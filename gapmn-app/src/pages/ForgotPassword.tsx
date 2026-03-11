import { useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "../lib/supabase";
import { Card } from "../components/Card";

export default function ForgotPassword() {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setLoading(true);
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(
        email.trim().toLowerCase(),
        { redirectTo: `${window.location.origin}/auth/reset-password` }
      );
      if (error) throw error;
      setSent(true);
    } catch (e: any) {
      setErr(e?.message || "Erro ao enviar e-mail. Tente novamente.");
    } finally {
      setLoading(false);
    }
  }

  if (sent) {
    return (
      <div className="mx-auto max-w-md">
        <Card>
          <h1 className="text-xl font-semibold">Verifique seu e-mail</h1>
          <div className="mt-3 rounded-xl border border-green-200 bg-green-50 p-3 text-sm text-green-800">
            Enviamos um link de redefinição para <strong>{email}</strong>. Abra
            sua caixa de entrada e clique no botão para criar uma nova senha.
          </div>
          <p className="mt-4 text-center text-sm text-slate-500">
            Não recebeu?{" "}
            <button
              className="text-sky-700 underline"
              onClick={() => setSent(false)}
            >
              Tentar novamente
            </button>
          </p>
          <p className="mt-2 text-center text-sm">
            <Link className="text-sky-700" to="/login">
              Voltar ao login
            </Link>
          </p>
        </Card>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-md">
      <Card>
        <h1 className="text-xl font-semibold">Esqueci minha senha</h1>
        <p className="mt-1 text-sm text-slate-600">
          Informe seu e-mail e enviaremos um link para redefinir sua senha.
        </p>

        <form onSubmit={handleSubmit} className="mt-4 space-y-3">
          <input
            className="w-full rounded-xl border px-3 py-2 outline-none focus:ring-2 focus:ring-sky-200"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            type="email"
            autoComplete="email"
            placeholder="E-mail"
            required
          />

          {err && (
            <div className="rounded-xl border border-red-200 bg-red-50 p-2 text-sm text-red-700">
              {err}
            </div>
          )}

          <button
            disabled={email.trim().length === 0 || loading}
            className="w-full rounded-xl bg-sky-600 px-3 py-2 text-white hover:bg-sky-700 disabled:opacity-60"
          >
            {loading ? "Enviando..." : "Enviar link"}
          </button>

          <p className="text-center text-sm">
            <Link className="text-sky-700" to="/login">
              Voltar ao login
            </Link>
          </p>
        </form>
      </Card>
    </div>
  );
}
