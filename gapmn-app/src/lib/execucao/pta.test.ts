// Testes da composição orçamentária da minuta do PTA (cap. VII) gerada com os dados do Painel de Execução.
// Dados fictícios. Rodar na pasta gapmn-app:  npm test

import { test } from "node:test";
import assert from "node:assert/strict";

import type { NotaEmpenho } from "./empenhos.ts";
import type { ContratoResumo, Vinculo } from "./painel.ts";
import { conferirComposicao, gerarComposicao, periodoDe, textoCapitulo, totalArtigo, totalComposicao } from "./pta.ts";
import { MACROPROCESSOS, ehDaMatriz, macroDaTarefa, macroSugerido, ultimoDaMatriz } from "./ptaMatriz.ts";

let seq = 0;
function ne(p: Partial<NotaEmpenho> & { itens: { nome: string; valor: number; categoria: NotaEmpenho["categoria"] }[] }): NotaEmpenho {
  seq++;
  const numero = `2026NE${String(seq).padStart(6, "0")}`;
  return {
    ne: numero, emissao: "2026-03-10", ultimoLancamento: "2026-03-10", ug: "120630", ugNome: "GRUPAMENTO DE APOIO DE MANAUS",
    natureza: "339030", naturezaNome: "MATERIAL DE CONSUMO", pi: "PI00001", piNome: "VIDA VEGETATIVA - SEFA",
    pag: "", pagChave: null, favorecido: { tipo: "empresa", documento: "01234567000189", nome: "EMPRESA FICTICIA" },
    observacao: "", solicitacao: null, assinada: true, lancamentos: ["2026-03-10"], categoria: p.itens[0].categoria,
    ...p,
    itens: p.itens.map((i, k) => ({ seq: String(k + 1), itemCompra: String(k + 1), descricao: `Item compra: 0000${k + 1} - ${i.nome}`, nome: i.nome, valor: i.valor, categoria: i.categoria })),
    valor: p.itens.reduce((s, i) => s + i.valor, 0),
  } as NotaEmpenho;
}

const ctrLimpeza: ContratoResumo = {
  id: "c-limp", numero: "DESPESA 018/GAPMN/2026", objeto: "CONTRATAÇÃO DE SERVIÇO DE LIMPEZA DO GAP-MN", fornecedor: "LIMPA LTDA",
  cnpj: null, pagChave: "672980000012026", inicio: "2026-08-04", fim: "2027-08-04", valor: 373891.4, status: "Vigente",
};

const NES: NotaEmpenho[] = [
  // material de consumo, vida vegetativa: alimentação em 6 meses diferentes (vira "Mensal") + limpeza
  ...["01", "02", "03", "04", "05", "06"].map((m) => ne({ emissao: `2026-${m}-15`, itens: [{ nome: "CAFE", valor: 1000, categoria: "alimentacao" }] })),
  ne({ emissao: "2026-05-02", itens: [{ nome: "DETERGENTE", valor: 4000, categoria: "limpeza" }] }),
  // item pequeno (menos de 2% e junto dos outros pequenos vira "diversos")
  ne({ emissao: "2026-05-02", itens: [{ nome: "LAPIS", valor: 30, categoria: "expediente" }, { nome: "CORDA", valor: 40, categoria: "outros" }] }),
  // serviço com contrato, em dois meses (contrato → "Anual")
  ne({ natureza: "339039", naturezaNome: "OUTROS SERVICOS DE TERCEIROS - PESSOA JURIDICA", pi: "PI00006", piNome: "CONTRATOS CONTINUADOS - SEFA",
    emissao: "2026-08-10", itens: [{ nome: "PRESTACAO DE SERVICO DE LIMPEZA", valor: 50000, categoria: "limpeza" }] }),
  ne({ natureza: "339039", naturezaNome: "OUTROS SERVICOS DE TERCEIROS - PESSOA JURIDICA", pi: "PI00006", piNome: "CONTRATOS CONTINUADOS - SEFA",
    emissao: "2026-10-01", itens: [{ nome: "PRESTACAO DE SERVICO DE LIMPEZA", valor: 25000, categoria: "limpeza" }] }),
  // diárias
  ne({ natureza: "339015", naturezaNome: "DIARIAS - PESSOAL MILITAR", pi: "OPX", piNome: "OPERACAO EXCELSIOR", emissao: "2026-04-20",
    itens: [{ nome: "Diarias da operacao", valor: 9000, categoria: "deslocamento" }] }),
  // fora do capítulo: folha e indenização
  ne({ natureza: "319012", naturezaNome: "VENCIMENTOS", pi: "PAG", piNome: "PAGAMENTO MILITAR ATIVA", itens: [{ nome: "folha", valor: 900000, categoria: "pessoal" }] }),
  ne({ natureza: "339093", naturezaNome: "INDENIZACOES E RESTITUICOES", itens: [{ nome: "indenizacao", valor: 500, categoria: "pessoal" }] }),
  // outra UG e outro ano: não entram
  ne({ ug: "120154", itens: [{ nome: "REAGENTE", valor: 7777, categoria: "saude" }] }),
  ne({ emissao: "2025-11-11", itens: [{ nome: "CAFE", valor: 8888, categoria: "alimentacao" }] }),
];

