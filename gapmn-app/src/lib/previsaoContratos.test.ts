// Testes da cobertura das próximas faturas (card "faltam … p/ 3 meses" e grupos de contratos).
import { test } from "node:test";
import assert from "node:assert/strict";
import { coberturaMeses, mesIdx, type PrevisaoContrato } from "./previsaoContratos.ts";

const hoje = new Date(2026, 10, 18); // 18/11/2026
const prev = (o: Partial<PrevisaoContrato>) => ({ regime: "fixo", mensal: 1000, fimMi: mesIdx(2027, 12), ...o }) as PrevisaoContrato;

test("exemplo do Bruno: fatura de R$ 1.000 e R$ 1.000 a liquidar → faltam R$ 2.000 para 3 meses", () => {
  assert.deepEqual(coberturaMeses(prev({}), 1000, hoje), { pedidos: 3, meses: 3, fatura: 1000, necessario: 3000, aLiquidar: 1000, falta: 2000 });
});

test("a liquidar maior que as 3 faturas: nada falta", () => {
  const c = coberturaMeses(prev({ mensal: 8634.75 }), 27692.77, hoje)!;
  assert.equal(c.necessario, 25904.25);
  assert.equal(c.falta, 0);
});

test("vigência acabando antes: conta só os meses que restam, salvo prorrogação", () => {
  const p = prev({ fimMi: mesIdx(2026, 12) }); // nov e dez
  assert.equal(coberturaMeses(p, 0, hoje)!.meses, 2);
  assert.equal(coberturaMeses(p, 0, hoje)!.falta, 2000);
  assert.equal(coberturaMeses(p, 0, hoje, 6, true)!.falta, 6000);
  assert.equal(coberturaMeses(prev({ fimMi: mesIdx(2026, 9) }), 0, hoje)!.meses, 0, "vencido: nenhum mês");
});

test("grupo de X meses e regimes sem fatura mensal", () => {
  assert.equal(coberturaMeses(prev({ regime: "estimativo", mensal: 500 }), 200, hoje, 6)!.falta, 2800);
  assert.equal(coberturaMeses(prev({ regime: "saldo" }), 0, hoje), null);
  assert.equal(coberturaMeses(prev({ regime: "nao_prever" }), 0, hoje), null);
  assert.equal(coberturaMeses(prev({ mensal: 0 }), 0, hoje), null);
  assert.equal(coberturaMeses(undefined, 0, hoje), null);
});
