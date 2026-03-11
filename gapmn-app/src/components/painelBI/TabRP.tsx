import {
  BarChart, Bar, XAxis, YAxis, ResponsiveContainer, Tooltip, Legend,
} from "recharts";
import type { LinhaRP } from "../../lib/gsheets";
import { rpGapmn, rpTotais, omImages } from "./mockData";

const fmtM  = (v: number) => `R$ ${(v / 1e6).toFixed(2).replace(".", ",")}M`;
const fmtMs = (v: number) => `${(v / 1e6).toFixed(1).replace(".", ",")}M`;

const RP_COLORS: Record<string, string> = {
  rp_proc_insc:       "#2563eb",
  rp_nao_proc_insc:   "#7c3aed",
  rp_nao_proc_reinsc: "#0d9488",
  rp_proc_canc:       "#dc2626",
  rp_nao_proc_canc:   "#d97706",
};

const RP_LABELS: Record<string, string> = {
  rp_proc_insc:       "Proc. Inscritos",
  rp_nao_proc_insc:   "Não Proc. Inscritos",
  rp_nao_proc_reinsc: "Não Proc. Reinscr.",
  rp_proc_canc:       "Proc. Cancelados",
  rp_nao_proc_canc:   "Não Proc. Cancelados",
};

// Converter mockData para LinhaRP
const mockLinhas: LinhaRP[] = rpGapmn.map((r) => ({
  om_sigla:           r.Sigla_OM,
  rp_proc_insc:       r.RP_PROC_INSC,
  rp_nao_proc_insc:   r.RP_NAO_PROC_INSC,
  rp_nao_proc_reinsc: r.RP_NAO_PROC_REINSC,
  rp_proc_canc:       r.RP_PROC_CANC,
  rp_nao_proc_canc:   r.RP_NAO_PROC_CANC,
  total:              r.RP_Total_Inscritos,
}));

interface Props {
  linhasRP?: LinhaRP[];
  totalInscrito?: number;
  totalLiquidado?: number;
  totalPago?: number;
}

function KpiCard({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-3 text-center">
      <div className="text-[10px] font-medium uppercase tracking-wider text-slate-400">{label}</div>
      <div className={`mt-1 text-xl font-bold ${color ?? "text-slate-900"}`}>{value}</div>
    </div>
  );
}

export default function TabRP({ linhasRP, totalInscrito, totalLiquidado, totalPago }: Props) {
  const hasReal = linhasRP && linhasRP.length > 0;
  const linhas  = hasReal ? linhasRP! : mockLinhas;

  const tInsc = hasReal ? (totalInscrito  ?? linhas.reduce((s, r) => s + r.total, 0))        : rpTotais.RP_Total_Inscritos;
  const tLiq  = hasReal ? (totalLiquidado ?? 0)                                               : rpTotais.LIQUIDADO;
  const tPago = hasReal ? (totalPago      ?? 0)                                               : rpTotais.RP_Total_Pago;

  const pctPago = tInsc > 0 ? (tPago / tInsc) * 100 : 0;
  const pctLiq  = tInsc > 0 ? (tLiq  / tInsc) * 100 : 0;

  const sorted = [...linhas].sort((a, b) => b.total - a.total);

  // Chart data: adapt field names for Recharts
  const chartData = sorted.map((r) => ({ Sigla_OM: r.om_sigla, ...r }));

  return (
    <div className="space-y-3">
      {/* KPI Cards */}
      <div className="grid grid-cols-3 gap-2">
        <KpiCard label="Total Inscrito" value={fmtM(tInsc)} />
        <KpiCard label="Liquidado"      value={fmtM(tLiq)}  color="text-sky-700" />
        <KpiCard label="Total Pago"     value={fmtM(tPago)} color="text-green-700" />
      </div>

      {/* Progress bars */}
      <div className="rounded-xl border border-slate-200 bg-white p-3 space-y-2">
        <div>
          <div className="mb-1 flex justify-between text-xs text-slate-500">
            <span>Liquidado / Inscrito</span>
            <span className="font-semibold text-sky-700">{pctLiq.toFixed(1).replace(".", ",")}%</span>
          </div>
          <div className="h-2.5 overflow-hidden rounded-full bg-slate-100">
            <div className="h-full rounded-full bg-sky-500" style={{ width: `${pctLiq}%` }} />
          </div>
        </div>
        <div>
          <div className="mb-1 flex justify-between text-xs text-slate-500">
            <span>Pago / Inscrito</span>
            <span className="font-semibold text-green-700">{pctPago.toFixed(1).replace(".", ",")}%</span>
          </div>
          <div className="h-2.5 overflow-hidden rounded-full bg-slate-100">
            <div className="h-full rounded-full bg-green-500" style={{ width: `${pctPago}%` }} />
          </div>
        </div>
      </div>

      {/* Stacked bar chart */}
      <div className="rounded-xl border border-slate-200 bg-white p-3">
        <div className="mb-2 text-sm font-semibold text-slate-700">Restos a Pagar por OM</div>
        <ResponsiveContainer width="100%" height={260}>
          <BarChart data={chartData} layout="vertical" barSize={14} margin={{ top: 2, right: 12, left: 0, bottom: 2 }}>
            <XAxis type="number" tickFormatter={fmtMs} tick={{ fontSize: 10 }} axisLine={false} tickLine={false} />
            <YAxis type="category" dataKey="Sigla_OM" tick={{ fontSize: 10 }} width={80} axisLine={false} tickLine={false} />
            <Tooltip formatter={(v: any, name?: string) => [fmtM(v), RP_LABELS[name ?? ""] ?? name ?? ""]} />
            <Legend formatter={(v) => RP_LABELS[v] ?? v} iconSize={10} wrapperStyle={{ fontSize: 11 }} />
            {Object.entries(RP_COLORS).map(([key, color]) => (
              <Bar key={key} dataKey={key} name={key} fill={color} stackId="rp" />
            ))}
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Ranking */}
      <div className="rounded-xl border border-slate-200 bg-white p-3">
        <div className="mb-2 text-sm font-semibold text-slate-700">Ranking — Total Inscrito por OM</div>
        <div className="space-y-1.5">
          {sorted.map((u, i) => {
            const pct = (u.total / (sorted[0]?.total || 1)) * 100;
            return (
              <div key={u.om_sigla} className="flex items-center gap-2">
                <div className="w-4 text-right text-xs font-semibold text-slate-400">{i + 1}</div>
                {omImages[u.om_sigla] ? (
                  <img src={omImages[u.om_sigla]} alt={u.om_sigla} className="h-5 w-5 shrink-0 rounded border border-slate-100 object-contain" />
                ) : (
                  <div className="h-5 w-5 shrink-0 rounded bg-slate-100" />
                )}
                <div className="w-[72px] shrink-0 text-xs font-medium text-slate-700">{u.om_sigla}</div>
                <div className="flex-1 overflow-hidden rounded-full bg-slate-100 h-2.5">
                  <div className="h-full rounded-full bg-indigo-500" style={{ width: `${pct}%` }} />
                </div>
                <div className="w-24 text-right text-xs text-slate-600">{fmtM(u.total)}</div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
