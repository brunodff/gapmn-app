import { useState, useEffect, useMemo, useCallback } from 'react';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import {
  Search, Download, RefreshCw, Settings,
  ChevronDown, ChevronRight, AlertCircle, Loader2, X,
} from 'lucide-react';

// ── Constants ──────────────────────────────────────────────────────────────────

const CSV_URL_KEY = 'gapmn_ob_csv_url';
const DEFAULT_CSV_URL =
  'https://docs.google.com/spreadsheets/d/e/2PACX-1vSYIxDW5oNp456_qcsDBiMV9rCrsXXmgPuGK2mqis2_k203qcCUGG1omx7jjZ_JRTZjIQgnj-SHmFaX/pub?gid=1989241909&single=true&output=csv';
const PDF_NCOLS = 18;
const COL_DATE  = 0;
const COL_OB    = 1;
const COL_OBS   = 2;

// ── Types ──────────────────────────────────────────────────────────────────────

interface OBRow {
  dateKey: string;
  dateBR:  string;
  obNum:   string;
  obs:     string;
  nf:      string | null;
  cols:    string[];
}

interface DayGroup {
  dateKey:   string;
  dateBR:    string;
  rows:      OBRow[];
  nfs:       string[];
  isPending: boolean;
}

// ── CSV / parsing helpers ──────────────────────────────────────────────────────

function parseCSV(text: string): string[][] {
  const rows: string[][] = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const cols: string[] = [];
    let cur = '', inQ = false;
    for (let j = 0; j < line.length; j++) {
      const c = line[j];
      if (c === '"') {
        if (inQ && line[j + 1] === '"') { cur += '"'; j++; }
        else inQ = !inQ;
      } else if (c === ',' && !inQ) { cols.push(cur.trim()); cur = ''; }
      else cur += c;
    }
    cols.push(cur.trim());
    rows.push(cols);
  }
  return rows;
}

