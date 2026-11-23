import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import ponte from "./index.ts";

const PAGINA_2026 = fs.readFileSync(new URL("../../../src/lib/apostilamento/fixtures/fgv_incc-m-2026.html", import.meta.url), "utf8");

/** FGV falsa: só a página de 2026 existe; as outras redirecionam para a lista de notícias */
function fgvFalsa(pedidas: string[]) {
  globalThis.fetch = (async (url: string) => {
    pedidas.push(String(url));
    const existe = String(url).endsWith("/incc-m-2026");
    return { ok: true, status: 200, url: existe ? String(url) : "https://portal.fgv.br/noticias", text: async () => (existe ? PAGINA_2026 : "<html>notícias</html>") } as unknown as Response;
  }) as typeof fetch;
}
const pedir = (q: string) => ponte.fetch(new Request(`https://gapmn-indice-fgv.exemplo.workers.dev/${q}`));

test("ponte: devolve a tabela lida, com CORS, e guarda a página", async () => {
  const pedidas: string[] = [];
  fgvFalsa(pedidas);
  const r = await pedir("?pagina=incc-m-2026");
  assert.equal(r.status, 200);
  assert.equal(r.headers.get("access-control-allow-origin"), "*");
  const j = await r.json() as { url: string; tabela: Record<string, [number, number]> };
  assert.equal(j.url, "https://portal.fgv.br/noticias/incc-m-2026");
  assert.deepEqual(j.tabela["out/26"], [0.35, 6.75]);
  await pedir("?pagina=incc-m-2026");
  assert.equal(pedidas.length, 1, "a segunda vez vem da memória");
});

test("ponte: página que não existe volta tabela null; pedido fora das páginas do INCC é recusado", async () => {
  fgvFalsa([]);
  const j = await (await pedir("?pagina=incc-m-2027")).json() as { tabela: unknown; url: unknown };
  assert.equal(j.tabela, null);
  assert.equal(j.url, null);
  assert.equal((await pedir("?pagina=../../etc")).status, 400);
  assert.equal((await pedir("?pagina=ipca-2026")).status, 400);
  assert.equal((await ponte.fetch(new Request("https://x.workers.dev/?pagina=incc-m-2026", { method: "POST" }))).status, 405);
});

test("ponte: FGV fora do ar vira erro 502 com o motivo", async () => {
  globalThis.fetch = (async () => { throw new Error("received fatal alert: HandshakeFailure"); }) as typeof fetch;
  const r = await pedir("?pagina=incc-di-2026");
  assert.equal(r.status, 502);
  assert.match(((await r.json()) as { erro: string }).erro, /HandshakeFailure/);
});
