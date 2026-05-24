import { useNavigate } from "react-router-dom";

const DARK = "#0a1929";

// ── Ícones SVG ──────────────────────────────────────────────────────────────

function IconBot() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" className="h-7 w-7">
      <rect x="3" y="8" width="18" height="13" rx="2" />
      <path d="M8 8V6a4 4 0 0 1 8 0v2" />
      <circle cx="9" cy="14" r="1.2" fill="currentColor" stroke="none" />
      <circle cx="15" cy="14" r="1.2" fill="currentColor" stroke="none" />
      <path d="M9 18h6" />
    </svg>
  );
}
function IconDoc() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" className="h-7 w-7">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
      <line x1="8" y1="13" x2="16" y2="13" />
      <line x1="8" y1="17" x2="12" y2="17" />
    </svg>
  );
}
function IconCalc() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" className="h-7 w-7">
      <rect x="4" y="2" width="16" height="20" rx="2" />
      <rect x="7" y="5" width="10" height="4" rx="1" />
      <line x1="7" y1="13" x2="9" y2="13" /><line x1="12" y1="13" x2="14" y2="13" /><line x1="17" y1="13" x2="17" y2="13" strokeLinecap="round" strokeWidth="2.2" />
      <line x1="7" y1="17" x2="9" y2="17" /><line x1="12" y1="17" x2="14" y2="17" /><line x1="17" y1="17" x2="17" y2="17" strokeLinecap="round" strokeWidth="2.2" />
    </svg>
  );
}
function IconServer() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" className="h-7 w-7">
      <rect x="2" y="3" width="20" height="5" rx="1" />
      <rect x="2" y="10" width="20" height="5" rx="1" />
      <rect x="2" y="17" width="20" height="4" rx="1" />
      <circle cx="6" cy="5.5" r="0.8" fill="currentColor" stroke="none" />
      <circle cx="6" cy="12.5" r="0.8" fill="currentColor" stroke="none" />
    </svg>
  );
}
function IconChevron({ dir = "down" }: { dir?: "down" | "right" }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"
      className={`h-4 w-4 ${dir === "right" ? "-rotate-90" : ""}`}>
      <polyline points="6 9 12 15 18 9" />
    </svg>
  );
}
function IconArrow() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-4 w-4">
      <line x1="5" y1="12" x2="19" y2="12" />
      <polyline points="12 5 19 12 12 19" />
    </svg>
  );
}
function IconLogin() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-4 w-4">
      <path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4" />
      <polyline points="10 17 15 12 10 7" />
      <line x1="15" y1="12" x2="3" y2="12" />
    </svg>
  );
}

// ── Dados ────────────────────────────────────────────────────────────────────

const FERRAMENTAS = [
  {
    icon: <IconBot />,
    titulo: "Robô CNET",
    desc: "Extrai propostas de pregões eletrônicos diretamente do ComprasNet e exporta para planilha.",
  },
  {
    icon: <IconDoc />,
    titulo: "Robô de ATAs",
    desc: "Sincroniza automaticamente as Atas de Registro de Preço do GAP-MN com um clique.",
  },
  {
    icon: <IconCalc />,
    titulo: "Gerador de Apostilamento",
    desc: "Calcula o reajuste contratual pelo IPCA/IGP-M e gera o Termo de Apostilamento.",
  },
  {
    icon: <IconServer />,
    titulo: "Assistente SILOMS",
    desc: "Lê e registra automaticamente o andamento de empenhos no SILOMS.",
  },
];

const NOVIDADES = [
  {
    icon: <IconBot />,
    titulo: "Robô CNET",
    desc: "Extrai propostas de pregões eletrônicos diretamente do ComprasNet e exporta para planilha.",
  },
  {
    icon: <IconDoc />,
    titulo: "Robô de ATAs",
    desc: "Sincroniza automaticamente as Atas de Registro de Preço do GAP-MN com um clique.",
  },
  {
    icon: <IconCalc />,
    titulo: "Gerador de Apostilamento",
    desc: "Calcula o reajuste contratual pelo IPCA/IGP-M e gera o Termo de Apostilamento.",
  },
  {
    icon: <IconServer />,
    titulo: "Assistente SILOMS",
    desc: "Lê e registra automaticamente o andamento de empenhos no SILOMS.",
  },
];

// ── Navbar ───────────────────────────────────────────────────────────────────

