import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import {
  Home, FileText, Clipboard, Bookmark, Activity,
  TrendingUp, BarChart2, Wrench, Bell, BellOff, LogOut,
  ChevronLeft, ChevronRight, X, Menu, DollarSign, ArrowRight,
} from "lucide-react";
import { supabase } from "../lib/supabase";
import { usePush } from "../lib/usePush";
import FeedNoticias from "../components/FeedNoticias";

// ─── Paleta ───────────────────────────────────────────────────
const P = {
  navy:   "#071B34",
  fab:    "#0B4D91",
  light:  "#EAF4FF",
  ice:    "#F8FAFC",
  border: "#E2E8F0",
  text:   "#0F172A",
  muted:  "#64748B",
  gray:   "#94A3B8",
};

// ─── Tipos ────────────────────────────────────────────────────
type UserHeader = {
  id?: string;
  nome: string;
  avatarKey?: string | null;
  setor?: "SEO" | "SCON" | "SLIC" | "ADMIN" | "DEV" | null;
};
type KPIs = { empenhos: number; processos: number; contratos: number; il: number; atas: number };

type Panel = {
  id: string; title: string; icon: React.ElementType;
  color: string; bg: string; path: string; desc: string;
};

function formatSetor(s?: string | null) {
  switch ((s ?? "").toUpperCase()) {
    case "SLIC":  return "Seção de Licitações";
    case "SEO":   return "Seção de Execução Orçamentária";
    case "SCON":  return "Seção de Contratos";
    case "ADMIN": return "Administração";
    case "DEV":   return "Desenvolvimento";
    default:      return s ?? "";
  }
}

// ─── Nav ──────────────────────────────────────────────────────
const NAV_MAIN = [
  { id: "inicio",      label: "Início",                icon: Home,       path: "/app" },
  { id: "contratos",   label: "Contratos",             icon: FileText,   path: "/setor?tab=contratos" },
  { id: "processos",   label: "Processos",             icon: Clipboard,  path: "/setor?tab=processos" },
  { id: "atas",        label: "Atas de RP",            icon: Bookmark,   path: "/setor?tab=atas" },
  { id: "indicadores", label: "Indicadores de Lotação",icon: Activity,   path: "/setor?tab=indicadores" },
  { id: "empenhos",    label: "Empenhos",              icon: DollarSign, path: "/setor?tab=empenhos" },
  { id: "paineis",     label: "Painéis Gerenciais",    icon: BarChart2,  path: "/orcamento" },
];

// ─── Slides do card lateral ───────────────────────────────────
const SLIDES = [
  {
    bg:       "linear-gradient(150deg, #0B4D91 0%, #071B34 100%)",
    img:      "/acantus.png",
    title:    "Acantus",
    subtitle: "Símbolo da Intendência",
    desc:     "Representa o aprimoramento constante da administração, do suprimento e do apoio logístico, garantindo eficiência e sustentabilidade às operações.",
  },
  {
    bg:       "linear-gradient(150deg, #071B34 0%, #0B4D91 100%)",
    img:      "/gapmn.png",
    title:    "GAP-MN",
    subtitle: "Grupamento de Apoio de Manaus",
    desc:     "Responsável pelo apoio logístico e administrativo às organizações militares da Força Aérea Brasileira na região amazônica.",
  },
  {
    bg:       "linear-gradient(150deg, #1a2f50 0%, #0B4D91 100%)",
    img:      null,
    title:    "Sistema de Gestão",
    subtitle: "Controle e Transparência",
    desc:     "Plataforma integrada para gestão de contratos, processos licitatórios, empenhos e indicadores operacionais do GAP-MN.",
  },
];

// ─── Painéis ──────────────────────────────────────────────────
const PANELS: Panel[] = [
  { id: "orcamentario", title: "Painel Orçamentário", icon: BarChart2,  color: "#0B4D91", bg: "#EAF4FF", path: "/orcamento",             desc: "Crédito, dotação e execução orçamentária"  },
  { id: "empenhos",     title: "Painel de Empenhos",  icon: DollarSign, color: "#16A34A", bg: "#F0FDF4", path: "/orcamento",             desc: "NEs SIAFI, perfis e acompanhamento"         },
  { id: "rp",           title: "Painel de RP",        icon: TrendingUp, color: "#7C3AED", bg: "#F5F3FF", path: "/orcamento",             desc: "Restos a Pagar e liquidações"              },
  { id: "processos",    title: "Painel de Processos", icon: Clipboard,  color: "#D97706", bg: "#FFFBEB", path: "/setor?tab=processos",   desc: "Licitações, pregões e SRPs"                },
];

