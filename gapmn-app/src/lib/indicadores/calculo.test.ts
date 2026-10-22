// Testes das regras do Painel de Governança (F.2). Cada um corresponde a um erro real.
// Dados fictícios. Rodar na pasta gapmn-app:  npm test

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  calcularAtingimento, calcularPainel, calcularStatus, compararId, competenciaReferencia, prepararPayload,
  filtrarIndicadores, montarCompetencias, normalizarLinhas,
} from "./calculo.ts";
import {
  competenciaPorExtenso, fmtPercentual, fmtTendencia, fmtValor, fmtVariacaoPct, fraseVariacao, larguraCss, metaExibida,
} from "./formato.ts";
import { CATALOGO_PADRAO, catalogoEfetivo } from "./catalogo.ts";
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

// 9 e 10 (refeitos em 20/10/2026): sem ranking entre divisões
test("sem ranking: a ASESO com 1 indicador adequado tem saúde de 100%, sem posição nem nota de Wilson", () => {
  const bd = [
    ind("19", "ASESO", 5),                                              // 1 de 1 adequado
    ...Array.from({ length: 9 }, (_, i) => ind(String(101 + i), "DIE", 2)), // 9 adequados (IDs neutros)
    ind("110", "DIE", 0.1),                                             // 1 crítico
  ];
  const aseso = calcularPainel(bd, { divisoes: ["ASESO"] });
  const die = calcularPainel(bd, { divisoes: ["DIE"] });
  assert.equal(aseso.resumo.saudeGeral, 1);
  assert.equal(die.resumo.saudeGeral, 0.9);
  const p = calcularPainel(bd) as unknown as Record<string, unknown>;
  assert.equal(p.podio, undefined);
  assert.equal(p.divisoes, undefined);
});

// 11
test("ID 35 aparece como COMSOC e não entra na saúde de ASESO", () => {
  const bd = [ind("19", "ASESO", 0.5), ind("35", "ASESO", 4)];
  const p = calcularPainel(bd);
  const i35 = p.indicadores.find((i) => i.id === "35")!;
  assert.equal(i35.divisaoExibida, "COMSOC");
  assert.equal(i35.pontos, null);
  assert.equal(p.resumo.n, 1); // o card de saúde geral também não conta o 35
  assert.equal(calcularPainel(bd, { divisoes: ["ASESO"] }).resumo.saudeGeral, 0);
  assert.deepEqual(p.siglasDivisoes, ["ASESO", "COMSOC"]);
});

