// Regras do Painel de Execução: vínculo das NEs com contratos e processos, filtros e agrupamentos.
// Funções puras (sem React nem rede), testadas em painel.test.ts.

import { CATEGORIAS, normalizar, type CategoriaId } from "./categorias.ts";
import { chavePAG, textoBusca, type ItemEmpenho, type NotaEmpenho } from "./empenhos.ts";
import { SIGLA_POR_UG } from "../ugSiglas.ts";

export type ContratoResumo = {
  id: string;
  numero: string;
  objeto: string;
  fornecedor: string;
  cnpj: string | null;
  pagChave: string | null;
  inicio: string | null;
  fim: string | null;
  valor: number | null;
  status: string | null;
};

export type ProcessoResumo = {
  id: string;
  modalidade: string;
  numero: string;
  objeto: string;
  situacao: string | null;
  pagChave: string | null;
};

/** Liquidação e pagamento da NE (planilha "Situação de empenhos"). */
export type Financeiro = { aLiquidar: number; liquidadoPagar: number; pago: number };

export type Vinculo = { contrato: ContratoResumo | null; processo: ProcessoResumo | null };

const soDigitos = (s: string | null | undefined) => String(s ?? "").replace(/\D/g, "");

/** Sigla da OM pela UG; sem sigla conhecida, o nome da UG. */
export const omDe = (n: Pick<NotaEmpenho, "ug" | "ugNome">) => SIGLA_POR_UG[n.ug] ?? (n.ugNome || n.ug || "—");

/**
 * Liga cada NE ao contrato e ao processo licitatório pelo PAG.
 * Quando o PAG tem mais de um contrato (energia, por exemplo), vale o do mesmo CNPJ da NE;
 * sem CNPJ igual, o que estava vigente na emissão; sem isso, nenhum (para não ligar errado).
 */
export function vincular(
  nes: readonly NotaEmpenho[],
  contratos: readonly ContratoResumo[],
  processos: readonly ProcessoResumo[],
): Map<string, Vinculo> {
  const ctrPorPag = new Map<string, ContratoResumo[]>();
  for (const c of contratos) {
    const k = c.pagChave ?? null;
    if (!k) continue;
    ctrPorPag.set(k, [...(ctrPorPag.get(k) ?? []), c]);
  }
  const procPorPag = new Map<string, ProcessoResumo>();
  for (const p of processos) if (p.pagChave && !procPorPag.has(p.pagChave)) procPorPag.set(p.pagChave, p);

  const out = new Map<string, Vinculo>();
  for (const n of nes) {
    const k = n.pagChave;
    let contrato: ContratoResumo | null = null;
    const candidatos = k ? ctrPorPag.get(k) ?? [] : [];
    if (candidatos.length === 1) contrato = candidatos[0];
    else if (candidatos.length > 1) {
      const doc = soDigitos(n.favorecido.documento);
      const mesmoCnpj = doc ? candidatos.filter((c) => soDigitos(c.cnpj).padStart(14, "0") === doc) : [];
      const pool = mesmoCnpj.length ? mesmoCnpj : candidatos;
      const vigentes = pool.filter((c) => (!c.inicio || c.inicio <= n.emissao) && (!c.fim || c.fim >= n.emissao));
      if (pool.length === 1) contrato = pool[0];
      else if (vigentes.length === 1) contrato = vigentes[0];
      else if (mesmoCnpj.length) contrato = mesmoCnpj[0];
    }
    out.set(n.ne, { contrato, processo: k ? procPorPag.get(k) ?? null : null });
  }
  return out;
}

export { chavePAG };

// ─── Filtros ────────────────────────────────────────────────────────────────

export type Filtros = {
  busca: string;
  om: string;
  categoria: CategoriaId | "";
  natureza: string;
  pis: ReadonlySet<string>;
  mes: string; // "2026-03"
  contrato: string; // id do contrato
  fornecedor: string; // CNPJ
  soComContrato: boolean;
};

export const FILTROS_VAZIOS: Filtros = {
  busca: "", om: "", categoria: "", natureza: "", pis: new Set(), mes: "", contrato: "", fornecedor: "", soComContrato: false,
};

/** NE recortada pelos filtros: só os itens que passaram e o valor deles. */
export type Recorte = { nota: NotaEmpenho; itens: ItemEmpenho[]; valor: number; parcial: boolean };

