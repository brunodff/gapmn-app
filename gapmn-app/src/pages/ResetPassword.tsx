import { useEffect, useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { supabase } from "../lib/supabase";
import { Card } from "../components/Card";

type OtpType = "signup" | "magiclink" | "recovery" | "invite" | "email_change";

function parseHashParams() {
  const h = window.location.hash?.startsWith("#")
    ? window.location.hash.slice(1)
    : window.location.hash;
  const sp = new URLSearchParams(h || "");
  const obj: Record<string, string> = {};
  sp.forEach((v, k) => (obj[k] = v));
  return obj;
}

export default function ResetPassword() {
  const nav = useNavigate();

  // "verifying" → trocando o token por sessão
  // "form"      → mostra o formulário de nova senha
  // "done"      → sucesso, vai redirecionar
  // "err"       → erro
  const [stage, setStage] = useState<"verifying" | "form" | "done" | "err">("verifying");
  const [stageMsg, setStageMsg] = useState("Verificando link...");

  const [senha, setSenha] = useState("");
  const [confirmSenha, setConfirmSenha] = useState("");
  const [loading, setLoading] = useState(false);
  const [formErr, setFormErr] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const url = new URL(window.location.href);

        // 1) PKCE flow (code=...)
        const code = url.searchParams.get("code");
        if (code) {
          const { error } = await supabase.auth.exchangeCodeForSession(window.location.href);
          if (error) throw error;
          setStage("form");
          return;
        }

        // 2) OTP flow (token_hash=...&type=recovery)
        const token_hash = url.searchParams.get("token_hash");
        const type = url.searchParams.get("type") as OtpType | null;
        if (token_hash && type) {
          const { error } = await supabase.auth.verifyOtp({ token_hash, type });
          if (error) throw error;
          setStage("form");
          return;
        }

        // 3) Implicit flow (tokens no hash)
        const hash = parseHashParams();
        const access_token = hash["access_token"];
        const refresh_token = hash["refresh_token"];
        if (access_token && refresh_token) {
          const { error } = await supabase.auth.setSession({ access_token, refresh_token });
          if (error) throw error;
          setStage("form");
          return;
        }

        throw new Error(
          "Link inválido ou expirado. Solicite um novo link de redefinição."
        );
      } catch (e: any) {
        setStage("err");
        setStageMsg(e?.message ?? "Não foi possível verificar o link. Tente novamente.");
      }
    })();
  }, []);

  async function handleReset(e: React.FormEvent) {
    e.preventDefault();
    setFormErr(null);

    if (senha.length < 6) {
      setFormErr("A senha deve ter pelo menos 6 caracteres.");
      return;
    }
    if (senha !== confirmSenha) {
      setFormErr("As senhas não coincidem.");
      return;
    }

    setLoading(true);
    try {
      const { error } = await supabase.auth.updateUser({ password: senha });
      if (error) throw error;

      setStage("done");
      await supabase.auth.signOut();
      setTimeout(() => nav("/login?password_reset=1", { replace: true }), 1200);
    } catch (e: any) {
      setFormErr(e?.message || "Erro ao atualizar a senha. Tente novamente.");
    } finally {
      setLoading(false);
    }
  }

  if (stage === "verifying") {
    return (
      <div className="mx-auto max-w-md">
        <Card>
          <h1 className="text-xl font-semibold">Redefinir senha</h1>
          <p className="mt-2 text-slate-600">{stageMsg}</p>
        </Card>
      </div>
    );
  }

  if (stage === "err") {
    return (
      <div className="mx-auto max-w-md">
        <Card>
          <h1 className="text-xl font-semibold">Redefinir senha</h1>
          <div className="mt-3 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">
            {stageMsg}
          </div>
          <div className="mt-4 flex gap-4 text-sm">
            <Link className="text-sky-700" to="/forgot-password">
              Solicitar novo link
            </Link>
            <Link className="text-sky-700" to="/login">
              Ir para login
            </Link>
          </div>
        </Card>
      </div>
    );
  }

  if (stage === "done") {
    return (
      <div className="mx-auto max-w-md">
        <Card>
          <h1 className="text-xl font-semibold">Senha atualizada!</h1>
          <p className="mt-2 text-sm text-slate-600">
            Sua senha foi redefinida com sucesso. Redirecionando para o login...
          </p>
        </Card>
      </div>
    );
  }

  // stage === "form"
  return (
    <div className="mx-auto max-w-md">
      <Card>
        <h1 className="text-xl font-semibold">Criar nova senha</h1>
        <p className="mt-1 text-sm text-slate-600">
          Digite e confirme sua nova senha abaixo.
        </p>

        <form onSubmit={handleReset} className="mt-4 space-y-3">
          <input
            className="w-full rounded-xl border px-3 py-2 outline-none focus:ring-2 focus:ring-sky-200"
            value={senha}
            onChange={(e) => setSenha(e.target.value)}
            type="password"
            autoComplete="new-password"
            placeholder="Nova senha"
            required
          />

          <input
            className="w-full rounded-xl border px-3 py-2 outline-none focus:ring-2 focus:ring-sky-200"
            value={confirmSenha}
            onChange={(e) => setConfirmSenha(e.target.value)}
            type="password"
            autoComplete="new-password"
            placeholder="Confirmar nova senha"
            required
          />

          {formErr && (
            <div className="rounded-xl border border-red-200 bg-red-50 p-2 text-sm text-red-700">
              {formErr}
            </div>
          )}

          <button
            disabled={senha.length === 0 || confirmSenha.length === 0 || loading}
            className="w-full rounded-xl bg-sky-600 px-3 py-2 text-white hover:bg-sky-700 disabled:opacity-60"
          >
            {loading ? "Salvando..." : "Salvar nova senha"}
          </button>
        </form>
      </Card>
    </div>
  );
}
