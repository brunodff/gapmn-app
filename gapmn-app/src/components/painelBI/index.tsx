import { useState, useEffect } from "react";
import TabCredito  from "./TabCredito";
import TabEmpenhos from "./TabEmpenhos";
import TabRP       from "./TabRP";
import { medidas } from "./mockData";
import {
  SHEET_URLS,
  fetchCSV,
  toCreditoLinhas,
  agregaPorOM,
  toControleEmpenhos,
  toLinhasRP,
  type ResumoOM,
  type ControleEmpenho,
  type LinhaRP,
} from "../../lib/gsheets";

type Tab = "credito" | "empenhos" | "rp";

const TABS: { id: Tab; label: string }[] = [
  { id: "credito",  label: "Crédito" },
  { id: "empenhos", label: "Empenhos (SEO)" },
  { id: "rp",       label: "Restos a Pagar" },
];

interface PainelBIProps {
  /** Quando true: container ocupa toda a altura disponível sem rolagem externa */
  fitHeight?: boolean;
}

interface SheetState {
  loading: boolean;
  error:   string | null;
  resumoOMs:      ResumoOM[];
  totalCredito:   number;
  totalEmpenhado: number;
  totalALiquidar: number;
  totalAPagar:    number;
  empenhos:       ControleEmpenho[];
  linhasRP:       LinhaRP[];
  totalInscrito:  number;
  atualizado:     string;
}

const DEFAULT_STATE: SheetState = {
  loading: false,
  error:   null,
  resumoOMs:      [],
  totalCredito:   0,
  totalEmpenhado: 0,
  totalALiquidar: 0,
  totalAPagar:    0,
  empenhos:       [],
  linhasRP:       [],
  totalInscrito:  0,
  atualizado:     medidas.atualizado_em,
};

export default function PainelBI({ fitHeight = false }: PainelBIProps) {
  const [tab, setTab] = useState<Tab>("credito");
  const [state, setState] = useState<SheetState>({ ...DEFAULT_STATE, loading: true });

  useEffect(() => {
    let cancelled = false;

    async function loadAll() {
      setState((s) => ({ ...s, loading: true, error: null }));
      try {
        // Busca paralela das 4 planilhas
        const [rows1, rows2, rows3, rows4] = await Promise.allSettled([
          fetchCSV(SHEET_URLS.credito1),
          fetchCSV(SHEET_URLS.credito2),
          fetchCSV(SHEET_URLS.rp),
          fetchCSV(SHEET_URLS.empenhos),
        ]);

        if (cancelled) return;

        // ── Crédito (planilhas 1 + 2) ─────────────────────────────────────────
        const linhasCredito = [
          ...(rows1.status === "fulfilled" ? toCreditoLinhas(rows1.value) : []),
          ...(rows2.status === "fulfilled" ? toCreditoLinhas(rows2.value) : []),
        ];
        const resumoOMs    = agregaPorOM(linhasCredito);
        const totalCredito   = resumoOMs.reduce((s, r) => s + r.credito,    0);
        const totalALiquidar = resumoOMs.reduce((s, r) => s + r.a_liquidar, 0);
        const totalAPagar    = resumoOMs.reduce((s, r) => s + r.a_pagar,    0);
        const totalEmpenhado = totalALiquidar + totalAPagar;

        // ── RP (planilha 3) ───────────────────────────────────────────────────
        const linhasRP     = rows3.status === "fulfilled" ? toLinhasRP(rows3.value)     : [];
        const totalInscrito = linhasRP.reduce((s, r) => s + r.total, 0);

        // ── Empenhos (planilha 4) ─────────────────────────────────────────────
        const empenhos = rows4.status === "fulfilled" ? toControleEmpenhos(rows4.value) : [];

        // Se nenhuma planilha retornou dados, mostra mock (sem erro)
        const anyData = linhasCredito.length > 0 || linhasRP.length > 0 || empenhos.length > 0;

        setState({
          loading:        false,
          error:          anyData ? null : null, // uso de mock é silencioso
          resumoOMs,
          totalCredito,
          totalEmpenhado,
          totalALiquidar,
          totalAPagar,
          empenhos,
          linhasRP,
          totalInscrito,
          atualizado: new Date().toLocaleDateString("pt-BR"),
        });
      } catch (err: any) {
        if (!cancelled) {
          setState({ ...DEFAULT_STATE, loading: false, error: err.message });
        }
      }
    }

    loadAll();
    return () => { cancelled = true; };
  }, []);

  const containerClass = fitHeight
    ? "flex flex-col h-full overflow-hidden"
    : "space-y-3";

  const tabContentClass = fitHeight
    ? "flex-1 overflow-y-auto min-h-0 pr-1"
    : "";

  return (
    <div className={containerClass}>
      {/* Header bar */}
      <div className="flex items-center justify-between gap-3 shrink-0 pb-1">
        <div className="flex items-center gap-2">
          {state.loading && (
            <div className="h-4 w-4 animate-spin rounded-full border-2 border-sky-500 border-t-transparent" />
          )}
          <span className="text-xs text-slate-400">
            {state.loading
              ? "Carregando planilhas..."
              : `Atualizado em ${state.atualizado}`}
          </span>
        </div>
        {state.resumoOMs.length === 0 && !state.loading && (
          <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] font-medium text-amber-600 select-none">
            mock data
          </span>
        )}
      </div>

      {/* Tab bar */}
      <div className="flex gap-1 border-b-2 border-slate-200 shrink-0">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`rounded-t-lg px-4 py-2 text-sm font-medium transition-colors ${
              tab === t.id
                ? "border-b-2 border-sky-600 text-sky-700 bg-sky-50"
                : "text-slate-500 hover:text-slate-800 hover:bg-slate-50"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className={tabContentClass}>
        {tab === "credito" && (
          <TabCredito
            resumoOMs={state.resumoOMs}
            totalCredito={state.totalCredito}
            totalEmpenhado={state.totalEmpenhado}
            totalALiquidar={state.totalALiquidar}
            totalAPagar={state.totalAPagar}
            atualizado={state.atualizado}
          />
        )}
        {tab === "empenhos" && (
          <TabEmpenhos empenhos={state.empenhos} />
        )}
        {tab === "rp" && (
          <TabRP
            linhasRP={state.linhasRP}
            totalInscrito={state.totalInscrito}
          />
        )}
      </div>
    </div>
  );
}
