// Tipo do contrato pelo começo do número oficial do SILOMS ("DESPESA 015/GAPMN-SRINFRA/2024",
// "CREDENCIAMENTO 014/2022" ou "CRED 004/2023", "ADESÃO 003/2021", "RECEITA 002/CINDACTAIV/2016").

export type TipoContrato = "DESPESA" | "CREDENCIAMENTO" | "ADESAO" | "RECEITA" | "OUTRO";

export const TIPOS_CONTRATO: { tipo: Exclude<TipoContrato, "OUTRO">; rotulo: string }[] = [
  { tipo: "DESPESA", rotulo: "Despesa" },
  { tipo: "CREDENCIAMENTO", rotulo: "Credenciamento" },
  { tipo: "ADESAO", rotulo: "Adesão" },
  { tipo: "RECEITA", rotulo: "Receita" },
];

export function tipoDoContrato(numero: string | null | undefined): TipoContrato {
  const t = String(numero ?? "").trim().toUpperCase().normalize("NFD").replace(/\p{M}/gu, "");
  if (/^DESPESA\b/.test(t)) return "DESPESA";
  if (/^CRED(ENCIAMENTO)?\b/.test(t)) return "CREDENCIAMENTO";
  if (/^ADESAO\b/.test(t)) return "ADESAO";
  if (/^RECEITA\b/.test(t)) return "RECEITA";
  return "OUTRO";
}

/** Quantos contratos de cada tipo (para mostrar no filtro) */
export function contarTipos(numeros: (string | null | undefined)[]): Map<TipoContrato, number> {
  const m = new Map<TipoContrato, number>();
  for (const n of numeros) { const t = tipoDoContrato(n); m.set(t, (m.get(t) ?? 0) + 1); }
  return m;
}
