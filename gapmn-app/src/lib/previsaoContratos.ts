/**
 * Previsão orçamentária de contratos — regras de cálculo (sem React).
 *
 * Valor mensal dos contratos contínuos (fixo e estimativo), regra do usuário:
 *   - com NE liquidada/paga: soma do liquidado/pago nas NEs do contrato, desde o
 *     início da vigência, ÷ meses do início da vigência até hoje
 *   - sem nada liquidado/pago ainda: valor do contrato ÷ meses de vigência
 *
 * O REGIME ainda separa:
 *   fixo        serviço contínuo com fatura mensal (limpeza, manutenção…): reajuste
 *               no aniversário da data-base
 *   estimativo  consumo variável (energia, água, telefonia, credenciamentos…): sem
 *               liquidação, o valor ÷ vigência vale só daqui para frente
 *   saldo       execução pontual (obras, aquisições): saldo a empenhar distribuído
 *               até o fim da vigência
 *   nao_prever  fora da previsão (contratos de receita, ou exclusão manual)
 *
 * O regime é deduzido do objeto do contrato e pode ser corrigido manualmente.
 *
 * Necessidade de crédito de um exercício, até o mês M:
 *     max(0, previsto acumulado no exercício até M − empenhado no exercício)
 * O acumulado começa em janeiro quando o PAG já existia antes do exercício (o
 * processo continua, mesmo que o instrumento atual tenha começado no meio do
 * ano — os empenhos do PAG cobrem também o antecessor); senão, no início do
 * contrato. Restos a pagar ficam de fora: pagam competências de exercícios
 * anteriores.
 */
import type { ExecucaoLinha } from "./gsheets";

// ─── Regimes ──────────────────────────────────────────────────────────────────

export type Regime = "fixo" | "estimativo" | "saldo" | "nao_prever";

export const REGIMES: Record<Regime, { rotulo: string; curto: string; icone: string; descricao: string }> = {
  fixo: {
    rotulo: "Parcela mensal fixa", curto: "Parcela fixa", icone: "📅",
    descricao: "Serviço contínuo com fatura mensal: liquidado/pago nas NEs ÷ meses desde o início da vigência; sem nada liquidado ainda, valor do contrato ÷ meses de vigência.",
  },
  estimativo: {
    rotulo: "Estimativo (consumo)", curto: "Estimativo", icone: "⚡",
    descricao: "Consumo variável (energia, água, telefonia, credenciamentos…): liquidado/pago nas NEs ÷ meses desde o início da vigência; sem nada liquidado ainda, valor ÷ vigência, só daqui para frente.",
  },
  saldo: {
    rotulo: "Saldo a empenhar", curto: "Saldo", icone: "🏗️",
    descricao: "Execução pontual (obras, aquisições): saldo a empenhar distribuído até o fim da vigência.",
  },
  nao_prever: {
    rotulo: "Não prever", curto: "Fora", icone: "⛔",
    descricao: "Fora da previsão (contratos de receita ou excluídos manualmente).",
  },
};

export const REGIME_LIST: Regime[] = ["fixo", "estimativo", "saldo", "nao_prever"];

// ─── Tipos de entrada ─────────────────────────────────────────────────────────

/** Campos do contrato usados na previsão (subconjunto de contratos_scon). */
export interface ContratoBase {
  id: string;
  numero_contrato: string;
  descricao: string | null;
  vl_contratual: number | null;
  vl_empenhado: number | null;
  vl_a_empenhar: number | null;
  data_inicio: string | null;
  data_final: string | null;
  data_orcamento: string | null;
  pag_nup: string | null;
  receita_despesa?: string | null;
  num_parcelas?: number | null;
  valor_parcela?: number | null;
}

/** Ajuste manual por contrato (tabela contratos_previsao, chave = número do contrato). */
export interface CfgPrevisao {
  numero_contrato: string;
  regime: Regime | null;        // null = automático
  valor_mensal: number | null;  // null = calculado
  observacao?: string | null;
  updated_nome?: string | null;
  updated_at?: string | null;
}

export interface OpcoesPrevisao {
  hoje: Date;
  reajustePct: number;          // reajuste anual estimado (%)
  suporProrrogacao: boolean;    // prevê continuidade após o fim da vigência
  /** planilha de execução ainda carregando ou com falha: sem empenhos conhecidos, nada
   *  de "parado" nem pendente — só valor ÷ vigência daqui para frente */
  execucaoIndisponivel?: boolean;
}

// ─── Meses ────────────────────────────────────────────────────────────────────
// Mês como índice inteiro: ano * 12 + (mês - 1). Evita Date e fuso horário.

