import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import * as pdfjsLib from "pdfjs-dist";
import { supabase } from "../lib/supabase";
import DocFormatBar from "./DocFormatBar";

const APT_TEMPLATE_TIPO = "apostilamento_ata";

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

export interface CompraTR {
  numero_compra: string;
  pdf_url: string | null;
  data_orcamento: string | null; // "YYYY-MM-DD"
  indice_adotado: string | null;
  nup?: string | null;
}

export interface IpcaResult {
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

// Próximo reajuste: início = data_orcamento + 11 meses; avança ciclos de 12 meses
// até uma data futura. Ex: 11/2024 → (10/2025 passado) → 10/2026 ✓
export function proxReajusteDate(dataOrcamento: string): Date {
  const d = new Date(dataOrcamento + "T12:00:00");
  d.setMonth(d.getMonth() + 11);
  const hoje = new Date();
  hoje.setDate(1);
  while (d < hoje) d.setMonth(d.getMonth() + 12);
  return d;
}
function proxReajusteDisplay(dataOrcamento: string): string {
  const d = proxReajusteDate(dataOrcamento);
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

// Extrai data_orcamento, indice_adotado e NUP (Processo Administrativo) do TR
function parseReajuste(text: string): {
  dataOrcamento: string | null;
  indiceAdotado: string | null;
  nup: string | null;
} {
  // NUP / Processo Administrativo: padrão 00000.000000/YYYY-NN
  const nupMatch = text.match(/\b(\d{5}\.\d{6}\/\d{4}-\d{2})\b/);
  const nup = nupMatch ? nupMatch[1] : null;

  const idx = text.search(/reajuste/i);
  if (idx < 0) return { dataOrcamento: null, indiceAdotado: null, nup };
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

  return { dataOrcamento, indiceAdotado, nup };
}

// Busca IPCA acumulado na API do BCB (série 433) — cálculo base da data do orçamento
async function fetchIpca(dataOrcamento: string): Promise<IpcaResult | null> {
  try {
    const d = new Date(dataOrcamento + "T12:00:00");
    const fmt = (dt: Date) =>
      `01/${String(dt.getMonth() + 1).padStart(2, "0")}/${dt.getFullYear()}`;
    const start = fmt(d);
    const endD  = new Date(d);
    endD.setMonth(endD.getMonth() + 11);
    const end = fmt(endD);
    const url = `https://api.bcb.gov.br/dados/serie/bcdata.sgs.433/dados?formato=json&dataInicial=${start}&dataFinal=${end}`;
    const r = await fetch(url);
    if (!r.ok) return null;
    const data: { data: string; valor: string }[] = await r.json();
    if (!data.length) return null;
    let fator = 1;
    data.forEach((item) => { fator *= 1 + parseFloat(item.valor.replace(",", ".")) / 100; });
    return { fator, percentual: (fator - 1) * 100, periodoInicio: start.slice(3), periodoFim: end.slice(3) };
  } catch { return null; }
}

// Busca IPCA com período customizado (MM/YYYY → MM/YYYY)
export async function fetchIpcaRange(inicio: string, fim: string): Promise<IpcaResult | null> {
  try {
    const toApi = (s: string) => { const [mm, yyyy] = s.split("/"); return `01/${mm}/${yyyy}`; };
    const start = toApi(inicio);
    const end   = toApi(fim);
    const url = `https://api.bcb.gov.br/dados/serie/bcdata.sgs.433/dados?formato=json&dataInicial=${start}&dataFinal=${end}`;
    const r = await fetch(url);
    if (!r.ok) return null;
    const data: { data: string; valor: string }[] = await r.json();
    if (!data.length) return null;
    let fator = 1;
    data.forEach((item) => { fator *= 1 + parseFloat(item.valor.replace(",", ".")) / 100; });
    return { fator, percentual: (fator - 1) * 100, periodoInicio: inicio, periodoFim: fim };
  } catch { return null; }
}

// Busca INCC-M acumulado na API do BCB (série 192) — índice FGV, construção civil
export async function fetchInccRange(inicio: string, fim: string): Promise<IpcaResult | null> {
  try {
    const toApi = (s: string) => { const [mm, yyyy] = s.split("/"); return `01/${mm}/${yyyy}`; };
    const start = toApi(inicio);
    const end   = toApi(fim);
    const url = `https://api.bcb.gov.br/dados/serie/bcdata.sgs.192/dados?formato=json&dataInicial=${start}&dataFinal=${end}`;
    const r = await fetch(url);
    if (!r.ok) return null;
    const data: { data: string; valor: string }[] = await r.json();
    if (!data.length) return null;
    let fator = 1;
    data.forEach((item) => { fator *= 1 + parseFloat(item.valor.replace(",", ".")) / 100; });
    return { fator, percentual: (fator - 1) * 100, periodoInicio: inicio, periodoFim: fim };
  } catch { return null; }
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
  const [sortByReajuste, setSortByReajuste] = useState(false);
  const [previewAta, setPreviewAta] = useState<string | null>(null);

  // upload de Termo de Referência
  const fileInputRef                          = useRef<HTMLInputElement>(null);
  const [uploadTargetAta, setUploadTargetAta] = useState<string | null>(null);
  const [uploading, setUploading]             = useState(false);
  const [uploadStatus, setUploadStatus]       = useState<string | null>(null);

  const loadCompraMap = useCallback(async () => {
    const m = new Map<string, string>();
    const PAGE = 1000;
    let from = 0;
    for (;;) {
      const { data } = await supabase
        .from("itens_ata_gap_mn")
        .select("ata_numero, numero_compra")
        .not("numero_compra", "is", null)
        .range(from, from + PAGE - 1);
      if (!data?.length) break;
      (data as { ata_numero: string; numero_compra: string }[]).forEach((r) => {
        if (!m.has(r.ata_numero)) m.set(r.ata_numero, r.numero_compra);
      });
      if (data.length < PAGE) break;
      from += PAGE;
    }
    setCompraMap(m);
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
    const m = new Map<string, string>();
    const PAGE = 1000;
    let from = 0;
    for (;;) {
      const { data } = await supabase
        .from("itens_ata_gap_mn")
        .select("ata_numero, descricao")
        .not("descricao", "is", null)
        .range(from, from + PAGE - 1);
      if (!data?.length) break;
      (data as { ata_numero: string; descricao: string }[]).forEach((r) => {
        const prev = m.get(r.ata_numero) ?? "";
        m.set(r.ata_numero, prev + " " + r.descricao.toLowerCase());
      });
      if (data.length < PAGE) break;
      from += PAGE;
    }
    setDescMap(m);
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

  // Carrega IPCA ao abrir o card de prévia
  useEffect(() => {
    const ata = previewAta;
    if (!ata) return;
    const compra = compraMap.get(ata);
    if (!compra) return;
    const tr = comprasTrMap.get(compra);
    if (!tr?.data_orcamento) return;
    if (!ipcaMap.has(compra)) {
      setIpcaMap((prev) => new Map(prev).set(compra, null));
      fetchIpca(tr.data_orcamento).then((result) => {
        setIpcaMap((prev) => new Map(prev).set(compra, result));
      });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [previewAta]);

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
      let nup: string | null = null;
      if (ext.toLowerCase() === "pdf") {
        setUploadStatus("Lendo PDF…");
        try {
          const pdfText = await extractPdfText(file);
          const parsed  = parseReajuste(pdfText);
          dataOrcamento = parsed.dataOrcamento;
          indiceAdotado = parsed.indiceAdotado;
          nup           = parsed.nup;
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
            ...(nup ? { nup } : {}),
          }, { onConflict: "numero_compra" });
        if (trErr) throw trErr;
        setComprasTrMap((prev) =>
          new Map(prev).set(compra, {
            numero_compra: compra,
            pdf_url: publicUrl,
            data_orcamento: dataOrcamento,
            indice_adotado: indiceAdotado,
            nup,
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
      alert("Erro ao enviar: " + ((err as any)?.message || String(err)));
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
    if (busca.trim()) {
      const q = busca.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
      list = list.filter((a) => {
        const base = [a.numero_ata, a.situacao, compraMap.get(a.numero_ata) ?? ""]
          .join(" ").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
        if (base.includes(q)) return true;
        const descs = descMap.get(a.numero_ata) ?? "";
        return descs.normalize("NFD").replace(/[̀-ͯ]/g, "").includes(q);
      });
    }
    if (sortByReajuste) {
      return [...list].sort((a, b) => {
        const cA = compraMap.get(a.numero_ata);
        const cB = compraMap.get(b.numero_ata);
        const tA = cA ? comprasTrMap.get(cA) : undefined;
        const tB = cB ? comprasTrMap.get(cB) : undefined;
        const dA = tA?.data_orcamento ? proxReajusteDate(tA.data_orcamento).getTime() : Infinity;
        const dB = tB?.data_orcamento ? proxReajusteDate(tB.data_orcamento).getTime() : Infinity;
        return dA - dB;
      });
    }
    return list;
  }, [atas, busca, filtro, filtroCompra, compraMap, descMap, sortByReajuste, comprasTrMap]);

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
      {/* Card de prévia do apostilamento */}
      {previewAta && (() => {
        const compra = compraMap.get(previewAta) ?? null;
        const tr     = compra ? (comprasTrMap.get(compra) ?? null) : null;
        const ipca   = compra ? ipcaMap.get(compra) : undefined;
        return (
          <ApostilamentoPreviewCard
            numeroAta={previewAta}
            compra={compra}
            tr={tr}
            ipcaResult={ipca}
            onClose={() => setPreviewAta(null)}
            onOpenDoc={() => {
              window.open(`/apt?tipo=ata&ata=${encodeURIComponent(previewAta)}`, "_blank");
              setPreviewAta(null);
            }}
          />
        );
      })()}

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
          <button
            onClick={() => setSortByReajuste((v) => !v)}
            className={`rounded-full px-3 py-1 text-xs font-medium border transition-colors ${
              sortByReajuste
                ? "bg-amber-500 text-white border-amber-500"
                : "bg-white text-slate-600 border-slate-200 hover:bg-slate-50"
            }`}
            title="Ordenar por data do próximo reajuste (crescente)"
          >
            📅 Próx. reajuste
          </button>
        </div>

        {/* Status de upload */}
        {uploadStatus && (
          <div className="text-xs text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2">
            {uploadStatus}
          </div>
        )}

        {/* Link discreto para ferramentas */}
        {canSync && (
          <div className="text-[11px] text-slate-400 flex items-center gap-1">
            <span>Robô de ATAs disponível em</span>
            <a href="/ferramentas" className="text-violet-600 hover:underline font-medium">🔧 Ferramentas & Catálogo</a>
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
        <div className="rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="space-y-2 p-3 max-h-[640px] overflow-y-auto">
            {filtradas.map((a) => {
              const isExp      = expanded === a.numero_ata;
              const itens      = itensMap.get(a.numero_ata) ?? [];
              const carregando = loadingItens === a.numero_ata;
              const isUpload   = uploading && uploadTargetAta === a.numero_ata;
              const compra     = compraMap.get(a.numero_ata);
              const tr         = compra ? comprasTrMap.get(compra) : undefined;
              const hasTR      = !!(tr?.pdf_url ?? a.pdf_url);
              const vencida    = isVencida(a.vigencia_final);
              const reajuste   = tr?.data_orcamento ? proxReajusteDisplay(tr.data_orcamento) : null;
              const reajusteD  = tr?.data_orcamento ? proxReajusteDate(tr.data_orcamento) : null;
              const diasRej    = reajusteD ? Math.ceil((reajusteD.getTime() - Date.now()) / 86400000) : null;
              return (
                <div key={a.id} className={`rounded-xl border border-slate-200 overflow-hidden transition-shadow hover:shadow-sm ${vencida ? "opacity-60" : ""}`}>
                  {/* Linha principal — clicável para expandir */}
                  <button
                    onClick={() => toggleAta(a.numero_ata)}
                    className="w-full text-left px-3 py-2.5 hover:bg-sky-50 transition-colors"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1 space-y-0.5">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-mono text-xs font-bold text-slate-800">{a.numero_ata}</span>
                          {compra && <span className="font-mono text-xs text-slate-500">{compra}</span>}
                          <span className={sitBadge(a.situacao)}>{a.situacao || "–"}</span>
                          {vencida && <span className="inline-block rounded-full px-2 py-0.5 text-xs font-semibold bg-red-100 text-red-700">Vencida</span>}
                        </div>
                        <div className="flex items-center gap-3 text-xs text-slate-500 flex-wrap">
                          <span>{fmtDate(a.vigencia_inicial)} → <span className={vencida ? "text-red-600 font-semibold" : ""}>{fmtDate(a.vigencia_final)}</span></span>
                          {reajuste && (
                            <span className={`font-semibold ${diasRej !== null && diasRej <= 60 ? "text-red-600" : diasRej !== null && diasRej <= 120 ? "text-amber-600" : "text-amber-700"}`}>
                              📅 Próx. reajuste: {reajuste}
                              {diasRej !== null && diasRej <= 120 && ` (${diasRej}d)`}
                            </span>
                          )}
                        </div>
                      </div>
                      <span className="text-slate-400 text-xs shrink-0 mt-0.5 select-none">{isExp ? "▼" : "▶"}</span>
                    </div>
                  </button>

                  {/* Botões de ação */}
                  <div className="flex items-center gap-1.5 flex-wrap px-3 pb-2.5 pt-0" onClick={(e) => e.stopPropagation()}>
                    {tr?.data_orcamento && (
                      <button
                        onClick={() => setPreviewAta(a.numero_ata)}
                        className="inline-flex items-center gap-1 rounded-lg bg-amber-50 border border-amber-300 px-2 py-1 text-xs text-amber-800 hover:bg-amber-100 font-medium whitespace-nowrap"
                        title="Gerar Termo de Apostilamento com cálculo de reajuste"
                      >
                        📜 Gerar Apostilamento
                      </button>
                    )}
                    {hasTR && (
                      <a
                        href={tr?.pdf_url ?? a.pdf_url ?? "#"}
                        target="_blank" rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 rounded-lg bg-sky-50 border border-sky-200 px-2 py-1 text-xs text-sky-700 hover:bg-sky-100 font-medium whitespace-nowrap"
                      >
                        📄 TR
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
                  </div>

                  {/* Painel expandido */}
                  {isExp && (
                    <div className="border-t border-slate-100 bg-slate-50">
                      {carregando ? (
                        <div className="px-6 py-3 text-xs text-slate-400">Carregando itens…</div>
                      ) : (
                        <div className="overflow-x-auto">
                          {compra && (
                            <div className="px-4 py-2 bg-slate-50 border-b border-slate-100 flex items-center gap-3 text-xs text-slate-500">
                              <span className="font-semibold text-slate-700">Nº Compra: <span className="font-mono font-normal">{compra}</span></span>
                              {tr?.pdf_url && (
                                <a href={tr.pdf_url} target="_blank" rel="noopener noreferrer"
                                  className="text-sky-600 hover:underline font-medium">📄 Ver TR</a>
                              )}
                              {tr?.data_orcamento && (
                                <span className="text-amber-600">Reajuste disponível — clique em "Gerar Apostilamento"</span>
                              )}
                            </div>
                          )}

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
                                  <th className="px-3 py-1.5 whitespace-nowrap text-right">Valor Total</th>
                                  <th className="px-3 py-1.5 whitespace-nowrap text-center">Adesão</th>
                                </tr>
                              </thead>
                              <tbody>
                                {itens.map((item, j) => (
                                  <tr key={item.id}
                                    className={`border-t border-slate-200 ${j % 2 === 0 ? "bg-white" : "bg-slate-50"}`}>
                                    <td className="px-3 py-1.5 font-mono font-semibold whitespace-nowrap">{item.numero_ata || "–"}</td>
                                    <td className="px-3 py-1.5 max-w-xs break-words">
                                      <span className="whitespace-normal">{item.descricao || "–"}</span>
                                    </td>
                                    <td className="px-3 py-1.5 whitespace-nowrap">{item.fornecedor_nome || "–"}</td>
                                    <td className="px-3 py-1.5 font-mono whitespace-nowrap text-slate-500">{item.cnpj_fornecedor || "–"}</td>
                                    <td className="px-3 py-1.5 whitespace-nowrap text-right">{fmtQtd(item.quantidade_registrada)}</td>
                                    <td className="px-3 py-1.5 whitespace-nowrap text-right font-mono">{fmtBRL(item.valor_unitario)}</td>
                                    <td className="px-3 py-1.5 whitespace-nowrap text-right font-mono font-semibold">{fmtBRL(item.valor_total)}</td>
                                    <td className="px-3 py-1.5 whitespace-nowrap text-center">
                                      {item.aceita_adesao == null ? "–"
                                        : /sim|yes|true|s$/i.test(item.aceita_adesao)
                                          ? <span className="text-green-700 font-semibold">Sim</span>
                                          : <span className="text-slate-400">Não</span>}
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          <div className="px-4 py-2 text-xs text-slate-400 border-t border-slate-100">
            {filtradas.length} ATA(s) exibida(s)
          </div>
        </div>
      )}
    </div>
  );
}

// ── Converte percentual numérico para extenso em pt-BR ──────────────────────
function pctToExtenso(pct: string): string {
  if (!pct) return "";
  const normalized = pct.replace(",", ".");
  const num = parseFloat(normalized);
  if (isNaN(num)) return "";
  const parts = normalized.split(".");
  const intPart = parseInt(parts[0], 10);
  const decStr = (parts[1] ?? "00").padEnd(2, "0").slice(0, 2);
  const decPart = parseInt(decStr, 10);

  const UNITS = [
    "zero","um","dois","três","quatro","cinco","seis","sete","oito","nove",
    "dez","onze","doze","treze","quatorze","quinze","dezesseis","dezessete","dezoito","dezenove",
  ];
  const TENS = ["","","vinte","trinta","quarenta","cinquenta","sessenta","setenta","oitenta","noventa"];

  function toWords(n: number): string {
    if (n < 20) return UNITS[n] ?? String(n);
    const t = Math.floor(n / 10);
    const u = n % 10;
    return u === 0 ? TENS[t] : `${TENS[t]} e ${UNITS[u]}`;
  }

  const intWords = toWords(intPart);
  if (decPart === 0) return `${intWords} por cento`;
  return `${intWords} vírgula ${toWords(decPart)} por cento`;
}

// ── Config localStorage ────────────────────────────────────────────────────
const LS_APT = "gapmn_apt_config";

type AptSig = { id: string; nome: string; cargo: string };

type AptConfig = {
  // Identificação
  nup: string;
  processoAdm: string;
  dofReferencia: string;
  // Representante GAP-MN no preâmbulo
  representanteNome: string;
  representantePortaria: string;
  representanteBoletim: string;
  representanteCpf: string;
  representanteIdentidade: string;
  // GAP-MN — dados editáveis
  gapmn_sede: string;
  gapmn_cnpj: string;
  // Reajuste (em branco = usa valor calculado automaticamente)
  periodoReajusteInicio: string;
  periodoReajusteFim: string;
  indiceReajuste: string;
  percentualReajuste: string;
  percentualExtenso: string;
  // Assinaturas GAP-MN (array dinâmico — add/remove)
  signatarios: AptSig[];
  // Empresa (cada campo é opcional — toggle no painel)
  showRepresentante: boolean;
  representanteEmpresaNome: string;
  showTestemunha1: boolean;
  testemunha1: string;
  showTestemunha2: boolean;
  testemunha2: string;
  // Overrides de texto (em branco = usa texto padrão gerado)
  txt_abertura: string;   // parágrafo de abertura completo
  txt_11: string;         // cláusula 1.1
  txt_21: string;         // cláusula 2.1 ratificação
  txt_31: string;         // cláusula 3.1 divulgação
  txt_final: string;      // parágrafo final antes das assinaturas
  // Aparência
  brasaoSize: number;
  // Quebras de página manuais
  quebrarAntesTabela: boolean;
  quebrarAntesAssinaturas: boolean;
  // Legacy (mantidos para migração e retro-compat)
  gestorNome: string;
  gestorCargo: string;
  agenteCINome: string;
  agenteCICargo: string;
  ordenadorNome: string;
  ordenadorCargo: string;
};

const DEFAULT_APT: AptConfig = {
  nup: "",
  processoAdm: "",
  dofReferencia: "SEÇÃO 3 Nº 162 de 27/08/2025",
  representanteNome: "SUSAN KELLY PRADO ANDRADE Cel Int",
  representantePortaria: "PORTARIA GABAER n°1208/GC1, de 06 de setembro de 2024",
  representanteBoletim: "BOLETIM DO COMANDO DA AERONÁUTICA n°56, de 24 março de 2024",
  representanteCpf: "708.595.071-49",
  representanteIdentidade: "510352 COMAER",
  gapmn_sede: "AV. PRESIDENTE KENNEDY, 1700 MANAUS-AM",
  gapmn_cnpj: "00.394.429/0188-24",
  periodoReajusteInicio: "",
  periodoReajusteFim: "",
  indiceReajuste: "",
  percentualReajuste: "",
  percentualExtenso: "",
  signatarios: [
    { id: "gestor",    nome: "GABRIELA DE ANDRADE CAVALCANTI TRINDADE 1º Ten QOINT", cargo: "Gestor de Licitações" },
    { id: "aci",       nome: "MAINÃ FARIA CUNHA DE JESUS Cap INT",                   cargo: "Agente de Controle Interno" },
    { id: "ordenador", nome: "SUSAN KELLY PRADO ANDRADE Cel Int",                    cargo: "Ordenador de Despesas" },
  ],
  showRepresentante: false,
  representanteEmpresaNome: "",
  showTestemunha1: false,
  testemunha1: "",
  showTestemunha2: false,
  testemunha2: "",
  txt_abertura: "",
  txt_11: "",
  txt_21: "",
  txt_31: "",
  txt_final: "",
  // Aparência
  brasaoSize: 110,
  // Quebras de página manuais
  quebrarAntesTabela: false,
  quebrarAntesAssinaturas: false,
  // Legacy
  gestorNome:     "GABRIELA DE ANDRADE CAVALCANTI TRINDADE 1º Ten QOINT",
  gestorCargo:    "Gestor de Licitações",
  agenteCINome:   "MAINÃ FARIA CUNHA DE JESUS Cap INT",
  agenteCICargo:  "Agente de Controle Interno",
  ordenadorNome:  "SUSAN KELLY PRADO ANDRADE Cel Int",
  ordenadorCargo: "Ordenador de Despesas",
};

function loadAptCfg(): AptConfig {
  try {
    const raw = localStorage.getItem(LS_APT);
    const saved = raw ? JSON.parse(raw) : {};
    const merged: AptConfig = { ...DEFAULT_APT, ...saved };
    // Migrar legacy → signatarios
    if (!Array.isArray(merged.signatarios) || merged.signatarios.length === 0) {
      merged.signatarios = [
        { id: "gestor",    nome: merged.gestorNome    || DEFAULT_APT.gestorNome,    cargo: merged.gestorCargo    || DEFAULT_APT.gestorCargo    },
        { id: "aci",       nome: merged.agenteCINome  || DEFAULT_APT.agenteCINome,  cargo: merged.agenteCICargo  || DEFAULT_APT.agenteCICargo  },
        { id: "ordenador", nome: merged.ordenadorNome || DEFAULT_APT.ordenadorNome, cargo: merged.ordenadorCargo || DEFAULT_APT.ordenadorCargo },
      ];
    }
    return merged;
  } catch { return { ...DEFAULT_APT }; }
}
function saveAptCfg(cfg: AptConfig) {
  try { localStorage.setItem(LS_APT, JSON.stringify(cfg)); } catch {}
}

// Keys de AptConfig cujo valor é string (para usar em <input value={}>)
type AptStrKey = Exclude<keyof AptConfig,
  "signatarios" | "showRepresentante" | "showTestemunha1" | "showTestemunha2" |
  "brasaoSize" | "quebrarAntesTabela" | "quebrarAntesAssinaturas">;

// ── Card de prévia do apostilamento ───────────────────────────────────────
function ApostilamentoPreviewCard({
  numeroAta, compra, tr, ipcaResult, onClose, onOpenDoc,
}: {
  numeroAta: string;
  compra: string | null;
  tr: CompraTR | null;
  ipcaResult?: IpcaResult | null; // undefined = carregando, null = sem resultado
  onClose: () => void;
  onOpenDoc: () => void;
}) {
  const loading = ipcaResult === undefined;
  const pct = ipcaResult
    ? ipcaResult.percentual.toLocaleString("pt-BR", { minimumFractionDigits: 4, maximumFractionDigits: 4 })
    : null;

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/50 p-4">
      <div className="modal-card bg-white rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 bg-amber-50">
          <div className="flex items-center gap-2">
            <span className="text-lg">📜</span>
            <div>
              <div className="text-sm font-bold text-slate-800">Termo de Apostilamento</div>
              <div className="text-xs text-slate-500">ATA Nº {numeroAta}{compra ? ` · Pregão ${compra}` : ""}</div>
            </div>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 text-xl px-1 leading-none">✕</button>
        </div>

        {/* Dados */}
        <div className="p-5 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-xl bg-slate-50 border border-slate-200 p-3">
              <div className="text-[11px] font-semibold text-slate-400 uppercase mb-1">Nº Compra (Pregão)</div>
              <div className="text-sm font-mono font-semibold text-slate-800">{compra ?? "–"}</div>
            </div>
            <div className="rounded-xl bg-slate-50 border border-slate-200 p-3">
              <div className="text-[11px] font-semibold text-slate-400 uppercase mb-1">Data do Orçamento</div>
              <div className="text-sm font-semibold text-slate-800">{tr?.data_orcamento ? fmtDate(tr.data_orcamento) : "–"}</div>
            </div>
            <div className="rounded-xl bg-slate-50 border border-slate-200 p-3">
              <div className="text-[11px] font-semibold text-slate-400 uppercase mb-1">Índice Adotado</div>
              <div className="text-sm font-semibold text-slate-800">{tr?.indice_adotado ?? "IPCA"}</div>
            </div>
            <div className="rounded-xl bg-amber-50 border border-amber-200 p-3">
              <div className="text-[11px] font-semibold text-amber-500 uppercase mb-1">Percentual Calculado</div>
              <div className="text-sm font-bold text-amber-800">
                {loading
                  ? <span className="animate-pulse text-slate-400">Calculando…</span>
                  : pct
                    ? `${pct}%`
                    : "Não disponível"}
              </div>
            </div>
            {tr?.nup && (
              <div className="col-span-2 rounded-xl bg-sky-50 border border-sky-200 p-3">
                <div className="text-[11px] font-semibold text-sky-500 uppercase mb-1">NUP / Processo Administrativo</div>
                <div className="text-sm font-mono font-semibold text-sky-800">{tr.nup}</div>
              </div>
            )}
          </div>

          {ipcaResult && (
            <div className="rounded-xl bg-emerald-50 border border-emerald-200 px-4 py-3 text-xs text-emerald-800">
              📊 IPCA acumulado de <strong>{ipcaResult.periodoInicio}</strong> a <strong>{ipcaResult.periodoFim}</strong>
              {" "}· fator {ipcaResult.fator.toFixed(6)}
            </div>
          )}

          {!tr?.data_orcamento && (
            <div className="rounded-xl bg-yellow-50 border border-yellow-200 px-4 py-3 text-xs text-yellow-800">
              ⚠️ Nenhum TR com data de orçamento foi inserido para esta ATA. Insira o Termo de Referência para calcular o reajuste automaticamente.
            </div>
          )}
        </div>

        {/* Ações */}
        <div className="px-5 pb-5 flex gap-3">
          <button
            onClick={onClose}
            className="flex-1 rounded-xl border border-slate-200 py-2.5 text-sm text-slate-600 hover:bg-slate-50 transition-colors"
          >
            Cancelar
          </button>
          <button
            onClick={onOpenDoc}
            className="rounded-xl bg-amber-500 hover:bg-amber-600 text-white py-2.5 px-6 text-sm font-semibold transition-colors"
          >
            📄 Abrir Documento
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Modal de Apostilamento ─────────────────────────────────────────────────
export function ApostilamentoModal({
  numeroAta, compra, tr, itens, loadingItens, ipcaResult, onClose,
}: {
  numeroAta: string;
  compra: string | null;
  tr: CompraTR | null;
  itens: ItemAta[];
  loadingItens: boolean;
  ipcaResult?: IpcaResult | null;
  onClose: () => void;
}) {
  const [cfg,     setCfg]     = useState<AptConfig>(() => {
    const base = loadAptCfg();
    // Auto-preenche NUP e Processo Administrativo do TR se ainda não salvos manualmente
    if (tr?.nup) {
      return {
        ...base,
        ...(base.nup        ? {} : { nup:         tr.nup }),
        ...(base.processoAdm ? {} : { processoAdm: tr.nup }),
      };
    }
    return base;
  });
  const [draft,   setDraft]   = useState<AptConfig>(() => {
    const base = loadAptCfg();
    if (tr?.nup) {
      return {
        ...base,
        ...(base.nup        ? {} : { nup:         tr.nup }),
        ...(base.processoAdm ? {} : { processoAdm: tr.nup }),
      };
    }
    return base;
  });
  const [showCfg,        setShowCfg]        = useState(false);
  const [savingDoc,      setSavingDoc]      = useState(false);
  const [docSaved,       setDocSaved]       = useState(false);
  const [savingTemplate, setSavingTemplate] = useState(false);
  const [templateSaved,  setTemplateSaved]  = useState(false);
  const [docEditMode,    setDocEditMode]    = useState(false);
  const [savedDocHtml,   setSavedDocHtml]   = useState<string | null>(() => {
    try { return localStorage.getItem(`gapmn_apt_ata_doc_${numeroAta}`); } catch { return null; }
  });
  const docRef = useRef<HTMLDivElement>(null);
  const LS_DOC_KEY = `gapmn_apt_ata_doc_${numeroAta}`;

  // Re-busca IPCA quando usuário define um período customizado
  const [customIpca,        setCustomIpca]        = useState<IpcaResult | null | undefined>(undefined);
  const [loadingCustomIpca, setLoadingCustomIpca] = useState(false);
  useEffect(() => {
    const mmYYYY = /^\d{2}\/\d{4}$/;
    if (!cfg.periodoReajusteInicio || !cfg.periodoReajusteFim ||
        !mmYYYY.test(cfg.periodoReajusteInicio) || !mmYYYY.test(cfg.periodoReajusteFim)) {
      setCustomIpca(undefined);
      return;
    }
    setLoadingCustomIpca(true);
    fetchIpcaRange(cfg.periodoReajusteInicio, cfg.periodoReajusteFim).then((res) => {
      setCustomIpca(res);
      setLoadingCustomIpca(false);
    });
  }, [cfg.periodoReajusteInicio, cfg.periodoReajusteFim]);

  function handlePrint() {
    const el = docRef.current;
    if (!el) { window.print(); return; }
    const pw = window.open("", "_blank", "width=900,height=700");
    if (!pw) { window.print(); return; }

    // Usa URL absoluta do brasão (currentSrc já é absoluto; resolve tanto local quanto fallback)
    let html = el.outerHTML;
    const brasaoEl = el.querySelector("[data-brasao]") as HTMLImageElement | null;
    const brasaoUrl = brasaoEl?.currentSrc || (window.location.origin + "/brasao.png");
    html = html.replace(/data-brasao="true"\s+src="[^"]*"/, `data-brasao="true" src="${brasaoUrl}"`);

    pw.document.write(`<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<title>Termo de Apostilamento — ATA ${numeroAta}</title>
<style>
  * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; box-sizing: border-box; }
  body { margin: 0; padding: 0; background: #fff; font-family: Arial, Helvetica, sans-serif; }
  @page { size: A4; margin: 0; }
  table { border-collapse: collapse; }
  tr { page-break-inside: avoid; break-inside: avoid; }
  div[style*="page-break-inside"] { page-break-inside: avoid; break-inside: avoid; }
  .pg { page-break-before: always; break-before: page; height: 0; overflow: hidden; }
</style>
</head>
<body>${html}<script>window.onload=function(){window.print();};<\/script></body>
</html>`);
    pw.document.close();
  }

  // Itens agrupados por fornecedor
  const byFornecedor = useMemo(() => {
    const map = new Map<string, { razao: string; cnpj: string; itens: ItemAta[] }>();
    itens.forEach((item) => {
      const key = item.cnpj_fornecedor ?? "__sem_cnpj__";
      if (!map.has(key)) map.set(key, { razao: item.fornecedor_nome ?? "–", cnpj: item.cnpj_fornecedor ?? "–", itens: [] });
      map.get(key)!.itens.push(item);
    });
    return Array.from(map.values());
  }, [itens]);

  function setDraftField(k: AptStrKey, v: string) {
    setDraft((prev) => ({ ...prev, [k]: v }));
  }
  function addDraftSig() {
    setDraft(p => ({ ...p, signatarios: [...p.signatarios, { id: Date.now().toString(), nome: "", cargo: "" }] }));
  }
  function removeDraftSig(id: string) {
    setDraft(p => ({ ...p, signatarios: p.signatarios.filter(s => s.id !== id) }));
  }
  function setDraftSig(id: string, field: keyof AptSig, value: string) {
    setDraft(p => ({ ...p, signatarios: p.signatarios.map(s => s.id === id ? { ...s, [field]: value } : s) }));
  }
  function salvarCfg() {
    saveAptCfg(draft);
    setCfg({ ...draft });
    setShowCfg(false);
  }

  // Conecta handlers de quebra ao entrar em modo de edição
  useEffect(() => {
    const el = docRef.current;
    if (!el || !docEditMode) return;
    el.querySelectorAll<HTMLElement>("[data-quebra]").forEach(e => {
      e.onclick = () => e.remove();
      e.style.cursor = "pointer";
    });
  }, [docEditMode, savedDocHtml]);

  // Carrega modelo do Supabase se não houver HTML local
  useEffect(() => {
    if (savedDocHtml) return;
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!user) return;
      supabase.from("document_templates")
        .select("html_content")
        .eq("user_id", user.id)
        .eq("tipo", APT_TEMPLATE_TIPO)
        .maybeSingle()
        .then(({ data }) => {
          if (data?.html_content) setSavedDocHtml(data.html_content);
        });
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Ctrl+S salva edições
  useEffect(() => {
    function onKey(e: KeyboardEvent) { if ((e.ctrlKey || e.metaKey) && e.key === "s") { e.preventDefault(); saveDocHtml(); } }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function saveDocHtml() {
    const el = docRef.current;
    if (!el) return;
    const clone = el.cloneNode(true) as HTMLElement;
    clone.querySelectorAll("[contenteditable]").forEach(e => { e.removeAttribute("contenteditable"); (e as HTMLElement).style.outline = ""; });
    const html = clone.innerHTML;
    localStorage.setItem(LS_DOC_KEY, html);
    setSavedDocHtml(html);
  }

  function restoreDocHtml() {
    if (!confirm("Restaurar o texto original? Suas edições serão perdidas.")) return;
    localStorage.removeItem(LS_DOC_KEY);
    setSavedDocHtml(null);
    setDocEditMode(false);
  }

  function inserirQuebra() {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return;
    const range = sel.getRangeAt(0);
    const div = document.createElement("div");
    div.className = "pg";
    div.setAttribute("data-quebra", "true");
    div.style.cssText = "page-break-before:always;break-before:page;display:block;border-top:2px dashed #93c5fd;margin:12px 0;padding:2px 6px;color:#60a5fa;font-size:9pt;text-align:center;cursor:pointer;";
    div.textContent = "✕ quebra de página — clique para remover";
    div.title = "Clique para remover";
    div.onclick = () => div.remove();
    range.collapse(false);
    range.insertNode(div);
    sel.removeAllRanges();
  }

  async function salvarComoModelo() {
    const el = docRef.current;
    if (!el) return;
    setSavingTemplate(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { alert("Faça login para salvar um modelo."); return; }
      const clone = el.cloneNode(true) as HTMLElement;
      clone.querySelectorAll("[contenteditable]").forEach(e => e.removeAttribute("contenteditable"));
      const html = clone.innerHTML;
      const { error } = await supabase.from("document_templates").upsert({
        user_id: user.id,
        tipo: APT_TEMPLATE_TIPO,
        html_content: html,
        updated_at: new Date().toISOString(),
      }, { onConflict: "user_id,tipo" });
      if (error) throw error;
      setTemplateSaved(true);
      setTimeout(() => setTemplateSaved(false), 3000);
    } catch (e) {
      alert("Erro ao salvar modelo.");
      console.error(e);
    } finally {
      setSavingTemplate(false);
    }
  }

  async function salvarNaAta() {
    setSavingDoc(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      const { data: profile } = user
        ? await supabase.from("profiles").select("nome_guerra").eq("id", user.id).single()
        : { data: null };
      const nome = `Apostilamento ATA ${numeroAta}${compra ? ` – Pregão ${compra}` : ""} (${new Date().toLocaleDateString("pt-BR")})`;
      const { error } = await supabase.from("contratos_docs").insert({
        numero_contrato: numeroAta,
        tipo: "apostilamento",
        nome,
        url: null,
        user_nome: (profile as { nome_guerra?: string } | null)?.nome_guerra ?? user?.email ?? "–",
        user_id: user?.id ?? null,
      });
      if (error) throw error;
      setDocSaved(true);
    } catch (err) {
      console.error("Erro ao salvar apostilamento na ATA:", err);
      alert("Erro ao salvar no histórico.");
    } finally {
      setSavingDoc(false);
    }
  }

  // customIpca sobrepõe ipcaResult quando o usuário definiu período customizado
  const activeIpca = customIpca !== undefined ? customIpca : ipcaResult;
  const pct = activeIpca
    ? activeIpca.percentual.toLocaleString("pt-BR", { minimumFractionDigits: 4, maximumFractionDigits: 4 })
    : "";

  // Valores efetivos do reajuste (override manual > calculado automático)
  const effPeriodoInicio = cfg.periodoReajusteInicio || activeIpca?.periodoInicio || "______";
  const effPeriodoFim    = cfg.periodoReajusteFim    || activeIpca?.periodoFim    || "______";
  const effIndice        = cfg.indiceReajuste        || tr?.indice_adotado        || "IPCA";
  const effPct           = cfg.percentualReajuste    || pct                       || "____";
  const effExtenso       = cfg.percentualExtenso     || pctToExtenso(effPct);
  const hasEmpresa       = cfg.showRepresentante || cfg.showTestemunha1 || cfg.showTestemunha2;

  const docStyle: React.CSSProperties = {
    fontFamily: "Arial, Helvetica, sans-serif",
    fontSize: "11pt",
    color: "#000",
    lineHeight: "1.6",
    width: "210mm",
    minHeight: "297mm",
    padding: "18mm 22mm",
    background: "#fff",
  };

  type StrFld = { key: AptStrKey; label: string };
  type FldGrp = { title: string; fields: StrFld[] };
  const FIELD_GROUPS: FldGrp[] = [
    { title: "Identificação", fields: [
      { key: "nup",           label: "NUP" },
      { key: "processoAdm",   label: "Processo Administrativo" },
      { key: "dofReferencia", label: "Referência — Diário Oficial" },
    ]},
    { title: "GAP-MN — Dados Institucionais", fields: [
      { key: "gapmn_sede", label: "Sede (endereço completo)" },
      { key: "gapmn_cnpj", label: "CNPJ/MF" },
    ]},
    { title: "Representante GAP-MN (preâmbulo)", fields: [
      { key: "representanteNome",       label: "Nome + posto/graduação" },
      { key: "representantePortaria",   label: "Portaria de nomeação" },
      { key: "representanteBoletim",    label: "Boletim COMAER" },
      { key: "representanteCpf",        label: "CPF" },
      { key: "representanteIdentidade", label: "Carteira de Identidade" },
    ]},
    { title: "Reajuste", fields: [
      { key: "periodoReajusteInicio", label: `Período início MM/AAAA (auto: ${activeIpca?.periodoInicio ?? "–"})` },
      { key: "periodoReajusteFim",    label: `Período fim MM/AAAA (auto: ${activeIpca?.periodoFim ?? "–"})${loadingCustomIpca ? " ⏳" : ""}` },
      { key: "indiceReajuste",        label: `Índice (auto: ${tr?.indice_adotado ?? "IPCA"})` },
      { key: "percentualReajuste",    label: `Percentual % (auto: ${pct || "–"}) — vírgula: ex 4,3897` },
      { key: "percentualExtenso",     label: `Extenso (auto: ${pctToExtenso(effPct) || "–"})` },
    ]},
  ];

  type TxtFld = { key: AptStrKey; label: string; ph: string };
  const TXT_FIELDS: TxtFld[] = [
    { key: "txt_abertura", label: "Parágrafo de abertura",              ph: "Em branco = texto padrão gerado..." },
    { key: "txt_11",       label: "Cláusula 1.1 — Objeto",             ph: "Em branco = texto padrão gerado..." },
    { key: "txt_21",       label: "Cláusula 2.1 — Ratificação",        ph: "Em branco = texto padrão gerado..." },
    { key: "txt_31",       label: "Cláusula 3.1 — Divulgação PNCP",    ph: "Em branco = texto padrão gerado..." },
    { key: "txt_final",    label: "Parágrafo final (pré-assinatura)",   ph: "Em branco = texto padrão gerado..." },
  ];

  return (
    <div className="apt-modal-bg fixed inset-0 z-[9999] flex flex-col bg-slate-200 overflow-hidden">

      {/* Barra superior — oculta na impressão */}
      <div className="print:hidden shrink-0 flex items-center justify-between gap-3 bg-slate-800 px-4 py-2 text-white">
        <div className="text-sm font-semibold truncate">
          Termo de Apostilamento — ATA Nº {numeroAta}{compra ? ` · Pregão ${compra}` : ""}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={() => { setDraft({ ...cfg }); setShowCfg((v) => !v); }}
            className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
              showCfg ? "bg-slate-600 text-slate-200" : "bg-amber-500 hover:bg-amber-400 text-white"
            }`}
          >
            ✏️ {showCfg ? "Fechar painel" : "Editar campos"}
          </button>
          <button
            onClick={() => {
              if (!docEditMode && !savedDocHtml) {
                setSavedDocHtml(docRef.current?.innerHTML ?? "");
              }
              setDocEditMode(v => !v);
            }}
            className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
              docEditMode ? "bg-emerald-600 text-white" : "bg-slate-600 hover:bg-slate-500 text-slate-200"
            }`}
            title="Edição livre — use a barra de formatação para negrito, fonte, tamanho, etc."
          >
            {docEditMode ? "📝 Editando…" : "📝 Editar texto"}
          </button>
          {docEditMode && (
            <button onClick={saveDocHtml}
              className="flex items-center gap-1.5 rounded-lg bg-green-600 hover:bg-green-500 px-3 py-1.5 text-xs font-medium text-white"
              title="Salvar edições (Ctrl+S)">
              💾 Salvar
            </button>
          )}
          <button
            onClick={salvarComoModelo}
            disabled={savingTemplate}
            title="Salvar como modelo padrão para futuros apostilamentos de ATA"
            className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
              templateSaved
                ? "bg-teal-700 text-teal-200 cursor-default"
                : "bg-teal-600 hover:bg-teal-500 text-white disabled:opacity-60"
            }`}
          >
            {templateSaved ? "✓ Modelo salvo!" : savingTemplate ? "Salvando…" : "📋 Salvar como modelo"}
          </button>
          {savedDocHtml && (
            <button onClick={restoreDocHtml}
              className="flex items-center gap-1.5 rounded-lg bg-rose-700 hover:bg-rose-600 px-3 py-1.5 text-xs font-medium text-white"
              title="Restaurar texto original">
              🔄 Original
            </button>
          )}
          <button
            onClick={salvarNaAta}
            disabled={savingDoc || docSaved}
            className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
              docSaved
                ? "bg-emerald-700 text-emerald-200 cursor-default"
                : "bg-emerald-600 hover:bg-emerald-500 text-white disabled:opacity-60"
            }`}
          >
            {docSaved ? "✓ Salvo no histórico" : savingDoc ? "Salvando…" : "💾 Salvar na ATA"}
          </button>
          <button
            onClick={handlePrint}
            className="flex items-center gap-1.5 rounded-lg bg-sky-600 hover:bg-sky-500 px-3 py-1.5 text-xs font-medium text-white transition-colors"
          >
            🖨 Imprimir / PDF
          </button>
          <button onClick={onClose} className="text-slate-400 hover:text-white text-xl px-2 leading-none">✕</button>
        </div>
      </div>

      {docEditMode && <DocFormatBar docRef={docRef} onInsertBreak={inserirQuebra} />}

      {/* Corpo — painel de config + documento */}
      <div className="flex flex-1 overflow-hidden print:block print:overflow-visible">

        {/* Painel de campos editáveis — oculto na impressão */}
        {showCfg && (
          <div className="modal-card apt-cfg-panel print:hidden w-80 shrink-0 bg-white border-r border-slate-200 overflow-y-auto flex flex-col">
            <div className="p-4 space-y-4 flex-1">
              <div className="text-sm font-bold">Campos Editáveis</div>
              <p className="text-xs text-slate-500 leading-relaxed">
                Salvo no navegador. Em branco = valor automático calculado.
              </p>

              {/* Grupos de campos string */}
              {FIELD_GROUPS.map(grp => (
                <div key={grp.title} className="space-y-2">
                  <div className="text-[11px] font-bold text-sky-700 uppercase tracking-wide border-b pb-0.5">{grp.title}</div>
                  {grp.fields.map(({ key, label }) => (
                    <div key={key}>
                      <label className="block text-[11px] font-semibold text-slate-500 mb-0.5">{label}</label>
                      <input
                        value={draft[key] as string}
                        onChange={e => setDraftField(key, e.target.value)}
                        className="w-full rounded-lg border px-2 py-1.5 text-xs outline-none focus:ring-1 focus:ring-sky-200"
                      />
                    </div>
                  ))}
                </div>
              ))}

              {/* Assinaturas — GAP-MN (array dinâmico) */}
              <div className="space-y-2">
                <div className="text-[11px] font-bold text-sky-700 uppercase tracking-wide border-b pb-0.5">Assinaturas — GAP-MN</div>
                {draft.signatarios.map((sig, idx) => (
                  <div key={sig.id} className="border rounded-lg p-2 space-y-1">
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] font-semibold text-slate-500">Assinante {idx + 1}</span>
                      <button onClick={() => removeDraftSig(sig.id)}
                        className="text-[11px] text-red-400 hover:text-red-600">✕ Remover</button>
                    </div>
                    <input placeholder="Nome + posto/graduação"
                      value={sig.nome}
                      onChange={e => setDraftSig(sig.id, "nome", e.target.value)}
                      className="w-full rounded-lg border px-2 py-1.5 text-xs outline-none focus:ring-1 focus:ring-sky-200"
                    />
                    <input placeholder="Cargo"
                      value={sig.cargo}
                      onChange={e => setDraftSig(sig.id, "cargo", e.target.value)}
                      className="w-full rounded-lg border px-2 py-1.5 text-xs outline-none focus:ring-1 focus:ring-sky-200"
                    />
                  </div>
                ))}
                <button onClick={addDraftSig}
                  className="text-xs text-sky-600 hover:text-sky-800 border border-sky-200 rounded-lg px-2 py-1">
                  + Adicionar assinante
                </button>
              </div>

              {/* Assinaturas — Empresa (opcional) */}
              <div className="space-y-2">
                <div className="text-[11px] font-bold text-sky-700 uppercase tracking-wide border-b pb-0.5">Assinaturas — Empresa (opcional)</div>
                <label className="flex items-center gap-2 text-xs text-slate-600 cursor-pointer">
                  <input type="checkbox" checked={draft.showRepresentante}
                    onChange={e => setDraft(p => ({ ...p, showRepresentante: e.target.checked }))} />
                  Incluir Representante da Empresa
                </label>
                {draft.showRepresentante && (
                  <input placeholder="Nome do representante"
                    value={draft.representanteEmpresaNome}
                    onChange={e => setDraftField("representanteEmpresaNome", e.target.value)}
                    className="w-full rounded-lg border px-2 py-1.5 text-xs outline-none focus:ring-1 focus:ring-sky-200"
                  />
                )}
                <label className="flex items-center gap-2 text-xs text-slate-600 cursor-pointer">
                  <input type="checkbox" checked={draft.showTestemunha1}
                    onChange={e => setDraft(p => ({ ...p, showTestemunha1: e.target.checked }))} />
                  Incluir Testemunha 1
                </label>
                {draft.showTestemunha1 && (
                  <input placeholder="Nome da testemunha"
                    value={draft.testemunha1}
                    onChange={e => setDraftField("testemunha1", e.target.value)}
                    className="w-full rounded-lg border px-2 py-1.5 text-xs outline-none focus:ring-1 focus:ring-sky-200"
                  />
                )}
                <label className="flex items-center gap-2 text-xs text-slate-600 cursor-pointer">
                  <input type="checkbox" checked={draft.showTestemunha2}
                    onChange={e => setDraft(p => ({ ...p, showTestemunha2: e.target.checked }))} />
                  Incluir Testemunha 2
                </label>
                {draft.showTestemunha2 && (
                  <input placeholder="Nome da testemunha"
                    value={draft.testemunha2}
                    onChange={e => setDraftField("testemunha2", e.target.value)}
                    className="w-full rounded-lg border px-2 py-1.5 text-xs outline-none focus:ring-1 focus:ring-sky-200"
                  />
                )}
              </div>

              {/* Overrides de texto */}
              <div className="space-y-2">
                <div className="text-[11px] font-bold text-sky-700 uppercase tracking-wide border-b pb-0.5">Overrides de Texto</div>
                <p className="text-[11px] text-slate-500">Em branco = usa o texto padrão gerado automaticamente.</p>
                {TXT_FIELDS.map(({ key, label, ph }) => (
                  <div key={key}>
                    <label className="block text-[11px] font-semibold text-slate-500 mb-0.5">{label}</label>
                    <textarea rows={3}
                      value={draft[key] as string}
                      onChange={e => setDraftField(key, e.target.value)}
                      placeholder={ph}
                      className="w-full rounded-lg border px-2 py-1.5 text-xs outline-none focus:ring-1 focus:ring-sky-200 resize-none"
                    />
                  </div>
                ))}
              </div>

              {/* Aparência */}
              <div className="space-y-2">
                <div className="text-[11px] font-bold text-sky-700 uppercase tracking-wide border-b pb-0.5">Aparência</div>
                <div>
                  <label className="block text-[11px] font-semibold text-slate-500 mb-0.5">
                    Brasão — tamanho: {draft.brasaoSize ?? 110}px
                  </label>
                  <input
                    type="range" min={60} max={200} step={5}
                    value={draft.brasaoSize ?? 110}
                    onChange={e => setDraft(p => ({ ...p, brasaoSize: Number(e.target.value) }))}
                    className="w-full"
                  />
                </div>
              </div>

              {/* Quebras de página */}
              <div className="space-y-2">
                <div className="text-[11px] font-bold text-sky-700 uppercase tracking-wide border-b pb-0.5">Quebras de Página</div>
                <label className="flex items-center gap-2 text-xs text-slate-600 cursor-pointer">
                  <input type="checkbox" checked={draft.quebrarAntesTabela ?? false}
                    onChange={e => setDraft(p => ({ ...p, quebrarAntesTabela: e.target.checked }))} />
                  Quebra antes das tabelas de itens
                </label>
                <label className="flex items-center gap-2 text-xs text-slate-600 cursor-pointer">
                  <input type="checkbox" checked={draft.quebrarAntesAssinaturas ?? false}
                    onChange={e => setDraft(p => ({ ...p, quebrarAntesAssinaturas: e.target.checked }))} />
                  Quebra antes das assinaturas
                </label>
              </div>
            </div>

            <div className="p-4 border-t shrink-0">
              <button onClick={salvarCfg}
                className="w-full rounded-lg bg-emerald-600 text-white py-2 text-xs font-semibold hover:bg-emerald-700 transition-colors">
                ✓ Salvar e aplicar
              </button>
            </div>
          </div>
        )}

        {/* Área do documento */}
        <div className="flex-1 overflow-y-auto py-8 px-4 print:p-0 print:overflow-visible flex justify-center">
          {savedDocHtml ? (
            <div ref={docRef} style={docStyle} className="shadow-xl print:shadow-none" contentEditable={docEditMode} suppressContentEditableWarning dangerouslySetInnerHTML={{ __html: savedDocHtml }} />
          ) : (
          <div ref={docRef} style={docStyle} className="shadow-xl print:shadow-none" contentEditable={docEditMode} suppressContentEditableWarning>

            {/* Timbre */}
            <div style={{ textAlign: "center", paddingBottom: "10pt", marginBottom: "14pt" }}>
              <img
                data-brasao="true"
                src="/brasao.png"
                alt="Brasão da República Federativa do Brasil"
                style={{ height: `${cfg.brasaoSize ?? 110}px`, width: `${cfg.brasaoSize ?? 110}px`, display: "block", margin: "0 auto 6pt" }}
                onError={(e) => {
                  const img = e.currentTarget as HTMLImageElement;
                  if (!img.dataset.tried) {
                    img.dataset.tried = "1";
                    img.src = "https://upload.wikimedia.org/wikipedia/commons/thumb/9/9d/Coat_of_arms_of_Brazil.svg/160px-Coat_of_arms_of_Brazil.svg.png";
                  } else {
                    img.style.display = "none";
                  }
                }}
              />
              <div style={{ fontSize: "9pt", fontWeight: "bold", color: "#000" }}>MINISTÉRIO DA DEFESA</div>
              <div style={{ fontSize: "9pt", color: "#000" }}>COMANDO DA AERONÁUTICA</div>
              <div style={{ fontSize: "10pt", textDecoration: "underline", color: "#000" }}>GRUPAMENTO DE APOIO DE MANAUS</div>
            </div>

            {/* Título */}
            <div style={{ textAlign: "center", marginBottom: "14pt" }}>
              <div>TERMO DE APOSTILAMENTO</div>
              <div>ATA DE REGISTRO DE PREÇOS</div>
              <div style={{ fontWeight: "bold" }}>N.º {numeroAta}</div>
            </div>

            {/* Assunto */}
            <p style={{ marginBottom: "12pt" }}>
              <span style={{ fontWeight: "bold" }}>Assunto:</span> Reajuste de preços da ata de registro de preços n.º {numeroAta} referente ao Pregão
              eletrônico {compra ?? "________"} – NUP {cfg.nup || "________________"}
            </p>

            {/* Parágrafo de abertura */}
            {cfg.txt_abertura ? (
              <p style={{ textAlign: "justify", marginBottom: "14pt", whiteSpace: "pre-wrap" }}>{cfg.txt_abertura}</p>
            ) : (
              <p style={{ textAlign: "justify", marginBottom: "14pt" }}>
                O GRUPAMENTO DE APOIO DE MANAUS, com sede em {cfg.gapmn_sede || "AV. PRESIDENTE KENNEDY, 1700 MANAUS-AM"},
                inscrito(a) no CNPJ/MF sob o n.º {cfg.gapmn_cnpj || "00.394.429/0188-24"}, neste ato representado
                pela {cfg.representanteNome}, nomeado(a) pela {cfg.representantePortaria}, publicada
                no {cfg.representanteBoletim}, inscrito(a) no CPF sob o n.º {cfg.representanteCpf},
                portador(a) da Carteira de Identidade n.º {cfg.representanteIdentidade}, considerando
                o julgamento da licitação na modalidade de pregão, na forma eletrônica, para REGISTRO
                DE PREÇOS n.º {compra ?? "________"}, publicada no Diário Oficial
                de {cfg.dofReferencia}, processo administrativo {cfg.processoAdm || "________________"},
                RESOLVE lavrar o presente Termo de Apostilamento à Ata de Registro de Preços
                n.º {numeroAta}, em conformidade com as disposições a seguir:
              </p>
            )}

            {/* 1. DO OBJETO */}
            <p style={{ fontWeight: "bold", marginBottom: "6pt" }}>1. DO OBJETO</p>
            {cfg.txt_11 ? (
              <p style={{ textAlign: "justify", marginBottom: "10pt", whiteSpace: "pre-wrap" }}>{cfg.txt_11}</p>
            ) : (
              <p style={{ textAlign: "justify", marginBottom: "10pt" }}>
                1.1 O presente instrumento tem por objeto formalizar o reajuste de preços dos itens
                registrados na Ata de Registro de Preços n.º {numeroAta} com fulcro no art. 136,
                inciso I, da Lei n.º 14.133/2021, visando à recomposição do valor aquisitivo da moeda.
              </p>
            )}
            <p style={{ textAlign: "justify", marginBottom: "16pt" }}>
              1.2. O reajuste decorre do transcurso do interregno de 12 (doze) meses e foi calculado
              com base na variação do índice {effIndice}, acumulado no período
              de {effPeriodoInicio} a {effPeriodoFim},
              correspondente ao percentual
              de {effPct}%{effExtenso ? ` (${effExtenso})` : ""}.
            </p>

            {/* Quebra de página antes das tabelas */}
            {cfg.quebrarAntesTabela && (
              <div className="pg" style={{ pageBreakBefore: "always", breakBefore: "page" }} />
            )}

            {/* Tabelas por fornecedor */}
            {loadingItens ? (
              <p style={{ textAlign: "center", color: "#666", padding: "20pt 0" }}>Carregando itens…</p>
            ) : byFornecedor.length === 0 ? (
              <p style={{ textAlign: "center", color: "#666", padding: "20pt 0" }}>Nenhum item registrado para esta ATA.</p>
            ) : byFornecedor.map((grupo, gi) => {
              const totalGrupo = grupo.itens.reduce((s, item) => {
                const vuR = activeIpca && item.valor_unitario ? item.valor_unitario * activeIpca.fator : 0;
                return s + vuR * (item.quantidade_registrada ?? 0);
              }, 0);
              return (
                <div key={gi} style={{ marginBottom: "14pt", pageBreakInside: "avoid" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse" }}>
                    <thead>
                      <tr>
                        <td colSpan={7} style={{ border: "1px solid #666", padding: "4pt 6pt", fontWeight: "bold", fontSize: "10pt", background: "#f0f0f0", color: "#000" }}>
                          RAZÃO: {grupo.razao.toUpperCase()}
                        </td>
                      </tr>
                      <tr>
                        <td colSpan={7} style={{ border: "1px solid #666", borderTop: "none", padding: "2pt 6pt", fontSize: "9pt", background: "#fff", color: "#000" }}>
                          CNPJ: {grupo.cnpj}
                        </td>
                      </tr>
                      <tr style={{ background: "#e0e0e0", fontSize: "9pt", fontWeight: "bold", textAlign: "center", color: "#000" }}>
                        <th style={{ border: "1px solid #666", padding: "3pt 4pt", width: "6%" }}>ITEM</th>
                        <th style={{ border: "1px solid #666", padding: "3pt 4pt", width: "36%", textAlign: "left" }}>DESCRIÇÃO</th>
                        <th style={{ border: "1px solid #666", padding: "3pt 4pt", width: "7%" }}>QTDE</th>
                        <th style={{ border: "1px solid #666", padding: "3pt 4pt", width: "6%" }}>UND</th>
                        <th style={{ border: "1px solid #666", padding: "3pt 4pt", width: "14%" }}>VALOR UNIT. ATUAL</th>
                        <th style={{ border: "1px solid #666", padding: "3pt 4pt", width: "15%" }}>VALOR UNIT. REAJUSTADO</th>
                        <th style={{ border: "1px solid #666", padding: "3pt 4pt", width: "16%" }}>VALOR TOTAL REAJUSTADO</th>
                      </tr>
                    </thead>
                    <tbody>
                      {grupo.itens.map((item, j) => {
                        const vu  = item.valor_unitario ?? 0;
                        const vuR = activeIpca ? vu * activeIpca.fator : null;
                        const tot = vuR != null ? vuR * (item.quantidade_registrada ?? 0) : null;
                        return (
                          <tr key={item.id} style={{ background: j % 2 === 0 ? "#fff" : "#f9f9f9", fontSize: "9pt", verticalAlign: "top", color: "#000", pageBreakInside: "avoid" }}>
                            <td style={{ border: "1px solid #999", padding: "3pt 4pt", textAlign: "center" }}>{item.numero_ata || String(j + 1).padStart(2, "0")}</td>
                            <td style={{ border: "1px solid #999", padding: "3pt 4pt" }}>{item.descricao || "–"}</td>
                            <td style={{ border: "1px solid #999", padding: "3pt 4pt", textAlign: "center" }}>{fmtQtd(item.quantidade_registrada)}</td>
                            <td style={{ border: "1px solid #999", padding: "3pt 4pt", textAlign: "center" }}>UN</td>
                            <td style={{ border: "1px solid #999", padding: "3pt 4pt", textAlign: "right" }}>{fmtBRL(item.valor_unitario)}</td>
                            <td style={{ border: "1px solid #999", padding: "3pt 4pt", textAlign: "right" }}>{vuR != null ? fmtBRL(vuR) : "–"}</td>
                            <td style={{ border: "1px solid #999", padding: "3pt 4pt", textAlign: "right" }}>{tot != null ? fmtBRL(tot) : "–"}</td>
                          </tr>
                        );
                      })}
                      <tr style={{ background: "#ebebeb", fontWeight: "bold", fontSize: "9pt", color: "#000" }}>
                        <td colSpan={6} style={{ border: "1px solid #999", padding: "3pt 6pt", textAlign: "right" }}>TOTAL:</td>
                        <td style={{ border: "1px solid #999", padding: "3pt 4pt", textAlign: "right" }}>{fmtBRL(totalGrupo)}</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              );
            })}

            {/* 2. DA RATIFICAÇÃO */}
            <p style={{ fontWeight: "bold", marginTop: "16pt", marginBottom: "6pt" }}>2. DA RATIFICAÇÃO</p>
            {cfg.txt_21 ? (
              <p style={{ textAlign: "justify", marginBottom: "16pt", whiteSpace: "pre-wrap" }}>{cfg.txt_21}</p>
            ) : (
              <p style={{ textAlign: "justify", marginBottom: "16pt" }}>
                2.1. Ficam ratificadas e inalteradas todas as demais cláusulas, condições e prazos
                estabelecidos na Ata de Registro de Preços n.º {numeroAta} e em seus anexos, que não
                colidam com as disposições do presente Termo de Apostilamento.
              </p>
            )}

            {/* 3. DA DIVULGAÇÃO */}
            <p style={{ fontWeight: "bold", marginBottom: "6pt" }}>3. DA DIVULGAÇÃO NO PNCP</p>
            {cfg.txt_31 ? (
              <p style={{ textAlign: "justify", marginBottom: "8pt", whiteSpace: "pre-wrap" }}>{cfg.txt_31}</p>
            ) : (
              <p style={{ textAlign: "justify", marginBottom: "8pt" }}>
                3.1. Incumbirá ao ÓRGÃO GERENCIADOR providenciar a divulgação deste instrumento no PNCP,
                de acordo com o prescrito no art. 18, § 4º, e art. 22 do Decreto n.º 11.462, de 2023.
              </p>
            )}
            {cfg.txt_final ? (
              <p style={{ textAlign: "justify", marginBottom: "36pt", whiteSpace: "pre-wrap" }}>{cfg.txt_final}</p>
            ) : (
              <p style={{ textAlign: "justify", marginBottom: "36pt" }}>
                Para firmeza e validade do que aqui ficou lavrado, assina-se o presente Termo de Apostilamento.
              </p>
            )}

            {/* Localidade e data */}
            <p style={{ textAlign: "center", marginBottom: "32pt", color: "#555", fontStyle: "italic", fontSize: "10pt" }}>
              Manaus, data conforme assinatura digital
            </p>

            {/* Quebra de página antes das assinaturas */}
            {cfg.quebrarAntesAssinaturas && (
              <div className="pg" style={{ pageBreakBefore: "always", breakBefore: "page" }} />
            )}

            {/* Assinaturas */}
            {hasEmpresa ? (
              <table style={{ width: "100%", borderCollapse: "collapse", marginTop: "4pt" }}>
                <tbody>
                  <tr>
                    <td style={{ width: "50%", verticalAlign: "top", paddingRight: "12pt" }}>
                      <div style={{ fontWeight: "bold", fontSize: "8pt", color: "#000", marginBottom: "20pt", textAlign: "center" }}>CONTRATANTE</div>
                      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "28pt" }}>
                        {cfg.signatarios.map(sig => (
                          <div key={sig.id} style={{ textAlign: "center" }}>
                            <div style={{ borderTop: "1px solid #000", paddingTop: "4pt", minWidth: "180pt", display: "inline-block" }}>
                              <div style={{ fontWeight: "bold", color: "#000", fontSize: "9pt" }}>{sig.nome}</div>
                              <div style={{ color: "#000", fontSize: "8pt" }}>{sig.cargo}</div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </td>
                    <td style={{ width: "50%", verticalAlign: "top", paddingLeft: "12pt", borderLeft: "1px solid #ccc" }}>
                      <div style={{ fontWeight: "bold", fontSize: "8pt", color: "#000", marginBottom: "20pt", textAlign: "center" }}>CONTRATADA</div>
                      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "28pt" }}>
                        {cfg.showRepresentante && (
                          <div style={{ textAlign: "center" }}>
                            <div style={{ borderTop: "1px solid #000", paddingTop: "4pt", minWidth: "180pt", display: "inline-block" }}>
                              <div style={{ fontWeight: "bold", color: "#000", fontSize: "9pt" }}>{cfg.representanteEmpresaNome || "______________________________"}</div>
                              <div style={{ color: "#000", fontSize: "8pt" }}>Representante da Empresa</div>
                            </div>
                          </div>
                        )}
                        {cfg.showTestemunha1 && (
                          <div style={{ textAlign: "center" }}>
                            <div style={{ borderTop: "1px solid #000", paddingTop: "4pt", minWidth: "180pt", display: "inline-block" }}>
                              <div style={{ fontWeight: "bold", color: "#000", fontSize: "9pt" }}>{cfg.testemunha1 || "______________________________"}</div>
                              <div style={{ color: "#000", fontSize: "8pt" }}>Testemunha</div>
                            </div>
                          </div>
                        )}
                        {cfg.showTestemunha2 && (
                          <div style={{ textAlign: "center" }}>
                            <div style={{ borderTop: "1px solid #000", paddingTop: "4pt", minWidth: "180pt", display: "inline-block" }}>
                              <div style={{ fontWeight: "bold", color: "#000", fontSize: "9pt" }}>{cfg.testemunha2 || "______________________________"}</div>
                              <div style={{ color: "#000", fontSize: "8pt" }}>Testemunha</div>
                            </div>
                          </div>
                        )}
                      </div>
                    </td>
                  </tr>
                </tbody>
              </table>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "28pt" }}>
                {cfg.signatarios.map(sig => (
                  <div key={sig.id} style={{ textAlign: "center" }}>
                    <div style={{ borderTop: "1px solid #000", paddingTop: "4pt", minWidth: "220pt", display: "inline-block" }}>
                      <div style={{ fontWeight: "bold", color: "#000" }}>{sig.nome}</div>
                      <div style={{ color: "#000", fontSize: "9pt" }}>{sig.cargo}</div>
                    </div>
                  </div>
                ))}
              </div>
            )}

          </div>
          )}
        </div>
      </div>

    </div>
  );
}
