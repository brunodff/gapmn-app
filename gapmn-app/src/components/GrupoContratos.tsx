/**
 * Grupo de contratos: crédito necessário para cobrir X meses de faturas de vários contratos de uma vez
 * (ex.: limpeza + vigilância + manutenção por 3 meses). Mesma regra do card: fatura mensal × meses −
 * saldo a liquidar das NEs de cada contrato (lib/previsaoContratos.ts, coberturaMeses).
 * Os grupos ficam guardados neste navegador.
 */
import { useMemo, useState } from "react";
import { createPortal } from "react-dom";
import * as XLSX from "xlsx";
import { coberturaMeses, type PrevisaoContrato } from "../lib/previsaoContratos";

export interface ContratoDoGrupo {
  id: string;
  numero: string;
  fornecedor: string | null;
  descricao: string | null;
  prev?: PrevisaoContrato;
  aLiquidar: number;
}

interface GrupoSalvo { id: string; nome: string; meses: number; alem: boolean; ids: string[]; salvo_em: string }

const CHAVE = "gapmn:grupos-contratos";
const BRL = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const fmt = (v: number) => BRL.format(v);
const semAcento = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase();

function lerGrupos(): GrupoSalvo[] {
  try { const g = JSON.parse(localStorage.getItem(CHAVE) ?? "[]"); return Array.isArray(g) ? g : []; } catch { return []; }
}
function gravarGrupos(g: GrupoSalvo[]): boolean {
  try { localStorage.setItem(CHAVE, JSON.stringify(g)); return true; } catch { return false; }
}

