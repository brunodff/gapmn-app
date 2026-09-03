/**
 * gsheets.ts — Busca e parser de Google Sheets CSV públicos
 *
 * Sheets configurados:
 *  CREDITO_1  — Execução orçamentária (fonte 1) - planilha 1 gid=946298877
 *  CREDITO_2  — Execução orçamentária (fonte 2) - planilha 2
 *  RP         — Restos a Pagar                   - planilha 3
 *  EMPENHOS   — Controle de Empenhos             - planilha 4
 */

// ─── URLs ─────────────────────────────────────────────────────────────────────
export const SHEET_URLS = {
  credito1:   "https://docs.google.com/spreadsheets/d/1kB9CUbvSKzZj_ue6Ppi4u_q7ubKSULh2ctp3KP5ntoI/export?format=csv&gid=946298877",
  credito2:   "https://docs.google.com/spreadsheets/d/1u_C28gNt0klzmSaaTWg9wK9YJAvnSImmvDmc65V8aDo/export?format=csv&gid=0",
  rp:         "https://docs.google.com/spreadsheets/d/1-_2ZqIaKjuzCf5dbujD9V3wP3gt3vtGanjxXqUGLlZ8/export?format=csv&gid=0",
  rpNE:       "https://docs.google.com/spreadsheets/d/1-_2ZqIaKjuzCf5dbujD9V3wP3gt3vtGanjxXqUGLlZ8/export?format=csv&gid=792698456",
  empenhos:   "https://docs.google.com/spreadsheets/d/1Gb-2Q1b6VJQff-MHTZyzwUIKvQI-sZnYwNB0ZU__Vb4/export?format=csv&gid=0",
  empenhosNF: "https://docs.google.com/spreadsheets/d/1XQ5CGcB0dTVADeEGfKjtXRhqtHxsNf1J1H_9VKjBklM/export?format=csv&gid=1297815245",
  execucao:   "https://docs.google.com/spreadsheets/d/1WXiRR3_QnjgYJHWeBQ5QPivF5z6bJsooqAw7BdH00JI/export?format=csv&gid=837657910",
} as const;

// ─── Tipos ────────────────────────────────────────────────────────────────────

/** Uma linha da execução orçamentária (crédito disponível por OM/PI/ND) */
export interface LinhaCredito {
  om_sigla:   string;   // sigla da OM (DACTA IV, GAP-MN, etc.)
  acao:       string;   // descrição da ação / programa
  pi:         string;   // Plano Interno (código)
  nd:         string;   // Natureza de Despesa (código)
  nd_nome:    string;   // Natureza de Despesa (nome)
  credito:    number;   // Crédito Disponível
  a_liquidar: number;   // Despesas Empenhadas a Liquidar
  a_pagar:    number;   // Despesas Liquidadas a Pagar
}

/** Resumo por OM para o ranking e gráfico */
export interface ResumoOM {
  om_sigla:   string;
  credito:    number;
  a_liquidar: number;
  a_pagar:    number;
  linhas:     LinhaCredito[];
}

/** Linha de controle de empenho (Sheet 2 — join via siafi) */
export interface ControleEmpenho {
  solicitacao: string;
  subprocesso: string;
  siafi:       string;
  siloms:      string;
  data:        string;
  ugcred:      string;
  valor:       number;
  dias:        number;
  renomeado:   string;  // "Sim" | "Não" | "–"
  incluido:    string;  // "Sim" | "Não" | "–"
}

/** Linha de nota de empenho (Sheet 1 — tabela principal de empenhos) */
export interface EmpenhoNF {
  data:              string;  // col 0 — data do empenho (DD/MM/YYYY)
  nota_empenho:      string;  // col 1 — últimos 14 dígitos ex: 2026NE000001
  nota_empenho_full: string;  // col 1 — código completo SIAFI
  descricao:         string;  // col 2 — descrição completa
  ugcred_code:       string;  // col 3 — código UG credora (ex: 120630)
  ugr:               string;  // col 4 — UGR nome (filtro)
  natureza:          string;  // col 5 — Natureza código
  pi:                string;  // col 7 — PI código
  pi_desc:           string;  // col 8  (I) — PI descrição
  pag:               string;  // col 9  (J) — PAG (processo administrativo)
  cnpj:              string;  // col 10 (K) — CNPJ do favorecido
  nome_fantasia:     string;  // col 11 (L) — Nome Fantasia do favorecido
  assinatura:        string;  // col 13 (N) — assinante OD ou "SEM INFORMACAO"
  pendente_od:       string;  // col 14 (O) — "Pendente" se aguardando ratificação OD
  valor:             number;  // col 15 (P) — valor do empenho (R$)
  solicitacao?:      string;  // extraído de descricao via regex /26S\d+/i
}

