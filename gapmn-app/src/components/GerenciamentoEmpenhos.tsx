import { useState, useEffect, useMemo } from "react";
import { Card } from "./Card";
import {
  fetchCSV,
  toEmpenhosNF,
  toControleEmpenhos,
  normalizeNE,
  SHEET_URLS,
  EmpenhoNF,
  ControleEmpenho,
} from "../lib/gsheets";

// ─── Tipos ────────────────────────────────────────────────────────────────────

type EmpenhoRow = EmpenhoNF & Partial<ControleEmpenho>;

interface Props {
  canSync?: boolean;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function fmtData(d: string): string {
  if (!d) return "–";
  // YYYY-MM-DD → DD/MM/YYYY
  const m = d.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[3]}/${m[2]}/${m[1]}`;
  return d;
}

function Badge({ val }: { val?: string }) {
  if (!val || val === "–") return <span className="text-slate-400">–</span>;
  const sim = val === "Sim";
  return (
    <span className={`inline-block rounded-full px-2 py-0.5 text-[11px] font-semibold ${
      sim
        ? "bg-emerald-100 text-emerald-700"
        : "bg-slate-100 text-slate-500"
    }`}>
      {val}
    </span>
  );
}

// ─── Componente ──────────────────────────────────────────────────────────────

export default function GerenciamentoEmpenhos({ canSync = false }: Props) {
  const [empenhos,  setEmpenhos]  = useState<EmpenhoNF[]>([]);
  const [controle,  setControle]  = useState<ControleEmpenho[]>([]);
  const [loading,   setLoading]   = useState(false);
  const [error,     setError]     = useState<string | null>(null);
  const [expanded,  setExpanded]  = useState<string | null>(null);

  const [filtroUgr,     setFiltroUgr]     = useState("todos");
  const [filtroNatureza, setFiltroNatureza] = useState("todos");
  const [filtroPI,      setFiltroPI]      = useState("todos");

  // ── Fetch ────────────────────────────────────────────────────────────────
  async function sync() {
    setLoading(true);
    setError(null);
    const [r1, r2] = await Promise.allSettled([
      fetchCSV(SHEET_URLS.empenhosNF),
      fetchCSV(SHEET_URLS.empenhos),
    ]);

    if (r1.status === "fulfilled") {
      const parsed = toEmpenhosNF(r1.value);
      setEmpenhos(parsed);
      if (parsed.length === 0) {
        setError("Planilha de empenhos não encontrada ou sem dados. Verifique se ela está pública.");
      }
    } else {
      setError("Erro ao carregar planilha de empenhos. Verifique se ela está com acesso público de leitura.");
    }

    if (r2.status === "fulfilled") {
      setControle(toControleEmpenhos(r2.value));
    }

    setLoading(false);
  }

  useEffect(() => { sync(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Derivados ─────────────────────────────────────────────────────────────
  const joined = useMemo<EmpenhoRow[]>(() => {
    return empenhos.map((e) => {
      const keyE = normalizeNE(e.nota_empenho);
      const extra = controle.find((c) => normalizeNE(c.siafi) === keyE);
      return extra ? { ...e, ...extra } : e;
    });
  }, [empenhos, controle]);

  const ugrs      = useMemo(() => [...new Set(empenhos.map((e) => e.ugr).filter(Boolean))].sort(),      [empenhos]);
  const naturezas = useMemo(() => [...new Set(empenhos.map((e) => e.natureza).filter(Boolean))].sort(), [empenhos]);
  const pis       = useMemo(() => [...new Set(empenhos.map((e) => e.pi).filter(Boolean))].sort(),       [empenhos]);

  const filtered = useMemo(() => {
    return joined.filter((r) =>
      (filtroUgr      === "todos" || r.ugr      === filtroUgr) &&
      (filtroNatureza === "todos" || r.natureza === filtroNatureza) &&
      (filtroPI       === "todos" || r.pi       === filtroPI)
    );
  }, [joined, filtroUgr, filtroNatureza, filtroPI]);

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-4">
      <Card>
        {/* Cabeçalho + filtros */}
        <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
          <div>
            <div className="text-sm font-semibold text-slate-900">
              Empenhos
              {empenhos.length > 0 && (
                <span className="ml-2 text-xs font-normal text-slate-500">
                  {filtered.length} / {empenhos.length} registro{empenhos.length !== 1 ? "s" : ""}
                </span>
              )}
            </div>
            <div className="text-xs text-slate-500 mt-0.5">
              Notas de empenho · sincronizadas da planilha
            </div>
          </div>

          {canSync && (
            <button
              onClick={sync}
              disabled={loading}
              className="rounded-xl border border-sky-200 bg-sky-50 px-3 py-1.5 text-sm font-medium text-sky-700 hover:bg-sky-100 disabled:opacity-60 flex items-center gap-1.5"
            >
              <span className={loading ? "animate-spin inline-block" : ""}>↻</span>
              {loading ? "Atualizando..." : "Atualizar"}
            </button>
          )}
        </div>

        {/* Filtros */}
        {(ugrs.length > 0 || naturezas.length > 0 || pis.length > 0) && (
          <div className="flex flex-wrap gap-2 mb-4">
            {ugrs.length > 0 && (
              <select
                value={filtroUgr}
                onChange={(e) => setFiltroUgr(e.target.value)}
                className="rounded-xl border px-3 py-1.5 text-xs outline-none focus:ring-2 focus:ring-sky-200"
              >
                <option value="todos">Todos os UGR</option>
                {ugrs.map((u) => <option key={u} value={u}>{u}</option>)}
              </select>
            )}
            {naturezas.length > 0 && (
              <select
                value={filtroNatureza}
                onChange={(e) => setFiltroNatureza(e.target.value)}
                className="rounded-xl border px-3 py-1.5 text-xs outline-none focus:ring-2 focus:ring-sky-200"
              >
                <option value="todos">Todas as Naturezas</option>
                {naturezas.map((n) => <option key={n} value={n}>{n}</option>)}
              </select>
            )}
            {pis.length > 0 && (
              <select
                value={filtroPI}
                onChange={(e) => setFiltroPI(e.target.value)}
                className="rounded-xl border px-3 py-1.5 text-xs outline-none focus:ring-2 focus:ring-sky-200"
              >
                <option value="todos">Todos os PI</option>
                {pis.map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
            )}
          </div>
        )}

        {/* Erro */}
        {error && (
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 mb-4">
            {error}
          </div>
        )}

        {/* Loading inicial */}
        {loading && empenhos.length === 0 && (
          <div className="py-12 text-center text-sm text-slate-400">Carregando empenhos...</div>
        )}

        {/* Tabela */}
        {!loading && empenhos.length === 0 && !error && (
          <div className="py-12 text-center text-sm text-slate-400">
            Nenhum empenho encontrado.
            {canSync && " Clique em Atualizar para sincronizar."}
          </div>
        )}

        {empenhos.length > 0 && (
          <div className="overflow-x-auto rounded-xl border border-slate-200">
            <table className="min-w-[720px] w-full text-xs border-collapse">
              <thead className="bg-slate-50 border-b text-left">
                <tr>
                  <th className="px-3 py-2 font-semibold text-slate-600 whitespace-nowrap">Data</th>
                  <th className="px-3 py-2 font-semibold text-slate-600 whitespace-nowrap">Nota de Empenho</th>
                  <th className="px-3 py-2 font-semibold text-slate-600 whitespace-nowrap">UGR</th>
                  <th className="px-3 py-2 font-semibold text-slate-600 whitespace-nowrap hidden sm:table-cell">Natureza</th>
                  <th className="px-3 py-2 font-semibold text-slate-600 whitespace-nowrap hidden sm:table-cell">PI</th>
                  <th className="px-3 py-2 font-semibold text-slate-600 whitespace-nowrap hidden sm:table-cell">Subprocesso</th>
                  <th className="px-3 py-2 font-semibold text-slate-600 whitespace-nowrap hidden sm:table-cell">Renomeado</th>
                  <th className="px-3 py-2 font-semibold text-slate-600 whitespace-nowrap hidden sm:table-cell">Incluído</th>
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="px-4 py-8 text-center text-slate-400">
                      Nenhum empenho corresponde aos filtros selecionados.
                    </td>
                  </tr>
                ) : (
                  filtered.map((row, idx) => {
                    const key = `${row.nota_empenho}-${idx}`;
                    const isExp = expanded === key;
                    return (
                      <>
                        <tr
                          key={key}
                          className={`border-b last:border-0 cursor-pointer transition-colors ${
                            isExp ? "bg-sky-50" : "hover:bg-sky-50/40"
                          }`}
                          onClick={() => setExpanded(isExp ? null : key)}
                        >
                          <td className="px-3 py-2 whitespace-nowrap text-slate-600">
                            {fmtData(row.data)}
                          </td>
                          <td className="px-3 py-2 whitespace-nowrap">
                            <span className="mr-1 text-slate-400 text-[10px]">{isExp ? "▼" : "▶"}</span>
                            <span className="font-mono font-semibold text-sky-700">{row.nota_empenho}</span>
                          </td>
                          <td className="px-3 py-2 text-slate-600">{row.ugr || "–"}</td>
                          <td className="px-3 py-2 text-slate-500 hidden sm:table-cell">{row.natureza || "–"}</td>
                          <td className="px-3 py-2 text-slate-500 font-mono hidden sm:table-cell">{row.pi || "–"}</td>
                          <td className="px-3 py-2 text-slate-500 hidden sm:table-cell">{row.subprocesso || "–"}</td>
                          <td className="px-3 py-2 hidden sm:table-cell"><Badge val={row.renomeado} /></td>
                          <td className="px-3 py-2 hidden sm:table-cell"><Badge val={row.incluido} /></td>
                        </tr>

                        {isExp && (
                          <tr key={`${key}-exp`} className="border-b last:border-0 border-l-2 border-sky-300 bg-sky-50/60">
                            <td colSpan={8} className="px-4 py-3">
                              {/* Descrição */}
                              {row.descricao && (
                                <div className="mb-3 text-sm text-slate-800 whitespace-normal break-words leading-relaxed">
                                  <span className="text-xs font-semibold text-slate-500 mr-2">Descrição:</span>
                                  {row.descricao}
                                </div>
                              )}

                              {/* Campos ocultos no mobile */}
                              <div className="flex flex-wrap gap-x-5 gap-y-1.5 text-xs text-slate-500 sm:hidden mb-2">
                                <span><span className="font-medium text-slate-600">Natureza:</span> {row.natureza || "–"}</span>
                                <span><span className="font-medium text-slate-600">PI:</span> {row.pi || "–"}</span>
                                <span><span className="font-medium text-slate-600">Subprocesso:</span> {row.subprocesso || "–"}</span>
                                <span><span className="font-medium text-slate-600">Renomeado:</span> <Badge val={row.renomeado} /></span>
                                <span><span className="font-medium text-slate-600">Incluído:</span> <Badge val={row.incluido} /></span>
                              </div>

                              {/* Dados do controle (Sheet 2) */}
                              {(row.solicitacao || row.siloms) && (
                                <div className="flex flex-wrap gap-x-5 gap-y-1 text-xs text-slate-500 border-t border-sky-100 pt-2 mt-1">
                                  {row.solicitacao && (
                                    <span><span className="font-medium text-slate-600">Solicitação:</span> {row.solicitacao}</span>
                                  )}
                                  {row.siloms && (
                                    <span><span className="font-medium text-slate-600">SILOMS:</span> {row.siloms}</span>
                                  )}
                                </div>
                              )}
                            </td>
                          </tr>
                        )}
                      </>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
