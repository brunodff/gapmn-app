// Testes da coleta mensal dos indicadores: fórmulas (iguais às do banco), prévia da classificação
// (igual à do Painel de Governança) e planilha consolidada. Valores de teste tirados da BD de 2026.
// Rodar na pasta gapmn-app:  npm test

import { test } from "node:test";
import assert from "node:assert/strict";

import { competenciaPadrao, nomeSecao } from "./cadastros.ts";
import type { DadosColeta } from "./coleta.ts";
import { classificar, montarAbas } from "./exportar.ts";
import { calcularValor, lerNumero, numeroParaCampo } from "./formulas.ts";
import { previaDoIndicador } from "./previa.ts";
import type { IndicadorGov, LancamentoAdmin } from "./tipos.ts";

const ind = (p: Partial<IndicadorGov>): IndicadorGov => ({
  id: "1", divisao: "DRH", categoria: "1. GESTÃO DE PESSOAL", indicador: "Indicador", unidade: "Dias úteis", formula: "",
  calculo: "razao", variaveis: ["A", "B"], meta_txt: null, meta_num: 10, direcao: "Menor é melhor", planejado: false, ordem: 1, ...p,
});
const ID28 = ind({ id: "28", divisao: "DOC", categoria: "9. LICITAÇÕES E CONTRATOS", unidade: "Horas", meta_txt: "72 horas", meta_num: 72 });
const ID25 = ind({ id: "25", divisao: "DOC", categoria: "9. LICITAÇÕES E CONTRATOS", unidade: "Percentual (%)", calculo: "percentual", meta_txt: "1", meta_num: 100, direcao: "Maior é melhor" });
const ID16 = ind({ id: "16", divisao: "DA", unidade: "Percentual (%)", calculo: "variacao", meta_txt: "≥ 10%", meta_num: 10, direcao: "Maior é melhor" });
const ID54 = ind({ id: "54", divisao: "DOC", categoria: "Plano de Contratações Anual", unidade: "Quantidade", calculo: "direto", variaveis: [], meta_num: null, direcao: "Monitoramento", planejado: true, ordem: 58 });

const v = (v1: number | null, v2: number | null = null, v3: number | null = null) => ({ v1, v2, v3 });
const perto = (a: number | null, b: number) => assert.ok(a !== null && Math.abs(a - b) < 1e-3, `${a} ≠ ${b}`);

test("fórmulas iguais às do banco, com valores reais da BD", () => {
  perto(calcularValor("disponibilidade", 744, 1, null), 99.866);  // ID 13
  perto(calcularValor("variacao", 209, 557, null), 62.478);       // ID 16, em módulo
  perto(calcularValor("taxa_ajustada", 19, 40, 21), 100);         // ID 18
  perto(calcularValor("percentual", 17, 11, null), 154.545);      // ID 25
  perto(calcularValor("razao", 24415, 4883, null), 5);            // ID 1
  assert.equal(calcularValor("direto", 4, null, null), 4);
  assert.equal(calcularValor("razao", 10, 0, null), null, "denominador zero");
  assert.equal(calcularValor("razao", 10, null, null), null, "falta variável");
  assert.equal(calcularValor("taxa_ajustada", 1, 5, 5), null, "P_t − P_av = 0");
});

test("número digitado em pt-BR", () => {
  assert.equal(lerNumero("1.234,5"), 1234.5);
  assert.equal(lerNumero("12,4"), 12.4);
  assert.equal(lerNumero(" 7 "), 7);
  assert.equal(lerNumero("1.234"), 1234);
  assert.equal(lerNumero("0,5"), 0.5);
  assert.equal(lerNumero(""), null);
  assert.equal(lerNumero("dez"), undefined);
  assert.equal(numeroParaCampo(1234.5), "1234,5");
  assert.equal(numeroParaCampo(null), "");
});

test("prévia classifica igual ao painel", () => {
  assert.equal(previaDoIndicador(ID28, v(4512, 188)).status, "Adequado");     // 24 h, meta 72
  assert.equal(previaDoIndicador(ID28, v(20280, 169)).status, "Crítico");     // 120 h → 60% da meta
  assert.equal(previaDoIndicador(ID28, v(9000, 100)).status, "Atenção");      // 90 h → 80% da meta
  assert.equal(previaDoIndicador(ID25, v(17, 11)).status, "Adequado");
  assert.equal(previaDoIndicador(ID25, v(5, 25)).status, "Crítico");
  assert.equal(previaDoIndicador(ID28, v(0, 0)).status, "Sem dados no mês de referência", "denominador zero = sem evento");
  assert.equal(previaDoIndicador(ID28, v(100)).status, "Aguardando informação", "só uma variável");
  assert.equal(previaDoIndicador(ID16, v(209, 557)).status, "Adequado", "pendências caíram 62%");
  assert.equal(previaDoIndicador(ID16, v(600, 557)).status, "Crítico", "pendências subiram");
  assert.equal(previaDoIndicador(ID54, v(10)).status, "Sem meta", "contagem não tem classificação");
  assert.equal(previaDoIndicador(ID28, v(null)).tocado, false);
});

