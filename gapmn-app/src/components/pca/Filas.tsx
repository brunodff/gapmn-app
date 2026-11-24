import { useCallback, useEffect, useState } from "react";
import { acaoPca, dnr as lerDnr, emailsPca, type DadosPca, type DnrPca, type EmailPca, type Irregularidade } from "../../lib/pca/cliente";
import { botao, botaoPrimario, entrada } from "./ui";
import { dataBR, horaBR } from "./formato";

const TIPOS: Record<string, string> = {
  pag_divergente: "PAG do TR ≠ PAG do Ofício", contratacao_ausente: "TR sem nº da contratação", contratacao_invalida: "Contratação inválida ou fora do PCA",
  objeto_incompativel: "Objeto incompatível com o PCA", pag_em_uso: "PAG já usado em outra contratação", evento_sem_processo: "E-mail/SILOMS sem processo",
  item_fora_da_contratacao: "Item do PCA fora da contratação", documental: "Irregularidade documental",
};
const COM_DNR = ["contratacao_ausente", "contratacao_invalida", "objeto_incompativel", "pag_em_uso"];

function ItemIrregularidade({ i, dados, onAbrir, onMudou }: { i: Irregularidade; dados: DadosPca; onAbrir: (id: string) => void; onMudou: () => void }) {
  const [d, setD] = useState<DnrPca | null>(null);
  const [alvo, setAlvo] = useState(i.contratacao_id ?? "");
  const [obs, setObs] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  useEffect(() => { if (i.dnr_id) void lerDnr(i.dnr_id).then(setD); }, [i.dnr_id]);
  const c = dados.lista.find((x) => x.id === i.contratacao_id);
  async function resolver(decisao: string) {
    setOcupado(true); setErro(null);
    try { await acaoPca("resolver", { irregularidade_id: i.id, decisao, contratacao_id: alvo || null, observacao: obs }); onMudou(); }
    catch (e) { setErro(e instanceof Error ? e.message : String(e)); } finally { setOcupado(false); }
  }
  const precisaVincular = COM_DNR.includes(i.tipo) && !!i.dnr_id;
  return (
    <div className="space-y-2 rounded-lg border border-amber-200 bg-white p-3">
      <div className="flex flex-wrap items-center gap-2 text-[11px]">
        <span className="rounded-full bg-amber-100 px-2 py-0.5 font-bold text-amber-800">{TIPOS[i.tipo] ?? i.tipo}</span>
        <span className="text-slate-400">{horaBR(i.criado_em)}</span>
        {c && <button className="text-sky-700 underline" onClick={() => onAbrir(c.id)}>{c.id_contratacao_pgc ?? ""} {c.objeto_resumido}</button>}
      </div>
      <p className="text-xs text-slate-700">{i.descricao}</p>
      {d && <p className="text-[11px] text-slate-500">DNR {d.numero_dnr ?? "s/nº"} de {dataBR(d.data_chegada)} · PAG Ofício {d.pag_oficio ?? "—"} · PAG TR {d.pag_tr ?? "—"} · contratação no TR {d.numero_contratacao ?? "—"} · objeto: {d.objeto ?? "—"}</p>}
      <div className="flex flex-wrap items-center gap-2">
        {precisaVincular && (
          <select className={`${entrada} max-w-[360px]`} value={alvo} onChange={(e) => setAlvo(e.target.value)}>
            <option value="">— vincular a qual contratação? —</option>
            {dados.lista.map((x) => <option key={x.id} value={x.id}>{x.id_contratacao_pgc ?? "s/nº"} · {x.objeto_resumido}{x.numero_pag ? ` (PAG ${x.numero_pag})` : ""}</option>)}
          </select>
        )}
        <input className={`${entrada} min-w-[200px] flex-1`} placeholder="Observação da decisão (fica no histórico)" value={obs} onChange={(e) => setObs(e.target.value)} />
        {precisaVincular && <button className={botaoPrimario} disabled={ocupado || !alvo} onClick={() => void resolver("vincular")}>Vincular</button>}
        {!precisaVincular && <button className={botaoPrimario} disabled={ocupado} onClick={() => void resolver("resolvida")}>Marcar resolvida</button>}
        <button className={botao} disabled={ocupado} onClick={() => void resolver("descartar")}>Descartar</button>
      </div>
      {erro && <p className="text-xs text-red-600">{erro}</p>}
    </div>
  );
}

export function FilaIrregularidades({ dados, onAbrir, onMudou }: { dados: DadosPca; onAbrir: (id: string) => void; onMudou: () => void }) {
  if (!dados.irregularidades.length) return <p className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-700">Nenhuma irregularidade aguardando decisão.</p>;
  return (
    <div className="space-y-2">
      <p className="text-xs text-slate-500">O sistema não vincula sozinho quando o nº da contratação falta, não existe no PCA ou o objeto não confere: a SLIC decide aqui. Cada decisão fica no histórico.</p>
      {dados.irregularidades.map((i) => <ItemIrregularidade key={i.id} i={i} dados={dados} onAbrir={onAbrir} onMudou={onMudou} />)}
    </div>
  );
}