export function filtrar(nes: readonly NotaEmpenho[], f: Filtros, vinculos: ReadonlyMap<string, Vinculo>): Recorte[] {
  const busca = normalizar(f.busca);
  const out: Recorte[] = [];
  for (const n of nes) {
    if (f.om && omDe(n) !== f.om) continue;
    if (f.natureza && n.natureza !== f.natureza) continue;
    if (f.pis.size && !f.pis.has(n.pi)) continue;
    if (f.mes && !n.emissao.startsWith(f.mes)) continue;
    if (f.fornecedor && n.favorecido.documento !== f.fornecedor) continue;
    const v = vinculos.get(n.ne);
    if (f.contrato && v?.contrato?.id !== f.contrato) continue;
    if (f.soComContrato && !v?.contrato) continue;

    let itens = n.itens;
    if (f.categoria) itens = itens.filter((i) => i.categoria === f.categoria);
    if (busca) {
      const naNE = textoNE(n, v).includes(busca);
      if (!naNE) itens = itens.filter((i) => normalizar(i.descricao).includes(busca));
    }
    if (!itens.length) continue;
    const valor = itens.reduce((s, i) => s + i.valor, 0);
    out.push({ nota: n, itens, valor, parcial: itens.length !== n.itens.length });
  }
  return out;
}

/** Texto da NE para a busca, sem os itens (que são filtrados um a um). */
function textoNE(n: NotaEmpenho, v: Vinculo | undefined): string {
  const semItens = textoBusca({ ...n, itens: [] });
  const extra = v?.contrato ? normalizar(`${v.contrato.numero} ${v.contrato.objeto}`) : "";
  return `${semItens} ${extra}`;
}

// ─── Agrupamentos ───────────────────────────────────────────────────────────

/** Liquidação e pagamento de um recorte. Se só parte dos itens entrou, vale a proporção do valor deles. */
export function financeiroDo(r: Recorte, fin: ReadonlyMap<string, Financeiro>): Financeiro {
  const f = fin.get(r.nota.ne);
  if (!f) return { aLiquidar: 0, liquidadoPagar: 0, pago: 0 };
  if (!r.parcial || r.nota.valor <= 0) return f;
  const p = r.valor / r.nota.valor;
  return { aLiquidar: f.aLiquidar * p, liquidadoPagar: f.liquidadoPagar * p, pago: f.pago * p };
}

export type Resumo = {
  valor: number;
  nes: number;
  itens: number;
  aLiquidar: number;
  liquidadoPagar: number;
  pago: number;
  /** NEs sem linha na planilha de situação (liquidação desconhecida). */
  semSituacao: number;
  valorComContrato: number;
  contratos: number;
  parcial: boolean;
};

export function resumir(rs: readonly Recorte[], fin: ReadonlyMap<string, Financeiro>, vinculos: ReadonlyMap<string, Vinculo>): Resumo {
  const r: Resumo = { valor: 0, nes: rs.length, itens: 0, aLiquidar: 0, liquidadoPagar: 0, pago: 0, semSituacao: 0, valorComContrato: 0, contratos: 0, parcial: false };
  const ctrs = new Set<string>();
  for (const x of rs) {
    r.valor += x.valor;
    r.itens += x.itens.length;
    if (x.parcial) r.parcial = true;
    if (!fin.has(x.nota.ne)) r.semSituacao++;
    const f = financeiroDo(x, fin);
    r.aLiquidar += f.aLiquidar;
    r.liquidadoPagar += f.liquidadoPagar;
    r.pago += f.pago;
    const c = vinculos.get(x.nota.ne)?.contrato;
    if (c) { r.valorComContrato += x.valor; ctrs.add(c.id); }
  }
  r.contratos = ctrs.size;
  return r;
}

export type Fatia = { chave: string; nome: string; valor: number; nes: number; itens: number; cor?: string };

function somar<T>(rs: readonly Recorte[], chaveDe: (r: Recorte, i: ItemEmpenho) => T | null, porItem: boolean) {
  const m = new Map<T, { valor: number; nes: Set<string>; itens: number }>();
  for (const r of rs) {
    if (porItem) {
      for (const i of r.itens) {
        const k = chaveDe(r, i);
        if (k === null) continue;
        const x = m.get(k) ?? { valor: 0, nes: new Set<string>(), itens: 0 };
        x.valor += i.valor; x.nes.add(r.nota.ne); x.itens++;
        m.set(k, x);
      }
    } else {
      const k = chaveDe(r, r.itens[0]);
      if (k === null) continue;
      const x = m.get(k) ?? { valor: 0, nes: new Set<string>(), itens: 0 };
      x.valor += r.valor; x.nes.add(r.nota.ne); x.itens += r.itens.length;
      m.set(k, x);
    }
  }
  return m;
}

