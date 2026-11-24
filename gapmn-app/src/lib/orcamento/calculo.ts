// Medidas da aba Crédito do Power BI "Painel de Controle | DOC-MN", em funções puras.
//
// Interações replicadas do BI:
// - "Selecione a OM" filtra os cartões, o gráfico por mês, o empenhado por PI e o recebido por OM.
//   NÃO filtra a faixa de unidades nem a lista de crédito disponível.
// - "Selecione a ND" filtra tudo. Aqui a ND vale direto em cada planilha (crédito, empenho e
//   saldo pela própria natureza de despesa da linha).

import type {
  CartaoUnidade, DadosOrcamento, FiltroCredito, IdadeCredito, LinhaDisponivel, LinhaRecebido, LinhaSaldo,
  NotaCredito, NotaNoSaldo, OpcaoND, PainelCredito, UnidadeDisponivel, ValorRotulado,
} from "./tipos.ts";
import { APOIADAS, logoDa } from "./unidades.ts";

export const MESES_CURTOS = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
export const SEM_SIGLA = "Outras UG";

const ORDEM_APOIADAS = new Map(APOIADAS.map((a, i) => [a.sigla, i]));

function somarPor<T>(itens: T[], chave: (x: T) => string, valor: (x: T) => number): Map<string, number> {
  const m = new Map<string, number>();
  for (const x of itens) m.set(chave(x), (m.get(chave(x)) ?? 0) + valor(x));
  return m;
}

const decrescente = (a: ValorRotulado, b: ValorRotulado) => b.valor - a.valor || a.rotulo.localeCompare(b.rotulo, "pt-BR");

function ordenarSiglas(siglas: Iterable<string>): string[] {
  return [...new Set(siglas)].sort((a, b) =>
    (ORDEM_APOIADAS.get(a) ?? 99) - (ORDEM_APOIADAS.get(b) ?? 99) || a.localeCompare(b, "pt-BR"));
}

/** Data mais recente de crédito recebido (o "Atualizado em" do BI). */
export function ultimaData(d: DadosOrcamento): string | null {
  let max: string | null = null;
  for (const r of d.recebido) if (!max || r.data > max) max = r.data;
  return max;
}

export function opcoesND(d: DadosOrcamento): OpcaoND[] {
  const nomes = new Map<string, string>();
  for (const r of [...d.recebido, ...d.disponivel]) if (r.nd && !nomes.get(r.nd)) nomes.set(r.nd, r.ndNome);
  for (const e of d.empenhos) if (e.nd && !nomes.has(e.nd)) nomes.set(e.nd, "");
  return [...nomes].map(([codigo, nome]) => ({ codigo, nome })).sort((a, b) => a.codigo.localeCompare(b.codigo));
}

/** Data de hoje em Manaus (AAAA-MM-DD). */
export function hojeEmManaus(agora = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Manaus", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(agora);
}

/** Dias corridos entre duas datas AAAA-MM-DD. */
export const diasEntre = (de: string, ate: string) => Math.round((Date.parse(ate) - Date.parse(de)) / 864e5);

// Saldo e crédito se ligam pela UG responsável, PI e ND (as 27 linhas de saldo de 20/10/2026 casaram assim).
const chaveDaLinha = (x: { ug: string; ugNome: string; pi: string; nd: string }) => `${x.ug || x.ugNome}|${x.pi}|${x.nd}`;

/** Créditos recebidos (só os positivos) por UG + PI + ND, do mais novo para o mais antigo. */
export function creditosPorLinha(recebido: LinhaRecebido[]): Map<string, LinhaRecebido[]> {
  const m = new Map<string, LinhaRecebido[]>();
  for (const r of recebido) {
    if (r.valor <= 0) continue;
    const k = chaveDaLinha(r);
    if (!m.has(k)) m.set(k, []);
    m.get(k)!.push(r);
  }
  for (const lista of m.values()) lista.sort((a, b) => b.data.localeCompare(a.data));
  return m;
}

