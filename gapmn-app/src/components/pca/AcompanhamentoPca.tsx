import { useCallback, useEffect, useMemo, useState } from "react";
import { EXCECOES, MODALIDADES, TODOS_STATUS, type Contratacao } from "../../lib/pca/tipos";
import { calcularKpis, dias, situacaoPrazo, type SituacaoPrazo } from "../../lib/pca/regras";
import { acaoPca, carregarPca, type DadosPca } from "../../lib/pca/cliente";
import { Kpi, ListaAlertas, PontoPrazo, SeloPublicacao, SeloStatus, botao, botaoPrimario, entrada } from "./ui";
import { brl, dataBR, horaBR, norm } from "./formato";
import DetalheContratacao from "./DetalheContratacao";
import ImportarDnr from "./ImportarDnr";
import AdminPca from "./AdminPca";
import { FilaEmails, FilaIrregularidades } from "./Filas";

// Acompanhamento automatizado dos processos licitatórios do PCA (pedido da SLIC, Ten Gabriela, nov/2026).
// O PCA vem do PGC (Dados Abertos + PNCP) todo dia; DNR, CJU, publicação, DOU, homologação e impugnações
// chegam pelos PDFs/planilha do SILOMS, pela caixa de e-mail da SLIC e pelas bases públicas. Regras em src/lib/pca.

const hojeISO = () => new Date(Date.now() - 4 * 3600e3).toISOString().slice(0, 10);
type FiltroKpi = "" | "prazo" | "risco" | "cju" | "douebc";
type Aba = "processos" | "irregularidades" | "emails" | "admin";

