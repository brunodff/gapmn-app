import { useEffect, useMemo, useState } from "react";
import { supabase } from "../../lib/supabase";
import { aditivosEmAndamento, apagarAditivo, contratosParaAditivo, iniciarAditivo, type ContratoParaAditivo } from "../../lib/aditivos/dados";
import type { RegistroAditivo } from "../../lib/aditivos/tipos";
import type { ContratoScon } from "../../lib/apostilamento/cadastro";
import { CONFIG_VAZIA, type ConfigApostilamento } from "../../lib/apostilamento/tipos";
import { configDaUnidade, unidadePadrao } from "../../lib/apostilamento/unidades";
import { carregarUnidades } from "../../lib/apostilamento/unidadesBanco";
import CompletarContratosGov from "../reajustes/CompletarContratosGov";
import AditivoContrato from "./AditivoContrato";

/** UG do GAP-MN no Contratos.gov.br (a mesma dos Reajustes) e quem usa as ferramentas em lote (as mesmas dos Reajustes) */
const UG_GAPMN = "120630";
const SETORES_LOTE = ["SCON", "ADMIN", "DEV"];

// Termos Aditivos (Contratos › Termos Aditivos): pedido da SCON (Ten Thiago, 24/11/2026). A tela monta os
// documentos do aditivo com o kit da SCON no navegador: Lista de Verificação, Declaração Orçamentária, Declaração de
// Vantajosidade, Mapa de Riscos, Pesquisa de Preços, Atestado de adequação, Ficha de Autorização (> R$ 1 milhão), SICAF,
// regularidade e Memória de Cálculo; os anexos ficam guardados no aditivo e o .zip sai numerado pela Lista (revisão 4).
type Linha = Pick<RegistroAditivo, "id" | "numero_contrato" | "numero_aditivo" | "situacao" | "atualizado_em" | "atualizado_nome">;
const botao = "rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50";
const sem = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

export default function TermosAditivos({ aditivoId, usuario, onAbrirAditivo, onAbrir }: {
  aditivoId: string | null; usuario: string | null; onAbrirAditivo: (id: string | null) => void; onAbrir: (link: string) => void;
}) {
  if (aditivoId) return <AditivoContrato key={aditivoId} id={aditivoId} usuario={usuario} onVoltar={() => onAbrirAditivo(null)} onAbrir={onAbrir} />;
  return <Lista usuario={usuario} onAbrirAditivo={onAbrirAditivo} />;
}

/** "Completar todos pelo Contratos.gov.br" (revisão 4 da SCON, seção 6.1): o mesmo componente e a mesma rotina dos
 *  Reajustes, na mesma base de contratos (o que uma aba completa aparece na outra). */
function CompletarTodos({ usuario, aoTerminar }: { usuario: string | null; aoTerminar: () => void }) {
  const [ctx, setCtx] = useState<{ contratos: (ContratoScon & { data_inicio: string | null })[]; config: ConfigApostilamento } | null>(null);
  useEffect(() => {
    let vivo = true;
    (async () => {
      const { data: s } = await supabase.auth.getSession();
      const uid = s.session?.user.id;
      if (!uid) return;
      const { data: p } = await supabase.from("profiles").select("setor").eq("id", uid).maybeSingle();
      if (!SETORES_LOTE.includes(String((p as { setor?: string | null } | null)?.setor ?? "").toUpperCase())) return;
      const [c, u] = await Promise.all([
        supabase.from("contratos_scon").select("id, numero_contrato, pag_nup, fornecedor, cnpj, descricao, data_orcamento, data_inicio, data_final, vl_contratual, status").order("numero_contrato"),
        carregarUnidades(),
      ]);
      const padrao = unidadePadrao(u.unidades);
      if (vivo && !c.error) setCtx({ contratos: (c.data ?? []) as (ContratoScon & { data_inicio: string | null })[], config: padrao ? configDaUnidade(padrao, padrao.sigla) : CONFIG_VAZIA });
    })().catch(() => undefined);
    return () => { vivo = false; };
  }, []);
  if (!ctx) return null;
  return <CompletarContratosGov contratos={ctx.contratos} config={ctx.config} nomeUsuario={usuario ?? ""} ug={UG_GAPMN} aoTerminar={aoTerminar} />;
}

