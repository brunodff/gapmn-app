// Execução dos contratos pelas notas de empenho do SIAFI: a fonte ÚNICA dos valores de cada contrato
// (empenhado, a liquidar, liquidado a pagar, pago, a empenhar). Cartões da lista, Dados Gerais, aba
// Execução e previsão usam estas funções — os valores financeiros importados do SILOMS não entram mais.
// Funções puras (sem React nem rede), testadas em execucao.test.ts.
//
// De onde vêm os valores de cada NE:
//  - planilha "Situação de empenhos": todas as NEs de 2021 em diante, uma linha por NE, com o que está a
//    liquidar, liquidado a pagar e pago NO EXERCÍCIO DA NE;
//  - planilha de restos a pagar (exercício corrente): o que a NE de ano anterior ainda tem em RP.
// As duas partes se completam: no fim do ano o que não foi pago vai para RP. Limite conhecido: o RP de NE
// de 2024 ou antes que foi pago ou cancelado em 2025 não está em nenhuma das duas planilhas, então o
// empenhado dessas NEs sai a menor (o a liquidar e o liquidado a pagar de hoje estão completos).
//
// Qual NE é de qual contrato. O PAG é do processo, e um processo pode ter vários contratos (atas de
// laboratório, pares de energia demanda/consumo, contrato anterior e atual):
//  1. a NE cita o número do contrato na descrição ("CONTRATO: DESPESA 055/GAPMN-DACTAIV/2024") → esse
//     contrato, mesmo que a NE esteja em outro PAG;
//  2. a NE cita outro contrato, que não é nenhum dos do PAG → fica fora (é de outro contrato do processo);
//  3. PAG de um contrato só → esse contrato;
//  4. PAG de vários contratos → o do mesmo fornecedor (CNPJ); se sobrar mais de um, a NE fica sem contrato
//     e aparece como aviso nos candidatos — não entra em total nenhum, para não ser contada duas vezes.

import { chavePAG } from "../execucao/empenhos.ts";

// ─── Entradas (formato dos leitores de gsheets.ts) ──────────────────────────

/** Linha da planilha "Situação de empenhos" (toExecucaoLinhas). */
export type LinhaSituacao = {
  nota_empenho: string;
  pi?: string;
  unidade?: string;
  info_d: string;  // código do favorecido
  info_e: string;  // nome do favorecido
  info_f: string;  // descrição da NE
  info_g: string;  // PAG
  a_liquidar: number;
  liquidado_pagar: number;
  pago: number;
};

/** Linha da planilha de restos a pagar por NE (toRPNEs). */
export type LinhaRP = {
  ne: string;
  processo: string;
  favorecido_codigo?: string;
  favorecido: string;
  descricao: string;
  pi?: string;
  ugr_nome?: string;
  rp_nao_proc_a_liq: number;
  rp_nao_proc_liq_pag: number;
  rp_nao_proc_pago: number;
  rp_proc_a_pagar: number;
  rp_proc_pagos: number;
};

/** Campos do contrato usados no vínculo (subconjunto de contratos_scon). */
export type ContratoVinculo = {
  id: string;
  numero_contrato: string;
  pag_nup: string | null;
  cnpj: string | null;
};

// ─── NE com situação e restos a pagar ───────────────────────────────────────

export type Valores = { aLiquidar: number; liquidadoPagar: number; pago: number };

/** Restos a pagar da NE no exercício corrente, por conta. */
export type RestosNE = {
  naoProcALiquidar: number;
  naoProcLiquidadoPagar: number;
  naoProcPago: number;
  procAPagar: number;
  procPago: number;
};

export type NotaContrato = {
  /** "2026NE000123" */
  ne: string;
  ano: number;
  pag: string;
  pagChave: string | null;
  favorecidoCodigo: string;
  favorecidoNome: string;
  descricao: string;
  pi: string;
  unidade: string;
  /** No exercício da NE (planilha de situação). */
  exercicio: Valores;
  /** Restos a pagar no exercício corrente (null = a NE não tem RP). */
  rp: RestosNE | null;
  /** exercicio + rp, por tipo */
  aLiquidar: number;
  liquidadoPagar: number;
  pago: number;
  empenhado: number;
};