// ─── Rotating Card ────────────────────────────────────────────
function RotatingCard() {
  const [cur, setCur] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setCur(c => (c + 1) % SLIDES.length), 15000);
    return () => clearInterval(t);
  }, []);
  const s = SLIDES[cur];
  const prev = () => setCur(c => (c - 1 + SLIDES.length) % SLIDES.length);
  const next = () => setCur(c => (c + 1) % SLIDES.length);

  return (
    <div className="relative rounded-2xl overflow-hidden" style={{ background: s.bg }}>
      <AnimatePresence mode="wait">
        <motion.div key={cur}
          initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.35 }}
          className="px-4 pt-4 pb-1 text-center"
        >
          {s.img && (
            <div className="flex justify-center mb-2.5">
              <img src={s.img} alt={s.title} className="h-12 w-12 object-contain opacity-90"
                onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }} />
            </div>
          )}
          <div className="text-[13px] font-bold text-white leading-tight">{s.title}</div>
          <div className="text-[10px] mt-0.5 mb-2" style={{ color: "rgba(255,255,255,0.55)" }}>{s.subtitle}</div>
          <div className="text-[11px] leading-relaxed" style={{ color: "rgba(255,255,255,0.42)" }}>{s.desc}</div>
        </motion.div>
      </AnimatePresence>

      <div className="flex justify-center gap-1 py-3">
        {SLIDES.map((_, i) => (
          <button key={i} onClick={() => setCur(i)}
            className="rounded-full transition-all"
            style={{ height: 4, width: i === cur ? 16 : 5, background: i === cur ? "white" : "rgba(255,255,255,0.22)" }} />
        ))}
      </div>

      <button onClick={prev}
        className="absolute left-1.5 top-[40%] rounded-full p-1 hover:bg-white/10 transition-colors"
        style={{ background: "rgba(255,255,255,0.07)" }}>
        <ChevronLeft size={13} className="text-white/60" />
      </button>
      <button onClick={next}
        className="absolute right-1.5 top-[40%] rounded-full p-1 hover:bg-white/10 transition-colors"
        style={{ background: "rgba(255,255,255,0.07)" }}>
        <ChevronRight size={13} className="text-white/60" />
      </button>
    </div>
  );
}

