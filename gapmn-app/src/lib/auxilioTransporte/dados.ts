// Painel do Auxílio Transporte: leitura do que o banco devolve (at_painel), filtros e agregações.
// Funções puras, sem React e sem rede. Os dados vêm do SIGPES pela extensão "Leitor do SIGPES".

export type Solicitacao = {
  id: number;
  /** AAAA-MM-DD */
  solicitado: string | null;
  encaminhado: string | null;
  situacao: string;
  ordem: string;
  pg: string;
  om: string;
  nome: string;
  valor: number | null;
  trajetos: number | null;
  tarifas: string | null;
  /** Não veio na última leitura completa do SIGPES. */
  foraDaLista: boolean;
  alteradoEm: string | null;
  primeiraLeitura: string | null;
  situacaoAnterior: string | null;
  /** Todo o texto da solicitação, sem acento e em minúsculas, para a busca. */
  busca: string;
};

export type Leitura = {
  iniciada_em: string;
  concluida_em: string | null;
  status: "em_andamento" | "ok" | "erro";
  total: number | null;
  lidas: number;
  novas: number;
  alteradas: number;
  sairam: number | null;
  /** quem leu tem perfil que vê só parte da lista: atualizou o que veio e não tirou ninguém da lista */
  parcial?: boolean;
  /** quantas o paginador do SIGPES contou e as páginas não entregaram (leitura aceita, ninguém saiu da lista) */
  faltaram?: number | null;
  erro: string | null;
};

export type DadosAT = { solicitacoes: Solicitacao[]; leituras: Leitura[]; geradoEm: string };

export type FiltroAT = {
  busca: string;
  valorMin: number | null;
  valorMax: number | null;
  oms: string[];
  situacoes: string[];
  pgs: string[];
  /** Período da solicitação (AAAA-MM-DD). */
  de: string | null;
  ate: string | null;
  incluirForaDaLista: boolean;
};

export const FILTRO_VAZIO: FiltroAT = {
  busca: "", valorMin: null, valorMax: null, oms: [], situacoes: [], pgs: [], de: null, ate: null, incluirForaDaLista: false,
};

export const semAcento = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

const txt = (v: unknown) => (v === null || v === undefined ? "" : String(v).trim());
const num = (v: unknown) => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/** Resposta de at_painel → listas tipadas. As linhas vêm como listas, na ordem de `colunas`. */
export function lerPayload(json: unknown): DadosAT {
  const j = json as { ok?: boolean; colunas?: string[]; linhas?: unknown[][]; leituras?: Leitura[]; gerado_em?: string };
  if (!j || j.ok !== true || !Array.isArray(j.colunas) || !Array.isArray(j.linhas)) throw new Error("Resposta do painel em formato inesperado.");
  const i = Object.fromEntries(j.colunas.map((c, k) => [c, k])) as Record<string, number>;
  const solicitacoes = j.linhas.map((l): Solicitacao => {
    const s = {
      id: Number(l[i.id]),
      solicitado: txt(l[i.solicitado]) || null,
      encaminhado: txt(l[i.encaminhado]) || null,
      situacao: txt(l[i.situacao]).toUpperCase() || "SEM SITUAÇÃO",
      ordem: txt(l[i.ordem]),
      pg: txt(l[i.pg]).toUpperCase(),
      om: txt(l[i.om]).toUpperCase() || "SEM OM",
      nome: txt(l[i.nome]).toUpperCase(),
      valor: num(l[i.valor]),
      trajetos: num(l[i.trajetos]),
      tarifas: txt(l[i.tarifas]) || null,
      foraDaLista: l[i.fora_da_lista] === true,
      alteradoEm: txt(l[i.alterado_em]) || null,
      primeiraLeitura: txt(l[i.primeira_leitura]) || null,
      situacaoAnterior: txt(l[i.situacao_anterior]) || null,
      busca: "",
    };
    s.busca = semAcento([s.id, s.ordem, s.pg, s.om, s.nome, s.situacao, s.tarifas ?? "", dataBR(s.solicitado), dataBR(s.encaminhado),
      s.valor === null ? "" : fmtMoeda(s.valor), s.valor ?? ""].join(" | "));
    return s;
  }).filter((s) => Number.isFinite(s.id));
  return { solicitacoes, leituras: Array.isArray(j.leituras) ? j.leituras : [], geradoEm: txt(j.gerado_em) };
}

// ── formatação ─────────────────────────────────────────────────────────────────
export const fmtMoeda = (v: number | null | undefined) =>
  v === null || v === undefined || !Number.isFinite(v) ? "—" : v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
