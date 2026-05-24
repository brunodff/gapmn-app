import { useRef, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { motion, useInView, AnimatePresence, type Variants } from "framer-motion";
import { supabase } from "../lib/supabase";

// ── Paleta ───────────────────────────────────────────────────────────────────
const C = {
  navy:   "#061B33",
  blue:   "#0B3B66",
  accent: "#3FA9FF",
  ice:    "#F8FAFC",
  gray:   "#D9E2EC",
  text:   "#1E3A5F",
  muted:  "#4A6680",
};

function traduzErroAuth(msg?: string) {
  const m = (msg || "").toLowerCase();
  if (m.includes("invalid login credentials")) return "E-mail ou senha inválidos.";
  if (m.includes("email not confirmed"))       return "Confirme seu e-mail antes de entrar.";
  if (m.includes("too many requests"))         return "Muitas tentativas. Aguarde e tente novamente.";
  if (m.includes("invalid email"))             return "E-mail inválido.";
  return msg || "Erro ao entrar.";
}

// ── Dados ────────────────────────────────────────────────────────────────────
const NAV_LINKS = [
  { label: "Início",          id: "inicio" },
  { label: "Funcionalidades", id: "funcionalidades" },
  { label: "Linha do Tempo",  id: "timeline" },
  { label: "Sobre",           id: "sobre" },
];

const TOOLS = [
  {
    title: "Robô CNET",
    desc:  "Extrai propostas de pregões eletrônicos diretamente do ComprasNet e exporta para planilha.",
    bg:    "#EAF6FF", border: "#BFD9F5", iconBg: "#D0E8FC", iconColor: "#1E88E5",
  },
  {
    title: "Robô de ATAs",
    desc:  "Sincroniza automaticamente as Atas de Registro de Preço do GAP-MN com um clique.",
    bg:    "#EAFBF2", border: "#B2EDD1", iconBg: "#C6F0DC", iconColor: "#0F9B6B",
  },
  {
    title: "Gerador de Apostilamento",
    desc:  "Calcula o reajuste contratual pelo IPCA/IGP-M e gera o Termo de Apostilamento.",
    bg:    "#F3EFFF", border: "#D6C8F9", iconBg: "#E4D9FD", iconColor: "#7C3AED",
  },
  {
    title: "Assistente SILOMS",
    desc:  "Lê e registra automaticamente o andamento de empenhos no SILOMS.",
    bg:    "#FFF7ED", border: "#FDE8C5", iconBg: "#FDDFA8", iconColor: "#D97706",
  },
];

const TIMELINE: { mes: string; cor: string; items: string[] }[] = [
  {
    mes: "Maio 2026",
    cor: C.accent,
    items: [
      "Gerador de Apostilamento com cálculo de reajuste IPCA via API do Banco Central",
      "Robô de ATAs — coluna de próximo reajuste e sincronização automática",
      "Robô CNET — extração completa de propostas do ComprasNet para planilha",
    ],
  },
  {
    mes: "Abril 2026",
    cor: "#34d399",
    items: [
      "Assistente SILOMS — leitura e registro automático de andamento de empenhos",
      "Feed de acompanhamentos por setor com notificações push",
      "Painel de Empenhos com rastreamento de NE SIAFI e perfil atual",
    ],
  },
  {
    mes: "Março 2026",
    cor: "#a78bfa",
    items: [
      "Indicadores de Lotação por conta corrente",
      "Controle de elaboração de processos licitatórios",
      "Suporte a processos de Registro de Preços (SRP)",
    ],
  },
  {
    mes: "Fevereiro 2026",
    cor: "#f59e0b",
    items: [
      "Gerenciamento de Processos Licitatórios com ciclo completo",
      "Gerenciamento de Contratos com importação de planilha Excel",
    ],
  },
  {
    mes: "Janeiro 2026",
    cor: "#fb7185",
    items: [
      "Lançamento da plataforma GAP-MN",
      "Sistema de autenticação e perfis por setor (SLIC, SCON, SEO)",
      "Feed de notícias e atualizações institucionais",
    ],
  },
];

// ── Hooks ────────────────────────────────────────────────────────────────────
function useFadeIn(threshold = 0.15) {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, amount: threshold });
  return { ref, inView };
}

const sectionFade: Variants = {
  hidden:  { opacity: 0, y: 28 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.5, ease: "easeOut" } },
};

