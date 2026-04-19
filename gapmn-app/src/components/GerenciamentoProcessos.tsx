import { useState, useEffect, useMemo } from "react";
import { supabase } from "../lib/supabase";
import { Card } from "./Card";

// ─── Constantes ─────────────────────────────────────────────────────────────
const STATUS_LIVRE_OPCOES = [
  "Aguardando DNR",
  "DNR recebida",
  "Aguardando ACI",
  "Abertura de PAG",
  "Lançamento de IRP",
  "Criação de Edital e Anexos",
  "Aguardando OD",
  "Análise CJU",
  "Adequação OMAP",
  "Para Publicação",
] as const;

// ─── Google Sheets ────────────────────────────────────────────────────────────
const DEFAULT_SHEET_ID = "16xUd9NGi1OwJyi7-hSkt5GDTSYBXdL4RfrlZMTyeRNQ";
const LS_SHEET_KEY     = "slic_spreadsheet_id";
const FASE_EXTERNA_GID = "10753468";
const PLANNING_GID     = "1518588116";

function getSheetId(): string {
  try { return localStorage.getItem(LS_SHEET_KEY) ?? DEFAULT_SHEET_ID; }
  catch { return DEFAULT_SHEET_ID; }
}

function makeSheetUrls(sheetId: string) {
  const base = `https://docs.google.com/spreadsheets/d/${sheetId}`;
  return {
    faseExterna: `${base}/export?format=csv&gid=${FASE_EXTERNA_GID}`,
    planning:    `${base}/export?format=csv&gid=${PLANNING_GID}`,
  };
}

// ─── Tipos ───────────────────────────────────────────────────────────────────
type Processo = {
  id: string;
  chave: string;
  fonte: string;
  ano: number;
  modalidade: string | null;
  numero_processo: string | null;
  objeto: string | null;
  data_publicacao: string | null;
  abertura_proposta: string | null;
  encerramento_proposta: string | null;
  valor_estimado: number | null;
  valor_homologado: number | null;
  situacao_api: string | null;
  link_sistema: string | null;
  ultima_sync: string;
  srp: boolean | null;
  homologado_manual: boolean | null;
  valor_homologado_manual: number | null;
  processo_controle: Array<{ status_livre: string | null; pag: string | null; om: string | null }> | null;
};


type FaseExternaRow = {
  nSiasg:       string;
  modalidade:   string;
  pregoeiro:    string;
  apoiada:      string;
  pag:          string;
  abertura:     string;       // "DD/MM/YYYY"
  aberturaDate: Date | null;
  diasCalc:     number;
  situacao:     string;
};

type LinhaElaboracao = {
  nContratacao: string;
  nDfd:         string;
  modalidade:   string;
  objeto:       string;
  apoiada:      string;
  situacao:     string;   // "Situação Detalhada" (texto longo)
  status:       string;   // coluna "Status" da planilha
  responsavel:  string;
};

type ElabOverride = {
  status_override: string | null;
  observacao:      string | null;
  oculto:          boolean;
};

// ─── Helpers ─────────────────────────────────────────────────────────────────
function isHomologado(p: Processo): boolean {
  if (p.homologado_manual === true) return true;
  const sit = (p.situacao_api || "").toLowerCase();
  return (
    p.valor_homologado !== null && p.valor_homologado !== undefined
  ) || sit.includes("homolog") || sit.includes("adjudic");
}

function calcStatus(p: Processo): { label: string; cls: string } {
  const sit = (p.situacao_api || "").toLowerCase();
  if (sit.includes("revogad") || sit.includes("anulad"))
    return { label: p.situacao_api!, cls: "bg-purple-50 border-purple-200 text-purple-800" };
  if (sit.includes("suspens"))
    return { label: p.situacao_api!, cls: "bg-yellow-50 border-yellow-200 text-yellow-800" };
  if (isHomologado(p))
    return { label: "Homologada", cls: "bg-green-50 border-green-200 text-green-800" };
  return { label: "Em Andamento", cls: "bg-sky-50 border-sky-200 text-sky-800" };
}

function fmtMoney(v: number | null | undefined): string {
  if (v === null || v === undefined) return "-";
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(v);
}

function fmtDate(d: string | null | undefined): string {
  if (!d) return "-";
  try {
    return new Date(d + "T12:00:00").toLocaleDateString("pt-BR");
  } catch {
    return d;
  }
}

function fmtDateTime(d: string | null | undefined): string {
  if (!d) return "-";
  try {
    return new Date(d).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
  } catch {
    return d;
  }
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

// ─── Modalidade → Prefixo ────────────────────────────────────────────────────
function modalidadePrefix(mod: string | null): string {
  if (!mod) return "";
  const m = mod.toLowerCase();
  if (m.includes("pregão"))          return "PE";
  if (m.includes("concorrência"))    return "CE";
  if (m.includes("credenciamento"))  return "CR";
  if (m.includes("dispensa"))        return "DE";
  if (m.includes("inexigibilidade")) return "INEX";
  if (m.includes("diálogo"))         return "DC";
  if (m.includes("tomada de preço")) return "TP";
  if (m.includes("convite"))         return "CV";
  if (m.includes("leilão"))          return "LL";
  return "";
}

function fmtNumProc(modalidade: string | null, numero: string | null): string {
  if (!numero) return "-";
  const prefix = modalidadePrefix(modalidade);
  return prefix ? `${prefix} ${numero}` : numero;
}

// ─── Fase Externa helpers ─────────────────────────────────────────────────────
function parseBRDate(s: string): Date | null {
  const m = s.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return null;
  return new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]));
}

function daysSince(d: Date): number {
  return Math.max(0, Math.floor((Date.now() - d.getTime()) / 86_400_000));
}

function normalizeNumSiasg(n: string): string {
  return n.split(/\s+e\s+/i)[0].trim().replace(/\s+/g, "").toLowerCase();
}

function parseCSVSimple(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') {
      if (inQuotes && text[i + 1] === '"') { field += '"'; i++; }
      else inQuotes = !inQuotes;
    } else if (c === ',' && !inQuotes) {
      row.push(field); field = "";
    } else if ((c === '\n' || c === '\r') && !inQuotes) {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); rows.push(row); row = []; field = "";
    } else {
      field += c;
    }
  }
  if (field !== "" || row.length > 0) { row.push(field); rows.push(row); }
  return rows;
}

