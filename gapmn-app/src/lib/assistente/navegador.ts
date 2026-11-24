// Consultas do assistente que rodam no navegador: empenhos e crédito vêm das planilhas do Tesouro Gerencial
// (a de NE tem ~23 MB), grandes demais para a função do servidor. Usa os mesmos leitores dos painéis e guarda
// o resultado por 10 minutos na memória da página. CPF de favorecido pessoa física não vai para a IA.
import type { NotaEmpenho } from "../execucao/empenhos.ts";
import type { Financeiro } from "../execucao/painel.ts";
import type { LinhaDisponivel, LinhaRecebido } from "../orcamento/tipos.ts";
import { chaveContrato, citacoes, saldoAEmpenhar, type ExecucaoContrato } from "../contratos/execucao.ts";
import type { ContratoExec } from "../contratos/useExecucaoContratos.ts";

export interface Fonte { rotulo: string; link: string; externo?: boolean }
export interface ResultadoNavegador { paraIA: unknown; fontes: Fonte[] }
type Args = Record<string, unknown>;

const s = (v: unknown) => (typeof v === "string" ? v.trim() : v == null ? "" : String(v));
const semAcento = (t: string) => t.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
const r2 = (v: number) => Math.round(v * 100) / 100;
const corta = (t: unknown, n: number) => { const x = String(t ?? "").replace(/\s+/g, " ").trim(); return x.length > n ? `${x.slice(0, n - 1)}…` : x; };
const VAZIAS = new Set("a o as os e de da do das dos em no na para por com um uma que qual quais quanto ao aos se sobre".split(" "));
/** Palavras da busca (sem acento, sem as vazias) */
export const termos = (texto: string) => semAcento(texto).split(/[\s,;]+/).map((p) => p.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "")).filter((p) => p && !VAZIAS.has(p) && (p.length > 2 || /\d/.test(p)));
const todas = (alvo: string, ps: string[]) => { const a = semAcento(alvo); return ps.every((p) => a.includes(p)); };
const app = (vista: string, busca?: string) => `/app?vista=${vista}${busca ? `&busca=${encodeURIComponent(busca)}` : ""}`;

// ── Empenhos ─────────────────────────────────────────────────────────────────
export function consultarEmpenhos(nes: NotaEmpenho[], financeiro: Map<string, Financeiro>, a: Args, omDe: (n: NotaEmpenho) => string): ResultadoNavegador {
  const ps = termos(s(a.texto));
  const ano = s(a.ano).slice(0, 4);
  const om = semAcento(s(a.om));
  const nd = s(a.natureza).replace(/\D/g, "");
  const achadas = nes.filter((n) => (!ano || n.emissao.startsWith(ano))
    && (!om || semAcento(omDe(n)) === om || semAcento(n.ugNome).includes(om))
    && (!nd || n.natureza.replace(/\D/g, "").startsWith(nd))
    && (!ps.length || todas(`${n.ne} ${n.favorecido.nome} ${n.favorecido.tipo === "pessoa" ? "" : n.favorecido.documento ?? ""} ${n.observacao} ${n.pi} ${n.piNome} ${n.natureza} ${n.naturezaNome} ${n.pag} ${n.ugNome} ${omDe(n)} ${n.solicitacao ?? ""} ${n.itens.map((i) => i.descricao).join(" ")}`, ps)));
  const ord = a.ordem === "data" ? [...achadas].sort((x, y) => y.emissao.localeCompare(x.emissao)) : [...achadas].sort((x, y) => y.valor - x.valor);
  const fin = (n: NotaEmpenho) => financeiro.get(n.ne);
  const soma = (f: (n: NotaEmpenho) => number) => r2(achadas.reduce((t, n) => t + f(n), 0));
  return {
    paraIA: {
      tela: "Painéis Gerenciais › Painel de Execução (empenhos por item)", total: achadas.length, mostrados: Math.min(12, achadas.length),
      somas_de_todas: { empenhado: soma((n) => n.valor), a_liquidar: soma((n) => fin(n)?.aLiquidar ?? 0), liquidado_a_pagar: soma((n) => fin(n)?.liquidadoPagar ?? 0), pago: soma((n) => fin(n)?.pago ?? 0) },
      notas: ord.slice(0, 12).map((n) => ({
        ne: n.ne, emissao: n.emissao, om: omDe(n), favorecido: n.favorecido.tipo === "pessoa" ? "pessoa física" : n.favorecido.nome,
        cnpj: n.favorecido.tipo === "empresa" ? n.favorecido.documento ?? undefined : undefined, natureza: `${n.natureza} ${n.naturezaNome}`.trim(), pi: `${n.pi} ${n.piNome}`.trim(),
        valor: r2(n.valor), a_liquidar: fin(n) ? r2(fin(n)!.aLiquidar) : undefined, liquidado_a_pagar: fin(n) ? r2(fin(n)!.liquidadoPagar) : undefined, pago: fin(n) ? r2(fin(n)!.pago) : undefined,
        pag: n.pag || undefined, observacao: corta(n.observacao, 120), assinada: n.assinada,
      })),
    },
    fontes: [{ rotulo: s(a.texto) ? `Painel de Execução: "${s(a.texto)}"` : "Painel de Execução", link: app("painel-execucao", s(a.texto) || undefined) },
      ...ord.slice(0, 2).map((n) => ({ rotulo: `NE ${n.ne}`, link: app("painel-execucao", n.ne) }))],
  };
}

