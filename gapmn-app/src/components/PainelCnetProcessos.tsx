import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";

type Processo = {
  id: number;
  identificacao: string;
  numero: string;
  ano: string;
  situacao: string;
  acao: string;
  possui_pendencia: boolean;
  agrupamento: string;
  sincronizado_em: string;
};

type Filtro = "todos" | "andamento" | "homologado" | "cancelado" | "pendente";

function classeSit(s: string): string {
  const l = (s || "").toLowerCase();
  if (/homolog/.test(l))   return "bg-emerald-100 border-emerald-300 text-emerald-800";
  if (/desert/.test(l))    return "bg-amber-100 border-amber-300 text-amber-800";
  if (/fracass/.test(l))   return "bg-orange-100 border-orange-300 text-orange-800";
  if (/cancel/.test(l))    return "bg-red-100 border-red-300 text-red-700";
  if (/revog|anulad/.test(l)) return "bg-purple-100 border-purple-300 text-purple-800";
  if (/julgamento|adjudic|abertura|aguardando|andamento|proposta|sess|analise|recurso|decidindo/.test(l))
    return "bg-sky-50 border-sky-200 text-sky-800";
  return "bg-amber-50 border-amber-200 text-amber-800";
}

function isAndamento(s: string) {
  return !/homolog|cancel|fracass|desert|revog|anulad|encerr/i.test(s);
}

export default function PainelCnetProcessos() {
  const [processos, setProcessos] = useState<Processo[]>([]);
  const [loading, setLoading]     = useState(true);
  const [filtro, setFiltro]       = useState<Filtro>("todos");
  const [busca, setBusca]         = useState("");
  const [anoFiltro, setAnoFiltro] = useState<string>("todos");

  useEffect(() => { load(); }, []);

  async function load() {
    setLoading(true);
    const { data } = await supabase
      .from("cnet_processos")
      .select("*")
      .order("sincronizado_em", { ascending: false });
    setProcessos((data as Processo[]) || []);
    setLoading(false);
  }

  const anos = [...new Set(processos.map(p => p.ano).filter(Boolean))].sort((a, b) => b.localeCompare(a));

  const filtrados = processos.filter(p => {
    if (filtro === "andamento"  && !isAndamento(p.situacao)) return false;
    if (filtro === "homologado" && !/homolog/i.test(p.situacao)) return false;
    if (filtro === "cancelado"  && !/cancel|fracass|desert|revog|anulad/i.test(p.situacao)) return false;
    if (filtro === "pendente"   && !p.possui_pendencia) return false;
    if (anoFiltro !== "todos"   && p.ano !== anoFiltro) return false;
    if (busca) {
      const b = busca.toLowerCase();
      if (!p.identificacao?.toLowerCase().includes(b) &&
          !p.situacao?.toLowerCase().includes(b) &&
          !p.acao?.toLowerCase().includes(b)) return false;
    }
    return true;
  });

  const ultimaSync = processos.length > 0
    ? new Date(processos[0].sincronizado_em).toLocaleString("pt-BR")
    : null;

  return (
    <div className="space-y-4">

      {/* Header */}
      <div className="rounded-2xl border border-slate-200 bg-white shadow-sm px-5 py-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-sm font-bold text-slate-800">Painel ComprasNet</div>
            <div className="text-xs text-slate-400 mt-0.5">
              Status real via Extensão GAPMN — UASG 120630
              {ultimaSync && <span className="ml-3">· Última sincronização: {ultimaSync}</span>}
            </div>
          </div>
          <button onClick={load}
            className="rounded-lg border border-sky-200 bg-sky-50 px-3 py-1.5 text-xs font-medium text-sky-700 hover:bg-sky-100 transition-colors">
            ↺ Atualizar
          </button>
        </div>
      </div>

      {/* Install banner */}
      {!loading && processos.length === 0 && (
        <div className="rounded-xl border border-indigo-200 bg-indigo-50 p-4 text-xs text-indigo-800 leading-relaxed">
          <div className="font-bold mb-1">⚠ Nenhum dado sincronizado</div>
          <div>
            Para carregar os processos:<br />
            1. Instale a extensão <b>GAPMN — Painel ComprasNet</b> no Chrome ou Firefox<br />
            2. Abra o ComprasNet e faça login<br />
            3. Clique em <b>Sincronizar</b> na extensão e depois em <b>Sincronizar com App</b>
          </div>
        </div>
      )}

      {/* Filtros */}
      {processos.length > 0 && (
        <div className="rounded-2xl border border-slate-200 bg-white shadow-sm p-4">
          <div className="flex flex-wrap items-center gap-2">
            {(["todos", "andamento", "homologado", "cancelado", "pendente"] as Filtro[]).map(f => (
              <button key={f} onClick={() => setFiltro(f)}
                className={`rounded-full border px-3 py-1 text-xs font-semibold transition-colors ${
                  filtro === f
                    ? "border-sky-400 bg-sky-50 text-sky-700"
                    : "border-slate-200 bg-white text-slate-500 hover:border-slate-300 hover:text-slate-700"
                }`}>
                {f === "todos"      ? "Todos"
                 : f === "andamento"  ? "Em Andamento"
                 : f === "homologado" ? "Homologado"
                 : f === "cancelado"  ? "Cancelado / Fracassado"
                 : "⚠ Com Pendência"}
              </button>
            ))}

            <select value={anoFiltro} onChange={e => setAnoFiltro(e.target.value)}
              className="rounded-xl border border-slate-200 px-3 py-1.5 text-xs text-slate-600 outline-none focus:ring-2 focus:ring-sky-200 bg-white">
              <option value="todos">Todos os anos</option>
              {anos.map(a => <option key={a} value={a}>{a}</option>)}
            </select>

            <input type="text" placeholder="Buscar…" value={busca} onChange={e => setBusca(e.target.value)}
              className="rounded-xl border border-slate-200 px-3 py-1.5 text-xs text-slate-700 outline-none focus:ring-2 focus:ring-sky-200 min-w-[160px]" />

            <span className="text-xs text-slate-400 ml-1">
              {filtrados.length} processo{filtrados.length !== 1 ? "s" : ""}
            </span>
          </div>
        </div>
      )}

      {/* Tabela */}
      {loading ? (
        <div className="text-sm text-slate-400 text-center py-10">Carregando…</div>
      ) : filtrados.length === 0 && processos.length > 0 ? (
        <div className="text-sm text-slate-400 text-center py-10">Nenhum processo corresponde ao filtro.</div>
      ) : filtrados.length > 0 && (
        <div className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-x-auto">
          <table className="w-full text-xs border-collapse">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200">
                {["Identificação", "Situação", "Grupo", "Ação Atual", "⚠"].map(h => (
                  <th key={h} className="px-3 py-2.5 text-left text-[10px] font-bold text-slate-500 uppercase tracking-wide">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtrados.map(p => (
                <tr key={p.id} className="border-b border-slate-100 hover:bg-slate-50 transition-colors">
                  <td className="px-3 py-2.5 font-semibold text-slate-800">{p.identificacao}</td>
                  <td className="px-3 py-2.5">
                    <span className={`rounded-full border px-2 py-0.5 text-[10px] font-medium ${classeSit(p.situacao)}`}>
                      {p.situacao}
                    </span>
                  </td>
                  <td className="px-3 py-2.5 text-slate-500">{p.agrupamento}</td>
                  <td className="px-3 py-2.5 text-slate-600 max-w-[260px] truncate">{p.acao}</td>
                  <td className="px-3 py-2.5 text-center">
                    {p.possui_pendencia && <span className="text-amber-500 font-bold">⚠</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
