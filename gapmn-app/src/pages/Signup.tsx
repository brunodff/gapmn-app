import { useMemo, useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabase";
import { Card } from "../components/Card";

const UNIDADES = [
  "CINDACTA IV",
  "GAP-MN",
  "SEREP-MN",
  "SERIPA-MN",
  "COMARA",
  "COMAR VII",
  "HAMN",
  "PAMN",
  "BAMN",
  "Outro",
] as const;

// ✅ Avatares no /public (PNG): 7_homem.png, 7_mulher.png, ...
const AVATARS = [
  { key: "7_homem" },
  { key: "7_mulher" },
  { key: "10_homem" },
  { key: "10_mulher" },
  { key: "grad_homem" },
  { key: "grad_mulher" },
] as const;

type AvatarKey = (typeof AVATARS)[number]["key"];

function isFabEmail(email: string) {
  const e = (email || "").trim().toLowerCase();
  return e.endsWith("@fab.mil.br");
}

function traduzErroAuth(msg?: string) {
  const m = (msg || "").toLowerCase();

  if (m.includes("user already registered")) return "Este e-mail já está cadastrado. Tente entrar.";
  if (m.includes("invalid login credentials")) return "E-mail ou senha inválidos.";
  if (m.includes("password should be at least")) return "A senha deve ter pelo menos 8 caracteres.";
  if (m.includes("email rate limit exceeded")) return "Muitas tentativas. Aguarde um pouco e tente novamente.";
  if (m.includes("invalid email")) return "E-mail inválido.";
  if (m.includes("signup requires a valid password")) return "Senha inválida.";

  return msg || "Ocorreu um erro. Tente novamente.";
}

export default function Signup() {
  const nav = useNavigate();

  const [email, setEmail] = useState("");
  const [senha, setSenha] = useState("");
  const [nomeGuerra, setNomeGuerra] = useState("");
  const [unidade, setUnidade] = useState<(typeof UNIDADES)[number]>("GAP-MN");
  const [unidadeOutro, setUnidadeOutro] = useState("");
  const [avatarKey, setAvatarKey] = useState<AvatarKey>("7_homem");

  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const unidadeFinal = useMemo(() => {
    if (unidade !== "Outro") return unidade;
    return unidadeOutro.trim() ? `Outro: ${unidadeOutro.trim()}` : "Outro";
  }, [unidade, unidadeOutro]);

  async function handleSignup(e: FormEvent) {
    e.preventDefault();
    setErr(null);

    if (!isFabEmail(email)) {
      setErr("Use um e-mail institucional @fab.mil.br.");
      return;
    }
    if (senha.length < 8) {
      setErr("A senha deve ter pelo menos 8 caracteres.");
      return;
    }
    if (!nomeGuerra.trim()) {
      setErr("Informe seu nome de guerra.");
      return;
    }

    setLoading(true);
    try {
      const redirectTo = `${window.location.origin}/auth/confirm`;

      const { error } = await supabase.auth.signUp({
        email: email.trim().toLowerCase(),
        password: senha,
        options: {
          emailRedirectTo: redirectTo,
          data: {
            nome_guerra: nomeGuerra.trim(),
            unidade: unidadeFinal,
            avatar_key: avatarKey,
            role: "user",
          },
        },
      });

      if (error) throw error;

      nav("/login?check_email=1", { replace: true });
    } catch (e: any) {
      setErr(traduzErroAuth(e?.message));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="mx-auto max-w-md">
      <Card>
        <h1 className="text-xl font-semibold">Criar conta</h1>
        <p className="mt-1 text-sm text-slate-600">
          Acesso com e-mail institucional. Você vai receber um e-mail de confirmação.
        </p>

        <form onSubmit={handleSignup} className="mt-4 space-y-3">
          <div>
            <input
              className="w-full rounded-xl border px-3 py-2 outline-none focus:ring-2 focus:ring-sky-200"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="E-mail FAB (seu.nome@fab.mil.br)"
              type="email"
              autoComplete="email"
            />
          </div>

          <div>
            <input
              className="w-full rounded-xl border px-3 py-2 outline-none focus:ring-2 focus:ring-sky-200"
              value={senha}
              onChange={(e) => setSenha(e.target.value)}
              placeholder="Senha (mínimo 8 caracteres)"
              type="password"
              autoComplete="new-password"
            />
          </div>

          <div>
            <input
              className="w-full rounded-xl border px-3 py-2 outline-none focus:ring-2 focus:ring-sky-200"
              value={nomeGuerra}
              onChange={(e) => setNomeGuerra(e.target.value)}
              placeholder="Nome de guerra (ex: BRUNO)"
            />
          </div>

          <div>
            <select
              className="w-full rounded-xl border px-3 py-2 outline-none focus:ring-2 focus:ring-sky-200"
              value={unidade}
              onChange={(e) => setUnidade(e.target.value as any)}
            >
              {UNIDADES.map((u) => (
                <option key={u} value={u}>
                  {u}
                </option>
              ))}
            </select>

            {unidade === "Outro" && (
              <input
                className="mt-2 w-full rounded-xl border px-3 py-2 outline-none focus:ring-2 focus:ring-sky-200"
                value={unidadeOutro}
                onChange={(e) => setUnidadeOutro(e.target.value)}
                placeholder="Digite a unidade"
              />
            )}
          </div>

          {/* ✅ Avatar: só imagem (sem label) */}
          <div>
            <div className="text-sm text-slate-700">Escolha seu avatar</div>

            <div className="mt-2 grid grid-cols-6 gap-2">
              {AVATARS.map((a) => {
                const selected = avatarKey === a.key;
                return (
                  <button
                    key={a.key}
                    type="button"
                    onClick={() => setAvatarKey(a.key)}
                    className={`aspect-square rounded-xl border bg-white p-1.5 hover:bg-slate-50 ${
                      selected
                        ? "border-sky-400 ring-2 ring-sky-200"
                        : "border-slate-200"
                    }`}
                    title={a.key}
                  >
                    <img
                      src={`/${a.key}.png`}
                      alt={a.key}
                      className="h-full w-full rounded-lg object-contain"
                      onError={(e) => {
                        (e.currentTarget as HTMLImageElement).src = "/grad_homem.png";
                      }}
                    />
                  </button>
                );
              })}
            </div>
          </div>

          {err && (
            <div className="rounded-xl border border-red-200 bg-red-50 p-2 text-sm text-red-700">
              {err}
            </div>
          )}

          <button
            disabled={loading}
            className="w-full rounded-xl bg-sky-600 px-3 py-2 text-white hover:bg-sky-700 disabled:opacity-60"
          >
            {loading ? "Criando..." : "Criar conta"}
          </button>

          <p className="text-center text-sm text-slate-600">
            Já tem conta?{" "}
            <Link className="text-sky-700" to="/login">
              Entrar
            </Link>
          </p>
        </form>
      </Card>
    </div>
  );
}