async function fetchFaseExterna(url: string): Promise<Map<string, FaseExternaRow>> {
  try {
    const resp = await fetch(url, { redirect: "follow" });
    if (!resp.ok) return new Map();
    const text = await resp.text();
    if (text.trimStart().startsWith("<")) return new Map();
    const rows = parseCSVSimple(text);
    const map = new Map<string, FaseExternaRow>();
    for (const row of rows.slice(5)) {
      const nSiasg = row[1]?.trim() ?? "";
      if (!nSiasg || nSiasg === "Nº SIASG") continue;
      const abertura    = row[7]?.trim() ?? "";
      const aberturaDate = parseBRDate(abertura);
      const diasCalc    = aberturaDate ? daysSince(aberturaDate) : 0;
      map.set(normalizeNumSiasg(nSiasg), {
        nSiasg,
        modalidade:  row[2]?.trim() ?? "",
        pregoeiro:   row[3]?.trim() ?? "",
        apoiada:     row[4]?.trim() ?? "",
        pag:         row[6]?.trim() ?? "",
        abertura, aberturaDate, diasCalc,
        situacao:    row[9]?.trim() ?? "",
      });
    }
    return map;
  } catch {
    return new Map();
  }
}

async function fetchElaboracao(url: string): Promise<LinhaElaboracao[]> {
  if (!url) return [];
  try {
    const resp = await fetch(url, { redirect: "follow" });
    if (!resp.ok) return [];
    const text = await resp.text();
    if (text.trimStart().startsWith("<")) return [];
    const rows = parseCSVSimple(text);
    const headerIdx = rows.findIndex((r) =>
      r.some((c) => c.toLowerCase().includes("contrata") || c.toLowerCase().includes("dfd"))
    );
    if (headerIdx < 0) return [];
    const headers = rows[headerIdx].map((h) => h.toLowerCase().trim());
    const findCol = (...keys: string[]) => {
      for (const k of keys) {
        const i = headers.findIndex((h) => h.includes(k));
        if (i >= 0) return i;
      }
      return -1;
    };
    const cC    = findCol("contrata");
    const cD    = findCol("dfd");
    const cM    = findCol("modalidade");
    const cO    = findCol("objeto", "descri");
    const cA    = findCol("apoiada");
    const cS    = findCol("situa");
    const cStat = headers.findIndex((h) => h === "status" || h === "status ");
    const cR    = findCol("respons");
    const linhas: LinhaElaboracao[] = [];
    for (const row of rows.slice(headerIdx + 1)) {
      const contratRaw = cC >= 0 ? (row[cC]?.trim() ?? "") : "";
      const objeto     = cO >= 0 ? (row[cO]?.trim() ?? "") : "";
      if (!contratRaw && !objeto) continue;
      const base = {
        nDfd:        cD    >= 0 ? (row[cD]?.trim()    ?? "") : "",
        modalidade:  cM    >= 0 ? (row[cM]?.trim()    ?? "") : "",
        objeto,
        apoiada:     cA    >= 0 ? (row[cA]?.trim()    ?? "") : "",
        situacao:    cS    >= 0 ? (row[cS]?.trim()    ?? "") : "",
        status:      cStat >= 0 ? (row[cStat]?.trim() ?? "") : "",
        responsavel: cR    >= 0 ? (row[cR]?.trim()    ?? "") : "",
      };
      // Uma célula pode ter múltiplos números separados por " e " (ex: "90064/2025 e 90005/2026")
      const numeros = contratRaw.split(/\s+e\s+/i).map((n) => n.trim()).filter(Boolean);
      if (numeros.length > 1) {
        for (const num of numeros) linhas.push({ nContratacao: num, ...base });
      } else {
        linhas.push({ nContratacao: contratRaw, ...base });
      }
    }
    return linhas;
  } catch {
    return [];
  }
}

