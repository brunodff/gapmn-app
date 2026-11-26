// Demonstrativo de Execução e Saldo do Período de Vigência (seção 3K da SCON, 25/11/2026): as mesmas contas do
// kit/gerar_demonstrativo_saldo.py, para a tela mostrar na hora o quadro A–F, as providências e os alertas.
// O que falta sai entre ⟦ ⟧ (no documento, em amarelo). O teste aditivos.test.ts confere com o documento do kit.
import type { Alerta, DadosAditivo, EmpenhoPeriodo, SaldoPeriodo } from "./tipos.ts";
import { brl, fimPrevisto, numero, temProrrogacao, valorNovo } from "./regras.ts";
import { brlExt } from "./parecer.ts";

const falta = (t: string) => `⟦${t}⟧`;
const r2 = (v: number) => Math.round((v + (v >= 0 ? 1e-9 : -1e-9)) * 100) / 100;
/** v() do kit: vazio → null; senão o número com 2 casas */
const v = (x: unknown): number | null => (x == null || x === "" ? null : (() => { const n = numero(x); return n == null ? null : r2(n); })());
const soma = (l: (number | null | undefined)[]) => r2(l.reduce<number>((s, x) => s + (x ?? 0), 0));

function data(br: string | null | undefined): Date | null {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(String(br ?? "").trim());
  return m ? new Date(Date.UTC(Number(m[3]), Number(m[2]) - 1, Number(m[1]))) : null;
}
const br = (d: Date) => d.toISOString().slice(0, 10).split("-").reverse().join("/");
const dias = (d: Date, n: number) => new Date(d.getTime() + n * 86400000);
/** somar_meses do kit (aceita meses negativos; dia limitado ao último do mês) */
function somarMeses(d: Date, meses: number): Date {
  const m = d.getUTCMonth() + meses;
  const ano = d.getUTCFullYear() + Math.floor(m / 12), mes = ((m % 12) + 12) % 12;
  const ultimo = new Date(Date.UTC(ano, mes + 1, 0)).getUTCDate();
  return new Date(Date.UTC(ano, mes, Math.min(d.getUTCDate(), ultimo)));
}
/** "05/03/2025" → "20250305" (ordem da NE mais recente) */
const chaveData = (s: string) => `${s.slice(-4)}${s.slice(3, 5)}${s.slice(0, 2)}`;

/** Período analisado: o fim é a véspera do novo período; o início, o fim menos os meses do período (editáveis) */
export function periodoAnalisado(d: Pick<DadosAditivo, "saldo_periodo" | "aditivo">, avisos: string[] = []): { inicio: string | null; fim: string | null; inicioCalculado: boolean } {
  const sp = (d.saldo_periodo ?? {}) as Partial<SaldoPeriodo> & { meses?: number };
  const pr = d.aditivo?.prorrogacao;
  let fim = sp.fim || null, ini = sp.inicio || null, calculado = false;
  if (!fim && pr?.inicio) { const x = data(pr.inicio); if (x) fim = br(dias(x, -1)); }
  if (!ini && fim) {
    const meses = Math.trunc(Number(sp.meses || pr?.meses || 12));
    const f = data(fim);
    if (f) { ini = br(somarMeses(dias(f, 1), -meses)); calculado = true; avisos.push(`Início do período analisado calculado (${ini}) – conferir com o termo que fixou o período.`); }
  }
  if (!fim) avisos.push("Período analisado sem fim (saldo_periodo.fim ou aditivo.prorrogacao.inicio).");
  return { inicio: ini, fim, inicioCalculado: calculado };
}

export interface NeCalculada { numero: string; data: string; empenhado: number | null; liquidado: number | null; pago: number | null; a_liquidar: number | null; reservado: number; anular: number }
export interface PendenteCalculada { descricao: string; periodo: string; nf: string; valor: number; empenho: string }
export interface QuadroSaldo { A: number | null; B: number; C: number; D: number | null; E: number; F: number; nes: NeCalculada[]; pend: PendenteCalculada[] }

/** NEs que entram no demonstrativo: as marcadas pelo fiscal (as desmarcadas ficam só na tela) */
export const empenhosMarcados = (l: EmpenhoPeriodo[] | undefined) => (l ?? []).filter((e) => e.marcado !== false);