export const fmtNumero = (v: number | null | undefined) =>
  v === null || v === undefined || !Number.isFinite(v) ? "—" : v.toLocaleString("pt-BR");
export const dataBR = (iso: string | null | undefined) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : "");

/** "R$ 5.000", "5000", "5.000,50" → número; vazio → null; inválido → undefined. */
export function lerValor(texto: string): number | null | undefined {
  const s = texto.replace(/R\$/i, "").replace(/\s/g, "");
  if (!s) return null;
  if (!/^[\d.,]+$/.test(s)) return undefined;
  const n = Number(s.includes(",") ? s.replace(/\./g, "").replace(",", ".") : /^\d{1,3}(\.\d{3})+$/.test(s) ? s.replace(/\./g, "") : s);
  return Number.isFinite(n) ? n : undefined;
}

// ── filtro ─────────────────────────────────────────────────────────────────────
/** Termos da busca: todos precisam aparecer (em qualquer campo). */
export function termos(busca: string): string[] {
  return semAcento(busca).split(/\s+/).filter(Boolean);
}

export function filtrar(lista: Solicitacao[], f: FiltroAT): Solicitacao[] {
  const t = termos(f.busca);
  const oms = new Set(f.oms), sits = new Set(f.situacoes), pgs = new Set(f.pgs);
  return lista.filter((s) =>
    (f.incluirForaDaLista || !s.foraDaLista) &&
    (f.valorMin === null || (s.valor !== null && s.valor >= f.valorMin)) &&
    (f.valorMax === null || (s.valor !== null && s.valor <= f.valorMax)) &&
    (!oms.size || oms.has(s.om)) &&
    (!sits.size || sits.has(s.situacao)) &&
    (!pgs.size || pgs.has(s.pg)) &&
    (!f.de || (s.solicitado !== null && s.solicitado >= f.de)) &&
    (!f.ate || (s.solicitado !== null && s.solicitado <= f.ate)) &&
    t.every((x) => s.busca.includes(x)),
  );
}

export function filtroAtivo(f: FiltroAT): boolean {
  return !!f.busca.trim() || f.valorMin !== null || f.valorMax !== null || f.oms.length > 0 || f.situacoes.length > 0 ||
    f.pgs.length > 0 || !!f.de || !!f.ate || f.incluirForaDaLista;
}

// ── agregações ─────────────────────────────────────────────────────────────────
const ENCERRADAS = ["FINALIZADO", "CANCELADO", "INDEFERIDO", "ARQUIVADO", "NEGADO", "EXCLUIDO"];
export const encerrada = (situacao: string) => ENCERRADAS.some((e) => semAcento(situacao).toUpperCase().startsWith(e));

export type Resumo = { quantidade: number; valorTotal: number; valorMedio: number | null; emAndamento: number; finalizadas: number; canceladas: number };

export function resumir(lista: Solicitacao[]): Resumo {
  let valorTotal = 0, comValor = 0, emAndamento = 0, finalizadas = 0, canceladas = 0;
  for (const s of lista) {
    if (s.valor !== null) { valorTotal += s.valor; comValor++; }
    if (s.situacao.startsWith("FINALIZ")) finalizadas++;
    else if (s.situacao.startsWith("CANCEL")) canceladas++;
    if (!encerrada(s.situacao)) emAndamento++;
  }
  return { quantidade: lista.length, valorTotal, valorMedio: comValor ? valorTotal / comValor : null, emAndamento, finalizadas, canceladas };
}

export type Fatia = { rotulo: string; quantidade: number; valor: number };

function agrupar(lista: Solicitacao[], chave: (s: Solicitacao) => string): Fatia[] {
  const m = new Map<string, Fatia>();
  for (const s of lista) {
    const k = chave(s);
    const f = m.get(k) ?? { rotulo: k, quantidade: 0, valor: 0 };
    f.quantidade++;
    f.valor += s.valor ?? 0;
    m.set(k, f);
  }
  return [...m.values()].sort((a, b) => b.quantidade - a.quantidade || a.rotulo.localeCompare(b.rotulo));
}

export const porSituacao = (lista: Solicitacao[]) => agrupar(lista, (s) => s.situacao);