export const mesIdx = (ano: number, mes: number) => ano * 12 + (mes - 1);
export const anoDe  = (mi: number) => Math.floor(mi / 12);
export const mesDe  = (mi: number) => (mi % 12) + 1;
export const mesHoje = (d: Date) => mesIdx(d.getFullYear(), d.getMonth() + 1);

const MESES_ABREV = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
export const rotuloMes = (mi: number) => `${MESES_ABREV[mesDe(mi) - 1]}/${String(anoDe(mi)).slice(2)}`;

export type Dia = { y: number; m: number; d: number };

function lerData(s: string | null | undefined): Dia | null {
  const r = /^(\d{4})-(\d{2})-(\d{2})/.exec(s ?? "");
  return r ? { y: +r[1], m: +r[2], d: +r[3] } : null;
}
const diasNoMes = (y: number, m: number) => new Date(y, m, 0).getDate();
function somaMeses(a: Dia, n: number): Dia {
  const t = a.y * 12 + (a.m - 1) + n;
  const y = Math.floor(t / 12), m = (t % 12) + 1;
  return { y, m, d: Math.min(a.d, diasNoMes(y, m)) };
}
const emDias = (a: Dia) => Date.UTC(a.y, a.m - 1, a.d) / 86400000;

/** Meses entre duas datas, com fração: 04/08→04/10 = 2; 18/08→19/10 = 2 + 1/31. */
function mesesEntre(a: Dia, b: Dia): number {
  if (emDias(b) <= emDias(a)) return 0;
  let n = (b.y - a.y) * 12 + (b.m - a.m);
  if (emDias(somaMeses(a, n)) > emDias(b)) n--;
  const c = somaMeses(a, n), prox = somaMeses(a, n + 1);
  return n + (emDias(b) - emDias(c)) / (emDias(prox) - emDias(c));
}

/** Duração em meses, com fração: 04/08/2026→04/08/2027 = 12; 18/08→19/10 = 2 + 1/31. */
export function mesesVigencia(ini: string | null, fim: string | null): number {
  const a = lerData(ini), b = lerData(fim);
  return a && b ? mesesEntre(a, b) : 0;
}

// ─── Histórico SIAFI por PAG ──────────────────────────────────────────────────

export interface ExecAno { empenhado: number; liquidado: number; aLiquidar: number; nNE: number }
export interface HistPag {
  anos: Map<number, ExecAno>;
  /** ano da NE mais antiga do PAG, contando também as inscritas em restos a pagar */
  primeiroAno: number;
  /** liquidado/pago por ano em que foi LIQUIDADO (não o ano da NE: a NE de dezembro
   *  paga faturas do ano seguinte como resto a pagar) */
  liqAno: Map<number, number>;
}
/** Restos a pagar de uma NE (planilha de RP): o que entra como liquidado/pago */
export interface RpLiquidacao {
  ne: string;
  processo: string;
  rp_nao_proc_liq_pag?: number;   // não processado, liquidado a pagar
  rp_nao_proc_pago?: number;      // não processado, pago
  rp_proc_a_pagar?: number;       // processado (liquidado no ano da NE), a pagar
  rp_proc_pagos?: number;         // processado, pago
}
/** PAG normalizado → histórico */
export type HistoricoPag = Map<string, HistPag>;

export const normPag = (p: string | null | undefined) => (p ?? "").trim().replace(/\s/g, "").toUpperCase();
const anoNE = (ne: string) => { const a = /^(\d{4})NE/i.exec(ne ?? "")?.[1]; return a ? +a : null; };

/**
 * Agrega a planilha de execução (uma linha por NE) por PAG e ano da NE, e o
 * liquidado/pago por ano de liquidação. Na execução, as NEs de anos anteriores trazem
 * só o que foi pago no próprio ano; o resto está nos restos a pagar: o processado foi
 * liquidado no ano da NE, o não processado liquidado/pago é do exercício corrente
 * (`anoAtual`, o da planilha de RP). As NEs de RP também datam o início do PAG: um
 * processo com RP de 2025 já existia antes de 2026.
 */
