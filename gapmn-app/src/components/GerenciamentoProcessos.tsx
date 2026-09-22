import { useState, useEffect, useMemo, Fragment } from "react";
import { utils, writeFile } from "xlsx";
import { supabase } from "../lib/supabase";
import { Card } from "./Card";

// ─── Tipos ───────────────────────────────────────────────────────────────────
type CnetProcesso = {
  id: number;
  identificacao: string;
  numero: string;
  ano: string;
  situacao: string;
  acao: string;
  acao_url: string;
  possui_pendencia: boolean;
  agrupamento: string;
  sincronizado_em: string;
};

type CnetItem = {
  id: number;
  numero_item: number;
  descricao: string | null;
  descricao_detalhada: string | null;
  unidade: string | null;
  quantidade: number | null;
  valor_estimado_unitario: number | null;
  valor_estimado_total: number | null;
  situacao: string | null;
  homologado: boolean;
  lote: string | null;
  vencedor_cnpj: string | null;
  vencedor_nome: string | null;
  valor_vencedor_unitario: number | null;
  valor_vencedor_total: number | null;
  grupo_numero: number | null;
};

type CnetParticipante = {
  id: number;
  cnpj: string;
  nome: string | null;
  me_epp: boolean;
  qtd_itens_selecao: number | null;
};

// ─── Helpers ─────────────────────────────────────────────────────────────────
function classeSit(s: string): string {
  const l = (s ?? "").toLowerCase();
  if (/homolog/.test(l))                                                                        return "bg-emerald-100 border-emerald-300 text-emerald-800";
  if (/desert/.test(l))                                                                         return "bg-amber-100 border-amber-300 text-amber-800";
  if (/fracass/.test(l))                                                                        return "bg-orange-100 border-orange-300 text-orange-800";
  if (/cancel/.test(l))                                                                         return "bg-red-100 border-red-300 text-red-700";
  if (/revog/.test(l))                                                                          return "bg-purple-100 border-purple-300 text-purple-800";
  if (/anulad/.test(l))                                                                         return "bg-pink-100 border-pink-300 text-pink-800";
  if (/julgamento|adjudic|abertura|aguardando|andamento|analise|recurso|proposta|selec/.test(l)) return "bg-sky-50 border-sky-200 text-sky-800";
  return "bg-amber-50 border-amber-200 text-amber-800";
}

