import { test } from "node:test";
import assert from "node:assert/strict";
import { textoCota, type Cota } from "./cota.ts";

const cota = (x: Partial<Cota>): Cota => ({ restante_pct: 78, restante_tokens: 468_000, limite_tokens: 600_000, perguntas_restantes: 104, perguntas_24h: 30, suas_perguntas_24h: 7, ...x });

test("barra da cota: rótulo, nível e explicação", () => {
  const ok = textoCota(cota({}));
  assert.equal(ok.rotulo, "IA: 78% · ~104 perguntas");
  assert.equal(ok.nivel, "ok");
  assert.match(ok.detalhe, /restam 468 mil de 600 mil tokens/);
  assert.match(ok.detalhe, /compartilhada por todos/);
  assert.match(ok.detalhe, /suas: 7/);
  assert.equal(textoCota(cota({ restante_pct: 12 })).nivel, "atencao");
  const agora = new Date("2026-11-24T15:00:00Z");
  const fim = textoCota(cota({ restante_pct: 0, restante_tokens: 0, perguntas_restantes: 0, libera_em: "2026-11-24T16:30:00Z" }), agora);
  assert.equal(fim.nivel, "fim");
  assert.equal(fim.rotulo, "IA esgotada · volta ~12:30"); // hora de Manaus
  assert.match(fim.detalhe, /respostas fixas/);
});