// ─── Sidebar Content ──────────────────────────────────────────
function SidebarContent({ active, onNav }: { active: string; onNav: (path: string, id: string) => void }) {
  return (
    <div className="flex h-full flex-col" style={{ background: P.navy }}>
      {/* Brand */}
      <div className="flex items-center gap-3 px-5 py-5 border-b flex-shrink-0"
        style={{ borderColor: "rgba(255,255,255,0.07)" }}>
        <img src="/acantus.png" alt="Acantus" className="h-9 w-9 object-contain opacity-90 flex-shrink-0"
          onError={(e) => { (e.currentTarget as HTMLImageElement).style.opacity = "0"; }} />
        <div className="min-w-0">
          <div className="text-[12.5px] font-bold text-white leading-tight truncate">
            Grupamento de Apoio de Manaus
          </div>
          <div className="text-[10px] truncate" style={{ color: "rgba(255,255,255,0.38)" }}>
            Sistema de Gestão
          </div>
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto px-3 py-3 space-y-0.5">
        {NAV_MAIN.map(item => {
          const Icon = item.icon;
          const isActive = active === item.id;
          return (
            <button
              key={item.id}
              onClick={() => onNav(item.path, item.id)}
              className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-left text-[13px] transition-all group"
              style={{
                background: isActive ? "rgba(59,130,246,0.15)" : "transparent",
                color:      isActive ? "#60A5FA" : "rgba(255,255,255,0.52)",
                border:     isActive ? "1px solid rgba(59,130,246,0.2)" : "1px solid transparent",
              }}
              onMouseEnter={(e) => {
                if (!isActive) {
                  (e.currentTarget).style.background = "rgba(255,255,255,0.05)";
                  (e.currentTarget).style.color = "rgba(255,255,255,0.82)";
                }
              }}
              onMouseLeave={(e) => {
                if (!isActive) {
                  (e.currentTarget).style.background = "transparent";
                  (e.currentTarget).style.color = "rgba(255,255,255,0.52)";
                }
              }}
            >
              <Icon size={16} className="flex-shrink-0" />
              <span className="flex-1">{item.label}</span>
              {isActive && <span className="h-1.5 w-1.5 rounded-full flex-shrink-0" style={{ background: "#60A5FA" }} />}
            </button>
          );
        })}

        <div className="my-3 border-t" style={{ borderColor: "rgba(255,255,255,0.06)" }} />

        <button
          onClick={() => onNav("/ferramentas", "ferramentas")}
          className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-left text-[13px] transition-all"
          style={{ color: "rgba(255,255,255,0.4)" }}
          onMouseEnter={(e) => {
            (e.currentTarget).style.background = "rgba(255,255,255,0.05)";
            (e.currentTarget).style.color = "rgba(255,255,255,0.78)";
          }}
          onMouseLeave={(e) => {
            (e.currentTarget).style.background = "transparent";
            (e.currentTarget).style.color = "rgba(255,255,255,0.4)";
          }}
        >
          <Wrench size={16} className="flex-shrink-0" />
          <span>Ferramentas & Catálogo</span>
        </button>
      </nav>

      {/* Rotating card */}
      <div className="px-3 pb-4 flex-shrink-0">
        <RotatingCard />
      </div>
    </div>
  );
}

// ─── Header ───────────────────────────────────────────────────
function TopHeader({ me, pushState, onPush, onLogout, onMenuToggle, loggingOut }: {
  me: UserHeader; pushState: string;
  onPush: () => void; onLogout: () => void;
  onMenuToggle: () => void; loggingOut: boolean;
}) {
  const avatarSrc = me.avatarKey ? `/${me.avatarKey}.png` : "/7_homem.png";
  return (
    <header className="flex-shrink-0 flex items-center gap-4 px-5 bg-white border-b"
      style={{ height: 64, borderColor: P.border, boxShadow: "0 1px 6px rgba(15,23,42,0.05)", zIndex: 20 }}>

      <button onClick={onMenuToggle}
        className="md:hidden flex items-center justify-center rounded-xl border h-9 w-9 transition-colors hover:bg-slate-50"
        style={{ borderColor: P.border, color: P.muted }}>
        <Menu size={18} />
      </button>

      <div className="flex items-center gap-2.5">
        <img src="/gapmn.png" alt="GAP-MN"
          className="h-8 w-8 rounded-lg object-contain border border-slate-100 bg-white shadow-sm"
          onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }} />
        <span className="hidden sm:block text-[14px] font-bold tracking-tight" style={{ color: P.text }}>
          Aplicativo do GAP-MN
        </span>
      </div>

      <div className="ml-auto flex items-center gap-2.5">
        {pushState !== "unsupported" && (
          <button onClick={onPush} disabled={pushState === "loading" || pushState === "denied"}
            title={pushState === "subscribed" ? "Notificações ativas" : pushState === "denied" ? "Notificações bloqueadas" : "Ativar notificações"}
            className="relative h-9 w-9 flex items-center justify-center rounded-xl border transition-colors disabled:opacity-40"
            style={{
              borderColor: pushState === "subscribed" ? "#FBD38D" : P.border,
              background:  pushState === "subscribed" ? "#FFFBEB" : "white",
              color:       pushState === "subscribed" ? "#B45309" : P.muted,
            }}>
            {pushState === "denied" ? <BellOff size={16} /> : <Bell size={16} />}
            {pushState === "subscribed" && (
              <span className="absolute -top-0.5 -right-0.5 h-2 w-2 rounded-full border-2 border-white bg-amber-400" />
            )}
          </button>
        )}

        <div className="flex items-center gap-2.5 pl-2.5 border-l" style={{ borderColor: P.border }}>
          <div className="h-9 w-9 rounded-full overflow-hidden border-2 flex-shrink-0"
            style={{ borderColor: "#CBE0F7" }}>
            <img src={avatarSrc} alt="Avatar" className="h-full w-full object-cover"
              onError={(e) => { (e.currentTarget as HTMLImageElement).src = "/7_homem.png"; }} />
          </div>
          <div className="hidden sm:block leading-tight">
            <div className="text-[13px] font-semibold" style={{ color: P.text }}>Olá, {me.nome}!</div>
            {me.setor && <div className="text-[11px]" style={{ color: P.muted }}>{formatSetor(me.setor)}</div>}
          </div>
          <button onClick={onLogout} disabled={loggingOut}
            className="h-9 w-9 flex items-center justify-center rounded-xl border transition-colors hover:bg-red-50 hover:border-red-200 disabled:opacity-50 ml-1"
            style={{ borderColor: P.border, color: P.muted }} title="Sair">
            <LogOut size={15} />
          </button>
        </div>
      </div>
    </header>
  );
}

