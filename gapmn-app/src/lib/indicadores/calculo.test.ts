// Testes das regras do Painel de Governança (F.2). Cada um corresponde a um erro real.
// Dados fictícios. Rodar na pasta gapmn-app:  npm test

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  calcularAtingimento, calcularPainel, calcularStatus, compararId, competenciaReferencia,
  filtrarIndicadores, montarCompetencias, normalizarLinhas, scoreWilson,
} from "./calculo.ts";
import {
  competenciaPorExtenso, fmtPercentual, fmtValor, fraseVariacao, larguraCss, metaExibida,
} from "./formato.ts";
import { gravarFiltros, lerFiltros } from "./filtros.ts";
import type { LinhaBD } from "./tipos.ts";

const MESES: Record<string, [string, number, string]> = {
  "JAN-JUN/26": ["JAN-JUN", 6, "2026-06-01"],
  "JUL/26": ["JUL", 7, "2026-07-01"],
  "AGO/26": ["AGO", 8, "2026-08-01"],
  "SET/26": ["SET", 9, "2026-09-01"],
};

function linha(comp: keyof typeof MESES, p: Partial<LinhaBD> = {}): LinhaBD {
  const [mes, mesNum, data] = MESES[comp];
  return {
    ID: "1", DIVISAO: "DRH", CATEGORIA: "1. GESTÃO DE PESSOAL", INDICADOR: "Indicador de teste",
    UNIDADE: "Dias úteis", FORMULA: "X = A ÷ B", META_TXT: "10 dias úteis", META_NUM: 10,
    DIRECAO: "Menor é melhor", TIPO: "Realizado", ANO: 2026, MES_NUM: mesNum, MES: mes, DATA: data,
    VALOR: null, VAR1_NOME: null, VAR1_VALOR: null, VAR2_NOME: null, VAR2_VALOR: null, VAR3_NOME: null, VAR3_VALOR: null,
    ...p,
  };
}

/** Indicador "maior é melhor" com meta 1 e o valor dado, para montar divisões. */
function ind(id: string, divisao: string, valor: number | null, comp: keyof typeof MESES = "JUL/26"): LinhaBD {
  return linha(comp, { ID: id, DIVISAO: divisao, DIRECAO: "Maior é melhor", META_NUM: 1, META_TXT: "≥ 1", UNIDADE: "Unidade (Número Absoluto)", VALOR: valor });
}

// 1
test("ID '17.1' continua texto na ida e volta e ordena entre 17 e 18", () => {
  const bruto = JSON.parse(JSON.stringify([{ ...linha("JUL/26"), ID: 17.1 }, { ...linha("JUL/26"), ID: "17,2" }]));
  const { linhas } = normalizarLinhas(bruto);
  assert.equal(linhas[0].ID, "17.1");
  assert.equal(typeof linhas[0].ID, "string");
  assert.equal(linhas[1].ID, "17.2");
  assert.deepEqual(["18", "17.2", "17", "24.1", "17.1", "2"].sort(compararId), ["2", "17", "17.1", "17.2", "18", "24.1"]);
});

// 2
test("JAN-JUN/26 é semestre, DATA 2026-06-01, e vem antes de JUL/26", () => {
  const comps = montarCompetencias([linha("JUL/26"), linha("JAN-JUN/26")]);
  assert.deepEqual(comps.map((c) => c.label), ["JAN-JUN/26", "JUL/26"]);
  assert.equal(comps[0].data, "2026-06-01");
  assert.equal(comps[0].semestral, true);
  assert.equal(comps[1].semestral, false);
  assert.equal(competenciaPorExtenso("JAN-JUN/26"), "1º semestre de 2026");
  assert.equal(competenciaPorExtenso("JUL/26"), "julho de 2026");
});

// 3
test("lançamento adiantado de 'Quantidade' não move a competência de referência", () => {
  const bd = [
    linha("JUL/26", { VALOR: 5 }),
    linha("SET/26", { ID: "40", UNIDADE: "Quantidade", DIRECAO: "Monitoramento", META_NUM: null, META_TXT: null, CATEGORIA: "Pendências do e-Pessoal", DIVISAO: "ACI", VALOR: 3 }),
  ];
  assert.equal(competenciaReferencia(bd)?.label, "JUL/26");
  assert.equal(calcularPainel(bd).referencia?.label, "JUL/26");
});

