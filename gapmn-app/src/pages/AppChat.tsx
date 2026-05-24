import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { supabase } from "../lib/supabase";
import { usePush } from "../lib/usePush";
import FeedNoticias from "../components/FeedNoticias";

// ── Paleta ───────────────────────────────────────────────────────────────────
const P = {
  navy:   "#062B49",
  accent: "#2563EB",
  text:   "#0F172A",
  muted:  "#64748B",
  border: "#E2E8F0",
};

// ── Tipos ────────────────────────────────────────────────────────────────────
type UserHeader = {
  id?: string;
  nome: string;
  avatarKey?: string | null;
  setor?: "SEO" | "SCON" | "SLIC" | "ADMIN" | null;
};
type KPIs = { empenhos: number; processos: number; contratos: number; il: number; atas: number };

function formatSetor(s: string | null | undefined): string {
  switch ((s ?? "").toUpperCase()) {
    case "SLIC":  return "Seção de Licitações";
    case "SEO":   return "Seção de Execução Orçamentária";
    case "SCON":  return "Seção de Contratos";
    case "ADMIN": return "Administração";
    default:      return s ?? "-";
  }
}

// ── Ícones SVG ───────────────────────────────────────────────────────────────
function IcClipboard({ className = "h-6 w-6" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
      <path d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2" />
      <rect x="9" y="3" width="6" height="4" rx="1" />
      <line x1="9" y1="12" x2="15" y2="12" strokeLinecap="round" />
      <line x1="9" y1="16" x2="13" y2="16" strokeLinecap="round" />
    </svg>
  );
}
function IcChart({ className = "h-6 w-6" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
      <rect x="3" y="12" width="4" height="9" rx="1" />
      <rect x="10" y="7" width="4" height="14" rx="1" />
      <rect x="17" y="3" width="4" height="18" rx="1" />
    </svg>
  );
}
function IcWrench({ className = "h-6 w-6" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
      <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />
    </svg>
  );
}
function IcCoins({ className = "h-5 w-5" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
      <circle cx="8" cy="14" r="5" />
      <path d="M19 5c0 2.76-2.24 5-5 5" />
      <path d="M14 5c0 2.76-2.24 5-5 5" strokeDasharray="2 2" />
      <circle cx="16" cy="5" r="3" />
    </svg>
  );
}
function IcProcess({ className = "h-5 w-5" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
      <path d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2" />
      <rect x="9" y="3" width="6" height="4" rx="1" />
      <path d="M9 12l2 2 4-4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
function IcContract({ className = "h-5 w-5" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
      <line x1="8" y1="13" x2="16" y2="13" strokeLinecap="round" />
      <line x1="8" y1="17" x2="12" y2="17" strokeLinecap="round" />
    </svg>
  );
}
function IcIndicator({ className = "h-5 w-5" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
      <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
function IcAta({ className = "h-5 w-5" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
      <path d="M12 2L2 7l10 5 10-5-10-5z" />
      <path d="M2 17l10 5 10-5" />
      <path d="M2 12l10 5 10-5" />
    </svg>
  );
}
function IcBell({ className = "h-5 w-5" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
      <path d="M13.73 21a2 2 0 0 1-3.46 0" />
    </svg>
  );
}
function IcBellOff({ className = "h-5 w-5" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M13.73 21a2 2 0 0 1-3.46 0" />
      <path d="M18.63 13A17.89 17.89 0 0 1 18 8" />
      <path d="M6.26 6.26A5.86 5.86 0 0 0 6 8c0 7-3 9-3 9h14" />
      <path d="M18 8a6 6 0 0 0-9.33-5" />
      <line x1="1" y1="1" x2="23" y2="23" strokeLinecap="round" />
    </svg>
  );
}
function IcLogout({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
      <polyline points="16 17 21 12 16 7" />
      <line x1="21" y1="12" x2="9" y2="12" />
    </svg>
  );
}
function IcArrow({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
      <polyline points="9 18 15 12 9 6" />
    </svg>
  );
}

// ── KPI card ─────────────────────────────────────────────────────────────────
type KpiProps = { icon: React.ReactNode; value: number; label: string; color: string };

function KpiCard({ icon, value, label, color }: KpiProps) {
  return (
    <motion.div
      whileHover={{ y: -2, boxShadow: `0 6px 20px ${color}20` }}
      className="flex flex-col items-center gap-1.5 rounded-2xl px-5 py-4 text-center"
      style={{
        background:     "rgba(255,255,255,0.75)",
        backdropFilter: "blur(8px)",
        border:         "1px solid rgba(255,255,255,0.9)",
        boxShadow:      "0 2px 12px rgba(15,23,42,0.06)",
      }}
    >
      <div className="flex h-9 w-9 items-center justify-center rounded-xl"
        style={{ background: `${color}18`, color }}>
        {icon}
      </div>
      <div className="text-2xl font-extrabold" style={{ color: P.text }}>{value}</div>
      <div className="text-xs font-medium" style={{ color: P.muted }}>{label}</div>
    </motion.div>
  );
}

// ── Nav card ─────────────────────────────────────────────────────────────────
type NavCardProps = {
  onClick: () => void;
  bg: string; border: string;
  iconBg: string; iconColor: string;
  titleColor: string; descColor: string;
  gradientFrom: string; gradientTo: string;
  title: string; desc: string;
  icon: React.ReactNode;
  delay: number;
};

function NavCard({ onClick, iconBg, iconColor, titleColor, descColor, gradientFrom, gradientTo, border, title, desc, icon, delay }: NavCardProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 18 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.42, ease: "easeOut", delay }}
      whileHover={{ y: -4, boxShadow: `0 12px 32px ${iconColor}20` }}
    >
      <button
        onClick={onClick}
        className="w-full rounded-2xl border p-6 text-left transition-all"
        style={{
          background:  `linear-gradient(140deg, ${gradientFrom} 0%, ${gradientTo} 100%)`,
          borderColor: border,
        }}
      >
        <div className="flex items-start justify-between mb-4">
          <div className="flex h-13 w-13 items-center justify-center rounded-2xl p-3"
            style={{ background: iconBg, color: iconColor }}>
            {icon}
          </div>
          <span className="mt-1 opacity-40" style={{ color: iconColor }}>
            <IcArrow className="h-5 w-5" />
          </span>
        </div>
        <div className="text-[15px] font-bold mb-1" style={{ color: titleColor }}>{title}</div>
        <div className="text-sm" style={{ color: descColor }}>{desc}</div>
      </button>
    </motion.div>
  );
}

// ── Modal de perfil ──────────────────────────────────────────────────────────
const AVATAR_OPTIONS = [
  "grad_homem", "grad_mulher",
  "7_homem",    "7_mulher",
  "10_homem",   "10_mulher",
];

function ProfileModal({ userId, currentNome, currentAvatarKey, onClose, onSaved }: {
  userId: string;
  currentNome: string;
  currentAvatarKey: string | null;
  onClose: () => void;
  onSaved: (nome: string, avatarKey: string | null) => void;
}) {
  const [nome,         setNome]         = useState(currentNome);
  const [avatarKey,    setAvatarKey]    = useState<string | null>(currentAvatarKey);
  const [novaSenha,    setNovaSenha]    = useState("");
  const [confirmSenha, setConfirmSenha] = useState("");
  const [saving,       setSaving]       = useState(false);
  const [msg,          setMsg]          = useState<{ type: "ok" | "err"; text: string } | null>(null);

  async function salvar() {
    setSaving(true);
    setMsg(null);
    try {
      const { error: e1 } = await supabase
        .from("profiles")
        .update({ nome_guerra: nome.trim(), avatar_key: avatarKey })
        .eq("id", userId);
      if (e1) throw e1;

      if (novaSenha) {
        if (novaSenha !== confirmSenha) throw new Error("Senhas não conferem");
        if (novaSenha.length < 6)       throw new Error("Senha muito curta (mínimo 6 caracteres)");
        const { error: e2 } = await supabase.auth.updateUser({ password: novaSenha });
        if (e2) throw e2;
      }

      setMsg({ type: "ok", text: "Perfil atualizado com sucesso!" });
      onSaved(nome.trim(), avatarKey);
    } catch (err: unknown) {
      setMsg({ type: "err", text: err instanceof Error ? err.message : String(err) });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
          <div className="text-sm font-bold text-slate-800">✏️ Editar Perfil</div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 text-xl px-1 leading-none">✕</button>
        </div>

        <div className="p-5 space-y-4">
          {/* Avatar */}
          <div>
            <label className="block text-xs font-semibold text-slate-500 mb-2">Avatar</label>
            <div className="grid grid-cols-4 gap-2">
              {AVATAR_OPTIONS.map((k) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => setAvatarKey(k)}
                  className={`rounded-xl border-2 overflow-hidden transition-all ${
                    avatarKey === k ? "border-sky-500 shadow-md" : "border-slate-200 hover:border-sky-200"
                  }`}
                >
                  <img
                    src={`/${k}.png`}
                    alt={k}
                    className="w-full h-16 object-cover"
                    onError={(e) => { (e.currentTarget as HTMLImageElement).src = "/grad_homem.png"; }}
                  />
                </button>
              ))}
            </div>
          </div>

          {/* Nome */}
          <div>
            <label className="block text-xs font-semibold text-slate-500 mb-1">Nome de Guerra</label>
            <input
              value={nome}
              onChange={(e) => setNome(e.target.value)}
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-200"
            />
          </div>

          {/* Senha */}
          <div className="border-t border-slate-100 pt-4 space-y-2">
            <div className="text-xs font-semibold text-slate-500">Alterar senha (opcional)</div>
            <input
              type="password"
              placeholder="Nova senha"
              value={novaSenha}
              onChange={(e) => setNovaSenha(e.target.value)}
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-200"
            />
            <input
              type="password"
              placeholder="Confirmar nova senha"
              value={confirmSenha}
              onChange={(e) => setConfirmSenha(e.target.value)}
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-200"
            />
          </div>

          {msg && (
            <div className={`rounded-lg px-3 py-2 text-xs ${
              msg.type === "ok"
                ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
                : "bg-red-50 text-red-700 border border-red-200"
            }`}>{msg.text}</div>
          )}
        </div>

        <div className="px-5 pb-5">
          <button
            onClick={salvar}
            disabled={saving}
            className="w-full rounded-xl bg-sky-600 text-white py-2.5 text-sm font-semibold hover:bg-sky-700 transition-colors disabled:opacity-50"
          >
            {saving ? "Salvando…" : "Salvar alterações"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Componente principal ─────────────────────────────────────────────────────
export default function AppChat() {
  const nav = useNavigate();
  const [me, setMe] = useState<UserHeader>({ nome: "Usuário" });
  const [loggingOut, setLoggingOut] = useState(false);
  const [showProfile, setShowProfile] = useState(false);
  const [kpis, setKpis] = useState<KPIs>({ empenhos: 0, processos: 0, contratos: 0, il: 0, atas: 0 });

  const { state: pushState, subscribe: pushSubscribe, unsubscribe: pushUnsubscribe } = usePush(me.id ?? null);

  const isAgent = !!(me.setor);
  const canCreateFeed = me.setor === "ADMIN" || me.setor === "SCON" || me.setor === "SLIC" || me.setor === "SEO";

  useEffect(() => {
    (async () => {
      const { data: sess } = await supabase.auth.getSession();
      const user = sess.session?.user;
      if (!user) return;

      const { data: prof } = await supabase
        .from("profiles")
        .select("nome_guerra, avatar_key, setor")
        .eq("id", user.id)
        .maybeSingle();

      const email     = user.email ?? null;
      const nome      = (prof as any)?.nome_guerra || (user.user_metadata as any)?.nome_guerra || (email ? email.split("@")[0] : "Usuário");
      const avatarKey = (prof as any)?.avatar_key || (user.user_metadata as any)?.avatar_key || null;
      const setorP    = ((prof as any)?.setor as UserHeader["setor"]) ?? null;
      setMe({ id: user.id, nome, avatarKey, setor: setorP });

      // Contagens para KPIs
      const today = new Date().toISOString().split("T")[0];
      const [r1, r2, r3, r4, r5] = await Promise.all([
        supabase.from("siloms_ne_identificadores").select("ne_siafi")
          .ilike("ne_siafi", "2026NE0_____")
          .order("ne_siafi", { ascending: false })
          .limit(1),
        supabase.from("processos_licitatorios").select("*", { count: "exact", head: true }),
        supabase.from("contratos_scon").select("*", { count: "exact", head: true }),
        supabase.from("indicadores_lotacao").select("*", { count: "exact", head: true }),
        supabase.from("atas_gap_mn").select("*", { count: "exact", head: true })
          .gte("vigencia_final", today)
          .not("situacao", "ilike", "%cancelad%"),
      ]);

      // Extrai número sequencial da última NE no padrão 2026NE0XXXXX (últimos 5 chars)
      const lastNE: string = (r1.data?.[0] as any)?.ne_siafi ?? "";
      const neNum = parseInt(lastNE.slice(-5) || "0", 10);

      setKpis({
        empenhos:  neNum,
        processos: r2.count ?? 0,
        contratos: r3.count ?? 0,
        il:        r4.count ?? 0,
        atas:      r5.count ?? 0,
      });
    })();
  }, []);

  async function handleLogout() {
    setLoggingOut(true);
    try {
      await supabase.auth.signOut();
      nav("/", { replace: true });
    } finally {
      setLoggingOut(false);
    }
  }

  function goToTab(tab: string) {
    nav(`/setor?tab=${tab}`);
  }

  const avatarSrc = me.avatarKey ? `/${me.avatarKey}.png` : "/grad_homem.png";

  return (
    <div className="space-y-6">

      {/* Modal de perfil */}
      {showProfile && me.id && (
        <ProfileModal
          userId={me.id}
          currentNome={me.nome}
          currentAvatarKey={me.avatarKey ?? null}
          onClose={() => setShowProfile(false)}
          onSaved={(nome, avatarKey) => {
            setMe((prev) => ({ ...prev, nome, avatarKey }));
            setShowProfile(false);
          }}
        />
      )}

      {/* ── Hero card do usuário ─────────────────────────────────────────── */}
      <motion.div
        initial={{ opacity: 0, y: 18 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.45, ease: "easeOut" }}
        className="rounded-2xl border p-6 md:p-8"
        style={{
          background:  "linear-gradient(140deg, #EAF3FF 0%, #F0F7FF 55%, #FFFFFF 100%)",
          borderColor: "#CBE0F7",
          boxShadow:   "0 2px 20px rgba(37,99,235,0.07)",
        }}
      >
        <div className="flex flex-col md:flex-row md:items-center gap-6 md:gap-8">

          {/* Avatar + info + ações */}
          <div className="flex items-center gap-5 min-w-0 flex-1">
            {/* Avatar */}
            <div className="relative flex-shrink-0">
              <div className="h-20 w-20 md:h-24 md:w-24 rounded-full border-4 border-white overflow-hidden"
                style={{ boxShadow: "0 0 0 4px rgba(37,99,235,0.12), 0 8px 28px rgba(0,0,0,0.12)" }}>
                <img
                  src={avatarSrc}
                  alt="Avatar"
                  className="h-full w-full object-cover"
                  onError={(e) => { (e.currentTarget as HTMLImageElement).src = "/grad_homem.png"; }}
                />
              </div>
              {/* Indicador online */}
              <div className="absolute bottom-1 right-1 h-4 w-4 rounded-full border-2 border-white bg-green-500"
                style={{ boxShadow: "0 0 0 2px #22c55e40" }} />
            </div>

            {/* Nome + setor */}
            <div className="min-w-0 flex-1">
              <div className="text-xl font-bold truncate" style={{ color: P.text }}>
                Olá, {me.nome}!
              </div>
              {me.setor && (
                <div className="text-sm mt-0.5" style={{ color: P.muted }}>
                  {formatSetor(me.setor)}
                </div>
              )}

              {/* Botões de ação */}
              <div className="flex items-center gap-2 mt-3">
                {/* Editar perfil */}
                <button
                  onClick={() => setShowProfile(true)}
                  title="Editar perfil"
                  className="flex h-9 w-9 items-center justify-center rounded-xl border transition-colors"
                  style={{ borderColor: P.border, background: "white", color: P.muted, boxShadow: "0 1px 4px rgba(0,0,0,0.06)" }}
                >
                  ✏️
                </button>

                {pushState !== "unsupported" && (
                  <button
                    title={
                      pushState === "subscribed" ? "Notificações ativas"
                      : pushState === "denied"   ? "Notificações bloqueadas"
                      : "Ativar notificações"
                    }
                    disabled={pushState === "loading" || pushState === "denied"}
                    onClick={() => pushState === "subscribed" ? pushUnsubscribe() : pushSubscribe()}
                    className="relative flex h-9 w-9 items-center justify-center rounded-xl border transition-colors disabled:opacity-40"
                    style={{
                      borderColor: pushState === "subscribed" ? "#FBD38D" : P.border,
                      background:  pushState === "subscribed" ? "#FFFBEB"
                                 : pushState === "denied"     ? "#FEF2F2"
                                 : "white",
                      color:       pushState === "subscribed" ? "#B45309"
                                 : pushState === "denied"     ? "#EF4444"
                                 : P.muted,
                      boxShadow:  "0 1px 4px rgba(0,0,0,0.06)",
                    }}
                  >
                    {pushState === "denied" ? <IcBellOff /> : <IcBell />}
                    {pushState === "subscribed" && (
                      <span className="absolute -top-0.5 -right-0.5 h-2 w-2 rounded-full border-2 border-white bg-amber-400" />
                    )}
                  </button>
                )}

                <button
                  onClick={handleLogout}
                  disabled={loggingOut}
                  className="flex items-center gap-1.5 rounded-xl border px-3 py-2 text-xs font-medium transition-colors hover:bg-red-50 disabled:opacity-50"
                  style={{ borderColor: P.border, color: P.muted, background: "white", boxShadow: "0 1px 4px rgba(0,0,0,0.06)" }}
                >
                  <IcLogout />
                  {loggingOut ? "Saindo..." : "Sair"}
                </button>
              </div>
            </div>
          </div>

          {/* KPI cards */}
          <div className="grid grid-cols-3 md:grid-cols-5 gap-3 flex-shrink-0 w-full md:w-auto">
            <KpiCard icon={<IcCoins />}     value={kpis.empenhos}  label="Empenhos"  color="#2563EB" />
            <KpiCard icon={<IcProcess />}   value={kpis.processos} label="Processos" color="#7C3AED" />
            <KpiCard icon={<IcContract />}  value={kpis.contratos} label="Contratos" color="#0F9B6B" />
            <KpiCard icon={<IcIndicator />} value={kpis.il}        label="IL"        color="#F59E0B" />
            <KpiCard icon={<IcAta />}       value={kpis.atas}      label="ATAs Ativas" color="#E11D48" />
          </div>
        </div>
      </motion.div>

      {/* ── Conteúdo principal ──────────────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-[420px_1fr] gap-5 items-start">

        {/* Coluna esquerda — cards de navegação */}
        <div className="space-y-3">
          <NavCard
            delay={0.08}
            onClick={() => nav("/setor")}
            bg=""
            gradientFrom="#EAF3FF" gradientTo="#DBEAFE"
            border="#C3D9FA"
            iconBg="rgba(37,99,235,0.12)"  iconColor="#2563EB"
            titleColor={P.navy}            descColor="#3B6EBF"
            title="Gerenciamentos"
            desc="Contratos · Processos · Indicadores de Lotação"
            icon={<IcClipboard className="h-6 w-6" />}
          />
          <NavCard
            delay={0.14}
            onClick={() => nav("/orcamento")}
            bg=""
            gradientFrom="#EAFBF2" gradientTo="#DCFCE7"
            border="#A7DFBC"
            iconBg="rgba(34,197,94,0.12)"  iconColor="#16A34A"
            titleColor="#14532D"           descColor="#15803D"
            title="Painéis Gerenciais"
            desc="Orçamentário · Empenhos · Restos a Pagar"
            icon={<IcChart className="h-6 w-6" />}
          />
          <NavCard
            delay={0.20}
            onClick={() => nav("/ferramentas")}
            bg=""
            gradientFrom="#F3EFFF" gradientTo="#EDE9FE"
            border="#C4B6F5"
            iconBg="rgba(124,58,237,0.12)"  iconColor="#7C3AED"
            titleColor="#3B0D91"            descColor="#6D28D9"
            title="Ferramentas &amp; Catálogo"
            desc="Robôs · Automações · Guia do sistema"
            icon={<IcWrench className="h-6 w-6" />}
          />
        </div>

        {/* Coluna direita — feed de atualizações */}
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.45, ease: "easeOut", delay: 0.1 }}
          className="rounded-2xl border bg-white overflow-hidden"
          style={{ borderColor: P.border, boxShadow: "0 2px 12px rgba(15,23,42,0.05)" }}
        >
          <div className="px-5 pt-5 pb-3 border-b" style={{ borderColor: P.border }}>
            <h2 className="text-sm font-bold" style={{ color: P.text }}>Atualizações</h2>
            <p className="text-xs mt-0.5" style={{ color: P.muted }}>
              Atividades recentes do sistema
            </p>
          </div>
          <div className="p-5">
            <FeedNoticias
              isLoggedIn
              canCreate={canCreateFeed}
              onNavigate={goToTab}
            />
          </div>
        </motion.div>
      </div>

      {isAgent && null}
    </div>
  );
}
