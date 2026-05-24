import { useMemo, useState } from "react";
import { Link, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { supabase } from "../lib/supabase";

function traduzErroAuth(msg?: string) {
  const m = (msg || "").toLowerCase();
  if (m.includes("invalid login credentials")) return "E-mail ou senha inválidos.";
  if (m.includes("email not confirmed"))       return "Confirme seu e-mail antes de entrar.";
  if (m.includes("too many requests"))         return "Muitas tentativas. Aguarde e tente novamente.";
  if (m.includes("invalid email"))             return "E-mail inválido.";
  return msg || "Erro ao entrar.";
}

const NOVIDADES = [
  {
    icon: "🤖",
    title: "Robô CNET",
    desc: "Extrai propostas de pregões eletrônicos diretamente do ComprasNet e exporta para planilha.",
  },
  {
    icon: "📋",
    title: "Robô de ATAs",
    desc: "Sincroniza automaticamente as Atas de Registro de Preço do GAP-MN com um clique.",
  },
  {
    icon: "📄",
    title: "Gerador de Apostilamento",
    desc: "Calcula o reajuste contratual pelo IPCA/IGP-M e gera o Termo de Apostilamento.",
  },
  {
    icon: "🔧",
    title: "Assistente SILOMS",
    desc: "Lê e registra automaticamente o andamento de empenhos no SILOMS.",
  },
];

export default function Login() {
  const nav = useNavigate();
  const loc = useLocation() as any;
  const redirectTo = loc.state?.from || "/app";

  const [sp] = useSearchParams();
  const showCheckEmail    = sp.get("check_email") === "1";
  const showConfirmed     = sp.get("confirmed") === "1";
  const showPasswordReset = sp.get("password_reset") === "1";

  const [email,   setEmail]   = useState("");
  const [senha,   setSenha]   = useState("");
  const [loading, setLoading] = useState(false);
  const [err,     setErr]     = useState<string | null>(null);

  const canSend = useMemo(
    () => email.trim().length > 0 && senha.trim().length > 0 && !loading,
    [email, senha, loading],
  );

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
    } catch (e: any) {
      setErr(traduzErroAuth(e?.message));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex flex-col md:flex-row">

      {/* ── Painel esquerdo — marca + novidades ─────────────────────────── */}
      <div className="relative flex flex-col justify-between bg-gradient-to-br from-slate-900 via-sky-950 to-slate-800 text-white md:w-[52%] px-8 py-10 md:px-12 md:py-14 overflow-hidden">

        {/* Fundo decorativo */}
        <div className="pointer-events-none absolute inset-0 opacity-10">
          <div className="absolute -top-32 -left-32 h-96 w-96 rounded-full bg-sky-400 blur-3xl" />
          <div className="absolute bottom-0 right-0 h-72 w-72 rounded-full bg-sky-600 blur-3xl" />
        </div>

        {/* Logo + nome */}
        <div className="relative z-10 flex items-center gap-4">
          <img
            src="/gapmn.png" alt="GAP-MN"
            className="h-16 w-16 rounded-2xl border-2 border-white/20 bg-white/10 object-contain shadow-xl"
          />
          <div>
            <div className="text-xl font-bold tracking-tight leading-tight">GAP-MN</div>
            <div className="text-sm text-sky-300 font-medium">Sistema de Gestão Integrada</div>
          </div>
        </div>

        {/* Tagline */}
        <div className="relative z-10 my-8 md:my-0 md:flex-1 md:flex md:flex-col md:justify-center">
          <p className="text-2xl md:text-3xl font-semibold leading-snug text-white/90 mb-2">
            Gestão inteligente,<br />
            <span className="text-sky-300">resultados mais rápidos.</span>
          </p>
          <p className="text-sm text-white/50 mt-2">
            Plataforma interna do Grupamento de Apoio — Marinha do Brasil
          </p>
        </div>

        {/* Novidades */}
        <div className="relative z-10 space-y-3">
          <p className="text-xs font-semibold uppercase tracking-widest text-sky-400 mb-3">
            Novidades da plataforma
          </p>
          {NOVIDADES.map((n) => (
            <div key={n.title} className="flex items-start gap-3">
              <span className="text-2xl leading-none mt-0.5">{n.icon}</span>
              <div>
                <div className="text-sm font-semibold text-white/90">{n.title}</div>
                <div className="text-xs text-white/50 leading-relaxed">{n.desc}</div>
              </div>
            </div>
          ))}
        </div>

        {/* Footer esquerdo */}
        <div className="relative z-10 mt-10 text-[11px] text-white/30">
          Desenvolvido por 2T Bruno · GAP-MN · versão de teste
        </div>
      </div>

      {/* ── Painel direito — formulário ──────────────────────────────────── */}
      <div className="flex flex-1 flex-col items-center justify-center bg-slate-50 px-6 py-12">
        <div className="w-full max-w-sm">

          {/* Logo mobile (visível apenas em telas pequenas) */}
          <div className="flex items-center gap-3 mb-8 md:hidden">
            <img src="/gapmn.png" alt="GAP-MN"
              className="h-10 w-10 rounded-xl border border-slate-200 bg-white object-contain shadow-sm" />
            <span className="text-base font-semibold text-slate-800">Aplicativo do GAP-MN</span>
          </div>

          <h1 className="text-2xl font-bold text-slate-900 mb-1">Bem-vindo</h1>
          <p className="text-sm text-slate-500 mb-7">Entre com suas credenciais para acessar.</p>

          {showCheckEmail && (
            <div className="mb-4 rounded-xl border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-800">
              Verifique seu e-mail para confirmar o cadastro.
            </div>
          )}
          {showConfirmed && (
            <div className="mb-4 rounded-xl border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800">
              ✅ E-mail confirmado. Você já pode entrar.
            </div>
          )}
          {showPasswordReset && (
            <div className="mb-4 rounded-xl border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800">
              ✅ Senha redefinida. Entre com a nova senha.
            </div>
          )}

          <form onSubmit={handleLogin} className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1.5">E-mail</label>
              <input
                className="w-full rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm outline-none transition focus:border-sky-400 focus:ring-2 focus:ring-sky-100 placeholder:text-slate-400"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                type="email"
                autoComplete="email"
                placeholder="seu@email.mil.br"
              />
            </div>

            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="block text-xs font-medium text-slate-600">Senha</label>
                <Link to="/forgot-password" className="text-xs text-sky-600 hover:underline">
                  Esqueceu a senha?
                </Link>
              </div>
              <input
                className="w-full rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm outline-none transition focus:border-sky-400 focus:ring-2 focus:ring-sky-100 placeholder:text-slate-400"
                value={senha}
                onChange={(e) => setSenha(e.target.value)}
                type="password"
                autoComplete="current-password"
                placeholder="••••••••"
              />
            </div>

            {err && (
              <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                {err}
              </div>
            )}

            <button
              disabled={!canSend}
              className="w-full rounded-xl bg-sky-600 px-4 py-3 text-sm font-semibold text-white shadow-sm hover:bg-sky-700 active:bg-sky-800 disabled:opacity-50 transition-colors"
            >
              {loading ? "Entrando…" : "Entrar"}
            </button>
          </form>

          <p className="mt-6 text-center text-sm text-slate-500">
            Não tem conta?{" "}
            <Link to="/signup" className="font-medium text-sky-600 hover:underline">
              Criar acesso
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
