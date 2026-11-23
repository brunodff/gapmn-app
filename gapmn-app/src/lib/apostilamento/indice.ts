// Índice do reajuste pelo Banco Central (SGS), como o indice_bcb.py do pacote da SCON: variações mensais
// do mês do orçamento até o mês anterior ao aniversário (12 índices), acumuladas como na Calculadora do
// Cidadão e arredondadas em 6 casas. A conta é feita em inteiros (BigInt), sem erro de ponto flutuante.
// O INCC, que não está na Calculadora, vem da tabela anual da FGV (indiceFgv.ts).

export const SERIES_SGS: Record<string, number> = { IPCA: 433, INPC: 188, "IGP-M": 189, "IGP-DI": 190 };

const CALCULADORA: Record<string, string> = {
  IPCA: "00433IPCA", INPC: "00188INPC", "IGP-M": "28655IGP-M", "IGP-DI": "00190IGP-DI",
  "IPCA-E": "10764IPC-E", "IPC-BRASIL": "00191IPC-BRASIL", "IPC-SP": "00193IPC-SP",
};

const mmAaaa = (m: number, a: number) => `${String(m).padStart(2, "0")}/${a}`;
function somaMeses(m: number, a: number, k: number): [number, number] {
  const t = a * 12 + (m - 1) + k;
  return [(t % 12 + 12) % 12 + 1, Math.floor(t / 12)];
}

/** Nome do índice como chave das tabelas: "ipca (ibge)" → "IPCA". */
export function chaveIndice(nome: string): string {
  const s = nome.toUpperCase().normalize("NFD").replace(/\p{M}/gu, "");
  for (const k of ["IPCA-E", "IGP-DI", "IGP-M", "IPCA", "INPC", "IPC-BRASIL", "IPC-SP", "INCC"]) {
    if (s.replace(/\s+/g, "").includes(k)) return k;
  }
  return s.trim();
}

/** Período do n-ésimo reajuste (regra DOZE_INDICES): do mês do orçamento + 12(n−1) até 11 meses depois. */
export function periodoDoReajuste(dataBase: string, n: number): { inicio: string; fim: string; aniversario: string } {
  const m = /^(\d{2})\/(\d{4})$/.exec(dataBase);
  if (!m) throw new Error("data do orçamento no formato MM/AAAA");
  const ini = somaMeses(+m[1], +m[2], 12 * (n - 1));
  const aniv = somaMeses(+m[1], +m[2], 12 * n);
  return { inicio: mmAaaa(...ini), fim: mmAaaa(...somaMeses(aniv[0], aniv[1], -1)), aniversario: mmAaaa(...aniv) };
}

function decimal(s: string): { v: bigint; casas: number } {
  const t = s.trim().replace(",", ".");
  if (!/^-?\d+(\.\d+)?$/.test(t)) throw new Error(`valor do índice inválido: ${s}`);
  const [int, dec = ""] = t.replace("-", "").split(".");
  const v = BigInt(int + dec) * (t.startsWith("-") ? -1n : 1n);
  return { v, casas: dec.length };
}

/**
 * Percentual acumulado das variações mensais, como a Calculadora do Cidadão: o fator (produto de 1 + v/100)
 * é arredondado em 7 casas ("Índice de correção no período: 1,0535117") e o percentual sai dele
 * (5,3511700 %). Conferido com a SCON: IPCA 07/2024–06/2025 = 5,351170 e 07/2025–06/2026 = 4,641330.
 * (Acumular sem arredondar o fator dá 5,351165, e pelo número-índice do IBGE, 5,351285: nenhum dos dois é
 * o da Calculadora, que vai no parecer.)
 */
export function acumular(variacoes: string[]): number {
  let prod = 1n, escala = 0;
  for (const s of variacoes) {
    const { v, casas } = decimal(s);
    prod *= 10n ** BigInt(casas + 2) + v; // 1 + v/100, na escala 10^(casas+2)
    escala += casas + 2;
  }
  // fator em 7 casas, arredondado "meio para cima" (o fator é sempre positivo)
  const den = 10n ** BigInt(escala);
  let f7 = (prod * 10n ** 7n) / den;
  if (((prod * 10n ** 7n) % den) * 2n >= den) f7 += 1n;
  // percentual = (fator − 1) × 100 = (f7 − 10^7) / 10^5
  return Number(f7 - 10n ** 7n) / 1e5;
}

export interface ResultadoIndice { indice: string; inicio: string; fim: string; percentual: number; meses: number; completo: boolean; url_calculadora: string | null }

/** Busca no SGS do Banco Central e acumula. `completo` = vieram os 12 meses (índice do mês final já divulgado). */
export async function buscarIndice(nome: string, inicio: string, fim: string, valorCalculadora = 1000, f: typeof fetch = fetch): Promise<ResultadoIndice> {
  const indice = chaveIndice(nome);
  const serie = SERIES_SGS[indice];
  if (!serie) throw new Error(`${indice}: não está no Banco Central — informe o percentual à mão (para o INCC, a fonte é a FGV)`);
  const [mi, ai] = inicio.split("/").map(Number), [mf, af] = fim.split("/").map(Number);
  const url = `https://api.bcb.gov.br/dados/serie/bcdata.sgs.${serie}/dados?formato=json&dataInicial=01/${String(mi).padStart(2, "0")}/${ai}&dataFinal=28/${String(mf).padStart(2, "0")}/${af}`;
  const r = await f(url);
  if (!r.ok) throw new Error(`Banco Central respondeu ${r.status}`);
  const dados: { data: string; valor: string }[] = await r.json();
  if (!dados.length) throw new Error("índice ainda não divulgado para o período");
  const esperados = (af * 12 + mf) - (ai * 12 + mi) + 1;
  return {
    indice, inicio, fim, percentual: acumular(dados.map((d) => d.valor)), meses: dados.length,
    completo: dados.length >= esperados, url_calculadora: urlCalculadora(indice, inicio, fim, valorCalculadora),
  };
}

/** Link da Calculadora do Cidadão já preenchida (para o print que vai no parecer). */
export function urlCalculadora(nome: string, inicio: string, fim: string, valor: number): string | null {
  const cod = CALCULADORA[chaveIndice(nome)];
  if (!cod) return null;
  const v = valor.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return "https://www3.bcb.gov.br/CALCIDADAO/publico/corrigirPorIndice.do?method=corrigirPorIndice"
    + `&aba=1&selIndice=${cod}&dataInicial=${inicio}&dataFinal=${fim}&valorCorrecao=${v}`;
}