// 4
test("valor ancorado na referência: 52,21 em JAN-JUN e 5 em JUL exibe 5, não 57,21", () => {
  const bd = [linha("JAN-JUN/26", { VALOR: 52.21 }), linha("JUL/26", { VALOR: 5 })];
  const p = calcularPainel(bd);
  assert.equal(p.referencia?.label, "JUL/26");
  assert.equal(p.indicadores[0].valor, 5);
  assert.equal(p.indicadores[0].valorAnterior, 52.21);
});

// 5
test("meta 1, valor 43, maior é melhor → 4300% (sem teto)", () => {
  const at = calcularAtingimento(linha("JUL/26", { DIRECAO: "Maior é melhor", META_NUM: 1, VALOR: 43 }));
  assert.equal(at, 43);
  assert.equal(fmtPercentual(at), "4.300%");
  assert.equal(larguraCss(at), "100.0%"); // largura limitada, número real no rótulo
});

// 6
test("menor é melhor com valor 0 → adequado, sem divisão por zero", () => {
  const l = linha("JUL/26", { VALOR: 0 });
  const at = calcularAtingimento(l);
  assert.equal(at, 1);
  assert.equal(calcularStatus(l, at), "Adequado");
});

// 7
test("ID 16: aumento (1058 contra 126) → 0; redução (51 contra 90) → positivo", () => {
  const base = { ID: "16", DIRECAO: "Maior é melhor" as const, META_NUM: 10, UNIDADE: "Percentual (%)" };
  const aumento = linha("JUL/26", { ...base, VALOR: 739.68, VAR1_VALOR: 1058, VAR2_VALOR: 126 });
  const reducao = linha("JUL/26", { ...base, VALOR: 43.33, VAR1_VALOR: 51, VAR2_VALOR: 90 });
  assert.equal(calcularAtingimento(aumento), 0);
  assert.ok((calcularAtingimento(reducao) as number) > 0);
  assert.equal(calcularStatus(aumento, 0), "Crítico");
  assert.equal(fraseVariacao(90, 51), "Variação de −43,3% no período (de 90 para 51)");
  assert.equal(fraseVariacao(126, 1058), "Variação de +739,7% no período (de 126 para 1.058)");
  // ID 22 com o estoque igual nos dois meses: não houve redução
  assert.equal(calcularAtingimento(linha("JUL/26", { ...base, ID: "22", META_NUM: 5, VALOR: 0, VAR1_VALOR: 7944.95, VAR2_VALOR: 7944.95 })), 0);
});

// 8
test("VALOR vazio: sem variáveis → Aguardando; VAR2 = 0 → Sem dados no mês", () => {
  assert.equal(calcularStatus(linha("JUL/26"), null), "Aguardando informação");
  assert.equal(calcularStatus(linha("JUL/26", { VAR1_VALOR: 134, VAR2_VALOR: 0 }), null), "Sem dados no mês de referência");
  assert.equal(calcularStatus(linha("JUL/26", { VAR1_VALOR: 0, VAR2_VALOR: 0 }), null), "Sem dados no mês de referência");
  // caso da planilha: só o denominador informado → o resultado ainda não existe
  assert.equal(calcularStatus(linha("JUL/26", { VAR2_VALOR: 50 }), null), "Aguardando informação");
});

// 9
test("Wilson: 1 adequado fica atrás de 9 adequados em 10", () => {
  const bd = [
    ind("1", "DRH", 5),
    ...Array.from({ length: 9 }, (_, i) => ind(String(10 + i), "DIE", 2)),
    ind("19", "DIE", 0.1),
  ];
  const { divisoes, podio } = calcularPainel(bd);
  const drh = divisoes.find((d) => d.sigla === "DRH")!, die = divisoes.find((d) => d.sigla === "DIE")!;
  assert.equal(die.posicao, 1);
  assert.equal(drh.posicao, 2);
  assert.ok((die.score as number) > (drh.score as number));
  assert.equal(podio[0].sigla, "DIE");
  assert.ok(Math.abs((scoreWilson(1, 1) as number) - 0.2065) < 0.001);
});

// 10
test("divisão com n = 0 não recebe posição", () => {
  const bd = [ind("1", "DRH", 5), linha("JUL/26", { ID: "2", DIVISAO: "DA" })];
  const da = calcularPainel(bd).divisoes.find((d) => d.sigla === "DA")!;
  assert.equal(da.n, 0);
  assert.equal(da.score, null);
  assert.equal(da.posicao, null);
});

