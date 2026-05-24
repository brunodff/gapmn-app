import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { motion, useInView, AnimatePresence, type Variants } from "framer-motion";

// ── Paleta ───────────────────────────────────────────────────────────────────
const C = {
  navy:    "#061B33",
  blue:    "#0B3B66",
  accent:  "#3FA9FF",
  ice:     "#F8FAFC",
  gray:    "#D9E2EC",
};

// ── Hook: fade-in ao scroll ──────────────────────────────────────────────────
function useFadeIn(threshold = 0.15) {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, amount: threshold });
  return { ref, inView };
}

const fadeUp: Variants = {
  hidden: { opacity: 0, y: 32 },
  visible: (i = 0) => ({
    opacity: 1, y: 0,
    transition: { duration: 0.55, ease: "easeOut", delay: i * 0.08 },
  }),
};

// ── Ícones SVG ───────────────────────────────────────────────────────────────
function IcBot({ className = "h-6 w-6" }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
      <rect x="3" y="8" width="18" height="13" rx="2.5" />
      <path d="M8 8V6a4 4 0 0 1 8 0v2" />
      <circle cx="9" cy="15" r="1.2" fill="currentColor" stroke="none" />
      <circle cx="15" cy="15" r="1.2" fill="currentColor" stroke="none" />
      <path d="M9 19h6" strokeLinecap="round" />
    </svg>
  );
}
function IcDoc({ className = "h-6 w-6" }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
      <line x1="8" y1="13" x2="16" y2="13" strokeLinecap="round" />
      <line x1="8" y1="17" x2="12" y2="17" strokeLinecap="round" />
    </svg>
  );
}
function IcCalc({ className = "h-6 w-6" }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
      <rect x="4" y="2" width="16" height="20" rx="2" />
      <rect x="7" y="5" width="10" height="4" rx="1" />
      <circle cx="8.5" cy="14" r="1" fill="currentColor" stroke="none" />
      <circle cx="12"  cy="14" r="1" fill="currentColor" stroke="none" />
      <circle cx="15.5"cy="14" r="1" fill="currentColor" stroke="none" />
      <circle cx="8.5" cy="18" r="1" fill="currentColor" stroke="none" />
      <circle cx="12"  cy="18" r="1" fill="currentColor" stroke="none" />
      <circle cx="15.5"cy="18" r="1" fill="currentColor" stroke="none" />
    </svg>
  );
}
function IcServer({ className = "h-6 w-6" }) {
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
function IcArrow({ className = "h-4 w-4" }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
      <line x1="5" y1="12" x2="19" y2="12" /><polyline points="12 5 19 12 12 19" />
    </svg>
  );
}
function IcChevronRight({ className = "h-4 w-4" }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
      <polyline points="9 18 15 12 9 6" />
    </svg>
  );
}
function IcChevronDown({ className = "h-4 w-4" }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
      <polyline points="6 9 12 15 18 9" />
    </svg>
  );
}
function IcMenu({ className = "h-5 w-5" }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <line x1="3" y1="6"  x2="21" y2="6"  strokeLinecap="round" />
      <line x1="3" y1="12" x2="21" y2="12" strokeLinecap="round" />
      <line x1="3" y1="18" x2="21" y2="18" strokeLinecap="round" />
    </svg>
  );
}
function IcClose({ className = "h-5 w-5" }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <line x1="18" y1="6" x2="6" y2="18" strokeLinecap="round" />
      <line x1="6" y1="6" x2="18" y2="18" strokeLinecap="round" />
    </svg>
  );
}
function IcLogin({ className = "h-4 w-4" }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4" />
      <polyline points="10 17 15 12 10 7" /><line x1="15" y1="12" x2="3" y2="12" />
    </svg>
  );
}