/** As `n` OMs com mais solicitações; o resto vira "Outras OMs". */
export function porOM(lista: Solicitacao[], n = 10): (Fatia & { outras?: boolean })[] {
  const todas = agrupar(lista, (s) => s.om);
  if (todas.length <= n) return todas;
  const resto = todas.slice(n);
  return [...todas.slice(0, n), {
    rotulo: `Outras ${resto.length} OMs`, quantidade: resto.reduce((a, f) => a + f.quantidade, 0),
    valor: resto.reduce((a, f) => a + f.valor, 0), outras: true,
  }];
}

const MESES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];

/** Solicitações por mês de solicitação, nos `meses` meses até o último com solicitação (inclusive os vazios). */
export function porMes(lista: Solicitacao[], meses = 12): (Fatia & { mes: string })[] {
  const datas = lista.map((s) => s.solicitado).filter((d): d is string => !!d).sort();
  if (!datas.length) return [];
  const ultimo = datas[datas.length - 1].slice(0, 7);
  let [a, m] = ultimo.split("-").map(Number);
  const chaves: string[] = [];
  for (let k = 0; k < meses; k++) {
    chaves.unshift(`${a}-${String(m).padStart(2, "0")}`);
    if (--m === 0) { m = 12; a--; }
  }
  const mapa = new Map(chaves.map((c) => [c, { mes: c, rotulo: `${MESES[Number(c.slice(5)) - 1]}/${c.slice(2, 4)}`, quantidade: 0, valor: 0 }]));
  for (const s of lista) {
    const f = s.solicitado ? mapa.get(s.solicitado.slice(0, 7)) : undefined;
    if (f) { f.quantidade++; f.valor += s.valor ?? 0; }
  }
  return [...mapa.values()];
}

export type Faixa = { rotulo: string; min: number; max: number | null };
export const FAIXAS: Faixa[] = [
  { rotulo: "até 500", min: 0, max: 500 },
  { rotulo: "500 a 1 mil", min: 500, max: 1000 },
  { rotulo: "1 a 1,5 mil", min: 1000, max: 1500 },
  { rotulo: "1,5 a 2 mil", min: 1500, max: 2000 },
  { rotulo: "2 a 3 mil", min: 2000, max: 3000 },
  { rotulo: "3 a 5 mil", min: 3000, max: 5000 },
  { rotulo: "5 a 10 mil", min: 5000, max: 10000 },
  { rotulo: "acima de 10 mil", min: 10000, max: null },
];

/** Quantidade em cada faixa de valor ([min, max)). */
export function porFaixa(lista: Solicitacao[]): (Fatia & { faixa: Faixa })[] {
  return FAIXAS.map((faixa) => {
    const dentro = lista.filter((s) => s.valor !== null && s.valor >= faixa.min && (faixa.max === null || s.valor < faixa.max));
    return { rotulo: faixa.rotulo, faixa, quantidade: dentro.length, valor: dentro.reduce((a, s) => a + (s.valor ?? 0), 0) };
  });
}

const ORDEM_PG = ["TB", "MB", "BR", "CEL", "TC", "MAJ", "CP", "CAP", "1T", "2T", "ASP", "SO", "1S", "2S", "3S", "CB", "S1", "S2", "SD", "CIVIL"];

/** Opções dos filtros (OMs e situações em ordem alfabética; postos pela hierarquia). */
export function opcoes(lista: Solicitacao[]): { oms: string[]; situacoes: string[]; pgs: string[] } {
  const u = (f: (s: Solicitacao) => string) => [...new Set(lista.map(f).filter(Boolean))];
  const pos = (p: string) => { const i = ORDEM_PG.indexOf(p.replace(/\s/g, "")); return i < 0 ? 99 : i; };
  return {
    oms: u((s) => s.om).sort((a, b) => a.localeCompare(b)),
    situacoes: u((s) => s.situacao).sort((a, b) => a.localeCompare(b)),
    pgs: u((s) => s.pg).sort((a, b) => pos(a) - pos(b) || a.localeCompare(b)),
  };
}

export type CampoOrdem = "id" | "solicitado" | "encaminhado" | "situacao" | "ordem" | "pg" | "om" | "nome" | "valor" | "trajetos";

export function ordenar(lista: Solicitacao[], campo: CampoOrdem, crescente: boolean): Solicitacao[] {
  const sinal = crescente ? 1 : -1;
  return [...lista].sort((a, b) => {
    const x = a[campo], y = b[campo];
    if (x === y) return b.id - a.id;
    if (x === null || x === "") return 1;   // vazios sempre no fim
    if (y === null || y === "") return -1;
    return (typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y), "pt-BR", { numeric: true })) * sinal;
  });
}