export function montarHistorico(linhas: ExecucaoLinha[], rps: RpLiquidacao[] = [], anoAtual = new Date().getFullYear()): HistoricoPag {
  const h: HistoricoPag = new Map();
  const doPag = (pag: string, ano: number) => {
    const x = h.get(pag) ?? { anos: new Map<number, ExecAno>(), primeiroAno: ano, liqAno: new Map<number, number>() };
    x.primeiroAno = Math.min(x.primeiroAno, ano);
    h.set(pag, x);
    return x;
  };
  const liquidou = (x: HistPag, ano: number, valor: number) => {
    if (valor) x.liqAno.set(ano, (x.liqAno.get(ano) ?? 0) + valor);
  };
  for (const l of linhas) {
    const pag = normPag(l.info_g), ano = anoNE(l.nota_empenho);
    if (!pag || ano === null) continue;
    const x = doPag(pag, ano);
    const a = x.anos.get(ano) ?? { empenhado: 0, liquidado: 0, aLiquidar: 0, nNE: 0 };
    a.aLiquidar += l.a_liquidar;
    a.liquidado += l.liquidado_pagar + l.pago;
    a.empenhado += l.a_liquidar + l.liquidado_pagar + l.pago;
    a.nNE++;
    x.anos.set(ano, a);
    liquidou(x, ano, l.liquidado_pagar + l.pago);
  }
  for (const rp of rps) {
    const pag = normPag(rp.processo), ano = anoNE(rp.ne);
    if (!pag || ano === null) continue;
    const x = doPag(pag, ano);
    liquidou(x, ano, (rp.rp_proc_a_pagar ?? 0) + (rp.rp_proc_pagos ?? 0));
    liquidou(x, anoAtual, (rp.rp_nao_proc_liq_pag ?? 0) + (rp.rp_nao_proc_pago ?? 0));
  }
  return h;
}

// ─── Classificação automática ─────────────────────────────────────────────────

const RX_RECEITA = /CESS[ÃA]O\s+DE\s+USO|ARRENDAMENTO|PERMISS[ÃA]O\s+DE\s+USO/i;
// Execução pontual: obra, reforma, aquisição de bens duráveis
// ("mão de obra" é termo de serviço contínuo, não de obra)
const RX_SALDO = /(?<!M[ÃA]O\s+DE\s+)\bOBRAS?\b|CONSTRU[ÇC][ÃA]O|CONSTRUIR|REFORMA|AMPLIA[ÇC][ÃA]O|DEMOLI[ÇC][ÃA]O|ADEQUA[ÇC][ÃA]O\s+D[AE]\s+INFRA|IMPLANTA[ÇC][ÃA]O|\bCERCA\b|AQUISI[ÇC][ÃA]O\s+DE\s+(BOMBAS|EQUIPAMENTOS|MOBILI|VE[ÍI]CULOS?|VIATURAS?|M[ÓO]VEIS)/i;
// Serviço público medido por consumo — prevalece sobre qualquer outro termo do objeto
const RX_UTILIDADE = /ENERGIA\s+EL[ÉE]TRICA|ESGOTO|SANEAMENTO|FORNECIMENTO\s+DE\s+[ÁA]GUA(?!\s+MINERAL)|TELEFONIA\s+FIX|\bSTFC\b/i;
// Manutenção por ordem de serviço: o valor do contrato é teto, não parcela
const RX_MANUT_DEMANDA = /SERVI[ÇC]O\s+CONTINUADO\s+COMUM\s+DE\s+ENGENHARIA|MANUTEN[ÇC][ÃA]O\s+(PREDIAL|DE\s+VIATURAS|DE\s+VE[ÍI]CULOS|DAS\s+EDIFICA)/i;
// Serviço contínuo com valor mensal definido. Vem antes da demanda variável:
// "manutenção dos equipamentos do posto de combustível" é parcela fixa.
const RX_FIXO = /LIMPEZA|CONSERVA[ÇC][ÃA]O|VIGIL[ÂA]NCIA|PORTARIA|RECEP[ÇC][ÃA]O|COPEIRAGEM|JARDINAGEM|MANUTEN[ÇC][ÃA]O|LOCA[ÇC][ÃA]O|OUTSOURCING|ENGENHARIA\s+CL[ÍI]NICA|RES[ÍI]DUOS|CONTROLE\s+DE\s+PRAGAS|DEDETIZA|DOSIMETRIA|SERVI[ÇC]O\s+M[ÓO]VEL\s+PESSOAL|\bSMP\b|ASSINATURA|SOFTWARE|LICEN[ÇC]A|APOIO\s+ADMINISTRATIVO/i;
// Consumo ou demanda variável
const RX_ESTIMATIVO = /TELEFONIA|CORREIOS|\bEBCT\b|COMBUST[ÍI]VE|PASSAGE(M|NS)|CREDENCIAMENTO|SA[ÚU]DE\s+COMPLEMENTAR|ATIVIDADE\s+M[ÉE]DICA|LABORATORIA|QUIMIOTERAPIA|INTERNA[ÇC]|PUBLICA[ÇC](ÃO|ÕES|AO|OES)|EST[ÁA]GIO|AGENTE\s+DE\s+INTEGRA|LAVAGEM|REAGENTE|GASES\s+MEDICINAIS|G[ÁA]S\s+(LIQUEFEITO|DE\s+COZINHA)|\bGLP\b|[ÁA]GUA\s+MINERAL|AGRICULTURA\s+FAMILIAR|INSUMOS|G[ÊE]NEROS\s+ALIMENT|GERENCIAMENTO|ADMINISTRA[ÇC][ÃA]O\s+E\s+GER/i;