// 11
test("ID 35 aparece como COMSOC e não entra na nota de ASESO", () => {
  const bd = [ind("19", "ASESO", 0.5), ind("35", "ASESO", 4)];
  const p = calcularPainel(bd);
  const i35 = p.indicadores.find((i) => i.id === "35")!;
  assert.equal(i35.divisaoExibida, "COMSOC");
  assert.equal(i35.pontos, null);
  const aseso = p.divisoes.find((d) => d.sigla === "ASESO")!;
  assert.equal(aseso.n, 1);
  assert.equal(aseso.pontos, 0);
  const comsoc = p.divisoes.find((d) => d.sigla === "COMSOC")!;
  assert.equal(comsoc.foraDoRanking, true);
  assert.equal(comsoc.posicao, null);
  assert.equal(p.resumo.n, 1); // o card de saúde geral também não conta o 35
});

// 12
test("tendência 3M é '—' (null) com menos de 3 competências com dado", () => {
  const dois = calcularPainel([linha("JAN-JUN/26", { VALOR: 8 }), linha("JUL/26", { VALOR: 6 })]);
  assert.equal(dois.indicadores[0].tendencia, null);
  const tres = calcularPainel([linha("JAN-JUN/26", { VALOR: 8 }), linha("JUL/26", { VALOR: 6 }), linha("AGO/26", { VALOR: 4 })]);
  assert.equal(tres.indicadores[0].tendencia?.media, -2);
  assert.equal(tres.indicadores[0].tendencia?.sentido, "melhora"); // menor é melhor e caiu
});

// 13
test("ordem: aguardando e sem dados antes de qualquer indicador com atingimento", () => {
  const bd = [
    ind("1", "DRH", 0.01),                                         // crítico, atingimento 1%
    ind("2", "DRH", 3),                                            // adequado
    linha("JUL/26", { ID: "3", VAR1_VALOR: 0, VAR2_VALOR: 0 }),    // sem dados
    linha("JUL/26", { ID: "4" }),                                  // aguardando
  ];
  assert.deepEqual(calcularPainel(bd).indicadores.map((i) => i.id), ["4", "3", "1", "2"]);
});

// ── Complementares ───────────────────────────────────────────────────────────

test("null não vira 0: aguardando fica fora da nota e da média", () => {
  const p = calcularPainel([ind("1", "DRH", 3), linha("JUL/26", { ID: "2" })]);
  assert.equal(p.resumo.n, 1);
  assert.equal(p.resumo.saudeGeral, 1);
  assert.equal(p.resumo.aguardando, 1);
  assert.equal(p.resumo.completude.esperados, 2);
  assert.equal(p.resumo.completude.preenchidos, 1);
});

test("'sem dados no mês' conta como preenchido na completude", () => {
  const p = calcularPainel([ind("1", "DRH", 3), linha("JUL/26", { ID: "2", VAR1_VALOR: 0, VAR2_VALOR: 0 })]);
  assert.equal(p.resumo.completude.preenchidos, 2);
  assert.equal(p.resumo.completude.comResultado, 1);
});

test("cortes: 0,70 é Atenção e 1,00 é Adequado", () => {
  const l = linha("JUL/26", { DIRECAO: "Maior é melhor", META_NUM: 10, VALOR: 7 });
  assert.equal(calcularStatus(l, calcularAtingimento(l)), "Atenção");
  const m = linha("JUL/26", { META_NUM: 24, VALOR: 24 / 0.7 });
  assert.equal(calcularStatus(m, calcularAtingimento(m)), "Atenção");
  assert.equal(calcularStatus(l, 1), "Adequado");
  assert.equal(calcularStatus(l, 0.69), "Crítico");
});

test("seletor de competência: escolher JUL/26 ancora valores em JUL e a padrão continua AGO", () => {
  const bd = [linha("JUL/26", { VALOR: 5 }), linha("AGO/26", { VALOR: 12 })];
  const p = calcularPainel(bd, { competencia: "JUL/26" });
  assert.equal(p.referencia?.label, "JUL/26");
  assert.equal(p.referenciaPadrao?.label, "AGO/26");
  assert.equal(p.indicadores[0].valor, 5);
  assert.equal(calcularPainel(bd, { competencia: "SET/26" }).referencia?.label, "AGO/26"); // sem dados: vale a padrão
});

test("filtros não mudam a referência e filtram por divisão, status e texto", () => {
  const bd = [
    ind("1", "DRH", 3), ind("1", "DRH", null, "AGO/26"),
    ind("2", "DIE", 0.1, "AGO/26"),
    linha("AGO/26", { ID: "3", DIVISAO: "DA", VALOR: 1 }),
  ];
  const p = calcularPainel(bd);
  assert.equal(p.referencia?.label, "AGO/26");
  const soDrh = filtrarIndicadores(p.indicadores, { divisoes: ["DRH"] });
  assert.deepEqual(soDrh.map((i) => i.status), ["Aguardando informação"]); // DRH sem dado em AGO
  assert.equal(filtrarIndicadores(p.indicadores, { busca: "INDICADOR de teste" }).length, 3);
});

