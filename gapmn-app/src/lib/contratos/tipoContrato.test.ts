import { test } from "node:test";
import assert from "node:assert/strict";
import { contarTipos, tipoDoContrato } from "./tipoContrato.ts";

test("tipo do contrato pelo começo do número do SILOMS", () => {
  assert.equal(tipoDoContrato("DESPESA 015/GAPMN-SRINFRA/2024"), "DESPESA");
  assert.equal(tipoDoContrato("CREDENCIAMENTO 014/2022"), "CREDENCIAMENTO");
  assert.equal(tipoDoContrato("CRED 004/2023"), "CREDENCIAMENTO");
  assert.equal(tipoDoContrato("ADESÃO 003/2021"), "ADESAO");
  assert.equal(tipoDoContrato("adesao 003/2021"), "ADESAO");
  assert.equal(tipoDoContrato(" RECEITA 002/CINDACTAIV/2016"), "RECEITA");
  assert.equal(tipoDoContrato("037/GAPMN-CINDACTAIV/2025"), "OUTRO");
  assert.equal(tipoDoContrato(null), "OUTRO");
  const m = contarTipos(["DESPESA 1/2024", "DESPESA 2/2024", "CRED 3/2023", "RECEITA 4/2016"]);
  assert.deepEqual([m.get("DESPESA"), m.get("CREDENCIAMENTO"), m.get("ADESAO"), m.get("RECEITA")], [2, 1, undefined, 1]);
});
