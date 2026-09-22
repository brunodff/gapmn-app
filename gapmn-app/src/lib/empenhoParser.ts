import * as pdfjsLib from "pdfjs-dist";
import type { TextItem } from "pdfjs-dist/types/src/display/api";

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/build/pdf.worker.min.mjs",
  import.meta.url
).href;

export interface ItemEmpenho {
  numeroItem: number;
  requisicao: string;
  subelemento: string | null;
  descricao: string;
  ref: string;
  quantidade: number;
  unidade: string;
  valorUnitario: number;
  valorTotal: number;
}

export interface SolicitacaoEmpenho {
  _md5: string;
  _arquivo: string;
  _lowConf: string[];   // field names with low confidence
  _total: number;

  numeroSolicitacao: string;
  dataImpressao: string;
  localEntrega: string;
  compradora: string;

  fornecedorCNPJ: string;
  fornecedorNome: string;

  itens: ItemEmpenho[];

  contrato: string;
  nd: string;
  ptres: string;
  pi: string;
  ugr: string;
  numeroCompra: string;
  fonte: string;
  codemp: string;
  numeroProcesso: string;
  observacaoPDF: string;

  tipoOrigem: "compra" | "contrato" | "ambiguo";
  modalidade: string;  // option value, e.g. "76" for Pregão

  descricaoObservacao: string;
}

// "1.169,0000" → 1169.0, "50,00" → 50.0, "23,38" → 23.38
function parseBR(s: string): number {
  return parseFloat(s.replace(/\./g, "").replace(",", ".")) || 0;
}

// Format CNPJ: 14 digits → "XX.XXX.XXX/XXXX-XX"
export function formatCNPJ(d: string): string {
  const n = d.replace(/\D/g, "");
  if (n.length !== 14) return d;
  return `${n.slice(0, 2)}.${n.slice(2, 5)}.${n.slice(5, 8)}/${n.slice(8, 12)}-${n.slice(12)}`;
}

// Group pdfjs text items by Y coordinate into rows (top-to-bottom)
async function extractRows(buf: ArrayBuffer): Promise<string[]> {
  const pdf = await pdfjsLib.getDocument({ data: buf }).promise;
  const allRows: { y: number; row: string }[] = [];

  // Only page 1 has the content we need (page 2 = signatures)
  const page = await pdf.getPage(1);
  const content = await page.getTextContent();

  type Bucket = { items: { x: number; str: string }[] };
  const buckets = new Map<number, Bucket>();

  for (const raw of content.items) {
    const ti = raw as TextItem;
    if (!ti.str?.trim()) continue;
    const y = Math.round(ti.transform[5]); // round to 1px
    // Merge rows within 3px tolerance
    let key = y;
    for (const k of buckets.keys()) {
      if (Math.abs(k - y) <= 3) { key = k; break; }
    }
    if (!buckets.has(key)) buckets.set(key, { items: [] });
    buckets.get(key)!.items.push({ x: ti.transform[4], str: ti.str.trim() });
  }

  for (const [y, b] of buckets) {
    const row = b.items
      .sort((a, b2) => a.x - b2.x)
      .map(i => i.str)
      .join(" ")
      .replace(/\s{2,}/g, " ")
      .trim();
    if (row) allRows.push({ y, row });
  }

  // PDF y increases upward → sort descending = top-to-bottom
  return allRows
    .sort((a, b) => b.y - a.y)
    .map(r => r.row);
}

