// Resultado de um indicador a partir das variáveis informadas pela divisão.
// Espelho exato de public.gov_calcular (migração 20261022_governanca_coleta): o banco calcula o valor
// que fica gravado; aqui o cálculo só serve para mostrar o resultado enquanto a pessoa digita.
// As escalas são as da antiga aba BD da planilha (percentual de 0 a 100). Desde o catálogo GAP/CAE
// (migração 20261028): IDs 16 e 22 em 'reducao' (FAQ 14) e ID 26 em 'soma' (FAQ 17); 'variacao' ficou
// só para os lançamentos antigos.

export type Calculo = "razao" | "percentual" | "disponibilidade" | "variacao" | "reducao" | "soma" | "taxa_ajustada" | "direto";

export const CALCULOS: readonly Calculo[] = ["razao", "percentual", "disponibilidade", "variacao", "reducao", "soma", "taxa_ajustada", "direto"];

/** Quantas variáveis o formulário pede para cada tipo de cálculo. */
export function quantasVariaveis(calculo: Calculo): number {
  if (calculo === "direto") return 1;
  if (calculo === "taxa_ajustada") return 3;
  return 2;
}

/** Valor do indicador; null quando falta variável ou o denominador é zero (sem evento no mês). */
export function calcularValor(calculo: Calculo, v1: number | null, v2: number | null, v3: number | null): number | null {
  switch (calculo) {
    case "direto":
      return v1;
    case "razao":
      return v1 === null || v2 === null || v2 === 0 ? null : v1 / v2;
    case "percentual":
      return v1 === null || v2 === null || v2 === 0 ? null : (v1 / v2) * 100;
    case "disponibilidade":
      return v1 === null || v2 === null || v1 === 0 ? null : ((v1 - v2) / v1) * 100;
    case "variacao":
      // legado: a planilha gravava a variação em módulo; o sentido sai de v1 (atual) × v2 (anterior)
      return v1 === null || v2 === null || v2 === 0 ? null : Math.abs(((v1 - v2) / v2) * 100);
    case "reducao":
      // FAQ 14: v1 = atual, v2 = anterior; havendo redução, o percentual reduzido; sem redução, 0
      if (v1 === null || v2 === null || v2 === 0) return null;
      return v1 >= v2 ? 0 : ((v2 - v1) / v2) * 100;
    case "soma":
      // FAQ 17 (ID 26): média do item 5 + média do item 6 do MAC/SILOMS
      return v1 === null || v2 === null ? null : v1 + v2;
    case "taxa_ajustada":
      return v1 === null || v2 === null || v3 === null || v2 - v3 === 0 ? null : (v1 / (v2 - v3)) * 100;
  }
}

/** Número digitado em pt-BR ("1.234,5", "12,4", "7") → número; texto vazio → null; inválido → undefined. */
export function lerNumero(texto: string): number | null | undefined {
  // "R$ 19.692,83" (montantes do ressarcimento) vale como 19692,83
  const s = texto.trim().replace(/\s/g, "").replace(/^R\$/i, "");
  if (!s) return null;
  if (!/^-?[\d.,]+$/.test(s)) return undefined;
  const norm = s.includes(",") ? s.replace(/\./g, "").replace(",", ".") : /^-?\d{1,3}(\.\d{3})+$/.test(s) ? s.replace(/\./g, "") : s;
  const n = Number(norm);
  return Number.isFinite(n) ? n : undefined;
}

/** Número para mostrar num campo de digitação (vírgula decimal, sem separador de milhar). */
export function numeroParaCampo(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "";
  return String(Math.round(n * 1e6) / 1e6).replace(".", ",");
}