function extractNF(obs: string): string | null {
  const t = String(obs || '').replace(/\s+/g, ' ');
  let m: RegExpMatchArray | null;
  m = t.match(/\bNF[eE]?\s*[-:]?\s*(\d+)/i); if (m) return m[1];
  m = t.match(/nota\s+fiscal\s*[nN°º#.]?\s*(\d+)/i); if (m) return m[1];
  return null;
}

function parseDateBR(val: string): Date | null {
  const m = String(val || '').trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  return m ? new Date(+m[3], +m[2] - 1, +m[1]) : null;
}

function toDateKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function toDateBR(d: Date): string {
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
}

function parseOBData(csvText: string): { headers: string[]; rows: OBRow[] } {
  const csvRows = parseCSV(csvText);
  let headerIdx = -1;
  for (let i = 0; i < Math.min(csvRows.length, 6); i++) {
    if (/emiss/i.test(csvRows[i][0] ?? '') && /doc/i.test(csvRows[i][1] ?? '')) {
      headerIdx = i; break;
    }
  }
  if (headerIdx < 0) return { headers: [], rows: [] };

  const headers  = csvRows[headerIdx].slice(0, PDF_NCOLS);
  let lastDate   = '';
  const rows: OBRow[] = [];

  for (const r of csvRows.slice(headerIdx + 1)) {
    const dateVal = (r[COL_DATE] ?? '').trim();
    const obVal   = (r[COL_OB]   ?? '').trim();
    if (dateVal) lastDate = dateVal;
    if (!obVal) continue;
    const eff = dateVal || lastDate;
    if (!eff) continue;
    const d = parseDateBR(eff);
    if (!d) continue;
    const cols = r.slice(0, PDF_NCOLS).map(c => c ?? '');
    if (!dateVal && lastDate) cols[COL_DATE] = lastDate;
    rows.push({
      dateKey: toDateKey(d),
      dateBR:  toDateBR(d),
      obNum:   obVal,
      obs:     (r[COL_OBS] ?? '').trim(),
      nf:      extractNF(r[COL_OBS] ?? ''),
      cols,
    });
  }
  return { headers, rows };
}

// ── PDF generation ─────────────────────────────────────────────────────────────

function generateDayPDF(group: DayGroup, headers: string[]): void {
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });

  doc.setFontSize(9);
  doc.setFont('helvetica', 'bold');
  doc.text('Ordens Bancarias - GAP-MN - ' + group.dateBR, 8, 11);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(6.5);
  doc.text('Gerado em: ' + new Date().toLocaleString('pt-BR'), 8, 16);
  doc.setDrawColor(31, 73, 125);
  doc.setLineWidth(0.4);
  doc.line(8, 18, 289, 18);

  autoTable(doc, {
    head:  [headers.map(h => String(h ?? ''))],
    body:  group.rows.map(r => r.cols.map(c => String(c ?? ''))),
    startY: 21,
    styles: {
      fontSize: 5.5, cellPadding: 1.2, overflow: 'linebreak',
      lineColor: [203, 213, 225] as [number,number,number], lineWidth: 0.1,
    },
    headStyles: {
      fillColor: [31, 73, 125] as [number,number,number],
      textColor: 255, fontStyle: 'bold', fontSize: 5.5, halign: 'center',
    },
    alternateRowStyles: { fillColor: [235, 242, 250] as [number,number,number] },
    columnStyles: { 0: { cellWidth: 14 }, 1: { cellWidth: 18 }, 2: { cellWidth: 44 }, 3: { cellWidth: 26 } },
    theme: 'grid',
    margin: { left: 6, right: 6, top: 21 },
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const pages = (doc as any).internal.getNumberOfPages() as number;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const pw = (doc as any).internal.pageSize.width  as number;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ph = (doc as any).internal.pageSize.height as number;

  for (let p = 1; p <= pages; p++) {
    doc.setPage(p);
    doc.setFontSize(5.5);
    doc.setTextColor(148, 163, 184);
    doc.text(`Total de OBs: ${group.rows.length}   |   Página ${p}/${pages}`, pw / 2, ph - 4, { align: 'center' });
  }

  doc.save(`OB_${group.dateKey}.pdf`);
}

// ── DayCard ────────────────────────────────────────────────────────────────────

interface DayCardProps {
  group:    DayGroup;
  headers:  string[];
  expanded: boolean;
  onToggle: () => void;
  onPDF:    () => void;
}

function DayCard({ group, headers, expanded, onToggle, onPDF }: DayCardProps) {
  return (
    <div className={`bg-white rounded-xl border shadow-sm overflow-hidden ${group.isPending ? 'border-amber-200' : 'border-slate-100'}`}>
      <div
        className="flex items-center gap-3 px-5 py-3.5 cursor-pointer select-none hover:bg-slate-50 transition-colors"
        onClick={onToggle}
      >
        <span className="text-slate-400 shrink-0">
          {expanded ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
        </span>

        <span className="font-semibold text-slate-800 text-sm shrink-0">{group.dateBR}</span>

        {group.isPending && (
          <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 text-amber-700 shrink-0">
            PENDENTE
          </span>
        )}

        <span className="text-xs text-slate-400 shrink-0">{group.rows.length} OBs</span>

        {group.nfs.length > 0 && (
          <span className="text-xs text-slate-400 truncate flex-1 min-w-0">
            NFs:{' '}
            <span className="text-blue-600 font-semibold">{group.nfs.join(', ')}</span>
          </span>
        )}

        <button
          onClick={e => { e.stopPropagation(); onPDF(); }}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-600 text-white text-xs font-semibold hover:bg-blue-700 transition-colors shrink-0 ml-auto"
        >
          <Download size={12} />
          PDF
        </button>
      </div>

      {expanded && (
        <div className="border-t border-slate-100 overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-slate-50 text-left">
                <th className="px-4 py-2 font-semibold text-slate-500 whitespace-nowrap">{headers[1] || 'Documento'}</th>
                <th className="px-4 py-2 font-semibold text-slate-500">NF</th>
                <th className="px-4 py-2 font-semibold text-slate-500 w-80">{headers[2] || 'Observação'}</th>
                <th className="px-4 py-2 font-semibold text-slate-500 whitespace-nowrap">{headers[3] || 'Favorecido'}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {group.rows.map((row, i) => (
                <tr key={i} className="hover:bg-blue-50/30">
                  <td className="px-4 py-2 font-mono text-slate-700 whitespace-nowrap">{row.obNum}</td>
                  <td className="px-4 py-2 whitespace-nowrap">
                    {row.nf
                      ? <span className="px-1.5 py-0.5 rounded bg-blue-50 text-blue-700 font-bold">{row.nf}</span>
                      : <span className="text-slate-300">—</span>}
                  </td>
                  <td className="px-4 py-2 text-slate-600 truncate max-w-xs" title={row.obs}>{row.obs}</td>
                  <td className="px-4 py-2 text-slate-600 whitespace-nowrap">{row.cols[3] || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ── Main page ──────────────────────────────────────────────────────────────────

export default function OrdensBancarias() {
  const [csvUrl, setCsvUrl]           = useState(() => localStorage.getItem(CSV_URL_KEY) || DEFAULT_CSV_URL);
  const [showSettings, setShowSettings] = useState(false);
  const [tempUrl, setTempUrl]         = useState(csvUrl);
  const [loading, setLoading]         = useState(false);
  const [error, setError]             = useState('');
  const [allRows, setAllRows]         = useState<OBRow[]>([]);
  const [headers, setHeaders]         = useState<string[]>([]);
  const [search, setSearch]           = useState('');
  const [showPendingOnly, setShowPendingOnly] = useState(false);
  const [expanded, setExpanded]       = useState<Set<string>>(new Set());

  // Day 25 of the current month
  const pendingThreshold = useMemo(() => {
    const n = new Date();
    return new Date(n.getFullYear(), n.getMonth(), 25);
  }, []);

  const loadData = useCallback(async (url = csvUrl) => {
    setLoading(true);
    setError('');
    try {
      const r = await fetch(url);
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const text = await r.text();
      const { headers: hdrs, rows } = parseOBData(text);
      setHeaders(hdrs);
      setAllRows(rows);
      if (!rows.length) setError('Nenhuma linha encontrada. Verifique a URL da planilha.');
    } catch (e: unknown) {
      setError((e as Error).message || 'Erro ao carregar planilha. Verifique a URL.');
    } finally {
      setLoading(false);
    }
  }, [csvUrl]);

  useEffect(() => { loadData(); }, []); // eslint-disable-line

  // Group by day, newest first
  const dayGroups = useMemo((): DayGroup[] => {
    const map = new Map<string, OBRow[]>();
    for (const row of allRows) {
      const list = map.get(row.dateKey) ?? [];
      list.push(row);
      map.set(row.dateKey, list);
    }
    return Array.from(map.entries())
      .sort(([a], [b]) => b.localeCompare(a))
      .map(([, rows]) => {
        const d = parseDateBR(rows[0].dateBR);
        return {
          dateKey:   rows[0].dateKey,
          dateBR:    rows[0].dateBR,
          rows,
          nfs:       [...new Set(rows.map(r => r.nf).filter((n): n is string => !!n))],
          isPending: !!d && d >= pendingThreshold,
        };
      });
  }, [allRows, pendingThreshold]);

  const filteredGroups = useMemo(() => {
    const q = search.toLowerCase().trim();
    let groups = dayGroups;
    if (showPendingOnly) groups = groups.filter(g => g.isPending);
    if (!q) return groups;
    return groups
      .map(g => ({
        ...g,
        rows: g.rows.filter(r =>
          r.obNum.toLowerCase().includes(q) ||
          (r.nf ?? '').toLowerCase().includes(q) ||
          r.obs.toLowerCase().includes(q)
        ),
      }))
      .filter(g => g.rows.length > 0);
  }, [dayGroups, search, showPendingOnly]);

  const stats = useMemo(() => ({
    total:     allRows.length,
    dias:      dayGroups.length,
    pendentes: dayGroups.filter(g => g.isPending).length,
  }), [allRows, dayGroups]);

  function toggleExpand(dk: string) {
    setExpanded(prev => {
      const next = new Set(prev);
      next.has(dk) ? next.delete(dk) : next.add(dk);
      return next;
    });
  }

  function saveSettings() {
    setCsvUrl(tempUrl);
    localStorage.setItem(CSV_URL_KEY, tempUrl);
    setShowSettings(false);
    loadData(tempUrl);
  }

  return (
    <div className="space-y-5">

      {/* ── Header ── */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">Ordens Bancárias</h1>
          <p className="text-sm text-slate-500 mt-0.5">Controle de anexação no SILOMS · Pendente = dia 25 em diante</p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => loadData()}
            disabled={loading}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-blue-600 text-white text-sm font-semibold hover:bg-blue-700 disabled:opacity-50 transition-colors"
          >
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
            Atualizar
          </button>
          <button
            onClick={() => { setTempUrl(csvUrl); setShowSettings(true); }}
            title="Configurar URL da planilha"
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-200 bg-white text-slate-500 hover:bg-slate-50 transition-colors"
          >
            <Settings size={15} />
          </button>
        </div>
      </div>

      {/* ── Settings modal ── */}
      {showSettings && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="bg-white rounded-2xl shadow-2xl p-6 w-full max-w-lg">
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-bold text-slate-800">Configurar Planilha</h2>
              <button onClick={() => setShowSettings(false)} className="text-slate-400 hover:text-slate-600">
                <X size={18} />
              </button>
            </div>
            <label className="block text-xs text-slate-500 mb-1.5">
              URL do CSV (Google Sheets → Arquivo → Publicar na web → CSV):
            </label>
            <input
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
              value={tempUrl}
              onChange={e => setTempUrl(e.target.value)}
            />
            <div className="flex justify-end gap-2 mt-5">
              <button onClick={() => setShowSettings(false)} className="px-4 py-2 text-sm text-slate-500 hover:text-slate-700">
                Cancelar
              </button>
              <button
                onClick={saveSettings}
                className="px-4 py-2 rounded-lg bg-blue-600 text-white text-sm font-semibold hover:bg-blue-700"
              >
                Salvar e Atualizar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Error ── */}
      {error && (
        <div className="flex items-center gap-2 p-4 rounded-xl bg-red-50 border border-red-200 text-red-700 text-sm">
          <AlertCircle size={16} className="shrink-0" />
          {error}
        </div>
      )}

      {/* ── Loading ── */}
      {loading && (
        <div className="flex items-center justify-center py-24 text-slate-400">
          <Loader2 size={30} className="animate-spin mr-3" />
          <span className="text-sm">Carregando planilha...</span>
        </div>
      )}

      {/* ── Stats ── */}
      {!loading && allRows.length > 0 && (
        <div className="grid grid-cols-3 gap-4">
          {[
            { label: 'Total de OBs',   value: allRows.length.toLocaleString('pt-BR'), color: 'text-slate-800' },
            { label: 'Dias com OBs',   value: stats.dias.toString(),                  color: 'text-slate-800' },
            { label: 'Dias Pendentes', value: stats.pendentes.toString(),              color: stats.pendentes > 0 ? 'text-amber-600' : 'text-slate-800' },
          ].map(s => (
            <div key={s.label} className="bg-white rounded-xl border border-slate-100 shadow-sm p-4">
              <p className="text-xs text-slate-500">{s.label}</p>
              <p className={`text-2xl font-bold mt-1 ${s.color}`}>{s.value}</p>
            </div>
          ))}
        </div>
      )}

      {/* ── Controls + list ── */}
      {!loading && allRows.length > 0 && (
        <>
          <div className="flex gap-3 flex-wrap items-center">
            {/* Search */}
            <div className="relative flex-1 min-w-56">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                className="w-full pl-9 pr-8 py-2 border border-slate-200 rounded-lg text-sm text-slate-700 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="Buscar por NF, número da OB, descrição..."
                value={search}
                onChange={e => setSearch(e.target.value)}
              />
              {search && (
                <button onClick={() => setSearch('')} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
                  <X size={13} />
                </button>
              )}
            </div>

            {/* Pending toggle */}
            <label className="flex items-center gap-2 px-4 py-2 rounded-lg border border-slate-200 bg-white text-sm text-slate-700 cursor-pointer select-none hover:bg-slate-50">
              <input
                type="checkbox"
                checked={showPendingOnly}
                onChange={e => setShowPendingOnly(e.target.checked)}
                className="accent-amber-500 w-3.5 h-3.5"
              />
              Apenas pendentes (≥ dia 25)
            </label>

            {/* Result count when filtered */}
            {(search || showPendingOnly) && (
              <span className="text-xs text-slate-400">
                {filteredGroups.reduce((s, g) => s + g.rows.length, 0).toLocaleString('pt-BR')} OBs em {filteredGroups.length} dias
              </span>
            )}
          </div>

          {/* Day groups */}
          <div className="space-y-2">
            {filteredGroups.length === 0
              ? <div className="text-center py-16 text-slate-400 text-sm">Nenhum resultado encontrado</div>
              : filteredGroups.map(group => (
                  <DayCard
                    key={group.dateKey}
                    group={group}
                    headers={headers}
                    expanded={expanded.has(group.dateKey)}
                    onToggle={() => toggleExpand(group.dateKey)}
                    onPDF={() => generateDayPDF(group, headers)}
                  />
                ))
            }
          </div>
        </>
      )}
    </div>
  );
}
