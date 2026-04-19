import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "../lib/supabase";

// ─── Types ────────────────────────────────────────────────────────────────────
type Contrato = {
  numero_contrato: string;
  status: string | null;
  saldo: number | null;
  vl_contratual: number | null;
  vl_empenhado: number | null;
  vl_liquidado: number | null;
  data_final: string | null;
  uge: string | null;
  ugr: string | null;
  fornecedor: string | null;
  descricao: string | null;
};

type Processo = {
  numero_processo: string | null;
  modalidade: string | null;
  situacao_api: string | null;
  valor_estimado: number | null;
  valor_homologado: number | null;
  homologado_manual: boolean | null;
  valor_homologado_manual: number | null;
  data_publicacao: string | null;
  objeto: string | null;
  ano: number | null;
};

type ObsContrato  = { contrato: Contrato;  nota: string };
type ObsProcesso  = { processo: Processo;  nota: string };

interface PainelProps {
  setor: "SEO" | "SCON" | "SLIC" | "DEV" | null;
  isAdmin: boolean;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────
function fmtMoney(v: number | null | undefined): string {
  if (v == null) return "–";
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(v);
}
function fmtDate(d: string | null | undefined): string {
  if (!d) return "–";
  try { return new Date(d + "T12:00:00").toLocaleDateString("pt-BR"); }
  catch { return d; }
}
function daysUntil(dateStr: string | null | undefined): number {
  if (!dateStr) return Infinity;
  return Math.ceil((new Date(dateStr + "T23:59:59").getTime() - Date.now()) / 86_400_000);
}
function isoToday():        string { return new Date().toISOString().slice(0, 10); }
function isoInDays(n: number): string { return new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10); }

// ─── KPI Card ─────────────────────────────────────────────────────────────────
function KpiCard({ label, value, sub, color, onClick, active }: {
  label: string; value: string; sub?: string; color?: string;
  onClick?: () => void; active?: boolean;
}) {
  return (
    <div
      onClick={onClick}
      className={`rounded-xl border p-4 text-center shadow-sm transition-colors ${
        onClick ? "cursor-pointer hover:border-sky-300 hover:bg-sky-50/50" : ""
      } ${active ? "border-sky-400 bg-sky-50 ring-2 ring-sky-100" : "border-slate-200 bg-white"}`}
    >
      <div className="text-xs text-slate-500 mb-1">{label}</div>
      <div className={`text-xl font-bold ${color ?? "text-slate-800"}`}>{value}</div>
      {sub && <div className="text-xs text-slate-400 mt-1">{sub}</div>}
    </div>
  );
}

