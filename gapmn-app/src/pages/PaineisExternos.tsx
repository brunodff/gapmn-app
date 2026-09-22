import { useState, useEffect } from "react";
import { supabase } from "../lib/supabase";
import PaineisGerenciais from "../components/PaineisGerenciais";
import PainelRP from "../components/PainelRP";

// ── Tipos ────────────────────────────────────────────────────────────────────

interface PainelExterno {
  id: string;
  nome: string;
  tipo: "empenhos" | "rp";
  sheets_url: string;
  unidade: string | null;
  criado_em: string;
}

interface UserProfile {
  nome_guerra: string;
  setor: string;
  avatar_key: string | null;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function normalizeSheetUrl(url: string): string {
  const m = url.match(/\/d\/([a-zA-Z0-9_-]+)/);
  if (!m) return url;
  const id = m[1];
  const gidM = url.match(/[?&]gid=(\d+)/);
  const gid = gidM ? gidM[1] : "0";
  return `https://docs.google.com/spreadsheets/d/${id}/export?format=csv&gid=${gid}`;
}

const TIPO_META: Record<string, { label: string; desc: string; color: string; abbr: string }> = {
  empenhos: {
    label: "Painel de Empenhos",
    abbr:  "EMP",
    desc:  "Visão por UG Credora, NEs, situações e NFs",
    color: "#22d3ee",
  },
  rp: {
    label: "Painel de Restos a Pagar",
    abbr:  "RP",
    desc:  "RP Processados e Não-Processados por UG e NE",
    color: "#a78bfa",
  },
};

// ── Componente principal ──────────────────────────────────────────────────────

export default function PaineisExternos() {
  const [profile,      setProfile]    = useState<UserProfile | null>(null);
  const [paineis,      setPaineis]    = useState<PainelExterno[]>([]);
  const [loadingInit,  setLoadingInit] = useState(true);
  const [viewingPanel, setViewingPanel] = useState<PainelExterno | null>(null);

  // form
  const [formNome,    setFormNome]    = useState("");
  const [formTipo,    setFormTipo]    = useState<"empenhos" | "rp">("empenhos");
  const [formUrl,     setFormUrl]     = useState("");
  const [formUnidade, setFormUnidade] = useState("");
  const [saving,      setSaving]      = useState(false);
  const [saveErr,     setSaveErr]     = useState<string | null>(null);
  const [showForm,    setShowForm]    = useState(false);

  // delete
  const [deletingId, setDeletingId] = useState<string | null>(null);

  useEffect(() => {
    async function init() {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { setLoadingInit(false); return; }
      const [{ data: prof }, { data: panels }] = await Promise.all([
        supabase.from("profiles").select("nome_guerra,setor,avatar_key").eq("id", user.id).maybeSingle(),
        supabase.from("user_paineis_externos").select("*").order("criado_em", { ascending: false }),
      ]);
      setProfile(prof as UserProfile ?? { nome_guerra: user.email ?? "Usuário", setor: "", avatar_key: null });
      setPaineis((panels ?? []) as PainelExterno[]);
      setLoadingInit(false);
    }
    init();
  }, []);

  async function handleSave() {
    if (!formNome.trim() || !formUrl.trim()) { setSaveErr("Preencha nome e URL da planilha."); return; }
    setSaving(true);
    setSaveErr(null);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setSaveErr("Sessão expirada."); setSaving(false); return; }
    const { data, error } = await supabase
      .from("user_paineis_externos")
      .insert({ user_id: user.id, nome: formNome.trim(), tipo: formTipo, sheets_url: formUrl.trim(), unidade: formUnidade.trim() || null })
      .select().single();
    if (error) { setSaveErr(error.message); setSaving(false); return; }
    setPaineis(prev => [data as PainelExterno, ...prev]);
    setFormNome(""); setFormUrl(""); setFormUnidade(""); setShowForm(false);
    setSaving(false);
  }

