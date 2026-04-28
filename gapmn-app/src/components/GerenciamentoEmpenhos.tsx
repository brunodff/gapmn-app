import { useState, useEffect, useMemo, useRef } from "react";
import * as XLSX from "xlsx";
import { supabase } from "../lib/supabase";
import { Card } from "./Card";
import { fetchCSV, toEmpenhosNF, SHEET_URLS, EmpenhoNF } from "../lib/gsheets";

// ─── Tipos ────────────────────────────────────────────────────────────────────

interface NeIdent {
  ne_siafi:      string;
  identificador: string;
  solicitacao:   string | null;
}

interface Props { canSync?: boolean; userRole?: string; }

// ─── Parser planilha de controle ─────────────────────────────────────────────
// Col A (índice 0) = Identificador (26E...)
// Col C (índice 2) = NE SIAFI (2026NE...)  ← chave de ligação com a planilha
// Col P (índice 15) = SE / Solicitação

function parsePlanilhaControle(wb: XLSX.WorkBook): NeIdent[] {
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json<string[]>(ws, { header: 1, raw: false });
  const out: NeIdent[] = [];
  for (const row of rows) {
    const identificador = String(row[0]  ?? "").trim();
    const ne_siafi      = String(row[2]  ?? "").trim();
    const solicitacao   = String(row[15] ?? "").trim() || null;
    if (!ne_siafi.match(/\d{4}NE\d+/i)) continue;
    out.push({ ne_siafi, identificador, solicitacao });
  }
  return out;
}

// ─── Componente ──────────────────────────────────────────────────────────────

