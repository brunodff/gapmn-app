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
  empenhos:   "https://docs.google.com/spreadsheets/d/1Gb-2Q1b6VJQff-MHTZyzwUIKvQI-sZnYwNB0ZU__Vb4/export?format=csv&gid=0",
  empenhosNF: "https://docs.google.com/spreadsheets/d/1XQ5CGcB0dTVADeEGfKjtXRhqtHxsNf1J1H_9VKjBklM/export?format=csv&gid=1297815245",
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
  pi_desc:           string;  // col 8 — PI descrição
  valor:             number;  // col 9 — valor do empenho (R$)
  solicitacao?:      string;  // extraído de descricao via regex /26S\d+/i
}

/** Extrai código de solicitação SILOMS de uma descrição de NE */
export function extractSolicitacao(descricao: string): string {
  const m = descricao.match(/26S\d{4}/i);
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
 *   col 9 = Valor
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
      ugcred_code:       (row[3] ?? "").trim(),
      ugr:               (row[4] ?? "").trim(),
      natureza:          (row[5] ?? "").trim(),
      pi:                (row[7] ?? "").trim(),
      pi_desc:           (row[8] ?? "").trim(),
      valor:             toNum((row[9] ?? "").trim()),
      solicitacao:       extractSolicitacao(descricao),
    });
  }

  // Ordena pelo número da NE (parte numérica após "NE")
  const neNum = (ne: string) => parseInt(ne.replace(/.*NE0*/i, "") || "0", 10);
  result.sort((a, b) => neNum(a.nota_empenho) - neNum(b.nota_empenho));
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

  // Fallback: 0=OM, 1=ProcInsc, 2=NaoProcInsc, 3=NaoProcReinsc, 4=ProcCanc, 5=NaoProcCanc, 6=Total
  const fb = { om: 0, pi: 1, npi: 2, npr: 3, pc: 4, npc: 5, tot: 6 };
  const getC = (idx: number, fallback: number, row: string[]) =>
    (idx >= 0 ? row[idx] : row[fallback]) ?? "";

  const dataStart = hi >= 0 ? hi + 1 : 1;
  const result: LinhaRP[] = [];

  for (let i = dataStart; i < rows.length; i++) {
    const row = rows[i];
    if (row.length < 3) continue;

    const om = resolveOM(getC(iOM, fb.om, row));
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