function trecho(rx: RegExp, s: string): string {
  return (rx.exec(s)?.[0] ?? "").trim().toUpperCase();
}

/** Regime deduzido do objeto e do número do contrato, com o motivo da escolha. */
export function classificarRegime(c: Pick<ContratoBase, "numero_contrato" | "descricao" | "receita_despesa">): { regime: Regime; motivo: string } {
  const num = (c.numero_contrato ?? "").trim();
  const obj = c.descricao ?? "";
  if (/^RECEITA\b/i.test(num) || /^receita$/i.test(c.receita_despesa ?? "")) return { regime: "nao_prever", motivo: "contrato de receita" };
  if (RX_RECEITA.test(obj)) return { regime: "nao_prever", motivo: `objeto de receita ("${trecho(RX_RECEITA, obj)}")` };
  if (RX_SALDO.test(obj)) return { regime: "saldo", motivo: `execução pontual ("${trecho(RX_SALDO, obj)}")` };
  if (RX_UTILIDADE.test(obj)) return { regime: "estimativo", motivo: `serviço público por consumo ("${trecho(RX_UTILIDADE, obj)}")` };
  if (RX_MANUT_DEMANDA.test(obj)) return { regime: "estimativo", motivo: `manutenção por ordem de serviço ("${trecho(RX_MANUT_DEMANDA, obj)}")` };
  if (RX_FIXO.test(obj)) return { regime: "fixo", motivo: `serviço contínuo ("${trecho(RX_FIXO, obj)}")` };
  if (RX_ESTIMATIVO.test(obj)) return { regime: "estimativo", motivo: `demanda variável ("${trecho(RX_ESTIMATIVO, obj)}")` };
  if (/^(CREDENCIAMENTO|CRED|ADES[ÃA]O)\b/i.test(num)) return { regime: "estimativo", motivo: `instrumento por demanda (${num.split(/\s/)[0].toUpperCase()})` };
  return { regime: "estimativo", motivo: "objeto não identificado — usando histórico do PAG" };
}

// ─── Projeção por contrato ────────────────────────────────────────────────────

export interface PrevisaoContrato {
  id: string;
  numero: string;
  regime: Regime;
  origem: "auto" | "manual";
  motivo: string;
  /** valor mensal de referência no mês atual (sem reajustes futuros) */
  mensal: number;
  /** como o valor mensal foi obtido, em texto para o usuário */
  base: string;
  alertas: string[];
  /** primeiro e último mês de competência do contrato (null = sem vigência válida) */
  inicioMi: number | null;
  fimMi: number | null;
  vencido: boolean;
  /** contratos do mesmo PAG e parcela deste (1 = sozinho no PAG) */
  pagContratos: number;
  /** previsto por mês de competência (já com reajuste e prorrogação, se ativos) */
  valorMes(mi: number): number;
  /** empenhado / liquidado / a liquidar do exercício (rateado no PAG compartilhado) */
  execAno(ano: number): ExecAno;
  /** primeiro mês considerado no acumulado do exercício */
  inicioExercicio(ano: number): number;
  /** primeira competência do exercício cuja fatura ainda não foi liquidada */
  primeiraAberta(ano: number): number;
}