  async function handleDelete(id: string) {
    await supabase.from("user_paineis_externos").delete().eq("id", id);
    setPaineis(prev => prev.filter(p => p.id !== id));
    if (viewingPanel?.id === id) setViewingPanel(null);
    setDeletingId(null);
  }

  // ── Loading ───────────────────────────────────────────────────────────────

  if (loadingInit) {
    return (
      <div style={S.page}>
        <div style={{ color: "#64748b", textAlign: "center", paddingTop: 80, fontSize: 14 }}>
          Carregando...
        </div>
      </div>
    );
  }

  // ── Visualizando painel ───────────────────────────────────────────────────

  if (viewingPanel) {
    const csvUrl = normalizeSheetUrl(viewingPanel.sheets_url);
    const meta   = TIPO_META[viewingPanel.tipo];
    return (
      <div style={S.page}>
        <div style={{ ...S.topbar, padding: "0 20px" }}>
          <button onClick={() => setViewingPanel(null)} style={S.backBtn}>
            ← Meus Painéis
          </button>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ ...S.tipoAbbrBadge, background: `${meta.color}18`, color: meta.color, borderColor: `${meta.color}40` }}>
              {meta.abbr}
            </span>
            <span style={{ fontSize: 15, fontWeight: 700, color: "#e2e8f0" }}>{viewingPanel.nome}</span>
            {viewingPanel.unidade && (
              <span style={{ fontSize: 12, color: "#475569" }}>— {viewingPanel.unidade}</span>
            )}
          </div>
          <div style={{ width: 130 }} />
        </div>
        <div style={{ padding: "0 16px 40px" }}>
          {viewingPanel.tipo === "empenhos"
            ? <PaineisGerenciais externalSheetsUrl={csvUrl} />
            : <PainelRP externalSheetsUrl={csvUrl} />
          }
        </div>
      </div>
    );
  }

  // ── Dashboard ─────────────────────────────────────────────────────────────

  const avatarSrc = profile?.avatar_key ? `/${profile.avatar_key}.png` : "/grad_homem.png";

  return (
    <div style={S.page}>

      {/* ── Topbar ─────────────────────────────────────────────────────────── */}
      <div style={S.topbar}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div style={S.logoDot} />
          <div>
            <div style={{ fontSize: 15, fontWeight: 800, color: "#e2e8f0", letterSpacing: "-0.01em" }}>
              Painéis Gerenciais
            </div>
            <div style={{ fontSize: 11, color: "#475569", marginTop: 1 }}>
              Uso externo — qualquer unidade
            </div>
          </div>
        </div>

        {profile && (
          <div style={S.userChip}>
            <img
              src={avatarSrc}
              alt={profile.nome_guerra}
              style={S.avatarSm}
              onError={e => { (e.currentTarget as HTMLImageElement).src = "/grad_homem.png"; }}
            />
            <div>
              <div style={{ fontSize: 12, fontWeight: 700, color: "#e2e8f0", lineHeight: 1.2 }}>
                {profile.nome_guerra}
              </div>
              <div style={{ fontSize: 10, color: "#475569", marginTop: 1 }}>{profile.setor}</div>
            </div>
          </div>
        )}
      </div>

      {/* ── Layout principal ────────────────────────────────────────────────── */}
      <div style={{ display: "flex", gap: 0, minHeight: "calc(100vh - 60px)" }}>

        {/* Sidebar do usuário */}
        <aside style={S.sidebar}>
          {profile && (
            <div style={S.userCard}>
              <div style={S.avatarWrap}>
                <img
                  src={avatarSrc}
                  alt={profile.nome_guerra}
                  style={S.avatarLg}
                  onError={e => { (e.currentTarget as HTMLImageElement).src = "/grad_homem.png"; }}
                />
                <div style={S.avatarOnline} />
              </div>
              <div style={{ marginTop: 14, textAlign: "center" }}>
                <div style={{ fontSize: 15, fontWeight: 800, color: "#e2e8f0", lineHeight: 1.2 }}>
                  {profile.nome_guerra}
                </div>
                <div style={{ marginTop: 6 }}>
                  <span style={S.setorBadge}>{profile.setor || "Usuário"}</span>
                </div>
              </div>
              <div style={S.userStats}>
                <div style={S.statItem}>
                  <div style={{ fontSize: 20, fontWeight: 800, color: "#22d3ee" }}>{paineis.length}</div>
                  <div style={{ fontSize: 10, color: "#475569" }}>Painéis</div>
                </div>
                <div style={S.statDivider} />
                <div style={S.statItem}>
                  <div style={{ fontSize: 20, fontWeight: 800, color: "#a78bfa" }}>
                    {paineis.filter(p => p.tipo === "empenhos").length}
                  </div>
                  <div style={{ fontSize: 10, color: "#475569" }}>Empenhos</div>
                </div>
                <div style={S.statDivider} />
                <div style={S.statItem}>
                  <div style={{ fontSize: 20, fontWeight: 800, color: "#a78bfa" }}>
                    {paineis.filter(p => p.tipo === "rp").length}
                  </div>
                  <div style={{ fontSize: 10, color: "#475569" }}>RP</div>
                </div>
              </div>
            </div>
          )}

          {/* Modelos disponíveis */}
          <div style={{ padding: "0 16px 24px" }}>
            <div style={S.sideLabel}>Modelos</div>
            {(Object.entries(TIPO_META) as [string, typeof TIPO_META[string]][]).map(([tipo, meta]) => (
              <div key={tipo} style={{ ...S.modeloItem, borderLeftColor: meta.color }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: "#cbd5e1" }}>{meta.label}</div>
                <div style={{ fontSize: 11, color: "#475569", marginTop: 2, lineHeight: 1.4 }}>{meta.desc}</div>
                <div style={{ marginTop: 6 }}>
                  <span style={{ fontSize: 10, color: "#334155", background: "#1e2a3a",
                    borderRadius: 4, padding: "2px 7px" }}>
                    Videoaula disponível em breve
                  </span>
                </div>
              </div>
            ))}
          </div>
        </aside>

        {/* Área principal */}
        <main style={S.main}>

          {/* Header da área */}
          <div style={S.mainHeader}>
            <div>
              <div style={{ fontSize: 16, fontWeight: 700, color: "#e2e8f0" }}>Meus Painéis</div>
              <div style={{ fontSize: 12, color: "#475569", marginTop: 2 }}>
                {paineis.length > 0
                  ? `${paineis.length} painel${paineis.length > 1 ? "s" : ""} configurado${paineis.length > 1 ? "s" : ""}`
                  : "Nenhum painel configurado ainda"}
              </div>
            </div>
            <button onClick={() => setShowForm(f => !f)} style={showForm ? S.cancelBtn : S.addBtn}>
              {showForm ? "Cancelar" : "+ Novo painel"}
            </button>
          </div>

          {/* Formulário */}
          {showForm && (
            <div style={{ ...S.formCard, marginBottom: 24 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: "#94a3b8", textTransform: "uppercase",
                letterSpacing: "0.06em", marginBottom: 18, paddingBottom: 12,
                borderBottom: "1px solid #1e2a3a" }}>
                Configurar novo painel
              </div>

              <div style={S.formRow}>
                <label style={S.label}>Nome do painel *</label>
                <input value={formNome} onChange={e => setFormNome(e.target.value)}
                  placeholder="Ex: Empenhos HAMN 2026" style={S.input} />
              </div>

              <div style={S.formRow}>
                <label style={S.label}>Tipo *</label>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" as const }}>
                  {(["empenhos", "rp"] as const).map(t => (
                    <button key={t} onClick={() => setFormTipo(t)} style={{
                      ...S.typeBtn,
                      borderColor: formTipo === t ? TIPO_META[t].color : "#1e2a3a",
                      color:       formTipo === t ? TIPO_META[t].color : "#64748b",
                      background:  formTipo === t ? `${TIPO_META[t].color}12` : "transparent",
                    }}>
                      {TIPO_META[t].label}
                    </button>
                  ))}
                </div>
              </div>

              <div style={S.formRow}>
                <label style={S.label}>URL da planilha Google Sheets *</label>
                <input value={formUrl} onChange={e => setFormUrl(e.target.value)}
                  placeholder="https://docs.google.com/spreadsheets/d/..." style={S.input} />
                <div style={{ fontSize: 11, color: "#334155", marginTop: 5 }}>
                  A planilha deve ser pública ou com acesso liberado (sem necessidade de login).
                </div>
              </div>

              <div style={S.formRow}>
                <label style={S.label}>Sigla da unidade (opcional)</label>
                <input value={formUnidade} onChange={e => setFormUnidade(e.target.value)}
                  placeholder="Ex: HAMN" style={{ ...S.input, maxWidth: 180 }} />
              </div>

              {saveErr && <div style={{ fontSize: 12, color: "#f87171", marginBottom: 12 }}>{saveErr}</div>}

              <div style={{ display: "flex", gap: 8 }}>
                <button onClick={handleSave} disabled={saving} style={S.saveBtn}>
                  {saving ? "Salvando..." : "Salvar painel"}
                </button>
                <button onClick={() => setShowForm(false)} style={S.cancelBtn}>Cancelar</button>
              </div>
            </div>
          )}

          {/* Lista vazia */}
          {paineis.length === 0 && !showForm && (
            <div style={S.emptyState}>
              <div style={{ width: 40, height: 40, borderRadius: 10, background: "#161b27",
                border: "1px solid #1e2a3a", display: "flex", alignItems: "center",
                justifyContent: "center", marginBottom: 14 }}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#334155" strokeWidth="1.5">
                  <rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M9 21V9"/>
                </svg>
              </div>
              <div style={{ fontSize: 14, fontWeight: 600, color: "#475569" }}>Nenhum painel configurado</div>
              <div style={{ fontSize: 12, color: "#334155", marginTop: 6 }}>
                Clique em <strong style={{ color: "#94a3b8" }}>+ Novo painel</strong> para conectar uma planilha.
              </div>
            </div>
          )}

          {/* Grid de painéis */}
          <div style={S.grid}>
            {paineis.map(panel => {
              const meta = TIPO_META[panel.tipo];
              return (
                <div key={panel.id} style={S.panelCard}>
                  <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 14 }}>
                    <span style={{ ...S.tipoAbbrBadge, background: `${meta.color}18`, color: meta.color, borderColor: `${meta.color}40` }}>
                      {meta.abbr}
                    </span>
                    {deletingId === panel.id ? (
                      <div style={{ display: "flex", gap: 6 }}>
                        <button onClick={() => handleDelete(panel.id)} style={S.confirmBtn}>Excluir</button>
                        <button onClick={() => setDeletingId(null)} style={S.undoBtn}>Cancelar</button>
                      </div>
                    ) : (
                      <button onClick={() => setDeletingId(panel.id)} style={S.removeBtn} title="Remover painel">
                        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5">
                          <path d="M1 1l10 10M11 1L1 11"/>
                        </svg>
                      </button>
                    )}
                  </div>

                  <div style={{ fontSize: 14, fontWeight: 700, color: "#e2e8f0", lineHeight: 1.3, marginBottom: 4 }}>
                    {panel.nome}
                  </div>
                  {panel.unidade && (
                    <div style={{ fontSize: 11, color: "#475569", marginBottom: 2 }}>{panel.unidade}</div>
                  )}
                  <div style={{ fontSize: 11, color: "#334155", marginBottom: 14 }}>
                    {meta.label} · {new Date(panel.criado_em).toLocaleDateString("pt-BR")}
                  </div>

                  <button onClick={() => setViewingPanel(panel)} style={{ ...S.openBtn, borderColor: meta.color, color: meta.color }}>
                    Abrir painel
                  </button>
                </div>
              );
            })}
          </div>

        </main>
      </div>
    </div>
  );
}

