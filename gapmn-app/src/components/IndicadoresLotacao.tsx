import { Fragment, useState, useEffect, useMemo, useRef } from "react";
import { supabase } from "../lib/supabase";
import { Card } from "./Card";
import * as XLSX from "xlsx";

// ─── Types ────────────────────────────────────────────────────────────────────
type IndicadorLotacao = {
  id: string;
  conta_corrente: string;
  descricao: string | null;
  uge: string | null;
  ug_cred: string | null;
  gestao: string | null;
  ano: string | null;
  natureza: string | null;
  sub_elemento: string | null;
  ptres: string | null;
  plano_interno: string | null;
  fonte_recurso: string | null;
  acao: string | null;
  dotacao: number | null;
  utilizacao: number | null;
  saldo: number | null;
  projetos: string | null;
  nota_credito: string | null;
  ug_coordenadora: string | null;
  created_at: string;
};

type EmpenhoSeo = {
  id: string;
  empenho: string;
  si: string | null;
  empresa: string | null;
  valor: number | null;
  contrato: string | null;
  // ── novos campos ──
  liquidado: number | null;
  saldo_emp: number | null;
  indicador_lotacao: string | null; // → conta_corrente em indicadores_lotacao
  licitacao_siasg: string | null;
  created_at: string;
};

type ContratoMin = {
  id: string;
  numero_contrato: string;
  fornecedor: string | null;
  descricao: string | null;
  saldo: number | null;
  vl_contratual: number | null;
  data_final: string | null;
  uge: string | null;
  acao: string | null;
};

// ─── Helpers ──────────────────────────────────────────────────────────────────
function fmtMoney(v: number | null | undefined): string {
  if (v == null) return "–";
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(v);
}

function fmtDate(d: string | null | undefined): string {
  if (!d) return "–";
  try { return new Date(d + "T12:00:00").toLocaleDateString("pt-BR"); }
  catch { return d; }
}