/** Projeta todos os contratos. Contratos do mesmo PAG dividem o histórico pelo peso nominal. */
export function projetarContratos(
  contratos: ContratoBase[],
  historico: HistoricoPag,
  cfgs: Map<string, CfgPrevisao>,
  op: OpcoesPrevisao,
): Map<string, PrevisaoContrato> {
  const hojeMi = mesHoje(op.hoje);
  const ano0 = anoDe(hojeMi);
  const r = op.reajustePct / 100;
  const semExec = !!op.execucaoIndisponivel;

  // Vigência e valor nominal mensal de cada contrato (base do rateio no PAG)
  type Vig = { iniMi: number; n: number; frac: number; dur: number; nominal: number };
  const vig = new Map<string, Vig | null>();
  for (const c of contratos) {
    const dur = mesesVigencia(c.data_inicio, c.data_final);
    const a = lerData(c.data_inicio);
    if (!a || dur <= 0) { vig.set(c.id, null); continue; }
    const n = Math.max(1, Math.ceil(dur - 1e-9));
    vig.set(c.id, { iniMi: mesIdx(a.y, a.m), n, frac: dur - (n - 1), dur, nominal: (c.vl_contratual ?? 0) / dur });
  }
  const ativoNoMes = (v: Vig | null | undefined, mi: number) => !!v && mi >= v.iniMi && mi < v.iniMi + v.n;
  const mesesNoAno = (v: Vig | null | undefined, ano: number) => {
    if (!v) return 0;
    let k = 0;
    for (let mi = mesIdx(ano, 1); mi <= mesIdx(ano, 12); mi++) if (ativoNoMes(v, mi)) k++;
    return k;
  };

  // Grupos de PAG compartilhado
  const grupos = new Map<string, ContratoBase[]>();
  for (const c of contratos) {
    const p = normPag(c.pag_nup);
    if (p) (grupos.get(p) ?? grupos.set(p, []).get(p)!).push(c);
  }
  // Parcela do contrato no PAG em um ano: peso = nominal mensal × meses ativos no ano
  const parcelaCache = new Map<string, number>();
  function parcela(c: ContratoBase, ano: number): number {
    const g = grupos.get(normPag(c.pag_nup));
    if (!g || g.length < 2) return 1;
    const chave = `${c.id}|${ano}`;
    const cached = parcelaCache.get(chave);
    if (cached !== undefined) return cached;
    const peso = (x: ContratoBase) => (vig.get(x.id)?.nominal ?? 0) * mesesNoAno(vig.get(x.id), ano);
    let tot = g.reduce((s, x) => s + peso(x), 0);
    let p: number;
    if (tot > 0) p = peso(c) / tot;
    else {
      // nenhum contrato do grupo ativo no ano (antecessor): divide pelo nominal
      tot = g.reduce((s, x) => s + (vig.get(x.id)?.nominal ?? 0), 0);
      p = tot > 0 ? (vig.get(c.id)?.nominal ?? 0) / tot : 1 / g.length;
    }
    parcelaCache.set(chave, p);
    return p;
  }

  const fmt = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
  const out = new Map<string, PrevisaoContrato>();

  for (const c of contratos) {
    const v = vig.get(c.id) ?? null;
    const pag = normPag(c.pag_nup);
    const hist = pag ? historico.get(pag) : undefined;
    const cfg = cfgs.get(c.numero_contrato);
    const auto = classificarRegime(c);
    const regime: Regime = cfg?.regime ?? auto.regime;
    const origem: "auto" | "manual" = cfg?.regime ? "manual" : "auto";
    const motivo = cfg?.regime ? `definido manualmente${cfg.updated_nome ? ` por ${cfg.updated_nome}` : ""}` : auto.motivo;
    const alertas: string[] = [];
    const grupo = pag ? grupos.get(pag) : undefined;
    const pagContratos = grupo?.length ?? 1;

    const fimMi = v ? v.iniMi + v.n - 1 : null;
    const vencido = fimMi !== null && fimMi < hojeMi;
    // PAG "contínuo": já tinha empenhos antes do exercício, ou o contrato começou antes dele
    const pagContinuo = (hist ? hist.primeiroAno < ano0 : false) || (!!v && v.iniMi < mesIdx(ano0, 1));
    const execAno = (ano: number): ExecAno => {
      const e = hist?.anos.get(ano);
      if (!e) return { empenhado: 0, liquidado: 0, aLiquidar: 0, nNE: 0 };
      const p = parcela(c, ano);
      return { empenhado: e.empenhado * p, liquidado: e.liquidado * p, aLiquidar: e.aLiquidar * p, nNE: e.nNE };
    };
    // Piso do acumulado no exercício corrente: estimativo sem histórico conta só
    // daqui para frente (definido mais abaixo, depois de conhecer o histórico).
    // Sem a planilha de execução não se sabe o que já foi empenhado: idem para todos.
    let pisoExercicio = semExec ? hojeMi : -Infinity;
    const inicioExercicio = (ano: number) => {
      const jan = mesIdx(ano, 1);
      if (ano > ano0 || !v) return jan;
      return Math.max(pagContinuo ? jan : Math.max(jan, v.iniMi), pisoExercicio);
    };

    if (!v) alertas.push("Vigência inválida (início/fim) — sem previsão");
    if (pagContratos > 1) alertas.push(`PAG compartilhado por ${pagContratos} contratos — histórico rateado pelo valor mensal de cada um`);
    if (!pag) alertas.push("Sem PAG/NUP — não é possível ler os empenhos do SIAFI");
    else if (!hist && !semExec) alertas.push("PAG não encontrado na planilha de execução SIAFI");

    // ── Liquidado/pago nas NEs do contrato (regra do usuário) ──────────────
    // Valor mensal = liquidado/pago ÷ meses já faturados. A fatura do mês só é
    // liquidada no seguinte: a janela vai até o fim do mês retrasado. Contrato com
    // mais de 12 meses: só os últimos 12 (a fatura de hoje, com reajustes). O
    // liquidado é conhecido por ano de liquidação, e o liquidado num ano paga as
    // faturas de dezembro do ano anterior a novembro: cada ano entra na proporção
    // desses meses que caem na janela.
    const iniDia = lerData(c.data_inicio);
    const liq = (() => {
      const r0 = { total: 0, meses: 0, de: 0, ate: 0, jaLiquidou: false };
      if (!v || !iniDia || !hist || semExec) return r0;
      const instante = (d: Dia) => mesIdx(d.y, d.m) + (d.d - 1) / diasNoMes(d.y, d.m);
      const inicio = instante(iniDia);
      // O PAG já corria antes do início gravado quando: outro contrato do mesmo PAG
      // começou antes (o anterior); houve liquidação antes do ano de início (contrato
      // anterior fora da lista, ou prorrogação com o início do período atual gravado);
      // ou o PAG é de vários contratos e tem NE de ano anterior (ex.: energia, com dois
      // contratos novos no PAG que pagava o fornecimento anterior). Em PAG de um
      // contrato só, NE antiga sem liquidação antes do início é empenho prévio dele.
      const outroAntes = (grupo ?? []).some((x) => x.id !== c.id && (vig.get(x.id)?.iniMi ?? Infinity) < v.iniMi);
      const liqAntes = [...hist.liqAno].some(([a, val]) => a < iniDia.y && val > 0);
      const corriaAntes = outroAntes || liqAntes || (pagContratos > 1 && hist.primeiroAno < iniDia.y);
      const fimDia = lerData(c.data_final);
      let ate = hojeMi - 1;                       // início do mês passado = fim do retrasado
      if (fimDia) ate = Math.min(ate, instante(fimDia));
      // PAG de vários contratos: o rateio é por ano, então antes do início deste contrato
      // não dá para saber o que era dele — a janela começa no início
      const de = Math.max(corriaAntes && pagContratos < 2 ? -Infinity : inicio, ate - 12);
      r0.de = de; r0.ate = ate;
      r0.jaLiquidou = [...hist.liqAno].some(([a, val]) => (a >= iniDia.y || corriaAntes) && val > 0);
      if (ate - de <= 0) return r0;
      r0.meses = ate - de;
      for (const [ano, valor] of hist.liqAno) {
        if (valor <= 0) continue;
        // faturas pagas pelo liquidado do ano: de dezembro do ano anterior a novembro
        // (no exercício corrente, até o fim do mês retrasado); sem nada antes do
        // início, nunca antes dele
        let cIni = mesIdx(ano, 1) - 1;
        if (!corriaAntes) cIni = Math.max(cIni, inicio);
        const cFim = ano === ano0 ? hojeMi - 1 : mesIdx(ano, 12);
        if (cFim <= cIni) continue;
        const naJanela = Math.max(0, Math.min(cFim, ate) - Math.max(cIni, de));
        r0.total += valor * parcela(c, ano) * naJanela / (cFim - cIni);
      }
      return r0;
    })();

    // ── Valor mensal de referência ───────────────────────────────────────────
    let mensal = 0;
    let base = "";
    const manual = cfg?.valor_mensal ?? null;
    let saldoRestante = 0, mesesRestantes = 0;

    if (regime === "nao_prever") {
      base = REGIMES.nao_prever.descricao;
    } else if (manual !== null && regime !== "saldo") {
      mensal = manual;
      base = `Valor mensal informado manualmente: ${fmt(manual)}`;
    } else if (regime === "fixo" || regime === "estimativo") {
      const fmtMeses = (m: number) => (Math.abs(m - Math.round(m)) < 0.05 ? String(Math.round(m)) : m.toFixed(1).replace(".", ","));
      const dataBR = (d: Dia) => `${String(d.d).padStart(2, "0")}/${String(d.m).padStart(2, "0")}/${d.y}`;
      if (liq.total > 0.005 && liq.meses > 0 && iniDia) {
        // Já há NE liquidada/paga: o ritmo real do contrato
        mensal = liq.total / liq.meses;
        const ultimo = Math.ceil(liq.ate - 1e-9) - 1;
        const periodo = liq.meses >= 11.95
          ? `nos últimos 12 meses faturados (${rotuloMes(ultimo - 11)} a ${rotuloMes(ultimo)})`
          : `desde o início (${dataBR(iniDia)}) até ${rotuloMes(ultimo)}, último mês já faturado`;
        base = `Liquidado/pago nas NEs ${periodo}: ${fmt(liq.total)} ÷ ${fmtMeses(liq.meses)} ${liq.meses > 1.05 ? "meses" : "mês"} = ${fmt(mensal)}/mês`;
        if (pagContratos > 1) base += ` · parcela deste contrato no PAG: ${Math.round(parcela(c, ano0) * 100)}%`;
      } else if (v && (c.vl_contratual ?? 0) > 0) {
        // Nada liquidado/pago (na janela): o valor do contrato distribuído na vigência
        mensal = v.nominal;
        const divisao = `${fmt(c.vl_contratual ?? 0)} ÷ ${fmtMeses(v.dur)} meses de vigência = ${fmt(mensal)}/mês`;
        if (semExec) base = `Execução SIAFI indisponível — ${divisao} (provisório)`;
        else if (liq.meses <= 0) base = `Ainda sem mês faturado (a fatura sai no mês seguinte) — ${divisao}`;
        else if (liq.jaLiquidou) base = `Nada liquidado/pago nos últimos meses faturados — ${divisao}`;
        else base = `Nenhuma NE liquidada/paga ainda — ${divisao}`;
        // Consumo sem histórico: o valor é um teto, vale daqui para frente (sem cobrar
        // como pendentes os meses que já passaram)
        if (regime === "estimativo") pisoExercicio = hojeMi;
      } else {
        alertas.push("Sem nada liquidado/pago e sem valor do contrato — informe o valor mensal");
      }
    } else if (regime === "saldo") {
      saldoRestante = Math.max(0, c.vl_a_empenhar ?? ((c.vl_contratual ?? 0) - (c.vl_empenhado ?? 0)));
      // peso de cada mês restante; o último pode ser parcial
      if (v && fimMi !== null) {
        for (let mi = Math.max(hojeMi, v.iniMi); mi <= fimMi; mi++) mesesRestantes += mi === fimMi ? v.frac : 1;
      }
      // valor exibido por mês: ao menos um mês inteiro (vigência acabando em poucos dias
      // concentra o saldo no último mês, sem inflar o valor "mensal")
      mensal = mesesRestantes > 0 ? saldoRestante / Math.max(1, mesesRestantes) : 0;
      base = mesesRestantes > 0
        ? `Saldo a empenhar ${fmt(saldoRestante)} distribuído até o fim da vigência (${Math.max(1, Math.ceil(mesesRestantes - 1e-9))} ${Math.ceil(mesesRestantes - 1e-9) > 1 ? "meses" : "mês"})`
        : saldoRestante > 0 ? `Saldo a empenhar ${fmt(saldoRestante)} com vigência encerrada` : "Sem saldo a empenhar";
      if (saldoRestante > 0 && mesesRestantes === 0) alertas.push("Saldo a empenhar com vigência encerrada");
    }

    // ── Previsto por mês de competência ──────────────────────────────────────
    const baseReajuste = lerData(c.data_orcamento);
    const valorMes = (mi: number): number => {
      if (regime === "nao_prever" || !v || mensal <= 0) return 0;
      if (regime === "saldo") {
        if (mi < hojeMi || mi < v.iniMi || fimMi === null || mi > fimMi || mesesRestantes <= 0) return 0;
        return saldoRestante * (mi === fimMi ? v.frac : 1) / mesesRestantes;
      }
      const dentro = ativoNoMes(v, mi);
      const prorrogado = !dentro && op.suporProrrogacao && fimMi !== null && mi > fimMi;
      // antecessor no mesmo PAG cobre os meses do exercício antes do início do contrato
      const antecessor = !dentro && pagContinuo && mi < v.iniMi && anoDe(mi) === ano0 && mi >= mesIdx(ano0, 1);
      if (!dentro && !prorrogado && !antecessor) return 0;
      let val = mensal;
      if (dentro && fimMi !== null && mi === fimMi && !op.suporProrrogacao) val *= v.frac;
      // Reajuste: parcela fixa no aniversário da data-base (ou do início, na prorrogação);
      // estimativo a cada novo exercício
      if (regime === "fixo") {
        const ref = baseReajuste ? mesIdx(baseReajuste.y, baseReajuste.m) : prorrogado ? v.iniMi : null;
        if (ref !== null && mi >= ref + 12) val *= Math.pow(1 + r, Math.floor((mi - ref) / 12));
      } else if (anoDe(mi) > ano0) {
        val *= Math.pow(1 + r, anoDe(mi) - ano0);
      }
      return val;
    };

    // ── Competências já liquidadas no exercício ──────────────────────────────
    // O liquidado do ano paga as faturas em ordem. Fatura com ao menos metade do previsto
    // conta como paga (a primeira costuma ser proporcional, há glosas); essas competências
    // valem o que foi liquidado. O mês corrente ainda não foi faturado.
    let abertaAno0 = inicioExercicio(ano0);
    let restoLiq = execAno(ano0).liquidado;
    while (abertaAno0 < hojeMi) {
      const fatura = valorMes(abertaAno0);
      if (fatura > 0 && restoLiq < fatura * 0.5) break;
      restoLiq -= fatura;
      abertaAno0++;
    }
    const primeiraAberta = (ano: number) => (ano === ano0 ? abertaAno0 : inicioExercicio(ano));

    if (vencido && !op.suporProrrogacao && regime !== "nao_prever") alertas.push("Vigência encerrada — sem previsão para os próximos meses");
    // Contrato em vigor sem nenhum empenho no exercício: a previsão continua, mas
    // pode ser contrato substituído ou empenhado em outro PAG
    if ((regime === "fixo" || regime === "estimativo") && manual === null && v && !vencido && pag && !semExec
        && hojeMi - Math.max(mesIdx(ano0, 1), v.iniMi) >= 2 && execAno(ano0).empenhado === 0) {
      const principal = /PAG\s+PRINCIPAL\s+(?:DE\s+)?N\D{0,3}\s*([\d.]+\/\d{4}-\d{2})/i.exec(c.descricao ?? "")?.[1];
      const empPrincipal = principal ? historico.get(normPag(principal))?.anos.get(ano0)?.empenhado ?? 0 : 0;
      alertas.push(empPrincipal > 0
        ? `Sem empenho no próprio PAG em ${ano0}; o PAG principal ${principal} tem ${fmt(empPrincipal)} empenhados — os empenhos devem estar lá. Informe o valor mensal deste contrato se quiser prevê-lo.`
        : `Nenhum empenho em ${ano0} até agora — confirme se o contrato ainda é executado (se foi substituído, marque "Não prever")`);
    }

    out.set(c.id, {
      id: c.id, numero: c.numero_contrato, regime, origem, motivo, mensal, base, alertas,
      inicioMi: v?.iniMi ?? null, fimMi, vencido, pagContratos,
      valorMes, execAno, inicioExercicio, primeiraAberta,
    });
  }
  return out;
}