/** Quadro A–F (calcular do kit): reserva das pendências nas NEs e o que anular em cada uma */
export function calcularSaldo(d: Pick<DadosAditivo, "saldo_periodo" | "valor_atual">, avisos: string[] = []): QuadroSaldo {
  const sp = d.saldo_periodo ?? ({ empenhos: [], pendentes: [] } as SaldoPeriodo);
  const atual = v(d.valor_atual);
  const A = sp.valor_periodo != null && (sp.valor_periodo as unknown) !== "" ? v(sp.valor_periodo) : atual;
  const nes: NeCalculada[] = empenhosMarcados(sp.empenhos).map((e) => {
    const emp = v(e.empenhado), liq = v(e.liquidado);
    let al = v(e.a_liquidar);
    if (al == null && emp != null) al = r2(emp - (liq ?? 0));
    return { numero: String(e.numero ?? "").trim(), data: e.data || "", empenhado: emp, liquidado: liq, pago: v(e.pago), a_liquidar: al, reservado: 0, anular: 0 };
  });
  if (!nes.length) avisos.push("Nenhuma nota de empenho do período informada (buscar no Contratos.gov.br e conferir).");
  let B = v(sp.liquidado);
  if (B == null) B = soma(nes.map((e) => e.liquidado));
  const pend: PendenteCalculada[] = (sp.pendentes ?? []).filter((p) => p.valor != null && (p.valor as unknown) !== "")
    .map((p) => ({ descricao: p.descricao || "", periodo: p.periodo || "", nf: p.nf || "", valor: v(p.valor)!, empenho: String(p.empenho ?? "").trim() }));
  const C = soma(pend.map((p) => p.valor));
  // reserva das pendências nas NEs (a indicada pelo fiscal; sem indicação → NE mais recente com saldo)
  const porNum = new Map(nes.map((e) => [e.numero, e]));
  for (const p of pend) {
    let resto = p.valor;
    const indicada = porNum.get(p.empenho);
    if (indicada) { indicada.reservado = r2(indicada.reservado + resto); continue; }
    if (p.empenho) avisos.push(`Pendência '${p.descricao}' aponta a NE ${p.empenho}, que não está na lista de empenhos.`);
    for (const e of [...nes].sort((x, y) => chaveData(y.data).localeCompare(chaveData(x.data)))) {
      const livre = (e.a_liquidar ?? 0) - e.reservado;
      if (livre <= 0) continue;
      const uso = Math.min(livre, resto);
      e.reservado = r2(e.reservado + uso);
      resto = r2(resto - uso);
      if (!p.empenho) p.empenho = e.numero;
      if (resto <= 0) break;
    }
    if (resto > 0) avisos.push(`🔴 Faltam ${brl(resto)} de empenho para pagar '${p.descricao}' – pedir reforço de empenho.`);
  }
  const D = A != null ? r2(A - B - C) : null;
  const E = soma(nes.map((e) => e.a_liquidar));
  for (const e of nes) {
    e.anular = r2(Math.max((e.a_liquidar ?? 0) - e.reservado, 0));
    if ((e.a_liquidar ?? 0) - e.reservado < -0.009) avisos.push(`🔴 A NE ${e.numero} não tem saldo para o que foi reservado nela – conferir.`);
  }
  const F = soma(nes.map((e) => e.anular));
  if (D != null && D < -0.009) avisos.push(`🔴 Executado + a pagar (${brl(B + C)}) passa do valor do período (${brl(A!)}) – conferir.`);
  if (A == null) avisos.push("Valor do contrato para o período não informado (saldo_periodo.valor_periodo ou valor_atual).");
  return { A, B, C, D, E, F, nes, pend };
}

export interface PreviaSaldo { inicio: string | null; fim: string | null; inicioCalculado: boolean; quadro: QuadroSaldo; providencias: string[]; avisos: string[]; semValor: boolean }
/** Providências para a Seção de Contratos (item 4 do documento), já com a letra e a pontuação */
export function previaSaldo(d: DadosAditivo): PreviaSaldo {
  const avisos: string[] = [];
  const pr = d.aditivo?.prorrogacao;
  const semValor = pr?.modalidade === "sem_valor";
  const { inicio, fim, inicioCalculado } = periodoAnalisado(d, avisos);
  const q = calcularSaldo(d, avisos);
  const nTa = `${Math.trunc(Number(d.numero_aditivo) || 0)}º`;
  const novoIni = pr?.inicio || null;
  const novoFim = pr?.fim || (novoIni ? fimPrevisto(novoIni, Math.trunc(Number(pr?.meses) || 12)) : null);
  const novo = valorNovo(d);
  const prov: string[] = [];
  const dExt = q.D != null ? brlExt(q.D) : falta("R$ ___");
  if (semValor) {
    prov.push(`Prorrogação sem renovação do valor contratual: o saldo de ${dExt} permanece no contrato para o período prorrogado (${novoIni ?? ""} a ${novoFim ?? ""}). Não retirar do SILOMS nem anular empenho por causa desta prorrogação`);
  } else {
    prov.push(`Retirar do SILOMS o saldo de ${dExt}, referente ao período de ${inicio || "___"} a ${fim || "___"}`);
    const anul = q.nes.filter((e) => e.anular > 0);
    prov.push(anul.length ? `Anular no SIAFI o saldo sem uso das notas de empenho, no total de ${brlExt(q.F)}: ${anul.map((e) => `${e.numero} – ${brl(e.anular)}`).join("; ")}` : "Não há saldo de nota de empenho a anular no SIAFI");
    if (q.pend.length) prov.push(`Manter ${brlExt(q.C)} nas notas de empenho para pagar os serviços do item 2 (${q.nes.filter((e) => e.reservado > 0).map((e) => `${e.numero} – ${brl(e.reservado)}`).join("; ")})`);
    prov.push(`Registrar o novo período (${novoIni || falta("__/__/____")} a ${novoFim || falta("__/__/____")}) somente com o valor do ${nTa} Termo Aditivo, ${novo != null ? brlExt(novo) : falta("R$ ___")}, sem somar o saldo do período anterior`);
  }
  const letras = "abcdefg";
  return { inicio, fim, inicioCalculado, quadro: q, semValor, avisos, providencias: prov.map((p, i) => `${letras[i]}) ${p}${i === prov.length - 1 ? "." : ";"}`) };
}

