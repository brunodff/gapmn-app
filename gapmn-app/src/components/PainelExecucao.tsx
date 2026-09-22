import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import {
  fetchCSV, SHEET_URLS, ExecucaoLinha, ExecucaoHeaders, toExecucaoLinhas,
} from "../lib/gsheets";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip as ChartTooltip, ResponsiveContainer, Cell,
} from "recharts";

// ─── Design tokens (mesmos do PaineisGerenciais) ─────────────────────────────

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

const COLORS = [DK.cyan, DK.teal, DK.purple, DK.pink, DK.amber, DK.green, DK.red];

// ─── Helpers ─────────────────────────────────────────────────────────────────

const fmtMoney = (v: number) =>
  v.toLocaleString("pt-BR", { style: "currency", currency: "BRL", minimumFractionDigits: 2 });

function fmtShort(v: number) {
  if (v >= 1_000_000) return `R$ ${(v / 1_000_000).toFixed(1).replace(".", ",")}M`;
  if (v >= 1_000)     return `R$ ${(v / 1_000).toFixed(0)}K`;
  return fmtMoney(v);
}

// ─── Componentes de UI ───────────────────────────────────────────────────────

function KpiCard({ icon, label, value, sub, accent = DK.cyan }: {
  icon: string; label: string; value: string | number; sub?: string; accent?: string;
}) {
  return (
    <div style={{
      background: DK.card, border: `1px solid ${DK.cardBorder}`,
      borderRadius: 16, padding: "18px 20px", position: "relative", overflow: "hidden",
    }}>
      <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 3,
        background: `linear-gradient(90deg, ${accent}00, ${accent}, ${accent}00)` }} />
      <div style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase",
        letterSpacing: "0.08em", color: DK.muted, display: "flex", alignItems: "center", gap: 5 }}>
        <span style={{ fontSize: 14 }}>{icon}</span> {label}
      </div>
      <div style={{ marginTop: 10, fontSize: 28, fontWeight: 800, color: accent, lineHeight: 1 }}>
        {value}
      </div>
      {sub && <div style={{ marginTop: 4, fontSize: 11, color: DK.muted }}>{sub}</div>}
    </div>
  );
}

function DarkCard({ title, children, style }: {
  title?: string; children: React.ReactNode; style?: React.CSSProperties;
}) {
  return (
    <div style={{
      background: DK.card, border: `1px solid ${DK.cardBorder}`,
      borderRadius: 16, padding: "18px 20px", ...style,
    }}>
      {title && (
        <div style={{ fontSize: 13, fontWeight: 700, color: DK.text, marginBottom: 16 }}>
          {title}
        </div>
      )}
      {children}
    </div>
  );
}

function DarkTooltip({ active, payload, label, formatter }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div style={{
      background: "#1e2a3a", border: "1px solid #2d3f52",
      borderRadius: 10, padding: "8px 12px", fontSize: 11, color: "#e2e8f0",
    }}>
      {label && <p style={{ marginBottom: 4, color: "#94a3b8", fontWeight: 600 }}>{label}</p>}
      {payload.map((p: any, i: number) => (
        <p key={i} style={{ color: p.color || p.fill || DK.cyan, margin: "2px 0" }}>
          {formatter ? formatter(p.value, p.name) : `${p.name}: ${p.value}`}
        </p>
      ))}
    </div>
  );
}

// ─── Componente principal ─────────────────────────────────────────────────────

