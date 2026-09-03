import { useState, useEffect, useMemo, useRef } from "react";
import { supabase } from "../lib/supabase";
import { Card } from "./Card";
import * as XLSX from "xlsx";
import TermoApostilamentoContrato from "./TermoApostilamentoContrato";
import { fetchCSV, toExecucaoLinhas, toRPNEs, normalizeNE, type ExecucaoLinha, type LinhaRPNE, SHEET_URLS } from "../lib/gsheets";
import * as pdfjsLib from "pdfjs-dist";
pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/build/pdf.worker.min.mjs",
  import.meta.url,
).toString();

// ─── Tipos ────────────────────────────────────────────────────────────────────
type Contrato = {
  id: string;
  numero_contrato: string;
  uge: string | null;
  ugr: string | null;
  status: string | null;
  acao: string | null;
  tipo: string | null;
  moeda: string | null;
  vl_contratual: number | null;
  vl_a_empenhar: number | null;
  vl_empenhado: number | null;
  vl_liquidado: number | null;
  saldo: number | null;
  data_inicio: string | null;
  data_final: string | null;
  fornecedor: string | null;
  tipo_objeto: string | null;
  rcd: string | null;
  pressup: string | null;
  pag_nup: string | null;
  descricao: string | null;
  prazo_fin_1: string | null;
  prazo_fin_2: string | null;
  cnpj: string | null;
  fiscal: string | null;
  data_orcamento: string | null;
  vl_atual: number | null;
  fonte: string;
  created_at: string;
};

type ContratoDoc = {
  id: string;
  numero_contrato: string;
  tipo: "contrato" | "tr" | "aditivo" | "apostilamento";
  nome: string;
  url: string | null;
  user_nome: string | null;
  created_at: string;
  deleted_at: string | null;
  deleted_by_nome: string | null;
};

type Reajuste = {
  id: string;
  contrato_id: string;
  tipo_doc: string;
  tipo_alteracao: string;
  objeto_doc: string | null;
  percentual: number | null;
  valor_anterior: number | null;
  valor_novo: number | null;
  data_fim_anterior: string | null;
  data_fim_nova: string | null;
  meses_acrescidos: number | null;
  user_nome: string | null;
  created_at: string;
};

type ReajusteForm = {
  tipo_doc: string;
  tipo_alteracao: string;
  objeto_doc: string;
  percentual: string;
  valor_anterior: string;
  valor_novo: string;
  data_fim_anterior: string;
  data_fim_nova: string;
  meses_acrescidos: string;
  texto_pdf: string;
};

// ─── Helpers ──────────────────────────────────────────────────────────────────
function fmtMoney(v: number | null | undefined): string {
  if (v === null || v === undefined) return "–";
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(v);
}

function fmtDate(d: string | null | undefined): string {
  if (!d) return "–";
  try { return new Date(d + "T12:00:00").toLocaleDateString("pt-BR"); }
  catch { return d; }
}

function toNum(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "number") return isNaN(v) ? null : v;
  const s = String(v)
    .replace(/R\$\s?/g, "")
    .replace(/\s/g, "")
    .replace(/\.(?=\d{3})/g, "")   // remove thousand separators (pt-BR)
    .replace(",", ".")
    .trim();
  const n = parseFloat(s);
  return isNaN(n) ? null : n;
}

function isVencido(dataFinal: string | null | undefined): boolean {
  if (!dataFinal) return false;
  const hoje = new Date();
  hoje.setHours(0, 0, 0, 0);
  const fim = new Date(dataFinal + "T12:00:00");
  return fim < hoje;
}

function proxReajusteDate(dataOrcamento: string | null | undefined): Date | null {
  if (!dataOrcamento) return null;
  const d = new Date(dataOrcamento + "T12:00:00");
  if (isNaN(d.getTime())) return null;
  return new Date(d.getFullYear(), d.getMonth() + 12, 1);
}
function fmtProxReajuste(dataOrcamento: string | null | undefined): string {
  const d = proxReajusteDate(dataOrcamento);
  if (!d) return "–";
  return d.toLocaleDateString("pt-BR", { month: "2-digit", year: "numeric" });
}
function diasReajuste(dataOrcamento: string | null | undefined): number | null {
  const d = proxReajusteDate(dataOrcamento);
  if (!d) return null;
  return Math.round((d.getTime() - Date.now()) / 86400000);
}

function toDateStr(v: unknown): string | null {
  if (v === null || v === undefined || v === "") return null;
  if (v instanceof Date) {
    const y = v.getFullYear();
    if (y < 1900 || y > 2100) return null;
    const m = String(v.getMonth() + 1).padStart(2, "0");
    const d = String(v.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }
  const s = String(v).trim();
  const br = s.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
  if (br) return `${br[3]}-${br[2]}-${br[1]}`;
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return s.slice(0, 10);
  return null;
}

function normH(s: string): string {
  return s
    .normalize("NFD")                    // decompõe: Ç → C + cedilha, Ã → A + til, etc.
    .replace(/[\u0300-\u036f]/g, "")     // remove as marcas de acentuação
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");          // remove tudo que não é letra ou dígito
}

function colIdx(headers: string[], ...candidates: string[]): number {
  const nh = headers.map(normH);
  for (const c of candidates) {
    const n = normH(c);
    const i = nh.findIndex((h) => h.includes(n));
    if (i !== -1) return i;
  }
  return -1;
}

function parseExcelBuffer(buf: ArrayBuffer): Partial<Contrato>[] {
  const wb = XLSX.read(buf, { type: "array", cellDates: true });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const raw: unknown[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" });

  // Encontra a linha de cabeçalho — procura a linha que contém mais palavras-chave conhecidas
  // (robusto para variações de encoding, acentos ou nomes ligeiramente diferentes)
  const HEADER_KEYWORDS = ["uge", "ugr", "status", "moeda", "saldo", "cnpj", "numero", "numer", "tipo", "inicio", "final"];
  let hIdx = -1;
  let bestScore = 0;
  for (let i = 0; i < Math.min(raw.length, 8); i++) {
    const row = (raw[i] ?? []) as unknown[];
    const normalizedCells = row.map((c) => normH(String(c)));
    const score = HEADER_KEYWORDS.filter((k) =>
      normalizedCells.some((n) => n.includes(k))
    ).length;
    if (score > bestScore) { bestScore = score; hIdx = i; }
  }
  // Fallback: se nenhuma linha tiver pelo menos 3 keywords, assume que a linha 1 é o cabeçalho
  if (bestScore < 3) {
    hIdx = raw.length >= 2 ? 1 : 0;
  }
  if (hIdx === -1 || raw.length <= hIdx + 1) return [];

  const headers = (raw[hIdx] as string[]).map(String);
  const nh = headers.map(normH);

  const idx: Record<string, number> = {
    // "NUMERO" pode vir como "Nº", "N°", "NUMERO", "NÚMERO" — tenta várias formas e cai no col 0
    numero:        colIdx(headers, "numero", "numer", "n") !== -1
                     ? colIdx(headers, "numero", "numer", "n")
                     : 0,
    uge:           colIdx(headers, "uge"),
    ugr:           colIdx(headers, "ugr"),
    status:        colIdx(headers, "status"),
    acao:          colIdx(headers, "acao", "ação"),
    tipo:          colIdx(headers, "tipo"),
    moeda:         colIdx(headers, "moeda"),
    // "contratual" é o nome mais comum; "vl contrato" / "vlcontrato" cobre planilhas com "VL CONTRATO"
    vl_contratual: colIdx(headers, "vl contrato", "vlcontrato", "contratual", "contratado", "original"),
    vl_a_empenhar: colIdx(headers, "aemp", "empenhar"),
    vl_empenhado:  colIdx(headers, "empenhado"),
    vl_liquidado:  colIdx(headers, "liquidado"),
    saldo:         colIdx(headers, "saldo"),
    data_inicio:   colIdx(headers, "inicio", "vigini", "vigencinicio"),
    data_final:    colIdx(headers, "final", "termino", "vigfin", "vigencfin"),
    fornecedor:    colIdx(headers, "fornec", "contratad", "razaosocial"),
    tipo_objeto:   colIdx(headers, "tipoobj"),
    rcd:           colIdx(headers, "rcd"),
    pressup:       colIdx(headers, "pressup"),
    pag_nup:       colIdx(headers, "pag", "nup", "processo"),
    // "objeto" também aparece em "TIPO OBJETO" — excluímos colunas com "tipo" para evitar colisão
    // Também cobre: ESPECIALIDADE, ESPECIFICAÇÃO, RESUMO, EMENTA, SERVIÇO, ÁREA, CATEGORIA
    descricao:     (() => {
      const kws = [
        "descricao", "descric",
        "especiali", "especif",
        "resumo", "ementa",
        "servico", "servic",
        "area", "categoria",
        "objeto",
      ];
      for (const kw of kws) {
        const n = normH(kw);
        const i = nh.findIndex((h) => h.includes(n) && !h.includes("tipo"));
        if (i !== -1) return i;
      }
      return -1;
    })(),
    cnpj:          colIdx(headers, "cnpj", "cpfcnpj"),
    prazo_fin_1:   -1,
    prazo_fin_2:   -1,
  };

  // Duas colunas "PRAZO FIN" com o mesmo nome
  let foundPrazo = false;
  for (let i = 0; i < nh.length; i++) {
    if (nh[i].includes("prazofin")) {
      if (!foundPrazo) { idx.prazo_fin_1 = i; foundPrazo = true; }
      else { idx.prazo_fin_2 = i; break; }
    }
  }

  // ── DEBUG: abre F12 → Console para ver os cabeçalhos detectados e o mapeamento ──
  console.log(
    "[GAP-MN Import] Cabeçalhos detectados:\n" +
    headers.map((h, i) => `  [${i}] "${h}" → normH: "${nh[i]}"`).join("\n")
  );
  console.log("[GAP-MN Import] Mapeamento de colunas:", {
    numero: idx.numero, uge: idx.uge, ugr: idx.ugr,
    descricao: idx.descricao === -1 ? "NÃO ENCONTRADO" : idx.descricao,
    vl_contratual: idx.vl_contratual === -1 ? "NÃO ENCONTRADO" : idx.vl_contratual,
    fornecedor: idx.fornecedor, saldo: idx.saldo,
    data_inicio: idx.data_inicio, data_final: idx.data_final,
    cnpj: idx.cnpj, pag_nup: idx.pag_nup,
  });

  const rows: Partial<Contrato>[] = [];
  for (let i = hIdx + 1; i < raw.length; i++) {
    const row = raw[i] as unknown[];
    const num = String(row[idx.numero] ?? "").trim();
    if (!num) continue;

    const get = (key: string): unknown => idx[key] !== -1 ? row[idx[key]] : "";
    const str = (key: string): string | null => {
      const v = String(get(key) ?? "").trim();
      return v || null;
    };

    rows.push({
      numero_contrato: num,
      uge:             str("uge"),
      ugr:             str("ugr"),
      status:          str("status"),
      acao:            str("acao"),
      tipo:            str("tipo"),
      moeda:           str("moeda") ?? "R$",
      vl_contratual:   toNum(get("vl_contratual")),
      vl_a_empenhar:   toNum(get("vl_a_empenhar")),
      vl_empenhado:    toNum(get("vl_empenhado")),
      vl_liquidado:    toNum(get("vl_liquidado")),
      saldo:           toNum(get("saldo")),
      data_inicio:     toDateStr(get("data_inicio")),
      data_final:      toDateStr(get("data_final")),
      fornecedor:      str("fornecedor"),
      tipo_objeto:     str("tipo_objeto"),
      rcd:             str("rcd"),
      pressup:         str("pressup"),
      pag_nup:         str("pag_nup"),
      descricao:       str("descricao"),
      prazo_fin_1:     idx.prazo_fin_1 !== -1 ? String(row[idx.prazo_fin_1] ?? "").trim() || null : null,
      prazo_fin_2:     idx.prazo_fin_2 !== -1 ? String(row[idx.prazo_fin_2] ?? "").trim() || null : null,
      cnpj:            str("cnpj"),
      fonte:           "EXCEL",
    });
  }

  return rows;
}

// ─── PDF extração ────────────────────────────────────────────────────────────
async function extractPdfText(file: File): Promise<string> {
  const buf = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: buf }).promise;
  let text = "";
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    text += content.items.map((item: any) => item.str).join(" ") + "\n";
  }
  return text;
}

function parseReajustePdf(text: string, contrato: Contrato): ReajusteForm {
  const t = text;

  // Tipo do documento
  let tipo_doc = "Termo Aditivo";
  if (/APOSTILAMENTO/i.test(t)) tipo_doc = "Apostilamento";
  else if (/TERMO\s+ADITIVO/i.test(t)) tipo_doc = "Termo Aditivo";

  // Objeto/ementa
  let objeto_doc = "";
  const objM = t.match(/(?:CL[AÁ]USULA\s+PRIMEIRA\s*[-–—]\s*DO\s+OBJETO|OBJETO\s*[:–—]|DO\s+OBJETO\s*[:–—]?)\s+([\s\S]{10,400}?)(?:\s{2,}|\n\n|\nCL[AÁ]USULA|\nART\.)/i);
  if (objM) objeto_doc = objM[1].replace(/\s+/g, " ").trim().slice(0, 300);

  // Percentual
  let percentual = "";
  const pctM =
    t.match(/(?:acr[eé]scimo|reajuste|majora[çc][aã]o|aumento)\s+de\s+(\d+[,.]?\d*)\s*%/i) ||
    t.match(/(\d+[,.]?\d*)\s*%\s*(?:de\s+acr[eé]scimo|de\s+reajuste|ao\s+ano)/i);
  if (pctM) percentual = pctM[1].replace(",", ".");

  // Meses acrescidos
  let meses_acrescidos = "";
  const mesM =
    t.match(/(?:prorrog(?:a[çc][aã]o|ado)\s+(?:por\s+mais\s+|de\s+)?|acr[eé]scimo\s+de\s+)(\d+)\s*(?:\([^)]+\)\s*)?m[eê]s(?:es)?/i) ||
    t.match(/(\d+)\s*(?:\([^)]+\)\s*)?m[eê]s(?:es)?\s+(?:de\s+)?(?:prazo|prorrog)/i);
  if (mesM) meses_acrescidos = mesM[1];

  // Nova data final
  let data_fim_nova = "";
  const dtM =
    t.match(/(?:nova\s+(?:data|vigência)|vigência\s+(?:até|para|de)|prazo\s+(?:até|para)|prorrogado\s+até|até\s+o\s+dia)\s*:?\s*(\d{2}\/\d{2}\/\d{4})/i) ||
    t.match(/(\d{2}\/\d{2}\/\d{4})\s*(?:,\s*nova\s+data|,\s*data\s+de\s+encerramento)/i);
  if (dtM) {
    const [dd, mm, yyyy] = dtM[1].split("/");
    data_fim_nova = `${yyyy}-${mm}-${dd}`;
  } else if (meses_acrescidos && contrato.data_final) {
    const d = new Date(contrato.data_final + "T12:00:00");
    d.setMonth(d.getMonth() + parseInt(meses_acrescidos));
    data_fim_nova = d.toISOString().slice(0, 10);
  }

  // Novo valor explícito no texto
  let valor_novo = "";
  const vlMs = [...t.matchAll(/R\$\s*([\d.]+,\d{2})/g)].map(m => {
    const n = parseFloat(m[1].replace(/\./g, "").replace(",", "."));
    return isNaN(n) ? 0 : n;
  });
  // Pega o maior valor encontrado (provavelmente o valor total do contrato)
  if (vlMs.length) {
    const maxV = Math.max(...vlMs);
    if (maxV > 0) valor_novo = String(maxV);
  }
  // Se tiver percentual, preferir calcular a partir do valor anterior
  const valAnt = contrato.vl_atual ?? contrato.vl_contratual;
  if (percentual && valAnt != null) {
    const pct = parseFloat(percentual);
    if (!isNaN(pct)) valor_novo = String(Math.round(valAnt * (1 + pct / 100) * 100) / 100);
  }

  // Tipo de alteração
  const hasValor = !!(percentual || valor_novo);
  const hasPrazo = !!(meses_acrescidos || data_fim_nova);
  const tipo_alteracao = hasValor && hasPrazo ? "ambos" : hasPrazo ? "prazo" : "valor";

  return {
    tipo_doc,
    tipo_alteracao,
    objeto_doc,
    percentual,
    valor_anterior: valAnt != null ? String(valAnt) : "",
    valor_novo,
    data_fim_anterior: contrato.data_final ?? "",
    data_fim_nova,
    meses_acrescidos,
    texto_pdf: text.slice(0, 10000),
  };
}