// ── Ícones SVG ───────────────────────────────────────────────────────────────
function IcBot({ className = "h-6 w-6" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
      <rect x="3" y="8" width="18" height="13" rx="2.5" />
      <path d="M8 8V6a4 4 0 0 1 8 0v2" />
      <circle cx="9"  cy="15" r="1.2" fill="currentColor" stroke="none" />
      <circle cx="15" cy="15" r="1.2" fill="currentColor" stroke="none" />
      <path d="M9 19h6" strokeLinecap="round" />
    </svg>
  );
}
function IcDoc({ className = "h-6 w-6" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
      <line x1="8" y1="13" x2="16" y2="13" strokeLinecap="round" />
      <line x1="8" y1="17" x2="12" y2="17" strokeLinecap="round" />
    </svg>
  );
}
function IcCalc({ className = "h-6 w-6" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
      <rect x="4" y="2" width="16" height="20" rx="2" />
      <rect x="7" y="5" width="10" height="4" rx="1" />
      <circle cx="8.5"  cy="14" r="1" fill="currentColor" stroke="none" />
      <circle cx="12"   cy="14" r="1" fill="currentColor" stroke="none" />
      <circle cx="15.5" cy="14" r="1" fill="currentColor" stroke="none" />
      <circle cx="8.5"  cy="18" r="1" fill="currentColor" stroke="none" />
      <circle cx="12"   cy="18" r="1" fill="currentColor" stroke="none" />
      <circle cx="15.5" cy="18" r="1" fill="currentColor" stroke="none" />
    </svg>
  );
}
function IcServer({ className = "h-6 w-6" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
      <rect x="2" y="3"  width="20" height="5" rx="1.5" />
      <rect x="2" y="10" width="20" height="5" rx="1.5" />
      <rect x="2" y="17" width="20" height="4" rx="1.5" />
      <circle cx="6" cy="5.5"  r="1" fill="currentColor" stroke="none" />
      <circle cx="6" cy="12.5" r="1" fill="currentColor" stroke="none" />
    </svg>
  );
}
function IcMail({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <rect x="2" y="4" width="20" height="16" rx="2" />
      <path d="M2 7l10 7 10-7" />
    </svg>
  );
}
function IcLock({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <rect x="3" y="11" width="18" height="11" rx="2" />
      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
    </svg>
  );
}
function IcLogin({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4" />
      <polyline points="10 17 15 12 10 7" />
      <line x1="15" y1="12" x2="3" y2="12" />
    </svg>
  );
}
function IcArrow({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
      <line x1="5" y1="12" x2="19" y2="12" /><polyline points="12 5 19 12 12 19" />
    </svg>
  );
}
function IcChevDown({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
      <polyline points="6 9 12 15 18 9" />
    </svg>
  );
}
function IcChevRight({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
      <polyline points="9 18 15 12 9 6" />
    </svg>
  );
}
function IcMenu({ className = "h-5 w-5" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <line x1="3" y1="6"  x2="21" y2="6"  strokeLinecap="round" />
      <line x1="3" y1="12" x2="21" y2="12" strokeLinecap="round" />
      <line x1="3" y1="18" x2="21" y2="18" strokeLinecap="round" />
    </svg>
  );
}
function IcClose({ className = "h-5 w-5" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <line x1="18" y1="6" x2="6" y2="18" strokeLinecap="round" />
      <line x1="6" y1="6" x2="18" y2="18" strokeLinecap="round" />
    </svg>
  );
}

const TOOL_ICONS = [IcBot, IcDoc, IcCalc, IcServer];

