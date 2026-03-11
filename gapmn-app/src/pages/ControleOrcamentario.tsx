import { useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";

const BI_URL =
  "https://app.powerbi.com/view?r=eyJrIjoiYjJiZWE0NWItZTJkNS00ZjMzLThhYTQtOTNkODhhOGQ3MzM1IiwidCI6IjNhMzY0ZGI2LTg2NmEtNDRkOS1iMzY5LWM1ODk1OWQ0NDhmOCJ9";

export default function ControleOrcamentario() {
  const nav = useNavigate();
  const [maximized, setMaximized] = useState(false);
  // Mudar a key força o React a remontar o iframe, limpando o cache
  const [iframeKey, setIframeKey] = useState(0);

  const reload = useCallback(() => setIframeKey((k) => k + 1), []);

  const src = `${BI_URL}&_k=${iframeKey}`;

  return (
    <>
      {/* Layout normal */}
      <div className="flex flex-col gap-3">
        {/* Header */}
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-slate-900">Controle Orçamentário</h2>
            <p className="text-xs text-slate-500">
              Painel de execução orçamentária — GAP-MN e subordinadas
            </p>
          </div>
          <div className="flex items-center gap-2">
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
            <button
              onClick={() => nav("/app")}
              className="rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-600 hover:bg-slate-50"
            >
              ← Voltar
            </button>
          </div>
        </div>

        {/* iframe normal */}
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
          <iframe
            key={iframeKey}
            title="Painel BI GAP-MN"
            src={src}
            className="h-[calc(100dvh-13rem)] w-full"
            allowFullScreen
          />
        </div>
      </div>

      {/* Overlay maximizado */}
      {maximized && (
        <div className="fixed inset-0 z-50 flex flex-col bg-white">
          <div className="flex shrink-0 items-center justify-between border-b border-slate-200 bg-white px-4 py-2">
            <span className="text-sm font-semibold text-slate-800">
              Controle Orçamentário — GAP-MN
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
            title="Painel BI GAP-MN Maximizado"
            src={src}
            className="flex-1 w-full"
            allowFullScreen
          />
        </div>
      )}
    </>
  );
}
