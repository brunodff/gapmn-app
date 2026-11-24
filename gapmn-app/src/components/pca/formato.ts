// Formatos e cores do Acompanhamento do PCA (fora do ui.tsx, que só exporta componentes).
import { S } from "../../lib/pca/tipos";
import type { SituacaoPrazo } from "../../lib/pca/regras";

export const dataBR = (d: string | null | undefined) => (d ? new Date(d.length === 10 ? d + "T12:00:00" : d).toLocaleDateString("pt-BR") : "—");
export const horaBR = (d: string | null | undefined) => (d ? new Date(d).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit" }) : "—");
export const brl = (v: number | null | undefined) => (v == null ? "—" : new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(v));
export const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/\p{M}/gu, "");

export function corStatus(s: string): string {
  switch (s) {
    case S.PLANEJADO: return "bg-slate-100 text-slate-600 border-slate-200";
    case S.DNR: case S.MINUTAS: return "bg-sky-100 text-sky-700 border-sky-200";
    case S.IRREGULAR: return "bg-red-100 text-red-700 border-red-200";
    case S.MJR: case S.LIBERADO: return "bg-violet-100 text-violet-700 border-violet-200";
    case S.CJU: case S.RETORNO_CJU: case S.POS_CJU: return "bg-amber-100 text-amber-800 border-amber-200";
    case S.PUBLICADO: return "bg-blue-50 text-blue-700 border-sky-200";
    case S.HOMOLOGADO: case S.ENCAMINHADO: return "bg-emerald-100 text-emerald-700 border-emerald-200";
    case S.SUSPENSO: case S.ADIADO: return "bg-orange-100 text-orange-700 border-amber-200";
    default: return "bg-red-50 text-red-700 border-red-200";
  }
}

export const PRAZO: Record<SituacaoPrazo, [string, string]> = {
  no_prazo: ["bg-emerald-500", "No prazo"], em_risco: ["bg-amber-500", "Em risco"], atrasado: ["bg-red-500", "Atrasado"],
  concluido: ["bg-sky-500", "Concluído"], encerrado: ["bg-slate-400", "Encerrado"],
};
export const nomePrazo = (p: SituacaoPrazo) => PRAZO[p][1];