// ── Navbar ───────────────────────────────────────────────────────────────────
function Navbar({ onScroll }: { onScroll: (id: string) => void }) {
  const nav = useNavigate();
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);

  useState(() => {
    const fn = () => setScrolled(window.scrollY > 30);
    window.addEventListener("scroll", fn, { passive: true });
    return () => window.removeEventListener("scroll", fn);
  });

  function go(id: string) { setOpen(false); onScroll(id); }

  return (
    <motion.header
      initial={{ y: -64, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      transition={{ duration: 0.45, ease: "easeOut" }}
      className="fixed top-0 inset-x-0 z-50 transition-all duration-300"
      style={{
        background:    scrolled ? "rgba(6,27,51,0.94)" : "transparent",
        backdropFilter: scrolled ? "blur(14px)" : "none",
        borderBottom:  scrolled ? "1px solid rgba(63,169,255,0.10)" : "none",
      }}
    >
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-6 md:px-12">
        <button onClick={() => go("inicio")} className="flex items-center gap-2.5">
          <img src="/gapmn.png" alt="GAP-MN"
            className="h-8 w-8 rounded-xl border border-white/10 bg-white/5 object-contain" />
          <div className="leading-tight text-left">
            <div className="text-sm font-bold text-white">GAP-MN</div>
            <div className="text-[10px] font-medium" style={{ color: C.accent }}>Sistema de Gestão Integrada</div>
          </div>
        </button>

        <nav className="hidden md:flex items-center gap-7">
          {NAV_LINKS.map((l) => (
            <button key={l.id} onClick={() => go(l.id)}
              className="text-sm text-white/70 hover:text-white transition-colors relative group pb-0.5">
              {l.label}
              <span className="absolute bottom-0 left-0 h-px w-0 group-hover:w-full transition-all duration-300"
                style={{ background: C.accent }} />
            </button>
          ))}
        </nav>

        <motion.button
          whileHover={{ scale: 1.03 }} whileTap={{ scale: 0.97 }}
          onClick={() => go("inicio")}
          className="hidden md:flex items-center gap-1.5 rounded-xl px-4 py-2 text-sm font-semibold text-white"
          style={{ background: C.accent }}
        >
          <IcLogin /> Entrar
        </motion.button>

        <button className="md:hidden text-white/80 hover:text-white" onClick={() => setOpen(!open)}>
          {open ? <IcClose /> : <IcMenu />}
        </button>
      </div>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.22 }}
            className="overflow-hidden md:hidden border-t border-white/10"
            style={{ background: "rgba(6,27,51,0.97)", backdropFilter: "blur(14px)" }}
          >
            <div className="flex flex-col px-6 py-4 gap-1">
              {NAV_LINKS.map((l) => (
                <button key={l.id} onClick={() => go(l.id)}
                  className="w-full text-left py-3 text-sm text-white/70 hover:text-white border-b border-white/5 last:border-0">
                  {l.label}
                </button>
              ))}
              <button onClick={() => { setOpen(false); go("inicio"); }}
                className="mt-3 w-full rounded-xl py-2.5 text-sm font-semibold text-white"
                style={{ background: C.accent }}>
                Acessar o sistema
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.header>
  );
}