/** Alertas do Demonstrativo (seção 5 da 3K): só avisam — o documento sai e a SCON confere */
export function alertasSaldo(d: DadosAditivo): Alerta[] {
  if (!temProrrogacao(d)) return [];
  if (!d.saldo_periodo) {
    return "demonstrativo_saldo" in (d.nao_anexados ?? {}) ? [] : [{ nivel: "atencao", texto: "Demonstrativo de Execução e Saldo: preencha a seção (notas de empenho do período e serviços ainda não pagos); sem ele o .zip sai sem o item.", secao: "saldo" }];
  }
  const p = previaSaldo(d);
  const a: Alerta[] = p.avisos.map((t) => (t.startsWith("🔴")
    ? { nivel: "critico" as const, texto: `Demonstrativo de Saldo: ${t.replace(/^🔴\s*/, "")}`, secao: "saldo" }
    : { nivel: "atencao" as const, texto: `Demonstrativo de Saldo: ${t}`, secao: "saldo" }));
  if (!p.semValor && p.quadro.D != null && p.quadro.D > 0.009) a.push({ nivel: "info", texto: `Declaração de Disponibilidade Orçamentária e lançamento do novo período: não somar o saldo de ${brl(p.quadro.D)} do período anterior ao valor do novo período (ele é retirado do SILOMS).`, secao: "saldo" });
  return a;
}

/** Empenho do Contratos.gov.br (rota <id>/empenhos; valores em texto "1.234,56") → NE do demonstrativo.
 *  NE de exercício anterior inscrita em restos a pagar: soma o RP liquidado e o RP pago, e o "a liquidar" é o do RP. */
export interface EmpenhoGovValores {
  numero: string; data_emissao?: string | null;
  empenhado?: string | null; aliquidar?: string | null; liquidado?: string | null; pago?: string | null;
  /** outras rotas da API escrevem "rpaliquidado" para o RP liquidado */
  rpinscrito?: string | null; rpaliquidar?: string | null; rpliquidado?: string | null; rpaliquidado?: string | null; rppago?: string | null;
}
const nBr = (x: unknown): number => {
  const s = String(x ?? "").trim();
  if (!s) return 0;
  const n = Number(s.includes(",") ? s.replace(/\./g, "").replace(",", ".") : s);
  return Number.isFinite(n) ? n : 0;
};
export function empenhoDoGov(e: EmpenhoGovValores, periodo: { inicio: string | null; fim: string | null }): EmpenhoPeriodo {
  const emissao = /^\d{4}-\d{2}-\d{2}/.test(String(e.data_emissao ?? "")) ? String(e.data_emissao).slice(0, 10).split("-").reverse().join("/") : String(e.data_emissao ?? "");
  const rpInscrito = nBr(e.rpinscrito);
  const rp = rpInscrito > 0;
  const rpLiq = nBr(e.rpliquidado ?? e.rpaliquidado);
  const empenhado = r2(nBr(e.empenhado) || rpInscrito);
  const liquidado = r2(nBr(e.liquidado) + (rp ? rpLiq : 0));
  const pago = r2(nBr(e.pago) + (rp ? nBr(e.rppago) : 0));
  const aLiq = rp ? r2(nBr(e.rpaliquidar)) : e.aliquidar != null && String(e.aliquidar).trim() !== "" ? r2(nBr(e.aliquidar)) : null;
  // já vem marcada a NE emitida dentro do período analisado (sem data: pelo ano do número)
  const de = data(emissao), ini = data(periodo.inicio), fim = data(periodo.fim);
  const ano = Number(String(e.numero).slice(0, 4));
  const marcado = de && ini && fim ? de >= ini && de <= fim
    : ini && fim ? ano >= ini.getUTCFullYear() && ano <= fim.getUTCFullYear() : true;
  return { numero: String(e.numero ?? "").trim(), data: emissao, empenhado, liquidado, pago, a_liquidar: aLiq, marcado, origem: rp ? "Contratos.gov.br (restos a pagar)" : "Contratos.gov.br" };
}
