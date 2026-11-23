// INCC da FGV, como o indice_fgv.py do pacote da SCON (versão 3.3). O INCC não está na Calculadora do Cidadão:
// o percentual e o print do parecer vêm da página anual da FGV (portal.fgv.br/noticias/incc-m-<ano>), tabela
// "Qual o valor do INCC-M acumulado em 12 meses?" (Mês de referência | Evolução Mensal | Acumulado 12 meses).
// Vale o "Acumulado 12 meses" da linha do último mês do período: pela regra dos 12 índices, ele cobre
// exatamente o período. O percentual tem 2 casas, como na tabela, e é usado como está.
// A página é a do ano do último mês; se a linha não estiver lá (aniversário em janeiro), a do ano seguinte,
// que também mostra os últimos meses do ano anterior.
// O navegador não lê a página (a FGV não libera CORS e só aceita TLS 1.2 com troca de chave RSA, que a função
// do Supabase não usa): quem lê é a ponte da Cloudflare (workers/indice-fgv), com o lerTabelaFgv daqui.

const MESES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];

/** Índices que vêm da FGV (página anual), e não da Calculadora do Cidadão */
export const ehFgv = (nome: string | null | undefined) => String(nome ?? "").toUpperCase().replace(/\s+/g, "").startsWith("INCC");

export function variante(nome: string | null | undefined): "INCC-M" | "INCC-DI" | "INCC-10" {
  const n = String(nome ?? "").toUpperCase().replace(/\s+/g, "");
  if (n.startsWith("INCC-DI")) return "INCC-DI";
  if (n.startsWith("INCC-10")) return "INCC-10";
  return "INCC-M"; // "INCC" sem sufixo = INCC-M (página usada pela SCON)
}

const mesAno = (s: string): [number, number] => { const [m, a] = s.trim().split("/").map(Number); return [m, a]; };
export function mesesEntre(ini: string, fim: string): number {
  const [mi, ai] = mesAno(ini), [mf, af] = mesAno(fim);
  return (af - ai) * 12 + (mf - mi) + 1;
}

/** "10/2026" → "out/26" (como na tabela da FGV) */
export function rotulo(mes: string): string {
  const [m, a] = mesAno(mes);
  return `${MESES[m - 1]}/${String(a % 100).padStart(2, "0")}`;
}

/** Nome da página anual: "incc-m-2026" */
export const paginaFgv = (nome: string, ano: number) => `${variante(nome).toLowerCase()}-${ano}`;
/** Só as páginas anuais do INCC (a ponte não lê outra coisa) */
export const PAGINA_FGV_VALIDA = /^incc-(m|di|10)-\d{4}$/;

/** Página anual da FGV. Com âncora, o navegador já abre rolado na tabela do acumulado (para o print). */
export function urlPaginaFgv(nome: string, ano: number, ancora = true): string {
  const url = `https://portal.fgv.br/noticias/${paginaFgv(nome, ano)}`;
  return ancora ? `${url}#:~:text=${encodeURIComponent(`Qual o valor do ${variante(nome)} acumulado em 12 meses`)}` : url;
}

export const urlGoogleFgv = (nome: string, ano: number) =>
  "https://www.google.com/search?q=" + encodeURIComponent(`índice ${variante(nome).split("-")[0]} FGV ${ano}`);

/** Links que a tela mostra no lugar do link da Calculadora do Cidadão (iguais aos do indice_fgv.links) */
export function linksFgv(nome: string, ini: string, fim: string) {
  const [, af] = mesAno(fim);
  return {
    fonte: "FGV", indice: variante(nome), periodo: `${ini} a ${fim}`, linha_tabela: rotulo(fim), coluna: "Acumulado 12 meses",
    url_print: urlPaginaFgv(nome, af), url_pagina_ano_seguinte: urlPaginaFgv(nome, af + 1), url_google: urlGoogleFgv(nome, af),
  };
}

/** {"out/26": [0.35, 6.75], …}: evolução mensal e acumulado em 12 meses de cada linha */
export type TabelaFgv = Record<string, [number, number]>;

function texto(html: string): string {
  return html.replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, " ")
    .replace(/<br\s*\/?>|<\/(td|th|tr|p|div|li)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ").replace(/&#37;/g, "%")
    .normalize("NFC");
}

/** A tabela a partir do HTML da página anual (como o ler_tabela do indice_fgv.py) */
export function lerTabelaFgv(html: string): TabelaFgv {
  const t = texto(html).replace(/\s+/g, " ");
  const out: TabelaFgv = {};
  for (const m of t.matchAll(/\b(jan|fev|mar|abr|mai|jun|jul|ago|set|out|nov|dez)\/(\d{2})\s+(-?\d+,\d+)\s*%\s+(-?\d+,\d+)\s*%/gi)) {
    const k = `${m[1].toLowerCase()}/${m[2]}`;
    if (!(k in out)) out[k] = [Number(m[3].replace(",", ".")), Number(m[4].replace(",", "."))];
  }
  return out;
}

export interface ResultadoFgv { percentual: number; url_print: string; linha_tabela: string; indice: string }

/** Percentual acumulado em 12 meses no último mês do período, como na tabela da FGV (acumulado_12m do motor).
 *  `tabelaDe("incc-m-2026")` devolve a tabela da página anual, ou null se a página não existe. */
export async function acumuladoFgv(nome: string, ini: string, fim: string, tabelaDe: (pagina: string) => Promise<TabelaFgv | null>): Promise<ResultadoFgv> {
  const n = mesesEntre(ini, fim);
  if (n !== 12) throw new Error(`a tabela da FGV dá o acumulado de 12 meses e o período ${ini} a ${fim} tem ${n}: informe o percentual à mão`);
  const [, af] = mesAno(fim);
  const linha = rotulo(fim);
  for (const ano of [af, af + 1]) {
    const tab = await tabelaDe(paginaFgv(nome, ano));
    if (tab?.[linha]) return { percentual: tab[linha][1], url_print: urlPaginaFgv(nome, ano), linha_tabela: linha, indice: variante(nome) };
  }
  throw new Error(`o ${variante(nome)} de ${linha} ainda não está na tabela da FGV (confira em ${urlGoogleFgv(nome, af)})`);
}