// ── Formulário de login (hero) ────────────────────────────────────────────────
function LoginCard() {
  const nav = useNavigate();
  const loc = useLocation() as any;
  const redirectTo = loc.state?.from || "/app";

  const [email,   setEmail]   = useState("");
  const [senha,   setSenha]   = useState("");
  const [loading, setLoading] = useState(false);
  const [err,     setErr]     = useState<string | null>(null);

  const canSend = email.trim().length > 0 && senha.trim().length > 0 && !loading;

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setLoading(true);
    try {
      const { error } = await supabase.auth.signInWithPassword({
        email: email.trim().toLowerCase(),
        password: senha,
      });
      if (error) throw error;
      nav(redirectTo, { replace: true });
    } catch (err: any) {
      setErr(traduzErroAuth(err?.message));
    } finally {
      setLoading(false);
    }
  }

  const inputBase = {
    background:  "rgba(255,255,255,0.07)",
    border:      "1px solid rgba(255,255,255,0.12)",
    borderRadius: "0.75rem",
    color:        "white",
    outline:      "none",
  } as React.CSSProperties;

  return (
    <motion.div
      initial={{ opacity: 0, x: 36 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.6, delay: 0.2, ease: "easeOut" }}
      className="w-full max-w-sm rounded-2xl p-7"
      style={{
        background:    "rgba(11,59,102,0.45)",
        backdropFilter: "blur(16px)",
        border:         "1px solid rgba(63,169,255,0.18)",
        boxShadow:      "0 24px 60px rgba(0,0,0,0.35)",
      }}
    >
      <div className="mb-6">
        <div className="text-lg font-bold text-white mb-1">Acessar o sistema</div>
        <div className="text-sm" style={{ color: "rgba(255,255,255,0.5)" }}>
          Grupamento de Apoio de Manaus — FAB
        </div>
      </div>

      {err && (
        <div className="mb-4 rounded-xl px-4 py-3 text-sm"
          style={{ background: "rgba(239,68,68,0.15)", border: "1px solid rgba(239,68,68,0.3)", color: "#fca5a5" }}>
          {err}
        </div>
      )}

      <form onSubmit={handleLogin} className="space-y-3">
        {/* E-mail */}
        <div className="flex items-center gap-3 px-4 py-2.5 transition-all focus-within:ring-1"
          style={{ ...inputBase, focusWithinRingColor: C.accent } as any}
          onFocus={(e) => e.currentTarget.style.borderColor = "rgba(63,169,255,0.5)"}
          onBlur={(e)  => e.currentTarget.style.borderColor = "rgba(255,255,255,0.12)"}
        >
          <span style={{ color: "rgba(255,255,255,0.35)" }}><IcMail /></span>
          <input
            className="flex-1 bg-transparent text-sm outline-none"
            style={{ color: "white" }}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            type="email"
            autoComplete="email"
            placeholder="E-mail"
            onFocus={(e) => (e.currentTarget.parentElement!.style.borderColor = `${C.accent}80`)}
            onBlur={(e)  => (e.currentTarget.parentElement!.style.borderColor = "rgba(255,255,255,0.12)")}
          />
        </div>

        {/* Senha */}
        <div className="flex items-center gap-3 px-4 py-2.5"
          style={inputBase}>
          <span style={{ color: "rgba(255,255,255,0.35)" }}><IcLock /></span>
          <input
            className="flex-1 bg-transparent text-sm outline-none placeholder-white/30"
            style={{ color: "white" }}
            value={senha}
            onChange={(e) => setSenha(e.target.value)}
            type="password"
            autoComplete="current-password"
            placeholder="Senha"
            onFocus={(e) => (e.currentTarget.parentElement!.style.borderColor = `${C.accent}80`)}
            onBlur={(e)  => (e.currentTarget.parentElement!.style.borderColor = "rgba(255,255,255,0.12)")}
          />
        </div>

        <motion.button
          whileHover={{ scale: canSend ? 1.02 : 1 }}
          whileTap={{ scale: canSend ? 0.98 : 1 }}
          type="submit"
          disabled={!canSend}
          className="flex w-full items-center justify-center gap-2 rounded-xl py-3 text-sm font-semibold text-white transition-opacity disabled:opacity-40"
          style={{ background: C.accent }}
        >
          <IcLogin />
          {loading ? "Entrando..." : "Entrar"}
        </motion.button>
      </form>

      <div className="mt-5 flex flex-col items-center gap-2">
        <span className="text-sm" style={{ color: "rgba(255,255,255,0.45)" }}>
          Não tem conta?{" "}
          <Link to="/signup" className="font-semibold hover:underline" style={{ color: C.accent }}>
            Criar acesso
          </Link>
        </span>
        <Link to="/forgot-password" className="text-xs hover:underline"
          style={{ color: "rgba(255,255,255,0.35)" }}>
          Esqueceu a senha?
        </Link>
      </div>
    </motion.div>
  );
}