// ─── Componente ───────────────────────────────────────────────────────────────
interface GerContratoProps { canImport?: boolean; canEdit?: boolean; canEditBudget?: boolean; }
export default function GerenciamentoContratos({ canImport = true, canEdit = true, canEditBudget = false }: GerContratoProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Dados
  const [contratos, setContratos] = useState<Contrato[]>([]);
  const [loading, setLoading]     = useState(true);
  const [err, setErr]             = useState<string | null>(null);

  // Previsão orçamentária
  const [mainView, setMainView]     = useState<"lista" | "previsao">("lista");
  const [gordura, setGordura]       = useState(5.1); // IPCA referência 2025
  const [prevGroupBy, setPrevGroupBy] = useState<"ugr" | "acao">("ugr");
  const [prevAno, setPrevAno]       = useState(new Date().getFullYear());
  const [prevMesFim, setPrevMesFim] = useState(12); // 1-12
  const [prevUgr, setPrevUgr]       = useState("todos");
  const [prevAcao, setPrevAcao]     = useState("todos");
  const [prevPi, setPrevPi]         = useState("todos");
  // Mapa PAG → estatísticas SIAFI — carregado da planilha quando abre Previsão
  type PagStats = { pagoByYear: Map<number, number>; aLiquidar: number };
  const [execPagMap, setExecPagMap] = useState<Map<string, PagStats>>(new Map());
  const [execPagLoaded, setExecPagLoaded] = useState(false);

  // Import
  const [preview, setPreview] = useState<{
    rows: Partial<Contrato>[];
    novos: number;
    existentes: number;
  } | null>(null);
  const [importing, setImporting]       = useState(false);
  const [clearingExcel, setClearingExcel] = useState(false);

  // Selecionado
  const [selected, setSelected] = useState<Contrato | null>(null);
  const detailRef = useRef<HTMLDivElement>(null);

  // Documentos
  const [showApt, setShowApt] = useState(false);
  type DocTab = "contrato" | "tr" | "aditivo" | "apostilamento";
  const [docTab, setDocTab] = useState<DocTab>("apostilamento");
  const [contratoDocs, setContratoDocs] = useState<ContratoDoc[]>([]);
  const [docUploading, setDocUploading] = useState(false);
  const [docMsg, setDocMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const docFileRef = useRef<HTMLInputElement>(null);
  const [pendingDocTipo, setPendingDocTipo] = useState<"contrato" | "tr">("contrato");

  // Reajustes
  const [reajustes, setReajustes] = useState<Reajuste[]>([]);
  const [reajusteParsing, setReajusteParsing] = useState(false);
  const [reajusteForm, setReajusteForm] = useState<ReajusteForm | null>(null);
  const [reajusteSaving, setReajusteSaving] = useState(false);
  const [reajusteMsg, setReajusteMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const reajusteFileRef = useRef<HTMLInputElement>(null);

  // Fiscal
  const [editingFiscal, setEditingFiscal] = useState(false);
  const [fiscalInput, setFiscalInput]     = useState("");
  const [savingFiscal, setSavingFiscal]   = useState(false);

  // Data base do orçamento
  const toMmYyyy = (d: string | null) => {
    if (!d) return "";
    const [yyyy, mm] = d.split("-");
    return mm && yyyy ? `${mm}/${yyyy}` : "";
  };
  const [orcamentoInput, setOrcamentoInput]   = useState("");
  const [savingOrcamento, setSavingOrcamento] = useState(false);
  const [orcamentoMsg, setOrcamentoMsg]       = useState<{ ok: boolean; text: string } | null>(null);

  // Valor atual do contrato (saldo ajustado — base para reajuste)
  const [vlAtualInput, setVlAtualInput]     = useState("");
  const [savingVlAtual, setSavingVlAtual]   = useState(false);
  const [vlAtualMsg, setVlAtualMsg]         = useState<{ ok: boolean; text: string } | null>(null);
  const [editandoVlAtual, setEditandoVlAtual] = useState(false);

  // Valor total do contrato (vl_contratual)
  const [editandoVlContratual, setEditandoVlContratual] = useState(false);
  const [vlContratualInput, setVlContratualInput]       = useState("");
  const [savingVlContratual, setSavingVlContratual]     = useState(false);

  // Modo de detalhe: dados (padrão) | execucao | reajustes
  type DetailMode = "dados" | "execucao" | "reajustes";
  const [detailMode, setDetailMode] = useState<DetailMode>("dados");

  // Execução — NEs do contrato carregadas do Google Sheets
  const [execLinhas, setExecLinhas]   = useState<ExecucaoLinha[]>([]);
  const [rpMap, setRpMap]             = useState<Map<string, LinhaRPNE>>(new Map());
  const [execLoading, setExecLoading] = useState(false);
  const [execExpandedNE, setExecExpandedNE] = useState<string | null>(null);

  // Rola para o painel de detalhes ao selecionar (mobile) e reseta estados de edição
  useEffect(() => {
    setEditingFiscal(false);
    setFiscalInput("");
    setOrcamentoInput(toMmYyyy(selected?.data_orcamento ?? null));
    setOrcamentoMsg(null);
    setVlAtualInput(selected?.vl_atual != null ? String(selected.vl_atual) : "");
    setVlAtualMsg(null);
    setEditandoVlAtual(false);
    setEditandoVlContratual(false);
    setVlContratualInput(selected?.vl_contratual != null ? String(selected.vl_contratual) : "");
    setReajusteForm(null);
    setDetailMode("dados");
    setExecLinhas([]);
    setRpMap(new Map());
    setExecExpandedNE(null);
    setReajusteMsg(null);
    setContratoDocs([]);
    setDocMsg(null);
    if (selected) {
      loadDocs(selected.numero_contrato);
      setTimeout(() => {
        detailRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      }, 60);
    }
  }, [selected?.id]);

  // Carrega NEs do contrato (Execução) + mapa de RP em paralelo
  useEffect(() => {
    if (detailMode !== "execucao" || !selected) return;
    setExecLoading(true);
    setExecLinhas([]);
    setRpMap(new Map());
    const pag = (selected.pag_nup ?? "").trim().replace(/[\s]/g, "").toUpperCase();
    Promise.all([
      fetchCSV(SHEET_URLS.execucao),
      fetchCSV(SHEET_URLS.rpNE),
    ]).then(([execRows, rpRows]) => {
      // Filtra NEs do contrato pela planilha de execução
      const { linhas } = toExecucaoLinhas(execRows);
      const filtered = pag
        ? linhas.filter((l) => l.info_g.replace(/[\s]/g, "").toUpperCase() === pag)
        : [];

      // Constrói mapa de RP
      const rps = toRPNEs(rpRows);
      const map = new Map<string, LinhaRPNE>();
      rps.forEach((r) => map.set(normalizeNE(r.ne), r));

      // Adiciona NEs que existem APENAS no RP (não na planilha de execução)
      // Ex: NE já liquidada/paga em exercício anterior — não consta mais na execução corrente
      if (pag) {
        const execNEs = new Set(filtered.map((l) => normalizeNE(l.nota_empenho)));
        for (const rp of rps) {
          const rpPag = rp.processo.replace(/[\s]/g, "").toUpperCase();
          if (rpPag !== pag) continue;
          if (execNEs.has(normalizeNE(rp.ne))) continue; // já presente
          // Linha sintética: valores de execução = 0, RP será resolvido via rpMap
          filtered.push({
            pi:              rp.pi ?? "",
            pi_desc:         "",
            unidade:         rp.ugr_nome,
            nota_empenho:    rp.ne,
            info_d:          "",
            info_e:          rp.favorecido,
            info_f:          rp.descricao,
            info_g:          rp.processo,
            a_liquidar:      0,
            liquidado_pagar: 0,
            pago:            0,
          });
        }
      }

      setExecLinhas(filtered);
      setRpMap(map);
      setExecLoading(false);
    }).catch(() => setExecLoading(false));
  }, [detailMode, selected?.id]);

  // Carrega histórico de reajustes do contrato selecionado
  useEffect(() => {
    if (!selected?.id) { setReajustes([]); return; }
    supabase
      .from("contratos_reajustes")
      .select("*")
      .eq("contrato_id", selected.id)
      .order("created_at", { ascending: false })
      .then(({ data }) => setReajustes((data ?? []) as Reajuste[]));
  }, [selected?.id]);

  // Cadastro manual
  const [showCadastro, setShowCadastro] = useState(false);
  const [form, setForm] = useState({
    numero_contrato: "", uge: "", ugr: "", descricao: "", fornecedor: "",
    cnpj: "", vl_contratual: "", vl_a_empenhar: "", vl_empenhado: "",
    vl_liquidado: "", saldo: "", data_inicio: "", data_final: "", status: "Vigente",
    pag_nup: "", tipo: "", acao: "",
  });
  const [savingForm, setSavingForm] = useState(false);

  // Filtros
  const [filtroTexto, setFiltroTexto]     = useState("");
  const [filtroStatus, setFiltroStatus]   = useState("todos");
  const [filtroAno, setFiltroAno]         = useState("todos");
  const [filtroUgr, setFiltroUgr]         = useState("todos");
  const [filtroFiscal, setFiltroFiscal]   = useState("todos");
  const [filtroPi, setFiltroPi]           = useState("todos");
  const [sortBy, setSortBy]               = useState<"none" | "saldo_asc" | "saldo_desc" | "liquidar_asc" | "liquidar_desc" | "vencimento_asc" | "reajuste_asc">("none");

  // Mapa PAG → PIs (pode ser vários por contrato) derivado da planilha de empenhos
  const [piByPag, setPiByPag]             = useState<Map<string, string[]>>(new Map());
  const [piDescMap, setPiDescMap]         = useState<Map<string, string>>(new Map());

  // ── Carga ────────────────────────────────────────────────────────────────
  useEffect(() => { load(); }, []);

  // Mapa PAG→PIs: carrega planilha de execução (col A=PI, col H=PAG) — coleta TODOS os PIs por PAG
  useEffect(() => {
    fetchCSV(SHEET_URLS.execucao).then((rows) => {
      const { linhas } = toExecucaoLinhas(rows);
      const setMap  = new Map<string, Set<string>>();
      const descMap = new Map<string, string>();
      linhas.forEach((l) => {
        if (l.pi && l.info_g) {
          const key = l.info_g.trim().replace(/\s/g, "").toUpperCase();
          const piSet = setMap.get(key) ?? new Set<string>();
          piSet.add(l.pi);
          setMap.set(key, piSet);
          if (l.pi_desc) descMap.set(l.pi, l.pi_desc);
        }
      });
      const arrMap = new Map<string, string[]>();
      setMap.forEach((s, key) => arrMap.set(key, [...s].sort()));
      setPiByPag(arrMap);
      setPiDescMap(descMap);
    }).catch(() => {});
  }, []);

  // Carrega execução SIAFI quando o usuário abre a aba Previsão
  useEffect(() => {
    if (mainView !== "previsao" || execPagLoaded) return;
    setExecPagLoaded(true);
    Promise.all([
      fetchCSV(SHEET_URLS.execucao),
      fetchCSV(SHEET_URLS.rpNE),
    ]).then(([execRows, rpRows]) => {
      const { linhas } = toExecucaoLinhas(execRows);
      const rpList = toRPNEs(rpRows);
      const pagMap = new Map<string, PagStats>();

      const getS = (rawPag: string): PagStats => {
        const key = rawPag.trim().replace(/\s/g, "").toUpperCase();
        if (!pagMap.has(key)) pagMap.set(key, { pagoByYear: new Map(), aLiquidar: 0 });
        return pagMap.get(key)!;
      };

      // Execução: acumula pago+liquidado_pagar por ano da NE, e soma a_liquidar atual
      for (const l of linhas) {
        if (!l.info_g) continue;
        const s = getS(l.info_g);
        if (l.a_liquidar > 0) s.aLiquidar += l.a_liquidar;
        const match = l.nota_empenho.match(/^(\d{4})NE/i);
        if (!match) continue;
        const v = l.pago + l.liquidado_pagar;
        if (v > 0) {
          const yr = parseInt(match[1]);
          s.pagoByYear.set(yr, (s.pagoByYear.get(yr) ?? 0) + v);
        }
      }

      // RP: pago de NEs de anos anteriores → atribuído ao ano de origem da NE
      //     rp_nao_proc_a_liq → ainda disponível para pagar faturas futuras (soma ao aLiquidar)
      for (const rp of rpList) {
        if (!rp.processo) continue;
        const s = getS(rp.processo);
        // Saldo de RP disponível para liquidar faturas futuras
        if ((rp.rp_nao_proc_a_liq ?? 0) > 0) s.aLiquidar += rp.rp_nao_proc_a_liq;
        // Pagamentos de RP → histórico do ano de origem da NE
        const match = rp.ne.match(/^(\d{4})NE/i);
        if (!match) continue;
        const rpPago = (rp.rp_nao_proc_pago ?? 0) + (rp.rp_proc_pagos ?? 0);
        if (rpPago > 0) {
          const yr = parseInt(match[1]);
          s.pagoByYear.set(yr, (s.pagoByYear.get(yr) ?? 0) + rpPago);
        }
      }

      setExecPagMap(pagMap);
    }).catch(() => {});
  }, [mainView, execPagLoaded]);

  async function load() {
    setLoading(true);
    setErr(null);
    const { data, error } = await supabase
      .from("contratos_scon")
      .select("*")
      .order("data_inicio", { ascending: false });
    if (error) setErr(error.message);
    else setContratos((data ?? []) as Contrato[]);
    setLoading(false);
  }

  // ── Documentos do contrato ────────────────────────────────────────────────
  async function loadDocs(numeroContrato: string) {
    const { data } = await supabase
      .from("contratos_docs")
      .select("*")
      .eq("numero_contrato", numeroContrato)
      .is("deleted_at", null)
      .order("created_at", { ascending: false });
    setContratoDocs((data ?? []) as ContratoDoc[]);
  }

  async function handleDocUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file || !selected) return;
    setDocUploading(true);
    setDocMsg(null);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      const { data: profile } = await supabase.from("profiles").select("nome_guerra").eq("id", user?.id ?? "").maybeSingle();
      const safeName = file.name.replace(/[^\w.\-]/g, "_");
      const path = `${selected.numero_contrato}/${pendingDocTipo}/${Date.now()}_${safeName}`;
      const { error: upErr } = await supabase.storage.from("contratos-docs").upload(path, file, { upsert: false });
      if (upErr) throw upErr;
      const { data: { publicUrl } } = supabase.storage.from("contratos-docs").getPublicUrl(path);
      const { error } = await supabase.from("contratos_docs").insert({
        numero_contrato: selected.numero_contrato,
        tipo: pendingDocTipo,
        nome: file.name,
        url: publicUrl,
        user_id: user?.id ?? null,
        user_nome: (profile as any)?.nome_guerra ?? user?.email ?? "Usuário",
      });
      if (error) throw error;
      setDocMsg({ ok: true, text: "Documento salvo com sucesso." });
      await loadDocs(selected.numero_contrato);
    } catch (e: any) {
      setDocMsg({ ok: false, text: e?.message ?? "Erro ao salvar documento." });
    } finally {
      setDocUploading(false);
    }
  }

  async function handleDocDelete(docId: string) {
    if (!window.confirm("Remover este documento do contrato?")) return;
    const { data: { user } } = await supabase.auth.getUser();
    const { data: profile } = await supabase.from("profiles").select("nome_guerra").eq("id", user?.id ?? "").maybeSingle();
    await supabase.from("contratos_docs").update({
      deleted_at: new Date().toISOString(),
      deleted_by_id: user?.id ?? null,
      deleted_by_nome: (profile as any)?.nome_guerra ?? "Usuário",
    }).eq("id", docId);
    if (selected) await loadDocs(selected.numero_contrato);
  }

  // ── Selecionar arquivo ───────────────────────────────────────────────────
  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setErr(null);
    setPreview(null);
    try {
      const buf = await file.arrayBuffer();
      const rows = parseExcelBuffer(buf);
      if (rows.length === 0) {
        setErr("Nenhum dado encontrado. Verifique se o arquivo tem a linha de cabeçalho com 'NUMERO'.");
        return;
      }
      const existingNums = new Set(contratos.map((c) => c.numero_contrato));
      const novos = rows.filter((r) => r.numero_contrato && !existingNums.has(r.numero_contrato));
      setPreview({ rows: novos, novos: novos.length, existentes: rows.length - novos.length });
    } catch (e: any) {
      setErr(e?.message ?? "Erro ao ler arquivo.");
    }
    e.target.value = "";
  }

  // ── Importar ─────────────────────────────────────────────────────────────
  async function handleImport() {
    if (!preview || preview.rows.length === 0) return;
    setImporting(true);
    setErr(null);
    try {
      // Inserir em lotes de 100 para evitar payload muito grande
      const lote = 100;
      for (let i = 0; i < preview.rows.length; i += lote) {
        const { error } = await supabase
          .from("contratos_scon")
          .insert(preview.rows.slice(i, i + lote) as any[]);
        if (error) throw error;
      }
      setPreview(null);
      await load();
    } catch (e: any) {
      setErr(e?.message ?? "Erro ao importar.");
    } finally {
      setImporting(false);
    }
  }

  // ── Cadastro manual ──────────────────────────────────────────────────────
  async function saveManual() {
    if (!form.numero_contrato.trim()) return;
    setSavingForm(true);
    setErr(null);
    try {
      const { error } = await supabase.from("contratos_scon").insert({
        numero_contrato: form.numero_contrato.trim(),
        uge:             form.uge.trim() || null,
        ugr:             form.ugr.trim() || null,
        descricao:       form.descricao.trim() || null,
        fornecedor:      form.fornecedor.trim() || null,
        cnpj:            form.cnpj.trim() || null,
        vl_contratual:   toNum(form.vl_contratual),
        vl_a_empenhar:   toNum(form.vl_a_empenhar),
        vl_empenhado:    toNum(form.vl_empenhado),
        vl_liquidado:    toNum(form.vl_liquidado),
        saldo:           toNum(form.saldo),
        data_inicio:     form.data_inicio || null,
        data_final:      form.data_final || null,
        status:          form.status.trim() || null,
        pag_nup:         form.pag_nup.trim() || null,
        tipo:            form.tipo.trim() || null,
        acao:            form.acao.trim() || null,
        fonte:           "MANUAL",
      });
      if (error) throw error;
      setForm({
        numero_contrato: "", uge: "", ugr: "", descricao: "", fornecedor: "",
        cnpj: "", vl_contratual: "", vl_a_empenhar: "", vl_empenhado: "",
        vl_liquidado: "", saldo: "", data_inicio: "", data_final: "", status: "Vigente",
        pag_nup: "", tipo: "", acao: "",
      });
      setShowCadastro(false);
      await load();
    } catch (e: any) {
      setErr(e?.message ?? "Erro ao salvar.");
    } finally {
      setSavingForm(false);
    }
  }

  // ── Limpar registros importados do Excel ────────────────────────────────
  async function clearExcelContratos() {
    const excelCount = contratos.filter((c) => c.fonte === "EXCEL").length;
    if (excelCount === 0) { setErr("Não há contratos importados via Excel para remover."); return; }
    if (!window.confirm(
      `Remover ${excelCount} contrato${excelCount !== 1 ? "s" : ""} importado${excelCount !== 1 ? "s" : ""} via Excel?\n\n` +
      `Os contratos cadastrados manualmente NÃO serão afetados.\n\n` +
      `Documentos anexados (TR, Termo de Contrato, Aditivos, Apostilamentos) são preservados e reaparecerão ao reimportar.\n\n` +
      `Após confirmar, importe novamente a planilha para recarregar os dados corrigidos.`
    )) return;
    setClearingExcel(true);
    setErr(null);
    try {
      const { error } = await supabase.from("contratos_scon").delete().eq("fonte", "EXCEL");
      if (error) throw error;
      setSelected(null);
      await load();
    } catch (e: any) {
      setErr(e?.message ?? "Erro ao remover contratos importados.");
    } finally {
      setClearingExcel(false);
    }
  }

  // ── Excluir ──────────────────────────────────────────────────────────────
  async function deleteContrato(c: Contrato) {
    if (!window.confirm(`Excluir o contrato "${c.numero_contrato}"? Esta ação não pode ser desfeita.`)) return;
    setErr(null);
    const { error } = await supabase.from("contratos_scon").delete().eq("id", c.id);
    if (error) setErr(error.message);
    else {
      setSelected(null);
      setContratos((prev) => prev.filter((x) => x.id !== c.id));
    }
  }

  // ── Salvar fiscal ────────────────────────────────────────────────────────
  async function saveFiscal() {
    if (!selected) return;
    setSavingFiscal(true);
    const novoFiscal = fiscalInput.trim() || null;
    const { error } = await supabase
      .from("contratos_scon")
      .update({ fiscal: novoFiscal })
      .eq("id", selected.id);
    if (!error) {
      const atualizado = { ...selected, fiscal: novoFiscal };
      setSelected(atualizado);
      setContratos((prev) => prev.map((c) => c.id === selected.id ? atualizado : c));
      setEditingFiscal(false);
    }
    setSavingFiscal(false);
  }

  async function saveOrcamento() {
    if (!selected) return;
    const v = orcamentoInput.trim();
    if (!/^\d{2}\/\d{4}$/.test(v)) {
      setOrcamentoMsg({ ok: false, text: "Formato inválido. Use MM/AAAA." });
      return;
    }
    const [mm, yyyy] = v.split("/");
    const dbDate = `${yyyy}-${mm}-01`;
    setSavingOrcamento(true);
    setOrcamentoMsg(null);
    const { error } = await supabase.rpc("set_contrato_data_orcamento", {
      p_id: selected.id,
      p_data_orcamento: dbDate,
    });
    setSavingOrcamento(false);
    if (error) {
      setOrcamentoMsg({ ok: false, text: `Erro: ${error.message}` });
    } else {
      const atualizado = { ...selected, data_orcamento: dbDate };
      setSelected(atualizado);
      setContratos((prev) => prev.map((c) => c.id === selected.id ? atualizado : c));
      setOrcamentoMsg({ ok: true, text: "Salvo!" });
      setTimeout(() => setOrcamentoMsg(null), 3000);
    }
  }

  async function saveVlAtual() {
    if (!selected) return;
    const v = toNum(vlAtualInput);
    if (v === null) { setVlAtualMsg({ ok: false, text: "Valor inválido." }); return; }
    setSavingVlAtual(true);
    setVlAtualMsg(null);
    const { error } = await supabase.from("contratos_scon").update({ vl_atual: v }).eq("id", selected.id);
    setSavingVlAtual(false);
    if (error) {
      setVlAtualMsg({ ok: false, text: `Erro: ${error.message}` });
    } else {
      const atualizado = { ...selected, vl_atual: v };
      setSelected(atualizado);
      setContratos((prev) => prev.map((c) => c.id === selected.id ? atualizado : c));
      setVlAtualMsg({ ok: true, text: "Salvo!" });
      setEditandoVlAtual(false);
      setTimeout(() => setVlAtualMsg(null), 3000);
    }
  }

  async function saveVlContratual() {
    if (!selected) return;
    const v = toNum(vlContratualInput);
    if (v === null) return;
    setSavingVlContratual(true);
    const { error } = await supabase.from("contratos_scon").update({ vl_contratual: v }).eq("id", selected.id);
    setSavingVlContratual(false);
    if (!error) {
      const atualizado = { ...selected, vl_contratual: v };
      setSelected(atualizado);
      setContratos((prev) => prev.map((c) => c.id === selected.id ? atualizado : c));
      setEditandoVlContratual(false);
    }
  }

  // ── Reajuste: parse PDF ────────────────────────────────────────────────
  async function handleReajustePdf(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || !selected) return;
    e.target.value = "";
    setReajusteParsing(true);
    setReajusteMsg(null);
    try {
      const text = await extractPdfText(file);
      const form = parseReajustePdf(text, selected);
      setReajusteForm(form);
    } catch (err: any) {
      setReajusteMsg({ ok: false, text: `Erro ao ler PDF: ${err?.message ?? err}` });
    } finally {
      setReajusteParsing(false);
    }
  }

  // ── Reajuste: salvar ──────────────────────────────────────────────────
  async function saveReajuste() {
    if (!selected || !reajusteForm) return;
    setReajusteSaving(true);
    setReajusteMsg(null);

    const pct    = toNum(reajusteForm.percentual);
    const valAnt = toNum(reajusteForm.valor_anterior);
    let   valNov = toNum(reajusteForm.valor_novo);
    if (pct !== null && valAnt !== null && valNov === null) {
      valNov = Math.round(valAnt * (1 + pct / 100) * 100) / 100;
    }

    const { data: { user } } = await supabase.auth.getUser();

    const { error } = await supabase.from("contratos_reajustes").insert({
      contrato_id:      selected.id,
      tipo_doc:         reajusteForm.tipo_doc,
      tipo_alteracao:   reajusteForm.tipo_alteracao,
      objeto_doc:       reajusteForm.objeto_doc || null,
      percentual:       pct,
      valor_anterior:   valAnt,
      valor_novo:       valNov,
      data_fim_anterior: reajusteForm.data_fim_anterior || null,
      data_fim_nova:    reajusteForm.data_fim_nova || null,
      meses_acrescidos: reajusteForm.meses_acrescidos ? parseInt(reajusteForm.meses_acrescidos) : null,
      texto_pdf:        reajusteForm.texto_pdf || null,
      created_by:       user?.id ?? null,
    });

    if (error) {
      setReajusteSaving(false);
      setReajusteMsg({ ok: false, text: error.message });
      return;
    }

    // Atualiza contrato
    const updates: Record<string, unknown> = {};
    if (valNov !== null && (reajusteForm.tipo_alteracao === "valor" || reajusteForm.tipo_alteracao === "ambos")) {
      updates.vl_atual = valNov;
    }
    if (reajusteForm.data_fim_nova && (reajusteForm.tipo_alteracao === "prazo" || reajusteForm.tipo_alteracao === "ambos")) {
      updates.data_final = reajusteForm.data_fim_nova;
    }

    if (Object.keys(updates).length > 0) {
      const { error: upErr } = await supabase.from("contratos_scon").update(updates).eq("id", selected.id);
      if (!upErr) {
        const atualizado = { ...selected, ...(updates as Partial<Contrato>) };
        setSelected(atualizado);
        setContratos((prev) => prev.map((c) => c.id === selected.id ? atualizado : c));
      }
    }

    // Recarrega histórico
    const { data: hist } = await supabase
      .from("contratos_reajustes")
      .select("*")
      .eq("contrato_id", selected.id)
      .order("created_at", { ascending: false });
    setReajustes((hist ?? []) as Reajuste[]);

    setReajusteForm(null);
    setReajusteSaving(false);
    setReajusteMsg({ ok: true, text: "Reajuste registrado e contrato atualizado!" });
    setTimeout(() => setReajusteMsg(null), 4000);
  }

  // ── Derivados ────────────────────────────────────────────────────────────
  const anos = useMemo(
    () => [...new Set(contratos.map((c) => c.data_inicio?.slice(0, 4)).filter(Boolean) as string[])].sort().reverse(),
    [contratos]
  );
  const ugrs = useMemo(
    () => [...new Set(contratos.map((c) => c.ugr).filter(Boolean) as string[])].sort(),
    [contratos]
  );
  const statuses = useMemo(
    () => [...new Set(contratos.map((c) => c.status).filter(Boolean) as string[])].sort(),
    [contratos]
  );
  const fiscais = useMemo(
    () => [...new Set(contratos.map((c) => c.fiscal).filter(Boolean) as string[])].sort(),
    [contratos]
  );

  function normPag(pag: string | null | undefined): string {
    return (pag ?? "").trim().replace(/\s/g, "").toUpperCase();
  }

  const pis = useMemo(() => {
    const set = new Set<string>();
    contratos.forEach((c) => {
      (piByPag.get(normPag(c.pag_nup)) ?? []).forEach(pi => set.add(pi));
    });
    return [...set].sort();
  }, [contratos, piByPag]);

  const filtered = useMemo(() => {
    const q = filtroTexto.trim().toLowerCase();
    return contratos.filter((c) => {
      if (filtroAno !== "todos" && !c.data_inicio?.startsWith(filtroAno)) return false;
      if (filtroUgr !== "todos" && c.ugr !== filtroUgr) return false;
      if (filtroFiscal !== "todos" && c.fiscal !== filtroFiscal) return false;
      if (filtroPi !== "todos" && !(piByPag.get(normPag(c.pag_nup)) ?? []).includes(filtroPi)) return false;
      if (filtroStatus === "pendentes_encerramento") {
        if (!isVencido(c.data_final)) return false;
      } else if (filtroStatus !== "todos") {
        if ((c.status ?? "").toLowerCase() !== filtroStatus.toLowerCase()) return false;
      }
      if (q) {
        const fields = [c.numero_contrato, c.descricao, c.fornecedor, c.cnpj, c.pag_nup]
          .map((f) => (f ?? "").toLowerCase());
        if (!fields.some((f) => f.includes(q))) return false;
      }
      return true;
    });
  }, [contratos, filtroTexto, filtroAno, filtroUgr, filtroStatus, filtroFiscal, filtroPi, piByPag]);

  const sorted = useMemo(() => {
    const arr = [...filtered];
    if (sortBy === "saldo_asc")       arr.sort((a, b) => (a.vl_a_empenhar ?? 0) - (b.vl_a_empenhar ?? 0));
    else if (sortBy === "saldo_desc") arr.sort((a, b) => (b.vl_a_empenhar ?? 0) - (a.vl_a_empenhar ?? 0));
    else if (sortBy === "liquidar_asc")  arr.sort((a, b) => (a.saldo ?? 0) - (b.saldo ?? 0));
    else if (sortBy === "liquidar_desc") arr.sort((a, b) => (b.saldo ?? 0) - (a.saldo ?? 0));
    else if (sortBy === "vencimento_asc") {
      arr.sort((a, b) => {
        const da = a.data_final ? new Date(a.data_final).getTime() : Infinity;
        const db = b.data_final ? new Date(b.data_final).getTime() : Infinity;
        return da - db;
      });
    }
    else if (sortBy === "reajuste_asc") {
      arr.sort((a, b) => {
        const proxR = (c: Contrato) => {
          if (!c.data_orcamento) return Infinity;
          const d = new Date(c.data_orcamento + "T12:00:00");
          return new Date(d.getFullYear(), d.getMonth() + 12, 1).getTime();
        };
        return proxR(a) - proxR(b);
      });
    }
    return arr;
  }, [filtered, sortBy]);

  const fld = (key: keyof typeof form) => ({
    value: form[key],
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      setForm((f) => ({ ...f, [key]: e.target.value })),
    className: "mt-1 w-full rounded-xl border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-sky-200",
  });

  // ── Previsão orçamentária ────────────────────────────────────────────────
  const ANO_CORRENTE = new Date().getFullYear();

  /**
   * Média mensal estimada do contrato no `ano` alvo:
   *   1. Se houver histórico SIAFI (execPagMap.pagoByYear): usa o último ano COMPLETO
   *      como base e aplica IPCA composto.
   *   2. Se não houver histórico: divide valor total do contrato pela duração total
   *      em meses → custo mensal constante.
   */
  function monthlyAvgContrato(c: Contrato, ano: number): number {
    const today      = new Date();
    const todayYear  = today.getFullYear();
    const todayMonth = today.getMonth() + 1;
    const ipca       = gordura / 100;

    const pag   = normPag(c.pag_nup);
    const stats = pag ? execPagMap.get(pag) : undefined;
    const ini   = c.data_inicio ? new Date(c.data_inicio + "T12:00:00") : null;

    // ── Caminho 1: histórico real SIAFI ──────────────────────────────────
    // Soma TODOS os pagamentos do PAG independente do ano do NE:
    // um NE de 2025 pode ser RP liquidado durante um contrato que só começou em 2026.
    if (stats && stats.pagoByYear.size > 0) {
      const totalPago = [...stats.pagoByYear.values()].reduce((a, b) => a + b, 0);

      // Denominador: meses corridos desde o início do contrato até o mês anterior
      // (mês atual pode estar incompleto → excluído)
      const cStartYear  = ini ? ini.getFullYear() : todayYear;
      const cStartMonth = ini ? ini.getMonth() + 1 : 1;
      const monthsElapsed = Math.max(1,
        (todayYear * 12 + todayMonth - 1) - (cStartYear * 12 + cStartMonth - 1)
      );

      // Média mensal no ritmo atual → projeta com IPCA acumulado até o ano-alvo
      const baseMonthly = totalPago / monthsElapsed;
      return baseMonthly * Math.pow(1 + ipca, ano - todayYear);
    }

    // ── Caminho 2: sem histórico — valor/duração total do contrato ───────
    const base = c.vl_atual ?? c.vl_contratual;
    if (!base || !ini) return 0;
    const fim = c.data_final  ? new Date(c.data_final  + "T12:00:00") : null;
    if (!fim) return 0;
    const MS_MES   = 30.44 * 24 * 3600 * 1000;
    const durTotal = Math.max(1, (fim.getTime() - ini.getTime()) / MS_MES);
    return (base / durTotal) * Math.pow(1 + ipca, Math.max(0, ano - todayYear));
  }

  /** Quantos meses do período [fromMonth, toMonth] o contrato está ativo no `ano`. */
  function contratoMesesAtivos(c: Contrato, ano: number, fromMonth: number, toMonth: number): number {
    if (!c.data_inicio || !c.data_final) return Math.max(0, toMonth - fromMonth + 1);
    const ini = new Date(c.data_inicio + "T12:00:00");
    const fim = new Date(c.data_final  + "T12:00:00");
    const cStart = ini.getFullYear() < ano ? 1  : ini.getFullYear() > ano ? 13 : ini.getMonth() + 1;
    const cEnd   = fim.getFullYear() > ano ? 12 : fim.getFullYear() < ano ? 0  : fim.getMonth() + 1;
    return Math.max(0, Math.min(toMonth, cEnd) - Math.max(fromMonth, cStart) + 1);
  }

  function ativoNoAno(c: Contrato, ano: number): boolean {
    const ini = c.data_inicio ? new Date(c.data_inicio + "T12:00:00") : null;
    const fim = c.data_final  ? new Date(c.data_final  + "T12:00:00") : null;
    if (!ini || !fim) return true;
    return ini <= new Date(ano, 11, 31) && fim >= new Date(ano, 0, 1);
  }

  // Anos disponíveis: corrente + futuros cobertos por algum contrato (máx +5)
  const prevAnosOpts = useMemo(() => {
    const set = new Set<number>([ANO_CORRENTE]);
    contratos.forEach((c) => {
      if (c.data_final) {
        const fimAno = new Date(c.data_final + "T12:00:00").getFullYear();
        for (let y = ANO_CORRENTE + 1; y <= Math.min(fimAno, ANO_CORRENTE + 5); y++) set.add(y);
      }
    });
    return [...set].sort();
  }, [contratos]);

  // Filtros cascateados da previsão
  const prevUgrsOpts = useMemo(
    () => [...new Set(contratos.map((c) => c.ugr).filter(Boolean) as string[])].sort(),
    [contratos]
  );

  // Base filtrada só por UGR — usada para calcular as opções de Ação e PI
  const prevBaseUgr = useMemo(
    () => prevUgr === "todos" ? contratos : contratos.filter((c) => c.ugr === prevUgr),
    [contratos, prevUgr]
  );

  // Ações disponíveis dado UGR + PI selecionados
  const prevAcaoOpts = useMemo(() => {
    const base = prevPi === "todos"
      ? prevBaseUgr
      : prevBaseUgr.filter((c) => (piByPag.get(normPag(c.pag_nup)) ?? []).includes(prevPi));
    return [...new Set(base.map((c) => c.acao).filter(Boolean) as string[])].sort();
  }, [prevBaseUgr, prevPi, piByPag]);

  // PIs disponíveis dado UGR + Ação selecionados
  const prevPiOpts = useMemo(() => {
    const base = prevAcao === "todos"
      ? prevBaseUgr
      : prevBaseUgr.filter((c) => c.acao === prevAcao);
    const set = new Set<string>();
    base.forEach((c) => (piByPag.get(normPag(c.pag_nup)) ?? []).forEach((pi) => set.add(pi)));
    return [...set].sort();
  }, [prevBaseUgr, prevAcao, piByPag]);

  // Contratos ativos no ano selecionado + filtros cascateados
  const prevContratos = useMemo(() =>
    contratos.filter((c) => {
      if (!ativoNoAno(c, prevAno)) return false;
      if (prevUgr  !== "todos" && c.ugr  !== prevUgr)  return false;
      if (prevAcao !== "todos" && c.acao !== prevAcao) return false;
      if (prevPi   !== "todos" && !(piByPag.get(normPag(c.pag_nup)) ?? []).includes(prevPi)) return false;
      return true;
    }),
    [contratos, prevAno, prevUgr, prevAcao, prevPi, piByPag]
  );

  const MESES_PT = ["Janeiro","Fevereiro","Março","Abril","Maio","Junho",
                    "Julho","Agosto","Setembro","Outubro","Novembro","Dezembro"];

  type PrevisaoRow = {
    grupo: string;
    contratos: Contrato[];
    previsao: number;            // valor proporcional até prevMesFim (IPCA já embutido)
    empenhadoALiquidar: number;  // NEs emitidas não pagas (só ano corrente)
    creditoNecessario: number;   // crédito novo que precisa ser aberto
  };

  const isAnoCorrente = prevAno === ANO_CORRENTE;

  // Quantos contratos ATIVOS compartilham o mesmo PAG — para dividir o total SIAFI da média mensal
  const pagCountMap = useMemo(() => {
    const m = new Map<string, number>();
    for (const c of prevContratos) {
      const pag = normPag(c.pag_nup);
      if (pag) m.set(pag, (m.get(pag) ?? 0) + 1);
    }
    return m;
  }, [prevContratos]);

  // Contrato "primário" de cada PAG — único que exibe o saldo a_liquidar do SIAFI.
  // Escolha: contrato com data_inicio mais recente (o que está sendo executado agora).
  // Se empate, o menor número de contrato (ordem alfabética).
  const primaryForPag = useMemo(() => {
    const byPag = new Map<string, Contrato[]>();
    for (const c of prevContratos) {
      const pag = normPag(c.pag_nup);
      if (!pag) continue;
      if (!byPag.has(pag)) byPag.set(pag, []);
      byPag.get(pag)!.push(c);
    }
    const result = new Map<string, string>(); // PAG → id do contrato primário
    for (const [pag, cs] of byPag) {
      const sorted = [...cs].sort((a, b) => {
        const da = a.data_inicio ?? "";
        const db = b.data_inicio ?? "";
        if (da !== db) return db.localeCompare(da); // mais recente primeiro
        return a.numero_contrato.localeCompare(b.numero_contrato);
      });
      result.set(pag, sorted[0].id);
    }
    return result;
  }, [prevContratos]);

  // Mês de início da janela de previsão:
  //   - ano corrente → começa no mês atual (faturas futuras)
  //   - ano futuro   → começa em janeiro (ano todo)
  const prevStartMonth = isAnoCorrente ? new Date().getMonth() + 1 : 1;

  const previsaoRows: PrevisaoRow[] = useMemo(() => {
    const startM = isAnoCorrente ? new Date().getMonth() + 1 : 1;

    const grupos = new Map<string, Contrato[]>();
    for (const c of prevContratos) {
      const chave = (prevGroupBy === "ugr" ? c.ugr : c.acao) ?? "Sem " + (prevGroupBy === "ugr" ? "UGR" : "PI");
      if (!grupos.has(chave)) grupos.set(chave, []);
      grupos.get(chave)!.push(c);
    }
    return [...grupos.entries()]
      .sort(([a], [b]) => a.localeCompare(b, "pt-BR"))
      .map(([grupo, cs]) => {
        // Previsão = soma dos PAGs únicos (cada PAG conta UMA VEZ, mesmo que múltiplos contratos compartilhem)
        const seenPagsPrev = new Set<string>();
        const previsao = cs.reduce((s, c) => {
          const pag   = normPag(c.pag_nup);
          const meses = contratoMesesAtivos(c, prevAno, startM, prevMesFim);
          if (pag) {
            if (seenPagsPrev.has(pag)) return s; // PAG já contabilizado por outro contrato
            seenPagsPrev.add(pag);
          }
          return s + monthlyAvgContrato(c, prevAno) * meses;
        }, 0);

        // Empenhado a liquidar = saldo real de NEs abertas (SIAFI).
        // Cada PAG é contado UMA ÚNICA VEZ (pelo contrato primário do PAG),
        // evitando duplicação quando dois contratos compartilham o mesmo processo.
        const empenhadoALiquidar = isAnoCorrente ? (() => {
          const seenPags = new Set<string>();
          return cs.reduce((s, c) => {
            const pag   = normPag(c.pag_nup);
            const stats = pag ? execPagMap.get(pag) : undefined;
            if (!pag || seenPags.has(pag)) return s;
            seenPags.add(pag);
            return s + (stats?.aLiquidar ?? 0);
          }, 0);
        })() : 0;

        // Crédito necessário = quanto ainda falta empenhar para cobrir o período
        const creditoNecessario = Math.max(0, previsao - empenhadoALiquidar);

        return { grupo, contratos: cs, previsao, empenhadoALiquidar, creditoNecessario };
      });
  }, [prevContratos, gordura, prevGroupBy, prevAno, prevMesFim, isAnoCorrente, execPagMap]);

  const previsaoTotais = useMemo(() => previsaoRows.reduce(
    (acc, r) => ({
      previsao:           acc.previsao           + r.previsao,
      empenhadoALiquidar: acc.empenhadoALiquidar + r.empenhadoALiquidar,
      creditoNecessario:  acc.creditoNecessario  + r.creditoNecessario,
    }),
    { previsao: 0, empenhadoALiquidar: 0, creditoNecessario: 0 }
  ), [previsaoRows]);

  // ── Render ───────────────────────────────────────────────────────────────
  return (
    <div className="space-y-4">
      {/* Input oculto para upload de documentos do contrato — sempre montado */}
      <input ref={docFileRef} type="file" accept=".pdf,.doc,.docx" className="hidden" onChange={handleDocUpload} />

      {/* Cabeçalho */}
      <div className="rounded-2xl border border-slate-200 bg-white shadow-sm px-5 py-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-sm font-bold text-slate-800">Gerenciamento de Contratos</div>
            <div className="text-xs text-slate-400 mt-0.5">
              {contratos.length} contrato{contratos.length !== 1 ? "s" : ""} cadastrado{contratos.length !== 1 ? "s" : ""}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            {canImport && (
              <>
                <button
                  onClick={() => { setShowCadastro((v) => !v); setPreview(null); }}
                  className="rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-1.5 text-xs font-medium text-indigo-700 hover:bg-indigo-100 transition-colors"
                >
                  {showCadastro ? "Cancelar" : "+ Cadastrar"}
                </button>
                <button
                  onClick={() => { setPreview(null); fileInputRef.current?.click(); }}
                  className="rounded-lg bg-sky-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-sky-700 transition-colors"
                >
                  Importar Excel
                </button>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".xls,.xlsx,.ods,.csv"
                  className="hidden"
                  onChange={handleFileChange}
                />
                <button
                  onClick={clearExcelContratos}
                  disabled={clearingExcel || loading}
                  title="Remove todos os contratos importados via Excel e permite reimportar com os dados corrigidos"
                  className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-1.5 text-xs font-medium text-rose-700 hover:bg-rose-100 disabled:opacity-60 transition-colors"
                >
                  {clearingExcel ? "Removendo..." : "Limpar Importados"}
                </button>
              </>
            )}
            <button
              onClick={load}
              disabled={loading}
              className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-50 disabled:opacity-60 transition-colors"
            >
              {loading ? "Carregando..." : "↻ Atualizar"}
            </button>
          </div>
        </div>
        {err && (
          <div className="mt-3 rounded-xl border border-red-200 bg-red-50 p-2 text-sm text-red-700">{err}</div>
        )}
      </div>

      {/* Seletor de visão principal */}
      <div className="flex gap-2">
        {([
          { id: "lista",    label: "📋 Lista de Contratos" },
          { id: "previsao", label: "📊 Previsão Orçamentária" },
        ] as const).map(({ id, label }) => (
          <button
            key={id}
            onClick={() => setMainView(id)}
            className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${
              mainView === id
                ? "bg-sky-600 text-white border-sky-600"
                : "border-slate-200 text-slate-600 hover:bg-slate-50"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* ── Previsão Orçamentária ── */}
      {mainView === "previsao" && (
        <div className="space-y-4">
          {/* Controles */}
          <Card>
            <div className="flex flex-wrap items-center gap-3">
              {/* Agrupar por */}
              <div className="flex items-center gap-2">
                <span className="text-xs font-medium text-slate-600 shrink-0">Agrupar por:</span>
                {([
                  { v: "ugr",  l: "UGR" },
                  { v: "acao", l: "PI / Ação" },
                ] as const).map(({ v, l }) => (
                  <button
                    key={v}
                    onClick={() => setPrevGroupBy(v)}
                    className={`rounded-lg border px-2.5 py-1 text-xs font-medium transition-colors ${
                      prevGroupBy === v
                        ? "bg-indigo-600 text-white border-indigo-600"
                        : "border-slate-200 text-slate-600 hover:bg-slate-50"
                    }`}
                  >
                    {l}
                  </button>
                ))}
              </div>

              {/* Filtro Período */}
              <div className="flex items-center gap-1">
                <span className="text-xs text-slate-500 shrink-0">Até</span>
                <select
                  value={prevMesFim}
                  onChange={(e) => setPrevMesFim(Number(e.target.value))}
                  className="rounded-xl border px-2 py-1.5 text-xs outline-none focus:ring-2 focus:ring-sky-200"
                >
                  {MESES_PT.map((m, i) => <option key={i + 1} value={i + 1}>{m}</option>)}
                </select>
                <select
                  value={prevAno}
                  onChange={(e) => { setPrevAno(Number(e.target.value)); }}
                  className="rounded-xl border px-2 py-1.5 text-xs font-semibold outline-none focus:ring-2 focus:ring-sky-200"
                >
                  {prevAnosOpts.map((a) => <option key={a} value={a}>{a}</option>)}
                </select>
              </div>

              {/* Filtro UGR */}
              <select
                value={prevUgr}
                onChange={(e) => { setPrevUgr(e.target.value); setPrevAcao("todos"); setPrevPi("todos"); }}
                className="rounded-xl border px-3 py-1.5 text-xs outline-none focus:ring-2 focus:ring-sky-200"
              >
                <option value="todos">Todas as UGR</option>
                {prevUgrsOpts.map((u) => <option key={u} value={u}>{u}</option>)}
              </select>

              {/* Filtro Ação */}
              <select
                value={prevAcao}
                onChange={(e) => { setPrevAcao(e.target.value); setPrevPi("todos"); }}
                className="rounded-xl border px-3 py-1.5 text-xs outline-none focus:ring-2 focus:ring-sky-200"
              >
                <option value="todos">Todas as Ações</option>
                {prevAcaoOpts.map((a) => <option key={a} value={a}>{a}</option>)}
              </select>

              {/* Filtro PI */}
              <select
                value={prevPi}
                onChange={(e) => setPrevPi(e.target.value)}
                className="rounded-xl border px-3 py-1.5 text-xs outline-none focus:ring-2 focus:ring-sky-200 max-w-xs"
              >
                <option value="todos">Todos os PI</option>
                {prevPiOpts.map((p) => {
                  const desc = piDescMap.get(p);
                  return <option key={p} value={p}>{desc ? `${p} — ${desc}` : p}</option>;
                })}
              </select>

              {/* IPCA */}
              <div className="flex items-center gap-2">
                <label className="text-xs font-medium text-slate-600 shrink-0" title="Índice de reajuste aplicado sobre contratos de anos futuros (IPCA referência 2025: 5,1%)">
                  IPCA/Reajuste (%):
                </label>
                <input
                  type="number"
                  min={0}
                  max={50}
                  step={0.1}
                  value={gordura}
                  onChange={(e) => setGordura(Number(e.target.value))}
                  className="w-16 rounded-xl border px-2 py-1 text-sm text-center outline-none focus:ring-2 focus:ring-sky-200"
                />
              </div>

              <span className="text-xs text-slate-400 ml-auto">
                {prevContratos.length}/{contratos.length} contratos ativos · Jan–{MESES_PT[prevMesFim - 1]} {prevAno}
              </span>
            </div>
          </Card>

          {/* Tabela resumo */}
          <Card>
            {execPagLoaded && execPagMap.size === 0 && (
              <div className="mb-3 rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-xs text-amber-700">
                Planilha SIAFI não carregada. Usando valor/duração do contrato como estimativa.
              </div>
            )}
            {!execPagLoaded && (
              <div className="mb-3 text-xs text-slate-400">Carregando histórico SIAFI…</div>
            )}
            {!isAnoCorrente && (
              <div className="mb-3 rounded-lg bg-blue-50 border border-blue-200 px-3 py-2 text-xs text-blue-700">
                <strong>Exercício futuro ({prevAno}):</strong> Previsão Jan–{MESES_PT[prevMesFim - 1]} = média mensal histórica × IPCA {gordura}%{prevAno > ANO_CORRENTE + 1 ? `^${prevAno - ANO_CORRENTE}` : ""} × meses ativos. Crédito Necessário = previsão integral (nenhuma NE emitida ainda).
              </div>
            )}
            <div className="overflow-x-auto">
              <table className="w-full text-xs border-collapse">
                <thead>
                  <tr className="bg-slate-100 text-slate-500 uppercase text-[10px] tracking-wide">
                    <th className="text-left px-3 py-2 font-semibold">{prevGroupBy === "ugr" ? "UGR" : "PI / Ação"}</th>
                    <th className="text-right px-3 py-2 font-semibold">
                      Previsão {MESES_PT[prevStartMonth - 1].slice(0, 3)}–{MESES_PT[prevMesFim - 1].slice(0, 3)} {prevAno}
                      {prevAno > ANO_CORRENTE ? <span className="ml-1 font-normal text-slate-400">(+IPCA {gordura}%)</span> : null}
                    </th>
                    {isAnoCorrente && <th className="text-right px-3 py-2 font-semibold text-indigo-600">Empenh. a Liquidar</th>}
                    <th className="text-right px-3 py-2 font-semibold text-red-700">Crédito Necessário</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {previsaoRows.map((row) => {
                    const ok      = row.creditoNecessario === 0;
                    const parcial = row.creditoNecessario > 0 && row.creditoNecessario <= row.previsao * 0.5;
                    return (
                      <tr key={row.grupo} className="hover:bg-slate-50 transition-colors">
                        <td className="px-3 py-2 font-medium text-slate-800">{row.grupo}</td>
                        <td className="px-3 py-2 text-right text-slate-700">{fmtMoney(row.previsao)}</td>
                        {isAnoCorrente && <td className="px-3 py-2 text-right text-indigo-600">{fmtMoney(row.empenhadoALiquidar)}</td>}
                        <td className={`px-3 py-2 text-right font-bold ${ok ? "text-green-600" : parcial ? "text-amber-600" : "text-red-600"}`}>
                          {fmtMoney(row.creditoNecessario)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr className="bg-slate-800 text-white text-xs font-bold">
                    <td className="px-3 py-2">TOTAL GERAL</td>
                    <td className="px-3 py-2 text-right">{fmtMoney(previsaoTotais.previsao)}</td>
                    {isAnoCorrente && <td className="px-3 py-2 text-right text-indigo-300">{fmtMoney(previsaoTotais.empenhadoALiquidar)}</td>}
                    <td className="px-3 py-2 text-right text-amber-300 text-sm">{fmtMoney(previsaoTotais.creditoNecessario)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>

            <div className="mt-3 flex flex-wrap gap-3 text-[10px] text-slate-400 border-t pt-2">
              <span><span className="font-semibold text-green-600">Verde</span> = totalmente coberto pelo empenhado</span>
              <span><span className="font-semibold text-amber-600">Laranja</span> = falta até 50% da previsão</span>
              <span><span className="font-semibold text-red-600">Vermelho</span> = falta mais de 50%</span>
              <span className="ml-auto text-slate-300">
                {isAnoCorrente
                  ? "Crédito Nec. = Previsão (média mensal × meses restantes) − Empenh. a Liquidar (SIAFI)"
                  : `Previsão = média mensal histórica × IPCA ${gordura}% × meses ativos`}
              </span>
            </div>
          </Card>

          {/* Detalhamento por grupo */}
          {previsaoRows.map((row) => (
            <Card key={row.grupo}>
              <div className="text-xs font-semibold text-slate-700 mb-2">
                {prevGroupBy === "ugr" ? "UGR" : "PI"}: {row.grupo}
                <span className="ml-2 font-normal text-slate-400">({row.contratos.length} contrato{row.contratos.length !== 1 ? "s" : ""})</span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-xs border-collapse">
                  <thead>
                    <tr className="bg-slate-50 text-slate-400 uppercase text-[10px]">
                      <th className="text-left px-2 py-1.5 font-semibold">Contrato</th>
                      <th className="text-left px-2 py-1.5 font-semibold">Fornecedor</th>
                      <th className="text-right px-2 py-1.5 font-semibold">{MESES_PT[prevStartMonth - 1].slice(0, 3)}–{MESES_PT[prevMesFim - 1].slice(0, 3)} {prevAno}</th>
                      {isAnoCorrente && <th className="text-right px-2 py-1.5 font-semibold text-indigo-600">Empenh. a Liq. (SIAFI)</th>}
                      <th className="text-right px-2 py-1.5 font-semibold text-red-700">Crédito Nec.</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {row.contratos.map((c) => {
                      const pag      = normPag(c.pag_nup);
                      const stats    = pag ? execPagMap.get(pag) : undefined;
                      const pagCount = pag ? (pagCountMap.get(pag) ?? 1) : 1;
                      const mAvg    = monthlyAvgContrato(c, prevAno);
                      const meses   = contratoMesesAtivos(c, prevAno, prevStartMonth, prevMesFim);
                      const prev    = mAvg * meses;
                      // a_liquidar aparece SOMENTE no contrato primário do PAG (não duplica)
                      const isPrimary = !pag || primaryForPag.get(pag) === c.id;
                      const empLiq  = isAnoCorrente && isPrimary ? (stats?.aLiquidar ?? 0) : 0;
                      const credNec = Math.max(0, prev - empLiq);
                      const ok      = credNec === 0;
                      const parcial = credNec > 0 && credNec <= prev * 0.5;
                      const temHistorico = !!stats?.pagoByYear.size;
                      const semPag  = !c.pag_nup;
                      return (
                        <tr key={c.id} className="hover:bg-slate-50">
                          <td className="px-2 py-1.5 text-slate-700 font-medium">
                            {c.numero_contrato}
                            {semPag  && <span className="ml-1 text-[9px] text-amber-500" title="PAG/NUP não preenchido — preencha em Dados Gerais para usar histórico SIAFI">sem PAG</span>}
                            {!semPag && !temHistorico && <span className="ml-1 text-[9px] text-slate-400" title="Sem histórico SIAFI — usando valor/duração do contrato">est.</span>}
                            {pagCount > 1 && <span className="ml-1 text-[9px] text-sky-500" title={`PAG compartilhado por ${pagCount} contratos — total SIAFI dividido igualmente`}>÷{pagCount}</span>}
                          </td>
                          <td className="px-2 py-1.5 text-slate-500 max-w-[180px] truncate">{c.fornecedor ?? "–"}</td>
                          <td className="px-2 py-1.5 text-right text-slate-700" title={`Média mensal: ${fmtMoney(mAvg)} × ${meses} meses`}>{fmtMoney(prev)}</td>
                          {isAnoCorrente && <td className="px-2 py-1.5 text-right text-indigo-600">{fmtMoney(empLiq)}</td>}
                          <td className={`px-2 py-1.5 text-right font-semibold ${ok ? "text-green-600" : parcial ? "text-amber-600" : "text-red-600"}`}>
                            {fmtMoney(credNec)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </Card>
          ))}
        </div>
      )}

      {mainView === "lista" && (<>
      {/* Prévia de importação */}
      {preview && (
        <Card>
          <div className="text-sm font-semibold text-slate-900 mb-2">Prévia da importação</div>
          <div className="text-sm text-slate-700">
            <span className="font-medium text-green-700">{preview.novos} novo{preview.novos !== 1 ? "s" : ""}</span>
            {" "}contrato{preview.novos !== 1 ? "s" : ""} serão importados.
            {preview.existentes > 0 && (
              <span className="text-slate-400 ml-1">
                ({preview.existentes} já existe{preview.existentes !== 1 ? "m" : ""} e {preview.existentes !== 1 ? "serão ignorados" : "será ignorado"}.)
              </span>
            )}
          </div>
          {preview.novos === 0 ? (
            <div className="mt-2 text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-xl p-2">
              Todos os contratos do arquivo já estão cadastrados.
            </div>
          ) : (
            <div className="mt-3 max-h-52 overflow-y-auto border rounded-xl divide-y">
              {preview.rows.slice(0, 30).map((r, i) => (
                <div key={i} className="px-3 py-1.5 text-xs text-slate-700 flex gap-3 items-center">
                  <span className="font-medium truncate max-w-[40%]">{r.numero_contrato}</span>
                  <span className="text-slate-400 truncate flex-1">{r.fornecedor ?? "–"}</span>
                  <span className="text-slate-500 shrink-0">{r.uge ?? ""}</span>
                  <span className="shrink-0 font-medium">{r.vl_contratual != null ? fmtMoney(r.vl_contratual) : "–"}</span>
                </div>
              ))}
              {preview.rows.length > 30 && (
                <div className="px-3 py-1.5 text-xs text-slate-400">+ {preview.rows.length - 30} mais…</div>
              )}
            </div>
          )}
          <div className="mt-3 flex gap-2">
            <button
              onClick={handleImport}
              disabled={importing || preview.novos === 0}
              className="rounded-xl bg-sky-600 px-4 py-2 text-sm text-white hover:bg-sky-700 disabled:opacity-60"
            >
              {importing ? "Importando..." : `Importar ${preview.novos} contrato${preview.novos !== 1 ? "s" : ""}`}
            </button>
            <button
              onClick={() => setPreview(null)}
              className="rounded-xl border px-4 py-2 text-sm text-slate-600 hover:bg-slate-50"
            >
              Cancelar
            </button>
          </div>
        </Card>
      )}

      {/* Formulário manual */}
      {showCadastro && (
        <Card>
          <div className="text-sm font-semibold text-slate-900 mb-3">Novo Contrato</div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-slate-600">Nº do Contrato *</label>
              <input {...fld("numero_contrato")} placeholder="Ex: 67615.039/2024" />
            </div>
            <div>
              <label className="text-xs font-medium text-slate-600">Status</label>
              <input {...fld("status")} placeholder="Ex: Vigente" />
            </div>
            <div>
              <label className="text-xs font-medium text-slate-600">UGE</label>
              <input {...fld("uge")} placeholder="Ex: DACTA IV" />
            </div>
            <div>
              <label className="text-xs font-medium text-slate-600">UGR</label>
              <input {...fld("ugr")} placeholder="Ex: 2000" />
            </div>
            <div className="sm:col-span-2">
              <label className="text-xs font-medium text-slate-600">Descrição / Objeto</label>
              <textarea
                value={form.descricao}
                onChange={(e) => setForm((f) => ({ ...f, descricao: e.target.value }))}
                rows={2}
                placeholder="Descreva o objeto do contrato..."
                className="mt-1 w-full rounded-xl border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-sky-200 resize-none"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-slate-600">Fornecedor</label>
              <input {...fld("fornecedor")} placeholder="Razão social" />
            </div>
            <div>
              <label className="text-xs font-medium text-slate-600">CNPJ</label>
              <input {...fld("cnpj")} placeholder="00.000.000/0000-00" />
            </div>
            <div>
              <label className="text-xs font-medium text-slate-600">PAG / NUP</label>
              <input {...fld("pag_nup")} placeholder="Ex: 67615.039" />
            </div>
            <div>
              <label className="text-xs font-medium text-slate-600">Tipo</label>
              <input {...fld("tipo")} placeholder="Ex: Serviço" />
            </div>
            <div>
              <label className="text-xs font-medium text-slate-600">Valor Contratual (R$)</label>
              <input {...fld("vl_contratual")} placeholder="Ex: 150000,00" />
            </div>
            <div>
              <label className="text-xs font-medium text-slate-600">Vl. a Empenhar (R$)</label>
              <input {...fld("vl_a_empenhar")} placeholder="Ex: 50000,00" />
            </div>
            <div>
              <label className="text-xs font-medium text-slate-600">Vl. Empenhado (R$)</label>
              <input {...fld("vl_empenhado")} placeholder="Ex: 100000,00" />
            </div>
            <div>
              <label className="text-xs font-medium text-slate-600">Vl. Liquidado (R$)</label>
              <input {...fld("vl_liquidado")} placeholder="Ex: 80000,00" />
            </div>
            <div>
              <label className="text-xs font-medium text-slate-600">Saldo (R$)</label>
              <input {...fld("saldo")} placeholder="Ex: 20000,00" />
            </div>
            <div>
              <label className="text-xs font-medium text-slate-600">Ação</label>
              <input {...fld("acao")} placeholder="Ex: D" />
            </div>
            <div>
              <label className="text-xs font-medium text-slate-600">Data Início</label>
              <input type="date" {...fld("data_inicio")} />
            </div>
            <div>
              <label className="text-xs font-medium text-slate-600">Data Final</label>
              <input type="date" {...fld("data_final")} />
            </div>
          </div>
          <div className="mt-4 flex gap-2 justify-end">
            <button
              onClick={() => setShowCadastro(false)}
              className="rounded-xl border px-4 py-2 text-sm text-slate-600 hover:bg-slate-50"
            >
              Cancelar
            </button>
            <button
              onClick={saveManual}
              disabled={savingForm || !form.numero_contrato.trim()}
              className="rounded-xl bg-indigo-600 px-4 py-2 text-sm text-white hover:bg-indigo-700 disabled:opacity-60"
            >
              {savingForm ? "Salvando..." : "Cadastrar"}
            </button>
          </div>
        </Card>
      )}

      {/* Filtros */}
      <Card>
        <div className="flex flex-wrap items-center gap-3">
          <select
            value={filtroAno}
            onChange={(e) => setFiltroAno(e.target.value)}
            className="rounded-xl border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-sky-200"
          >
            <option value="todos">Todos os anos</option>
            {anos.map((a) => <option key={a} value={a}>{a}</option>)}
          </select>

          <select
            value={filtroUgr}
            onChange={(e) => setFiltroUgr(e.target.value)}
            className="rounded-xl border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-sky-200"
          >
            <option value="todos">Todas as UGR</option>
            {ugrs.map((u) => <option key={u} value={u}>{u}</option>)}
          </select>

          <select
            value={filtroStatus}
            onChange={(e) => setFiltroStatus(e.target.value)}
            className="rounded-xl border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-sky-200"
          >
            <option value="todos">Todos os status</option>
            <option value="pendentes_encerramento">Pendentes de encerramento</option>
            {statuses.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>

          {fiscais.length > 0 && (
            <select
              value={filtroFiscal}
              onChange={(e) => setFiltroFiscal(e.target.value)}
              className="rounded-xl border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-sky-200"
            >
              <option value="todos">Todos os fiscais</option>
              {fiscais.map((f) => <option key={f} value={f}>{f}</option>)}
            </select>
          )}

          {pis.length > 0 && (
            <select
              value={filtroPi}
              onChange={(e) => setFiltroPi(e.target.value)}
              className="rounded-xl border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-sky-200"
            >
              <option value="todos">Todos os PI</option>
              {pis.map((p) => {
                const desc = piDescMap.get(p);
                return <option key={p} value={p}>{desc ? `${p} — ${desc}` : p}</option>;
              })}
            </select>
          )}

          <input
            value={filtroTexto}
            onChange={(e) => setFiltroTexto(e.target.value)}
            placeholder="Buscar por nº, objeto, fornecedor, CNPJ..."
            className="flex-1 min-w-[220px] rounded-xl border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-sky-200"
          />

          <div className="flex gap-1 flex-wrap">
            {([
              { key: "none",           label: "Padrão" },
              { key: "saldo_asc",      label: "A empenhar ↑" },
              { key: "saldo_desc",     label: "A empenhar ↓" },
              { key: "liquidar_asc",   label: "A liquidar ↑" },
              { key: "liquidar_desc",  label: "A liquidar ↓" },
              { key: "vencimento_asc", label: "Vencimento" },
              { key: "reajuste_asc",   label: "📅 Próx. reajuste" },
            ] as const).map(({ key, label }) => (
              <button
                key={key}
                onClick={() => setSortBy(key)}
                className={`rounded-lg border px-2 py-1 text-xs transition-colors ${
                  sortBy === key
                    ? "bg-sky-100 border-sky-300 text-sky-800"
                    : "border-slate-200 text-slate-500 hover:bg-slate-50"
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          <span className="text-xs text-slate-500">
            {sorted.length} de {contratos.length} contrato{contratos.length !== 1 ? "s" : ""}
          </span>
        </div>
      </Card>

      {/* Grid principal */}
      <div className={`grid gap-4 ${selected ? "grid-cols-1 xl:grid-cols-2" : "grid-cols-1"}`}>

        {/* Lista */}
        <Card>
          {loading ? (
            <p className="text-sm text-slate-500">Carregando...</p>
          ) : sorted.length === 0 ? (
            <p className="text-sm text-slate-500">
              {contratos.length === 0
                ? "Nenhum contrato. Importe um arquivo Excel ou cadastre manualmente."
                : "Nenhum resultado para os filtros aplicados."}
            </p>
          ) : (
            <div className="space-y-2 max-h-[640px] overflow-y-auto pr-1">
              {sorted.map((c) => {
                const isActive = selected?.id === c.id;
                return (
                <div
                  key={c.id}
                  className={`rounded-xl border transition-colors ${
                    isActive ? "border-sky-300 ring-2 ring-sky-100" : "border-slate-200"
                  }`}
                >
                  {/* Área principal — clica para selecionar */}
                  <button
                    onClick={() => { setSelected(isActive ? null : c); setDetailMode("dados"); }}
                    className="w-full p-3 text-left hover:bg-slate-50 transition-colors rounded-t-xl"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className="text-sm font-semibold text-slate-900 truncate">
                            {c.numero_contrato}
                          </span>
                          {isVencido(c.data_final) && (
                            <span className="inline-block rounded-full border border-orange-300 bg-orange-50 px-2 py-0.5 text-[10px] font-semibold text-orange-700">
                              pendente de encerramento
                            </span>
                          )}
                        </div>
                        <div className="mt-0.5 text-xs text-slate-600 line-clamp-2">
                          {c.descricao ?? c.fornecedor ?? "–"}
                        </div>
                        <div className="mt-1 flex items-center gap-1.5 flex-wrap text-xs text-slate-400">
                          <span>{c.uge ?? "–"}</span>
                          <span>•</span>
                          <span>{fmtDate(c.data_inicio)} →</span>
                          <span className={`font-semibold px-1.5 py-0.5 rounded-md ${
                            isVencido(c.data_final)
                              ? "bg-orange-100 text-orange-700"
                              : c.data_final
                              ? "bg-green-50 text-green-700"
                              : "text-slate-400"
                          }`}>
                            {fmtDate(c.data_final)}
                          </span>
                        </div>
                        {(() => {
                          const dias = diasReajuste(c.data_orcamento);
                          if (dias === null) return null;
                          const cor = dias < 0 ? "text-red-500" : dias <= 30 ? "text-orange-500" : dias <= 90 ? "text-amber-500" : "text-green-600";
                          return (
                            <div className={`mt-0.5 text-[11px] ${cor}`}>
                              📅 Próx. reajuste: {fmtProxReajuste(c.data_orcamento)}
                              {dias < 0 ? ` (${Math.abs(dias)}d atrasado)` : dias <= 90 ? ` (${dias}d)` : ""}
                            </div>
                          );
                        })()}
                      </div>
                      <div className="text-right text-xs shrink-0 space-y-0.5">
                        {c.vl_contratual != null && (
                          <div className="font-semibold text-slate-700">{fmtMoney(c.vl_contratual)}</div>
                        )}
                        {c.vl_a_empenhar != null && (
                          <div className={c.vl_a_empenhar > 0 ? "text-green-700" : "text-red-600"}>
                            A empenhar: {fmtMoney(c.vl_a_empenhar)}
                          </div>
                        )}
                        {c.saldo != null && (
                          <div className={c.saldo > 0 ? "text-amber-700" : "text-red-600"}>
                            A liquidar: {fmtMoney(c.saldo)}
                          </div>
                        )}
                        {c.status && (
                          <span className={`inline-block rounded-full border px-2 py-0.5 ${
                            (c.status ?? "").toLowerCase().includes("vigent")
                              ? "bg-green-50 border-green-200 text-green-800"
                              : (c.status ?? "").toLowerCase().includes("encerr")
                              ? "bg-slate-50 border-slate-200 text-slate-600"
                              : "bg-amber-50 border-amber-200 text-amber-700"
                          }`}>
                            {c.status}
                          </span>
                        )}
                        {(() => {
                          const piArr = piByPag.get(normPag(c.pag_nup)) ?? [];
                          if (!piArr.length) return null;
                          return (
                            <div className="flex flex-wrap gap-1">
                              {piArr.map(pi => (
                                <span key={pi} className="inline-block rounded border border-violet-200 bg-violet-50 px-1.5 py-0.5 text-[9px] font-mono font-semibold text-violet-700 tracking-wide">
                                  {pi}
                                </span>
                              ))}
                            </div>
                          );
                        })()}
                      </div>
                    </div>
                  </button>

                  {/* Tabs rápidas: Execução e Reajustes */}
                  <div className="flex border-t border-slate-100">
                    <button
                      onClick={() => { setSelected(c); setDetailMode("execucao"); }}
                      className={`flex-1 py-1.5 text-[11px] font-medium transition-colors rounded-bl-xl ${
                        isActive && detailMode === "execucao"
                          ? "bg-sky-600 text-white"
                          : "text-slate-500 hover:bg-slate-50 hover:text-sky-700"
                      }`}
                    >
                      ⚡ Execução
                    </button>
                    <div className="w-px bg-slate-100" />
                    <button
                      onClick={() => { setSelected(c); setDetailMode("reajustes"); }}
                      className={`flex-1 py-1.5 text-[11px] font-medium transition-colors rounded-br-xl ${
                        isActive && detailMode === "reajustes"
                          ? "bg-indigo-600 text-white"
                          : "text-slate-500 hover:bg-slate-50 hover:text-indigo-700"
                      }`}
                    >
                      📈 Reajustes
                    </button>
                  </div>
                </div>
                );
              })}
            </div>
          )}
        </Card>

        {/* Painel de detalhe */}
        {selected && (
          <div ref={detailRef}>
          <Card>
            {/* Header do painel */}
            <div className="flex items-start justify-between gap-2 mb-2">
              <div>
                <div className="text-sm font-semibold text-slate-900">{selected.numero_contrato}</div>
                <div className="text-xs text-slate-500">
                  {selected.fonte} • {selected.uge ?? "–"} {selected.ugr ? `/ ${selected.ugr}` : ""}
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {selected.fonte === "MANUAL" && detailMode === "dados" && (
                  <button onClick={() => deleteContrato(selected)} className="text-xs text-red-400 hover:text-red-600 border border-red-200 rounded-lg px-2 py-0.5">
                    Excluir
                  </button>
                )}
                <button onClick={() => setSelected(null)} className="text-xs text-slate-400 hover:text-slate-700">
                  ✕ Fechar
                </button>
              </div>
            </div>

            {/* Tabs de modo */}
            <div className="flex gap-1 mb-3 border-b pb-3">
              {([
                { id: "dados",     label: "Dados Gerais", icon: "📋" },
                { id: "execucao",  label: "Execução",     icon: "⚡" },
                { id: "reajustes", label: "Reajustes",    icon: "📈" },
              ] as { id: DetailMode; label: string; icon: string }[]).map(({ id, label, icon }) => (
                <button
                  key={id}
                  onClick={() => setDetailMode(id)}
                  className={`flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-[11px] font-medium border transition-colors ${
                    detailMode === id
                      ? id === "execucao" ? "bg-sky-600 text-white border-sky-600"
                        : id === "reajustes" ? "bg-indigo-600 text-white border-indigo-600"
                        : "bg-slate-700 text-white border-slate-700"
                      : "bg-white text-slate-600 border-slate-200 hover:bg-slate-50"
                  }`}
                >
                  {icon} {label}
                </button>
              ))}
            </div>

            {/* ── Modo: Dados Gerais ─────────────────────────────────────────── */}
            {detailMode === "dados" && (<>
            <p className="text-sm leading-relaxed mb-3 border-b pb-3">
              {selected.descricao
                ? <span className="text-slate-700">{selected.descricao}</span>
                : <span className="text-slate-400 italic">Sem descrição cadastrada.</span>
              }
            </p>

            {/* Fiscal do contrato */}
            <div className="mb-3 border-b pb-3">
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs font-semibold text-slate-700">Fiscal do Contrato</span>
                {!editingFiscal && canEdit && (
                  <button
                    onClick={() => { setFiscalInput(selected.fiscal ?? ""); setEditingFiscal(true); }}
                    className="text-xs text-sky-600 hover:text-sky-800 border border-sky-200 rounded-lg px-2 py-0.5"
                  >
                    {selected.fiscal ? "Editar" : "+ Definir fiscal"}
                  </button>
                )}
              </div>
              {editingFiscal ? (
                <div className="flex gap-2 items-center">
                  <input
                    autoFocus
                    value={fiscalInput}
                    onChange={(e) => setFiscalInput(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") saveFiscal(); if (e.key === "Escape") setEditingFiscal(false); }}
                    placeholder="Nome do fiscal..."
                    className="flex-1 rounded-xl border px-3 py-1.5 text-sm outline-none focus:ring-2 focus:ring-sky-200"
                  />
                  <button
                    onClick={saveFiscal}
                    disabled={savingFiscal}
                    className="rounded-xl bg-sky-600 px-3 py-1.5 text-xs text-white hover:bg-sky-700 disabled:opacity-60"
                  >
                    {savingFiscal ? "..." : "Salvar"}
                  </button>
                  <button
                    onClick={() => setEditingFiscal(false)}
                    className="rounded-xl border px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-50"
                  >
                    Cancelar
                  </button>
                </div>
              ) : (
                <div className="text-sm">
                  {selected.fiscal
                    ? <span className="font-medium text-slate-800">{selected.fiscal}</span>
                    : <span className="text-slate-400 italic text-xs">Nenhum fiscal definido.</span>
                  }
                </div>
              )}
            </div>

            {/* Fornecedor / Identificação */}
            <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs text-slate-600">
              <div><span className="font-semibold">Fornecedor:</span> {selected.fornecedor ?? "–"}</div>
              <div><span className="font-semibold">CNPJ:</span> {selected.cnpj ?? "–"}</div>
              <div><span className="font-semibold">PAG/NUP:</span> {selected.pag_nup ?? "–"}</div>
              <div><span className="font-semibold">UGR:</span> {selected.ugr ?? "–"}</div>
              <div><span className="font-semibold">Início:</span> {fmtDate(selected.data_inicio)}</div>
              <div className="flex items-center gap-1.5 flex-wrap">
                <span className="font-semibold">Vigência até:</span>
                <span className={`rounded-md px-2 py-0.5 font-semibold text-xs ${
                  isVencido(selected.data_final)
                    ? "bg-orange-100 text-orange-700 border border-orange-300"
                    : selected.data_final
                    ? "bg-green-50 text-green-700 border border-green-200"
                    : ""
                }`}>
                  {fmtDate(selected.data_final)}
                </span>
                {isVencido(selected.data_final) && (
                  <span className="text-orange-600 font-semibold">— pendente de encerramento</span>
                )}
              </div>
              {selected.prazo_fin_1 && <div><span className="font-semibold">Prazo Fin 1:</span> {selected.prazo_fin_1}</div>}
              {selected.prazo_fin_2 && <div><span className="font-semibold">Prazo Fin 2:</span> {selected.prazo_fin_2}</div>}
            </div>

            {/* Valores financeiros */}
            <div className="mt-3 border-t pt-3">
              <div className="text-xs font-semibold text-slate-700 mb-2">Valores Financeiros</div>
              <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
                <div className="rounded-lg bg-slate-50 border p-2">
                  <div className="flex items-center justify-between gap-1">
                    <div className="text-slate-500">Valor Total do Contrato</div>
                    {canEditBudget && !editandoVlContratual && (
                      <button
                        onClick={() => { setVlContratualInput(selected.vl_contratual != null ? String(selected.vl_contratual) : ""); setEditandoVlContratual(true); }}
                        className="text-[11px] text-slate-400 hover:text-slate-600 leading-none shrink-0"
                        title="Editar valor total"
                      >✏️</button>
                    )}
                  </div>
                  {editandoVlContratual ? (
                    <div className="mt-1 flex gap-1">
                      <div className="flex items-center rounded border border-slate-200 overflow-hidden text-[11px] flex-1 min-w-0">
                        <span className="px-1.5 py-1 bg-slate-100 text-slate-500 border-r border-slate-200 select-none text-[10px]">R$</span>
                        <input
                          type="text"
                          value={vlContratualInput}
                          onChange={(e) => setVlContratualInput(e.target.value)}
                          onKeyDown={(e) => { if (e.key === "Enter") saveVlContratual(); if (e.key === "Escape") setEditandoVlContratual(false); }}
                          autoFocus
                          className="px-1.5 py-1 outline-none flex-1 min-w-0 bg-transparent text-slate-800 text-xs"
                        />
                      </div>
                      <button onClick={saveVlContratual} disabled={savingVlContratual} className="rounded bg-sky-600 text-white px-2 py-1 text-[11px] font-medium hover:bg-sky-700 disabled:opacity-50 shrink-0">
                        {savingVlContratual ? "…" : "OK"}
                      </button>
                      <button onClick={() => setEditandoVlContratual(false)} className="rounded border px-2 py-1 text-[11px] text-slate-500 hover:bg-slate-100 shrink-0">✕</button>
                    </div>
                  ) : (
                    <div className="font-semibold text-slate-800 mt-0.5">{fmtMoney(selected.vl_contratual)}</div>
                  )}
                </div>
                <div className="rounded-lg bg-amber-50 border border-amber-100 p-2">
                  <div className="text-amber-700">Valor a Liquidar</div>
                  <div className="font-semibold text-amber-900 mt-0.5">{fmtMoney(selected.saldo)}</div>
                </div>
                <div className="rounded-lg bg-indigo-50 border border-indigo-100 p-2">
                  <div className="text-indigo-700">Liquidado</div>
                  <div className="font-semibold text-indigo-900 mt-0.5">{fmtMoney(selected.vl_liquidado)}</div>
                </div>
                {/* 4º card — Saldo Atual (mostra vl_atual quando definido, senão vl_a_empenhar) */}
                <div className={`rounded-lg border p-2 ${
                  selected.vl_atual != null
                    ? "bg-sky-50 border-sky-200"
                    : selected.vl_a_empenhar != null && selected.vl_a_empenhar > 0
                    ? "bg-green-50 border-green-200"
                    : "bg-red-50 border-red-200"
                }`}>
                  <div className="flex items-center justify-between gap-1">
                    <div className={
                      selected.vl_atual != null ? "text-sky-700" :
                      selected.vl_a_empenhar != null && selected.vl_a_empenhar > 0 ? "text-green-700" : "text-red-700"
                    }>
                      Saldo
                      {selected.vl_atual != null
                        ? <span className="ml-1 text-[9px] bg-sky-100 text-sky-600 rounded px-1 py-0.5 font-semibold align-middle">ajustado ✓</span>
                        : " (a Empenhar)"}
                    </div>
                    {canEditBudget && (
                    <button
                      onClick={() => setEditandoVlAtual(v => !v)}
                      className="text-[11px] text-slate-400 hover:text-slate-600 leading-none shrink-0"
                      title="Definir saldo ajustado para reajuste"
                    >✏️</button>
                    )}
                  </div>
                  <div className={`font-bold text-base mt-0.5 ${
                    selected.vl_atual != null ? "text-sky-800" :
                    selected.vl_a_empenhar != null && selected.vl_a_empenhar > 0 ? "text-green-800" : "text-red-800"
                  }`}>
                    {fmtMoney(selected.vl_atual ?? selected.vl_a_empenhar)}
                  </div>
                  {editandoVlAtual && (
                    <div className="mt-1.5 pt-1.5 border-t border-slate-200 space-y-1">
                      <div className="flex gap-1">
                        <div className="flex items-center rounded border border-slate-200 overflow-hidden text-[11px] flex-1 min-w-0">
                          <span className="px-1.5 py-1 bg-slate-50 text-slate-500 border-r border-slate-200 select-none text-[10px]">R$</span>
                          <input
                            type="text"
                            value={vlAtualInput}
                            onChange={e => setVlAtualInput(e.target.value)}
                            onKeyDown={e => { if (e.key === "Enter") saveVlAtual(); }}
                            placeholder="0,00"
                            autoFocus
                            className="px-1.5 py-1 outline-none flex-1 min-w-0 bg-transparent text-slate-800 text-xs"
                          />
                        </div>
                        <button
                          onClick={saveVlAtual}
                          disabled={savingVlAtual}
                          className="rounded bg-sky-600 text-white px-2 py-1 text-[11px] font-medium hover:bg-sky-700 disabled:opacity-50 shrink-0"
                        >
                          {savingVlAtual ? "…" : "OK"}
                        </button>
                      </div>
                      {selected.vl_atual != null && (
                        <button
                          onClick={async () => {
                            const { error } = await supabase.from("contratos_scon").update({ vl_atual: null }).eq("id", selected.id);
                            if (!error) {
                              const upd = { ...selected, vl_atual: null };
                              setSelected(upd);
                              setContratos(prev => prev.map(c => c.id === selected.id ? upd : c));
                              setVlAtualInput("");
                              setEditandoVlAtual(false);
                            }
                          }}
                          className="text-[10px] text-red-500 hover:text-red-700"
                        >
                          Limpar valor ajustado
                        </button>
                      )}
                      {vlAtualMsg && (
                        <p className={`text-[10px] ${vlAtualMsg.ok ? "text-green-700" : "text-red-600"}`}>{vlAtualMsg.text}</p>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Documentos */}
            <div className="mt-3 border-t pt-3">
              <div className="text-xs font-semibold text-slate-700 mb-2">Documentos</div>

              {/* Abas */}
              <div className="flex gap-1 flex-wrap mb-3">
                {([
                  { id: "contrato",     label: "Contrato",           icon: "📄" },
                  { id: "tr",           label: "Termo de Referência",icon: "📋" },
                  { id: "aditivo",      label: "Termo Aditivo",      icon: "📝" },
                  { id: "apostilamento",label: "Apostilamento",      icon: "🔖" },
                ] as { id: DocTab; label: string; icon: string }[]).map(({ id, label, icon }) => (
                  <button
                    key={id}
                    onClick={() => setDocTab(id)}
                    className={`flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-[11px] font-medium border transition-colors ${
                      docTab === id
                        ? "bg-sky-600 text-white border-sky-600"
                        : "bg-white text-slate-600 border-slate-200 hover:bg-slate-50"
                    }`}
                  >
                    {icon} {label}
                  </button>
                ))}
              </div>

              {/* Conteúdo da aba */}
              {docTab === "apostilamento" && (
                <div className="space-y-3">
                  {/* Data base do orçamento */}
                  <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs space-y-2">
                    <div className="font-semibold text-amber-800">📅 Data base do orçamento (para reajuste)</div>
                    {canEditBudget ? (
                    <div className="flex items-center gap-2 flex-wrap">
                      <input
                        value={orcamentoInput}
                        onChange={(e) => setOrcamentoInput(e.target.value)}
                        onKeyDown={(e) => { if (e.key === "Enter") saveOrcamento(); }}
                        placeholder="MM/AAAA"
                        maxLength={7}
                        className="rounded-lg border border-amber-300 bg-white px-2.5 py-1.5 text-xs outline-none focus:ring-2 focus:ring-amber-300 w-28"
                      />
                      <button
                        onClick={saveOrcamento}
                        disabled={savingOrcamento}
                        className="rounded-lg bg-amber-500 px-3 py-1.5 text-xs text-white hover:bg-amber-600 disabled:opacity-60 font-medium"
                      >
                        {savingOrcamento ? "..." : "Salvar"}
                      </button>
                      {selected.data_orcamento && (
                        <span className="text-amber-700 font-medium">Atual: {toMmYyyy(selected.data_orcamento)}</span>
                      )}
                    </div>
                    ) : (
                    <div className="text-amber-700">
                      {selected.data_orcamento ? toMmYyyy(selected.data_orcamento) : <span className="text-amber-400 italic">Não definida</span>}
                      <span className="ml-2 text-[10px] text-amber-400">(somente SCON/ADMIN podem alterar)</span>
                    </div>
                    )}
                    {orcamentoMsg && (
                      <p className={orcamentoMsg.ok ? "text-green-700" : "text-red-600"}>{orcamentoMsg.text}</p>
                    )}
                  </div>
                  {/* Botão gerar apostilamento */}
                  <button
                    onClick={() => window.open(`/apt?tipo=contrato&id=${selected.id}`, "_blank")}
                    className="flex items-center gap-2 rounded-xl border border-sky-200 bg-sky-50 px-3 py-2 text-xs font-medium text-sky-700 hover:bg-sky-100 transition-colors"
                  >
                    🔖 Gerar Termo de Apostilamento
                  </button>
                  {/* Apostilamentos gerados e salvos */}
                  {contratoDocs.filter(d => d.tipo === "apostilamento").map(doc => (
                    <div key={doc.id} className="flex items-start gap-2 rounded-lg border border-sky-100 bg-sky-50 px-3 py-2 text-xs">
                      <span className="text-lg leading-none">🔖</span>
                      <div className="flex-1 min-w-0">
                        <span className="font-medium text-sky-800 truncate block">{doc.nome}</span>
                        <span className="text-slate-400">
                          {doc.user_nome ?? "Usuário"} · {new Date(doc.created_at).toLocaleDateString("pt-BR")}
                        </span>
                      </div>
                      {canEdit && (
                        <button onClick={() => handleDocDelete(doc.id)} className="text-red-400 hover:text-red-600 font-bold ml-1" title="Remover">✕</button>
                      )}
                    </div>
                  ))}
                </div>
              )}
              {(docTab === "contrato" || docTab === "tr") && (() => {
                const tipoLabel = docTab === "contrato" ? "Termo de Contrato" : "Termo de Referência";
                const docsDoTipo = contratoDocs.filter(d => d.tipo === docTab);
                return (
                  <div className="space-y-3">
                    {/* Upload */}
                    <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 p-3 text-xs space-y-2">
                      <div className="font-semibold text-slate-700">{tipoLabel}</div>
                      <button
                        disabled={docUploading}
                        onClick={() => { setPendingDocTipo(docTab); docFileRef.current?.click(); }}
                        className="flex items-center gap-2 rounded-lg bg-sky-600 px-3 py-1.5 text-white font-medium hover:bg-sky-700 disabled:opacity-60 transition-colors"
                      >
                        {docUploading ? "Enviando..." : "📎 Anexar PDF"}
                      </button>
                      {docMsg && (
                        <p className={docMsg.ok ? "text-green-700" : "text-red-600"}>{docMsg.text}</p>
                      )}
                    </div>
                    {/* Histórico */}
                    {docsDoTipo.length > 0 && (
                      <div className="space-y-2">
                        <div className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide">Documentos anexados</div>
                        {docsDoTipo.map(doc => (
                          <div key={doc.id} className="flex items-start gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs">
                            <span className="text-lg leading-none">📄</span>
                            <div className="flex-1 min-w-0">
                              {doc.url ? (
                                <a href={doc.url} target="_blank" rel="noopener noreferrer" className="font-medium text-sky-700 hover:underline truncate block">{doc.nome}</a>
                              ) : (
                                <span className="font-medium text-slate-700 truncate block">{doc.nome}</span>
                              )}
                              <span className="text-slate-400">
                                {doc.user_nome ?? "Usuário"} · {new Date(doc.created_at).toLocaleDateString("pt-BR")}
                              </span>
                            </div>
                            {canEdit && (
                              <button onClick={() => handleDocDelete(doc.id)} className="text-red-400 hover:text-red-600 font-bold ml-1" title="Remover">✕</button>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                    {docsDoTipo.length === 0 && !docUploading && (
                      <p className="text-[11px] text-slate-400 italic">Nenhum documento anexado.</p>
                    )}
                  </div>
                );
              })()}
              {docTab === "aditivo" && (
                <div className="space-y-3">
                  <button
                    onClick={() => window.open(`/apt?tipo=aditivo&id=${selected.id}`, "_blank")}
                    className="flex items-center gap-2 rounded-xl border border-indigo-200 bg-indigo-50 px-3 py-2 text-xs font-medium text-indigo-700 hover:bg-indigo-100 transition-colors"
                  >
                    📝 Gerar Termo Aditivo
                  </button>
                  {/* Docs gerados salvos */}
                  {contratoDocs.filter(d => d.tipo === "aditivo").map(doc => (
                    <div key={doc.id} className="flex items-start gap-2 rounded-lg border border-indigo-100 bg-indigo-50 px-3 py-2 text-xs">
                      <span className="text-lg leading-none">📝</span>
                      <div className="flex-1 min-w-0">
                        <span className="font-medium text-indigo-800 truncate block">{doc.nome}</span>
                        <span className="text-slate-400">
                          {doc.user_nome ?? "Usuário"} · {new Date(doc.created_at).toLocaleDateString("pt-BR")}
                        </span>
                      </div>
                      {canEdit && (
                        <button onClick={() => handleDocDelete(doc.id)} className="text-red-400 hover:text-red-600 font-bold ml-1" title="Remover">✕</button>
                      )}
                    </div>
                  ))}
                  {contratoDocs.filter(d => d.tipo === "aditivo").length === 0 && (
                    <p className="text-[11px] text-slate-400 italic">Nenhum termo aditivo gerado.</p>
                  )}
                </div>
              )}
            </div>
            </>)}

            {/* ── Modo: Execução ─────────────────────────────────────────────── */}
            {detailMode === "execucao" && (
              <div className="space-y-3">
                {execLoading && <p className="text-xs text-slate-500 text-center py-4">Carregando empenhos...</p>}
                {!execLoading && !selected.pag_nup && (
                  <p className="text-xs text-slate-400 italic text-center py-4">
                    PAG/NUP não preenchido — não é possível vincular empenhos.
                  </p>
                )}
                {!execLoading && selected.pag_nup && execLinhas.length === 0 && (
                  <p className="text-xs text-slate-400 italic text-center py-4">
                    Nenhum empenho encontrado para PAG <strong>{selected.pag_nup}</strong>.
                  </p>
                )}
                {!execLoading && execLinhas.length > 0 && (() => {
                  // Para cada NE: emite linha do ano de origem + linha RP (se houver)
                  const rows = execLinhas.flatMap((l) => {
                    const rp = rpMap.get(normalizeNE(l.nota_empenho));
                    const execRow = {
                      l,
                      isRP:       false as const,
                      rowKey:     l.nota_empenho + "_exec",
                      aLiquidar:  l.a_liquidar,
                      liquidado:  l.liquidado_pagar,
                      pago:       l.pago,
                      total:      l.a_liquidar + l.liquidado_pagar + l.pago,
                      favorecido: l.info_e || l.info_d,
                      descricao:  l.info_f,
                    };
                    if (rp) {
                      const rpRow = {
                        l,
                        isRP:       true as const,
                        rowKey:     l.nota_empenho + "_rp",
                        aLiquidar:  rp.rp_nao_proc_a_liq,
                        liquidado:  rp.rp_nao_proc_liq_pag + rp.rp_proc_a_pagar,
                        pago:       rp.rp_nao_proc_pago + rp.rp_proc_pagos,
                        total:      rp.rp_nao_proc_a_liq + rp.rp_nao_proc_liq_pag + rp.rp_nao_proc_pago + rp.rp_proc_a_pagar + rp.rp_proc_pagos,
                        favorecido: rp.favorecido || l.info_e || l.info_d,
                        descricao:  rp.descricao  || l.info_f,
                      };
                      // NE existe apenas no RP (linha sintética com zeros) — omite linha exec em branco
                      const execIsZero = l.a_liquidar === 0 && l.liquidado_pagar === 0 && l.pago === 0;
                      return execIsZero ? [rpRow] : [execRow, rpRow];
                    }
                    return [execRow];
                  });

                  const totalALiq = rows.reduce((s, r) => s + r.aLiquidar, 0);
                  const totalLiq  = rows.reduce((s, r) => s + r.liquidado, 0);
                  const totalPago = rows.reduce((s, r) => s + r.pago, 0);
                  const totalEmp  = totalALiq + totalLiq + totalPago;
                  const nRP       = rows.filter((r) => r.isRP).length;

                  return (
                    <>
                      {/* KPIs */}
                      <div className="grid grid-cols-2 gap-2 text-xs">
                        {[
                          { label: "Total Empenhado", val: totalEmp,  bg: "bg-sky-50 border-sky-200",       txt: "text-sky-800" },
                          { label: "A Liquidar",      val: totalALiq, bg: "bg-amber-50 border-amber-200",   txt: "text-amber-800" },
                          { label: "Liq. a Pagar",    val: totalLiq,  bg: "bg-indigo-50 border-indigo-200", txt: "text-indigo-800" },
                          { label: "Pago",            val: totalPago, bg: "bg-green-50 border-green-200",   txt: "text-green-800" },
                        ].map(k => (
                          <div key={k.label} className={`rounded-lg border p-2 ${k.bg}`}>
                            <div className="text-slate-500">{k.label}</div>
                            <div className={`font-semibold mt-0.5 ${k.txt}`}>{fmtMoney(k.val)}</div>
                          </div>
                        ))}
                      </div>

                      {/* Aviso de RP */}
                      {nRP > 0 && (
                        <div className="rounded-lg border border-orange-200 bg-orange-50 px-3 py-2 text-[11px] text-orange-700 flex items-center gap-2">
                          <span>⚠️</span>
                          <span>
                            <strong>{nRP} NE{nRP > 1 ? "s" : ""}</strong> com Restos a Pagar — histórico completo exibido (ano de origem + RP).
                          </span>
                        </div>
                      )}

                      {/* Tabela */}
                      <div className="overflow-x-auto rounded-xl border border-slate-200">
                        <table className="w-full text-[11px]">
                          <thead>
                            <tr className="bg-slate-50 border-b border-slate-200 text-slate-500 text-left">
                              <th className="px-3 py-2">NE</th>
                              <th className="px-3 py-2">Favorecido</th>
                              <th className="px-3 py-2 text-right">A Liquidar</th>
                              <th className="px-3 py-2 text-right">Liq/Pagar</th>
                              <th className="px-3 py-2 text-right">Pago</th>
                              <th className="px-2 py-2"></th>
                            </tr>
                          </thead>
                          <tbody>
                            {rows.map((r) => {
                              const key = r.rowKey;
                              const exp = execExpandedNE === key;
                              return (
                                <>
                                  <tr
                                    key={key}
                                    onClick={() => setExecExpandedNE(exp ? null : key)}
                                    className={`border-b border-slate-100 cursor-pointer hover:bg-slate-50 ${r.isRP ? "bg-orange-50/40" : ""}`}
                                  >
                                    <td className="px-3 py-2 whitespace-nowrap">
                                      <span className="font-mono font-semibold text-sky-700">
                                        {r.l.nota_empenho.slice(-6)}
                                      </span>
                                      {r.isRP ? (
                                        <span className="ml-1.5 rounded px-1 py-0.5 text-[9px] font-bold bg-orange-200 text-orange-800 align-middle">RP</span>
                                      ) : (
                                        <span className="ml-1.5 rounded px-1 py-0.5 text-[9px] font-semibold bg-sky-100 text-sky-700 align-middle">
                                          {r.l.nota_empenho.slice(0, 4)}
                                        </span>
                                      )}
                                    </td>
                                    <td className="px-3 py-2 text-slate-600 truncate max-w-[120px]">{r.favorecido}</td>
                                    <td className="px-3 py-2 text-right text-amber-700">{r.aLiquidar > 0 ? fmtMoney(r.aLiquidar) : <span className="text-slate-300">–</span>}</td>
                                    <td className="px-3 py-2 text-right text-indigo-700">{r.liquidado > 0 ? fmtMoney(r.liquidado) : <span className="text-slate-300">–</span>}</td>
                                    <td className="px-3 py-2 text-right text-green-700">{r.pago > 0 ? fmtMoney(r.pago) : <span className="text-slate-300">–</span>}</td>
                                    <td className="px-2 py-2 text-slate-400">{exp ? "▲" : "▼"}</td>
                                  </tr>
                                  {exp && (
                                    <tr key={key + "_det"} className="bg-slate-50">
                                      <td colSpan={6} className="px-4 py-3 text-[11px] text-slate-600">
                                        <div className="grid grid-cols-2 gap-x-6 gap-y-1">
                                          <div><span className="font-semibold">NE Completa:</span> {r.l.nota_empenho}</div>
                                          <div><span className="font-semibold">Favorecido:</span> {r.favorecido}</div>
                                          <div><span className="font-semibold">Descrição:</span> {r.descricao || "–"}</div>
                                          <div><span className="font-semibold">PAG:</span> {r.l.info_g || "–"}</div>
                                          <div><span className="font-semibold">Total linha:</span> {fmtMoney(r.total)}</div>
                                          {r.isRP && (
                                            <div className="col-span-2 mt-1 text-orange-700 font-medium">
                                              ⚠️ Restos a Pagar — A Liq.: {fmtMoney(r.aLiquidar)} · Liq/Pagar: {fmtMoney(r.liquidado)} · Pago: {fmtMoney(r.pago)}
                                            </div>
                                          )}
                                        </div>
                                      </td>
                                    </tr>
                                  )}
                                </>
                              );
                            })}
                          </tbody>
                        </table>
                      {/* Estimativa para o próximo ano — usa início do contrato como âncora */}
                      {(() => {
                        const todayYear  = new Date().getFullYear();
                        const todayMonth = new Date().getMonth() + 1;
                        const IPCA       = 0.051;

                        // Soma TODOS os pagamentos (qualquer NE, incluindo RP):
                        // NEs de exercícios anteriores podem estar liquidando faturas do contrato atual.
                        const totalPago = rows.reduce((s, r) =>
                          s + r.pago + (r.isRP ? 0 : r.liquidado), 0
                        );
                        if (totalPago === 0) return null;

                        // Denominador: meses desde o início do contrato até o mês anterior
                        const ini        = selected.data_inicio ? new Date(selected.data_inicio + "T12:00:00") : null;
                        const cStartYear  = ini ? ini.getFullYear() : todayYear;
                        const cStartMonth = ini ? ini.getMonth() + 1 : 1;
                        const monthsElapsed = Math.max(1,
                          (todayYear * 12 + todayMonth - 1) - (cStartYear * 12 + cStartMonth - 1)
                        );

                        const predMensal = (totalPago / monthsElapsed) * (1 + IPCA);
                        const predAnual  = predMensal * 12;
                        const nextYear   = todayYear + 1;

                        // Agrupa por ano do NE apenas para exibição informativa
                        const byYear = new Map<number, number>();
                        for (const r of rows) {
                          const m = r.l.nota_empenho.match(/^(\d{4})NE/i);
                          if (!m) continue;
                          const yr  = parseInt(m[1]);
                          const val = r.pago + (r.isRP ? 0 : r.liquidado);
                          if (val > 0) byYear.set(yr, (byYear.get(yr) ?? 0) + val);
                        }
                        const pts = [...byYear.entries()].sort((a, b) => a[0] - b[0]);

                        return (
                          <div className="mt-3 rounded-xl border border-sky-200 bg-sky-50 px-4 py-3 text-xs space-y-2">
                            <div className="font-semibold text-sky-800">
                              Estimativa de empenho para {nextYear}
                            </div>

                            {/* Histórico por ano do NE (informativo) */}
                            <div className="flex flex-wrap gap-x-4 gap-y-1">
                              {pts.map(([yr, v]) => (
                                <span key={yr} className="text-slate-500">
                                  <span className="font-semibold text-slate-700">{yr}:</span>{" "}
                                  {fmtMoney(v)}
                                </span>
                              ))}
                            </div>

                            <div className="grid grid-cols-2 gap-3 pt-1">
                              <div>
                                <div className="text-slate-500">Previsão anual</div>
                                <div className="font-bold text-sky-700 text-sm">{fmtMoney(predAnual)}</div>
                                <div className="text-[10px] text-slate-400">base {fmtMoney(predAnual / (1 + IPCA))} + IPCA {(IPCA * 100).toFixed(1)}%</div>
                              </div>
                              <div>
                                <div className="text-slate-500">Estimativa mensal</div>
                                <div className="font-bold text-sky-700 text-sm">{fmtMoney(predMensal)}</div>
                              </div>
                            </div>

                            <div className="text-slate-400 text-[10px]">
                              Base: {fmtMoney(totalPago)} em {monthsElapsed} mes{monthsElapsed !== 1 ? "es" : ""} (desde {String(cStartMonth).padStart(2, "0")}/{cStartYear}) + IPCA {(IPCA * 100).toFixed(1)}%
                            </div>
                          </div>
                        );
                      })()}
                      </div>
                    </>
                  );
                })()}
              </div>
            )}

            {/* ── Modo: Reajustes ────────────────────────────────────────────── */}
            {detailMode === "reajustes" && (
              <div className="space-y-3">
                {/* Upload PDF */}
                {!reajusteForm && (
                  <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 p-4 text-center space-y-2">
                    <p className="text-xs text-slate-500 font-medium">
                      Importe um <strong>Termo Aditivo</strong> ou <strong>Apostilamento</strong> em PDF para registrar o reajuste.
                    </p>
                    <button
                      onClick={() => reajusteFileRef.current?.click()}
                      disabled={reajusteParsing}
                      className="rounded-lg bg-indigo-600 px-4 py-2 text-xs text-white font-medium hover:bg-indigo-700 disabled:opacity-60 transition-colors"
                    >
                      {reajusteParsing ? "Lendo PDF..." : "📎 Selecionar PDF"}
                    </button>
                    <input ref={reajusteFileRef} type="file" accept=".pdf" className="hidden" onChange={handleReajustePdf} />
                  </div>
                )}

                {/* Formulário de revisão */}
                {reajusteForm && (
                  <div className="rounded-xl border border-indigo-200 bg-indigo-50 p-3 space-y-3 text-xs">
                    <div className="flex items-center justify-between">
                      <span className="font-semibold text-indigo-800">Revisão — confirme os dados extraídos</span>
                      <button onClick={() => setReajusteForm(null)} className="text-slate-400 hover:text-slate-600 text-sm">✕</button>
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="text-slate-600 font-medium">Tipo de documento</label>
                        <select value={reajusteForm.tipo_doc} onChange={(e) => setReajusteForm(f => f ? { ...f, tipo_doc: e.target.value } : f)}
                          className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-xs outline-none focus:ring-2 focus:ring-indigo-200">
                          <option>Termo Aditivo</option>
                          <option>Apostilamento</option>
                        </select>
                      </div>
                      <div>
                        <label className="text-slate-600 font-medium">Tipo de alteração</label>
                        <select value={reajusteForm.tipo_alteracao} onChange={(e) => setReajusteForm(f => f ? { ...f, tipo_alteracao: e.target.value } : f)}
                          className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-xs outline-none focus:ring-2 focus:ring-indigo-200">
                          <option value="valor">Reajuste de valor</option>
                          <option value="prazo">Prorrogação de prazo</option>
                          <option value="ambos">Valor + Prazo</option>
                        </select>
                      </div>
                    </div>

                    <div>
                      <label className="text-slate-600 font-medium">Objeto / Ementa do documento</label>
                      <textarea value={reajusteForm.objeto_doc} onChange={(e) => setReajusteForm(f => f ? { ...f, objeto_doc: e.target.value } : f)}
                        rows={3} className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-xs outline-none focus:ring-2 focus:ring-indigo-200 resize-none" />
                    </div>

                    {(reajusteForm.tipo_alteracao === "valor" || reajusteForm.tipo_alteracao === "ambos") && (
                      <div className="grid grid-cols-3 gap-3">
                        <div>
                          <label className="text-slate-600 font-medium">Valor anterior (R$)</label>
                          <input type="text" value={reajusteForm.valor_anterior}
                            onChange={(e) => setReajusteForm(f => f ? { ...f, valor_anterior: e.target.value } : f)}
                            className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-xs outline-none focus:ring-2 focus:ring-indigo-200" />
                        </div>
                        <div>
                          <label className="text-slate-600 font-medium">Percentual (%)</label>
                          <input type="text" placeholder="ex: 5.96" value={reajusteForm.percentual}
                            onChange={(e) => {
                              const pct = e.target.value;
                              const valAnt = toNum(reajusteForm.valor_anterior);
                              const pctN = toNum(pct);
                              let novo = reajusteForm.valor_novo;
                              if (pctN !== null && valAnt !== null) novo = String(Math.round(valAnt * (1 + pctN / 100) * 100) / 100);
                              setReajusteForm(f => f ? { ...f, percentual: pct, valor_novo: novo } : f);
                            }}
                            className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-xs outline-none focus:ring-2 focus:ring-indigo-200" />
                        </div>
                        <div>
                          <label className="text-slate-600 font-medium">Novo valor (R$)</label>
                          <input type="text" value={reajusteForm.valor_novo}
                            onChange={(e) => setReajusteForm(f => f ? { ...f, valor_novo: e.target.value } : f)}
                            className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-xs outline-none focus:ring-2 focus:ring-indigo-200" />
                        </div>
                      </div>
                    )}

                    {(reajusteForm.tipo_alteracao === "prazo" || reajusteForm.tipo_alteracao === "ambos") && (
                      <div className="grid grid-cols-3 gap-3">
                        <div>
                          <label className="text-slate-600 font-medium">Vigência anterior</label>
                          <input type="date" value={reajusteForm.data_fim_anterior}
                            onChange={(e) => setReajusteForm(f => f ? { ...f, data_fim_anterior: e.target.value } : f)}
                            className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-xs outline-none focus:ring-2 focus:ring-indigo-200" />
                        </div>
                        <div>
                          <label className="text-slate-600 font-medium">Meses acrescidos</label>
                          <input type="text" placeholder="ex: 12" value={reajusteForm.meses_acrescidos}
                            onChange={(e) => {
                              const m = e.target.value;
                              let nova = reajusteForm.data_fim_nova;
                              const mN = parseInt(m);
                              if (!isNaN(mN) && reajusteForm.data_fim_anterior) {
                                const d = new Date(reajusteForm.data_fim_anterior + "T12:00:00");
                                d.setMonth(d.getMonth() + mN);
                                nova = d.toISOString().slice(0, 10);
                              }
                              setReajusteForm(f => f ? { ...f, meses_acrescidos: m, data_fim_nova: nova } : f);
                            }}
                            className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-xs outline-none focus:ring-2 focus:ring-indigo-200" />
                        </div>
                        <div>
                          <label className="text-slate-600 font-medium">Nova vigência</label>
                          <input type="date" value={reajusteForm.data_fim_nova}
                            onChange={(e) => setReajusteForm(f => f ? { ...f, data_fim_nova: e.target.value } : f)}
                            className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-xs outline-none focus:ring-2 focus:ring-indigo-200" />
                        </div>
                      </div>
                    )}

                    {reajusteMsg && (
                      <p className={`text-xs font-medium ${reajusteMsg.ok ? "text-green-700" : "text-red-600"}`}>{reajusteMsg.text}</p>
                    )}

                    <div className="flex gap-2">
                      <button onClick={saveReajuste} disabled={reajusteSaving}
                        className="rounded-lg bg-green-600 px-4 py-1.5 text-xs text-white font-medium hover:bg-green-700 disabled:opacity-60">
                        {reajusteSaving ? "Salvando..." : "✓ Confirmar e Registrar"}
                      </button>
                      <button onClick={() => reajusteFileRef.current?.click()} disabled={reajusteParsing}
                        className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-50 disabled:opacity-60">
                        {reajusteParsing ? "Lendo..." : "↩ Outro PDF"}
                      </button>
                      <input ref={reajusteFileRef} type="file" accept=".pdf" className="hidden" onChange={handleReajustePdf} />
                    </div>
                  </div>
                )}

                {reajusteMsg && !reajusteForm && (
                  <p className={`text-xs font-medium px-1 ${reajusteMsg.ok ? "text-green-700" : "text-red-600"}`}>{reajusteMsg.text}</p>
                )}

                {/* Histórico */}
                {reajustes.length > 0 && (
                  <div className="space-y-2">
                    <div className="text-xs font-semibold text-slate-600">Histórico de reajustes</div>
                    {reajustes.map((r) => (
                      <div key={r.id} className="rounded-xl border border-slate-200 bg-white p-3 text-xs space-y-1">
                        <div className="flex items-center justify-between gap-2">
                          <span className={`font-semibold ${r.tipo_doc === "Apostilamento" ? "text-amber-700" : "text-indigo-700"}`}>{r.tipo_doc}</span>
                          <span className="text-slate-400">{new Date(r.created_at).toLocaleDateString("pt-BR")}</span>
                        </div>
                        {r.objeto_doc && <p className="text-slate-600 leading-snug">{r.objeto_doc}</p>}
                        <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-slate-500">
                          {r.percentual != null && <span>Percentual: <strong className="text-slate-700">{r.percentual}%</strong></span>}
                          {r.valor_anterior != null && <span>De: <strong className="text-slate-700">{fmtMoney(r.valor_anterior)}</strong></span>}
                          {r.valor_novo != null && <span>Para: <strong className="text-green-700">{fmtMoney(r.valor_novo)}</strong></span>}
                          {r.meses_acrescidos != null && <span>+<strong className="text-slate-700">{r.meses_acrescidos} meses</strong></span>}
                          {r.data_fim_nova && <span>Até: <strong className="text-slate-700">{fmtDate(r.data_fim_nova)}</strong></span>}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
                {reajustes.length === 0 && !reajusteForm && (
                  <p className="text-xs text-slate-400 italic text-center py-2">Nenhum reajuste registrado.</p>
                )}
              </div>
            )}
          </Card>
          </div>
        )}
      </div>
      </>)}

    </div>
  );
}
