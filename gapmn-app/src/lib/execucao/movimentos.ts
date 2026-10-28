// Valor de cada lançamento (emissão, reforço ou anulação) de uma NE na planilha "Notas de Empenho".
//
// A coluna U ("Movim. Líquido - R$" da conta Despesas Empenhadas) é do documento, não do item: o Tesouro
// Gerencial não reparte o movimento contábil por item e o repete em cada registro de operação dos itens
// da NE (coluna F, "NE Item - Qtde Operação"). Cada emissão, reforço ou anulação cria registros de
// operação, e os registros com o mesmo item e a mesma quantidade saem numa linha só, com o movimento
// somado. Num lançamento, então, cada linha traz movimento × (registros daquela linha). Esses registros
// são os mesmos em todos os dias da NE, porque o relatório é extraído inteiro: uma NE emitida e depois
// anulada pela mesma quantidade mostra a emissão e a anulação em dobro (2026NE001520: R$ 40.800,00
// na planilha, R$ 20.400,00 no SIAFI).
//
// Com o valor atual da NE (soma da coluna G) diferente de zero, o multiplicador sai exato: a soma da
// 1ª linha de cada lançamento dividida pelo valor atual. Com a NE zerada (anulada por inteiro), essa
// soma é zero e não diz nada; o multiplicador é deduzido. As proporções entre as linhas de um lançamento
// dão a contagem relativa dos registros, e a linha com mais registros passou por todos os lançamentos
// (a emissão e a anulação total passam por todos os itens). Se isso der fração de centavo, que não existe
// no SIAFI, o multiplicador desce até dar centavos inteiros. Conferido com a cópia da planilha de
// 20/10/2026: acerta as 7 NEs anuladas por inteiro depois dessa data; nas NEs com valor, o multiplicador
// exato dá centavos inteiros em todos os 1.977 lançamentos.

/** De onde veio o valor: exato (fecha com o valor atual), deduzido (NE zerada) ou como veio (não fecha). */
export type OrigemDoValor = "exato" | "deduzido" | "a conferir";

export type ValoresDosLancamentos = {
  /** Valor de cada lançamento, na mesma ordem da entrada. */
  valores: number[];
  origem: OrigemDoValor;
  /** Por quanto a planilha multiplicou a 1ª linha de cada lançamento (1 = veio certo). */
  multiplicador: number;
};

const TOLERANCIA = 0.05;
const MAIOR_MULTIPLICADOR = 200;

/** Todos os valores divididos por `k` dão centavos inteiros? */
const centavosInteiros = (valores: number[], k: number) =>
  valores.every((v) => Math.abs((v / k) * 100 - Math.round((v / k) * 100)) < 1e-4);

/** Contagem relativa dos registros de cada linha, pelo lançamento de maior movimento: a menor que dá inteiros. */
function contagemDasLinhas(movimentos: number[][]): { linhas: number[]; primeira: number } | null {
  const ref = movimentos.reduce((a, b) => (Math.abs(b[0] ?? 0) > Math.abs(a[0] ?? 0) ? b : a));
  const base = ref[0] ?? 0;
  if (Math.abs(base) <= TOLERANCIA) return null;
  const razoes = ref.map((v) => v / base);
  for (let primeira = 1; primeira <= MAIOR_MULTIPLICADOR; primeira++) {
    const linhas = razoes.map((r) => r * primeira);
    if (linhas.every((c) => Math.round(c) >= 1 && Math.abs(c - Math.round(c)) < 1e-3)) {
      return { linhas: linhas.map(Math.round), primeira };
    }
  }
  return null;
}

/**
 * Valores dos lançamentos de uma NE.
 * `movimentos[i]` são as colunas U das linhas do i-ésimo lançamento (a linha da NE primeiro, depois as
 * linhas de item do mesmo dia); `valorAtual` é a soma da coluna G dos itens.
 */
export function valoresDosLancamentos(movimentos: number[][], valorAtual: number): ValoresDosLancamentos {
  const primeiras = movimentos.map((l) => l[0] ?? 0);
  const comoVeio: ValoresDosLancamentos = { valores: primeiras, origem: "a conferir", multiplicador: 1 };
  if (!primeiras.length) return { ...comoVeio, origem: "exato" };
  const soma = primeiras.reduce((s, v) => s + v, 0);

  if (Math.abs(valorAtual) > TOLERANCIA) {
    const k = Math.round(soma / valorAtual);
    if (k >= 1 && Math.abs(soma - k * valorAtual) <= TOLERANCIA * k) {
      return { valores: primeiras.map((v) => v / k), origem: "exato", multiplicador: k };
    }
    return comoVeio;
  }

  // NE zerada: os lançamentos precisam se anular; senão a planilha está incompleta
  if (Math.abs(soma) > TOLERANCIA * primeiras.length) return comoVeio;
  if (primeiras.every((v) => Math.abs(v) <= TOLERANCIA)) return { ...comoVeio, origem: "exato" };
  const contagem = contagemDasLinhas(movimentos);
  if (!contagem) return comoVeio;
  let vezes = Math.max(1, Math.ceil(movimentos.length / Math.max(...contagem.linhas)));
  while (vezes > 1 && !centavosInteiros(primeiras, contagem.primeira * vezes)) vezes--;
  const k = contagem.primeira * vezes;
  if (!centavosInteiros(primeiras, k)) return comoVeio;
  return { valores: primeiras.map((v) => v / k), origem: "deduzido", multiplicador: k };
}
