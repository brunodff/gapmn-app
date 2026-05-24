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

// Próximo reajuste: início = data_orcamento + 11 meses; avança ciclos de 12 meses
// até uma data futura. Ex: 11/2024 → (10/2025 passado) → 10/2026 ✓
function proxReajusteDate(dataOrcamento: string): Date {
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
  const [sortByReajuste, setSortByReajuste] = useState(false);
  const [apostilamentoAta, setApostilamentoAta] = useState<string | null>(null);
  const [previewAta,       setPreviewAta]       = useState<string | null>(null);

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

  // Carrega IPCA e itens ao abrir o card de prévia (ou o modal direto)
  useEffect(() => {
    const ata = previewAta ?? apostilamentoAta;
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
    if (!itensMap.has(ata)) {
      setLoadingItens(ata);
      supabase.from("itens_ata_gap_mn").select("*")
        .eq("ata_numero", ata).order("numero_ata")
        .then(({ data }) => {
          setItensMap((prev) => new Map(prev).set(ata, (data as ItemAta[]) ?? []));
          setLoadingItens(null);
        });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [previewAta, apostilamentoAta]);

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
            onOpenDoc={() => { setApostilamentoAta(previewAta); setPreviewAta(null); }}
          />
        );
      })()}

      {/* Modal de Apostilamento */}
      {apostilamentoAta && (() => {
        const compra = compraMap.get(apostilamentoAta) ?? null;
        const tr     = compra ? (comprasTrMap.get(compra) ?? null) : null;
        const itens  = itensMap.get(apostilamentoAta) ?? [];
        const ipca   = compra ? (ipcaMap.get(compra) ?? undefined) : undefined;
        return (
          <ApostilamentoModal
            numeroAta={apostilamentoAta}
            compra={compra}
            tr={tr}
            itens={itens}
            loadingItens={loadingItens === apostilamentoAta}
            ipcaResult={ipca}
            onClose={() => setApostilamentoAta(null)}
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
                  <th className="px-3 py-2 whitespace-nowrap text-amber-600">📅 Próx. Reajuste</th>
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
                        <td className="px-3 py-2 text-xs whitespace-nowrap font-semibold text-amber-700">
                          {tr?.data_orcamento ? proxReajusteDisplay(tr.data_orcamento) : "–"}
                        </td>
                        <td className="px-3 py-2 text-center" onClick={(e) => e.stopPropagation()}>
                          <div className="flex items-center justify-center gap-1 flex-wrap">
                            {tr?.data_orcamento && (
                              <button
                                onClick={() => setPreviewAta(a.numero_ata)}
                                className="inline-flex items-center gap-1 rounded-lg bg-amber-50 border border-amber-300 px-2 py-1 text-xs text-amber-800 hover:bg-amber-100 font-medium whitespace-nowrap"
                                title="Gerar Termo de Apostilamento com cálculo de reajuste"
                              >
                                📜 Gerar Termo de Apostilamento
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
                                {isUpload ? "…" : (hasTR ? "📎 Alterar" : "📎 Inserir TR")}
                              </button>
                            )}
                            {!hasTR && !canSync && !tr?.data_orcamento && (
                              <span className="text-slate-300 text-xs">–</span>
                            )}
                          </div>
                        </td>
                      </tr>

                      {/* Painel expandido */}
                      {isExp && (
                        <tr key={a.numero_ata + "-itens"} className="border-t border-slate-100">
                          <td colSpan={8} className="px-0 py-0 bg-slate-50">
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
                                      <span className="text-amber-600">Reajuste disponível — clique em "Gerar Termo de Apostilamento"</span>
                                    )}
                                  </div>
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
                                        <th className="px-3 py-1.5 whitespace-nowrap text-right">Valor Total</th>
                                        <th className="px-3 py-1.5 whitespace-nowrap text-center">Adesão</th>
                                      </tr>
                                    </thead>
                                    <tbody>
                                      {itens.map((item, j) => {
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

// ── Config localStorage ────────────────────────────────────────────────────
const LS_APT = "gapmn_apt_config";

type AptConfig = {
  nup: string;
  processoAdm: string;
  dofReferencia: string;
  representanteNome: string;
  representantePortaria: string;
  representanteBoletim: string;
  representanteCpf: string;
  representanteIdentidade: string;
  percentualExtenso: string;
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
  percentualExtenso: "",
  gestorNome: "GABRIELA DE ANDRADE CAVALCANTI TRINDADE 1º Ten QOINT",
  gestorCargo: "Gestor de Licitações",
  agenteCINome: "MAINÃ FARIA CUNHA DE JESUS Cap INT",
  agenteCICargo: "Agente de Controle Interno",
  ordenadorNome: "SUSAN KELLY PRADO ANDRADE Cel Int",
  ordenadorCargo: "Ordenador de Despesas",
};

function loadAptCfg(): AptConfig {
  try {
    const raw = localStorage.getItem(LS_APT);
    return raw ? { ...DEFAULT_APT, ...JSON.parse(raw) } : { ...DEFAULT_APT };
  } catch { return { ...DEFAULT_APT }; }
}
function saveAptCfg(cfg: AptConfig) {
  try { localStorage.setItem(LS_APT, JSON.stringify(cfg)); } catch {}
}

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
    ? ipcaResult.percentual.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    : null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden">
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
function ApostilamentoModal({
  numeroAta, compra, itens, loadingItens, ipcaResult, onClose,
}: {
  numeroAta: string;
  compra: string | null;
  tr: CompraTR | null;
  itens: ItemAta[];
  loadingItens: boolean;
  ipcaResult?: IpcaResult | null;
  onClose: () => void;
}) {
  const [cfg,     setCfg]     = useState<AptConfig>(loadAptCfg);
  const [draft,   setDraft]   = useState<AptConfig>(loadAptCfg);
  const [showCfg, setShowCfg] = useState(false);
  const docRef = useRef<HTMLDivElement>(null);

  function handlePrint() {
    const el = docRef.current;
    if (!el) { window.print(); return; }
    const pw = window.open("", "_blank", "width=900,height=700");
    if (!pw) { window.print(); return; }
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
</style>
</head>
<body>${el.outerHTML}<script>window.onload=function(){window.print();};<\/script></body>
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

  function setDraftField(k: keyof AptConfig, v: string) {
    setDraft((prev) => ({ ...prev, [k]: v }));
  }
  function salvarCfg() {
    saveAptCfg(draft);
    setCfg({ ...draft });
    setShowCfg(false);
  }

  const pct = ipcaResult
    ? ipcaResult.percentual.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    : "____";

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

  const CFG_FIELDS: { key: keyof AptConfig; label: string }[] = [
    { key: "nup",                    label: "NUP" },
    { key: "processoAdm",            label: "Processo Administrativo" },
    { key: "dofReferencia",          label: "Referência — Diário Oficial" },
    { key: "representanteNome",      label: "Representante GAP-MN (nome + posto/graduação)" },
    { key: "representantePortaria",  label: "Portaria de nomeação" },
    { key: "representanteBoletim",   label: "Boletim COMAER (publicação da portaria)" },
    { key: "representanteCpf",       label: "CPF do representante" },
    { key: "representanteIdentidade",label: "Identidade do representante" },
    { key: "percentualExtenso",      label: "Percentual IPCA por extenso (ex: quatro vírgula trinta e nove por cento)" },
    { key: "gestorNome",             label: "Gestor de Licitações — nome + graduação" },
    { key: "gestorCargo",            label: "Gestor de Licitações — cargo" },
    { key: "agenteCINome",           label: "Agente de Controle Interno — nome + graduação" },
    { key: "agenteCICargo",          label: "Agente de Controle Interno — cargo" },
    { key: "ordenadorNome",          label: "Ordenador de Despesas — nome + graduação" },
    { key: "ordenadorCargo",         label: "Ordenador de Despesas — cargo" },
  ];

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-slate-200 overflow-hidden">

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
            onClick={handlePrint}
            className="flex items-center gap-1.5 rounded-lg bg-sky-600 hover:bg-sky-500 px-3 py-1.5 text-xs font-medium text-white transition-colors"
          >
            🖨 Imprimir / PDF
          </button>
          <button onClick={onClose} className="text-slate-400 hover:text-white text-xl px-2 leading-none">✕</button>
        </div>
      </div>

      {/* Corpo — painel de config + documento */}
      <div className="flex flex-1 overflow-hidden print:block print:overflow-visible">

        {/* Painel de campos editáveis — oculto na impressão */}
        {showCfg && (
          <div className="print:hidden w-80 shrink-0 bg-white border-r border-slate-200 overflow-y-auto flex flex-col">
            <div className="p-4 space-y-3 flex-1">
              <div className="text-sm font-bold text-slate-800">Campos Editáveis</div>
              <p className="text-xs text-slate-500 leading-relaxed">
                Estas informações são salvas no navegador e reutilizadas automaticamente na próxima ATA.
                Altere apenas o que mudou.
              </p>
              {CFG_FIELDS.map(({ key, label }) => (
                <div key={key}>
                  <label className="block text-[11px] font-semibold text-slate-500 mb-0.5">{label}</label>
                  <input
                    value={draft[key]}
                    onChange={(e) => setDraftField(key, e.target.value)}
                    className="w-full rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-sky-200"
                  />
                </div>
              ))}
            </div>
            <div className="p-4 border-t border-slate-100 shrink-0">
              <button
                onClick={salvarCfg}
                className="w-full rounded-lg bg-emerald-600 text-white py-2 text-xs font-semibold hover:bg-emerald-700 transition-colors"
              >
                ✓ Salvar e aplicar
              </button>
            </div>
          </div>
        )}

        {/* Área do documento */}
        <div className="flex-1 overflow-y-auto py-8 px-4 print:p-0 print:overflow-visible flex justify-center">
          <div ref={docRef} style={docStyle} className="shadow-xl print:shadow-none">

            {/* Timbre */}
            <div style={{ textAlign: "center", borderBottom: "2px solid #000", paddingBottom: "10pt", marginBottom: "14pt" }}>
              <img
                src="/brasao.png"
                alt="Brasão da República Federativa do Brasil"
                style={{ height: "55pt", display: "block", margin: "0 auto 6pt" }}
                onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
              />
              <div style={{ fontSize: "9pt", fontWeight: "bold", color: "#000" }}>MINISTÉRIO DA DEFESA</div>
              <div style={{ fontSize: "9pt", fontWeight: "bold", color: "#000" }}>COMANDO DA AERONÁUTICA</div>
              <div style={{ fontSize: "10pt", fontWeight: "bold", color: "#000" }}>GRUPAMENTO DE APOIO DE MANAUS</div>
            </div>

            {/* Título */}
            <div style={{ textAlign: "center", marginBottom: "14pt" }}>
              <div style={{ fontWeight: "bold" }}>TERMO DE APOSTILAMENTO</div>
              <div style={{ fontWeight: "bold" }}>ATA DE REGISTRO DE PREÇOS</div>
              <div style={{ fontWeight: "bold" }}>N.º {numeroAta}</div>
            </div>

            {/* Assunto */}
            <p style={{ marginBottom: "12pt" }}>
              <strong>Assunto:</strong> Reajuste de preços da ata de registro de preços n.º {numeroAta} referente ao Pregão
              eletrônico {compra ?? "________"} – NUP {cfg.nup || "________________"}
            </p>

            {/* Parágrafo de abertura */}
            <p style={{ textAlign: "justify", marginBottom: "14pt" }}>
              O GRUPAMENTO DE APOIO DE MANAUS, com sede em AV. PRESIDENTE KENNEDY, 1700 MANAUS-AM,
              inscrito(a) no CNPJ/MF sob o n.º 00.394.429/0188-24, neste ato representado
              pela {cfg.representanteNome}, nomeado(a) pela {cfg.representantePortaria}, publicada
              no {cfg.representanteBoletim}, inscrito(a) no CPF sob o n.º {cfg.representanteCpf},
              portador(a) da Carteira de Identidade n.º {cfg.representanteIdentidade}, considerando
              o julgamento da licitação na modalidade de pregão, na forma eletrônica, para REGISTRO
              DE PREÇOS n.º {compra ?? "________"}, publicada no Diário Oficial
              de {cfg.dofReferencia}, processo administrativo {cfg.processoAdm || "________________"},
              RESOLVE lavrar o presente Termo de Apostilamento à Ata de Registro de Preços
              n.º {numeroAta}, em conformidade com as disposições a seguir:
            </p>

            {/* 1. DO OBJETO */}
            <p style={{ fontWeight: "bold", marginBottom: "6pt" }}>1. DO OBJETO</p>
            <p style={{ textAlign: "justify", marginBottom: "10pt" }}>
              1.1 O presente instrumento tem por objeto formalizar o reajuste de preços dos itens
              registrados na Ata de Registro de Preços n.º {numeroAta} com fulcro no art. 136,
              inciso I, da Lei n.º 14.133/2021, visando à recomposição do valor aquisitivo da moeda.
            </p>
            <p style={{ textAlign: "justify", marginBottom: "16pt" }}>
              1.2. O reajuste decorre do transcurso do interregno de 12 (doze) meses e foi calculado
              com base na variação do índice IPCA, acumulado no período
              de {ipcaResult?.periodoInicio ?? "______"} a {ipcaResult?.periodoFim ?? "______"},
              correspondente ao percentual
              de {pct}%{cfg.percentualExtenso ? ` (${cfg.percentualExtenso})` : ""}.
            </p>

            {/* Tabelas por fornecedor */}
            {loadingItens ? (
              <p style={{ textAlign: "center", color: "#666", padding: "20pt 0" }}>Carregando itens…</p>
            ) : byFornecedor.length === 0 ? (
              <p style={{ textAlign: "center", color: "#666", padding: "20pt 0" }}>Nenhum item registrado para esta ATA.</p>
            ) : byFornecedor.map((grupo, gi) => {
              const totalGrupo = grupo.itens.reduce((s, item) => {
                const vuR = ipcaResult && item.valor_unitario ? item.valor_unitario * ipcaResult.fator : 0;
                return s + vuR * (item.quantidade_registrada ?? 0);
              }, 0);
              return (
                <div key={gi} style={{ marginBottom: "14pt" }}>
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
                        const vuR = ipcaResult ? vu * ipcaResult.fator : null;
                        const tot = vuR != null ? vuR * (item.quantidade_registrada ?? 0) : null;
                        return (
                          <tr key={item.id} style={{ background: j % 2 === 0 ? "#fff" : "#f9f9f9", fontSize: "9pt", verticalAlign: "top", color: "#000" }}>
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
            <p style={{ textAlign: "justify", marginBottom: "16pt" }}>
              2.1. Ficam ratificadas e inalteradas todas as demais cláusulas, condições e prazos
              estabelecidos na Ata de Registro de Preços n.º {numeroAta} e em seus anexos, que não
              colidam com as disposições do presente Termo de Apostilamento.
            </p>

            {/* 3. DA DIVULGAÇÃO */}
            <p style={{ fontWeight: "bold", marginBottom: "6pt" }}>3. DA DIVULGAÇÃO NO PNCP</p>
            <p style={{ textAlign: "justify", marginBottom: "8pt" }}>
              3.1. Incumbirá ao ÓRGÃO GERENCIADOR providenciar a divulgação deste instrumento no PNCP,
              de acordo com o prescrito no art. 18, § 4º, e art. 22 do Decreto n.º 11.462, de 2023.
            </p>
            <p style={{ textAlign: "justify", marginBottom: "36pt" }}>
              Para firmeza e validade do que aqui ficou lavrado, assina-se o presente Termo de Apostilamento.
            </p>

            {/* Localidade e data */}
            <p style={{ textAlign: "center", marginBottom: "32pt", color: "#555", fontStyle: "italic", fontSize: "10pt" }}>
              Manaus, data conforme assinatura digital
            </p>

            {/* Assinaturas */}
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "28pt" }}>
              {[
                { nome: cfg.gestorNome,    cargo: cfg.gestorCargo    },
                { nome: cfg.agenteCINome,  cargo: cfg.agenteCICargo  },
                { nome: cfg.ordenadorNome, cargo: cfg.ordenadorCargo },
              ].map((sig, i) => (
                <div key={i} style={{ textAlign: "center" }}>
                  <div style={{ borderTop: "1px solid #000", paddingTop: "4pt", minWidth: "220pt", display: "inline-block" }}>
                    <div style={{ fontWeight: "bold", color: "#000" }}>{sig.nome}</div>
                    <div style={{ color: "#000", fontSize: "9pt" }}>{sig.cargo}</div>
                  </div>
                </div>
              ))}
            </div>

          </div>
        </div>
      </div>

    </div>
  );
}
