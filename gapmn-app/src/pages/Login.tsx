import { useMemo, useState } from "react";
import { Link, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { supabase } from "../lib/supabase";
import { Card } from "../components/Card";
import FeedNoticias from "../components/FeedNoticias";

function traduzErroAuth(msg?: string) {
  const m = (msg || "").toLowerCase();
  if (m.includes("invalid login credentials")) return "E-mail ou senha inválidos.";
  if (m.includes("email not confirmed")) return "Seu e-mail ainda não foi confirmado. Verifique sua caixa de entrada.";
  if (m.includes("too many requests")) return "Muitas tentativas. Aguarde um pouco e tente novamente.";
  if (m.includes("invalid email")) return "E-mail inválido.";
  return msg || "Erro ao entrar.";
}

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
    [email, senha, loading]
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
    <div className="grid grid-cols-1 md:grid-cols-2 gap-6 items-stretch">
      {/* Feed de notícias — rolagem interna, não empurra a página */}
      <div className="order-2 md:order-1">
        <div className="rounded-2xl border bg-white p-4 shadow-sm">
          <div className="overflow-y-auto pr-1" style={{ maxHeight: "420px" }}>
            <FeedNoticias isLoggedIn={false} />
          </div>
        </div>
      </div>

      {/* Formulário de login */}
      <div className="order-1 md:order-2" id="login-form">
        <Card>
          <h1 className="text-xl font-semibold">Entrar</h1>
          <p className="mt-1 text-sm text-slate-600">Use suas credenciais para acessar o sistema.</p>

          {showCheckEmail && (
            <div className="mt-4 rounded-xl border border-sky-200 bg-sky-50 p-2 text-sm text-sky-800">
              Enviamos um e-mail de confirmação. Abra sua caixa de entrada e confirme para liberar o acesso.
            </div>
          )}

          {showConfirmed && (
            <div className="mt-4 rounded-xl border border-green-200 bg-green-50 p-2 text-sm text-green-800">
              E-mail confirmado com sucesso ✅ Agora você pode entrar.
            </div>
          )}

          {showPasswordReset && (
            <div className="mt-4 rounded-xl border border-green-200 bg-green-50 p-2 text-sm text-green-800">
              Senha redefinida com sucesso ✅ Entre com sua nova senha.
            </div>
          )}

          <form onSubmit={handleLogin} className="mt-4 space-y-3">
            <input
              className="w-full rounded-xl border px-3 py-2 outline-none focus:ring-2 focus:ring-sky-200"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              type="email"
              autoComplete="email"
              placeholder="E-mail"
            />

            <input
              className="w-full rounded-xl border px-3 py-2 outline-none focus:ring-2 focus:ring-sky-200"
              value={senha}
              onChange={(e) => setSenha(e.target.value)}
              type="password"
              autoComplete="current-password"
              placeholder="Senha"
            />

            {err && (
              <div className="rounded-xl border border-red-200 bg-red-50 p-2 text-sm text-red-700">
                {err}
              </div>
            )}

            <button
              disabled={!canSend}
              className="w-full rounded-xl bg-sky-600 px-3 py-2 text-white hover:bg-sky-700 disabled:opacity-60"
            >
              {loading ? "Entrando..." : "Entrar"}
            </button>

            <p className="text-center text-sm text-slate-600">
              Não tem conta?{" "}
              <Link className="text-sky-700" to="/signup">Criar</Link>
            </p>

            <p className="pt-2 text-center text-xs text-slate-500">
              <Link className="text-sky-700" to="/forgot-password">Esqueceu sua senha?</Link>
            </p>
          </form>
        </Card>
      </div>
    </div>
  );
}