/**
 * Há quanto tempo chegou o crédito que forma o saldo. Os empenhos gastam primeiro o crédito mais
 * antigo, então o saldo é a parte mais nova do que chegou: soma os créditos do mais novo para o mais
 * antigo até cobrir o saldo, e a idade é a do último crédito somado.
 */
export function idadeDoSaldo(saldo: number, creditos: LinhaRecebido[] | undefined, hoje: string): IdadeCredito | null {
  if (!creditos?.length || saldo <= 0) return null;
  let acumulado = 0;
  let desde = creditos[0].data;
  for (const c of creditos) {
    acumulado += c.valor;
    desde = c.data;
    if (acumulado >= saldo - 0.005) break;
  }
  return { desde, dias: Math.max(0, diasEntre(desde, hoje)), ultimo: creditos[0].data, parcial: acumulado < saldo - 0.005 };
}

const notaDe = (r: LinhaRecebido): NotaCredito =>
  ({ nc: r.nc ?? "", data: r.data, valor: r.valor, obs: r.obs ?? "", pi: r.pi, piNome: r.piNome, nd: r.nd });

/** Junta as linhas da mesma nota de crédito (uma nota pode vir em várias linhas). */
function juntarNotas(linhas: LinhaRecebido[]): NotaCredito[] {
  const m = new Map<string, NotaCredito>();
  linhas.forEach((r, i) => {
    const k = r.nc ? `${r.nc}|${r.pi}|${r.nd}` : `#${i}`;
    const n = m.get(k);
    if (n) n.valor += r.valor;
    else m.set(k, notaDe(r));
  });
  return [...m.values()];
}

/**
 * Notas de crédito que ainda formam o saldo, pela mesma regra da idade: o saldo é a parte mais nova do
 * que chegou, então soma as notas da mais nova para a mais antiga até cobrir o saldo. A última nota
 * somada pode estar em parte empenhada (`noSaldo` menor que o valor).
 */
export function notasDoSaldo(saldo: number, creditos: LinhaRecebido[] | undefined): NotaNoSaldo[] {
  if (!creditos?.length || saldo <= 0) return [];
  const out: NotaNoSaldo[] = [];
  let falta = saldo;
  for (const n of juntarNotas(creditos)) {
    const parte = Math.min(n.valor, falta);
    out.push({ ...n, noSaldo: Math.round(parte * 100) / 100 });
    falta -= parte;
    if (falta <= 0.005) break;
  }
  return out;
}

/** Linhas do tooltip: do crédito que chegou há menos tempo para o mais antigo; sem idade no fim; empate pelo maior saldo. */
export function ordemDoTooltip(a: LinhaSaldo, b: LinhaSaldo): number {
  const da = a.idade?.dias ?? Infinity, db = b.idade?.dias ?? Infinity;
  return da === db ? b.valor - a.valor : da - db;
}

/** Agrupa o saldo disponível por unidade, com posição (empates dividem a posição, como o RANKX DENSE). */
export function disponivelPorUnidade(
  linhas: LinhaDisponivel[],
  recebidoNoDia: Map<string, number>,
  creditos: Map<string, LinhaRecebido[]> = new Map(),
  hoje = hojeEmManaus(),
): UnidadeDisponivel[] {
  const grupos = new Map<string, LinhaSaldo[]>();
  for (const l of linhas) {
    const nome = l.sigla ?? (l.ugNome || "Unidade não cadastrada");
    if (!grupos.has(nome)) grupos.set(nome, []);
    const doSaldo = creditos.get(chaveDaLinha(l));
    grupos.get(nome)!.push({ ...l, idade: idadeDoSaldo(l.valor, doSaldo, hoje), notas: notasDoSaldo(l.valor, doSaldo) });
  }
  const lista = [...grupos].map(([sigla, ls]) => ({
    sigla, logo: logoDa(sigla), valor: ls.reduce((s, l) => s + l.valor, 0),
    recebidoUltimoDia: recebidoNoDia.has(sigla) ? recebidoNoDia.get(sigla)! : null,
    linhas: [...ls].sort(ordemDoTooltip),
  }));
  lista.sort((a, b) => b.valor - a.valor || a.sigla.localeCompare(b.sigla, "pt-BR"));
  const valores = [...new Set(lista.map((u) => u.valor))];
  return lista.map((u) => ({ ...u, rank: valores.indexOf(u.valor) + 1 }));
}

