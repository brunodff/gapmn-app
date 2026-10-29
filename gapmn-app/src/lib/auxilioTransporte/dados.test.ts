// Testes do Painel do Auxílio Transporte (dados fictícios). Rodar na pasta gapmn-app:
//   node --test src/lib/auxilioTransporte/dados.test.ts

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  FILTRO_VAZIO, filtrar, filtroAtivo, lerPayload, lerValor, opcoes, ordenar, porFaixa, porMes, porOM, porSituacao, resumir,
} from "./dados.ts";

const COLUNAS = ["id", "solicitado", "encaminhado", "situacao", "ordem", "pg", "om", "nome", "valor", "trajetos",
  "tarifas", "fora_da_lista", "alterado_em", "primeira_leitura", "situacao_anterior"];
const linha = (id: number, solicitado: string, situacao: string, pg: string, om: string, nome: string, valor: number | null, fora = false) =>
  [id, solicitado, null, situacao, String(1000000 + id), pg, om, nome, valor, 2, null, fora, null, "2026-10-28", null];

const payload = {
  ok: true, gerado_em: "2026-10-28T12:00:00Z", colunas: COLUNAS, leituras: [],
  linhas: [
    linha(1, "2026-01-10", "FINALIZADO", "2S", "GAP SP", "SOUZA", 1278.2),
    linha(2, "2026-01-20", "CANCELADO", "1S", "BASP", "LIMA", 5300),
    linha(3, "2026-03-05", "EM ANÁLISE", "CB", "GAP SP", "JOÃO PEDRO", 9999.99),
    linha(4, "2026-03-07", "PENDENTE", "CEL", "PAMA SP", "ARAÚJO", 10000),
    linha(5, "2025-11-30", "FINALIZADO", "3S", "BASP", "COSTA", null),
    linha(6, "2026-02-14", "FINALIZADO", "2S", "GAP SP", "SAIU DA LISTA", 800, true),
  ],
};

test("lê o formato do banco (listas na ordem das colunas)", () => {
  const d = lerPayload(payload);
  assert.equal(d.solicitacoes.length, 6);
  const s = d.solicitacoes[2];
  assert.equal(s.nome, "JOÃO PEDRO");
  assert.equal(s.valor, 9999.99);
  assert.equal(s.ordem, "1000003");
  assert.ok(d.solicitacoes[5].foraDaLista);
  assert.throws(() => lerPayload({ ok: false }));
});

test("filtro de valor entre 5.000 e 10.000 (inclusive), OM, situação, posto e período", () => {
  const { solicitacoes } = lerPayload(payload);
  const ids = (f: Partial<typeof FILTRO_VAZIO>) => filtrar(solicitacoes, { ...FILTRO_VAZIO, ...f }).map((s) => s.id);
  assert.deepEqual(ids({ valorMin: 5000, valorMax: 10000 }), [2, 3, 4]);
  assert.deepEqual(ids({ valorMin: 5000 }), [2, 3, 4]);
  assert.deepEqual(ids({ valorMax: 1278.2 }), [1], "sem valor não entra em filtro de valor; fora da lista some");
  assert.deepEqual(ids({ oms: ["GAP SP"] }), [1, 3]);
  assert.deepEqual(ids({ oms: ["GAP SP"], incluirForaDaLista: true }), [1, 3, 6]);
  assert.deepEqual(ids({ situacoes: ["FINALIZADO", "PENDENTE"] }), [1, 4, 5]);
  assert.deepEqual(ids({ pgs: ["2S"] }), [1]);
  assert.deepEqual(ids({ de: "2026-01-15", ate: "2026-03-05" }), [2, 3]);
  assert.ok(!filtroAtivo(FILTRO_VAZIO));
  assert.ok(filtroAtivo({ ...FILTRO_VAZIO, valorMin: 1 }));
});

test("busca em todos os campos, sem acento, com vários termos", () => {
  const { solicitacoes } = lerPayload(payload);
  const ids = (busca: string) => filtrar(solicitacoes, { ...FILTRO_VAZIO, busca }).map((s) => s.id);
  assert.deepEqual(ids("joao"), [3]);
  assert.deepEqual(ids("araujo pama"), [4]);
  assert.deepEqual(ids("1000002"), [2], "nº de ordem");
  assert.deepEqual(ids("1.278,20"), [1], "valor como aparece na tela");
  assert.deepEqual(ids("10/01/2026"), [1], "data como aparece na tela");
  assert.deepEqual(ids("analise"), [3]);
});

test("resumo, situação, OM, faixas e meses", () => {
  const lista = filtrar(lerPayload(payload).solicitacoes, FILTRO_VAZIO);
  const r = resumir(lista);
  assert.equal(r.quantidade, 5);
  assert.ok(Math.abs(r.valorTotal - (1278.2 + 5300 + 9999.99 + 10000)) < 1e-6);
  assert.equal(r.emAndamento, 2);
  assert.equal(r.finalizadas, 2);
  assert.equal(r.canceladas, 1);
  assert.deepEqual(porSituacao(lista).map((f) => [f.rotulo, f.quantidade]), [["FINALIZADO", 2], ["CANCELADO", 1], ["EM ANÁLISE", 1], ["PENDENTE", 1]]);
  const oms = porOM(lista, 2);
  assert.deepEqual(oms.map((f) => [f.rotulo, f.quantidade]), [["BASP", 2], ["GAP SP", 2], ["Outras 1 OMs", 1]]);
  const faixas = porFaixa(lista);
  assert.equal(faixas.find((f) => f.rotulo === "5 a 10 mil")?.quantidade, 2);
  assert.equal(faixas.find((f) => f.rotulo === "acima de 10 mil")?.quantidade, 1, "10.000 cai na faixa de cima ([min, max))");
  const meses = porMes(lista, 6);
  assert.deepEqual(meses.map((m) => m.rotulo), ["out/25", "nov/25", "dez/25", "jan/26", "fev/26", "mar/26"]);
  assert.deepEqual(meses.map((m) => m.quantidade), [0, 1, 0, 2, 0, 2]);
});

test("opções em ordem (posto pela hierarquia), ordenação e valor digitado", () => {
  const lista = lerPayload(payload).solicitacoes;
  assert.deepEqual(opcoes(lista).pgs, ["CEL", "1S", "2S", "3S", "CB"]);
  assert.deepEqual(ordenar(lista, "valor", false).map((s) => s.id), [4, 3, 2, 1, 6, 5], "sem valor no fim");
  assert.deepEqual(ordenar(lista, "nome", true).map((s) => s.nome)[0], "ARAÚJO");
  assert.equal(lerValor("R$ 5.000"), 5000);
  assert.equal(lerValor("5.000,50"), 5000.5);
  assert.equal(lerValor("10000"), 10000);
  assert.equal(lerValor(""), null);
  assert.equal(lerValor("cinco"), undefined);
});
