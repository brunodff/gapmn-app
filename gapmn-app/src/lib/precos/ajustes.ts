// Ajustes da cesta de preços pela IN SEGES/ME nº 65/2021:
// - a mesma CATMAT junta preços em unidades de fornecimento diferentes (a unidade, a caixa com 100, o pacote
//   com 50): misturar dá média e mediana sem sentido. A estatística parte de uma unidade só — a do item, se
//   aparecer entre os preços, senão a mais comum — e o analista troca, se quiser;
// - art. 5º, I e II: os preços de compras anteriores são considerados "observado o índice de atualização de
//   preços correspondente". O app atualiza pelo IPCA (série 433 do Banco Central), do mês seguinte ao da
//   compra até o último mês divulgado, e guarda o preço original.

export interface PrecoComUnidade {
  precoUnitario?: number;
  siglaUnidadeFornecimento?: string | null;
  capacidadeUnidadeFornecimento?: number | null;
  dataCompra?: string;
  precoOriginal?: number;
  fatorCorrecao?: number;
}

const fmtCap = (v: number) => v.toLocaleString("pt-BR", { maximumFractionDigits: 2 });

/** "UN", "CX c/ 100"… (como a tela mostra e filtra) */
export function unidadeDoRegistro(r: PrecoComUnidade): string {
  const cap = r.capacidadeUnidadeFornecimento;
  return `${r.siglaUnidadeFornecimento ?? "?"}${cap && cap !== 1 ? ` c/ ${fmtCap(cap)}` : ""}`;
}

// sai na sigla do catálogo (a dos preços praticados): o PNCP, de onde vem a unidade das atas, escreve por extenso
const SINONIMOS: [RegExp, string][] = [
  [/^(UN|UND|UNID|UNIDADE|UNIDADES|UNI)$/, "UN"], [/^(PC|PCA|PECA|PECAS)$/, "PC"],
  [/^(COMPR|COMP|CP|CPR|COMPRIMIDO|COMPRIMIDOS)$/, "COMPR"], [/^(CAPS|CAP|CAPSULA|CAPSULAS)$/, "CAPS"],
  [/^(FRAM|FRASCOAMPOLA|FRASCOAMPOLAS)$/, "FR-AM"], [/^(AMP|AMPOLA|AMPOLAS)$/, "AMP"], [/^(FR|FRASCO|FRASCOS)$/, "FR"],
  [/^(BIS|BISNAGA|BISNAGAS)$/, "BIS"], [/^(CX|CAIXA|CAIXAS)$/, "CX"], [/^(PCT|PACOTE|PACOTES|PT)$/, "PCT"],
  [/^(KG|QUILO|QUILOGRAMA|QUILOGRAMAS)$/, "KG"], [/^(L|LT|LITRO|LITROS)$/, "L"], [/^(M|METRO|METROS)$/, "M"],
  [/^(RESMA|RESMAS|RM)$/, "RESMA"], [/^(GL|GALAO|GALOES)$/, "GL"], [/^(SV|SERV|SERVICO|SERVICOS)$/, "SERVICO"], [/^(MES|MESES)$/, "MES"],
];
/** Sigla de unidade sem acento, ponto e variações ("Unid." = "UN", "Comprimido" = "COMPR") */
export function normalizarUnidade(s: string | null | undefined): string {
  const t = String(s ?? "").normalize("NFD").replace(/\p{M}/gu, "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  for (const [rx, v] of SINONIMOS) if (rx.test(t)) return v;
  return t;
}

/** Unidade em que a estatística começa: "" quando os preços já estão numa unidade só. */
export function unidadePadrao(registros: PrecoComUnidade[], unidadeItem?: string | null): string {
  const cont = new Map<string, number>();
  for (const r of registros) if (typeof r.precoUnitario === "number") cont.set(unidadeDoRegistro(r), (cont.get(unidadeDoRegistro(r)) ?? 0) + 1);
  if (cont.size <= 1) return "";
  const alvo = normalizarUnidade(unidadeItem);
  const doItem = alvo ? [...cont.entries()].filter(([u]) => !u.includes(" c/ ") && normalizarUnidade(u) === alvo) : [];
  const lista = doItem.length ? doItem : [...cont.entries()];
  return lista.sort((a, b) => b[1] - a[1])[0][0];
}

/** {"2026-03": 0.56, …} a partir da série mensal do SGS ([{ data: "01/03/2026", valor: "0.56" }]) */
export function variacoesPorMes(serie: { data: string; valor: string }[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const { data, valor } of serie) {
    const d = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(data);
    const v = Number(String(valor).replace(",", "."));
    if (d && Number.isFinite(v)) m.set(`${d[3]}-${d[2]}`, v);
  }
  return m;
}

const proximoMes = (am: string) => {
  const [a, m] = am.split("-").map(Number);
  return m === 12 ? `${a + 1}-01` : `${a}-${String(m + 1).padStart(2, "0")}`;
};

/** Fator do IPCA do mês seguinte ao da compra até `ate` (AAAA-MM, último mês divulgado); 1 se nada a corrigir */
export function fatorIpca(dataCompra: string | undefined, variacoes: Map<string, number>, ate: string): number {
  const am = /^(\d{4})-(\d{2})/.exec(dataCompra ?? "");
  if (!am) return 1;
  let fator = 1;
  for (let mes = proximoMes(`${am[1]}-${am[2]}`); mes <= ate; mes = proximoMes(mes)) {
    const v = variacoes.get(mes);
    if (v != null) fator *= 1 + v / 100;
  }
  return fator;
}

/** Preços atualizados pelo IPCA (preço original e fator guardados no registro) */
export function corrigirPrecos<T extends PrecoComUnidade>(registros: T[], variacoes: Map<string, number>, ate: string): T[] {
  return registros.map((r) => {
    if (typeof r.precoUnitario !== "number") return r;
    const original = r.precoOriginal ?? r.precoUnitario;
    const fator = fatorIpca(r.dataCompra, variacoes, ate);
    return { ...r, precoOriginal: original, fatorCorrecao: fator, precoUnitario: Math.round(original * fator * 10000) / 10000 };
  });
}

export interface PrecoDeAta extends PrecoComUnidade { idCompraItem?: string; estado?: string; unidadeTexto?: string | null }

/** Itens de ata (art. 5º, II) prontos para a cesta: só da UF pedida (sem UF conhecida, ficam fora quando há
 *  filtro de UF), unidade da compra como sigla, atualização pelo IPCA; `novas` = os que não estavam entre os
 *  preços praticados (o mesmo item de compra conta uma vez só). */
export function prepararAtas<T extends PrecoDeAta>(registros: T[], op: {
  ufs: string[]; praticados: Set<string | undefined>; ipca?: { variacoes: Map<string, number>; ate: string } | null;
}): { registros: T[]; novas: number } {
  let regs = registros
    .filter((r) => !op.ufs.length || (!!r.estado && op.ufs.includes(r.estado)))
    .map((r) => ({ ...r, siglaUnidadeFornecimento: r.unidadeTexto ? normalizarUnidade(r.unidadeTexto) : null, capacidadeUnidadeFornecimento: null }));
  if (op.ipca) regs = corrigirPrecos(regs, op.ipca.variacoes, op.ipca.ate);
  return { registros: regs, novas: regs.filter((r) => !op.praticados.has(r.idCompraItem)).length };
}

/** Último mês da série (AAAA-MM) */
export const ultimoMesDaSerie = (variacoes: Map<string, number>) => [...variacoes.keys()].sort().pop() ?? "";
