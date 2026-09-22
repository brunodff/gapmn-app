import { useState, useEffect, useMemo } from "react";
import { supabase } from "../lib/supabase";

// ── Tipos ───────────────────────────────────────────────────────────────────
type Contrato = {
  id: string;
  numero_contrato: string;
  uge: string | null;
  ugr: string | null;
  status: string | null;
  tipo: string | null;
  vl_contratual: number | null;
  vl_a_empenhar: number | null;
  vl_liquidado:  number | null;
  saldo:         number | null;
  data_inicio: string | null;
  data_final: string | null;
  data_orcamento: string | null; // YYYY-MM-DD — base para calcular próx. reajuste
  fornecedor: string | null;
  tipo_objeto: string | null;
  pag_nup: string | null;
  descricao: string | null;
  cnpj: string | null;
  fiscal: string | null;
  fonte: string;
};

// Documento anexado por contrato (localStorage + Supabase Storage)
type DocAnexo = {
  nome: string;
  tipo: "contrato" | "tr" | "aditivo" | "apostilamento";
  dataAnexo: string;
  url?: string | null; // Supabase Storage public URL
};
type DocMap = Record<string, DocAnexo[]>; // chave = numero_contrato

const LS_DOCS = "gapmn_apt_docs";
function loadDocs(): DocMap { try { return JSON.parse(localStorage.getItem(LS_DOCS) ?? "{}"); } catch { return {}; } }
function saveDocs(m: DocMap) { localStorage.setItem(LS_DOCS, JSON.stringify(m)); }

// ── Helpers ─────────────────────────────────────────────────────────────────
function fmtMoney(v: number | null) {
  if (v == null) return "–";
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}
function fmtDate(d: string | null) {
  if (!d) return "–";
  try { return new Date(d + "T12:00:00").toLocaleDateString("pt-BR"); }
  catch { return d; }
}
function isVencido(d: string | null) {
  if (!d) return false;
  return new Date(d + "T12:00:00") < new Date();
}
function norm(s: string) {
  return s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
}
// data_orcamento (YYYY-MM-DD) + 12 meses = próximo reajuste
function proxReajusteDate(dataOrcamento: string | null): Date | null {
  if (!dataOrcamento) return null;
  const d = new Date(dataOrcamento + "T12:00:00");
  if (isNaN(d.getTime())) return null;
  return new Date(d.getFullYear(), d.getMonth() + 12, 1);
}
function fmtProxReajuste(dataOrcamento: string | null): string {
  const d = proxReajusteDate(dataOrcamento);
  if (!d) return "–";
  return d.toLocaleDateString("pt-BR", { month: "2-digit", year: "numeric" });
}
function diasParaReajuste(dataOrcamento: string | null): number | null {
  const d = proxReajusteDate(dataOrcamento);
  if (!d) return null;
  return Math.round((d.getTime() - Date.now()) / 86400000);
}

const DOC_TIPOS: { id: DocAnexo["tipo"]; label: string; icon: string }[] = [
  { id: "contrato",     label: "Termo de Contrato",   icon: "📄" },
  { id: "tr",           label: "Termo de Referência", icon: "📋" },
  { id: "aditivo",      label: "Termo Aditivo",       icon: "📝" },
  { id: "apostilamento",label: "Apostilamento",       icon: "🔖" },
];

