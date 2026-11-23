import { test } from "node:test";
import assert from "node:assert/strict";
import { corrigirPrecos, fatorIpca, normalizarUnidade, prepararAtas, ultimoMesDaSerie, unidadeDoRegistro, unidadePadrao, variacoesPorMes } from "./ajustes.ts";

test("atas (art. 5º, II): UF pedida, unidade da compra, IPCA e só as que não estavam entre os praticados contam como novas", () => {
  const v = variacoesPorMes([{ data: "01/02/2026", valor: "1.00" }]);
  const atas = [
    { idCompraItem: "A", estado: "AM", unidadeTexto: "Unidade", precoUnitario: 10, dataCompra: "2026-01-10" },
    { idCompraItem: "B", estado: "SP", unidadeTexto: "Caixa", precoUnitario: 20, dataCompra: "2026-01-10" },
    { idCompraItem: "C", estado: undefined, unidadeTexto: null, precoUnitario: 30, dataCompra: "2026-01-10" },
  ];
  const nacional = prepararAtas(atas, { ufs: [], praticados: new Set(["A"]), ipca: { variacoes: v, ate: "2026-02" } });
  assert.equal(nacional.registros.length, 3);
  assert.equal(nacional.novas, 2, "A já estava entre os praticados");
  assert.equal(nacional.registros[0].siglaUnidadeFornecimento, "UN");
  assert.equal(nacional.registros[1].siglaUnidadeFornecimento, "CX");
  assert.equal(nacional.registros[2].siglaUnidadeFornecimento, null);
  assert.equal(nacional.registros[0].precoUnitario, 10.1);
  const am = prepararAtas(atas, { ufs: ["AM"], praticados: new Set(), ipca: null });
  assert.deepEqual(am.registros.map((r) => r.idCompraItem), ["A"], "sem UF conhecida, fica fora quando há filtro de UF");
});

const reg = (preco: number, sigla: string, cap: number | null = null, dataCompra = "2026-01-15") =>
  ({ precoUnitario: preco, siglaUnidadeFornecimento: sigla, capacidadeUnidadeFornecimento: cap, dataCompra });

test("unidade de fornecimento: a do item quando aparece, senão a mais comum; uma só = sem filtro", () => {
  const lista = [reg(10, "UN"), reg(11, "UN"), reg(900, "CX", 100), reg(950, "CX", 100), reg(980, "CX", 100)];
  assert.equal(unidadeDoRegistro(lista[2]), "CX c/ 100");
  assert.equal(unidadePadrao(lista, "Unid."), "UN", "a unidade do item vence a mais comum");
  assert.equal(unidadePadrao(lista, ""), "CX c/ 100", "sem unidade no item: a mais comum");
  assert.equal(unidadePadrao([reg(1, "UN"), reg(2, "UN")], "UN"), "");
  assert.equal(normalizarUnidade("unidade"), "UN");
  assert.equal(normalizarUnidade("Pacote"), "PCT");
  // a unidade das atas (PNCP, por extenso) cai na sigla dos preços praticados (catálogo)
  assert.equal(normalizarUnidade("Comprimido"), "COMPR");
  assert.equal(normalizarUnidade("Frasco-Ampola"), "FR-AM");
  assert.equal(normalizarUnidade("FR-AM"), "FR-AM");
  assert.equal(unidadePadrao([reg(1, "COMPR"), reg(2, "COMPR"), reg(3, "FR-AM"), reg(4, "FR-AM"), reg(5, "FR-AM")], "comprimido"), "COMPR");
});

test("IPCA do mês seguinte ao da compra até o último divulgado", () => {
  const v = variacoesPorMes([{ data: "01/01/2026", valor: "0.50" }, { data: "01/02/2026", valor: "1.00" }, { data: "01/03/2026", valor: "2.00" }]);
  assert.equal(ultimoMesDaSerie(v), "2026-03");
  assert.equal(fatorIpca("2026-01-20", v, "2026-03"), 1.01 * 1.02);
  assert.equal(fatorIpca("2026-03-02", v, "2026-03"), 1, "comprado no último mês: nada a corrigir");
  assert.equal(fatorIpca(undefined, v, "2026-03"), 1);
  const [r] = corrigirPrecos([reg(100, "UN")], v, "2026-03");
  assert.equal(r.precoOriginal, 100);
  assert.equal(r.precoUnitario, 103.02);
  assert.equal(corrigirPrecos([r], v, "2026-03")[0].precoUnitario, 103.02, "corrigir de novo parte do original");
});
