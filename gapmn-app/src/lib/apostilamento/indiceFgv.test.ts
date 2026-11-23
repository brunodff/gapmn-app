import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { acumuladoFgv, ehFgv, lerTabelaFgv, linksFgv, paginaFgv, rotulo, urlPaginaFgv, variante } from "./indiceFgv.ts";

const PAGINA_2026 = fs.readFileSync(new URL("./fixtures/fgv_incc-m-2026.html", import.meta.url), "utf8");
const TABELA_2026 = lerTabelaFgv(PAGINA_2026);

test("lê a tabela do acumulado da página anual da FGV (sem o que está em script)", () => {
  assert.equal(Object.keys(TABELA_2026).length, 13);
  assert.deepEqual(TABELA_2026["out/26"], [0.35, 6.75]);
  assert.deepEqual(TABELA_2026["dez/25"], [0.21, 6.1]);
  assert.equal(TABELA_2026["jan/99"], undefined);
});

test("orçamento 11/2025: período 11/2025 a 10/2026, linha out/26 da página de 2026", async () => {
  const pedidas: string[] = [];
  const r = await acumuladoFgv("INCC", "11/2025", "10/2026", async (p) => { pedidas.push(p); return p === "incc-m-2026" ? TABELA_2026 : null; });
  assert.equal(r.percentual, 6.75);
  assert.equal(r.linha_tabela, "out/26");
  assert.ok(r.url_print.startsWith("https://portal.fgv.br/noticias/incc-m-2026#:~:text="));
  assert.deepEqual(pedidas, ["incc-m-2026"]);
});

test("aniversário em janeiro: período até dez/25, sem a página de 2025, acha na de 2026", async () => {
  const r = await acumuladoFgv("INCC-M", "01/2025", "12/2025", async (p) => (p === "incc-m-2026" ? TABELA_2026 : null));
  assert.equal(r.percentual, 6.1);
  assert.ok(r.url_print.includes("incc-m-2026"));
});

test("mês que ainda não saiu e período que não tem 12 meses dão erro com explicação", async () => {
  await assert.rejects(acumuladoFgv("INCC", "12/2025", "11/2026", async () => TABELA_2026), /nov\/26 ainda não está na tabela da FGV.*google\.com/);
  await assert.rejects(acumuladoFgv("INCC", "11/2025", "09/2026", async () => TABELA_2026), /tem 11/);
});

test("links do print iguais aos do motor (indice_fgv.links)", () => {
  const l = linksFgv("INCC", "11/2025", "10/2026");
  assert.equal(l.linha_tabela, "out/26");
  assert.equal(l.coluna, "Acumulado 12 meses");
  assert.equal(l.url_print, "https://portal.fgv.br/noticias/incc-m-2026#:~:text=Qual%20o%20valor%20do%20INCC-M%20acumulado%20em%2012%20meses");
  assert.equal(l.url_google, "https://www.google.com/search?q=%C3%ADndice%20INCC%20FGV%202026");
  assert.ok(l.url_pagina_ano_seguinte.includes("incc-m-2027"));
});

test("variantes do INCC e o que não é da FGV", () => {
  assert.equal(variante("incc"), "INCC-M");
  assert.equal(variante("INCC-DI"), "INCC-DI");
  assert.equal(paginaFgv("INCC-DI", 2026), "incc-di-2026");
  assert.equal(urlPaginaFgv("INCC-DI", 2026, false), "https://portal.fgv.br/noticias/incc-di-2026");
  assert.equal(rotulo("01/2027"), "jan/27");
  assert.ok(ehFgv("incc-m") && ehFgv("INCC (FGV)") && !ehFgv("IPCA") && !ehFgv(""));
});
