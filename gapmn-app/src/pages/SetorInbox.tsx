import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";

import { supabase } from "../lib/supabase";
import { initAnalytics, logActivity, startHeartbeat } from "../lib/analytics";
import PainelAnalytics from "../components/PainelAnalytics";
import GerenciamentoProcessos from "../components/GerenciamentoProcessos";
import GerenciamentoContratos from "../components/GerenciamentoContratos";
import IndicadoresLotacao from "../components/IndicadoresLotacao";
import AtasRegistroPreco from "../components/AtasRegistroPreco";
import PainelSolicitacoesEmpenho from "../components/PainelSolicitacoesEmpenho";
import AtaApuracao from "../components/AtaApuracao";
import CalendarioLicitacoes from "../components/CalendarioLicitacoes";

type Setor = "SEO" | "SCON" | "SLIC" | "ADMIN" | "DEV";

type Profile = {
  id: string;
  nome_guerra: string | null;
  email: string | null;
  setor: Setor | null;
};

function isAgent(profile?: Profile | null) {
  const setor = profile?.setor?.toUpperCase();
  return setor === "ADMIN" || setor === "DEV" || setor === "SEO" || setor === "SCON" || setor === "SLIC";
}

function formatSetor(s: string | null | undefined): string {
  switch ((s ?? "").toUpperCase()) {
    case "SLIC":  return "Seção de Licitações";
    case "SEO":   return "Seção de Execução Orçamentária";
    case "SCON":  return "Seção de Contratos";
    case "ADMIN": return "Administração";
    default:      return s ?? "-";
  }
}