export default function AcompanhamentoPca({ canEdit, buscaInicial }: { canEdit: boolean; buscaInicial?: string }) {
  const [dados, setDados] = useState<DadosPca | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [versao, setVersao] = useState(0);
  const [aba, setAba] = useState<Aba>("processos");
  const [busca, setBusca] = useState(buscaInicial ?? "");
  const [fOm, setFOm] = useState("");
  const [fStatus, setFStatus] = useState("");
  const [fMod, setFMod] = useState("");
  const [fResp, setFResp] = useState("");
  const [soAlerta, setSoAlerta] = useState(false);
  const [fKpi, setFKpi] = useState<FiltroKpi>("");
  const [aberta, setAberta] = useState<string | null>(null);
  const [importar, setImportar] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; txt: string } | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [ordem, setOrdem] = useState<"chegada" | "conclusao" | "valor" | "status">("chegada");
  const hoje = hojeISO();

  const carregar = useCallback(async () => {
    try { setDados(await carregarPca()); setErro(null); } catch (e) { setErro(e instanceof Error ? e.message : String(e)); }
  }, []);
  useEffect(() => { void carregar(); }, [carregar, versao]);
  const mudou = useCallback(() => setVersao((v) => v + 1), []);

  async function sincronizar() {
    setOcupado(true); setMsg({ ok: true, txt: "Lendo o PCA no PGC (Dados Abertos e PNCP), a publicação, o DOU e os prazos… leva até 1 minuto." });
    try {
      const r = await acaoPca<{ resumo: Record<string, unknown>; avisos: string[] }>("sincronizar");
      const p = r.resumo.pgc as { contratacoes?: number; novas?: number; alteradas?: number } | undefined;
      setMsg({ ok: true, txt: `✅ PGC: ${p?.contratacoes ?? 0} contratação(ões), ${p?.novas ?? 0} nova(s), ${p?.alteradas ?? 0} atualizada(s); publicação: ${r.resumo.publicacao ?? 0}; DOU: ${r.resumo.dou ?? 0}; avisos D-30: ${r.resumo.d30 ?? 0}.${r.avisos?.length ? ` Atenção: ${r.avisos.join("; ")}` : ""}` });
      mudou();
    } catch (e) { setMsg({ ok: false, txt: "❌ " + (e instanceof Error ? e.message : String(e)) }); } finally { setOcupado(false); }
  }

  const prazo = useMemo(() => new Map((dados?.lista ?? []).map((c) => [c.id, situacaoPrazo(c, hoje)] as [string, SituacaoPrazo])), [dados, hoje]);
  const kpis = useMemo(() => calcularKpis(dados?.lista ?? [], hoje, dados?.irregularidades.length ?? 0, dados?.cfg.sla_cju_dias), [dados, hoje]);
  const oms = useMemo(() => [...new Set((dados?.lista ?? []).map((c) => c.om_apoiada).filter((x): x is string => !!x))].sort(), [dados]);
  const responsaveis = useMemo(() => [...new Set((dados?.lista ?? []).flatMap((c) => [c.responsavel_gapmn, c.pregoeiro_responsavel]).filter((x): x is string => !!x))].sort(), [dados]);

  const visiveis = useMemo(() => {
    const q = norm(busca.trim());
    const l = (dados?.lista ?? []).filter((c) => {
      if (q && !norm(`${c.objeto} ${c.objeto_resumido ?? ""} ${c.id_contratacao_pgc ?? ""} ${c.numero_pag ?? ""} ${c.numero_certame ?? ""} ${c.numero_dnr ?? ""} ${c.numeros_dfd.join(" ")} ${c.om_apoiada ?? ""}`).includes(q)) return false;
      if (fOm && c.om_apoiada !== fOm) return false;
      if (fStatus && c.status_atual !== fStatus) return false;
      if (fMod && c.modalidade !== fMod) return false;
      if (fResp && c.responsavel_gapmn !== fResp && c.pregoeiro_responsavel !== fResp) return false;
      if (soAlerta && !c.alertas_ativos.length) return false;
      const p = prazo.get(c.id);
      if (fKpi === "prazo" && p !== "no_prazo") return false;
      if (fKpi === "risco" && p !== "em_risco" && p !== "atrasado") return false;
      if (fKpi === "cju" && !(c.data_envio_cju && !c.data_retorno_cju)) return false;
      if (fKpi === "douebc" && !(c.pncp_publicado_em && (!c.status_publicacao_dou || !c.status_publicacao_ebc))) return false;
      return true;
    });
    const k = (c: Contratacao) => ordem === "conclusao" ? c.data_estimada_conclusao ?? "9" : ordem === "valor" ? -(c.valor_estimado ?? 0) : ordem === "status" ? TODOS_STATUS.indexOf(c.status_atual) : c.data_estimada_chegada ?? "9";
    return [...l].sort((a, b) => { const x = k(a), y = k(b); return x < y ? -1 : x > y ? 1 : 0; });
  }, [dados, busca, fOm, fStatus, fMod, fResp, soAlerta, fKpi, prazo, ordem]);

  const aberto = dados?.lista.find((c) => c.id === aberta) ?? null;

  if (erro) return <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">Não carregou o Acompanhamento do PCA: {erro}</div>;
  if (!dados) return <p className="text-xs text-slate-500">Carregando o Acompanhamento do PCA…</p>;
  if (dados.semTabelas) return (
    <div className="space-y-2">
      <h2 className="text-base font-bold text-slate-800">Acompanhamento do PCA</h2>
      <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">As tabelas do Acompanhamento do PCA ainda não existem no banco: falta rodar a migração <b>20261125_pca_acompanhamento.sql</b> no SQL Editor do Supabase.</div>
    </div>
  );

  const contaAba = { irregularidades: dados.irregularidades.length, emails: 0 };
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-start gap-3">
        <div>
          <h2 className="text-base font-bold text-slate-800">Acompanhamento do PCA {dados.cfg.ano} — GAP-MN (UASG 120630)</h2>
          <p className="text-xs text-slate-500">
            PCA lido do PGC todo dia às 07:50 e às 13:50; DNR, CJU, publicação, DOU, homologação e impugnações cruzados sozinhos.
            {dados.rodada && <> Última rodada: {horaBR(dados.rodada.fim ?? dados.rodada.inicio)}{dados.rodada.ok === false ? " (com erro)" : ""}.</>}
          </p>
        </div>
        {canEdit && (
          <div className="ml-auto flex flex-wrap gap-2">
            <button className={botao} disabled={ocupado} onClick={() => void sincronizar()}>{ocupado ? "Atualizando…" : "↻ Atualizar agora"}</button>
            <button className={botaoPrimario} onClick={() => setImportar(true)}>+ Registrar DNR</button>
          </div>
        )}
      </div>
      {msg && <div className={`rounded-lg border px-3 py-2 text-xs ${msg.ok ? "border-sky-200 bg-sky-50 text-sky-700" : "border-red-200 bg-red-50 text-red-700"}`}>{msg.txt}</div>}
      {dados.rodada?.ok === false && dados.rodada.erro && <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">A última rodada falhou: {dados.rodada.erro}</div>}

      <div className="flex gap-1 border-b border-slate-200 text-xs">
        {([["processos", "Processos"], ["irregularidades", `Irregularidades${contaAba.irregularidades ? ` (${contaAba.irregularidades})` : ""}`], ["emails", "E-mails"], ["admin", "Administração"]] as const).map(([k, n]) => (
          <button key={k} onClick={() => setAba(k)} className={`-mb-px border-b-2 px-3 py-1.5 font-semibold ${aba === k ? "border-sky-600 text-sky-700" : "border-transparent text-slate-500"} ${k === "irregularidades" && contaAba.irregularidades ? "text-red-600" : ""}`}>{n}</button>
        ))}
      </div>

      {aba === "processos" && (
        <>
          <div className="flex flex-wrap gap-2">
            <Kpi rotulo="Processos no PCA" valor={kpis.total} detalhe={`${kpis.concluidos} homologado(s)`} cor="border-slate-200" ativo={fKpi === ""} onClick={() => setFKpi("")} />
            <Kpi rotulo="No prazo" valor={kpis.noPrazo} cor="border-emerald-200" ativo={fKpi === "prazo"} onClick={() => setFKpi(fKpi === "prazo" ? "" : "prazo")} />
            <Kpi rotulo="Em risco / atrasados" valor={kpis.emRiscoOuAtrasado} detalhe={`${kpis.atrasados} atrasado(s)`} cor="border-amber-200" ativo={fKpi === "risco"} onClick={() => setFKpi(fKpi === "risco" ? "" : "risco")} />
            <Kpi rotulo="Aguardando CJU" valor={kpis.aguardandoCju} detalhe={kpis.cjuVencido ? <span className="font-bold text-red-600">{kpis.cjuVencido} há mais de {dados.cfg.sla_cju_dias} dias</span> : "dentro do prazo"} cor={kpis.cjuVencido ? "border-red-200" : "border-amber-200"} ativo={fKpi === "cju"} onClick={() => setFKpi(fKpi === "cju" ? "" : "cju")} />
            <Kpi rotulo="Pendentes DOU/EBC" valor={<span className={kpis.pendentesDouEbc ? "text-red-600" : ""}>{kpis.pendentesDouEbc}</span>} cor={kpis.pendentesDouEbc ? "border-red-200" : "border-slate-200"} ativo={fKpi === "douebc"} onClick={() => setFKpi(fKpi === "douebc" ? "" : "douebc")} />
            <Kpi rotulo="Fila de irregularidades" valor={<span className={kpis.irregularidades ? "text-red-600" : ""}>{kpis.irregularidades}</span>} detalhe="cross-check DNR × PCA" cor={kpis.irregularidades ? "border-red-200" : "border-slate-200"} onClick={() => setAba("irregularidades")} />
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <input className={`${entrada} min-w-[220px] flex-1`} placeholder="Buscar: objeto, contratação, PAG, certame, DNR, DFD, OM…" value={busca} onChange={(e) => setBusca(e.target.value)} />
            <select className={entrada} value={fOm} onChange={(e) => setFOm(e.target.value)}><option value="">Todas as OMs</option>{oms.map((o) => <option key={o}>{o}</option>)}</select>
            <select className={entrada} value={fStatus} onChange={(e) => setFStatus(e.target.value)}><option value="">Todos os status</option>{TODOS_STATUS.map((s) => <option key={s}>{s}</option>)}</select>
            <select className={entrada} value={fMod} onChange={(e) => setFMod(e.target.value)}><option value="">Todas as modalidades</option>{MODALIDADES.map((m) => <option key={m}>{m}</option>)}</select>
            <select className={entrada} value={fResp} onChange={(e) => setFResp(e.target.value)}><option value="">AUX SLIC / pregoeiro</option>{responsaveis.map((r) => <option key={r}>{r}</option>)}</select>
            <select className={entrada} value={ordem} onChange={(e) => setOrdem(e.target.value as typeof ordem)}><option value="chegada">Ordem: chegada prevista</option><option value="conclusao">Ordem: conclusão prevista</option><option value="valor">Ordem: maior valor</option><option value="status">Ordem: status</option></select>
            <label className="flex items-center gap-1 text-xs text-slate-600"><input type="checkbox" checked={soAlerta} onChange={(e) => setSoAlerta(e.target.checked)} /> só com alerta</label>
            <span className="text-[11px] text-slate-400">{visiveis.length} de {dados.lista.length}</span>
          </div>

          {!dados.lista.length ? (
            <div className="rounded-lg border border-slate-200 bg-white px-3 py-4 text-xs text-slate-500">Nenhuma contratação ainda. {canEdit ? "Clique em \"Atualizar agora\" para ler o PCA do PGC." : "A primeira leitura do PGC acontece na próxima rodada."}</div>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
              <table className="w-full min-w-[1100px] text-left text-[11.5px]">
                <thead className="sticky top-0 bg-slate-50 text-[10.5px] uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="px-2 py-2">Status</th><th className="px-2 py-2">Contratação / PAG</th><th className="px-2 py-2">Objeto · OM</th>
                    <th className="px-2 py-2">Modalidade</th><th className="px-2 py-2 text-right">Valor estimado</th><th className="px-2 py-2">Chegada → Conclusão</th>
                    <th className="px-2 py-2">AUX SLIC · Pregoeiro</th><th className="px-2 py-2">DOU · EBC</th><th className="px-2 py-2">Alertas</th>
                  </tr>
                </thead>
                <tbody>
                  {visiveis.map((c) => {
                    const p = prazo.get(c.id) ?? "no_prazo";
                    const dCju = c.data_envio_cju && !c.data_retorno_cju ? dias(c.data_envio_cju, hoje) : null;
                    return (
                      <tr key={c.id} onClick={() => setAberta(c.id)} className={`cursor-pointer border-t border-slate-100 align-top hover:bg-sky-50/60 ${EXCECOES.includes(c.status_atual) ? "opacity-70" : ""}`}>
                        <td className="px-2 py-1.5"><div className="flex items-start gap-1.5"><span className="mt-1"><PontoPrazo p={p} /></span><SeloStatus c={c} /></div>
                          {dCju != null && <div className={`mt-0.5 text-[10.5px] font-bold ${dCju > dados.cfg.sla_cju_dias ? "animate-pulse text-red-600" : "text-amber-700"}`}>⏱ CJU {dCju}d</div>}</td>
                        <td className="whitespace-nowrap px-2 py-1.5"><div className="font-semibold text-slate-700">{c.id_contratacao_pgc ?? <span className="text-slate-400">s/nº PGC</span>}</div>
                          <div className="text-slate-500">{c.numero_pag ?? "—"}</div>{c.numero_certame && <div className="text-slate-400">{c.numero_certame}</div>}</td>
                        <td className="max-w-[300px] px-2 py-1.5"><div className="font-medium text-slate-800" title={c.objeto}>{c.objeto_resumido ?? c.objeto}</div><div className="text-slate-500">{c.om_apoiada ?? "—"}{c.numero_dnr ? ` · DNR ${c.numero_dnr}` : ""}</div></td>
                        <td className="px-2 py-1.5"><div className={c.modalidade_origem === "sugerida" ? "italic text-slate-500" : "text-slate-700"}>{c.modalidade ?? "—"}</div>
                          <div className="text-[10px] text-slate-400">{c.modalidade_origem === "sugerida" ? "Sugerida (automática)" : c.modalidade_origem === "publicada" ? "✔ publicada" : c.modalidade_origem === "manual" ? "SLIC" : ""}{c.sistema_srp ? " · SRP" : ""}</div></td>
                        <td className="whitespace-nowrap px-2 py-1.5 text-right"><div className="text-slate-700">{brl(c.valor_estimado)}</div><div className="text-[10px] text-slate-400">{c.valor_origem === "edital" ? "edital" : c.valor_origem === "manual" ? "SLIC" : "PCA"}</div></td>
                        <td className="whitespace-nowrap px-2 py-1.5 text-slate-600">{dataBR(c.data_estimada_chegada)} → {dataBR(c.data_estimada_conclusao)}{c.data_chegada_dnr && <div className="text-[10px] text-sky-700">DNR em {dataBR(c.data_chegada_dnr)}</div>}</td>
                        <td className="px-2 py-1.5 text-slate-600"><div>{c.responsavel_gapmn ?? <span className="text-slate-300">—</span>}</div><div className="text-slate-500">{c.pregoeiro_responsavel ?? ""}</div></td>
                        <td className="px-2 py-1.5"><div className="flex flex-col items-start gap-1">
                          <SeloPublicacao rotulo="DOU" publicadoPncp={!!c.pncp_publicado_em} feito={c.status_publicacao_dou} data={c.dou_data} link={c.dou_link} />
                          <SeloPublicacao rotulo="EBC" publicadoPncp={!!c.pncp_publicado_em} feito={c.status_publicacao_ebc} data={c.ebc_data} link={c.ebc_link} /></div></td>
                        <td className="px-2 py-1.5"><ListaAlertas alertas={c.alertas_ativos} compacto /></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
      {aba === "irregularidades" && <FilaIrregularidades dados={dados} onAbrir={(id) => { setAba("processos"); setAberta(id); }} onMudou={mudou} />}
      {aba === "emails" && (canEdit ? <FilaEmails dados={dados} onMudou={mudou} /> : <p className="text-xs text-slate-500">Os e-mails ficam visíveis para a SLIC, ADMIN e DEV.</p>)}
      {aba === "admin" && <AdminPca dados={dados} onMudou={mudou} pode={canEdit} />}

      {aberto && <DetalheContratacao key={`${aberto.id}-${aberto.atualizado_em}`} c={aberto} dados={dados} canEdit={canEdit} onFechar={() => setAberta(null)} onMudou={mudou} />}
      {importar && <ImportarDnr dados={dados} onFechar={() => setImportar(false)} onMudou={mudou} />}
    </div>
  );
}
