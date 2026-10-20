// Testes do Painel Orçamentário (aba Crédito). Conferem a leitura das planilhas e as medidas do BI.
// Dados fictícios. Rodar na pasta gapmn-app:  npm test

import { test } from "node:test";
import assert from "node:assert/strict";

import { SEM_SIGLA, montarPainel } from "./calculo.ts";
import { fmtCompacto, fmtData, fmtMoeda, fmtPct } from "./formato.ts";
import { dataBR, lerDisponivel, lerEmpenhos, lerRecebido, numeroBR, parseCSV } from "./leitura.ts";
import type { DadosOrcamento, Empenho, LinhaDisponivel, LinhaRecebido } from "./tipos.ts";
import { REGRAS_DISPONIVEL, REGRAS_RECEBIDO, siglaDe } from "./unidades.ts";

const rec = (p: Partial<LinhaRecebido>): LinhaRecebido => ({
  data: "2026-03-10", ugNome: "", sigla: null, nd: "339030", ndNome: "MATERIAL DE CONSUMO",
  pi: "PI001", piNome: "PI TESTE", valor: 0, ...p,
});
const emp = (p: Partial<Empenho>): Empenho => ({
  ne: "NE1", data: "2026-03-10", ugNome: "", sigla: null, nd: "339030", piNome: "PI TESTE", valor: 0, ...p,
});
const disp = (p: Partial<LinhaDisponivel>): LinhaDisponivel => ({
  ptres: "1", pi: "PI001", piNome: "PI TESTE", nd: "339030", ndNome: "MATERIAL DE CONSUMO",
  ugNome: "", sigla: null, valor: 0, ...p,
});

test("números no formato brasileiro, inclusive milhar sem decimais e negativos", () => {
  assert.equal(numeroBR("1.234.567,89"), 1234567.89);
  assert.equal(numeroBR("-10,5"), -10.5);
  assert.equal(numeroBR("R$ 3,00"), 3);
  assert.equal(numeroBR("5000000"), 5000000);
  assert.equal(numeroBR("1.234"), 1234);
  assert.equal(numeroBR("(2,50)"), -2.5);
  assert.equal(numeroBR(""), null);
  assert.equal(numeroBR("abc"), null);
});

test("datas com dia e mês de um dígito (10 lançamentos ficavam de fora)", () => {
  assert.equal(dataBR("9/10/2026"), "2026-10-09");
  assert.equal(dataBR("09/10/2026 00:00:00"), "2026-10-09");
  assert.equal(dataBR("31/13/2026"), null);
  assert.equal(dataBR("Emissão - Dia"), null);
});

test("sigla pela primeira regra que casa, sem depender de acento", () => {
  assert.equal(siglaDe("SERV DE REC E MOBILIZACAO DE MANAUS", REGRAS_RECEBIDO), "SEREP-MN");
  assert.equal(siglaDe("COMISSÃO DE AEROPORTOS DA REGIAO AMAZONICA", REGRAS_RECEBIDO), "COMARA");
  assert.equal(siglaDe("BASE AEREA DE MANAUS", REGRAS_RECEBIDO), "BAMN");
  assert.equal(siglaDe("SERVICO REGIONAL DE ENGENHARIA E INFRAESTRUTURA", REGRAS_RECEBIDO), "SERINFRA-MN");
  assert.equal(siglaDe("SUBDIRETORIA DE ABASTECIMENTO", REGRAS_RECEBIDO), null);
  assert.equal(siglaDe("SUBDIRETORIA DE ABASTECIMENTO", REGRAS_DISPONIVEL), "GAP-MN");
  assert.equal(siglaDe("POLICLINICA DE MANAUS", REGRAS_DISPONIVEL), "HAMN");
  assert.equal(siglaDe("", REGRAS_RECEBIDO), null);
});

test("crédito recebido: cabeçalho na 3ª linha, preenchimento para baixo e linhas sem valor ignoradas", () => {
  const csv = [
    "Relatório de movimentação,,,,,,,,,,,,,,,,,,",
    ",,,,,,,,,,,,,,,,,,",
    "RO - Doc Web,Emissão - Dia,Emitente - UG,,UG Responsável,,Esfera Orçamentária,,Ação Governo,,PI,,PTRES,Natureza Despesa,,Fonte Recursos Detalhada,,Doc - Observação,Movim. Líquido - R$ (Item Informação)",
    'NC1,05/03/2026,1,EMIT,111,BASE AEREA DE MANAUS,1,FISCAL,2000,ADM,PI01,VIDA VEG,1,339030,MATERIAL DE CONSUMO,1,F,obs,"1.000,50"',
    'NC2,,,,,,,,,,,,,339039,"OUTROS SERVICOS, PJ",,,,"2.000,00"',
    "NC3,9/4/2026,1,EMIT,222,HOSPITAL DE AERONAUTICA DE MANAUS,1,FISCAL,2000,ADM,PI02,SAUDE,1,339030,MATERIAL DE CONSUMO,1,F,obs,-300",
    ",,,,,,,,,,,,,,,,,,",
    "Total,,,,,,,,,,,,,,,,,,",
  ].join("\n");
  const l = lerRecebido(parseCSV(csv));
  assert.equal(l.length, 3);
  assert.deepEqual(l[1], {
    data: "2026-03-05", ugNome: "BASE AEREA DE MANAUS", sigla: "BAMN", nd: "339039", ndNome: "OUTROS SERVICOS, PJ",
    pi: "PI01", piNome: "VIDA VEG", valor: 2000,
  });
  assert.equal(l[2].data, "2026-04-09");
  assert.equal(l[2].sigla, "HAMN");
  assert.equal(l[2].valor, -300);
  assert.throws(() => lerRecebido(parseCSV("a,b\n1,2")), /Emissão/);
});