const NE = /(\d{4})NE(\d+)/i;
/** "120630000012026NE000242" ou "2026NE242" → "2026NE000242". */
export function neCanonica(v: string): string | null {
  const m = NE.exec(v ?? "");
  return m ? `${m[1]}NE${m[2].padStart(6, "0").slice(-6)}` : null;
}

const rpValores = (r: RestosNE): Valores => ({
  aLiquidar: r.naoProcALiquidar,
  liquidadoPagar: r.naoProcLiquidadoPagar + r.procAPagar,
  pago: r.naoProcPago + r.procPago,
});

function fechar(n: Omit<NotaContrato, "aLiquidar" | "liquidadoPagar" | "pago" | "empenhado">): NotaContrato {
  const r = n.rp ? rpValores(n.rp) : { aLiquidar: 0, liquidadoPagar: 0, pago: 0 };
  const aLiquidar = n.exercicio.aLiquidar + r.aLiquidar;
  const liquidadoPagar = n.exercicio.liquidadoPagar + r.liquidadoPagar;
  const pago = n.exercicio.pago + r.pago;
  return { ...n, aLiquidar, liquidadoPagar, pago, empenhado: aLiquidar + liquidadoPagar + pago };
}

/** Junta as duas planilhas: uma NotaContrato por NE. */
export function juntarNEs(situacao: readonly LinhaSituacao[], rps: readonly LinhaRP[] = []): Map<string, NotaContrato> {
  type Bruta = Omit<NotaContrato, "aLiquidar" | "liquidadoPagar" | "pago" | "empenhado">;
  const m = new Map<string, Bruta>();
  for (const l of situacao) {
    const ne = neCanonica(l.nota_empenho);
    if (!ne) continue;
    const x = m.get(ne);
    if (x) {
      x.exercicio.aLiquidar += l.a_liquidar || 0;
      x.exercicio.liquidadoPagar += l.liquidado_pagar || 0;
      x.exercicio.pago += l.pago || 0;
      continue;
    }
    m.set(ne, {
      ne, ano: Number(ne.slice(0, 4)),
      pag: (l.info_g ?? "").trim(), pagChave: chavePAG(l.info_g),
      favorecidoCodigo: (l.info_d ?? "").trim(), favorecidoNome: (l.info_e ?? "").trim(),
      descricao: (l.info_f ?? "").trim(), pi: (l.pi ?? "").trim(), unidade: (l.unidade ?? "").trim(),
      exercicio: { aLiquidar: l.a_liquidar || 0, liquidadoPagar: l.liquidado_pagar || 0, pago: l.pago || 0 },
      rp: null,
    });
  }
  for (const r of rps) {
    const ne = neCanonica(r.ne);
    if (!ne) continue;
    const rp: RestosNE = {
      naoProcALiquidar: r.rp_nao_proc_a_liq || 0, naoProcLiquidadoPagar: r.rp_nao_proc_liq_pag || 0,
      naoProcPago: r.rp_nao_proc_pago || 0, procAPagar: r.rp_proc_a_pagar || 0, procPago: r.rp_proc_pagos || 0,
    };
    let x = m.get(ne);
    if (!x) {
      // NE só no RP (sem linha na situação): os dados de identificação vêm da planilha de RP
      x = {
        ne, ano: Number(ne.slice(0, 4)),
        pag: (r.processo ?? "").trim(), pagChave: chavePAG(r.processo),
        favorecidoCodigo: (r.favorecido_codigo ?? "").trim(), favorecidoNome: (r.favorecido ?? "").trim(), descricao: (r.descricao ?? "").trim(),
        pi: (r.pi ?? "").trim(), unidade: (r.ugr_nome ?? "").trim(),
        exercicio: { aLiquidar: 0, liquidadoPagar: 0, pago: 0 }, rp: null,
      };
      m.set(ne, x);
    }
    const a = x.rp;
    x.rp = a
      ? {
          naoProcALiquidar: a.naoProcALiquidar + rp.naoProcALiquidar, naoProcLiquidadoPagar: a.naoProcLiquidadoPagar + rp.naoProcLiquidadoPagar,
          naoProcPago: a.naoProcPago + rp.naoProcPago, procAPagar: a.procAPagar + rp.procAPagar, procPago: a.procPago + rp.procPago,
        }
      : rp;
  }
  const out = new Map<string, NotaContrato>();
  for (const [k, v] of m) out.set(k, fechar(v));
  return out;
}

// ─── Número do contrato e citações na descrição da NE ───────────────────────

