// Peças visuais do Acompanhamento do PCA (selos, datas, valores). Classes claras do Tailwind: o fundo escuro do
// app vem do .svdark que envolve a tela.
import type { ReactNode } from "react";
import type { Alerta, Contratacao } from "../../lib/pca/tipos";
import { PRAZO, corStatus, dataBR } from "./formato";
import type { SituacaoPrazo } from "../../lib/pca/regras";


export function SeloStatus({ c }: { c: Pick<Contratacao, "status_atual" | "status_origem"> }) {
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10.5px] font-semibold leading-tight ${corStatus(c.status_atual)}`}
      title={c.status_origem === "manual" ? "Status definido pela SLIC (com justificativa no histórico)" : "Status automático (fatos registrados)"}>
      {c.status_origem === "manual" && <span aria-hidden>✋</span>}{c.status_atual}
    </span>
  );
}

export const PontoPrazo = ({ p }: { p: SituacaoPrazo }) => <span title={PRAZO[p][1]} className={`inline-block h-2 w-2 shrink-0 rounded-full ${PRAZO[p][0]}`} />;

/** DOU/EBC: cinza antes da publicação no PNCP; vermelho piscando enquanto falta; verde com a data quando publicado */
export function SeloPublicacao({ rotulo, publicadoPncp, feito, data, link }: { rotulo: string; publicadoPncp: boolean; feito: boolean; data: string | null; link: string | null }) {
  if (!publicadoPncp && !feito) return <span className="text-[10.5px] text-slate-400" title={`${rotulo}: aguardando a publicação no PNCP`}>{rotulo} —</span>;
  if (!feito) return <span className="animate-pulse rounded border border-red-200 bg-red-100 px-1.5 py-0.5 text-[10.5px] font-bold text-red-700" title={`Publicado no PNCP e sem publicação no ${rotulo} registrada`}>{rotulo} pendente</span>;
  const selo = <span className="rounded border border-emerald-200 bg-emerald-50 px-1.5 py-0.5 text-[10.5px] font-semibold text-emerald-700" title={`${rotulo} em ${dataBR(data)}`}>{rotulo} ✓ {dataBR(data).slice(0, 5)}</span>;
  return link ? <a href={link} target="_blank" rel="noreferrer">{selo}</a> : selo;
}

export function ListaAlertas({ alertas, compacto }: { alertas: Alerta[]; compacto?: boolean }) {
  if (!alertas.length) return compacto ? <span className="text-[10.5px] text-slate-300">—</span> : <p className="text-xs text-slate-500">Nenhum alerta.</p>;
  const criticos = alertas.filter((a) => a.nivel === "critico").length;
  if (compacto) {
    return (
      <span title={alertas.map((a) => `• ${a.texto}`).join("\n")}
        className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10.5px] font-bold ${criticos ? "bg-red-100 text-red-700" : "bg-amber-100 text-amber-800"}`}>
        {criticos ? "⛔" : "⚠"} {alertas.length}
      </span>
    );
  }
  return (
    <ul className="space-y-1">
      {alertas.map((a, i) => (
        <li key={i} className={`rounded-md border px-2 py-1 text-xs ${a.nivel === "critico" ? "border-red-200 bg-red-50 text-red-700" : a.nivel === "atencao" ? "border-amber-200 bg-amber-50 text-amber-800" : "border-slate-200 bg-slate-50 text-slate-600"}`}>
          {a.nivel === "critico" ? "⛔ " : a.nivel === "atencao" ? "⚠ " : "ℹ "}{a.texto}
        </li>
      ))}
    </ul>
  );
}

export function Kpi({ rotulo, valor, detalhe, cor, ativo, onClick }: { rotulo: string; valor: ReactNode; detalhe?: ReactNode; cor: string; ativo?: boolean; onClick?: () => void }) {
  return (
    <button onClick={onClick} className={`min-w-[130px] flex-1 rounded-xl border bg-white px-3 py-2 text-left transition hover:shadow ${ativo ? "ring-2 ring-sky-400" : ""} ${cor}`}>
      <div className="text-[10.5px] font-semibold uppercase tracking-wide text-slate-500">{rotulo}</div>
      <div className="text-xl font-bold text-slate-800">{valor}</div>
      {detalhe && <div className="text-[10.5px] text-slate-500">{detalhe}</div>}
    </button>
  );
}

export const Campo = ({ rotulo, children, largo }: { rotulo: string; children: ReactNode; largo?: boolean }) => (
  <label className={`flex flex-col gap-0.5 text-[11px] text-slate-500 ${largo ? "sm:col-span-2" : ""}`}>
    <span className="font-semibold">{rotulo}</span>
    {children}
  </label>
);
export const entrada = "rounded-md border border-slate-200 bg-white px-2 py-1 text-xs text-slate-800 outline-none focus:ring-2 focus:ring-sky-200 disabled:bg-slate-50 disabled:text-slate-500";
export const botao = "rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50";
export const botaoPrimario = "rounded-lg bg-sky-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-sky-700 disabled:opacity-50";