// ─── Componente principal ────────────────────────────────────────────────────
interface GerProcessosProps { canImport?: boolean; canEdit?: boolean; canEditElaboracao?: boolean; }
export default function GerenciamentoProcessos({ canImport = true, canEdit = false, canEditElaboracao = false }: GerProcessosProps) {
  // Sub-aba
  const [subTab, setSubTab] = useState<"publicados" | "elaboracao">("publicados");

  // Dados PNCP (Supabase)
  const [processos, setProcessos]   = useState<Processo[]>([]);
  const [loading, setLoading]       = useState(true);
  const [syncing, setSyncing]       = useState(false);
  const [err, setErr]               = useState<string | null>(null);
  const [lastSync, setLastSync]     = useState<string | null>(null);
  const [staleness, setStaleness]   = useState<"fresh" | "stale" | "empty">("empty");

  // Dados Google Sheets
  const [sheetId, setSheetId]           = useState(getSheetId);
  const [sheetInput, setSheetInput]     = useState("");
  const [showSheetCfg, setShowSheetCfg] = useState(false);
  const [faseExternaMap, setFaseExternaMap] = useState<Map<string, FaseExternaRow>>(new Map());
  const [elaboracaoRows, setElaboracaoRows] = useState<LinhaElaboracao[]>([]);
  const [loadingSheet, setLoadingSheet]     = useState(false);

  // Filtros — Publicados
  const [filtroAno, setFiltroAno]           = useState("todos");
  const [filtroStatus, setFiltroStatus]     = useState("todos");
  const [filtroModalidade, setFiltroModalidade] = useState("todas");
  const [filtroSrp, setFiltroSrp]           = useState("todos");
  const [filtroTexto, setFiltroTexto]       = useState("");

  // Filtros — Em Elaboração
  const [elabFiltroTexto,       setElabFiltroTexto]       = useState("");
  const [elabFiltroModalidade,  setElabFiltroModalidade]  = useState("todas");
  const [elabFiltroAno,         setElabFiltroAno]         = useState("todos");
  const [elabFiltroApoiada,     setElabFiltroApoiada]     = useState("todas");
  const [elabFiltroSituacao,    setElabFiltroSituacao]    = useState("todas");
  const [elabFiltroStatus,      setElabFiltroStatus]      = useState("todos");

  // Overrides — Em Elaboração
  const [elabOverrides,    setElabOverrides]    = useState<Map<string, ElabOverride>>(new Map());
  const [elabSelected,     setElabSelected]     = useState<LinhaElaboracao | null>(null);
  const [overrideStatus,   setOverrideStatus]   = useState("");
  const [overrideObs,      setOverrideObs]      = useState("");
  const [savingOverride,   setSavingOverride]   = useState(false);
  const [showOcultos,      setShowOcultos]      = useState(false);

  // Processo selecionado
  const [selected, setSelected] = useState<Processo | null>(null);

  // Override manual de homologação
  const [homManualInput, setHomManualInput] = useState("");
  const [savingHom,      setSavingHom]      = useState(false);
  const [homManualErr,   setHomManualErr]   = useState<string | null>(null);


  // Cadastro manual
  const [showCadastro, setShowCadastro] = useState(false);
  const [cNumero, setCNumero]           = useState("");
  const [cPag, setCPag]                 = useState("");
  const [cObjeto, setCObjeto]           = useState("");
  const [cOm, setCOm]                   = useState("");
  const [cStatus, setCStatus]           = useState("");
  const [cObs, setCObs]                 = useState<string[]>([""]);
  const [savingCadastro, setSavingCadastro] = useState(false);

  // ── Carga inicial ──────────────────────────────────────────────────────────
  useEffect(() => {
    loadProcessos();
    loadSheets();
    loadElabOverrides();
  }, []);

  async function loadSheets(sid = sheetId) {
    setLoadingSheet(true);
    const urls = makeSheetUrls(sid);
    const [feMap, elabRows] = await Promise.all([
      fetchFaseExterna(urls.faseExterna),
      fetchElaboracao(urls.planning),
    ]);
    setFaseExternaMap(feMap);
    setElaboracaoRows(elabRows);
    setLoadingSheet(false);
  }

  async function loadElabOverrides() {
    const { data } = await supabase.from("elaboracao_overrides").select("*");
    if (!data) return;
    const m = new Map<string, ElabOverride>();
    for (const row of data) {
      m.set(row.n_contratacao, {
        status_override: row.status_override ?? null,
        observacao:      row.observacao ?? null,
        oculto:          row.oculto ?? false,
      });
    }
    setElabOverrides(m);
  }

  async function saveElabOverride(nContratacao: string, oculto: boolean) {
    setSavingOverride(true);
    const { data: sess } = await supabase.auth.getSession();
    const uid = sess.session?.user.id ?? null;
    const { error } = await supabase.from("elaboracao_overrides").upsert({
      n_contratacao:   nContratacao,
      status_override: overrideStatus.trim() || null,
      observacao:      overrideObs.trim() || null,
      oculto,
      updated_at:      new Date().toISOString(),
      updated_by:      uid,
    }, { onConflict: "n_contratacao" });
    if (!error) {
      setElabOverrides((prev) => {
        const m = new Map(prev);
        m.set(nContratacao, {
          status_override: overrideStatus.trim() || null,
          observacao:      overrideObs.trim() || null,
          oculto,
        });
        return m;
      });
      setElabSelected(null);
    }
    setSavingOverride(false);
  }

  function handleElabSelect(r: LinhaElaboracao) {
    if (elabSelected?.nContratacao === r.nContratacao) { setElabSelected(null); return; }
    const ov = elabOverrides.get(r.nContratacao);
    setOverrideStatus(ov?.status_override ?? "");
    setOverrideObs(ov?.observacao ?? "");
    setElabSelected(r);
  }

  async function loadProcessos() {
    setLoading(true);
    setErr(null);
    try {
      const { data, error } = await supabase
        .from("processos_licitatorios")
        .select("*, processo_controle(status_livre, pag, om)")
        .order("data_publicacao", { ascending: false });

      if (error) throw error;

      const procs = (data ?? []) as Processo[];
      setProcessos(procs);

      if (procs.length === 0) {
        setStaleness("empty");
      } else {
        const sorted = procs.map((p) => p.ultima_sync).filter(Boolean).sort();
        const maxSync = sorted[sorted.length - 1];
        setLastSync(maxSync ?? null);
        const hoursAgo = maxSync
          ? (Date.now() - new Date(maxSync).getTime()) / 3_600_000
          : Infinity;
        setStaleness(hoursAgo > 24 ? "stale" : "fresh");
      }
    } catch (e: any) {
      setErr(e?.message ?? "Erro ao carregar processos.");
    } finally {
      setLoading(false);
    }
  }

  // ── Sync via Edge Function ─────────────────────────────────────────────────
  async function handleSync() {
    if (syncing) return;
    setSyncing(true);
    setErr(null);
    try {
      const { error } = await supabase.functions.invoke("sync-processos");
      if (error) throw error;
      await loadProcessos();
    } catch (e: any) {
      setErr(
        e?.message?.includes("FunctionsFetchError")
          ? "Edge Function não encontrada. Faça o deploy com: supabase functions deploy sync-processos"
          : e?.message ?? "Erro ao sincronizar."
      );
    } finally {
      setSyncing(false);
    }
  }

  // ── Selecionar processo ────────────────────────────────────────────────────
  function handleSelect(p: Processo) {
    if (selected?.id === p.id) { setSelected(null); return; }
    setSelected(p);
  }

  // ── Override manual de homologação ────────────────────────────────────────
  async function saveHomologadoManual(p: Processo, marcar: boolean) {
    setSavingHom(true);
    setHomManualErr(null);
    const valorNum = homManualInput.trim()
      ? parseFloat(homManualInput.replace(",", ".").replace(/\s/g, ""))
      : null;
    const { error } = await supabase
      .from("processos_licitatorios")
      .update({
        homologado_manual:       marcar,
        valor_homologado_manual: marcar ? (isNaN(valorNum!) ? null : valorNum) : null,
      })
      .eq("id", p.id);
    if (error) { setHomManualErr(error.message); setSavingHom(false); return; }
    // Atualiza estado local
    const updated = { ...p, homologado_manual: marcar, valor_homologado_manual: marcar ? valorNum : null };
    setProcessos(prev => prev.map(x => x.id === p.id ? updated : x));
    setSelected(updated);
    setHomManualInput("");
    setSavingHom(false);
  }

  // ── Excluir processo manual ────────────────────────────────────────────────
  async function deleteProcesso(p: Processo) {
    if (!window.confirm(`Excluir o processo "${fmtNumProc(p.modalidade, p.numero_processo) ?? p.chave}"? Esta ação não pode ser desfeita.`)) return;
    setErr(null);
    try {
      const { error, data } = await supabase
        .from("processos_licitatorios")
        .delete()
        .eq("chave", p.chave)
        .select("chave");
      if (error) throw error;
      if (!data || data.length === 0) {
        throw new Error("Exclusão bloqueada por permissão de acesso (RLS). Contate o administrador.");
      }
      setSelected(null);
      setProcessos((prev) => prev.filter((x) => x.chave !== p.chave));
    } catch (e: any) {
      setErr(e?.message ?? "Erro ao excluir processo.");
    }
  }

  // ── Cadastro manual ────────────────────────────────────────────────────────
  async function saveCadastro() {
    if (!cNumero.trim() || !cObjeto.trim()) return;
    setSavingCadastro(true);
    setErr(null);
    try {
      const chave = `MANUAL:${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
      const ano   = new Date().getFullYear();
      const { error: e1 } = await supabase.from("processos_licitatorios").insert({
        chave, fonte: "MANUAL", ano,
        numero_processo: cNumero.trim(),
        objeto: cObjeto.trim(),
        ultima_sync: new Date().toISOString(),
      });
      if (e1) throw e1;
      const { error: e2 } = await supabase.from("processo_controle").upsert(
        { chave, status_livre: cStatus || null, pag: cPag.trim() || null, om: cOm.trim() || null, updated_at: new Date().toISOString() },
        { onConflict: "chave" }
      );
      if (e2) throw e2;
      const { data: sess } = await supabase.auth.getSession();
      const uid = sess.session?.user.id;
      for (const obs of cObs.map((o) => o.trim()).filter(Boolean)) {
        await supabase.from("processo_observacoes").insert({
          chave, observacao: obs, data_observacao: today(), created_by: uid,
        });
      }
      setCNumero(""); setCPag(""); setCObjeto(""); setCOm(""); setCStatus(""); setCObs([""]);
      setShowCadastro(false);
      await loadProcessos();
    } catch (e: any) {
      setErr(e?.message ?? "Erro ao cadastrar processo.");
    } finally {
      setSavingCadastro(false);
    }
  }

  // ── Filtros ────────────────────────────────────────────────────────────────
  const anos = useMemo(
    () => [...new Set(processos.map((p) => p.ano))].sort((a, b) => b - a),
    [processos]
  );

  const filtered = useMemo(() => {
    const q = filtroTexto.trim().toLowerCase();
    return processos.filter((p) => {
      if (filtroAno !== "todos" && String(p.ano) !== filtroAno) return false;
      if (filtroStatus !== "todos") {
        const st = calcStatus(p).label.toLowerCase();
        if (filtroStatus === "andamento"  && st !== "em andamento") return false;
        if (filtroStatus === "homologada" && st !== "homologada")   return false;
        if (filtroStatus === "revogada"   && !st.includes("revog")) return false;
        if (filtroStatus === "suspensa"   && !st.includes("suspens")) return false;
      }
      if (filtroModalidade !== "todas") {
        const prefix = modalidadePrefix(p.modalidade);
        if (prefix !== filtroModalidade) return false;
      }
      if (filtroSrp === "sim" && p.srp !== true)  return false;
      if (filtroSrp === "nao" && p.srp === true)  return false;
      if (q) {
        const obj = (p.objeto ?? "").toLowerCase();
        const num = (p.numero_processo ?? "").toLowerCase();
        if (!obj.includes(q) && !num.includes(q)) return false;
      }
      return true;
    });
  }, [processos, filtroAno, filtroStatus, filtroModalidade, filtroSrp, filtroTexto]);

  // ── Filtros — Em Elaboração ─────────────────────────────────────────────────
  const elabAnos = useMemo(() => {
    const s = new Set<string>();
    elaboracaoRows.forEach((r) => { const m = r.nContratacao.match(/\/(\d{4})/); if (m) s.add(m[1]); });
    return Array.from(s).sort((a, b) => Number(b) - Number(a));
  }, [elaboracaoRows]);

  const elabModalidades = useMemo(() => {
    const s = new Set<string>();
    elaboracaoRows.forEach((r) => { if (r.modalidade) s.add(r.modalidade); });
    return Array.from(s).sort();
  }, [elaboracaoRows]);

  const elabApoiadas = useMemo(() => {
    const s = new Set<string>();
    elaboracaoRows.forEach((r) => { if (r.apoiada) s.add(r.apoiada); });
    return Array.from(s).sort();
  }, [elaboracaoRows]);

  const elabStatuses = useMemo(() => {
    const s = new Set<string>();
    elaboracaoRows.forEach((r) => {
      const ov = elabOverrides.get(r.nContratacao);
      const v = ov?.status_override || r.status || r.situacao;
      if (v) s.add(v);
    });
    return Array.from(s).sort();
  }, [elaboracaoRows, elabOverrides]);

  const filteredElab = useMemo(() => {
    const q = elabFiltroTexto.trim().toLowerCase();
    return elaboracaoRows.filter((r) => {
      const ov = elabOverrides.get(r.nContratacao);
      if (!showOcultos && ov?.oculto) return false;
      const ano = r.nContratacao.match(/\/(\d{4})/)?.[1] ?? "";
      if (elabFiltroAno !== "todos" && ano !== elabFiltroAno) return false;
      if (elabFiltroModalidade !== "todas" && r.modalidade !== elabFiltroModalidade) return false;
      if (elabFiltroApoiada !== "todas" && r.apoiada !== elabFiltroApoiada) return false;
      if (elabFiltroSituacao !== "todas") {
        const sit = r.situacao.trim().toLowerCase();
        const isDNR = sit.includes("dnr") || sit.includes("aguardando dnr");
        if (elabFiltroSituacao === "aguardando_dnr" && !isDNR) return false;
        if (elabFiltroSituacao === "outra"          &&  isDNR) return false;
      }
      if (elabFiltroStatus !== "todos") {
        const ov = elabOverrides.get(r.nContratacao);
        const statusVal = ov?.status_override || r.status || r.situacao;
        if (statusVal !== elabFiltroStatus) return false;
      }
      if (q && !r.objeto.toLowerCase().includes(q) && !r.nContratacao.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [elaboracaoRows, elabFiltroTexto, elabFiltroModalidade, elabFiltroAno, elabFiltroApoiada, elabFiltroSituacao, elabFiltroStatus, elabOverrides, showOcultos]);

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-4">

      {/* Banner de dados desatualizados */}
      {staleness === "stale" && !syncing && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800 flex items-center justify-between gap-3">
          <span>Dados com mais de 24h. Atualize para trazer novos processos.</span>
          <button onClick={handleSync} className="font-semibold underline">Sincronizar agora</button>
        </div>
      )}

      {/* Cabeçalho */}
      <Card>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="font-semibold text-slate-900">Gerenciamento de Processos</div>
            <div className="text-sm text-slate-500">
              UASG 120630 •{" "}
              {lastSync
                ? `Última sincronização: ${fmtDateTime(lastSync)}`
                : "Ainda não sincronizado — clique em Sincronizar"}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {canImport && subTab === "publicados" && (
              <>
                <button
                  onClick={() => setShowCadastro((v) => !v)}
                  className="rounded-xl border border-indigo-200 bg-indigo-50 px-3 py-2 text-sm text-indigo-700 hover:bg-indigo-100"
                >
                  {showCadastro ? "Cancelar" : "+ Cadastrar Processo"}
                </button>
                <button
                  onClick={handleSync}
                  disabled={syncing || loading}
                  className="rounded-xl bg-sky-600 px-3 py-2 text-sm text-white hover:bg-sky-700 disabled:opacity-60"
                >
                  {syncing ? "Sincronizando..." : "Sincronizar"}
                </button>
              </>
            )}
            <button
              onClick={() => loadSheets()}
              disabled={loadingSheet}
              className="rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-60"
            >
              {loadingSheet ? "Carregando..." : "↺ Atualizar planilha"}
            </button>
            {canImport && (
              <button
                onClick={() => { setShowSheetCfg((v) => !v); setSheetInput(sheetId); }}
                className="rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50"
                title="Configurar planilha"
              >
                ⚙
              </button>
            )}
          </div>
        </div>

        {/* Config de planilha — apenas SLIC/ADMIN */}
        {showSheetCfg && canImport && (
          <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3 space-y-2">
            <div className="text-xs font-semibold text-amber-800">Configurar planilha (ID ou URL)</div>
            <div className="text-xs text-amber-700">
              Cole o ID da planilha (trecho entre <code className="bg-amber-100 px-1 rounded">/d/</code> e <code className="bg-amber-100 px-1 rounded">/edit</code>) ou a URL completa do Google Sheets.
            </div>
            <div className="flex gap-2">
              <input
                value={sheetInput}
                onChange={(e) => setSheetInput(e.target.value)}
                placeholder={DEFAULT_SHEET_ID}
                className="flex-1 rounded-xl border border-amber-300 bg-white px-3 py-1.5 text-xs outline-none focus:ring-2 focus:ring-amber-200"
              />
              <button
                onClick={() => {
                  // extrai ID da URL se necessário
                  const m = sheetInput.match(/\/d\/([\w-]+)/);
                  const id = m ? m[1] : sheetInput.trim() || DEFAULT_SHEET_ID;
                  try { localStorage.setItem(LS_SHEET_KEY, id); } catch { /* ignore */ }
                  setSheetId(id);
                  setShowSheetCfg(false);
                  loadSheets(id);
                }}
                className="rounded-xl bg-amber-600 px-3 py-1.5 text-xs text-white hover:bg-amber-700"
              >
                Salvar e recarregar
              </button>
              {sheetId !== DEFAULT_SHEET_ID && (
                <button
                  onClick={() => {
                    try { localStorage.removeItem(LS_SHEET_KEY); } catch { /* ignore */ }
                    setSheetId(DEFAULT_SHEET_ID);
                    setShowSheetCfg(false);
                    loadSheets(DEFAULT_SHEET_ID);
                  }}
                  className="rounded-xl border border-amber-300 px-3 py-1.5 text-xs text-amber-700 hover:bg-amber-100"
                >
                  Restaurar padrão
                </button>
              )}
            </div>
            <div className="text-xs text-amber-600">ID atual: <code className="font-mono">{sheetId}</code></div>
          </div>
        )}

        {err && (
          <div className="mt-3 rounded-xl border border-red-200 bg-red-50 p-2 text-sm text-red-700">
            {err}
          </div>
        )}

        {/* Sub-abas */}
        <div className="mt-4 flex gap-0 border-b border-slate-200">
          {[
            { id: "publicados", label: `Publicados — PNCP (${processos.length})` },
            { id: "elaboracao", label: `Em Elaboração${elaboracaoRows.length > 0 ? ` (${elaboracaoRows.length})` : ""}` },
          ].map((t) => (
            <button
              key={t.id}
              onClick={() => setSubTab(t.id as any)}
              className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                subTab === t.id
                  ? "border-sky-600 text-sky-700"
                  : "border-transparent text-slate-500 hover:text-slate-700"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </Card>

      {/* ══════════════════ SUB-ABA: PUBLICADOS ══════════════════ */}
      {subTab === "publicados" && (
        <>
          {/* Formulário de cadastro manual */}
          {showCadastro && (
            <Card>
              <div className="text-sm font-semibold text-slate-900 mb-3">Novo Processo</div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-medium text-slate-600">Nº do Processo *</label>
                  <input
                    value={cNumero} onChange={(e) => setCNumero(e.target.value)}
                    placeholder="Ex: 90036/2025"
                    className="mt-1 w-full rounded-xl border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-sky-200"
                  />
                </div>
                <div>
                  <label className="text-xs font-medium text-slate-600">PAG</label>
                  <input
                    value={cPag} onChange={(e) => setCPag(e.target.value)}
                    placeholder="Ex: 67298.001234/2025-00"
                    className="mt-1 w-full rounded-xl border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-sky-200"
                  />
                </div>
                <div className="sm:col-span-2">
                  <label className="text-xs font-medium text-slate-600">Objeto Resumido *</label>
                  <textarea
                    value={cObjeto} onChange={(e) => setCObjeto(e.target.value)}
                    placeholder="Descreva o objeto da licitação..."
                    rows={2}
                    className="mt-1 w-full rounded-xl border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-sky-200 resize-none"
                  />
                </div>
                <div>
                  <label className="text-xs font-medium text-slate-600">OM</label>
                  <input
                    value={cOm} onChange={(e) => setCOm(e.target.value)}
                    placeholder="Ex: GAP-MN"
                    className="mt-1 w-full rounded-xl border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-sky-200"
                  />
                </div>
                <div>
                  <label className="text-xs font-medium text-slate-600">Status</label>
                  <select
                    value={cStatus} onChange={(e) => setCStatus(e.target.value)}
                    className="mt-1 w-full rounded-xl border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-sky-200"
                  >
                    <option value="">— Sem status —</option>
                    {STATUS_LIVRE_OPCOES.map((s) => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
              </div>

              <div className="mt-4">
                <div className="text-xs font-semibold text-slate-700 mb-2">Observações</div>
                <div className="space-y-2">
                  {cObs.map((obs, i) => (
                    <div key={i} className="flex gap-2 items-start">
                      <span className="mt-2 text-xs text-slate-400 shrink-0">#{i + 1}</span>
                      <textarea
                        value={obs}
                        onChange={(e) => setCObs((prev) => prev.map((o, j) => j === i ? e.target.value : o))}
                        rows={2}
                        placeholder={`Observação ${i + 1}...`}
                        className="flex-1 rounded-xl border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-sky-200 resize-none"
                      />
                      {cObs.length > 1 && (
                        <button
                          onClick={() => setCObs((prev) => prev.filter((_, j) => j !== i))}
                          className="mt-1 text-xs text-red-400 hover:text-red-600"
                        >✕</button>
                      )}
                    </div>
                  ))}
                </div>
                <button onClick={() => setCObs((prev) => [...prev, ""])} className="mt-2 text-xs text-sky-700 hover:underline">
                  + Adicionar observação
                </button>
              </div>

              <div className="mt-4 flex gap-2 justify-end">
                <button
                  onClick={() => { setShowCadastro(false); setCNumero(""); setCPag(""); setCObjeto(""); setCOm(""); setCStatus(""); setCObs([""]); }}
                  className="rounded-xl border px-4 py-2 text-sm text-slate-600 hover:bg-slate-50"
                >
                  Cancelar
                </button>
                <button
                  onClick={saveCadastro}
                  disabled={savingCadastro || !cNumero.trim() || !cObjeto.trim()}
                  className="rounded-xl bg-indigo-600 px-4 py-2 text-sm text-white hover:bg-indigo-700 disabled:opacity-60"
                >
                  {savingCadastro ? "Salvando..." : "Cadastrar"}
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
                {anos.map((a) => <option key={a} value={String(a)}>{a}</option>)}
              </select>

              <select
                value={filtroStatus}
                onChange={(e) => setFiltroStatus(e.target.value)}
                className="rounded-xl border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-sky-200"
              >
                <option value="todos">Todas as situações</option>
                <option value="andamento">Em Andamento</option>
                <option value="homologada">Homologada</option>
                <option value="suspensa">Suspensa</option>
                <option value="revogada">Revogada</option>
              </select>

              <select
                value={filtroModalidade}
                onChange={(e) => setFiltroModalidade(e.target.value)}
                className="rounded-xl border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-sky-200"
              >
                <option value="todas">Todas as modalidades</option>
                <option value="PE">Pregão Eletrônico</option>
                <option value="INEX">Inexigibilidade</option>
                <option value="DE">Dispensa Eletrônica</option>
                <option value="CE">Concorrência</option>
              </select>

              <select
                value={filtroSrp}
                onChange={(e) => setFiltroSrp(e.target.value)}
                className="rounded-xl border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-sky-200"
              >
                <option value="todos">SRP: todos</option>
                <option value="sim">Somente SRP</option>
                <option value="nao">Sem SRP</option>
              </select>

              <input
                value={filtroTexto}
                onChange={(e) => setFiltroTexto(e.target.value)}
                placeholder="Buscar por objeto ou nº do processo..."
                className="flex-1 min-w-[220px] rounded-xl border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-sky-200"
              />

              <span className="text-xs text-slate-500">
                {filtered.length} de {processos.length} processo{processos.length !== 1 ? "s" : ""}
              </span>
            </div>
          </Card>

          {/* Grid principal */}
          <div className={`grid gap-4 ${selected ? "grid-cols-1 xl:grid-cols-2" : "grid-cols-1"}`}>

            {/* Lista de processos */}
            <Card>
              {loading ? (
                <p className="text-sm text-slate-500">Carregando...</p>
              ) : filtered.length === 0 ? (
                <p className="text-sm text-slate-500">
                  {processos.length === 0
                    ? "Nenhum processo. Clique em Sincronizar para importar da API PNCP."
                    : "Nenhum resultado para os filtros aplicados."}
                </p>
              ) : (
                <div className="space-y-2 max-h-[640px] overflow-y-auto pr-1">
                  {filtered.map((p) => {
                    const st      = calcStatus(p);
                    const sl      = p.processo_controle?.[0]?.status_livre;
                    const numFmt  = fmtNumProc(p.modalidade, p.numero_processo);
                    const fe      = faseExternaMap.get(normalizeNumSiasg(p.numero_processo ?? ""));
                    const isAnd   = st.label === "Em Andamento";
                    return (
                      <button
                        key={p.id}
                        onClick={() => handleSelect(p)}
                        className={`w-full rounded-xl border p-3 text-left hover:bg-slate-50 transition-colors ${
                          selected?.id === p.id ? "border-sky-300 ring-2 ring-sky-100" : "border-slate-200"
                        }`}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0 flex-1">
                            <div className="text-sm font-semibold text-slate-900 truncate flex items-center gap-1.5 flex-wrap">
                              {numFmt}{p.srp && <span className="rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700">SRP</span>} — {p.ano}
                            </div>
                            <div className="mt-0.5 text-xs text-slate-600 line-clamp-2">
                              {p.objeto ?? "-"}
                            </div>
                            {/* Fase Externa: abertura e dias em andamento */}
                            {fe && isAnd && (
                              <div className="mt-1 text-xs flex items-center gap-2">
                                <span className="text-sky-700 font-medium">Abertura: {fe.abertura}</span>
                                {fe.diasCalc > 0 && (
                                  <span className={`font-semibold ${fe.diasCalc > 60 ? "text-red-600" : fe.diasCalc > 30 ? "text-amber-600" : "text-slate-500"}`}>
                                    • {fe.diasCalc}d em andamento
                                  </span>
                                )}
                              </div>
                            )}
                            <div className="mt-1.5 flex flex-wrap gap-1.5">
                              <span className={`rounded-full border px-2 py-0.5 text-xs ${st.cls}`}>
                                {st.label}
                              </span>
                              {fe && isAnd && (
                                <span className="rounded-full border border-sky-200 bg-sky-50 px-2 py-0.5 text-xs text-sky-700">
                                  Fase Externa
                                </span>
                              )}
                              {sl && (
                                <span className="rounded-full border border-indigo-200 bg-indigo-50 px-2 py-0.5 text-xs text-indigo-800">
                                  {sl}
                                </span>
                              )}
                            </div>
                          </div>
                          <div className="text-right text-xs shrink-0 space-y-0.5">
                            {p.valor_homologado !== null ? (
                              <div className="font-semibold text-green-700">{fmtMoney(p.valor_homologado)}</div>
                            ) : p.valor_estimado !== null ? (
                              <div className="text-slate-400">Est: {fmtMoney(p.valor_estimado)}</div>
                            ) : null}
                            <div className="text-slate-400">{fmtDate(p.data_publicacao)}</div>
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </Card>

            {/* Painel de detalhe */}
            {selected && (() => {
              const fe = faseExternaMap.get(normalizeNumSiasg(selected.numero_processo ?? ""));
              return (
                <Card>
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="text-sm font-semibold text-slate-900">
                        {fmtNumProc(selected.modalidade, selected.numero_processo ?? selected.chave)}
                      </div>
                      <div className="text-xs text-slate-500">
                        {selected.modalidade ?? "-"} • {selected.ano} • {selected.fonte}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {selected.fonte === "MANUAL" && (
                        <button
                          onClick={() => deleteProcesso(selected)}
                          className="text-xs text-red-400 hover:text-red-600 border border-red-200 rounded-lg px-2 py-0.5"
                        >
                          Excluir
                        </button>
                      )}
                      <button onClick={() => setSelected(null)} className="text-xs text-slate-400 hover:text-slate-700">
                        ✕ Fechar
                      </button>
                    </div>
                  </div>

                  <p className="mt-2 text-sm text-slate-700 leading-relaxed">{selected.objeto ?? "-"}</p>

                  {/* Dados do processo */}
                  <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-slate-600">
                    <div><span className="font-semibold">Publicação:</span> {fmtDate(selected.data_publicacao)}</div>
                    <div><span className="font-semibold">Abertura (API):</span> {fmtDate(selected.abertura_proposta)}</div>
                    <div><span className="font-semibold">Encerramento:</span> {fmtDate(selected.encerramento_proposta)}</div>
                    <div><span className="font-semibold">Situação API:</span> {selected.situacao_api ?? "-"}</div>
                    <div><span className="font-semibold">Valor Estimado:</span> {fmtMoney(selected.valor_estimado)}</div>
                    <div>
                      <span className="font-semibold">Valor Homologado:</span>{" "}
                      <span className={selected.valor_homologado ? "text-green-700 font-semibold" : ""}>
                        {fmtMoney(selected.valor_homologado ?? selected.valor_homologado_manual)}
                      </span>
                    </div>
                  </div>

                  {/* ── Override manual de homologação (só SLIC/ADMIN) ── */}
                  {canEdit && (
                    <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50/60 p-3">
                      <div className="text-xs font-semibold text-amber-800 mb-2">
                        Homologação manual
                        {selected.homologado_manual && (
                          <span className="ml-2 rounded-full bg-green-100 border border-green-300 text-green-700 px-2 py-0.5 text-[10px]">
                            Marcado manualmente
                          </span>
                        )}
                      </div>
                      {selected.homologado_manual ? (
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-slate-600">
                            Valor: {fmtMoney(selected.valor_homologado_manual)}
                          </span>
                          <button
                            onClick={() => saveHomologadoManual(selected, false)}
                            disabled={savingHom}
                            className="text-xs text-red-500 hover:text-red-700 border border-red-200 rounded-lg px-2 py-0.5 disabled:opacity-50"
                          >
                            {savingHom ? "Salvando..." : "Desfazer"}
                          </button>
                        </div>
                      ) : (
                        <div className="flex items-center gap-2 flex-wrap">
                          <input
                            type="text"
                            value={homManualInput}
                            onChange={e => setHomManualInput(e.target.value)}
                            placeholder="Valor homologado (opcional)"
                            className="rounded-lg border border-amber-200 px-2 py-1 text-xs outline-none focus:ring-2 focus:ring-amber-200 w-48"
                          />
                          <button
                            onClick={() => saveHomologadoManual(selected, true)}
                            disabled={savingHom}
                            className="text-xs font-medium bg-green-600 hover:bg-green-700 text-white rounded-lg px-3 py-1 disabled:opacity-50"
                          >
                            {savingHom ? "Salvando..." : "Marcar como Homologado"}
                          </button>
                        </div>
                      )}
                      {homManualErr && <p className="mt-1 text-xs text-red-600">{homManualErr}</p>}
                    </div>
                  )}

                  {selected.link_sistema && (
                    <a
                      href={selected.link_sistema}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="mt-2 block text-xs text-sky-700 hover:underline truncate"
                    >
                      Abrir no sistema de origem →
                    </a>
                  )}

                  {/* ── Fase Externa (planilha SLIC) ── */}
                  {fe && (
                    <div className="mt-4 rounded-xl border border-sky-100 bg-sky-50/60 p-3">
                      <div className="text-xs font-semibold text-sky-800 mb-2">
                        Fase Externa — Planilha Seção de Licitações
                      </div>
                      <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-slate-700">
                        <div><span className="font-semibold">Pregoeiro:</span> {fe.pregoeiro || "–"}</div>
                        <div><span className="font-semibold">Apoiada:</span> {fe.apoiada || "–"}</div>
                        <div>
                          <span className="font-semibold">Abertura sessão:</span>{" "}
                          <span className="text-sky-700 font-medium">{fe.abertura || "–"}</span>
                        </div>
                        <div>
                          <span className="font-semibold">Dias em andamento:</span>{" "}
                          <span className={`font-bold ${fe.diasCalc > 60 ? "text-red-600" : fe.diasCalc > 30 ? "text-amber-600" : "text-slate-700"}`}>
                            {fe.diasCalc}d
                          </span>
                        </div>
                        {fe.pag && (
                          <div className="col-span-2">
                            <span className="font-semibold">PAG:</span> {fe.pag}
                          </div>
                        )}
                        {fe.situacao && (
                          <div className="col-span-2 mt-1 text-slate-500 italic leading-relaxed text-[11px]">
                            {fe.situacao.slice(0, 220)}{fe.situacao.length > 220 ? "..." : ""}
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  <div className="mt-4 border-t pt-1">
                  </div>
                </Card>
              );
            })()}
          </div>
        </>
      )}

      {/* ══════════════════ SUB-ABA: EM ELABORAÇÃO ══════════════════ */}
      {subTab === "elaboracao" && (
        <Card>
          {false ? (
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 space-y-2">
              <div className="text-sm font-semibold text-amber-800">Aba de elaboração não configurada</div>
              <div className="text-xs text-amber-700 leading-relaxed">
                Para ativar: abra a planilha → vá para a aba de planejamento → copie o número após{" "}
                <code className="bg-amber-100 px-1 rounded">gid=</code> na URL → informe ao administrador
                para atualizar a constante <code className="bg-amber-100 px-1 rounded">PLANNING_GID</code>{" "}
                em <code className="bg-amber-100 px-1 rounded">GerenciamentoProcessos.tsx</code>.
              </div>
              <div className="text-xs text-amber-700">
                Certifique-se de que a aba foi compartilhada como <strong>"Qualquer pessoa com o link"</strong>.
              </div>
            </div>
          ) : loadingSheet ? (
            <p className="text-sm text-slate-500">Carregando planilha...</p>
          ) : elaboracaoRows.length === 0 ? (
            <p className="text-sm text-slate-500">Nenhum processo em elaboração encontrado na planilha.</p>
          ) : (
            <div className="space-y-4">
              {/* Filtros */}
              <div className="flex flex-wrap items-center gap-3">
                <select
                  value={elabFiltroAno}
                  onChange={(e) => setElabFiltroAno(e.target.value)}
                  className="rounded-xl border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-sky-200"
                >
                  <option value="todos">Todos os anos</option>
                  {elabAnos.map((a) => <option key={a} value={a}>{a}</option>)}
                </select>

                <select
                  value={elabFiltroModalidade}
                  onChange={(e) => setElabFiltroModalidade(e.target.value)}
                  className="rounded-xl border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-sky-200"
                >
                  <option value="todas">Todas as modalidades</option>
                  {elabModalidades.map((m) => <option key={m} value={m}>{m}</option>)}
                </select>

                <select
                  value={elabFiltroApoiada}
                  onChange={(e) => setElabFiltroApoiada(e.target.value)}
                  className="rounded-xl border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-sky-200"
                >
                  <option value="todas">Todas as apoiadas</option>
                  {elabApoiadas.map((a) => <option key={a} value={a}>{a}</option>)}
                </select>


                {elabStatuses.length > 0 && (
                  <select
                    value={elabFiltroStatus}
                    onChange={(e) => setElabFiltroStatus(e.target.value)}
                    className="rounded-xl border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-sky-200"
                  >
                    <option value="todos">Todos os status</option>
                    {elabStatuses.map((s) => <option key={s} value={s}>{s}</option>)}
                  </select>
                )}

                <input
                  value={elabFiltroTexto}
                  onChange={(e) => setElabFiltroTexto(e.target.value)}
                  placeholder="Buscar por objeto ou nº..."
                  className="flex-1 min-w-[200px] rounded-xl border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-sky-200"
                />

                <span className="text-xs text-slate-500">
                  {filteredElab.length} de {elaboracaoRows.length} processo{elaboracaoRows.length !== 1 ? "s" : ""}
                </span>

                {canEditElaboracao && (
                  <button
                    onClick={() => setShowOcultos((v) => !v)}
                    className={`rounded-xl border px-3 py-2 text-xs ${showOcultos ? "border-amber-300 bg-amber-50 text-amber-700" : "border-slate-200 text-slate-500 hover:bg-slate-50"}`}
                  >
                    {showOcultos ? "Ocultar removidos" : "Ver removidos"}
                  </button>
                )}
              </div>

              {/* Tabela + painel lateral */}
              <div className={`grid gap-4 ${elabSelected ? "grid-cols-1 xl:grid-cols-2" : "grid-cols-1"}`}>
                <div className="overflow-x-auto">
                  {filteredElab.length === 0 ? (
                    <p className="text-sm text-slate-500">Nenhum resultado para os filtros aplicados.</p>
                  ) : (
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="border-b border-slate-200 bg-slate-50">
                          <th className="text-left py-2 px-3 font-semibold text-slate-600 whitespace-nowrap">Nº Contratação</th>
                          <th className="text-left py-2 px-3 font-semibold text-slate-600 whitespace-nowrap">Nº DFD</th>
                          <th className="text-left py-2 px-3 font-semibold text-slate-600">Modalidade</th>
                          <th className="text-left py-2 px-3 font-semibold text-slate-600">Objeto</th>
                          <th className="text-left py-2 px-3 font-semibold text-slate-600">Apoiada</th>
                          <th className="text-left py-2 px-3 font-semibold text-slate-600">Status</th>
                          <th className="text-left py-2 px-3 font-semibold text-slate-600">Responsável</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-50">
                        {filteredElab.map((r, i) => {
                          const ov       = elabOverrides.get(r.nContratacao);
                          const isOculto = ov?.oculto ?? false;
                          const statusShow = ov?.status_override || r.status || r.situacao;
                          const isSelected = elabSelected?.nContratacao === r.nContratacao;
                          return (
                            <tr
                              key={i}
                              onClick={() => handleElabSelect(r)}
                              className={`cursor-pointer hover:bg-sky-50 transition-colors ${isSelected ? "bg-sky-50 ring-1 ring-sky-200" : ""} ${isOculto ? "opacity-40" : ""}`}
                            >
                              <td className="py-2 px-3 font-medium text-slate-800 whitespace-nowrap">{r.nContratacao || "–"}</td>
                              <td className="py-2 px-3 text-slate-600 whitespace-nowrap">{r.nDfd || "–"}</td>
                              <td className="py-2 px-3 text-slate-600 whitespace-nowrap">{r.modalidade || "–"}</td>
                              <td className="py-2 px-3 text-slate-600 max-w-xs" title={r.objeto}>
                                <span className="line-clamp-2">{r.objeto || "–"}</span>
                              </td>
                              <td className="py-2 px-3 text-slate-600 whitespace-nowrap">{r.apoiada || "–"}</td>
                              <td className="py-2 px-3 whitespace-nowrap">
                                {ov?.status_override ? (
                                  <span className="rounded-full border border-indigo-200 bg-indigo-50 px-2 py-0.5 text-indigo-800 text-[11px]">
                                    {ov.status_override}
                                  </span>
                                ) : statusShow ? (
                                  <span className="text-slate-700">{statusShow}</span>
                                ) : "–"}
                              </td>
                              <td className="py-2 px-3 text-slate-600 whitespace-nowrap">{r.responsavel || "–"}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  )}
                </div>

                {/* Painel lateral */}
                {elabSelected && (() => {
                  const ov = elabOverrides.get(elabSelected.nContratacao);
                  return (
                    <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-3 text-sm">
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <div className="font-semibold text-slate-900">{elabSelected.nContratacao}</div>
                          <div className="text-xs text-slate-500 mt-0.5">{elabSelected.modalidade} • {elabSelected.apoiada}</div>
                        </div>
                        <button onClick={() => setElabSelected(null)} className="text-xs text-slate-400 hover:text-slate-700">✕</button>
                      </div>

                      <p className="text-xs text-slate-700 leading-relaxed">{elabSelected.objeto || "–"}</p>

                      {elabSelected.situacao && (
                        <div className="rounded-lg bg-slate-50 border border-slate-100 p-2 text-xs text-slate-600 leading-relaxed">
                          <span className="font-semibold text-slate-700">Situação detalhada: </span>
                          {elabSelected.situacao}
                        </div>
                      )}

                      {ov?.observacao && (
                        <div className="rounded-lg bg-amber-50 border border-amber-100 p-2 text-xs text-amber-800 leading-relaxed">
                          <span className="font-semibold">Observação: </span>{ov.observacao}
                        </div>
                      )}

                      {canEditElaboracao && (
                        <div className="space-y-2 pt-2 border-t border-slate-100">
                          <div className="text-xs font-semibold text-slate-700">Editar manualmente</div>
                          <div>
                            <label className="text-xs text-slate-500">Status</label>
                            <select
                              value={overrideStatus}
                              onChange={(e) => setOverrideStatus(e.target.value)}
                              className="mt-1 w-full rounded-xl border px-2 py-1.5 text-xs outline-none focus:ring-2 focus:ring-sky-200"
                            >
                              <option value="">— Sem override —</option>
                              {STATUS_LIVRE_OPCOES.map((s) => <option key={s} value={s}>{s}</option>)}
                            </select>
                          </div>
                          <div>
                            <label className="text-xs text-slate-500">Observação</label>
                            <textarea
                              value={overrideObs}
                              onChange={(e) => setOverrideObs(e.target.value)}
                              rows={3}
                              placeholder="Adicione uma observação..."
                              className="mt-1 w-full rounded-xl border px-2 py-1.5 text-xs outline-none focus:ring-2 focus:ring-sky-200 resize-none"
                            />
                          </div>
                          <div className="flex gap-2 flex-wrap">
                            <button
                              onClick={() => saveElabOverride(elabSelected.nContratacao, ov?.oculto ?? false)}
                              disabled={savingOverride}
                              className="rounded-xl bg-sky-600 px-3 py-1.5 text-xs text-white hover:bg-sky-700 disabled:opacity-60"
                            >
                              {savingOverride ? "Salvando..." : "Salvar"}
                            </button>
                            <button
                              onClick={() => saveElabOverride(elabSelected.nContratacao, !(ov?.oculto ?? false))}
                              disabled={savingOverride}
                              className={`rounded-xl border px-3 py-1.5 text-xs disabled:opacity-60 ${ov?.oculto ? "border-green-200 text-green-700 hover:bg-green-50" : "border-red-200 text-red-600 hover:bg-red-50"}`}
                            >
                              {ov?.oculto ? "Reexibir" : "Ocultar processo"}
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })()}
              </div>
            </div>
          )}
        </Card>
      )}
    </div>
  );
}
