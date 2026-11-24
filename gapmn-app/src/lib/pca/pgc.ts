// PCA no PGC (Módulo A): os itens vêm dos Dados Abertos do Compras.gov.br (módulo PGC: projeto de compra,
// DFD, datas de início e fim do processo, valores) e do PNCP (código da contratação "120630-110/2027",
// que o TR repete no "Identificador da Futura Contratação"). Junta tudo em uma contratação por projeto de compra.
import { type Categoria } from "./tipos.ts";
import { categoriaProvavel, normalizarIdContratacao, semAcento } from "./regras.ts";

/** Item do PGC nos Dados Abertos (/modulo-pgc/1_consultarPgcDetalhe) */
export interface ItemPgc {
  descricaoArtefato?: string | null;       // DFD "4/2027"
  codigoAreaDfd?: string | null;
  tipoItem?: string | null;                // M | S
  valorTotalItem?: number | null;
  tituloProjetoCompra?: string | null;
  descricaoProjetoCompra?: string | null;
  dataInicioProcessoCompra?: string | null;
  dataFimProcessoCompra?: string | null;
  numeroItemPncp?: number | null;
}
/** Item do PCA no PNCP (/api/pncp/v1/orgaos/{cnpj}/pca/{ano}/{seq}/itens) */
export interface ItemPncp {
  numeroItem: number;
  grupoContratacaoCodigo?: string | null;
  grupoContratacaoNome?: string | null;
  dataDesejada?: string | null;
  valorTotal?: number | null;
  categoriaItemPcaNome?: string | null;
}

export interface ContratacaoPgc {
  chave_pgc: string;
  id_contratacao_pgc: string | null;
  numeros_dfd: string[];
  itens_pca: number[];
  objeto: string;
  objeto_resumido: string;
  categoria: Categoria;
  valor_estimado: number;
  area_pgc: string | null;
  data_estimada_chegada: string | null;
  data_estimada_conclusao: string | null;
}

/** Chave estável do projeto de compra no PGC: título + data de início (títulos se repetem com datas diferentes) */
export function chavePgc(titulo: string, inicio: string | null | undefined): string {
  return `${semAcento(titulo).replace(/[^a-z0-9]+/g, " ").trim()}|${String(inicio ?? "").slice(0, 10)}`;
}

/** Objeto resumido para a tabela: o título do projeto sem "Aquisição de" e afins, até 80 caracteres */
export function resumirObjeto(t: string): string {
  const s = t.replace(/\s+/g, " ").trim().replace(/^(aquisi[çc][ãa]o|contrata[çc][ãa]o|presta[çc][ãa]o)\s+(de|do|da|dos|das)\s+/i, "").replace(/[.;]+$/, "");
  const r = s.charAt(0).toUpperCase() + s.slice(1);
  return r.length > 80 ? r.slice(0, 79).replace(/\s+\S*$/, "") + "…" : r;
}

export function agruparPgc(itens: ItemPgc[], pncp: ItemPncp[]): ContratacaoPgc[] {
  const porItemPncp = new Map(pncp.map((p) => [p.numeroItem, p]));
  const grupos = new Map<string, { itens: ItemPgc[]; pncp: ItemPncp[] }>();
  for (const it of itens) {
    const titulo = (it.tituloProjetoCompra ?? "").trim();
    if (!titulo) continue;
    const k = chavePgc(titulo, it.dataInicioProcessoCompra);
    const g = grupos.get(k) ?? { itens: [], pncp: [] };
    g.itens.push(it);
    const p = it.numeroItemPncp != null ? porItemPncp.get(it.numeroItemPncp) : undefined;
    if (p) g.pncp.push(p);
    grupos.set(k, g);
  }
  const lista: ContratacaoPgc[] = [];
  for (const [k, g] of grupos) {
    const it0 = g.itens[0];
    // o código mais frequente (um projeto pode ter itens publicados em mais de uma contratação; raro)
    const contagem = new Map<string, number>();
    for (const p of g.pncp) { const id = normalizarIdContratacao(p.grupoContratacaoCodigo); if (id) contagem.set(id, (contagem.get(id) ?? 0) + 1); }
    const id = [...contagem].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
    const objeto = (it0.descricaoProjetoCompra || it0.tituloProjetoCompra || "").replace(/\s+/g, " ").trim();
    const tipos = new Set(g.itens.map((i) => i.tipoItem ?? ""));
    const tipo = tipos.has("S") && !tipos.has("M") ? "S" : tipos.has("M") && !tipos.has("S") ? "M" : tipos.has("S") ? "S" : null;
    const catPncp = g.pncp.find((p) => p.categoriaItemPcaNome)?.categoriaItemPcaNome ?? null;
    const areas = new Map<string, number>();
    for (const i of g.itens) if (i.codigoAreaDfd) areas.set(i.codigoAreaDfd, (areas.get(i.codigoAreaDfd) ?? 0) + 1);
    lista.push({
      chave_pgc: k,
      id_contratacao_pgc: id,
      numeros_dfd: [...new Set(g.itens.map((i) => i.descricaoArtefato).filter((d): d is string => !!d))].sort(),
      itens_pca: [...new Set(g.itens.map((i) => i.numeroItemPncp).filter((n): n is number => n != null))].sort((a, b) => a - b),
      objeto,
      objeto_resumido: resumirObjeto(it0.tituloProjetoCompra ?? objeto),
      categoria: categoriaProvavel(`${it0.tituloProjetoCompra ?? ""} ${objeto}`, tipo, catPncp),
      valor_estimado: Math.round(g.itens.reduce((s, i) => s + (Number(i.valorTotalItem) || 0), 0) * 100) / 100,
      area_pgc: [...areas].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null,
      data_estimada_chegada: it0.dataInicioProcessoCompra ? it0.dataInicioProcessoCompra.slice(0, 10) : null,
      data_estimada_conclusao: it0.dataFimProcessoCompra ? it0.dataFimProcessoCompra.slice(0, 10) : (g.pncp.find((p) => p.dataDesejada)?.dataDesejada?.slice(0, 10) ?? null),
    });
  }
  return lista.sort((a, b) => (a.data_estimada_chegada ?? "9999").localeCompare(b.data_estimada_chegada ?? "9999"));
}
