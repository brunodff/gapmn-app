import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabase";
import { Card } from "../components/Card";
import { usePush } from "../lib/usePush";

type UserHeader = {
  id?: string;
  nome: string;
  avatarKey?: string | null;
  setor?: "SEO" | "SCON" | "SLIC" | "ADMIN" | null;
};

function formatSetor(s: string | null | undefined): string {
  switch ((s ?? "").toUpperCase()) {
    case "SLIC":  return "Seção de Licitações";
    case "SEO":   return "Seção de Execução Orçamentária";
    case "SCON":  return "Seção de Contratos";
    case "ADMIN": return "Administração";
    default:      return s ?? "-";
  }
}

export default function AppChat() {
  const nav = useNavigate();
  const [me, setMe] = useState<UserHeader>({ nome: "Usuário" });
  const [loggingOut, setLoggingOut] = useState(false);

  const { state: pushState, subscribe: pushSubscribe, unsubscribe: pushUnsubscribe } = usePush(me.id ?? null);

  useEffect(() => {
    (async () => {
      const { data: sess } = await supabase.auth.getSession();
      const user = sess.session?.user;
      if (!user) return;

      const { data: prof } = await supabase
        .from("profiles")
        .select("nome_guerra, avatar_key, setor")
        .eq("id", user.id)
        .maybeSingle();

      const email  = user.email ?? null;
      const nome   = (prof as any)?.nome_guerra || (user.user_metadata as any)?.nome_guerra || (email ? email.split("@")[0] : "Usuário");
      const avatarKey  = (prof as any)?.avatar_key  || (user.user_metadata as any)?.avatar_key  || null;
      const setorP = ((prof as any)?.setor as UserHeader["setor"]) ?? null;

      setMe({ id: user.id, nome, avatarKey, setor: setorP });
    })();
  }, []);

  async function handleLogout() {
    setLoggingOut(true);
    try {
      await supabase.auth.signOut();
      nav("/login", { replace: true });
    } finally {
      setLoggingOut(false);
    }
  }

  const avatarSrc = me.avatarKey ? `/${me.avatarKey}.png` : "/grad_homem.png";

  return (
    <div className="space-y-4">

      {/* Header */}
      <Card>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">

          <div className="flex items-center gap-3 min-w-0">
            <img
              src={avatarSrc}
              alt="Avatar"
              className="h-10 w-10 shrink-0 rounded-xl border border-slate-200 bg-white object-contain"
              onError={(e) => { (e.currentTarget as HTMLImageElement).src = "/grad_homem.png"; }}
            />
            <div className="min-w-0">
              <h2 className="text-base font-semibold leading-tight">GAP-MN · Sistema de Gestão</h2>
              <p className="text-xs text-slate-500 truncate">
                {me.nome}
                {me.setor ? <span className="ml-1 opacity-70">· {formatSetor(me.setor)}</span> : null}
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-1.5">
            {/* Sino push */}
            {pushState !== "unsupported" && (
              <button
                title={
                  pushState === "subscribed" ? "Notificações ativas — toque para desativar"
                  : pushState === "denied"   ? "Notificações bloqueadas pelo navegador"
                  : "Ativar notificações"
                }
                disabled={pushState === "loading" || pushState === "denied"}
                onClick={() => pushState === "subscribed" ? pushUnsubscribe() : pushSubscribe()}
                className={`relative rounded-xl border px-3 py-1.5 text-sm transition-colors disabled:opacity-50 ${
                  pushState === "subscribed" ? "border-amber-300 bg-amber-50 text-amber-600 hover:bg-amber-100"
                  : pushState === "denied"   ? "border-red-200 bg-red-50 text-red-400 cursor-not-allowed"
                  : "border-slate-200 bg-white text-slate-400 hover:bg-slate-50"
                }`}
              >
                {pushState === "denied" ? "🔕" : "🔔"}
                {pushState === "subscribed" && (
                  <span className="absolute -top-1 -right-1 h-2.5 w-2.5 rounded-full bg-amber-400 border-2 border-white" />
                )}
              </button>
            )}

            <button
              onClick={handleLogout}
              disabled={loggingOut}
              className="rounded-xl border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-60 whitespace-nowrap"
            >
              {loggingOut ? "Saindo..." : "Sair"}
            </button>
          </div>
        </div>
      </Card>

      {/* Cards de navegação */}
      <div className="mx-auto w-full max-w-lg space-y-4">
        <button
          onClick={() => nav("/setor")}
          className="w-full rounded-2xl border-2 border-sky-200 bg-sky-50 p-6 text-left hover:bg-sky-100 active:bg-sky-200 transition-colors"
        >
          <div className="text-3xl mb-2">📋</div>
          <div className="text-lg font-semibold text-sky-800">Gerenciamentos</div>
          <div className="text-sm text-sky-600 mt-1">Contratos · Processos · Indicadores de Lotação</div>
        </button>

        <button
          onClick={() => nav("/orcamento")}
          className="w-full rounded-2xl border-2 border-emerald-200 bg-emerald-50 p-6 text-left hover:bg-emerald-100 active:bg-emerald-200 transition-colors"
        >
          <div className="text-3xl mb-2">💰</div>
          <div className="text-lg font-semibold text-emerald-800">Painel Orçamentário</div>
          <div className="text-sm text-emerald-600 mt-1">Crédito disponível · Empenhos · Restos a Pagar</div>
        </button>
      </div>

      {/* ── CHATBOT_HIDDEN — reativar quando necessário ──────────────────────────
      Todo o código do chatbot (chips, histórico, input, encaminhamento,
      minhas dúvidas, toast de tickets) foi ocultado aqui.
      Para reativar: restaurar a versão anterior do AppChat.tsx do git.
      ─────────────────────────────────────────────────────────────────────── */}
    </div>
  );
}
