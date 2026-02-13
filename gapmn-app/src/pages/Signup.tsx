// src/pages/Signup.tsx
import { useMemo, useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabase";
import { isFabEmail } from "../lib/validators";
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

const AVATARS = ["a1", "a2", "a3", "a4", "a5", "a6"] as const;

export default function Signup() {
  const nav = useNavigate();

  const [email, setEmail] = useState("");
  const [senha, setSenha] = useState("");
  const [nomeGuerra, setNomeGuerra] = useState("");
  const [unidade, setUnidade] = useState<(typeof UNIDADES)[number]>("GAP-MN");
  const [unidadeOutro, setUnidadeOutro] = useState("");
  const [avatarKey, setAvatarKey] = useState<(typeof AVATARS)[number]>("a1");

  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const unidadeFinal = useMemo(() => {
    if (unidade !== "Outro") return unidade;
    return unidadeOutro.trim() ? `Outro: ${unidadeOutro.trim()}` : "Outro";
  }, [unidade, unidadeOutro]);

  async function handleSignup(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setErr(null);

    // validações
    const emailNorm = email.trim().toLowerCase();
    if (!isFabEmail(emailNorm)) {
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
      // 1) cria usuário no auth
      const { data, error } = await supabase.auth.signUp({
        email: emailNorm,
        password: senha,
      });
      if (error) throw error;

      // 2) cria perfil (isso VAI falhar se não existir policy de INSERT no profiles)
      const user = data.user;
      if (user?.id) {
        const { error: pErr } = await supabase.from("profiles").insert({
          id: user.id,
          email: user.email,
          nome_guerra: nomeGuerra.trim(),
          unidade: unidadeFinal,
          avatar_key: avatarKey,
          role: "user",
        });
        if (pErr) throw pErr;
      }

      // 3) redireciona
      nav("/login");
    } catch (e: any) {
      setErr(e?.message ?? "Erro ao criar conta.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="mx-auto max-w-md">
      <Card>
        <h1 className="text-xl font-semibold">Criar conta</h1>
        <p className="mt-1 text-sm text-slate-600">
          Acesso com e-mail institucional. Interface clean, rápida e feita pro celular também.
        </p>

        <form onSubmit={handleSignup} className="mt-4 space-y-3">
          <div>
            <label className="text-sm text-slate-700">E-mail FAB</label>
            <input
              className="mt-1 w-full rounded-xl border px-3 py-2 outline-none focus:ring-2 focus:ring-sky-200"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="seu.nome@fab.mil.br"
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
              placeholder="mínimo 8 caracteres"
              type="password"
              autoComplete="new-password"
            />
          </div>

          <div>
            <label className="text-sm text-slate-700">Nome de guerra</label>
            <input
              className="mt-1 w-full rounded-xl border px-3 py-2 outline-none focus:ring-2 focus:ring-sky-200"
              value={nomeGuerra}
              onChange={(e) => setNomeGuerra(e.target.value)}
              placeholder="Ex: BRUNO"
            />
          </div>

          <div>
            <label className="text-sm text-slate-700">Unidade</label>
            <select
              className="mt-1 w-full rounded-xl border px-3 py-2 outline-none focus:ring-2 focus:ring-sky-200"
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

          <div>
            <label className="text-sm text-slate-700">Avatar</label>
            <div className="mt-2 grid grid-cols-6 gap-2">
              {AVATARS.map((a) => (
                <button
                  key={a}
                  type="button"
                  onClick={() => setAvatarKey(a)}
                  className={`h-10 rounded-xl border ${
                    avatarKey === a ? "border-sky-400 ring-2 ring-sky-200" : "border-slate-200"
                  } bg-sky-50`}
                  title={`Avatar ${a}`}
                />
              ))}
            </div>
            <p className="mt-2 text-xs text-slate-500">
              Depois a gente troca por imagens reais geradas aqui na IA.
            </p>
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
