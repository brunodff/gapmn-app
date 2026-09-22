import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { supabase } from "../lib/supabase";
import { fetchCSV, toEmpenhosNF, SHEET_URLS, EmpenhoNF } from "../lib/gsheets";
import {
  ComposedChart, BarChart, Bar, Line, XAxis, YAxis, CartesianGrid,
  Tooltip as ChartTooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Legend,
} from "recharts";

// ─── Tipos ────────────────────────────────────────────────────────────────────

interface NeIdent {
  ne_siafi:      string;
  identificador: string;
  solicitacao:   string | null;
  subprocesso?:  string | null;
  perfil_atual?: string | null;
}

interface SeSolicitacao {
  solicitacao:            string;
  ug_cred:                string | null;
  dt_solicitacao:         string | null;
  responsavel:            string | null;
  excluir_media:          boolean;
  justificativa_exclusao: string | null;
  empenho_realizado:      boolean;
  justificativa_atraso:   string | null;
  status:                 string | null;
  nr_documento:           string | null;
  se_origem:              string | null;
}

const UG_CODE_MAP: Record<string, string> = {
  "120630": "GAP-MN",
  "120094": "DACTA IV",
  "120082": "BAMN",
  "120154": "HAMN",
  "788701": "HAMN",
  "120519": "PAMN",
  "120254": "SEREP-MN",
  "120083": "COMAR VII",
  "120174": "SERIPA-MN",
  "120036": "DECEA",
  "120088": "COMARA",
};

// ─── Design tokens dark ───────────────────────────────────────────────────────

const DK = {
  bg:       "#0d1117",
  card:     "#161b27",
  cardBorder:"#1e2a3a",
  text:     "#e2e8f0",
  muted:    "#64748b",
  dim:      "#334155",
  grid:     "#1e2a3a",
  cyan:     "#22d3ee",
  teal:     "#2dd4bf",
  green:    "#4ade80",
  purple:   "#a78bfa",
  pink:     "#f472b6",
  amber:    "#fbbf24",
  red:      "#f87171",
};

const CHART_COLORS = [DK.cyan, DK.teal, DK.purple, DK.pink, DK.amber, DK.green, DK.red];

// ─── Helpers ──────────────────────────────────────────────────────────────────

const MESES = ["Jan","Fev","Mar","Abr","Mai","Jun","Jul","Ago","Set","Out","Nov","Dez"];

function parseDate(s: string): Date | null {
  if (!s) return null;
  if (s.includes("/")) {
    const [d, m, y] = s.split("/");
    const dt = new Date(+y, +m - 1, +d);
    return isNaN(dt.getTime()) ? null : dt;
  }
  const dt = new Date(s);
  return isNaN(dt.getTime()) ? null : dt;
}

const fmtMoney = (v: number) =>
  v.toLocaleString("pt-BR", { style: "currency", currency: "BRL", minimumFractionDigits: 2 });

function fmtShort(v: number) {
  if (v >= 1_000_000) return `R$ ${(v / 1_000_000).toFixed(1).replace(".", ",")}M`;
  if (v >= 1_000)     return `R$ ${(v / 1_000).toFixed(0)}K`;
  return fmtMoney(v);
}

// ─── Tooltip customizado ──────────────────────────────────────────────────────

function DarkTooltip({ active, payload, label, formatter }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div style={{
      background: "#1e2a3a", border: "1px solid #2d3f52",
      borderRadius: 10, padding: "8px 12px", fontSize: 11, color: "#e2e8f0",
    }}>
      {label && <p style={{ marginBottom: 4, color: "#94a3b8", fontWeight: 600 }}>{label}</p>}
      {payload.map((p: any, i: number) => (
        <p key={i} style={{ color: p.color || p.fill || "#22d3ee", margin: "2px 0" }}>
          {formatter ? formatter(p.value, p.name) : `${p.name}: ${p.value}`}
        </p>
      ))}
    </div>
  );
}

// ─── KPI card ─────────────────────────────────────────────────────────────────

function KpiCard({ label, value, sub, icon, accent = DK.cyan }: {
  label: string; value: string | number; sub?: string; icon: string; accent?: string;
}) {
  return (
    <div style={{
      background: DK.card, border: `1px solid ${DK.cardBorder}`,
      borderRadius: 16, padding: "18px 20px", position: "relative", overflow: "hidden",
    }}>
      {/* top glow bar */}
      <div style={{
        position: "absolute", top: 0, left: 0, right: 0, height: 3,
        background: `linear-gradient(90deg, ${accent}00, ${accent}, ${accent}00)`,
      }} />
      <div style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", color: DK.muted, display: "flex", alignItems: "center", gap: 5 }}>
        <span style={{ fontSize: 14 }}>{icon}</span> {label}
      </div>
      <div style={{ marginTop: 10, fontSize: 28, fontWeight: 800, color: accent, lineHeight: 1 }}>
        {value}
      </div>
      {sub && <div style={{ marginTop: 4, fontSize: 11, color: DK.muted }}>{sub}</div>}
    </div>
  );
}

// ─── Section card ─────────────────────────────────────────────────────────────

