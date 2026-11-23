import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { ITENS_CHECKLIST, avisosChecklist, checklistIniciado, checklistVazio, marcar, normalizarChecklist } from "./checklist.ts";

test("os 8 itens da tela são os mesmos do motor (motor/checklist.py), na mesma ordem", () => {
  const py = fs.readFileSync(new URL("./motor/checklist.py", import.meta.url), "utf8");
  const bloco = /CHECKLIST_ITENS = \[([\s\S]*?)\n\]/.exec(py)?.[1] ?? "";
  const itens = [...bloco.matchAll(/^\s*"(.*)",?\s*$/gm)].map((m) => m[1]);
  assert.deepEqual(itens, ITENS_CHECKLIST);
});

test("SIM e NÃO se excluem; sair do NÃO apaga a justificativa", () => {
  let l = checklistVazio();
  l = marcar(l, 4, "nao", true);
  l = l.map((m, i) => (i === 4 ? { ...m, obs: "mesmo representante" } : m));
  assert.deepEqual(l[4], { sim: false, nao: true, obs: "mesmo representante" });
  l = marcar(l, 4, "sim", true);
  assert.deepEqual(l[4], { sim: true, nao: false, obs: "" });
});

test("como o motor: SIM e NÃO juntos vale o NÃO, justificativa de SIM é descartada, sempre 8 itens", () => {
  const n = normalizarChecklist([{ sim: true, nao: true, obs: "x" }, { sim: true, obs: "não vale" }]);
  assert.equal(n.length, 8);
  assert.deepEqual(n[0], { sim: false, nao: true, obs: "x" });
  assert.deepEqual(n[1], { sim: true, nao: false, obs: "" });
});

test("avisos com as mesmas mensagens do conferir() do motor, sem impedir", () => {
  const l = [...Array(4).fill({ sim: true, nao: false, obs: "" }), { sim: false, nao: true, obs: " " }, ...Array(2).fill({ sim: true, nao: false, obs: "" })];
  assert.deepEqual(avisosChecklist(l), ["Item 5 marcado NÃO sem justificativa.", "Item 8 sem marcação (SIM ou NÃO)."]);
  assert.equal(checklistIniciado(checklistVazio()), false);
  assert.equal(checklistIniciado(l), true);
});