export default function GerenciamentoEmpenhos({ canSync = false, userRole }: Props) {
  const canEdit = ["SEO", "DEV", "ADMIN"].includes((userRole ?? "").toUpperCase());

  const [empenhos,  setEmpenhos]  = useState<EmpenhoNF[]>([]);
  const [neIdents,  setNeIdents]  = useState<NeIdent[]>([]);
  const [loading,   setLoading]   = useState(false);
  const [importMsg, setImportMsg] = useState<string | null>(null);
  const [importando, setImportando] = useState(false);
  const [busca, setBusca] = useState("");

  const planilhaControlRef = useRef<HTMLInputElement>(null);

  // ── Fetch ─────────────────────────────────────────────────────────────────
  async function carregarPlanilha() {
    setLoading(true);
    try {
      const csv = await fetchCSV(SHEET_URLS.empenhosNF);
      setEmpenhos(toEmpenhosNF(csv));
    } catch { /* offline */ }
    setLoading(false);
  }

  async function carregarNeIdentificadores() {
    const { data } = await supabase
      .from("siloms_ne_identificadores")
      .select("*")
      .limit(2000);
    if (data) setNeIdents(data as NeIdent[]);
  }

  useEffect(() => {
    carregarPlanilha();
    carregarNeIdentificadores();
  }, []); // eslint-disable-line

  // ── Importar planilha de controle ─────────────────────────────────────────
  async function onPlanilhaControleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setImportando(true);
    setImportMsg("⏳ Lendo planilha de controle...");
    try {
      const buf = await file.arrayBuffer();
      const wb  = XLSX.read(buf);
      const registros = parsePlanilhaControle(wb);
      if (!registros.length) { setImportMsg("⚠️ Nenhuma NE encontrada na planilha."); return; }

      await supabase.from("siloms_ne_identificadores").delete().gte("ne_siafi", "");
      for (let i = 0; i < registros.length; i += 100)
        await supabase.from("siloms_ne_identificadores").insert(registros.slice(i, i + 100));

      setImportMsg(`✅ ${registros.length} NEs importadas`);
      await carregarNeIdentificadores();
    } catch (err: unknown) {
      setImportMsg(`❌ ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setImportando(false);
      if (planilhaControlRef.current) planilhaControlRef.current.value = "";
    }
  }

  // ── Join: NE SIAFI (planilha) + Identificador/SE (siloms_ne_identificadores) ──
  const rows = useMemo(() => {
    const neIdentsMap = new Map(neIdents.map(r => [r.ne_siafi.toUpperCase(), r]));
    return empenhos.map(ne => {
      const ident = neIdentsMap.get(ne.nota_empenho.toUpperCase());
      return {
        nota_empenho:  ne.nota_empenho,
        identificador: ident?.identificador ?? "",
        solicitacao:   ident?.solicitacao   ?? "",
      };
    });
  }, [empenhos, neIdents]);

  const filtrado = useMemo(() => {
    const q = busca.trim().toUpperCase();
    if (!q) return rows;
    return rows.filter(r =>
      r.nota_empenho.toUpperCase().includes(q) ||
      r.identificador.toUpperCase().includes(q) ||
      (r.solicitacao ?? "").toUpperCase().includes(q)
    );
  }, [rows, busca]);

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-3">
      <Card>
        <div className="flex flex-wrap items-center gap-2 mb-2">
          <div className="flex-1">
            <div className="text-sm font-semibold text-slate-900">
              NEs SIAFI
              {rows.length > 0 && (
                <span className="ml-2 text-xs font-normal text-slate-500">
                  {filtrado.length} / {rows.length}
                </span>
              )}
            </div>
            <div className="text-xs text-slate-500">
              Planilha Google Sheets · Identificador e SE via planilha de controle
              {loading && <span className="ml-2 text-slate-400">↻ carregando...</span>}
            </div>
          </div>

          {canEdit && (
            <>
              <button
                onClick={() => planilhaControlRef.current?.click()}
                disabled={importando}
                className="rounded-xl border border-indigo-300 bg-indigo-50 px-3 py-1.5 text-xs text-indigo-700 hover:bg-indigo-100 disabled:opacity-50"
              >
                {importando ? "Importando..." : "📥 Planilha Controle"}
              </button>
              <input
                ref={planilhaControlRef}
                type="file"
                accept=".xls,.xlsx"
                className="hidden"
                onChange={onPlanilhaControleChange}
              />
            </>
          )}

          {canSync && (
            <button
              onClick={() => { carregarPlanilha(); carregarNeIdentificadores(); }}
              disabled={loading}
              className="rounded-xl border border-sky-200 bg-sky-50 px-3 py-1.5 text-xs font-medium text-sky-700 hover:bg-sky-100 disabled:opacity-60"
            >
              <span className={loading ? "animate-spin inline-block" : ""}>↻</span> Atualizar
            </button>
          )}

          <input
            value={busca}
            onChange={e => setBusca(e.target.value)}
            placeholder="Buscar..."
            className="rounded-xl border px-3 py-1.5 text-xs outline-none focus:ring-2 focus:ring-sky-200 w-36"
          />
        </div>

        {importMsg && (
          <div className={`text-xs px-3 py-2 rounded-lg ${
            importMsg.startsWith("✅") ? "bg-green-50 text-green-700" :
            importMsg.startsWith("❌") ? "bg-red-50 text-red-700" :
            "bg-blue-50 text-blue-600"
          }`}>
            {importMsg}
          </div>
        )}
      </Card>

      <div className="rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="max-h-[72vh] overflow-y-auto overflow-x-auto rounded-2xl">
          <table className="w-full text-xs border-collapse table-fixed" style={{ minWidth: "400px" }}>
            <colgroup>
              <col style={{ width: "150px" }} />
              <col style={{ width: "130px" }} />
              <col style={{ width: "130px" }} />
            </colgroup>
            <thead className="bg-slate-50 text-left sticky top-0 z-20">
              <tr className="border-b border-slate-200">
                <th className="px-3 py-2 font-semibold text-slate-600 whitespace-nowrap">NE SIAFI</th>
                <th className="px-3 py-2 font-semibold text-slate-600 whitespace-nowrap">Identificador</th>
                <th className="px-3 py-2 font-semibold text-slate-600 whitespace-nowrap">SE</th>
              </tr>
            </thead>
            <tbody>
              {filtrado.length === 0 ? (
                <tr>
                  <td colSpan={3} className="px-4 py-10 text-center text-slate-400">
                    {rows.length === 0
                      ? "Carregando NEs da planilha..."
                      : "Sem resultados para a busca aplicada."}
                  </td>
                </tr>
              ) : filtrado.map((row, i) => (
                <tr key={`${row.nota_empenho}||${i}`} className="border-b last:border-0 hover:bg-slate-50/60">
                  <td className="px-3 py-1.5 font-mono font-semibold text-sky-700 text-[11px] whitespace-nowrap">
                    {row.nota_empenho}
                  </td>
                  <td className="px-3 py-1.5 font-mono text-indigo-600 text-[11px] whitespace-nowrap">
                    {row.identificador || <span className="text-slate-300">–</span>}
                  </td>
                  <td className="px-3 py-1.5 font-mono text-slate-600 text-[11px] whitespace-nowrap">
                    {row.solicitacao || <span className="text-slate-300">–</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
