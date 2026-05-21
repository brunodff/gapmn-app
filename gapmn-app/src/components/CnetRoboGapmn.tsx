import { useState, useEffect, useMemo, useRef } from "react";
import { supabase } from "../lib/supabase";

// ─── Types ────────────────────────────────────────────────────────────────────
type CnetRow = {
  id?: number;
  processo: string; ano: string; uasg: string; grupo: string; item: string;
  nome_item: string; cnpj: string; razao_social: string; uf: string;
  status: string; me_epp: string; valor_ofertado: string; valor_negociado: string;
  situacao_item: string; qtde_solicitada: string; descricao_item: string;
  criterio_julgamento: string; sit_processo: string; valor_estimado: string;
  importado_em?: string;
};

type ItemGroup = {
  iKey: string; item: string; grupo: string; nome_item: string;
  situacao_item: string; qtde_solicitada: string; valor_estimado: string;
  descricao_item: string; fornecedores: CnetRow[];
};

type ProcGroup = {
  proc: string; sit_processo: string; criterio: string; ano: string;
  items: ItemGroup[]; totalForn: number; totalEst: number;
};

// ─── Helpers ──────────────────────────────────────────────────────────────────
function parseCSVSimple(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], field = "", inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') { if (inQ && text[i + 1] === '"') { field += '"'; i++; } else inQ = !inQ; }
    else if (c === ',' && !inQ) { row.push(field); field = ""; }
    else if ((c === '\n' || c === '\r') && !inQ) {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); rows.push(row); row = []; field = "";
    } else { field += c; }
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows.filter(r => r.some(c => c.trim()));
}

function parseMoney(s: string): number {
  if (!s) return 0;
  return parseFloat(s.replace(/\./g, '').replace(',', '.').replace(/[^\d.]/g, '')) || 0;
}

function fmtMoney(v: number): string {
  if (!v) return '–';
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v);
}

function sitCls(s: string): string {
  const sl = (s ?? '').toLowerCase();
  if (sl.includes('homolog') && !sl.includes('fracass') && !sl.includes('deserto'))
    return 'bg-green-100 text-green-700 border-green-200';
  if (sl.includes('fracass') || sl.includes('deserto'))
    return 'bg-yellow-100 text-yellow-700 border-yellow-200';
  if (sl.includes('cancelad') || sl.includes('revog') || sl.includes('anulad'))
    return 'bg-red-100 text-red-700 border-red-200';
  return 'bg-sky-100 text-sky-700 border-sky-200';
}

function statusCls(s: string): string {
  const sl = (s ?? '').toLowerCase();
  if (sl.includes('vencedor') || sl.includes('adjudic') || sl.includes('homolog'))
    return 'bg-green-100 text-green-700 border-green-200';
  if (sl.includes('desclass'))
    return 'bg-red-100 text-red-700 border-red-200';
  return 'bg-gray-100 text-gray-600 border-gray-200';
}

// ─── Constants ────────────────────────────────────────────────────────────────
const DEF_TAB  = 'PNCP - 120630';

const ENDPOINT_CODE = `function doPost(e) {
  if (!e || !e.postData) return ContentService.createTextOutput("no data");

  var data = JSON.parse(e.postData.contents);
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(data.aba) || ss.insertSheet(data.aba);

  if (data.clear) sh.clearContents();
  if (data.moveFirst) { ss.setActiveSheet(sh); ss.moveActiveSheet(1); }
  if (sh.getLastRow() === 0) sh.appendRow(data.headers);

  data.rows.forEach(function(r) { sh.appendRow(r); });
  return ContentService.createTextOutput("ok");
}`;

const LAYOUT_CODE = `function aplicarLayoutFABEmTodasAsAbas() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  ss.getSheets().forEach(sheet => {
    const lastRow = sheet.getLastRow();
    const lastCol = sheet.getLastColumn();
    if (lastRow < 1 || lastCol < 1) return;
    sheet.getRange(1, 1, 1, lastCol)
      .setBackground("#14223D").setFontColor("#FFFFFF")
      .setFontWeight("bold").setHorizontalAlignment("center");
    sheet.setFrozenRows(1);
    sheet.getRange(2, 1, Math.max(lastRow - 1, 1), lastCol).setWrap(true);
    sheet.setHiddenGridlines(true);
  });
  SpreadsheetApp.getActiveSpreadsheet().toast("Layout aplicado.", "FAB", 5);
}`;

