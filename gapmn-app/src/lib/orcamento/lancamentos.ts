// Lançamentos das notas de empenho (emissão, reforço e anulação), dia a dia, para a lista
// "Empenhos do dia" do Painel Orçamentário. Lê a mesma planilha "Notas de Empenho" (layout em
// lib/execucao/empenhos.ts): cada lançamento repete a NE na coluna B, com a data na coluna A e o valor
// do lançamento na coluna U; as linhas seguintes, sem NE e no mesmo dia, são os itens dele.
//
// O primeiro lançamento da NE é a emissão; os seguintes são reforço (valor positivo) ou anulação
// (valor negativo). A coluna U vem multiplicada pelos registros de operação dos itens; o valor de
// cada lançamento sai de lib/execucao/movimentos.ts (exato, deduzido na NE zerada ou "a conferir").

import { nomeDoItem } from "../execucao/categorias.ts";
import { dataISO, favorecidoDe, neCurta, numero, solicitacaoDe, type NotaEmpenho } from "../execucao/empenhos.ts";
import { valoresDosLancamentos, type OrigemDoValor } from "../execucao/movimentos.ts";
import { REGRAS_RECEBIDO, siglaDe } from "./unidades.ts";

export type TipoLancamento = "emissao" | "reforco" | "anulacao";

export type ItemDaNota = { seq: string; nome: string; descricao: string; valor: number };

/** Um lançamento (emissão, reforço ou anulação) de uma nota de empenho. */
export type Lancamento = {
  /** Chave única: NE + posição do lançamento. */
  id: string;
  ne: string;
  /** Data do lançamento (AAAA-MM-DD). */
  data: string;
  tipo: TipoLancamento;
  /** Valor do lançamento: positivo na emissão e no reforço, negativo na anulação. */
  valor: number;
  /** "deduzido" na NE zerada; "a conferir" quando os lançamentos não fecham com o valor atual (conferir no SIAFI). */
  origem: OrigemDoValor;
  /** Posição do lançamento na NE (1 = emissão) e quantos ela tem. */
  ordem: number;
  total: number;
};

/** A nota de empenho com tudo o que a lista mostra ao expandir. */
export type NotaDoDia = {
  ne: string;
  ug: string;
  ugNome: string;
  sigla: string | null;
  nd: string;
  ndNome: string;
  pi: string;
  piNome: string;
  pag: string;
  solicitacao: string | null;
  observacao: string;
  assinada: boolean;
  favorecido: NotaEmpenho["favorecido"];
  /** Valor atual da NE (soma do valor atual dos itens). */
  valorAtual: number;
  itens: ItemDaNota[];
  lancamentos: Lancamento[];
};

export type LancamentosEmpenho = {
  notas: NotaDoDia[];
  /** Todos os lançamentos, do mais recente para o mais antigo. */
  lancamentos: Lancamento[];
};

type Bruta = Omit<NotaDoDia, "itens" | "lancamentos" | "valorAtual"> & {
  itens: Map<string, ItemDaNota>;
  /** Cada lançamento com a coluna U de todas as linhas dele (a da NE primeiro). */
  brutos: { data: string; movimentos: number[] }[];
};

