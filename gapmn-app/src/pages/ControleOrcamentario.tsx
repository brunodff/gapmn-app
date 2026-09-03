import { useState, useCallback, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabase";
import PainelRP from "../components/PainelRP";
import CnetRoboGapmn from "../components/CnetRoboGapmn";
import PainelProcessos from "../components/PainelProcessos";
import PainelExecucao from "../components/PainelExecucao";

const BI_URL =
  "https://app.powerbi.com/view?r=eyJrIjoiYjJiZWE0NWItZTJkNS00ZjMzLThhYTQtOTNkODhhOGQ3MzM1IiwidCI6IjNhMzY0ZGI2LTg2NmEtNDRkOS1iMzY5LWM1ODk1OWQ0NDhmOCJ9";

const GOV_URL =
  "https://app.powerbi.com/view?r=eyJrIjoiMGI0ZDUxZDAtOTQzOC00YmNiLTk1OTctYzA1NDk5MjkxMDNjIiwidCI6IjNhMzY0ZGI2LTg2NmEtNDRkOS1iMzY5LWM1ODk1OWQ0NDhmOCJ9";

type Painel = "orcamentario" | "rp" | "processos" | "execucao" | "governanca";

export default function PaineisGerenciaisPage() {
  const nav = useNavigate();
  const [painel, setPainel] = useState<Painel>("orcamentario");
  const [maximized, setMaximized] = useState(false);
  const [iframeKey, setIframeKey] = useState(0);
  const [govKey,    setGovKey]    = useState(0);
  const [userSetor, setUserSetor] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const { data: sess } = await supabase.auth.getSession();
      const uid = sess.session?.user.id;
      if (!uid) return;
      const { data } = await supabase
        .from("profiles").select("setor").eq("id", uid).maybeSingle();
      setUserSetor((data as any)?.setor?.toUpperCase() ?? null);
    })();
  }, []);

  const isAdmin = userSetor === "ADMIN" || userSetor === "DEV";

  const reload = useCallback(() => setIframeKey((k) => k + 1), []);
  const src = `${BI_URL}&_k=${iframeKey}`;

  return (
    <>
      <div className="flex flex-col gap-3">

        {/* ── Header ── */}
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <h2 className="text-base font-semibold text-slate-900">Painéis Gerenciais</h2>
            <p className="text-xs text-slate-500">GAP-MN e subordinadas</p>
          </div>
          <div className="flex items-center gap-2">
            {painel === "orcamentario" && (
              <>
                <button
                  onClick={reload}
                  className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 hover:bg-slate-50"
                  title="Recarregar painel"
                >
                  ↺ Recarregar
                </button>
                <button
                  onClick={() => setMaximized(true)}
                  className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 hover:bg-slate-50"
                  title="Maximizar painel"
                >
                  ⛶ Maximizar
                </button>
              </>
            )}
            {painel === "governanca" && isAdmin && (
              <button
                onClick={() => setGovKey((k) => k + 1)}
                className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 hover:bg-slate-50"
                title="Recarregar painel"
              >
                ↺ Recarregar
              </button>
            )}
            <button
              onClick={() => nav("/app")}
              className="rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-600 hover:bg-slate-50"
            >
              ← Voltar
            </button>
          </div>
        </div>

        {/* ── Seletor de painel ── */}
        <div className="flex gap-2 border-b border-slate-200 pb-0 overflow-x-auto">
          {([
            ["orcamentario", "💰 Painel Orçamentário"],
            ["rp",           "📋 Painel de RP"],
            ["processos",    "🤖 Painel de Processos"],
            ["execucao",     "📈 Painel de Execução"],
          ] as const).map(([key, label]) => (
            <button
              key={key}
              onClick={() => setPainel(key)}
              className={`px-5 py-2.5 text-sm font-semibold border-b-2 transition-colors -mb-px whitespace-nowrap ${
                painel === key
                  ? "border-sky-600 text-sky-700"
                  : "border-transparent text-slate-500 hover:text-slate-700 hover:border-slate-300"
              }`}
            >
              {label}
            </button>
          ))}
          {isAdmin && (
            <button
              onClick={() => setPainel("governanca")}
              className={`px-5 py-2.5 text-sm font-semibold border-b-2 transition-colors -mb-px whitespace-nowrap ${
                painel === "governanca"
                  ? "border-purple-600 text-purple-700"
                  : "border-transparent text-slate-500 hover:text-slate-700 hover:border-slate-300"
              }`}
            >
              🏛️ Painel de Governança
            </button>
          )}
        </div>

        {/* ── Conteúdo ── */}
        {painel === "orcamentario" && (
          <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
            <iframe
              key={iframeKey}
              title="Painel Orçamentário GAP-MN"
              src={src}
              className="h-[calc(100dvh-13rem)] w-full"
              allowFullScreen
            />
          </div>
        )}

        {painel === "rp" && (
          <PainelRP />
        )}

        {painel === "processos" && (
          <PainelProcessos />
        )}

        {painel === "execucao" && (
          <PainelExecucao />
        )}

        {painel === "governanca" && (
          isAdmin ? (
            <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
              <iframe
                key={govKey}
                title="Painel de Governança GAP-MN"
                src={`${GOV_URL}&_k=${govKey}`}
                className="h-[calc(100dvh-13rem)] w-full"
                allowFullScreen
              />
            </div>
          ) : (
            <div className="rounded-xl border border-red-200 bg-red-50 p-8 text-center text-sm text-red-700">
              🔒 Acesso restrito a administradores do sistema.
            </div>
          )
        )}
      </div>

      {/* ── Overlay maximizado (só Orçamentário) ── */}
      {maximized && (
        <div className="fixed inset-0 z-50 flex flex-col bg-white">
          <div className="flex shrink-0 items-center justify-between border-b border-slate-200 bg-white px-4 py-2">
            <span className="text-sm font-semibold text-slate-800">
              Painel Orçamentário — GAP-MN
            </span>
            <div className="flex items-center gap-2">
              <button
                onClick={reload}
                className="rounded-xl border border-slate-200 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50"
              >
                ↺ Recarregar
              </button>
              <button
                onClick={() => setMaximized(false)}
                className="rounded-xl border border-slate-200 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50"
              >
                ✕ Restaurar
              </button>
            </div>
          </div>
          <iframe
            key={`max-${iframeKey}`}
            title="Painel Orçamentário GAP-MN Maximizado"
            src={src}
            className="flex-1 w-full"
            allowFullScreen
          />
        </div>
      )}
    </>
  );
}
