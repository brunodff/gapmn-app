// Aparência dos status do Painel de Governança (ícone, cor e texto curto).
import { CircleCheck, CircleMinus, CircleX, Clock, Eye, TriangleAlert, type LucideIcon } from "lucide-react";
import type { ContagemStatus, IndicadorPainel, Status } from "../../lib/indicadores/tipos.ts";

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

/** Nome por extenso das divisões (modo apresentação). */
export const NOMES_DIVISOES: Record<string, string> = {
  DRH: "Divisão de Recursos Humanos",
  DIE: "Divisão de Infraestrutura",
  DA: "Divisão Administrativa",
  AJUR: "Assessoria Jurídica",
  ASESO: "Assessoria de Serviços Sociais",
  DOC: "Divisão de Obtenção e Contratos",
  ACI: "Assessoria de Controle Interno",
  COMSOC: "Comunicação Social",
};

const COMPARACAO = {
  melhora: { texto: "melhor", cor: "var(--ok)" },
  piora: { texto: "pior", cor: "var(--critico)" },
  igual: { texto: "igual", cor: "var(--txt-2)" },
} as const;

/** Seta pelo movimento do número (↑ subiu, ↓ desceu), cor pelo sentido bom/ruim da direção. */
export function setaMesAnterior(ind: IndicadorPainel): { seta: string; cor: string; texto: string } | null {
  const c = ind.comparacaoMesAnterior, ant = ind.mesAnterior;
  if (!c || !ant) return null;
  const usaAtingimento = ind.id === "16" || ind.id === "22";
  const a = usaAtingimento ? ind.atingimento : ind.valor;
  const b = usaAtingimento ? ant.atingimento : ant.valor;
  const seta = c === "igual" || a === null || b === null ? "=" : a > b ? "↑" : "↓";
  return { seta, cor: COMPARACAO[c].cor, texto: `${COMPARACAO[c].texto} que ${ant.label}` };
}
