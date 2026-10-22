// Formatos do Painel Orçamentário (os mesmos do BI: "R$ #,##0.00" e unidades automáticas Mil/Mi/Bi).

const moeda = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

/** "R$ 1.207.459,84" */
export const fmtMoeda = (v: number) => moeda.format(v).replace(/\s/g, " ");

/** Unidade automática do Power BI: 23360000 → "23,36 Mi"; 387641 → "387,64 Mil". */
export function fmtCompacto(v: number, casas = 2): string {
  const a = Math.abs(v);
  const [div, suf] = a >= 1e9 ? [1e9, " Bi"] : a >= 1e6 ? [1e6, " Mi"] : a >= 1e3 ? [1e3, " Mil"] : [1, ""];
  return (v / div).toLocaleString("pt-BR", { minimumFractionDigits: casas, maximumFractionDigits: casas }) + suf;
}

/** 0.98857 → "98,86%" */
export const fmtPct = (v: number | null, casas = 2) =>
  v === null ? "—" : (v * 100).toLocaleString("pt-BR", { minimumFractionDigits: casas, maximumFractionDigits: casas }) + "%";

/** "2026-10-19" → "19/10/2026" */
export const fmtData = (iso: string | null) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : "—");

/** 0 → "hoje"; 1 → "1 dia"; 225 → "225 dias" */
export const fmtDias = (n: number) => (n <= 0 ? "hoje" : n === 1 ? "1 dia" : `${n.toLocaleString("pt-BR")} dias`);

/** "2026-10-19" → "19/10" */
export const fmtDiaMes = (iso: string | null) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}` : "—");

/** Hora local "08:15" de um instante ISO. */
export const fmtHora = (iso: string) =>
  new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: "America/Manaus" });

/** Número curto da nota de crédito: "120002000012026NC011361" → "2026NC011361". */
export const fmtNC = (nc: string) => /(\d{4}NC\d+)$/i.exec(nc.trim())?.[1].toUpperCase() ?? nc.trim();