/** Extrai código de solicitação SILOMS (2XSXXXX ou 2XMXXXX) de uma descrição de NE */
export function extractSolicitacao(descricao: string): string {
  const m = descricao.match(/\b2[2-9][SM]\d{4,6}\b/i);
  return m ? m[0].toUpperCase() : "";
}

/** Linha de Restos a Pagar por OM */
export interface LinhaRP {
  om_sigla:           string;
  rp_proc_insc:       number;
  rp_nao_proc_insc:   number;
  rp_nao_proc_reinsc: number;
  rp_proc_canc:       number;
  rp_nao_proc_canc:   number;
  total:              number;
}

// ─── Mapeamento UG → Sigla OM ─────────────────────────────────────────────────
const UG_MAP: Record<string, string> = {
  // Por código UG
  "120630": "GAP-MN",
  "120631": "BAMN",
  "120632": "HAMN",
  "120633": "DACTA IV",
  "120634": "PAMN",
  "120635": "SERIPA-MN",
  "120636": "COMAR VII",
  "120637": "COMARA",
  "120638": "SEREP-MN",
  "120639": "SERINFRA-MN",
  // Por nome (normalizado)
  "GRUPAMENTO DE APOIO DE MANAUS": "GAP-MN",
  "GAP-MN": "GAP-MN",
  "BASE AEREA DE MANAUS": "BAMN",
  "BASE AÉREA DE MANAUS": "BAMN",
  "BAMN": "BAMN",
  "HOSPITAL DA AERONAUTICA DE MANAUS": "HAMN",
  "HOSPITAL DA AERONÁUTICA DE MANAUS": "HAMN",
  "HAMN": "HAMN",
  "DESTACAMENTO DE CONTROLE DO ESPACO AEREO IV": "DACTA IV",
  "DESTACAMENTO DE CONTROLE DO ESPAÇO AÉREO IV": "DACTA IV",
  "CINDACTA IV": "DACTA IV",
  "DACTA IV": "DACTA IV",
  "PARQUE DE MATERIAL AERONAUTICO DE MANAUS": "PAMN",
  "PARQUE DE MATERIAL AERONÁUTICO DE MANAUS": "PAMN",
  "PAMN": "PAMN",
  "SERVICO REGIONAL DE INVESTIGACAO E PREVENCAO DE ACIDENTES AERONAUTICOS - MANAUS": "SERIPA-MN",
  "SERIPA-MN": "SERIPA-MN",
  "SERIPA MN": "SERIPA-MN",
  "COMANDO AEREO REGIONAL VII": "COMAR VII",
  "COMANDO AÉREO REGIONAL VII": "COMAR VII",
  "COMAR VII": "COMAR VII",
  "COMISSAO DE AEROPORTOS DA REGIAO AMAZONICA": "COMARA",
  "COMISSÃO DE AEROPORTOS DA REGIÃO AMAZÔNICA": "COMARA",
  "COMARA": "COMARA",
  "SERVICO REGIONAL DE PATRIMONIO": "SEREP-MN",
  "SEREP-MN": "SEREP-MN",
  "SEREP MN": "SEREP-MN",
  "SERVICO DE INFRAESTRUTURA DE MANAUS": "SERINFRA-MN",
  "SERINFRA-MN": "SERINFRA-MN",
  "SERINFRA MN": "SERINFRA-MN",
};

function resolveOM(codOrNome: string): string {
  const upper = (codOrNome || "").trim().toUpperCase();
  if (UG_MAP[upper]) return UG_MAP[upper];
  // Busca parcial por nome (primeiras palavras)
  for (const [key, val] of Object.entries(UG_MAP)) {
    if (upper.includes(key) || key.includes(upper)) return val;
  }
  return upper; // fallback: usa o próprio nome
}

// ─── Parser CSV ───────────────────────────────────────────────────────────────
function parseCSV(text: string): string[][] {
  const rows: string[][] = [];
  const lines = text.split(/\r?\n/);
  for (const line of lines) {
    if (!line.trim()) continue;
    const row: string[] = [];
    let inQuote = false;
    let cur = "";
    for (const ch of line) {
      if (ch === '"') {
        inQuote = !inQuote;
      } else if (ch === "," && !inQuote) {
        row.push(cur.trim());
        cur = "";
      } else {
        cur += ch;
      }
    }
    row.push(cur.trim());
    rows.push(row);
  }
  return rows;
}

