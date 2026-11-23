import { test } from "node:test";
import assert from "node:assert/strict";
import { ehFgv, linksFgv, rotulo, urlPaginaFgv, variante } from "./indiceFgv.ts";

test("orçamento 11/2025: período 11/2025 a 10/2026, linha out/26 da página de 2026 (links iguais aos do motor)", () => {
  const l = linksFgv("INCC", "11/2025", "10/2026");
  assert.equal(l.linha_tabela, "out/26");
  assert.equal(l.coluna, "Acumulado 12 meses");
  assert.equal(l.url_print, "https://portal.fgv.br/noticias/incc-m-2026#:~:text=Qual%20o%20valor%20do%20INCC-M%20acumulado%20em%2012%20meses");
  assert.equal(l.url_google, "https://www.google.com/search?q=%C3%ADndice%20INCC%20FGV%202026");
  assert.equal(l.url_pagina_ano_seguinte, "https://portal.fgv.br/noticias/incc-m-2027#:~:text=Qual%20o%20valor%20do%20INCC-M%20acumulado%20em%2012%20meses");
});

test("aniversário em janeiro: período até dez/25, página de 2025 (a de 2026 também mostra dez/25)", () => {
  const l = linksFgv("INCC-M", "01/2025", "12/2025");
  assert.equal(l.linha_tabela, "dez/25");
  assert.ok(l.url_print.startsWith("https://portal.fgv.br/noticias/incc-m-2025#"));
  assert.ok(l.url_pagina_ano_seguinte.includes("incc-m-2026"));
});

test("variantes do INCC e o que não é da FGV", () => {
  assert.equal(variante("incc"), "INCC-M");
  assert.equal(variante("INCC-DI"), "INCC-DI");
  assert.equal(urlPaginaFgv("INCC-DI", 2026, false), "https://portal.fgv.br/noticias/incc-di-2026");
  assert.equal(rotulo("01/2027"), "jan/27");
  assert.ok(ehFgv("incc-m") && ehFgv("INCC (FGV)") && !ehFgv("IPCA") && !ehFgv(""));
});
