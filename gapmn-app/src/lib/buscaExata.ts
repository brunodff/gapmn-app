// Busca exata no texto das compras do PNCP. A busca do PNCP reduz as palavras ao radical (CLAUDE acha Claudia),
// então o resultado dela é conferido aqui: só fica a compra em que a palavra ou frase digitada aparece inteira,
// como palavra (não pedaço de outra). Maiúsculas e acentos não contam, porque o PNCP escreve sem padrão.

const normalizar = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
const escapar = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Expressão da frase digitada como palavra inteira; null se não há o que buscar */
export function expressaoExata(q: string): RegExp | null {
  const t = normalizar(q.replace(/^["']+|["']+$/g, ""));
  if (!t) return null;
  return new RegExp(`(?<![\\p{L}\\p{N}])${t.split(" ").map(escapar).join("\\s+")}(?![\\p{L}\\p{N}])`, "u");
}

/** A frase aparece exatamente em algum dos textos? (sem termo, tudo passa) */
export function casaExato(textos: (string | null | undefined)[], q: string): boolean {
  const re = expressaoExata(q);
  if (!re) return true;
  return re.test(normalizar(textos.filter(Boolean).join(" \n ")));
}

/** Textos da compra em que a palavra é procurada: título, objeto, órgão, unidade e fornecedor (atas) */
export const textosDaCompra = (i: { title?: string | null; description?: string | null; orgao_nome?: string | null; unidade_nome?: string | null; fornecedor_nome?: string | null }) =>
  [i.title, i.description, i.orgao_nome, i.unidade_nome, i.fornecedor_nome];

export const filtrarExato = <T extends Parameters<typeof textosDaCompra>[0]>(itens: T[], q: string) =>
  expressaoExata(q) ? itens.filter((i) => casaExato(textosDaCompra(i), q)) : itens;
