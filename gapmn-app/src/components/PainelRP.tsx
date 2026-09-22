import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { fetchCSV, toRPNEs, SHEET_URLS, LinhaRPNE } from "../lib/gsheets";
import { supabase } from "../lib/supabase";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip as ChartTooltip, ResponsiveContainer, Cell, Legend,
} from "recharts";

// ─── Design tokens (igual ao PaineisGerenciais) ──────────────────────────────

const DK = {
  bg:        "#0d1117",
  card:      "#161b27",
  cardBorder:"#1e2a3a",
  text:      "#e2e8f0",
  muted:     "#64748b",
  dim:       "#334155",
  grid:      "#1e2a3a",
  cyan:      "#22d3ee",
  teal:      "#2dd4bf",
  green:     "#4ade80",
  purple:    "#a78bfa",
  pink:      "#f472b6",
  amber:     "#fbbf24",
  red:       "#f87171",
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

const fmtMoney = (v: number) =>
  v.toLocaleString("pt-BR", { style: "currency", currency: "BRL", minimumFractionDigits: 2 });

function fmtShort(v: number) {
  if (v >= 1_000_000) return `R$ ${(v / 1_000_000).toFixed(1).replace(".", ",")}M`;
  if (v >= 1_000)     return `R$ ${(v / 1_000).toFixed(0)}K`;
  return fmtMoney(v);
}

function truncate(s: string, n = 20) {
  return s.length > n ? s.slice(0, n) + "…" : s;
}

function normPag(s: string) {
  return (s ?? "").trim().toUpperCase().replace(/\s+/g, "");
}

// ─── Sub-componentes ─────────────────────────────────────────────────────────

function KpiCard({ label, value, accent = DK.cyan }: {
  label: string; value: string; accent?: string;
}) {
  return (
    <div style={{
      background: DK.card, border: `1px solid ${DK.cardBorder}`,
      borderRadius: 16, padding: "18px 20px", position: "relative", overflow: "hidden",
    }}>
      <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 3,
        background: `linear-gradient(90deg, ${accent}00, ${accent}, ${accent}00)` }} />
      <div style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase",
        letterSpacing: "0.08em", color: DK.muted }}>
        {label}
      </div>
      <div style={{ marginTop: 10, fontSize: 22, fontWeight: 800, color: accent, lineHeight: 1 }}>
        {value}
      </div>
    </div>
  );
}

function DarkCard({ title, children }: { title?: string; children: React.ReactNode }) {
  return (
    <div style={{ background: DK.card, border: `1px solid ${DK.cardBorder}`, borderRadius: 16, padding: "20px 24px" }}>
      {title && (
        <div style={{ fontSize: 13, fontWeight: 700, color: DK.text, marginBottom: 16,
          display: "flex", alignItems: "center", gap: 8 }}>
          {title}
        </div>
      )}
      {children}
    </div>
  );
}

function DarkTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div style={{ background: "#1e2a3a", border: "1px solid #2d3f52",
      borderRadius: 10, padding: "8px 12px", fontSize: 11, color: "#e2e8f0" }}>
      {label && <p style={{ marginBottom: 4, color: "#94a3b8", fontWeight: 600 }}>{label}</p>}
      {payload.map((p: any, i: number) => (
        <p key={i} style={{ color: p.fill || DK.cyan, margin: "2px 0" }}>
          {p.name}: {fmtShort(p.value)}
        </p>
      ))}
    </div>
  );
}

// ─── Componente principal ────────────────────────────────────────────────────

