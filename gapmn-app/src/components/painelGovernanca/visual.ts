// Aparência dos status do Painel de Governança (ícone, cor e texto curto).
import { CircleCheck, CircleMinus, CircleX, Clock, Eye, TriangleAlert, type LucideIcon } from "lucide-react";
import type { ContagemStatus, Status } from "../../lib/indicadores/tipos.ts";

/** Cor nunca é a única portadora de significado: cada status tem ícone e texto. */
export const VISUAL_STATUS: Record<Status, { cor: string; texto: string; Icone: LucideIcon; curto: string }> = {
  "Adequado":                       { cor: "var(--ok)",        texto: "var(--ok)",      Icone: CircleCheck,   curto: "Adequado" },
  "Atenção":                        { cor: "var(--atencao)",   texto: "var(--atencao)", Icone: TriangleAlert, curto: "Atenção" },
  "Crítico":                        { cor: "var(--critico)",   texto: "var(--critico)", Icone: CircleX,       curto: "Crítico" },
  "Aguardando informação":          { cor: "var(--neutro)",    texto: "var(--txt-2)",   Icone: Clock,         curto: "Aguardando informação" },
  "Sem dados no mês de referência": { cor: "var(--sem-dados)", texto: "var(--txt-2)",   Icone: CircleMinus,   curto: "Sem dados no mês" },
  "Sem meta":                       { cor: "var(--txt-2)",     texto: "var(--txt-2)",   Icone: Eye,           curto: "Sem meta" },
};

const PLURAIS: [Status, string, string][] = [
  ["Adequado", "adequado", "adequados"],
  ["Atenção", "em atenção", "em atenção"],
  ["Crítico", "crítico", "críticos"],
  ["Aguardando informação", "aguardando", "aguardando"],
  ["Sem dados no mês de referência", "sem dados no mês", "sem dados no mês"],
  ["Sem meta", "sem meta", "sem meta"],
];

/** '3 adequados · 2 em atenção · 1 crítico · 2 aguardando' (só o que não é zero). */
export function textoContagem(c: ContagemStatus): string {
  return PLURAIS.filter(([s]) => c[s] > 0).map(([s, um, varios]) => `${c[s]} ${c[s] === 1 ? um : varios}`).join(" · ");
}