// ─── KPI Card ─────────────────────────────────────────────────
function KpiCard({ icon: Icon, value, label, color }: { icon: React.ElementType; value: number; label: string; color: string }) {
  return (
    <motion.div
      whileHover={{ y: -3, boxShadow: `0 8px 20px ${color}28` }}
      className="flex flex-col items-center gap-1.5 rounded-2xl px-3 py-3.5 text-center cursor-default"
      style={{
        background:     "rgba(255,255,255,0.11)",
        backdropFilter: "blur(10px)",
        border:         "1px solid rgba(255,255,255,0.18)",
      }}
    >
      <div className="flex h-8 w-8 items-center justify-center rounded-xl" style={{ background: `${color}28`, color }}>
        <Icon size={16} />
      </div>
      <div className="text-[22px] font-extrabold text-white leading-none">
        {value.toLocaleString("pt-BR")}
      </div>
      <div className="text-[11px] font-medium leading-tight" style={{ color: "rgba(255,255,255,0.58)" }}>{label}</div>
    </motion.div>
  );
}

// ─── Hero ─────────────────────────────────────────────────────
function HeroSection({ me, kpis }: { me: UserHeader; kpis: KPIs }) {
  const avatarSrc = me.avatarKey ? `/${me.avatarKey}.png` : "/7_homem.png";
  return (
    <section className="relative overflow-hidden px-6 py-8 md:py-10"
      style={{ background: `linear-gradient(135deg, ${P.navy} 0%, ${P.fab} 65%, #1a4e8c 100%)` }}>

      {/* Subtle grid bg */}
      <div className="absolute inset-0 pointer-events-none overflow-hidden">
        <svg className="absolute inset-0 h-full w-full opacity-[0.025]" xmlns="http://www.w3.org/2000/svg">
          <defs>
            <pattern id="hgrid" width="44" height="44" patternUnits="userSpaceOnUse">
              <path d="M 44 0 L 0 0 0 44" fill="none" stroke="white" strokeWidth="0.6" />
            </pattern>
          </defs>
          <rect width="100%" height="100%" fill="url(#hgrid)" />
        </svg>
        <div className="absolute -top-24 -right-24 h-72 w-72 rounded-full opacity-[0.05]" style={{ background: "white" }} />
        <div className="absolute bottom-0 left-1/4 h-40 w-40 rounded-full opacity-[0.03]" style={{ background: "white" }} />
      </div>

      <div className="relative z-10 flex flex-col md:flex-row md:items-center gap-7">
        {/* Avatar + info */}
        <div className="flex items-center gap-5 flex-1 min-w-0">
          <div className="relative flex-shrink-0">
            <div className="h-20 w-20 rounded-full border-4 overflow-hidden"
              style={{ borderColor: "rgba(255,255,255,0.22)", boxShadow: "0 0 0 3px rgba(96,165,250,0.28), 0 8px 28px rgba(0,0,0,0.28)" }}>
              <img src={avatarSrc} alt="Avatar" className="h-full w-full object-cover"
                onError={(e) => { (e.currentTarget as HTMLImageElement).src = "/7_homem.png"; }} />
            </div>
            <div className="absolute bottom-1 right-1 h-4 w-4 rounded-full border-2 border-white bg-green-500"
              style={{ boxShadow: "0 0 0 2px rgba(34,197,94,0.35)" }} />
          </div>
          <div className="min-w-0">
            <h1 className="text-xl font-bold text-white">Olá, {me.nome}! 👋</h1>
            {me.setor && (
              <div className="text-sm mt-0.5" style={{ color: "rgba(255,255,255,0.62)" }}>{formatSetor(me.setor)}</div>
            )}
            <div className="text-xs mt-2 max-w-xs leading-relaxed" style={{ color: "rgba(255,255,255,0.42)" }}>
              Bem-vindo ao sistema. Acompanhe os principais indicadores e fique por dentro das atualizações.
            </div>
          </div>
        </div>

        {/* KPIs */}
        <div className="grid grid-cols-3 md:grid-cols-5 gap-2.5 w-full md:w-auto md:min-w-[340px]">
          <KpiCard icon={DollarSign} value={kpis.empenhos}  label="Empenhos"   color="#60A5FA" />
          <KpiCard icon={Clipboard}  value={kpis.processos} label="Processos"  color="#C4B5FD" />
          <KpiCard icon={FileText}   value={kpis.contratos} label="Contratos"  color="#6EE7B7" />
          <KpiCard icon={Activity}   value={kpis.il}        label="IL"         color="#FCD34D" />
          <KpiCard icon={Bookmark}   value={kpis.atas}      label="ATAs Ativas" color="#FCA5A5" />
        </div>
      </div>
    </section>
  );
}