const semAcento = (s: string) => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase();

/** Unidade do número sem o GAP-MN e sem o "CIN" de CINDACTA: "GAPMN-CINDACTA IV" → "DACTAIV". */
export function unidadeNorm(s: string): string {
  return semAcento(s).replace(/[^A-Z]/g, "").replace(/^GAP(MN)?/, "").replace(/^CIN/, "");
}

export type ChaveContrato = { num: number; ano: number; unidade: string };

/** "DESPESA 055/GAPMN-DACTAIV/2024" → { num: 55, ano: 2024, unidade: "DACTAIV" }; "CREDENCIAMENTO 001/2021" → unidade "". */
export function chaveContrato(numero: string): ChaveContrato | null {
  const s = semAcento(numero).trim();
  const m = /(\d+)\s*\/\s*(?:(.*?)\s*\/+\s*)?(\d{4})\s*$/.exec(s);
  if (!m) return null;
  return { num: Number(m[1]), ano: Number(m[3]), unidade: unidadeNorm(m[2] ?? "") };
}

export type Citacao = ChaveContrato & { /** precedida de "contrato", "despesa", "adesão"… (e não de ofício, pregão, processo) */ forte: boolean };

const RX_CITACAO = /(?<![\d./])0*(\d{1,10})\s*\/\s*(?:([A-Z][A-Z0-9 .ºª°-]{0,30}?)\s*\/+\s*)?(\d{4})(?![\d/])/g;
const RX_PALAVRA_CONTRATO = /CONTRAT|DESPESA|ADESAO|CREDENC|\bCRED\b|\bCTR?\b|ACORDO|TERMO/g;
const RX_PALAVRA_OUTRA = /OFICIO|\bOF\b|PREGAO|\bPE\b|PROCESSO|\bNUP\b|\bPAG\b|DISPENSA|INEXIG|\bREQ\b|\bMSG\b|SIGAD|MEMORANDO|\bDIEX\b|PEDIDO|\bNC\b|\bREF\b/g;
const ultimo = (rx: RegExp, s: string) => { let i = -1; for (const m of s.matchAll(rx)) i = m.index ?? i; return i; };

/** Números de contrato citados no texto da NE ("CONTRATO: DESPESA 055/GAPMN-DACTAIV/2024"). */
export function citacoes(texto: string): Citacao[] {
  const s = semAcento(texto);
  const out: Citacao[] = [];
  for (const m of s.matchAll(RX_CITACAO)) {
    const ano = Number(m[3]);
    if (ano < 2000 || ano > 2039) continue; // "OFICIO 255/SDRS/7312", telefones
    const antes = s.slice(Math.max(0, (m.index ?? 0) - 60), m.index);
    const forte = ultimo(RX_PALAVRA_CONTRATO, antes) > ultimo(RX_PALAVRA_OUTRA, antes);
    out.push({ num: Number(m[1]), ano, unidade: unidadeNorm(m[2] ?? ""), forte });
  }
  return out;
}

/** A citação é deste contrato? Número longo (adesão) basta; senão número, ano e unidade compatível. */
function citacaoBate(c: Citacao, k: ChaveContrato, exigirUnidade: boolean): boolean {
  if (c.num !== k.num) return false;
  if (k.num >= 100000) return true; // "ADESÃO 1005321248/…": número único, o ano e a unidade variam na escrita
  if (c.ano !== k.ano) return false;
  if (!exigirUnidade) return true;
  // sem unidade dos dois lados ("037/GAPMN/2024", "CREDENCIAMENTO 001/2021") o número se repete entre
  // unidades: só vale entre os contratos do mesmo PAG
  if (!c.unidade || !k.unidade) return false;
  return c.unidade.includes(k.unidade) || k.unidade.includes(c.unidade);
}

// ─── Vínculo NE → contrato ──────────────────────────────────────────────────

export type MotivoVinculo =
  | "cita o contrato"
  | "PAG do contrato"
  | "mesmo fornecedor no PAG"
  | "cita outro contrato"
  | "PAG compartilhado"
  | "sem contrato";

export type Vinculo = {
  contratoId: string | null;
  motivo: MotivoVinculo;
  /** contratos do PAG da NE (para avisar nos candidatos quando a NE ficou de fora) */
  candidatos: string[];
};

