// Testes do valor de cada lançamento de NE (coluna U multiplicada pelos registros de operação dos itens).
// Os padrões de linhas são os da planilha "Notas de Empenho" de 28/10/2026. Rodar na pasta gapmn-app:
//   node --test src/lib/execucao/movimentos.test.ts

import { test } from "node:test";
import assert from "node:assert/strict";

import { valoresDosLancamentos } from "./movimentos.ts";

const perto = (a: number[], b: number[]) => a.length === b.length && a.every((v, i) => Math.abs(v - b[i]) < 0.005);

test("valores certos: a soma dos lançamentos é o valor atual", () => {
  const r = valoresDosLancamentos([[1000], [300], [-500]], 800);
  assert.deepEqual(r, { valores: [1000, 300, -500], origem: "exato", multiplicador: 1 });
});

test("três operações de quantidade 1: cada lançamento vem triplicado", () => {
  const r = valoresDosLancamentos([[4500000], [6000000], [4500000]], 5000000);
  assert.deepEqual(r, { valores: [1500000, 2000000, 1500000], origem: "exato", multiplicador: 3 });
});

test("multiplicador grande (NE de diárias com 25 operações) sai exato", () => {
  const reais = [18945, 570, 2385, 17260, -38870.32];
  const r = valoresDosLancamentos(reais.map((v) => [v * 25]), reais.reduce((s, v) => s + v, 0));
  assert.equal(r.origem, "exato");
  assert.equal(r.multiplicador, 25);
  assert.ok(perto(r.valores, reais));
});

test("emitida e anulada pela mesma quantidade (2026NE001520): R$ 20.400,00, não R$ 40.800,00", () => {
  const r = valoresDosLancamentos([[40800], [-40800]], 0);
  assert.deepEqual(r, { valores: [20400, -20400], origem: "deduzido", multiplicador: 2 });
});

test("NE zerada com linhas em proporção 1:1:2 já vem certa", () => {
  const r = valoresDosLancamentos([[82517.02, 82517.02, 165034.04], [-82517.02, -82517.02, -165034.04]], 0);
  assert.equal(r.origem, "deduzido");
  assert.equal(r.multiplicador, 1);
  assert.ok(perto(r.valores, [82517.02, -82517.02]));
});

test("NE zerada de serviço (fração da ata + quantidade 1): as duas linhas em dobro", () => {
  const r = valoresDosLancamentos([[52959.66, 52959.66], [-52959.66, -52959.66]], 0);
  assert.equal(r.multiplicador, 2);
  assert.ok(perto(r.valores, [26479.83, -26479.83]));
});

test("NE zerada com vários itens: emissão e anulação passam por todos", () => {
  const linha = (v: number) => Array.from({ length: 8 }, () => v);
  const r = valoresDosLancamentos([linha(142006.8), linha(-142006.8)], 0);
  assert.equal(r.multiplicador, 2);
  assert.ok(perto(r.valores, [71003.4, -71003.4]));
});

test("NE zerada em três lançamentos com linhas 1:2:3 não é dividida", () => {
  const r = valoresDosLancamentos([[5766, 11532, 17298], [-5756.92, -11513.84, -17270.76], [-9.08, -18.16, -27.24]], 0);
  assert.equal(r.multiplicador, 1);
  assert.ok(perto(r.valores, [5766, -5756.92, -9.08]));
});

test("NE zerada: o multiplicador desce quando daria fração de centavo", () => {
  // linhas 1:1:2 em três lançamentos pediriam 2, mas 1,83 ÷ 2 não existe em reais
  const r = valoresDosLancamentos([[716, 716, 1432], [-1.83, -1.83, -3.66], [-714.17, -714.17, -1428.34]], 0);
  assert.equal(r.multiplicador, 1);
  assert.ok(perto(r.valores, [716, -1.83, -714.17]));
  // linha única em três lançamentos pediria 3; 198 ÷ 3 dá 66, mas 2 ÷ 3 não fecha em centavos
  const s = valoresDosLancamentos([[198], [2], [-200]], 0);
  assert.deepEqual(s, { valores: [99, 1, -100], origem: "deduzido", multiplicador: 2 });
});

test("o que não fecha fica 'a conferir' com o valor como veio", () => {
  assert.deepEqual(valoresDosLancamentos([[130], [7]], 100), { valores: [130, 7], origem: "a conferir", multiplicador: 1 });
  assert.deepEqual(valoresDosLancamentos([[500], [10]], 0), { valores: [500, 10], origem: "a conferir", multiplicador: 1 });
});