// ── Dados ────────────────────────────────────────────────────────────────────
const TOOLS = [
  { icon: IcBot,    title: "Robô CNET",                desc: "Extrai propostas de pregões eletrônicos diretamente do ComprasNet e exporta para planilha." },
  { icon: IcDoc,    title: "Robô de ATAs",             desc: "Sincroniza automaticamente as Atas de Registro de Preço do GAP-MN com um clique." },
  { icon: IcCalc,   title: "Gerador de Apostilamento", desc: "Calcula o reajuste contratual pelo IPCA/IGP-M e gera o Termo de Apostilamento." },
  { icon: IcServer, title: "Assistente SILOMS",        desc: "Lê e registra automaticamente o andamento de empenhos no SILOMS." },
];

const NAV_LINKS = [
  { label: "Início",          id: "inicio" },
  { label: "Funcionalidades", id: "funcionalidades" },
  { label: "Novidades",       id: "novidades" },
  { label: "Sobre",           id: "sobre" },
];

// ── Navbar ───────────────────────────────────────────────────────────────────
function Navbar({ onLogin, onScroll }: { onLogin: () => void; onScroll: (id: string) => void }) {
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const fn = () => setScrolled(window.scrollY > 30);
    window.addEventListener("scroll", fn, { passive: true });
    return () => window.removeEventListener("scroll", fn);
  }, []);

  function go(id: string) { setOpen(false); onScroll(id); }

  return (
    <motion.header
      initial={{ y: -64, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      transition={{ duration: 0.5, ease: "easeOut" }}
      className="fixed top-0 inset-x-0 z-50 transition-all duration-300"
      style={{
        background: scrolled
          ? "rgba(6,27,51,0.92)"
          : "transparent",
        backdropFilter: scrolled ? "blur(12px)" : "none",
        borderBottom: scrolled ? "1px solid rgba(63,169,255,0.12)" : "none",
      }}
    >
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-6 md:px-12">
        {/* Logo */}
        <button onClick={() => go("inicio")} className="flex items-center gap-2.5">
          <img src="/gapmn.png" alt="GAP-MN"
            className="h-8 w-8 rounded-xl border border-white/10 bg-white/5 object-contain" />
          <div className="leading-tight text-left">
            <div className="text-sm font-bold text-white">GAP-MN</div>
            <div className="text-[10px] font-medium" style={{ color: C.accent }}>Sistema de Gestão Integrada</div>
          </div>
        </button>

        {/* Desktop nav */}
        <nav className="hidden md:flex items-center gap-7">
          {NAV_LINKS.map((l) => (
            <button key={l.id} onClick={() => go(l.id)}
              className="text-sm text-white/70 hover:text-white transition-colors relative group">
              {l.label}
              <span className="absolute -bottom-0.5 left-0 h-px w-0 group-hover:w-full transition-all duration-300"
                style={{ background: C.accent }} />
            </button>
          ))}
        </nav>

        {/* Desktop entrar */}
        <motion.button
          whileHover={{ scale: 1.03 }}
          whileTap={{ scale: 0.97 }}
          onClick={onLogin}
          className="hidden md:flex items-center gap-1.5 rounded-xl px-4 py-2 text-sm font-semibold text-white transition-all"
          style={{ background: C.accent }}
        >
          <IcLogin /> Entrar
        </motion.button>

        {/* Mobile menu toggle */}
        <button className="md:hidden text-white/80 hover:text-white" onClick={() => setOpen(!open)}>
          {open ? <IcClose /> : <IcMenu />}
        </button>
      </div>

      {/* Mobile drawer */}
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.25 }}
            className="overflow-hidden md:hidden border-t border-white/10"
            style={{ background: "rgba(6,27,51,0.97)", backdropFilter: "blur(12px)" }}
          >
            <div className="flex flex-col px-6 py-4 gap-1">
              {NAV_LINKS.map((l) => (
                <button key={l.id} onClick={() => go(l.id)}
                  className="w-full text-left py-3 text-sm text-white/70 hover:text-white border-b border-white/5 last:border-0 transition-colors">
                  {l.label}
                </button>
              ))}
              <button onClick={() => { setOpen(false); onLogin(); }}
                className="mt-3 w-full rounded-xl py-2.5 text-sm font-semibold text-white"
                style={{ background: C.accent }}>
                Entrar no sistema
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.header>
  );
}