const soDigitos = (s: string | null | undefined) => String(s ?? "").replace(/\D/g, "");
const cnpjDe = (s: string | null | undefined) => {
  const d = soDigitos(s);
  return d.length >= 12 && d.length <= 14 ? d.padStart(14, "0") : null;
};

export function vincularNEs(contratos: readonly ContratoVinculo[], nes: Iterable<NotaContrato>): Map<string, Vinculo> {
  type C = ContratoVinculo & { chave: ChaveContrato | null; cnpj14: string | null };
  const lista: C[] = contratos.map((c) => ({ ...c, chave: chaveContrato(c.numero_contrato), cnpj14: cnpjDe(c.cnpj) }));
  const porPag = new Map<string, C[]>();
  for (const c of lista) {
    const k = chavePAG(c.pag_nup);
    if (k) porPag.set(k, [...(porPag.get(k) ?? []), c]);
  }
  const out = new Map<string, Vinculo>();
  for (const n of nes) {
    const cand = n.pagChave ? porPag.get(n.pagChave) ?? [] : [];
    const ids = cand.map((c) => c.id);
    const liga = (c: C, motivo: MotivoVinculo) => out.set(n.ne, { contratoId: c.id, motivo, candidatos: ids });
    const cit = citacoes(n.descricao);
    const fortes = cit.filter((x) => x.forte);

    // 1. cita o contrato (com unidade, ou número de adesão): vale em qualquer PAG
    const global = lista.filter((c) => c.chave && fortes.some((x) => (x.unidade || x.num >= 100000) && citacaoBate(x, c.chave!, true)));
    const noPag = global.filter((c) => ids.includes(c.id));
    if (global.length === 1) { liga(global[0], "cita o contrato"); continue; }
    if (noPag.length === 1) { liga(noPag[0], "cita o contrato"); continue; }

    // 2. citação entre os contratos do PAG (a unidade pode faltar: "CONTRATO 005/2022")
    let achou = false;
    for (const grupo of [fortes, cit.filter((x) => !x.forte)]) {
      const hit = cand.filter((c) => c.chave && grupo.some((x) => citacaoBate(x, c.chave!, false)));
      if (hit.length === 1) { liga(hit[0], "cita o contrato"); achou = true; break; }
    }
    if (achou) continue;

    // 3. cita, como contrato, um número que não é de nenhum contrato do PAG: é de outro contrato do processo
    //    (mesmo número com outro ano é erro de digitação comum: "CREDENCIAMENTO 001/2020" no PAG do 001/2021)
    if (cand.length && fortes.length && !cand.some((c) => c.chave && fortes.some((x) => x.num === c.chave!.num))) {
      out.set(n.ne, { contratoId: null, motivo: "cita outro contrato", candidatos: ids });
      continue;
    }

    // 4. sem citação útil: pelo PAG e, se preciso, pelo fornecedor
    if (cand.length === 1) { liga(cand[0], "PAG do contrato"); continue; }
    if (cand.length > 1) {
      const doc = cnpjDe(n.favorecidoCodigo);
      const mesmo = doc ? cand.filter((c) => c.cnpj14 === doc) : [];
      if (mesmo.length === 1) { liga(mesmo[0], "mesmo fornecedor no PAG"); continue; }
      out.set(n.ne, { contratoId: null, motivo: "PAG compartilhado", candidatos: (mesmo.length ? mesmo : cand).map((c) => c.id) });
      continue;
    }
    out.set(n.ne, { contratoId: null, motivo: "sem contrato", candidatos: [] });
  }
  return out;
}

// ─── Execução de cada contrato ──────────────────────────────────────────────

export type Totais = {
  nNE: number;
  empenhado: number;
  aLiquidar: number;
  liquidadoPagar: number;
  pago: number;
  /** NEs do exercício corrente */
  empenhadoAno: number;
};

export type ExecucaoContrato = {
  /** NEs do contrato, mais novas primeiro */
  nes: NotaContrato[];
  totais: Totais;
  /** NEs do PAG que ficaram de fora por citar outro contrato */
  citamOutro: NotaContrato[];
  /** NEs do PAG que podem ser deste contrato ou de outro do mesmo PAG (mesmo fornecedor, sem citação) */
  semContratoNoPag: NotaContrato[];
  /** o empenhado só tem NEs de 2021 em diante e perde o RP antigo já pago: a vigência começou antes de 2025 */
  empenhadoIncompleto: boolean;
};