// ── Hero ─────────────────────────────────────────────────────────────────────
function Hero({ onScroll }: { onScroll: (id: string) => void }) {
  return (
    <section id="inicio" className="relative min-h-screen flex items-center pt-16 overflow-hidden"
      style={{ background: `linear-gradient(135deg, ${C.navy} 0%, ${C.blue} 65%, #0a2d55 100%)` }}>

      {/* Fundo geométrico */}
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute -right-48 top-1/2 -translate-y-1/2 h-[620px] w-[620px] rounded-full opacity-[0.07] border-2"
          style={{ borderColor: C.accent }} />
        <div className="absolute -right-64 top-1/2 -translate-y-1/2 h-[860px] w-[860px] rounded-full opacity-[0.04] border"
          style={{ borderColor: C.accent }} />
        <div className="absolute bottom-0 inset-x-0 h-40"
          style={{ background: `linear-gradient(to top, ${C.navy}, transparent)` }} />
        <div className="absolute right-6 top-20 grid grid-cols-10 gap-4 opacity-[0.06]">
          {Array.from({ length: 80 }).map((_, i) => (
            <div key={i} className="h-1 w-1 rounded-full bg-white" />
          ))}
        </div>
        <div className="absolute top-1/3 inset-x-0 h-px opacity-[0.08]"
          style={{ background: `linear-gradient(to right, transparent, ${C.accent}, transparent)` }} />
      </div>

      <div className="relative z-10 mx-auto w-full max-w-7xl px-6 md:px-12 grid grid-cols-1 md:grid-cols-2 gap-12 lg:gap-20 items-center py-20">

        {/* Texto esquerdo */}
        <div>
          <motion.div initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }} className="flex items-center gap-2.5 mb-7">
            <img src="/gapmn.png" alt="GAP-MN"
              className="h-10 w-10 rounded-xl border border-white/10 bg-white/5 object-contain" />
            <div>
              <div className="text-sm font-bold text-white">GAP-MN</div>
              <div className="text-[11px] font-medium" style={{ color: C.accent }}>Sistema de Gestão Integrada</div>
            </div>
          </motion.div>

          <motion.h1 initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.55, delay: 0.08 }}
            className="text-4xl md:text-5xl lg:text-[3.2rem] font-extrabold leading-[1.15] text-white mb-5">
            Gestão inteligente,<br />
            <span style={{ color: C.accent }}>resultados mais rápidos.</span>
          </motion.h1>

          <motion.p initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.16 }}
            className="text-base mb-9 max-w-md leading-relaxed"
            style={{ color: "rgba(255,255,255,0.55)" }}>
            Plataforma interna do Grupamento de Apoio de Manaus —
            Força Aérea Brasileira
          </motion.p>

          <motion.div initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.24 }}>
            <button
              onClick={() => onScroll("funcionalidades")}
              className="flex items-center gap-2 rounded-xl border border-white/20 px-5 py-2.5 text-sm font-semibold text-white/75 hover:bg-white/10 transition-colors"
            >
              Conheça as funcionalidades <IcChevDown />
            </button>
          </motion.div>
        </div>

        {/* Card de login direito */}
        <div className="flex justify-center md:justify-end">
          <LoginCard />
        </div>
      </div>
    </section>
  );
}

