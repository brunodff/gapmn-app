import { useState, useEffect, useMemo, useRef } from "react";
import { supabase } from "../lib/supabase";
import { Card } from "./Card";
import * as XLSX from "xlsx";

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
  fonte: string;
  created_at: string;
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

// ─── Componente ───────────────────────────────────────────────────────────────
interface GerContratoProps { canImport?: boolean; canEdit?: boolean; }
export default function GerenciamentoContratos({ canImport = true, canEdit = true }: GerContratoProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Dados
  const [contratos, setContratos] = useState<Contrato[]>([]);
  const [loading, setLoading]     = useState(true);
  const [err, setErr]             = useState<string | null>(null);

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

  // Fiscal
  const [editingFiscal, setEditingFiscal] = useState(false);
  const [fiscalInput, setFiscalInput]     = useState("");
  const [savingFiscal, setSavingFiscal]   = useState(false);

  // Rola para o painel de detalhes ao selecionar (mobile) e reseta edição de fiscal
  useEffect(() => {
    setEditingFiscal(false);
    setFiscalInput("");
    if (selected && detailRef.current) {
      setTimeout(() => {
        detailRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      }, 60);
    }
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
  const [sortBy, setSortBy]               = useState<"none" | "saldo_asc" | "saldo_desc" | "vencimento_asc">("none");

  // ── Carga ────────────────────────────────────────────────────────────────
  useEffect(() => { load(); }, []);

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

  const filtered = useMemo(() => {
    const q = filtroTexto.trim().toLowerCase();
    return contratos.filter((c) => {
      if (filtroAno !== "todos" && !c.data_inicio?.startsWith(filtroAno)) return false;
      if (filtroUgr !== "todos" && c.ugr !== filtroUgr) return false;
      if (filtroFiscal !== "todos" && c.fiscal !== filtroFiscal) return false;
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
  }, [contratos, filtroTexto, filtroAno, filtroUgr, filtroStatus, filtroFiscal]);

  const sorted = useMemo(() => {
    const arr = [...filtered];
    if (sortBy === "saldo_asc")  arr.sort((a, b) => (a.vl_a_empenhar ?? 0) - (b.vl_a_empenhar ?? 0));
    else if (sortBy === "saldo_desc") arr.sort((a, b) => (b.vl_a_empenhar ?? 0) - (a.vl_a_empenhar ?? 0));
    else if (sortBy === "vencimento_asc") {
      arr.sort((a, b) => {
        const da = a.data_final ? new Date(a.data_final).getTime() : Infinity;
        const db = b.data_final ? new Date(b.data_final).getTime() : Infinity;
        return da - db;
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

  // ── Render ───────────────────────────────────────────────────────────────
  return (
    <div className="space-y-4">

      {/* Cabeçalho */}
      <Card>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="font-semibold text-slate-900">Gerenciamento de Contratos</div>
            <div className="text-sm text-slate-500">
              {contratos.length} contrato{contratos.length !== 1 ? "s" : ""} cadastrado{contratos.length !== 1 ? "s" : ""}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {canImport && (
              <>
                <button
                  onClick={() => { setShowCadastro((v) => !v); setPreview(null); }}
                  className="rounded-xl border border-indigo-200 bg-indigo-50 px-3 py-2 text-sm text-indigo-700 hover:bg-indigo-100"
                >
                  {showCadastro ? "Cancelar" : "+ Cadastrar"}
                </button>
                <button
                  onClick={() => { setPreview(null); fileInputRef.current?.click(); }}
                  className="rounded-xl bg-sky-600 px-3 py-2 text-sm text-white hover:bg-sky-700"
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
                  className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700 hover:bg-rose-100 disabled:opacity-60"
                >
                  {clearingExcel ? "Removendo..." : "Limpar Importados"}
                </button>
              </>
            )}
            <button
              onClick={load}
              disabled={loading}
              className="rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-60"
            >
              {loading ? "Carregando..." : "Atualizar"}
            </button>
          </div>
        </div>
        {err && (
          <div className="mt-3 rounded-xl border border-red-200 bg-red-50 p-2 text-sm text-red-700">{err}</div>
        )}
      </Card>

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

          <input
            value={filtroTexto}
            onChange={(e) => setFiltroTexto(e.target.value)}
            placeholder="Buscar por nº, objeto, fornecedor, CNPJ..."
            className="flex-1 min-w-[220px] rounded-xl border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-sky-200"
          />

          <div className="flex gap-1 flex-wrap">
            {([
              { key: "none",          label: "Padrão" },
              { key: "saldo_asc",     label: "Saldo ↑" },
              { key: "saldo_desc",    label: "Saldo ↓" },
              { key: "vencimento_asc",label: "Vencimento" },
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
              {sorted.map((c) => (
                <button
                  key={c.id}
                  onClick={() => setSelected(selected?.id === c.id ? null : c)}
                  className={`w-full rounded-xl border p-3 text-left hover:bg-slate-50 transition-colors ${
                    selected?.id === c.id ? "border-sky-300 ring-2 ring-sky-100" : "border-slate-200"
                  }`}
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
                    </div>
                    <div className="text-right text-xs shrink-0 space-y-0.5">
                      {c.vl_contratual != null && (
                        <div className="font-semibold text-slate-700">{fmtMoney(c.vl_contratual)}</div>
                      )}
                      {c.vl_a_empenhar != null && (
                        <div className={c.vl_a_empenhar > 0 ? "text-green-700" : "text-red-600"}>
                          Saldo: {fmtMoney(c.vl_a_empenhar)}
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
                    </div>
                  </div>
                </button>
              ))}
            </div>
          )}
        </Card>

        {/* Painel de detalhe */}
        {selected && (
          <div ref={detailRef}>
          <Card>
            <div className="flex items-start justify-between gap-2 mb-3">
              <div>
                <div className="text-sm font-semibold text-slate-900">{selected.numero_contrato}</div>
                <div className="text-xs text-slate-500">
                  {selected.fonte} • {selected.uge ?? "–"} {selected.ugr ? `/ ${selected.ugr}` : ""}
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {selected.fonte === "MANUAL" && (
                  <button
                    onClick={() => deleteContrato(selected)}
                    className="text-xs text-red-400 hover:text-red-600 border border-red-200 rounded-lg px-2 py-0.5"
                  >
                    Excluir
                  </button>
                )}
                <button
                  onClick={() => setSelected(null)}
                  className="text-xs text-slate-400 hover:text-slate-700"
                >
                  ✕ Fechar
                </button>
              </div>
            </div>

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
                  <div className="text-slate-500">Valor Total do Contrato</div>
                  <div className="font-semibold text-slate-800 mt-0.5">{fmtMoney(selected.vl_contratual)}</div>
                </div>
                <div className="rounded-lg bg-amber-50 border border-amber-100 p-2">
                  <div className="text-amber-700">Valor a Liquidar</div>
                  <div className="font-semibold text-amber-900 mt-0.5">{fmtMoney(selected.saldo)}</div>
                </div>
                <div className="rounded-lg bg-indigo-50 border border-indigo-100 p-2">
                  <div className="text-indigo-700">Liquidado</div>
                  <div className="font-semibold text-indigo-900 mt-0.5">{fmtMoney(selected.vl_liquidado)}</div>
                </div>
                <div className={`rounded-lg border p-2 ${
                  selected.vl_a_empenhar != null && selected.vl_a_empenhar > 0
                    ? "bg-green-50 border-green-200"
                    : "bg-red-50 border-red-200"
                }`}>
                  <div className={selected.vl_a_empenhar != null && selected.vl_a_empenhar > 0 ? "text-green-700" : "text-red-700"}>
                    Saldo (Valor a Empenhar)
                  </div>
                  <div className={`font-bold text-base mt-0.5 ${
                    selected.vl_a_empenhar != null && selected.vl_a_empenhar > 0 ? "text-green-800" : "text-red-800"
                  }`}>
                    {fmtMoney(selected.vl_a_empenhar)}
                  </div>
                </div>
              </div>
            </div>
          </Card>
          </div>
        )}
      </div>
    </div>
  );
}