const TIPO_EMAIL: Record<string, string> = { d30: "Aviso D-30 ao Elo", macro: "Mudança de status ao Elo", homologacao_srp: "Homologado → Atas (SRP)", homologacao_contrato: "Homologado → SCON (contrato)", sla_cju: "Prazo da CJU → SLIC", impugnacao: "Impugnação/esclarecimento" };

export function FilaEmails({ dados, onMudou }: { dados: DadosPca; onMudou: () => void }) {
  const [lista, setLista] = useState<EmailPca[] | null>(null);
  const [ver, setVer] = useState<EmailPca | null>(null);
  const [filtro, setFiltro] = useState("pendente");
  const [msg, setMsg] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const carregar = useCallback(() => { emailsPca().then(setLista).catch((e) => setMsg(e.message)); }, []);
  useEffect(() => { carregar(); }, [carregar]);
  async function enviar(ids?: string[]) {
    const n = ids?.length ?? lista?.filter((m) => m.situacao === "pendente").length ?? 0;
    if (!confirm(`Enviar ${n} e-mail(s) agora? Eles saem de noreply@gapmn.app para os destinatários mostrados.`)) return;
    setOcupado(true); setMsg(null);
    try { const r = await acaoPca<{ enviados: number; erros: number; aviso?: string }>("enviar", ids ? { ids } : {}); setMsg(`${r.enviados} enviado(s), ${r.erros} com erro.${r.aviso ? ` ${r.aviso}` : ""}`); carregar(); onMudou(); }
    catch (e) { setMsg(e instanceof Error ? e.message : String(e)); } finally { setOcupado(false); }
  }
  const vis = (lista ?? []).filter((m) => !filtro || m.situacao === filtro);
  return (
    <div className="space-y-2">
      <div className={`rounded-lg border px-3 py-2 text-xs ${dados.cfg.envio_automatico ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-amber-200 bg-amber-50 text-amber-800"}`}>
        {dados.cfg.envio_automatico ? "Envio automático LIGADO: os avisos saem sozinhos a cada rodada e a cada mudança." : "Envio automático DESLIGADO: os avisos ficam aqui até a SLIC enviar (liga em Administração › Configuração)."}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <select className={entrada} value={filtro} onChange={(e) => setFiltro(e.target.value)}>
          <option value="pendente">Pendentes</option><option value="enviado">Enviados</option><option value="erro">Com erro</option><option value="">Todos</option>
        </select>
        <button className={botaoPrimario} disabled={ocupado || !(lista ?? []).some((m) => m.situacao === "pendente")} onClick={() => void enviar()}>Enviar todos os pendentes</button>
        {msg && <span className="text-xs text-slate-600">{msg}</span>}
      </div>
      {!lista ? <p className="text-xs text-slate-400">Carregando…</p> : !vis.length ? <p className="text-xs text-slate-400">Nenhum e-mail nesta situação.</p> : (
        <div className="overflow-x-auto rounded-lg border border-slate-200">
          <table className="w-full text-left text-[11px]">
            <thead className="bg-slate-50 text-slate-500"><tr><th className="px-2 py-1">Criado</th><th className="px-2 py-1">Tipo</th><th className="px-2 py-1">Para</th><th className="px-2 py-1">Assunto</th><th className="px-2 py-1">Situação</th><th /></tr></thead>
            <tbody>
              {vis.map((m) => (
                <tr key={m.id} className="border-t border-slate-100">
                  <td className="whitespace-nowrap px-2 py-1 text-slate-500">{horaBR(m.criado_em)}</td>
                  <td className="px-2 py-1">{TIPO_EMAIL[m.tipo] ?? m.tipo}</td>
                  <td className="px-2 py-1">{m.para.join(", ")}</td>
                  <td className="px-2 py-1">{m.assunto}</td>
                  <td className="px-2 py-1">{m.situacao === "enviado" ? `✔ ${horaBR(m.enviado_em)}` : m.situacao === "erro" ? <span className="text-red-600" title={m.erro ?? ""}>erro</span> : "pendente"}</td>
                  <td className="whitespace-nowrap px-2 py-1">
                    <button className="text-sky-700 underline" onClick={() => setVer(m)}>ver</button>
                    {m.situacao !== "enviado" && <button className="ml-2 text-sky-700 underline" disabled={ocupado} onClick={() => void enviar([m.id])}>enviar</button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {ver && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/40 p-4" onClick={() => setVer(null)}>
          <div className="w-full max-w-2xl space-y-2 rounded-xl p-3 shadow-xl" style={{ background: "var(--gm-pop, #fff)" }} onClick={(e) => e.stopPropagation()}>
            <div className="text-xs text-slate-500">Para: {ver.para.join(", ")}<br />Assunto: <b>{ver.assunto}</b></div>
            <iframe title="Prévia do e-mail" sandbox="" srcDoc={ver.html} className="h-[60vh] w-full rounded border border-slate-200 bg-white" />
            <div className="flex justify-end"><button className={botao} onClick={() => setVer(null)}>Fechar</button></div>
          </div>
        </div>
      )}
    </div>
  );
}
