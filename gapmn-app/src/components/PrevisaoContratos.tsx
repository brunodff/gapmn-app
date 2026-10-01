/**
 * Interface da previsão orçamentária de contratos.
 * Cálculo em ../lib/previsaoContratos.ts; aqui só apresentação e filtros.
 */
import { useMemo, useState } from "react";
import * as XLSX from "xlsx";
import { Card } from "./Card";
import {
  REGIMES, REGIME_LIST, calcularNecessidade, classificarRegime, mesHoje, mesIdx, anoDe, rotuloMes, normPag,
  type Regime, type PrevisaoContrato, type CfgPrevisao, type Necessidade,
} from "../lib/previsaoContratos";

// ─── Formatação ───────────────────────────────────────────────────────────────

const BRL = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const fmtMoney = (v: number) => BRL.format(v);
/** Valor curto para células de mês: 31,2 mil · 1,25 mi */
function fmtCurto(v: number): string {
  if (Math.abs(v) < 0.5) return "–";
  if (Math.abs(v) >= 1e6) return `${(v / 1e6).toLocaleString("pt-BR", { maximumFractionDigits: 2 })} mi`;
  if (Math.abs(v) >= 1e3) return `${(v / 1e3).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} mil`;
  return v.toLocaleString("pt-BR", { maximumFractionDigits: 0 });
}
function lerValor(s: string): number | null {
  const t = s.replace(/R\$\s?/g, "").replace(/\s/g, "");
  if (!t) return null;
  const n = parseFloat(t.includes(",") ? t.replace(/\./g, "").replace(",", ".") : t);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/** Planilha de execução SIAFI: sem ela não há empenhado nem ritmo dos estimativos */
export type EstadoSiafi = "ok" | "carregando" | "erro";

const COR_REGIME: Record<Regime, string> = {
  fixo:       "bg-sky-50 border-sky-200 text-sky-700",
  estimativo: "bg-amber-50 border-amber-200 text-amber-700",
  saldo:      "bg-violet-50 border-violet-200 text-violet-700",
  nao_prever: "bg-slate-100 border-slate-200 text-slate-500",
};

// ─── Selo do regime ───────────────────────────────────────────────────────────

export function RegimeBadge({ prev }: { prev: PrevisaoContrato }) {
  const r = REGIMES[prev.regime];
  return (
    <span
      className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2 py-0.5 text-[10px] font-semibold ${COR_REGIME[prev.regime]}`}
      title={`${r.rotulo}: ${r.descricao}\nMotivo: ${prev.motivo}`}
    >
      <span>{r.icone}</span>{r.curto}{prev.origem === "manual" && <span title="Ajustado manualmente">✎</span>}
    </span>
  );
}

// ─── Resumo no card do contrato (lista) ───────────────────────────────────────

export function PrevisaoNoCard({ prev, necessidadeAno, anoAtual, siafi }: { prev?: PrevisaoContrato; necessidadeAno?: number; anoAtual: number; siafi: EstadoSiafi }) {
  if (siafi === "carregando") return <div className="mt-1 text-[11px] text-slate-400">Previsão: carregando execução SIAFI…</div>;
  if (!prev) return null;
  if (prev.regime === "nao_prever") return <div className="mt-1"><RegimeBadge prev={prev} /></div>;
  return (
    <div className="mt-1 flex items-center gap-1.5 flex-wrap text-[11px]">
      <RegimeBadge prev={prev} />
      {prev.mensal > 0 && <span className="text-slate-600" title={prev.base}>{fmtMoney(prev.mensal)}/mês</span>}
      {siafi === "ok" && (necessidadeAno ?? 0) > 0.5 && (
        <span className="font-semibold text-red-600" title={`Crédito ainda necessário até dezembro/${anoAtual}`}>
          · faltam {fmtMoney(necessidadeAno!)} até dez
        </span>
      )}
      {siafi === "erro" && <span className="text-slate-400" title="Planilha de execução SIAFI indisponível: empenhado do exercício desconhecido">· provisório</span>}
      {prev.alertas.length > 0 && <span className="text-amber-600" title={prev.alertas.join("\n")}>⚠</span>}
    </div>
  );
}

// ─── Ajuste manual (Dados Gerais) ─────────────────────────────────────────────

export function RegimeEditor({
  contrato, prev, siafi, cfg, podeEditar, disponivel, onSalvar,
}: {
  contrato: { numero_contrato: string; descricao: string | null; receita_despesa?: string | null };
  prev?: PrevisaoContrato;
  siafi: EstadoSiafi;
  cfg?: CfgPrevisao;
  podeEditar: boolean;
  disponivel: boolean;
  /** retorna mensagem de erro, ou null em caso de sucesso */
  onSalvar: (regime: Regime | null, valorMensal: number | null, observacao: string | null) => Promise<string | null>;
}) {
  const [editando, setEditando] = useState(false);
  const [regimeSel, setRegimeSel] = useState<Regime | "auto">(cfg?.regime ?? "auto");
  const [valorTxt, setValorTxt] = useState(cfg?.valor_mensal != null ? String(cfg.valor_mensal).replace(".", ",") : "");
  const [obs, setObs] = useState(cfg?.observacao ?? "");
  const [salvando, setSalvando] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; texto: string } | null>(null);
  const auto = classificarRegime(contrato);

  function abrir() {
    setRegimeSel(cfg?.regime ?? "auto");
    setValorTxt(cfg?.valor_mensal != null ? String(cfg.valor_mensal).replace(".", ",") : "");
    setObs(cfg?.observacao ?? "");
    setMsg(null);
    setEditando(true);
  }
  async function salvar(voltarAuto = false) {
    const regime = voltarAuto || regimeSel === "auto" ? null : regimeSel;
    const valor = voltarAuto ? null : lerValor(valorTxt);
    if (!voltarAuto && valorTxt.trim() && valor === null) { setMsg({ ok: false, texto: "Valor mensal inválido" }); return; }
    setSalvando(true);
    const erro = await onSalvar(regime, valor, voltarAuto ? null : obs.trim() || null);
    setSalvando(false);
    if (erro) { setMsg({ ok: false, texto: erro }); return; }
    setMsg({ ok: true, texto: voltarAuto ? "Voltou ao automático" : "Ajuste salvo" });
    setEditando(false);
    setTimeout(() => setMsg(null), 3000);
  }

  const regimeEfetivo = regimeSel === "auto" ? auto.regime : regimeSel;
  const aceitaValor = regimeEfetivo === "fixo" || regimeEfetivo === "estimativo";

  return (
    <div className="mt-3 border-t pt-3">
      <div className="flex items-center justify-between gap-2 mb-1.5">
        <div className="text-xs font-semibold text-slate-700">Previsão mensal</div>
        {podeEditar && !editando && (
          <button onClick={abrir} className="rounded-lg border border-sky-200 px-2 py-0.5 text-[11px] text-sky-700 hover:bg-sky-50">
            ✏️ Ajustar
          </button>
        )}
      </div>

      {siafi === "carregando" ? (
        <p className="text-[11px] text-slate-400">Carregando execução SIAFI…</p>
      ) : prev ? (
        <div className="rounded-lg border bg-slate-50 p-2 text-xs space-y-1">
          <div className="flex items-center gap-2 flex-wrap">
            <RegimeBadge prev={prev} />
            {prev.regime !== "nao_prever" && <span className="text-sm font-bold text-slate-800">{fmtMoney(prev.mensal)}<span className="text-xs font-normal text-slate-500">/mês</span></span>}
          </div>
          <div className="text-[11px] text-slate-500">{prev.base}</div>
          <div className="text-[10px] text-slate-400">Regime: {prev.motivo}</div>
          {cfg?.observacao && <div className="text-[11px] text-slate-600 italic">“{cfg.observacao}”</div>}
          {cfg?.updated_nome && cfg.updated_at && (
            <div className="text-[10px] text-slate-400">Ajustado por {cfg.updated_nome} em {new Date(cfg.updated_at).toLocaleDateString("pt-BR")}</div>
          )}
        </div>
      ) : (
        <p className="text-[11px] text-slate-400">Carregando previsão…</p>
      )}

      {editando && (
        <div className="mt-2 rounded-lg border border-sky-200 bg-sky-50 p-2 space-y-2 text-xs">
          {!disponivel && (
            <div className="rounded border border-amber-200 bg-amber-50 px-2 py-1 text-[11px] text-amber-700">
              Para salvar ajustes, execute a migração <code>20261001_contratos_previsao.sql</code> no SQL Editor do Supabase.
            </div>
          )}
          <label className="block">
            <span className="text-slate-600">Regime</span>
            <select
              value={regimeSel}
              onChange={(e) => setRegimeSel(e.target.value as Regime | "auto")}
              className="mt-0.5 w-full rounded-lg border px-2 py-1 text-xs outline-none focus:ring-2 focus:ring-sky-200"
            >
              <option value="auto">Automático — {REGIMES[auto.regime].rotulo} ({auto.motivo})</option>
              {REGIME_LIST.map((r) => <option key={r} value={r}>{REGIMES[r].icone} {REGIMES[r].rotulo}</option>)}
            </select>
            <span className="mt-0.5 block text-[10px] text-slate-500">{REGIMES[regimeEfetivo].descricao}</span>
          </label>
          {aceitaValor && (
            <label className="block">
              <span className="text-slate-600">Valor mensal (opcional — deixe em branco para calcular)</span>
              <div className="mt-0.5 flex items-center rounded-lg border bg-white overflow-hidden">
                <span className="px-2 text-[10px] text-slate-500 border-r">R$</span>
                <input
                  value={valorTxt}
                  onChange={(e) => setValorTxt(e.target.value)}
                  placeholder={prev && prev.mensal > 0 ? prev.mensal.toFixed(2).replace(".", ",") : "0,00"}
                  className="flex-1 min-w-0 px-2 py-1 text-xs outline-none bg-transparent"
                />
              </div>
            </label>
          )}
          <label className="block">
            <span className="text-slate-600">Observação</span>
            <input
              value={obs}
              onChange={(e) => setObs(e.target.value)}
              placeholder="ex.: substituído pelo contrato 053/2024; fatura fixa de R$ 31.157,62"
              className="mt-0.5 w-full rounded-lg border px-2 py-1 text-xs outline-none focus:ring-2 focus:ring-sky-200"
            />
          </label>
          <div className="flex flex-wrap gap-1.5">
            <button onClick={() => salvar()} disabled={salvando || !disponivel}
              className="rounded-lg bg-sky-600 px-3 py-1 text-[11px] font-medium text-white hover:bg-sky-700 disabled:opacity-50">
              {salvando ? "Salvando…" : "Salvar"}
            </button>
            <button onClick={() => setEditando(false)} className="rounded-lg border px-3 py-1 text-[11px] text-slate-600 hover:bg-slate-50">
              Cancelar
            </button>
            {cfg && (
              <button onClick={() => salvar(true)} disabled={salvando || !disponivel}
                className="ml-auto rounded-lg border border-red-200 px-3 py-1 text-[11px] text-red-600 hover:bg-red-50 disabled:opacity-50">
                Voltar ao automático
              </button>
            )}
          </div>
        </div>
      )}
      {msg && <p className={`mt-1 text-[11px] ${msg.ok ? "text-green-700" : "text-red-600"}`}>{msg.texto}</p>}
    </div>
  );
}

// ─── Resumo da previsão do contrato (aba Execução) ────────────────────────────

export function PrevisaoResumoContrato({ prev, hoje, dataFinal, siafi }: { prev?: PrevisaoContrato; hoje: Date; dataFinal: string | null; siafi: EstadoSiafi }) {
  if (siafi === "carregando") return <p className="text-xs text-slate-400 text-center py-2">Carregando execução SIAFI para a previsão…</p>;
  if (!prev) return <p className="text-xs text-slate-400 text-center py-2">Carregando previsão…</p>;
  // Sem a planilha não se sabe o empenhado: mostra só o previsto
  const semExec = siafi === "erro";
  const hojeMi = mesHoje(hoje), ano0 = anoDe(hojeMi), dez = mesIdx(ano0, 12);
  const nAno = calcularNecessidade(prev, hojeMi, dez);
  const nProx = calcularNecessidade(prev, mesIdx(ano0 + 1, 1), mesIdx(ano0 + 1, 12));
  const n12 = calcularNecessidade(prev, hojeMi, hojeMi + 11);
  // Previsto no ano = realizado + o que falta até dezembro; assim previsto − empenhado
  // é o crédito necessário (competências liquidadas valem o que foi pago)
  const e = prev.execAno(ano0);
  const aberta = prev.primeiraAberta(ano0);
  let aFaturar = 0;
  for (let mi = aberta; mi <= dez; mi++) aFaturar += prev.valorMes(mi);
  const realizado = prev.regime === "saldo" ? e.empenhado : e.liquidado;
  const previstoAno = realizado + aFaturar;
  const fimVig = dataFinal ? new Date(dataFinal + "T12:00:00").toLocaleDateString("pt-BR") : null;

  return (
    <div className="rounded-xl border border-sky-200 bg-sky-50 px-3 py-3 text-xs space-y-2.5">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="font-semibold text-sky-700">📊 Previsão orçamentária</div>
        <RegimeBadge prev={prev} />
      </div>

      {prev.regime === "nao_prever" ? (
        <p className="text-slate-500">Contrato fora da previsão ({prev.motivo}).</p>
      ) : (
        <>
          <div>
            <div className="text-slate-500">Valor mensal previsto</div>
            <div className="text-base font-bold text-sky-700">{fmtMoney(prev.mensal)}</div>
            <div className="text-[11px] text-slate-500">{prev.base}</div>
          </div>

          {semExec ? (
            <p className="rounded-lg border border-amber-200 bg-amber-50 px-2 py-1.5 text-[11px] text-amber-700">
              Planilha de execução SIAFI indisponível: sem o empenhado do exercício não dá para calcular o crédito necessário. Abaixo, só o previsto.
            </p>
          ) : (
            <div className="grid grid-cols-2 gap-2">
              <div className="rounded-lg border bg-white p-2">
                <div className="text-slate-500">Previsto em {ano0}</div>
                <div className="font-semibold text-slate-800">{fmtMoney(previstoAno)}</div>
                <div className="text-[10px] text-slate-400">
                  {prev.regime === "saldo"
                    ? "empenhado + saldo a empenhar até dez"
                    : realizado > 0.5
                      ? `${fmtMoney(realizado)} liquidado + faturas de ${rotuloMes(aberta)} a dez`
                      : `desde ${rotuloMes(aberta)}`}
                </div>
              </div>
              <div className="rounded-lg border bg-white p-2">
                <div className="text-slate-500">Empenhado em {ano0}</div>
                <div className="font-semibold text-slate-800">{fmtMoney(e.empenhado)}</div>
                <div className="text-[10px] text-slate-400">a liquidar {fmtMoney(e.aLiquidar)}{prev.pagContratos > 1 ? " · rateado no PAG" : ""}</div>
              </div>
              <div className="rounded-lg border bg-white p-2">
                <div className="text-slate-500">Empenho cobre até</div>
                <div className={`font-semibold ${nAno.cobertoAte !== null && nAno.cobertoAte >= dez ? "text-green-700" : "text-amber-700"}`}>
                  {nAno.cobertoAte !== null ? rotuloMes(nAno.cobertoAte) : "— (nada coberto)"}
                </div>
                {nAno.excedente > 0.5 && <div className="text-[10px] text-green-700">sobra {fmtMoney(nAno.excedente)} no exercício</div>}
              </div>
              <div className={`rounded-lg border p-2 ${nAno.total > 0.5 ? "bg-red-50 border-red-200" : "bg-green-50 border-green-200"}`}>
                <div className={nAno.total > 0.5 ? "text-red-700" : "text-green-700"}>Crédito necessário até dez/{String(ano0).slice(2)}</div>
                <div className={`font-bold ${nAno.total > 0.5 ? "text-red-700" : "text-green-700"}`}>{fmtMoney(nAno.total)}</div>
                {nAno.pendente > 0.5 && <div className="text-[10px] text-red-600">inclui {fmtMoney(nAno.pendente)} de competências passadas</div>}
              </div>
            </div>
          )}

          <div className="rounded-lg border bg-white p-2 flex items-center justify-between gap-2">
            <div>
              <div className="text-slate-500">Previsão para {ano0 + 1}</div>
              <div className="text-[10px] text-slate-400">
                {prev.fimMi !== null && prev.fimMi < mesIdx(ano0 + 1, 12) && fimVig
                  ? `até o fim da vigência (${fimVig}) — sem supor prorrogação`
                  : "jan–dez, com reajuste estimado"}
              </div>
            </div>
            <div className="font-bold text-slate-800">{fmtMoney(nProx.previstoPeriodo)}</div>
          </div>

          <div>
            <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-500 mb-1">Próximos 12 meses</div>
            <div className="grid grid-cols-3 sm:grid-cols-4 gap-1">
              {n12.meses.map((m) => (
                <div key={m.mi} className="rounded border bg-white px-1.5 py-1" title={`Previsto ${fmtMoney(m.previsto)} · necessário ${fmtMoney(m.necessidade)}`}>
                  <div className="text-[10px] text-slate-400">{rotuloMes(m.mi)}</div>
                  <div className="font-mono text-[11px] text-slate-700">{fmtCurto(m.previsto)}</div>
                  {!semExec && m.necessidade > 0.5 && <div className="font-mono text-[10px] text-red-600">+{fmtCurto(m.necessidade)}</div>}
                </div>
              ))}
            </div>
            <div className="mt-1 text-[10px] text-slate-400">
              {semExec ? "Em cada mês: valor previsto." : "Em cada mês: valor previsto e, em vermelho, o crédito novo necessário."}
            </div>
          </div>
        </>
      )}

      {prev.alertas.length > 0 && (
        <ul className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 space-y-0.5 text-[11px] text-amber-700">
          {prev.alertas.map((a, i) => <li key={i}>⚠ {a}</li>)}
        </ul>
      )}
    </div>
  );
}

// ─── Aba Previsão Orçamentária ────────────────────────────────────────────────

export interface ContratoLinha {
  id: string;
  numero_contrato: string;
  descricao: string | null;
  fornecedor: string | null;
  ugr: string | null;
  acao: string | null;
  pag_nup: string | null;
  data_final: string | null;
}

type Agrupar = "ugr" | "pi" | "acao" | "regime" | "nenhum";
type Linha = { c: ContratoLinha; p: PrevisaoContrato; n: Necessidade; pis: string[] };
type Soma = { previsto: number[]; necessidade: number[]; pendente: number; total: number; previstoPeriodo: number; mensal: number };

function somar(ls: Linha[], nMeses: number): Soma {
  const s: Soma = { previsto: Array(nMeses).fill(0), necessidade: Array(nMeses).fill(0), pendente: 0, total: 0, previstoPeriodo: 0, mensal: 0 };
  for (const l of ls) {
    l.n.meses.forEach((m, i) => { s.previsto[i] += m.previsto; s.necessidade[i] += m.necessidade; });
    s.pendente += l.n.pendente;
    s.total += l.n.total;
    s.previstoPeriodo += l.n.previstoPeriodo;
    s.mensal += l.p.mensal;
  }
  return s;
}

const AGRUPAR_ROTULO: Record<Agrupar, string> = { ugr: "UGR", pi: "PI", acao: "Ação", regime: "Regime", nenhum: "Sem agrupar" };

export function PrevisaoOrcamentaria({
  contratos, previsoes, hoje, piByPag, piDescMap,
  reajustePct, onReajustePct, suporProrrogacao, onSuporProrrogacao,
  siafiCarregando, siafiErro, onAbrirContrato,
}: {
  contratos: ContratoLinha[];
  previsoes: Map<string, PrevisaoContrato>;
  hoje: Date;
  piByPag: Map<string, string[]>;
  piDescMap: Map<string, string>;
  reajustePct: number;
  onReajustePct: (v: number) => void;
  suporProrrogacao: boolean;
  onSuporProrrogacao: (v: boolean) => void;
  siafiCarregando: boolean;
  siafiErro: string | null;
  onAbrirContrato: (id: string) => void;
}) {
  const hojeMi = mesHoje(hoje);
  const ano0 = anoDe(hojeMi);
  const [deMi, setDeMi] = useState(hojeMi);
  const [ateMi, setAteMi] = useState(mesIdx(ano0, 12));
  const [agrupar, setAgrupar] = useState<Agrupar>("ugr");
  const [mostrar, setMostrar] = useState<"necessidade" | "previsto">("necessidade");
  const [fUgr, setFUgr] = useState("todos");
  const [fAcao, setFAcao] = useState("todos");
  const [fPi, setFPi] = useState("todos");
  const [fRegime, setFRegime] = useState<"todos" | Regime>("todos");
  const [texto, setTexto] = useState("");
  const [soAlertas, setSoAlertas] = useState(false);
  const [abertos, setAbertos] = useState<Set<string>>(new Set());
  const [verMetodo, setVerMetodo] = useState(false);

  const opcoesMes = Array.from({ length: 36 }, (_, i) => hojeMi + i);
  const meses = useMemo(() => { const a: number[] = []; for (let mi = deMi; mi <= ateMi; mi++) a.push(mi); return a; }, [deMi, ateMi]);

  function periodo(de: number, ate: number) { setDeMi(de); setAteMi(Math.max(de, ate)); }
  const ATALHOS: Array<{ rotulo: string; de: number; ate: number }> = [
    { rotulo: `Até dez/${String(ano0).slice(2)}`, de: hojeMi, ate: mesIdx(ano0, 12) },
    { rotulo: "Próx. 3 meses", de: hojeMi, ate: hojeMi + 2 },
    { rotulo: "Próx. 6 meses", de: hojeMi, ate: hojeMi + 5 },
    { rotulo: "Próx. 12 meses", de: hojeMi, ate: hojeMi + 11 },
    { rotulo: `Exercício ${ano0 + 1}`, de: mesIdx(ano0 + 1, 1), ate: mesIdx(ano0 + 1, 12) },
  ];

  // Opções de filtro em cascata: UGR → Ação → PI
  const ugrs = useMemo(() => [...new Set(contratos.map((c) => c.ugr).filter(Boolean) as string[])].sort(), [contratos]);
  const baseUgr = useMemo(() => (fUgr === "todos" ? contratos : contratos.filter((c) => c.ugr === fUgr)), [contratos, fUgr]);
  const acoes = useMemo(() => [...new Set(baseUgr.map((c) => c.acao).filter(Boolean) as string[])].sort(), [baseUgr]);
  const pisOpc = useMemo(() => {
    const s = new Set<string>();
    (fAcao === "todos" ? baseUgr : baseUgr.filter((c) => c.acao === fAcao)).forEach((c) => (piByPag.get(normPag(c.pag_nup)) ?? []).forEach((p) => s.add(p)));
    return [...s].sort();
  }, [baseUgr, fAcao, piByPag]);

  const { linhas, ocultosVencidos, foraPrevisao } = useMemo(() => {
    const q = texto.trim().toLowerCase();
    let ocultosVencidos = 0, foraPrevisao = 0;
    const linhas: Linha[] = [];
    for (const c of contratos) {
      const p = previsoes.get(c.id);
      if (!p) continue;
      if (fUgr !== "todos" && c.ugr !== fUgr) continue;
      if (fAcao !== "todos" && c.acao !== fAcao) continue;
      const pis = piByPag.get(normPag(c.pag_nup)) ?? [];
      if (fPi !== "todos" && !pis.includes(fPi)) continue;
      if (q && ![c.numero_contrato, c.descricao, c.fornecedor, c.pag_nup].some((f) => (f ?? "").toLowerCase().includes(q))) continue;
      if (fRegime === "todos" && p.regime === "nao_prever") { foraPrevisao++; continue; }
      if (fRegime !== "todos" && p.regime !== fRegime) continue;
      if (p.vencido && !suporProrrogacao) { ocultosVencidos++; continue; }
      if (soAlertas && !p.alertas.length) continue;
      linhas.push({ c, p, n: calcularNecessidade(p, deMi, ateMi), pis });
    }
    return { linhas, ocultosVencidos, foraPrevisao };
  }, [contratos, previsoes, piByPag, fUgr, fAcao, fPi, fRegime, texto, soAlertas, suporProrrogacao, deMi, ateMi]);

  const grupos = useMemo(() => {
    const chave = (l: Linha) =>
      agrupar === "ugr" ? l.c.ugr || "Sem UGR"
      : agrupar === "acao" ? l.c.acao || "Sem ação"
      : agrupar === "pi" ? l.pis.join(", ") || "Sem PI"
      : agrupar === "regime" ? `${REGIMES[l.p.regime].icone} ${REGIMES[l.p.regime].rotulo}`
      : "Todos os contratos";
    const m = new Map<string, Linha[]>();
    for (const l of linhas) (m.get(chave(l)) ?? m.set(chave(l), []).get(chave(l))!).push(l);
    const valor = (x: { total: number; previstoPeriodo: number }) => (mostrar === "necessidade" ? x.total : x.previstoPeriodo);
    return [...m].map(([nome, ls]) => ({
      nome,
      linhas: [...ls].sort((a, b) => valor(b.n) - valor(a.n)),
      soma: somar(ls, meses.length),
    })).sort((a, b) => valor(b.soma) - valor(a.soma));
  }, [linhas, agrupar, mostrar, meses.length]);

  const tot = useMemo(() => somar(linhas, meses.length), [linhas, meses.length]);
  const comAlerta = linhas.filter((l) => l.p.alertas.length).length;
  const rotuloPendente = deMi === hojeMi ? "Pendente (competências passadas)" : `Necessidade antes de ${rotuloMes(deMi)}`;
  const anos = useMemo(() => {
    const a: Array<{ ano: number; n: number }> = [];
    for (const mi of meses) { const y = anoDe(mi); if (a.length && a[a.length - 1].ano === y) a[a.length - 1].n++; else a.push({ ano: y, n: 1 }); }
    return a;
  }, [meses]);
  const todosAbertos = agrupar === "nenhum";

  function alternar(nome: string) {
    setAbertos((s) => { const n = new Set(s); if (n.has(nome)) n.delete(nome); else n.add(nome); return n; });
  }

  function exportar() {
    const cab = [
      "UGR", "Ação", "PI", "Contrato", "Fornecedor", "Objeto", "Regime", "Origem do regime", "Base de cálculo",
      "Valor mensal", "Vigência até", `Empenhado ${anoDe(deMi)}`, "Empenho cobre até", rotuloPendente,
      ...meses.map((mi) => `Previsto ${rotuloMes(mi)}`), ...meses.map((mi) => `Necessário ${rotuloMes(mi)}`),
      "Total previsto", "Total necessário", "Alertas",
    ];
    const r2 = (v: number) => Math.round(v * 100) / 100;
    const linhasXls = grupos.flatMap((g) => g.linhas).map(({ c, p, n, pis }) => [
      c.ugr ?? "", c.acao ?? "", pis.map((pi) => (piDescMap.get(pi) ? `${pi} — ${piDescMap.get(pi)}` : pi)).join("; "),
      c.numero_contrato, c.fornecedor ?? "", c.descricao ?? "", REGIMES[p.regime].rotulo, p.motivo, p.base,
      r2(p.mensal), c.data_final ? new Date(c.data_final + "T12:00:00").toLocaleDateString("pt-BR") : "",
      r2(p.execAno(anoDe(deMi)).empenhado), n.cobertoAte !== null ? rotuloMes(n.cobertoAte) : "", r2(n.pendente),
      ...n.meses.map((m) => r2(m.previsto)), ...n.meses.map((m) => r2(m.necessidade)),
      r2(n.previstoPeriodo), r2(n.total), p.alertas.join(" | "),
    ]);
    const resumo = [
      [AGRUPAR_ROTULO[agrupar], "Contratos", "Custo mensal atual", rotuloPendente, ...meses.map((mi) => `Necessário ${rotuloMes(mi)}`), "Total previsto", "Total necessário"],
      ...grupos.map((g) => [g.nome, g.linhas.length, r2(g.soma.mensal), r2(g.soma.pendente), ...g.soma.necessidade.map(r2), r2(g.soma.previstoPeriodo), r2(g.soma.total)]),
      ["TOTAL", linhas.length, r2(tot.mensal), r2(tot.pendente), ...tot.necessidade.map(r2), r2(tot.previstoPeriodo), r2(tot.total)],
    ];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(resumo), "Resumo");
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([cab, ...linhasXls]), "Contratos");
    XLSX.writeFile(wb, `previsao_contratos_${rotuloMes(deMi).replace("/", "-")}_a_${rotuloMes(ateMi).replace("/", "-")}.xlsx`);
  }

  const celula = (prev: number, nec: number) => {
    const v = mostrar === "necessidade" ? nec : prev;
    return { v, cor: mostrar === "necessidade" && v > 0.5 ? "text-red-600" : "text-slate-600" };
  };
  const btn = (ativo: boolean) =>
    `rounded-lg border px-2.5 py-1 text-xs font-medium transition-colors ${ativo ? "bg-sky-600 text-white border-sky-600" : "border-slate-200 text-slate-600 hover:bg-slate-50"}`;
  const sel = "rounded-xl border px-2.5 py-1.5 text-xs outline-none focus:ring-2 focus:ring-sky-200";

  return (
    <div className="space-y-4">
      {/* ── Controles ── */}
      <Card>
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-semibold text-slate-700">Período:</span>
            <select value={deMi} onChange={(e) => periodo(Number(e.target.value), ateMi)} className={sel}>
              {opcoesMes.map((mi) => <option key={mi} value={mi}>{rotuloMes(mi)}</option>)}
            </select>
            <span className="text-xs text-slate-500">até</span>
            <select value={ateMi} onChange={(e) => periodo(deMi, Number(e.target.value))} className={sel}>
              {opcoesMes.filter((mi) => mi >= deMi).map((mi) => <option key={mi} value={mi}>{rotuloMes(mi)}</option>)}
            </select>
            <div className="flex flex-wrap gap-1">
              {ATALHOS.map((a) => (
                <button key={a.rotulo} onClick={() => periodo(a.de, a.ate)} className={btn(deMi === a.de && ateMi === a.ate)}>{a.rotulo}</button>
              ))}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-semibold text-slate-700">Agrupar:</span>
            {(Object.keys(AGRUPAR_ROTULO) as Agrupar[]).map((a) => (
              <button key={a} onClick={() => setAgrupar(a)} className={btn(agrupar === a)}>{AGRUPAR_ROTULO[a]}</button>
            ))}
            <span className="ml-2 text-xs font-semibold text-slate-700">Mostrar:</span>
            <button onClick={() => setMostrar("necessidade")} className={btn(mostrar === "necessidade")}>Crédito necessário</button>
            <button onClick={() => setMostrar("previsto")} className={btn(mostrar === "previsto")}>Gasto previsto</button>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <select value={fUgr} onChange={(e) => { setFUgr(e.target.value); setFAcao("todos"); setFPi("todos"); }} className={sel}>
              <option value="todos">Todas as UGR</option>
              {ugrs.map((u) => <option key={u} value={u}>{u}</option>)}
            </select>
            <select value={fAcao} onChange={(e) => { setFAcao(e.target.value); setFPi("todos"); }} className={sel}>
              <option value="todos">Todas as ações</option>
              {acoes.map((a) => <option key={a} value={a}>{a}</option>)}
            </select>
            <select value={fPi} onChange={(e) => setFPi(e.target.value)} className={`${sel} max-w-xs`}>
              <option value="todos">Todos os PI</option>
              {pisOpc.map((p) => <option key={p} value={p}>{piDescMap.get(p) ? `${p} — ${piDescMap.get(p)}` : p}</option>)}
            </select>
            <select value={fRegime} onChange={(e) => setFRegime(e.target.value as "todos" | Regime)} className={sel}>
              <option value="todos">Todos os regimes</option>
              {REGIME_LIST.map((r) => <option key={r} value={r}>{REGIMES[r].icone} {REGIMES[r].rotulo}</option>)}
            </select>
            <input value={texto} onChange={(e) => setTexto(e.target.value)} placeholder="Buscar contrato, objeto, fornecedor, PAG…"
              className="flex-1 min-w-[200px] rounded-xl border px-3 py-1.5 text-xs outline-none focus:ring-2 focus:ring-sky-200" />
          </div>

          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-slate-600">
            <label className="flex items-center gap-1.5" title="Reajuste anual aplicado à parcela fixa no aniversário da data-base (quando informada) e na prorrogação, e ao estimativo a cada novo exercício">
              Reajuste anual
              <input type="number" min={0} max={50} step={0.1} value={reajustePct}
                onChange={(e) => onReajustePct(Number(e.target.value) || 0)}
                className="w-16 rounded-lg border px-2 py-1 text-center text-xs outline-none focus:ring-2 focus:ring-sky-200" />%
            </label>
            <label className="flex items-center gap-1.5 cursor-pointer" title="Prevê a continuidade dos contratos após o fim da vigência (prorrogação ou novo contrato equivalente)">
              <input type="checkbox" checked={suporProrrogacao} onChange={(e) => onSuporProrrogacao(e.target.checked)} />
              Supor prorrogação dos contratos que vencem
            </label>
            <label className="flex items-center gap-1.5 cursor-pointer">
              <input type="checkbox" checked={soAlertas} onChange={(e) => setSoAlertas(e.target.checked)} />
              Só contratos com alerta ({comAlerta})
            </label>
            <button onClick={() => setVerMetodo((v) => !v)} className="text-sky-600 hover:underline">
              {verMetodo ? "Ocultar" : "Como é calculado?"}
            </button>
            <button onClick={exportar} disabled={!linhas.length}
              className="ml-auto rounded-lg border border-green-200 bg-green-50 px-3 py-1 text-xs font-medium text-green-700 hover:bg-green-100 disabled:opacity-50">
              ⬇ Exportar Excel
            </button>
          </div>

          {siafiErro && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
              Planilha de execução SIAFI indisponível ({siafiErro}). Previsão provisória: estimativos usam valor ÷ vigência e o crédito
              necessário conta só daqui para frente, sem descontar o que já foi empenhado. Recarregue a página para tentar de novo.
            </div>
          )}

          {verMetodo && (
            <div className="rounded-lg border border-sky-200 bg-sky-50 px-3 py-2 text-[11px] text-slate-700 space-y-1">
              <p><strong>📅 Parcela fixa</strong> (limpeza, manutenção preventiva, outsourcing…): valor do contrato ÷ meses de vigência, uma parcela por mês a partir do início.</p>
              <p><strong>⚡ Estimativo</strong> (energia, água, telefonia, credenciamentos, manutenção por OS…): ritmo de liquidação do ano (liquidado ÷ meses já faturados, considerando ~1 mês de defasagem da fatura) combinado com os empenhos anuais dos últimos 3 anos, com peso maior para o mais recente. Sem empenho no ano há 3 meses ou mais, a previsão é zerada (provável substituição). Sem histórico, usa valor ÷ vigência, só daqui para frente.</p>
              <p><strong>🏗️ Saldo</strong> (obras, aquisições): saldo a empenhar distribuído até o fim da vigência.</p>
              <p><strong>Crédito necessário</strong> em cada exercício = faturas ainda não liquidadas até o fim do período − saldo a liquidar dos empenhos do ano (NEs do ano). As competências já liquidadas entram pelo valor pago, não pela previsão. O <em>pendente</em> é a parte de competências que já passaram sem empenho suficiente, como a fatura do mês passado que ainda vai ser liquidada. Restos a pagar não entram: pagam competências de anos anteriores.</p>
              <p>O regime é deduzido do objeto; uma parcela fixa que executa menos de 60% do valor vira estimativo. Contratos do mesmo PAG dividem o histórico pelo valor mensal de cada um. Tudo pode ser ajustado em <em>Dados Gerais → Previsão mensal</em>.</p>
            </div>
          )}
        </div>
      </Card>

      {siafiCarregando ? (
        <Card>
          <p className="py-8 text-center text-sm text-slate-500">Carregando execução SIAFI (empenhos e liquidações)…</p>
        </Card>
      ) : (
        <>
          {/* ── Indicadores ── */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            {[
              { rotulo: `Gasto previsto ${rotuloMes(deMi)}–${rotuloMes(ateMi)}`, valor: tot.previstoPeriodo, sub: `custo mensal atual ${fmtMoney(tot.mensal)}`, cor: "text-slate-800", bg: "bg-white" },
              { rotulo: rotuloPendente, valor: tot.pendente, sub: "já deveria estar empenhado", cor: tot.pendente > 0.5 ? "text-amber-700" : "text-slate-800", bg: tot.pendente > 0.5 ? "bg-amber-50" : "bg-white" },
              { rotulo: "Crédito necessário no período", valor: tot.total - tot.pendente, sub: "além do que já está empenhado", cor: "text-red-700", bg: "bg-red-50" },
              { rotulo: "Total a providenciar", valor: tot.total, sub: `${linhas.length} contratos`, cor: "text-red-700", bg: "bg-red-50" },
            ].map((k) => (
              <div key={k.rotulo} className={`rounded-2xl border p-3 shadow-sm ${k.bg}`}>
                <div className="text-[11px] text-slate-500">{k.rotulo}</div>
                <div className={`mt-0.5 text-lg font-bold ${k.cor}`}>{fmtMoney(k.valor)}</div>
                <div className="text-[10px] text-slate-400">{k.sub}</div>
              </div>
            ))}
          </div>

          {/* ── Tabela mês a mês ── */}
          <Card>
            <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-slate-500">
              <span>
                {mostrar === "necessidade"
                  ? "Crédito novo necessário em cada mês (o que ultrapassa o empenhado)"
                  : "Gasto previsto em cada mês de competência"}
              </span>
              {ocultosVencidos > 0 && <span>· {ocultosVencidos} contrato(s) com vigência já encerrada não entram (marque “Supor prorrogação” se forem renovados)</span>}
              {foraPrevisao > 0 && <span>· {foraPrevisao} fora da previsão (receita ou excluídos)</span>}
            </div>
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-xs">
                <thead>
                  {anos.length > 1 && (
                    <tr className="text-[10px] text-slate-500">
                      <th colSpan={5} />
                      {anos.map((a) => <th key={a.ano} colSpan={a.n} className="border-b border-slate-200 px-2 py-1 text-center font-semibold">{a.ano}</th>)}
                      <th />
                    </tr>
                  )}
                  <tr className="bg-slate-100 text-[10px] uppercase tracking-wide text-slate-500">
                    <th className="px-2 py-2 text-left font-semibold min-w-[200px]">{agrupar === "nenhum" ? "Contrato" : `${AGRUPAR_ROTULO[agrupar]} / contrato`}</th>
                    <th className="px-2 py-2 text-left font-semibold">Regime</th>
                    <th className="px-2 py-2 text-right font-semibold">Mensal</th>
                    <th className="px-2 py-2 text-center font-semibold" title="Último mês já liquidado ou coberto pelo saldo empenhado no exercício">Cobre até</th>
                    <th className="px-2 py-2 text-right font-semibold text-amber-700" title={rotuloPendente}>Pendente</th>
                    {meses.map((mi) => <th key={mi} className="px-2 py-2 text-right font-semibold whitespace-nowrap">{rotuloMes(mi)}</th>)}
                    <th className="px-2 py-2 text-right font-semibold text-red-700">Total</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {grupos.map((g) => {
                    const aberto = todosAbertos || abertos.has(g.nome);
                    return [
                      !todosAbertos && (
                        <tr key={`g-${g.nome}`} onClick={() => alternar(g.nome)} className="cursor-pointer bg-slate-50 font-semibold hover:bg-slate-100">
                          <td className="px-2 py-1.5 text-slate-800">
                            <span className="mr-1 text-slate-400">{aberto ? "▾" : "▸"}</span>{g.nome}
                            <span className="ml-1 font-normal text-slate-400">({g.linhas.length})</span>
                          </td>
                          <td />
                          <td className="px-2 py-1.5 text-right text-slate-600" title={fmtMoney(g.soma.mensal)}>{fmtCurto(g.soma.mensal)}</td>
                          <td />
                          <td className="px-2 py-1.5 text-right text-amber-700" title={fmtMoney(g.soma.pendente)}>{fmtCurto(g.soma.pendente)}</td>
                          {meses.map((mi, i) => { const k = celula(g.soma.previsto[i], g.soma.necessidade[i]); return <td key={mi} className={`px-2 py-1.5 text-right ${k.cor}`} title={fmtMoney(k.v)}>{fmtCurto(k.v)}</td>; })}
                          <td className="px-2 py-1.5 text-right text-red-700" title={fmtMoney(mostrar === "necessidade" ? g.soma.total : g.soma.previstoPeriodo)}>
                            {fmtCurto(mostrar === "necessidade" ? g.soma.total : g.soma.previstoPeriodo)}
                          </td>
                        </tr>
                      ),
                      ...(aberto ? g.linhas.map(({ c, p, n }) => (
                        <tr key={c.id} className="hover:bg-slate-50">
                          <td className="px-2 py-1.5">
                            <button onClick={() => onAbrirContrato(c.id)} className="text-left font-medium text-sky-700 hover:underline">{c.numero_contrato}</button>
                            {p.alertas.length > 0 && <span className="ml-1 cursor-help text-amber-600" title={p.alertas.join("\n")}>⚠</span>}
                            <div className="max-w-[260px] truncate text-[10px] text-slate-400" title={`${c.fornecedor ?? ""} — ${c.descricao ?? ""}`}>{c.fornecedor ?? c.descricao ?? "–"}</div>
                          </td>
                          <td className="px-2 py-1.5"><RegimeBadge prev={p} /></td>
                          <td className="px-2 py-1.5 text-right text-slate-600 whitespace-nowrap" title={p.base}>{fmtCurto(p.mensal)}</td>
                          <td className="px-2 py-1.5 text-center text-slate-500 whitespace-nowrap">{n.cobertoAte !== null ? rotuloMes(n.cobertoAte) : "–"}</td>
                          <td className="px-2 py-1.5 text-right text-amber-700" title={fmtMoney(n.pendente)}>{fmtCurto(n.pendente)}</td>
                          {n.meses.map((m) => { const k = celula(m.previsto, m.necessidade); return <td key={m.mi} className={`px-2 py-1.5 text-right ${k.cor}`} title={`Previsto ${fmtMoney(m.previsto)} · necessário ${fmtMoney(m.necessidade)}`}>{fmtCurto(k.v)}</td>; })}
                          <td className="px-2 py-1.5 text-right font-semibold text-red-700" title={fmtMoney(mostrar === "necessidade" ? n.total : n.previstoPeriodo)}>
                            {fmtCurto(mostrar === "necessidade" ? n.total : n.previstoPeriodo)}
                          </td>
                        </tr>
                      )) : []),
                    ];
                  })}
                </tbody>
                <tfoot>
                  <tr className="bg-slate-800 text-xs font-bold text-white">
                    <td className="px-2 py-2">TOTAL ({linhas.length})</td>
                    <td />
                    <td className="px-2 py-2 text-right" title={fmtMoney(tot.mensal)}>{fmtCurto(tot.mensal)}</td>
                    <td />
                    <td className="px-2 py-2 text-right text-amber-300" title={fmtMoney(tot.pendente)}>{fmtCurto(tot.pendente)}</td>
                    {meses.map((mi, i) => { const k = celula(tot.previsto[i], tot.necessidade[i]); return <td key={mi} className="px-2 py-2 text-right" title={fmtMoney(k.v)}>{fmtCurto(k.v)}</td>; })}
                    <td className="px-2 py-2 text-right text-amber-300" title={fmtMoney(mostrar === "necessidade" ? tot.total : tot.previstoPeriodo)}>
                      {fmtCurto(mostrar === "necessidade" ? tot.total : tot.previstoPeriodo)}
                    </td>
                  </tr>
                </tfoot>
              </table>
              {!linhas.length && <p className="py-6 text-center text-xs text-slate-400">Nenhum contrato para os filtros escolhidos.</p>}
            </div>
          </Card>
        </>
      )}
    </div>
  );
}
