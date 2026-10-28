// Leitura da planilha "Notas de Empenho" por item (Tesouro Gerencial, só empenhos de 2026).
//
// Layout (21 colunas, A–U):
//   A data do lançamento · B NE (código SIAFI completo, só na 1ª linha de cada lançamento)
//   C sequencial do item · D "Item compra: 00001 - DESCRIÇÃO" (ou a descrição da NE quando não há item de compra)
//   E ano · F quantidade · G valor atual do item · H observação da NE · I/J UG (código/nome)
//   K/L natureza de despesa (código/nome) · M/N PI (código/nome) · O PAG · P/Q favorecido (código/nome)
//   R/S assinante da NE (CPF e nome: NÃO são lidos) · T situação da assinatura · U valor do lançamento
//
// O movimento do lançamento (coluna U) não serve para somar: vem multiplicado pelos registros de
// operação dos itens (o valor certo de cada lançamento sai de ./movimentos.ts). O valor da NE é a soma
// da coluna G, que bate com o SIAFI e com a soma dos lançamentos corrigidos. Dos lançamentos o painel
// usa só as datas.
//
// Cada lançamento da NE (original, reforço, anulação) repete a NE na coluna B. As linhas seguintes,
// sem NE, são os itens daquele lançamento, mas só no mesmo dia: a planilha intercala NEs diferentes.
// Linhas sem sequencial na coluna C repetem o item de cima (o relatório multiplica linhas); o valor
// atual do item (coluna G) é o mesmo em todas elas.

import { classificar, nomeDoItem, normalizar, type CategoriaId } from "./categorias.ts";

export type TipoFavorecido = "empresa" | "orgao" | "pessoa";

export type ItemEmpenho = {
  seq: string;
  /** Número do item na compra (licitação/ata), quando a linha traz "Item compra". */
  itemCompra: string | null;
  descricao: string;
  /** Nome curto do item (antes da primeira vírgula da descrição do catálogo). */
  nome: string;
  valor: number;
  categoria: CategoriaId;
};

export type NotaEmpenho = {
  ne: string;
  emissao: string;
  ultimoLancamento: string;
  ug: string;
  ugNome: string;
  natureza: string;
  naturezaNome: string;
  pi: string;
  piNome: string;
  /** PAG como veio na planilha. */
  pag: string;
  /** Parte fixa do número do PAG (órgão + sequencial + ano), para casar com contratos e processos. */
  pagChave: string | null;
  favorecido: { tipo: TipoFavorecido; documento: string | null; nome: string };
  observacao: string;
  solicitacao: string | null;
  assinada: boolean;
  itens: ItemEmpenho[];
  /** Datas dos lançamentos (emissão, reforços e anulações), em ordem. */
  lancamentos: string[];
  /** Valor atual da NE: soma do valor atual dos itens. */
  valor: number;
  /** Categoria do item de maior valor. */
  categoria: CategoriaId;
};

const DATA = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/;

/** "15/01/2026" → "2026-01-15". */
export function dataISO(v: string): string | null {
  const m = DATA.exec((v ?? "").trim());
  if (!m) return null;
  return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
}

/** Números da planilha: "1426651,68", "1.426.651,68", "5000000", "-100". */
export function numero(v: string): number {
  const s = (v ?? "").replace(/[R$\s]/g, "");
  if (!s) return 0;
  const n = s.includes(",") ? Number(s.replace(/\./g, "").replace(",", ".")) : Number(s);
  return Number.isFinite(n) ? n : 0;
}

/** "120630000012026NE000001" → "2026NE000001". */
export function neCurta(v: string): string | null {
  const m = /(\d{4}NE\d{6})\s*$/i.exec((v ?? "").trim());
  return m ? m[1].toUpperCase() : null;
}

/** Parte fixa do PAG: 5 dígitos do órgão + 6 do sequencial + 4 do ano. Os dígitos verificadores às vezes vêm cortados. */
export function chavePAG(v: string | null | undefined): string | null {
  const d = String(v ?? "").replace(/\D/g, "");
  return d.length >= 15 ? d.slice(0, 15) : null;
}

/**
 * Favorecido pelo código: 6 dígitos é UG (órgão), 12 a 14 é CNPJ (a planilha perde os zeros à esquerda).
 * Qualquer outro é tratado como pessoa física e não tem nome nem documento expostos.
 */
export function favorecidoDe(codigo: string, nome: string): NotaEmpenho["favorecido"] {
  const d = (codigo ?? "").replace(/\D/g, "");
  if (d.length === 6) return { tipo: "orgao", documento: d, nome: (nome ?? "").trim() || `UG ${d}` };
  if (d.length >= 12 && d.length <= 14) {
    const cnpj = d.padStart(14, "0");
    return { tipo: "empresa", documento: cnpj, nome: (nome ?? "").trim() || cnpj };
  }
  return { tipo: "pessoa", documento: null, nome: "Pessoa física" };
}