// ── Funcionalidades ──────────────────────────────────────────────────────────
function Funcionalidades() {
  const { ref, inView } = useFadeIn();
  return (
    <section id="funcionalidades" className="py-24 px-6 md:px-12" style={{ background: C.ice }}>
      <div ref={ref} className="mx-auto max-w-7xl">
        <motion.div variants={sectionFade} initial="hidden" animate={inView ? "visible" : "hidden"} className="mb-14">
          <p className="text-xs font-bold uppercase tracking-widest mb-3" style={{ color: C.accent }}>Funcionalidades</p>
          <h2 className="text-3xl md:text-4xl font-extrabold leading-tight mb-4" style={{ color: C.navy }}>
            Tudo o que você precisa,<br />em um só lugar.
          </h2>
          <p className="text-base max-w-lg leading-relaxed" style={{ color: C.muted }}>
            Soluções integradas que otimizam processos e aumentam a eficiência da gestão.
          </p>
        </motion.div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
          {TOOLS.map((t, i) => {
            const Icon = TOOL_ICONS[i];
            return (
              <motion.div
                key={t.title}
                initial={{ opacity: 0, y: 20 }}
                animate={inView ? { opacity: 1, y: 0 } : {}}
                transition={{ duration: 0.45, ease: "easeOut", delay: 0.08 * i }}
                whileHover={{ y: -5, boxShadow: `0 12px 36px ${t.iconColor}22` }}
                className="flex flex-col gap-4 rounded-2xl border bg-white p-6 cursor-default"
                style={{ borderColor: t.border }}
              >
                <div className="flex h-12 w-12 items-center justify-center rounded-xl"
                  style={{ background: t.iconBg, color: t.iconColor }}>
                  <Icon className="h-6 w-6" />
                </div>
                <div>
                  <div className="text-base font-bold mb-1.5" style={{ color: C.navy }}>{t.title}</div>
                  <div className="text-sm leading-relaxed" style={{ color: C.muted }}>{t.desc}</div>
                </div>
                <button className="mt-auto flex items-center gap-1 text-sm font-semibold transition-all hover:gap-2"
                  style={{ color: t.iconColor }}>
                  Saiba mais <IcArrow className="h-3.5 w-3.5" />
                </button>
              </motion.div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

// ── Linha do Tempo ───────────────────────────────────────────────────────────
function TimelineItem({ mes, cor, items, index }: { mes: string; cor: string; items: string[]; index: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, amount: 0.2 });

  return (
    <div ref={ref} className="flex items-start gap-5">
      {/* Dot */}
      <div className="relative flex flex-col items-center flex-shrink-0" style={{ width: 40 }}>
        <motion.div
          initial={{ scale: 0, opacity: 0 }}
          animate={inView ? { scale: 1, opacity: 1 } : {}}
          transition={{ duration: 0.35, delay: 0.05, type: "spring", stiffness: 260 }}
          className="h-10 w-10 rounded-full border-4 border-white shadow-md flex items-center justify-center z-10"
          style={{ background: cor, boxShadow: `0 0 0 4px ${cor}25, 0 4px 12px rgba(0,0,0,0.15)` }}
        >
          <span className="text-xs font-extrabold text-white">{TIMELINE.length - index}</span>
        </motion.div>
      </div>

      {/* Card */}
      <motion.div
        initial={{ opacity: 0, x: 20 }}
        animate={inView ? { opacity: 1, x: 0 } : {}}
        transition={{ duration: 0.45, ease: "easeOut", delay: 0.08 }}
        className="flex-1 rounded-2xl border bg-white p-5 shadow-sm mb-8"
        style={{ borderColor: `${cor}30`, borderLeft: `3px solid ${cor}` }}
      >
        <div className="text-xs font-bold uppercase tracking-widest mb-3" style={{ color: cor }}>
          {mes}
        </div>
        <ul className="space-y-2">
          {items.map((item) => (
            <li key={item} className="flex items-start gap-2.5">
              <span className="mt-1.5 h-1.5 w-1.5 flex-shrink-0 rounded-full" style={{ background: cor }} />
              <span className="text-sm leading-relaxed" style={{ color: C.text }}>{item}</span>
            </li>
          ))}
        </ul>
      </motion.div>
    </div>
  );
}

function Timeline() {
  const { ref, inView } = useFadeIn(0.1);
  return (
    <section id="timeline" className="py-24 px-6 md:px-12" style={{ background: "#EFF4FA" }}>
      <div className="mx-auto max-w-3xl">
        <motion.div ref={ref} variants={sectionFade} initial="hidden" animate={inView ? "visible" : "hidden"}
          className="mb-14 text-center">
          <p className="text-xs font-bold uppercase tracking-widest mb-3" style={{ color: C.accent }}>
            Histórico de versões
          </p>
          <h2 className="text-3xl md:text-4xl font-extrabold leading-tight mb-4" style={{ color: C.navy }}>
            Evolução da plataforma
          </h2>
          <p className="text-base leading-relaxed" style={{ color: C.muted }}>
            Acompanhe as funcionalidades entregues mês a mês ao longo de 2026.
          </p>
        </motion.div>

        {/* Linha vertical */}
        <div className="relative">
          <div className="absolute left-5 top-0 bottom-0 w-0.5 -translate-x-1/2"
            style={{ background: `linear-gradient(to bottom, transparent 0%, ${C.accent}40 8%, ${C.accent}40 92%, transparent 100%)` }} />

          <div>
            {TIMELINE.map((item, i) => (
              <TimelineItem key={item.mes} {...item} index={i} />
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

// ── Sobre ────────────────────────────────────────────────────────────────────
function Sobre() {
  const { ref, inView } = useFadeIn();
  return (
    <section id="sobre" className="py-24 px-6 md:px-12 bg-white">
      <div ref={ref} className="mx-auto max-w-7xl grid grid-cols-1 md:grid-cols-2 gap-16 items-center">
        <motion.div variants={sectionFade} initial="hidden" animate={inView ? "visible" : "hidden"}>
          <p className="text-xs font-bold uppercase tracking-widest mb-3" style={{ color: C.accent }}>
            Sobre a plataforma
          </p>
          <h2 className="text-3xl md:text-4xl font-extrabold leading-tight mb-5" style={{ color: C.navy }}>
            Tecnologia a serviço<br />da gestão pública.
          </h2>
          <p className="text-base leading-relaxed mb-8 max-w-md" style={{ color: C.muted }}>
            O GAP-MN é uma plataforma desenvolvida para integrar, automatizar e simplificar
            processos internos, promovendo mais controle, agilidade e transparência na gestão
            do Grupamento de Apoio de Manaus — Força Aérea Brasileira.
          </p>
          <motion.button
            whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }}
            className="rounded-xl border px-5 py-2.5 text-sm font-semibold transition-all hover:bg-slate-50"
            style={{ borderColor: C.gray, color: C.navy }}
          >
            Saiba mais sobre o GAP-MN
          </motion.button>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, x: 28 }}
          animate={inView ? { opacity: 1, x: 0 } : {}}
          transition={{ duration: 0.55, delay: 0.14, ease: "easeOut" }}
          className="rounded-2xl overflow-hidden border shadow-lg h-72 md:h-96 relative"
          style={{ borderColor: C.gray }}
        >
          <img src="/gapmn_predio.jpg" alt="Grupamento de Apoio de Manaus"
            className="w-full h-full object-cover"
            onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }} />
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-4"
            style={{ background: `linear-gradient(135deg, ${C.navy} 0%, ${C.blue} 100%)` }}>
            <img src="/gapmn.png" alt="GAP-MN"
              className="h-20 w-20 rounded-2xl border-2 border-white/10 bg-white/5 object-contain opacity-50" />
            <p className="text-xs text-center px-6 leading-relaxed" style={{ color: "rgba(255,255,255,0.3)" }}>
              Grupamento de Apoio de Manaus<br />Força Aérea Brasileira
            </p>
          </div>
        </motion.div>
      </div>
    </section>
  );
}

// ── Footer ───────────────────────────────────────────────────────────────────
function Footer({ onScroll }: { onScroll: (id: string) => void }) {
  return (
    <footer style={{ background: C.navy }}>
      <div className="mx-auto max-w-7xl px-6 md:px-12 py-14 grid grid-cols-1 md:grid-cols-3 gap-10">
        <div>
          <div className="flex items-center gap-2.5 mb-4">
            <img src="/gapmn.png" alt="GAP-MN"
              className="h-8 w-8 rounded-xl border border-white/10 bg-white/5 object-contain" />
            <div>
              <div className="text-sm font-bold text-white">GAP-MN</div>
              <div className="text-[10px] font-medium" style={{ color: C.accent }}>Sistema de Gestão Integrada</div>
            </div>
          </div>
          <p className="text-xs leading-relaxed max-w-xs" style={{ color: "rgba(255,255,255,0.35)" }}>
            Plataforma interna do Grupamento de Apoio de Manaus — Força Aérea Brasileira
          </p>
        </div>

        <div>
          <p className="text-[10px] font-bold uppercase tracking-widest mb-4"
            style={{ color: "rgba(255,255,255,0.25)" }}>Navegação</p>
          <ul className="space-y-2">
            {NAV_LINKS.map((l) => (
              <li key={l.id}>
                <button onClick={() => onScroll(l.id)}
                  className="text-sm transition-colors hover:text-white"
                  style={{ color: "rgba(255,255,255,0.45)" }}>
                  {l.label}
                </button>
              </li>
            ))}
          </ul>
        </div>

        <div>
          <p className="text-[10px] font-bold uppercase tracking-widest mb-4"
            style={{ color: "rgba(255,255,255,0.25)" }}>Suporte</p>
          <ul className="space-y-2">
            {["Central de Ajuda", "Fale Conosco", "Política de Privacidade"].map((item) => (
              <li key={item}>
                <span className="text-sm" style={{ color: "rgba(255,255,255,0.45)" }}>{item}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
      <div className="border-t px-6 py-5 text-center text-[11px]"
        style={{ borderColor: "rgba(255,255,255,0.07)", color: "rgba(255,255,255,0.2)" }}>
        Desenvolvido por 2T Bruno · GAP-MN · versão de teste
      </div>
    </footer>
  );
}

// ── Página ───────────────────────────────────────────────────────────────────
export default function LandingPage() {
  function scrollTo(id: string) {
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth" });
  }

  return (
    <div className="antialiased" style={{ fontFamily: "'Inter', 'Segoe UI', sans-serif" }}>
      <Navbar onScroll={scrollTo} />
      <Hero   onScroll={scrollTo} />
      <Funcionalidades />
      <Timeline />
      <Sobre />
      <Footer onScroll={scrollTo} />
    </div>
  );
}
