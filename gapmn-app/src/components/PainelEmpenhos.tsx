import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { supabase } from "../lib/supabase";
import { fetchCSV, SHEET_URLS, EmpenhoNF, toEmpenhosNF } from "../lib/gsheets";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip as ChartTooltip, ResponsiveContainer, Cell,
} from "recharts";

// ─── Design tokens ────────────────────────────────────────────────────────────
const DK = {
  bg:         "#0d1117",
  card:       "#161b27",
  cardBorder: "#1e2a3a",
  text:       "#e2e8f0",
  muted:      "#64748b",
  dim:        "#334155",
  grid:       "#1e2a3a",
  cyan:       "#22d3ee",
  teal:       "#2dd4bf",
  green:      "#4ade80",
  purple:     "#a78bfa",
  amber:      "#fbbf24",
  red:        "#f87171",
  pink:       "#f472b6",
};

const COLORS = [DK.cyan, DK.teal, DK.purple, DK.amber, DK.green, DK.red, DK.pink];

// ─── Helpers ──────────────────────────────────────────────────────────────────
const fmtMoney = (v: number) =>
  v.toLocaleString("pt-BR", { style: "currency", currency: "BRL", minimumFractionDigits: 2 });

function fmtShort(v: number) {
  if (Math.abs(v) >= 1_000_000) return `R$ ${(v / 1_000_000).toFixed(1).replace(".", ",")}M`;
  if (Math.abs(v) >= 1_000)     return `R$ ${(v / 1_000).toFixed(0)}K`;
  return fmtMoney(v);
}

// Quebra o nome em até 2 linhas para o YAxis do gráfico
function WrappedTick({ x, y, payload }: any) {
  const words: string[] = (payload.value as string).split(" ");
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    const test = cur ? `${cur} ${w}` : w;
    if (test.length <= 17) { cur = test; }
    else { if (cur) lines.push(cur); cur = w; }
  }
  if (cur) lines.push(cur);
  const display = lines.slice(0, 2);
  if (lines.length > 2) display[1] = display[1].slice(0, 15) + "…";
  const lh = 13;
  const offset = ((display.length - 1) * lh) / 2;
  return (
    <g transform={`translate(${x},${y})`}>
      {display.map((line, i) => (
        <text key={i} x={-4} y={i * lh - offset} textAnchor="end"
          fill={DK.text} fontSize={10} dominantBaseline="middle">{line}</text>
      ))}
    </g>
  );
}

// ─── Sub-componentes ──────────────────────────────────────────────────────────
function KpiCard({ label, value, sub, icon, accent = DK.cyan }: {
  label: string; value: string | number; sub?: string; icon: string; accent?: string;
}) {
  return (
    <div style={{
      background: DK.card, border: `1px solid ${DK.cardBorder}`,
      borderRadius: 16, padding: "18px 20px", position: "relative", overflow: "hidden",
    }}>
      <div style={{
        position: "absolute", top: 0, left: 0, right: 0, height: 3,
        background: `linear-gradient(90deg, ${accent}00, ${accent}, ${accent}00)`,
      }} />
      <div style={{
        fontSize: 10, fontWeight: 700, textTransform: "uppercase",
        letterSpacing: "0.08em", color: DK.muted,
        display: "flex", alignItems: "center", gap: 5,
      }}>
        <span style={{ fontSize: 14 }}>{icon}</span> {label}
      </div>
      <div style={{ marginTop: 10, fontSize: 26, fontWeight: 800, color: accent, lineHeight: 1 }}>
        {value}
      </div>
      {sub && <div style={{ marginTop: 4, fontSize: 11, color: DK.muted }}>{sub}</div>}
    </div>
  );
}

function DarkTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div style={{
      background: "#1e2a3a", border: "1px solid #2d3f52",
      borderRadius: 10, padding: "8px 12px", fontSize: 11, color: DK.text,
    }}>
      {label && <p style={{ marginBottom: 4, color: "#94a3b8", fontWeight: 600 }}>{label}</p>}
      {payload.map((p: any, i: number) => (
        <p key={i} style={{ color: p.fill || DK.cyan, margin: "2px 0" }}>
          {p.name}: {typeof p.value === "number" && p.name !== "NEs" ? fmtShort(p.value) : p.value}
        </p>
      ))}
    </div>
  );
}

// ─── Tipos ────────────────────────────────────────────────────────────────────
interface SeSol {
  solicitacao: string;
  ug_cred:     string | null;
  observacao:  string | null;
  status:      string | null;
  ne_manual:   string | null;
}