export const fmtCNPJ = (d: string) =>
  d.length === 14 ? `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}` : d;

/** Código da solicitação de empenho do SILOMS na observação (26S0001, 26M0435...). */
export function solicitacaoDe(texto: string): string | null {
  const m = /\b2[2-9][SM]\d{4,6}\b/i.exec(texto ?? "");
  return m ? m[0].toUpperCase() : null;
}

type Bruta = Omit<NotaEmpenho, "itens" | "lancamentos" | "valor" | "categoria" | "emissao" | "ultimoLancamento"> & {
  itens: Map<string, Omit<ItemEmpenho, "categoria">>;
  lancamentos: Set<string>;
};

/** Lê as linhas do CSV (já separadas em colunas) e devolve uma NE por número, com itens e lançamentos. */
export function lerEmpenhos(linhas: string[][]): NotaEmpenho[] {
  const porNE = new Map<string, Bruta>();
  let atual: Bruta | null = null;
  let diaAtual = "";
  let seqAtual = "";

  for (const c of linhas) {
    if (c.length < 21) continue;
    const data = dataISO(c[0]);
    if (!data) continue;

    const ne = neCurta(c[1]);
    if (ne) {
      atual = porNE.get(ne) ?? null;
      if (!atual) {
        const obs = (c[7] ?? "").trim();
        atual = {
          ne,
          ug: (c[8] ?? "").trim(),
          ugNome: (c[9] ?? "").trim(),
          natureza: (c[10] ?? "").trim(),
          naturezaNome: (c[11] ?? "").trim(),
          pi: (c[12] ?? "").trim(),
          piNome: (c[13] ?? "").trim(),
          pag: (c[14] ?? "").trim(),
          pagChave: chavePAG(c[14]),
          favorecido: favorecidoDe(c[15], c[16]),
          observacao: obs,
          solicitacao: solicitacaoDe(obs),
          assinada: /ASSINAD/i.test(c[19] ?? ""),
          itens: new Map(),
          lancamentos: new Set(),
        };
        porNE.set(ne, atual);
      } else if (/ASSINAD/i.test(c[19] ?? "")) {
        atual.assinada = true;
      }
      atual.lancamentos.add(data);
      diaAtual = data;
      seqAtual = "";
    } else if (!atual || data !== diaAtual) {
      continue; // linha sem NE de outro dia: não dá para saber de qual NE é
    }

    const seq = (c[2] ?? "").trim();
    if (seq) seqAtual = seq;
    if (!seqAtual) continue;
    if (!seq && atual.itens.has(seqAtual)) continue; // repetição do item de cima

    const descricao = (c[3] ?? "").replace(/\s+/g, " ").trim();
    const compra = /item\s*compra\s*:\s*(\d+)/i.exec(descricao);
    const anterior = atual.itens.get(seqAtual);
    atual.itens.set(seqAtual, {
      seq: seqAtual,
      itemCompra: compra ? String(Number(compra[1])) : anterior?.itemCompra ?? null,
      descricao: descricao || anterior?.descricao || atual.observacao,
      nome: nomeDoItem(descricao || anterior?.descricao || atual.observacao),
      valor: numero(c[6]),
    });
  }

  const resultado: NotaEmpenho[] = [];
  for (const b of porNE.values()) {
    const itens: ItemEmpenho[] = [...b.itens.values()]
      .sort((x, y) => Number(x.seq) - Number(y.seq))
      .map((it) => ({ ...it, categoria: classificar(b.natureza, it.descricao, b.observacao) }));
    const datas = [...b.lancamentos].sort();
    const valor = itens.reduce((s, it) => s + it.valor, 0);
    const maior = itens.reduce<ItemEmpenho | null>((m, it) => (!m || it.valor > m.valor ? it : m), null);
    resultado.push({
      ...b,
      itens,
      lancamentos: datas,
      valor,
      categoria: maior?.categoria ?? classificar(b.natureza, b.observacao),
      emissao: datas[0],
      ultimoLancamento: datas[datas.length - 1],
    });
  }
  return resultado.sort((a, b) => a.ne.localeCompare(b.ne));
}

/** Texto de busca de uma NE: número, PAG, solicitação, fornecedor, OM, itens e observação. */
export function textoBusca(n: NotaEmpenho): string {
  return normalizar([
    n.ne, n.pag, n.solicitacao ?? "", n.favorecido.tipo === "pessoa" ? "" : n.favorecido.nome,
    n.favorecido.documento ?? "", n.ugNome, n.piNome, n.naturezaNome, n.observacao,
    ...n.itens.map((i) => i.descricao),
  ].join(" "));
}