// ── Execução de contratos (a mesma conta da aba Execução do contrato) ─────────
export type ContratoInfo = ContratoExec & { fornecedor?: string | null; descricao?: string | null };

/** Contratos pedidos: pelo número citado no texto ("008/GAPMN-DACTAIV/2025", "contrato 8/2025"); sem número,
 *  pelas palavras (empresa, objeto, CNPJ, PAG). */
export function acharContratos(contratos: ContratoInfo[], texto: string): ContratoInfo[] {
  const cits = [...citacoes(texto), ...(chaveContrato(texto) ? [{ ...chaveContrato(texto)!, forte: true }] : [])];
  if (cits.length) {
    const achados = contratos.filter((c) => {
      const k = chaveContrato(c.numero_contrato);
      return !!k && cits.some((x) => x.num === k.num && (k.num >= 100000 || x.ano === k.ano) && (!x.unidade || !k.unidade || x.unidade.includes(k.unidade) || k.unidade.includes(x.unidade)));
    });
    if (achados.length) return achados;
  }
  const ps = termos(texto);
  return ps.length ? contratos.filter((c) => todas(`${c.numero_contrato} ${c.fornecedor ?? ""} ${c.descricao ?? ""} ${c.cnpj ?? ""} ${c.pag_nup ?? ""}`, ps)) : [];
}