const ordenar = (a: Fatia[]) => a.sort((x, y) => y.valor - x.valor);

export function porCategoria(rs: readonly Recorte[]): Fatia[] {
  const m = somar(rs, (_r, i) => i.categoria, true);
  return ordenar(CATEGORIAS.filter((c) => m.has(c.id)).map((c) => {
    const x = m.get(c.id)!;
    return { chave: c.id, nome: c.nome, valor: x.valor, nes: x.nes.size, itens: x.itens, cor: c.cor };
  }));
}

/** Por mês de emissão da NE (valor atual). */
export function porMes(rs: readonly Recorte[]): Fatia[] {
  const m = somar(rs, (r) => r.nota.emissao.slice(0, 7), false);
  return [...m].sort(([a], [b]) => a.localeCompare(b)).map(([k, x]) => ({ chave: k, nome: k, valor: x.valor, nes: x.nes.size, itens: x.itens }));
}

/** Objetos mais empenhados: itens agrupados pelo nome do catálogo. */
export function porObjeto(rs: readonly Recorte[]): (Fatia & { categoria: CategoriaId })[] {
  const m = new Map<string, { nome: string; categoria: CategoriaId; valor: number; nes: Set<string>; itens: number }>();
  for (const r of rs) for (const i of r.itens) {
    const k = normalizar(i.nome);
    const x = m.get(k) ?? { nome: i.nome, categoria: i.categoria, valor: 0, nes: new Set<string>(), itens: 0 };
    x.valor += i.valor; x.nes.add(r.nota.ne); x.itens++;
    m.set(k, x);
  }
  return [...m].map(([k, x]) => ({ chave: k, nome: x.nome, categoria: x.categoria, valor: x.valor, nes: x.nes.size, itens: x.itens }))
    .sort((a, b) => b.valor - a.valor);
}

export function porOM(rs: readonly Recorte[]): Fatia[] {
  const m = somar(rs, (r) => omDe(r.nota), false);
  return ordenar([...m].map(([k, x]) => ({ chave: k, nome: k, valor: x.valor, nes: x.nes.size, itens: x.itens })));
}

/** Fornecedores (só empresas; órgãos e pessoas físicas ficam de fora). */
export function porFornecedor(rs: readonly Recorte[]): (Fatia & { cnpj: string })[] {
  const nomes = new Map<string, string>();
  const m = somar(rs, (r) => {
    const f = r.nota.favorecido;
    if (f.tipo !== "empresa" || !f.documento) return null;
    nomes.set(f.documento, f.nome);
    return f.documento;
  }, false);
  return [...m].map(([k, x]) => ({ chave: k, cnpj: k, nome: nomes.get(k) ?? k, valor: x.valor, nes: x.nes.size, itens: x.itens }))
    .sort((a, b) => b.valor - a.valor);
}

export type LinhaContrato = { contrato: ContratoResumo; valor: number; nes: number; pago: number; aLiquidar: number };

/** Contratos mais empenhados no ano, com o que já foi pago. */
export function porContrato(rs: readonly Recorte[], vinculos: ReadonlyMap<string, Vinculo>, fin: ReadonlyMap<string, Financeiro>): LinhaContrato[] {
  const m = new Map<string, LinhaContrato>();
  for (const r of rs) {
    const c = vinculos.get(r.nota.ne)?.contrato;
    if (!c) continue;
    const x = m.get(c.id) ?? { contrato: c, valor: 0, nes: 0, pago: 0, aLiquidar: 0 };
    const f = financeiroDo(r, fin);
    x.valor += r.valor; x.nes++; x.pago += f.pago; x.aLiquidar += f.aLiquidar;
    m.set(c.id, x);
  }
  return [...m.values()].sort((a, b) => b.valor - a.valor);
}

/** Situação (liquidação e pagamento) por NE, somando as linhas da mesma NE. */
export function financeiroPorNE(linhas: readonly { nota_empenho: string; a_liquidar: number; liquidado_pagar: number; pago: number }[]): Map<string, Financeiro> {
  const m = new Map<string, Financeiro>();
  for (const l of linhas) {
    const ne = /(\d{4}NE\d{6})/i.exec(l.nota_empenho ?? "")?.[1]?.toUpperCase();
    if (!ne) continue;
    const x = m.get(ne) ?? { aLiquidar: 0, liquidadoPagar: 0, pago: 0 };
    x.aLiquidar += l.a_liquidar || 0; x.liquidadoPagar += l.liquidado_pagar || 0; x.pago += l.pago || 0;
    m.set(ne, x);
  }
  return m;
}
