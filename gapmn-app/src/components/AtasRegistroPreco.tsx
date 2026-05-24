import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import * as pdfjsLib from "pdfjs-dist";
import { supabase } from "../lib/supabase";

// Configura worker do PDF.js (Vite resolve via import.meta.url)
pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/build/pdf.worker.min.mjs",
  import.meta.url,
).toString();

// ── interfaces ─────────────────────────────────────────────────────────────
interface Ata {
  id: number;
  numero_ata: string;
  situacao: string | null;
  tipo_uasg: string | null;
  vigencia_inicial: string | null;
  vigencia_final: string | null;
  pdf_url: string | null;
  registrado_em: string | null;
}

interface ItemAta {
  id: number;
  ata_numero: string;
  numero_ata: string | null;
  descricao: string | null;
  cnpj_fornecedor: string | null;
  fornecedor_nome: string | null;
  quantidade_registrada: number | null;
  valor_unitario: number | null;
  valor_total: number | null;
  qtd_limite_adesao: number | null;
  aceita_adesao: string | null;
  numero_compra: string | null;
}

interface CompraTR {
  numero_compra: string;
  pdf_url: string | null;
  data_orcamento: string | null; // "YYYY-MM-DD"
  indice_adotado: string | null;
}

interface IpcaResult {
  fator: number;
  percentual: number;
  periodoInicio: string; // "MM/YYYY"
  periodoFim: string;
}

// ── helpers ────────────────────────────────────────────────────────────────
function fmtDate(s: string | null) {
  if (!s) return "–";
  try { return new Date(s + "T12:00:00").toLocaleDateString("pt-BR"); } catch { return s; }
}
function fmtBRL(v: number | null) {
  if (v == null) return "–";
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(v);
}
function fmtQtd(v: number | null) {
  if (v == null) return "–";
  return new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 2 }).format(v);
}
function sitBadge(sit: string | null) {
  const base = "inline-block rounded-full px-2 py-0.5 text-xs font-semibold";
  const s = (sit ?? "").toLowerCase();
  if (/ativa|vigente/i.test(s))             return `${base} bg-green-100 text-green-800`;
  if (/cancelad|revogad/i.test(s))          return `${base} bg-red-100 text-red-700`;
  if (/encerrad|expirad|suspensa/i.test(s)) return `${base} bg-slate-100 text-slate-600`;
  return `${base} bg-sky-100 text-sky-700`;
}
function isVencida(vigFim: string | null) {
  if (!vigFim) return false;
  return new Date(vigFim + "T23:59:59") < new Date();
}

// Próximo reajuste: mês da data_orcamento + 12 meses - 1 mês = + 11 meses
// Ex: 04/11/2024 → 10/2025; 11/2025 → 10/2026
function proxReajusteDisplay(dataOrcamento: string): string {
  const d = new Date(dataOrcamento + "T12:00:00");
  d.setMonth(d.getMonth() + 11);
  return `${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`;
}

// Extrai texto de PDF via PDF.js
async function extractPdfText(file: File): Promise<string> {
  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  let text = "";
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    text +=
      (content.items as { str: string }[]).map((it) => it.str).join(" ") + "\n";
  }
  return text;
}

// Extrai data_orcamento e indice_adotado da seção "Reajuste" do TR
function parseReajuste(text: string): {
  dataOrcamento: string | null;
  indiceAdotado: string | null;
} {
  const idx = text.search(/reajuste/i);
  if (idx < 0) return { dataOrcamento: null, indiceAdotado: null };
  const section = text.slice(idx, idx + 3000);

  // Procura padrão "em DD/MM/YYYY" (data do orçamento estimado)
  const dateMatch =
    section.match(/\bem\s+(\d{2}\/\d{2}\/\d{4})/i) ||
    section.match(/(\d{2}\/\d{2}\/\d{4})/);
  const rawDate = dateMatch ? dateMatch[1] : null;
  // Converte DD/MM/YYYY → YYYY-MM-DD para storage
  let dataOrcamento: string | null = null;
  if (rawDate) {
    const parts = rawDate.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    if (parts) dataOrcamento = `${parts[3]}-${parts[2]}-${parts[1]}`;
  }

  const idxMatch = section.match(
    /\b(IPCA[-\s]?[A-Z]*|IGP[-.\s]?M|INPC|IPC[-.\s]?A|INCC)\b/i,
  );
  const indiceAdotado = idxMatch
    ? idxMatch[1].toUpperCase().replace(/\s/g, "-")
    : null;

  return { dataOrcamento, indiceAdotado };
}

