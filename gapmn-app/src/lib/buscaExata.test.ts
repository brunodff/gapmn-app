// Testes da busca exata (CLAUDE não pode trazer Claudia).
import { test } from "node:test";
import assert from "node:assert/strict";
import { casaExato, filtrarExato } from "./buscaExata.ts";

test("palavra inteira, sem pedaço de outra palavra", () => {
  assert.equal(casaExato(["Aquisição de licença do CLAUDE para a equipe"], "CLAUDE"), true);
  assert.equal(casaExato(["Contratação de Claude (Anthropic)"], "claude"), true);
  assert.equal(casaExato(["Pregão – fornecedora CLAUDIA MARIA LTDA"], "CLAUDE"), false);
  assert.equal(casaExato(["Serviço de claudestino"], "claude"), false);
  assert.equal(casaExato(["ClaudeAI"], "claude"), false);
});

test("maiúsculas, acentos, espaços e aspas não atrapalham; frase tem de vir junta", () => {
  assert.equal(casaExato(["MANUTENCAO PREDIAL PREVENTIVA"], "manutenção predial"), true);
  assert.equal(casaExato(["manutenção   predial"], "Manutenção Predial"), true);
  assert.equal(casaExato(["manutenção de ar condicionado predial"], "manutenção predial"), false);
  assert.equal(casaExato(["Papel A4 sulfite"], "\"papel a4\""), true);
  assert.equal(casaExato(["valor de R$ 1.000,00 (item 1.2)"], "1.2"), true, "pontos e símbolos valem como texto");
});

test("sem termo, tudo passa; filtro sobre título, objeto, órgão e fornecedor", () => {
  const itens = [
    { title: "Pregão 1/2026", description: "Aquisição de CLAUDE Pro", orgao_nome: "MINISTÉRIO X" },
    { title: "Pregão 2/2026", description: "Serviços de limpeza", orgao_nome: "CLAUDIA ÓRGÃO" },
    { title: "Ata 3/2026", description: "Licenças", fornecedor_nome: "Claude Ltda" },
  ];
  assert.equal(filtrarExato(itens, "").length, 3);
  assert.deepEqual(filtrarExato(itens, "CLAUDE").map((i) => i.title), ["Pregão 1/2026", "Ata 3/2026"]);
});
