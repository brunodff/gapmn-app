import type { ControleEmpenho } from "../../lib/gsheets";
import { medidasSEO, controleEmpenhos as mockEmpenhos } from "./mockData";

const fmtPct = (v: number) => `${(v * 100).toFixed(1).replace(".", ",")}%`;
const fmtR$ = (v: number) =>
  v.toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

function diasBadge(d: number) {
  if (d > 45) return "bg-red-50 border-red-200 text-red-700";
  if (d > 20) return "bg-amber-50 border-amber-200 text-amber-700";
  return "bg-green-50 border-green-200 text-green-700";
}

interface Props {
  empenhos?: ControleEmpenho[];
}

export default function TabEmpenhos({ empenhos }: Props) {
  const rows = empenhos && empenhos.length > 0 ? empenhos : mockEmpenhos as ControleEmpenho[];

  const total        = rows.length;
  const atendidas    = rows.filter((r) => r.valor > 0).length;
  const naoAtendidas = rows.filter((r) => r.valor <= 0).length;
  const pct          = total > 0 ? atendidas / total : medidasSEO.pct_atendidas;

  // Quando é mock puro, usar métricas do mock
  const useMock = !(empenhos && empenhos.length > 0);
  const dispTotal = useMock ? medidasSEO.total_solicitacoes : total;
  const dispAtend = useMock ? medidasSEO.atendidas          : atendidas;
  const dispNao   = useMock ? medidasSEO.nao_atendidas      : naoAtendidas;
  const dispPct   = useMock ? medidasSEO.pct_atendidas      : pct;

  return (
    <div className="space-y-3">
      {/* KPI Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <div className="rounded-xl border border-slate-200 bg-white p-3 text-center">
          <div className="text-[10px] font-medium uppercase tracking-wider text-slate-400">Total Solicitações</div>
          <div className="mt-1 text-2xl font-bold text-slate-900">{dispTotal}</div>
        </div>
        <div className="rounded-xl border border-green-200 bg-green-50 p-3 text-center">
          <div className="text-[10px] font-medium uppercase tracking-wider text-green-600">Atendidas</div>
          <div className="mt-1 text-2xl font-bold text-green-700">{dispAtend}</div>
        </div>
        <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-center">
          <div className="text-[10px] font-medium uppercase tracking-wider text-red-600">Não Atendidas</div>
          <div className="mt-1 text-2xl font-bold text-red-700">{dispNao}</div>
        </div>
        <div className="rounded-xl border border-sky-200 bg-sky-50 p-3 text-center">
          <div className="text-[10px] font-medium uppercase tracking-wider text-sky-600">% Atendidas</div>
          <div className="mt-1 text-2xl font-bold text-sky-700">{fmtPct(dispPct)}</div>
          <div className="mt-1.5 overflow-hidden rounded-full bg-sky-200 h-2">
            <div className="h-full rounded-full bg-sky-500" style={{ width: `${dispPct * 100}%` }} />
          </div>
        </div>
      </div>

      {/* Tabela */}
      <div className="rounded-xl border border-slate-200 bg-white p-3">
        <div className="mb-2 flex items-center justify-between gap-3">
          <div className="text-sm font-semibold text-slate-700">Controle de Empenhos em Aberto</div>
          <div className="flex items-center gap-3 text-[11px] text-slate-500">
            <span className="flex items-center gap-1">
              <span className="inline-block h-2 w-2 rounded-full bg-green-400" />&le;20d
            </span>
            <span className="flex items-center gap-1">
              <span className="inline-block h-2 w-2 rounded-full bg-amber-400" />20–45d
            </span>
            <span className="flex items-center gap-1">
              <span className="inline-block h-2 w-2 rounded-full bg-red-400" />&gt;45d
            </span>
          </div>
        </div>

        <div className="overflow-x-auto overflow-y-auto max-h-[380px]">
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-white">
              <tr className="border-b-2 border-slate-200">
                {["Solicitação", "Subprocesso", "SIAFI", "SILOMS", "Data", "UG Cred", "Valor (R$)", "Dias"].map(
                  (h) => (
                    <th key={h} className="whitespace-nowrap pb-2 px-2 text-left text-[11px] font-semibold text-slate-500">
                      {h}
                    </th>
                  )
                )}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i} className={`border-b border-slate-100 ${i % 2 === 0 ? "bg-white" : "bg-slate-50/60"}`}>
                  <td className="whitespace-nowrap py-1.5 px-2 font-semibold text-sky-700">{r.solicitacao}</td>
                  <td className="py-1.5 px-2 text-slate-600">{r.subprocesso}</td>
                  <td className="whitespace-nowrap py-1.5 px-2 text-slate-500">{r.siafi}</td>
                  <td className="whitespace-nowrap py-1.5 px-2 text-slate-500">{r.siloms}</td>
                  <td className="whitespace-nowrap py-1.5 px-2 text-slate-600">{r.data}</td>
                  <td className="py-1.5 px-2 text-slate-600">{r.ugcred}</td>
                  <td className={`whitespace-nowrap py-1.5 px-2 text-right font-medium ${r.valor < 0 ? "text-red-700" : "text-green-700"}`}>
                    {fmtR$(r.valor)}
                  </td>
                  <td className="py-1.5 px-2 text-center">
                    <span className={`inline-block rounded-full border px-2 py-0.5 text-[11px] font-semibold ${diasBadge(r.dias)}`}>
                      {r.dias}d
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="mt-2 text-right text-[11px] text-slate-400">
          {rows.length} registro(s){useMock ? " · dados de demonstração" : ""}
        </div>
      </div>
    </div>
  );
}
