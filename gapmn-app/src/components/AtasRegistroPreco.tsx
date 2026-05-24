import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { supabase } from "../lib/supabase";

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

// ── componente principal ────────────────────────────────────────────────────
interface Props { canSync: boolean }

export default function AtasRegistroPreco({ canSync }: Props) {
  const [atas, setAtas]         = useState<Ata[]>([]);
  const [loading, setLoading]   = useState(true);
  const [busca, setBusca]       = useState("");
  const [filtro, setFiltro]     = useState<"todas" | "ativas" | "encerradas">("ativas");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [itensMap, setItensMap] = useState<Map<string, ItemAta[]>>(new Map());
  const [loadingItens, setLoadingItens] = useState<string | null>(null);
  const [showInstrucoes, setShowInstrucoes] = useState(false);
  const [copiado, setCopiado]   = useState(false);

  // upload de Termo de Referência
  const fileInputRef                          = useRef<HTMLInputElement>(null);
  const [uploadTargetAta, setUploadTargetAta] = useState<string | null>(null);
  const [uploading, setUploading]             = useState(false);

  const loadAtas = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase
      .from("atas_gap_mn")
      .select("*")
      .order("vigencia_final", { ascending: false });
    if (data) setAtas(data as Ata[]);
    setLoading(false);
  }, []);

  useEffect(() => { loadAtas(); }, [loadAtas]);

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
      setItensMap(prev => new Map(prev).set(numeroAta, (data as ItemAta[]) ?? []));
      setLoadingItens(null);
    }
  }

  async function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || !uploadTargetAta) return;
    setUploading(true);
    try {
      const ext  = file.name.split(".").pop() ?? "pdf";
      const path = `${uploadTargetAta.replace("/", "-")}-${Date.now()}.${ext}`;
      const { error: upErr } = await supabase.storage
        .from("atas-docs").upload(path, file, { upsert: true });
      if (upErr) throw upErr;
      const { data: { publicUrl } } = supabase.storage
        .from("atas-docs").getPublicUrl(path);
      const { error: updErr } = await supabase
        .from("atas_gap_mn").update({ pdf_url: publicUrl }).eq("numero_ata", uploadTargetAta);
      if (updErr) throw updErr;
      setAtas(prev => prev.map(a =>
        a.numero_ata === uploadTargetAta ? { ...a, pdf_url: publicUrl } : a
      ));
    } catch (err: unknown) {
      alert("Erro ao enviar: " + (err instanceof Error ? err.message : String(err)));
    } finally {
      setUploading(false);
      setUploadTargetAta(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  const filtradas = useMemo(() => {
    let list = atas;
    if (filtro === "ativas")     list = list.filter(a => !isVencida(a.vigencia_final) && !/cancelad/i.test(a.situacao ?? ""));
    if (filtro === "encerradas") list = list.filter(a => isVencida(a.vigencia_final) || /cancelad|encerrad/i.test(a.situacao ?? ""));
    if (!busca.trim()) return list;
    const q = busca.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
    return list.filter(a =>
      [a.numero_ata, a.situacao, a.tipo_uasg]
        .join(" ").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").includes(q)
    );
  }, [atas, busca, filtro]);

  const ativas     = atas.filter(a => !isVencida(a.vigencia_final) && !/cancelad/i.test(a.situacao ?? "")).length;
  const encerradas = atas.length - ativas;

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
          <div className="flex items-center gap-2">
            <button
              onClick={loadAtas} disabled={loading}
              title="Buscar dados atualizados do banco"
              className="flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-50 transition-colors"
            >
              <span className={loading ? "animate-spin inline-block" : ""}>↻</span>
              Atualizar
            </button>
            <input
              type="text" value={busca} onChange={e => setBusca(e.target.value)}
              placeholder="Buscar nº ATA…"
              className="rounded-xl border border-slate-200 px-3 py-1.5 text-sm w-44 focus:outline-none focus:ring-2 focus:ring-sky-300"
            />
          </div>
        </div>

        {/* Filtros */}
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

        {/* Bookmarklet */}
        {canSync && (
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800 space-y-2">
            <div className="flex items-center justify-between">
              <span className="font-semibold">📋 Sincronizar ATAs via robô</span>
              <button onClick={() => setShowInstrucoes(v => !v)} className="text-amber-700 hover:text-amber-900 underline text-[11px]">
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
                  <th className="px-3 py-2 whitespace-nowrap">Tipo UASG</th>
                  <th className="px-3 py-2 whitespace-nowrap">Situação</th>
                  <th className="px-3 py-2 whitespace-nowrap">Vigência Inicial</th>
                  <th className="px-3 py-2 whitespace-nowrap">Vigência Final</th>
                  <th className="px-3 py-2 whitespace-nowrap text-center">Termo de Referência</th>
                </tr>
              </thead>
              <tbody>
                {filtradas.map((a, i) => {
                  const isExp    = expanded === a.numero_ata;
                  const itens    = itensMap.get(a.numero_ata) ?? [];
                  const carregando = loadingItens === a.numero_ata;
                  const isUpload = uploading && uploadTargetAta === a.numero_ata;
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
                        <td className="px-3 py-2 text-xs whitespace-nowrap text-slate-600">{a.tipo_uasg || "–"}</td>
                        <td className="px-3 py-2 whitespace-nowrap">
                          <span className={sitBadge(a.situacao)}>{a.situacao || "–"}</span>
                        </td>
                        <td className="px-3 py-2 text-xs whitespace-nowrap">{fmtDate(a.vigencia_inicial)}</td>
                        <td className={`px-3 py-2 text-xs whitespace-nowrap ${isVencida(a.vigencia_final) ? "text-red-600 font-semibold" : ""}`}>
                          {fmtDate(a.vigencia_final)}
                        </td>
                        <td className="px-3 py-2 text-center" onClick={e => e.stopPropagation()}>
                          <div className="flex items-center justify-center gap-1">
                            {a.pdf_url && (
                              <a href={a.pdf_url} target="_blank" rel="noopener noreferrer"
                                className="inline-flex items-center gap-1 rounded-lg bg-sky-50 border border-sky-200 px-2 py-1 text-xs text-sky-700 hover:bg-sky-100 font-medium whitespace-nowrap">
                                📄 Ver TR
                              </a>
                            )}
                            {canSync && (
                              <button
                                disabled={isUpload}
                                onClick={() => { setUploadTargetAta(a.numero_ata); fileInputRef.current?.click(); }}
                                className="inline-flex items-center gap-1 rounded-lg bg-emerald-50 border border-emerald-200 px-2 py-1 text-xs text-emerald-700 hover:bg-emerald-100 font-medium whitespace-nowrap disabled:opacity-50"
                                title="Inserir Termo de Referência"
                              >
                                {isUpload ? "…" : (a.pdf_url ? "📎 Alterar" : "📎 Inserir")}
                              </button>
                            )}
                            {!a.pdf_url && !canSync && (
                              <span className="text-slate-300 text-xs">–</span>
                            )}
                          </div>
                        </td>
                      </tr>

                      {/* Painel de itens expandido */}
                      {isExp && (
                        <tr key={a.numero_ata + "-itens"} className="border-t border-slate-100">
                          <td colSpan={7} className="px-0 py-0 bg-slate-50">
                            {carregando ? (
                              <div className="px-6 py-3 text-xs text-slate-400">Carregando itens…</div>
                            ) : itens.length === 0 ? (
                              <div className="px-6 py-3 text-xs text-slate-400">
                                Nenhum item registrado para esta ATA. Execute o robô para capturar.
                              </div>
                            ) : (
                              <div className="overflow-x-auto">
                                {/* info de compra + totais */}
                                <div className="px-4 py-2 flex items-center gap-3 text-[11px] text-slate-500 border-b border-slate-200 bg-slate-100">
                                  {itens[0]?.numero_compra && (
                                    <span className="font-semibold text-slate-700">
                                      🛒 Compra: {itens[0].numero_compra}
                                    </span>
                                  )}
                                  <span>{itens.length} item(s)</span>
                                  <span>Valor total: <strong>{fmtBRL(itens.reduce((s, it) => s + (it.valor_total ?? 0), 0))}</strong></span>
                                </div>
                                <table className="w-full text-xs border-collapse">
                                  <thead>
                                    <tr className="text-left font-semibold text-slate-500 bg-slate-100 border-b border-slate-200">
                                      <th className="px-3 py-1.5 whitespace-nowrap">Item(s)</th>
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
                                    ))}
                                  </tbody>
                                </table>
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