export async function parsePdfSolicitacao(file: File): Promise<SolicitacaoEmpenho> {
  const buf = await file.arrayBuffer();
  const rows = await extractRows(buf);
  const text = rows.join("\n");
  const low: string[] = [];

  // ── MD5 ──────────────────────────────────────────────────────────────────
  const md5 = text.match(/Hash MD5:\s*([a-f0-9]{32})/i)?.[1] ?? "";

  // ── Número da Solicitação ─────────────────────────────────────────────────
  const numeroSolicitacao = text.match(/\b(\d{2}S\d{4})\b/)?.[1] ?? "";
  if (!numeroSolicitacao) low.push("numeroSolicitacao");

  // ── Data Impressão ────────────────────────────────────────────────────────
  const dataImpressao = text.match(/Data Impress[aã]o:\s*(\d{2}\/\d{2}\/\d{4})/i)?.[1] ?? "";

  // ── Local de Entrega ──────────────────────────────────────────────────────
  // Appears as an all-caps line in the header block before "SOLICITAÇÃO DE EMPENHO"
  let localEntrega = "";
  const skipTokens = new Set(["CNPJ:", "TELEFONE:", "FAX:", "AQS05044WSOLICITACAOEMPENHO"]);
  for (const row of rows) {
    if (/SOLICITAÇ[AÃ]O\s+DE\s+EMPENHO/i.test(row)) break;
    const r = row.trim();
    if (
      r.length > 8 &&
      /^[A-ZÁÉÍÓÚÂÊÎÔÛÃÕÇÀÜ\s.\-\/]+$/.test(r) &&
      !skipTokens.has(r.replace(/\s/g, "").toUpperCase()) &&
      !r.startsWith("CNPJ") &&
      !r.startsWith("TELEFONE") &&
      !/^\d/.test(r)
    ) {
      localEntrega = r;
    }
  }
  if (!localEntrega) low.push("localEntrega");

  // ── Fornecedor ────────────────────────────────────────────────────────────
  const fornIdx = rows.findIndex(r => /^FORNECEDOR$/i.test(r.trim()));
  const fornRows = fornIdx >= 0 ? rows.slice(fornIdx) : rows;

  let fornecedorCNPJ = "";
  let fornecedorNome = "";
  for (let i = 0; i < fornRows.length; i++) {
    const m = fornRows[i].match(/CNPJ:\s*([\d.\/\-]{14,18})/);
    if (m) {
      fornecedorCNPJ = m[1].replace(/\D/g, "");
      if (fornecedorCNPJ.length === 14) {
        // Next meaningful line = name
        for (let j = i + 1; j < Math.min(i + 5, fornRows.length); j++) {
          const n = fornRows[j].trim();
          if (n && !n.startsWith("CNPJ") && !/^\d{2}\//.test(n) && n !== "GAP-MN") {
            fornecedorNome = n;
            break;
          }
        }
        break;
      }
    }
  }
  if (!fornecedorCNPJ) low.push("fornecedorCNPJ");
  if (!fornecedorNome) low.push("fornecedorNome");

  // ── Item Table ────────────────────────────────────────────────────────────
  const headerIdx = rows.findIndex(r =>
    /ITEM/.test(r) && /REQUISI/i.test(r) && (/QUANT/i.test(r) || /UNID/i.test(r))
  );

  const itens: ItemEmpenho[] = [];
  if (headerIdx >= 0) {
    let i = headerIdx + 1;
    while (i < rows.length) {
      const row = rows[i];
      if (/^TOTAL:/i.test(row) || /Contrato:/i.test(row)) break;
      const item = parseItemRow(row);
      if (item) {
        // Absorb continuation line (additional description)
        const next = rows[i + 1]?.trim() ?? "";
        if (next && !parseItemRow(next) && !/^TOTAL:/i.test(next) && !/^ITEM\b/i.test(next)) {
          item.descricao += " " + next;
          i++;
        }
        if (item.subelemento === null) item.subelemento = ""; // mark for user input
        itens.push(item);
      }
      i++;
    }
  }
  if (itens.length === 0) low.push("itens");
  if (itens.some(it => !it.subelemento)) low.push("subelemento");

  // ── Classification Block ──────────────────────────────────────────────────
  const totalIdx = rows.findIndex(r => /^TOTAL:/i.test(r));
  const classRows = totalIdx >= 0 ? rows.slice(totalIdx) : rows;
  const classText = classRows.join(" ");
  const allToks = classText.split(/\s+/).map(t => t.trim()).filter(Boolean);

  // Contrato: C followed by 5 digits
  const contrato = classText.match(/\b(C\d{5})\b/)?.[1] ?? "";

  // Número Processo: NNNNN.NNNNNN/AAAA-NN
  const numeroProcesso = text.match(/\b(\d{5}\.\d{6}\/\d{4}-\d{2})\b/)?.[1] ?? "";
  if (!numeroProcesso) low.push("numeroProcesso");

  // Format-based extraction (tolerant of label/value order swap in PDF)
  let nd = "", ptres = "", ugr = "", fonte = "", numeroCompra = "", pi = "", codemp = "";

  for (const t of allToks) {
    if (t.includes(":") || t.length < 4) continue;
    if (!nd  && /^[34]\d{5}$/.test(t))          { nd = t; continue; }
    if (!ugr && /^12\d{4}$/.test(t))            { ugr = t; continue; }
    if (!pi  && /^[A-Z]{2}\d{9}$/.test(t))      { pi = t; continue; }
    if (!numeroCompra && /^\d{5}\/\d{4}$/.test(t)) { numeroCompra = t; continue; }
    if (!fonte && /^\d{10}$/.test(t))            { fonte = t; continue; }
    if (!codemp && /[A-Z0-9]+\$/.test(t))        { codemp = t; continue; }
    if (!ptres && /^\d{6}$/.test(t) && t !== nd && t !== ugr) { ptres = t; continue; }
  }

  if (!nd) low.push("nd");
  if (!ptres) low.push("ptres");
  if (!pi) low.push("pi");
  if (!ugr) low.push("ugr");
  if (!numeroCompra) low.push("numeroCompra");

  // ── OBS ───────────────────────────────────────────────────────────────────
  const observacaoPDF = text.match(/OBS:\s*(.+?)(?:\n|MINIST|COMANDO|$)/s)?.[1]?.trim() ?? "";

  // ── Derived ───────────────────────────────────────────────────────────────
  const tipoOrigem: "compra" | "contrato" | "ambiguo" =
    numeroCompra ? "compra" : contrato ? "contrato" : "ambiguo";

  // compras que começam com 90 = Pregão (valor 76 no select do Comprasnet)
  const modalidade = /^90\d{3}\//.test(numeroCompra) ? "76" : "";
  if (!modalidade) low.push("modalidade");

  const descricaoObservacao = `Solicitação de empenho ${numeroSolicitacao}. OBS: ${observacaoPDF}`;
  const totalEmpenho = itens.reduce((s, it) => s + it.valorTotal, 0);

  return {
    _md5: md5,
    _arquivo: file.name,
    _lowConf: low,
    _total: totalEmpenho,
    numeroSolicitacao,
    dataImpressao,
    localEntrega,
    compradora: "GAP-MN",
    fornecedorCNPJ,
    fornecedorNome,
    itens,
    contrato,
    nd,
    ptres,
    pi,
    ugr,
    numeroCompra,
    fonte,
    codemp,
    numeroProcesso,
    observacaoPDF,
    tipoOrigem,
    modalidade,
    descricaoObservacao,
  };
}