// ─── Component ────────────────────────────────────────────────────────────────
export default function CnetRoboGapmn({ canImport = false }: { canImport?: boolean }) {
  const [rows, setRows]           = useState<CnetRow[]>([]);
  const [loading, setLoading]     = useState(true);
  const [loadErr, setLoadErr]     = useState<string | null>(null);
  const [showManual, setShowManual] = useState(false);
  const [expandedProcs, setExpandedProcs] = useState<Set<string>>(new Set());
  const [expandedItems, setExpandedItems] = useState<Set<string>>(new Set());
  const [search, setSearch]       = useState('');
  const [filtroSit, setFiltroSit] = useState('');
  const [filtroAno, setFiltroAno] = useState('');
  const [filtroProc, setFiltroProc] = useState('');

  useEffect(() => { loadData(); }, []);

  async function loadData() {
    setLoading(true);
    setLoadErr(null);
    const { data, error } = await supabase
      .from('cnet_propostas_gapmn')
      .select('*')
      .order('processo')
      .order('grupo')
      .order('item');
    if (error) setLoadErr(error.message);
    setRows((data ?? []) as CnetRow[]);
    setLoading(false);
  }

  const lastUpdate = useMemo(() => {
    const dates = rows.map(r => r.importado_em).filter(Boolean) as string[];
    if (!dates.length) return null;
    const max = dates.reduce((a, b) => (a > b ? a : b));
    return new Date(max).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  }, [rows]);

  const allAnos  = useMemo(() => [...new Set(rows.map(r => r.ano).filter(Boolean))].sort(), [rows]);
  const allProcs = useMemo(() => [...new Set(rows.map(r => r.processo))].sort((a, b) => a.localeCompare(b, 'pt-BR', { numeric: true })), [rows]);

  const grouped = useMemo((): ProcGroup[] => {
    const s = search.toLowerCase();
    const filtered = rows.filter(r => {
      if (filtroSit  && !(r.sit_processo || '').toLowerCase().includes(filtroSit.toLowerCase())) return false;
      if (filtroAno  && r.ano !== filtroAno) return false;
      if (filtroProc && r.processo !== filtroProc) return false;
      if (s && !(r.processo || '').toLowerCase().includes(s) && !(r.nome_item || '').toLowerCase().includes(s) &&
          !(r.razao_social || '').toLowerCase().includes(s) && !(r.cnpj || '').includes(s)) return false;
      return true;
    });
    const procMap = new Map<string, CnetRow[]>();
    for (const r of filtered) { const a = procMap.get(r.processo) ?? []; a.push(r); procMap.set(r.processo, a); }
    return [...procMap.entries()].map(([proc, pRows]) => {
      const itemMap = new Map<string, CnetRow[]>();
      for (const r of pRows) {
        const iKey = (r.grupo ? `G${r.grupo}` : '') + `I${r.item}`;
        const a = itemMap.get(iKey) ?? []; a.push(r); itemMap.set(iKey, a);
      }
      const items = [...itemMap.entries()].map(([iKey, iRows]) => ({
        iKey, item: iRows[0].item, grupo: iRows[0].grupo, nome_item: iRows[0].nome_item,
        situacao_item: iRows[0].situacao_item, qtde_solicitada: iRows[0].qtde_solicitada,
        valor_estimado: iRows[0].valor_estimado, descricao_item: iRows[0].descricao_item,
        fornecedores: iRows,
      })).sort((a, b) => {
        const ga = parseInt(a.grupo) || 0, gb = parseInt(b.grupo) || 0;
        if (ga !== gb) return ga - gb;
        return (parseInt(a.item) || 0) - (parseInt(b.item) || 0);
      });
      const totalForn = items.reduce((a, i) => a + i.fornecedores.filter(f => f.cnpj !== 'DESERTO').length, 0);
      const totalEst  = items.reduce((a, i) => {
        const unit = parseMoney(i.valor_estimado);
        const qtde = parseFloat((i.qtde_solicitada || '').replace(',', '.')) || 1;
        return a + unit * qtde;
      }, 0);
      return { proc, sit_processo: pRows[0].sit_processo, criterio: pRows[0].criterio_julgamento, ano: pRows[0].ano, items, totalForn, totalEst };
    }).sort((a, b) => a.proc.localeCompare(b.proc, 'pt-BR', { numeric: true }));
  }, [rows, search, filtroSit, filtroAno, filtroProc]);

  const allSits = useMemo(() => [...new Set(rows.map(r => r.sit_processo).filter(Boolean))].sort(), [rows]);

  const [deletingProc, setDeletingProc] = useState<string | null>(null);

  function toggleProc(p: string) {
    setExpandedProcs(prev => { const n = new Set(prev); n.has(p) ? n.delete(p) : n.add(p); return n; });
  }
  function toggleItem(k: string) {
    setExpandedItems(prev => { const n = new Set(prev); n.has(k) ? n.delete(k) : n.add(k); return n; });
  }

  async function deleteProcesso(proc: string) {
    if (!window.confirm(`Apagar todos os dados do processo "${proc}" do Supabase?`)) return;
    setDeletingProc(proc);
    await supabase.from('cnet_propostas_gapmn').delete().eq('processo', proc);
    setDeletingProc(null);
    setExpandedProcs(prev => { const n = new Set(prev); n.delete(proc); return n; });
    await loadData();
  }

  return (
    <div className="space-y-4">
      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h3 className="text-base font-semibold text-gray-800">Robô CNET — Processos GAP-MN</h3>
          <p className="text-xs text-gray-500 mt-0.5">
            {rows.length > 0
              ? `${rows.length} registros · UASG 120630${lastUpdate ? ` · Atualizado em ${lastUpdate}` : ''}`
              : 'UASG 120630 · Nenhum dado ainda — execute o robô com UASG 120630'}
          </p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <button
            onClick={() => setShowManual(v => !v)}
            className="rounded-xl border border-gray-200 px-3 py-1.5 text-xs text-gray-600 hover:bg-gray-50"
          >
            📖 {showManual ? 'Ocultar manual' : 'Manual de uso'}
          </button>
          <button
            onClick={loadData}
            className="rounded-xl border border-gray-200 px-3 py-1.5 text-xs text-gray-600 hover:bg-gray-50"
          >
            ↺ Atualizar
          </button>
        </div>
      </div>

      {/* ── Erro de carregamento ───────────────────────────────────────────── */}
      {loadErr && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
          Erro ao carregar dados: {loadErr}
        </div>
      )}

      {/* ── Manual ─────────────────────────────────────────────────────────── */}
      {showManual && <ManualRobo />}

      {/* ── Filters ────────────────────────────────────────────────────────── */}
      {(rows.length > 0 || search || filtroSit || filtroAno || filtroProc) && (
        <div className="flex gap-2 flex-wrap items-center">
          <input
            value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Buscar processo, item, CNPJ, empresa…"
            className="flex-1 min-w-40 rounded-xl border border-gray-200 px-3 py-1.5 text-xs outline-none focus:ring-2 focus:ring-sky-200"
          />
          <select
            value={filtroProc} onChange={e => setFiltroProc(e.target.value)}
            className="rounded-xl border border-gray-200 px-3 py-1.5 text-xs bg-white outline-none focus:ring-2 focus:ring-sky-200"
          >
            <option value="">Todos os processos</option>
            {allProcs.map(p => <option key={p} value={p}>{p}</option>)}
          </select>
          <select
            value={filtroSit} onChange={e => setFiltroSit(e.target.value)}
            className="rounded-xl border border-gray-200 px-3 py-1.5 text-xs bg-white outline-none focus:ring-2 focus:ring-sky-200"
          >
            <option value="">Todas as situações</option>
            {allSits.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
          <select
            value={filtroAno} onChange={e => setFiltroAno(e.target.value)}
            className="rounded-xl border border-gray-200 px-3 py-1.5 text-xs bg-white outline-none focus:ring-2 focus:ring-sky-200"
          >
            <option value="">Todos os anos</option>
            {allAnos.map(a => <option key={a} value={a}>{a}</option>)}
          </select>
          {(search || filtroSit || filtroAno || filtroProc) && (
            <button
              onClick={() => { setSearch(''); setFiltroSit(''); setFiltroAno(''); setFiltroProc(''); }}
              className="rounded-xl border border-gray-200 px-2 py-1.5 text-xs text-gray-500 hover:bg-gray-50"
              title="Limpar filtros"
            >✕</button>
          )}
          <span className="text-xs text-gray-400">{grouped.length} processo(s)</span>
        </div>
      )}

      {/* ── Data table ─────────────────────────────────────────────────────── */}
      {loading ? (
        <p className="text-sm text-gray-400 py-4">Carregando…</p>
      ) : rows.length === 0 ? (
        <div className="rounded-xl border border-dashed border-gray-200 py-14 text-center">
          <p className="text-sm text-gray-400">Nenhum dado ainda.</p>
          <p className="text-xs text-gray-300 mt-1">
            Execute o robô com UASG 120630. Os dados serão gravados automaticamente.
          </p>
        </div>
      ) : grouped.length === 0 ? (
        <p className="text-sm text-gray-400 py-4">Nenhum processo para os filtros selecionados.</p>
      ) : (
        <div className="space-y-2">
          {grouped.map(g => {
            const procExpanded = expandedProcs.has(g.proc);
            return (
              <div key={g.proc} className="rounded-xl border border-gray-200 overflow-hidden bg-white">
                {/* Process header */}
                <div
                  className="flex items-start justify-between gap-3 p-3 cursor-pointer hover:bg-gray-50 select-none"
                  onClick={() => toggleProc(g.proc)}
                >
                  <div className="flex items-center gap-2 flex-wrap min-w-0">
                    <span className="text-sm font-semibold text-gray-800">{g.proc}</span>
                    {g.ano && <span className="text-xs text-gray-400">· {g.ano}</span>}
                    {g.sit_processo && (
                      <span className={`rounded border px-1.5 py-0.5 text-xs font-medium ${sitCls(g.sit_processo)}`}>
                        {g.sit_processo}
                      </span>
                    )}
                    {g.criterio && (
                      <span className="rounded bg-gray-100 border border-gray-200 px-1.5 py-0.5 text-xs text-gray-500">
                        {g.criterio}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-3 shrink-0 text-xs text-gray-500 pt-0.5">
                    <span>{g.items.length} itens</span>
                    <span>{g.totalForn} propostas</span>
                    {g.totalEst > 0 && (
                      <span className="font-medium text-gray-700">{fmtMoney(g.totalEst)}</span>
                    )}
                    <button
                      onClick={e => { e.stopPropagation(); deleteProcesso(g.proc); }}
                      disabled={deletingProc === g.proc}
                      className="rounded border border-red-200 bg-red-50 px-2 py-0.5 text-xs text-red-600 hover:bg-red-100 disabled:opacity-50"
                      title="Apagar processo do Supabase"
                    >
                      {deletingProc === g.proc ? '…' : '🗑'}
                    </button>
                    <span className="text-gray-400 text-base leading-none">{procExpanded ? '▲' : '▼'}</span>
                  </div>
                </div>

                {/* Items list */}
                {procExpanded && (
                  <div className="border-t border-gray-100">
                    {g.items.map(itm => {
                      const iKey = g.proc + '|' + itm.iKey;
                      const itmExpanded = expandedItems.has(iKey);
                      return (
                        <div key={itm.iKey} className="border-b border-gray-100 last:border-0">
                          <div
                            className="flex items-center justify-between gap-2 px-4 py-2.5 cursor-pointer hover:bg-gray-50 select-none"
                            onClick={() => toggleItem(iKey)}
                          >
                            <div className="flex items-center gap-2 flex-wrap min-w-0">
                              <span className="text-xs font-mono font-medium text-gray-400 shrink-0">
                                {itm.grupo ? `G${itm.grupo}·` : ''}I{itm.item}
                              </span>
                              <span className="text-sm text-gray-800 truncate max-w-xs" title={itm.nome_item}>
                                {itm.nome_item || '—'}
                              </span>
                              {itm.situacao_item && (
                                <span className={`rounded border px-1 py-0 text-xs ${sitCls(itm.situacao_item)}`}>
                                  {itm.situacao_item}
                                </span>
                              )}
                            </div>
                            <div className="flex items-center gap-3 shrink-0 text-xs text-gray-500">
                              {itm.qtde_solicitada && <span>Qtde: {itm.qtde_solicitada}</span>}
                              {itm.valor_estimado && (
                                <span className="font-medium text-gray-600">R$ {itm.valor_estimado}</span>
                              )}
                              <span className="text-gray-300">{itmExpanded ? '▲' : '▼'}</span>
                            </div>
                          </div>

                          {itmExpanded && (
                            <div className="px-4 pb-4 pt-1 bg-gray-50/50">
                              {itm.descricao_item && (
                                <p className="text-xs text-gray-500 mb-2 italic leading-relaxed">
                                  {itm.descricao_item}
                                </p>
                              )}
                              {itm.fornecedores.length === 1 && itm.fornecedores[0].cnpj === 'DESERTO' ? (
                                <p className="text-xs text-yellow-700 bg-yellow-50 border border-yellow-200 rounded-lg px-3 py-2">
                                  Item deserto — sem propostas recebidas
                                </p>
                              ) : (
                                <div className="overflow-x-auto rounded-lg border border-gray-200">
                                  <table className="w-full text-xs">
                                    <thead>
                                      <tr className="bg-gray-100 border-b border-gray-200">
                                        {['CNPJ','Razão Social','UF','Status','ME/EPP','Valor Ofertado','Valor Negociado'].map(h => (
                                          <th key={h} className="text-left px-2 py-1.5 text-gray-500 font-medium whitespace-nowrap">
                                            {h}
                                          </th>
                                        ))}
                                      </tr>
                                    </thead>
                                    <tbody>
                                      {itm.fornecedores
                                        .filter(f => f.cnpj !== 'DESERTO')
                                        .map((f, fi) => (
                                          <tr key={fi} className="border-b border-gray-100 last:border-0 hover:bg-white">
                                            <td className="px-2 py-1.5 font-mono text-gray-500">{f.cnpj}</td>
                                            <td className="px-2 py-1.5 text-gray-800 max-w-xs">
                                              <span className="block truncate" title={f.razao_social}>{f.razao_social}</span>
                                            </td>
                                            <td className="px-2 py-1.5 text-gray-500">{f.uf}</td>
                                            <td className="px-2 py-1.5">
                                              {f.status && (
                                                <span className={`rounded border px-1.5 py-0 text-xs ${statusCls(f.status)}`}>
                                                  {f.status}
                                                </span>
                                              )}
                                            </td>
                                            <td className="px-2 py-1.5">
                                              {f.me_epp === 'Sim' && (
                                                <span className="rounded bg-amber-100 border border-amber-200 text-amber-700 px-1.5 py-0 text-xs">
                                                  ME/EPP
                                                </span>
                                              )}
                                            </td>
                                            <td className="px-2 py-1.5 text-right text-gray-600">{f.valor_ofertado || '–'}</td>
                                            <td className="px-2 py-1.5 text-right font-semibold text-gray-800">{f.valor_negociado || '–'}</td>
                                          </tr>
                                        ))}
                                    </tbody>
                                  </table>
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

const BOOKMARKLET = `javascript:(function(){var s=document.createElement('script');s.src='https://gapmn.app/cnet-bot.js?_='+Date.now();document.head.appendChild(s);}())`;

// ─── Manual ───────────────────────────────────────────────────────────────────
function ManualRobo() {
  const [copiedEp, setCopiedEp]   = useState(false);
  const [copiedLay, setCopiedLay] = useState(false);
  const [copiedBm, setCopiedBm]   = useState(false);
  const bmRef = useRef<HTMLAnchorElement>(null);

  useEffect(() => {
    // React bloqueia javascript: em href — setar via DOM bypassa a sanitização
    if (bmRef.current) bmRef.current.setAttribute('href', BOOKMARKLET);
  }, []);

  function copy(text: string, set: (v: boolean) => void) {
    navigator.clipboard.writeText(text).then(() => { set(true); setTimeout(() => set(false), 2000); });
  }

  const TRow = ({ label, children }: { label: string; children: React.ReactNode }) => (
    <tr className="border-b border-gray-100 last:border-0">
      <td className="px-3 py-2 bg-gray-50 font-medium text-gray-600 text-xs w-44 align-top">{label}</td>
      <td className="px-3 py-2 text-gray-700 text-xs">{children}</td>
    </tr>
  );

  return (
    <div className="rounded-xl border border-sky-100 bg-sky-50/40 p-5 space-y-6 text-sm">
      <h4 className="font-bold text-gray-800 text-base">Manual do Robô CNET — GAP-MN</h4>

      {/* Bookmarklet */}
      <section>
        <h5 className="font-semibold text-gray-700 mb-2 flex items-center gap-2">
          <span className="w-5 h-5 rounded-full bg-sky-600 text-white flex items-center justify-center text-xs">★</span>
          Instalar o robô no navegador
        </h5>
        <div className="rounded-xl border border-sky-200 bg-sky-50 p-4 space-y-2">
          <p className="text-xs text-gray-700 leading-relaxed">
            Arraste o botão abaixo para a <strong>barra de favoritos</strong> do seu navegador.
            Sempre que estiver numa página do ComprasNet, clique nele para iniciar o robô.
          </p>
          <div className="flex items-center gap-3 flex-wrap">
            {/* href="#" no React — o useEffect seta o href real via DOM */}
            <a
              ref={bmRef}
              href="#"
              className="inline-block rounded-xl bg-sky-600 px-4 py-2 text-sm font-bold text-white shadow hover:bg-sky-700 cursor-grab active:cursor-grabbing select-none"
              onClick={e => { e.preventDefault(); copy(BOOKMARKLET, setCopiedBm); }}
              title="Clique para copiar a URL — depois crie o favorito manualmente. Ou arraste para a barra de favoritos."
            >
              {copiedBm ? '✓ URL copiada!' : '🤖 Robô CNET'}
            </a>
            <span className="text-xs text-gray-500">← clique para copiar ou arraste para a barra</span>
          </div>
          <p className="text-xs text-gray-400">
            <strong>Para instalar:</strong> clique o botão acima para copiar a URL → pressione <strong>Ctrl+Shift+B</strong> para mostrar a barra de favoritos → clique com botão direito na barra → <em>Adicionar marcador/página…</em> → cole no campo URL → salvar.<br />
            Ou arraste diretamente o botão para a barra.
          </p>
        </div>
      </section>

      {/* 1 */}
      <section>
        <h5 className="font-semibold text-gray-700 mb-2 flex items-center gap-2">
          <span className="w-5 h-5 rounded-full bg-sky-600 text-white flex items-center justify-center text-xs">1</span>
          Orientação geral
        </h5>
        <table className="w-full border border-gray-200 rounded-xl overflow-hidden">
          <tbody>
            <TRow label="Endpoint individual">
              Cada militar deverá criar seu próprio endpoint, ou seja, sua própria planilha vinculada ao Apps Script.
            </TRow>
            <TRow label="Finalidade">
              Esse endpoint será utilizado para receber os dados enviados pelo robô diretamente na planilha criada pelo militar.
            </TRow>
          </tbody>
        </table>
      </section>

      {/* 2 */}
      <section>
        <h5 className="font-semibold text-gray-700 mb-3 flex items-center gap-2">
          <span className="w-5 h-5 rounded-full bg-sky-600 text-white flex items-center justify-center text-xs">2</span>
          Passo a passo para gerar o link do Apps Script
        </h5>
        <div className="space-y-2">
          {[
            'Crie uma nova planilha no Google Sheets.',
            'Na planilha, acesse: Extensões → Apps Script.',
            'Apague todo o código existente no editor.',
            'Cole o código informado abaixo (Seção 4).',
            'Clique em Salvar.',
            'Clique em Implantar → Nova implantação.',
            'Selecione o tipo: App da Web.',
            'Em Acesso, selecione: Qualquer pessoa.',
            'Copie a URL gerada pela implantação.',
            'Cole a URL no campo Apps Script URL do robô.',
          ].map((step, i) => (
            <div key={i} className="flex gap-2 items-start text-xs">
              <span className="shrink-0 w-5 h-5 rounded-full bg-sky-100 text-sky-700 flex items-center justify-center text-xs font-bold">
                {i + 1}
              </span>
              <span className="text-gray-700 pt-0.5">{step}</span>
            </div>
          ))}
        </div>
      </section>

      {/* 3 */}
      <section>
        <h5 className="font-semibold text-gray-700 mb-3 flex items-center gap-2">
          <span className="w-5 h-5 rounded-full bg-sky-600 text-white flex items-center justify-center text-xs">3</span>
          Código do endpoint Apps Script
        </h5>
        <div className="space-y-4">
          <div>
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs text-gray-500 font-medium">Código Endpoint (colar no Apps Script)</span>
              <button
                onClick={() => copy(ENDPOINT_CODE, setCopiedEp)}
                className="text-xs text-sky-600 hover:text-sky-800 px-2 py-0.5 rounded border border-sky-200 bg-white"
              >
                {copiedEp ? '✓ Copiado!' : 'Copiar'}
              </button>
            </div>
            <pre className="bg-gray-900 text-gray-100 rounded-xl px-4 py-3 text-xs overflow-x-auto font-mono leading-relaxed">
              {ENDPOINT_CODE}
            </pre>
          </div>
          <div>
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs text-gray-500 font-medium">Código Layout FAB (opcional — aplicar após importação)</span>
              <button
                onClick={() => copy(LAYOUT_CODE, setCopiedLay)}
                className="text-xs text-sky-600 hover:text-sky-800 px-2 py-0.5 rounded border border-sky-200 bg-white"
              >
                {copiedLay ? '✓ Copiado!' : 'Copiar'}
              </button>
            </div>
            <pre className="bg-gray-900 text-gray-100 rounded-xl px-4 py-3 text-xs overflow-x-auto font-mono leading-relaxed">
              {LAYOUT_CODE}
            </pre>
          </div>
        </div>
      </section>

      {/* 4 */}
      <section>
        <h5 className="font-semibold text-gray-700 mb-2 flex items-center gap-2">
          <span className="w-5 h-5 rounded-full bg-sky-600 text-white flex items-center justify-center text-xs">4</span>
          Uso do botão PNCP no robô
        </h5>
        <table className="w-full border border-gray-200 rounded-xl overflow-hidden">
          <tbody>
            <TRow label="Botão PNCP">
              Use o botão PNCP do robô para rodar todos os processos divulgados no PNCP conforme o ano informado no campo Anos PNCP.
            </TRow>
            <TRow label="Resultado esperado">
              Esse recurso criará uma aba na planilha com o nome: <strong>PNCP - 120630</strong>.
            </TRow>
            <TRow label="Campo Anos PNCP">
              Informe o ano desejado, por exemplo: <strong>2026</strong>.
            </TRow>
          </tbody>
        </table>
      </section>

      {/* 5 */}
      <div className="rounded-xl bg-green-50 border border-green-200 p-3">
        <h5 className="font-semibold text-green-800 mb-1 text-xs flex items-center gap-1">
          <span className="w-4 h-4 rounded-full bg-green-600 text-white flex items-center justify-center text-xs">5</span>
          Gravação automática no GAP-MN
        </h5>
        <p className="text-xs text-green-700 leading-relaxed">
          Ao rodar o robô com UASG <strong>120630</strong>, os dados são gravados automaticamente na base do GAP-MN.
          Após a conclusão, clique em <strong>↺ Atualizar</strong> para ver os novos registros na tabela abaixo.
        </p>
      </div>
    </div>
  );
}