function DarkCard({ title, children, style }: { title?: string; children: React.ReactNode; style?: React.CSSProperties }) {
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

// ─── Componente principal ─────────────────────────────────────────────────────

interface Props { canEdit?: boolean; externalSheetsUrl?: string; }

export default function PaineisGerenciais({ canEdit = false, externalSheetsUrl }: Props) {
  const [neIdents,     setNeIdents]     = useState<NeIdent[]>([]);
  const [solicitacoes, setSolicitacoes] = useState<SeSolicitacao[]>([]);
  const [empenhos,     setEmpenhos]     = useState<EmpenhoNF[]>([]);
  const [nfRawCount,   setNfRawCount]   = useState(0);
  const [loading,      setLoading]      = useState(true);
  const [ugFiltro,     setUgFiltro]     = useState("");
  const [editando,     setEditando]     = useState<string | null>(null);
  const [justText,     setJustText]     = useState("");
  const [saving,       setSaving]       = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => { loadAll(); }, [externalSheetsUrl]);

  // Escuta saída do fullscreen nativo (tecla Esc do browser)
  useEffect(() => {
    function onFsChange() {
      if (!document.fullscreenElement) setIsFullscreen(false);
    }
    document.addEventListener("fullscreenchange", onFsChange);
    return () => document.removeEventListener("fullscreenchange", onFsChange);
  }, []);

  // Esc para sair do fullscreen CSS (quando API nativa não disponível)
  useEffect(() => {
    if (!isFullscreen) return;
    function onKey(e: KeyboardEvent) { if (e.key === "Escape") setIsFullscreen(false); }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isFullscreen]);

  const toggleFullscreen = useCallback(async () => {
    if (!isFullscreen) {
      try {
        await containerRef.current?.requestFullscreen();
      } catch { /* navegador não suporta — usa overlay CSS */ }
      setIsFullscreen(true);
    } else {
      if (document.fullscreenElement) await document.exitFullscreen();
      setIsFullscreen(false);
    }
  }, [isFullscreen]);

  async function loadAll() {
    setLoading(true);
    if (externalSheetsUrl) {
      const csv = await fetchCSV(externalSheetsUrl).catch(() => null);
      if (csv) {
        setEmpenhos(toEmpenhosNF(csv));
        const raw = csv.slice(1).filter(r => /\d{4}NE\d+/i.test(r[1] ?? "")).length;
        setNfRawCount(raw);
      }
      setLoading(false);
      return;
    }
    const [{ data: ni }, { data: sols }, csv] = await Promise.all([
      supabase.from("siloms_ne_identificadores").select("*").limit(5000),
      supabase.from("siloms_solicitacoes").select("*").limit(2000),
      fetchCSV(SHEET_URLS.empenhosNF).catch(() => null),
    ]);
    setNeIdents((ni ?? []) as NeIdent[]);
    setSolicitacoes((sols ?? []) as SeSolicitacao[]);
    if (csv) {
      setEmpenhos(toEmpenhosNF(csv));
      // Conta linhas brutas da col B com código NE (sem filtro de data)
      const raw = csv.slice(1).filter(r => /\d{4}NE\d+/i.test(r[1] ?? "")).length;
      setNfRawCount(raw);
    }
    setLoading(false);
  }

  async function salvarJustificativa(sol: string) {
    setSaving(true);
    await supabase.from("siloms_solicitacoes")
      .update({ justificativa_atraso: justText.trim() || null })
      .eq("solicitacao", sol);
    setSolicitacoes(prev =>
      prev.map(s => s.solicitacao === sol ? { ...s, justificativa_atraso: justText.trim() || null } : s)
    );
    setEditando(null);
    setSaving(false);
  }

  // ── Maps ──────────────────────────────────────────────────────────────────

  const seMap = useMemo(
    () => new Map(solicitacoes.map(s => [s.solicitacao.toUpperCase(), s])),
    [solicitacoes]
  );

  const neUgCodeMap = useMemo(() => {
    const m = new Map<string, string>();
    for (const ne of empenhos) {
      if (ne.ugcred_code) m.set(ne.nota_empenho.toUpperCase(), ne.ugcred_code);
    }
    return m;
  }, [empenhos]);

  const neUgMap = useMemo(() => {
    const m = new Map<string, string>();
    for (const ni of neIdents) {
      const se = ni.solicitacao ? seMap.get(ni.solicitacao.toUpperCase()) : undefined;
      if (se?.ug_cred) {
        m.set(ni.ne_siafi.toUpperCase(), se.ug_cred);
      } else {
        const code = neUgCodeMap.get(ni.ne_siafi.toUpperCase());
        m.set(ni.ne_siafi.toUpperCase(), code ? (UG_CODE_MAP[code] ?? code) : "Não identificada");
      }
    }
    return m;
  }, [neIdents, seMap, neUgCodeMap]);

  const firstEmissaoMap = useMemo(() => {
    const m = new Map<string, Date>();
    for (const ne of empenhos) {
      const k = ne.nota_empenho.toUpperCase();
      const d = ne.data ? parseDate(ne.data) : null;
      if (!d) continue;
      const ex = m.get(k);
      if (!ex || d < ex) m.set(k, d);
    }
    return m;
  }, [empenhos]);

  // UGs disponíveis = união de solicitações + neUgMap (cobre NEs sem SE vinculada)
  const ugsDisponiveis = useMemo(() => {
    const set = new Set<string>();
    for (const s of solicitacoes) { if (s.ug_cred) set.add(s.ug_cred); }
    for (const ug of neUgMap.values()) { if (ug && ug !== "Não identificada") set.add(ug); }
    return Array.from(set).sort();
  }, [solicitacoes, neUgMap]);

  // ── Dados filtrados ───────────────────────────────────────────────────────

  const neIdentsFiltrados = useMemo(() => {
    if (!ugFiltro) return neIdents;
    // Usa neUgMap que já resolve: SE.ug_cred → planilha ugcred_code → UG_CODE_MAP
    return neIdents.filter(ni => neUgMap.get(ni.ne_siafi.toUpperCase()) === ugFiltro);
  }, [neIdents, ugFiltro, neUgMap]);

  const uniqueNEs = useMemo(() => {
    const seen = new Set<string>();
    return neIdentsFiltrados.filter(ni => {
      const k = ni.ne_siafi.toUpperCase();
      if (seen.has(k)) return false;
      seen.add(k); return true;
    });
  }, [neIdentsFiltrados]);

  const uniqueNEsSet = useMemo(
    () => new Set(uniqueNEs.map(ni => ni.ne_siafi.toUpperCase())),
    [uniqueNEs]
  );

  // NEs e SEs já emitidas na planilha (fonte mais atualizada que SILOMS)
  const planilhaSolsSet = useMemo(
    () => new Set(empenhos.map(e => (e.solicitacao ?? "").toUpperCase()).filter(Boolean)),
    [empenhos]
  );
  const planilhaNEsSet = useMemo(
    () => new Set(empenhos.map(e => e.nota_empenho.toUpperCase())),
    [empenhos]
  );
  // Subprocessos já vinculados a NEs (de neIdents)
  const planilhaSubprocsData = useMemo(() => {
    const subprocs = new Set<string>();
    const subprocToNEs = new Map<string, string[]>();
    for (const n of neIdents) {
      if (n.subprocesso) {
        n.subprocesso.split(/,\s*/).filter(Boolean).forEach(sp => {
          const k = sp.trim();
          subprocs.add(k);
          if (n.ne_siafi) {
            if (!subprocToNEs.has(k)) subprocToNEs.set(k, []);
            subprocToNEs.get(k)!.push(n.ne_siafi.toUpperCase());
          }
        });
      }
    }
    return { subprocs, subprocToNEs };
  }, [neIdents]);

  // Pendentes: mesma lógica do GerenciamentoEmpenhos (sePendentes)
  const seSemNEAll = useMemo(() => {
    const { subprocs, subprocToNEs } = planilhaSubprocsData;
    return solicitacoes.filter(s => {
      const sol = s.solicitacao.toUpperCase();
      if (planilhaSolsSet.has(sol)) return false;                    // NE emitida → sai
      if (s.se_origem && (planilhaSolsSet.has(s.se_origem.toUpperCase()) || planilhaNEsSet.has(s.se_origem.toUpperCase()))) return false;
      if (s.nr_documento && subprocs.has(s.nr_documento.trim())) return false;
      if (/^26M/i.test(sol) && s.nr_documento) {
        const nes26m = subprocToNEs.get(s.nr_documento.trim());
        if (nes26m?.some(ne => planilhaNEsSet.has(ne))) return false;
      }
      if (s.status) return true;           // SE assinada, aguardando NE
      if (s.empenho_realizado) return true; // Empenhada, NE ainda não na planilha
      if (!s.status && s.nr_documento) return true; // Emissão SILOMS registrada
      return false;
    });
  }, [solicitacoes, planilhaSolsSet, planilhaNEsSet, planilhaSubprocsData]);

  const seSemNE = useMemo(() => {
    if (!ugFiltro) return seSemNEAll;
    return seSemNEAll.filter(s => s.ug_cred === ugFiltro);
  }, [seSemNEAll, ugFiltro]);

  // ── KPIs ──────────────────────────────────────────────────────────────────

  const totalValor = useMemo(() => {
    if (!ugFiltro) return empenhos.reduce((s, ne) => s + (ne.valor ?? 0), 0);
    return empenhos
      .filter(ne => uniqueNEsSet.has(ne.nota_empenho.toUpperCase()))
      .reduce((s, ne) => s + (ne.valor ?? 0), 0);
  }, [empenhos, ugFiltro, uniqueNEsSet]);

  // Apenas NEs com estrutura "2026NEXXXXXX" (empenhos do exercício corrente)
  const nesSiafi2026 = useMemo(
    () => uniqueNEs.filter(ni => /^2026NE\d+$/i.test(ni.ne_siafi.trim())).length,
    [uniqueNEs]
  );

  // Conta NEs da planilha empenhosNF (fonte mais atualizada que o SILOMS)
  const nesDaPlanilha = useMemo(() => {
    const seen = new Set<string>();
    for (const ne of empenhos) {
      if (ne.nota_empenho_full) seen.add(ne.nota_empenho_full);
    }
    return seen.size;
  }, [empenhos]);

  // Usa planilha como fonte de verdade para "atendidas" (mais completa que SILOMS)
  const atendidas = nfRawCount || nesDaPlanilha || nesSiafi2026;
  const totalRecebidas = atendidas + seSemNE.length;
  const txAtend = totalRecebidas > 0 ? Math.round((atendidas / totalRecebidas) * 100) : 0;

  // solicitacao por NE SIAFI: tenta neIdents primeiro, depois planilha (ne.solicitacao extraído)
  const planilhaSolMap = useMemo(() => {
    const m = new Map<string, string>();
    for (const ne of empenhos) {
      if (ne.solicitacao) m.set(ne.nota_empenho.toUpperCase(), ne.solicitacao.toUpperCase());
    }
    return m;
  }, [empenhos]);

  const mediaDias = useMemo(() => {
    const seen = new Set<string>();
    let soma = 0, n = 0;
    for (const ni of uniqueNEs) {
      const k = ni.ne_siafi.toUpperCase();
      if (seen.has(k)) continue;
      const solKey = (ni.solicitacao ?? planilhaSolMap.get(k) ?? "").toUpperCase();
      if (!solKey) continue;
      const se = seMap.get(solKey);
      if (!se?.dt_solicitacao || se.excluir_media) continue;
      const first = firstEmissaoMap.get(k);
      const dtSol = parseDate(se.dt_solicitacao);
      if (!first || !dtSol) continue;
      const dias = Math.round((first.getTime() - dtSol.getTime()) / 86400000);
      if (dias < 0 || dias > 10) continue;
      seen.add(k);
      soma += dias; n++;
    }
    return n > 0 ? { media: Math.round(soma / n), n } : null;
  }, [uniqueNEs, seMap, firstEmissaoMap, planilhaSolMap]);

  // ── Dados mensais ─────────────────────────────────────────────────────────

  const dadosMensais = useMemo(() => {
    const byMonth = new Map<string, { qty: number; valor: number; label: string }>();
    const neToMonth = new Map<string, string>();

    for (const ni of uniqueNEs) {
      const k  = ni.ne_siafi.toUpperCase();
      const dt = firstEmissaoMap.get(k);
      if (!dt) continue;
      const key   = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}`;
      const label = `${MESES[dt.getMonth()]}`;
      neToMonth.set(k, key);
      const ex = byMonth.get(key) ?? { qty: 0, valor: 0, label };
      ex.qty++;
      byMonth.set(key, ex);
    }

    for (const ne of empenhos) {
      const k = ne.nota_empenho.toUpperCase();
      if (!uniqueNEsSet.has(k)) continue;
      const monthKey = neToMonth.get(k);
      if (!monthKey) continue;
      const ex = byMonth.get(monthKey);
      if (ex) ex.valor += (ne.valor ?? 0);
    }

    return Array.from(byMonth.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([, v]) => ({ mes: v.label, qty: v.qty, valor: v.valor }));
  }, [uniqueNEs, firstEmissaoMap, empenhos, uniqueNEsSet]);

  // Média de NEs por mês: total real (planilha raw) ÷ meses com dados
  const nesPorMes = useMemo(() => {
    if (!dadosMensais.length) return null;
    const total = nfRawCount || nesDaPlanilha || dadosMensais.reduce((s, m) => s + m.qty, 0);
    return { media: Math.round(total / dadosMensais.length), meses: dadosMensais.length };
  }, [dadosMensais, nfRawCount, nesDaPlanilha]);

  const mesMaisQty   = useMemo(
    () => dadosMensais.length ? [...dadosMensais].sort((a, b) => b.qty   - a.qty  )[0] : null,
    [dadosMensais]
  );
  const mesMaisValor = useMemo(
    () => dadosMensais.length ? [...dadosMensais].sort((a, b) => b.valor - a.valor)[0] : null,
    [dadosMensais]
  );

  // ── Dados por UG Cred ─────────────────────────────────────────────────────

  const dadosUG = useMemo(() => {
    const byUG = new Map<string, { qty: number; valor: number }>();
    for (const ni of uniqueNEs) {
      const ug = neUgMap.get(ni.ne_siafi.toUpperCase()) ?? "Não identificada";
      const ex = byUG.get(ug) ?? { qty: 0, valor: 0 };
      ex.qty++;
      byUG.set(ug, ex);
    }
    for (const ne of empenhos) {
      const k = ne.nota_empenho.toUpperCase();
      if (!uniqueNEsSet.has(k)) continue;
      const ug = neUgMap.get(k) ?? "Não identificada";
      const ex = byUG.get(ug);
      if (ex) ex.valor += (ne.valor ?? 0);
    }
    return Array.from(byUG.entries())
      .filter(([ug]) => ug !== "Não identificada")
      .map(([ug, v]) => ({ ug, ...v }))
      .sort((a, b) => b.qty - a.qty);
  }, [uniqueNEs, neUgMap, empenhos, uniqueNEsSet]);


  // ── SEs atrasadas (> 7 dias) ──────────────────────────────────────────────

  const hoje = new Date();
  const seSemNEAtrasadas = useMemo(
    () => seSemNE.filter(s => {
      if (s.status === "Assinada OD UGCred" || s.empenho_realizado) {
        const dt = s.dt_solicitacao ? parseDate(s.dt_solicitacao) : null;
        return dt ? Math.floor((hoje.getTime() - dt.getTime()) / 86400000) > 7 : false;
      }
      return false;
    }),
    [seSemNE]
  );

  // ── Pie data ──────────────────────────────────────────────────────────────

  const pieData = useMemo(() => [
    { name: "Atendidas",     value: atendidas,       fill: DK.teal },
    { name: "Não atendidas", value: seSemNE.length,  fill: DK.pink },
  ].filter(d => d.value > 0), [atendidas, seSemNE.length]);

  // ── Render ─────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div style={{ background: DK.bg, borderRadius: 20, padding: 40, textAlign: "center", color: DK.muted, fontSize: 13 }}>
        ⏳ Carregando painel...
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      style={{
        background: DK.bg,
        borderRadius: isFullscreen ? 0 : 20,
        padding: isFullscreen ? "20px 24px" : 16,
        minHeight: 400,
        // Fullscreen nativo: o elemento ocupa 100vh, precisa rolar internamente
        // Fullscreen CSS (fallback): overlay fixo que também rola
        ...(isFullscreen ? {
          overflowY: "auto",
          boxSizing: "border-box" as const,
        } : {}),
        ...(isFullscreen && !document.fullscreenElement ? {
          position: "fixed", inset: 0, zIndex: 9999,
        } : {}),
        ...(isFullscreen && !!document.fullscreenElement ? {
          height: "100vh",
        } : {}),
      }}
      className="space-y-4"
    >

      {/* ── Filtro ── */}
      <div style={{
        background: DK.card, border: `1px solid ${DK.cardBorder}`,
        borderRadius: 14, padding: "10px 16px",
        display: "flex", flexWrap: "wrap", alignItems: "center", gap: 10,
      }}>
        <span style={{ fontSize: 11, fontWeight: 700, color: DK.muted, textTransform: "uppercase", letterSpacing: "0.06em" }}>
          UG Cred
        </span>
        <select
          value={ugFiltro}
          onChange={e => setUgFiltro(e.target.value)}
          style={{
            background: "#0d1117", border: `1px solid ${DK.cardBorder}`, borderRadius: 8,
            padding: "5px 10px", fontSize: 12, color: DK.text, outline: "none", cursor: "pointer",
          }}>
          <option value="">Todas ({ugsDisponiveis.length})</option>
          {ugsDisponiveis.map(ug => <option key={ug} value={ug}>{ug}</option>)}
        </select>
        {ugFiltro && (
          <button onClick={() => setUgFiltro("")}
            style={{ fontSize: 11, color: DK.cyan, background: "none", border: "none", cursor: "pointer", fontWeight: 600 }}>
            ✕ Limpar
          </button>
        )}
        <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
          <button onClick={loadAll}
            style={{
              background: "#1e2a3a", border: `1px solid ${DK.cardBorder}`,
              borderRadius: 8, padding: "5px 14px", fontSize: 11, color: DK.muted, cursor: "pointer", fontWeight: 600,
            }}>
            ↻ Atualizar
          </button>
          <button
            onClick={toggleFullscreen}
            title={isFullscreen ? "Sair da tela cheia (Esc)" : "Expandir em tela cheia"}
            style={{
              background: isFullscreen ? `${DK.cyan}22` : "#1e2a3a",
              border: `1px solid ${isFullscreen ? DK.cyan : DK.cardBorder}`,
              borderRadius: 8, padding: "5px 12px", fontSize: 14,
              color: isFullscreen ? DK.cyan : DK.muted,
              cursor: "pointer", lineHeight: 1, transition: "all 0.15s",
            }}>
            {isFullscreen ? "⊠" : "⛶"}
          </button>
        </div>
      </div>

      {/* ── KPI cards ── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <KpiCard icon="📊" label="NEs SIAFI Emitidas"
          value={nfRawCount || nesDaPlanilha || nesSiafi2026}
          sub={nfRawCount ? "emitidas em 2026 (planilha)" : nesDaPlanilha ? "emitidas em 2026" : "registradas no SILOMS"}
          accent={DK.cyan} />
        <KpiCard icon="💰" label="Valor Empenhado"
          value={fmtShort(totalValor)}
          sub={fmtMoney(totalValor)}
          accent={DK.teal} />
        <KpiCard icon="📅" label="NEs por Mês"
          value={nesPorMes ? `${nesPorMes.media}` : "–"}
          sub={nesPorMes ? `média — ${nesPorMes.meses} meses de dados` : "sem dados mensais"}
          accent={DK.amber} />
        <KpiCard icon="✅" label="Taxa de Atendimento"
          value={`${txAtend}%`}
          sub={`${atendidas} atend. · ${seSemNE.length} pend.`}
          accent={txAtend >= 80 ? DK.green : txAtend >= 50 ? DK.amber : DK.red} />
      </div>

      {/* ── Mês destaque ── */}
      {(mesMaisQty || mesMaisValor) && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {mesMaisQty && (
            <div style={{
              background: `linear-gradient(135deg, #162032 0%, ${DK.card} 100%)`,
              border: `1px solid ${DK.cyan}33`, borderRadius: 14,
              padding: "16px 20px", display: "flex", alignItems: "center", gap: 16,
            }}>
              <span style={{ fontSize: 28 }}>📅</span>
              <div>
                <div style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", color: DK.cyan }}>
                  Mês mais ativo — quantidade
                </div>
                <div style={{ fontSize: 20, fontWeight: 800, color: DK.text, marginTop: 2 }}>{mesMaisQty.mes}</div>
                <div style={{ fontSize: 12, color: DK.muted }}>{mesMaisQty.qty} NEs emitidas</div>
              </div>
            </div>
          )}
          {mesMaisValor && (
            <div style={{
              background: `linear-gradient(135deg, #0f2018 0%, ${DK.card} 100%)`,
              border: `1px solid ${DK.teal}33`, borderRadius: 14,
              padding: "16px 20px", display: "flex", alignItems: "center", gap: 16,
            }}>
              <span style={{ fontSize: 28 }}>💵</span>
              <div>
                <div style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", color: DK.teal }}>
                  Mês mais ativo — valor
                </div>
                <div style={{ fontSize: 20, fontWeight: 800, color: DK.text, marginTop: 2 }}>{mesMaisValor.mes}</div>
                <div style={{ fontSize: 12, color: DK.muted }}>{fmtShort(mesMaisValor.valor)}</div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── Gráfico mensal + Pie ── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">

        {/* Área mensal */}
        <DarkCard title="📅 Emissões por Mês" style={{ gridColumn: "span 2" }}>
          {dadosMensais.length === 0 ? (
            <div style={{ padding: "40px 0", textAlign: "center", color: DK.muted, fontSize: 12 }}>
              Sem dados de emissão disponíveis.
            </div>
          ) : (
            <>
              <ResponsiveContainer width="100%" height={220}>
                <ComposedChart data={dadosMensais} margin={{ top: 8, right: 20, left: 0, bottom: 4 }}>
                  <defs>
                    <linearGradient id="gradCyan" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%"  stopColor={DK.cyan}  stopOpacity={0.25} />
                      <stop offset="95%" stopColor={DK.cyan}  stopOpacity={0.02} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke={DK.grid} vertical={false} />
                  <XAxis dataKey="mes" tick={{ fontSize: 11, fill: DK.muted }} axisLine={false} tickLine={false} />
                  <YAxis yAxisId="qty"   orientation="left"  tick={{ fontSize: 10, fill: DK.muted }} axisLine={false} tickLine={false} allowDecimals={false} />
                  <YAxis yAxisId="valor" orientation="right" tick={{ fontSize: 10, fill: DK.muted }} axisLine={false} tickLine={false}
                    tickFormatter={v => fmtShort(v)} width={72} />
                  <ChartTooltip
                    content={<DarkTooltip formatter={(v: number, n: string) =>
                      n === "valor" ? fmtMoney(v) + " empenhado" : `${v} NEs`
                    } />}
                  />
                  <Bar yAxisId="qty" dataKey="qty" radius={[6, 6, 0, 0]} name="qty"
                    fill={`url(#gradCyan)`} stroke={DK.cyan} strokeWidth={1.5} />
                  <Line yAxisId="valor" type="monotone" dataKey="valor"
                    stroke={DK.teal} strokeWidth={2.5}
                    dot={{ r: 4, fill: DK.teal, stroke: DK.card, strokeWidth: 2 }}
                    activeDot={{ r: 6, fill: DK.teal, stroke: DK.card, strokeWidth: 2 }}
                    name="valor" />
                </ComposedChart>
              </ResponsiveContainer>
              <div style={{ marginTop: 8, display: "flex", gap: 20, justifyContent: "center", fontSize: 11, color: DK.muted }}>
                <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <span style={{ width: 12, height: 12, borderRadius: 3, background: DK.cyan, display: "inline-block" }} /> Qtd. NEs
                </span>
                <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <span style={{ width: 20, height: 2, background: DK.teal, display: "inline-block", borderRadius: 2 }} /> Valor empenhado
                </span>
              </div>
            </>
          )}
        </DarkCard>

        {/* Pie atendimento */}
        <DarkCard title="📋 Atendimento">
          {totalRecebidas === 0 ? (
            <div style={{ padding: "40px 0", textAlign: "center", color: DK.muted, fontSize: 12 }}>
              Sem dados disponíveis.
            </div>
          ) : (
            <>
              <ResponsiveContainer width="100%" height={170}>
                <PieChart>
                  <Pie data={pieData} cx="50%" cy="50%"
                    innerRadius={50} outerRadius={72}
                    paddingAngle={4} dataKey="value"
                    strokeWidth={0}>
                    {pieData.map((entry, i) => <Cell key={i} fill={entry.fill} />)}
                  </Pie>
                  <ChartTooltip
                    content={<DarkTooltip formatter={(v: number, n: string) => `${v} SEs — ${n}`} />}
                  />
                  <Legend iconType="circle" iconSize={8}
                    wrapperStyle={{ fontSize: 11, color: DK.muted }} />
                </PieChart>
              </ResponsiveContainer>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginTop: 6 }}>
                <div style={{
                  background: "#0d1f18", border: `1px solid ${DK.teal}44`,
                  borderRadius: 12, padding: "12px 0", textAlign: "center",
                }}>
                  <div style={{ fontSize: 9, fontWeight: 700, textTransform: "uppercase", color: DK.teal, letterSpacing: "0.08em" }}>Atendidas</div>
                  <div style={{ fontSize: 24, fontWeight: 800, color: DK.teal, marginTop: 2 }}>{nesSiafi2026}</div>
                  <div style={{ fontSize: 11, color: DK.muted }}>{txAtend}%</div>
                </div>
                <div style={{
                  background: "#1f0d1a", border: `1px solid ${DK.pink}44`,
                  borderRadius: 12, padding: "12px 0", textAlign: "center",
                }}>
                  <div style={{ fontSize: 9, fontWeight: 700, textTransform: "uppercase", color: DK.pink, letterSpacing: "0.08em" }}>Pendentes</div>
                  <div style={{ fontSize: 24, fontWeight: 800, color: DK.pink, marginTop: 2 }}>{seSemNE.length}</div>
                  <div style={{ fontSize: 11, color: DK.muted }}>{100 - txAtend}%</div>
                </div>
              </div>
            </>
          )}
        </DarkCard>
      </div>

      {/* ── Por UG Cred ── */}
      {dadosUG.length > 0 && (
        <DarkCard title="🏛️ Empenhos por UG Cred">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

            {/* Barras horizontais */}
            <ResponsiveContainer width="100%" height={Math.max(180, dadosUG.length * 42)}>
              <BarChart data={dadosUG} layout="vertical"
                margin={{ top: 4, right: 12, left: 4, bottom: 4 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={DK.grid} vertical={true} horizontal={false} />
                <XAxis type="number" tick={{ fontSize: 10, fill: DK.muted }} axisLine={false} tickLine={false} allowDecimals={false} />
                <YAxis type="category" dataKey="ug" tick={{ fontSize: 11, fill: DK.muted }} width={78} axisLine={false} tickLine={false} />
                <ChartTooltip
                  content={<DarkTooltip formatter={(v: number, n: string) =>
                    n === "qty" ? `${v} NEs` : fmtMoney(v)
                  } />}
                />
                <Bar dataKey="qty" radius={[0, 6, 6, 0]} name="qty">
                  {dadosUG.map((_, i) => (
                    <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]}
                      fillOpacity={0.85} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>

            {/* Tabela */}
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                <thead>
                  <tr style={{ borderBottom: `2px solid ${DK.dim}` }}>
                    <th style={{ padding: "8px 12px", textAlign: "left", fontWeight: 700, color: DK.muted, fontSize: 10, textTransform: "uppercase", letterSpacing: "0.06em" }}>UG</th>
                    <th style={{ padding: "8px 8px",  textAlign: "right", fontWeight: 700, color: DK.muted, fontSize: 10, textTransform: "uppercase", letterSpacing: "0.06em" }}>NEs</th>
                    <th style={{ padding: "8px 8px",  textAlign: "right", fontWeight: 700, color: DK.muted, fontSize: 10, textTransform: "uppercase", letterSpacing: "0.06em" }}>Valor</th>
                    <th style={{ padding: "8px 12px", textAlign: "right", fontWeight: 700, color: DK.muted, fontSize: 10, textTransform: "uppercase", letterSpacing: "0.06em", minWidth: 100 }}>Distribuição</th>
                  </tr>
                </thead>
                <tbody>
                  {dadosUG.map((row, i) => {
                    const pct = totalValor > 0 ? (row.valor / totalValor * 100) : 0;
                    const cor = CHART_COLORS[i % CHART_COLORS.length];
                    return (
                      <tr key={row.ug} style={{ borderBottom: `1px solid ${DK.grid}` }}>
                        <td style={{ padding: "10px 12px", fontWeight: 700, color: cor }}>{row.ug}</td>
                        <td style={{ padding: "10px 8px",  textAlign: "right", color: DK.text, fontFamily: "monospace" }}>{row.qty}</td>
                        <td style={{ padding: "10px 8px",  textAlign: "right", color: DK.text, fontFamily: "monospace" }}>{fmtShort(row.valor)}</td>
                        <td style={{ padding: "10px 12px", textAlign: "right" }}>
                          <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 8 }}>
                            <div style={{ width: 64, height: 4, borderRadius: 4, background: DK.grid, overflow: "hidden" }}>
                              <div style={{ height: "100%", width: `${pct}%`, background: cor, borderRadius: 4 }} />
                            </div>
                            <span style={{ color: DK.muted, fontFamily: "monospace", minWidth: 38, textAlign: "right" }}>
                              {pct.toFixed(1)}%
                            </span>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                  <tr style={{ borderTop: `2px solid ${DK.dim}` }}>
                    <td style={{ padding: "10px 12px", fontWeight: 700, color: DK.text }}>Total</td>
                    <td style={{ padding: "10px 8px",  textAlign: "right", fontWeight: 700, color: DK.text, fontFamily: "monospace" }}>
                      {dadosUG.reduce((s, r) => s + r.qty, 0)}
                    </td>
                    <td style={{ padding: "10px 8px",  textAlign: "right", fontWeight: 700, color: DK.text, fontFamily: "monospace" }}>{fmtShort(totalValor)}</td>
                    <td style={{ padding: "10px 12px", textAlign: "right", color: DK.muted }}>100%</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </DarkCard>
      )}

      {/* ── SEs atrasadas ── */}
      {seSemNEAtrasadas.length > 0 && (
        <div style={{
          background: DK.card, border: `1px solid ${DK.red}33`,
          borderRadius: 16, padding: "18px 20px",
        }}>
          <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 14 }}>
            <div>
              <div style={{ fontSize: 13, fontWeight: 700, color: DK.red, display: "flex", alignItems: "center", gap: 8 }}>
                ⚠️ Solicitações sem NE há mais de 7 dias
                <span style={{
                  background: `${DK.red}22`, border: `1px solid ${DK.red}44`,
                  borderRadius: 20, padding: "1px 8px", fontSize: 10, fontWeight: 800, color: DK.red,
                }}>
                  {seSemNEAtrasadas.length}
                </span>
              </div>
              <div style={{ fontSize: 11, color: DK.muted, marginTop: 4 }}>
                Adicione uma justificativa para cada SE com prazo excedido
              </div>
            </div>
          </div>

          <div style={{ borderRadius: 12, border: `1px solid ${DK.red}22`, overflow: "hidden" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
              <thead>
                <tr style={{ background: `${DK.red}11`, borderBottom: `1px solid ${DK.red}22` }}>
                  {["SE","UG Cred","Dt Sol.","Dias","Responsável","Justificativa"].map(h => (
                    <th key={h} style={{ padding: "8px 12px", textAlign: h === "Dias" ? "center" : "left", fontWeight: 700, color: `${DK.red}cc`, fontSize: 10, textTransform: "uppercase", letterSpacing: "0.06em" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {seSemNEAtrasadas.map(s => {
                  const dt   = s.dt_solicitacao ? parseDate(s.dt_solicitacao) : null;
                  const dias = dt ? Math.floor((hoje.getTime() - dt.getTime()) / 86400000) : null;
                  const dtFmt = s.dt_solicitacao ? s.dt_solicitacao.split("-").reverse().join("/") : "–";
                  const isEditing = editando === s.solicitacao;

                  return (
                    <tr key={s.solicitacao}
                      style={{ borderBottom: `1px solid ${DK.grid}`, transition: "background 0.15s" }}
                      onMouseEnter={e => (e.currentTarget.style.background = `${DK.red}08`)}
                      onMouseLeave={e => (e.currentTarget.style.background = "transparent")}>
                      <td style={{ padding: "9px 12px", fontFamily: "monospace", fontWeight: 700, color: DK.red }}>{s.solicitacao}</td>
                      <td style={{ padding: "9px 12px", color: DK.muted }}>{s.ug_cred || "–"}</td>
                      <td style={{ padding: "9px 12px", color: DK.muted, whiteSpace: "nowrap" }}>{dtFmt}</td>
                      <td style={{ padding: "9px 12px", textAlign: "center" }}>
                        {dias !== null && (
                          <span style={{
                            background: `${DK.red}22`, border: `1px solid ${DK.red}44`,
                            borderRadius: 20, padding: "2px 8px", fontWeight: 800, color: DK.red, fontSize: 11,
                          }}>
                            {dias}d
                          </span>
                        )}
                      </td>
                      <td style={{ padding: "9px 12px", color: DK.muted }}>{s.responsavel || "–"}</td>
                      <td style={{ padding: "9px 12px", minWidth: 220 }}>
                        {isEditing ? (
                          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                            <input
                              autoFocus
                              value={justText}
                              onChange={e => setJustText(e.target.value)}
                              onKeyDown={e => {
                                if (e.key === "Enter") salvarJustificativa(s.solicitacao);
                                if (e.key === "Escape") setEditando(null);
                              }}
                              placeholder="Ex: aguardando liberação de crédito"
                              style={{
                                flex: 1, background: DK.bg, border: `1px solid ${DK.cyan}55`,
                                borderRadius: 8, padding: "5px 10px", fontSize: 11, color: DK.text, outline: "none",
                              }}
                            />
                            <button onClick={() => salvarJustificativa(s.solicitacao)} disabled={saving}
                              style={{ background: DK.cyan, border: "none", borderRadius: 7, padding: "5px 12px", fontSize: 11, color: "#000", fontWeight: 700, cursor: "pointer" }}>
                              {saving ? "..." : "✓"}
                            </button>
                            <button onClick={() => setEditando(null)}
                              style={{ background: "none", border: `1px solid ${DK.dim}`, borderRadius: 7, padding: "4px 10px", fontSize: 11, color: DK.muted, cursor: "pointer" }}>
                              ✕
                            </button>
                          </div>
                        ) : (
                          <div
                            onClick={() => canEdit ? (setEditando(s.solicitacao), setJustText(s.justificativa_atraso ?? "")) : undefined}
                            style={{ display: "flex", alignItems: "center", gap: 6, borderRadius: 8, padding: "4px 8px", cursor: canEdit ? "pointer" : "default" }}>
                            {s.justificativa_atraso ? (
                              <span style={{ color: DK.text }}>{s.justificativa_atraso}</span>
                            ) : (
                              <span style={{ color: DK.dim, fontStyle: "italic", fontSize: 11 }}>
                                {canEdit ? "Clique para justificar..." : "–"}
                              </span>
                            )}
                            {canEdit && <span style={{ opacity: 0.4, fontSize: 10 }}>✏️</span>}
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* OK badge */}
      {seSemNEAtrasadas.length === 0 && seSemNE.length > 0 && (
        <div style={{
          background: `${DK.green}11`, border: `1px solid ${DK.green}33`,
          borderRadius: 14, padding: "14px 20px", textAlign: "center",
          fontSize: 13, fontWeight: 700, color: DK.green,
        }}>
          ✅ Nenhuma solicitação pendente há mais de 7 dias!
        </div>
      )}

    </div>
  );
}