test("empenhos: vale o último valor de cada item e a nota soma os itens; favorecido não é lido", () => {
  // Colunas: 0 data, 1 NE, 2 item, 3–5 outros, 6 valor do item, 7–8 outros, 9 UG, 10 ND, 11 nome ND,
  // 12 PI, 13 nome do PI, 14–16 outros, 17 documento do favorecido, 18 nome do favorecido, 19, 20.
  const lin = (c: Record<number, string>) => Array.from({ length: 21 }, (_, i) => c[i] ?? "");
  const linhas = [
    lin({ 0: "Notas de Empenho" }),
    lin({ 0: "15/01/2026", 1: "NE0001", 2: "1", 6: "100,00", 9: "BASE AEREA DE MANAUS", 10: "339030", 13: "VIDA VEG", 17: "00000000000", 18: "FULANO FICTICIO" }),
    lin({ 0: "20/01/2026", 2: "1", 6: "150,00" }),
    lin({ 0: "20/01/2026", 2: "2", 6: "50,00" }),
    lin({ 0: "21/01/2026", 2: "2", 6: "" }),
    lin({ 0: "02/02/2026", 1: "NE0002", 2: "1", 6: "1.000,00", 9: "HOSPITAL DE AERONAUTICA DE MANAUS", 10: "339039", 13: "SAUDE" }),
  ];
  const e = lerEmpenhos(linhas);
  assert.equal(e.length, 2);
  assert.deepEqual(e[0], {
    ne: "NE0001", data: "2026-01-15", ugNome: "BASE AEREA DE MANAUS", sigla: "BAMN", nd: "339030", piNome: "VIDA VEG", valor: 200,
  });
  assert.equal(e[1].valor, 1000);
  assert.ok(!JSON.stringify(e).includes("FULANO"), "nome do favorecido não pode ser lido");
  assert.throws(() => lerEmpenhos([["15/01/2026", "NE1", "1"]]), /colunas/);
});

test("crédito disponível: preenche as 7 primeiras colunas e ignora linha de total", () => {
  const csv = [
    "Saldo por UG,,,,,,,",
    "PTRES,PI,,Natureza Despesa,,UG Responsável,,Saldo - R$ (Item Informação)",
    'P1,PI01,VIDA VEG,339030,MATERIAL DE CONSUMO,111,BASE AEREA DE MANAUS,"10,00"',
    ',,,339039,OUTROS SERVICOS,,,"5,00"',
    ",,,,,,,",
    'Total,,,,,,,"15,00"',
  ].join("\n");
  const l = lerDisponivel(parseCSV(csv));
  assert.equal(l.length, 2);
  assert.equal(l[1].ugNome, "BASE AEREA DE MANAUS");
  assert.equal(l[1].sigla, "BAMN");
  assert.equal(l[1].piNome, "VIDA VEG");
  assert.equal(l[1].nd, "339039");
});

const BASE: DadosOrcamento = {
  recebido: [
    rec({ data: "2026-03-10", sigla: "BAMN", ugNome: "BASE AEREA DE MANAUS", valor: 1000 }),
    rec({ data: "2026-04-02", sigla: "BAMN", ugNome: "BASE AEREA DE MANAUS", nd: "339039", ndNome: "OUTROS SERVICOS", valor: 3000 }),
    rec({ data: "2026-04-05", sigla: "HAMN", ugNome: "HOSPITAL", valor: 500 }),
    rec({ data: "2026-04-05", sigla: null, ugNome: "SUBDIRETORIA DE ABASTECIMENTO", valor: 200 }),
  ],
  empenhos: [
    emp({ ne: "NE1", sigla: "BAMN", piNome: "VIDA VEG", valor: 900 }),
    emp({ ne: "NE2", sigla: "BAMN", nd: "339039", piNome: "CONTRATOS", valor: 2500 }),
    emp({ ne: "NE3", sigla: "HAMN", piNome: "VIDA VEG", valor: 300 }),
    emp({ ne: "NE4", sigla: "HAMN", piNome: "ZERADO", valor: 0 }),
  ],
  disponivel: [
    disp({ sigla: "BAMN", ugNome: "BASE", valor: 100 }),
    disp({ sigla: "BAMN", ugNome: "BASE", nd: "339039", valor: 50 }),
    disp({ sigla: "HAMN", ugNome: "HOSPITAL", valor: 150 }),
    disp({ sigla: "PAMN", ugNome: "PREFEITURA", valor: 20 }),
    disp({ sigla: null, ugNome: "UG SEM CADASTRO", valor: 5 }),
  ],
};