test("grupos de contagem: 0 é dado, PCA emparelhado e fora de qualquer nota", () => {
  const extra = (id: string, cat: string, tipo: "Realizado" | "Planejado", valor: number | null) => linha("JUL/26", {
    ID: id, CATEGORIA: cat, UNIDADE: "Quantidade", DIRECAO: "Monitoramento", META_NUM: null, META_TXT: null, TIPO: tipo, VALOR: valor,
  });
  const bd = [
    ind("1", "DRH", 3),
    extra("54", "Plano de Contratações Anual", "Planejado", 17), extra("54", "Plano de Contratações Anual", "Realizado", 10),
    extra("36", "Pendências do e-Pessoal", "Realizado", 0), extra("37", "Pendências do e-Pessoal", "Realizado", 2),
  ];
  const p = calcularPainel(bd);
  assert.deepEqual(p.grupos.map((g) => g.categoria), ["Pendências do e-Pessoal", "Plano de Contratações Anual"]);
  const epessoal = p.grupos[0], pca = p.grupos[1];
  assert.equal(epessoal.itens[0].realizado, 0);
  assert.equal(epessoal.total, 2);
  assert.equal(pca.emparelhado, true);
  assert.equal(pca.itens[0].planejado, 17);
  assert.ok(Math.abs((pca.itens[0].execucao as number) - 10 / 17) < 1e-9);
  assert.equal(p.resumo.n, 1);
  assert.equal(p.indicadores.length, 1);
});

test("meta de percentual gravada como fração aparece como percentual", () => {
  assert.equal(metaExibida("0.99", 99, "Percentual (%)", "Maior é melhor"), "≥ 99%");
  assert.equal(metaExibida("1", 100, "Percentual (%)", "Maior é melhor"), "≥ 100%");
  assert.equal(metaExibida("≥ 10%", 10, "Percentual (%)", "Maior é melhor"), "≥ 10%");
});

test("tendência dos IDs 16 e 22 é '—' (o valor é o módulo da variação)", () => {
  const v = (comp: keyof typeof MESES, valor: number) =>
    linha(comp, { ID: "16", DIRECAO: "Maior é melhor", UNIDADE: "Percentual (%)", VALOR: valor, VAR1_VALOR: 10, VAR2_VALOR: 20 });
  const p = calcularPainel([v("JAN-JUN/26", 50), v("JUL/26", 30), v("AGO/26", 40)]);
  assert.equal(p.indicadores[0].tendencia, null);
});

test("unidade no singular quando o valor é 1", () => {
  assert.equal(fmtValor(1, "Dias úteis"), "1 dia útil");
  assert.equal(fmtValor(2, "Dias úteis"), "2 dias úteis");
  assert.equal(fmtValor(1, "Meses"), "1 mês");
});

test("filtros vão e voltam pela URL sem perder a aba do painel", () => {
  const sp = new URLSearchParams("painel=governanca");
  const gravado = gravarFiltros(sp, { divisoes: ["DRH", "DA"], status: ["Crítico", "Aguardando informação"], busca: " prazo ", competencia: "JUL/26" });
  assert.equal(gravado.get("painel"), "governanca");
  assert.equal(gravado.get("st"), "critico,aguardando");
  const lido = lerFiltros(gravado);
  assert.deepEqual(lido.divisoes, ["DRH", "DA"]);
  assert.deepEqual(lido.status, ["Crítico", "Aguardando informação"]);
  assert.equal(lido.busca, " prazo ");
  assert.equal(lido.competencia, "JUL/26");
  const limpo = gravarFiltros(gravado, { divisoes: [], status: [], busca: "", competencia: null });
  assert.equal(limpo.toString(), "painel=governanca");
  assert.deepEqual(lerFiltros(new URLSearchParams("st=inexistente")).status, []);
});

test("largura de barra sempre com ponto, nunca vírgula", () => {
  assert.equal(larguraCss(0.577), "38.5%");
  assert.equal(larguraCss(null), "0.0%");
  assert.ok(!larguraCss(1.234).includes(","));
});

test("sem nenhuma competência com dado: painel vazio, sem zeros fingindo dado", () => {
  const p = calcularPainel([linha("JUL/26"), linha("AGO/26")]);
  assert.equal(p.referencia, null);
  assert.equal(p.indicadores.length, 0);
  assert.equal(p.resumo.saudeGeral, null);
});