// ─── Panel Fullscreen ─────────────────────────────────────────
function PanelFullscreen({ panel, onClose, nav }: {
  panel: Panel; onClose: () => void; nav: ReturnType<typeof useNavigate>;
}) {
  const Icon = panel.icon;
  return (
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center p-4 md:p-8"
    >
      {/* Backdrop */}
      <motion.div
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        className="absolute inset-0 cursor-pointer"
        style={{ background: "rgba(7,27,52,0.88)", backdropFilter: "blur(7px)" }}
        onClick={onClose}
      />

      {/* Panel */}
      <motion.div
        initial={{ scale: 0.88, y: 28, opacity: 0 }}
        animate={{ scale: 1,    y: 0,  opacity: 1 }}
        exit={{   scale: 0.92,  y: 16, opacity: 0 }}
        transition={{ type: "spring", stiffness: 290, damping: 26 }}
        className="relative z-10 w-full max-w-4xl rounded-2xl overflow-hidden shadow-2xl flex flex-col bg-white"
        style={{ maxHeight: "88vh" }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b flex-shrink-0"
          style={{ borderColor: P.border }}>
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl flex items-center justify-center"
              style={{ background: panel.bg, color: panel.color }}>
              <Icon size={20} />
            </div>
            <div>
              <h2 className="text-[15px] font-bold" style={{ color: P.text }}>{panel.title}</h2>
              <p className="text-xs" style={{ color: P.muted }}>{panel.desc}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => { onClose(); nav(panel.path); }}
              className="flex items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-medium border transition-colors hover:bg-slate-50"
              style={{ borderColor: P.border, color: P.muted }}>
              Abrir página completa <ArrowRight size={13} />
            </button>
            <button onClick={onClose}
              className="h-9 w-9 flex items-center justify-center rounded-xl border transition-colors hover:bg-slate-50"
              style={{ borderColor: P.border, color: P.muted }}>
              <X size={16} />
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6" style={{ background: P.ice }}>
          {/* Mock KPI row */}
          <div className="grid grid-cols-3 gap-4 mb-5">
            {["Indicador 1", "Indicador 2", "Indicador 3"].map((label, i) => (
              <div key={label} className="rounded-xl bg-white border p-4" style={{ borderColor: P.border }}>
                <div className="text-xs mb-1" style={{ color: P.muted }}>{label}</div>
                <div className="text-2xl font-bold" style={{ color: P.text }}>—</div>
                <div className="mt-3 h-1.5 rounded-full" style={{ background: `${panel.color}18` }}>
                  <div className="h-full rounded-full transition-all"
                    style={{ width: `${[68, 44, 82][i]}%`, background: panel.color }} />
                </div>
              </div>
            ))}
          </div>

          {/* CTA */}
          <div className="rounded-xl bg-white border flex items-center justify-center p-10"
            style={{ borderColor: P.border }}>
            <div className="text-center space-y-3">
              <div style={{ color: panel.color, opacity: 0.25 }}>
                <Icon size={48} />
              </div>
              <div className="text-sm font-medium" style={{ color: P.muted }}>
                Visualização detalhada disponível na página completa
              </div>
              <motion.button
                whileHover={{ scale: 1.03 }} whileTap={{ scale: 0.97 }}
                onClick={() => { onClose(); nav(panel.path); }}
                className="inline-flex items-center gap-2 rounded-xl px-5 py-2.5 text-sm font-semibold text-white"
                style={{ background: panel.color }}>
                Abrir {panel.title} <ArrowRight size={15} />
              </motion.button>
            </div>
          </div>
        </div>
      </motion.div>
    </motion.div>
  );
}