/** Encontra a linha de cabeçalho (primeiro que contém keywords conhecidas) */
function findHeaderRow(rows: string[][], keywords: string[]): number {
  for (let i = 0; i < Math.min(rows.length, 8); i++) {
    const joined = rows[i].join("|").toUpperCase();
    const hits = keywords.filter((k) => joined.includes(k.toUpperCase()));
    if (hits.length >= 2) return i;
  }
  return -1; // não encontrado → usar posição
}

/** Mapeia nome de coluna → índice, por substring normalizada */
function colMap(headers: string[]): Record<string, number> {
  const map: Record<string, number> = {};
  headers.forEach((h, i) => {
    map[h.trim().toUpperCase()] = i;
  });
  return map;
}

function findCol(map: Record<string, number>, ...candidates: string[]): number {
  for (const c of candidates) {
    const up = c.toUpperCase();
    for (const [key, idx] of Object.entries(map)) {
      if (key.includes(up)) return idx;
    }
  }
  return -1;
}

function toNum(v: string | undefined): number {
  if (!v) return 0;
  const cleaned = v.replace(/[R$\s]/g, "").replace(",", ".");
  const n = parseFloat(cleaned);
  return isNaN(n) ? 0 : n;
}

// ─── Fetch CSV ────────────────────────────────────────────────────────────────
export async function fetchCSV(url: string): Promise<string[][]> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${url}`);
  const text = await res.text();
  if (text.trimStart().startsWith("<!") || text.trimStart().startsWith("<html"))
    throw new Error("Planilha não está acessível — verifique se está compartilhada publicamente.");
  return parseCSV(text);
}

// ─── Transformadores ─────────────────────────────────────────────────────────

/**
 * Transforma linhas CSV em LinhaCredito[].
 * Detecta colunas automaticamente; usa posições fixas como fallback.
 * Filtro: excluir ND iniciados em 31, 36, 46 (pessoal / transferências).
 */
export function toCreditoLinhas(rows: string[][]): LinhaCredito[] {
  const CRED_KW = ["CREDITO", "DISPONIV", "UG", "ND", "PI", "ACAO", "LIQUIDAR", "PAGAR"];
  const hi = findHeaderRow(rows, CRED_KW);

  let iAcao = -1, iPi = -1, iNdCod = -1, iNdNome = -1;
  let iUgCod = -1, iUgNome = -1;
  let iCredito = -1, iALiquidar = -1, iAPagar = -1;

  if (hi >= 0) {
    const cm = colMap(rows[hi]);
    iAcao      = findCol(cm, "ACAO", "AÇÃO", "PROGRAMA", "DESCRICAO", "DESCR");
    iPi        = findCol(cm, "PI", "PLANO INTERNO", "PTRES");
    iNdCod     = findCol(cm, "ND", "NATUREZA DESPESA", "COD ND");
    iNdNome    = findCol(cm, "NATUREZA DESPESA", "DESCRICAO ND", "NOME ND");
    iUgCod     = findCol(cm, "UG COD", "CODIGO UG", "UG RESPONSAVEL", "UG RESP");
    iUgNome    = findCol(cm, "UG NOME", "NOME UG", "UNIDADE GESTORA");
    iCredito   = findCol(cm, "CREDITO DISPONIV", "DISPONIVEL", "CRED DISP");
    iALiquidar = findCol(cm, "LIQUIDAR", "A LIQUIDAR", "EMP LIQUIDAR");
    iAPagar    = findCol(cm, "A PAGAR", "LIQ PAGAR", "PAGAR");
  }

  // Fallback por posição (baseado na estrutura observada na planilha 1)
  // Pos: 0=FonteCode, 1=FonteNome, 2=PI, 3=Acao, 4=PTRES, 5=NDCode, 6=NDNome,
  //      7=UGCode, 8=UGNome, 9=Data, 10=Item, 11=Credito, 12=ALiquidar, 13=APagar
  const fallbackAcao      = 3;
  const fallbackPi        = 2;
  const fallbackNdCod     = 5;
  const fallbackNdNome    = 6;
  const fallbackUgCod     = 7;
  const fallbackUgNome    = 8;
  const fallbackCredito   = 11;
  const fallbackALiquidar = 12;
  const fallbackAPagar    = 13;

  const getCol = (idx: number, fb: number, row: string[]) =>
    (idx >= 0 ? row[idx] : row[fb]) ?? "";

  const dataStart = hi >= 0 ? hi + 1 : 1;
  const result: LinhaCredito[] = [];

  for (let i = dataStart; i < rows.length; i++) {
    const row = rows[i];
    if (row.length < 5) continue;

    const ndCode = getCol(iNdCod, fallbackNdCod, row);
    // Filtrar pessoal (31x) e transferências (36x, 46x, 47x)
    const ndNum = ndCode.replace(/\D/g, "").slice(0, 2);
    if (["31", "36", "46", "47"].includes(ndNum)) continue;

    const ugCod  = getCol(iUgCod,  fallbackUgCod,  row);
    const ugNome = getCol(iUgNome, fallbackUgNome, row);
    const om = resolveOM(ugNome || ugCod);

    const credito   = Math.abs(toNum(getCol(iCredito,   fallbackCredito,   row)));
    const aLiquidar = Math.abs(toNum(getCol(iALiquidar, fallbackALiquidar, row)));
    const aPagar    = Math.abs(toNum(getCol(iAPagar,    fallbackAPagar,    row)));

    if (credito === 0 && aLiquidar === 0 && aPagar === 0) continue;

    result.push({
      om_sigla:   om,
      acao:       getCol(iAcao,   fallbackAcao,   row),
      pi:         getCol(iPi,     fallbackPi,     row),
      nd:         ndCode,
      nd_nome:    getCol(iNdNome, fallbackNdNome, row),
      credito,
      a_liquidar: aLiquidar,
      a_pagar:    aPagar,
    });
  }

  return result;
}

/** Agrega LinhaCredito[] por OM → ResumoOM[] */
export function agregaPorOM(linhas: LinhaCredito[]): ResumoOM[] {
  const map = new Map<string, ResumoOM>();
  for (const l of linhas) {
    const existing = map.get(l.om_sigla);
    if (existing) {
      existing.credito    += l.credito;
      existing.a_liquidar += l.a_liquidar;
      existing.a_pagar    += l.a_pagar;
      existing.linhas.push(l);
    } else {
      map.set(l.om_sigla, {
        om_sigla:   l.om_sigla,
        credito:    l.credito,
        a_liquidar: l.a_liquidar,
        a_pagar:    l.a_pagar,
        linhas:     [l],
      });
    }
  }
  return [...map.values()].sort((a, b) => b.credito - a.credito);
}

/** Normaliza booleano de planilha → "Sim" | "Não" | "–" */
function toBool(v: string): string {
  const u = (v ?? "").trim().toUpperCase();
  if (!u) return "–";
  if (["TRUE", "1", "SIM", "YES", "X"].includes(u)) return "Sim";
  if (["FALSE", "0", "NAO", "NÃO", "NO"].includes(u)) return "Não";
  return "–";
}

/** Transforma linhas CSV em ControleEmpenho[] */
export function toControleEmpenhos(rows: string[][]): ControleEmpenho[] {
  // Tenta detectar header com keywords
  const KEYS = ["SOLICIT", "SIAFI", "SILOMS", "SUBPROC", "DATA", "VALOR", "DIAS"];
  const hi = findHeaderRow(rows, KEYS);

  let iSol = -1, iSub = -1, iSiafi = -1, iSiloms = -1;
  let iData = -1, iUg = -1, iValor = -1, iDias = -1;
  let iRenomeado = -1, iIncluido = -1;

  if (hi >= 0) {
    const cm = colMap(rows[hi]);
    iSol       = findCol(cm, "SOLICIT", "NUMERO SOLICIT");
    iSub       = findCol(cm, "SUBPROC", "SUB PROC", "SP");
    iSiafi     = findCol(cm, "SIAFI", "NE", "EMPENHO SIAFI");
    iSiloms    = findCol(cm, "SILOMS", "PEDIDO", "EMPENHO SILOMS");
    iData      = findCol(cm, "DATA", "DT");
    iUg        = findCol(cm, "UG", "UGCRED", "UG CRED", "UNIDADE");
    iValor     = findCol(cm, "VALOR", "VL");
    iDias      = findCol(cm, "DIAS", "DIAS EM ABERTO", "PENDENTE");
    iRenomeado = findCol(cm, "RENOME", "RENOMEAD");
    iIncluido  = findCol(cm, "INCLUI", "INCLUIDO");
  }

  // Fallback positions (common format: Data | UGCred | Solicitacao | Subprocesso | SIAFI | SILOMS | Valor | Dias)
  const fb = { sol: 2, sub: 3, siafi: 4, siloms: 5, data: 0, ug: 1, valor: 6, dias: 7 };

  const getC = (idx: number, fallback: number, row: string[]) =>
    (idx >= 0 ? row[idx] : row[fallback]) ?? "";

  const dataStart = hi >= 0 ? hi + 1 : 1;
  const result: ControleEmpenho[] = [];

  for (let i = dataStart; i < rows.length; i++) {
    const row = rows[i];
    if (row.length < 4) continue;

    const solicitacao = getC(iSol, fb.sol, row);
    if (!solicitacao) continue;

    result.push({
      solicitacao,
      subprocesso: getC(iSub,    fb.sub,   row),
      siafi:       getC(iSiafi,  fb.siafi, row),
      siloms:      getC(iSiloms, fb.siloms,row),
      data:        getC(iData,   fb.data,  row),
      ugcred:      getC(iUg,     fb.ug,    row),
      valor:       toNum(getC(iValor, fb.valor, row)),
      dias:        parseInt(getC(iDias, fb.dias, row)) || 0,
      renomeado:   toBool(iRenomeado >= 0 ? (row[iRenomeado] ?? "") : ""),
      incluido:    toBool(iIncluido  >= 0 ? (row[iIncluido]  ?? "") : ""),
    });
  }

  return result;
}

/** Transforma linhas CSV em EmpenhoNF[] (Sheet 1 — notas de empenho)
 *
 * A planilha NÃO tem linha de cabeçalho — apenas título na linha 0.
 * Posições fixas (confirmadas pela estrutura real do CSV):
 *   col 0 = Data (DD/MM/YYYY)
 *   col 1 = NE completo (ex: 120630000012026NE000001) → últimos 12 = chave SIAFI
 *   col 2 = Descrição
 *   col 3 = UGR código
 *   col 4 = UGR nome
 *   col 5 = Natureza código
 *   col 6 = Natureza nome
 *   col 7 = PI código
 *   col 8 = PI nome
 *   col 9  (J) = PAG
 *   col 10 (K) = CNPJ
 *   col 11 (L) = Nome Fantasia
 *   col 12 (M) = CPF (ignorado)
 *   col 13 (N) = Assinatura OD (nome ou "SEM INFORMACAO")
 *   col 14 (O) = Pendente OD ("Pendente" ou vazio)
 *   col 15 (P) = Valor
 */
export function toEmpenhosNF(rows: string[][]): EmpenhoNF[] {
  const result: EmpenhoNF[] = [];

  for (let i = 1; i < rows.length; i++) { // linha 0 = título "Notas de Empenho"
    const row = rows[i];
    if (row.length < 3) continue;

    const rawData = (row[0] ?? "").trim();
    if (!rawData.match(/^\d{2}\/\d{2}\/\d{4}$/)) continue;

    const rawNota = (row[1] ?? "").trim();
    if (rawNota.length < 12) continue;

    const descricao = (row[2] ?? "").trim();
    const neMatch = rawNota.match(/(\d{4}NE\d+)$/i);
    result.push({
      data:              rawData,
      nota_empenho:      neMatch ? neMatch[1] : rawNota.slice(-12), // ex: 2026NE000001
      nota_empenho_full: rawNota,
      descricao,
      ugcred_code:       (row[3]  ?? "").trim(),
      ugr:               (row[4]  ?? "").trim(),
      natureza:          (row[5]  ?? "").trim(),
      pi:                (row[7]  ?? "").trim(),
      pi_desc:           (row[8]  ?? "").trim(),
      pag:               (row[9]  ?? "").trim(),
      cnpj:              (row[10] ?? "").trim(),
      nome_fantasia:     (row[11] ?? "").trim(),
      assinatura:        (row[13] ?? "").trim(),
      pendente_od:       (row[14] ?? "").trim(),
      valor:             toNum((row[15] ?? "").trim()),
      solicitacao:       extractSolicitacao(descricao),
    });
  }

  // Ordena pelo número da NE (parte numérica após "NE")
  const neNum = (ne: string) => parseInt(ne.replace(/.*NE0*/i, "") || "0", 10);
  result.sort((a, b) => neNum(a.nota_empenho) - neNum(b.nota_empenho));
  return result;
}

/** Linha de RP por Nota de Empenho (planilha gid=792698456) */
export interface LinhaRPNE {
  pi:          string;
  ugr_code:    string;
  ugr_nome:    string;
  ne:          string;
  favorecido:  string;
  descricao:   string;
  processo:    string;
  // Campos granulares (estrutura 2026)
  rp_nao_proc_a_liq:    number;   // col J (631100000) — RP Não Proc. A Liquidar
  rp_nao_proc_liq_pag:  number;   // col K (631300000) — RP Não Proc. Liquidados A Pagar
  rp_nao_proc_pago:     number;   // col L (631400000) — RP Não Proc. Pagos
  rp_proc_a_pagar:      number;   // col M (632100000) — RP Proc. A Pagar
  rp_proc_pagos:        number;   // col N (632200000) — RP Proc. Pagos
  // Agregados para PainelRP (backward compat)
  rp_nao_proc: number;  // J+K — pendentes não-processados
  rp_proc:     number;  // M   — pendentes processados
}

/**
 * Transforma linhas CSV da planilha de RP por NE em LinhaRPNE[].
 * As 5 primeiras linhas são cabeçalho/título — dados começam na linha 5 (índice 5).
 * Estrutura (cols A-N):
 *   A=PI código (fill-down)  B=PI descrição (fill-down)  C=UGR code (fill-down)  D=UGR nome (fill-down)
 *   E=NE CCor  F=CNPJ/blank  G=Favorecido  H=Descrição  I=Processo/PAG
 *   J=631100000 RP Não Proc. A Liquidar
 *   K=631300000 RP Não Proc. Liquidados A Pagar
 *   L=631400000 RP Não Proc. Pagos
 *   M=632100000 RP Proc. A Pagar
 *   N=632200000 RP Proc. Pagos
 */
export function toRPNEs(rows: string[][]): LinhaRPNE[] {
  const result: LinhaRPNE[] = [];
  let lastPi = "";
  let lastUgrCode = "";
  let lastUgrNome = "";

  for (let i = 5; i < rows.length; i++) {
    const row = rows[i];
    if (row.length < 5) continue;

    const pi      = (row[0] ?? "").trim();
    const ugrCode = (row[2] ?? "").trim();
    const ugrNome = (row[3] ?? "").trim();
    if (pi)      lastPi      = pi;
    if (ugrCode) lastUgrCode = ugrCode;
    if (ugrNome) lastUgrNome = ugrNome;

    const neRaw = (row[4] ?? "").trim();
    if (!neRaw) continue;  // sem NE = linha de grupo/total, pula

    // Extrai NE: tenta regex padrão SIAFI, fallback: remove 11 primeiros chars
    const neMatch = neRaw.match(/(\d{4}NE\d+)$/i);
    const ne = neMatch ? neMatch[1] : (neRaw.length > 11 ? neRaw.slice(11) : neRaw);
    if (!ne) continue;

    const rpNaoProcALiq   = toNum((row[9]  ?? "").trim()); // J
    const rpNaoProcLiqPag = toNum((row[10] ?? "").trim()); // K
    const rpNaoProcPago   = toNum((row[11] ?? "").trim()); // L
    const rpProcAPagar    = toNum((row[12] ?? "").trim()); // M
    const rpProcPagos     = toNum((row[13] ?? "").trim()); // N

    if (rpNaoProcALiq + rpNaoProcLiqPag + rpNaoProcPago + rpProcAPagar + rpProcPagos === 0) continue;

    result.push({
      pi:          lastPi,
      ugr_code:    lastUgrCode,
      ugr_nome:    lastUgrNome,
      ne,
      favorecido:  (row[6] ?? "").trim(),
      descricao:   (row[7] ?? "").trim(),
      processo:    (row[8] ?? "").trim(),
      rp_nao_proc_a_liq:   rpNaoProcALiq,
      rp_nao_proc_liq_pag: rpNaoProcLiqPag,
      rp_nao_proc_pago:    rpNaoProcPago,
      rp_proc_a_pagar:     rpProcAPagar,
      rp_proc_pagos:       rpProcPagos,
      rp_nao_proc: rpNaoProcALiq + rpNaoProcLiqPag,
      rp_proc:     rpProcAPagar,
    });
  }

  return result;
}

/**
 * Normaliza código NE removendo zeros à esquerda do número
 * ex: "2026NE000001" e "2026NE0001" e "2026NE1" → todos iguais "2026NE1"
 * Permite join entre Sheet1 (últimos 12 do código completo) e Sheet2 (siafi)
 */
export function normalizeNE(s: string): string {
  const m = (s ?? "").match(/(\d{4})NE(\d+)/i);
  if (m) return `${m[1]}NE${parseInt(m[2], 10)}`;
  return (s ?? "").trim().toUpperCase();
}

/** Normaliza data para YYYY-MM-DD (para ordenação) */
function normDate(d: string): string {
  if (!d) return "";
  // DD/MM/YYYY → YYYY-MM-DD
  const m = d.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (m) return `${m[3]}-${m[2]}-${m[1]}`;
  return d;
}

/** Transforma linhas CSV em LinhaRP[] */
export function toLinhasRP(rows: string[][]): LinhaRP[] {
  const KEYS = ["OM", "SIGLA", "RP", "INSCR", "PROC", "CANCEL", "TOTAL"];
  const hi = findHeaderRow(rows, KEYS);

  let iOM = -1, iProcInsc = -1, iNaoProcInsc = -1, iNaoProcReinsc = -1;
  let iProcCanc = -1, iNaoProcCanc = -1, iTotal = -1;

  if (hi >= 0) {
    const cm = colMap(rows[hi]);
    iOM            = findCol(cm, "SIGLA", "OM", "UNIDADE");
    iProcInsc      = findCol(cm, "PROC INSC", "RP PROC INSC", "PROCESSADOS INSCR");
    iNaoProcInsc   = findCol(cm, "NAO PROC INSC", "N PROC INSC", "NAO PROCESSADOS INSCR");
    iNaoProcReinsc = findCol(cm, "REINSCR", "REINSC", "NAO PROC REINSCR");
    iProcCanc      = findCol(cm, "PROC CANC", "PROCESSADOS CANC");
    iNaoProcCanc   = findCol(cm, "NAO PROC CANC", "N PROC CANC");
    iTotal         = findCol(cm, "TOTAL", "TOTAL INSCR");
  }

  // Fallback (com +2 por colunas PI A e B adicionadas): 2=OM, 3=ProcInsc, 4=NaoProcInsc, 5=NaoProcReinsc, 6=ProcCanc, 7=NaoProcCanc, 8=Total
  const fb = { om: 2, pi: 3, npi: 4, npr: 5, pc: 6, npc: 7, tot: 8 };
  const getC = (idx: number, fallback: number, row: string[]) =>
    (idx >= 0 ? row[idx] : row[fallback]) ?? "";

  const dataStart = hi >= 0 ? hi + 1 : 1;
  const result: LinhaRP[] = [];
  let lastOM = "";

  for (let i = dataStart; i < rows.length; i++) {
    const row = rows[i];
    if (row.length < 3) continue;

    const rawOM = resolveOM(getC(iOM, fb.om, row));
    if (rawOM) lastOM = rawOM;
    const om = lastOM;
    if (!om) continue;

    const procInsc      = toNum(getC(iProcInsc,      fb.pi,  row));
    const naoProcInsc   = toNum(getC(iNaoProcInsc,   fb.npi, row));
    const naoProcReinsc = toNum(getC(iNaoProcReinsc, fb.npr, row));
    const procCanc      = toNum(getC(iProcCanc,      fb.pc,  row));
    const naoProcCanc   = toNum(getC(iNaoProcCanc,   fb.npc, row));
    const total         = toNum(getC(iTotal,         fb.tot, row))
                         || procInsc + naoProcInsc + naoProcReinsc;

    if (total === 0) continue;

    result.push({
      om_sigla: om,
      rp_proc_insc:       procInsc,
      rp_nao_proc_insc:   naoProcInsc,
      rp_nao_proc_reinsc: naoProcReinsc,
      rp_proc_canc:       procCanc,
      rp_nao_proc_canc:   naoProcCanc,
      total,
    });
  }

  return result;
}

// ─── Painel de Execução ───────────────────────────────────────────────────────

/** Uma linha da planilha de execução de empenhos */
export interface ExecucaoLinha {
  pi:              string;  // col A — PI código (fill-down)
  pi_desc:         string;  // col B — PI descrição (fill-down)
  unidade:         string;  // col D — UG Resp. nome (fill-down)
  nota_empenho:    string;  // col D
  info_d:          string;  // col E
  info_e:          string;  // col F (tipicamente favorecido/empresa)
  info_f:          string;  // col G
  info_g:          string;  // col H (PAG)
  a_liquidar:      number;  // col I
  liquidado_pagar: number;  // col J
  pago:            number;  // col K
}

export interface ExecucaoHeaders {
  d: string; e: string; f: string; g: string;
}

function toBRLNum(v: string | undefined): number {
  if (!v) return 0;
  const s = v.replace(/[R$\s%]/g, "");
  const cleaned = s.indexOf(",") !== -1
    ? s.replace(/\./g, "").replace(",", ".")
    : s;
  const n = parseFloat(cleaned);
  return isNaN(n) ? 0 : n;
}

/**
 * Transforma CSV do "Situação Empenho GAPMN" (Sheet1) em ExecucaoLinha[].
 *
 * Estrutura atual da planilha (cols A-L, 2 colunas PI adicionadas no início):
 *   A=PI código (fill-down)  B=PI descrição (fill-down)  C=UG Resp. código  D=UG Resp. nome (fill-down)
 *   E=NE CCor (ex: "120630000012026NE000242")  F=NE CCor - Favorecido  G=Favorecido  H=NE CCor - Descrição
 *   I=PAG  J=A Liquidar (6229.20.101)  K=Liquidado a Pagar (6229.20.103)  L=Pago (6229.20.104)
 *
 * Detecta o início dos dados pela primeira linha onde col E (índice 4) contém padrão \d{4}NE\d+.
 */
export function toExecucaoLinhas(rows: string[][]): { linhas: ExecucaoLinha[]; headers: ExecucaoHeaders } {
  const headers: ExecucaoHeaders = { d: "Cód. Favorecido", e: "Favorecido", f: "Favorecido", g: "PAG" };
  if (!rows.length) return { linhas: [], headers };

  // Encontra primeira linha de dados: col E (índice 4) contém padrão de NE
  let dataStart = 1;
  for (let i = 0; i < Math.min(rows.length, 12); i++) {
    if (/\d{4}NE\d+/i.test(rows[i][4] ?? "")) { dataStart = i; break; }
  }

  // Índices fixos conforme estrutura atual
  // A=0:PI  B=1:PIdesc  C=2:UGcode  D=3:UGnome  E=4:NE  F=5:CodFav  G=6:Fav  H=7:Desc  I=8:PAG  J=9:ALiq  K=10:LiqPag  L=11:Pago
  const iPI = 0, iUnidade = 3, iNota = 4, iD = 5, iE = 6, iF = 7, iG = 8;
  const iALiq = 9, iLiqPag = 10, iPago = 11;

  let lastPi     = "";
  let lastPiDesc = "";
  let lastUnidade = "";
  let lastInfoG = "";  // PAG/NUP: fill-down pois fica em branco nas NEs subsequentes
  const linhas: ExecucaoLinha[] = [];

  for (let i = dataStart; i < rows.length; i++) {
    const row = rows[i];
    if (row.length < 5) continue;
    const rawPi     = (row[iPI]      ?? "").trim();
    const rawPiDesc = (row[1]        ?? "").trim();  // col B = PI descrição
    const rawUnit   = (row[iUnidade] ?? "").trim();
    const rawInfoG  = (row[iG]       ?? "").trim();
    if (rawPi)     lastPi      = rawPi;
    if (rawPiDesc) lastPiDesc  = rawPiDesc;
    if (rawUnit)   lastUnidade = rawUnit;
    if (rawInfoG)  lastInfoG   = rawInfoG;
    // Extrai só o código NE do campo composto (ex: "120630000012026NE000242" → "2026NE000242")
    const notaRaw = (row[iNota] ?? "").trim();
    const neMatch = /(\d{4}NE\d+)/i.exec(notaRaw);
    const nota = neMatch ? neMatch[1].toUpperCase() : notaRaw;
    if (!nota && !lastUnidade) continue;
    const aLiquidar      = toBRLNum(row[iALiq]);
    const liquidadoPagar = toBRLNum(row[iLiqPag]);
    const pago           = toBRLNum(row[iPago]);
    if (!nota && aLiquidar === 0 && liquidadoPagar === 0 && pago === 0) continue;
    linhas.push({
      pi:              lastPi,
      pi_desc:         lastPiDesc,
      unidade:         lastUnidade,
      nota_empenho:    nota,
      info_d:          (row[iD]  ?? "").trim(),
      info_e:          (row[iE]  ?? "").trim(),
      info_f:          (row[iF]  ?? "").trim(),
      info_g:          lastInfoG,
      a_liquidar:      aLiquidar,
      liquidado_pagar: liquidadoPagar,
      pago,
    });
  }
  return { linhas, headers };
}
