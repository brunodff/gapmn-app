import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { supabase } from "../lib/supabase";
import { fetchCSV, SHEET_URLS, ExecucaoLinha, toExecucaoLinhas } from "../lib/gsheets";

// ─── Types ────────────────────────────────────────────────────────────────────

type Contrato = {
  id: string;
  numero_contrato: string;
  descricao: string | null;
  fornecedor: string | null;
  cnpj: string | null;
  fiscal: string | null;
  data_inicio: string | null;
  data_final: string | null;
  vl_contratual: number | null;
  vl_atual: number | null;
  status: string | null;
  uge: string | null;
  ugr: string | null;
  pag_nup: string | null;
  tipo_objeto: string | null;
  fonte: string;
  created_at: string;
  modalidade_compra: string | null;
};

type Profile = { id: string; nome_guerra: string; email: string | null; setor: string | null };
type Responsavel = { id: string; user_id: string; user: Profile | null };

type Obs = {
  id: string; campo: string; texto: string;
  user_nome: string | null; created_at: string;
};

type ProcessoLic = {
  id: string;
  numero_processo: string | null;
  modalidade: string | null;
  objeto: string | null;
  data_publicacao: string | null;
  status: string | null;
  processo_controle: { status_livre: string | null; pag: string | null; om: string | null }[];
};

// ─── Design tokens ────────────────────────────────────────────────────────────

const DK = {
  bg:         "#0d1117",
  card:       "#161b27",
  cardBorder: "#1e2a3a",
  text:       "#e2e8f0",
  muted:      "#64748b",
  dim:        "#334155",
  cyan:       "#22d3ee",
  teal:       "#2dd4bf",
  green:      "#4ade80",
  amber:      "#fbbf24",
  rose:       "#fb7185",
  violet:     "#a78bfa",
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

const brl = (v: number | null | undefined) =>
  v == null ? "–" : new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(v);

const fmtDate = (d: string | null | undefined) => {
  if (!d) return "–";
  try { return new Date(d + "T12:00:00").toLocaleDateString("pt-BR"); } catch { return d; }
};

const diasAteVencer = (d: string | null) => {
  if (!d) return null;
  return Math.ceil((new Date(d + "T12:00:00").getTime() - Date.now()) / 86400000);
};

const normNUP = (s: string) => (s ?? "").trim().replace(/[\s]/g, "").toUpperCase();

// adaptive font size for large monetary values
const moneyFontSize = (s: string) => {
  const len = s.replace(/\s/g, "").length;
  if (len > 18) return 14;
  if (len > 14) return 17;
  if (len > 10) return 20;
  return 24;
};

// ─── KPI card ─────────────────────────────────────────────────────────────────

function Kpi({ label, value, accent, sub }: {
  label: string; value: string | number; accent: string; sub?: string;
}) {
  const vs = String(value);
  return (
    <div style={{ background: DK.card, border: `1px solid ${DK.cardBorder}`,
      borderRadius: 14, padding: "16px 18px", position: "relative",
      overflow: "hidden", textAlign: "center", minWidth: 0 }}>
      <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 3,
        background: `linear-gradient(90deg,${accent},${accent}44)` }} />
      <div style={{ fontSize: 9, color: DK.muted, textTransform: "uppercase",
        letterSpacing: "0.1em", fontWeight: 700, marginBottom: 8 }}>{label}</div>
      <div style={{ fontSize: moneyFontSize(vs), fontWeight: 800, color: DK.text,
        lineHeight: 1.1, wordBreak: "break-word" }}>{value}</div>
      {sub && <div style={{ fontSize: 10, color: DK.muted, marginTop: 5 }}>{sub}</div>}
    </div>
  );
}

// ─── Status badge ─────────────────────────────────────────────────────────────

function StatusBadge({ data_final }: { data_final: string | null }) {
  const d = diasAteVencer(data_final);
  if (d == null) return null;
  if (d < 0)   return <span style={{ background: "rgba(251,113,133,.15)", color: DK.rose,  padding: "3px 10px", borderRadius: 20, fontSize: 11, fontWeight: 700 }}>Vencido</span>;
  if (d <= 30)  return <span style={{ background: "rgba(251,113,133,.12)", color: DK.rose,  padding: "3px 10px", borderRadius: 20, fontSize: 11 }}>≤ 30d</span>;
  if (d <= 90)  return <span style={{ background: "rgba(251,191,36,.12)",  color: DK.amber, padding: "3px 10px", borderRadius: 20, fontSize: 11 }}>≤ 90d</span>;
  return <span style={{ background: "rgba(74,222,128,.12)", color: DK.green, padding: "3px 10px", borderRadius: 20, fontSize: 11 }}>Vigente</span>;
}