// ─── Panels Section ───────────────────────────────────────────
function PanelsSection({ nav }: { nav: ReturnType<typeof useNavigate> }) {
  const [expanded, setExpanded] = useState<string | null>(null);
  return (
    <section className="px-6 py-6">
      <div className="mb-5">
        <h2 className="text-[16px] font-bold" style={{ color: P.text }}>Painéis Gerenciais</h2>
        <p className="text-sm mt-1" style={{ color: P.muted }}>
          Clique em qualquer painel para expandir em tela cheia e visualizar os indicadores detalhados.
        </p>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {PANELS.map((panel, i) => {
          const Icon = panel.icon;
          return (
            <motion.button
              key={panel.id}
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.38, delay: i * 0.07 }}
              whileHover={{ y: -5, boxShadow: `0 14px 36px ${panel.color}1A` }}
              whileTap={{ scale: 0.97 }}
              onClick={() => setExpanded(panel.id)}
              className="text-left rounded-2xl border p-5 bg-white transition-all"
              style={{ borderColor: P.border }}
            >
              <div className="flex items-start justify-between mb-4">
                <div className="h-11 w-11 rounded-xl flex items-center justify-center"
                  style={{ background: panel.bg, color: panel.color }}>
                  <Icon size={21} />
                </div>
                <ArrowRight size={15} style={{ color: P.gray, marginTop: 2 }} />
              </div>
              <div className="text-[13px] font-bold mb-1" style={{ color: P.text }}>{panel.title}</div>
              <div className="text-xs leading-relaxed" style={{ color: P.muted }}>{panel.desc}</div>
            </motion.button>
          );
        })}
      </div>

      <AnimatePresence>
        {expanded && (
          <PanelFullscreen
            panel={PANELS.find(p => p.id === expanded)!}
            onClose={() => setExpanded(null)}
            nav={nav}
          />
        )}
      </AnimatePresence>
    </section>
  );
}

// ─── Feed Section ─────────────────────────────────────────────
function FeedSection({ canCreate, onNavigate }: { canCreate: boolean; onNavigate: (tab: string) => void }) {
  return (
    <section className="px-6 pb-6">
      <div className="rounded-2xl border bg-white overflow-hidden"
        style={{ borderColor: P.border, boxShadow: "0 2px 12px rgba(15,23,42,0.04)" }}>
        <div className="px-5 pt-5 pb-3 border-b" style={{ borderColor: P.border }}>
          <h2 className="text-[15px] font-bold" style={{ color: P.text }}>Atualizações</h2>
          <p className="text-xs mt-0.5" style={{ color: P.muted }}>
            Fique por dentro das últimas novidades e atividades do sistema.
          </p>
        </div>
        <div className="p-5">
          <FeedNoticias isLoggedIn canCreate={canCreate} onNavigate={onNavigate} />
        </div>
      </div>
    </section>
  );
}

// ─── Footer ───────────────────────────────────────────────────
function PageFooter() {
  return (
    <footer className="px-6 pb-6">
      <div className="flex items-center justify-center gap-2.5 py-3 border-t"
        style={{ borderColor: P.border }}>
        <img src="/acantus.png" alt="Acantus" className="h-4 w-4 object-contain"
          style={{ opacity: 0.28 }}
          onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }} />
        <span className="text-[11px]" style={{ color: P.gray }}>
          Desenvolvido por 2T Bruno · GAP-MN
        </span>
      </div>
    </footer>
  );
}