// Busca IPCA acumulado na API do BCB (série 433)
async function fetchIpca(dataOrcamento: string): Promise<IpcaResult | null> {
  try {
    const d = new Date(dataOrcamento + "T12:00:00");
    const fmt = (dt: Date) =>
      `01/${String(dt.getMonth() + 1).padStart(2, "0")}/${dt.getFullYear()}`;
    const start = fmt(d);
    const endD = new Date(d);
    endD.setMonth(endD.getMonth() + 11);
    const end = fmt(endD);
    const url = `https://api.bcb.gov.br/dados/serie/bcdata.sgs.433/dados?formato=json&dataInicial=${start}&dataFinal=${end}`;
    const r = await fetch(url);
    if (!r.ok) return null;
    const data: { data: string; valor: string }[] = await r.json();
    if (!data.length) return null;
    let fator = 1;
    data.forEach((item) => {
      fator *= 1 + parseFloat(item.valor.replace(",", ".")) / 100;
    });
    return {
      fator,
      percentual: (fator - 1) * 100,
      periodoInicio: start.slice(3),
      periodoFim: end.slice(3),
    };
  } catch {
    return null;
  }
}

// ── componente principal ────────────────────────────────────────────────────
interface Props { canSync: boolean }

export default function AtasRegistroPreco({ canSync }: Props) {
  const [atas, setAtas]         = useState<Ata[]>([]);
  const [loading, setLoading]   = useState(true);
  const [busca, setBusca]       = useState("");
  const [filtro, setFiltro]     = useState<"todas" | "ativas" | "encerradas">("ativas");
  const [filtroCompra, setFiltroCompra] = useState<string>("");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [itensMap, setItensMap] = useState<Map<string, ItemAta[]>>(new Map());
  const [loadingItens, setLoadingItens] = useState<string | null>(null);
  const [showInstrucoes, setShowInstrucoes] = useState(false);
  const [copiado, setCopiado]   = useState(false);
  const [compraMap, setCompraMap] = useState<Map<string, string>>(new Map());
  const [comprasTrMap, setComprasTrMap] = useState<Map<string, CompraTR>>(new Map());
  const [descMap, setDescMap]   = useState<Map<string, string>>(new Map()); // ata_numero → descs concat
  const [ipcaMap, setIpcaMap]   = useState<Map<string, IpcaResult | null>>(new Map());

  // upload de Termo de Referência
  const fileInputRef                          = useRef<HTMLInputElement>(null);
  const [uploadTargetAta, setUploadTargetAta] = useState<string | null>(null);
  const [uploading, setUploading]             = useState(false);
  const [uploadStatus, setUploadStatus]       = useState<string | null>(null);

  const loadCompraMap = useCallback(async () => {
    const { data } = await supabase
      .from("itens_ata_gap_mn")
      .select("ata_numero, numero_compra")
      .not("numero_compra", "is", null);
    if (data) {
      const m = new Map<string, string>();
      (data as { ata_numero: string; numero_compra: string }[]).forEach((r) => {
        if (!m.has(r.ata_numero)) m.set(r.ata_numero, r.numero_compra);
      });
      setCompraMap(m);
    }
  }, []);

  const loadComprasTrMap = useCallback(async () => {
    const { data } = await supabase.from("compras_tr_gap_mn").select("*");
    if (data) {
      const m = new Map<string, CompraTR>();
      (data as CompraTR[]).forEach((r) => m.set(r.numero_compra, r));
      setComprasTrMap(m);
    }
  }, []);

  const loadDescMap = useCallback(async () => {
    const { data } = await supabase
      .from("itens_ata_gap_mn")
      .select("ata_numero, descricao")
      .not("descricao", "is", null);
    if (data) {
      const m = new Map<string, string>();
      (data as { ata_numero: string; descricao: string }[]).forEach((r) => {
        const prev = m.get(r.ata_numero) ?? "";
        m.set(r.ata_numero, prev + " " + r.descricao.toLowerCase());
      });
      setDescMap(m);
    }
  }, []);

  const loadAtas = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase
      .from("atas_gap_mn")
      .select("*")
      .order("vigencia_final", { ascending: false });
    if (data) setAtas(data as Ata[]);
    setLoading(false);
    loadCompraMap();
    loadComprasTrMap();
    loadDescMap();
  }, [loadCompraMap, loadComprasTrMap, loadDescMap]);

  useEffect(() => { loadAtas(); }, [loadAtas]);

  // Carrega IPCA quando uma ATA com TR e data_orcamento é expandida
  useEffect(() => {
    if (!expanded) return;
    const compra = compraMap.get(expanded);
    if (!compra) return;
    const tr = comprasTrMap.get(compra);
    if (!tr?.data_orcamento) return;
    if (ipcaMap.has(compra)) return; // já carregou
    setIpcaMap((prev) => new Map(prev).set(compra, null)); // marcador loading
    fetchIpca(tr.data_orcamento).then((result) => {
      setIpcaMap((prev) => new Map(prev).set(compra, result));
    });
  }, [expanded, compraMap, comprasTrMap, ipcaMap]);

  async function toggleAta(numeroAta: string) {
    if (expanded === numeroAta) { setExpanded(null); return; }
    setExpanded(numeroAta);
    if (!itensMap.has(numeroAta)) {
      setLoadingItens(numeroAta);
      const { data } = await supabase
        .from("itens_ata_gap_mn")
        .select("*")
        .eq("ata_numero", numeroAta)
        .order("numero_ata");
      setItensMap((prev) => new Map(prev).set(numeroAta, (data as ItemAta[]) ?? []));
      setLoadingItens(null);
    }
  }

  async function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || !uploadTargetAta) return;

    // Determina numero_compra para este upload
    const compra = compraMap.get(uploadTargetAta) ?? null;

    setUploading(true);
    setUploadStatus("Enviando arquivo…");
    try {
      const ext  = file.name.split(".").pop() ?? "pdf";
      const key  = (compra ?? uploadTargetAta).replace(/\//g, "-");
      const path = `${key}-${Date.now()}.${ext}`;

      const { error: upErr } = await supabase.storage
        .from("atas-docs").upload(path, file, { upsert: true });
      if (upErr) throw upErr;

      const { data: { publicUrl } } = supabase.storage
        .from("atas-docs").getPublicUrl(path);

      // Extrai dados do PDF (somente se for PDF)
      let dataOrcamento: string | null = null;
      let indiceAdotado: string | null = null;
      if (ext.toLowerCase() === "pdf") {
        setUploadStatus("Lendo PDF…");
        try {
          const pdfText = await extractPdfText(file);
          const parsed  = parseReajuste(pdfText);
          dataOrcamento = parsed.dataOrcamento;
          indiceAdotado = parsed.indiceAdotado;
        } catch {
          // falha silenciosa — dados podem ser preenchidos manualmente depois
        }
      }

      // Salva na tabela compras_tr_gap_mn (escopo: compra, não ATA específica)
      if (compra) {
        setUploadStatus("Salvando no banco…");
        const { error: trErr } = await supabase
          .from("compras_tr_gap_mn")
          .upsert({
            numero_compra: compra,
            pdf_url: publicUrl,
            data_orcamento: dataOrcamento,
            indice_adotado: indiceAdotado,
          }, { onConflict: "numero_compra" });
        if (trErr) throw trErr;
        setComprasTrMap((prev) =>
          new Map(prev).set(compra, {
            numero_compra: compra,
            pdf_url: publicUrl,
            data_orcamento: dataOrcamento,
            indice_adotado: indiceAdotado,
          })
        );
      } else {
        // Sem numero_compra: salva pdf_url no registro da ATA (fallback)
        await supabase
          .from("atas_gap_mn")
          .update({ pdf_url: publicUrl })
          .eq("numero_ata", uploadTargetAta);
        setAtas((prev) => prev.map((a) =>
          a.numero_ata === uploadTargetAta ? { ...a, pdf_url: publicUrl } : a
        ));
      }

      const infoMsg = dataOrcamento
        ? ` · Orçamento: ${fmtDate(dataOrcamento)}${indiceAdotado ? ` · Índice: ${indiceAdotado}` : ""}`
        : "";
      setUploadStatus(`✓ TR salvo${infoMsg}`);
      setTimeout(() => setUploadStatus(null), 4000);
    } catch (err: unknown) {
      setUploadStatus(null);
      alert("Erro ao enviar: " + (err instanceof Error ? err.message : String(err)));
    } finally {
      setUploading(false);
      setUploadTargetAta(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  const filtradas = useMemo(() => {
    let list = atas;
    if (filtro === "ativas")     list = list.filter((a) => !isVencida(a.vigencia_final) && !/cancelad/i.test(a.situacao ?? ""));
    if (filtro === "encerradas") list = list.filter((a) => isVencida(a.vigencia_final) || /cancelad|encerrad/i.test(a.situacao ?? ""));
    if (filtroCompra)            list = list.filter((a) => compraMap.get(a.numero_ata) === filtroCompra);
    if (!busca.trim()) return list;
    const q = busca.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
    return list.filter((a) => {
      const base = [a.numero_ata, a.situacao, compraMap.get(a.numero_ata) ?? ""]
        .join(" ").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
      if (base.includes(q)) return true;
      // busca em descrições dos itens
      const descs = descMap.get(a.numero_ata) ?? "";
      return descs.normalize("NFD").replace(/[̀-ͯ]/g, "").includes(q);
    });
  }, [atas, busca, filtro, filtroCompra, compraMap, descMap]);

  const ativas     = atas.filter((a) => !isVencida(a.vigencia_final) && !/cancelad/i.test(a.situacao ?? "")).length;
  const encerradas = atas.length - ativas;

  // Lista de nºs de compra únicos para o filtro
  const comprasOpcoes = useMemo(() => {
    const s = new Set<string>();
    compraMap.forEach((v) => s.add(v));
    return [...s].sort();
  }, [compraMap]);

  const bookmarklet = "javascript:(function(){var s=document.createElement('script');s.src='https://processoscae.vercel.app/arp-bot.js?v='+Date.now();document.body.appendChild(s);})();";

  async function copiarBookmarklet() {
    try {
      await navigator.clipboard.writeText(bookmarklet);
      setCopiado(true);
      setTimeout(() => setCopiado(false), 2500);
    } catch {
      prompt("Copie o código abaixo:", bookmarklet);
    }
  }

  return (
    <div className="space-y-4">
      {/* input oculto para upload */}
      <input
        ref={fileInputRef} type="file" accept=".pdf,.doc,.docx"
        className="hidden"
        onChange={handleFileUpload}
      />

      {/* Cabeçalho */}
      <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm space-y-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="text-base font-semibold text-slate-800">Atas de Registro de Preço — GAP-MN</div>
            <div className="text-xs text-slate-500 mt-0.5">
              {loading ? "Carregando…"
                : `${atas.length} ATA(s) · ${ativas} ativas · ${encerradas} encerradas/canceladas`}
            </div>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <button
              onClick={loadAtas} disabled={loading}
              title="Buscar dados atualizados do banco"
              className="flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-50 transition-colors"
            >
              <span className={loading ? "animate-spin inline-block" : ""}>↻</span>
              Atualizar
            </button>
            <input
              type="text" value={busca} onChange={(e) => setBusca(e.target.value)}
              placeholder="Buscar nº ATA ou descrição…"
              className="rounded-xl border border-slate-200 px-3 py-1.5 text-sm w-52 focus:outline-none focus:ring-2 focus:ring-sky-300"
            />
          </div>
        </div>

        {/* Filtros situação + filtro compra */}
        <div className="flex gap-2 flex-wrap items-center">
          <div className="flex gap-1 flex-wrap">
            {([
              { k: "ativas",     label: `Ativas (${ativas})` },
              { k: "todas",      label: `Todas (${atas.length})` },
              { k: "encerradas", label: `Encerradas/Canceladas (${encerradas})` },
            ] as const).map(({ k, label }) => (
              <button key={k} onClick={() => setFiltro(k)}
                className={`rounded-full px-3 py-1 text-xs font-medium border transition-colors ${
                  filtro === k ? "bg-sky-600 text-white border-sky-600" : "bg-white text-slate-600 border-slate-200 hover:bg-slate-50"
                }`}>
                {label}
              </button>
            ))}
          </div>
          {comprasOpcoes.length > 0 && (
            <select
              value={filtroCompra}
              onChange={(e) => setFiltroCompra(e.target.value)}
              className="rounded-xl border border-slate-200 px-2 py-1 text-xs text-slate-700 focus:outline-none focus:ring-2 focus:ring-sky-300 bg-white"
            >
              <option value="">Todas as compras</option>
              {comprasOpcoes.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          )}
        </div>

        {/* Status de upload */}
        {uploadStatus && (
          <div className="text-xs text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2">
            {uploadStatus}
          </div>
        )}

        {/* Bookmarklet */}
        {canSync && (
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800 space-y-2">
            <div className="flex items-center justify-between">
              <span className="font-semibold">📋 Sincronizar ATAs via robô</span>
              <button onClick={() => setShowInstrucoes((v) => !v)} className="text-amber-700 hover:text-amber-900 underline text-[11px]">
                {showInstrucoes ? "Ocultar" : "Ver instruções"}
              </button>
            </div>
            {showInstrucoes && (
              <ol className="list-decimal list-inside space-y-1 text-amber-900">
                <li>Abra <a href="https://contratos.sistema.gov.br/arp" target="_blank" rel="noopener noreferrer" className="text-sky-600 hover:underline font-medium">contratos.sistema.gov.br/arp ↗</a> e faça login</li>
                <li>Crie um favorito no navegador com o código abaixo como URL</li>
                <li>Na página do contratos.gov.br, clique o favorito</li>
                <li>O robô sincroniza metadados e itens de cada ATA</li>
              </ol>
            )}
            <div className="flex items-center gap-2 pt-1">
              <button onClick={copiarBookmarklet}
                className="flex items-center gap-1.5 rounded-lg bg-amber-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-amber-700">
                {copiado ? "✓ Copiado!" : "📋 Copiar URL do robô"}
              </button>
              <span className="text-[11px] text-amber-700">Cole como URL de um favorito do navegador</span>
            </div>
          </div>
        )}
      </div>

      {/* Tabela */}
      {loading ? (
        <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-400 shadow-sm">Carregando ATAs…</div>
      ) : filtradas.length === 0 ? (
        <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-sm">
          <div className="text-slate-400 text-sm">
            {atas.length === 0 ? "Nenhuma ATA registrada. Use o bookmarklet acima para sincronizar." : "Nenhuma ATA para o filtro aplicado."}
          </div>
        </div>
      ) : (
        <div className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="text-left text-xs font-semibold uppercase text-slate-500 bg-slate-50 border-b border-slate-200">
                  <th className="px-3 py-2 w-4"></th>
                  <th className="px-3 py-2 whitespace-nowrap">Nº ATA</th>
                  <th className="px-3 py-2 whitespace-nowrap">Nº Compra</th>
                  <th className="px-3 py-2 whitespace-nowrap">Situação</th>
                  <th className="px-3 py-2 whitespace-nowrap">Vigência Inicial</th>
                  <th className="px-3 py-2 whitespace-nowrap">Vigência Final</th>
                  <th className="px-3 py-2 whitespace-nowrap text-center">Termo de Referência</th>
                </tr>
              </thead>
              <tbody>
                {filtradas.map((a, i) => {
                  const isExp      = expanded === a.numero_ata;
                  const itens      = itensMap.get(a.numero_ata) ?? [];
                  const carregando = loadingItens === a.numero_ata;
                  const isUpload   = uploading && uploadTargetAta === a.numero_ata;
                  const compra     = compraMap.get(a.numero_ata);
                  const tr         = compra ? comprasTrMap.get(compra) : undefined;
                  const hasTR      = !!(tr?.pdf_url ?? a.pdf_url);
                  return (
                    <>
                      <tr
                        key={a.id}
                        onClick={() => toggleAta(a.numero_ata)}
                        className={`border-t border-slate-100 cursor-pointer transition-colors ${
                          i % 2 === 0 ? "bg-white" : "bg-slate-50/40"
                        } hover:bg-sky-50 ${isVencida(a.vigencia_final) ? "opacity-55" : ""}`}
                      >
                        <td className="px-2 py-2 text-slate-400 text-xs select-none">{isExp ? "▼" : "▶"}</td>
                        <td className="px-3 py-2 font-mono text-xs font-semibold whitespace-nowrap">{a.numero_ata}</td>
                        <td className="px-3 py-2 text-xs whitespace-nowrap font-mono text-slate-600">{compra || "–"}</td>
                        <td className="px-3 py-2 whitespace-nowrap">
                          <span className={sitBadge(a.situacao)}>{a.situacao || "–"}</span>
                        </td>
                        <td className="px-3 py-2 text-xs whitespace-nowrap">{fmtDate(a.vigencia_inicial)}</td>
                        <td className={`px-3 py-2 text-xs whitespace-nowrap ${isVencida(a.vigencia_final) ? "text-red-600 font-semibold" : ""}`}>
                          {fmtDate(a.vigencia_final)}
                        </td>
                        <td className="px-3 py-2 text-center" onClick={(e) => e.stopPropagation()}>
                          <div className="flex items-center justify-center gap-1">
                            {hasTR && (
                              <a
                                href={tr?.pdf_url ?? a.pdf_url ?? "#"}
                                target="_blank" rel="noopener noreferrer"
                                className="inline-flex items-center gap-1 rounded-lg bg-sky-50 border border-sky-200 px-2 py-1 text-xs text-sky-700 hover:bg-sky-100 font-medium whitespace-nowrap"
                              >
                                📄 Ver TR
                              </a>
                            )}
                            {canSync && (
                              <button
                                disabled={isUpload}
                                onClick={() => { setUploadTargetAta(a.numero_ata); fileInputRef.current?.click(); }}
                                className="inline-flex items-center gap-1 rounded-lg bg-emerald-50 border border-emerald-200 px-2 py-1 text-xs text-emerald-700 hover:bg-emerald-100 font-medium whitespace-nowrap disabled:opacity-50"
                                title={compra ? `Inserir TR para compra ${compra}` : "Inserir Termo de Referência"}
                              >
                                {isUpload ? "…" : (hasTR ? "📎 Alterar TR" : "📎 Inserir TR")}
                              </button>
                            )}
                            {!hasTR && !canSync && (
                              <span className="text-slate-300 text-xs">–</span>
                            )}
                          </div>
                        </td>
                      </tr>

                      {/* Painel expandido */}
                      {isExp && (
                        <tr key={a.numero_ata + "-itens"} className="border-t border-slate-100">
                          <td colSpan={7} className="px-0 py-0 bg-slate-50">
                            {carregando ? (
                              <div className="px-6 py-3 text-xs text-slate-400">Carregando itens…</div>
                            ) : (
                              <div className="overflow-x-auto">
                                {/* Bloco de TR + Reajuste */}
                                {(tr || (compra && comprasTrMap.has(compra))) ? (
                                  <TRReajusteBlock
                                    tr={tr ?? null}
                                    compra={compra ?? null}
                                    ipcaResult={compra ? (ipcaMap.get(compra) ?? undefined) : undefined}
                                  />
                                ) : (
                                  compra && (
                                    <div className="px-4 py-2 text-[11px] text-slate-400 border-b border-slate-200 bg-white">
                                      🛒 Compra: <span className="font-mono font-semibold text-slate-600">{compra}</span>
                                      {canSync && (
                                        <span className="ml-2 text-amber-600">— insira o TR para ver dados de reajuste</span>
                                      )}
                                    </div>
                                  )
                                )}

                                {/* Header de itens */}
                                <div className="px-4 py-2 flex items-center gap-3 text-[11px] text-slate-500 border-b border-slate-200 bg-slate-100">
                                  <span>{itens.length} item(s)</span>
                                  {itens.length > 0 && (
                                    <span>Valor total registrado: <strong>{fmtBRL(itens.reduce((s, it) => s + (it.valor_total ?? 0), 0))}</strong></span>
                                  )}
                                </div>

                                {itens.length === 0 ? (
                                  <div className="px-6 py-3 text-xs text-slate-400">
                                    Nenhum item registrado para esta ATA. Execute o robô para capturar.
                                  </div>
                                ) : (
                                  <table className="w-full text-xs border-collapse">
                                    <thead>
                                      <tr className="text-left font-semibold text-slate-500 bg-slate-100 border-b border-slate-200">
                                        <th className="px-3 py-1.5 whitespace-nowrap">Item</th>
                                        <th className="px-3 py-1.5">Descrição</th>
                                        <th className="px-3 py-1.5 whitespace-nowrap">Fornecedor</th>
                                        <th className="px-3 py-1.5 whitespace-nowrap">CNPJ</th>
                                        <th className="px-3 py-1.5 whitespace-nowrap text-right">Qtd.</th>
                                        <th className="px-3 py-1.5 whitespace-nowrap text-right">Valor Unit.</th>
                                        {tr?.data_orcamento && (
                                          <th className="px-3 py-1.5 whitespace-nowrap text-right text-amber-700">Unit. Reaj.</th>
                                        )}
                                        <th className="px-3 py-1.5 whitespace-nowrap text-right">Valor Total</th>
                                        <th className="px-3 py-1.5 whitespace-nowrap text-center">Adesão</th>
                                      </tr>
                                    </thead>
                                    <tbody>
                                      {itens.map((item, j) => {
                                        const ipca = compra ? (ipcaMap.get(compra) ?? null) : null;
                                        const vuReaj = ipca && item.valor_unitario
                                          ? item.valor_unitario * ipca.fator
                                          : null;
                                        return (
                                          <tr key={item.id}
                                            className={`border-t border-slate-200 ${j % 2 === 0 ? "bg-white" : "bg-slate-50"}`}>
                                            <td className="px-3 py-1.5 font-mono font-semibold whitespace-nowrap">{item.numero_ata || "–"}</td>
                                            <td className="px-3 py-1.5 max-w-sm">
                                              <span className="line-clamp-2">{item.descricao || "–"}</span>
                                            </td>
                                            <td className="px-3 py-1.5 whitespace-nowrap">{item.fornecedor_nome || "–"}</td>
                                            <td className="px-3 py-1.5 font-mono whitespace-nowrap text-slate-500">{item.cnpj_fornecedor || "–"}</td>
                                            <td className="px-3 py-1.5 whitespace-nowrap text-right">{fmtQtd(item.quantidade_registrada)}</td>
                                            <td className="px-3 py-1.5 whitespace-nowrap text-right font-mono">{fmtBRL(item.valor_unitario)}</td>
                                            {tr?.data_orcamento && (
                                              <td className="px-3 py-1.5 whitespace-nowrap text-right font-mono font-semibold text-amber-700">
                                                {vuReaj != null ? fmtBRL(vuReaj) : <span className="text-slate-300">…</span>}
                                              </td>
                                            )}
                                            <td className="px-3 py-1.5 whitespace-nowrap text-right font-mono font-semibold">{fmtBRL(item.valor_total)}</td>
                                            <td className="px-3 py-1.5 whitespace-nowrap text-center">
                                              {item.aceita_adesao == null ? "–"
                                                : /sim|yes|true|s$/i.test(item.aceita_adesao)
                                                  ? <span className="text-green-700 font-semibold">Sim</span>
                                                  : <span className="text-slate-400">Não</span>}
                                            </td>
                                          </tr>
                                        );
                                      })}
                                    </tbody>
                                  </table>
                                )}
                              </div>
                            )}
                          </td>
                        </tr>
                      )}
                    </>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="px-4 py-2 text-xs text-slate-400 border-t border-slate-100">
            {filtradas.length} ATA(s) exibida(s)
          </div>
        </div>
      )}
    </div>
  );
}

// ── Sub-componente: bloco TR + Reajuste ────────────────────────────────────
function TRReajusteBlock({
  tr,
  compra,
  ipcaResult,
}: {
  tr: CompraTR | null;
  compra: string | null;
  ipcaResult?: IpcaResult | null;
}) {
  const calcUrl = tr?.data_orcamento
    ? "https://www3.bcb.gov.br/CALCIDADAO/publico/corrigirPorIndice.do?method=corrigirPorIndice"
    : null;

  const proxReaj = tr?.data_orcamento ? proxReajusteDisplay(tr.data_orcamento) : null;

  return (
    <div className="px-4 py-3 bg-amber-50 border-b border-amber-200 space-y-2">
      <div className="flex flex-wrap items-center gap-4 text-xs">
        {compra && (
          <span className="font-semibold text-slate-700">🛒 Compra: <span className="font-mono">{compra}</span></span>
        )}
        {tr?.pdf_url && (
          <a href={tr.pdf_url} target="_blank" rel="noopener noreferrer"
            className="inline-flex items-center gap-1 rounded-lg bg-sky-50 border border-sky-200 px-2 py-1 text-sky-700 hover:bg-sky-100 font-medium">
            📄 Ver TR
          </a>
        )}
      </div>

      {tr?.data_orcamento ? (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
          <div className="rounded-lg bg-white border border-amber-200 px-3 py-2">
            <div className="text-slate-500 text-[10px] uppercase font-semibold mb-0.5">Data do Orçamento</div>
            <div className="font-semibold text-slate-800">{fmtDate(tr.data_orcamento)}</div>
          </div>
          <div className="rounded-lg bg-white border border-amber-200 px-3 py-2">
            <div className="text-slate-500 text-[10px] uppercase font-semibold mb-0.5">Índice Adotado</div>
            <div className="font-semibold text-slate-800">{tr.indice_adotado ?? "–"}</div>
          </div>
          <div className="rounded-lg bg-white border border-amber-200 px-3 py-2">
            <div className="text-slate-500 text-[10px] uppercase font-semibold mb-0.5">Próximo Reajuste</div>
            <div className="font-semibold text-amber-700">{proxReaj ?? "–"}</div>
          </div>
          <div className="rounded-lg bg-white border border-amber-200 px-3 py-2">
            <div className="text-slate-500 text-[10px] uppercase font-semibold mb-0.5">
              Reajuste {tr.indice_adotado ?? "IPCA"}
              {ipcaResult && (
                <span className="text-slate-400 ml-1">({ipcaResult.periodoInicio}–{ipcaResult.periodoFim})</span>
              )}
            </div>
            {ipcaResult === undefined ? (
              <div className="text-slate-400 animate-pulse">Calculando…</div>
            ) : ipcaResult === null ? (
              <div className="text-slate-400 text-[10px]">
                Calcule em{" "}
                {calcUrl && (
                  <a href={calcUrl} target="_blank" rel="noopener noreferrer"
                    className="text-sky-600 hover:underline font-medium">
                    Calculadora BCB ↗
                  </a>
                )}
              </div>
            ) : (
              <div>
                <span className="font-bold text-emerald-700 text-sm">
                  +{ipcaResult.percentual.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%
                </span>
                {calcUrl && (
                  <a href={calcUrl} target="_blank" rel="noopener noreferrer"
                    className="ml-2 text-[10px] text-sky-600 hover:underline">
                    Calculadora ↗
                  </a>
                )}
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className="text-xs text-amber-700">
          TR registrado sem dados de reajuste extraídos. Reenvie o arquivo PDF do TR.
        </div>
      )}
    </div>
  );
}
