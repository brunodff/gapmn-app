// Busca por palavras nas tabelas do app (assistente): cada palavra tem de aparecer em pelo menos uma das colunas,
// sem diferença de acento nem de maiúscula nos dois sentidos ("manutencao" acha "MANUTENÇÃO" e "combustível" acha
// "COMBUSTIVEL") e pelo radical ("material" acha "materiais").

const VAZIAS = new Set(("a o as os e de da do das dos em no na nos nas para por com sem um uma uns umas que qual quais " +
  "quanto quantos quantas como onde quando ao aos se sobre ate entre mais menos meu minha nosso nossa ha tem ter sao " +
  "esta estao estao foi ser lista listar mostre mostrar me diga dizer quero saber existe existem algum alguma").split(" "));

const semAcento = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "");

/** Palavras que contam na busca (até 5): sem as vazias, sem pontuação nas pontas; nº de contrato fica inteiro. */
export function palavras(texto: string | null | undefined): string[] {
  const out: string[] = [];
  for (const bruto of String(texto ?? "").split(/[\s,;]+/)) {
    const p = bruto.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "");
    if (!p) continue;
    const chave = semAcento(p.toLowerCase());
    if (VAZIAS.has(chave) || (p.length < 3 && !/\d/.test(p))) continue;
    if (!out.some((x) => semAcento(x.toLowerCase()) === chave)) out.push(p);
    if (out.length >= 5) break;
  }
  return out;
}

// Variantes de cada letra (sem acento, com acento, maiúscula): o cadastro às vezes tem acento e a pergunta não, e vice-versa
const VARIANTES: Record<string, string> = { a: "aáàâãAÁÀÂÃ", e: "eéêEÉÊ", i: "iíIÍ", o: "oóôõOÓÔÕ", u: "uúüUÚÜ", c: "cçCÇ" };

/** Radical da palavra: sem acento, e sem o fim nas palavras longas ("materiais" e "material" → "materia"/"materi") */
export function radical(p: string): string {
  const w = semAcento(p).toLowerCase();
  if (/\d/.test(w)) return w;
  // "licitação"/"licitações" → "licitac"; "botões" → "bot"; o resto: corta o fim (plural, gênero)
  if (/c(ao|oes)$/.test(w)) return w.replace(/(ao|oes)$/, "");
  if (w.length >= 6 && /(oes|aes|aos)$/.test(w)) return w.slice(0, -3);
  return w.length >= 8 ? w.slice(0, -2) : w.length >= 6 ? w.slice(0, -1) : w;
}

/** Expressão regular (operador imatch do PostgREST) da palavra: radical com as variantes de acento; nº e sinais viram "." */
export function padrao(p: string): string {
  return [...radical(p)].map((ch) => (VARIANTES[ch] ? `[${VARIANTES[ch]}]` : /[a-z0-9 /-]/.test(ch) ? ch : ".")).join("");
}

/** Filtro .or() do PostgREST: a palavra em qualquer uma das colunas */
export const orDePalavra = (colunas: string[], p: string) => colunas.map((c) => `${c}.imatch."${padrao(p)}"`).join(",");

/** Palavras genéricas: saem primeiro quando a busca com todas as palavras não acha nada */
export const GENERICAS = new Set("material materiais servico servicos aquisicao aquisicoes contratacao contratacoes empresa empresas fornecimento produto produtos item itens geral diversos tipo contrato contratos".split(" "));
/** Aplica a busca (todas as palavras, cada uma em alguma coluna) numa consulta do supabase-js */
// deno-lint-ignore no-explicit-any
export function comPalavras<Q extends { or: (f: string) => Q }>(q: Q, colunas: string[], texto: string | null | undefined): Q {
  for (const p of palavras(texto)) q = q.or(orDePalavra(colunas, p));
  return q;
}

export const corta = (s: unknown, n: number) => {
  const t = String(s ?? "").replace(/\s+/g, " ").trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
};