function fmtDateTime(d: string | null | undefined): string {
  if (!d) return "-";
  try { return new Date(d).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" }); }
  catch { return d; }
}

function fmtBRL(v: number | null | undefined): string {
  if (v == null) return "—";
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function fmtCnpj(cnpj: string): string {
  const n = cnpj.replace(/\D/g, "");
  if (n.length === 14) return n.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, "$1.$2.$3/$4-$5");
  return cnpj;
}

// ─── Componente principal ────────────────────────────────────────────────────
interface GerProcessosProps { canImport?: boolean; canEdit?: boolean; canEditElaboracao?: boolean; }
export default function GerenciamentoProcessos({ canImport = true, canEdit = false }: GerProcessosProps) {
  const [processos, setProcessos] = useState<CnetProcesso[]>([]);
  const [loading, setLoading]     = useState(true);
  const [err, setErr]             = useState<string | null>(null);
  const [selected, setSelected]   = useState<CnetProcesso | null>(null);

  // Detail data
  const [itens,          setItens]          = useState<CnetItem[]>([]);
  const [participantes,  setParticipantes]  = useState<CnetParticipante[]>([]);
  const [loadingDetail,  setLoadingDetail]  = useState(false);
  const [activeTab,      setActiveTab]      = useState<"itens" | "fornecedores">("itens");

  // Filtros
  const [filtroAno,   setFiltroAno]   = useState("todos");
  const [filtroSit,   setFiltroSit]   = useState("todos");
  const [filtroGrupo, setFiltroGrupo] = useState("todos");
  const [filtroTexto, setFiltroTexto] = useState("");
  const [expandedGroups, setExpandedGroups] = useState<Set<number>>(new Set());
  const [expandedItems,  setExpandedItems]  = useState<Set<number>>(new Set());

  function toggleGroup(n: number) {
    setExpandedGroups(prev => { const s = new Set(prev); s.has(n) ? s.delete(n) : s.add(n); return s; });
  }
  function toggleItem(n: number) {
    setExpandedItems(prev => { const s = new Set(prev); s.has(n) ? s.delete(n) : s.add(n); return s; });
  }

  useEffect(() => { load(); }, []);

  async function load() {
    setLoading(true); setErr(null);
    try {
      const { data, error } = await supabase
        .from("cnet_processos").select("*").order("sincronizado_em", { ascending: false });
      if (error) throw error;
      setProcessos((data ?? []) as CnetProcesso[]);
    } catch (e: any) {
      setErr(e?.message ?? "Erro ao carregar processos.");
    } finally { setLoading(false); }
  }

  async function loadDetail(processo: CnetProcesso) {
    setSelected(processo);
    setItens([]); setParticipantes([]);
    setLoadingDetail(true); setActiveTab("itens");
    try {
      const [{ data: itensData }, { data: partData }] = await Promise.all([
        supabase.from("cnet_itens")
          .select("*")
          .eq("identificacao", processo.identificacao)
          .order("numero_item", { ascending: true }),
        supabase.from("cnet_participantes")
          .select("*")
          .eq("identificacao", processo.identificacao)
          .order("qtd_itens_selecao", { ascending: false }),
      ]);
      setItens((itensData ?? []) as CnetItem[]);
      setParticipantes((partData ?? []) as CnetParticipante[]);
    } catch {} finally { setLoadingDetail(false); }
  }

  // ── Derivados ─────────────────────────────────────────────────────────────
  const anos   = useMemo(() => [...new Set(processos.map(p => p.ano).filter(Boolean))].sort((a, b) => Number(b) - Number(a)), [processos]);
  const grupos = useMemo(() => [...new Set(processos.map(p => p.agrupamento).filter(Boolean))].sort(), [processos]);

  const lastSync = useMemo(() => {
    if (!processos.length) return null;
    return [...processos].sort((a, b) => b.sincronizado_em?.localeCompare(a.sincronizado_em ?? "") ?? 0)[0]?.sincronizado_em ?? null;
  }, [processos]);

  // CNPJ → nome: resolve vencedor_nome ausente via cnet_participantes
  const cnpjNome = useMemo(() =>
    Object.fromEntries(participantes.map(p => [p.cnpj, p.nome ?? ""])),
  [participantes]);

  function resolveNome(cnpj: string | null | undefined): string | null {
    if (!cnpj) return null;
    return cnpjNome[cnpj] || cnpj;
  }

  const filtered = useMemo(() => {
    const q = filtroTexto.trim().toLowerCase();
    return processos.filter(p => {
      if (filtroAno   !== "todos" && p.ano         !== filtroAno)   return false;
      if (filtroGrupo !== "todos" && p.agrupamento !== filtroGrupo) return false;
      if (filtroSit !== "todos") {
        const l = (p.situacao ?? "").toLowerCase();
        if (filtroSit === "andamento"  &&  /homolog|cancel|fracass|desert|revog|anulad/.test(l)) return false;
        if (filtroSit === "homologado" && !/homolog/.test(l))                                    return false;
        if (filtroSit === "deserto"    && !/desert/.test(l))                                     return false;
        if (filtroSit === "fracassado" && !/fracass/.test(l))                                    return false;
        if (filtroSit === "cancelado"  && !/cancel/.test(l))                                     return false;
        if (filtroSit === "revogado"   && !/revog|anulad/.test(l))                               return false;
      }
      if (q && ![p.identificacao, p.acao, p.situacao].some(v => v?.toLowerCase().includes(q))) return false;
      return true;
    });
  }, [processos, filtroAno, filtroSit, filtroGrupo, filtroTexto]);

  // ── Export XLS ────────────────────────────────────────────────────────────
  function exportarCSV() {
    if (selected && itens.length > 0) {
      // Resumo de grupo = sem quantidade E sem valor unitário mas com valor total
      // (mesma lógica da extensão para detectar grupos/lotes)
      const ehResumo = (it: CnetItem) =>
        it.quantidade == null && it.valor_estimado_unitario == null && it.valor_estimado_total != null;

      // Sub-itens com grupo_numero explícito (linkados ao pai)
      const subItens  = itens.filter(it => it.grupo_numero != null && it.numero_item > 0);
      // Itens reais: positivo E não é resumo de grupo
      const reais     = itens.filter(it => it.numero_item > 0 && !ehResumo(it));
      // Se não há itens reais, cai de volta nos resumos (nada mais para mostrar)
      const base      = reais.length > 0 ? reais : itens.filter(it => it.numero_item > 0);

      const xlsItens  = base
        .sort((a, b) => a.numero_item - b.numero_item)
        .map(it => {
          if (it.vencedor_cnpj) return it;
          // Propaga vencedor do grupo pai (quando sub-item tem grupo_numero linkado)
          if (it.grupo_numero != null) {
            const pai = itens.find(g => g.numero_item === it.grupo_numero);
            if (pai?.vencedor_cnpj) return { ...it, vencedor_cnpj: pai.vencedor_cnpj, vencedor_nome: pai.vencedor_nome };
          }
          // Propaga vencedor de sub-itens já linkados: se há sub-itens do mesmo grupo que têm vencedor
          if (subItens.length > 0) {
            const irmao = subItens.find(s => s.vencedor_cnpj && s.grupo_numero === it.grupo_numero);
            if (irmao) return { ...it, vencedor_cnpj: irmao.vencedor_cnpj, vencedor_nome: irmao.vencedor_nome };
          }
          return it;
        });

      if (!xlsItens.length) return;
      const rows: unknown[][] = [
        ["LOTE", "ITEM", "REQUISIÇÃO", "CNPJ", "EMPRESA", "QTDE", "UND", "VALOR UNIT", "VALOR TOTAL", "PRAZO", "DESCRIÇÃO", "SITUAÇÃO", "FORNECEDOR", "MODELO/VERSAO", "MARCA"],
        ...xlsItens.map((it) => {
          const nomeVencedor = it.vencedor_nome ?? resolveNome(it.vencedor_cnpj) ?? "";
          return [
            it.lote ?? "",
            it.numero_item,
            selected.numero + "/" + selected.ano,
            it.vencedor_cnpj ?? "",
            nomeVencedor,
            it.quantidade ?? "",
            it.unidade ?? "",
            it.valor_vencedor_unitario ?? it.valor_estimado_unitario ?? "",
            it.valor_vencedor_total ?? it.valor_estimado_total ?? "",
            30,
            it.descricao_detalhada || it.descricao || "",
            it.situacao ?? "",
            nomeVencedor,
            "",
            "",
          ];
        }),
      ];
      const ws = utils.aoa_to_sheet(rows);
      const wb = utils.book_new();
      utils.book_append_sheet(wb, ws, "Itens");
      writeFile(wb, selected.identificacao.replace(/[/\\:*?"<>|]/g, "-") + ".xlsx");
    } else {
      if (!filtered.length) return;
      const rows: unknown[][] = [
        ["Identificação", "Número", "Ano", "Situação", "Grupo", "Ação"],
        ...filtered.map(p => [p.identificacao, p.numero, p.ano, p.situacao, p.agrupamento, p.acao]),
      ];
      const ws = utils.aoa_to_sheet(rows);
      const wb = utils.book_new();
      utils.book_append_sheet(wb, ws, "Processos");
      writeFile(wb, `processos-cnet-${new Date().toISOString().slice(0, 10)}.xlsx`);
    }
  }

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-4">

      {/* Cabeçalho */}
      <div className="rounded-2xl border border-slate-200 bg-white shadow-sm px-5 py-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-sm font-bold text-slate-800">Processos Licitatórios — ComprasNet</div>
            <div className="text-xs text-slate-400 mt-0.5">
              UASG 120630 ·{" "}
              {lastSync ? `Última sincronização via extensão: ${fmtDateTime(lastSync)}` : "Sem dados — sincronize via extensão Chrome"}
            </div>
          </div>
          <button onClick={load} disabled={loading}
            className="rounded-lg border border-sky-200 bg-sky-50 px-3 py-1.5 text-xs font-medium text-sky-700 hover:bg-sky-100 disabled:opacity-60 transition-colors">
            {loading ? "Carregando..." : "↻ Recarregar"}
          </button>
        </div>
        {processos.length === 0 && !loading && (
          <div className="mt-3 rounded-xl border border-indigo-200 bg-indigo-50 p-3 text-xs text-indigo-800 leading-relaxed">
            <strong>Como sincronizar:</strong> instale a extensão Chrome <em>GAPMN — Painel ComprasNet</em>,
            acesse o ComprasNet com login, clique em <em>↺ Sincronizar</em> e depois em <em>☁ Sincronizar com App</em>.
          </div>
        )}
        {err && <div className="mt-3 rounded-xl border border-red-200 bg-red-50 p-2 text-sm text-red-700">{err}</div>}
      </div>

      {/* Filtros */}
      <Card>
        <div className="flex flex-wrap items-center gap-3">
          <select value={filtroAno} onChange={e => setFiltroAno(e.target.value)}
            className="rounded-xl border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-sky-200">
            <option value="todos">Todos os anos</option>
            {anos.map(a => <option key={a} value={a}>{a}</option>)}
          </select>
          <select value={filtroSit} onChange={e => setFiltroSit(e.target.value)}
            className="rounded-xl border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-sky-200">
            <option value="todos">Todas as situações</option>
            <option value="andamento">Em Andamento</option>
            <option value="homologado">Homologado</option>
            <option value="deserto">Deserto</option>
            <option value="fracassado">Fracassado</option>
            <option value="cancelado">Cancelado</option>
            <option value="revogado">Revogado / Anulado</option>
          </select>
          <select value={filtroGrupo} onChange={e => setFiltroGrupo(e.target.value)}
            className="rounded-xl border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-sky-200">
            <option value="todos">Todos os grupos</option>
            {grupos.map(g => <option key={g} value={g}>{g}</option>)}
          </select>
          <input value={filtroTexto} onChange={e => setFiltroTexto(e.target.value)}
            placeholder="Buscar por identificação, ação ou situação..."
            className="flex-1 min-w-[220px] rounded-xl border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-sky-200" />
          <span className="text-xs text-slate-500 flex-1">
            {filtered.length} de {processos.length} processo{processos.length !== 1 ? "s" : ""}
          </span>
          <button onClick={exportarCSV} disabled={selected ? itens.length === 0 : filtered.length === 0}
            className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-medium text-emerald-700 hover:bg-emerald-100 disabled:opacity-40 transition-colors">
            {selected && itens.length > 0 ? "📥 Exportar XLS do Processo" : "📥 Exportar Processos"}
          </button>
        </div>
      </Card>

      {/* Grid: lista + detalhe */}
      <div className={`grid gap-4 ${selected ? "grid-cols-1 xl:grid-cols-[380px_1fr]" : "grid-cols-1"}`}>

        {/* Lista */}
        <Card>
          {loading ? (
            <p className="text-sm text-slate-500">Carregando...</p>
          ) : filtered.length === 0 ? (
            <p className="text-sm text-slate-500">
              {processos.length === 0
                ? "Nenhum processo. Sincronize via extensão Chrome (☁ Sincronizar com App)."
                : "Nenhum resultado para os filtros aplicados."}
            </p>
          ) : (
            <div className="space-y-2 max-h-[72vh] overflow-y-auto pr-1">
              {filtered.map(p => (
                <button key={p.id} onClick={() => loadDetail(p)}
                  className={`w-full rounded-xl border p-3 text-left hover:bg-slate-50 transition-colors ${
                    selected?.id === p.id ? "border-sky-300 ring-2 ring-sky-100" : "border-slate-200"
                  }`}>
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-semibold text-slate-900 truncate">
                        {p.identificacao}
                      </div>
                      <div className="mt-0.5 text-xs text-slate-500 truncate">{p.acao || "—"}</div>
                      <div className="mt-1.5 flex flex-wrap gap-1.5">
                        <span className={`rounded-full border px-2 py-0.5 text-xs ${classeSit(p.situacao)}`}>{p.situacao || "—"}</span>
                        <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-xs text-slate-600">{p.agrupamento}</span>
                      </div>
                    </div>
                    <div className="text-right text-xs shrink-0 text-slate-400 font-medium">{p.ano}</div>
                  </div>
                </button>
              ))}
            </div>
          )}
        </Card>

        {/* Detalhe completo */}
        {selected && (
          <div className="space-y-4">

            {/* Header do processo */}
            <div className="rounded-2xl border border-slate-200 bg-white shadow-sm px-5 py-4">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="text-base font-bold text-slate-900">{selected.identificacao}</div>
                  <div className="text-xs text-slate-500 mt-0.5">{selected.agrupamento} · Ano {selected.ano}</div>
                </div>
                <button onClick={() => setSelected(null)} className="text-xs text-slate-400 hover:text-slate-700 shrink-0">✕ Fechar</button>
              </div>

              <div className="mt-3 grid grid-cols-2 gap-x-6 gap-y-2 text-xs text-slate-700">
                <div className="col-span-2 flex items-center gap-2">
                  <span className="font-semibold">Situação:</span>
                  <span className={`rounded-full border px-2 py-0.5 text-xs ${classeSit(selected.situacao)}`}>{selected.situacao || "—"}</span>
                </div>
                <div className="col-span-2">
                  <span className="font-semibold">Ação atual:</span>{" "}
                  <span className="text-sky-700">{selected.acao || "—"}</span>
                </div>
                <div><span className="font-semibold">Nº Processo:</span> {selected.numero}/{selected.ano}</div>
                <div><span className="font-semibold">Sincronizado em:</span> {fmtDateTime(selected.sincronizado_em)}</div>
              </div>

              {selected.acao_url && (
                <a href={"https://cnetmobile.estaleiro.serpro.gov.br" + selected.acao_url}
                  target="_blank" rel="noopener noreferrer"
                  className="mt-3 inline-block text-xs text-sky-700 hover:underline">
                  Abrir no ComprasNet →
                </a>
              )}
            </div>

            {/* Tabs: Itens / Fornecedores */}
            <div className="flex gap-1 border-b border-slate-200">
              {(["itens", "fornecedores"] as const).map(tab => (
                <button key={tab} onClick={() => setActiveTab(tab)}
                  className={`px-4 py-2 text-xs font-semibold border-b-2 -mb-px transition-colors ${
                    activeTab === tab
                      ? "border-sky-500 text-sky-700"
                      : "border-transparent text-slate-500 hover:text-slate-700"
                  }`}>
                  {tab === "itens"
                    ? `📦 Itens${itens.length ? ` (${itens.length})` : ""}`
                    : `🏢 Fornecedores${participantes.length ? ` (${participantes.length})` : ""}`}
                </button>
              ))}
              {loadingDetail && <span className="ml-auto text-xs text-slate-400 self-center pr-2">Carregando...</span>}
              {!loadingDetail && itens.length === 0 && participantes.length === 0 && (
                <span className="ml-auto text-xs text-slate-400 self-center pr-2">
                  Abra este processo na extensão Chrome para carregar os dados →
                </span>
              )}
            </div>

            {/* Tab: Itens */}
            {activeTab === "itens" && (
              <Card>
                {loadingDetail ? (
                  <p className="text-sm text-slate-400">Carregando itens...</p>
                ) : itens.length === 0 ? (
                  <div className="rounded-xl border border-indigo-100 bg-indigo-50 p-4 text-xs text-indigo-800 leading-relaxed">
                    <strong>Sem itens armazenados.</strong> Para carregar, abra a extensão Chrome, clique neste processo
                    e os itens serão sincronizados automaticamente.
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs border-collapse">
                      <thead>
                        <tr className="bg-slate-50">
                          <th className="text-left px-2 py-2 text-slate-500 font-semibold border-b w-10">#</th>
                          <th className="text-left px-2 py-2 text-slate-500 font-semibold border-b">Descrição / Vencedor</th>
                          <th className="text-left px-2 py-2 text-slate-500 font-semibold border-b w-16">Unid.</th>
                          <th className="text-right px-2 py-2 text-slate-500 font-semibold border-b w-16">Qtde</th>
                          <th className="text-right px-2 py-2 text-slate-500 font-semibold border-b w-28">Val. Est.</th>
                          <th className="text-right px-2 py-2 text-slate-500 font-semibold border-b w-28">Val. Proposto</th>
                          <th className="text-right px-2 py-2 text-slate-500 font-semibold border-b w-16 text-emerald-600">Eco.%</th>
                          <th className="text-left px-2 py-2 text-slate-500 font-semibold border-b w-24">Situação</th>
                          <th className="text-center px-2 py-2 text-slate-500 font-semibold border-b w-12 text-emerald-600">Hom.</th>
                        </tr>
                      </thead>
                      <tbody>
                        {itens
                          .filter(it => it.grupo_numero == null)
                          .map(it => {
                            const isGroup = it.numero_item < 0;

                            if (isGroup) {
                              const expanded = expandedGroups.has(it.numero_item);
                              const subItens = itens.filter(si => si.grupo_numero === it.numero_item);
                              const ecoGrupo = (it.valor_estimado_total != null && it.valor_vencedor_total != null && it.valor_estimado_total > 0)
                                ? ((it.valor_estimado_total - it.valor_vencedor_total) / it.valor_estimado_total) * 100
                                : null;
                              const homGrupo = subItens.length > 0 && subItens.every(si => si.homologado);
                              return (
                                <Fragment key={it.id}>
                                  <tr
                                    className="border-b border-indigo-100 bg-indigo-50/50 cursor-pointer hover:bg-indigo-100/50 select-none"
                                    onClick={() => toggleGroup(it.numero_item)}
                                  >
                                    <td className="px-2 py-2 text-indigo-500 font-bold text-center">{expanded ? "▲" : "▼"}</td>
                                    <td className="px-2 py-2 font-semibold text-indigo-900" colSpan={3}>
                                      <span className="mr-1.5 text-[9px] font-bold text-indigo-400 uppercase tracking-wide">Grupo</span>
                                      {it.descricao || it.descricao_detalhada || "—"}
                                      {subItens.length > 0 && (
                                        <span className="ml-2 text-[10px] font-normal text-indigo-400">
                                          {subItens.length} {subItens.length === 1 ? "item" : "itens"}
                                        </span>
                                      )}
                                    </td>
                                    <td className="px-2 py-2 text-right text-slate-600">{fmtBRL(it.valor_estimado_total)}</td>
                                    <td className="px-2 py-2 text-right font-medium text-slate-800">{fmtBRL(it.valor_vencedor_total)}</td>
                                    <td className="px-2 py-2 text-right font-semibold">
                                      {ecoGrupo != null ? (
                                        <span className={ecoGrupo >= 0 ? "text-emerald-600" : "text-red-500"}>
                                          {ecoGrupo >= 0 ? "-" : "+"}{Math.abs(ecoGrupo).toFixed(1)}%
                                        </span>
                                      ) : "—"}
                                    </td>
                                    <td className="px-2 py-2">
                                      <span className={`rounded-full border px-2 py-0.5 text-[10px] font-medium ${classeSit(it.situacao ?? "")}`}>
                                        {it.situacao || "—"}
                                      </span>
                                    </td>
                                    <td className="px-2 py-2 text-center text-sm">
                                      {homGrupo ? <span className="text-emerald-500 font-bold">✓</span> : <span className="text-slate-300">—</span>}
                                    </td>
                                  </tr>
                                  {expanded && subItens.length === 0 && (
                                    <tr className="border-b border-indigo-50">
                                      <td colSpan={9} className="pl-8 py-2 text-[10px] text-slate-400 italic bg-indigo-50/20">
                                        Sub-itens não carregados. Re-sincronize via extensão Chrome para carregar os itens deste grupo.
                                      </td>
                                    </tr>
                                  )}
                                  {expanded && subItens.map(si => {
                                    const ecoSi = (si.valor_estimado_unitario != null && si.valor_vencedor_unitario != null && si.valor_estimado_unitario > 0)
                                      ? ((si.valor_estimado_unitario - si.valor_vencedor_unitario) / si.valor_estimado_unitario) * 100
                                      : null;
                                    return (
                                      <tr key={si.id} className="border-b border-indigo-50 hover:bg-indigo-50/30">
                                        <td className="pl-5 pr-2 py-1.5 text-indigo-400 text-[11px] font-medium">↳ {si.numero_item}</td>
                                        <td className="px-2 py-1.5 text-slate-800 max-w-[300px]">
                                          <div className="text-[11px] font-medium leading-snug">{si.descricao_detalhada || si.descricao || "—"}</div>
                                          {si.vencedor_cnpj ? (
                                            <div className="mt-1 rounded border border-slate-200 border-l-2 border-l-emerald-500 bg-white px-2 py-1">
                                              <div className="text-[9px] font-bold text-emerald-700 mb-0.5">🏆 Vencedor</div>
                                              <div className="text-[10px] text-slate-800 font-semibold truncate max-w-[220px]">{si.vencedor_nome ?? resolveNome(si.vencedor_cnpj)}</div>
                                              <div className="text-[9px] text-slate-500 font-mono">{fmtCnpj(si.vencedor_cnpj)}</div>
                                            </div>
                                          ) : (
                                            <div className="mt-0.5 text-[9px] text-slate-400 italic">sem vencedor</div>
                                          )}
                                        </td>
                                        <td className="px-2 py-1.5 text-slate-500 text-[11px]">{si.unidade || "—"}</td>
                                        <td className="px-2 py-1.5 text-right text-slate-700 text-[11px]">{si.quantidade?.toLocaleString("pt-BR") ?? "—"}</td>
                                        <td className="px-2 py-1.5 text-right text-slate-500 text-[11px]">{fmtBRL(si.valor_estimado_unitario)}</td>
                                        <td className="px-2 py-1.5 text-right font-medium text-slate-700 text-[11px]">{fmtBRL(si.valor_vencedor_unitario)}</td>
                                        <td className="px-2 py-1.5 text-right font-semibold text-[11px]">
                                          {ecoSi != null ? (
                                            <span className={ecoSi >= 0 ? "text-emerald-600" : "text-red-500"}>
                                              {ecoSi >= 0 ? "-" : "+"}{Math.abs(ecoSi).toFixed(1)}%
                                            </span>
                                          ) : "—"}
                                        </td>
                                        <td className="px-2 py-1.5">
                                          <span className={`rounded-full border px-2 py-0.5 text-[9px] font-medium ${classeSit(si.situacao ?? "")}`}>
                                            {si.situacao || "—"}
                                          </span>
                                        </td>
                                        <td className="px-2 py-1.5 text-center text-sm">
                                          {si.homologado ? <span className="text-emerald-500 font-bold">✓</span> : <span className="text-slate-300">—</span>}
                                        </td>
                                      </tr>
                                    );
                                  })}
                                </Fragment>
                              );
                            }

                            // Item normal — clicável para expandir detalhe do vencedor
                            const eco = (it.valor_estimado_unitario != null && it.valor_vencedor_unitario != null && it.valor_estimado_unitario > 0)
                              ? ((it.valor_estimado_unitario - it.valor_vencedor_unitario) / it.valor_estimado_unitario) * 100
                              : null;
                            const itemExpanded = expandedItems.has(it.numero_item);
                            return (
                              <Fragment key={it.id}>
                              <tr className="border-b border-slate-100 hover:bg-slate-50/60 cursor-pointer select-none" onClick={() => toggleItem(it.numero_item)}>
                                <td className="px-2 py-2 text-slate-400 font-medium whitespace-nowrap">
                                  <span className="text-[9px] text-slate-300 mr-0.5">{itemExpanded ? "▲" : "▼"}</span>{it.numero_item}
                                </td>
                                <td className="px-2 py-2 text-slate-800 max-w-[340px]">
                                  <div className="font-medium leading-snug">{it.descricao || "—"}</div>
                                  {it.vencedor_cnpj && (
                                    <div className="mt-0.5 flex items-center gap-1 flex-wrap">
                                      <span className="text-emerald-600 text-[9px] font-semibold">🏆</span>
                                      <span className="text-[9px] text-slate-500 truncate max-w-[220px]">{it.vencedor_nome ?? resolveNome(it.vencedor_cnpj)}</span>
                                    </div>
                                  )}
                                </td>
                                <td className="px-2 py-2 text-slate-500">{it.unidade || "—"}</td>
                                <td className="px-2 py-2 text-right text-slate-700">{it.quantidade?.toLocaleString("pt-BR") ?? "—"}</td>
                                <td className="px-2 py-2 text-right text-slate-600">{fmtBRL(it.valor_estimado_unitario)}</td>
                                <td className="px-2 py-2 text-right font-medium text-slate-800">{fmtBRL(it.valor_vencedor_unitario)}</td>
                                <td className="px-2 py-2 text-right font-semibold">
                                  {eco != null ? (
                                    <span className={eco >= 0 ? "text-emerald-600" : "text-red-500"}>
                                      {eco >= 0 ? "-" : "+"}{Math.abs(eco).toFixed(1)}%
                                    </span>
                                  ) : "—"}
                                </td>
                                <td className="px-2 py-2">
                                  <span className={`rounded-full border px-2 py-0.5 text-[10px] font-medium ${classeSit(it.situacao ?? "")}`}>
                                    {it.situacao || "—"}
                                  </span>
                                </td>
                                <td className="px-2 py-2 text-center text-sm">
                                  {it.homologado ? <span className="text-emerald-500 font-bold">✓</span> : <span className="text-slate-300">—</span>}
                                </td>
                              </tr>
                              {itemExpanded && (
                                <tr className="border-b border-slate-100 bg-slate-50/60">
                                  <td colSpan={9} className="px-5 py-3">
                                    {it.descricao_detalhada && it.descricao_detalhada !== it.descricao && (
                                      <p className="text-[11px] text-slate-600 mb-2 leading-relaxed">{it.descricao_detalhada}</p>
                                    )}
                                    {it.vencedor_cnpj ? (
                                      <div className="rounded-lg border border-slate-200 border-l-4 border-l-emerald-500 bg-white px-4 py-3 max-w-xl shadow-sm">
                                        <div className="text-[10px] font-bold text-emerald-700 mb-1.5 flex items-center gap-1">🏆 Vencedor</div>
                                        <div className="grid grid-cols-2 gap-x-6 gap-y-1.5 text-[11px]">
                                          <div><span className="text-slate-500">Empresa:</span> <span className="font-semibold text-slate-800">{it.vencedor_nome ?? resolveNome(it.vencedor_cnpj)}</span></div>
                                          <div><span className="text-slate-500">CNPJ:</span> <span className="font-mono text-slate-700">{fmtCnpj(it.vencedor_cnpj)}</span></div>
                                          {it.valor_vencedor_unitario != null && (
                                            <div><span className="text-slate-500">Val. proposto:</span> <span className="font-semibold text-slate-800">{fmtBRL(it.valor_vencedor_unitario)}/un</span></div>
                                          )}
                                          {it.valor_vencedor_total != null && (
                                            <div><span className="text-slate-500">Val. total:</span> <span className="font-semibold text-slate-800">{fmtBRL(it.valor_vencedor_total)}</span></div>
                                          )}
                                          {eco != null && (
                                            <div><span className="text-slate-500">Economia:</span> <span className={`font-bold ${eco >= 0 ? "text-emerald-600" : "text-red-500"}`}>{eco >= 0 ? "-" : "+"}{Math.abs(eco).toFixed(1)}%</span></div>
                                          )}
                                          <div><span className="text-slate-500">Homologado:</span> {it.homologado ? <span className="font-bold text-emerald-600">✓ Sim</span> : <span className="text-slate-500">Não</span>}</div>
                                        </div>
                                      </div>
                                    ) : (
                                      <p className="text-[11px] text-slate-400 italic">Sem vencedor registrado. Re-sincronize via extensão Chrome para carregar os dados.</p>
                                    )}
                                  </td>
                                </tr>
                              )}
                              </Fragment>
                            );
                          })}
                      </tbody>
                    </table>
                    {/* Totais — apenas itens de topo (sem sub-itens de grupo) */}
                    {(() => {
                      const topLevel = itens.filter(it => it.grupo_numero == null);
                      const hasEst = topLevel.some(it => it.valor_estimado_total != null);
                      const hasVen = topLevel.some(it => it.valor_vencedor_total != null);
                      if (!hasEst && !hasVen) return null;
                      const est = topLevel.reduce((s, it) => s + (it.valor_estimado_total ?? 0), 0);
                      const ven = topLevel.reduce((s, it) => s + (it.valor_vencedor_total ?? 0), 0);
                      const eco = (hasEst && hasVen && est > 0) ? ((est - ven) / est) * 100 : null;
                      return (
                        <div className="mt-3 flex flex-wrap justify-end gap-x-8 gap-y-1 text-xs border-t pt-2">
                          {hasEst && (
                            <div className="flex items-center gap-2 text-slate-500">
                              <span>Total estimado:</span>
                              <span className="font-bold text-slate-700">{fmtBRL(est)}</span>
                            </div>
                          )}
                          {hasVen && (
                            <div className="flex items-center gap-2 text-slate-500">
                              <span>Total vencedor:</span>
                              <span className="font-bold text-emerald-700">{fmtBRL(ven)}</span>
                            </div>
                          )}
                          {eco != null && (
                            <div className="flex items-center gap-2">
                              <span className="text-slate-500">Economia:</span>
                              <span className={`font-bold ${eco >= 0 ? "text-emerald-600" : "text-red-500"}`}>
                                {fmtBRL(est - ven)} ({eco >= 0 ? "-" : "+"}{Math.abs(eco).toFixed(1)}%)
                              </span>
                            </div>
                          )}
                        </div>
                      );
                    })()}
                  </div>
                )}
              </Card>
            )}

            {/* Tab: Fornecedores */}
            {activeTab === "fornecedores" && (
              <Card>
                {loadingDetail ? (
                  <p className="text-sm text-slate-400">Carregando fornecedores...</p>
                ) : participantes.length === 0 ? (
                  <div className="rounded-xl border border-indigo-100 bg-indigo-50 p-4 text-xs text-indigo-800 leading-relaxed">
                    <strong>Sem fornecedores armazenados.</strong> Abra a extensão Chrome, veja os detalhes deste
                    processo e clique em "Ver todos os fornecedores" para sincronizar.
                  </div>
                ) : (
                  <div>
                    {/* Aviso quando dados de vencedor ainda não foram sincronizados */}
                    {itens.length > 0 && itens.every(it => it.vencedor_cnpj == null) && (
                      <div className="mb-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-800 leading-relaxed">
                        <strong>⚠ Dados de vencedor não sincronizados.</strong> Atualize a extensão Chrome (git pull + recarregar extensão) e clique em "☁ Sincronizar com App" novamente. Os itens ganhos por cada fornecedor aparecerão automaticamente.
                      </div>
                    )}
                    <table className="w-full text-xs border-collapse">
                      <thead>
                        <tr className="bg-slate-50">
                          <th className="text-left px-2 py-2 text-slate-500 font-semibold border-b w-8"></th>
                          <th className="text-left px-2 py-2 text-slate-500 font-semibold border-b">CNPJ/CPF</th>
                          <th className="text-left px-2 py-2 text-slate-500 font-semibold border-b">Empresa</th>
                          <th className="text-center px-2 py-2 text-slate-500 font-semibold border-b w-16">ME/EPP</th>
                          <th className="text-center px-2 py-2 text-slate-500 font-semibold border-b w-20">Itens</th>
                          <th className="text-center px-2 py-2 text-slate-500 font-semibold border-b w-20 text-emerald-600">Ganhos</th>
                        </tr>
                      </thead>
                      <tbody>
                        {participantes.map(p => {
                          const itensGanhos = itens.filter(it => it.vencedor_cnpj === p.cnpj);
                          const supExpanded = expandedItems.has(-(p.id));
                          return (
                            <Fragment key={p.id}>
                              <tr
                                className="border-b border-slate-100 cursor-pointer hover:bg-slate-50 select-none"
                                onClick={() => toggleItem(-(p.id))}
                              >
                                <td className="px-2 py-2 text-slate-400 text-center text-[10px]">{supExpanded ? "▲" : "▼"}</td>
                                <td className="px-2 py-2 text-slate-400 font-mono text-[10px]">{fmtCnpj(p.cnpj)}</td>
                                <td className="px-2 py-2 text-slate-800 font-medium max-w-[260px] truncate" title={p.nome ?? ""}>{p.nome || "—"}</td>
                                <td className="px-2 py-2 text-center">
                                  {p.me_epp && <span className="rounded-full border border-green-200 bg-green-50 px-2 py-0.5 text-[10px] text-green-700 font-medium">ME/EPP</span>}
                                </td>
                                <td className="px-2 py-2 text-center text-slate-600 font-medium">{p.qtd_itens_selecao ?? "—"}</td>
                                <td className="px-2 py-2 text-center font-bold">
                                  {itensGanhos.length > 0
                                    ? <span className="text-emerald-600">{itensGanhos.length}</span>
                                    : <span className="text-slate-300 font-normal">—</span>}
                                </td>
                              </tr>
                              {supExpanded && (
                                <tr className="border-b border-slate-100">
                                  <td colSpan={6} className="p-0">
                                    {itensGanhos.length === 0 ? (
                                      <div className="px-8 py-3 text-[11px] text-slate-400 italic bg-slate-50/60">
                                        {itens.every(it => it.vencedor_cnpj == null)
                                          ? "Dados de vencedor ainda não sincronizados. Atualize a extensão e re-sincronize."
                                          : "Este fornecedor não ganhou nenhum item neste processo."}
                                      </div>
                                    ) : (
                                      <div className="bg-white px-4 py-3">
                                        <div className="text-[10px] font-bold text-emerald-700 mb-2">🏆 Itens ganhos ({itensGanhos.length})</div>
                                        <table className="w-full text-[11px] border-collapse">
                                          <thead>
                                            <tr className="border-b border-slate-200">
                                              <th className="text-left py-1 pr-3 text-slate-500 font-semibold w-8">#</th>
                                              <th className="text-left py-1 pr-3 text-slate-500 font-semibold">Item</th>
                                              <th className="text-right py-1 pr-3 text-slate-500 font-semibold w-14">Qtde</th>
                                              <th className="text-right py-1 pr-3 text-slate-500 font-semibold w-28">Val. Est.</th>
                                              <th className="text-right py-1 pr-3 text-sky-600 font-semibold w-28">Val. Proposto</th>
                                              <th className="text-right py-1 pr-3 text-emerald-600 font-semibold w-16">Eco.</th>
                                              <th className="text-center py-1 text-emerald-600 font-semibold w-12">Hom.</th>
                                            </tr>
                                          </thead>
                                          <tbody>
                                            {itensGanhos.map(it => {
                                              const isGrupo = it.numero_item < 0;
                                              const vlrEst = isGrupo ? it.valor_estimado_total : it.valor_estimado_unitario;
                                              const vlrProp = isGrupo
                                                ? it.valor_vencedor_total
                                                : it.valor_vencedor_unitario;
                                              const ecoIt = (vlrEst != null && vlrProp != null && vlrEst > 0)
                                                ? ((vlrEst - vlrProp) / vlrEst) * 100 : null;
                                              return (
                                                <tr key={it.id} className="border-b border-slate-100">
                                                  <td className="py-1.5 pr-3 text-slate-400 font-semibold">
                                                    {isGrupo ? <span className="text-indigo-500 text-[9px] font-bold">GRP</span> : it.numero_item}
                                                  </td>
                                                  <td className="py-1.5 pr-3 text-slate-700 max-w-[280px]">
                                                    <div className="truncate" title={it.descricao_detalhada || it.descricao || ""}>
                                                      {it.descricao || it.descricao_detalhada || "—"}
                                                    </div>
                                                  </td>
                                                  <td className="py-1.5 pr-3 text-right text-slate-500">
                                                    {isGrupo ? "—" : (it.quantidade?.toLocaleString("pt-BR") ?? "—")}
                                                  </td>
                                                  <td className="py-1.5 pr-3 text-right text-slate-500">{fmtBRL(vlrEst)}</td>
                                                  <td className="py-1.5 pr-3 text-right text-sky-700 font-semibold">{fmtBRL(vlrProp)}</td>
                                                  <td className="py-1.5 pr-3 text-right font-bold">
                                                    {ecoIt != null
                                                      ? <span className={ecoIt >= 0 ? "text-emerald-600" : "text-red-500"}>{ecoIt >= 0 ? "-" : "+"}{Math.abs(ecoIt).toFixed(1)}%</span>
                                                      : <span className="text-slate-300">—</span>}
                                                  </td>
                                                  <td className="py-1.5 text-center">
                                                    {it.homologado ? <span className="text-emerald-500 font-bold">✓</span> : <span className="text-slate-300">—</span>}
                                                  </td>
                                                </tr>
                                              );
                                            })}
                                          </tbody>
                                        </table>
                                      </div>
                                    )}
                                  </td>
                                </tr>
                              )}
                            </Fragment>
                          );
                        })}
                      </tbody>
                    </table>
                    <div className="mt-2 text-xs text-slate-400 text-right">
                      {participantes.length} fornecedor{participantes.length !== 1 ? "es" : ""}
                    </div>
                  </div>
                )}
              </Card>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