// ── Estilos ───────────────────────────────────────────────────────────────────

const S: Record<string, React.CSSProperties> = {
  page: {
    minHeight: "100vh",
    background: "#0a0f1a",
    fontFamily: "'Inter', system-ui, sans-serif",
    color: "#e2e8f0",
  },

  // topbar
  topbar: {
    height: 60,
    background: "#0d1117",
    borderBottom: "1px solid #161b27",
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "0 20px",
    position: "sticky" as const,
    top: 0,
    zIndex: 40,
  },
  logoDot: {
    width: 8,
    height: 8,
    borderRadius: "50%",
    background: "linear-gradient(135deg, #22d3ee, #a78bfa)",
  },
  backBtn: {
    background: "none",
    border: "1px solid #1e2a3a",
    color: "#64748b",
    borderRadius: 8,
    padding: "6px 14px",
    fontSize: 12,
    cursor: "pointer",
    fontFamily: "inherit",
    whiteSpace: "nowrap" as const,
  },
  userChip: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    background: "#161b27",
    border: "1px solid #1e2a3a",
    borderRadius: 10,
    padding: "6px 12px 6px 6px",
  },
  avatarSm: {
    width: 30,
    height: 30,
    borderRadius: "50%",
    objectFit: "cover" as const,
    border: "1.5px solid #1e2a3a",
  },

  // sidebar
  sidebar: {
    width: 240,
    flexShrink: 0,
    borderRight: "1px solid #161b27",
    display: "flex",
    flexDirection: "column" as const,
  },
  userCard: {
    padding: "28px 20px 20px",
    borderBottom: "1px solid #161b27",
    display: "flex",
    flexDirection: "column" as const,
    alignItems: "center",
  },
  avatarWrap: {
    position: "relative" as const,
    display: "inline-block",
  },
  avatarLg: {
    width: 80,
    height: 80,
    borderRadius: "50%",
    objectFit: "cover" as const,
    border: "2px solid #1e2a3a",
    display: "block",
  },
  avatarOnline: {
    position: "absolute" as const,
    bottom: 3,
    right: 3,
    width: 12,
    height: 12,
    borderRadius: "50%",
    background: "#4ade80",
    border: "2px solid #0a0f1a",
  },
  setorBadge: {
    fontSize: 10,
    fontWeight: 700,
    letterSpacing: "0.08em",
    color: "#22d3ee",
    background: "rgba(34,211,238,0.08)",
    border: "1px solid rgba(34,211,238,0.2)",
    borderRadius: 6,
    padding: "2px 8px",
    textTransform: "uppercase" as const,
  },
  userStats: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 0,
    marginTop: 16,
    width: "100%",
    background: "#0d1117",
    borderRadius: 10,
    border: "1px solid #161b27",
    padding: "10px 0",
  },
  statItem: {
    flex: 1,
    textAlign: "center" as const,
  },
  statDivider: {
    width: 1,
    height: 28,
    background: "#161b27",
  },

  // sidebar modelos
  sideLabel: {
    fontSize: 10,
    fontWeight: 700,
    color: "#334155",
    textTransform: "uppercase" as const,
    letterSpacing: "0.08em",
    padding: "20px 0 8px",
  },
  modeloItem: {
    borderLeft: "2px solid transparent",
    paddingLeft: 10,
    marginBottom: 14,
  },

  // main area
  main: {
    flex: 1,
    padding: "24px 28px",
    minWidth: 0,
  },
  mainHeader: {
    display: "flex",
    alignItems: "flex-start",
    justifyContent: "space-between",
    marginBottom: 20,
  },
  addBtn: {
    background: "#22d3ee",
    color: "#0a0f1a",
    border: "none",
    borderRadius: 8,
    padding: "7px 16px",
    fontSize: 12,
    fontWeight: 700,
    cursor: "pointer",
    fontFamily: "inherit",
    whiteSpace: "nowrap" as const,
  },
  cancelBtn: {
    background: "none",
    border: "1px solid #1e2a3a",
    color: "#64748b",
    borderRadius: 8,
    padding: "7px 16px",
    fontSize: 12,
    fontWeight: 600,
    cursor: "pointer",
    fontFamily: "inherit",
  },

  // form
  formCard: {
    background: "#0d1117",
    border: "1px solid #1e2a3a",
    borderRadius: 14,
    padding: "20px 22px",
  },
  formRow: { marginBottom: 14 },
  label: {
    display: "block",
    fontSize: 10,
    fontWeight: 700,
    color: "#475569",
    textTransform: "uppercase" as const,
    letterSpacing: "0.07em",
    marginBottom: 6,
  },
  input: {
    width: "100%",
    background: "#161b27",
    border: "1px solid #1e2a3a",
    borderRadius: 8,
    color: "#e2e8f0",
    fontSize: 13,
    padding: "8px 12px",
    outline: "none",
    boxSizing: "border-box" as const,
    fontFamily: "inherit",
  },
  typeBtn: {
    border: "1px solid",
    borderRadius: 8,
    padding: "6px 14px",
    fontSize: 12,
    fontWeight: 600,
    cursor: "pointer",
    fontFamily: "inherit",
    transition: "all 0.12s",
  },
  saveBtn: {
    background: "#22d3ee",
    color: "#0a0f1a",
    border: "none",
    borderRadius: 8,
    padding: "8px 20px",
    fontSize: 12,
    fontWeight: 700,
    cursor: "pointer",
    fontFamily: "inherit",
  },

  // empty state
  emptyState: {
    border: "1px dashed #1e2a3a",
    borderRadius: 14,
    padding: "48px 24px",
    textAlign: "center" as const,
    display: "flex",
    flexDirection: "column" as const,
    alignItems: "center",
  },

  // panel cards
  grid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))",
    gap: 14,
  },
  panelCard: {
    background: "#0d1117",
    border: "1px solid #1e2a3a",
    borderRadius: 12,
    padding: "16px 18px",
    transition: "border-color 0.15s",
  },
  tipoAbbrBadge: {
    fontSize: 10,
    fontWeight: 800,
    letterSpacing: "0.06em",
    border: "1px solid",
    borderRadius: 6,
    padding: "2px 8px",
  },
  removeBtn: {
    background: "none",
    border: "none",
    color: "#334155",
    cursor: "pointer",
    padding: 4,
    borderRadius: 4,
    display: "flex",
    alignItems: "center",
    lineHeight: 1,
  },
  confirmBtn: {
    fontSize: 11,
    color: "#f87171",
    background: "rgba(248,113,113,0.08)",
    border: "1px solid rgba(248,113,113,0.25)",
    borderRadius: 6,
    padding: "2px 9px",
    cursor: "pointer",
    fontFamily: "inherit",
  },
  undoBtn: {
    fontSize: 11,
    color: "#475569",
    background: "#161b27",
    border: "1px solid #1e2a3a",
    borderRadius: 6,
    padding: "2px 9px",
    cursor: "pointer",
    fontFamily: "inherit",
  },
  openBtn: {
    display: "block",
    width: "100%",
    textAlign: "center" as const,
    background: "none",
    border: "1px solid",
    borderRadius: 8,
    padding: "7px 0",
    fontSize: 12,
    fontWeight: 600,
    cursor: "pointer",
    fontFamily: "inherit",
    transition: "opacity 0.15s",
  },
};
