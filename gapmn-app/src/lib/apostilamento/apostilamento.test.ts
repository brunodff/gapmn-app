import { test } from "node:test";
import assert from "node:assert/strict";
import { painel, statusContrato, dataBaseDe, isoDaVigencia } from "./painel.ts";
import { acumular, periodoDoReajuste, urlCalculadora, chaveIndice, buscarIndice } from "./indice.ts";
import { dadosIniciais, itensColados, paraMotor, reajustesAplicados, omDoNumero } from "./cadastro.ts";

const dia = (a: number, m: number, d: number) => ({ a, m, d });

// Casos conferidos com o painel_reajustes.py do pacote da SCON (mesmas entradas, mesma saída)
test("painel igual ao painel_reajustes.py da SCON", () => {
  const casos: [Parameters<typeof statusContrato>[0], ReturnType<typeof dia>, string, number, string | null, number | null, string[]][] = [
    [{ contrato: "A", data_base: "07/2024", reajustes_aplicados: 0 }, dia(2026, 11, 16), "VERMELHO", 2, "01/07/2027", 227, ["07/2024 a 06/2025/true", "07/2025 a 06/2026/true"]],
    [{ contrato: "B", data_base: "07/2024", reajustes_aplicados: 1 }, dia(2026, 11, 16), "VERMELHO", 1, "01/07/2027", 227, ["07/2025 a 06/2026/true"]],
    [{ contrato: "C", data_base: "07/2025" }, dia(2026, 7, 5), "AGUARDANDO_INDICE", 1, "01/07/2027", 361, ["07/2025 a 06/2026/false"]],
    [{ contrato: "D", data_base: "07/2024" }, dia(2026, 7, 5), "VERMELHO", 2, "01/07/2027", 361, ["07/2024 a 06/2025/true", "07/2025 a 06/2026/false"]],
    [{ contrato: "E", data_base: "07/2024", vigencia_fim: "2026-01-31" }, dia(2026, 11, 16), "VIGENCIA_ENCERRADA", 2, "01/07/2027", 227, ["07/2024 a 06/2025/true", "07/2025 a 06/2026/true"]],
    [{ contrato: "F", data_base: "07/2024", dedicacao_exclusiva: true }, dia(2026, 11, 16), "NAO_SE_APLICA", 0, null, null, []],
    [{ contrato: "F2", data_base: "07/2024", nao_aplicavel: "tarifa regulada da concessionária (contrato de adesão)" }, dia(2026, 11, 16), "NAO_SE_APLICA", 0, null, null, []],
    [{ contrato: "G", data_base: "01/2026" }, dia(2026, 11, 2), "AMARELO", 0, "01/01/2027", 60, []],
    [{ contrato: "H", data_base: "12/2025" }, dia(2026, 11, 16), "AMARELO", 0, "01/12/2026", 15, []],
  ];
  for (const [c, hoje, status, qtd, prox, dias, periodos] of casos) {
    const r = statusContrato(c, hoje);
    assert.equal(r.status, status, c.contrato);
    assert.equal(r.qtd_devidos, qtd, c.contrato);
    assert.equal(r.proximo_aniversario, prox, c.contrato);
    assert.equal(r.dias_para_proximo, dias, c.contrato);
    assert.deepEqual(r.reajustes_devidos.map((d) => `${d.periodo}/${d.indice_divulgado}`), periodos, c.contrato);
  }
});

test("painel: vigência encerrada vem antes da falta de data do orçamento (LEIA-ME da carga de 23/11)", () => {
  assert.equal(statusContrato({ contrato: "014", data_base: null, vigencia_fim: "2026-11-06" }, dia(2026, 11, 23)).status, "VIGENCIA_ENCERRADA");
  assert.equal(statusContrato({ contrato: "X", data_base: null, vigencia_fim: "2027-01-31" }, dia(2026, 11, 23)).status, "SEM_DATA_BASE");
  assert.equal(statusContrato({ contrato: "A", data_base: null, vigencia_fim: "2020-01-01", nao_aplicavel: "tarifa" }, dia(2026, 11, 23)).status, "NAO_SE_APLICA");
  assert.equal(isoDaVigencia("06/11/2026"), "2026-11-06");
  assert.equal(isoDaVigencia("2026-11-06T00:00:00"), "2026-11-06");
  assert.equal(isoDaVigencia(""), null);
});

