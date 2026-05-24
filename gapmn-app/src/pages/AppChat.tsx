import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { supabase } from "../lib/supabase";
import { Card } from "../components/Card";
import { usePush } from "../lib/usePush";
import FeedNoticias from "../components/FeedNoticias";

// ── Paleta ───────────────────────────────────────────────────────────────────
const P = {
  navy:    "#062B49",
  accent:  "#1E88E5",
  text:    "#061B33",
  muted:   "#64748B",
  border:  "#E2E8F0",
  bgBlue:  "#EAF6FF",
  bgGreen: "#EAFBF2",
  bgPurp:  "#F3EFFF",
};

// ── Tipos e helpers ──────────────────────────────────────────────────────────
type UserHeader = {
  id?: string;
  nome: string;
  avatarKey?: string | null;
  setor?: "SEO" | "SCON" | "SLIC" | "ADMIN" | null;
};

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
function IcArrow({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
      <polyline points="9 18 15 12 9 6" />
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

// ── Card de navegação ────────────────────────────────────────────────────────
type NavCardProps = {
  onClick: () => void;
  bg: string;
  border: string;
  iconBg: string;
  iconColor: string;
  titleColor: string;
  descColor: string;
  title: string;
  desc: string;
  icon: React.ReactNode;
  delay: number;
};

function NavCard({ onClick, bg, border, iconBg, iconColor, titleColor, descColor, title, desc, icon, delay }: NavCardProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: "easeOut", delay }}
      whileHover={{ y: -3 }}
    >
      <button
        onClick={onClick}
        className="w-full rounded-2xl border p-5 text-left transition-shadow hover:shadow-lg"
        style={{ background: bg, borderColor: border }}
      >
        <div className="flex items-start justify-between">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl"
            style={{ background: iconBg, color: iconColor }}>
            {icon}
          </div>
          <span style={{ color: iconColor, opacity: 0.5 }}>
            <IcArrow />
          </span>
        </div>
        <div className="mt-4 font-bold text-base" style={{ color: titleColor }}>
          {title}
        </div>
        <div className="mt-1 text-sm" style={{ color: descColor }}>
          {desc}
        </div>
      </button>
    </motion.div>
  );
}

// ── Componente principal ─────────────────────────────────────────────────────
export default function AppChat() {
  const nav = useNavigate();
  const [me, setMe] = useState<UserHeader>({ nome: "Usuário" });
  const [loggingOut, setLoggingOut] = useState(false);

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
    })();
  }, []);

  async function handleLogout() {
    setLoggingOut(true);
    try {
      await supabase.auth.signOut();
      nav("/login", { replace: true });
    } finally {
      setLoggingOut(false);
    }
  }

  function goToTab(tab: string) {
    nav(`/setor?tab=${tab}`);
  }

  const avatarSrc = me.avatarKey ? `/${me.avatarKey}.png` : "/grad_homem.png";

  return (
    <div className="space-y-5">

      {/* ── Card do usuário ─────────────────────────────────────────────── */}
      <motion.div
        initial={{ opacity: 0, y: 14 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.38, ease: "easeOut" }}
      >
        <Card>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-3 min-w-0">
              <img
                src={avatarSrc}
                alt="Avatar"
                className="h-11 w-11 shrink-0 rounded-xl border object-contain bg-white"
                style={{ borderColor: P.border }}
                onError={(e) => { (e.currentTarget as HTMLImageElement).src = "/grad_homem.png"; }}
              />
              <div className="min-w-0">
                <div className="text-sm font-bold leading-tight" style={{ color: P.text }}>
                  GAP-MN · Sistema de Gestão
                </div>
                <div className="text-xs mt-0.5 truncate" style={{ color: P.muted }}>
                  {me.nome}
                  {me.setor && <span className="ml-1">· {formatSetor(me.setor)}</span>}
                </div>
              </div>
            </div>

            <div className="flex items-center gap-2">
              {pushState !== "unsupported" && (
                <button
                  title={
                    pushState === "subscribed" ? "Notificações ativas — clique para desativar"
                    : pushState === "denied"   ? "Notificações bloqueadas pelo navegador"
                    : "Ativar notificações push"
                  }
                  disabled={pushState === "loading" || pushState === "denied"}
                  onClick={() => pushState === "subscribed" ? pushUnsubscribe() : pushSubscribe()}
                  className="relative flex h-9 w-9 items-center justify-center rounded-xl border transition-colors disabled:opacity-40"
                  style={{
                    borderColor: pushState === "subscribed" ? "#FBD38D" : P.border,
                    background:  pushState === "subscribed" ? "#FFFBEB"
                               : pushState === "denied"     ? "#FEF2F2"
                               : "#F8FAFC",
                    color:       pushState === "subscribed" ? "#B45309"
                               : pushState === "denied"     ? "#EF4444"
                               : P.muted,
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
                style={{ borderColor: P.border, color: P.muted }}
              >
                <IcLogout />
                {loggingOut ? "Saindo..." : "Sair"}
              </button>
            </div>
          </div>
        </Card>
      </motion.div>

      {/* ── Boas-vindas ─────────────────────────────────────────────────── */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.38, ease: "easeOut", delay: 0.07 }}
        className="px-1"
      >
        <h1 className="text-lg font-bold" style={{ color: P.text }}>
          Bem-vindo ao painel do GAP-MN
        </h1>
        <p className="text-sm mt-0.5" style={{ color: P.muted }}>
          Acesse rapidamente suas áreas, acompanhe novidades e gerencie suas atividades.
        </p>
      </motion.div>

      {/* ── Conteúdo principal ──────────────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-[400px_1fr] gap-5 items-start">

        {/* Coluna esquerda — cards de navegação */}
        <div className="space-y-3">
          <NavCard
            delay={0.10}
            onClick={() => nav("/setor")}
            bg={P.bgBlue}       border="#BFD9F5"
            iconBg="#D0E8FC"    iconColor={P.accent}
            titleColor={P.navy} descColor="#3B7EC8"
            title="Gerenciamentos"
            desc="Contratos · Processos · Indicadores de Lotação"
            icon={<IcClipboard className="h-5 w-5" />}
          />
          <NavCard
            delay={0.16}
            onClick={() => nav("/orcamento")}
            bg={P.bgGreen}      border="#B2EDD1"
            iconBg="#C6F0DC"    iconColor="#0F9B6B"
            titleColor="#064E2F" descColor="#168A5C"
            title="Painéis Gerenciais"
            desc="Orçamentário · Empenhos · Restos a Pagar"
            icon={<IcChart className="h-5 w-5" />}
          />
          <NavCard
            delay={0.22}
            onClick={() => nav("/ferramentas")}
            bg={P.bgPurp}       border="#D6C8F9"
            iconBg="#E4D9FD"    iconColor="#7C3AED"
            titleColor="#3B0D91" descColor="#6D34C5"
            title="Ferramentas & Catálogo"
            desc="Robôs · Automações · Guia do sistema"
            icon={<IcWrench className="h-5 w-5" />}
          />
        </div>

        {/* Coluna direita — feed */}
        <motion.div
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, ease: "easeOut", delay: 0.12 }}
        >
          <Card>
            <FeedNoticias
              isLoggedIn
              canCreate={canCreateFeed}
              onNavigate={goToTab}
            />
          </Card>
        </motion.div>
      </div>

      {isAgent && null}
    </div>
  );
}