test("progressos: quem mais se aproximou da meta (ou passou dela) em relação ao mês anterior", () => {
  const par = (id: string, jul: number, ago: number) => [ind(id, "DRH", jul, "JUL/26"), ind(id, "DRH", ago, "AGO/26")];
  const bd = [
    ...par("1", 0.5, 0.9),   // +40 p.p.
    ...par("2", 0.2, 1.2),   // +100 p.p.
    ...par("3", 15, 40),     // 1.500% → 4.000%: limitado a 150% nos dois → não conta como avanço
    ...par("4", 1, 0.8),     // piorou
    ind("5", "DRH", 0.9, "AGO/26"), // sem mês anterior
  ];
  const p = calcularPainel(bd);
  assert.deepEqual(p.avancos.map((i) => i.id), ["2", "1"]);
  assert.equal(calcularPainel(bd, { competencia: "JUL/26" }).avancos.length, 0); // JUL não tem anterior
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

test("filtro de divisão vale para o painel inteiro, menos a competência de referência", () => {
  const extra = (id: string, cat: string, div: string, valor: number) => linha("AGO/26", {
    ID: id, CATEGORIA: cat, DIVISAO: div, UNIDADE: "Quantidade", DIRECAO: "Monitoramento", META_NUM: null, META_TXT: null, VALOR: valor,
  });
  const bd = [
    ind("1", "DRH", 3, "AGO/26"), ind("2", "DRH", 0.1, "AGO/26"),
    ...["10", "11", "12"].map((id) => ind(id, "DIE", 2, "AGO/26")),
    ind("20", "DA", 0.75, "AGO/26"),
    extra("36", "Pendências do e-Pessoal", "ACI", 2), extra("60", "Ressarcimento ao Erário", "AJUR", 0),
  ];
  const geral = calcularPainel(bd);
  const da = calcularPainel(bd, { divisoes: ["DA"] });
  assert.equal(da.referencia?.label, geral.referencia?.label);
  assert.equal(da.resumo.n, 1);
  assert.equal(da.resumo.atencao, 1);
  assert.equal(da.resumo.saudeGeral, 0.5);
  assert.deepEqual(da.indicadores.map((i) => i.id), ["20"]);
  assert.deepEqual(da.piores.map((i) => i.id), ["20"]);
  assert.equal(da.grupos.length, 0);
  assert.deepEqual(da.siglasDivisoes, geral.siglasDivisoes); // o seletor continua com todas
  assert.equal(da.totalIndicadores, 6);
  const aci = calcularPainel(bd, { divisoes: ["ACI"] });
  assert.deepEqual(aci.grupos.map((g) => g.categoria), ["Pendências do e-Pessoal"]);
});

test("coleta aberta: o painel abre no último mês fechado; o mês em coleta continua escolhível", () => {
  const bd = [
    ind("1", "DRH", 3, "JUL/26"), ind("2", "DRH", 3, "JUL/26"),
    ind("1", "DRH", 3, "AGO/26"), ind("2", "DRH", 0.1, "AGO/26"),
    ind("1", "DRH", 3, "SET/26"),                                   // SET/26 em coleta: só 1 de 2
  ];
  const semColeta = calcularPainel(bd);
  assert.equal(semColeta.referencia?.label, "SET/26");
  const set = linha("SET/26").DATA;
  const p = calcularPainel(bd, { emColeta: set });
  assert.equal(p.referenciaPadrao?.label, "AGO/26");
  assert.equal(p.referencia?.label, "AGO/26");
  assert.equal(p.competenciaEmColeta?.label, "SET/26");
  assert.deepEqual(p.serieSaudeCompleta.map((s) => s.label), ["JUL/26", "AGO/26", "SET/26"], "o mês em coleta aparece no gráfico");
  const escolhida = calcularPainel(bd, { emColeta: set, competencia: "SET/26" });
  assert.equal(escolhida.referencia?.label, "SET/26");
  assert.equal(escolhida.anterior?.label, "AGO/26");
  // coleta aberta num mês sem nenhum resultado ainda: nada muda
  assert.equal(calcularPainel(bd, { emColeta: "2026-10-01" }).referencia?.label, "SET/26");
  // reabrir um mês antigo para correção não tira o último da posição de padrão
  assert.equal(calcularPainel(bd, { emColeta: linha("JUL/26").DATA }).referencia?.label, "SET/26");
});

test("saúde: série por competência, comparação com o mês anterior e tendência 3M", () => {
  const bd = [
    ind("1", "DRH", 0.1, "JAN-JUN/26"), ind("2", "DRH", 0.1, "JAN-JUN/26"),   // 0%
    ind("1", "DRH", 3, "JUL/26"), ind("2", "DRH", 0.1, "JUL/26"),             // 50%
    ind("1", "DRH", 3, "AGO/26"), ind("2", "DRH", 3, "AGO/26"),               // 100%
  ];
  const p = calcularPainel(bd);
  assert.deepEqual(p.serieSaude.map((s) => s.saude), [0, 0.5, 1]);
  assert.equal(p.saudeAnterior, 0.5);
  assert.equal(p.tendenciaSaude, 0.5);
  const dois = calcularPainel(bd, { competencia: "JUL/26" });
  assert.equal(dois.tendenciaSaude, null); // só 2 pontos até JUL/26
  // o gráfico clicável continua mostrando os meses depois do exibido, para dar para voltar
  assert.deepEqual(dois.serieSaude.map((s) => s.label), ["JAN-JUN/26", "JUL/26"]);
  assert.deepEqual(dois.serieSaudeCompleta.map((s) => [s.label, s.saude]), [["JAN-JUN/26", 0], ["JUL/26", 0.5], ["AGO/26", 1]]);
  assert.equal(dois.saudeAnterior, 0);
});

test("mês anterior e histórico completo de cada indicador", () => {
  // menor é melhor, meta 10: 12 (83%, atenção) → 9 (adequado) → vazio em SET (aguardando)
  const bd = [
    linha("JUL/26", { VALOR: 12, VAR1_NOME: "T = tempo", VAR1_VALOR: 120 }),
    linha("AGO/26", { VALOR: 9 }),
    linha("SET/26", { VALOR: null }),
    linha("SET/26", { ID: "2", VALOR: 4 }), // outro indicador já preencheu SET: a referência vai para SET
    linha("AGO/26", { ID: "2", VALOR: 5 }),
  ];
  const p = calcularPainel(bd);
  assert.equal(p.referencia?.label, "SET/26");
  const i1 = p.indicadores.find((i) => i.id === "1")!;
  assert.equal(i1.status, "Aguardando informação");
  assert.equal(i1.mesAnterior?.label, "AGO/26");
  assert.equal(i1.mesAnterior?.valor, 9);
  assert.equal(i1.mesAnterior?.status, "Adequado");
  assert.deepEqual(i1.historico.map((h) => `${h.label}=${h.valor}:${h.status}`), [
    "JUL/26=12:Atenção", "AGO/26=9:Adequado", "SET/26=null:Aguardando informação",
  ]);
  assert.equal(i1.historico[0].variaveis[0].valor, 120);
  assert.equal(i1.comparacaoMesAnterior, null); // sem resultado em SET: não compara
  const i2 = p.indicadores.find((i) => i.id === "2")!;
  assert.equal(i2.comparacaoMesAnterior, "melhora"); // menor é melhor: 5 → 4
  // escolhendo AGO/26, o mês anterior passa a ser JUL/26 e o histórico continua completo
  const ago = calcularPainel(bd, { competencia: "AGO/26" }).indicadores.find((i) => i.id === "1")!;
  assert.equal(ago.mesAnterior?.label, "JUL/26");
  assert.equal(ago.comparacaoMesAnterior, "melhora");
  assert.equal(ago.historico.length, 3);
});

test("catálogo: ficha técnica por ID, só informativa", () => {
  const { payload } = prepararPayload({
    ok: true, gerado_em: "2026-10-19T10:00:00",
    bd: [linha("JUL/26", { VALOR: 5 }), linha("JUL/26", { ID: "17.1", VALOR: 10 })],
    catalogo: [
      { ID: 1, OBJETIVO: "Acompanhar a celeridade.", ORIGEM_DADOS: "Sistema X", PERIODICIDADE: "Mensal", META_CATALOGO: "10 dias úteis", UNIDADE_CATALOGO: "" },
      { ID: "17,1", OBJETIVO: "Prevenir prazos.", META_CATALOGO: "30 dias corridos (PATD)" },
      { OBJETIVO: "sem ID, ignorada" },
    ],
  });
  assert.deepEqual(Object.keys(payload.catalogo).sort(), ["1", "17.1"]);
  assert.equal(payload.catalogo["1"].unidade, null);
  const com = calcularPainel(payload.bd, { catalogo: payload.catalogo });
  const sem = calcularPainel(payload.bd);
  const i1 = com.indicadores.find((i) => i.id === "1")!;
  assert.equal(i1.catalogo?.objetivo, "Acompanhar a celeridade.");
  assert.equal(com.indicadores.find((i) => i.id === "17.1")?.catalogo?.meta, "30 dias corridos (PATD)");
  assert.equal(sem.indicadores[0].catalogo, null);
  assert.deepEqual(com.indicadores.map((i) => i.atingimento), sem.indicadores.map((i) => i.atingimento)); // não muda conta
  // payload antigo, sem a aba CATALOGO
  assert.deepEqual(prepararPayload({ ok: true, bd: [] }).payload.catalogo, {});
});

test("catálogo no código: 39 fichas completas e a planilha tem prioridade", () => {
  const ids = Object.keys(CATALOGO_PADRAO).sort(compararId);
  const esperados = [...Array.from({ length: 35 }, (_, i) => String(i + 1)).filter((x) => x !== "17" && x !== "24"),
    "17.1", "17.2", "17.3", "24.1", "24.2", "24.3"].sort(compararId);
  assert.deepEqual(ids, esperados);
  for (const [id, f] of Object.entries(CATALOGO_PADRAO)) {
    assert.ok(f.objetivo && f.origem && f.periodicidade && f.meta, `ficha ${id} incompleta`);
  }
  assert.equal(CATALOGO_PADRAO["16"].meta, "Tendência decrescente (Valor negativo)");
  const efetivo = catalogoEfetivo({ "1": { objetivo: "Novo objetivo", origem: null, periodicidade: null, unidade: null, meta: null } });
  assert.equal(efetivo["1"].objetivo, "Novo objetivo");                 // a planilha sobrepõe
  assert.equal(efetivo["1"].origem, CATALOGO_PADRAO["1"].origem);       // campo vazio mantém o do código
  assert.equal(catalogoEfetivo(undefined)["35"].meta, "Mín. 1 evento por mês");
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

test("variação da saúde e tendência em %, não em pontos percentuais (p.p.)", () => {
  assert.equal(fmtVariacaoPct(0.1), "+10,0%");
  assert.equal(fmtVariacaoPct(-0.125), "−12,5%");
  assert.equal(fmtVariacaoPct(0), "0,0%");
  assert.equal(fmtVariacaoPct(null), "—");
  assert.equal(fmtTendencia({ media: 2.5, pontos: [], sentido: "melhora" }, "Percentual (%)"), "+2,5% por competência");
  assert.equal(fmtTendencia({ media: -1, pontos: [], sentido: "melhora" }, "Dias úteis"), "−1 dias úteis por competência");
});
