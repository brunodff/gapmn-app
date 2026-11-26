import { test } from "node:test";
import assert from "node:assert/strict";
import { planejarRemanejamento, type ContratoRemanejamento, type Dotacao } from "./remanejamento.ts";

const D: Dotacao = { ugr: "GAP-MN", nd: "339037", pi: "A0630340600" };
const OUTRA: Dotacao = { ugr: "GAP-MN", nd: "339039", pi: "A0630340600" };
const ct = (id: string, fatura: number, meses: number, nes: { ne: string; a: number; d?: Dotacao | null }[]): ContratoRemanejamento => ({
  id, numero: id, fatura, necessario: fatura * meses, saldo: nes.reduce((s, n) => s + n.a, 0),
  nes: nes.map((n) => ({ ne: n.ne, ano: Number(n.ne.slice(0, 4)), aLiquidarExercicio: n.a, dotacao: n.d === undefined ? D : n.d })),
});

test("exemplo do Bruno: 15 mil num contrato e zero nos outros dois, 1 mês de 5 mil → todos com 5 mil", () => {
  const p = planejarRemanejamento([ct("A", 5000, 1, [{ ne: "2026NE000010", a: 15000 }]), ct("B", 5000, 1, [{ ne: "2026NE000011", a: 0 }]), ct("C", 5000, 1, [{ ne: "2025NE000900", a: 0 }])], 2026);
  assert.deepEqual([...p.porContrato.values()].map((r) => [r.cede, r.recebe, r.saldoDepois, r.falta]), [[10000, 0, 5000, 0], [0, 5000, 5000, 0], [0, 5000, 5000, 0]]);
  assert.deepEqual(p.anulacoes.map((a) => [a.ne, a.valor]), [["2026NE000010", 10000]]);
  // B tem NE do exercício na mesma adequação (reforça); C só tem NE de 2025 (emite outra)
  assert.deepEqual(p.empenhos.map((e) => [e.numero, e.valor, e.reforcar]), [["B", 5000, "2026NE000011"], ["C", 5000, null]]);
  assert.equal(p.total, 10000);
});

test("sobra curta: todos ganham o 1º mês antes de alguém ganhar o 2º; resto a pagar não é anulado", () => {
  const p = planejarRemanejamento([
    ct("A", 1000, 2, [{ ne: "2026NE000001", a: 4500 }, { ne: "2025NE000001", a: 3000 }]), // sobra 5.500, mas só 4.500 do exercício
    ct("B", 3000, 2, [{ ne: "2026NE000002", a: 0 }]),
    ct("C", 2000, 2, [{ ne: "2026NE000003", a: 500 }]),
  ], 2026);
  const r = (id: string) => p.porContrato.get(id)!;
  // 1º mês: B recebe 3.000, C recebe 1.500; sobra 0 para o 2º mês
  assert.deepEqual([r("B").recebe, r("C").recebe, r("A").cede], [3000, 1500, 4500]);
  assert.deepEqual([r("A").saldoDepois, r("A").falta], [3000, 0]);
  assert.deepEqual([r("B").falta, r("C").falta], [3000, 2000]);
  assert.ok(p.avisos.some((a) => a.startsWith("A: sobram R$ 5.500,00, mas só R$ 4.500,00")));
});

test("adequação diferente ou desconhecida não recebe", () => {
  const p = planejarRemanejamento([
    ct("A", 1000, 1, [{ ne: "2026NE000001", a: 5000 }]),
    ct("B", 1000, 1, [{ ne: "2026NE000002", a: 0, d: OUTRA }]),
    ct("C", 1000, 1, [{ ne: "2026NE000003", a: 0, d: null }]),
    ct("D", 1000, 1, [{ ne: "2026NE000004", a: 0, d: { ...D, nd: "33903701" } }]), // subitem: mesmo elemento 339037
  ], 2026);
  assert.deepEqual(["A", "B", "C", "D"].map((id) => p.porContrato.get(id)!.recebe), [0, 0, 0, 1000]);
  assert.ok(p.avisos.some((a) => a.startsWith("B: nenhum contrato do grupo tem sobra na mesma adequação")));
  assert.ok(p.avisos.some((a) => a.startsWith("C: sem NE com UGR, ND e PI")));
});

test("contrato com NEs do exercício em duas adequações recebe na que tem sobra", () => {
  const p = planejarRemanejamento([
    ct("A", 5000, 1, [{ ne: "2026NE000010", a: 15000 }]),
    ct("B", 5000, 1, [{ ne: "2026NE000557", a: 0, d: { ...D, pi: "SF063100200" } }, { ne: "2026NE000102", a: 0 }, { ne: "2025NE000001", a: 0, d: OUTRA }]),
  ], 2026);
  const b = p.porContrato.get("B")!;
  assert.deepEqual([b.recebe, b.dotacoes.length], [5000, 2]);
  assert.deepEqual(p.empenhos.map((e) => [e.numero, e.valor, e.reforcar, e.dotacao.pi]), [["B", 5000, "2026NE000102", "A0630340600"]]);
});
