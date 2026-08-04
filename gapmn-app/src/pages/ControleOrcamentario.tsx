import { useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import PainelRP from "../components/PainelRP";
import CnetRoboGapmn from "../components/CnetRoboGapmn";
import PainelProcessos from "../components/PainelProcessos";
import PainelExecucao from "../components/PainelExecucao";

const BI_URL =
  "https://app.powerbi.com/view?r=eyJrIjoiYjJiZWE0NWItZTJkNS00ZjMzLThhYTQtOTNkODhhOGQ3MzM1IiwidCI6IjNhMzY0ZGI2LTg2NmEtNDRkOS1iMzY5LWM1ODk1OWQ0NDhmOCJ9";

type Painel = "orcamentario" | "rp" | "processos" | "execucao";

export default function PaineisGerenciaisPage() {
  const nav = useNavigate();
  const [painel, setPainel] = useState<Painel>("orcamentario");
  const [maximized, setMaximized] = useState(false);
  const [iframeKey, setIframeKey] = useState(0);

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
            <button
              onClick={() => nav("/app")}
              className="rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-600 hover:bg-slate-50"
            >
              ← Voltar
            </button>
          </div>
        </div>

        {/* ── Seletor de painel ── */}
        <div className="flex gap-2 border-b border-slate-200 pb-0">
          {([
            ["orcamentario", "💰 Painel Orçamentário"],
            ["rp",           "📋 Painel de RP"],
            ["processos",    "🤖 Painel de Processos"],
            ["execucao",     "📈 Painel de Execução"],
          ] as const).map(([key, label]) => (
            <button
              key={key}
              onClick={() => setPainel(key)}
              className={`px-5 py-2.5 text-sm font-semibold border-b-2 transition-colors -mb-px ${
                painel === key
                  ? "border-sky-600 text-sky-700"
                  : "border-transparent text-slate-500 hover:text-slate-700 hover:border-slate-300"
              }`}
            >
              {label}
            </button>
          ))}
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