// ── Item row parser ───────────────────────────────────────────────────────────
// Row format (left→right in PDF): DESC ITEM REQ [SUB] REF QUANT UNID UNIT TOTAL
// In plain text (Ctrl+A or pdfjs flat), they appear concatenated in that order.
const UNIT_CODES = /^(CX|UN|PC|KG|LT|MT|RL|FD|GR|ML|PT|PK|JS|CJ|AMP|FR|CO|FX|TP|SC|BL|BD|VD|CT|TU|TB|MG|MR|MO|PR|SG|GD|MC|DZ|GV|UC|IT|BI|TN|GL|VL|GL|PÇ|PA|JG|BX|FL|EM)$/;

function parseItemRow(row: string): ItemEmpenho | null {
  const tokens = row.trim().split(/\s+/);
  if (tokens.length < 8) return null;

  // Find UNID: 2-3 uppercase-letter token in the middle range
  let unidIdx = -1;
  for (let i = tokens.length - 3; i >= 4; i--) {
    if (UNIT_CODES.test(tokens[i])) { unidIdx = i; break; }
  }
  // Fallback: any 2-3 uppercase alpha token not at edges
  if (unidIdx === -1) {
    for (let i = tokens.length - 3; i >= 4; i--) {
      if (/^[A-Z]{2,3}$/.test(tokens[i])) { unidIdx = i; break; }
    }
  }
  if (unidIdx < 3 || unidIdx > tokens.length - 3) return null;

  const unidade    = tokens[unidIdx];
  const quantStr   = tokens[unidIdx - 1];
  const unitStr    = tokens[unidIdx + 1];
  const totalStr   = tokens[unidIdx + 2];

  if (!quantStr?.match(/^[\d,]+$/) || !unitStr?.match(/^[\d,]+$/) || !totalStr?.match(/^[\d.,]+$/)) {
    return null;
  }

  // Tokens before QUANT: ...DESC ITEM REQ [SUB] REF
  const before = tokens.slice(0, unidIdx - 1);

  // ITEM: last pure integer token in `before`
  let itemIdx = -1;
  for (let j = before.length - 1; j >= 1; j--) {
    if (/^\d{1,4}$/.test(before[j])) { itemIdx = j; break; }
  }
  if (itemIdx < 1) return null;

  const numeroItem = parseInt(before[itemIdx], 10);
  const descricao  = before.slice(0, itemIdx).join(" ").trim();
  const after      = before.slice(itemIdx + 1); // REQ [SUB] REF

  // REQ: first alphanumeric starting with a letter
  const reqToken = after.find(t => /^[A-Z][A-Z0-9]+$/.test(t)) ?? "";
  const reqPos   = after.findIndex(t => t === reqToken);

  // REF: second alphanumeric starting with a letter (after REQ)
  const afterReq = reqPos >= 0 ? after.slice(reqPos + 1) : [];
  const refToken = afterReq.find(t => /^[A-Z][A-Z0-9]+$/.test(t)) ?? "";

  // SUB: pure 1-2 digit number between REQ and REF
  const subToken = afterReq.find(t => /^\d{1,2}$/.test(t)) ?? null;

  if (!descricao || isNaN(numeroItem)) return null;

  return {
    numeroItem,
    requisicao: reqToken,
    subelemento: subToken,
    descricao,
    ref: refToken,
    quantidade: parseBR(quantStr),
    unidade,
    valorUnitario: parseBR(unitStr),
    valorTotal: parseBR(totalStr),
  };
}