// ── Mockup do app ────────────────────────────────────────────────────────────
function AppMockup() {
  return (
    <motion.div
      initial={{ opacity: 0, x: 40 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.7, delay: 0.3, ease: "easeOut" }}
      className="relative w-full max-w-[480px]"
    >
      {/* Reflexo de fundo */}
      <div className="absolute -inset-4 rounded-3xl opacity-30 blur-2xl"
        style={{ background: `radial-gradient(circle, ${C.accent} 0%, transparent 70%)` }} />

      <div className="relative rounded-2xl border overflow-hidden shadow-2xl"
        style={{ background: "rgba(11,59,102,0.6)", borderColor: "rgba(63,169,255,0.2)", backdropFilter: "blur(8px)" }}>
        {/* Barra de título */}
        <div className="flex items-center gap-1.5 px-4 py-3 border-b" style={{ borderColor: "rgba(255,255,255,0.07)" }}>
          <div className="h-2.5 w-2.5 rounded-full bg-red-400/60" />
          <div className="h-2.5 w-2.5 rounded-full bg-yellow-400/60" />
          <div className="h-2.5 w-2.5 rounded-full bg-green-400/60" />
          <div className="ml-3 h-1.5 w-36 rounded-full bg-white/10" />
        </div>

        <div className="p-4 space-y-3">
          {/* KPI cards */}
          <div className="grid grid-cols-3 gap-2">
            {[
              { label: "Contratos", val: "48", color: C.accent },
              { label: "Processos", val: "23", color: "#34d399" },
              { label: "Empenhos",  val: "312", color: "#a78bfa" },
            ].map((k) => (
              <div key={k.label} className="rounded-xl p-3 border"
                style={{ background: "rgba(255,255,255,0.04)", borderColor: "rgba(255,255,255,0.08)" }}>
                <div className="text-[9px] font-medium mb-1" style={{ color: "rgba(255,255,255,0.4)" }}>{k.label}</div>
                <div className="text-xl font-bold" style={{ color: k.color }}>{k.val}</div>
              </div>
            ))}
          </div>

          {/* Gráfico simulado */}
          <div className="rounded-xl p-3 border" style={{ background: "rgba(255,255,255,0.03)", borderColor: "rgba(255,255,255,0.07)" }}>
            <div className="flex items-center justify-between mb-3">
              <div className="h-1.5 w-24 rounded-full bg-white/20" />
              <div className="h-1.5 w-10 rounded-full" style={{ background: `${C.accent}60` }} />
            </div>
            <div className="flex items-end gap-1 h-16">
              {[38, 52, 44, 68, 55, 72, 60, 80, 64, 76, 58, 85].map((h, i) => (
                <div key={i} className="flex-1 rounded-t-sm transition-all"
                  style={{ height: `${h}%`, background: `rgba(63,169,255,${0.2 + i * 0.04})` }} />
              ))}
            </div>
          </div>

          {/* Linhas de tabela */}
          <div className="space-y-1.5">
            {[80, 60, 70].map((w, i) => (
              <div key={i} className="flex items-center gap-2 rounded-lg p-2.5 border"
                style={{ background: "rgba(255,255,255,0.03)", borderColor: "rgba(255,255,255,0.06)" }}>
                <div className="h-2 w-2 rounded-full" style={{ background: C.accent, opacity: 0.7 }} />
                <div className="h-1.5 rounded-full bg-white/20" style={{ width: `${w}%` }} />
                <div className="ml-auto h-1.5 w-8 rounded-full" style={{ background: `${C.accent}40` }} />
              </div>
            ))}
          </div>
        </div>
      </div>
    </motion.div>
  );
}