// ─── Componente principal ─────────────────────────────────────
export default function AppChat() {
  const nav = useNavigate();
  const [mobileOpen,  setMobileOpen]  = useState(false);
  const [activeNav,   setActiveNav]   = useState("inicio");
  const [loggingOut,  setLoggingOut]  = useState(false);
  const [me,   setMe]   = useState<UserHeader>({ nome: "Usuário" });
  const [kpis, setKpis] = useState<KPIs>({ empenhos: 0, processos: 0, contratos: 0, il: 0, atas: 0 });

  const { state: pushState, subscribe: pushSubscribe, unsubscribe: pushUnsubscribe } = usePush(me.id ?? null);
  const canCreateFeed = ["ADMIN", "SCON", "SLIC", "SEO", "DEV"].includes((me.setor ?? "").toUpperCase());

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
      const avatarKey = (prof as any)?.avatar_key  || (user.user_metadata as any)?.avatar_key  || null;
      const setorP    = ((prof as any)?.setor as UserHeader["setor"]) ?? null;
      setMe({ id: user.id, nome, avatarKey, setor: setorP });

      const today = new Date().toISOString().split("T")[0];
      const [r1, r2, r3, r4, r5] = await Promise.all([
        supabase.from("siloms_ne_identificadores").select("ne_siafi")
          .ilike("ne_siafi", "2026NE0_____").order("ne_siafi", { ascending: false }).limit(1),
        supabase.from("processos_licitatorios").select("*", { count: "exact", head: true }),
        supabase.from("contratos_scon").select("*", { count: "exact", head: true }),
        supabase.from("indicadores_lotacao").select("*", { count: "exact", head: true }),
        supabase.from("atas_gap_mn").select("*", { count: "exact", head: true })
          .gte("vigencia_final", today).not("situacao", "ilike", "%cancelad%"),
      ]);

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
    try { await supabase.auth.signOut(); nav("/", { replace: true }); }
    finally { setLoggingOut(false); }
  }

  function handleNav(path: string, id: string) {
    setActiveNav(id);
    setMobileOpen(false);
    const [base, qs] = path.split("?");
    nav(qs ? `${base}?${qs}` : base);
  }

  return (
    <div className="flex h-screen overflow-hidden"
      style={{ background: P.ice, fontFamily: "'Inter', 'Segoe UI', system-ui, sans-serif" }}>

      {/* Sidebar — desktop (always visible) */}
      <div className="hidden md:flex md:w-[272px] md:flex-shrink-0 overflow-hidden">
        <SidebarContent active={activeNav} onNav={handleNav} />
      </div>

      {/* Sidebar — mobile overlay */}
      <AnimatePresence>
        {mobileOpen && (
          <>
            <motion.div
              key="backdrop"
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="fixed inset-0 z-30 md:hidden"
              style={{ background: "rgba(7,27,52,0.5)", backdropFilter: "blur(3px)" }}
              onClick={() => setMobileOpen(false)}
            />
            <motion.div
              key="drawer"
              initial={{ x: "-100%" }} animate={{ x: 0 }} exit={{ x: "-100%" }}
              transition={{ type: "tween", duration: 0.24 }}
              className="fixed inset-y-0 left-0 z-40 w-[272px] md:hidden overflow-hidden"
            >
              <SidebarContent active={activeNav} onNav={handleNav} />
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* Main */}
      <div className="flex flex-1 flex-col overflow-hidden min-w-0">
        <TopHeader
          me={me}
          pushState={pushState}
          onPush={() => pushState === "subscribed" ? pushUnsubscribe() : pushSubscribe()}
          onLogout={handleLogout}
          onMenuToggle={() => setMobileOpen(v => !v)}
          loggingOut={loggingOut}
        />

        <main className="flex-1 overflow-y-auto">
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, ease: "easeOut" }}
          >
            <HeroSection  me={me} kpis={kpis} />
            <PanelsSection nav={nav} />
            <FeedSection canCreate={canCreateFeed} onNavigate={(tab) => nav(`/setor?tab=${tab}`)} />
            <PageFooter />
          </motion.div>
        </main>
      </div>
    </div>
  );
}