export default function PainelExecucao() {
  const [linhas,       setLinhas]       = useState<ExecucaoLinha[]>([]);
  const [headers,      setHeaders]      = useState<ExecucaoHeaders>({ d: "Info D", e: "Favorecido", f: "Info F", g: "Info G" });
  const [loading,      setLoading]      = useState(true);
  const [erro,         setErro]         = useState<string | null>(null);
  const [filtroUn,     setFiltroUn]     = useState("");
  const [filtroAno,    setFiltroAno]    = useState("");
  const [filtroPi,     setFiltroPi]     = useState("");
  const [expanded,     setExpanded]     = useState<Set<string>>(new Set());
  const [showEmp,      setShowEmp]      = useState(false);
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
    load();
    // Dados se atualizam às 8h — recarrega a cada hora
    const iv = setInterval(load, 3_600_000);
    return () => clearInterval(iv);
  }, []);

  async function load() {
    setLoading(true);
    setErro(null);
    try {
      const rows = await fetchCSV(SHEET_URLS.execucao);
      const { linhas: l, headers: h } = toExecucaoLinhas(rows);
      setLinhas(l);
      setHeaders(h);
    } catch (e: any) {
      setErro(e?.message ?? "Erro ao carregar planilha.");
    } finally {
      setLoading(false);
    }
  }

  // ── Opções de filtro ─────────────────────────────────────────────────────

  const unidades = useMemo(() => {
    const s = new Set<string>();
    for (const l of linhas) if (l.unidade) s.add(l.unidade);
    return Array.from(s).sort();
  }, [linhas]);

  const anos = useMemo(() => {
    const s = new Set<string>();
    for (const l of linhas) {
      const m = l.nota_empenho.match(/^(\d{4})NE/i);
      if (m) s.add(m[1]);
    }
    return Array.from(s).sort((a, b) => Number(b) - Number(a)); // desc: 2026, 2025, ...
  }, [linhas]);

  const pis = useMemo(() => {
    const s = new Set<string>();
    for (const l of linhas) if (l.pi_desc) s.add(l.pi_desc);
    return Array.from(s).sort();
  }, [linhas]);

  // ── Linhas filtradas ──────────────────────────────────────────────────────

  const filtradas = useMemo(() => {
    let list = linhas;
    if (filtroUn)  list = list.filter(l => l.unidade === filtroUn);
    if (filtroAno) list = list.filter(l => l.nota_empenho.startsWith(filtroAno + "NE"));
    if (filtroPi)  list = list.filter(l => l.pi_desc === filtroPi);
    return list;
  }, [linhas, filtroUn, filtroAno, filtroPi]);

  // ── Totais ────────────────────────────────────────────────────────────────

  const totais = useMemo(() => {
    let aLiq = 0, liqPag = 0, pago = 0, nes = 0;
    for (const l of filtradas) {
      aLiq   += l.a_liquidar;
      liqPag += l.liquidado_pagar;
      pago   += l.pago;
      if (l.nota_empenho) nes++;
    }
    return { aLiq, liqPag, pago, nes };
  }, [filtradas]);

  // ── Por unidade (ranking global, não filtrado) ────────────────────────────

  const byUnidade = useMemo(() => {
    const m = new Map<string, { un: string; aLiq: number; liqPag: number; pago: number; nes: number }>();
    for (const l of linhas) {
      if (!l.unidade) continue;
      const ex = m.get(l.unidade) ?? { un: l.unidade, aLiq: 0, liqPag: 0, pago: 0, nes: 0 };
      ex.aLiq   += l.a_liquidar;
      ex.liqPag += l.liquidado_pagar;
      ex.pago   += l.pago;
      if (l.nota_empenho) ex.nes++;
      m.set(l.unidade, ex);
    }
    return Array.from(m.values()).sort((a, b) => (b.aLiq + b.liqPag + b.pago) - (a.aLiq + a.liqPag + a.pago));
  }, [linhas]);

  // ── Top empresas (col E) excluindo GAP-MN ────────────────────────────────

  const byEmpresa = useMemo(() => {
    const m = new Map<string, number>();
    for (const l of linhas) {
      const emp = l.info_e;
      if (!emp) continue;
      if (/GRUPAMENTO|GAP.?MN/i.test(emp)) continue;
      m.set(emp, (m.get(emp) ?? 0) + l.a_liquidar + l.liquidado_pagar + l.pago);
    }
    return Array.from(m.entries())
      .filter(([, v]) => v > 0)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 10)
      .map(([empresa, total]) => ({ empresa, total }));
  }, [linhas]);

  // ── Grupos por unidade para a tabela ─────────────────────────────────────

  const grupos = useMemo(() => {
    const m = new Map<string, ExecucaoLinha[]>();
    for (const l of filtradas) {
      if (!l.nota_empenho) continue;
      const arr = m.get(l.unidade) ?? [];
      arr.push(l);
      m.set(l.unidade, arr);
    }
    return Array.from(m.entries()).map(([unidade, nes]) => ({ unidade, nes }));
  }, [filtradas]);

  function toggleNE(key: string) {
    setExpanded(prev => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  }

  // ── Render ────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div style={{ background: DK.bg, borderRadius: 20, padding: 40,
        textAlign: "center", color: DK.muted, fontSize: 13 }}>
        ⏳ Carregando Painel de Execução...
      </div>
    );
  }

  if (erro) {
    return (
      <div style={{ background: DK.bg, borderRadius: 20, padding: 40 }}>
        <div style={{ color: DK.red, fontSize: 13, fontWeight: 700 }}>
          ❌ {erro}
        </div>
        <button onClick={load} style={{
          marginTop: 12, background: DK.card, border: `1px solid ${DK.cardBorder}`,
          color: DK.cyan, borderRadius: 8, padding: "6px 16px", fontSize: 12, cursor: "pointer",
        }}>
          Tentar novamente
        </button>
      </div>
    );
  }

  const topALiq   = [...byUnidade].sort((a, b) => b.aLiq   - a.aLiq  )[0];
  const topLiqPag = [...byUnidade].sort((a, b) => b.liqPag - a.liqPag)[0];
  const topPago   = [...byUnidade].sort((a, b) => b.pago   - a.pago  )[0];

  return (
    <div
      ref={containerRef}
      className="space-y-4"
      style={{
        background: DK.bg, borderRadius: 20, padding: 16,
        ...(isFullscreen ? { overflowY: "auto", height: "100vh", boxSizing: "border-box" as const } : {}),
      }}
    >

      {/* ── Filtros + refresh ── */}
      <div style={{
        background: DK.card, border: `1px solid ${DK.cardBorder}`,
        borderRadius: 14, padding: "10px 16px",
        display: "flex", flexWrap: "wrap", alignItems: "center", gap: 10,
      }}>
        {/* Unidade */}
        <span style={{ fontSize: 11, fontWeight: 700, color: DK.muted,
          textTransform: "uppercase", letterSpacing: "0.06em" }}>
          Unidade
        </span>
        <select
          value={filtroUn}
          onChange={e => setFiltroUn(e.target.value)}
          style={{
            background: "#0d1117", border: `1px solid ${DK.cardBorder}`, borderRadius: 8,
            padding: "5px 10px", fontSize: 12, color: DK.text, outline: "none", cursor: "pointer",
          }}>
          <option value="">Todas ({unidades.length})</option>
          {unidades.map(u => <option key={u} value={u}>{u}</option>)}
        </select>

        {/* Ano */}
        <span style={{ fontSize: 11, fontWeight: 700, color: DK.muted,
          textTransform: "uppercase", letterSpacing: "0.06em" }}>
          Ano
        </span>
        <select
          value={filtroAno}
          onChange={e => setFiltroAno(e.target.value)}
          style={{
            background: "#0d1117", border: `1px solid ${filtroAno ? DK.cyan : DK.cardBorder}`, borderRadius: 8,
            padding: "5px 10px", fontSize: 12, color: filtroAno ? DK.cyan : DK.text, outline: "none", cursor: "pointer",
          }}>
          <option value="">Todos ({anos.length})</option>
          {anos.map(a => <option key={a} value={a}>{a}</option>)}
        </select>

        {/* PI */}
        <span style={{ fontSize: 11, fontWeight: 700, color: DK.muted,
          textTransform: "uppercase", letterSpacing: "0.06em" }}>
          PI
        </span>
        <select
          value={filtroPi}
          onChange={e => setFiltroPi(e.target.value)}
          style={{
            background: "#0d1117", border: `1px solid ${filtroPi ? DK.purple : DK.cardBorder}`, borderRadius: 8,
            padding: "5px 10px", fontSize: 12, color: filtroPi ? DK.purple : DK.text, outline: "none", cursor: "pointer",
            maxWidth: 220,
          }}>
          <option value="">Todos ({pis.length})</option>
          {pis.map(p => <option key={p} value={p}>{p}</option>)}
        </select>

        {(filtroUn || filtroAno || filtroPi) && (
          <button onClick={() => { setFiltroUn(""); setFiltroAno(""); setFiltroPi(""); }}
            style={{ fontSize: 11, color: DK.red, background: "none", border: `1px solid ${DK.red}44`,
              borderRadius: 6, padding: "3px 10px", cursor: "pointer", fontWeight: 600 }}>
            ✕ Limpar filtros
          </button>
        )}

        <div style={{ marginLeft: "auto", display: "flex", gap: 8, alignItems: "center" }}>
          <span style={{ fontSize: 10, color: DK.muted }}>Atualiza às 8h diariamente</span>
          <button onClick={load} style={{
            background: "#1e2a3a", border: `1px solid ${DK.cardBorder}`,
            borderRadius: 8, padding: "5px 14px", fontSize: 11, color: DK.muted,
            cursor: "pointer", fontWeight: 600,
          }}>
            ↻ Atualizar
          </button>
          <button onClick={toggleFullscreen} title={isFullscreen ? "Sair da tela cheia" : "Tela cheia"} style={{
            background: "#1e2a3a", border: `1px solid ${DK.cardBorder}`,
            borderRadius: 8, padding: "5px 10px", fontSize: 15, color: DK.muted,
            cursor: "pointer", lineHeight: 1,
          }}>
            {isFullscreen ? "⊡" : "⛶"}
          </button>
        </div>
      </div>

      {/* ── KPI cards ── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <KpiCard icon="📋" label="Notas de Empenho"
          value={totais.nes}
          sub={filtroUn ? `em ${filtroUn}` : `em ${unidades.length} unidades`}
          accent={DK.cyan} />
        <KpiCard icon="💰" label="A Liquidar"
          value={fmtShort(totais.aLiq)}
          sub={fmtMoney(totais.aLiq)}
          accent={DK.amber} />
        <KpiCard icon="🏦" label="Liquidado a Pagar"
          value={fmtShort(totais.liqPag)}
          sub={fmtMoney(totais.liqPag)}
          accent={DK.teal} />
        <KpiCard icon="✅" label="Pago"
          value={fmtShort(totais.pago)}
          sub={fmtMoney(totais.pago)}
          accent={DK.green} />
      </div>

      {/* ── Destaques por unidade ── */}
      {(topALiq || topLiqPag || topPago) && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {topALiq && (
            <div style={{
              background: `linear-gradient(135deg, #1a1400 0%, ${DK.card} 100%)`,
              border: `1px solid ${DK.amber}33`, borderRadius: 14, padding: "14px 18px",
            }}>
              <div style={{ fontSize: 9, fontWeight: 700, textTransform: "uppercase",
                letterSpacing: "0.08em", color: DK.amber, marginBottom: 4 }}>
                Maior saldo a liquidar
              </div>
              <div style={{ fontSize: 16, fontWeight: 800, color: DK.text }}>{topALiq.un}</div>
              <div style={{ fontSize: 12, color: DK.amber, marginTop: 2 }}>{fmtShort(topALiq.aLiq)}</div>
            </div>
          )}
          {topLiqPag && (
            <div style={{
              background: `linear-gradient(135deg, #001a18 0%, ${DK.card} 100%)`,
              border: `1px solid ${DK.teal}33`, borderRadius: 14, padding: "14px 18px",
            }}>
              <div style={{ fontSize: 9, fontWeight: 700, textTransform: "uppercase",
                letterSpacing: "0.08em", color: DK.teal, marginBottom: 4 }}>
                Maior liquidado a pagar
              </div>
              <div style={{ fontSize: 16, fontWeight: 800, color: DK.text }}>{topLiqPag.un}</div>
              <div style={{ fontSize: 12, color: DK.teal, marginTop: 2 }}>{fmtShort(topLiqPag.liqPag)}</div>
            </div>
          )}
          {topPago && (
            <div style={{
              background: `linear-gradient(135deg, #001a08 0%, ${DK.card} 100%)`,
              border: `1px solid ${DK.green}33`, borderRadius: 14, padding: "14px 18px",
            }}>
              <div style={{ fontSize: 9, fontWeight: 700, textTransform: "uppercase",
                letterSpacing: "0.08em", color: DK.green, marginBottom: 4 }}>
                Maior volume pago
              </div>
              <div style={{ fontSize: 16, fontWeight: 800, color: DK.text }}>{topPago.un}</div>
              <div style={{ fontSize: 12, color: DK.green, marginTop: 2 }}>{fmtShort(topPago.pago)}</div>
            </div>
          )}
        </div>
      )}

      {/* ── Gráfico por unidade + Empresas ── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">

        {/* Ranking por unidade */}
        {byUnidade.length > 0 && (
          <DarkCard title="🏛️ Saldo por Unidade">
            <ResponsiveContainer width="100%" height={Math.max(200, byUnidade.length * 52)}>
              <BarChart data={byUnidade} layout="vertical"
                margin={{ top: 4, right: 16, left: 4, bottom: 4 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={DK.grid} vertical horizontal={false} />
                <XAxis type="number" tick={{ fontSize: 10, fill: DK.muted }} axisLine={false}
                  tickLine={false} tickFormatter={v => fmtShort(v)} />
                <YAxis type="category" dataKey="un" tick={{ fontSize: 10, fill: DK.muted }}
                  width={180} axisLine={false} tickLine={false}
                  tickFormatter={(v: string) => v.length > 26 ? v.slice(0, 26) + "…" : v} />
                <ChartTooltip content={
                  <DarkTooltip formatter={(v: number, n: string) =>
                    n === "aLiq" ? `A Liquidar: ${fmtMoney(v)}`
                    : n === "liqPag" ? `Liq. a Pagar: ${fmtMoney(v)}`
                    : `Pago: ${fmtMoney(v)}`
                  } />
                } />
                <Bar dataKey="aLiq"   stackId="a" name="aLiq"   fill={DK.amber} radius={[0, 0, 0, 0]} />
                <Bar dataKey="liqPag" stackId="a" name="liqPag" fill={DK.teal}  radius={[0, 0, 0, 0]} />
                <Bar dataKey="pago"   stackId="a" name="pago"   fill={DK.green} radius={[0, 6, 6, 0]} />
              </BarChart>
            </ResponsiveContainer>
            <div style={{ display: "flex", gap: 16, justifyContent: "center", marginTop: 8, fontSize: 11, color: DK.muted }}>
              {[["A Liquidar", DK.amber], ["Liq. a Pagar", DK.teal], ["Pago", DK.green]].map(([l, c]) => (
                <span key={l} style={{ display: "flex", alignItems: "center", gap: 5 }}>
                  <span style={{ width: 10, height: 10, borderRadius: 3, background: c, display: "inline-block" }} />
                  {l}
                </span>
              ))}
            </div>
          </DarkCard>
        )}

        {/* Top empresas */}
        {byEmpresa.length > 0 && (
          <DarkCard title={`🏢 Top Empresas — ${headers.e}`}>
            <div>
              <button
                onClick={() => setShowEmp(v => !v)}
                style={{
                  marginBottom: 12, background: "none", border: `1px solid ${DK.dim}`,
                  borderRadius: 8, padding: "4px 10px", fontSize: 11, color: DK.muted,
                  cursor: "pointer",
                }}>
                {showEmp ? "▲ Recolher" : "▼ Ver lista"}
              </button>
              {showEmp && (
                <div style={{ overflowX: "auto" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                    <thead>
                      <tr style={{ borderBottom: `2px solid ${DK.dim}` }}>
                        <th style={{ padding: "6px 10px", textAlign: "left", color: DK.muted,
                          fontSize: 10, textTransform: "uppercase", letterSpacing: "0.06em" }}>Empresa</th>
                        <th style={{ padding: "6px 10px", textAlign: "right", color: DK.muted,
                          fontSize: 10, textTransform: "uppercase", letterSpacing: "0.06em" }}>Total</th>
                        <th style={{ padding: "6px 10px", textAlign: "right", color: DK.muted,
                          fontSize: 10, textTransform: "uppercase", letterSpacing: "0.06em", minWidth: 80 }}>%</th>
                      </tr>
                    </thead>
                    <tbody>
                      {byEmpresa.map((e, i) => {
                        const total = byEmpresa.reduce((s, x) => s + x.total, 0);
                        const pct   = total > 0 ? e.total / total * 100 : 0;
                        const cor   = COLORS[i % COLORS.length];
                        return (
                          <tr key={e.empresa} style={{ borderBottom: `1px solid ${DK.grid}` }}>
                            <td style={{ padding: "8px 10px", color: cor, fontWeight: 600,
                              maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                              {e.empresa}
                            </td>
                            <td style={{ padding: "8px 10px", textAlign: "right",
                              color: DK.text, fontFamily: "monospace" }}>
                              {fmtShort(e.total)}
                            </td>
                            <td style={{ padding: "8px 10px", textAlign: "right" }}>
                              <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 6 }}>
                                <div style={{ width: 48, height: 4, borderRadius: 4,
                                  background: DK.grid, overflow: "hidden" }}>
                                  <div style={{ height: "100%", width: `${pct}%`,
                                    background: cor, borderRadius: 4 }} />
                                </div>
                                <span style={{ color: DK.muted, fontFamily: "monospace", minWidth: 36, textAlign: "right" }}>
                                  {pct.toFixed(1)}%
                                </span>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
              {!showEmp && (
                <ResponsiveContainer width="100%" height={Math.min(220, byEmpresa.length * 26 + 20)}>
                  <BarChart data={byEmpresa.slice(0, 8)} layout="vertical"
                    margin={{ top: 4, right: 12, left: 4, bottom: 4 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke={DK.grid} vertical horizontal={false} />
                    <XAxis type="number" tick={{ fontSize: 10, fill: DK.muted }} axisLine={false}
                      tickLine={false} tickFormatter={v => fmtShort(v)} />
                    <YAxis type="category" dataKey="empresa" tick={{ fontSize: 10, fill: DK.muted }}
                      width={100} axisLine={false} tickLine={false}
                      tickFormatter={(v: string) => v.length > 14 ? v.slice(0, 14) + "…" : v} />
                    <ChartTooltip content={
                      <DarkTooltip formatter={(v: number) => fmtMoney(v)} />
                    } />
                    <Bar dataKey="total" radius={[0, 6, 6, 0]}>
                      {byEmpresa.slice(0, 8).map((_, i) => (
                        <Cell key={i} fill={COLORS[i % COLORS.length]} fillOpacity={0.85} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              )}
            </div>
          </DarkCard>
        )}
      </div>

      {/* ── Tabela por unidade ── */}
      {grupos.length > 0 && (
        <DarkCard title="📄 Notas de Empenho por Unidade">
          <div style={{ overflowX: "auto" }}>
            {grupos.map(({ unidade, nes }) => {
              const subALiq   = nes.reduce((s, l) => s + l.a_liquidar, 0);
              const subLiqPag = nes.reduce((s, l) => s + l.liquidado_pagar, 0);
              const subPago   = nes.reduce((s, l) => s + l.pago, 0);

              return (
                <div key={unidade} style={{ marginBottom: 18 }}>
                  {/* Cabeçalho da unidade */}
                  <div style={{
                    background: `${DK.cyan}12`, border: `1px solid ${DK.cyan}22`,
                    borderRadius: "10px 10px 0 0", padding: "8px 14px",
                    display: "flex", alignItems: "center", justifyContent: "space-between",
                    flexWrap: "wrap", gap: 8,
                  }}>
                    <span style={{ fontWeight: 800, fontSize: 13, color: DK.cyan }}>{unidade}</span>
                    <div style={{ display: "flex", gap: 16, fontSize: 11, color: DK.muted }}>
                      <span>{nes.length} NEs</span>
                      <span style={{ color: DK.amber }}>A Liq: {fmtMoney(subALiq)}</span>
                      <span style={{ color: DK.teal }}>Liq a Pag: {fmtMoney(subLiqPag)}</span>
                      <span style={{ color: DK.green }}>Pago: {fmtMoney(subPago)}</span>
                    </div>
                  </div>

                  {/* Tabela de NEs */}
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12,
                    border: `1px solid ${DK.cardBorder}`, borderTop: "none",
                    borderRadius: "0 0 10px 10px", overflow: "hidden" }}>
                    <thead>
                      <tr style={{ background: DK.card, borderBottom: `1px solid ${DK.dim}` }}>
                        <th style={{ padding: "7px 12px", textAlign: "left", color: DK.muted,
                          fontSize: 10, textTransform: "uppercase", letterSpacing: "0.06em" }}>
                          Nota de Empenho
                        </th>
                        <th style={{ padding: "7px 10px", textAlign: "right", color: DK.amber,
                          fontSize: 10, textTransform: "uppercase", letterSpacing: "0.06em" }}>
                          A Liquidar
                        </th>
                        <th style={{ padding: "7px 10px", textAlign: "right", color: DK.teal,
                          fontSize: 10, textTransform: "uppercase", letterSpacing: "0.06em" }}>
                          Liq. a Pagar
                        </th>
                        <th style={{ padding: "7px 10px", textAlign: "right", color: DK.green,
                          fontSize: 10, textTransform: "uppercase", letterSpacing: "0.06em" }}>
                          Pago
                        </th>
                        <th style={{ width: 28 }} />
                      </tr>
                    </thead>
                    <tbody>
                      {nes.map((l, idx) => {
                        const key = `${unidade}|${l.nota_empenho}|${idx}`;
                        const open = expanded.has(key);
                        const hasDetail = l.info_d || l.info_e || l.info_f || l.info_g;
                        return (
                          <>
                            <tr key={key}
                              onClick={() => hasDetail && toggleNE(key)}
                              style={{
                                borderBottom: open ? "none" : `1px solid ${DK.grid}`,
                                background: open ? `${DK.cyan}08` : "transparent",
                                cursor: hasDetail ? "pointer" : "default",
                                transition: "background 0.12s",
                              }}
                              onMouseEnter={e => { if (!open) e.currentTarget.style.background = `${DK.dim}22`; }}
                              onMouseLeave={e => { if (!open) e.currentTarget.style.background = "transparent"; }}>
                              <td style={{ padding: "9px 12px", fontFamily: "monospace",
                                fontWeight: 700, color: DK.text }}>
                                {l.nota_empenho || "–"}
                              </td>
                              <td style={{ padding: "9px 10px", textAlign: "right",
                                fontFamily: "monospace", color: DK.amber, whiteSpace: "nowrap" }}>
                                {l.a_liquidar ? fmtMoney(l.a_liquidar) : "–"}
                              </td>
                              <td style={{ padding: "9px 10px", textAlign: "right",
                                fontFamily: "monospace", color: DK.teal, whiteSpace: "nowrap" }}>
                                {l.liquidado_pagar ? fmtMoney(l.liquidado_pagar) : "–"}
                              </td>
                              <td style={{ padding: "9px 10px", textAlign: "right",
                                fontFamily: "monospace", color: DK.green, whiteSpace: "nowrap" }}>
                                {l.pago ? fmtMoney(l.pago) : "–"}
                              </td>
                              <td style={{ padding: "9px 8px", textAlign: "center",
                                color: DK.muted, fontSize: 11 }}>
                                {hasDetail ? (open ? "▲" : "▼") : ""}
                              </td>
                            </tr>
                            {open && hasDetail && (
                              <tr key={key + "_det"}
                                style={{ borderBottom: `1px solid ${DK.grid}`, background: `${DK.cyan}06` }}>
                                <td colSpan={5} style={{ padding: "10px 16px 14px" }}>
                                  <div style={{
                                    display: "grid",
                                    gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))",
                                    gap: "8px 20px",
                                  }}>
                                    {([
                                      [headers.d, l.info_d],
                                      [headers.e, l.info_e],
                                      [headers.f, l.info_f],
                                      [headers.g, l.info_g],
                                    ] as [string, string][]).filter(([, v]) => v).map(([label, value]) => (
                                      <div key={label}>
                                        <div style={{ fontSize: 9, fontWeight: 700, textTransform: "uppercase",
                                          letterSpacing: "0.06em", color: DK.muted }}>{label}</div>
                                        <div style={{ fontSize: 12, color: DK.text, marginTop: 2 }}>{value}</div>
                                      </div>
                                    ))}
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
              );
            })}
          </div>
        </DarkCard>
      )}

      {linhas.length === 0 && (
        <div style={{ textAlign: "center", padding: "40px 0", color: DK.muted, fontSize: 13 }}>
          Nenhum dado disponível na planilha.
        </div>
      )}
    </div>
  );
}