/**
 * Empenhado pelo SIAFI (planilha de situação: valor atual de cada NE). É o que fecha com o crédito: recebido −
 * empenhado = disponível. A planilha de NE do Tesouro Gerencial chega cortada quando traz os anos anteriores
 * (em 24/11/2026: ordenada pelo texto da data, parou no dia 24 e perdeu 316 NEs de 2026, R$ 6,25 mi).
 * A situação não traz a ND: com o filtro de ND, vale a ND da NE na planilha de NE; a NE que só está na situação
 * entra pela parte do crédito daquela UG e PI que o SIAFI deu como consumida naquela ND.
 */
export function empenhadoSiafi(d: DadosOrcamento, f: FiltroCredito, ano: number | null): number {
  const sit = (d.situacao ?? []).filter((e) => (ano === null || e.ne.startsWith(String(ano))) && (!f.om || e.sigla === f.om));
  if (!f.nd) return sit.reduce((s, e) => s + e.valor, 0);
  const ndDaNE = new Map<string, string>();
  for (const e of d.empenhos) { const m = /(\d{4}NE\d{6})\s*$/i.exec(e.ne); if (m) ndDaNE.set(m[1].toUpperCase(), e.nd); }
  const grupo = (x: { ug: string; pi: string }) => `${x.ug}|${x.pi}`;
  let total = 0;
  const semND = new Map<string, number>();
  const conhecido = new Map<string, number>(); // UG|PI|ND
  for (const e of sit) {
    const nd = ndDaNE.get(e.ne);
    if (nd === undefined) { semND.set(grupo(e), (semND.get(grupo(e)) ?? 0) + e.valor); continue; }
    conhecido.set(`${grupo(e)}|${nd}`, (conhecido.get(`${grupo(e)}|${nd}`) ?? 0) + e.valor);
    if (nd === f.nd) total += e.valor;
  }
  if (!semND.size) return total;
  // consumido segundo o SIAFI em cada UG|PI|ND = recebido − disponível; o que falta explicar vai para as NEs sem ND
  const consumido = new Map<string, number>();
  for (const r of d.recebido) if (ano === null || r.data.startsWith(String(ano))) {
    const k = `${grupo(r)}|${r.nd}`; consumido.set(k, (consumido.get(k) ?? 0) + r.valor);
  }
  for (const l of d.disponivel) { const k = `${grupo(l)}|${l.nd}`; consumido.set(k, (consumido.get(k) ?? 0) - l.valor); }
  const falta = new Map<string, Map<string, number>>(); // grupo → ND → falta
  for (const [k, v] of consumido) {
    const [ug, pi, nd] = k.split("|");
    const g = `${ug}|${pi}`;
    if (!semND.has(g)) continue;
    const resto = Math.max(0, v - (conhecido.get(k) ?? 0));
    if (!falta.has(g)) falta.set(g, new Map());
    falta.get(g)!.set(nd, resto);
  }
  for (const [g, valor] of semND) {
    const porND = falta.get(g);
    const soma = porND ? [...porND.values()].reduce((s, v) => s + v, 0) : 0;
    if (soma > 0) total += valor * ((porND!.get(f.nd) ?? 0) / soma);
  }
  return Math.round(total * 100) / 100;
}