// ── Hero ─────────────────────────────────────────────────────────────────────
function Hero({ onLogin, onScroll }: { onLogin: () => void; onScroll: (id: string) => void }) {
  return (
    <section id="inicio" className="relative min-h-screen flex items-center pt-16 overflow-hidden"
      style={{ background: `linear-gradient(135deg, ${C.navy} 0%, ${C.blue} 70%, #0a2d55 100%)` }}>

      {/* Elementos geométricos de fundo */}
      <div className="pointer-events-none absolute inset-0">
        {/* Círculo grande à direita */}
        <div className="absolute -right-48 top-1/2 -translate-y-1/2 h-[600px] w-[600px] rounded-full opacity-10 border-2"
          style={{ borderColor: C.accent }} />
        <div className="absolute -right-64 top-1/2 -translate-y-1/2 h-[800px] w-[800px] rounded-full opacity-5 border"
          style={{ borderColor: C.accent }} />
        {/* Gradiente suave */}
        <div className="absolute bottom-0 inset-x-0 h-48"
          style={{ background: `linear-gradient(to top, ${C.navy}, transparent)` }} />
        {/* Grade de pontos */}
        <div className="absolute right-8 top-24 grid grid-cols-10 gap-3.5 opacity-[0.07]">
          {Array.from({ length: 80 }).map((_, i) => (
            <div key={i} className="h-1 w-1 rounded-full bg-white" />
          ))}
        </div>
        {/* Linha horizontal sutil */}
        <div className="absolute top-1/3 inset-x-0 h-px opacity-10"
          style={{ background: `linear-gradient(to right, transparent, ${C.accent}, transparent)` }} />
      </div>

      <div className="relative z-10 mx-auto w-full max-w-7xl px-6 md:px-12 grid grid-cols-1 md:grid-cols-2 gap-16 items-center py-20">
        {/* Texto */}
        <div>
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
            className="flex items-center gap-2 mb-6"
          >
            <img src="/gapmn.png" alt="GAP-MN"
              className="h-10 w-10 rounded-xl border border-white/10 bg-white/5 object-contain" />
            <div>
              <div className="text-sm font-bold text-white">GAP-MN</div>
              <div className="text-[11px] font-medium" style={{ color: C.accent }}>Sistema de Gestão Integrada</div>
            </div>
          </motion.div>

          <motion.h1
            initial={{ opacity: 0, y: 28 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.1 }}
            className="text-4xl md:text-5xl lg:text-[3.4rem] font-extrabold leading-[1.15] text-white mb-5"
          >
            Gestão inteligente,
            <br />
            <span style={{ color: C.accent }}>resultados mais rápidos.</span>
          </motion.h1>

          <motion.p
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.2 }}
            className="text-base text-white/55 mb-10 max-w-md leading-relaxed"
          >
            Plataforma interna do Grupamento de Apoio de Manaus —
            Força Aérea Brasileira
          </motion.p>

          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.3 }}
            className="flex flex-wrap gap-3"
          >
            <motion.button
              whileHover={{ scale: 1.04, boxShadow: `0 8px 32px ${C.accent}55` }}
              whileTap={{ scale: 0.97 }}
              onClick={onLogin}
              className="flex items-center gap-2 rounded-xl px-6 py-3 text-sm font-semibold text-white transition-all"
              style={{ background: C.accent }}
            >
              <IcLogin /> Entrar no sistema
            </motion.button>

            <motion.button
              whileHover={{ scale: 1.03, background: "rgba(255,255,255,0.1)" }}
              whileTap={{ scale: 0.97 }}
              onClick={() => onScroll("funcionalidades")}
              className="flex items-center gap-2 rounded-xl border border-white/20 px-6 py-3 text-sm font-semibold text-white/80 transition-all"
            >
              Saiba mais <IcChevronDown />
            </motion.button>
          </motion.div>
        </div>

        {/* Mockup */}
        <div className="hidden md:flex justify-end">
          <AppMockup />
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
        <motion.div
          variants={fadeUp} initial="hidden" animate={inView ? "visible" : "hidden"}
          className="mb-14"
        >
          <p className="text-xs font-bold uppercase tracking-widest mb-3" style={{ color: C.accent }}>
            Funcionalidades
          </p>
          <h2 className="text-3xl md:text-4xl font-extrabold leading-tight mb-4" style={{ color: C.navy }}>
            Tudo o que você precisa,
            <br />em um só lugar.
          </h2>
          <p className="text-base max-w-lg leading-relaxed" style={{ color: "#4A6080" }}>
            Soluções integradas que otimizam processos e aumentam a eficiência da gestão.
          </p>
        </motion.div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
          {TOOLS.map((t, i) => (
            <motion.div
              key={t.title}
              custom={i}
              variants={fadeUp}
              initial="hidden"
              animate={inView ? "visible" : "hidden"}
              whileHover={{ y: -5, boxShadow: `0 12px 40px rgba(63,169,255,0.12)` }}
              className="flex flex-col gap-5 rounded-2xl border bg-white p-6 cursor-default transition-colors"
              style={{ borderColor: C.gray }}
            >
              <div className="flex h-12 w-12 items-center justify-center rounded-xl"
                style={{ background: `${C.accent}18`, color: C.accent }}>
                <t.icon className="h-6 w-6" />
              </div>
              <div>
                <div className="text-base font-bold mb-2" style={{ color: C.navy }}>{t.title}</div>
                <div className="text-sm leading-relaxed" style={{ color: "#5A7090" }}>{t.desc}</div>
              </div>
              <button className="mt-auto flex items-center gap-1 text-sm font-semibold transition-colors hover:gap-2"
                style={{ color: C.accent }}>
                Saiba mais <IcArrow className="h-3.5 w-3.5" />
              </button>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}

// ── Novidades ────────────────────────────────────────────────────────────────
function Novidades() {
  const { ref, inView } = useFadeIn();

  return (
    <section id="novidades" className="py-24 px-6 md:px-12" style={{ background: "#EFF4FA" }}>
      <div ref={ref} className="mx-auto max-w-7xl">
        <motion.div
          variants={fadeUp} initial="hidden" animate={inView ? "visible" : "hidden"}
          className="flex flex-col sm:flex-row sm:items-end sm:justify-between mb-10 gap-6"
        >
          <div>
            <p className="text-xs font-bold uppercase tracking-widest mb-3" style={{ color: C.accent }}>
              Novidades da plataforma
            </p>
            <h2 className="text-3xl md:text-4xl font-extrabold leading-tight" style={{ color: C.navy }}>
              Fique por dentro
              <br />das últimas novidades.
            </h2>
          </div>
          <motion.button
            whileHover={{ scale: 1.03 }}
            whileTap={{ scale: 0.97 }}
            className="flex items-center gap-2 rounded-xl border bg-white px-5 py-2.5 text-sm font-semibold transition-all self-start sm:self-auto"
            style={{ borderColor: C.gray, color: C.navy }}
          >
            Ver todas as novidades <IcArrow className="h-3.5 w-3.5" />
          </motion.button>
        </motion.div>

        <div className="space-y-2">
          {TOOLS.map((t, i) => (
            <motion.div
              key={t.title}
              custom={i}
              variants={fadeUp}
              initial="hidden"
              animate={inView ? "visible" : "hidden"}
              whileHover={{ x: 4, boxShadow: `0 4px 24px rgba(63,169,255,0.09)` }}
              className="group flex items-center gap-4 rounded-2xl border bg-white px-5 py-4 cursor-default transition-all"
              style={{ borderColor: C.gray }}
            >
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl transition-colors"
                style={{ background: `${C.accent}15`, color: C.accent }}>
                <t.icon className="h-5 w-5" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-bold mb-0.5" style={{ color: C.navy }}>{t.title}</div>
                <div className="text-sm truncate" style={{ color: "#5A7090" }}>{t.desc}</div>
              </div>
              <div className="shrink-0 opacity-30 group-hover:opacity-70 transition-opacity" style={{ color: C.accent }}>
                <IcChevronRight />
              </div>
            </motion.div>
          ))}
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
        <motion.div
          variants={fadeUp} initial="hidden" animate={inView ? "visible" : "hidden"}
        >
          <p className="text-xs font-bold uppercase tracking-widest mb-3" style={{ color: C.accent }}>
            Sobre a plataforma
          </p>
          <h2 className="text-3xl md:text-4xl font-extrabold leading-tight mb-5" style={{ color: C.navy }}>
            Tecnologia a serviço
            <br />da gestão pública.
          </h2>
          <p className="text-base leading-relaxed mb-8 max-w-md" style={{ color: "#4A6080" }}>
            O GAP-MN é uma plataforma desenvolvida para integrar, automatizar e
            simplificar processos internos, promovendo mais controle, agilidade e
            transparência na gestão do Grupamento de Apoio de Manaus — Força Aérea Brasileira.
          </p>
          <motion.button
            whileHover={{ scale: 1.03 }}
            whileTap={{ scale: 0.97 }}
            className="rounded-xl border px-5 py-2.5 text-sm font-semibold transition-all hover:bg-slate-50"
            style={{ borderColor: C.gray, color: C.navy }}
          >
            Saiba mais sobre o GAP-MN
          </motion.button>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, x: 32 }}
          animate={inView ? { opacity: 1, x: 0 } : {}}
          transition={{ duration: 0.6, delay: 0.15, ease: "easeOut" }}
          className="rounded-2xl overflow-hidden border shadow-lg h-72 md:h-96 relative"
          style={{ borderColor: C.gray }}
        >
          <img
            src="/gapmn_predio.jpg"
            alt="Grupamento de Apoio de Manaus"
            className="w-full h-full object-cover"
            onError={(e) => {
              (e.currentTarget as HTMLImageElement).style.display = "none";
            }}
          />
          {/* Placeholder visual enquanto não há foto */}
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-4"
            style={{ background: `linear-gradient(135deg, ${C.navy} 0%, ${C.blue} 100%)` }}>
            <img src="/gapmn.png" alt="GAP-MN" className="h-20 w-20 rounded-2xl border-2 border-white/10 bg-white/5 object-contain opacity-60" />
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
            Plataforma interna do Grupamento de Apoio de Manaus —
            Força Aérea Brasileira
          </p>
        </div>

        <div>
          <p className="text-[10px] font-bold uppercase tracking-widest mb-4" style={{ color: "rgba(255,255,255,0.25)" }}>
            Navegação
          </p>
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
          <p className="text-[10px] font-bold uppercase tracking-widest mb-4" style={{ color: "rgba(255,255,255,0.25)" }}>
            Suporte
          </p>
          <ul className="space-y-2">
            {["Central de Ajuda", "Fale Conosco", "Política de Privacidade"].map((item) => (
              <li key={item}>
                <span className="text-sm" style={{ color: "rgba(255,255,255,0.45)" }}>{item}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>

      <div className="border-t mx-auto px-6 py-5 text-center text-[11px]"
        style={{ borderColor: "rgba(255,255,255,0.08)", color: "rgba(255,255,255,0.2)" }}>
        Desenvolvido por 2T Bruno · GAP-MN · versão de teste
      </div>
    </footer>
  );
}

// ── Página ───────────────────────────────────────────────────────────────────
export default function LandingPage() {
  const nav = useNavigate();

  function scrollTo(id: string) {
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth" });
  }

  return (
    <div className="antialiased" style={{ fontFamily: "'Inter', 'Segoe UI', sans-serif" }}>
      <Navbar onLogin={() => nav("/login")} onScroll={scrollTo} />
      <Hero   onLogin={() => nav("/login")} onScroll={scrollTo} />
      <Funcionalidades />
      <Novidades />
      <Sobre />
      <Footer onScroll={scrollTo} />
    </div>
  );
}
