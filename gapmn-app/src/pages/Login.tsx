import { useEffect, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabase";
import { Card } from "../components/Card";

export default function Login() {
  const nav = useNavigate();
  const loc = useLocation() as any;
  const redirectTo = loc.state?.from || "/app";

  const [email, setEmail] = useState("");
  const [senha, setSenha] = useState("");
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

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
      nav(redirectTo);
    } catch (e: any) {
      setErr(e?.message ?? "Erro ao entrar.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="mx-auto max-w-md">
      <Card>
        <h1 className="text-xl font-semibold">Entrar</h1>
        <p className="mt-1 text-sm text-slate-600">Use suas credenciais para acessar o chat.</p>

        <form onSubmit={handleLogin} className="mt-4 space-y-3">
          <div>
            <label className="text-sm text-slate-700">E-mail</label>
            <input
              className="mt-1 w-full rounded-xl border px-3 py-2 outline-none focus:ring-2 focus:ring-sky-200"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              type="email"
              autoComplete="email"
            />
          </div>

          <div>
            <label className="text-sm text-slate-700">Senha</label>
            <input
              className="mt-1 w-full rounded-xl border px-3 py-2 outline-none focus:ring-2 focus:ring-sky-200"
              value={senha}
              onChange={(e) => setSenha(e.target.value)}
              type="password"
              autoComplete="current-password"
            />
          </div>

          {err && <div className="rounded-xl border border-red-200 bg-red-50 p-2 text-sm text-red-700">{err}</div>}

          <button
            disabled={loading}
            className="w-full rounded-xl bg-sky-600 px-3 py-2 text-white hover:bg-sky-700 disabled:opacity-60"
          >
            {loading ? "Entrando..." : "Entrar"}
          </button>

          <p className="text-center text-sm text-slate-600">
            Não tem conta? <Link className="text-sky-700" to="/signup">Criar</Link>
          </p>
        </form>
      </Card>
    </div>
  );
}