function Lista({ usuario, onAbrirAditivo }: { usuario: string | null; onAbrirAditivo: (id: string) => void }) {
  const [aditivos, setAditivos] = useState<Linha[] | null>(null);
  const [contratos, setContratos] = useState<ContratoParaAditivo[]>([]);
  const [erro, setErro] = useState<string | null>(null);
  const [busca, setBusca] = useState("");
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [recarga, setRecarga] = useState(0);
  const [confirmar, setConfirmar] = useState<string | null>(null);

  useEffect(() => {
    let vivo = true;
    Promise.all([aditivosEmAndamento(), contratosParaAditivo()])
      .then(([a, c]) => { if (vivo) { setAditivos(a); setContratos(c); setErro(null); } })
      .catch((e) => { if (vivo) { setErro(e instanceof Error ? e.message : String(e)); setAditivos([]); } });
    return () => { vivo = false; };
  }, [recarga]);

  const nomeContrato = useMemo(() => new Map(contratos.map((c) => [c.numero_contrato, c])), [contratos]);
  const achados = useMemo(() => {
    const q = sem(busca.trim());
    if (q.length < 2) return [];
    return contratos.filter((c) => sem(`${c.contrato} ${c.numero_contrato} ${c.objeto} ${c.empresa} ${c.om}`).includes(q)).slice(0, 30);
  }, [busca, contratos]);

  async function iniciar(c: ContratoParaAditivo) {
    setOcupado(c.numero_contrato);
    try { onAbrirAditivo((await iniciarAditivo(c.numero_contrato, usuario)).id); }
    catch (e) { setErro(e instanceof Error ? e.message : String(e)); } finally { setOcupado(null); }
  }
  async function apagar(l: Linha) {
    setOcupado(l.id);
    try { await apagarAditivo(l.id); setRecarga((n) => n + 1); }
    catch (e) { setErro(e instanceof Error ? e.message : String(e)); } finally { setOcupado(null); }
  }

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-base font-bold text-slate-800">Termos Aditivos</h2>
        <p className="text-xs text-slate-500">Prorrogação, reajuste, acréscimo e supressão: o site preenche com o cadastro do contrato nos Reajustes e a carga do SILOMS, confere os pareceres referenciais da AGU e gera os documentos da Lista de Verificação com o kit da SCON. Os dados da OM que assina vêm de Reajustes › Configurações (unidades apoiadas).</p>
      </div>
      {erro && <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{erro}</div>}

      <CompletarTodos usuario={usuario} aoTerminar={() => setRecarga((n) => n + 1)} />

      <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <h3 className="mb-2 text-sm font-semibold text-slate-800">Iniciar um aditivo</h3>
        <input className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-sky-300" placeholder="Procure o contrato: número, objeto, empresa ou OM…" value={busca} onChange={(e) => setBusca(e.target.value)} />
        {busca.trim().length >= 2 && (
          <ul className="mt-2 divide-y divide-slate-100 text-xs">
            {achados.length === 0 && <li className="py-2 text-slate-500">Nenhum contrato com esse texto no cadastro dos Reajustes.</li>}
            {achados.map((c) => (
              <li key={c.numero_contrato} className="flex flex-wrap items-center gap-2 py-2">
                <div className="min-w-0 flex-1">
                  <b className="text-slate-800">{c.contrato}</b> <span className="text-slate-500">· {c.om || "—"} · vigência até {c.vigencia_fim ?? "?"}{c.aditivos ? ` · ${c.aditivos} aditivo(s) no site` : ""}</span>
                  <div className="truncate text-slate-600">{c.empresa}{c.objeto ? ` — ${c.objeto}` : ""}</div>
                </div>
                <button className={botao} disabled={!!ocupado} onClick={() => void iniciar(c)}>{ocupado === c.numero_contrato ? "Abrindo…" : "Iniciar aditivo"}</button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <h3 className="mb-2 text-sm font-semibold text-slate-800">Aditivos em andamento</h3>
        {aditivos === null && <p className="text-xs text-slate-500">Carregando…</p>}
        {aditivos?.length === 0 && !erro && <p className="text-xs text-slate-500">Nenhum aditivo iniciado. Procure o contrato acima.</p>}
        {!!aditivos?.length && (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[620px] text-left text-xs">
              <thead className="text-[10.5px] uppercase text-slate-500"><tr><th className="p-1.5">Aditivo</th><th className="p-1.5">Contrato</th><th className="p-1.5">Situação</th><th className="p-1.5">Última alteração</th><th className="p-1.5" /></tr></thead>
              <tbody>
                {aditivos.map((l) => {
                  const c = nomeContrato.get(l.numero_contrato);
                  return (
                    <tr key={l.id} className="border-t border-slate-100">
                      <td className="p-1.5 font-semibold text-slate-800">{l.numero_aditivo ?? "?"}º TA</td>
                      <td className="p-1.5"><div className="text-slate-800">{c?.contrato ?? l.numero_contrato}</div><div className="max-w-[340px] truncate text-slate-500">{c?.empresa}{c?.objeto ? ` — ${c.objeto}` : ""}</div></td>
                      <td className="p-1.5"><span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${l.situacao === "gerado" ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-800"}`}>{l.situacao === "gerado" ? "documentos gerados" : "rascunho"}</span></td>
                      <td className="p-1.5 text-slate-600">{new Date(l.atualizado_em).toLocaleString("pt-BR")}{l.atualizado_nome ? ` · ${l.atualizado_nome}` : ""}</td>
                      <td className="p-1.5 text-right whitespace-nowrap">
                        <button className={botao} onClick={() => onAbrirAditivo(l.id)}>Abrir</button>
                        <button className="ml-2 text-[11px] text-red-600 underline disabled:opacity-50" disabled={!!ocupado} onClick={() => (confirmar === l.id ? void apagar(l) : setConfirmar(l.id))} onBlur={() => setConfirmar(null)} title="Apaga este aditivo do site (os documentos já baixados não são afetados)">{ocupado === l.id ? "apagando…" : confirmar === l.id ? "clique de novo para apagar" : "apagar"}</button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