export function consultarExecucaoContratos(contratos: ContratoInfo[], porContrato: ReadonlyMap<string, ExecucaoContrato>, a: Args): ResultadoNavegador {
  const achados = acharContratos(contratos, s(a.texto));
  const tela = "Contratos › Contratos SCON › aba Execução do contrato";
  const regra = "NEs ligadas ao contrato pela mesma regra da aba Execução: citação do contrato na NE, PAG do contrato e mesmo fornecedor no PAG";
  if (!achados.length) return { paraIA: { tela, total: 0, obs: `nenhum contrato encontrado para "${s(a.texto)}"` }, fontes: [] };
  const exec = (c: ContratoInfo) => porContrato.get(c.id);
  const tot = (c: ContratoInfo) => exec(c)?.totais;
  const saldo = (c: ContratoInfo) => saldoAEmpenhar(c.vl_contratual, exec(c), c.vl_a_empenhar);
  const fonte = (c: ContratoInfo) => ({ rotulo: `Execução do ${c.numero_contrato}`, link: app("contratos", c.numero_contrato) });
  if (achados.length === 1) {
    const c = achados[0], e = exec(c), t = tot(c), sa = saldo(c);
    return {
      paraIA: {
        tela, regra, total: 1,
        contrato: c.numero_contrato, empresa: c.fornecedor ?? undefined, objeto: corta(c.descricao, 120), vigencia: `${c.data_inicio ?? "?"} a ${c.data_final ?? "?"}`,
        valor_contratual: c.vl_contratual ?? undefined,
        saldo_a_empenhar: sa.valor == null ? "sem cálculo" : r2(sa.valor), saldo_fonte: sa.fonte === "SILOMS" ? "SILOMS (o histórico de NEs do contrato está incompleto nas planilhas)" : sa.fonte ?? undefined,
        totais: t ? { quantidade_de_nes: t.nNE, empenhado: r2(t.empenhado), a_liquidar: r2(t.aLiquidar), liquidado_a_pagar: r2(t.liquidadoPagar), pago: r2(t.pago), empenhado_no_ano: r2(t.empenhadoAno) } : undefined,
        notas_de_empenho: (e?.nes ?? []).slice(0, 30).map((n) => ({ ne: n.ne, empenhado: r2(n.empenhado), a_liquidar: r2(n.aLiquidar), liquidado_a_pagar: r2(n.liquidadoPagar), pago: r2(n.pago), descricao: corta(n.descricao, 80) })),
        ...(e && e.nes.length > 30 ? { obs_lista: `mostradas 30 de ${e.nes.length} NEs` } : {}),
        ...(e?.empenhadoIncompleto ? { aviso: "o contrato começou antes de 2022 ou tem NE sem itens: o empenhado das NEs pode estar a menor" } : {}),
        ...(e?.citamOutro.length ? { nes_do_mesmo_pag_que_citam_outro_contrato: e.citamOutro.map((n) => n.ne) } : {}),
      },
      fontes: [fonte(c)],
    };
  }
  const soma = (f: (c: ContratoInfo) => number) => r2(achados.reduce((x, c) => x + f(c), 0));
  return {
    paraIA: {
      tela, regra, total: achados.length, mostrados: Math.min(12, achados.length),
      somas_de_todos: { empenhado: soma((c) => tot(c)?.empenhado ?? 0), pago: soma((c) => tot(c)?.pago ?? 0), a_liquidar: soma((c) => tot(c)?.aLiquidar ?? 0) },
      contratos: achados.slice(0, 12).map((c) => {
        const t = tot(c), sa = saldo(c);
        return { contrato: c.numero_contrato, empresa: c.fornecedor ?? undefined, fim: c.data_final ?? undefined, valor_contratual: c.vl_contratual ?? undefined,
          nes: t?.nNE ?? 0, empenhado: r2(t?.empenhado ?? 0), pago: r2(t?.pago ?? 0), a_liquidar: r2(t?.aLiquidar ?? 0),
          saldo_a_empenhar: sa.valor == null ? undefined : r2(sa.valor) };
      }),
    },
    fontes: achados.slice(0, 3).map(fonte),
  };
}

// ── Crédito ──────────────────────────────────────────────────────────────────
export function consultarCredito(tipo: "disponivel" | "recebido", linhas: (LinhaDisponivel | LinhaRecebido)[], a: Args): ResultadoNavegador {
  const ps = termos(s(a.texto));
  const achadas = linhas.filter((l) => !ps.length || todas(`${l.pi} ${l.piNome} ${l.nd} ${l.ndNome} ${l.ug} ${l.ugNome} ${l.sigla ?? ""} ${"ptres" in l ? l.ptres : ""} ${"obs" in l ? `${l.nc} ${l.obs}` : ""}`, ps));
  const total = r2(achadas.reduce((t, l) => t + l.valor, 0));
  const porPI = new Map<string, number>();
  for (const l of achadas) porPI.set(`${l.pi} ${l.piNome}`.trim(), (porPI.get(`${l.pi} ${l.piNome}`.trim()) ?? 0) + l.valor);
  const ord = tipo === "recebido" ? [...achadas].sort((x, y) => String((y as LinhaRecebido).data).localeCompare(String((x as LinhaRecebido).data))) : [...achadas].sort((x, y) => y.valor - x.valor);
  return {
    paraIA: {
      tela: "Painéis Gerenciais › Painel Orçamentário (aba Crédito)", o_que: tipo === "disponivel" ? "saldo de crédito disponível" : "notas de crédito recebidas no ano",
      total_linhas: achadas.length, soma: total,
      por_pi: [...porPI].sort((x, y) => y[1] - x[1]).slice(0, 8).map(([pi, v]) => ({ pi, valor: r2(v) })),
      linhas: ord.slice(0, 12).map((l) => ({ om: l.sigla ?? l.ugNome, pi: `${l.pi} ${l.piNome}`.trim(), nd: `${l.nd} ${l.ndNome}`.trim(), valor: r2(l.valor),
        ...("ptres" in l ? { ptres: l.ptres } : {}), ...("nc" in l ? { nc: l.nc, data: l.data, descricao: corta(l.obs, 100) } : {}) })),
    },
    fontes: [{ rotulo: "Painel Orçamentário (crédito)", link: "/app?vista=painel-orcamento" }],
  };
}

