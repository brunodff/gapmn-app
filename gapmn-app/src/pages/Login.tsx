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

const NOVIDADES: { mes: string; items: string[] }[] = [
  {
    mes: "Janeiro 2026",
    items: [
      "Lançamento do sistema: autenticação, perfis de usuário e feed de notícias",
    ],
  },
  {
    mes: "Fevereiro 2026",
    items: [
      "Gerenciamento de Contratos com importação de planilha Excel",
      "Gerenciamento de Processos Licitatórios",
    ],
  },
  {
    mes: "Março 2026",
    items: [
      "Suporte a processos SRP (Sistema de Registro de Preços)",
      "Controle de elaboração e indicadores de lotação por conta corrente",
    ],
  },
  {
    mes: "Abril 2026",
    items: [
      "Painel de Empenhos integrado ao SILOMS com leitura automática",
      "Notificações push e feed de acompanhamentos por setor",
    ],
  },
  {
    mes: "Maio 2026",
    items: [
      "Robô CNET — extração de propostas do ComprasNet para planilha",
      "Robô de ATAs — sincronização de Atas de Registro de Preço",
      "Gerador de Apostilamento com cálculo de reajuste pelo IPCA",
    ],
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
  const [mesAberto, setMesAberto] = useState<string | null>("Maio 2026");

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
    <div className="relative min-h-screen flex flex-col items-center justify-center bg-[#eaf3fb] overflow-hidden px-4 py-10">

      {/* Blob superior esquerdo */}
      <div
        className="pointer-events-none absolute -top-32 -left-32 h-[480px] w-[480px] rounded-full opacity-60"
        style={{ background: "radial-gradient(circle, #bfdbfe 0%, #93c5fd 40%, transparent 70%)" }}
      />
      {/* Blob inferior direito */}
      <div
        className="pointer-events-none absolute -bottom-24 -right-24 h-[400px] w-[400px] rounded-full opacity-50"
        style={{ background: "radial-gradient(circle, #dbeafe 0%, #bfdbfe 50%, transparent 75%)" }}
      />
      {/* Pontos decorativos */}
      <div className="pointer-events-none absolute right-[8%] top-[18%] grid grid-cols-6 gap-3 opacity-25">
        {Array.from({ length: 36 }).map((_, i) => (
          <div key={i} className="h-1 w-1 rounded-full bg-blue-400" />
        ))}
      </div>

      {/* Logos + título */}
      <div className="relative z-10 mb-6 flex flex-col items-center gap-3">
        <div className="flex items-center gap-3">
          <img
            src="/gapmn.png" alt="GAP-MN"
            className="h-14 w-14 rounded-2xl border border-white/60 bg-white object-contain shadow-md"
          />
          <img
            src="/acantus.png" alt="Acantus"
            className="h-14 w-14 rounded-2xl border border-white/60 bg-white object-contain shadow-md"
          />
        </div>
        <h1 className="text-2xl font-bold text-slate-800 tracking-tight">Aplicativo do GAP-MN</h1>
        <span className="rounded-full border border-amber-300 bg-amber-50 px-3 py-0.5 text-[11px] font-semibold uppercase tracking-widest text-amber-600">
          Versão de testes
        </span>
      </div>

      {/* Card principal */}
      <div className="relative z-10 w-full max-w-sm rounded-2xl bg-white shadow-xl shadow-blue-100/60 px-8 py-8">

        {/* Cabeçalho do card */}
        <div className="flex items-center gap-2 mb-1">
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-blue-50">
            <svg className="h-4 w-4 text-blue-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
              <circle cx="12" cy="7" r="4" />
            </svg>
          </div>
          <span className="text-lg font-bold text-slate-800">Entrar</span>
        </div>
        <p className="text-sm text-slate-500 mb-6">Use suas credenciais para acessar o sistema.</p>

        {showCheckEmail && (
          <div className="mb-4 rounded-xl border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-800">
            Verifique seu e-mail para confirmar o cadastro.
          </div>
        )}
        {showConfirmed && (
          <div className="mb-4 rounded-xl border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800">
            E-mail confirmado. Você já pode entrar.
          </div>
        )}
        {showPasswordReset && (
          <div className="mb-4 rounded-xl border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800">
            Senha redefinida. Entre com a nova senha.
          </div>
        )}

        <form onSubmit={handleLogin} className="space-y-4">
          {/* Campo e-mail */}
          <div className="flex items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 focus-within:border-blue-400 focus-within:ring-2 focus-within:ring-blue-100 transition">
            <svg className="h-4 w-4 shrink-0 text-slate-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
              <rect x="2" y="4" width="20" height="16" rx="2" />
              <path d="M2 7l10 7 10-7" />
            </svg>
            <input
              className="flex-1 bg-transparent text-sm text-slate-800 outline-none placeholder:text-slate-400"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              type="email"
              autoComplete="email"
              placeholder="E-mail"
            />
          </div>

          {/* Campo senha */}
          <div className="flex items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 focus-within:border-blue-400 focus-within:ring-2 focus-within:ring-blue-100 transition">
            <svg className="h-4 w-4 shrink-0 text-slate-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
              <rect x="3" y="11" width="18" height="11" rx="2" />
              <path d="M7 11V7a5 5 0 0 1 10 0v4" />
            </svg>
            <input
              className="flex-1 bg-transparent text-sm text-slate-800 outline-none placeholder:text-slate-400"
              value={senha}
              onChange={(e) => setSenha(e.target.value)}
              type="password"
              autoComplete="current-password"
              placeholder="Senha"
            />
          </div>

          {err && (
            <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              {err}
            </div>
          )}

          <button
            disabled={!canSend}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 py-3 text-sm font-semibold text-white shadow-sm hover:bg-blue-700 active:bg-blue-800 disabled:opacity-50 transition-colors"
          >
            <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4" />
              <polyline points="10 17 15 12 10 7" />
              <line x1="15" y1="12" x2="3" y2="12" />
            </svg>
            {loading ? "Entrando..." : "Entrar"}
          </button>
        </form>

        <div className="mt-5 flex flex-col items-center gap-2 text-sm text-slate-500">
          <span>
            Não tem conta?{" "}
            <Link to="/signup" className="font-semibold text-blue-600 hover:underline">
              Criar
            </Link>
          </span>
          <Link to="/forgot-password" className="text-blue-500 hover:underline text-xs">
            Esqueceu sua senha?
          </Link>
        </div>
      </div>

      {/* Novidades por mês */}
      <div className="relative z-10 mt-8 w-full max-w-sm">
        <p className="text-center text-[11px] font-semibold uppercase tracking-widest text-slate-400 mb-3">
          Novidades da plataforma
        </p>
        <div className="space-y-1">
          {NOVIDADES.slice().reverse().map((grupo) => {
            const aberto = mesAberto === grupo.mes;
            return (
              <div key={grupo.mes} className="rounded-xl bg-white/70 border border-white shadow-sm overflow-hidden">
                <button
                  onClick={() => setMesAberto(aberto ? null : grupo.mes)}
                  className="flex w-full items-center justify-between px-4 py-2.5 text-left"
                >
                  <span className="text-xs font-semibold text-slate-700">{grupo.mes}</span>
                  <svg
                    className={`h-3.5 w-3.5 text-slate-400 transition-transform ${aberto ? "rotate-180" : ""}`}
                    viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"
                  >
                    <polyline points="6 9 12 15 18 9" />
                  </svg>
                </button>
                {aberto && (
                  <ul className="px-4 pb-3 space-y-1 border-t border-slate-100">
                    {grupo.items.map((item) => (
                      <li key={item} className="flex items-start gap-2 pt-1.5">
                        <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-blue-400" />
                        <span className="text-xs text-slate-600 leading-relaxed">{item}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Footer */}
      <footer className="relative z-10 mt-8 text-center text-xs text-slate-400">
        Desenvolvido para o{" "}
        <span className="font-medium text-slate-500">Grupamento de Apoio de Manaus</span>
        {" "}·{" "}
        <span className="font-medium text-slate-500">Força Aérea Brasileira</span>
      </footer>
    </div>
  );
}