test("seção, competência padrão", () => {
  assert.equal(nomeSecao("9. LICITAÇÕES E CONTRATOS"), "Licitações e Contratos");
  assert.equal(nomeSecao("4. APOIO DE TI"), "Apoio de TI");
  assert.equal(nomeSecao("Pendências do e-Pessoal"), "Pendências do e-Pessoal");
  assert.equal(competenciaPadrao(new Date(2026, 9, 22)), "2026-09");
  assert.equal(competenciaPadrao(new Date(2027, 0, 5)), "2026-12");
});

test("planilha consolidada: matrizes por mês, lançamentos, abas por divisão, contratos e histórico", () => {
  const lanc = (p: Partial<LancamentoAdmin>): LancamentoAdmin => ({
    competencia: "2026-09", indicador_id: "28", tipo: "Realizado", v1: null, v2: null, v3: null, valor: null, comentario: null,
    anexo: null, anexo_nome: null, posto: null, nome_guerra: null, divisao: "DOC", atualizado_em: "2026-10-14T13:00:00Z", versao: 1, ...p,
  });
  const d: DadosColeta = {
    indicadores: [ID28, ID25, ID54],
    competencias: [
      { codigo: "2026-10", rotulo: "OUT/26", semestral: false, token: "x".repeat(24), aberta: true, prazo: null, origem: "formulario", aberta_em: null, fechada_em: null },
      { codigo: "2026-09", rotulo: "SET/26", semestral: false, token: null, aberta: false, prazo: null, origem: "planilha", aberta_em: null, fechada_em: null },
    ],
    lancamentos: [
      lanc({ v1: 7776, v2: 162, valor: 48 }),
      lanc({ competencia: "2026-10", v1: 20280, v2: 169, valor: 120, comentario: "Greve dos fornecedores", anexo: "2026-10/a.png", anexo_nome: "siafi.png", posto: "2º Ten", nome_guerra: "TESTE", versao: 3 }),
      lanc({ competencia: "2026-10", indicador_id: "54", tipo: "Planejado", v1: 17, valor: 17 }),
    ],
    historico: [{ id: 1, competencia: "2026-10", indicador_id: "28", tipo: "Realizado", antes: { v1: 4512, v2: 188, valor: 24 }, depois: { v1: 20280, v2: 169, valor: 120 }, posto: "2º Ten", nome_guerra: "TESTE", quando: "2026-10-14T13:00:00Z" }],
    contratos: [{ id: "c1", competencia: "2026-09", ordem: 1, servico: "Aquisição de Carnes", nup: "67298.001437/2025-18", termino: "2027-10-07", status: "Seguro", providencias: "Homologado", padrao: true }],
  };
  const abas = montarAbas(d);
  assert.deepEqual(abas.map((a) => a.nome), ["Resultados por mês", "Classificação por mês", "Lançamentos", "DOC", "Contratos essenciais", "Histórico de alterações"]);
  const res = abas[0].linhas;
  const l28 = res.find((r) => r.ID === "28")!;
  assert.equal(l28["SET/26"], 48);
  assert.equal(l28["OUT/26"], 120);
  assert.ok(res.some((r) => r.Indicador === "Indicador (Planejado)" && r["OUT/26"] === 17), "PCA tem linha Planejado");
  const cls = abas[1].linhas.find((r) => r.ID === "28")!;
  assert.equal(cls["SET/26"], "Adequado");
  assert.equal(cls["OUT/26"], "Crítico");
  assert.ok(!abas[1].linhas.some((r) => r.ID === "54"), "contagem fica fora da classificação");
  const l = abas[2].linhas.find((r) => r["Competência"] === "OUT/26" && r.ID === "28")!;
  assert.equal(l["Justificativa"], "Greve dos fornecedores");
  assert.equal(l["Comprovante"], "siafi.png");
  assert.equal(l["Lançado por"], "2º Ten TESTE");
  assert.equal(l["Alterações"], 2);
  assert.equal(l["Atingimento da meta (%)"], 60);
  assert.equal(abas[2].linhas[0]["Atualizado em"], "importado da planilha");
  assert.equal(abas[4].linhas[0]["Término da vigência"], "07/10/2027");
  assert.match(String(abas[5].linhas[0]["Antes"]), /v1: 4512/);
  assert.equal(classificar(ID25, { v1: 17, v2: 11, v3: null, valor: 154.5, tipo: "Realizado" }).status, "Adequado");
});