const VINCULOS = new Map<string, Vinculo>(NES.filter((n) => n.natureza === "339039").map((n) => [n.ne, { contrato: ctrLimpeza, processo: null }]));
const COMP = gerarComposicao(NES, VINCULOS, { ano: 2027, agora: "2026-10-21T00:00:00Z" });

test("só a UG do GAP-MN e o ano de base; folha e indenização ficam fora, listadas", () => {
  const tudo = JSON.stringify(COMP.artigos);
  assert.ok(!tudo.includes("7777") && !tudo.includes("8888"));
  assert.deepEqual(COMP.excluidos.map((e) => [e.nd, e.valor]), [["319012", 900000], ["339093", 500]]);
  assert.equal(COMP.anoBase, 2026);
  assert.equal(COMP.recorte, "2026-10-01");
});

test("um artigo por natureza de despesa e PI, com ação a confirmar", () => {
  assert.deepEqual(COMP.artigos.map((a) => [a.nd, a.pi]), [["339015", "OPX"], ["339030", "PI00001"], ["339039", "PI00006"]]);
  assert.match(COMP.artigos[1].titulo, /^MATERIAL DE CONSUMO – VIDA VEGETATIVA - SEFA$/);
  assert.ok(COMP.artigos.every((a) => a.acao === "a confirmar"));
});

test("tarefas: alimentação mensal, contrato anual, diversos com os pequenos; valor proposto = base", () => {
  const mc = COMP.artigos[1];
  const desc = mc.tarefas.map((t) => [t.descricao, t.periodo, t.valor]);
  assert.deepEqual(desc, [
    ["Adquirir gêneros alimentícios e material de copa e cozinha", "Mensal", 6000],
    ["Adquirir material de higiene e limpeza", "Maio", 4000],
    ["Quitar despesas diversas", "Anual", 70],
  ]);
  assert.equal(totalArtigo(mc), 10070);
  const serv = COMP.artigos[2].tarefas[0];
  assert.equal(serv.descricao, "Quitar as despesas do contrato DESPESA 018/GAPMN/2026 (contratação de serviço de limpeza do gap-mn)");
  assert.equal(serv.periodo, "Anual");
  assert.equal(serv.valor, 75000);
  assert.equal(serv.base, 75000);
  assert.equal(serv.observacao, "contrato vence em 04/08/2027");
  assert.equal(COMP.artigos[0].tarefas[0].descricao, "Pagar diárias – Operacao Excelsior");
  assert.equal(totalComposicao(COMP), 94070);
});

test("códigos: ano do PTA + macroprocesso da Matriz + sequencial depois das tarefas da Matriz", () => {
  const codigos = COMP.artigos.flatMap((a) => a.tarefas.map((t) => t.codigo));
  // diárias → PES (Matriz vai até 006); gêneros → SUB (005); limpeza → ADM (005); diversos → PAT (005)
  assert.deepEqual(codigos, ["27PES007", "27SUB006", "27ADM006", "27PAT006", "27ADM007"]);
  assert.equal(macroSugerido("449052", "equipamentos"), "PAT");
  assert.equal(macroSugerido("449052", "tic"), "TIC");
  assert.equal(macroSugerido("339039", "engenharia"), "INF");
  assert.equal(macroSugerido("339039", "utilidades"), "ADM");
  assert.equal(macroSugerido("339030", "equipamentos"), "SPV");
  assert.equal(macroSugerido("339030", "veiculos"), "STR");
  assert.equal(macroSugerido("339092", "outros"), "FIN");
  assert.deepEqual(conferirComposicao(COMP), []);
});