export default function SetorInbox() {
  const nav = useNavigate();
  const [me, setMe] = useState<Profile | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const [sp] = useSearchParams();

  const defaultTab = sp.get("tab") || (me?.setor === "SEO" ? "indicadores" : "contratos");
  const [tab, setTab] = useState<"processos" | "contratos" | "indicadores" | "atas" | "solicitacoes" | "ata_disciplinar" | "calendario" | "configuracoes" | "analytics">(defaultTab as any);
  const isDev = me?.setor === "DEV";
  const showAnyExtraTab      = true;
  const canImportIndicadores = isDev || me?.setor === "SEO"   || me?.setor === "ADMIN";
  const canImportContratos   = isDev || me?.setor === "SCON"  || me?.setor === "ADMIN";
  const canImportProcessos   = isDev || me?.setor === "SLIC"  || me?.setor === "ADMIN";
  const canEdit              = isAgent(me);
  const canManageSolicitacoes = isDev || me?.setor === "SEO" || me?.setor === "ADMIN";
  const isAdmin              = isDev || me?.setor === "ADMIN";


  useEffect(() => {
    let stopHeartbeat: (() => void) | undefined;
    (async () => {
      setErr(null);
      const { data: sess } = await supabase.auth.getSession();
      const uid = sess.session?.user.id;
      if (!uid) { setErr("Sessão inválida. Faça login novamente."); return; }

      const { data: prof, error: e1 } = await supabase
        .from("profiles")
        .select("id, nome_guerra, email, setor")
        .eq("id", uid)
        .maybeSingle();

      if (e1) { setErr(e1.message); return; }

      const raw = (prof ?? null) as any;
      const profile = raw ? { ...raw, setor: raw.setor?.toUpperCase() ?? null } : null;
      setMe(profile);
      if (uid && profile) {
        initAnalytics(uid, profile.setor ?? null, profile.nome_guerra ?? null);
        logActivity("page_view", "setor");
        stopHeartbeat = startHeartbeat();
      }
    })();
    return () => stopHeartbeat?.();
  }, []);

  const TAB_META: Record<string, { label: string; icon: string }> = {
    contratos:      { label: "Contratos",              icon: "📋" },
    processos:      { label: "Processos",              icon: "⚖️" },
    atas:           { label: "Atas de RP",             icon: "📝" },
    indicadores:    { label: "Indicadores de Lotação", icon: "📊" },
    solicitacoes:   { label: "Solicitações",           icon: "📬" },
    ata_disciplinar:{ label: "Ata de Apuração",        icon: "🎙️" },
    calendario:     { label: "Calendário SLIC",         icon: "📅" },
    configuracoes:  { label: "Configurações",          icon: "⚙️" },
    analytics:      { label: "Analytics DEV",          icon: "📡" },
  };

  return (
    <div className="space-y-4">
      {/* Header + Tabs */}
      <div className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
        {/* Barra superior */}
        <div className="flex items-center justify-between gap-3 px-5 py-3 border-b border-slate-100">
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-base font-bold text-slate-800 truncate">
              {TAB_META[tab]?.icon} {TAB_META[tab]?.label}
            </span>
            <span className="hidden sm:inline text-xs text-slate-400">
              · {me?.setor === "ADMIN" ? "Administração" : formatSetor(me?.setor)}
            </span>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            <button
              onClick={() => nav("/ferramentas")}
              className="rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs text-slate-600 hover:bg-slate-50 transition-colors"
              title="Ferramentas, robôs e guia do sistema"
            >
              🔧 Ferramentas
            </button>
            <button
              onClick={() => nav("/app")}
              className="rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs text-slate-600 hover:bg-slate-50 transition-colors"
            >
              ← Início
            </button>
            <button
              onClick={async () => { await supabase.auth.signOut(); nav("/"); }}
              className="rounded-lg border border-red-200 bg-red-50 px-2.5 py-1.5 text-xs text-red-600 hover:bg-red-100 transition-colors"
            >
              Sair
            </button>
          </div>
        </div>

        {/* Abas */}
        {showAnyExtraTab && (
          <div className="flex overflow-x-auto">
            {(["contratos", "processos", "atas", "indicadores", "solicitacoes", "ata_disciplinar", "calendario"] as const).map((t) => {
              const { label, icon } = TAB_META[t];
              return (
                <button
                  key={t}
                  onClick={() => { setTab(t); logActivity("tab_change", t); }}
                  className={`flex items-center gap-1.5 px-4 py-2.5 text-xs font-medium whitespace-nowrap border-b-2 transition-colors ${
                    tab === t
                      ? "border-sky-600 text-sky-700 bg-sky-50/60"
                      : "border-transparent text-slate-500 hover:text-slate-700 hover:bg-slate-50"
                  }`}
                >
                  <span>{icon}</span>
                  <span>{label}</span>
                </button>
              );
            })}
            {isAdmin && (
              <button
                onClick={() => { setTab("configuracoes"); logActivity("tab_change", "configuracoes"); }}
                className={`flex items-center gap-1.5 px-4 py-2.5 text-xs font-medium whitespace-nowrap border-b-2 transition-colors ml-auto ${
                  tab === "configuracoes"
                    ? "border-purple-600 text-purple-700 bg-purple-50/60"
                    : "border-transparent text-slate-400 hover:text-slate-600 hover:bg-slate-50"
                }`}
              >
                <span>⚙️</span>
                <span>Configurações</span>
              </button>
            )}
            {isDev && (
              <button
                onClick={() => { setTab("analytics"); logActivity("tab_change", "analytics"); }}
                className={`flex items-center gap-1.5 px-4 py-2.5 text-xs font-medium whitespace-nowrap border-b-2 transition-colors ${
                  tab === "analytics"
                    ? "border-green-600 text-green-700 bg-green-50/60"
                    : "border-transparent text-slate-400 hover:text-slate-600 hover:bg-slate-50"
                }`}
              >
                <span>📡</span>
                <span>Analytics</span>
              </button>
            )}
          </div>
        )}

        {err && (
          <div className="mx-4 mb-3 rounded-xl border border-red-200 bg-red-50 p-2 text-sm text-red-700">
            {err}
          </div>
        )}
      </div>

      {/* Conteúdo da aba Indicadores de Lotação */}
      {tab === "indicadores" && (
        <IndicadoresLotacao canImport={canImportIndicadores} />
      )}

      {/* Conteúdo da aba Gerenciamento de Processos */}
      {tab === "processos" && <GerenciamentoProcessos canImport={canImportProcessos} canEdit={canEdit} canEditElaboracao={canImportProcessos} />}

      {/* Conteúdo da aba Gerenciamento de Contratos */}
      {tab === "contratos" && <GerenciamentoContratos canImport={canImportContratos} canEdit={canEdit} canEditBudget={canImportContratos} />}

      {/* Conteúdo da aba Atas de RP */}
      {tab === "atas" && <AtasRegistroPreco canSync={canImportProcessos} />}

      {/* Conteúdo da aba Solicitações de Empenho */}
      {tab === "solicitacoes" && <PainelSolicitacoesEmpenho canManage={canManageSolicitacoes} />}

      {/* Ata de Apuração — digitação por voz */}
      {tab === "ata_disciplinar" && <AtaApuracao />}

      {/* Calendário de Licitações SLIC */}
      {tab === "calendario" && (
        <CalendarioLicitacoes
          canEdit={canImportProcessos}
          userNome={me?.nome_guerra ?? null}
        />
      )}

      {/* Conteúdo da aba Configurações — apenas ADMIN/DEV */}
      {tab === "configuracoes" && (
        isAdmin
          ? <AdminPanel />
          : <div className="rounded-2xl border border-red-200 bg-red-50 p-8 text-center text-sm text-red-700">🔒 Acesso restrito a administradores.</div>
      )}

      {tab === "analytics" && (
        isDev
          ? <PainelAnalytics />
          : <div className="rounded-2xl border border-red-200 bg-red-50 p-8 text-center text-sm text-red-700">🔒 Acesso restrito a DEV.</div>
      )}

    </div>
  );
}