export default function GrupoContratos({ contratos, hoje, siafiOk, onFechar, onAbrirContrato }: {
  contratos: ContratoDoGrupo[];
  hoje: Date;
  /** planilha de execução carregada: sem ela o "a liquidar" é desconhecido */
  siafiOk: boolean;
  onFechar: () => void;
  onAbrirContrato?: (id: string) => void;
}) {
  const [grupos, setGrupos] = useState<GrupoSalvo[]>(lerGrupos);
  const [grupoId, setGrupoId] = useState<string | null>(null);
  const [nome, setNome] = useState("");
  const [meses, setMeses] = useState(3);
  const [alem, setAlem] = useState(false);
  const [ids, setIds] = useState<string[]>([]);
  const [busca, setBusca] = useState("");
  const [msg, setMsg] = useState<string | null>(null);

  // só entram contratos com fatura mensal (parcela fixa ou estimativo)
  const elegiveis = useMemo(
    () => contratos.filter((c) => coberturaMeses(c.prev, c.aLiquidar, hoje) !== null).sort((a, b) => a.numero.localeCompare(b.numero)),
    [contratos, hoje],
  );
  const lista = useMemo(() => {
    const t = semAcento(busca.trim());
    if (!t) return elegiveis;
    return elegiveis.filter((c) => t.split(/\s+/).every((p) => semAcento(`${c.numero} ${c.fornecedor ?? ""} ${c.descricao ?? ""}`).includes(p)));
  }, [elegiveis, busca]);

  const linhas = useMemo(() => {
    const porId = new Map(contratos.map((c) => [c.id, c]));
    return ids.map((id) => porId.get(id)).filter((c): c is ContratoDoGrupo => !!c)
      .map((c) => ({ c, cob: coberturaMeses(c.prev, c.aLiquidar, hoje, meses, alem) }));
  }, [ids, contratos, hoje, meses, alem]);
  const total = linhas.reduce((s, l) => ({
    necessario: s.necessario + (l.cob?.necessario ?? 0), aLiquidar: s.aLiquidar + (l.cob?.aLiquidar ?? 0), falta: s.falta + (l.cob?.falta ?? 0),
  }), { necessario: 0, aLiquidar: 0, falta: 0 });
  const faltando = ids.length - linhas.length; // contratos do grupo que não estão mais na lista

  const alterna = (id: string) => setIds((x) => (x.includes(id) ? x.filter((y) => y !== id) : [...x, id]));
  const novo = () => { setGrupoId(null); setNome(""); setMeses(3); setAlem(false); setIds([]); setMsg(null); };
  function abrir(g: GrupoSalvo) { setGrupoId(g.id); setNome(g.nome); setMeses(g.meses); setAlem(g.alem); setIds(g.ids); setMsg(null); }

  function salvar() {
    if (!nome.trim()) { setMsg("Dê um nome ao grupo."); return; }
    if (!ids.length) { setMsg("Escolha ao menos um contrato."); return; }
    const g: GrupoSalvo = { id: grupoId ?? `${Date.now()}`, nome: nome.trim(), meses, alem, ids, salvo_em: new Date().toISOString() };
    const prox = [...grupos.filter((x) => x.id !== g.id), g].sort((a, b) => a.nome.localeCompare(b.nome));
    setGrupoId(g.id);
    setGrupos(prox);
    setMsg(gravarGrupos(prox) ? "Grupo salvo neste navegador." : "Não deu para guardar neste navegador (modo privado?). O cálculo continua na tela.");
  }
  function excluir(g: GrupoSalvo) {
    if (!confirm(`Excluir o grupo "${g.nome}"? Os contratos não mudam.`)) return;
    const prox = grupos.filter((x) => x.id !== g.id);
    setGrupos(prox); gravarGrupos(prox);
    if (grupoId === g.id) novo();
  }

  const tabela = () => [
    ["Contrato", "Fornecedor", "Fatura mensal", "Meses", "Necessário", "A liquidar", "Falta"],
    ...linhas.map(({ c, cob }) => [c.numero, c.fornecedor ?? "", cob?.fatura ?? 0, cob?.meses ?? 0, cob?.necessario ?? 0, cob?.aLiquidar ?? 0, cob?.falta ?? 0]),
    ["Total", "", "", "", total.necessario, total.aLiquidar, total.falta],
  ];
  function exportar() {
    const ws = XLSX.utils.aoa_to_sheet([[`${nome || "Grupo de contratos"} — crédito para ${meses} ${meses === 1 ? "mês" : "meses"}`], [], ...tabela()]);
    ws["!cols"] = [{ wch: 30 }, { wch: 40 }, { wch: 14 }, { wch: 7 }, { wch: 14 }, { wch: 14 }, { wch: 14 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Grupo");
    XLSX.writeFile(wb, `Grupo - ${(nome || "contratos").replace(/[\\/:*?"<>|]/g, "-")}.xlsx`);
  }
  async function copiar() {
    const br = (v: unknown) => (typeof v === "number" ? v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : String(v));
    try {
      await navigator.clipboard.writeText(tabela().map((l) => l.map(br).join("\t")).join("\n"));
      setMsg("Tabela copiada: cole no Excel ou no documento.");
    } catch { setMsg("O navegador não deixou copiar; use Exportar Excel."); }
  }

  // no body (acima do menu lateral), com o tema escuro do app (svdark) só nas cores
  return createPortal(
    <div className="svdark fixed inset-0 z-[9999] flex items-center justify-center p-4" style={{ background: "rgba(0,0,0,0.6)", borderRadius: 0 }} onClick={onFechar}>
      <div className="modal-card flex max-h-[92vh] w-full max-w-6xl flex-col overflow-hidden rounded-2xl border border-slate-200 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between gap-3 border-b px-4 py-3">
          <div>
            <div className="text-sm font-semibold text-slate-800">Grupo de contratos</div>
            <div className="text-[11px] text-slate-500">Crédito para cobrir as próximas faturas: fatura mensal × meses − saldo a liquidar das NEs de cada contrato.</div>
          </div>
          <button onClick={onFechar} className="rounded-lg border px-2 py-1 text-xs text-slate-600 hover:bg-slate-50">✕ Fechar</button>
        </div>

        <div className="grid min-h-0 flex-1 gap-4 overflow-auto p-4 md:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
          {/* escolha dos contratos */}
          <div className="flex min-h-0 flex-col gap-2">
            {grupos.length > 0 && (
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-[11px] text-slate-500">Salvos:</span>
                {grupos.map((g) => (
                  <span key={g.id} className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] ${g.id === grupoId ? "border-sky-400 bg-sky-50 text-sky-700" : "border-slate-200 text-slate-600"}`}>
                    <button onClick={() => abrir(g)} className="hover:underline">{g.nome}</button>
                    <button onClick={() => excluir(g)} title="Excluir o grupo" className="text-slate-400 hover:text-red-600">×</button>
                  </span>
                ))}
                <button onClick={novo} className="rounded-full border border-dashed px-2 py-0.5 text-[11px] text-slate-500 hover:bg-slate-50">+ novo</button>
              </div>
            )}
            <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar por número, fornecedor ou objeto…"
              className="rounded-lg border px-3 py-1.5 text-xs outline-none focus:ring-2 focus:ring-sky-200" />
            <div className="text-[10px] text-slate-400">{lista.length} contrato{lista.length === 1 ? "" : "s"} com fatura mensal (parcela fixa ou estimativo) · {ids.length} no grupo</div>
            <div className="min-h-[200px] flex-1 overflow-auto rounded-lg border divide-y divide-slate-100">
              {lista.map((c) => (
                <label key={c.id} className="flex cursor-pointer items-start gap-2 px-2 py-1.5 text-xs hover:bg-slate-50">
                  <input type="checkbox" className="mt-0.5" checked={ids.includes(c.id)} onChange={() => alterna(c.id)} />
                  <span className="min-w-0 flex-1">
                    <span className="block font-semibold text-slate-700">{c.numero}</span>
                    <span className="block truncate text-[11px] text-slate-500">{c.fornecedor ?? c.descricao ?? "–"}</span>
                  </span>
                  <span className="shrink-0 text-[11px] text-slate-600">{fmt(c.prev?.mensal ?? 0)}/mês</span>
                </label>
              ))}
              {!lista.length && <div className="p-3 text-center text-xs text-slate-400">Nenhum contrato encontrado.</div>}
            </div>
          </div>

          {/* resultado */}
          <div className="flex min-h-0 flex-col gap-3">
            <div className="flex flex-wrap items-end gap-3">
              <label className="flex-1 min-w-[180px]">
                <span className="block text-[11px] text-slate-600">Nome do grupo</span>
                <input value={nome} onChange={(e) => setNome(e.target.value)} placeholder="ex.: Serviços contínuos – 1º trimestre"
                  className="mt-0.5 w-full rounded-lg border px-2 py-1.5 text-xs outline-none focus:ring-2 focus:ring-sky-200" />
              </label>
              <label>
                <span className="block text-[11px] text-slate-600">Meses a cobrir</span>
                <input type="number" min={1} max={36} value={meses} onChange={(e) => setMeses(Math.min(36, Math.max(1, Math.round(Number(e.target.value) || 1))))}
                  className="mt-0.5 w-20 rounded-lg border px-2 py-1.5 text-xs outline-none focus:ring-2 focus:ring-sky-200" />
              </label>
            </div>
            <label className="inline-flex items-center gap-2 text-[11px] text-slate-600">
              <input type="checkbox" checked={alem} onChange={(e) => setAlem(e.target.checked)} />
              contar também os meses depois do fim da vigência (supor prorrogação)
            </label>
            {!siafiOk && <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-1.5 text-[11px] text-amber-700">Planilha de execução do SIAFI ainda não carregou: o "a liquidar" aparece como zero.</div>}

            <div className="overflow-auto rounded-lg border">
              <table className="w-full text-xs">
                <thead className="bg-slate-50 text-[11px] text-slate-500">
                  <tr>
                    <th className="px-2 py-1.5 text-left">Contrato</th>
                    <th className="px-2 py-1.5 text-right">Fatura/mês</th>
                    <th className="px-2 py-1.5 text-right">Meses</th>
                    <th className="px-2 py-1.5 text-right">Necessário</th>
                    <th className="px-2 py-1.5 text-right">A liquidar</th>
                    <th className="px-2 py-1.5 text-right">Falta</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {linhas.map(({ c, cob }) => (
                    <tr key={c.id}>
                      <td className="px-2 py-1.5">
                        <button onClick={() => onAbrirContrato?.(c.id)} className="text-left font-semibold text-sky-700 hover:underline" title="Abrir o contrato">{c.numero}</button>
                        <div className="max-w-[220px] truncate text-[10px] text-slate-500">{c.fornecedor ?? ""}</div>
                      </td>
                      <td className="px-2 py-1.5 text-right">{fmt(cob?.fatura ?? 0)}</td>
                      <td className="px-2 py-1.5 text-right" title={cob && cob.meses < cob.pedidos ? "A vigência acaba antes" : undefined}>
                        {cob?.meses ?? 0}{cob && cob.meses < cob.pedidos && <span className="text-amber-600"> *</span>}
                      </td>
                      <td className="px-2 py-1.5 text-right">{fmt(cob?.necessario ?? 0)}</td>
                      <td className="px-2 py-1.5 text-right text-amber-700">{fmt(cob?.aLiquidar ?? 0)}</td>
                      <td className={`px-2 py-1.5 text-right font-semibold ${(cob?.falta ?? 0) > 0.5 ? "text-red-600" : "text-green-700"}`}>{fmt(cob?.falta ?? 0)}</td>
                    </tr>
                  ))}
                  {!linhas.length && <tr><td colSpan={6} className="p-4 text-center text-slate-400">Marque os contratos à esquerda.</td></tr>}
                </tbody>
                {linhas.length > 0 && (
                  <tfoot className="border-t bg-slate-50 font-semibold">
                    <tr>
                      <td className="px-2 py-1.5">Total ({linhas.length})</td>
                      <td colSpan={2} />
                      <td className="px-2 py-1.5 text-right">{fmt(total.necessario)}</td>
                      <td className="px-2 py-1.5 text-right text-amber-700">{fmt(total.aLiquidar)}</td>
                      <td className={`px-2 py-1.5 text-right ${total.falta > 0.5 ? "text-red-600" : "text-green-700"}`}>{fmt(total.falta)}</td>
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
            {linhas.some((l) => l.cob && l.cob.meses < l.cob.pedidos) && (
              <div className="text-[10px] text-amber-700">* a vigência acaba antes dos {meses} meses: só os meses até o fim dela (marque "supor prorrogação" para contar todos).</div>
            )}
            {faltando > 0 && <div className="text-[10px] text-slate-500">{faltando} contrato{faltando > 1 ? "s" : ""} do grupo não {faltando > 1 ? "estão" : "está"} mais na lista e ficou de fora.</div>}

            <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2">
              <div className="text-[11px] text-red-700">Crédito necessário para {meses} {meses === 1 ? "mês" : "meses"}</div>
              <div className="text-lg font-bold text-red-700">{fmt(total.falta)}</div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button onClick={salvar} className="rounded-lg bg-sky-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-sky-700">💾 Salvar grupo</button>
              <button onClick={exportar} disabled={!linhas.length} className="rounded-lg border px-3 py-1.5 text-xs text-slate-700 hover:bg-slate-50 disabled:opacity-50">Exportar Excel</button>
              <button onClick={() => void copiar()} disabled={!linhas.length} className="rounded-lg border px-3 py-1.5 text-xs text-slate-700 hover:bg-slate-50 disabled:opacity-50">Copiar tabela</button>
              {msg && <span className="text-[11px] text-slate-600">{msg}</span>}
            </div>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