export default function PainelRP({ externalSheetsUrl }: { externalSheetsUrl?: string } = {}) {
  const [dados, setDados] = useState<LinhaRPNE[]>([]);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [ugFiltro, setUgFiltro] = useState("");
  const [expandidos, setExpandidos] = useState<Set<string>>(new Set());
  const [buscaNE, setBuscaNE] = useState("");
  const [apenasComContrato, setApenasComContrato] = useState(false);
  const [apenasComSaldoALiquidar, setApenasComSaldoALiquidar] = useState(false);
  const [secaoFiltro,       setSecaoFiltro]       = useState("");
  const [pagMap,    setPagMap]    = useState<Map<string, string>>(new Map());
  const [objetoMap, setObjetoMap] = useState<Map<string, string>>(new Map());
  const [isFullscreen, setIsFullscreen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const toggleFullscreen = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    if (!document.fullscreenElement) {
      el.requestFullscreen().then(() => setIsFullscreen(true)).catch(() => setIsFullscreen(true));
    } else {
      document.exitFullscreen().then(() => setIsFullscreen(false)).catch(() => setIsFullscreen(false));
    }
  }, []);

  useEffect(() => {
    const handler = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", handler);
    return () => document.removeEventListener("fullscreenchange", handler);
  }, []);

  // Busca contratos: PAG → numero_contrato e numero_contrato → descricao
  useEffect(() => {
    if (externalSheetsUrl) return;
    supabase
      .from("contratos_scon")
      .select("numero_contrato, pag_nup, descricao")
      .then(({ data }) => {
        if (!data) return;
        const m = new Map<string, string>();
        const o = new Map<string, string>();
        for (const c of data) {
          if (c.pag_nup) m.set(normPag(c.pag_nup), c.numero_contrato ?? "");
          if (c.numero_contrato && c.descricao) o.set(c.numero_contrato, c.descricao);
        }
        setPagMap(m);
        setObjetoMap(o);
      });
  }, []);

  useEffect(() => {
    const url = externalSheetsUrl ?? SHEET_URLS.rpNE;
    fetchCSV(url)
      .then(rows => setDados(toRPNEs(rows)))
      .catch(e => setErro(e.message))
      .finally(() => setLoading(false));
  }, [externalSheetsUrl]);

  const ugsDisponiveis = useMemo(() =>
    [...new Set(dados.map(r => r.ugr_nome).filter(Boolean))].sort(),
  [dados]);

  const filtrado = useMemo(() => {
    let list = ugFiltro ? dados.filter(r => r.ugr_nome === ugFiltro) : dados;
    if (buscaNE.trim()) {
      const q = buscaNE.trim().toLowerCase();
      list = list.filter(r =>
        r.ne.toLowerCase().includes(q) ||
        r.favorecido.toLowerCase().includes(q) ||
        r.processo.toLowerCase().includes(q)
      );
    }
    return list;
  }, [dados, ugFiltro, buscaNE]);

  const totalALiq      = useMemo(() => filtrado.reduce((s, r) => s + r.rp_nao_proc_a_liq,   0), [filtrado]);
  const totalNPLiqPag  = useMemo(() => filtrado.reduce((s, r) => s + r.rp_nao_proc_liq_pag, 0), [filtrado]);
  const totalNPPago    = useMemo(() => filtrado.reduce((s, r) => s + r.rp_nao_proc_pago,    0), [filtrado]);
  const totalProcPagar = useMemo(() => filtrado.reduce((s, r) => s + r.rp_proc_a_pagar,     0), [filtrado]);
  const totalProcPagos = useMemo(() => filtrado.reduce((s, r) => s + r.rp_proc_pagos,       0), [filtrado]);
  const totalPendente    = totalALiq + totalNPLiqPag + totalProcPagar;
  const totalPago        = totalNPPago + totalProcPagos;
  const totalNEsPendentes = useMemo(() =>
    filtrado.filter(r => r.rp_nao_proc_a_liq > 0 || r.rp_nao_proc_liq_pag > 0 || r.rp_proc_a_pagar > 0).length,
  [filtrado]);

  const dadosUGR = useMemo(() => {
    const map = new Map<string, { a_liq: number; liq_pag: number; pago: number; nome: string }>();
    for (const r of filtrado) {
      const ex = map.get(r.ugr_nome) ?? { a_liq: 0, liq_pag: 0, pago: 0, nome: r.ugr_nome };
      ex.a_liq   += r.rp_nao_proc_a_liq;
      ex.liq_pag += r.rp_nao_proc_liq_pag + r.rp_proc_a_pagar;
      ex.pago    += r.rp_nao_proc_pago + r.rp_proc_pagos;
      map.set(r.ugr_nome, ex);
    }
    return Array.from(map.values())
      .map(v => ({ ugr: v.nome, a_liq: v.a_liq, liq_pag: v.liq_pag, pago: v.pago,
                   total: v.a_liq + v.liq_pag + v.pago }))
      .sort((a, b) => b.total - a.total);
  }, [filtrado]);

  // Resolve contrato para cada NE via PAG (processo) → pagMap
  const contratoDeNE = useCallback((r: LinhaRPNE): string => {
    const key = normPag(r.processo);
    if (!key) return "";
    return pagMap.get(key) ?? "";
  }, [pagMap]);

  type Responsavel = { label: string; tipo: "secao" | "objeto" | "nao_encontrado" };

  const RESP_COLORS: Record<string, string> = {
    RANCHO:  "#f59e0b",
    DIE:     "#38bdf8",
    GARAGEM: "#a78bfa",
    DA:      "#4ade80",
    STIC:    "#f472b6",
    SHEE:    "#fb923c",
    GDAAE:   "#e879f9",
    BAMN:    "#34d399",
    SERIPA:  "#60a5fa",
    SEREP:    "#fda4af",
    SERINFRA: "#86efac",
  };

  function detectSecao(text: string, fav = ""): string | null {
    const t = text.toUpperCase();
    const f = fav.toUpperCase();
    if (/SSUB|ALIMENTO|GENERO|ALIMENTA|G[AÁ]S|SUBSIST/.test(t))           return "RANCHO";
    if (/ENERGIA|ELETRIC|ENGENHARI|PREDIAL|\bDIE\b/.test(t) || /ENERGIA|ELETRIC/.test(f)) return "DIE";
    if (/FROTA|VIATURA/.test(t))                                            return "GARAGEM";
    if (/ALMOXARIFADO|JORNAL|CAMPANHA|CORREIO/.test(t))                     return "DA";
    if (/TELEFONIA/.test(t))                                                return "STIC";
    if (/SHEE|HOTEL/.test(t))                                               return "SHEE";
    if (/GDAAE/.test(t))                                                    return "GDAAE";
    if (/BAMN/.test(t))                                                     return "BAMN";
    if (/SERIPA/.test(t))                                                   return "SERIPA";
    if (/SEREP/.test(t))                                                    return "SEREP";
    if (/SRINFRA/.test(t))                                                  return "SERINFRA";
    return null;
  }

  const resolveResponsavel = useCallback((r: LinhaRPNE, contrato: string): Responsavel => {
    // 1. Tenta pela descrição + favorecido da NE
    const secaoNE = detectSecao(r.descricao ?? "", r.favorecido ?? "");
    if (secaoNE) return { label: secaoNE, tipo: "secao" };

    // 2. Tenta pelo objeto do contrato vinculado
    if (contrato) {
      const objeto = objetoMap.get(contrato);
      if (objeto) {
        const secaoObj = detectSecao(objeto);
        if (secaoObj) return { label: secaoObj, tipo: "secao" };
        return { label: objeto, tipo: "objeto" };
      }
    }

    return { label: "Responsável não encontrado", tipo: "nao_encontrado" };
  }, [objetoMap]);

  // Seções disponíveis para o filtro (apenas tipo "secao")
  const secoesDisponiveis = useMemo(() => {
    const set = new Set<string>();
    for (const r of filtrado) {
      const resp = resolveResponsavel(r, contratoDeNE(r));
      if (resp.tipo === "secao") set.add(resp.label);
    }
    return [...set].sort();
  }, [filtrado, contratoDeNE, resolveResponsavel]);

  // NEs ordenadas, com filtros de contrato, seção e saldo a liquidar
  const nesOrdenadas = useMemo(() => {
    const total = (r: LinhaRPNE) =>
      r.rp_nao_proc_a_liq + r.rp_nao_proc_liq_pag + r.rp_nao_proc_pago + r.rp_proc_a_pagar + r.rp_proc_pagos;
    let list = apenasComSaldoALiquidar
      ? [...filtrado].filter(r => r.rp_nao_proc_a_liq > 0).sort((a, b) => b.rp_nao_proc_a_liq - a.rp_nao_proc_a_liq)
      : [...filtrado].sort((a, b) => total(b) - total(a));
    if (apenasComContrato) list = list.filter(r => !!contratoDeNE(r));
    if (secaoFiltro) list = list.filter(r => {
      const resp = resolveResponsavel(r, contratoDeNE(r));
      return resp.label === secaoFiltro;
    });
    return list;
  }, [filtrado, apenasComContrato, apenasComSaldoALiquidar, contratoDeNE, secaoFiltro, resolveResponsavel]);

  function toggleExpand(ne: string) {
    setExpandidos(prev => {
      const next = new Set(prev);
      next.has(ne) ? next.delete(ne) : next.add(ne);
      return next;
    });
  }

  function handleDownloadPDF() {
    const dateStr = new Date().toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" });

    const filtros: string[] = [];
    if (ugFiltro)              filtros.push(`Unidade: ${ugFiltro}`);
    if (buscaNE.trim())        filtros.push(`Busca: "${buscaNE.trim()}"`);
    if (secaoFiltro)           filtros.push(`Seção: ${secaoFiltro}`);
    if (apenasComContrato)     filtros.push("Apenas com contrato");
    if (apenasComSaldoALiquidar) filtros.push("Apenas com saldo a liquidar");

    const totalGeral = totalALiq + totalNPLiqPag + totalNPPago + totalProcPagar + totalProcPagos;

    const linhasHTML = nesOrdenadas.map(r => {
      const tot = r.rp_nao_proc_a_liq + r.rp_nao_proc_liq_pag + r.rp_nao_proc_pago + r.rp_proc_a_pagar + r.rp_proc_pagos;
      const contrato = contratoDeNE(r);
      const resp = resolveResponsavel(r, contrato);
      const fmt = (v: number) => v > 0 ? fmtMoney(v) : "–";

      const detItens: string[] = [];
      if (r.favorecido) detItens.push(`<div class="det-item"><span class="det-label">Favorecido:</span> ${r.favorecido}</div>`);
      if (r.processo)   detItens.push(`<div class="det-item"><span class="det-label">Processo:</span> ${r.processo}</div>`);
      if (r.descricao)  detItens.push(`<div class="det-item" style="flex:1 1 100%"><span class="det-label">Descrição:</span> ${r.descricao}</div>`);
      const detRow = detItens.length > 0
        ? `<tr class="det-row"><td></td><td colspan="7"><div class="det-grid">${detItens.join("")}</div></td></tr>`
        : "";

      return `<tr class="main-row">
        <td>${r.ne}</td>
        <td>${r.ugr_nome}</td>
        <td class="mono">${contrato || "–"}</td>
        <td>${resp.label}</td>
        <td class="num">${fmt(r.rp_nao_proc_a_liq)}</td>
        <td class="num">${fmt(r.rp_nao_proc_liq_pag)}</td>
        <td class="num">${fmt(r.rp_proc_a_pagar)}</td>
        <td class="num bold">${fmtMoney(tot)}</td>
      </tr>${detRow}`;
    }).join("");

    const html = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<title>Restos a Pagar — NEs</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: Arial, sans-serif; font-size: 10px; color: #111; padding: 20px 24px; }
  h1 { font-size: 15px; font-weight: 700; margin-bottom: 3px; color: #1e293b; }
  .meta { color: #64748b; font-size: 9px; margin-bottom: 12px; }
  .filtros { background: #f1f5f9; border-left: 3px solid #0284c7; padding: 6px 10px;
    border-radius: 4px; margin-bottom: 12px; font-size: 9px; color: #334155; }
  .filtros strong { color: #0f172a; }
  .kpis { display: flex; gap: 10px; margin-bottom: 14px; flex-wrap: wrap; }
  .kpi { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 6px; padding: 7px 12px; min-width: 130px; }
  .kpi-label { font-size: 8px; text-transform: uppercase; letter-spacing: .06em; color: #94a3b8; font-weight: 700; }
  .kpi-value { font-size: 12px; font-weight: 800; color: #1e293b; margin-top: 3px; }
  .kpi-value.amber { color: #d97706; }
  .kpi-value.indigo { color: #4f46e5; }
  .kpi-value.green  { color: #16a34a; }
  .kpi-value.cyan   { color: #0891b2; }
  table { width: 100%; border-collapse: collapse; font-size: 9px; margin-top: 4px; }
  thead tr { background: #1e293b; }
  th { color: #e2e8f0; padding: 6px 8px; text-align: left; font-size: 8px;
    text-transform: uppercase; letter-spacing: .05em; font-weight: 700; white-space: nowrap; }
  th.num { text-align: right; }
  td { padding: 5px 8px; border-bottom: 1px solid #f1f5f9; vertical-align: top; }
  td.num { text-align: right; font-family: monospace; white-space: nowrap; }
  td.mono { font-family: monospace; font-size: 9px; }
  td.bold { font-weight: 700; }
  tr.main-row:nth-child(4n+1) td, tr.main-row:nth-child(4n+2) td { background: #f8fafc; }
  tr.det-row td { border-bottom: 1px solid #e5e7eb; padding: 2px 8px 8px; background: inherit; }
  .det-grid { display: flex; flex-wrap: wrap; gap: 2px 24px; font-size: 8px; color: #475569; padding-left: 4px; border-left: 2px solid #cbd5e1; }
  .det-item { line-height: 1.6; }
  .det-label { font-weight: 700; color: #334155; }
  tfoot td { border-top: 2px solid #1e293b; font-weight: 700; background: #f1f5f9; }
  @media print {
    body { padding: 10px 12px; }
    @page { margin: 12mm; size: A4 landscape; }
  }
</style>
</head>
<body>
  <h1>Restos a Pagar — Notas de Empenho</h1>
  <div class="meta">GAP-MN e subordinadas &nbsp;·&nbsp; Gerado em ${dateStr} &nbsp;·&nbsp; ${nesOrdenadas.length} NEs exibidas</div>

  ${filtros.length ? `<div class="filtros"><strong>Filtros ativos:</strong> ${filtros.join(" &nbsp;·&nbsp; ")}</div>` : ""}

  <div class="kpis">
    <div class="kpi"><div class="kpi-label">RP A Liquidar</div><div class="kpi-value amber">${fmtMoney(totalALiq)}</div></div>
    <div class="kpi"><div class="kpi-label">Liq. A Pagar</div><div class="kpi-value indigo">${fmtMoney(totalNPLiqPag)}</div></div>
    <div class="kpi"><div class="kpi-label">Proc. A Pagar</div><div class="kpi-value green">${fmtMoney(totalProcPagar)}</div></div>
    <div class="kpi"><div class="kpi-label">Total Pendente</div><div class="kpi-value cyan">${fmtMoney(totalPendente)}</div></div>
    <div class="kpi"><div class="kpi-label">Pago</div><div class="kpi-value">${fmtMoney(totalPago)}</div></div>
    <div class="kpi"><div class="kpi-label">Total Geral</div><div class="kpi-value">${fmtMoney(totalGeral)}</div></div>
  </div>

  <table>
    <thead>
      <tr>
        <th>NE SIAFI</th>
        <th>Unidade</th>
        <th>Contrato</th>
        <th>Responsável</th>
        <th class="num">RP A Liq.</th>
        <th class="num">Liq/Pagar</th>
        <th class="num">Proc. A Pagar</th>
        <th class="num">Total</th>
      </tr>
    </thead>
    <tbody>${linhasHTML}</tbody>
    <tfoot>
      <tr>
        <td colspan="4">Total (${nesOrdenadas.length} NEs)</td>
        <td class="num">${fmtMoney(totalALiq)}</td>
        <td class="num">${fmtMoney(totalNPLiqPag)}</td>
        <td class="num">${fmtMoney(totalProcPagar)}</td>
        <td class="num">${fmtMoney(totalGeral)}</td>
      </tr>
    </tfoot>
  </table>
</body>
</html>`;

    const win = window.open("", "_blank");
    if (!win) { alert("Permita pop-ups para gerar o PDF."); return; }
    win.document.write(html);
    win.document.close();
    win.focus();
    setTimeout(() => { win.print(); }, 400);
  }

  if (loading) return (
    <div style={{ background: DK.bg, borderRadius: 16, padding: 48, textAlign: "center", color: DK.muted }}>
      Carregando dados de Restos a Pagar…
    </div>
  );

  if (erro) return (
    <div style={{ background: DK.bg, borderRadius: 16, padding: 24, color: DK.red }}>
      Erro ao carregar planilha: {erro}
    </div>
  );

  return (
    <div
      ref={containerRef}
      style={{
        background: DK.bg, borderRadius: 16, padding: 24,
        display: "flex", flexDirection: "column", gap: 20,
        ...(isFullscreen ? { overflowY: "auto", height: "100vh", boxSizing: "border-box" } : {}),
        ...(!document.fullscreenElement && isFullscreen ? { position: "fixed", inset: 0, zIndex: 9999, borderRadius: 0 } : {}),
      }}
    >

      {/* ── Filtros ── */}
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
        <select
          value={ugFiltro}
          onChange={e => setUgFiltro(e.target.value)}
          style={{ background: DK.card, border: `1px solid ${DK.cardBorder}`, borderRadius: 10,
            color: ugFiltro ? DK.cyan : DK.muted, padding: "7px 12px", fontSize: 12, outline: "none", minWidth: 240 }}
        >
          <option value="">Todas as Unidades</option>
          {ugsDisponiveis.map(ug => (
            <option key={ug} value={ug}>{ug}</option>
          ))}
        </select>

        <input
          value={buscaNE}
          onChange={e => setBuscaNE(e.target.value)}
          placeholder="Buscar NE, fornecedor ou processo…"
          style={{ background: DK.card, border: `1px solid ${DK.cardBorder}`, borderRadius: 10,
            color: DK.text, padding: "7px 12px", fontSize: 12, outline: "none", flex: 1, minWidth: 220 }}
        />

        <select
          value={secaoFiltro}
          onChange={e => setSecaoFiltro(e.target.value)}
          style={{ background: DK.card, border: `1px solid ${DK.cardBorder}`, borderRadius: 10,
            color: secaoFiltro ? DK.cyan : DK.muted, padding: "7px 12px", fontSize: 12,
            outline: "none", minWidth: 160 }}
        >
          <option value="">Todas as seções</option>
          {secoesDisponiveis.map(s => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>

        {(ugFiltro || buscaNE || secaoFiltro) && (
          <button
            onClick={() => { setUgFiltro(""); setBuscaNE(""); setSecaoFiltro(""); }}
            style={{ background: "transparent", border: `1px solid ${DK.dim}`, borderRadius: 10,
              color: DK.muted, padding: "7px 12px", fontSize: 12, cursor: "pointer" }}
          >
            ✕ Limpar
          </button>
        )}

        <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12,
          color: apenasComContrato ? DK.teal : DK.muted, cursor: "pointer", userSelect: "none" }}>
          <input
            type="checkbox"
            checked={apenasComContrato}
            onChange={e => setApenasComContrato(e.target.checked)}
            style={{ accentColor: DK.teal, width: 14, height: 14 }}
          />
          Apenas com contrato
        </label>

        <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12,
          color: apenasComSaldoALiquidar ? DK.amber : DK.muted, cursor: "pointer", userSelect: "none" }}>
          <input
            type="checkbox"
            checked={apenasComSaldoALiquidar}
            onChange={e => setApenasComSaldoALiquidar(e.target.checked)}
            style={{ accentColor: DK.amber, width: 14, height: 14 }}
          />
          Saldo a liquidar
        </label>

        <span style={{ fontSize: 11, color: DK.muted, marginLeft: "auto" }}>
          {nesOrdenadas.length} NEs
        </span>

        <button
          onClick={handleDownloadPDF}
          disabled={nesOrdenadas.length === 0}
          title="Baixar relatório em PDF"
          style={{
            background: nesOrdenadas.length === 0 ? "transparent" : "#b45309",
            border: `1px solid ${nesOrdenadas.length === 0 ? DK.dim : "#b45309"}`,
            borderRadius: 10, color: nesOrdenadas.length === 0 ? DK.dim : "#fff",
            padding: "7px 12px", fontSize: 12, cursor: nesOrdenadas.length === 0 ? "default" : "pointer",
            fontWeight: 600, display: "flex", alignItems: "center", gap: 5,
          }}
        >
          ⬇ PDF
        </button>

        <button
          onClick={toggleFullscreen}
          title={isFullscreen ? "Restaurar" : "Expandir em tela cheia"}
          style={{ background: "transparent", border: `1px solid ${DK.dim}`, borderRadius: 10,
            color: DK.muted, padding: "7px 12px", fontSize: 13, cursor: "pointer" }}
        >
          {isFullscreen ? "⊠" : "⛶"}
        </button>
      </div>

      {/* ── KPIs ── */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: 16 }}>
        <KpiCard label="RP A LIQUIDAR"          value={fmtMoney(totalALiq)}      accent={DK.amber}   />
        <KpiCard label="RP LIQUIDADO A PAGAR"   value={fmtMoney(totalNPLiqPag)}  accent="#818cf8"    />
        <KpiCard label="RP PROCESSADO"          value={fmtMoney(totalProcPagar)} accent={DK.green}   />
        <KpiCard label="TOTAL"                  value={fmtMoney(totalPendente)}  accent={DK.cyan}    />
        <KpiCard label="RP PAGO"                value={fmtMoney(totalPago)}      accent={DK.teal}    />
        <KpiCard label="NOTAS DE EMPENHO PENDENTES" value={String(totalNEsPendentes)} accent={DK.purple} />
      </div>

      {/* ── Gráfico por UGR ── */}
      {dadosUGR.length > 0 && (
        <DarkCard title="Restos a Pagar por Unidade">
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24 }}>

            {/* Gráfico de barras */}
            <ResponsiveContainer width="100%" height={Math.max(200, dadosUGR.length * 48)}>
              <BarChart data={dadosUGR} layout="vertical"
                margin={{ top: 4, right: 12, left: 4, bottom: 4 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={DK.grid} vertical horizontal={false} />
                <XAxis type="number" tick={{ fontSize: 10, fill: DK.muted }} axisLine={false} tickLine={false}
                  tickFormatter={v => fmtShort(v)} />
                <YAxis type="category" dataKey="ugr" width={110}
                  tick={{ fontSize: 10, fill: DK.text }}
                  tickFormatter={v => truncate(v, 18)}
                  axisLine={false} tickLine={false} />
                <ChartTooltip content={<DarkTooltip />} cursor={{ fill: `${DK.cyan}10` }} />
                <Legend
                  formatter={(v) => <span style={{ color: DK.muted, fontSize: 11 }}>{v}</span>}
                  wrapperStyle={{ paddingTop: 8 }}
                />
                <Bar dataKey="a_liq"   name="A Liquidar"  stackId="a" fill={DK.amber}  radius={[0, 0, 0, 0]} />
                <Bar dataKey="liq_pag" name="Liq/Pagar"   stackId="a" fill="#818cf8"   radius={[0, 0, 0, 0]} />
                <Bar dataKey="pago"    name="Pago"         stackId="a" fill={DK.green}  radius={[0, 6, 6, 0]} />
              </BarChart>
            </ResponsiveContainer>

            {/* Tabela por UGR */}
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                <thead>
                  <tr style={{ borderBottom: `1px solid ${DK.dim}` }}>
                    {["Unidade", "A Liq.", "Liq/Pagar", "Pago", "Total"].map(h => (
                      <th key={h} style={{ padding: "6px 10px", textAlign: h === "Unidade" ? "left" : "right",
                        fontSize: 10, fontWeight: 700, textTransform: "uppercase",
                        letterSpacing: "0.06em", color: DK.muted }}>
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {dadosUGR.map((row, i) => {
                    const corNome = [DK.cyan, DK.teal, DK.purple, DK.pink, DK.amber, DK.green, DK.red][i % 7];
                    return (
                      <tr key={row.ugr} style={{ borderBottom: `1px solid ${DK.grid}` }}>
                        <td style={{ padding: "8px 10px", color: corNome, fontWeight: 600, fontSize: 11 }}>
                          {truncate(row.ugr, 22)}
                        </td>
                        <td style={{ padding: "8px 10px", textAlign: "right", fontFamily: "monospace",
                          color: DK.amber, fontSize: 11 }}>{fmtShort(row.a_liq)}</td>
                        <td style={{ padding: "8px 10px", textAlign: "right", fontFamily: "monospace",
                          color: "#818cf8", fontSize: 11 }}>{fmtShort(row.liq_pag)}</td>
                        <td style={{ padding: "8px 10px", textAlign: "right", fontFamily: "monospace",
                          color: DK.green, fontSize: 11 }}>{fmtShort(row.pago)}</td>
                        <td style={{ padding: "8px 10px", textAlign: "right", fontFamily: "monospace",
                          color: DK.text, fontWeight: 700, fontSize: 11 }}>{fmtShort(row.total)}</td>
                      </tr>
                    );
                  })}
                  <tr style={{ borderTop: `2px solid ${DK.dim}` }}>
                    <td style={{ padding: "10px", fontWeight: 700, color: DK.text }}>Total</td>
                    <td style={{ padding: "10px", textAlign: "right", fontWeight: 700,
                      color: DK.amber, fontFamily: "monospace" }}>{fmtShort(totalALiq)}</td>
                    <td style={{ padding: "10px", textAlign: "right", fontWeight: 700,
                      color: "#818cf8", fontFamily: "monospace" }}>{fmtShort(totalNPLiqPag + totalProcPagar)}</td>
                    <td style={{ padding: "10px", textAlign: "right", fontWeight: 700,
                      color: DK.green, fontFamily: "monospace" }}>{fmtShort(totalPago)}</td>
                    <td style={{ padding: "10px", textAlign: "right", fontWeight: 700,
                      color: DK.text, fontFamily: "monospace" }}>{fmtShort(totalALiq + totalNPLiqPag + totalNPPago + totalProcPagar + totalProcPagos)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </DarkCard>
      )}

      {/* ── Tabela de NEs ── */}
      <DarkCard title={`Notas de Empenho em RP (${nesOrdenadas.length})`}>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
            <thead>
              <tr style={{ borderBottom: `1px solid ${DK.dim}` }}>
                {[
                  { h: "",              align: "left"  },
                  { h: "NE SIAFI",      align: "left"  },
                  { h: "Unidade",       align: "left"  },
                  { h: "Contrato",      align: "left"  },
                  { h: "Responsável",   align: "left"  },
                  { h: "RP A Liq.",     align: "right", color: DK.amber  },
                  { h: "RP Liq/Pagar",  align: "right", color: "#818cf8" },
                  { h: "RP NP Pago",    align: "right", color: DK.teal   },
                  { h: "Proc. A Pagar", align: "right", color: DK.green  },
                  { h: "Proc. Pagos",   align: "right", color: "#34d399" },
                  { h: "Total",         align: "right", color: DK.text   },
                ].map((col, i) => (
                  <th key={i} style={{
                    padding: "7px 8px",
                    textAlign: col.align as "left" | "right",
                    fontSize: 9, fontWeight: 700, textTransform: "uppercase",
                    letterSpacing: "0.06em", color: col.color ?? DK.muted, whiteSpace: "nowrap",
                  }}>
                    {col.h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {nesOrdenadas.map(r => {
                const key = `${r.ugr_code}-${r.ne}`;
                const isExp = expandidos.has(key);
                const total = r.rp_nao_proc_a_liq + r.rp_nao_proc_liq_pag + r.rp_nao_proc_pago + r.rp_proc_a_pagar + r.rp_proc_pagos;
                const cell = (v: number, color: string) => (
                  <td style={{ padding: "7px 8px", textAlign: "right", fontFamily: "monospace",
                    color: v > 0 ? color : DK.dim, whiteSpace: "nowrap", fontSize: 11 }}>
                    {v > 0 ? fmtMoney(v) : "–"}
                  </td>
                );
                return (
                  <>
                    <tr
                      key={key}
                      onClick={() => (r.favorecido || r.descricao || r.processo) && toggleExpand(key)}
                      style={{
                        borderBottom: `1px solid ${DK.grid}`,
                        cursor: (r.favorecido || r.descricao || r.processo) ? "pointer" : "default",
                        background: isExp ? `${DK.cyan}08` : "transparent",
                      }}
                    >
                      <td style={{ padding: "7px 6px", color: DK.muted, fontSize: 10, width: 20 }}>
                        {(r.favorecido || r.descricao || r.processo) ? (isExp ? "▲" : "▶") : ""}
                      </td>
                      <td style={{ padding: "7px 8px", fontFamily: "monospace", fontWeight: 600,
                        color: DK.cyan, whiteSpace: "nowrap" }}>
                        {r.ne}
                      </td>
                      <td style={{ padding: "7px 8px", color: DK.text, fontSize: 11 }}>
                        {truncate(r.ugr_nome, 24)}
                      </td>
                      <td style={{ padding: "7px 8px", fontSize: 11, whiteSpace: "nowrap" }}>
                        {(() => { const c = contratoDeNE(r); return c
                          ? <span style={{ color: DK.teal, fontFamily: "monospace", fontWeight: 600 }}>{c}</span>
                          : <span style={{ color: DK.dim }}>–</span>;
                        })()}
                      </td>
                      {(() => {
                        const contrato = contratoDeNE(r);
                        const resp = resolveResponsavel(r, contrato);
                        if (resp.tipo === "secao") {
                          const cor = RESP_COLORS[resp.label] ?? DK.cyan;
                          return (
                            <td style={{ padding: "7px 8px", fontSize: 11, whiteSpace: "nowrap" }}>
                              <span style={{
                                background: `${cor}22`, border: `1px solid ${cor}55`,
                                color: cor, borderRadius: 6, padding: "2px 8px",
                                fontWeight: 700, fontSize: 10, letterSpacing: "0.05em",
                              }}>
                                {resp.label}
                              </span>
                            </td>
                          );
                        }
                        if (resp.tipo === "objeto") {
                          return (
                            <td style={{ padding: "7px 8px", fontSize: 10, color: DK.muted, maxWidth: 220 }}
                              title={resp.label}>
                              {resp.label.length > 60 ? resp.label.slice(0, 60) + "…" : resp.label}
                            </td>
                          );
                        }
                        return (
                          <td style={{ padding: "7px 8px", fontSize: 10, color: DK.dim, fontStyle: "italic" }}>
                            Não encontrado
                          </td>
                        );
                      })()}
                      {cell(r.rp_nao_proc_a_liq,   DK.amber)}
                      {cell(r.rp_nao_proc_liq_pag,  "#818cf8")}
                      {cell(r.rp_nao_proc_pago,     DK.teal)}
                      {cell(r.rp_proc_a_pagar,      DK.green)}
                      {cell(r.rp_proc_pagos,        "#34d399")}
                      <td style={{ padding: "7px 8px", textAlign: "right", fontFamily: "monospace",
                        fontWeight: 700, color: DK.text, whiteSpace: "nowrap", fontSize: 11 }}>
                        {fmtMoney(total)}
                      </td>
                    </tr>

                    {isExp && (
                      <tr key={`${key}-exp`} style={{ background: `${DK.cyan}06` }}>
                        <td />
                        <td colSpan={10} style={{ padding: "10px 14px 14px" }}>
                          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
                            gap: "8px 20px", fontSize: 11 }}>
                            {r.favorecido && (
                              <div>
                                <span style={{ color: DK.muted, fontWeight: 600 }}>Favorecido: </span>
                                <span style={{ color: DK.text }}>{r.favorecido}</span>
                              </div>
                            )}
                            {r.processo && (
                              <div>
                                <span style={{ color: DK.muted, fontWeight: 600 }}>Processo: </span>
                                <span style={{ color: DK.teal, fontFamily: "monospace" }}>{r.processo}</span>
                              </div>
                            )}
                            {r.descricao && (
                              <div style={{ gridColumn: "1 / -1" }}>
                                <span style={{ color: DK.muted, fontWeight: 600 }}>Descrição: </span>
                                <span style={{ color: DK.text }}>{r.descricao}</span>
                              </div>
                            )}
                            <div>
                              <span style={{ color: DK.muted, fontWeight: 600 }}>Unidade: </span>
                              <span style={{ color: DK.text }}>{r.ugr_nome}</span>
                            </div>
                            {r.ugr_code && (
                              <div>
                                <span style={{ color: DK.muted, fontWeight: 600 }}>Código UGR: </span>
                                <span style={{ color: DK.text, fontFamily: "monospace" }}>{r.ugr_code}</span>
                              </div>
                            )}
                          </div>
                        </td>
                      </tr>
                    )}
                  </>
                );
              })}
            </tbody>
          </table>
        </div>
      </DarkCard>
    </div>
  );
}