test("cartões, % empenhado, meses em ordem de valor e 'Atualizado em' pela última emissão", () => {
  const p = montarPainel(BASE, { om: null, nd: null });
  assert.equal(p.recebido, 4700);
  assert.equal(p.empenhado, 3700);
  assert.equal(fmtPct(p.pctEmpenhado), "78,72%");
  assert.equal(p.atualizadoEm, "2026-04-05");
  assert.equal(p.ano, 2026);
  assert.deepEqual(p.porMes.map((m) => [m.rotulo, m.valor]), [["abr", 3700], ["mar", 1000]]);
  assert.deepEqual(p.porPI.map((x) => x.rotulo), ["CONTRATOS", "VIDA VEG"], "PI zerado não aparece");
  assert.equal(p.porPI[1].valor, 1200);
  assert.deepEqual(p.porOM.map((x) => x.rotulo), ["BAMN", "HAMN", SEM_SIGLA]);
  assert.equal(p.porOM[2].dica, "SUBDIRETORIA DE ABASTECIMENTO");
  assert.equal(montarPainel({ recebido: [], empenhos: [], disponivel: [] }, { om: null, nd: null }).pctEmpenhado, null);
});

test("faixa: todas as apoiadas, inclusive sem crédito, do maior para o menor", () => {
  const p = montarPainel(BASE, { om: null, nd: null });
  assert.equal(p.faixa.length, 13);
  assert.deepEqual(p.faixa.slice(0, 2).map((x) => [x.sigla, x.valor]), [["BAMN", 4000], ["HAMN", 500]]);
  assert.ok(p.faixa.slice(2).every((x) => x.valor === 0));
  assert.equal(p.faixa[0].logo, "/om/bamn.png");
});

test("filtro de OM: muda cartões e gráficos, mas não a faixa nem o disponível (como no BI)", () => {
  const todos = montarPainel(BASE, { om: null, nd: null });
  const p = montarPainel(BASE, { om: "HAMN", nd: null });
  assert.equal(p.recebido, 500);
  assert.equal(p.empenhado, 300);
  assert.deepEqual(p.porOM.map((x) => x.rotulo), ["HAMN"]);
  assert.deepEqual(p.porMes.map((x) => x.rotulo), ["abr"]);
  assert.deepEqual(p.faixa, todos.faixa);
  assert.deepEqual(p.disponivel, todos.disponivel);
});

test("filtro de ND: vale para tudo, inclusive faixa e disponível", () => {
  const p = montarPainel(BASE, { om: null, nd: "339039" });
  assert.equal(p.recebido, 3000);
  assert.equal(p.empenhado, 2500);
  assert.equal(p.faixa[0].valor, 3000);
  assert.deepEqual(p.disponivel.map((u) => [u.sigla, u.valor]), [["BAMN", 50]]);
  assert.equal(p.totalDisponivel, 50);
});

test("disponível: posição com empate, nome da UG quando não há sigla e recebido no último dia", () => {
  const p = montarPainel(BASE, { om: null, nd: null });
  assert.deepEqual(p.disponivel.map((u) => [u.rank, u.sigla, u.valor]), [
    [1, "BAMN", 150], [1, "HAMN", 150], [2, "PAMN", 20], [3, "UG SEM CADASTRO", 5],
  ]);
  assert.equal(p.disponivel[1].recebidoUltimoDia, 500, "HAMN recebeu 500 em 05/04");
  assert.equal(p.disponivel[0].recebidoUltimoDia, null, "BAMN não recebeu em 05/04");
  assert.deepEqual(p.disponivel[0].linhas.map((l) => l.valor), [100, 50], "linhas do tooltip do maior para o menor");
  assert.equal(p.totalDisponivel, 325);
});

test("opções dos filtros", () => {
  const p = montarPainel(BASE, { om: null, nd: null });
  assert.deepEqual(p.opcoesOM, ["BAMN", "HAMN"]);
  assert.deepEqual(p.opcoesND.map((o) => o.codigo), ["339030", "339039"]);
  assert.equal(p.opcoesND[1].nome, "OUTROS SERVICOS");
});

test("formatos do BI", () => {
  assert.equal(fmtCompacto(107889276.96), "107,89 Mi");
  assert.equal(fmtCompacto(387641.95, 1), "387,6 Mil");
  assert.equal(fmtCompacto(950), "950,00");
  assert.equal(fmtMoeda(1207459.84), "R$ 1.207.459,84");
  assert.equal(fmtMoeda(-5), "-R$ 5,00");
  assert.equal(fmtData("2026-10-19"), "19/10/2026");
});