function Navbar({ onLogin, onScroll }: { onLogin: () => void; onScroll: (id: string) => void }) {
  return (
    <header
      className="fixed top-0 inset-x-0 z-50 flex items-center justify-between px-6 md:px-16 h-16"
      style={{ background: DARK }}
    >
      {/* Logo */}
      <button onClick={() => onScroll("inicio")} className="flex items-center gap-2.5 min-w-0">
        <img src="/gapmn.png" alt="GAP-MN"
          className="h-8 w-8 rounded-lg border border-white/10 bg-white/5 object-contain" />
        <div className="leading-tight text-left">
          <div className="text-sm font-bold text-white">GAP-MN</div>
          <div className="text-[10px] text-sky-400 font-medium">Sistema de Gestão Integrada</div>
        </div>
      </button>

      {/* Nav links */}
      <nav className="hidden md:flex items-center gap-7">
        {[
          { label: "Início",           id: "inicio" },
          { label: "Funcionalidades",  id: "funcionalidades" },
          { label: "Novidades",        id: "novidades" },
          { label: "Sobre",            id: "sobre" },
        ].map((item) => (
          <button
            key={item.id}
            onClick={() => onScroll(item.id)}
            className="text-sm text-white/70 hover:text-white transition-colors pb-0.5 border-b-2 border-transparent hover:border-sky-400"
          >
            {item.label}
          </button>
        ))}
      </nav>

      {/* Botão entrar */}
      <button
        onClick={onLogin}
        className="flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 transition-colors"
      >
        Entrar
      </button>
    </header>
  );
}

// ── Hero ─────────────────────────────────────────────────────────────────────