interface NeIdent {
  ne_siafi:   string;
  solicitacao: string | null;
}

interface Props {
  onNavigateToEmpenhos?: () => void;
}

// ─── Componente principal ─────────────────────────────────────────────────────
export default function PainelEmpenhos({ onNavigateToEmpenhos }: Props) {
  const [empenhos,     setEmpenhos]     = useState<EmpenhoNF[]>([]);
  const [solicitacoes, setSolicitacoes] = useState<SeSol[]>([]);
  const [neIdents,     setNeIdents]     = useState<NeIdent[]>([]);
  const [loading,      setLoading]      = useState(true);
  const [busca,        setBusca]        = useState("");
  const [ugrFiltro,    setUgrFiltro]    = useState("");
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

  useEffect(() => {
    (async () => {
      setLoading(true);
      const [rows, { data: sols }, { data: neis }] = await Promise.all([
        fetchCSV(SHEET_URLS.empenhosNF).catch(() => [] as string[][]),
        supabase.from("siloms_solicitacoes").select("solicitacao,ug_cred,observacao,status,ne_manual").limit(2000),
        supabase.from("siloms_ne_identificadores").select("ne_siafi,solicitacao").limit(5000),
      ]);
      setEmpenhos(toEmpenhosNF(rows));
      if (sols) setSolicitacoes(sols as SeSol[]);
      if (neis) setNeIdents(neis as NeIdent[]);
      setLoading(false);
    })();
  }, []);

  // ─── KPIs: agrupa por NE SIAFI para detectar originais vs reforços/anulações ─
  const kpis = useMemo(() => {
    const neMap = new Map<string, EmpenhoNF[]>();
    for (const e of empenhos) {
      const k = e.nota_empenho.toUpperCase();
      if (!neMap.has(k)) neMap.set(k, []);
      neMap.get(k)!.push(e);
    }
    let primeiros = neMap.size;
    let reforcosP = 0, anulacoes = 0;
    for (const rows of neMap.values()) {
      for (let i = 1; i < rows.length; i++) {
        if (rows[i].valor < 0) anulacoes++;
        else reforcosP++;
      }
    }
    const valorTotal = empenhos.reduce((s, e) => s + e.valor, 0);
    return { total: primeiros + reforcosP + anulacoes, primeiros, reforcosP, anulacoes, valorTotal };
  }, [empenhos]);

  // ─── Charts ───────────────────────────────────────────────────────────────────
  const dadosValorUGR = useMemo(() => {
    const map = new Map<string, number>();
    for (const e of empenhos) {
      const ugr = e.ugr || "–";
      map.set(ugr, (map.get(ugr) ?? 0) + e.valor);
    }
    return [...map.entries()]
      .map(([ugr, valor]) => ({ ugr, valor }))
      .sort((a, b) => b.valor - a.valor)
      .slice(0, 10);
  }, [empenhos]);

  const dadosQtyUGR = useMemo(() => {
    const map = new Map<string, number>();
    for (const e of empenhos) {
      const ugr = e.ugr || "–";
      map.set(ugr, (map.get(ugr) ?? 0) + 1);
    }
    return [...map.entries()]
      .map(([ugr, qty]) => ({ ugr, qty }))
      .sort((a, b) => b.qty - a.qty)
      .slice(0, 10);
  }, [empenhos]);

  // ─── Pendentes ────────────────────────────────────────────────────────────────
  const planilhaSols = useMemo(() =>
    new Set(empenhos.map(e => (e.solicitacao ?? "").toUpperCase()).filter(Boolean)),
    [empenhos],
  );

  // SEs que têm NE vinculada via SILOMS Leitor E confirmada na planilha
  const solsComNEConfirmada = useMemo(() => {
    const planilhaNEs = new Set(empenhos.map(e => e.nota_empenho.toUpperCase()));
    return new Set(
      neIdents
        .filter(n => n.solicitacao && planilhaNEs.has(n.ne_siafi.toUpperCase()))
        .map(n => n.solicitacao!.toUpperCase())
    );
  }, [empenhos, neIdents]);

  const pendentes = useMemo(() =>
    solicitacoes.filter(s => {
      if (s.ne_manual) return false;
      if (planilhaSols.has(s.solicitacao.toUpperCase())) return false;
      if (solsComNEConfirmada.has(s.solicitacao.toUpperCase())) return false;
      return !!s.status;   // empenho_realizado=true (marcado manualmente) não aparece aqui
    }),
    [solicitacoes, planilhaSols, solsComNEConfirmada],
  );

  const ugrsUnicas = useMemo(() =>
    [...new Set(pendentes.map(s => s.ug_cred ?? "").filter(Boolean))].sort(),
    [pendentes],
  );

  const pendentesFiltradas = useMemo(() => {
    const q = busca.trim().toUpperCase();
    return pendentes.filter(s => {
      if (ugrFiltro && (s.ug_cred ?? "") !== ugrFiltro) return false;
      if (q && !s.solicitacao.toUpperCase().includes(q) && !(s.ug_cred ?? "").toUpperCase().includes(q)) return false;
      return true;
    });
  }, [pendentes, busca, ugrFiltro]);

  // ─── Render ───────────────────────────────────────────────────────────────────
  if (loading) return (
    <div style={{ background: DK.bg, borderRadius: 16, padding: 48, textAlign: "center", color: DK.muted, fontFamily: "Inter,sans-serif" }}>
      Carregando dados de empenhos…
    </div>
  );

  const chartH = Math.max(200, dadosValorUGR.length * 36);

  return (
    <div
      ref={containerRef}
      style={{
        background: DK.bg, borderRadius: 16, padding: 24,
        display: "flex", flexDirection: "column", gap: 20,
        fontFamily: "Inter,sans-serif", color: DK.text,
        ...(isFullscreen ? { overflowY: "auto", height: "100vh", boxSizing: "border-box" as const } : {}),
      }}
    >

      {/* ── Header ── */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 10 }}>
        <div>
          <div style={{ fontSize: 17, fontWeight: 700, color: DK.text }}>💵 Painel de Empenhos</div>
          <div style={{ fontSize: 12, color: DK.muted, marginTop: 2 }}>Planilha NE SIAFI · Exercício 2026</div>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          {onNavigateToEmpenhos && (
            <button onClick={onNavigateToEmpenhos} style={{
              background: "rgba(34,211,238,0.08)", border: "1px solid rgba(34,211,238,0.25)",
              borderRadius: 10, padding: "7px 14px", fontSize: 12, color: DK.cyan,
              cursor: "pointer", fontWeight: 600,
            }}>
              📋 Notas de Empenho Emitidas →
            </button>
          )}
          <button onClick={toggleFullscreen} style={{
            background: DK.card, border: `1px solid ${DK.cardBorder}`,
            borderRadius: 10, padding: "7px 12px", fontSize: 13, color: DK.muted,
            cursor: "pointer",
          }}>
            {isFullscreen ? "⊡" : "⛶"}
          </button>
        </div>
      </div>

      {/* ── KPI Cards ── */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(170px, 1fr))", gap: 12 }}>
        <KpiCard icon="" label="Total de NEs" value={kpis.total} accent={DK.cyan}
          sub="" />
        <KpiCard icon="" label="Primeiros Empenhos" value={kpis.primeiros} accent={DK.teal}
          sub="" />
        <KpiCard icon="" label="Reforços" value={kpis.reforcosP} accent={DK.green}
          sub="" />
        <KpiCard icon="" label="Anulações" value={kpis.anulacoes} accent={DK.red}
          sub="" />
        <KpiCard icon="💰" label="Valor Total Empenhado" value={fmtShort(kpis.valorTotal)} accent={DK.amber}
          sub={fmtMoney(kpis.valorTotal)} />
      </div>

      {/* ── Gráficos ── */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>

        {/* Valor por UGR */}
        <div style={{ background: DK.card, border: `1px solid ${DK.cardBorder}`, borderRadius: 16, padding: "20px 20px 12px" }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: DK.text, marginBottom: 16 }}>Valor Empenhado por UGR</div>
          <ResponsiveContainer width="100%" height={chartH}>
            <BarChart data={dadosValorUGR} layout="vertical" margin={{ left: 0, right: 28, top: 0, bottom: 0 }}>
              <CartesianGrid horizontal={false} stroke={DK.grid} />
              <XAxis type="number" tick={{ fill: DK.muted, fontSize: 10 }}
                tickFormatter={v => fmtShort(v as number)} />
              <YAxis type="category" dataKey="ugr" tick={<WrappedTick />} width={140} />
              <ChartTooltip content={<DarkTooltip />} />
              <Bar dataKey="valor" name="Valor" radius={[0, 4, 4, 0]}>
                {dadosValorUGR.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* Quantidade por UGR */}
        <div style={{ background: DK.card, border: `1px solid ${DK.cardBorder}`, borderRadius: 16, padding: "20px 20px 12px" }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: DK.text, marginBottom: 16 }}>Quantidade de NEs por UGR</div>
          <ResponsiveContainer width="100%" height={chartH}>
            <BarChart data={dadosQtyUGR} layout="vertical" margin={{ left: 0, right: 28, top: 0, bottom: 0 }}>
              <CartesianGrid horizontal={false} stroke={DK.grid} />
              <XAxis type="number" allowDecimals={false} tick={{ fill: DK.muted, fontSize: 10 }} />
              <YAxis type="category" dataKey="ugr" tick={<WrappedTick />} width={140} />
              <ChartTooltip content={<DarkTooltip />} />
              <Bar dataKey="qty" name="NEs" radius={[0, 4, 4, 0]}>
                {dadosQtyUGR.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>

      </div>

      {/* ── Solicitações Pendentes ── */}
      <div style={{ background: DK.card, border: `1px solid ${DK.cardBorder}`, borderRadius: 16, padding: "20px 24px" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16, flexWrap: "wrap", gap: 10 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ fontSize: 13, fontWeight: 700, color: DK.text }}>📋 Solicitações Pendentes</span>
            <span style={{
              background: "rgba(251,191,36,0.15)", color: DK.amber, fontSize: 10, fontWeight: 700,
              borderRadius: 20, padding: "2px 8px", border: "1px solid rgba(251,191,36,0.3)",
            }}>
              {pendentesFiltradas.length}{pendentesFiltradas.length < pendentes.length ? `/${pendentes.length}` : ""}
            </span>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <input
              type="text"
              placeholder="Buscar por número..."
              value={busca}
              onChange={e => setBusca(e.target.value)}
              style={{
                background: DK.bg, border: `1px solid ${DK.cardBorder}`, borderRadius: 10,
                padding: "6px 12px", fontSize: 12, color: DK.text, outline: "none", width: 180,
              }}
            />
            <select
              value={ugrFiltro}
              onChange={e => setUgrFiltro(e.target.value)}
              style={{
                background: DK.bg, border: `1px solid ${DK.cardBorder}`, borderRadius: 10,
                padding: "6px 12px", fontSize: 12, color: ugrFiltro ? DK.text : DK.muted, outline: "none",
              }}>
              <option value="">Todas as UGs</option>
              {ugrsUnicas.map(ugr => <option key={ugr} value={ugr}>{ugr}</option>)}
            </select>
            {(busca || ugrFiltro) && (
              <button onClick={() => { setBusca(""); setUgrFiltro(""); }} style={{
                background: "transparent", border: `1px solid ${DK.dim}`, borderRadius: 10,
                color: DK.muted, padding: "6px 12px", fontSize: 12, cursor: "pointer",
              }}>✕</button>
            )}
          </div>
        </div>

        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
            <thead>
              <tr style={{ borderBottom: `1px solid ${DK.cardBorder}` }}>
                {["Solicitação", "UG Cred", "Observação"].map(h => (
                  <th key={h} style={{
                    padding: "7px 12px", textAlign: "left", fontWeight: 700, fontSize: 10,
                    textTransform: "uppercase", letterSpacing: "0.08em", color: DK.muted,
                    whiteSpace: "nowrap",
                  }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {pendentesFiltradas.length === 0 ? (
                <tr>
                  <td colSpan={3} style={{ padding: "28px 12px", textAlign: "center", color: DK.muted }}>
                    Nenhuma solicitação pendente encontrada.
                  </td>
                </tr>
              ) : pendentesFiltradas.map(s => (
                <tr key={s.solicitacao}
                  style={{ borderBottom: `1px solid ${DK.cardBorder}`, transition: "background .1s" }}
                  onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = DK.cardBorder}
                  onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = "transparent"}>
                  <td style={{ padding: "9px 12px", fontFamily: "monospace", fontWeight: 700, color: DK.cyan, whiteSpace: "nowrap" }}>
                    {s.solicitacao}
                  </td>
                  <td style={{ padding: "9px 12px", color: DK.text, whiteSpace: "nowrap" }}>
                    {s.ug_cred || <span style={{ color: DK.dim }}>–</span>}
                  </td>
                  <td style={{ padding: "9px 12px", color: DK.muted, fontSize: 11, maxWidth: 380 }}>
                    {s.observacao || <span style={{ color: DK.dim }}>–</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

    </div>
  );
}
