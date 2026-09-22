import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { supabase } from "../lib/supabase";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip as ChartTooltip, ResponsiveContainer, Cell,
  PieChart, Pie, Legend,
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
  pink:       "#f472b6",
  amber:      "#fbbf24",
  red:        "#f87171",
  orange:     "#fb923c",
};

// ─── Types ────────────────────────────────────────────────────────────────────

interface PropostaRow {
  id?: number;
  processo: string;
  ano: string;
  uasg: string;
  grupo: string;
  item: string;
  nome_item: string | null;
  cnpj: string | null;
  razao_social: string | null;
  uf: string | null;
  status: string | null;
  me_epp: boolean | null;
  valor_ofertado: number | null;
  valor_negociado: number | null;
  situacao_item: string | null;
  qtde_solicitada: string | null;
  descricao_item: string | null;
  criterio_julgamento: string | null;
  sit_processo: string | null;
  valor_estimado: number | null;
  importado_em: string | null;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const fmtMoney = (v: number) =>
  v.toLocaleString("pt-BR", { style: "currency", currency: "BRL", minimumFractionDigits: 2 });

function fmtShort(v: number) {
  if (v >= 1_000_000) return `R$ ${(v / 1_000_000).toFixed(1).replace(".", ",")}M`;
  if (v >= 1_000)     return `R$ ${(v / 1_000).toFixed(0)}K`;
  return fmtMoney(v);
}

function truncStr(s: string | null | undefined, n = 28) {
  const t = s ?? "";
  return t.length > n ? t.slice(0, n) + "…" : t;
}

function isAdj(status: string | null) {
  return /adjudic|homolog/i.test(status ?? "");
}

const SIT_COLORS: Record<string, string> = {
  "Homologado":                  DK.green,
  "Homologado (Fracassado)":     DK.teal,
  "Homologado (Deserto)":        DK.muted,
  "Julgado e Habilitado":        DK.cyan,
  "Aguardando Julgamento":       DK.amber,
  "Aguardando Habilitação":      DK.orange,
  "Aguardando Encerramento":     DK.purple,
  "Fracassado (Aberto para Contrarrazões)": DK.red,
  "Revogado":                    DK.red,
  "Anulado":                     DK.red,
};

function sitColor(s: string | null) {
  return SIT_COLORS[s ?? ""] ?? DK.dim;
}

const STATUS_COLORS: Record<string, string> = {
  "Adjudicado":           DK.green,
  "Homologado":           DK.teal,
  "Classificado":         DK.cyan,
  "Desclassificado":      DK.red,
  "DESERTO":              DK.muted,
  "Não adjudicado":       DK.amber,
};

function statusColor(s: string | null) {
  if (!s) return DK.dim;
  for (const [k, v] of Object.entries(STATUS_COLORS)) {
    if (s.toLowerCase().includes(k.toLowerCase())) return v;
  }
  return DK.dim;
}

// ─── Sub-componentes ──────────────────────────────────────────────────────────

function KpiCard({ label, value, sub, icon, accent = DK.cyan }: {
  label: string; value: string; sub?: string; icon: string; accent?: string;
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

function DarkCard({ title, children }: { title?: string; children: React.ReactNode }) {
  return (
    <div style={{ background: DK.card, border: `1px solid ${DK.cardBorder}`, borderRadius: 16, padding: "20px 24px" }}>
      {title && (
        <div style={{ fontSize: 13, fontWeight: 700, color: DK.text, marginBottom: 16 }}>
          {title}
        </div>
      )}
      {children}
    </div>
  );
}

function DarkTooltipSit({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div style={{ background: "#1e2a3a", border: "1px solid #2d3f52",
      borderRadius: 10, padding: "8px 12px", fontSize: 11, color: "#e2e8f0" }}>
      {label && <p style={{ marginBottom: 4, color: "#94a3b8", fontWeight: 600 }}>{label}</p>}
      {payload.map((p: any, i: number) => (
        <p key={i} style={{ color: p.fill || DK.cyan, margin: "2px 0" }}>
          {p.name}: {typeof p.value === "number" && p.name?.toLowerCase().includes("valor")
            ? fmtShort(p.value) : p.value}
        </p>
      ))}
    </div>
  );
}

function selStyle(extra?: object): React.CSSProperties {
  return {
    background: "#1a2234", border: `1px solid ${DK.dim}`,
    borderRadius: 8, color: DK.text, fontSize: 12, padding: "6px 10px",
    outline: "none", cursor: "pointer", ...extra,
  };
}

function inputStyle(extra?: object): React.CSSProperties {
  return {
    background: "#1a2234", border: `1px solid ${DK.dim}`,
    borderRadius: 8, color: DK.text, fontSize: 12, padding: "6px 10px",
    outline: "none", width: 200, ...extra,
  };
}

// ─── Componente principal ─────────────────────────────────────────────────────

export default function PainelProcessos() {
  const [rows, setRows]           = useState<PropostaRow[]>([]);
  const [loading, setLoading]     = useState(true);
  const [erro, setErro]           = useState<string | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Filtros
  const [filtroProc, setFiltroProc]   = useState("");
  const [filtroSit, setFiltroSit]     = useState("");
  const [filtroAno, setFiltroAno]     = useState("");
  const [search, setSearch]           = useState("");
  const [expandidos, setExpandidos]   = useState<Set<string>>(new Set());
  const [expandItens, setExpandItens] = useState<Set<string>>(new Set());

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
    const h = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", h);
    return () => document.removeEventListener("fullscreenchange", h);
  }, []);

  useEffect(() => {
    setLoading(true);
    supabase
      .from("cnet_propostas_gapmn")
      .select("*")
      .order("processo", { ascending: true })
      .order("grupo",    { ascending: true })
      .order("item",     { ascending: true })
      .then(({ data, error }) => {
        if (error) { setErro(error.message); }
        else       { setRows((data ?? []) as PropostaRow[]); }
        setLoading(false);
      });
  }, []);

  // ── Opções de filtro ──────────────────────────────────────────────────────
  const processos = useMemo(() =>
    [...new Set(rows.map(r => r.processo))].sort(), [rows]);

  const situacoes = useMemo(() =>
    [...new Set(rows.map(r => r.sit_processo).filter(Boolean) as string[])].sort(), [rows]);

  const anos = useMemo(() =>
    [...new Set(rows.map(r => r.ano).filter(Boolean))].sort().reverse(), [rows]);

  // ── Filtrado ──────────────────────────────────────────────────────────────
  const filtrado = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter(r => {
      if (filtroProc && r.processo !== filtroProc) return false;
      if (filtroSit  && r.sit_processo !== filtroSit) return false;
      if (filtroAno  && r.ano !== filtroAno) return false;
      if (q && !(
        (r.processo ?? "").toLowerCase().includes(q) ||
        (r.nome_item ?? "").toLowerCase().includes(q) ||
        (r.razao_social ?? "").toLowerCase().includes(q) ||
        (r.cnpj ?? "").toLowerCase().includes(q) ||
        (r.sit_processo ?? "").toLowerCase().includes(q)
      )) return false;
      return true;
    });
  }, [rows, filtroProc, filtroSit, filtroAno, search]);

  // ── KPIs ──────────────────────────────────────────────────────────────────
  const kpis = useMemo(() => {
    const procsSet = new Set(filtrado.map(r => r.processo));
    const itemsSet = new Set(filtrado.map(r => `${r.processo}|${r.grupo}|${r.item}`));

    // fornecedores únicos (excl. DESERTO)
    const fornSet = new Set(
      filtrado.filter(r => r.cnpj && r.cnpj !== "DESERTO").map(r => r.cnpj!)
    );

    // valor adjudicado = soma dos itens Adjudicado/Homologado
    let valAdj = 0;
    let estHom = 0;
    const adjItemKeys = new Set<string>();
    for (const r of filtrado) {
      if (isAdj(r.status)) {
        const v = r.valor_negociado ?? r.valor_ofertado ?? 0;
        valAdj += v;
        adjItemKeys.add(`${r.processo}|${r.grupo}|${r.item}`);
      }
    }
    // estimado dos itens adjudicados (deduplica por item)
    const seenItemEst = new Set<string>();
    for (const r of filtrado) {
      const k = `${r.processo}|${r.grupo}|${r.item}`;
      if (adjItemKeys.has(k) && !seenItemEst.has(k)) {
        seenItemEst.add(k);
        estHom += r.valor_estimado ?? 0;
      }
    }
    const economia = estHom - valAdj;
    const econPct = estHom > 0 ? (economia / estHom * 100).toFixed(1) : "0";

    // Situação dos itens (deduplica por item)
    const seenItem2 = new Set<string>();
    let nHom = 0, nFrac = 0, nAguard = 0, nOutros = 0;
    for (const r of filtrado) {
      const k2 = `${r.processo}|${r.grupo}|${r.item}`;
      if (seenItem2.has(k2)) continue;
      seenItem2.add(k2);
      const sit2 = r.situacao_item ?? "";
      if (/homolog/i.test(sit2))          nHom++;
      else if (/fracass|deserto/i.test(sit2)) nFrac++;
      else if (/aguard/i.test(sit2))      nAguard++;
      else                                 nOutros++;
    }

    return {
      nProcs: procsSet.size,
      nItems: itemsSet.size,
      nForn:  fornSet.size,
      valAdj,
      economia,
      econPct,
      nHom, nFrac, nAguard, nOutros,
    };
  }, [filtrado]);

  // ── Gráfico: processos por situação ───────────────────────────────────────
  const dadosSit = useMemo(() => {
    const map = new Map<string, { qtd: number; valor: number }>();
    const seenProc = new Set<string>();
    for (const r of filtrado) {
      if (seenProc.has(r.processo)) continue;
      seenProc.add(r.processo);
      const sit = r.sit_processo ?? "Sem situação";
      const ex = map.get(sit) ?? { qtd: 0, valor: 0 };
      ex.qtd += 1;
      map.set(sit, ex);
    }
    // valor total por situação (itens adjudicados)
    for (const r of filtrado) {
      if (isAdj(r.status)) {
        const sit = r.sit_processo ?? "Sem situação";
        const ex = map.get(sit);
        if (ex) ex.valor += r.valor_negociado ?? r.valor_ofertado ?? 0;
      }
    }
    return Array.from(map.entries())
      .map(([sit, d]) => ({ sit, ...d }))
      .sort((a, b) => b.qtd - a.qtd);
  }, [filtrado]);

  // ── Gráfico: itens por status ──────────────────────────────────────────────
  const dadosStatus = useMemo(() => {
    const map = new Map<string, number>();
    const seen = new Set<string>();
    for (const r of filtrado) {
      const k = `${r.processo}|${r.grupo}|${r.item}|${r.cnpj}`;
      if (seen.has(k)) continue;
      seen.add(k);
      const st = r.status ?? "Desconhecido";
      map.set(st, (map.get(st) ?? 0) + 1);
    }
    return Array.from(map.entries())
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value);
  }, [filtrado]);

  // ── Tabela: agrupar por processo ─────────────────────────────────────────
  const byProc = useMemo(() => {
    const map = new Map<string, {
      sit_processo: string | null;
      ano: string;
      criterio: string | null;
      items: Map<string, { nome: string | null; situacao: string | null; est: number; propostas: PropostaRow[] }>;
    }>();
    for (const r of filtrado) {
      if (!map.has(r.processo)) {
        map.set(r.processo, {
          sit_processo: r.sit_processo,
          ano: r.ano,
          criterio: r.criterio_julgamento,
          items: new Map(),
        });
      }
      const proc = map.get(r.processo)!;
      const ik = `${r.grupo}|${r.item}`;
      if (!proc.items.has(ik)) {
        proc.items.set(ik, {
          nome: r.nome_item,
          situacao: r.situacao_item,
          est: r.valor_estimado ?? 0,
          propostas: [],
        });
      }
      proc.items.get(ik)!.propostas.push(r);
    }
    return Array.from(map.entries())
      .map(([proc, d]) => ({ proc, ...d, itemCount: d.items.size }))
      .sort((a, b) => a.proc.localeCompare(b.proc));
  }, [filtrado]);

  function toggleProc(p: string) {
    setExpandidos(prev => {
      const n = new Set(prev); n.has(p) ? n.delete(p) : n.add(p); return n;
    });
  }

  function toggleItem(k: string) {
    setExpandItens(prev => {
      const n = new Set(prev); n.has(k) ? n.delete(k) : n.add(k); return n;
    });
  }

  // ── Render ────────────────────────────────────────────────────────────────

  if (loading) return (
    <div style={{ background: DK.bg, borderRadius: 16, padding: 48, textAlign: "center", color: DK.muted }}>
      Carregando dados de processos…
    </div>
  );

  if (erro) return (
    <div style={{ background: DK.bg, borderRadius: 16, padding: 24, color: DK.red }}>
      Erro: {erro}
    </div>
  );

  if (!rows.length) return (
    <div style={{ background: DK.bg, borderRadius: 16, padding: 48, textAlign: "center", color: DK.muted }}>
      Nenhum processo carregado. Execute o Robô CNET primeiro.
    </div>
  );

  return (
    <div
      ref={containerRef}
      style={{
        background: DK.bg, borderRadius: 16, padding: 24,
        display: "flex", flexDirection: "column", gap: 20,
        minHeight: isFullscreen ? "100dvh" : undefined,
        overflowY: isFullscreen ? "auto" : undefined,
      }}
    >
      {/* ── Cabeçalho ── */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 10 }}>
        <div>
          <div style={{ fontSize: 18, fontWeight: 800, color: DK.text }}>Painel de Processos</div>
          <div style={{ fontSize: 11, color: DK.muted, marginTop: 2 }}>
            ComprasNet · CNET Robô GAP-MN
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <button
            onClick={toggleFullscreen}
            style={{ background: DK.card, border: `1px solid ${DK.dim}`, borderRadius: 8,
              color: DK.muted, padding: "6px 12px", fontSize: 12, cursor: "pointer" }}
          >
            {isFullscreen ? "⛶ Sair" : "⛶ Tela cheia"}
          </button>
        </div>
      </div>

      {/* ── Filtros ── */}
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
        <input
          placeholder="🔍  Buscar processo, item, fornecedor…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          style={inputStyle({ width: 260 })}
        />
        <select value={filtroProc} onChange={e => setFiltroProc(e.target.value)} style={selStyle()}>
          <option value="">Todos os processos</option>
          {processos.map(p => <option key={p} value={p}>{p}</option>)}
        </select>
        <select value={filtroSit} onChange={e => setFiltroSit(e.target.value)} style={selStyle()}>
          <option value="">Todas as situações</option>
          {situacoes.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
        <select value={filtroAno} onChange={e => setFiltroAno(e.target.value)} style={selStyle()}>
          <option value="">Todos os anos</option>
          {anos.map(a => <option key={a} value={a}>{a}</option>)}
        </select>
        {(filtroProc || filtroSit || filtroAno || search) && (
          <button
            onClick={() => { setFiltroProc(""); setFiltroSit(""); setFiltroAno(""); setSearch(""); }}
            style={{ background: "transparent", border: `1px solid ${DK.red}`, borderRadius: 8,
              color: DK.red, padding: "6px 12px", fontSize: 11, cursor: "pointer" }}
          >
            ✕ Limpar filtros
          </button>
        )}
        <span style={{ fontSize: 11, color: DK.muted, marginLeft: "auto" }}>
          {filtrado.length.toLocaleString("pt-BR")} linhas · {byProc.length} processos
        </span>
      </div>

      {/* ── KPI cards — visão geral ── */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: 16 }}>
        <KpiCard icon="📂" label="Processos"   value={String(kpis.nProcs)}               accent={DK.cyan}   />
        <KpiCard icon="📦" label="Itens"        value={String(kpis.nItems)}               accent={DK.purple} />
        <KpiCard icon="🏢" label="Fornecedores" value={String(kpis.nForn)}                accent={DK.teal}   />
        <KpiCard icon="💰" label="Val. Adjudicado" value={fmtShort(kpis.valAdj)}
          sub={`${kpis.nItems} itens com proposta`} accent={DK.green} />
        <KpiCard icon="📉" label="Economia"     value={fmtShort(kpis.economia)}
          sub={`${kpis.econPct}% sobre estimado`}   accent={DK.amber}  />
      </div>

      {/* ── KPI cards — situação dos itens ── */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 12 }}>
        <KpiCard icon="✅" label="Itens Homologados"   value={String(kpis.nHom)}
          sub="sit. item = homologado"  accent={DK.green}  />
        <KpiCard icon="❌" label="Fracassados / Desertos" value={String(kpis.nFrac)}
          sub="fracassado ou deserto"   accent={DK.red}    />
        <KpiCard icon="⏳" label="Aguardando"          value={String(kpis.nAguard)}
          sub="julgamento ou habilitação" accent={DK.amber} />
        <KpiCard icon="📋" label="Outras Situações"    value={String(kpis.nOutros)}
          sub="encerrado, revogado etc." accent={DK.muted} />
      </div>

      {/* ── Gráficos ── */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>

        {/* Processos por situação */}
        <DarkCard title="📊 Processos por Situação">
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={dadosSit} layout="vertical" margin={{ left: 0, right: 20, top: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={DK.grid} horizontal={false} />
              <XAxis type="number" tick={{ fill: DK.muted, fontSize: 10 }} axisLine={false} tickLine={false} />
              <YAxis type="category" dataKey="sit" tick={{ fill: DK.muted, fontSize: 9 }}
                axisLine={false} tickLine={false} width={160}
                tickFormatter={s => truncStr(s, 28)} />
              <ChartTooltip content={<DarkTooltipSit />} cursor={{ fill: "#1e2a3a" }} />
              <Bar dataKey="qtd" name="Processos" radius={[0, 4, 4, 0]}>
                {dadosSit.map((d, i) => (
                  <Cell key={i} fill={sitColor(d.sit)} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </DarkCard>

        {/* Itens por status de proposta */}
        <DarkCard title="🥧 Propostas por Status">
          <ResponsiveContainer width="100%" height={220}>
            <PieChart>
              <Pie
                data={dadosStatus} dataKey="value" nameKey="name"
                cx="50%" cy="50%" outerRadius={80}
                label={({ name, percent }: { name?: string; percent?: number }) =>
                  `${truncStr(name, 16)} ${((percent ?? 0) * 100).toFixed(0)}%`
                }
                labelLine={false}
              >
                {dadosStatus.map((d, i) => (
                  <Cell key={i} fill={statusColor(d.name)} />
                ))}
              </Pie>
              <Legend
                formatter={(v) => (
                  <span style={{ color: DK.muted, fontSize: 10 }}>{truncStr(v, 22)}</span>
                )}
              />
              <ChartTooltip
                content={({ active, payload }) => {
                  if (!active || !payload?.length) return null;
                  const p = payload[0];
                  return (
                    <div style={{ background: "#1e2a3a", border: "1px solid #2d3f52",
                      borderRadius: 10, padding: "8px 12px", fontSize: 11, color: "#e2e8f0" }}>
                      <p style={{ color: p.payload.fill }}>{p.name}: {p.value}</p>
                    </div>
                  );
                }}
              />
            </PieChart>
          </ResponsiveContainer>
        </DarkCard>
      </div>

      {/* ── Tabela por processo ── */}
      <DarkCard title="📋 Detalhamento por Processo">
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {byProc.map(({ proc, sit_processo, ano, criterio, items, itemCount }) => {
            const open = expandidos.has(proc);
            return (
              <div key={proc} style={{ border: `1px solid ${DK.cardBorder}`, borderRadius: 10, overflow: "hidden" }}>
                {/* cabeçalho do processo */}
                <div
                  onClick={() => toggleProc(proc)}
                  style={{
                    display: "flex", alignItems: "center", gap: 12, padding: "10px 14px",
                    cursor: "pointer", background: open ? "#1a2234" : "transparent",
                    userSelect: "none",
                  }}
                >
                  <span style={{ fontSize: 11, color: DK.muted }}>{open ? "▼" : "▶"}</span>
                  <span style={{ flex: "0 0 auto", fontSize: 12, fontWeight: 700, color: DK.cyan, fontFamily: "monospace" }}>
                    {proc}
                  </span>
                  <span style={{ fontSize: 11, color: DK.muted }}>{ano}</span>
                  {sit_processo && (
                    <span style={{
                      fontSize: 10, fontWeight: 700, padding: "2px 8px", borderRadius: 6,
                      background: `${sitColor(sit_processo)}22`, color: sitColor(sit_processo),
                      border: `1px solid ${sitColor(sit_processo)}55`,
                    }}>
                      {sit_processo}
                    </span>
                  )}
                  {criterio && (
                    <span style={{ fontSize: 10, color: DK.muted }}>{criterio}</span>
                  )}
                  <span style={{ marginLeft: "auto", fontSize: 11, color: DK.muted }}>
                    {itemCount} {itemCount === 1 ? "item" : "itens"}
                  </span>
                </div>

                {/* itens do processo */}
                {open && (
                  <div style={{ borderTop: `1px solid ${DK.cardBorder}`, padding: "8px 14px", display: "flex", flexDirection: "column", gap: 4 }}>
                    {Array.from(items.entries()).map(([ik, itemData]) => {
                      const [grupo, item] = ik.split("|");
                      const itemOpen = expandItens.has(`${proc}|${ik}`);
                      const adjProp = itemData.propostas.find(p => isAdj(p.status));
                      const valAdj = adjProp
                        ? (adjProp.valor_negociado ?? adjProp.valor_ofertado ?? 0)
                        : null;
                      return (
                        <div key={ik} style={{ borderRadius: 8, border: `1px solid ${DK.cardBorder}`, overflow: "hidden" }}>
                          {/* linha do item */}
                          <div
                            onClick={() => toggleItem(`${proc}|${ik}`)}
                            style={{
                              display: "flex", alignItems: "center", gap: 10, padding: "7px 12px",
                              cursor: "pointer", background: itemOpen ? "#131c2e" : "transparent",
                              userSelect: "none",
                            }}
                          >
                            <span style={{ fontSize: 10, color: DK.dim }}>{itemOpen ? "▼" : "▶"}</span>
                            <span style={{ fontSize: 11, fontWeight: 700, color: DK.purple, minWidth: 36 }}>
                              {grupo}/{item}
                            </span>
                            <span style={{ fontSize: 11, color: DK.text, flex: 1 }}>
                              {truncStr(itemData.nome, 60)}
                            </span>
                            {itemData.situacao && (
                              <span style={{
                                fontSize: 10, padding: "1px 7px", borderRadius: 5,
                                background: `${statusColor(itemData.situacao)}22`,
                                color: statusColor(itemData.situacao),
                                border: `1px solid ${statusColor(itemData.situacao)}44`,
                              }}>
                                {itemData.situacao}
                              </span>
                            )}
                            {valAdj !== null && (
                              <span style={{ fontSize: 11, fontWeight: 700, color: DK.green }}>
                                {fmtShort(valAdj)}
                              </span>
                            )}
                            {itemData.est > 0 && (
                              <span style={{ fontSize: 10, color: DK.muted }}>
                                est. {fmtShort(itemData.est)}
                              </span>
                            )}
                            <span style={{ fontSize: 10, color: DK.dim }}>
                              {itemData.propostas.length} prop.
                            </span>
                          </div>

                          {/* propostas do item */}
                          {itemOpen && (
                            <div style={{ borderTop: `1px solid ${DK.cardBorder}` }}>
                              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
                                <thead>
                                  <tr style={{ background: "#0f1620" }}>
                                    {["CNPJ","Razão Social","UF","ME/EPP","Status","Vl. Ofertado","Vl. Negociado"].map(h => (
                                      <th key={h} style={{ padding: "5px 10px", textAlign: "left",
                                        color: DK.muted, fontWeight: 600, fontSize: 10 }}>{h}</th>
                                    ))}
                                  </tr>
                                </thead>
                                <tbody>
                                  {itemData.propostas
                                    .filter(p => p.cnpj !== "DESERTO")
                                    .sort((a, b) => {
                                      const va = a.valor_negociado ?? a.valor_ofertado ?? 0;
                                      const vb = b.valor_negociado ?? b.valor_ofertado ?? 0;
                                      return va - vb;
                                    })
                                    .map((p, pi) => (
                                      <tr key={pi} style={{
                                        borderTop: `1px solid ${DK.cardBorder}`,
                                        background: isAdj(p.status) ? `${DK.green}0a` : "transparent",
                                      }}>
                                        <td style={{ padding: "5px 10px", color: DK.muted, fontFamily: "monospace" }}>
                                          {p.cnpj}
                                        </td>
                                        <td style={{ padding: "5px 10px", color: DK.text }}>
                                          {truncStr(p.razao_social, 32)}
                                        </td>
                                        <td style={{ padding: "5px 10px", color: DK.muted }}>{p.uf}</td>
                                        <td style={{ padding: "5px 10px", color: p.me_epp ? DK.green : DK.dim }}>
                                          {p.me_epp ? "Sim" : "Não"}
                                        </td>
                                        <td style={{ padding: "5px 10px" }}>
                                          <span style={{ color: statusColor(p.status), fontWeight: 600 }}>
                                            {p.status}
                                          </span>
                                        </td>
                                        <td style={{ padding: "5px 10px", color: DK.text, textAlign: "right" }}>
                                          {p.valor_ofertado != null ? fmtMoney(p.valor_ofertado) : "–"}
                                        </td>
                                        <td style={{ padding: "5px 10px",
                                          color: isAdj(p.status) ? DK.green : DK.text, textAlign: "right", fontWeight: isAdj(p.status) ? 700 : 400 }}>
                                          {p.valor_negociado != null ? fmtMoney(p.valor_negociado) : "–"}
                                        </td>
                                      </tr>
                                    ))
                                  }
                                  {/* linha DESERTO se existir */}
                                  {itemData.propostas.some(p => p.cnpj === "DESERTO") && (
                                    <tr style={{ borderTop: `1px solid ${DK.cardBorder}`, opacity: 0.5 }}>
                                      <td colSpan={7} style={{ padding: "4px 10px", color: DK.muted, fontStyle: "italic", fontSize: 10 }}>
                                        Item deserto (sem propostas)
                                      </td>
                                    </tr>
                                  )}
                                </tbody>
                              </table>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </DarkCard>

      <div style={{ fontSize: 10, color: DK.dim, textAlign: "right" }}>
        Dados: cnet_propostas_gapmn · {rows.length.toLocaleString("pt-BR")} registros
      </div>
    </div>
  );
}