test("painel: ordem e contrato sem data do orçamento", () => {
  const l = painel([{ contrato: "C", data_base: "05/2026" }, { contrato: "X", data_base: null }, { contrato: "A", data_base: "07/2024" }, { contrato: "B", data_base: "12/2025" }], dia(2026, 11, 16));
  assert.deepEqual(l.map((x) => `${x.contrato}:${x.status}`), ["A:VERMELHO", "B:AMARELO", "C:VERDE", "X:SEM_DATA_BASE"]);
  assert.equal(dataBaseDe("2024-07-01"), "07/2024");
  assert.equal(dataBaseDe(null), null);
});

// IPCA mensal do SGS (série 433) e os acumulados conferidos na Calculadora do Cidadão pela SCON
const IPCA_0724_0625 = ["0.38", "-0.02", "0.44", "0.56", "0.39", "0.52", "0.16", "1.31", "0.56", "0.43", "0.26", "0.24"];
const IPCA_0725_0626 = ["0.26", "-0.11", "0.48", "0.09", "0.18", "0.33", "0.33", "0.70", "0.88", "0.67", "0.58", "0.16"];

test("índice acumulado igual ao da Calculadora do Cidadão (6 casas)", () => {
  assert.equal(acumular(IPCA_0724_0625), 5.35117);
  assert.equal(acumular(IPCA_0725_0626), 4.64133);
  assert.equal(acumular(["-0.10", "-0.20"]), -0.2998); // fator 0,997002 → 0,9970020
  assert.equal(acumular(["0.5"]), 0.5);
});

test("período de 12 índices e link da Calculadora", () => {
  assert.deepEqual(periodoDoReajuste("07/2024", 1), { inicio: "07/2024", fim: "06/2025", aniversario: "07/2025" });
  assert.deepEqual(periodoDoReajuste("07/2024", 2), { inicio: "07/2025", fim: "06/2026", aniversario: "07/2026" });
  assert.deepEqual(periodoDoReajuste("01/2025", 1), { inicio: "01/2025", fim: "12/2025", aniversario: "01/2026" });
  assert.equal(urlCalculadora("IPCA", "07/2024", "06/2025", 16730),
    "https://www3.bcb.gov.br/CALCIDADAO/publico/corrigirPorIndice.do?method=corrigirPorIndice&aba=1&selIndice=00433IPCA&dataInicial=07/2024&dataFinal=06/2025&valorCorrecao=16.730,00");
  assert.equal(urlCalculadora("INCC", "07/2024", "06/2025", 1), null);
  assert.equal(chaveIndice("IPCA (Índice Nacional de Preços ao Consumidor Amplo)"), "IPCA");
  assert.equal(chaveIndice("igp-m"), "IGP-M");
});

test("busca no Banco Central: série, período e índice ainda não divulgado", async () => {
  let url = "";
  const falso = (async (u: string) => { url = u; return new Response(JSON.stringify(IPCA_0724_0625.map((valor) => ({ data: "01/01/2025", valor })))); }) as typeof fetch;
  const r = await buscarIndice("IPCA", "07/2024", "06/2025", 16730, falso);
  assert.match(url, /bcdata\.sgs\.433\/dados\?formato=json&dataInicial=01\/07\/2024&dataFinal=28\/06\/2025$/);
  assert.equal(r.percentual, 5.35117);
  assert.equal(r.completo, true);
  const onze = (async () => new Response(JSON.stringify(IPCA_0724_0625.slice(0, 11).map((valor) => ({ data: "x", valor }))))) as typeof fetch;
  assert.equal((await buscarIndice("IPCA", "07/2024", "06/2025", 1, onze)).completo, false);
  await assert.rejects(buscarIndice("INCC", "07/2024", "06/2025", 1, falso), /FGV/);
});