function Hero({ onLogin, onScroll }: { onLogin: () => void; onScroll: (id: string) => void }) {
  return (
    <section
      id="inicio"
      className="min-h-screen flex items-center pt-16"
      style={{ background: `linear-gradient(135deg, ${DARK} 0%, #0d2137 60%, #0a2540 100%)` }}
    >
      {/* Pontos decorativos */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute right-0 top-1/4 grid grid-cols-8 gap-4 p-8 opacity-10">
          {Array.from({ length: 64 }).map((_, i) => (
            <div key={i} className="h-1 w-1 rounded-full bg-sky-300" />
          ))}
        </div>
      </div>

      <div className="relative z-10 mx-auto w-full max-w-7xl px-6 md:px-16 grid grid-cols-1 md:grid-cols-2 gap-12 items-center py-16">
        {/* Texto */}
        <div>
          <h1 className="text-4xl md:text-5xl font-extrabold leading-tight text-white mb-3">
            Gestão inteligente,
            <br />
            <span className="text-sky-400">resultados mais rápidos.</span>
          </h1>
          <p className="text-base text-white/60 mt-4 mb-8 max-w-md leading-relaxed">
            Plataforma interna do Grupamento de Apoio de Manaus —
            Força Aérea Brasileira
          </p>
          <div className="flex flex-wrap gap-3">
            <button
              onClick={onLogin}
              className="flex items-center gap-2 rounded-lg bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 transition-colors shadow-lg shadow-blue-900/40"
            >
              <IconLogin />
              Entrar no sistema
            </button>
            <button
              onClick={() => onScroll("funcionalidades")}
              className="flex items-center gap-2 rounded-lg border border-white/20 px-5 py-2.5 text-sm font-semibold text-white/80 hover:bg-white/10 transition-colors"
            >
              Saiba mais
              <IconChevron />
            </button>
          </div>
        </div>

        {/* Mockup do app */}
        <div className="hidden md:flex justify-center">
          <AppMockup />
        </div>
      </div>
    </section>
  );
}

function AppMockup() {
  return (
    <div
      className="w-full max-w-md rounded-2xl border border-white/10 shadow-2xl shadow-black/40 overflow-hidden"
      style={{ background: "#0d2137" }}
    >
      {/* Barra de título */}
      <div className="flex items-center gap-1.5 px-4 py-3 border-b border-white/10">
        <div className="h-2.5 w-2.5 rounded-full bg-red-400/70" />
        <div className="h-2.5 w-2.5 rounded-full bg-yellow-400/70" />
        <div className="h-2.5 w-2.5 rounded-full bg-green-400/70" />
        <div className="ml-4 h-2 w-32 rounded bg-white/10" />
      </div>
      {/* Conteúdo simulado */}
      <div className="p-4 space-y-3">
        <div className="flex gap-2">
          <div className="h-16 flex-1 rounded-xl bg-white/5 border border-white/10 p-3 space-y-1.5">
            <div className="h-2 w-16 rounded bg-sky-400/40" />
            <div className="h-3 w-10 rounded bg-white/30" />
          </div>
          <div className="h-16 flex-1 rounded-xl bg-white/5 border border-white/10 p-3 space-y-1.5">
            <div className="h-2 w-16 rounded bg-emerald-400/40" />
            <div className="h-3 w-10 rounded bg-white/30" />
          </div>
          <div className="h-16 flex-1 rounded-xl bg-white/5 border border-white/10 p-3 space-y-1.5">
            <div className="h-2 w-16 rounded bg-violet-400/40" />
            <div className="h-3 w-10 rounded bg-white/30" />
          </div>
        </div>
        <div className="h-28 rounded-xl bg-white/5 border border-white/10 p-3">
          <div className="h-2 w-24 rounded bg-white/20 mb-3" />
          {/* Gráfico simulado */}
          <div className="flex items-end gap-1 h-16 px-2">
            {[40, 55, 35, 70, 50, 80, 60, 90, 65, 75].map((h, i) => (
              <div key={i} className="flex-1 rounded-t"
                style={{ height: `${h}%`, background: `rgba(56,189,248,${0.3 + i * 0.06})` }} />
            ))}
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-10 rounded-lg bg-white/5 border border-white/10 px-3 flex items-center gap-2">
              <div className="h-2 w-2 rounded-full bg-sky-400/60" />
              <div className="h-1.5 flex-1 rounded bg-white/20" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Funcionalidades ──────────────────────────────────────────────────────────

function Funcionalidades() {
  return (
    <section id="funcionalidades" className="bg-white py-20 px-6 md:px-16">
      <div className="mx-auto max-w-7xl">
        <p className="text-xs font-bold uppercase tracking-widest text-blue-600 mb-3">
          Funcionalidades
        </p>
        <h2 className="text-3xl md:text-4xl font-extrabold text-slate-900 mb-3">
          Tudo o que você precisa,
          <br />em um só lugar.
        </h2>
        <p className="text-base text-slate-500 mb-12 max-w-lg">
          Soluções integradas que otimizam processos e aumentam a eficiência da gestão.
        </p>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
          {FERRAMENTAS.map((f) => (
            <div
              key={f.titulo}
              className="flex flex-col gap-4 rounded-2xl border border-slate-100 bg-white p-6 shadow-sm hover:shadow-md transition-shadow"
            >
              <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-blue-50 text-blue-500">
                {f.icon}
              </div>
              <div>
                <div className="text-base font-bold text-slate-900 mb-1">{f.titulo}</div>
                <div className="text-sm text-slate-500 leading-relaxed">{f.desc}</div>
              </div>
              <button className="mt-auto flex items-center gap-1 text-sm font-semibold text-blue-600 hover:text-blue-800 transition-colors">
                Saiba mais <IconArrow />
              </button>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

// ── Novidades ────────────────────────────────────────────────────────────────

function Novidades() {
  return (
    <section id="novidades" className="bg-slate-50 py-20 px-6 md:px-16">
      <div className="mx-auto max-w-7xl">
        <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between mb-10 gap-4">
          <div>
            <p className="text-xs font-bold uppercase tracking-widest text-blue-600 mb-3">
              Novidades da plataforma
            </p>
            <h2 className="text-3xl md:text-4xl font-extrabold text-slate-900 leading-tight">
              Fique por dentro
              <br />das últimas novidades.
            </h2>
          </div>
          <button className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-100 transition-colors whitespace-nowrap self-start sm:self-auto">
            Ver todas as novidades
            <IconArrow />
          </button>
        </div>

        <div className="space-y-2">
          {NOVIDADES.map((n) => (
            <div
              key={n.titulo}
              className="flex items-center gap-4 rounded-2xl border border-slate-100 bg-white px-5 py-4 hover:shadow-sm transition-shadow cursor-default"
            >
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-blue-50 text-blue-500">
                {n.icon}
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-bold text-slate-900">{n.titulo}</div>
                <div className="text-sm text-slate-500 truncate">{n.desc}</div>
              </div>
              <div className="shrink-0 text-slate-300">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-5 w-5">
                  <polyline points="9 18 15 12 9 6" />
                </svg>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

// ── Sobre ────────────────────────────────────────────────────────────────────

function Sobre() {
  return (
    <section id="sobre" className="bg-white py-20 px-6 md:px-16">
      <div className="mx-auto max-w-7xl grid grid-cols-1 md:grid-cols-2 gap-12 items-center">
        <div>
          <p className="text-xs font-bold uppercase tracking-widest text-blue-600 mb-3">
            Sobre a plataforma
          </p>
          <h2 className="text-3xl md:text-4xl font-extrabold text-slate-900 mb-5 leading-tight">
            Tecnologia a serviço
            <br />da gestão pública.
          </h2>
          <p className="text-base text-slate-500 leading-relaxed mb-8 max-w-md">
            O GAP-MN é uma plataforma desenvolvida para integrar, automatizar e
            simplificar processos internos, promovendo mais controle, agilidade e
            transparência na gestão do Grupamento de Apoio de Manaus — FAB.
          </p>
          <button className="rounded-xl border border-slate-200 px-5 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50 transition-colors">
            Saiba mais sobre o GAP-MN
          </button>
        </div>

        {/* Foto do prédio — coloque a imagem real em /gapmn_predio.jpg */}
        <div className="rounded-2xl overflow-hidden border border-slate-100 shadow-md h-64 md:h-80 bg-slate-100 flex items-center justify-center">
          <img
            src="/gapmn_predio.jpg"
            alt="Grupamento de Apoio de Manaus"
            className="w-full h-full object-cover"
            onError={(e) => {
              (e.currentTarget as HTMLImageElement).style.display = "none";
              (e.currentTarget.parentElement as HTMLElement).classList.add("flex", "flex-col", "items-center", "justify-center", "gap-2");
              const p = document.createElement("p");
              p.className = "text-sm text-slate-400 text-center px-4";
              p.textContent = "Adicione a foto do prédio em public/gapmn_predio.jpg";
              e.currentTarget.parentElement?.appendChild(p);
            }}
          />
        </div>
      </div>
    </section>
  );
}

// ── Footer ───────────────────────────────────────────────────────────────────

function Footer({ onScroll }: { onScroll: (id: string) => void }) {
  return (
    <footer style={{ background: DARK }}>
      <div className="mx-auto max-w-7xl px-6 md:px-16 py-12 grid grid-cols-1 md:grid-cols-3 gap-10">
        {/* Coluna 1 — marca */}
        <div>
          <div className="flex items-center gap-2.5 mb-3">
            <img src="/gapmn.png" alt="GAP-MN"
              className="h-8 w-8 rounded-lg border border-white/10 bg-white/5 object-contain" />
            <div>
              <div className="text-sm font-bold text-white">GAP-MN</div>
              <div className="text-[10px] text-sky-400 font-medium">Sistema de Gestão Integrada</div>
            </div>
          </div>
          <p className="text-xs text-white/40 leading-relaxed max-w-xs">
            Plataforma interna do Grupamento de Apoio de Manaus —
            Força Aérea Brasileira
          </p>
        </div>

        {/* Coluna 2 — navegação */}
        <div>
          <p className="text-[10px] font-bold uppercase tracking-widest text-white/30 mb-4">Navegação</p>
          <ul className="space-y-2">
            {[
              { label: "Início",          id: "inicio" },
              { label: "Funcionalidades", id: "funcionalidades" },
              { label: "Novidades",       id: "novidades" },
              { label: "Sobre",           id: "sobre" },
            ].map((item) => (
              <li key={item.id}>
                <button
                  onClick={() => onScroll(item.id)}
                  className="text-sm text-white/50 hover:text-white transition-colors"
                >
                  {item.label}
                </button>
              </li>
            ))}
          </ul>
        </div>

        {/* Coluna 3 — suporte */}
        <div>
          <p className="text-[10px] font-bold uppercase tracking-widest text-white/30 mb-4">Suporte</p>
          <ul className="space-y-2">
            {["Central de Ajuda", "Fale Conosco", "Política de Privacidade"].map((item) => (
              <li key={item}>
                <span className="text-sm text-white/50">{item}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>

      <div className="border-t border-white/10 py-4 text-center text-[11px] text-white/25">
        Desenvolvido por 2T Bruno · GAP-MN · versão de teste
      </div>
    </footer>
  );
}

// ── Página principal ─────────────────────────────────────────────────────────

export default function LandingPage() {
  const nav = useNavigate();

  function scrollTo(id: string) {
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth" });
  }

  return (
    <div className="font-sans antialiased">
      <Navbar onLogin={() => nav("/login")} onScroll={scrollTo} />
      <Hero  onLogin={() => nav("/login")} onScroll={scrollTo} />
      <Funcionalidades />
      <Novidades />
      <Sobre />
      <Footer onScroll={scrollTo} />
    </div>
  );
}