function normH(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
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

function toNum(v: unknown): number | null {
  if (v == null || v === "") return null;
  if (typeof v === "number") return isNaN(v) ? null : v;
  let s = String(v).replace(/R\$\s?/g, "").replace(/\s/g, "").trim();
  if (!s) return null;
  const hasDot   = s.includes(".");
  const hasComma = s.includes(",");
  if (hasDot && hasComma) {
    // Ambos: último separador é o decimal
    if (s.lastIndexOf(",") > s.lastIndexOf(".")) {
      s = s.replace(/\./g, "").replace(",", "."); // BR: 1.234,56
    } else {
      s = s.replace(/,/g, "");                    // US: 1,234.56
    }
  } else if (hasComma && !hasDot) {
    s = s.replace(/,/g, "").length === s.replace(/,/g, "").length
      ? s.replace(",", ".")
      : s.replace(/,/g, "");
    // Simplificado: vírgula sozinha → decimal BR
    s = String(v).replace(/R\$\s?/g, "").replace(/\s/g, "").trim().replace(",", ".");
  } else if (hasDot && !hasComma) {
    const partes = s.split(".");
    if (partes.length > 2) {
      // Múltiplos pontos → todos são separadores de milhar: 1.234.567 → 1234567
      s = s.replace(/\./g, "");
    } else if (partes.length === 2 && partes[1].length === 3 && partes[0].length <= 3) {
      // Único ponto + exatamente 3 decimais + parte inteira curta → milhar: 1.234 → 1234
      s = s.replace(/\./g, "");
    }
    // Caso contrário (ex: 1120000.0000 ou 11200000.000) → ponto decimal → manter
  }
  const n = parseFloat(s);
  return isNaN(n) ? null : n;
}

// Valores do SILOMS sempre usam ponto como separador decimal (formato US):
// ex: 16411.2400 → 16411.24   |   1120000.0000 → 1120000
function toNumUS(v: unknown): number | null {
  if (v == null || v === "") return null;
  if (typeof v === "number") return isNaN(v) ? null : v;
  // Remove R$, espaços e vírgulas (separador de milhar US), mantém o ponto decimal
  const s = String(v).replace(/R\$\s?/g, "").replace(/\s/g, "").replace(/,/g, "").trim();
  if (!s) return null;
  const n = parseFloat(s);
  return isNaN(n) ? null : n;
}

// ─── Parsers ──────────────────────────────────────────────────────────────────
function parseIndicadoresBuffer(buf: ArrayBuffer): Partial<IndicadorLotacao>[] {
  const wb = XLSX.read(buf, { type: "array", cellDates: false });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const raw: unknown[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" });

  const KEYWORDS = ["conta", "uge", "natureza", "saldo", "dotacao", "ptres"];
  let hIdx = -1, bestScore = 0;
  for (let i = 0; i < Math.min(raw.length, 6); i++) {
    const row = (raw[i] ?? []) as unknown[];
    const normalized = row.map((c) => normH(String(c)));
    const score = KEYWORDS.filter((k) => normalized.some((n) => n.includes(k))).length;
    if (score > bestScore) { bestScore = score; hIdx = i; }
  }
  if (bestScore < 2) hIdx = 1;
  if (hIdx === -1 || raw.length <= hIdx + 1) return [];

  const headers = (raw[hIdx] as string[]).map(String);
  const nh = headers.map(normH);

  const idx = {
    conta_corrente:  colIdx(headers, "conta corrente", "contacorrente"),
    descricao:       colIdx(headers, "descricao", "digito"),
    uge:             colIdx(headers, "uge"),
    ug_cred:         (() => {
      const n = normH("ug cred");
      const i = nh.findIndex((h) => h.includes(n));
      return i !== -1 ? i : colIdx(headers, "ugcred");
    })(),
    gestao:          colIdx(headers, "gestao"),
    ano:             colIdx(headers, "ano"),
    natureza:        colIdx(headers, "natureza"),
    sub_elemento:    colIdx(headers, "sub elemento", "subelemento"),
    ptres:           colIdx(headers, "ptres", "ptre"),
    plano_interno:   colIdx(headers, "plano interno", "planointerno"),
    fonte_recurso:   colIdx(headers, "fonte recurso", "fonterecurso", "fonte de recurso"),
    acao:            colIdx(headers, "acao"),
    dotacao:         colIdx(headers, "dotacao"),
    utilizacao:      colIdx(headers, "utilizacao"),
    saldo:           colIdx(headers, "saldo"),
    projetos:        colIdx(headers, "projetos"),
    nota_credito:    colIdx(headers, "notas de credito", "nota credito", "notasdecredito", "notadecredito"),
    ug_coordenadora: colIdx(headers, "coordenadora", "ug coordenadora"),
  };

  console.log("[GAP-MN Indicadores] Headers:", headers.map((h, i) => `[${i}] "${h}" → "${nh[i]}"`).join(" | "));
  console.log("[GAP-MN Indicadores] Mapeamento:", idx);

  const rows: Partial<IndicadorLotacao>[] = [];
  for (let i = hIdx + 1; i < raw.length; i++) {
    const row = raw[i] as unknown[];
    const get = (key: keyof typeof idx): unknown => idx[key] !== -1 ? row[idx[key]] : "";
    const str = (key: keyof typeof idx): string | null => {
      const v = String(get(key) ?? "").trim(); return v || null;
    };
    const cc = str("conta_corrente");
    if (!cc) continue;
    rows.push({
      conta_corrente: cc, descricao: str("descricao"),
      uge: str("uge"), ug_cred: str("ug_cred"), gestao: str("gestao"),
      ano: str("ano"), natureza: str("natureza"), sub_elemento: str("sub_elemento"),
      ptres: str("ptres"), plano_interno: str("plano_interno"),
      fonte_recurso: str("fonte_recurso"), acao: str("acao"),
      dotacao: toNum(get("dotacao")), utilizacao: toNum(get("utilizacao")),
      saldo: toNum(get("saldo")), projetos: str("projetos"),
      nota_credito: str("nota_credito"), ug_coordenadora: str("ug_coordenadora"),
    });
  }
  return rows;
}

function parseEmpenhoBuffer(buf: ArrayBuffer): Partial<EmpenhoSeo>[] {
  const wb = XLSX.read(buf, { type: "array", cellDates: false });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const raw: unknown[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" });

  // Detect header row
  const KEYWORDS = ["empenho", "valor", "liquidado", "saldo", "indicador", "contrato", "licitacao", "empresa"];
  let hIdx = -1, bestScore = 0;
  for (let i = 0; i < Math.min(raw.length, 6); i++) {
    const row = (raw[i] ?? []) as unknown[];
    const normalized = row.map((c) => normH(String(c)));
    const score = KEYWORDS.filter((k) => normalized.some((n) => n.includes(k))).length;
    if (score > bestScore) { bestScore = score; hIdx = i; }
  }
  if (bestScore < 2) hIdx = 0;
  if (hIdx === -1 || raw.length <= hIdx + 1) return [];

  const headers = (raw[hIdx] as string[]).map(String);
  const idx = {
    empenho:           colIdx(headers, "empenho"),
    empresa:           colIdx(headers, "empresa", "favorecido", "credor"),
    valor:             colIdx(headers, "valor"),
    liquidado:         colIdx(headers, "liquidado"),
    saldo_emp:         colIdx(headers, "saldo"),
    indicador_lotacao: colIdx(headers, "indicador", "indicador de lotacao", "conta corrente"),
    // CONTRATO tem prioridade; SIASG como fallback
    contrato:          (() => {
      const iC = colIdx(headers, "contrat");
      if (iC !== -1) return iC;
      return colIdx(headers, "licitacao siasg", "siasg", "licitacao");
    })(),
    licitacao_siasg:   colIdx(headers, "licitacao siasg", "siasg"),
    si:                colIdx(headers, "si"),
  };

  console.log("[GAP-MN Empenhos] Headers:", headers);
  console.log("[GAP-MN Empenhos] Mapeamento:", idx);

  const rows: Partial<EmpenhoSeo>[] = [];
  for (let i = hIdx + 1; i < raw.length; i++) {
    const row = raw[i] as unknown[];
    const get = (key: keyof typeof idx): unknown => idx[key] !== -1 ? row[idx[key]] : "";
    const str = (key: keyof typeof idx): string | null => {
      const v = String(get(key) ?? "").trim(); return v || null;
    };
    const empenho = str("empenho");
    if (!empenho) continue;
    rows.push({
      empenho,
      empresa:           str("empresa"),
      valor:             toNumUS(get("valor")),
      liquidado:         toNumUS(get("liquidado")),
      saldo_emp:         toNumUS(get("saldo_emp")),
      indicador_lotacao: str("indicador_lotacao"),
      contrato:          str("contrato"),
      licitacao_siasg:   str("licitacao_siasg"),
      si:                str("si"),
    });
  }
  return rows;
}

// ─── Component ────────────────────────────────────────────────────────────────
interface Props { canImport: boolean; }

export default function IndicadoresLotacao({ canImport }: Props) {
  type SubTab = "indicadores" | "empenhos" | "gerenciamento";
  const [subTab, setSubTab] = useState<SubTab>("indicadores");
  const [showHelp, setShowHelp] = useState(false);

  // ── Data state ────────────────────────────────────────────────────────────
  const [indicadores, setIndicadores] = useState<IndicadorLotacao[]>([]);
  const [loadingInd, setLoadingInd]   = useState(true);
  const [errInd, setErrInd]           = useState<string | null>(null);
  const [previewInd, setPreviewInd]   = useState<{ rows: Partial<IndicadorLotacao>[]; novos: number; aAtualizar: number } | null>(null);
  const [importingInd, setImportingInd] = useState(false);
  const [clearingInd, setClearingInd]   = useState(false);
  const fileIndRef = useRef<HTMLInputElement>(null);

  const [empenhos, setEmpenhos]     = useState<EmpenhoSeo[]>([]);
  const [loadingEmp, setLoadingEmp] = useState(true);
  const [errEmp, setErrEmp]         = useState<string | null>(null);
  const [previewEmp, setPreviewEmp] = useState<{ rows: Partial<EmpenhoSeo>[]; novos: number; existentes: number } | null>(null);
  const [importingEmp, setImportingEmp] = useState(false);
  const [clearingEmp, setClearingEmp]   = useState(false);
  const fileEmpRef = useRef<HTMLInputElement>(null);

  const [contratos, setContratos] = useState<ContratoMin[]>([]);

  // ── UI state ──────────────────────────────────────────────────────────────
  const [indRowExp,   setIndRowExp]   = useState<string | null>(null); // expand NC in ind table
  const [contRowExp,  setContRowExp]  = useState<string | null>(null); // expand contract card
  const [indInCtExp,  setIndInCtExp]  = useState<string | null>(null); // expand ind inside contract

  // ── Filters ───────────────────────────────────────────────────────────────
  const [filtroSaldo,       setFiltroSaldo]       = useState(false);
  const [filtroDuplicados,  setFiltroDuplicados]  = useState(false);
  const [filtroNatureza,    setFiltroNatureza]    = useState("todos");
  const [filtroPI,          setFiltroPI]          = useState("todos");
  const [filtroUgCred,      setFiltroUgCred]      = useState("todos");
  const [filtroTexto,       setFiltroTexto]       = useState("");
  const [filtroContrato,    setFiltroContrato]    = useState("");

  // ── PI descriptions (from pi_descricoes table, synced daily from Google Sheets) ──
  const [piDesc, setPiDesc] = useState<Map<string, string>>(new Map());

  // ── Load ──────────────────────────────────────────────────────────────────
  useEffect(() => { loadIndicadores(); loadEmpenhos(); loadContratos(); loadPiDescricoes(); }, []);

  async function loadPiDescricoes() {
    const { data } = await supabase.from("pi_descricoes").select("codigo, descricao");
    if (data) setPiDesc(new Map(data.map((r: any) => [r.codigo as string, r.descricao as string])));
  }

  async function loadIndicadores() {
    setLoadingInd(true); setErrInd(null);
    const { data, error } = await supabase.from("indicadores_lotacao").select("*").order("conta_corrente");
    if (error) setErrInd(error.message);
    else setIndicadores((data ?? []) as IndicadorLotacao[]);
    setLoadingInd(false);
  }

  async function loadEmpenhos() {
    setLoadingEmp(true); setErrEmp(null);
    const { data, error } = await supabase.from("empenhos_seo").select("*").order("empenho");
    if (error) setErrEmp(error.message);
    else setEmpenhos((data ?? []) as EmpenhoSeo[]);
    setLoadingEmp(false);
  }

  async function loadContratos() {
    const { data } = await supabase
      .from("contratos_scon")
      .select("id, numero_contrato, fornecedor, descricao, saldo, vl_contratual, data_final, uge, acao");
    setContratos((data ?? []) as ContratoMin[]);
  }

  // ── Indicadores import ────────────────────────────────────────────────────
  async function handleFileIndChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]; if (!file) return;
    setErrInd(null); setPreviewInd(null);
    try {
      const buf = await file.arrayBuffer();
      const rows = parseIndicadoresBuffer(buf);
      if (rows.length === 0) { setErrInd("Nenhum dado encontrado. Verifique o arquivo."); return; }
      const existingKeys = new Set(indicadores.map((r) => `${r.conta_corrente}||${r.nota_credito ?? ""}`));
      const novos = rows.filter((r) => !existingKeys.has(`${r.conta_corrente}||${r.nota_credito ?? ""}`));
      const aAtualizar = rows.length - novos.length;
      setPreviewInd({ rows, novos: novos.length, aAtualizar });
    } catch (e: any) { setErrInd(e?.message ?? "Erro ao ler arquivo."); }
    e.target.value = "";
  }

  async function handleImportInd() {
    if (!previewInd || previewInd.rows.length === 0) return;
    setImportingInd(true); setErrInd(null);
    try {
      const existingMap = new Map(indicadores.map((r) => [`${r.conta_corrente}||${r.nota_credito ?? ""}`, r]));
      const toInsert: Partial<IndicadorLotacao>[] = [];
      const toUpdate: Array<{ id: string; patch: Partial<IndicadorLotacao> }> = [];

      for (const row of previewInd.rows) {
        const key = `${row.conta_corrente}||${row.nota_credito ?? ""}`;
        const existing = existingMap.get(key);
        if (existing) {
          const { conta_corrente: _cc, nota_credito: _nc, id: _id, created_at: _ca, ...updatable } = row as any;
          toUpdate.push({ id: existing.id, patch: updatable });
        } else {
          toInsert.push(row);
        }
      }

      // Inserir novos em lotes de 100
      for (let i = 0; i < toInsert.length; i += 100) {
        const { error } = await supabase.from("indicadores_lotacao").insert(toInsert.slice(i, i + 100) as any[]);
        if (error) throw error;
      }
      // Atualizar existentes
      for (const { id, patch } of toUpdate) {
        const { error } = await supabase.from("indicadores_lotacao").update(patch as any).eq("id", id);
        if (error) throw error;
      }

      setPreviewInd(null); await loadIndicadores();
    } catch (e: any) { setErrInd(e?.message ?? "Erro ao importar."); }
    finally { setImportingInd(false); }
  }

  async function clearIndicadores() {
    if (!window.confirm(`Remover todos os ${indicadores.length} indicadores? Esta ação não pode ser desfeita.`)) return;
    setClearingInd(true); setErrInd(null);
    try {
      const { error } = await supabase.from("indicadores_lotacao").delete().not("id", "is", null);
      if (error) throw error;
      setIndRowExp(null); await loadIndicadores();
    } catch (e: any) { setErrInd(e?.message ?? "Erro ao remover."); }
    finally { setClearingInd(false); }
  }

  // ── Empenhos import ───────────────────────────────────────────────────────
  async function handleFileEmpChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]; if (!file) return;
    setErrEmp(null); setPreviewEmp(null);
    try {
      const buf = await file.arrayBuffer();
      const rows = parseEmpenhoBuffer(buf);
      if (rows.length === 0) { setErrEmp("Nenhum dado encontrado. Verifique o arquivo."); return; }
      const existingKeys = new Set(empenhos.map((r) => `${r.empenho}||${r.contrato ?? ""}`));
      const novos = rows.filter((r) => !existingKeys.has(`${r.empenho}||${r.contrato ?? ""}`));
      setPreviewEmp({ rows: novos, novos: novos.length, existentes: rows.length - novos.length });
    } catch (e: any) { setErrEmp(e?.message ?? "Erro ao ler arquivo."); }
    e.target.value = "";
  }

  async function handleImportEmp() {
    if (!previewEmp || previewEmp.rows.length === 0) return;
    setImportingEmp(true); setErrEmp(null);
    try {
      for (let i = 0; i < previewEmp.rows.length; i += 100) {
        const { error } = await supabase.from("empenhos_seo").insert(previewEmp.rows.slice(i, i + 100) as any[]);
        if (error) throw error;
      }
      setPreviewEmp(null); await loadEmpenhos();
    } catch (e: any) { setErrEmp(e?.message ?? "Erro ao importar."); }
    finally { setImportingEmp(false); }
  }

  async function clearEmpenhos() {
    if (!window.confirm(`Remover todos os ${empenhos.length} empenhos?`)) return;
    setClearingEmp(true); setErrEmp(null);
    try {
      const { error } = await supabase.from("empenhos_seo").delete().not("id", "is", null);
      if (error) throw error; await loadEmpenhos();
    } catch (e: any) { setErrEmp(e?.message ?? "Erro ao remover."); }
    finally { setClearingEmp(false); }
  }

  // ── Derived: filter options ───────────────────────────────────────────────
  const naturezas = useMemo(() => [...new Set(indicadores.map((r) => r.natureza).filter(Boolean) as string[])].sort(), [indicadores]);
  const pis       = useMemo(() => [...new Set(indicadores.map((r) => r.plano_interno).filter(Boolean) as string[])].sort(), [indicadores]);
  const ugCreds   = useMemo(() => [...new Set(indicadores.map((r) => r.ug_cred).filter(Boolean) as string[])].sort(), [indicadores]);

  // ── Derived: chaves duplicadas (mesma UG + NATUREZA + PTRES + PI + AÇÃO) ──
  const duplicateKeys = useMemo(() => {
    const counts = new Map<string, number>();
    indicadores.forEach((r) => {
      const k = `${r.uge}|${r.natureza}|${r.ptres}|${r.plano_interno}|${r.acao}`;
      counts.set(k, (counts.get(k) ?? 0) + 1);
    });
    return new Set([...counts.entries()].filter(([, c]) => c > 1).map(([k]) => k));
  }, [indicadores]);

  // ── Derived: filtered indicadores ────────────────────────────────────────
  const filteredInd = useMemo(() => {
    const q = filtroTexto.trim().toLowerCase();
    return indicadores.filter((r) => {
      if (filtroSaldo       && (r.saldo ?? 0) <= 0)                            return false;
      if (filtroNatureza !== "todos" && r.natureza      !== filtroNatureza)     return false;
      if (filtroPI       !== "todos" && r.plano_interno !== filtroPI)           return false;
      if (filtroUgCred   !== "todos" && r.ug_cred       !== filtroUgCred)       return false;
      if (filtroDuplicados) {
        const k = `${r.uge}|${r.natureza}|${r.ptres}|${r.plano_interno}|${r.acao}`;
        if (!duplicateKeys.has(k)) return false;
      }
      if (q) {
        const hay = [r.conta_corrente, r.descricao, r.nota_credito, r.ug_cred,
                     r.plano_interno, r.plano_interno ? piDesc.get(r.plano_interno) : null]
          .map((f) => (f ?? "").toLowerCase());
        if (!hay.some((f) => f.includes(q))) return false;
      }
      return true;
    });
  }, [indicadores, filtroSaldo, filtroDuplicados, duplicateKeys, filtroNatureza, filtroPI, filtroUgCred, filtroTexto, piDesc]);

  // ── Derived: aggregated indicadores ──────────────────────────────────────
  type AgInd = {
    conta_corrente: string; descricao: string | null; ug_cred: string | null;
    natureza: string | null; ptres: string | null; plano_interno: string | null;
    acao: string | null; dotacao: number; utilizacao: number; saldo: number;
    notasCount: number; rows: IndicadorLotacao[];
  };

  const agregados = useMemo(() => {
    const byCC: Record<string, AgInd> = {};
    for (const r of filteredInd) {
      const cc = r.conta_corrente;
      if (!byCC[cc]) byCC[cc] = {
        conta_corrente: cc, descricao: r.descricao, ug_cred: r.ug_cred,
        natureza: r.natureza, ptres: r.ptres, plano_interno: r.plano_interno,
        acao: r.acao, dotacao: 0, utilizacao: 0, saldo: 0, notasCount: 0, rows: [],
      };
      byCC[cc].dotacao    += r.dotacao    ?? 0;
      byCC[cc].utilizacao += r.utilizacao ?? 0;
      byCC[cc].saldo      += r.saldo      ?? 0;
      byCC[cc].notasCount++;
      byCC[cc].rows.push(r);
    }
    return Object.values(byCC).sort((a, b) => b.saldo - a.saldo);
  }, [filteredInd]);

  // ── Derived: ALL indicadores aggregated (unfiltered, for suggestions) ─────
  const allAgregados = useMemo(() => {
    const byCC: Record<string, AgInd> = {};
    for (const r of indicadores) {
      const cc = r.conta_corrente;
      if (!byCC[cc]) byCC[cc] = {
        conta_corrente: cc, descricao: r.descricao, ug_cred: r.ug_cred,
        natureza: r.natureza, ptres: r.ptres, plano_interno: r.plano_interno,
        acao: r.acao, dotacao: 0, utilizacao: 0, saldo: 0, notasCount: 0, rows: [],
      };
      byCC[cc].dotacao    += r.dotacao    ?? 0;
      byCC[cc].utilizacao += r.utilizacao ?? 0;
      byCC[cc].saldo      += r.saldo      ?? 0;
      byCC[cc].notasCount++;
      byCC[cc].rows.push(r);
    }
    return byCC;
  }, [indicadores]);

  // ── Derived: agDisplay — sorted+grouped for duplicate view ─────────────────
  const agDisplay = useMemo(() => {
    const toItem = (ag: AgInd) => ({ ag, gk: "", gi: 0, isFirst: false });
    if (!filtroDuplicados) return agregados.map(toItem);

    const getGk = (ag: AgInd) => {
      const r = ag.rows[0];
      return r ? `${r.uge}|${r.natureza}|${r.ptres}|${r.plano_interno}|${r.acao}` : "";
    };
    const sorted = [...agregados].sort((a, b) =>
      getGk(a).localeCompare(getGk(b)) || b.saldo - a.saldo
    );
    let gi = -1, lastGk = "";
    return sorted.map((ag) => {
      const gk = getGk(ag);
      const isFirst = gk !== lastGk;
      if (isFirst) { gi++; lastGk = gk; }
      return { ag, gk, gi, isFirst };
    });
  }, [agregados, filtroDuplicados]);

  // ── Derived: Gerenciamento — contratos × empenhos × indicadores ──────────
  const gerenciamento = useMemo(() => {
    type GerItem = {
      contrato: ContratoMin;
      empenhos: EmpenhoSeo[];
      totalEmpenho: number;
      // indicadores vinculados via empenho.indicador_lotacao (direto)
      indicadoresDiretos: AgInd[];
      // indicadores sugeridos (sem empenho registrado, match por acao/uge)
      indicadoresSugeridos: AgInd[];
    };

    const qC = filtroContrato.trim().toLowerCase();

    const items: GerItem[] = contratos
      .filter((c) => {
        if (!qC) return true;
        return (c.numero_contrato + (c.fornecedor ?? "") + (c.descricao ?? ""))
          .toLowerCase().includes(qC);
      })
      .map((c) => {
        const contLow = c.numero_contrato.toLowerCase();
        const emps = empenhos.filter((e) => {
          const el = (e.contrato ?? "").toLowerCase();
          const sl = (e.licitacao_siasg ?? "").toLowerCase();
          return (el && (el.includes(contLow) || contLow.includes(el))) ||
                 (sl && (sl.includes(contLow) || contLow.includes(sl)));
        });

        // Indicadores diretos: via empenho.indicador_lotacao
        const ccDiretos = [...new Set(emps.map((e) => e.indicador_lotacao).filter(Boolean) as string[])];
        const indicadoresDiretos = ccDiretos
          .map((cc) => allAgregados[cc])
          .filter((ag): ag is AgInd => !!ag);

        // Indicadores sugeridos (apenas se sem empenhos): match por acao + uge
        const indicadoresSugeridos: AgInd[] = emps.length === 0
          ? Object.values(allAgregados).filter((ag) => {
              const matchAcao = c.acao && ag.acao && normH(c.acao) === normH(ag.acao);
              const matchUge  = c.uge  && ag.ug_cred === c.uge;
              return matchAcao || matchUge;
            })
          : [];

        return {
          contrato: c, empenhos: emps,
          totalEmpenho: emps.reduce((s, e) => s + (e.valor ?? 0), 0),
          indicadoresDiretos,
          indicadoresSugeridos,
        };
      })
      .sort((a, b) => b.totalEmpenho - a.totalEmpenho);

    // Empenhos sem contrato encontrado
    const allMatchedEmpIds = new Set(items.flatMap((it) => it.empenhos.map((e) => e.id)));
    const orphanEmps = empenhos.filter((e) => !allMatchedEmpIds.has(e.id));

    return { items, orphanEmps };
  }, [contratos, empenhos, allAgregados, filtroContrato]);

  // ─────────────────────────────────────────────────────────────────────────
  // RENDER
  // ─────────────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-4">

      {/* Sub-tab nav */}
      <Card>
        <div className="flex flex-wrap gap-2 items-center justify-between">
          <div className="flex gap-1 flex-wrap">
            {/* SUB-TABS EMPENHOS e GERENCIAMENTO OCULTOS — reativar se necessário */}
            {(["indicadores"] as const).map((t) => {
              const labels: Record<typeof t, string> = {
                indicadores: "Indicadores de Lotação",
              };
              return (
                <button key={t} onClick={() => setSubTab(t)}
                  className={`px-4 py-2 text-sm font-medium rounded-xl transition-colors ${
                    subTab === t
                      ? "bg-emerald-600 text-white"
                      : "border border-slate-200 text-slate-600 hover:bg-slate-50"
                  }`}>
                  {labels[t]}
                </button>
              );
            })}
          </div>
          <div className="text-xs text-slate-400">
            {indicadores.length} indicadores • {empenhos.length} empenhos
          </div>
        </div>
      </Card>

      {/* ════════════════════════════════════════════════════════════════════
          TAB: INDICADORES DE LOTAÇÃO — import + tabela
      ════════════════════════════════════════════════════════════════════ */}
      {subTab === "indicadores" && (
        <>
          {/* Import card */}
          <Card>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="text-sm font-semibold text-slate-900">Planilha de Indicadores de Lotação</div>
                <div className="text-xs text-slate-500 mt-0.5">
                  Formato: Consulta de Conta Corrente — duplicatas ignoradas automaticamente
                </div>
              </div>
              <div className="flex flex-wrap gap-2 items-center">
                <button onClick={() => setShowHelp((v) => !v)}
                  className={`rounded-xl border px-3 py-2 text-sm font-medium transition-colors ${
                    showHelp ? "border-emerald-300 bg-emerald-50 text-emerald-700" : "border-slate-200 text-slate-500 hover:bg-slate-50"
                  }`}>
                  ? Como encontrar
                </button>
                {canImport && (
                  <>
                    <button onClick={() => { setPreviewInd(null); fileIndRef.current?.click(); }}
                      className="rounded-xl bg-emerald-600 px-3 py-2 text-sm text-white hover:bg-emerald-700">
                      Importar Excel
                    </button>
                    <input ref={fileIndRef} type="file" accept=".xls,.xlsx,.ods,.csv"
                      className="hidden" onChange={handleFileIndChange} />
                    <button onClick={() => loadIndicadores()} disabled={loadingInd}
                      className="rounded-xl border px-3 py-2 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-60">
                      Atualizar
                    </button>
                    <button onClick={clearIndicadores}
                      disabled={clearingInd || loadingInd || indicadores.length === 0}
                      className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700 hover:bg-rose-100 disabled:opacity-60">
                      {clearingInd ? "Removendo..." : "Limpar Tudo"}
                    </button>
                  </>
                )}
              </div>
            </div>

            {/* SILOMS help */}
            {showHelp && (
              <div className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 p-4">
                <div className="text-sm font-semibold text-emerald-800 mb-2">Como exportar a planilha do SILOMS</div>
                <ol className="space-y-1.5 text-sm text-emerald-900">
                  {[
                    "Acesse o SILOMS",
                    "Menu: Indicador de Lotação",
                    "Submenu: Gerenciamento de Indicador de Lotação",
                    "Clique em Pesquisar",
                    "Clique no botão verde Importar em Excel",
                  ].map((step, i) => (
                    <li key={i} className="flex gap-2">
                      <span className="shrink-0 w-5 h-5 rounded-full bg-emerald-600 text-white text-xs flex items-center justify-center font-bold">
                        {i + 1}
                      </span>
                      <span dangerouslySetInnerHTML={{ __html: step.replace(/(\w.*)/g, (m) => `<strong>${m}</strong>`) }} />
                    </li>
                  ))}
                </ol>
              </div>
            )}
            {errInd && <div className="mt-3 rounded-xl border border-red-200 bg-red-50 p-2 text-sm text-red-700">{errInd}</div>}
          </Card>

          {/* Preview */}
          {previewInd && (
            <Card>
              <div className="text-sm font-semibold text-slate-900 mb-2">Prévia da importação</div>
              <div className="text-sm text-slate-700 flex flex-wrap gap-x-3 gap-y-1">
                {previewInd.novos > 0 && (
                  <span className="font-medium text-green-700">+{previewInd.novos} novo{previewInd.novos !== 1 ? "s" : ""}</span>
                )}
                {previewInd.aAtualizar > 0 && (
                  <span className="font-medium text-sky-700">↺ {previewInd.aAtualizar} a atualizar</span>
                )}
                {previewInd.novos === 0 && previewInd.aAtualizar === 0 && (
                  <span className="text-slate-400">Nenhuma alteração detectada.</span>
                )}
              </div>
              <div className="mt-2 max-h-44 overflow-y-auto border rounded-xl divide-y">
                {previewInd.rows.slice(0, 25).map((r, i) => {
                  const existingKey = `${r.conta_corrente}||${r.nota_credito ?? ""}`;
                  const isUpdate = indicadores.some((x) => `${x.conta_corrente}||${x.nota_credito ?? ""}` === existingKey);
                  return (
                    <div key={i} className="px-3 py-1.5 text-xs text-slate-700 flex gap-3 items-center">
                      <span className={`font-medium w-20 shrink-0 ${isUpdate ? "text-sky-700" : "text-emerald-700"}`}>
                        {r.conta_corrente}
                      </span>
                      <span className="text-slate-400 truncate flex-1">{r.nota_credito ?? "–"}</span>
                      <span className="text-slate-500 shrink-0">{r.natureza ?? "–"}</span>
                      <span className="font-medium shrink-0">{r.saldo != null ? fmtMoney(r.saldo) : "–"}</span>
                      {isUpdate && <span className="shrink-0 text-[10px] bg-sky-100 text-sky-700 border border-sky-200 rounded px-1">atualizar</span>}
                    </div>
                  );
                })}
                {previewInd.rows.length > 25 && <div className="px-3 py-1 text-xs text-slate-400">+ {previewInd.rows.length - 25} mais…</div>}
              </div>
              <div className="mt-3 flex gap-2">
                <button onClick={handleImportInd} disabled={importingInd || (previewInd.novos === 0 && previewInd.aAtualizar === 0)}
                  className="rounded-xl bg-emerald-600 px-4 py-2 text-sm text-white hover:bg-emerald-700 disabled:opacity-60">
                  {importingInd ? "Importando..." : [
                    previewInd.novos > 0 ? `+${previewInd.novos} novo${previewInd.novos !== 1 ? "s" : ""}` : "",
                    previewInd.aAtualizar > 0 ? `↺ ${previewInd.aAtualizar} atualizaç${previewInd.aAtualizar !== 1 ? "ões" : "ão"}` : "",
                  ].filter(Boolean).join(" · ")}
                </button>
                <button onClick={() => setPreviewInd(null)} className="rounded-xl border px-4 py-2 text-sm text-slate-600 hover:bg-slate-50">
                  Cancelar
                </button>
              </div>
            </Card>
          )}

          {/* Filters */}
          <Card>
            <div className="flex flex-wrap items-center gap-3">
              <label className="flex items-center gap-2 text-sm text-slate-700 cursor-pointer select-none shrink-0">
                <input type="checkbox" checked={filtroSaldo} onChange={(e) => setFiltroSaldo(e.target.checked)} className="rounded" />
                Apenas com saldo
              </label>
              <label className="flex items-center gap-2 text-sm text-slate-700 cursor-pointer select-none shrink-0">
                <input type="checkbox" checked={filtroDuplicados} onChange={(e) => setFiltroDuplicados(e.target.checked)} className="rounded" />
                <span>
                  Apenas duplicados
                  {duplicateKeys.size > 0 && (
                    <span className="ml-1 rounded-full bg-amber-100 border border-amber-300 text-amber-700 text-[10px] px-1.5 py-0.5 font-semibold">
                      {duplicateKeys.size}
                    </span>
                  )}
                </span>
              </label>
              <select value={filtroUgCred} onChange={(e) => setFiltroUgCred(e.target.value)}
                className="rounded-xl border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-emerald-200">
                <option value="todos">Todas as UG CRED</option>
                {ugCreds.map((u) => <option key={u} value={u}>{u}</option>)}
              </select>
              <select value={filtroNatureza} onChange={(e) => setFiltroNatureza(e.target.value)}
                className="rounded-xl border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-emerald-200">
                <option value="todos">Todas as Naturezas</option>
                {naturezas.map((n) => <option key={n} value={n}>{n}</option>)}
              </select>
              <select value={filtroPI} onChange={(e) => setFiltroPI(e.target.value)}
                className="rounded-xl border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-emerald-200 max-w-xs">
                <option value="todos">Todos os PI</option>
                {pis.map((p) => {
                  const desc = piDesc.get(p);
                  return <option key={p} value={p}>{desc ? `${p} – ${desc}` : p}</option>;
                })}
              </select>
              <input value={filtroTexto} onChange={(e) => setFiltroTexto(e.target.value)}
                placeholder="Buscar código, descrição, nota de crédito..."
                className="flex-1 min-w-[200px] rounded-xl border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-emerald-200" />
              <span className="text-xs text-slate-500 shrink-0">
                {agregados.length} indicador{agregados.length !== 1 ? "es" : ""}
              </span>
            </div>
          </Card>

          {/* Indicadores table */}
          <Card>
            {loadingInd ? (
              <p className="text-sm text-slate-500">Carregando...</p>
            ) : agregados.length === 0 ? (
              <p className="text-sm text-slate-500">
                {indicadores.length === 0
                  ? canImport ? "Nenhum indicador importado. Clique em 'Importar Excel'." : "Nenhum indicador cadastrado."
                  : "Nenhum resultado para os filtros aplicados."}
              </p>
            ) : (
              <div className="overflow-x-auto rounded-xl border">
                <table className="w-full text-xs min-w-[620px]">
                  <thead className="bg-slate-50 border-b">
                    <tr>
                      <th className="text-left px-3 py-2 font-semibold text-slate-600 whitespace-nowrap">Indicador</th>
                      <th className="text-left px-3 py-2 font-semibold text-slate-600 whitespace-nowrap">Descrição</th>
                      <th className="text-left px-3 py-2 font-semibold text-slate-600 whitespace-nowrap">UG CRED</th>
                      <th className="text-left px-3 py-2 font-semibold text-slate-600 whitespace-nowrap">Natureza</th>
                      <th className="text-left px-3 py-2 font-semibold text-slate-600 whitespace-nowrap hidden sm:table-cell">PTRES</th>
                      <th className="text-left px-3 py-2 font-semibold text-slate-600 whitespace-nowrap hidden sm:table-cell">PI</th>
                      <th className="text-left px-3 py-2 font-semibold text-slate-600 whitespace-nowrap">Ação</th>
                      <th className="text-right px-3 py-2 font-semibold text-slate-600 whitespace-nowrap">Dotação</th>
                      <th className="text-right px-3 py-2 font-semibold text-slate-600 whitespace-nowrap hidden sm:table-cell">Utilizado</th>
                      <th className="text-right px-3 py-2 font-semibold text-slate-600 whitespace-nowrap">Saldo</th>
                      <th className="text-center px-3 py-2 font-semibold text-slate-600 whitespace-nowrap hidden sm:table-cell">NC</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {agDisplay.map(({ ag, gk, gi, isFirst }) => {
                      const groupBg = gi % 2 === 0 ? "bg-amber-50/60" : "bg-sky-50/50";
                      const [gkUge, gkNat, gkPtres, gkPi, gkAcao] = gk.split("|");
                      return (
                      <Fragment key={ag.conta_corrente}>
                        {isFirst && (
                          <tr>
                            <td colSpan={11} className={`px-3 py-1.5 text-xs ${groupBg} border-b border-slate-200`}>
                              <span className="text-slate-400 mr-2 font-normal">Grupo {gi + 1}</span>
                              <span className="font-semibold text-slate-700">
                                {[gkUge && `UGE ${gkUge}`, gkNat, gkPtres && `PTRES ${gkPtres}`, gkPi && `PI ${gkPi}`, gkAcao && `Ação ${gkAcao}`]
                                  .filter(Boolean).join(" · ")}
                              </span>
                            </td>
                          </tr>
                        )}
                        <tr className={`cursor-pointer ${filtroDuplicados ? groupBg : "hover:bg-emerald-50/40"}`}
                          onClick={() => setIndRowExp(indRowExp === ag.conta_corrente ? null : ag.conta_corrente)}>
                          <td className="px-3 py-2 font-semibold text-emerald-700 whitespace-nowrap">
                            <span className="mr-1 text-slate-400">{indRowExp === ag.conta_corrente ? "▼" : "▶"}</span>
                            {ag.conta_corrente}
                          </td>
                          <td className="px-3 py-2 text-slate-700 max-w-[160px] truncate" title={ag.descricao ?? undefined}>{ag.descricao ?? "–"}</td>
                          <td className="px-3 py-2 text-slate-500 whitespace-nowrap">{ag.ug_cred ?? "–"}</td>
                          <td className="px-3 py-2 text-slate-500 whitespace-nowrap">{ag.natureza ?? "–"}</td>
                          <td className="px-3 py-2 text-slate-500 whitespace-nowrap hidden sm:table-cell">{ag.ptres ?? "–"}</td>
                          <td className="px-3 py-2 hidden sm:table-cell max-w-[200px]">
                            <div className="font-mono text-xs text-slate-600">{ag.plano_interno ?? "–"}</div>
                            {ag.plano_interno && piDesc.get(ag.plano_interno) && (
                              <div className="text-[10px] text-slate-400 truncate" title={piDesc.get(ag.plano_interno)}>
                                {piDesc.get(ag.plano_interno)}
                              </div>
                            )}
                          </td>
                          <td className="px-3 py-2 text-slate-500 whitespace-nowrap">{ag.acao ?? "–"}</td>
                          <td className="px-3 py-2 font-medium text-slate-700 whitespace-nowrap text-right">{fmtMoney(ag.dotacao)}</td>
                          <td className="px-3 py-2 text-slate-500 whitespace-nowrap text-right hidden sm:table-cell">{fmtMoney(ag.utilizacao)}</td>
                          <td className={`px-3 py-2 font-semibold whitespace-nowrap text-right ${ag.saldo > 0 ? "text-green-700" : "text-red-600"}`}>
                            {fmtMoney(ag.saldo)}
                          </td>
                          <td className="px-3 py-2 text-center hidden sm:table-cell">
                            <span className="rounded-full bg-slate-100 px-2 py-0.5">{ag.notasCount}</span>
                          </td>
                        </tr>
                        {indRowExp === ag.conta_corrente && (
                          <tr className={`border-l-2 border-emerald-300 ${filtroDuplicados ? groupBg : "bg-emerald-50/40"}`}>
                            <td colSpan={11} className="px-4 py-3">
                              {/* Descrição completa — visível no mobile */}
                              {ag.descricao && (
                                <div className="mb-3 text-sm text-slate-800 whitespace-normal break-words leading-relaxed">
                                  <span className="text-xs font-semibold text-slate-500 mr-2">Descrição:</span>
                                  {ag.descricao}
                                </div>
                              )}
                              {/* Campos ocultos no mobile em formato compacto */}
                              <div className="flex flex-wrap gap-x-6 gap-y-1 text-xs text-slate-500 mb-3 sm:hidden">
                                <span><span className="font-medium text-slate-600">PTRES:</span> {ag.ptres ?? "–"}</span>
                                <span>
                                  <span className="font-medium text-slate-600">PI:</span>{" "}
                                  {ag.plano_interno ?? "–"}
                                  {ag.plano_interno && piDesc.get(ag.plano_interno) && (
                                    <span className="ml-1 text-slate-400">— {piDesc.get(ag.plano_interno)}</span>
                                  )}
                                </span>
                                <span><span className="font-medium text-slate-600">Utilizado:</span> {fmtMoney(ag.utilizacao)}</span>
                                <span><span className="font-medium text-slate-600">NC:</span> {ag.notasCount}</span>
                              </div>
                              {/* Sub-linhas por nota de crédito */}
                              {ag.rows.length >= 1 && (
                                <div className="space-y-1">
                                  <div className="text-xs font-semibold text-slate-500 mb-1">
                                    Nota{ag.rows.length !== 1 ? "s" : ""} de Crédito ({ag.rows.length})
                                  </div>
                                  {ag.rows.map((r) => (
                                    <div key={r.id} className="flex flex-wrap items-center gap-x-4 gap-y-0.5 text-xs bg-white/70 rounded-lg px-3 py-1.5 border border-emerald-100">
                                      <span className="font-mono font-semibold text-emerald-700">{r.nota_credito ?? "–"}</span>
                                      <span className="text-slate-400">{r.ug_cred ?? "–"}</span>
                                      <span className="text-slate-400">{r.natureza ?? "–"}</span>
                                      <span className="hidden sm:inline text-slate-400">PTRES: {r.ptres ?? "–"}</span>
                                      <span className="hidden sm:inline text-slate-400">
                                        PI: {r.plano_interno ?? "–"}
                                        {r.plano_interno && piDesc.get(r.plano_interno) && (
                                          <span className="ml-1 text-slate-300">({piDesc.get(r.plano_interno)})</span>
                                        )}
                                      </span>
                                      <span className="text-slate-400">{r.acao ?? "–"}</span>
                                      <span className="ml-auto font-medium text-slate-700">{fmtMoney(r.dotacao)}</span>
                                      <span className={`font-semibold ${(r.saldo ?? 0) > 0 ? "text-green-600" : "text-red-500"}`}>{fmtMoney(r.saldo)}</span>
                                    </div>
                                  ))}
                                </div>
                              )}
                            </td>
                          </tr>
                        )}
                      </Fragment>
                      );
                    })}
                  </tbody>
                  <tfoot className="bg-slate-50 border-t font-semibold">
                    <tr>
                      <td colSpan={5} className="px-3 py-2 text-xs text-slate-700">
                        Total — {agregados.length} indicador{agregados.length !== 1 ? "es" : ""}
                      </td>
                      <td className="px-3 py-2 text-right text-slate-800 whitespace-nowrap hidden sm:table-cell" colSpan={2}></td>
                      <td className="px-3 py-2 text-right text-slate-800 whitespace-nowrap">{fmtMoney(agregados.reduce((s, a) => s + a.dotacao, 0))}</td>
                      <td className="px-3 py-2 text-right text-slate-600 whitespace-nowrap hidden sm:table-cell">{fmtMoney(agregados.reduce((s, a) => s + a.utilizacao, 0))}</td>
                      <td className="px-3 py-2 text-right text-green-700 whitespace-nowrap">{fmtMoney(agregados.reduce((s, a) => s + a.saldo, 0))}</td>
                      <td className="hidden sm:table-cell" />
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
          </Card>
        </>
      )}

      {/* ════════════════════════════════════════════════════════════════════
          TAB: EMPENHOS
      ════════════════════════════════════════════════════════════════════ */}
      {subTab === "empenhos" && (
        <>
          {canImport && (
            <Card>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="text-sm font-semibold text-slate-900">Importar Planilha — Empenhos</div>
                  <div className="text-xs text-slate-500 mt-0.5">
                    Colunas: EMPENHO · VALOR · LIQUIDADO · SALDO · INDICADOR DE LOTAÇÃO · LICITAÇÃO SIASG ou CONTRATO
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button onClick={() => { setPreviewEmp(null); fileEmpRef.current?.click(); }}
                    className="rounded-xl bg-emerald-600 px-3 py-2 text-sm text-white hover:bg-emerald-700">
                    Importar Excel
                  </button>
                  <input ref={fileEmpRef} type="file" accept=".xls,.xlsx,.ods,.csv"
                    className="hidden" onChange={handleFileEmpChange} />
                  <button onClick={() => loadEmpenhos()} disabled={loadingEmp}
                    className="rounded-xl border px-3 py-2 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-60">
                    Atualizar
                  </button>
                  <button onClick={clearEmpenhos}
                    disabled={clearingEmp || loadingEmp || empenhos.length === 0}
                    className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700 hover:bg-rose-100 disabled:opacity-60">
                    {clearingEmp ? "Removendo..." : "Limpar Tudo"}
                  </button>
                </div>
              </div>
              {errEmp && <div className="mt-2 rounded-xl border border-red-200 bg-red-50 p-2 text-sm text-red-700">{errEmp}</div>}
            </Card>
          )}

          {previewEmp && (
            <Card>
              <div className="text-sm font-semibold text-slate-900 mb-2">Prévia da importação</div>
              <div className="text-sm text-slate-700">
                <span className="font-medium text-green-700">{previewEmp.novos} novo{previewEmp.novos !== 1 ? "s" : ""}</span> empenho{previewEmp.novos !== 1 ? "s" : ""}.
                {previewEmp.existentes > 0 && <span className="text-slate-400 ml-1">({previewEmp.existentes} já existem.)</span>}
              </div>
              {previewEmp.novos > 0 && (
                <div className="mt-2 max-h-44 overflow-y-auto border rounded-xl divide-y">
                  {previewEmp.rows.slice(0, 25).map((r, i) => (
                    <div key={i} className="px-3 py-1.5 text-xs text-slate-700 flex gap-3 items-center">
                      <span className="font-medium w-28 shrink-0 text-emerald-700">{r.empenho}</span>
                      <span className="text-slate-500 shrink-0 w-16 text-right">{r.valor != null ? fmtMoney(r.valor) : "–"}</span>
                      <span className="text-blue-600 font-medium shrink-0 w-16">{r.indicador_lotacao ?? "–"}</span>
                      <span className="text-slate-400 truncate flex-1">{r.contrato ?? r.licitacao_siasg ?? "–"}</span>
                    </div>
                  ))}
                  {previewEmp.rows.length > 25 && <div className="px-3 py-1 text-xs text-slate-400">+ {previewEmp.rows.length - 25} mais…</div>}
                </div>
              )}
              <div className="mt-3 flex gap-2">
                <button onClick={handleImportEmp} disabled={importingEmp || previewEmp.novos === 0}
                  className="rounded-xl bg-emerald-600 px-4 py-2 text-sm text-white hover:bg-emerald-700 disabled:opacity-60">
                  {importingEmp ? "Importando..." : `Importar ${previewEmp.novos} empenho${previewEmp.novos !== 1 ? "s" : ""}`}
                </button>
                <button onClick={() => setPreviewEmp(null)} className="rounded-xl border px-4 py-2 text-sm text-slate-600 hover:bg-slate-50">
                  Cancelar
                </button>
              </div>
            </Card>
          )}

          <Card>
            {loadingEmp ? (
              <p className="text-sm text-slate-500">Carregando...</p>
            ) : empenhos.length === 0 ? (
              <p className="text-sm text-slate-500">
                {canImport ? "Nenhum empenho importado." : "Nenhum empenho cadastrado."}
              </p>
            ) : (
              <>
                <div className="flex items-center justify-between mb-3">
                  <div className="text-sm font-semibold text-slate-900">{empenhos.length} empenho{empenhos.length !== 1 ? "s" : ""}</div>
                  <div className="text-sm font-medium text-slate-600">
                    Total: {fmtMoney(empenhos.reduce((s, e) => s + (e.valor ?? 0), 0))} •
                    Liquidado: {fmtMoney(empenhos.reduce((s, e) => s + (e.liquidado ?? 0), 0))}
                  </div>
                </div>
                <div className="overflow-x-auto rounded-xl border max-h-[600px] overflow-y-auto">
                  <table className="w-full text-xs min-w-[700px]">
                    <thead className="bg-slate-50 border-b sticky top-0">
                      <tr>
                        {["Empenho", "Indicador de Lotação", "Valor", "Liquidado", "Saldo", "Contrato / SIASG"].map((h) => (
                          <th key={h} className="text-left px-3 py-2 font-semibold text-slate-600 whitespace-nowrap">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {empenhos.map((e) => (
                        <tr key={e.id} className="hover:bg-slate-50">
                          <td className="px-3 py-2 font-medium text-emerald-700 whitespace-nowrap">{e.empenho}</td>
                          <td className="px-3 py-2 font-semibold text-blue-700 whitespace-nowrap">{e.indicador_lotacao ?? "–"}</td>
                          <td className="px-3 py-2 font-semibold text-slate-800 whitespace-nowrap text-right">{fmtMoney(e.valor)}</td>
                          <td className="px-3 py-2 text-slate-600 whitespace-nowrap text-right">{fmtMoney(e.liquidado)}</td>
                          <td className={`px-3 py-2 font-medium whitespace-nowrap text-right ${(e.saldo_emp ?? 0) > 0 ? "text-green-700" : "text-slate-500"}`}>
                            {fmtMoney(e.saldo_emp)}
                          </td>
                          <td className="px-3 py-2 text-slate-500 max-w-[200px] truncate">
                            {e.contrato ?? e.licitacao_siasg ?? "–"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </Card>
        </>
      )}

      {/* ════════════════════════════════════════════════════════════════════
          TAB: GERENCIAMENTO DOS CONTRATOS
      ════════════════════════════════════════════════════════════════════ */}
      {subTab === "gerenciamento" && (
        <>
          {/* Filters */}
          <Card>
            <div className="flex flex-wrap items-center gap-3">
              <input value={filtroContrato} onChange={(e) => setFiltroContrato(e.target.value)}
                placeholder="Buscar contrato ou fornecedor..."
                className="flex-1 min-w-[200px] rounded-xl border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-emerald-200" />
              <button onClick={() => setFiltroContrato("")}
                className="rounded-xl border px-3 py-2 text-sm text-slate-500 hover:bg-slate-50">
                Limpar
              </button>
            </div>
            <div className="mt-2 text-xs text-slate-400">
              {gerenciamento.items.length} contrato{gerenciamento.items.length !== 1 ? "s" : ""} •{" "}
              {gerenciamento.items.filter((i) => i.empenhos.length > 0).length} com empenhos
            </div>
          </Card>

          {/* Contracts accordion */}
          <div className="space-y-2">
            {gerenciamento.items.map((item) => {
              const isExp = contRowExp === item.contrato.id;
              const hasEmps = item.empenhos.length > 0;
              const hasDiretos = item.indicadoresDiretos.length > 0;
              const hasSugeridos = item.indicadoresSugeridos.length > 0;

              return (
                <div key={item.contrato.id}
                  className={`rounded-xl border overflow-hidden ${hasEmps ? "border-emerald-200" : "border-slate-200"}`}>
                  {/* Header */}
                  <button
                    className={`w-full flex items-center justify-between gap-3 px-4 py-3 text-left transition-colors ${
                      hasEmps ? "hover:bg-emerald-50" : "hover:bg-slate-50"
                    }`}
                    onClick={() => setContRowExp(isExp ? null : item.contrato.id)}
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <span className="text-slate-400 text-xs shrink-0">{isExp ? "▼" : "▶"}</span>
                      <div className="min-w-0">
                        <div className="text-sm font-semibold text-slate-900 truncate">{item.contrato.numero_contrato}</div>
                        <div className="text-xs text-slate-500 mt-0.5 flex flex-wrap gap-x-3">
                          <span>{item.contrato.fornecedor ?? "–"}</span>
                          {item.contrato.uge   && <span className="text-slate-400">UGE: {item.contrato.uge}</span>}
                          {item.contrato.acao  && <span className="text-slate-400">Ação: {item.contrato.acao}</span>}
                          <span className="text-slate-400">Vence: {fmtDate(item.contrato.data_final)}</span>
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-5 shrink-0 text-right">
                      <div>
                        <div className="text-xs text-slate-400">Saldo Contrato</div>
                        <div className={`text-sm font-semibold ${(item.contrato.saldo ?? 0) > 0 ? "text-green-700" : "text-slate-500"}`}>
                          {fmtMoney(item.contrato.saldo)}
                        </div>
                      </div>
                      <div>
                        <div className="text-xs text-slate-400">Empenhos</div>
                        <div className="text-sm font-semibold text-slate-800">{fmtMoney(item.totalEmpenho)}</div>
                      </div>
                      {(hasDiretos || hasSugeridos) && (
                        <div>
                          <div className={`text-xs ${hasDiretos ? "text-emerald-600" : "text-amber-500"}`}>
                            {hasDiretos ? "Indicadores" : "Sugestões"}
                          </div>
                          <div className={`text-sm font-semibold ${hasDiretos ? "text-emerald-700" : "text-amber-600"}`}>
                            {hasDiretos ? item.indicadoresDiretos.length : item.indicadoresSugeridos.length}
                          </div>
                        </div>
                      )}
                    </div>
                  </button>

                  {/* Expanded */}
                  {isExp && (
                    <div className="border-t divide-y">
                      {/* Contract details */}
                      <div className="px-4 py-3 bg-slate-50 text-xs">
                        <div className="font-semibold text-slate-700 mb-2">Detalhes do Contrato</div>
                        <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-1.5 text-slate-700">
                          <div><span className="font-medium">Nº:</span> {item.contrato.numero_contrato}</div>
                          <div><span className="font-medium">Fornecedor:</span> {item.contrato.fornecedor ?? "–"}</div>
                          <div><span className="font-medium">UGE:</span> {item.contrato.uge ?? "–"}</div>
                          <div><span className="font-medium">Ação:</span> {item.contrato.acao ?? "–"}</div>
                          <div><span className="font-medium">Vencimento:</span> {fmtDate(item.contrato.data_final)}</div>
                          <div><span className="font-medium">Vl. Contratual:</span> {fmtMoney(item.contrato.vl_contratual)}</div>
                          <div><span className="font-medium text-green-700">Saldo:</span> {fmtMoney(item.contrato.saldo)}</div>
                        </div>
                        {item.contrato.descricao && (
                          <div className="mt-2 text-slate-500 italic">{item.contrato.descricao.slice(0, 200)}</div>
                        )}
                      </div>

                      {/* Empenhos */}
                      <div className="px-4 py-3">
                        <div className="text-xs font-semibold text-slate-700 mb-2">
                          Notas de Empenho ({item.empenhos.length})
                          {item.empenhos.length > 0 && (
                            <span className="ml-2 font-normal text-slate-500">
                              Total: {fmtMoney(item.totalEmpenho)} •
                              Liquidado: {fmtMoney(item.empenhos.reduce((s, e) => s + (e.liquidado ?? 0), 0))}
                            </span>
                          )}
                        </div>
                        {item.empenhos.length === 0 ? (
                          <p className="text-xs text-slate-400">Nenhum empenho registrado neste exercício para este contrato.</p>
                        ) : (
                          <div className="divide-y border rounded-xl overflow-hidden">
                            <div className="grid grid-cols-5 px-3 py-1.5 bg-slate-50 text-xs font-semibold text-slate-600">
                              <span>Empenho</span><span>Indicador</span>
                              <span className="text-right">Valor</span><span className="text-right">Liquidado</span><span className="text-right">Saldo</span>
                            </div>
                            {item.empenhos.map((e) => (
                              <div key={e.id} className="grid grid-cols-5 px-3 py-2 bg-white text-xs items-center">
                                <span className="font-medium text-emerald-700">{e.empenho}</span>
                                <span className="font-semibold text-blue-700">{e.indicador_lotacao ?? "–"}</span>
                                <span className="font-semibold text-slate-800 text-right">{fmtMoney(e.valor)}</span>
                                <span className="text-slate-600 text-right">{fmtMoney(e.liquidado)}</span>
                                <span className={`font-medium text-right ${(e.saldo_emp ?? 0) > 0 ? "text-green-700" : "text-slate-400"}`}>
                                  {fmtMoney(e.saldo_emp)}
                                </span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>

                      {/* Indicadores diretos (via empenho.indicador_lotacao) */}
                      {hasDiretos && (
                        <div className="px-4 py-3 bg-emerald-50/40">
                          <div className="text-xs font-semibold text-emerald-800 mb-2">
                            Indicadores de Lotação vinculados
                            <span className="ml-1 font-normal text-emerald-600">(identificados pelos empenhos)</span>
                          </div>
                          <IndTable
                            rows={item.indicadoresDiretos}
                            expandedKey={indInCtExp}
                            prefix={item.contrato.id}
                            onToggle={setIndInCtExp}
                          />
                        </div>
                      )}

                      {/* Sugestões (sem empenho) */}
                      {hasSugeridos && !hasDiretos && (
                        <div className="px-4 py-3 bg-amber-50/40">
                          <div className="text-xs font-semibold text-amber-800 mb-1">
                            Indicadores sugeridos
                            <span className="ml-1 font-normal text-amber-600">
                              (nenhum empenho registrado este ano — sugestão por Ação / UGE compatível)
                            </span>
                          </div>
                          <IndTable
                            rows={item.indicadoresSugeridos}
                            expandedKey={indInCtExp}
                            prefix={`sug-${item.contrato.id}`}
                            onToggle={setIndInCtExp}
                            suggested
                          />
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}

            {/* Orphan empenhos */}
            {gerenciamento.orphanEmps.length > 0 && (
              <div className="rounded-xl border border-amber-200 overflow-hidden">
                <button
                  className="w-full flex items-center justify-between gap-3 px-4 py-3 text-left hover:bg-amber-50 transition-colors"
                  onClick={() => setContRowExp(contRowExp === "__orphan__" ? null : "__orphan__")}>
                  <div className="flex items-center gap-3">
                    <span className="text-slate-400 text-xs">{contRowExp === "__orphan__" ? "▼" : "▶"}</span>
                    <div>
                      <div className="text-sm font-semibold text-amber-800">Empenhos sem contrato registrado</div>
                      <div className="text-xs text-amber-600 mt-0.5">
                        {gerenciamento.orphanEmps.length} empenho{gerenciamento.orphanEmps.length !== 1 ? "s" : ""} cujo contrato não foi localizado no módulo SCON
                      </div>
                    </div>
                  </div>
                  <div className="text-sm font-semibold text-slate-700 shrink-0">
                    {fmtMoney(gerenciamento.orphanEmps.reduce((s, e) => s + (e.valor ?? 0), 0))}
                  </div>
                </button>
                {contRowExp === "__orphan__" && (
                  <div className="border-t divide-y">
                    {gerenciamento.orphanEmps.map((e) => (
                      <div key={e.id} className="grid grid-cols-4 px-6 py-2 bg-amber-50/30 text-xs items-center">
                        <span className="font-medium text-emerald-700">{e.empenho}</span>
                        <span className="font-semibold text-blue-700">{e.indicador_lotacao ?? "–"}</span>
                        <span className="font-semibold text-slate-800 text-right">{fmtMoney(e.valor)}</span>
                        <span className="text-amber-700 truncate">{e.contrato ?? e.licitacao_siasg ?? "Sem contrato"}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {gerenciamento.items.length === 0 && gerenciamento.orphanEmps.length === 0 && (
              <Card>
                <p className="text-sm text-slate-500">Nenhum contrato encontrado com os filtros aplicados.</p>
              </Card>
            )}
          </div>
        </>
      )}
    </div>
  );
}

// ─── Sub-component: Indicadores table (reused in gerenciamento) ───────────────
function IndTable({
  rows, expandedKey, prefix, onToggle, suggested = false,
}: {
  rows: { conta_corrente: string; descricao: string | null; natureza: string | null;
          plano_interno: string | null; acao: string | null; dotacao: number;
          utilizacao: number; saldo: number; notasCount: number;
          rows: IndicadorLotacao[]; }[];
  expandedKey: string | null;
  prefix: string;
  onToggle: (key: string | null) => void;
  suggested?: boolean;
}) {
  return (
    <div className="border rounded-xl overflow-hidden">
      <table className="w-full text-xs">
        <thead className={`border-b ${suggested ? "bg-amber-50" : "bg-emerald-50"}`}>
          <tr>
            {["Indicador", "Descrição", "Natureza", "PI", "Ação", "Dotação", "Utilizado", "Saldo", "NC"].map((h) => (
              <th key={h} className={`text-left px-3 py-1.5 font-semibold whitespace-nowrap ${suggested ? "text-amber-800" : "text-emerald-800"}`}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y">
          {rows.map((ag) => {
            const key = `${prefix}:${ag.conta_corrente}`;
            const isExp = expandedKey === key;
            return (
              <Fragment key={ag.conta_corrente}>
                <tr className={`cursor-pointer bg-white ${suggested ? "hover:bg-amber-50/50" : "hover:bg-emerald-50/50"}`}
                  onClick={() => onToggle(isExp ? null : key)}>
                  <td className={`px-3 py-1.5 font-semibold whitespace-nowrap ${suggested ? "text-amber-700" : "text-emerald-700"}`}>
                    <span className="mr-1 text-slate-300 text-xs">{isExp ? "▼" : "▶"}</span>{ag.conta_corrente}
                  </td>
                  <td className="px-3 py-1.5 text-slate-600 max-w-[160px] truncate" title={ag.descricao ?? undefined}>{ag.descricao ?? "–"}</td>
                  <td className="px-3 py-1.5 text-slate-500 whitespace-nowrap">{ag.natureza ?? "–"}</td>
                  <td className="px-3 py-1.5 text-slate-500 whitespace-nowrap">{ag.plano_interno ?? "–"}</td>
                  <td className="px-3 py-1.5 text-slate-500 whitespace-nowrap">{ag.acao ?? "–"}</td>
                  <td className="px-3 py-1.5 text-slate-600 whitespace-nowrap text-right">{new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(ag.dotacao)}</td>
                  <td className="px-3 py-1.5 text-slate-500 whitespace-nowrap text-right">{new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(ag.utilizacao)}</td>
                  <td className={`px-3 py-1.5 font-semibold whitespace-nowrap text-right ${ag.saldo > 0 ? "text-green-700" : "text-red-500"}`}>
                    {new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(ag.saldo)}
                  </td>
                  <td className="px-3 py-1.5 text-center">
                    <span className={`rounded-full px-2 py-0.5 text-xs ${suggested ? "bg-amber-100 text-amber-700" : "bg-emerald-100 text-emerald-700"}`}>
                      {ag.notasCount}
                    </span>
                  </td>
                </tr>
                {isExp && ag.rows.map((r) => (
                  <tr key={r.id} className={`border-l-2 ${suggested ? "bg-amber-50/20 border-amber-200" : "bg-emerald-50/20 border-emerald-200"}`}>
                    <td className="px-3 py-1 pl-6 text-slate-300 whitespace-nowrap">↳</td>
                    <td className="px-3 py-1 text-slate-500 font-medium whitespace-nowrap" colSpan={2}>
                      NC: {r.nota_credito ?? "–"}
                    </td>
                    <td className="px-3 py-1 text-slate-400 whitespace-nowrap">{r.plano_interno ?? "–"}</td>
                    <td className="px-3 py-1 text-slate-400 whitespace-nowrap">{r.acao ?? "–"}</td>
                    <td className="px-3 py-1 text-right text-slate-500 whitespace-nowrap">{new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(r.dotacao ?? 0)}</td>
                    <td className="px-3 py-1 text-right text-slate-400 whitespace-nowrap">{new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(r.utilizacao ?? 0)}</td>
                    <td className={`px-3 py-1 text-right font-medium whitespace-nowrap ${(r.saldo ?? 0) > 0 ? "text-green-600" : "text-red-400"}`}>
                      {new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(r.saldo ?? 0)}
                    </td>
                    <td />
                  </tr>
                ))}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
