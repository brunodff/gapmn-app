import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import { Link, useNavigate } from "react-router-dom";

type OtpType = "signup" | "magiclink" | "recovery" | "invite" | "email_change";

function parseHashParams() {
  // hash vem tipo: #access_token=...&refresh_token=...&type=signup
  const h = window.location.hash?.startsWith("#") ? window.location.hash.slice(1) : window.location.hash;
  const sp = new URLSearchParams(h || "");
  const obj: Record<string, string> = {};
  sp.forEach((v, k) => (obj[k] = v));
  return obj;
}

export default function AuthConfirm() {
  const nav = useNavigate();
  const [status, setStatus] = useState<"loading" | "ok" | "err">("loading");
  const [msg, setMsg] = useState("Confirmando seu e-mail...");

  useEffect(() => {
    (async () => {
      try {
        const url = new URL(window.location.href);

        // 1) PKCE flow (code=...)
        const code = url.searchParams.get("code");
        if (code) {
          const { error } = await supabase.auth.exchangeCodeForSession(window.location.href);
          if (error) throw error;

          setStatus("ok");
          setMsg("E-mail confirmado com sucesso ✅ Redirecionando para o login...");
          await supabase.auth.signOut();
          setTimeout(() => nav("/login?confirmed=1", { replace: true }), 900);
          return;
        }

        // 2) OTP flow (token_hash=...&type=signup)  ✅ MAIS ROBUSTO
        const token_hash = url.searchParams.get("token_hash");
        const type = url.searchParams.get("type") as OtpType | null;
        if (token_hash && type) {
          const { error } = await supabase.auth.verifyOtp({ token_hash, type });
          if (error) throw error;

          setStatus("ok");
          setMsg("E-mail confirmado com sucesso ✅ Redirecionando para o login...");
          await supabase.auth.signOut();
          setTimeout(() => nav("/login?confirmed=1", { replace: true }), 900);
          return;
        }

        // 3) Implicit flow (tokens no hash)
        const hash = parseHashParams();
        const access_token = hash["access_token"];
        const refresh_token = hash["refresh_token"];
        if (access_token && refresh_token) {
          const { error } = await supabase.auth.setSession({ access_token, refresh_token });
          if (error) throw error;

          setStatus("ok");
          setMsg("E-mail confirmado com sucesso ✅ Redirecionando para o login...");
          await supabase.auth.signOut();
          setTimeout(() => nav("/login?confirmed=1", { replace: true }), 900);
          return;
        }

        // Se não caiu em nenhum formato, o link veio “errado/incompleto”
        throw new Error(
          "Link de confirmação inválido ou incompleto. Abra o e-mail mais recente e clique no botão de confirmação novamente."
        );
      } catch (e: any) {
        setStatus("err");
        setMsg(e?.message ?? "Não foi possível confirmar. Tente novamente.");
      }
    })();
  }, [nav]);

  return (
    <div className="mx-auto max-w-md">
      <div className="rounded-2xl border bg-white p-6 shadow-sm">
        <h1 className="text-xl font-semibold">Confirmação de e-mail</h1>
        <p className="mt-2 text-slate-700">{msg}</p>

        {status === "err" && (
          <div className="mt-4 flex gap-4">
            <Link className="text-sky-700" to="/login">
              Ir para login
            </Link>
            <Link className="text-sky-700" to="/signup">
              Criar conta
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}