// ── Painel do contrato selecionado ───────────────────────────────────────────
function ContratoAptPanel({
  contrato, onBack,
}: {
  contrato: Contrato;
  onBack: () => void;
}) {
  const [docTab, setDocTab] = useState<DocAnexo["tipo"]>("apostilamento");
  const [docs, setDocs] = useState<DocMap>(() => loadDocs());

  // ── Data base do orçamento (editável inline) ─────────────────────────────
  const toMmYyyy = (d: string | null) => {
    if (!d) return "";
    const [yyyy, mm] = d.split("-");
    return mm && yyyy ? `${mm}/${yyyy}` : "";
  };
  const [dataOrcInput, setDataOrcInput] = useState(() => toMmYyyy(contrato.data_orcamento));
  const [savedDataOrc, setSavedDataOrc] = useState(contrato.data_orcamento);
  const [savingDataOrc, setSavingDataOrc] = useState(false);
  const [dataOrcMsg, setDataOrcMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function salvarDataOrcamento() {
    const v = dataOrcInput.trim();
    if (!/^\d{2}\/\d{4}$/.test(v)) {
      setDataOrcMsg({ ok: false, text: "Formato inválido. Use MM/AAAA." });
      return;
    }
    const [mm, yyyy] = v.split("/");
    const dbDate = `${yyyy}-${mm}-01`;
    setSavingDataOrc(true);
    setDataOrcMsg(null);
    const { error } = await supabase.rpc("set_contrato_data_orcamento", {
      p_id: contrato.id,
      p_data_orcamento: dbDate,
    });
    setSavingDataOrc(false);
    if (error) {
      setDataOrcMsg({ ok: false, text: `Erro: ${error.message}` });
    } else {
      setSavedDataOrc(dbDate);
      setDataOrcMsg({ ok: true, text: "Salvo! Próximo reajuste atualizado." });
      setTimeout(() => setDataOrcMsg(null), 3000);
    }
  }

  const anexos = docs[contrato.numero_contrato] ?? [];

  function registrarAnexo(tipo: DocAnexo["tipo"], nome: string, url?: string | null) {
    const updated: DocMap = {
      ...docs,
      [contrato.numero_contrato]: [
        ...anexos.filter(d => d.tipo !== tipo),
        { nome, tipo, dataAnexo: new Date().toISOString(), url },
      ],
    };
    setDocs(updated);
    saveDocs(updated);
  }

  function removerAnexo(tipo: DocAnexo["tipo"]) {
    const updated: DocMap = {
      ...docs,
      [contrato.numero_contrato]: anexos.filter(d => d.tipo !== tipo),
    };
    setDocs(updated);
    saveDocs(updated);
  }

  return (
    <div className="space-y-4">
      {/* Breadcrumb / voltar */}
      <div className="flex items-center gap-2 text-sm text-slate-500">
        <button onClick={onBack} className="hover:text-sky-600 transition-colors">
          ← Termos de Apostilamento e Aditivo
        </button>
        <span>/</span>
        <span className="font-semibold text-slate-800 font-mono">{contrato.numero_contrato}</span>
      </div>

      {/* Card do contrato */}
      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm space-y-4">
        {/* Header */}
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <div className="font-mono text-base font-bold text-slate-800">{contrato.numero_contrato}</div>
            <div className="text-xs text-slate-500 mt-0.5">{contrato.fornecedor || "–"}</div>
            {contrato.cnpj && <div className="text-[11px] text-slate-400 font-mono mt-0.5">{contrato.cnpj}</div>}
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${
              isVencido(contrato.data_final) ? "bg-red-100 text-red-700" : "bg-emerald-100 text-emerald-700"
            }`}>
              {isVencido(contrato.data_final) ? "Vencido" : (contrato.status || "Ativo")}
            </span>
          </div>
        </div>

        {/* Detalhes */}
        <div className="grid grid-cols-2 gap-x-6 gap-y-1.5 text-xs text-slate-600">
          <div><span className="text-slate-400">Objeto:</span> {contrato.descricao || "–"}</div>
          <div><span className="text-slate-400">Tipo:</span> {contrato.tipo_objeto || contrato.tipo || "–"}</div>
          <div><span className="text-slate-400">Início:</span> {fmtDate(contrato.data_inicio)}</div>
          <div><span className="text-slate-400">Término:</span> {fmtDate(contrato.data_final)}</div>
          <div><span className="text-slate-400">Valor contratual:</span> <strong>{fmtMoney(contrato.vl_contratual)}</strong></div>
          <div>
            <span className="text-slate-400">Saldo a empenhar:</span>{" "}
            <strong className={contrato.vl_a_empenhar != null && contrato.vl_a_empenhar > 0 ? "text-green-700" : "text-red-600"}>
              {fmtMoney(contrato.vl_a_empenhar)}
            </strong>
          </div>
          <div><span className="text-slate-400">NUP:</span> {contrato.pag_nup || "–"}</div>
          {contrato.fiscal && <div><span className="text-slate-400">Fiscal:</span> {contrato.fiscal}</div>}
          {/* Próx. Reajuste — exibe se já salvo */}
          {savedDataOrc && (
            <div>
              <span className="text-slate-400">Próx. Reajuste:</span>{" "}
              {(() => {
                const dias = diasParaReajuste(savedDataOrc);
                const label = fmtProxReajuste(savedDataOrc);
                if (dias === null) return label;
                if (dias < 0) return <span className="text-red-600 font-semibold">{label} (atrasado {Math.abs(dias)}d)</span>;
                if (dias <= 60) return <span className="text-orange-600 font-semibold">{label} ({dias}d)</span>;
                return <span>{label} ({dias}d)</span>;
              })()}
            </div>
          )}
        </div>

        {/* ── Data base do orçamento ── */}
        <div className="border-t pt-3 space-y-1.5">
          <div className="text-xs font-semibold text-slate-700">📅 Data base do orçamento (para reajuste)</div>
          <div className="flex items-center gap-2 flex-wrap">
            <input
              type="text"
              placeholder="MM/AAAA"
              value={dataOrcInput}
              onChange={e => setDataOrcInput(e.target.value)}
              maxLength={7}
              className="rounded-lg border px-2 py-1.5 text-xs w-28 outline-none focus:ring-2 focus:ring-sky-200 font-mono"
            />
            <button
              onClick={salvarDataOrcamento}
              disabled={savingDataOrc}
              className="rounded-lg bg-sky-600 hover:bg-sky-500 disabled:opacity-40 text-white px-3 py-1.5 text-xs font-medium transition-colors"
            >
              {savingDataOrc ? "Salvando…" : "Salvar"}
            </button>
            {dataOrcMsg && (
              <span className={`text-xs font-medium ${dataOrcMsg.ok ? "text-emerald-600" : "text-red-500"}`}>
                {dataOrcMsg.ok ? "✓" : "✕"} {dataOrcMsg.text}
              </span>
            )}
          </div>
          <p className="text-[10px] text-slate-400">Próximo reajuste = data base + 12 meses. Aparecerá na lista automaticamente.</p>
        </div>

        {/* Abas de documentos */}
        <div className="border-t pt-4 space-y-3">
          <div className="text-xs font-semibold text-slate-700">Documentos do Contrato</div>
          <div className="flex gap-1 flex-wrap">
            {DOC_TIPOS.map(({ id, label, icon }) => {
              const temAnexo = anexos.some(a => a.tipo === id);
              return (
                <button key={id} onClick={() => setDocTab(id)}
                  className={`flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-[11px] font-medium border transition-colors ${
                    docTab === id
                      ? "bg-sky-600 text-white border-sky-600"
                      : "bg-white text-slate-600 border-slate-200 hover:bg-slate-50"
                  }`}>
                  {icon} {label}
                  {temAnexo && <span className="ml-0.5 w-1.5 h-1.5 rounded-full bg-emerald-400 inline-block" />}
                </button>
              );
            })}
          </div>

          {/* Conteúdo da aba */}
          {docTab === "apostilamento" ? (
            <div className="space-y-2">
              {anexos.filter(a => a.tipo === "apostilamento").map(a => (
                <div key={a.tipo} className="flex items-center justify-between rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs">
                  <span className="text-emerald-800 font-medium">🔖 {a.nome}</span>
                  <div className="flex items-center gap-2">
                    {a.url && (
                      <a href={a.url} target="_blank" rel="noopener noreferrer"
                        className="text-sky-600 hover:text-sky-800 font-semibold underline">
                        ⬇ Baixar
                      </a>
                    )}
                    <span className="text-emerald-600">{new Date(a.dataAnexo).toLocaleDateString("pt-BR")}</span>
                    <button onClick={() => removerAnexo("apostilamento")} className="text-red-400 hover:text-red-600 text-xs">✕</button>
                  </div>
                </div>
              ))}
              <div className="flex gap-2 flex-wrap">
                <button
                  onClick={() => window.open(`/apt?tipo=contrato&id=${contrato.id}`, "_blank")}
                  className="flex items-center gap-2 rounded-xl bg-amber-500 hover:bg-amber-600 text-white px-4 py-2.5 text-sm font-semibold transition-colors"
                >
                  🔖 Gerar Termo de Apostilamento
                </button>
                <button
                  onClick={() => window.open(`/apt?tipo=aditivo&id=${contrato.id}`, "_blank")}
                  className="flex items-center gap-2 rounded-xl bg-sky-600 hover:bg-sky-500 text-white px-4 py-2.5 text-sm font-semibold transition-colors"
                >
                  📝 Gerar Termo Aditivo
                </button>
              </div>
            </div>
          ) : (
            <AnexoUpload
              tipo={docTab}
              anexo={anexos.find(a => a.tipo === docTab)}
              numeroContrato={contrato.numero_contrato}
              onAnexar={registrarAnexo}
              onRemover={removerAnexo}
            />
          )}
        </div>
      </div>

    </div>
  );
}

// ── Upload de anexo com Supabase Storage ────────────────────────────────────
const BUCKET = "contratos-docs";

function AnexoUpload({
  tipo, anexo, numeroContrato, onAnexar, onRemover,
}: {
  tipo: DocAnexo["tipo"];
  anexo: DocAnexo | undefined;
  numeroContrato: string;
  onAnexar: (tipo: DocAnexo["tipo"], nome: string, url?: string | null) => void;
  onRemover: (tipo: DocAnexo["tipo"]) => void;
}) {
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const info = DOC_TIPOS.find(d => d.id === tipo)!;

  async function handleFile(file: File) {
    setUploading(true);
    setUploadError(null);
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
    const path = `${numeroContrato}/${tipo}/${safeName}`;
    const { error } = await supabase.storage
      .from(BUCKET)
      .upload(path, file, { upsert: true });

    if (error) {
      setUploadError(`Erro no upload: ${error.message}`);
      onAnexar(tipo, file.name, null);
    } else {
      const { data } = supabase.storage.from(BUCKET).getPublicUrl(path);
      onAnexar(tipo, file.name, data.publicUrl);
    }
    setUploading(false);
  }

  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs space-y-2">
      <div className="font-semibold text-slate-700">{info.icon} {info.label}</div>
      {anexo ? (
        <div className="flex items-center justify-between rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2">
          <span className="text-emerald-800 font-medium truncate max-w-[55%]">{anexo.nome}</span>
          <div className="flex items-center gap-2 shrink-0">
            {anexo.url ? (
              <a href={anexo.url} target="_blank" rel="noopener noreferrer"
                className="text-sky-600 hover:text-sky-800 font-semibold underline">
                ⬇ Baixar
              </a>
            ) : (
              <span className="text-amber-600" title="Arquivo registrado sem upload — substitua para habilitar download">
                ⚠ sem link
              </span>
            )}
            <span className="text-emerald-600">{new Date(anexo.dataAnexo).toLocaleDateString("pt-BR")}</span>
            <button onClick={() => onRemover(tipo)} className="text-red-400 hover:text-red-600">✕ Remover</button>
          </div>
        </div>
      ) : (
        <p className="text-slate-500">Nenhum arquivo anexado ainda.</p>
      )}
      {uploadError && (
        <p className="text-red-500 text-[11px]">{uploadError}</p>
      )}
      <label className={`flex items-center gap-2 cursor-pointer rounded-lg border border-dashed border-slate-300 bg-white px-3 py-2 hover:bg-slate-50 transition-colors w-fit ${uploading ? "opacity-50 pointer-events-none" : ""}`}>
        <span>📎 {uploading ? "Enviando…" : anexo ? "Substituir arquivo" : "Selecionar PDF"}</span>
        <input
          type="file" accept=".pdf,.doc,.docx" className="hidden"
          disabled={uploading}
          onChange={e => {
            const file = e.target.files?.[0];
            if (file) handleFile(file);
            e.target.value = "";
          }}
        />
      </label>
    </div>
  );
}

// ── Tela principal — lista de contratos ────────────────────────────────────
export default function ApostilamentoContratosView() {
  const [contratos, setContratos] = useState<Contrato[]>([]);
  const [loading, setLoading]     = useState(true);
  const [selected, setSelected]   = useState<Contrato | null>(null);

  // Filtros (idênticos ao GerenciamentoContratos)
  const [filtroTexto,  setFiltroTexto]  = useState("");
  const [filtroAno,    setFiltroAno]    = useState("todos");
  const [filtroUgr,    setFiltroUgr]    = useState("todos");
  const [filtroStatus, setFiltroStatus] = useState("todos");
  const [filtroFiscal, setFiltroFiscal] = useState("todos");
  const [sortBy, setSortBy] = useState<"none"|"saldo_asc"|"saldo_desc"|"liquidar_asc"|"liquidar_desc"|"vencimento_asc"|"reajuste_asc">("none");
  const [filtroReajuste, setFiltroReajuste] = useState<"todos"|"prox_30"|"prox_60"|"prox_90"|"atrasados">("todos");

  function fetchContratos() {
    setLoading(true);
    supabase
      .from("contratos_scon")
      .select("id,numero_contrato,uge,ugr,status,tipo,vl_contratual,vl_a_empenhar,vl_liquidado,saldo,data_inicio,data_final,data_orcamento,fornecedor,tipo_objeto,pag_nup,descricao,cnpj,fiscal,fonte")
      .order("numero_contrato", { ascending: false })
      .then(({ data, error }) => {
        if (!error) setContratos((data as Contrato[]) ?? []);
        setLoading(false);
      });
  }

  useEffect(() => {
    fetchContratos();
    // Recarrega automaticamente quando o usuário retorna à aba (ex: fechou o popup do Termo)
    const onFocus = () => fetchContratos();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Opções únicas para selects
  const anos    = useMemo(() => [...new Set(contratos.map(c => c.data_inicio?.slice(0,4)).filter(Boolean))].sort().reverse() as string[], [contratos]);
  const ugrs    = useMemo(() => [...new Set(contratos.map(c => c.ugr).filter(Boolean))].sort() as string[], [contratos]);
  const fiscais = useMemo(() => [...new Set(contratos.map(c => c.fiscal).filter(Boolean))].sort() as string[], [contratos]);
  const statuses= useMemo(() => [...new Set(contratos.map(c => c.status).filter(Boolean))].sort() as string[], [contratos]);

  const filtrados = useMemo(() => {
    const q = filtroTexto.trim().toLowerCase();
    return contratos.filter(c => {
      if (filtroAno !== "todos" && !c.data_inicio?.startsWith(filtroAno)) return false;
      if (filtroUgr !== "todos" && c.ugr !== filtroUgr) return false;
      if (filtroFiscal !== "todos" && c.fiscal !== filtroFiscal) return false;
      if (filtroStatus === "pendentes_encerramento") {
        if (!isVencido(c.data_final)) return false;
      } else if (filtroStatus !== "todos") {
        if ((c.status ?? "").toLowerCase() !== filtroStatus.toLowerCase()) return false;
      }
      if (filtroReajuste !== "todos") {
        const dias = diasParaReajuste(c.data_orcamento);
        if (filtroReajuste === "atrasados") { if (dias === null || dias >= 0) return false; }
        else if (filtroReajuste === "prox_30") { if (dias === null || dias < 0 || dias > 30) return false; }
        else if (filtroReajuste === "prox_60") { if (dias === null || dias < 0 || dias > 60) return false; }
        else if (filtroReajuste === "prox_90") { if (dias === null || dias < 0 || dias > 90) return false; }
      }
      if (q) {
        const t = norm(q);
        return (
          norm(c.numero_contrato).includes(t) ||
          norm(c.fornecedor ?? "").includes(t) ||
          norm(c.descricao  ?? "").includes(t) ||
          norm(c.cnpj       ?? "").includes(t) ||
          norm(c.fiscal     ?? "").includes(t)
        );
      }
      return true;
    });
  }, [contratos, filtroTexto, filtroAno, filtroUgr, filtroStatus, filtroFiscal, filtroReajuste]);

  const sorted = useMemo(() => {
    const arr = [...filtrados];
    if      (sortBy === "saldo_asc")       arr.sort((a,b) => (a.vl_a_empenhar??0)-(b.vl_a_empenhar??0));
    else if (sortBy === "saldo_desc")      arr.sort((a,b) => (b.vl_a_empenhar??0)-(a.vl_a_empenhar??0));
    else if (sortBy === "liquidar_asc")    arr.sort((a,b) => (a.saldo??0)-(b.saldo??0));
    else if (sortBy === "liquidar_desc")   arr.sort((a,b) => (b.saldo??0)-(a.saldo??0));
    else if (sortBy === "vencimento_asc")  arr.sort((a,b) => {
      const da = a.data_final ? new Date(a.data_final).getTime() : Infinity;
      const db = b.data_final ? new Date(b.data_final).getTime() : Infinity;
      return da - db;
    });
    else if (sortBy === "reajuste_asc") arr.sort((a,b) => {
      const da = proxReajusteDate(a.data_orcamento)?.getTime() ?? Infinity;
      const db = proxReajusteDate(b.data_orcamento)?.getTime() ?? Infinity;
      return da - db;
    });
    return arr;
  }, [filtrados, sortBy]);

  const temFiltro = filtroTexto || filtroAno !== "todos" || filtroUgr !== "todos" || filtroStatus !== "todos" || filtroFiscal !== "todos" || filtroReajuste !== "todos";

  // Docs salvos (para badges na lista)
  const docs = loadDocs();

  if (selected) {
    return (
      <div className="p-4">
        <ContratoAptPanel contrato={selected} onBack={() => { setSelected(null); fetchContratos(); }} />
      </div>
    );
  }

  return (
    <div className="space-y-4 p-4">
      {/* Cabeçalho + filtros */}
      <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-base font-semibold text-slate-800">🔖 Termos de Apostilamento e Aditivo — Contratos</div>
            <div className="text-xs text-slate-500 mt-0.5">
              {loading ? "Carregando…" : `${filtrados.length} de ${contratos.length} contrato(s)`}
            </div>
          </div>
          <button
            onClick={fetchContratos}
            disabled={loading}
            className="flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-500 hover:bg-slate-50 transition-colors disabled:opacity-40"
            title="Recarregar contratos do banco de dados"
          >
            🔄 {loading ? "Carregando…" : "Atualizar"}
          </button>
        </div>

        {/* Filtros — idênticos ao GerenciamentoContratos */}
        <div className="flex flex-wrap items-center gap-2">
          <select value={filtroAno} onChange={e => setFiltroAno(e.target.value)}
            className="rounded-xl border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-sky-200">
            <option value="todos">Todos os anos</option>
            {anos.map(a => <option key={a} value={a}>{a}</option>)}
          </select>
          <select value={filtroUgr} onChange={e => setFiltroUgr(e.target.value)}
            className="rounded-xl border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-sky-200">
            <option value="todos">Todas as UGR</option>
            {ugrs.map(u => <option key={u} value={u}>{u}</option>)}
          </select>
          <select value={filtroStatus} onChange={e => setFiltroStatus(e.target.value)}
            className="rounded-xl border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-sky-200">
            <option value="todos">Todos os status</option>
            <option value="pendentes_encerramento">Pendentes de encerramento</option>
            {statuses.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
          {fiscais.length > 0 && (
            <select value={filtroFiscal} onChange={e => setFiltroFiscal(e.target.value)}
              className="rounded-xl border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-sky-200">
              <option value="todos">Todos os fiscais</option>
              {fiscais.map(f => <option key={f} value={f}>{f}</option>)}
            </select>
          )}
          <select value={filtroReajuste} onChange={e => setFiltroReajuste(e.target.value as typeof filtroReajuste)}
            className="rounded-xl border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-sky-200">
            <option value="todos">Todos os reajustes</option>
            <option value="atrasados">Reajuste atrasado</option>
            <option value="prox_30">Próximos 30 dias</option>
            <option value="prox_60">Próximos 60 dias</option>
            <option value="prox_90">Próximos 90 dias</option>
          </select>
          <input
            type="text" value={filtroTexto} onChange={e => setFiltroTexto(e.target.value)}
            placeholder="Buscar nº, objeto, fornecedor, CNPJ…"
            className="rounded-xl border px-3 py-2 text-sm w-72 outline-none focus:ring-2 focus:ring-sky-200"
          />
        </div>
        {/* Ordenação */}
        <div className="flex gap-1 flex-wrap">
          {([
            { key: "none",           label: "Padrão" },
            { key: "saldo_asc",      label: "A empenhar ↑" },
            { key: "saldo_desc",     label: "A empenhar ↓" },
            { key: "liquidar_asc",   label: "A liquidar ↑" },
            { key: "liquidar_desc",  label: "A liquidar ↓" },
            { key: "vencimento_asc", label: "Vencimento" },
            { key: "reajuste_asc",  label: "Reajuste ↑" },
          ] as const).map(({ key, label }) => (
            <button key={key} onClick={() => setSortBy(key)}
              className={`rounded-lg border px-2 py-1 text-xs transition-colors ${
                sortBy === key ? "bg-sky-100 border-sky-300 text-sky-800" : "border-slate-200 text-slate-500 hover:bg-slate-50"
              }`}>
              {label}
            </button>
          ))}
          {temFiltro && (
            <button onClick={() => { setFiltroTexto(""); setFiltroAno("todos"); setFiltroUgr("todos"); setFiltroStatus("todos"); setFiltroFiscal("todos"); setFiltroReajuste("todos"); }}
              className="rounded-lg border border-red-200 px-2 py-1 text-xs text-red-500 hover:bg-red-50 transition-colors">
              ✕ Limpar filtros
            </button>
          )}
        </div>
      </div>

      {/* Lista */}
      {loading ? (
        <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-400">
          Carregando contratos…
        </div>
      ) : filtrados.length === 0 ? (
        <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-400">
          {contratos.length === 0
            ? "Nenhum contrato cadastrado. Importe planilha SCON na aba Contratos."
            : "Nenhum contrato para os filtros aplicados."}
        </div>
      ) : (
        <div className="rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="space-y-2 p-3 max-h-[640px] overflow-y-auto">
            {sorted.map((c) => {
              const vencido = isVencido(c.data_final);
              const temDocs = (docs[c.numero_contrato] ?? []).length;
              const dias    = diasParaReajuste(c.data_orcamento);
              return (
                <button
                  key={c.id}
                  onClick={() => setSelected(c)}
                  className={`w-full rounded-xl border p-3 text-left hover:bg-sky-50 transition-colors ${vencido ? "opacity-60 border-slate-200" : "border-slate-200"}`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="text-sm font-semibold text-slate-900">{c.numero_contrato}</span>
                        {vencido && (
                          <span className="inline-block rounded-full border border-orange-300 bg-orange-50 px-2 py-0.5 text-[10px] font-semibold text-orange-700">
                            pendente de encerramento
                          </span>
                        )}
                        {dias !== null && (
                          dias < 0
                            ? <span className="rounded-full bg-red-100 text-red-700 px-2 py-0.5 text-[10px] font-semibold">⚠ Reajuste {fmtProxReajuste(c.data_orcamento)}</span>
                            : dias <= 30
                            ? <span className="rounded-full bg-orange-100 text-orange-700 px-2 py-0.5 text-[10px] font-semibold">📅 Reajuste {fmtProxReajuste(c.data_orcamento)} ({dias}d)</span>
                            : dias <= 60
                            ? <span className="rounded-full bg-amber-100 text-amber-700 px-2 py-0.5 text-[10px] font-semibold">📅 Reajuste {fmtProxReajuste(c.data_orcamento)} ({dias}d)</span>
                            : <span className="text-slate-400 text-[11px]">📅 {fmtProxReajuste(c.data_orcamento)}</span>
                        )}
                        {temDocs > 0 && (
                          <span className="rounded-full bg-emerald-100 text-emerald-700 px-2 py-0.5 text-[10px] font-semibold">
                            {temDocs} doc{temDocs > 1 ? "s" : ""}
                          </span>
                        )}
                      </div>
                      <div className="mt-0.5 text-xs text-slate-600 line-clamp-2">
                        {c.descricao ?? c.fornecedor ?? "–"}
                      </div>
                      <div className="mt-1 flex items-center gap-1.5 flex-wrap text-xs text-slate-400">
                        <span>{c.ugr ?? c.uge ?? "GAP-MN"}</span>
                        <span>•</span>
                        <span>{fmtDate(c.data_inicio)} →</span>
                        <span className={`font-semibold px-1.5 py-0.5 rounded-md ${
                          vencido ? "bg-orange-100 text-orange-700"
                          : c.data_final ? "bg-green-50 text-green-700"
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
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
          <div className="px-4 py-2 text-xs text-slate-400 border-t border-slate-100">
            {filtrados.length} contrato(s) exibido(s)
          </div>
        </div>
      )}
    </div>
  );
}