export function montarPainel(d: DadosOrcamento, f: FiltroCredito, hoje = hojeEmManaus()): PainelCredito {
  const atualizadoEm = ultimaData(d);
  const ano = atualizadoEm ? Number(atualizadoEm.slice(0, 4)) : null;
  const doAno = <T extends { data: string }>(x: T) => ano === null || x.data.startsWith(String(ano));
  const daND = (x: { nd: string }) => !f.nd || x.nd === f.nd;
  const daOM = (x: { sigla: string | null }) => !f.om || x.sigla === f.om;

  const recebidoND = d.recebido.filter((r) => doAno(r) && daND(r));
  const recebidoFiltrado = recebidoND.filter(daOM);
  const empenhosFiltrados = d.empenhos.filter((e) => doAno(e) && daND(e) && daOM(e));

  const recebido = recebidoFiltrado.reduce((s, r) => s + r.valor, 0);
  const empenhado = d.situacao?.length ? empenhadoSiafi(d, f, ano) : empenhosFiltrados.reduce((s, e) => s + e.valor, 0);

  // Faixa: todas as apoiadas (inclusive as sem crédito), maior para menor; só a ND filtra.
  const porSiglaND = somarPor(recebidoND.filter((r) => r.sigla), (r) => r.sigla!, (r) => r.valor);
  const faixa: CartaoUnidade[] = APOIADAS
    .map((a) => ({ sigla: a.sigla, logo: a.logo, valor: porSiglaND.get(a.sigla) ?? 0 }))
    .sort((a, b) => b.valor - a.valor);

  const porMes = [...somarPor(recebidoFiltrado, (r) => r.data.slice(5, 7), (r) => r.valor)]
    .map(([mm, valor]) => ({ rotulo: MESES_CURTOS[Number(mm) - 1], valor }))
    .sort(decrescente);

  const porPI = [...somarPor(empenhosFiltrados, (e) => e.piNome || "(em branco)", (e) => e.valor)]
    .map(([rotulo, valor]) => ({ rotulo, valor }))
    .filter((x) => x.valor !== 0)
    .sort(decrescente);

  const semSigla = new Set(recebidoFiltrado.filter((r) => !r.sigla).map((r) => r.ugNome));
  const porOM = [...somarPor(recebidoFiltrado, (r) => r.sigla ?? SEM_SIGLA, (r) => r.valor)]
    .map(([rotulo, valor]): ValorRotulado => (
      rotulo === SEM_SIGLA ? { rotulo, valor, dica: [...semSigla].sort().join("\n") } : { rotulo, valor }))
    .filter((x) => x.valor !== 0)
    .sort(decrescente);

  // Lista de disponível: só a ND filtra. A linha verde do BI ("variação") passa a ser o crédito
  // recebido pela unidade no dia do último lançamento.
  const doUltimoDia = recebidoND.filter((r) => r.data === atualizadoEm && r.sigla);
  const recebidoNoDia = somarPor(doUltimoDia, (r) => r.sigla!, (r) => r.valor);
  const disponivelND = d.disponivel.filter(daND);
  const disponivel = disponivelPorUnidade(disponivelND, recebidoNoDia, creditosPorLinha(d.recebido), hoje);

  const disponivelSelecao = f.om ? disponivel.filter((u) => u.sigla === f.om).reduce((s, u) => s + u.valor, 0) : disponivelND.reduce((s, l) => s + l.valor, 0);
  return {
    hoje, ano, atualizadoEm, recebido, empenhado,
    disponivelSelecao,
    pctEmpenhado: recebido ? empenhado / recebido : null,
    faixa, porMes, porPI, porOM, disponivel,
    totalDisponivel: disponivelND.reduce((s, l) => s + l.valor, 0),
    opcoesOM: ordenarSiglas([...d.recebido, ...d.empenhos].map((x) => x.sigla).filter((s): s is string => !!s)),
    opcoesND: opcoesND(d),
  };
}
