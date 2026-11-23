// INCC da FGV, como o indice_fgv.py do pacote da SCON (versão 3.3). O INCC não está na Calculadora do Cidadão:
// o percentual e o print do parecer vêm da página anual da FGV (portal.fgv.br/noticias/incc-m-<ano>), tabela
// "Qual o valor do INCC-M acumulado em 12 meses?" (Mês de referência | Evolução Mensal | Acumulado 12 meses).
// Vale o "Acumulado 12 meses" da linha do último mês do período: pela regra dos 12 índices, ele cobre
// exatamente o período. O percentual tem 2 casas, como na tabela.
// A página é a do ano do último mês; se a linha não estiver lá (aniversário em janeiro), a do ano seguinte.
// O app não lê a página sozinho: o site da FGV não libera o navegador (CORS) e só aceita uma criptografia
// antiga (TLS 1.2 com troca de chave RSA) que a função do Supabase não usa. O fiscal abre o link, digita o
// percentual e tira o print — o caminho que o pacote da SCON prevê quando a busca automática falha.

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

/** "10/2026" → "out/26" (como na tabela da FGV) */
export function rotulo(mes: string): string {
  const [m, a] = mesAno(mes);
  return `${MESES[m - 1]}/${String(a % 100).padStart(2, "0")}`;
}

/** Página anual da FGV. Com âncora, o navegador já abre rolado na tabela do acumulado (para o print). */
export function urlPaginaFgv(nome: string, ano: number, ancora = true): string {
  const url = `https://portal.fgv.br/noticias/${variante(nome).toLowerCase()}-${ano}`;
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
