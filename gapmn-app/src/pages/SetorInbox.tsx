import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";

import { supabase } from "../lib/supabase";
import { Card } from "../components/Card";
import GerenciamentoProcessos from "../components/GerenciamentoProcessos";
import GerenciamentoContratos from "../components/GerenciamentoContratos";
import GerenciamentoEmpenhos from "../components/GerenciamentoEmpenhos";
import IndicadoresLotacao from "../components/IndicadoresLotacao";
import AtasRegistroPreco from "../components/AtasRegistroPreco";

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
  const [tab, setTab] = useState<"processos" | "contratos" | "indicadores" | "empenhos" | "atas">(defaultTab as any);
  const isDev = me?.setor === "DEV";
  const showAnyExtraTab    = true;
  const canImportIndicadores = isDev || me?.setor === "SEO"   || me?.setor === "ADMIN";
  const canImportContratos   = isDev || me?.setor === "SCON"  || me?.setor === "ADMIN";
  const canImportProcessos   = isDev || me?.setor === "SLIC"  || me?.setor === "ADMIN";
  const canEdit              = isAgent(me);
  const canSyncEmpenhos      = isDev || me?.setor === "SEO" || me?.setor === "ADMIN";


  useEffect(() => {
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
      setMe(raw ? { ...raw, setor: raw.setor?.toUpperCase() ?? null } : null);
    })();
  }, []);

  return (
    <div className="space-y-4">
      <Card>
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-lg font-semibold text-slate-900">
              {tab === "processos"  ? "Processos"
                : tab === "contratos" ? "Contratos"
                : tab === "empenhos"  ? "Empenhos"
                : tab === "atas"      ? "Atas de RP"
                : "Indicadores de Lotação"}
            </div>
            <div className="text-sm text-slate-600">
              {me?.setor === "ADMIN" ? "Chefe do GAP" : `Setor: ${formatSetor(me?.setor)}`}
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => nav("/ferramentas")}
              className="rounded-xl border border-violet-200 bg-violet-50 px-3 py-2 text-xs text-violet-700 hover:bg-violet-100"
              title="Ferramentas, robôs e guia do sistema"
            >
              🔧 Ferramentas
            </button>
            <button
              onClick={() => nav("/app")}
              className="rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50"
            >
              ← Início
            </button>
            <button
              onClick={async () => { await supabase.auth.signOut(); nav("/"); }}
              className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 hover:bg-red-100"
            >
              Sair
            </button>
          </div>
        </div>

        {/* Abas */}
        {showAnyExtraTab && (
          <div className="mt-3 flex flex-wrap gap-1 border-b border-slate-200">
            {(["contratos", "processos", "atas", "indicadores", "empenhos"] as const).map((t) => {
              const labels: Record<string, string> = {
                indicadores: "Indicadores de Lotação",
                contratos:   "Contratos",
                processos:   "Processos",
                atas:        "Atas de RP",
                empenhos:    "Empenhos",
              };
              return (
                <button
                  key={t}
                  onClick={() => setTab(t)}
                  className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                    tab === t
                      ? "border-sky-600 text-sky-700"
                      : "border-transparent text-slate-500 hover:text-slate-700"
                  }`}
                >
                  {labels[t]}
                </button>
              );
            })}
          </div>
        )}

        {err && (
          <div className="mt-3 rounded-xl border border-red-200 bg-red-50 p-2 text-sm text-red-700">
            {err}
          </div>
        )}
      </Card>

      {/* Conteúdo da aba Indicadores de Lotação */}
      {tab === "indicadores" && (
        <IndicadoresLotacao canImport={canImportIndicadores} />
      )}

      {/* Conteúdo da aba Gerenciamento de Processos */}
      {tab === "processos" && <GerenciamentoProcessos canImport={canImportProcessos} canEdit={canEdit} canEditElaboracao={canImportProcessos} />}

      {/* Conteúdo da aba Gerenciamento de Contratos */}
      {tab === "contratos" && <GerenciamentoContratos canImport={canImportContratos} canEdit={canEdit} />}

      {/* Conteúdo da aba Atas de RP */}
      {tab === "atas" && <AtasRegistroPreco canSync={canImportProcessos} />}

      {/* Conteúdo da aba Empenhos */}
      {tab === "empenhos" && <GerenciamentoEmpenhos canSync={canSyncEmpenhos} userRole={me?.setor ?? undefined} />}

    </div>
  );
}