// ─── Bar Row ──────────────────────────────────────────────────────────────────
function BarRow({ label, pct, val, color }: { label: string; pct: number; val: string; color: string }) {
  return (
    <div>
      <div className="flex items-center justify-between text-xs text-slate-600 mb-1">
        <span className="font-medium truncate max-w-[55%]">{label}</span>
        <span className="shrink-0 ml-2">{val} <span className="font-semibold text-slate-800">({pct.toFixed(1)}%)</span></span>
      </div>
      <div className="h-2.5 rounded-full bg-slate-100 overflow-hidden">
        <div className={`h-full rounded-full transition-all ${color}`} style={{ width: `${Math.min(pct, 100)}%` }} />
      </div>
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────
export default function PainelDashboard({ setor, isAdmin }: PainelProps) {
  const showSCON = isAdmin || setor === "SCON";
  const showSLIC = isAdmin || setor === "SLIC";

  const [contratos, setContratos] = useState<Contrato[]>([]);
  const [processos, setProcessos] = useState<Processo[]>([]);
  const [loading, setLoading]     = useState(true);
  const [isMaximized, setIsMaximized] = useState(false);
  const printRef = useRef<HTMLDivElement>(null);

  // ── Filtros ───────────────────────────────────────────────────────────────
  const [filtroUGR,     setFiltroUGR]     = useState("todos");
  const [filtroAnoSLIC, setFiltroAnoSLIC] = useState<"todos" | "2024" | "2025" | "2026">("todos");

  // ── Vencimentos: ocultar linhas ────────────────────────────────────────────
  const [vencOcultos, setVencOcultos] = useState<Set<string>>(new Set());

  // ── Em Andamento: ocultar linhas ───────────────────────────────────────────
  const [andOcultos, setAndOcultos] = useState<Set<string>>(new Set());

  // ── KPI card ativo (SLIC) ─────────────────────────────────────────────────
  const [activeKpiSLIC, setActiveKpiSLIC] = useState<"andamento" | "homologados" | "revogados" | null>(null);

  // ── Observações SCON ─────────────────────────────────────────────────────
  const [obsContratos,    setObsContratos]    = useState<ObsContrato[]>([]);
  const [buscarContrato,  setBuscarContrato]  = useState("");

  // ── Observações SLIC ─────────────────────────────────────────────────────
  const [obsProcessos,    setObsProcessos]    = useState<ObsProcesso[]>([]);
  const [buscarProcesso,  setBuscarProcesso]  = useState("");

  // ── Carga de dados ────────────────────────────────────────────────────────
  useEffect(() => {
    (async () => {
      setLoading(true);
      const promises: PromiseLike<void>[] = [];
      if (showSCON) {
        promises.push(
          supabase
            .from("contratos_scon")
            .select("numero_contrato, status, saldo, vl_contratual, vl_empenhado, vl_liquidado, data_final, uge, ugr, fornecedor, descricao")
            .then(({ data }) => { setContratos((data ?? []) as Contrato[]); })
        );
      }
      if (showSLIC) {
        promises.push(
          supabase
            .from("processos_licitatorios")
            .select("numero_processo, modalidade, situacao_api, valor_estimado, valor_homologado, homologado_manual, valor_homologado_manual, data_publicacao, objeto, ano")
            .then(({ data }) => { setProcessos((data ?? []) as Processo[]); })
        );
      }
      await Promise.all(promises);
      setLoading(false);
    })();
  }, [showSCON, showSLIC]);

  // ── Derived: SCON ─────────────────────────────────────────────────────────
  const ugrsDisponiveis = useMemo(() =>
    [...new Set(contratos.map(c => c.ugr ?? "Sem UGR"))].filter(Boolean).sort(),
    [contratos]
  );

  const contratosFiltrados = useMemo(() =>
    filtroUGR === "todos" ? contratos : contratos.filter(c => (c.ugr ?? "Sem UGR") === filtroUGR),
    [contratos, filtroUGR]
  );

  // ── Derived: SLIC ─────────────────────────────────────────────────────────
  const processosFiltrados = useMemo(() =>
    filtroAnoSLIC === "todos" ? processos : processos.filter(p => String(p.ano) === filtroAnoSLIC),
    [processos, filtroAnoSLIC]
  );

  // ── KPIs Contratos ────────────────────────────────────────────────────────
  const kpiC = useMemo(() => {
    if (!contratosFiltrados.length) return null;
    const hoje = isoToday();
    const em30 = isoInDays(30);
    const em90 = isoInDays(90);

    const vigentes = contratosFiltrados.filter(c => (c.status ?? "").toLowerCase().includes("vigent")).length;
    const vencidos = contratosFiltrados.filter(c => c.data_final && c.data_final < hoje).length;
    const venc30   = contratosFiltrados.filter(c => c.data_final && c.data_final >= hoje && c.data_final <= em30).length;
    const venc90   = contratosFiltrados.filter(c => c.data_final && c.data_final >= hoje && c.data_final <= em90).length;

    const vencendoList = contratosFiltrados
      .filter(c => c.data_final && c.data_final <= em90)
      .sort((a, b) => (a.data_final ?? "").localeCompare(b.data_final ?? ""));

    const semDataFinal = contratosFiltrados.filter(c => !c.data_final).length;

    return { vigentes, vencidos, venc30, venc90, vencendoList, semDataFinal };
  }, [contratosFiltrados]);

  // ── KPIs Processos ────────────────────────────────────────────────────────
  const kpiP = useMemo(() => {
    if (!processosFiltrados.length) return null;

    const isHom = (p: Processo) => {
      if (p.homologado_manual === true) return true;
      const sit = (p.situacao_api ?? "").toLowerCase();
      return p.valor_homologado != null || sit.includes("homolog") || sit.includes("adjudic");
    };
    const isRevog = (p: Processo) =>
      (p.situacao_api ?? "").toLowerCase().match(/revogad|suspens|anulad/) != null;

    const homologados = processosFiltrados.filter(isHom).length;
    const revogados   = processosFiltrados.filter(isRevog).length;
    const andamento   = processosFiltrados.length - homologados - revogados;

    const totalHom       = processosFiltrados.filter(isHom).reduce((s, p) => s + (p.valor_homologado ?? 0), 0);
    const totalEstComHom = processosFiltrados.filter(isHom).reduce((s, p) => s + (p.valor_estimado ?? 0), 0);
    const economia = totalEstComHom > 0 ? totalEstComHom - totalHom : 0;
    const pctEco   = totalEstComHom > 0 ? (economia / totalEstComHom) * 100 : 0;

    const andamentoList = processosFiltrados
      .filter(p => !isHom(p) && !isRevog(p))
      .sort((a, b) => (b.data_publicacao ?? "").localeCompare(a.data_publicacao ?? ""));

    const homologadosList = processosFiltrados
      .filter(isHom)
      .sort((a, b) => (b.data_publicacao ?? "").localeCompare(a.data_publicacao ?? ""));

    const revogadosList = processosFiltrados
      .filter(isRevog)
      .sort((a, b) => (b.data_publicacao ?? "").localeCompare(a.data_publicacao ?? ""));

    const byModal: Record<string, number> = {};
    for (const p of processosFiltrados) {
      const m = p.modalidade ?? "Sem modalidade";
      byModal[m] = (byModal[m] ?? 0) + 1;
    }
    const modalRows = Object.entries(byModal).sort(([, a], [, b]) => b - a);

    return { homologados, revogados, andamento, totalHom, economia, pctEco, andamentoList, homologadosList, revogadosList, modalRows };
  }, [processosFiltrados]);

  // ── Busca para Observações SCON ───────────────────────────────────────────
  const contratosResultadoBusca = useMemo(() => {
    const q = buscarContrato.trim().toLowerCase();
    if (!q) return [];
    const jaAdicionados = new Set(obsContratos.map(o => o.contrato.numero_contrato));
    return contratos.filter(c =>
      !jaAdicionados.has(c.numero_contrato) && (
        (c.numero_contrato ?? "").toLowerCase().includes(q) ||
        (c.fornecedor ?? "").toLowerCase().includes(q) ||
        (c.descricao ?? "").toLowerCase().includes(q)
      )
    ).slice(0, 6);
  }, [buscarContrato, contratos, obsContratos]);

  // ── Busca para Observações SLIC ───────────────────────────────────────────
  const processosResultadoBusca = useMemo(() => {
    const q = buscarProcesso.trim().toLowerCase();
    if (!q) return [];
    const jaAdicionados = new Set(obsProcessos.map(o => o.processo.numero_processo ?? ""));
    return processos.filter(p =>
      !jaAdicionados.has(p.numero_processo ?? "") && (
        (p.numero_processo ?? "").toLowerCase().includes(q) ||
        (p.objeto ?? "").toLowerCase().includes(q)
      )
    ).slice(0, 6);
  }, [buscarProcesso, processos, obsProcessos]);

  // ── Ações Observações SCON ────────────────────────────────────────────────
  function adicionarContrato(c: Contrato) {
    setObsContratos(prev => [...prev, { contrato: c, nota: "" }]);
    setBuscarContrato("");
  }
  function removerObsContrato(num: string) {
    setObsContratos(prev => prev.filter(o => o.contrato.numero_contrato !== num));
  }
  function atualizarNotaContrato(num: string, nota: string) {
    setObsContratos(prev => prev.map(o => o.contrato.numero_contrato === num ? { ...o, nota } : o));
  }

  // ── Ações Observações SLIC ────────────────────────────────────────────────
  function adicionarProcesso(p: Processo) {
    setObsProcessos(prev => [...prev, { processo: p, nota: "" }]);
    setBuscarProcesso("");
  }
  function removerObsProcesso(num: string) {
    setObsProcessos(prev => prev.filter(o => (o.processo.numero_processo ?? "") !== num));
  }
  function atualizarNotaProcesso(num: string, nota: string) {
    setObsProcessos(prev => prev.map(o => (o.processo.numero_processo ?? "") === num ? { ...o, nota } : o));
  }

  // ── Print PDF ─────────────────────────────────────────────────────────────
  function handlePrint() {
    const conteudo = printRef.current?.innerHTML ?? "";
    const dataHoje = new Date().toLocaleDateString("pt-BR", { dateStyle: "long" });
    const janela   = window.open("", "_blank", "width=1100,height=800");
    if (!janela) return;
    janela.document.write(`<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8"/>
<title>Prestação de Contas — GAP-MN</title>
<style>
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: 'Segoe UI', Arial, sans-serif; font-size: 11px; color: #1e293b; background: #fff; padding: 18mm 16mm; }
  h2 { font-size: 14px; color: #0f766e; border-bottom: 2px solid #0f766e; padding-bottom: 6px; margin-bottom: 14px; margin-top: 20px; }
  h3 { font-size: 12px; color: #334155; margin-bottom: 8px; margin-top: 14px; }
  .header { text-align: center; margin-bottom: 24px; }
  .header h1 { font-size: 20px; color: #0f766e; }
  .header p  { color: #64748b; font-size: 11px; margin-top: 4px; }
  .kpi-grid { display: grid; grid-template-columns: repeat(5, 1fr); gap: 8px; margin-bottom: 14px; }
  .kpi { border: 1px solid #e2e8f0; border-radius: 8px; padding: 10px; text-align: center; }
  .kpi .label { font-size: 9px; color: #94a3b8; margin-bottom: 3px; }
  .kpi .val   { font-size: 14px; font-weight: 700; color: #1e293b; }
  .two-col { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; margin-bottom: 14px; }
  .panel { border: 1px solid #e2e8f0; border-radius: 8px; padding: 12px; }
  .panel-title { font-size: 10px; font-weight: 600; color: #334155; margin-bottom: 8px; }
  table { width: 100%; border-collapse: collapse; font-size: 9px; margin-bottom: 12px; }
  th { background: #f8fafc; border-bottom: 1px solid #e2e8f0; padding: 5px 6px; text-align: left; color: #475569; font-weight: 600; }
  td { padding: 4px 6px; border-bottom: 1px solid #f1f5f9; color: #334155; }
  tr:nth-child(even) td { background: #f8fafc; }
  .obs-item { border: 1px solid #e2e8f0; border-radius: 6px; padding: 8px 10px; margin-bottom: 8px; }
  .obs-header { font-weight: 600; font-size: 10px; color: #0f766e; margin-bottom: 4px; }
  .obs-nota { font-size: 10px; color: #334155; white-space: pre-wrap; }
  .eco-banner { border: 1px solid #99f6e4; background: #f0fdfa; border-radius: 8px; padding: 8px 12px; margin-bottom: 12px; font-size: 11px; color: #0f766e; }
  .alert { border: 1px solid #fde68a; background: #fffbeb; border-radius: 6px; padding: 6px 10px; margin-bottom: 10px; font-size: 9px; color: #92400e; }
  .bar-row { margin-bottom: 6px; }
  .bar-label { display: flex; justify-content: space-between; font-size: 9px; color: #475569; margin-bottom: 2px; }
  .bar-track { height: 7px; border-radius: 4px; background: #f1f5f9; overflow: hidden; }
  .bar-fill  { height: 100%; border-radius: 4px; background: #38bdf8; }
  .text-red { color: #dc2626; font-weight: 600; }
  .text-amber { color: #d97706; font-weight: 600; }
  .footer { margin-top: 28px; text-align: center; font-size: 9px; color: #94a3b8; border-top: 1px solid #e2e8f0; padding-top: 8px; }
  @media print { body { padding: 10mm 8mm; } }
  /* Oculta controles interativos no PDF */
  button, input, textarea, select { display: none !important; }
  .no-print { display: none !important; }
</style></head><body>
<div class="header">
  <h1>Prestação de Contas — GAP-MN</h1>
  <p>Gerado em ${dataHoje}</p>
</div>
${conteudo}
<div class="footer">Aplicativo do GAP-MN • Desenvolvido por 2T Bruno | GAP-MN</div>
</body></html>`);
    janela.document.close();
    setTimeout(() => { janela.focus(); janela.print(); }, 600);
  }

  const wrapClass = isMaximized ? "fixed inset-0 z-50 bg-white overflow-auto p-6" : "space-y-6";
  const dataHoje  = new Date().toLocaleDateString("pt-BR", { dateStyle: "long" });

  return (
    <div className={wrapClass}>

      {/* ── Header ──────────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between gap-3 mb-2">
        <div>
          <div className="text-base font-semibold text-slate-900">Painel — Prestação de Contas</div>
          <div className="text-xs text-slate-500">{dataHoje}</div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handlePrint}
            className="flex items-center gap-1.5 rounded-xl border border-sky-200 bg-sky-50 px-3 py-2 text-sm font-medium text-sky-700 hover:bg-sky-100 transition-colors"
          >
            🖨 Gerar PDF
          </button>
          <button
            onClick={() => setIsMaximized(!isMaximized)}
            className="flex items-center gap-1.5 rounded-xl border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 transition-colors"
          >
            {isMaximized ? "✕ Restaurar" : "⛶ Maximizar"}
          </button>
        </div>
      </div>

      {loading && <div className="text-sm text-slate-500 text-center py-8">Carregando dados...</div>}

      <div ref={printRef} className="space-y-8">

        {/* ═══════════════════════════════════════════════════════════════════
            CONTRATOS — SCON
        ═══════════════════════════════════════════════════════════════════ */}
        {showSCON && !loading && (
          <div className="space-y-4">

            {/* Cabeçalho + filtro UGR */}
            <div className="flex flex-wrap items-center gap-3">
              <h2 className="flex-1 text-sm font-bold text-teal-700 border-b border-teal-200 pb-2 uppercase tracking-wide">
                Contratos — Seção de Contratos
                {filtroUGR !== "todos" && (
                  <span className="ml-2 text-xs font-normal normal-case text-teal-600">({filtroUGR})</span>
                )}
              </h2>
              <select
                value={filtroUGR}
                onChange={(e) => setFiltroUGR(e.target.value)}
                className="no-print rounded-xl border border-slate-200 px-3 py-1.5 text-xs outline-none focus:ring-2 focus:ring-teal-200"
              >
                <option value="todos">Todas as UGRs ({contratos.length})</option>
                {ugrsDisponiveis.map(u => <option key={u} value={u}>{u}</option>)}
              </select>
            </div>

            {!kpiC ? (
              <p className="text-sm text-slate-500">Nenhum contrato cadastrado.</p>
            ) : (
              <>
                {/* KPI cards */}
                <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
                  <KpiCard label="Total"          value={String(contratosFiltrados.length)} />
                  <KpiCard label="Vigentes"        value={String(kpiC.vigentes)}  color="text-emerald-700" />
                  <KpiCard label="Vencidos"        value={String(kpiC.vencidos)}  color={kpiC.vencidos > 0 ? "text-red-600" : "text-slate-800"} />
                  <KpiCard label="Vencendo ≤30d"   value={String(kpiC.venc30)}    color={kpiC.venc30   > 0 ? "text-red-600" : "text-slate-800"} />
                  <KpiCard label="Vencendo ≤90d"   value={String(kpiC.venc90)}    color={kpiC.venc90   > 0 ? "text-amber-600" : "text-slate-800"} />
                </div>

                {kpiC.semDataFinal > 0 && (
                  <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                    ⚠ {kpiC.semDataFinal} contrato{kpiC.semDataFinal !== 1 ? "s" : ""} sem data de vencimento registrada.
                  </div>
                )}

                {/* Grade: Vencimentos | Observações */}
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">

                  {/* Vencimentos — com botão de remoção por linha */}
                  <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm flex flex-col">
                    <div className="flex items-center justify-between mb-3">
                      <div className="text-xs font-semibold text-slate-700">
                        Vencimentos ≤90 dias + Vencidos
                        <span className="ml-2 font-normal text-slate-400">
                          ({kpiC.vencendoList.filter(c => !vencOcultos.has(c.numero_contrato)).length})
                        </span>
                      </div>
                      {vencOcultos.size > 0 && (
                        <button
                          onClick={() => setVencOcultos(new Set())}
                          className="no-print text-xs text-slate-400 hover:text-slate-600"
                        >
                          Restaurar todos
                        </button>
                      )}
                    </div>

                    {kpiC.vencendoList.filter(c => !vencOcultos.has(c.numero_contrato)).length === 0 ? (
                      <p className="text-xs text-slate-500">Nenhum contrato exibido.</p>
                    ) : (
                      <div className="overflow-y-auto max-h-72 flex-1">
                        <table className="w-full text-xs">
                          <thead className="sticky top-0 bg-white">
                            <tr className="border-b border-slate-100">
                              <th className="text-left py-1.5 px-2 font-semibold text-slate-600">Contrato</th>
                              <th className="text-left py-1.5 px-2 font-semibold text-slate-600 hidden sm:table-cell">Fornecedor</th>
                              <th className="text-left py-1.5 px-2 font-semibold text-slate-600">Vencimento</th>
                              <th className="text-right py-1.5 px-2 font-semibold text-slate-600">Saldo</th>
                              <th className="no-print py-1.5 px-1"></th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-50">
                            {kpiC.vencendoList
                              .filter(c => !vencOcultos.has(c.numero_contrato))
                              .map((c) => {
                                const dias    = daysUntil(c.data_final);
                                const vencido = dias < 0;
                                return (
                                  <tr key={c.numero_contrato} className="hover:bg-slate-50">
                                    <td className="py-1.5 px-2 font-medium text-slate-800">{c.numero_contrato}</td>
                                    <td className="py-1.5 px-2 text-slate-600 hidden sm:table-cell truncate max-w-[100px]">{c.fornecedor ?? "–"}</td>
                                    <td className={`py-1.5 px-2 font-semibold ${vencido ? "text-red-600" : dias <= 30 ? "text-amber-600" : "text-slate-700"}`}>
                                      {fmtDate(c.data_final)}
                                      {vencido
                                        ? <span className="ml-1 rounded-full border border-red-200 bg-red-50 px-1.5 text-xs font-normal">VENCIDO</span>
                                        : <span className="ml-1 text-slate-400 font-normal">({dias}d)</span>
                                      }
                                    </td>
                                    <td className="py-1.5 px-2 text-right">{fmtMoney(c.saldo)}</td>
                                    <td className="no-print py-1 px-1 text-right">
                                      <button
                                        onClick={() => setVencOcultos(prev => new Set([...prev, c.numero_contrato]))}
                                        title="Remover da lista"
                                        className="text-slate-300 hover:text-red-400 transition-colors font-bold"
                                      >×</button>
                                    </td>
                                  </tr>
                                );
                              })}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>

                  {/* Observações SCON */}
                  <div className="rounded-xl border border-indigo-100 bg-white p-4 shadow-sm flex flex-col gap-3">
                    <div className="text-xs font-semibold text-slate-700">
                      Observações para Apresentação
                      <span className="ml-2 font-normal text-slate-400">({obsContratos.length})</span>
                    </div>

                    {/* Campo de busca */}
                    <div className="no-print relative">
                      <input
                        value={buscarContrato}
                        onChange={(e) => setBuscarContrato(e.target.value)}
                        placeholder="Buscar contrato por nº, fornecedor ou descrição..."
                        className="w-full rounded-xl border border-slate-200 px-3 py-2 text-xs outline-none focus:ring-2 focus:ring-indigo-200"
                      />
                      {contratosResultadoBusca.length > 0 && (
                        <div className="absolute z-10 mt-1 w-full rounded-xl border border-slate-200 bg-white shadow-lg overflow-hidden">
                          {contratosResultadoBusca.map(c => (
                            <button
                              key={c.numero_contrato}
                              onClick={() => adicionarContrato(c)}
                              className="w-full px-3 py-2 text-left text-xs hover:bg-indigo-50 border-b border-slate-50 last:border-0"
                            >
                              <span className="font-semibold text-slate-800">{c.numero_contrato}</span>
                              {c.fornecedor && <span className="ml-2 text-slate-500">{c.fornecedor}</span>}
                              {c.descricao && <span className="ml-2 text-slate-400 truncate">{c.descricao.slice(0, 40)}</span>}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>

                    {/* Lista de observações */}
                    {obsContratos.length === 0 ? (
                      <p className="text-xs text-slate-400 text-center py-4">
                        Busque um contrato acima para adicionar à lista de observações.
                      </p>
                    ) : (
                      <div className="space-y-3 overflow-y-auto max-h-64">
                        {obsContratos.map((obs) => (
                          <div key={obs.contrato.numero_contrato} className="rounded-xl border border-indigo-100 bg-indigo-50/40 p-3">
                            <div className="flex items-start justify-between gap-2 mb-2">
                              <div>
                                <div className="text-xs font-semibold text-indigo-800">{obs.contrato.numero_contrato}</div>
                                <div className="text-xs text-slate-500">
                                  {obs.contrato.fornecedor ?? "–"}
                                  {obs.contrato.data_final && (
                                    <span className="ml-2">Venc: {fmtDate(obs.contrato.data_final)}</span>
                                  )}
                                  {obs.contrato.saldo != null && (
                                    <span className="ml-2">Saldo: {fmtMoney(obs.contrato.saldo)}</span>
                                  )}
                                </div>
                              </div>
                              <button
                                onClick={() => removerObsContrato(obs.contrato.numero_contrato)}
                                className="no-print shrink-0 text-xs text-slate-400 hover:text-red-500"
                                title="Remover observação"
                              >× remover</button>
                            </div>
                            <textarea
                              value={obs.nota}
                              onChange={(e) => atualizarNotaContrato(obs.contrato.numero_contrato, e.target.value)}
                              placeholder="Escreva sua observação sobre este contrato..."
                              rows={2}
                              className="w-full rounded-lg border border-indigo-200 bg-white px-2 py-1.5 text-xs outline-none focus:ring-2 focus:ring-indigo-200 resize-none"
                            />
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                </div>
              </>
            )}
          </div>
        )}

        {/* ═══════════════════════════════════════════════════════════════════
            PROCESSOS — SLIC
        ═══════════════════════════════════════════════════════════════════ */}
        {showSLIC && !loading && (
          <div className="space-y-4">

            {/* Cabeçalho + filtro ano */}
            <div className="flex flex-wrap items-center gap-3">
              <h2 className="flex-1 text-sm font-bold text-sky-700 border-b border-sky-200 pb-2 uppercase tracking-wide">
                Processos Licitatórios — Seção de Licitações
              </h2>
              <div className="no-print flex gap-1">
                {(["todos", "2024", "2025", "2026"] as const).map((a) => (
                  <button
                    key={a}
                    onClick={() => setFiltroAnoSLIC(a)}
                    className={`px-3 py-1.5 text-xs rounded-lg border transition-colors ${
                      filtroAnoSLIC === a
                        ? "bg-sky-600 border-sky-600 text-white"
                        : "border-slate-200 text-slate-600 hover:bg-slate-50"
                    }`}
                  >{a === "todos" ? "Todos" : a}</button>
                ))}
              </div>
            </div>

            {!kpiP ? (
              <p className="text-sm text-slate-500">Nenhum processo cadastrado.</p>
            ) : (
              <>
                {/* KPI cards */}
                <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
                  <KpiCard label="Total"           value={String(processosFiltrados.length)} />
                  <KpiCard label="Em Andamento"    value={String(kpiP.andamento)}   color="text-sky-700"
                    onClick={() => setActiveKpiSLIC(v => v === "andamento"   ? null : "andamento")}
                    active={activeKpiSLIC === "andamento"} />
                  <KpiCard label="Homologados"     value={String(kpiP.homologados)} color="text-emerald-700"
                    onClick={() => setActiveKpiSLIC(v => v === "homologados" ? null : "homologados")}
                    active={activeKpiSLIC === "homologados"} />
                  <KpiCard label="Revogados/Susp." value={String(kpiP.revogados)}   color={kpiP.revogados > 0 ? "text-purple-700" : "text-slate-800"}
                    onClick={() => setActiveKpiSLIC(v => v === "revogados"   ? null : "revogados")}
                    active={activeKpiSLIC === "revogados"} />
                  <KpiCard label="Valor Homologado" value={fmtMoney(kpiP.totalHom)} color="text-emerald-700" />
                </div>

                {/* Painel de detalhes do KPI selecionado */}
                {activeKpiSLIC && (() => {
                  const lista =
                    activeKpiSLIC === "andamento"   ? kpiP.andamentoList   :
                    activeKpiSLIC === "homologados" ? kpiP.homologadosList :
                    kpiP.revogadosList;
                  const titulo =
                    activeKpiSLIC === "andamento"   ? "Em Andamento" :
                    activeKpiSLIC === "homologados" ? "Homologados"  : "Revogados / Suspensos";
                  return (
                    <div className="rounded-xl border border-sky-200 bg-white shadow-sm overflow-hidden">
                      <div className="flex items-center justify-between px-4 py-2 border-b border-sky-100 bg-sky-50">
                        <div className="text-xs font-semibold text-sky-800">{titulo} — {lista.length} processo{lista.length !== 1 ? "s" : ""}</div>
                        <button onClick={() => setActiveKpiSLIC(null)} className="text-xs text-slate-400 hover:text-slate-700">✕ Fechar</button>
                      </div>
                      <div className="overflow-x-auto max-h-72 overflow-y-auto">
                        <table className="w-full text-xs">
                          <thead className="sticky top-0 bg-white border-b border-slate-100">
                            <tr>
                              <th className="text-left py-2 px-3 font-semibold text-slate-600 whitespace-nowrap">Processo</th>
                              <th className="text-left py-2 px-3 font-semibold text-slate-600">Objeto</th>
                              <th className="text-left py-2 px-3 font-semibold text-slate-600 whitespace-nowrap">Situação</th>
                              <th className="text-right py-2 px-3 font-semibold text-slate-600 whitespace-nowrap">
                                {activeKpiSLIC === "homologados" ? "Vl. Homologado" : "Vl. Estimado"}
                              </th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-50">
                            {lista.map((p, i) => (
                              <tr key={i} className="hover:bg-slate-50">
                                <td className="py-1.5 px-3 font-medium text-slate-800 whitespace-nowrap">
                                  {p.numero_processo ?? "–"}
                                  {p.ano && <span className="ml-1 text-slate-400 font-normal">({p.ano})</span>}
                                </td>
                                <td className="py-1.5 px-3 text-slate-600 max-w-xs whitespace-normal break-words leading-relaxed">
                                  {p.objeto ?? "–"}
                                </td>
                                <td className="py-1.5 px-3 text-slate-500 whitespace-nowrap">{p.situacao_api ?? "–"}</td>
                                <td className="py-1.5 px-3 text-right text-slate-700 whitespace-nowrap font-medium">
                                  {activeKpiSLIC === "homologados"
                                    ? fmtMoney(p.valor_homologado)
                                    : fmtMoney(p.valor_estimado)}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  );
                })()}

                {/* Banner economia */}
                {kpiP.economia > 0 && (
                  <div className="rounded-xl border border-teal-200 bg-teal-50 px-4 py-3 flex flex-wrap items-center gap-4">
                    <div>
                      <div className="text-xs text-teal-600 font-medium">Diferença de</div>
                      <div className="text-lg font-bold text-teal-800">{fmtMoney(kpiP.economia)}</div>
                    </div>
                    <div className="text-sm font-semibold text-teal-700">
                      {kpiP.pctEco.toFixed(1)}% sobre o valor estimado dos processos homologados
                    </div>
                  </div>
                )}

                {/* Grade: Em Andamento | Observações */}
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">

                  {/* Em Andamento — com remoção por linha */}
                  <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm flex flex-col">
                    <div className="flex items-center justify-between mb-3">
                      <div className="text-xs font-semibold text-slate-700">
                        Em Andamento
                        <span className="ml-2 font-normal text-slate-400">
                          ({kpiP.andamentoList.filter(p => !andOcultos.has(p.numero_processo ?? "")).length})
                        </span>
                      </div>
                      {andOcultos.size > 0 && (
                        <button
                          onClick={() => setAndOcultos(new Set())}
                          className="no-print text-xs text-slate-400 hover:text-slate-600"
                        >
                          Restaurar todos
                        </button>
                      )}
                    </div>

                    {kpiP.andamentoList.filter(p => !andOcultos.has(p.numero_processo ?? "")).length === 0 ? (
                      <p className="text-xs text-slate-500">Nenhum processo exibido.</p>
                    ) : (
                      <div className="overflow-y-auto max-h-72 flex-1">
                        <table className="w-full text-xs">
                          <thead className="sticky top-0 bg-white">
                            <tr className="border-b border-slate-100">
                              <th className="text-left py-1.5 px-2 font-semibold text-slate-600">Processo</th>
                              <th className="text-left py-1.5 px-2 font-semibold text-slate-600">Objeto</th>
                              <th className="text-right py-1.5 px-2 font-semibold text-slate-600">Vl. Est.</th>
                              <th className="no-print py-1.5 px-1"></th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-50">
                            {kpiP.andamentoList
                              .filter(p => !andOcultos.has(p.numero_processo ?? ""))
                              .map((p, i) => (
                                <tr key={i} className="hover:bg-slate-50">
                                  <td className="py-1.5 px-2 font-medium text-slate-800 whitespace-nowrap">
                                    {p.numero_processo ?? "–"}
                                    {p.ano && <span className="text-slate-400 font-normal ml-1">({p.ano})</span>}
                                  </td>
                                  <td className="py-1.5 px-2 text-slate-600 truncate max-w-[160px]">
                                    {(p.objeto ?? "–").slice(0, 50)}
                                  </td>
                                  <td className="py-1.5 px-2 text-right text-slate-600 whitespace-nowrap">
                                    {fmtMoney(p.valor_estimado)}
                                  </td>
                                  <td className="no-print py-1 px-1 text-right">
                                    <button
                                      onClick={() => setAndOcultos(prev => new Set([...prev, p.numero_processo ?? ""]))}
                                      title="Remover da lista"
                                      className="text-slate-300 hover:text-red-400 transition-colors font-bold"
                                    >×</button>
                                  </td>
                                </tr>
                              ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>

                  {/* Observações SLIC */}
                  <div className="rounded-xl border border-sky-100 bg-white p-4 shadow-sm flex flex-col gap-3">
                    <div className="text-xs font-semibold text-slate-700">
                      Observações para Apresentação
                      <span className="ml-2 font-normal text-slate-400">({obsProcessos.length})</span>
                    </div>

                    {/* Campo de busca */}
                    <div className="no-print relative">
                      <input
                        value={buscarProcesso}
                        onChange={(e) => setBuscarProcesso(e.target.value)}
                        placeholder="Buscar processo por nº ou objeto..."
                        className="w-full rounded-xl border border-slate-200 px-3 py-2 text-xs outline-none focus:ring-2 focus:ring-sky-200"
                      />
                      {processosResultadoBusca.length > 0 && (
                        <div className="absolute z-10 mt-1 w-full rounded-xl border border-slate-200 bg-white shadow-lg overflow-hidden">
                          {processosResultadoBusca.map((p, i) => (
                            <button
                              key={i}
                              onClick={() => adicionarProcesso(p)}
                              className="w-full px-3 py-2 text-left text-xs hover:bg-sky-50 border-b border-slate-50 last:border-0"
                            >
                              <span className="font-semibold text-slate-800">
                                {p.numero_processo ?? "–"} ({p.ano})
                              </span>
                              {p.objeto && (
                                <span className="ml-2 text-slate-500">{p.objeto.slice(0, 50)}</span>
                              )}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>

                    {/* Lista de observações */}
                    {obsProcessos.length === 0 ? (
                      <p className="text-xs text-slate-400 text-center py-4">
                        Busque um processo acima para adicionar à lista de observações.
                      </p>
                    ) : (
                      <div className="space-y-3 overflow-y-auto max-h-64">
                        {obsProcessos.map((obs) => (
                          <div key={obs.processo.numero_processo ?? obs.processo.objeto ?? ""} className="rounded-xl border border-sky-100 bg-sky-50/40 p-3">
                            <div className="flex items-start justify-between gap-2 mb-2">
                              <div>
                                <div className="text-xs font-semibold text-sky-800">
                                  {obs.processo.numero_processo ?? "–"} ({obs.processo.ano})
                                </div>
                                <div className="text-xs text-slate-500">
                                  {obs.processo.modalidade ?? "–"}
                                  {obs.processo.valor_estimado != null && (
                                    <span className="ml-2">Est: {fmtMoney(obs.processo.valor_estimado)}</span>
                                  )}
                                  {obs.processo.valor_homologado != null && (
                                    <span className="ml-2 text-emerald-600 font-medium">Hom: {fmtMoney(obs.processo.valor_homologado)}</span>
                                  )}
                                </div>
                                {obs.processo.objeto && (
                                  <div className="text-xs text-slate-400 mt-0.5">{obs.processo.objeto}</div>
                                )}
                              </div>
                              <button
                                onClick={() => removerObsProcesso(obs.processo.numero_processo ?? "")}
                                className="no-print shrink-0 text-xs text-slate-400 hover:text-red-500"
                                title="Remover observação"
                              >× remover</button>
                            </div>
                            <textarea
                              value={obs.nota}
                              onChange={(e) => atualizarNotaProcesso(obs.processo.numero_processo ?? "", e.target.value)}
                              placeholder="Escreva sua observação sobre este processo..."
                              rows={2}
                              className="w-full rounded-lg border border-sky-200 bg-white px-2 py-1.5 text-xs outline-none focus:ring-2 focus:ring-sky-200 resize-none"
                            />
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                </div>

                {/* Por Modalidade */}
                <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                  <div className="text-xs font-semibold text-slate-700 mb-3">Por Modalidade</div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-8 gap-y-2">
                    {kpiP.modalRows.map(([modal, count]) => (
                      <BarRow
                        key={modal}
                        label={modal}
                        pct={(count / processosFiltrados.length) * 100}
                        val={`${count} processo${count !== 1 ? "s" : ""}`}
                        color="bg-sky-500"
                      />
                    ))}
                  </div>
                </div>

              </>
            )}
          </div>
        )}

      </div>
    </div>
  );
}