test("macroprocesso de tarefas já escritas (minutas com código por setor)", () => {
  assert.equal(macroDaTarefa("339015", "Pagar diárias – Operacao Excelsior"), "PES");
  assert.equal(macroDaTarefa("339030", "Adquirir gêneros alimentícios e material de copa e cozinha"), "SUB");
  assert.equal(macroDaTarefa("339030", "Quitar as despesas do contrato DESPESA 045/GAPMN/2025 (agricultura familiar)"), "SUB");
  assert.equal(macroDaTarefa("339030", "Adquirir fardamento, mobiliário e material individual"), "SPV");
  assert.equal(macroDaTarefa("339030", "Adquirir material de manutenção predial e infraestrutura"), "INF");
  assert.equal(macroDaTarefa("339039", "Quitar as despesas do contrato DESPESA 018/GAPMN/2026 (contratação de serviço de limpeza do gap-mn)"), "ADM");
  assert.equal(macroDaTarefa("339039", "Quitar as despesas de energia elétrica"), "ADM");
  assert.equal(macroDaTarefa("339040", "Contratar serviços de tecnologia da informação e telefonia"), "TIC");
  assert.equal(macroDaTarefa("449052", "Adquirir freezer"), "PAT");
  assert.equal(macroDaTarefa("339030", "Quitar despesas diversas"), "PAT");
  assert.equal(macroDaTarefa("339039", "Quitar as despesas do contrato 00036/2021 (serviços de administração e gerenciamento compartilhado de frota)"), "STR");
  assert.equal(macroDaTarefa("339039", "Quitar as despesas do contrato DESPESA 006/2025 (serviço de outsourcing de impressão)"), "TIC");
  assert.equal(macroDaTarefa("339039", "Quitar as despesas do contrato DESPESA 043/2021 (outsourcing para operação de almoxarifado virtual)"), "PAT");
  assert.equal(macroDaTarefa("339039", "Quitar as despesas do contrato DESPESA 066/2024 (empresa brasileira de correios e telégrafos (ebct))"), "ARQ");
  assert.equal(macroDaTarefa("339039", "Quitar as despesas do contrato DESPESA 009/2023 (assinatura de ferramenta de pesquisas de preço)"), "CON");
  assert.equal(macroDaTarefa("339039", "Contratar serviços de manutenção e reparo de equipamentos, mobiliário e fardamento", "SISHT - SEFA"), "SHT");
  assert.equal(macroDaTarefa("449052", "Adquirir veiculos teleguiados"), "PAT", "material permanente fica no patrimônio");
  assert.equal(macroSugerido("339039", "limpeza", "SISHT - SEFA"), "SHT");
});

test("Matriz da DIRAD: trigramas e códigos reservados", () => {
  assert.equal(ultimoDaMatriz("SPV"), 14);
  assert.equal(ultimoDaMatriz("DIE"), 0, "trigrama de setor não é da Matriz");
  assert.ok(ehDaMatriz("FIN", 5) && !ehDaMatriz("FIN", 6) && !ehDaMatriz("FIN", 0));
  assert.ok(MACROPROCESSOS.ARQ && !MACROPROCESSOS.DOC, "documental usa ARQ, como nas tarefas da Matriz");
});

test("período pelos meses de emissão", () => {
  assert.equal(periodoDe(["2026-03-01"], false), "Março");
  assert.equal(periodoDe(["2026-03-01", "2026-08-01"], false), "Mar e Ago");
  assert.equal(periodoDe(["2026-03-01", "2026-05-01", "2026-08-01"], false), "Mar, Mai e Ago");
  assert.equal(periodoDe(["2026-03-01", "2026-08-01"], true), "Anual");
  assert.equal(periodoDe(["01", "02", "03", "04", "05", "06"].map((m) => `2026-${m}-01`), true), "Mensal");
});

test("conferência aponta código repetido, prefixo errado e diversos acima de 10%", () => {
  const ruim = {
    ano: 2027,
    artigos: [{
      id: "a", nd: "339030", ndNome: "", pi: "", piNome: "", titulo: "MATERIAL DE CONSUMO", acao: "2000",
      tarefas: [
        { id: "1", codigo: "27DIE001", periodo: "Mensal", descricao: "Adquirir café", valor: 50, base: 50, nes: 1, contrato: null, observacao: "" },
        { id: "2", codigo: "27DIE001", periodo: "Maio", descricao: "Adquirir detergente", valor: 30, base: 30, nes: 1, contrato: null, observacao: "" },
        { id: "3", codigo: "26DIE002", periodo: "", descricao: "Despesas diversas", valor: 20, base: 20, nes: 1, contrato: null, observacao: "" },
      ],
    }],
  };
  const avisos = conferirComposicao(ruim);
  assert.ok(avisos.some((a) => /27DIE001 repetido/.test(a)));
  assert.ok(avisos.some((a) => /26DIE002: o código deve começar por 27/.test(a)));
  assert.ok(avisos.some((a) => /passa de 10%/.test(a)));
  assert.ok(avisos.some((a) => /sem período/.test(a)));
});

test("texto do capítulo no formato do PTA, numerando a partir do artigo informado", () => {
  const t = textoCapitulo(COMP, 38).split("\n");
  assert.equal(t[0], "CAPÍTULO VII");
  assert.equal(t[3], "Art. 38 DIÁRIAS MILITARES – OPERACAO EXCELSIOR – ND 339015 – Ação: «a confirmar» – R$ 9.000,00");
  assert.equal(t[5], "CÓDIGO\tPERÍODO\tTAREFA\tTOTAL (R$)");
  assert.equal(t[6], "27PES007\tAbril\tPagar diárias – Operacao Excelsior\t9.000,00");
  assert.ok(t.includes("Art. 40 SERVIÇOS DE TERCEIROS – PESSOA JURÍDICA – CONTRATOS CONTINUADOS - SEFA – ND 339039 – Ação: «a confirmar» – R$ 75.000,00"));
});
