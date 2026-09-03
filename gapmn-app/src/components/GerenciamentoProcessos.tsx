import { useState, useEffect, useMemo, Fragment } from "react";
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
  if (/homolog/.test(l))                                                                   return "bg-green-50 border-green-200 text-green-800";
  if (/cancel|fracass|desert|revog|anulad/.test(l))                                       return "bg-slate-100 border-slate-300 text-slate-600";
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

  function toggleGroup(n: number) {
    setExpandedGroups(prev => {
      const s = new Set(prev);
      s.has(n) ? s.delete(n) : s.add(n);
      return s;
    });
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

  const filtered = useMemo(() => {
    const q = filtroTexto.trim().toLowerCase();
    return processos.filter(p => {
      if (filtroAno   !== "todos" && p.ano         !== filtroAno)   return false;
      if (filtroGrupo !== "todos" && p.agrupamento !== filtroGrupo) return false;
      if (filtroSit !== "todos") {
        const l = (p.situacao ?? "").toLowerCase();
        if (filtroSit === "andamento"  &&  /homolog|cancel|fracass|desert|revog|anulad/.test(l)) return false;
        if (filtroSit === "homologado" && !/homolog/.test(l))                                    return false;
        if (filtroSit === "cancelado"  && !/cancel|fracass|desert|revog|anulad/.test(l))        return false;
      }
      if (q && ![p.identificacao, p.acao, p.situacao].some(v => v?.toLowerCase().includes(q))) return false;
      return true;
    });
  }, [processos, filtroAno, filtroSit, filtroGrupo, filtroTexto]);

  // ── Export CSV ────────────────────────────────────────────────────────────
  function exportarCSV() {
    if (!filtered.length) return;
    const esc = (v: unknown) => {
      const s = String(v ?? "");
      return s.includes(";") || s.includes('"') || s.includes("\n")
        ? '"' + s.replace(/"/g, '""') + '"' : s;
    };
    const rows = [
      ["LOTE", "ITEM", "REQUISIÇÃO", "CNPJ", "EMPRESA", "QTDE", "UND", "VALOR UNIT", "VALOR TOTAL", "PRAZO", "DESCRIÇÃO", "SITUAÇÃO", "FORNECEDOR", "MODELO/VERSAO", "MARCA"],
      ...filtered.map((p, i) => [
        p.agrupamento, i + 1, p.numero + "/" + p.ano, "", "", "", "", "", "", "",
        p.acao, p.situacao, "", "", p.possui_pendencia ? "Pendência" : "",
      ]),
    ];
    const csv = "﻿" + rows.map(r => r.map(esc).join(";")).join("\r\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    a.download = `processos-cnet-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 3000);
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
            <option value="cancelado">Cancelado / Fracassado</option>
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
          <button onClick={exportarCSV} disabled={!filtered.length}
            className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-medium text-emerald-700 hover:bg-emerald-100 disabled:opacity-40 transition-colors">
            📥 Exportar CSV
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
                          <th className="text-left px-2 py-2 text-slate-500 font-semibold border-b w-8">#</th>
                          <th className="text-left px-2 py-2 text-slate-500 font-semibold border-b">Descrição / Vencedor</th>
                          <th className="text-left px-2 py-2 text-slate-500 font-semibold border-b w-16">Unid.</th>
                          <th className="text-right px-2 py-2 text-slate-500 font-semibold border-b w-16">Qtde</th>
                          <th className="text-right px-2 py-2 text-slate-500 font-semibold border-b w-28">Val. Est.</th>
                          <th className="text-right px-2 py-2 text-slate-500 font-semibold border-b w-28">Val. Vencedor</th>
                          <th className="text-right px-2 py-2 text-slate-500 font-semibold border-b w-16 text-emerald-600">Eco.%</th>
                          <th className="text-left px-2 py-2 text-slate-500 font-semibold border-b w-24">Situação</th>
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
                                  </tr>
                                  {expanded && subItens.length === 0 && (
                                    <tr className="border-b border-indigo-50">
                                      <td colSpan={8} className="pl-8 py-2 text-[10px] text-slate-400 italic bg-indigo-50/20">
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
                                          {si.vencedor_nome && (
                                            <div className="mt-0.5 flex items-center gap-1 flex-wrap">
                                              <span className="text-emerald-600 text-[9px] font-semibold">🏆 Vencedor:</span>
                                              <span className="text-[9px] text-slate-500 truncate max-w-[200px]">{si.vencedor_nome}</span>
                                              {si.vencedor_cnpj && <span className="text-[9px] text-slate-400 font-mono">{fmtCnpj(si.vencedor_cnpj)}</span>}
                                            </div>
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
                                      </tr>
                                    );
                                  })}
                                </Fragment>
                              );
                            }

                            // Item normal
                            const eco = (it.valor_estimado_unitario != null && it.valor_vencedor_unitario != null && it.valor_estimado_unitario > 0)
                              ? ((it.valor_estimado_unitario - it.valor_vencedor_unitario) / it.valor_estimado_unitario) * 100
                              : null;
                            return (
                              <tr key={it.id} className="border-b border-slate-100 hover:bg-slate-50/60">
                                <td className="px-2 py-2 text-slate-400 font-medium">{it.numero_item}</td>
                                <td className="px-2 py-2 text-slate-800 max-w-[340px]">
                                  <div className="font-medium leading-snug">{it.descricao_detalhada || it.descricao || "—"}</div>
                                  {it.vencedor_nome && (
                                    <div className="mt-1 flex items-center gap-1.5 flex-wrap">
                                      <span className="text-emerald-700 text-[10px] font-semibold">🏆 Vencedor:</span>
                                      <span className="text-[10px] text-slate-600 truncate max-w-[240px]" title={it.vencedor_nome}>{it.vencedor_nome}</span>
                                      {it.vencedor_cnpj && <span className="text-[10px] text-slate-400 font-mono">{fmtCnpj(it.vencedor_cnpj)}</span>}
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
                              </tr>
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
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs border-collapse">
                      <thead>
                        <tr className="bg-slate-50">
                          <th className="text-left px-2 py-2 text-slate-500 font-semibold border-b">CNPJ</th>
                          <th className="text-left px-2 py-2 text-slate-500 font-semibold border-b">Empresa</th>
                          <th className="text-center px-2 py-2 text-slate-500 font-semibold border-b w-16">ME/EPP</th>
                          <th className="text-center px-2 py-2 text-slate-500 font-semibold border-b w-20">Participações</th>
                          <th className="text-left px-2 py-2 text-slate-500 font-semibold border-b">Itens ganhos</th>
                        </tr>
                      </thead>
                      <tbody>
                        {participantes.map(p => {
                          const itensGanhos = itens.filter(it => it.vencedor_cnpj === p.cnpj);
                          return (
                            <tr key={p.id} className="hover:bg-slate-50 border-b border-slate-100 align-top">
                              <td className="px-2 py-2 text-slate-400 font-mono text-[10px]">{fmtCnpj(p.cnpj)}</td>
                              <td className="px-2 py-2 text-slate-800 max-w-[240px] truncate" title={p.nome ?? ""}>{p.nome || "—"}</td>
                              <td className="px-2 py-2 text-center">
                                {p.me_epp && (
                                  <span className="rounded-full border border-green-200 bg-green-50 px-2 py-0.5 text-[10px] text-green-700 font-medium">ME/EPP</span>
                                )}
                              </td>
                              <td className="px-2 py-2 text-center text-slate-600 font-medium">{p.qtd_itens_selecao ?? "—"}</td>
                              <td className="px-2 py-2">
                                {itensGanhos.length > 0 ? (
                                  <div className="space-y-0.5">
                                    {itensGanhos.map(it => (
                                      <div key={it.id} className="flex items-center gap-2 text-[10px]">
                                        <span className="text-emerald-700 font-semibold shrink-0">#{it.numero_item}</span>
                                        <span className="text-slate-600 truncate max-w-[200px]" title={it.descricao_detalhada || it.descricao || ""}>
                                          {(it.descricao_detalhada || it.descricao || "").slice(0, 50)}{(it.descricao_detalhada || it.descricao || "").length > 50 ? "…" : ""}
                                        </span>
                                        {it.valor_vencedor_unitario != null && (
                                          <span className="text-slate-500 font-mono shrink-0">{fmtBRL(it.valor_vencedor_unitario)}/un</span>
                                        )}
                                      </div>
                                    ))}
                                  </div>
                                ) : (
                                  <span className="text-slate-300 text-[10px]">—</span>
                                )}
                              </td>
                            </tr>
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