// ── Carga das planilhas (com cache de 10 min) ────────────────────────────────
const VALIDADE = 10 * 60_000;
const cache = new Map<string, { em: number; p: Promise<unknown> }>();
function lembrar<T>(chave: string, f: () => Promise<T>): Promise<T> {
  const c = cache.get(chave);
  if (c && Date.now() - c.em < VALIDADE) return c.p as Promise<T>;
  const p = f();
  cache.set(chave, { em: Date.now(), p });
  p.catch(() => cache.delete(chave));
  return p;
}

async function baixarCSV(url: string): Promise<string[][]> {
  const { parseCSV } = await import("../orcamento/leitura.ts");
  const r = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(45_000) });
  if (!r.ok) throw new Error(`a planilha respondeu ${r.status}`);
  return parseCSV(await r.text());
}

/** Roda a consulta pedida pela IA (nome = "execucao_contratos" | "empenhos" | "credito") */
export async function executarNoNavegador(nome: string, a: Args): Promise<ResultadoNavegador> {
  if (nome === "execucao_contratos") {
    // as mesmas planilhas (baixar) e a mesma conta (calcularExecucao) da aba Execução do contrato, com todos os contratos
    const [{ baixar, calcularExecucao }, { supabase }] = await Promise.all([import("../contratos/useExecucaoContratos.ts"), import("../supabase")]);
    const [dados, contratos] = await Promise.all([baixar(), lembrar("contratos", async () => {
      const { data, error } = await supabase.from("contratos_scon").select("id,numero_contrato,pag_nup,cnpj,data_inicio,data_final,vl_contratual,vl_a_empenhar,fornecedor,descricao").limit(5000);
      if (error) throw new Error(error.message);
      return (data ?? []) as ContratoInfo[];
    })]);
    return consultarExecucaoContratos(contratos, calcularExecucao(dados, contratos).porContrato, a);
  }
  if (nome === "empenhos") {
    const [{ buscarExecucao }, { omDe }] = await Promise.all([import("../execucao/fonte.ts"), import("../execucao/painel.ts")]);
    const d = await lembrar("execucao", buscarExecucao);
    return consultarEmpenhos(d.nes, d.financeiro, a, omDe);
  }
  if (nome === "credito") {
    const tipo = a.tipo === "recebido" ? "recebido" : "disponivel";
    const [{ PLANILHAS_ORCAMENTO }, { lerDisponivel, lerRecebido }] = await Promise.all([import("../orcamento/fonte.ts"), import("../orcamento/leitura.ts")]);
    const linhas = await lembrar(`credito-${tipo}`, async () => (tipo === "disponivel"
      ? lerDisponivel(await baixarCSV(PLANILHAS_ORCAMENTO.disponivel)) : lerRecebido(await baixarCSV(PLANILHAS_ORCAMENTO.recebido))));
    return consultarCredito(tipo, linhas, a);
  }
  throw new Error(`consulta desconhecida: ${nome}`);
}
