// Prévia do resultado e da classificação de um indicador enquanto a divisão digita.
// Usa as mesmas regras do Painel de Governança (lib/indicadores/calculo.ts), montando uma linha
// no formato da BD: o que aparece no formulário é o que vai aparecer no painel.

import { calcularAtingimento, calcularStatus } from "../indicadores/calculo.ts";
import type { LinhaBD, Status } from "../indicadores/tipos.ts";
import { calcularValor } from "./formulas.ts";
import type { IndicadorGov, TipoLancamento } from "./tipos.ts";

export type Previa = {
  valor: number | null;
  atingimento: number | null;
  status: Status;
  /** A pessoa já digitou alguma coisa neste indicador. */
  tocado: boolean;
};

export function linhaDoIndicador(
  ind: IndicadorGov, v: { v1: number | null; v2: number | null; v3: number | null }, tipo: TipoLancamento = "Realizado",
  competencia = "2026-01",
): LinhaBD {
  const valor = calcularValor(ind.calculo, v.v1, v.v2, v.v3);
  const [ano, mes] = competencia.split("-").map(Number);
  return {
    ID: ind.id, DIVISAO: ind.divisao, CATEGORIA: ind.categoria, INDICADOR: ind.indicador, UNIDADE: ind.unidade,
    FORMULA: ind.formula, META_TXT: ind.meta_txt, META_NUM: ind.meta_num, DIRECAO: ind.direcao, TIPO: tipo,
    ANO: ano, MES_NUM: mes, MES: "", DATA: `${competencia}-01`, VALOR: valor,
    VAR1_NOME: ind.variaveis[0] ?? null, VAR1_VALOR: ind.calculo === "direto" ? null : v.v1,
    VAR2_NOME: ind.variaveis[1] ?? null, VAR2_VALOR: v.v2,
    VAR3_NOME: ind.variaveis[2] ?? null, VAR3_VALOR: v.v3,
  };
}

export function previaDoIndicador(ind: IndicadorGov, v: { v1: number | null; v2: number | null; v3: number | null }): Previa {
  const linha = linhaDoIndicador(ind, v);
  const atingimento = calcularAtingimento(linha);
  return {
    valor: linha.VALOR,
    atingimento,
    status: calcularStatus(linha, atingimento),
    tocado: v.v1 !== null || v.v2 !== null || v.v3 !== null,
  };
}

/** Pede justificativa (o campo de comentário abre sozinho). */
export const pedeJustificativa = (s: Status) => s === "Atenção" || s === "Crítico";
