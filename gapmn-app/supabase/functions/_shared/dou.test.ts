import { test } from "node:test";
import assert from "node:assert/strict";
import { lerBuscaDou, urlBuscaDou } from "./dou.ts";

// Página de busca da Imprensa Nacional reduzida ao que importa (publicações fictícias)
const pagina = (lista: unknown[]) => `<html><body><div>busca</div>
<script id="_br_com_seatecnologia_in_buscadou_BuscaDouPortlet_params" type="application/json">${JSON.stringify({ jsonArray: lista })}</script>
</body></html>`;

test("lê as publicações da busca do DOU", () => {
  const html = pagina([{
    pubName: "DO3", urlTitle: "extrato-de-contrato-n-99/2026-uasg-120630-123", numberPage: "16",
    title: "EXTRATO DE CONTRATO Nº 99/2026 - UASG 120630", pubDate: "19/11/2026", editionNumber: "218",
    content: "Contratante: <span class='highlight' style='background:#FFA;'>GRUPAMENTO DE APOIO DE MANAUS</span> &amp; Contratada: EMPRESA FICTÍCIA",
    artType: "Extrato de Contrato", classPK: "123", hierarchyStr: "Ministério da Defesa/Comando da Aeronáutica",
  }]);
  const [p] = lerBuscaDou(html);
  assert.equal(p.id, "123");
  assert.equal(p.data, "2026-11-19");
  assert.equal(p.secao, "DO3");
  assert.equal(p.resumo, "Contratante: GRUPAMENTO DE APOIO DE MANAUS & Contratada: EMPRESA FICTÍCIA");
  assert.equal(p.url, "https://www.in.gov.br/web/dou/-/extrato-de-contrato-n-99/2026-uasg-120630-123");
});

test("busca vazia é lista vazia; página sem a lista é erro (layout mudou)", () => {
  assert.deepEqual(lerBuscaDou(pagina([])), []);
  assert.throws(() => lerBuscaDou("<html>manutenção</html>"), /mudou/);
});

test("endereço da busca exata, nas três seções, com 75 por página", () => {
  const u = new URL(urlBuscaDou('Grupamento de Apoio de "Manaus"', "semana"));
  assert.equal(u.searchParams.get("q"), '"Grupamento de Apoio de Manaus"');
  assert.equal(u.searchParams.get("s"), "todos");
  assert.equal(u.searchParams.get("exactDate"), "semana");
  assert.equal(u.searchParams.get("delta"), "75");
});