// ── Painel de Gerenciamento de Usuários (ADMIN) ───────────────────────────────
const SETORES_OPTS = ["SEO", "SCON", "SLIC", "ADMIN", "DEV"] as const;

function AdminPanel() {
  type AdminUser = { id: string; nome_guerra: string | null; email: string | null; setor: string | null };
  const [users,   setUsers]   = useState<AdminUser[]>([]);
  const [edits,   setEdits]   = useState<Record<string, string>>({});
  const [saving,  setSaving]  = useState<Record<string, boolean>>({});
  const [saved,   setSaved]   = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from("profiles")
        .select("id, nome_guerra, email, setor")
        .order("nome_guerra");
      setUsers((data ?? []) as AdminUser[]);
      setLoading(false);
    })();
  }, []);

  async function saveSetor(uid: string) {
    const novoSetor = edits[uid] ?? "";
    setSaving((p) => ({ ...p, [uid]: true }));
    const { error } = await supabase
      .from("profiles")
      .update({ setor: novoSetor || null })
      .eq("id", uid);
    setSaving((p) => ({ ...p, [uid]: false }));
    if (error) {
      alert(`Erro ao salvar: ${error.message}\n\nVerifique se a política RLS da tabela "profiles" permite que administradores atualizem outros usuários.`);
      return;
    }
    setUsers((prev) => prev.map((u) => u.id === uid ? { ...u, setor: novoSetor || null } : u));
    setSaved((p) => ({ ...p, [uid]: true }));
    setTimeout(() => setSaved((p) => ({ ...p, [uid]: false })), 2000);
  }

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-slate-200 bg-white shadow-sm p-5">
        <div className="mb-4">
          <div className="text-sm font-bold text-slate-800">Gerenciamento de Usuários</div>
          <div className="text-xs text-slate-400 mt-0.5">
            Defina o setor e as permissões de cada usuário. A role determina quais abas e ações estão disponíveis.
          </div>
        </div>

        {loading && <div className="text-xs text-slate-400 py-4 text-center">Carregando usuários…</div>}

        {!loading && (
          <div className="overflow-x-auto">
            <table className="w-full text-xs border-collapse">
              <thead>
                <tr className="border-b border-slate-200">
                  <th className="py-2 px-3 text-left font-semibold text-slate-500 uppercase tracking-wide text-[10px]">Usuário</th>
                  <th className="py-2 px-3 text-left font-semibold text-slate-500 uppercase tracking-wide text-[10px]">Setor / Role</th>
                  <th className="py-2 px-3 text-left font-semibold text-slate-500 uppercase tracking-wide text-[10px]">Ação</th>
                </tr>
              </thead>
              <tbody>
                {users.map((u) => {
                  const cur   = edits[u.id] ?? (u.setor ?? "");
                  const dirty = cur !== (u.setor ?? "");
                  return (
                    <tr key={u.id} className="border-b border-slate-100 hover:bg-slate-50 transition-colors">
                      <td className="py-2.5 px-3">
                        <div className="font-semibold text-slate-800">{u.nome_guerra ?? "—"}</div>
                        {u.email && <div className="text-slate-400 text-[10px] mt-0.5">{u.email}</div>}
                      </td>
                      <td className="py-2.5 px-3">
                        <select
                          value={cur}
                          onChange={(e) => setEdits((p) => ({ ...p, [u.id]: e.target.value }))}
                          className="rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs outline-none focus:ring-2 focus:ring-sky-200 bg-white"
                        >
                          <option value="">— Sem setor —</option>
                          {SETORES_OPTS.map((s) => (
                            <option key={s} value={s}>{s}</option>
                          ))}
                        </select>
                      </td>
                      <td className="py-2.5 px-3">
                        <button
                          onClick={() => saveSetor(u.id)}
                          disabled={!dirty || saving[u.id]}
                          className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${
                            saved[u.id]
                              ? "border-green-200 bg-green-50 text-green-700"
                              : dirty
                              ? "border-sky-200 bg-sky-50 text-sky-700 hover:bg-sky-100 cursor-pointer"
                              : "border-slate-100 text-slate-300 cursor-default"
                          }`}
                        >
                          {saving[u.id] ? "…" : saved[u.id] ? "✓ Salvo" : "Salvar"}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Legenda de roles */}
      <div className="rounded-2xl border border-slate-200 bg-white shadow-sm p-5">
        <div className="text-xs font-bold text-slate-700 mb-3">Permissões por Role</div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
          {[
            { role: "ADMIN", desc: "Acesso total: importar, editar, configurar e ver todos os painéis.", color: "text-purple-700 bg-purple-50 border-purple-200" },
            { role: "DEV",   desc: "Igual ao ADMIN — usada para desenvolvimento e suporte técnico.", color: "text-slate-700 bg-slate-50 border-slate-200" },
            { role: "SEO",   desc: "Importar indicadores de lotação, gerenciar solicitações de empenho.", color: "text-sky-700 bg-sky-50 border-sky-200" },
            { role: "SCON",  desc: "Importar e editar contratos.", color: "text-indigo-700 bg-indigo-50 border-indigo-200" },
            { role: "SLIC",  desc: "Importar processos licitatórios e gerenciar Atas de RP.", color: "text-amber-700 bg-amber-50 border-amber-200" },
          ].map(({ role, desc, color }) => (
            <div key={role} className={`rounded-lg border px-3 py-2 ${color}`}>
              <span className="font-bold">{role}</span>
              <span className="ml-2 text-[11px] opacity-80">{desc}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-2.5 text-xs text-amber-700">
        ⚠️ Alterações têm efeito imediato. Usuários ADMIN têm acesso a todas as funcionalidades, incluindo o Painel de Governança.
      </div>
    </div>
  );
}