test("cadastro inicial a partir do contrato e dados para o motor", () => {
  const d = dadosIniciais({
    id: "1", numero_contrato: "999/GAPMN-BAMN/2025", pag_nup: "67000.000001/2025-00", fornecedor: "EMPRESA FICTICIA LTDA",
    cnpj: "11222333000181", descricao: "Serviço de exemplo", data_orcamento: "2024-07-01", data_final: "2030-02-03", vl_contratual: 611205,
  }, 2026);
  assert.equal(d.data_base, "07/2024");
  assert.equal(d.empresa.cnpj, "11.222.333/0001-81");
  assert.equal(d.om_contratante_sigla, "BAMN");
  assert.equal(d.reajustes.length >= 2, true, "dois aniversários já passaram");
  assert.deepEqual(d.historico_valores, [{ documento: "Contrato inicial", valor: 611205 }]);
  assert.equal(omDoNumero("045/2025"), "GAP-MN");
  const m = paraMotor({ ...d, contratante_paragrafo: "", itens: [{ item: 1, descricao: "A", qtd: 1, valor_unit: 10, valor_base: 120, qtd_inicial: null }] });
  assert.equal("contratante_paragrafo" in m, false);
  assert.equal("qtd_inicial" in m.itens[0], false);
  assert.equal("itens_total_inicial" in m, false);
  assert.equal(reajustesAplicados({ ...d, reajustes: [{ n: 1, indice_pct: 5, novo: false }, { n: 2, indice_pct: null, novo: true }] }), 1);
  // o checklist vai à parte; no IPCA fica o "pesquisa abaixo" do cadastro
  const ck = paraMotor({ ...d, indice: { nome: "IPCA", clausula: "c", fonte_curta: "pesquisa abaixo" }, checklist: [{ sim: true, nao: false, obs: "" }],
    data_base_fonte: { fonte: "TR" } });
  assert.equal("checklist" in ck, false);
  assert.equal("data_base_fonte" in ck, false);
  assert.equal(ck.indice.fonte_curta, "pesquisa abaixo");
});

test("INCC: sem o 'pesquisa abaixo' padrão, o motor põe 'conforme consulta abaixo' (print da FGV)", () => {
  const d = dadosIniciais({ id: "1", numero_contrato: "998/GAPMN/2025", pag_nup: null, fornecedor: null, cnpj: null, descricao: null,
    data_orcamento: "2025-11-01", data_final: null, vl_contratual: null }, 2026);
  const m = paraMotor({ ...d, indice: { ...d.indice, nome: "INCC", clausula: "c" } });
  assert.equal("fonte_curta" in m.indice, false);
  assert.equal(d.indice.fonte_curta, "pesquisa abaixo", "o cadastro não muda");
  assert.equal(paraMotor({ ...d, indice: { nome: "INCC-M", clausula: "c", fonte_curta: "tabela abaixo" } }).indice.fonte_curta, "tabela abaixo");
});

test("itens colados de planilha (tabulação, número brasileiro)", () => {
  const t = "1\tOUTSOURCING MONO\t26743\t1\t320,00\t3.840,00\n2\tEXCEDENTE\t26743\t1\tR$ 50,00\t600\nTOTAL\t\t\t\t\t16.730,00";
  assert.deepEqual(itensColados(t), [
    { item: 1, descricao: "OUTSOURCING MONO", catser: "26743", qtd: 1, valor_unit: 320, valor_base: 3840 },
    { item: 2, descricao: "EXCEDENTE", catser: "26743", qtd: 1, valor_unit: 50, valor_base: 600 },
  ]);
});