/** Lê as linhas do CSV (já separadas em colunas) e devolve as notas com os lançamentos classificados. */
export function lerLancamentos(linhas: string[][]): LancamentosEmpenho {
  const porNE = new Map<string, Bruta>();
  let atual: Bruta | null = null;
  let dia = "";
  let seqAtual = "";

  for (const c of linhas) {
    if (c.length < 21) continue;
    const data = dataISO(c[0]);
    if (!data) continue;

    const ne = neCurta(c[1]);
    if (ne) {
      atual = porNE.get(ne) ?? null;
      if (!atual) {
        const ugNome = (c[9] ?? "").trim();
        const obs = (c[7] ?? "").replace(/\s+/g, " ").trim();
        atual = {
          ne,
          ug: (c[8] ?? "").trim(),
          ugNome,
          sigla: siglaDe(ugNome, REGRAS_RECEBIDO),
          nd: (c[10] ?? "").trim(),
          ndNome: (c[11] ?? "").trim(),
          pi: (c[12] ?? "").trim(),
          piNome: (c[13] ?? "").trim(),
          pag: (c[14] ?? "").trim(),
          solicitacao: solicitacaoDe(obs),
          observacao: obs,
          assinada: /ASSINAD/i.test(c[19] ?? ""),
          // colunas R e S (assinante) não são lidas; pessoa física aparece só como "Pessoa física"
          favorecido: favorecidoDe(c[15], c[16]),
          itens: new Map(),
          brutos: [],
        };
        porNE.set(ne, atual);
      } else if (/ASSINAD/i.test(c[19] ?? "")) {
        atual.assinada = true;
      }
      atual.brutos.push({ data, movimentos: [numero(c[20])] });
      dia = data;
      seqAtual = "";
    } else if (!atual || data !== dia) {
      continue; // linha sem NE de outro dia: não dá para saber de qual NE é
    } else {
      atual.brutos[atual.brutos.length - 1].movimentos.push(numero(c[20]));
    }

    const seq = (c[2] ?? "").trim();
    if (seq) seqAtual = seq;
    if (!seqAtual) continue;
    if (!seq && atual.itens.has(seqAtual)) continue; // repetição do item de cima
    const descricao = (c[3] ?? "").replace(/\s+/g, " ").trim() || atual.itens.get(seqAtual)?.descricao || atual.observacao;
    atual.itens.set(seqAtual, { seq: seqAtual, nome: nomeDoItem(descricao), descricao, valor: numero(c[6]) });
  }

  const notas: NotaDoDia[] = [];
  const todos: Lancamento[] = [];
  for (const b of porNE.values()) {
    const itens = [...b.itens.values()].sort((x, y) => Number(x.seq) - Number(y.seq));
    const valorAtual = itens.reduce((s, it) => s + it.valor, 0);
    const brutos = [...b.brutos].sort((x, y) => x.data.localeCompare(y.data));
    const { valores, origem } = valoresDosLancamentos(brutos.map((l) => l.movimentos), valorAtual);
    const lancamentos: Lancamento[] = brutos.map((l, i) => {
      const valor = valores[i];
      const tipo: TipoLancamento = i === 0 ? "emissao" : valor < 0 ? "anulacao" : "reforco";
      return { id: `${b.ne}#${i + 1}`, ne: b.ne, data: l.data, tipo, valor, origem, ordem: i + 1, total: brutos.length };
    });
    notas.push({
      ne: b.ne, ug: b.ug, ugNome: b.ugNome, sigla: b.sigla, nd: b.nd, ndNome: b.ndNome, pi: b.pi, piNome: b.piNome,
      pag: b.pag, solicitacao: b.solicitacao, observacao: b.observacao, assinada: b.assinada, favorecido: b.favorecido,
      valorAtual, itens, lancamentos,
    });
    todos.push(...lancamentos);
  }
  todos.sort((x, y) => y.data.localeCompare(x.data) || x.ne.localeCompare(y.ne) || x.ordem - y.ordem);
  return { notas, lancamentos: todos };
}

/** Esconde e-mails e telefones da observação (a página pública do painel fica aberta, sem login). */
export function semContatos(texto: string): string {
  return texto
    .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, "[e-mail]")
    .replace(/\(?\b\d{2}\)?\s*9?\d{4}[\s.-]?\d{4}\b/g, "[telefone]");
}

export type ResumoDoDia = Record<TipoLancamento, { quantidade: number; valor: number }>;

export function resumirDia(lancamentos: Lancamento[]): ResumoDoDia {
  const r: ResumoDoDia = { emissao: { quantidade: 0, valor: 0 }, reforco: { quantidade: 0, valor: 0 }, anulacao: { quantidade: 0, valor: 0 } };
  for (const l of lancamentos) { r[l.tipo].quantidade++; r[l.tipo].valor += l.valor; }
  return r;
}

/** Dias que têm lançamento, do mais recente para o mais antigo. */
export function diasComLancamento(lancamentos: Lancamento[]): string[] {
  return [...new Set(lancamentos.map((l) => l.data))].sort((a, b) => b.localeCompare(a));
}