// ─── Necessidade de crédito num período ──────────────────────────────────────

export interface MesPrevisto { mi: number; previsto: number; necessidade: number }

export interface Necessidade {
  meses: MesPrevisto[];         // de `deMi` a `ateMi`
  /** crédito que faltou em competências já passadas do exercício corrente */
  pendente: number;
  /** pendente + necessidade dos meses do período */
  total: number;
  previstoPeriodo: number;
  /** último mês do exercício corrente já liquidado ou coberto pelo saldo empenhado (null = nenhum) */
  cobertoAte: number | null;
  /** saldo a liquidar do exercício corrente além das faturas previstas até dezembro */
  excedente: number;
}

/**
 * Necessidade de crédito de `deMi` (normalmente o mês atual) a `ateMi`.
 * Em cada exercício: max(0, faturas ainda não liquidadas − saldo a liquidar dos empenhos
 * do ano). As competências já liquidadas valem o que foi pago, não a previsão. A
 * necessidade do mês é o quanto esse valor cresce de um mês para o outro.
 */
export function calcularNecessidade(p: PrevisaoContrato, deMi: number, ateMi: number): Necessidade {
  const meses: MesPrevisto[] = [];
  for (let mi = deMi; mi <= ateMi; mi++) meses.push({ mi, previsto: p.valorMes(mi), necessidade: 0 });
  const porMi = new Map(meses.map((m) => [m.mi, m]));
  const ano0 = anoDe(deMi);
  let pendente = 0, cobertoAte: number | null = null, excedente = 0;

  if (p.regime === "saldo" || p.regime === "nao_prever") {
    for (const m of meses) m.necessidade = m.previsto;
  } else {
    for (let ano = ano0; ano <= anoDe(ateMi); ano++) {
      // saldo dos empenhos do ano ainda não liquidado: paga as próximas faturas
      const saldo = p.execAno(ano).aLiquidar;
      const ini = p.primeiraAberta(ano);
      const fimAno = mesIdx(ano, 12);
      if (ano === ano0 && ini > p.inicioExercicio(ano)) cobertoAte = ini - 1;  // já liquidadas
      let acum = 0, necAnt = 0;
      for (let mi = ini; mi <= fimAno; mi++) {
        const valor = p.valorMes(mi);
        acum += valor;
        const nec = Math.max(0, acum - saldo);
        if (ano === ano0 && valor > 0 && acum <= saldo + 0.005) cobertoAte = mi;
        if (mi < deMi) pendente = nec;
        else if (mi <= ateMi) { const m = porMi.get(mi); if (m) m.necessidade = nec - necAnt; }
        necAnt = nec;
      }
      if (ano === ano0) excedente = Math.max(0, saldo - acum);
    }
  }
  const previstoPeriodo = meses.reduce((s, m) => s + m.previsto, 0);
  const total = pendente + meses.reduce((s, m) => s + m.necessidade, 0);
  return { meses, pendente, total, previstoPeriodo, cobertoAte, excedente };
}