function TabBtn({ label, active, count, onClick }: {
  label: string; active: boolean; count?: number; onClick: () => void;
}) {
  return (
    <button onClick={onClick} style={{
      background: "none", border: "none",
      borderBottom: `2px solid ${active ? DK.cyan : "transparent"}`,
      color: active ? DK.cyan : DK.muted, fontSize: 12,
      fontWeight: active ? 700 : 400, padding: "7px 16px",
      cursor: "pointer", whiteSpace: "nowrap",
    }}>
      {label}
      {count != null && count > 0 && (
        <span style={{ marginLeft: 5, background: active ? DK.cyan + "22" : DK.dim,
          color: active ? DK.cyan : DK.muted, borderRadius: 10, padding: "0 6px", fontSize: 10 }}>
          {count}
        </span>
      )}
    </button>
  );
}

// ─── Component principal ──────────────────────────────────────────────────────

type DetailTab = "dados" | "processo" | "execucao" | "obs";

export default function PainelContratos({ canManage = false }: { canManage?: boolean }) {
  const [contratos,    setContratos]    = useState<Contrato[]>([]);
  const [profiles,     setProfiles]     = useState<Profile[]>([]);
  const [loading,      setLoading]      = useState(true);
  const [busca,        setBusca]        = useState("");
  const [selectedId,   setSelectedId]   = useState<string | null>(null);
  const [detailTab,    setDetailTab]    = useState<DetailTab>("dados");
  const [isFs,         setIsFs]         = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const [responsaveis, setResponsaveis] = useState<Responsavel[]>([]);
  const [obs,          setObs]          = useState<Obs[]>([]);
  const [relLoading,   setRelLoading]   = useState(false);

  const [processo,     setProcesso]     = useState<ProcessoLic | null>(null);
  const [procLoading,  setProcLoading]  = useState(false);

  const [execLinhas,   setExecLinhas]   = useState<ExecucaoLinha[]>([]);
  const [execLoading,  setExecLoading]  = useState(false);
  const [expandedNE,   setExpandedNE]   = useState<string | null>(null);

  const [showAddResp,  setShowAddResp]  = useState(false);
  const [addRespId,    setAddRespId]    = useState("");
  const [addRespSav,   setAddRespSav]   = useState(false);

  const [obsText,      setObsText]      = useState("");
  const [obsSaving,    setObsSaving]    = useState(false);

  const [currentUserId,   setCurrentUserId]   = useState("");
  const [currentUserName, setCurrentUserName] = useState("");

  // ── Load ──────────────────────────────────────────────────────────────────

  const load = useCallback(async () => {
    setLoading(true);
    const { data: { user: au } } = await supabase.auth.getUser();
    if (au) {
      setCurrentUserId(au.id);
      const { data: p } = await supabase.from("profiles")
        .select("nome_guerra").eq("id", au.id).single();
      setCurrentUserName((p as { nome_guerra?: string } | null)?.nome_guerra ?? "Usuário");
    }
    const [{ data: cts }, { data: profs }] = await Promise.all([
      supabase.from("contratos_scon")
        .select("id,numero_contrato,descricao,fornecedor,cnpj,fiscal,data_inicio,data_final,vl_contratual,vl_atual,status,uge,ugr,pag_nup,tipo_objeto,fonte,modalidade_compra,created_at")
        .order("numero_contrato"),
      supabase.from("profiles").select("id,nome_guerra,email,setor").order("nome_guerra"),
    ]);
    setContratos((cts ?? []) as Contrato[]);
    setProfiles((profs ?? []) as Profile[]);
    setLoading(false);
  }, []);

  const loadRelated = useCallback(async (id: string) => {
    setRelLoading(true);
    const [resp, obs_r] = await Promise.all([
      supabase.from("contratos_responsaveis")
        .select("id,user_id,user:profiles(id,nome_guerra,email,setor)")
        .eq("contrato_id", id),
      supabase.from("contratos_notas")
        .select("id,campo,texto,user_nome,created_at")
        .eq("contrato_id", id).eq("campo", "__obs__")
        .order("created_at", { ascending: false }),
    ]);
    setResponsaveis((resp.data ?? []) as unknown as Responsavel[]);
    setObs((obs_r.data ?? []) as Obs[]);
    setRelLoading(false);
  }, []);

  const loadProcesso = useCallback(async (pag: string) => {
    if (!pag) { setProcesso(null); return; }
    setProcLoading(true);
    const { data } = await supabase
      .from("processos_licitatorios")
      .select("id,numero_processo,modalidade,objeto,data_publicacao,status,processo_controle(status_livre,pag,om)")
      .eq("numero_processo", pag)
      .maybeSingle();
    if (!data) {
      // fallback: search via processo_controle.pag
      const { data: pc } = await supabase
        .from("processo_controle")
        .select("processo_licitatorio_id:processos_licitatorios(id,numero_processo,modalidade,objeto,data_publicacao,status,processo_controle(status_livre,pag,om))")
        .eq("pag", pag)
        .maybeSingle();
      setProcesso((pc as unknown as { processo_licitatorio_id: ProcessoLic | null } | null)?.processo_licitatorio_id ?? null);
    } else {
      setProcesso(data as unknown as ProcessoLic);
    }
    setProcLoading(false);
  }, []);

  const loadExec = useCallback(async () => {
    setExecLoading(true);
    try {
      const rows = await fetchCSV(SHEET_URLS.execucao);
      setExecLinhas(toExecucaoLinhas(rows).linhas);
    } catch { /* silent */ }
    setExecLoading(false);
  }, []);

  useEffect(() => { load(); loadExec(); }, [load, loadExec]);

  useEffect(() => {
    const id = selectedId ?? contratos[0]?.id;
    if (!id) return;
    loadRelated(id);
  }, [selectedId, contratos, loadRelated]);

  useEffect(() => {
    if (detailTab === "processo" && selected?.pag_nup) {
      loadProcesso(selected.pag_nup);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detailTab, selectedId]);

  useEffect(() => {
    const fn = () => setIsFs(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", fn);
    return () => document.removeEventListener("fullscreenchange", fn);
  }, []);

  // ── Computed ──────────────────────────────────────────────────────────────

  const filtrados = useMemo(() => {
    const q = busca.trim().toLowerCase();
    if (!q) return contratos;
    return contratos.filter(c =>
      [c.numero_contrato, c.descricao, c.fornecedor, c.cnpj, c.pag_nup, c.modalidade_compra]
        .some(v => v?.toLowerCase().includes(q))
    );
  }, [contratos, busca]);

  const selected = useMemo(
    () => filtrados.find(c => c.id === selectedId) ?? filtrados[0] ?? null,
    [filtrados, selectedId]
  );

  const globalKpis = useMemo(() => ({
    total:    contratos.length,
    vigentes: contratos.filter(c => (diasAteVencer(c.data_final) ?? -1) > 0).length,
    vencendo: contratos.filter(c => { const d = diasAteVencer(c.data_final); return d != null && d >= 0 && d <= 90; }).length,
    valor:    contratos.reduce((s, c) => s + (c.vl_atual ?? c.vl_contratual ?? 0), 0),
  }), [contratos]);

  const filteredExec = useMemo(() => {
    if (!selected?.pag_nup) return [];
    const key = normNUP(selected.pag_nup);
    return execLinhas.filter(l => normNUP(l.info_g) === key);
  }, [execLinhas, selected]);

  const execTotals = useMemo(() => filteredExec.reduce(
    (s, l) => ({ aLiq: s.aLiq + (l.a_liquidar ?? 0), liqPag: s.liqPag + (l.liquidado_pagar ?? 0), pago: s.pago + (l.pago ?? 0) }),
    { aLiq: 0, liqPag: 0, pago: 0 }
  ), [filteredExec]);

  const execEmpenhado = execTotals.aLiq + execTotals.liqPag + execTotals.pago;

  const isResp = responsaveis.some(r => r.user_id === currentUserId);
  const canEdit = canManage || isResp;

  // ── Helpers ───────────────────────────────────────────────────────────────

  function toggleFs() {
    if (!containerRef.current) return;
    if (!document.fullscreenElement) containerRef.current.requestFullscreen?.();
    else document.exitFullscreen?.();
  }

  async function addResp() {
    if (!addRespId || !selected) return;
    setAddRespSav(true);
    await supabase.from("contratos_responsaveis").insert({
      contrato_id: selected.id, user_id: addRespId, added_by: currentUserId,
    });
    setAddRespId(""); setShowAddResp(false); setAddRespSav(false);
    loadRelated(selected.id);
  }

  async function removeResp(id: string) {
    await supabase.from("contratos_responsaveis").delete().eq("id", id);
    if (selected) loadRelated(selected.id);
  }

  async function saveObs() {
    if (!obsText.trim() || !selected) return;
    setObsSaving(true);
    await supabase.from("contratos_notas").insert({
      contrato_id: selected.id, campo: "__obs__",
      texto: obsText.trim(), user_id: currentUserId, user_nome: currentUserName,
    });
    setObsText(""); setObsSaving(false);
    loadRelated(selected.id);
  }

  async function deleteObs(id: string) {
    await supabase.from("contratos_notas").delete().eq("id", id);
    if (selected) loadRelated(selected.id);
  }

  // ── Styles ────────────────────────────────────────────────────────────────

  const S = {
    container: isFs
      ? { background: DK.bg, overflowY: "auto" as const, height: "100vh", padding: "24px 28px" }
      : { background: DK.bg, borderRadius: 16, padding: "24px 28px" },
    tbl: { width: "100%", borderCollapse: "collapse" as const, fontSize: 12 } as React.CSSProperties,
    th:  { color: DK.muted, textTransform: "uppercase" as const, letterSpacing: "0.06em",
           fontWeight: 600, padding: "7px 10px", borderBottom: `1px solid ${DK.cardBorder}`,
           textAlign: "left" as const, fontSize: 10 },
    td:  { color: DK.text,  padding: "7px 10px", borderBottom: `1px solid ${DK.cardBorder}20`, verticalAlign: "top" as const },
    tdm: { color: DK.muted, padding: "7px 10px", borderBottom: `1px solid ${DK.cardBorder}20`, verticalAlign: "top" as const },
  };

  // ── Render ────────────────────────────────────────────────────────────────

  if (loading) return (
    <div style={{ ...S.container, display: "flex", alignItems: "center",
      justifyContent: "center", minHeight: 320 }}>
      <div style={{ color: DK.muted }}>Carregando contratos…</div>
    </div>
  );

  return (
    <div ref={containerRef} style={S.container}>

      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 22 }}>
        <div>
          <div style={{ fontSize: 20, fontWeight: 800, color: DK.text }}>Painel de Contratos</div>
          <div style={{ fontSize: 12, color: DK.muted, marginTop: 2 }}>
            {globalKpis.total} contratos · {globalKpis.vigentes} vigentes · {globalKpis.vencendo} vencendo
          </div>
        </div>
        <button onClick={toggleFs} style={{ background: "transparent",
          border: `1px solid ${DK.cardBorder}`, borderRadius: 8,
          padding: "7px 12px", color: DK.muted, fontSize: 16, cursor: "pointer" }}>
          {isFs ? "⊡" : "⛶"}
        </button>
      </div>

      {/* Global KPI cards */}
      <div style={{ display: "flex", justifyContent: "center", gap: 12,
        marginBottom: 20, flexWrap: "wrap" }}>
        {[
          { label: "Total",         value: globalKpis.total,    accent: DK.cyan  },
          { label: "Vigentes",      value: globalKpis.vigentes, accent: DK.green },
          { label: "Vencendo ≤90d", value: globalKpis.vencendo, accent: DK.amber },
          { label: "Valor Total",   value: brl(globalKpis.valor), accent: DK.teal },
        ].map(k => (
          <div key={k.label} style={{ flex: "1 1 140px", maxWidth: 210 }}>
            <Kpi label={k.label} value={k.value} accent={k.accent} />
          </div>
        ))}
      </div>

      {/* Selected contract KPI row */}
      {selected && (
        <div style={{ display: "flex", justifyContent: "center", gap: 12,
          marginBottom: 20, flexWrap: "wrap",
          background: "rgba(34,211,238,0.04)", border: `1px solid ${DK.cyan}20`,
          borderRadius: 12, padding: "14px 16px" }}>
          <div style={{ width: "100%", fontSize: 11, color: DK.cyan, fontWeight: 700,
            textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 8 }}>
            {selected.numero_contrato}
          </div>
          {[
            { label: "Valor Global",    value: brl(selected.vl_atual ?? selected.vl_contratual), accent: DK.cyan  },
            { label: "Empenhado",       value: brl(execEmpenhado), accent: DK.amber },
            { label: "Saldo",           value: brl((selected.vl_atual ?? selected.vl_contratual ?? 0) - execEmpenhado), accent: DK.green },
            { label: "Vigência Fim",    value: fmtDate(selected.data_final), accent: DK.violet,
              sub: (() => { const d = diasAteVencer(selected.data_final); return d != null ? `${d > 0 ? d + " dias" : "Vencido"}` : undefined; })() },
          ].map(k => (
            <div key={k.label} style={{ flex: "1 1 130px", maxWidth: 190 }}>
              <Kpi label={k.label} value={k.value} accent={k.accent} sub={k.sub} />
            </div>
          ))}
        </div>
      )}

      {/* Search + selector */}
      <div style={{ display: "flex", gap: 10, marginBottom: 18, flexWrap: "wrap" }}>
        <input value={busca}
          onChange={e => { setBusca(e.target.value); setSelectedId(null); }}
          placeholder="Buscar por nº contrato, fornecedor, CNPJ, NUP…"
          style={{ flex: 1, minWidth: 220, background: DK.card,
            border: `1px solid ${DK.cardBorder}`, borderRadius: 10,
            padding: "9px 14px", color: DK.text, fontSize: 13,
            outline: "none", fontFamily: "inherit" }}
        />
        {filtrados.length > 1 && (
          <select value={selectedId ?? ""}
            onChange={e => { setSelectedId(e.target.value || null); setDetailTab("dados"); }}
            style={{ background: DK.card, border: `1px solid ${DK.cardBorder}`,
              borderRadius: 10, padding: "9px 14px", color: DK.text, fontSize: 13,
              outline: "none", cursor: "pointer", fontFamily: "inherit", maxWidth: 340 }}>
            <option value="">— Selecionar contrato —</option>
            {filtrados.map(c => (
              <option key={c.id} value={c.id}>{c.numero_contrato} — {c.fornecedor ?? "sem fornecedor"}</option>
            ))}
          </select>
        )}
      </div>

      {filtrados.length === 0 && (
        <div style={{ textAlign: "center", padding: "80px 0", color: DK.muted }}>
          <div style={{ fontSize: 40, marginBottom: 12 }}>📑</div>
          <div style={{ fontSize: 15, color: DK.text }}>Nenhum contrato encontrado</div>
        </div>
      )}

      {/* Master + Detail */}
      {filtrados.length > 0 && (
        <div style={{ display: "grid", gridTemplateColumns: "270px 1fr", gap: 16, alignItems: "start" }}>

          {/* List */}
          <div style={{ display: "flex", flexDirection: "column", gap: 5,
            maxHeight: "60vh", overflowY: "auto" }}>
            {filtrados.map(c => {
              const ativo = c.id === (selectedId ?? filtrados[0]?.id);
              const dias  = diasAteVencer(c.data_final);
              const cor   = dias == null ? DK.muted : dias < 0 ? DK.rose : dias <= 90 ? DK.amber : DK.green;
              return (
                <button key={c.id}
                  onClick={() => { setSelectedId(c.id); setDetailTab("dados"); }}
                  style={{ background: ativo ? "rgba(34,211,238,0.08)" : DK.card,
                    border: `1px solid ${ativo ? DK.cyan + "50" : DK.cardBorder}`,
                    borderRadius: 12, padding: "10px 14px", textAlign: "left", cursor: "pointer" }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: ativo ? DK.cyan : DK.text,
                    marginBottom: 3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {c.numero_contrato}
                  </div>
                  <div style={{ fontSize: 10, color: DK.muted, overflow: "hidden",
                    textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {c.fornecedor ?? "sem fornecedor"}
                  </div>
                  <div style={{ fontSize: 10, color: cor, marginTop: 3 }}>
                    {c.data_final ? fmtDate(c.data_final) : "sem vencimento"}
                  </div>
                </button>
              );
            })}
          </div>

          {/* Detail */}
          {selected && (
            <div style={{ background: DK.card, border: `1px solid ${DK.cardBorder}`,
              borderRadius: 16, padding: "22px 24px" }}>

              {/* Detail header */}
              <div style={{ marginBottom: 16 }}>
                <div style={{ display: "flex", alignItems: "flex-start",
                  justifyContent: "space-between", marginBottom: 8 }}>
                  <div>
                    <div style={{ fontSize: 17, fontWeight: 800, color: DK.cyan }}>
                      {selected.numero_contrato}
                    </div>
                    <div style={{ fontSize: 11, color: DK.muted, marginTop: 2 }}>
                      {selected.tipo_objeto ?? selected.modalidade_compra ?? "Contrato SCON"}
                    </div>
                  </div>
                  <StatusBadge data_final={selected.data_final} />
                </div>

                {/* Responsáveis */}
                <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap",
                  gap: 6, paddingTop: 10, borderTop: `1px solid ${DK.cardBorder}` }}>
                  <span style={{ fontSize: 10, color: DK.muted, textTransform: "uppercase",
                    letterSpacing: "0.07em", fontWeight: 600, marginRight: 4 }}>Responsáveis:</span>

                  {responsaveis.length === 0 && (
                    <span style={{ fontSize: 11, color: DK.dim }}>nenhum atribuído</span>
                  )}
                  {responsaveis.map(r => (
                    <span key={r.id} style={{ display: "inline-flex", alignItems: "center", gap: 5,
                      background: "rgba(167,139,250,.12)", border: `1px solid ${DK.violet}40`,
                      borderRadius: 20, padding: "3px 10px", fontSize: 11, color: DK.violet }}>
                      {r.user?.email ?? r.user?.nome_guerra ?? "–"}
                      {canManage && (
                        <button onClick={() => removeResp(r.id)}
                          style={{ background: "none", border: "none", color: DK.muted,
                            cursor: "pointer", fontSize: 12, padding: 0 }}>×</button>
                      )}
                    </span>
                  ))}

                  {canManage && !showAddResp && (
                    <button onClick={() => setShowAddResp(true)}
                      style={{ background: "transparent",
                        border: `1px dashed ${DK.cardBorder}`,
                        borderRadius: 20, padding: "3px 10px",
                        fontSize: 11, color: DK.muted, cursor: "pointer" }}>
                      + Adicionar
                    </button>
                  )}
                  {canManage && showAddResp && (
                    <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                      <select value={addRespId} onChange={e => setAddRespId(e.target.value)}
                        style={{ background: DK.bg, border: `1px solid ${DK.cardBorder}`,
                          borderRadius: 8, padding: "4px 10px", color: DK.text,
                          fontSize: 12, outline: "none", cursor: "pointer" }}>
                        <option value="">— Selecionar usuário —</option>
                        {profiles.filter(p => !responsaveis.some(r => r.user_id === p.id)).map(p => (
                          <option key={p.id} value={p.id}>
                            {p.email ?? p.nome_guerra}{p.setor ? ` (${p.setor})` : ""}
                          </option>
                        ))}
                      </select>
                      <button onClick={addResp} disabled={!addRespId || addRespSav}
                        style={{ background: DK.violet, border: "none", borderRadius: 8,
                          padding: "4px 12px", color: "#fff", fontSize: 11,
                          cursor: addRespId ? "pointer" : "not-allowed", opacity: addRespId ? 1 : 0.5 }}>
                        Confirmar
                      </button>
                      <button onClick={() => { setShowAddResp(false); setAddRespId(""); }}
                        style={{ background: "none", border: "none",
                          color: DK.muted, fontSize: 11, cursor: "pointer" }}>Cancelar</button>
                    </div>
                  )}
                </div>
              </div>

              {/* Tabs */}
              <div style={{ display: "flex", borderBottom: `1px solid ${DK.cardBorder}`,
                marginBottom: 18, gap: 2, overflowX: "auto" }}>
                <TabBtn label="Dados"       active={detailTab === "dados"}    onClick={() => setDetailTab("dados")} />
                <TabBtn label="Processo"    active={detailTab === "processo"} onClick={() => setDetailTab("processo")} />
                <TabBtn label="Execução"    active={detailTab === "execucao"} count={filteredExec.length} onClick={() => setDetailTab("execucao")} />
                <TabBtn label="Observações" active={detailTab === "obs"}      count={obs.length} onClick={() => setDetailTab("obs")} />
              </div>

              {relLoading && <div style={{ color: DK.muted, fontSize: 12 }}>Carregando…</div>}

              {/* ─ Tab: Dados ─ */}
              {!relLoading && detailTab === "dados" && (
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px 24px" }}>
                  {([
                    ["Fornecedor",        selected.fornecedor],
                    ["CNPJ",              selected.cnpj],
                    ["Objeto",            selected.descricao],
                    ["Processo (NUP/PAG)",selected.pag_nup],
                    ["Vigência Início",   fmtDate(selected.data_inicio)],
                    ["Vigência Fim",      fmtDate(selected.data_final)],
                    ["Valor Global",      brl(selected.vl_contratual)],
                    ["Valor Atual",       brl(selected.vl_atual)],
                    ["Fiscal",            selected.fiscal],
                    ["UGE / UGR",         [selected.uge, selected.ugr].filter(Boolean).join(" / ") || null],
                    ["Status",            selected.status],
                  ] as [string, string | null][]).map(([k, v]) => (
                    <div key={k} style={{ borderBottom: `1px solid ${DK.cardBorder}20`, paddingBottom: 8 }}>
                      <div style={{ fontSize: 9, color: DK.muted, textTransform: "uppercase",
                        letterSpacing: "0.07em", fontWeight: 700, marginBottom: 3 }}>{k}</div>
                      <div style={{ fontSize: 13, color: v ? DK.text : DK.dim }}>{v || "–"}</div>
                    </div>
                  ))}
                </div>
              )}

              {/* ─ Tab: Processo ─ */}
              {detailTab === "processo" && (
                <div>
                  {procLoading && <div style={{ color: DK.muted, fontSize: 12 }}>Carregando processo…</div>}
                  {!procLoading && !processo && (
                    <div style={{ textAlign: "center", padding: "40px 0", color: DK.muted }}>
                      <div style={{ fontSize: 28, marginBottom: 8 }}>🔍</div>
                      <div>Nenhum processo licitatório vinculado a este PAG/NUP</div>
                      {selected.pag_nup && (
                        <div style={{ fontSize: 11, marginTop: 6, fontFamily: "monospace",
                          color: DK.dim }}>{selected.pag_nup}</div>
                      )}
                    </div>
                  )}
                  {!procLoading && processo && (
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px 24px" }}>
                      {([
                        ["Número do Processo",  processo.numero_processo],
                        ["Modalidade",          processo.modalidade],
                        ["Data de Publicação",  fmtDate(processo.data_publicacao)],
                        ["Status",              processo.status],
                        ["OM",                  processo.processo_controle?.[0]?.om],
                        ["Situação (controle)", processo.processo_controle?.[0]?.status_livre],
                        ["Objeto",              processo.objeto],
                      ] as [string, string | null | undefined][]).map(([k, v]) => (
                        <div key={k} style={{ borderBottom: `1px solid ${DK.cardBorder}20`, paddingBottom: 8,
                          gridColumn: k === "Objeto" ? "1 / -1" : undefined }}>
                          <div style={{ fontSize: 9, color: DK.muted, textTransform: "uppercase",
                            letterSpacing: "0.07em", fontWeight: 700, marginBottom: 3 }}>{k}</div>
                          <div style={{ fontSize: 13, color: v ? DK.text : DK.dim }}>{v || "–"}</div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* ─ Tab: Execução ─ */}
              {detailTab === "execucao" && (
                <div>
                  <div style={{ fontSize: 11, color: DK.muted, marginBottom: 12 }}>
                    PAG/NUP:&nbsp;
                    <span style={{ color: DK.cyan, fontFamily: "monospace" }}>
                      {selected.pag_nup ?? "não informado"}
                    </span>
                    {execLoading && <span style={{ marginLeft: 10 }}>Carregando…</span>}
                  </div>

                  {!execLoading && filteredExec.length === 0 && (
                    <div style={{ color: DK.muted, textAlign: "center", padding: "40px 0" }}>
                      Nenhum empenho vinculado a este PAG no Painel de Execução
                    </div>
                  )}

                  {!execLoading && filteredExec.length > 0 && (
                    <div style={{ overflowX: "auto" }}>
                      <table style={S.tbl}>
                        <thead><tr>
                          <th style={S.th}>NE</th>
                          <th style={S.th}>Unidade</th>
                          <th style={S.th}>Favorecido</th>
                          <th style={{ ...S.th, textAlign: "right" }}>A Liquidar</th>
                          <th style={{ ...S.th, textAlign: "right" }}>Liq./Pagar</th>
                          <th style={{ ...S.th, textAlign: "right" }}>Pago</th>
                          <th style={S.th}></th>
                        </tr></thead>
                        <tbody>
                          {filteredExec.map((l, i) => {
                            const ne  = l.nota_empenho.replace(/^\d{6}/, "");
                            const key = l.nota_empenho;
                            const exp = expandedNE === key;
                            return (
                              <>
                                <tr key={key} style={{ cursor: "pointer" }}
                                  onClick={() => setExpandedNE(exp ? null : key)}
                                  onMouseEnter={e => (e.currentTarget.style.background = "rgba(255,255,255,0.03)")}
                                  onMouseLeave={e => (e.currentTarget.style.background = "transparent")}>
                                  <td style={{ ...S.td, color: DK.cyan, fontFamily: "monospace", fontSize: 11 }}>{ne}</td>
                                  <td style={S.tdm}>{l.unidade}</td>
                                  <td style={S.tdm}>{l.info_e || l.info_d || "–"}</td>
                                  <td style={{ ...S.td, textAlign: "right", color: l.a_liquidar ? DK.amber : DK.dim }}>
                                    {brl(l.a_liquidar)}
                                  </td>
                                  <td style={{ ...S.td, textAlign: "right" }}>{brl(l.liquidado_pagar)}</td>
                                  <td style={{ ...S.td, textAlign: "right", color: l.pago ? DK.green : DK.dim }}>
                                    {brl(l.pago)}
                                  </td>
                                  <td style={{ ...S.tdm, textAlign: "center" }}>{exp ? "▲" : "▼"}</td>
                                </tr>
                                {exp && (
                                  <tr key={key + "_det"}>
                                    <td colSpan={7} style={{ padding: "10px 16px",
                                      background: "rgba(34,211,238,0.04)",
                                      borderBottom: `1px solid ${DK.cardBorder}` }}>
                                      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: "8px 24px" }}>
                                        {([
                                          ["NE completo",   l.nota_empenho],
                                          ["Cód. Favorecido", l.info_d],
                                          ["Descrição",     l.info_f],
                                          ["PAG (vinculado)", l.info_g],
                                          ["Total empenho", brl((l.a_liquidar ?? 0) + (l.liquidado_pagar ?? 0) + (l.pago ?? 0))],
                                        ] as [string, string | number | undefined][]).filter(([, v]) => v).map(([k, v]) => (
                                          <div key={String(k)}>
                                            <div style={{ fontSize: 9, color: DK.muted, textTransform: "uppercase",
                                              letterSpacing: "0.06em", fontWeight: 700, marginBottom: 2 }}>{k}</div>
                                            <div style={{ fontSize: 12, color: DK.text }}>{String(v)}</div>
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
                        <tfoot>
                          <tr style={{ borderTop: `1px solid ${DK.cardBorder}` }}>
                            <td colSpan={3} style={{ ...S.tdm, fontWeight: 700, fontSize: 10 }}>
                              TOTAL ({filteredExec.length} NEs)
                            </td>
                            <td style={{ ...S.td, textAlign: "right", color: DK.amber, fontWeight: 700 }}>{brl(execTotals.aLiq)}</td>
                            <td style={{ ...S.td, textAlign: "right", fontWeight: 700 }}>{brl(execTotals.liqPag)}</td>
                            <td style={{ ...S.td, textAlign: "right", color: DK.green, fontWeight: 700 }}>{brl(execTotals.pago)}</td>
                            <td />
                          </tr>
                        </tfoot>
                      </table>
                    </div>
                  )}
                </div>
              )}

              {/* ─ Tab: Observações ─ */}
              {!relLoading && detailTab === "obs" && (
                <div>
                  {canEdit && (
                    <div style={{ marginBottom: 18 }}>
                      <textarea
                        value={obsText}
                        onChange={e => setObsText(e.target.value)}
                        placeholder="Escreva uma observação sobre este contrato…"
                        rows={3}
                        style={{ width: "100%", background: "rgba(255,255,255,0.05)",
                          border: `1px solid ${DK.cardBorder}`, borderRadius: 10,
                          padding: "10px 14px", color: DK.text, fontSize: 13,
                          resize: "vertical", outline: "none", fontFamily: "inherit",
                          boxSizing: "border-box" }}
                      />
                      <button onClick={saveObs} disabled={obsSaving || !obsText.trim()}
                        style={{ marginTop: 8, background: DK.cyan, border: "none",
                          borderRadius: 8, padding: "8px 20px", color: "#041020",
                          fontSize: 13, fontWeight: 700,
                          cursor: obsText.trim() ? "pointer" : "not-allowed",
                          opacity: obsText.trim() ? 1 : 0.5 }}>
                        {obsSaving ? "Salvando…" : "Publicar observação"}
                      </button>
                    </div>
                  )}

                  {obs.length === 0 && (
                    <div style={{ color: DK.dim, fontSize: 12, textAlign: "center",
                      padding: "30px 0" }}>Nenhuma observação registrada</div>
                  )}

                  <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                    {obs.map(o => (
                      <div key={o.id} style={{ background: "rgba(255,255,255,0.04)",
                        border: `1px solid ${DK.cardBorder}`, borderRadius: 10,
                        padding: "12px 16px" }}>
                        <div style={{ display: "flex", justifyContent: "space-between",
                          alignItems: "flex-start", marginBottom: 6 }}>
                          <div style={{ fontSize: 11, color: DK.muted }}>
                            <span style={{ color: DK.violet, fontWeight: 600 }}>
                              {o.user_nome ?? "Usuário"}
                            </span>
                            &nbsp;·&nbsp;
                            {new Date(o.created_at).toLocaleString("pt-BR")}
                          </div>
                          {canEdit && (
                            <button onClick={() => deleteObs(o.id)}
                              style={{ background: "none", border: "none",
                                color: DK.dim, cursor: "pointer", fontSize: 12 }}>✕</button>
                          )}
                        </div>
                        <div style={{ fontSize: 13, color: DK.text, lineHeight: 1.6,
                          whiteSpace: "pre-wrap" }}>{o.texto}</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

            </div>
          )}
        </div>
      )}
    </div>
  );
}