export function totalizar(nes: readonly NotaContrato[], anoAtual: number): Totais {
  const t: Totais = { nNE: nes.length, empenhado: 0, aLiquidar: 0, liquidadoPagar: 0, pago: 0, empenhadoAno: 0 };
  for (const n of nes) {
    t.empenhado += n.empenhado; t.aLiquidar += n.aLiquidar; t.liquidadoPagar += n.liquidadoPagar; t.pago += n.pago;
    if (n.ano === anoAtual) t.empenhadoAno += n.empenhado;
  }
  return t;
}

const porNE = (a: NotaContrato, b: NotaContrato) => b.ne.localeCompare(a.ne);

/** Execução de todos os contratos, de uma vez (id do contrato → execução). */
export function execucaoPorContrato(
  contratos: readonly (ContratoVinculo & { data_inicio?: string | null })[],
  nes: ReadonlyMap<string, NotaContrato>,
  vinculos: ReadonlyMap<string, Vinculo>,
  anoAtual: number,
): Map<string, ExecucaoContrato> {
  const out = new Map<string, ExecucaoContrato>();
  for (const c of contratos) {
    out.set(c.id, {
      nes: [], citamOutro: [], semContratoNoPag: [],
      totais: totalizar([], anoAtual),
      empenhadoIncompleto: !!c.data_inicio && c.data_inicio < "2025-01-01",
    });
  }
  for (const n of nes.values()) {
    const v = vinculos.get(n.ne);
    if (!v) continue;
    if (v.contratoId) { out.get(v.contratoId)?.nes.push(n); continue; }
    for (const id of v.candidatos) {
      const e = out.get(id);
      if (!e) continue;
      if (v.motivo === "cita outro contrato") e.citamOutro.push(n);
      else if (v.motivo === "PAG compartilhado") e.semContratoNoPag.push(n);
    }
  }
  for (const e of out.values()) {
    e.nes.sort(porNE); e.citamOutro.sort(porNE); e.semContratoNoPag.sort(porNE);
    e.totais = totalizar(e.nes, anoAtual);
    // NE de antes de 2025 só aparece com o pago no próprio ano: o empenhado dela pode estar a menor
    if (e.nes.some((n) => n.ano < 2025)) e.empenhadoIncompleto = true;
  }
  return out;
}

/** Saldo do contrato a empenhar: valor total − empenhado nas NEs ligadas a ele. */
export function aEmpenhar(valorContrato: number | null | undefined, t: Totais): number | null {
  return valorContrato == null ? null : Number(valorContrato) - t.empenhado;
}

export type SaldoAEmpenhar = { valor: number | null; fonte: "NEs" | "SILOMS" | null };

/**
 * Saldo a empenhar mostrado em todas as telas. Pelas NEs, quando o histórico delas está completo nas
 * planilhas. Quando o contrato tem NE de 2024 ou antes (ou vigência anterior a 2025), o empenhado das NEs
 * sai a menor — falta o RP pago em 2025 — e o saldo pelas NEs sairia a maior (ex.: obra 004/GAPMN-DACTAIV/2024,
 * 100% empenhada, aparecia com R$ 720 mil a empenhar). Aí vale o saldo do SILOMS, sempre identificado.
 */
export function saldoAEmpenhar(valorContrato: number | null | undefined, e: ExecucaoContrato | undefined, saldoSiloms: number | null | undefined): SaldoAEmpenhar {
  if (!e) return { valor: null, fonte: null };
  if (!e.empenhadoIncompleto) return { valor: aEmpenhar(valorContrato, e.totais), fonte: valorContrato == null ? null : "NEs" };
  return saldoSiloms == null ? { valor: null, fonte: null } : { valor: Number(saldoSiloms), fonte: "SILOMS" };
}

/** Data da primeira NE do contrato: a emissão (NEs do ano, planilha de itens); sem ela, 31 de dezembro do
 *  ano da NE — a data mais tardia possível, para nunca dizer que o contrato já corria quando não se sabe. */
export function primeiraNE(e: ExecucaoContrato | undefined, emissao: ReadonlyMap<string, string>): string | null {
  let min: string | null = null;
  for (const n of e?.nes ?? []) {
    const d = emissao.get(n.ne) ?? `${n.ano}-12-31`;
    if (!min || d < min) min = d;
  }
  return min;
}
