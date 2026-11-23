import { test } from "node:test";
import assert from "node:assert/strict";
import { cepimComOrgao, cnpjDaMatriz, juntarSancoes, situacaoReceita } from "./fornecedor.ts";

test("CNPJ da matriz com os dígitos verificadores", () => {
  assert.equal(cnpjDaMatriz("00.394.429/0188-24"), "00394429000100"); // GAP-MN → Comando da Aeronáutica
  assert.equal(cnpjDaMatriz("00394429000100"), null, "já é a matriz");
  assert.equal(cnpjDaMatriz("123"), null);
});

test("situação na Receita pelos campos da BrasilAPI/Minha Receita", () => {
  assert.deepEqual(situacaoReceita({ descricao_situacao_cadastral: "ATIVA", razao_social: "EMPRESA FICTÍCIA LTDA" }),
    { situacao_cadastral: "ATIVA", razao_social: "EMPRESA FICTÍCIA LTDA" });
  assert.equal(situacaoReceita({}), null);
  assert.equal(situacaoReceita(null), null);
});

test("sanções da filial e da matriz sem repetir; CEPIM ganha o órgão no campo do CEIS", () => {
  const a = { id: 1, tipoSancao: { descricaoResumida: "Impedimento" } }, b = { id: 2 };
  assert.deepEqual(juntarSancoes([[a, b], [b]]).map((x) => x.id), [1, 2]);
  assert.deepEqual(cepimComOrgao({ motivo: "Omissão", orgaoSuperior: { nome: "Ministério X" } }).orgaoSancionador, { nome: "Ministério X" });
});
