import {
  BarChart, Bar, XAxis, YAxis, ResponsiveContainer, Tooltip, LabelList,
} from "recharts";
import type { ResumoOM } from "../../lib/gsheets";
import { medidas, calendario, unidades, scrollerUnidades } from "./mockData";

const fmtM  = (v: number) => `R$ ${(v / 1e6).toFixed(2).replace(".", ",")}M`;
const fmtMs = (v: number) => `${(v / 1e6).toFixed(1).replace(".", ",")}M`;
const fmtPct = (v: number) => `${(v * 100).toFixed(1).replace(".", ",")}%`;
const fmtVal = (v: number) => {
  if (Math.abs(v) >= 1e6) return `R$ ${(v / 1e6).toFixed(2).replace(".", ",")}M`;
  if (Math.abs(v) >= 1e3) return `R$ ${(v / 1e3).toFixed(1).replace(".", ",")}K`;
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
};
const fmtBRL = (v: number) =>
  v.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 2 });

// ─── Custom Tooltip para o gráfico de OM ─────────────────────────────────────
function TooltipOM({ active, payload }: any) {
  if (!active || !payload?.length) return null;
  const d = payload[0]?.payload as ResumoOM & {
    a_liquidar: number; a_pagar: number; Disp?: number; linhas?: ResumoOM["linhas"];
  };
  const linhas = d.linhas ?? [];

  return (
    <div className="max-w-xs rounded-xl border border-slate-200 bg-white p-3 shadow-lg text-xs">
      <div className="mb-2 font-bold text-slate-900">{d.om_sigla}</div>
      <div className="grid grid-cols-2 gap-x-3 gap-y-1 mb-2">
        <span className="text-slate-500">A Liquidar</span>
        <span className="font-semibold text-blue-700">{fmtBRL(d.a_liquidar)}</span>
        <span className="text-slate-500">A Pagar</span>
        <span className="font-semibold text-purple-700">{fmtBRL(d.a_pagar)}</span>
      </div>
      {linhas.length > 0 && (
        <>
          <div className="border-t border-slate-100 pt-2 mb-1 text-[10px] font-semibold text-slate-400 uppercase tracking-wide">
            Linhas Orçamentárias
          </div>
          <div className="max-h-48 overflow-y-auto space-y-1">
            {linhas.map((l, i) => (
              <div key={i} className="rounded bg-slate-50 p-1.5 border border-slate-100">
                <div className="font-medium text-slate-700 truncate">{l.acao || l.nd_nome || "—"}</div>
                <div className="flex gap-2 text-[10px] text-slate-500 mt-0.5">
                  <span>PI: {l.pi || "—"}</span>
                  <span>ND: {l.nd || "—"}</span>
                </div>
                <div className="text-[10px] font-semibold text-slate-700 mt-0.5">
                  Disp: {fmtBRL(l.credito)}
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

// ─── Props ────────────────────────────────────────────────────────────────────
interface Props {
  resumoOMs?: ResumoOM[];
  totalCredito?: number;
  totalALiquidar?: number;
  totalAPagar?: number;
  totalEmpenhado?: number;
  atualizado?: string;
}

function KpiCard({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-3 text-center">
      <div className="text-[10px] font-medium uppercase tracking-wider text-slate-400">{label}</div>
      <div className={`mt-1 text-lg font-bold leading-tight ${color ?? "text-slate-900"}`}>{value}</div>
    </div>
  );
}

export default function TabCredito({ resumoOMs, totalCredito, totalALiquidar, totalAPagar, totalEmpenhado, atualizado }: Props) {
  // Usa dados reais se disponíveis, senão mockData
  const hasReal = resumoOMs && resumoOMs.length > 0;

  const credito   = hasReal ? (totalCredito   ?? 0) : medidas.Credito_Recebido;
  const empenhado = hasReal ? (totalEmpenhado ?? 0) : medidas.Empenhado;
  const aLiquidar = hasReal ? (totalALiquidar ?? 0) : medidas.a_liquidar;
  const aPagar    = hasReal ? (totalAPagar    ?? 0) : medidas.a_pagar;
  const pctEmp    = credito > 0 ? empenhado / credito : medidas.Pct_Empenhado;

  const chartData = hasReal
    ? resumoOMs!.map((r) => ({ Sigla_OM: r.om_sigla, ...r }))
    : unidades;

  const rankingData = hasReal
    ? resumoOMs!.map((r) => ({ Sigla_OM: r.om_sigla, Credito: r.credito }))
        .sort((a, b) => b.Credito - a.Credito)
    : scrollerUnidades;

  const tickerData = rankingData;

  return (
    <div className="space-y-3">
      {/* Atualizado */}
      {atualizado && (
        <div className="text-right text-[10px] text-slate-400">
          Atualizado em {atualizado}
        </div>
      )}

      {/* KPI Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
        <KpiCard label="Crédito Recebido"  value={fmtM(credito)} />
        <KpiCard label="Empenhado"          value={fmtM(empenhado)} color="text-sky-700" />
        <KpiCard label="% Empenhado"        value={fmtPct(pctEmp)} color="text-indigo-700" />
        <KpiCard label="A Liquidar"         value={fmtM(aLiquidar)} color="text-amber-700" />
        <KpiCard label="A Pagar"            value={fmtVal(aPagar)} color="text-purple-700" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        {/* Crédito por Mês */}
        <div className="rounded-xl border border-slate-200 bg-white p-3">
          <div className="mb-2 text-sm font-semibold text-slate-700">Crédito Recebido por Mês</div>
          <ResponsiveContainer width="100%" height={170}>
            <BarChart data={calendario} barSize={50} margin={{ top: 14, right: 12, left: 0, bottom: 0 }}>
              <XAxis dataKey="mes" tick={{ fontSize: 12 }} axisLine={false} tickLine={false} />
              <YAxis tickFormatter={fmtMs} tick={{ fontSize: 11 }} width={50} axisLine={false} tickLine={false} />
              <Tooltip formatter={(v: any) => [fmtM(v), "Crédito"]} />
              <Bar dataKey="Credito_Recebido" fill="#2563eb" radius={[5, 5, 0, 0]}>
                <LabelList
                  dataKey="Credito_Recebido"
                  position="top"
                  formatter={(v: any) => fmtMs(Number(v))}
                  style={{ fontSize: 11, fill: "#475569", fontWeight: 600 }}
                />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* A Liquidar + A Pagar por OM — com tooltip de detalhes */}
        <div className="rounded-xl border border-slate-200 bg-white p-3">
          <div className="mb-1 flex items-center gap-3 text-xs">
            <span className="font-semibold text-slate-700">Situação por OM</span>
            <span className="flex items-center gap-1 text-slate-500">
              <span className="inline-block h-2.5 w-2.5 rounded-sm bg-blue-600" /> A Liquidar
            </span>
            <span className="flex items-center gap-1 text-slate-500">
              <span className="inline-block h-2.5 w-2.5 rounded-sm bg-purple-600" /> A Pagar
            </span>
          </div>
          <ResponsiveContainer width="100%" height={180}>
            <BarChart
              data={chartData}
              layout="vertical"
              barSize={12}
              margin={{ top: 2, right: 12, left: 0, bottom: 0 }}
            >
              <XAxis type="number" tickFormatter={fmtMs} tick={{ fontSize: 10 }} axisLine={false} tickLine={false} />
              <YAxis type="category" dataKey="Sigla_OM" tick={{ fontSize: 10 }} width={72} axisLine={false} tickLine={false} />
              <Tooltip content={<TooltipOM />} />
              <Bar dataKey="a_liquidar" name="A Liquidar" fill="#2563eb" stackId="s" />
              <Bar dataKey="a_pagar"    name="A Pagar"    fill="#7c3aed" stackId="s" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Ranking + Ticker lado a lado */}
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_auto] gap-3">
        <div className="rounded-xl border border-slate-200 bg-white p-3">
          <div className="mb-2 text-sm font-semibold text-slate-700">Ranking — Crédito por OM</div>
          <div className="space-y-1.5">
            {rankingData.slice(0, 7).map((u, i) => {
              const pct = (u.Credito / (rankingData[0]?.Credito || 1)) * 100;
              return (
                <div key={u.Sigla_OM} className="flex items-center gap-2">
                  <div className="w-4 text-right text-xs font-semibold text-slate-400">{i + 1}</div>
                  <div className="w-[70px] shrink-0 text-xs font-medium text-slate-700">{u.Sigla_OM}</div>
                  <div className="flex-1 overflow-hidden rounded-full bg-slate-100 h-2.5">
                    <div className="h-full rounded-full bg-sky-500" style={{ width: `${pct}%` }} />
                  </div>
                  <div className="w-22 text-right text-xs text-slate-600">{fmtM(u.Credito)}</div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Ticker */}
      <div className="overflow-hidden rounded-xl border border-slate-700 bg-slate-900 px-3 py-1.5">
        <style>{`
          @keyframes gapmn-ticker { 0% { transform: translateX(0); } 100% { transform: translateX(-50%); } }
          .gapmn-ticker-track { animation: gapmn-ticker 28s linear infinite; }
        `}</style>
        <div className="gapmn-ticker-track flex whitespace-nowrap">
          {[...tickerData, ...tickerData].map((u, i) => (
            <span key={i} className="inline-flex items-center gap-2 px-5 text-sm">
              <span className="font-semibold text-sky-400">{u.Sigla_OM}</span>
              <span className="text-slate-200">{fmtM(u.Credito)}</span>
              <span className="mx-1 text-slate-600">◆</span>
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
