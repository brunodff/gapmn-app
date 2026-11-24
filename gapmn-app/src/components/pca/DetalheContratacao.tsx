import { useEffect, useMemo, useState } from "react";
import { CATEGORIAS, ENQUADRAMENTOS, EXCECOES, FLUXOS, MARCOS, MODALIDADES, S, TODOS_STATUS, fase, proximaAcao, type Contratacao, type MarcoId, type Subprocesso } from "../../lib/pca/tipos";
import { dias, situacaoPrazo, triagemJuridica } from "../../lib/pca/regras";
import { acaoPca, dnrsDe, historicoDe, type DadosPca, type DnrPca, type HistoricoPca } from "../../lib/pca/cliente";
import { Campo, ListaAlertas, PontoPrazo, SeloPublicacao, SeloStatus, botao, botaoPrimario, entrada } from "./ui";
import { brl, dataBR, horaBR, nomePrazo } from "./formato";

const hojeISO = () => new Date(Date.now() - 4 * 3600e3).toISOString().slice(0, 10); // Manaus (UTC−4)
const igual = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
const NOMES_CAMPOS: Record<string, string> = {
  criacao: "Criação", status_atual: "Status", numero_pag: "PAG", id_contratacao_pgc: "Contratação (PGC)", numero_certame: "Certame", modalidade: "Modalidade",
  valor_estimado: "Valor estimado", data_estimada_chegada: "Chegada prevista", data_estimada_conclusao: "Conclusão prevista", numero_dnr: "DNR",
  data_chegada_dnr: "Chegada da DNR", responsavel_apoiada: "Responsável (apoiada)", responsavel_gapmn: "AUX SLIC", pregoeiro_responsavel: "Pregoeiro",
  enquadramento_juridico: "Enquadramento jurídico", data_envio_cju: "Envio à CJU", data_retorno_cju: "Retorno da CJU", pncp_publicado_em: "Publicação no PNCP",
  status_publicacao_dou: "DOU publicado", status_publicacao_ebc: "EBC publicado", data_homologacao: "Homologação", encaminhado_em: "Encaminhado (Ata/Contrato)",
  subprocesso_fase_interna: "Subprocesso fase interna", subprocesso_pos_cju: "Subprocesso pós-CJU", subprocesso_fase_externa: "Subprocesso fase externa",
  om_apoiada: "OM/setor", objeto: "Objeto", email_d30_em: "Aviso D-30 ao Elo", pgc_ausente_desde: "Fora do PGC desde", documentacao_inicial_ok: "Documentação inicial",
  decisao_irregularidade: "Decisão da SLIC", ciencia_evento: "Ciência de impugnação/esclarecimento",
};
const ORIGENS: Record<string, string> = { manual: "SLIC", pgc: "PGC", pncp: "PNCP", dou: "DOU", email: "E-mail", siloms: "SILOMS", sistema: "Sistema" };
const mostrar = (v: unknown) => {
  if (v == null || v === "") return "—";
  if (typeof v === "boolean") return v ? "sim" : "não";
  if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}/.test(v)) return v.length === 10 ? dataBR(v) : horaBR(v);
  if (typeof v === "object") {
    const sp = v as Subprocesso;
    if ("fluxo" in sp) return `${sp.nome || "(sem nome)"} · fluxo ${sp.fluxo} · ${Object.entries(sp.marcos ?? {}).map(([k, d]) => `${k}: ${d === "nao_se_aplica" ? "n/a" : dataBR(String(d))}`).join(", ") || "sem marcos"}`;
    return JSON.stringify(v);
  }
  return String(v);
};

/** Linha do tempo do PAG */
function LinhaDoTempo({ c }: { c: Contratacao }) {
  const etapas: [string, string | null, number][] = [
    ["PCA", c.data_estimada_chegada, 0],
    ["DNR", c.data_chegada_dnr, 1],
    ["Minutas", c.subprocesso_fase_interna?.marcos.minutas && c.subprocesso_fase_interna.marcos.minutas !== "nao_se_aplica" ? c.subprocesso_fase_interna.marcos.minutas : null, 2],
    [c.enquadramento_juridico === "Parecer Referencial AGU" ? "MJR" : "CJU", c.data_envio_cju ?? (c.enquadramento_juridico === "Parecer Referencial AGU" ? (typeof c.subprocesso_fase_interna?.marcos.od === "string" ? c.subprocesso_fase_interna.marcos.od : null) : null), 3],
    ["Liberação", c.liberado_publicacao_em ?? c.data_retorno_cju, 6],
    ["PNCP", c.pncp_publicado_em, 7],
    ["Homologação", c.data_homologacao, 8],
    ["Ata/Contrato", c.encaminhado_em, 9],
  ];
  const f = fase(c.status_atual);
  return (
    <div className="overflow-x-auto">
      <ol className="flex min-w-[560px] items-start">
        {etapas.map(([nome, data, fz], i) => {
          const feito = f >= fz && f >= 0;
          const atual = f >= 0 && fz <= f && (i === etapas.length - 1 || etapas[i + 1][2] > f);
          return (
            <li key={nome} className="flex flex-1 flex-col items-center text-center">
              <div className="flex w-full items-center">
                <div className={`h-0.5 flex-1 ${i === 0 ? "opacity-0" : feito ? "bg-sky-400" : "bg-slate-200"}`} />
                <div className={`flex h-6 w-6 items-center justify-center rounded-full border-2 text-[10px] font-bold ${atual ? "border-sky-600 bg-sky-600 text-white" : feito ? "border-sky-400 bg-sky-100 text-sky-700" : "border-slate-200 bg-white text-slate-400"}`}>{i + 1}</div>
                <div className={`h-0.5 flex-1 ${i === etapas.length - 1 ? "opacity-0" : f > fz && f >= 0 ? "bg-sky-400" : "bg-slate-200"}`} />
              </div>
              <div className={`mt-1 text-[10.5px] font-semibold ${atual ? "text-sky-700" : "text-slate-500"}`}>{nome}</div>
              <div className="text-[10px] text-slate-400">{data ? dataBR(data) : ""}</div>
            </li>
          );
        })}
      </ol>
      {EXCECOES.includes(c.status_atual) && <div className="mt-1 text-center text-[11px] font-semibold text-red-600">Processo em exceção: {c.status_atual}</div>}
    </div>
  );
}

/** Subprocesso do SILOMS: fluxo (5 oficiais) e marcos */
function EditorSubprocesso({ titulo, valor, posCju, onChange, pode }: { titulo: string; valor: Subprocesso | null; posCju: boolean; onChange: (v: Subprocesso | null) => void; pode: boolean }) {
  const fluxos = FLUXOS.filter((f) => f.posCju === posCju || f.id === 5);
  const sp = valor ?? { nome: "", fluxo: 0, marcos: {} };
  const marco = (id: MarcoId, v: string | null) => onChange({ ...sp, marcos: { ...sp.marcos, [id]: v ?? undefined } });
  return (
    <div className="space-y-2 rounded-lg border border-slate-200 p-2">
      <div className="flex items-center gap-2 text-[11px] font-semibold text-slate-600">{titulo}
        {valor && pode && <button className="ml-auto text-[10.5px] text-slate-400 hover:text-red-600" onClick={() => onChange(null)}>limpar</button>}</div>
      <div className="grid gap-2 sm:grid-cols-2">
        <Campo rotulo="Nome no SILOMS (DNR XXXX - OBJETO RESUMIDO)"><input className={entrada} disabled={!pode} value={sp.nome} onChange={(e) => onChange({ ...sp, nome: e.target.value })} /></Campo>
        <Campo rotulo="Fluxo"><select className={entrada} disabled={!pode} value={sp.fluxo || ""} onChange={(e) => onChange({ ...sp, fluxo: Number(e.target.value) })}>
          <option value="">— escolha —</option>{fluxos.map((f) => <option key={f.id} value={f.id}>{f.id}. {f.nome} ({f.tramite.join(" - ")})</option>)}</select></Campo>
      </div>
      <div className="grid gap-2 sm:grid-cols-4">
        {MARCOS.map((m) => {
          const v = sp.marcos[m.id];
          return (
            <Campo key={m.id} rotulo={m.nome}>
              <div className="flex gap-1">
                <input type="date" className={`${entrada} min-w-0 flex-1`} disabled={!pode || v === "nao_se_aplica"} value={v && v !== "nao_se_aplica" ? v : ""} onChange={(e) => marco(m.id, e.target.value || null)} />
                {m.id === "irp" && <button title="Não se aplica" disabled={!pode} className={`rounded border px-1 text-[10px] ${v === "nao_se_aplica" ? "border-slate-300 bg-slate-200" : "border-slate-200"}`} onClick={() => marco("irp", v === "nao_se_aplica" ? null : "nao_se_aplica")}>n/a</button>}
              </div>
            </Campo>
          );
        })}
      </div>
      {sp.etapa && <div className="text-[10.5px] text-slate-500">Etapa atual no SILOMS: <b>{sp.etapa}</b></div>}
    </div>
  );
}

export default function DetalheContratacao({ c, dados, canEdit, onFechar, onMudou }: { c: Contratacao; dados: DadosPca; canEdit: boolean; onFechar: () => void; onMudou: () => void }) {
  const [form, setForm] = useState<Contratacao>(c);
  const [hist, setHist] = useState<HistoricoPca[] | null>(null);
  const [dnrs, setDnrs] = useState<DnrPca[]>([]);
  const [msg, setMsg] = useState<{ ok: boolean; txt: string } | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [modalStatus, setModalStatus] = useState(false);
  const [novoStatus, setNovoStatus] = useState<string>(c.status_atual);
  const [justificativa, setJustificativa] = useState("");
  const [irregTexto, setIrregTexto] = useState("");
  const hoje = hojeISO();

  // Esc fecha (primeiro o modal de status, se aberto)
  useEffect(() => {
    const tecla = (e: KeyboardEvent) => { if (e.key === "Escape") { if (modalStatus) setModalStatus(false); else onFechar(); } };
    window.addEventListener("keydown", tecla);
    return () => window.removeEventListener("keydown", tecla);
  }, [modalStatus, onFechar]);
  useEffect(() => {
    let vivo = true;
    historicoDe(c.id).then((h) => { if (vivo) setHist(h); }).catch(() => { if (vivo) setHist([]); });
    dnrsDe(c.id).then((d) => { if (vivo) setDnrs(d); });
    return () => { vivo = false; };
  }, [c.id, c.atualizado_em]);

  const set = <K extends keyof Contratacao>(k: K, v: Contratacao[K]) => setForm((f) => ({ ...f, [k]: v }));
  const mudancas = useMemo(() => {
    const m: Record<string, unknown> = {};
    for (const k of Object.keys(form) as (keyof Contratacao)[]) if (!igual(form[k], c[k])) m[k] = form[k];
    return m;
  }, [form, c]);
  const sugestaoTriagem = useMemo(() => triagemJuridica(form, dados.regras, hoje), [form, dados.regras, hoje]);
  const irregs = dados.irregularidades.filter((i) => i.contratacao_id === c.id);
  const eventos = dados.eventos.filter((e) => e.contratacao_id === c.id);
  const pode = canEdit;
  const prazo = situacaoPrazo(c, hoje);
  const diasCju = c.data_envio_cju && !c.data_retorno_cju ? dias(c.data_envio_cju, hoje) : null;

  async function executar(f: () => Promise<unknown>, ok: string) {
    setOcupado(true); setMsg(null);
    try { await f(); setMsg({ ok: true, txt: ok }); onMudou(); } catch (e) { setMsg({ ok: false, txt: e instanceof Error ? e.message : String(e) }); } finally { setOcupado(false); }
  }
  const salvar = () => executar(() => acaoPca("editar", { id: c.id, campos: mudancas }), "Alterações salvas e registradas no histórico.");
  const trocarStatus = () => executar(async () => { await acaoPca("editar", { id: c.id, campos: {}, status: novoStatus, justificativa }); setModalStatus(false); setJustificativa(""); }, `Status alterado para "${novoStatus}".`);

  const opcoesEquipe = (funcoes: string[]) => dados.equipe.filter((p) => p.ativo && funcoes.some((f) => p.funcao.toLowerCase().includes(f.toLowerCase())));
  const auxSlic = opcoesEquipe(["aux", "slic"]);
  const pregoeiros = opcoesEquipe(["pregoeiro", "agente"]);

  return (
    <div className="fixed inset-0 z-[60] flex justify-end bg-black/30" onClick={onFechar}>
      <div className="h-full w-full max-w-4xl overflow-y-auto shadow-2xl" style={{ background: "var(--gm-pop, #fff)" }} onClick={(e) => e.stopPropagation()}>
        <div className="sticky top-0 z-10 border-b border-slate-200 px-4 py-3" style={{ background: "var(--gm-pop, #fff)" }}>
          <div className="flex items-start gap-3">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2"><SeloStatus c={c} /><PontoPrazo p={prazo} /><span className="text-[11px] text-slate-500">{nomePrazo(prazo)}</span></div>
              <h3 className="mt-1 text-sm font-bold text-slate-800">{c.objeto_resumido ?? c.objeto}</h3>
              <div className="text-[11px] text-slate-500">
                {c.id_contratacao_pgc ? `Contratação ${c.id_contratacao_pgc}` : "Sem nº no PGC"} · {c.numero_pag ? `PAG ${c.numero_pag}` : "sem PAG"}{c.numero_certame ? ` · ${c.modalidade ?? ""} ${c.numero_certame}` : ""} · {c.om_apoiada ?? "OM não informada"}
              </div>
            </div>
            {pode && <button className={botao} onClick={() => { setNovoStatus(c.status_atual); setModalStatus(true); }}>Alterar status…</button>}
            <button onClick={onFechar} className="text-lg text-slate-400 hover:text-slate-700" aria-label="Fechar">✕</button>
          </div>
        </div>

        <div className="space-y-4 p-4">
          <LinhaDoTempo c={c} />
          <div className="rounded-lg border border-sky-100 bg-sky-50 px-3 py-2 text-xs text-sky-700"><b>Próxima ação:</b> {proximaAcao(c.status_atual, c.sistema_srp)}</div>
          {msg && <div className={`rounded-lg border px-3 py-2 text-xs ${msg.ok ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-red-200 bg-red-50 text-red-700"}`}>{msg.txt}</div>}
          <ListaAlertas alertas={c.alertas_ativos} />

          {eventos.length > 0 && (
            <section className="space-y-1">
              <h4 className="text-xs font-bold text-slate-700">Impugnações e esclarecimentos</h4>
              {eventos.map((e) => (
                <div key={e.id} className="flex items-center gap-2 rounded-md border border-red-200 bg-red-50 px-2 py-1 text-xs text-red-700">
                  <span className="flex-1">{e.tipo === "impugnacao" ? "Impugnação" : "Esclarecimento"}: {e.assunto} ({horaBR(e.data)}, {e.remetente})</span>
                  {pode && <button className={botao} disabled={ocupado} onClick={() => executar(() => acaoPca("ciente", { evento_id: e.id }), "Ciência registrada.")}>Dar ciência</button>}
                </div>
              ))}
            </section>
          )}
          {irregs.length > 0 && (
            <section className="space-y-1">
              <h4 className="text-xs font-bold text-slate-700">Irregularidades abertas (decisão na aba Irregularidades)</h4>
              {irregs.map((i) => <div key={i.id} className="rounded-md border border-amber-200 bg-amber-50 px-2 py-1 text-xs text-amber-800">{i.descricao}</div>)}
            </section>
          )}

          <section className="space-y-2">
            <h4 className="text-xs font-bold text-slate-700">Identificação e planejamento</h4>
            <div className="grid gap-2 sm:grid-cols-4">
              <Campo rotulo="Contratação no PGC"><input className={entrada} disabled={!pode} value={form.id_contratacao_pgc ?? ""} placeholder="120630-110/2027" onChange={(e) => set("id_contratacao_pgc", e.target.value)} /></Campo>
              <Campo rotulo="PAG (XXXXX.XXXXXX/XXXX-XX)"><input className={entrada} disabled={!pode} value={form.numero_pag ?? ""} onChange={(e) => set("numero_pag", e.target.value)} /></Campo>
              <Campo rotulo="Nº do certame"><input className={entrada} disabled={!pode} value={form.numero_certame ?? ""} onChange={(e) => set("numero_certame", e.target.value)} /></Campo>
              <Campo rotulo="DFD / itens do PCA"><div className="py-1 text-xs text-slate-600">{c.numeros_dfd.join(", ") || "—"} · {c.itens_pca.length ? `${c.itens_pca.length} item(ns)` : "—"}</div></Campo>
              <Campo rotulo="Objeto resumido" largo><input className={entrada} disabled={!pode} value={form.objeto_resumido ?? ""} onChange={(e) => set("objeto_resumido", e.target.value)} /></Campo>
              <Campo rotulo="OM apoiada / setor">
                <input className={entrada} list="pca-oms" disabled={!pode} value={form.om_apoiada ?? ""} onChange={(e) => set("om_apoiada", e.target.value)} />
                <datalist id="pca-oms">{dados.elos.map((e) => <option key={e.id} value={e.om}>{e.nome_om ?? ""}</option>)}</datalist>
              </Campo>
              <Campo rotulo="Categoria"><select className={entrada} disabled={!pode} value={form.categoria ?? ""} onChange={(e) => set("categoria", (e.target.value || null) as Contratacao["categoria"])}><option value="">—</option>{CATEGORIAS.map((x) => <option key={x}>{x}</option>)}</select></Campo>
              <Campo rotulo="Chegada prevista (PCA)"><input type="date" className={entrada} disabled={!pode} value={form.data_estimada_chegada ?? ""} onChange={(e) => set("data_estimada_chegada", e.target.value || null)} /></Campo>
              <Campo rotulo="Conclusão prevista (PCA)"><input type="date" className={entrada} disabled={!pode} value={form.data_estimada_conclusao ?? ""} onChange={(e) => set("data_estimada_conclusao", e.target.value || null)} /></Campo>
              <Campo rotulo={`Valor estimado (${c.valor_origem === "edital" ? "edital" : c.valor_origem === "manual" ? "SLIC" : "PCA"})`}><input type="number" step="0.01" className={entrada} disabled={!pode} value={form.valor_estimado ?? ""} onChange={(e) => set("valor_estimado", e.target.value === "" ? null : Number(e.target.value))} /></Campo>
              <Campo rotulo="Sistema de Registro de Preços"><select className={entrada} disabled={!pode} value={form.sistema_srp == null ? "" : form.sistema_srp ? "s" : "n"} onChange={(e) => set("sistema_srp", e.target.value === "" ? null : e.target.value === "s")}><option value="">—</option><option value="s">Sim (Ata)</option><option value="n">Não (Contrato)</option></select></Campo>
              <Campo rotulo={`Modalidade (${c.modalidade_origem === "sugerida" ? "sugerida automaticamente" : c.modalidade_origem === "publicada" ? "confirmada pela publicação" : c.modalidade_origem === "manual" ? "definida pela SLIC" : "—"})`} largo>
                <select className={entrada} disabled={!pode || c.modalidade_origem === "publicada"} value={form.modalidade ?? ""} onChange={(e) => set("modalidade", e.target.value || null)}><option value="">—</option>{MODALIDADES.map((x) => <option key={x}>{x}</option>)}</select>
                {c.modalidade_motivo && <span className="text-[10.5px] italic text-slate-400">{c.modalidade_motivo}</span>}
              </Campo>
            </div>
            <p className="text-[11px] text-slate-500">Objeto no PGC: {c.objeto}</p>
          </section>

          <section className="space-y-2">
            <h4 className="text-xs font-bold text-slate-700">DNR e responsáveis</h4>
            <div className="grid gap-2 sm:grid-cols-4">
              <Campo rotulo="Nº da DNR"><input className={entrada} disabled={!pode} value={form.numero_dnr ?? ""} onChange={(e) => set("numero_dnr", e.target.value)} /></Campo>
              <Campo rotulo="Chegada da DNR"><input type="date" className={entrada} disabled={!pode} value={form.data_chegada_dnr ?? ""} onChange={(e) => set("data_chegada_dnr", e.target.value || null)} /></Campo>
              <Campo rotulo="Responsável na apoiada (assinou o TR)" largo><input className={entrada} disabled={!pode} value={form.responsavel_apoiada ?? ""} onChange={(e) => set("responsavel_apoiada", e.target.value)} /></Campo>
              <Campo rotulo="AUX SLIC (minutas de Edital, Contrato e Ata)" largo>
                <select className={entrada} disabled={!pode} value={form.responsavel_gapmn ?? ""} onChange={(e) => set("responsavel_gapmn", e.target.value || null)}>
                  <option value="">— designar —</option>{auxSlic.map((p) => <option key={p.id}>{p.nome}</option>)}
                  {form.responsavel_gapmn && !auxSlic.some((p) => p.nome === form.responsavel_gapmn) && <option>{form.responsavel_gapmn}</option>}
                </select>
              </Campo>
              <Campo rotulo="Pregoeiro / agente de contratação" largo>
                <select className={entrada} disabled={!pode} value={form.pregoeiro_responsavel ?? ""} onChange={(e) => set("pregoeiro_responsavel", e.target.value || null)}>
                  <option value="">— designar —</option>{pregoeiros.map((p) => <option key={p.id}>{p.nome}</option>)}
                  {form.pregoeiro_responsavel && !pregoeiros.some((p) => p.nome === form.pregoeiro_responsavel) && <option>{form.pregoeiro_responsavel}</option>}
                </select>
              </Campo>
              <label className="flex items-center gap-2 text-xs text-slate-700 sm:col-span-4">
                <input type="checkbox" disabled={!pode} checked={form.documentacao_inicial_ok} onChange={(e) => set("documentacao_inicial_ok", e.target.checked)} />
                Documentação inicial da Equipe de Planejamento recebida e conferida (tudo, exceto Edital, Contrato e Ata)
              </label>
            </div>
            {dnrs.length > 0 && (
              <div className="text-[11px] text-slate-500">DNR registrada(s): {dnrs.map((d) => `${d.numero_dnr ?? "s/nº"} (${d.fonte}, ${dataBR(d.data_chegada)}${d.pag_tr && d.pag_oficio && d.pag_tr !== d.pag_oficio ? `; PAG do TR ${d.pag_tr} ≠ Ofício ${d.pag_oficio}` : ""})`).join(" · ")}</div>
            )}
          </section>

          <section className="space-y-2">
            <h4 className="text-xs font-bold text-slate-700">Fase interna (SILOMS)</h4>
            <EditorSubprocesso titulo="Subprocesso da fase interna" valor={form.subprocesso_fase_interna} posCju={false} pode={pode} onChange={(v) => set("subprocesso_fase_interna", v)} />
          </section>

          <section className="space-y-2">
            <h4 className="text-xs font-bold text-slate-700">Análise jurídica</h4>
            <div className="grid gap-2 sm:grid-cols-4">
              <Campo rotulo="Enquadramento" largo><select className={entrada} disabled={!pode} value={form.enquadramento_juridico} onChange={(e) => set("enquadramento_juridico", e.target.value as Contratacao["enquadramento_juridico"])}>{ENQUADRAMENTOS.map((x) => <option key={x}>{x}</option>)}</select></Campo>
              <Campo rotulo="Regra de MJR (parecer referencial)" largo>
                <select className={entrada} disabled={!pode || form.enquadramento_juridico !== "Parecer Referencial AGU"} value={form.mjr_id ?? ""} onChange={(e) => set("mjr_id", e.target.value ? Number(e.target.value) : null)}>
                  <option value="">—</option>{dados.regras.map((r) => <option key={r.id} value={r.id}>{r.titulo}</option>)}
                </select>
              </Campo>
              <Campo rotulo="Envio à CJU"><input type="date" className={entrada} disabled={!pode} value={form.data_envio_cju ?? ""} onChange={(e) => set("data_envio_cju", e.target.value || null)} /></Campo>
              <Campo rotulo="Retorno da CJU"><input type="date" className={entrada} disabled={!pode} value={form.data_retorno_cju ?? ""} onChange={(e) => set("data_retorno_cju", e.target.value || null)} /></Campo>
              <div className="flex items-end sm:col-span-2">
                {diasCju != null && <span className={`rounded-md px-2 py-1 text-xs font-bold ${diasCju > dados.cfg.sla_cju_dias ? "animate-pulse bg-red-100 text-red-700" : "bg-amber-50 text-amber-800"}`}>⏱ {diasCju} dia(s) na CJU (referência: {dados.cfg.sla_cju_dias})</span>}
              </div>
            </div>
            <p className="text-[11px] text-slate-500">{c.enquadramento_motivo ?? ""} {form.enquadramento_juridico === "Pendente de Triagem" && <>Sugestão: <b>{sugestaoTriagem.enquadramento}</b> — {sugestaoTriagem.motivo}</>}</p>
            {(form.data_retorno_cju || form.subprocesso_pos_cju) && <EditorSubprocesso titulo="Subprocesso pós-CJU (Equipe de Planejamento → ACI → OD → SLIC)" valor={form.subprocesso_pos_cju} posCju pode={pode} onChange={(v) => set("subprocesso_pos_cju", v)} />}
          </section>

          <section className="space-y-2">
            <h4 className="text-xs font-bold text-slate-700">Publicação</h4>
            <div className="flex flex-wrap gap-2">
              <SeloPublicacao rotulo="DOU" publicadoPncp={!!c.pncp_publicado_em} feito={c.status_publicacao_dou} data={c.dou_data} link={c.dou_link} />
              <SeloPublicacao rotulo="EBC" publicadoPncp={!!c.pncp_publicado_em} feito={c.status_publicacao_ebc} data={c.ebc_data} link={c.ebc_link} />
              {c.link_pncp && <a className="text-[11px] text-sky-700 underline" href={c.link_pncp} target="_blank" rel="noreferrer">ver no PNCP ↗</a>}
            </div>
            <div className="grid gap-2 sm:grid-cols-4">
              <Campo rotulo="Liberado para publicação"><input type="date" className={entrada} disabled={!pode} value={form.liberado_publicacao_em ?? ""} onChange={(e) => set("liberado_publicacao_em", e.target.value || null)} /></Campo>
              <Campo rotulo="Publicado no PNCP"><input type="date" className={entrada} disabled={!pode} value={form.pncp_publicado_em ?? ""} onChange={(e) => set("pncp_publicado_em", e.target.value || null)} /></Campo>
              <Campo rotulo="Link do PNCP" largo><input className={entrada} disabled={!pode} value={form.link_pncp ?? ""} onChange={(e) => set("link_pncp", e.target.value)} /></Campo>
              {(["dou", "ebc"] as const).map((x) => (
                <div key={x} className={`grid grid-cols-[auto_1fr_2fr] items-end gap-2 rounded-md p-1 sm:col-span-4 ${c.pncp_publicado_em && !c[`status_publicacao_${x}`] ? "bg-red-50" : ""}`}>
                  <label className="flex items-center gap-1 pb-1 text-xs font-semibold text-slate-700"><input type="checkbox" disabled={!pode} checked={form[`status_publicacao_${x}`]} onChange={(e) => set(`status_publicacao_${x}`, e.target.checked)} /> {x.toUpperCase()} publicado</label>
                  <Campo rotulo="Data"><input type="date" className={entrada} disabled={!pode} value={form[`${x}_data`] ?? ""} onChange={(e) => set(`${x}_data`, e.target.value || null)} /></Campo>
                  <Campo rotulo="Link ou comprovante"><input className={entrada} disabled={!pode} value={form[`${x}_link`] ?? ""} onChange={(e) => set(`${x}_link`, e.target.value)} /></Campo>
                </div>
              ))}
            </div>
          </section>

          <section className="space-y-2">
            <h4 className="text-xs font-bold text-slate-700">Fase externa e homologação</h4>
            <div className="grid gap-2 sm:grid-cols-4">
              <Campo rotulo="Subprocesso fase externa (FASE EXTERNA - PREGÃO XXXXXX)" largo><input className={entrada} disabled={!pode} value={form.subprocesso_fase_externa ?? ""} onChange={(e) => set("subprocesso_fase_externa", e.target.value)} /></Campo>
              <Campo rotulo="Homologação"><input type="date" className={entrada} disabled={!pode} value={form.data_homologacao ?? ""} onChange={(e) => set("data_homologacao", e.target.value || null)} /></Campo>
              <Campo rotulo="Encaminhado (Ata/Contrato)"><div className="py-1 text-xs text-slate-600">{c.encaminhado_em ? dataBR(c.encaminhado_em) : "—"}</div></Campo>
            </div>
            <Campo rotulo="Observação"><textarea className={`${entrada} min-h-[50px]`} disabled={!pode} value={form.observacao ?? ""} onChange={(e) => set("observacao", e.target.value)} /></Campo>
          </section>

          {pode && (
            <div className="sticky bottom-0 -mx-4 flex flex-wrap items-center gap-2 border-t border-slate-200 px-4 py-2" style={{ background: "var(--gm-pop, #fff)" }}>
              <button className={botaoPrimario} disabled={ocupado || !Object.keys(mudancas).length} onClick={() => void salvar()}>{ocupado ? "Salvando…" : `Salvar ${Object.keys(mudancas).length || ""} alteração(ões)`}</button>
              <button className={botao} disabled={ocupado || !Object.keys(mudancas).length} onClick={() => setForm(c)}>Descartar</button>
              <div className="ml-auto flex items-center gap-1">
                <input className={`${entrada} w-64`} placeholder="Irregularidade documental (ex.: falta o mapa de riscos)" value={irregTexto} onChange={(e) => setIrregTexto(e.target.value)} />
                <button className={botao} disabled={ocupado || irregTexto.trim().length < 10} onClick={() => void executar(async () => { await acaoPca("irregularidade", { id: c.id, descricao: irregTexto }); setIrregTexto(""); }, "Irregularidade registrada; a unidade é avisada se houver Elo cadastrado.")}>Registrar</button>
              </div>
            </div>
          )}

          <section className="space-y-1">
            <h4 className="text-xs font-bold text-slate-700">Histórico (auditoria — não pode ser alterado)</h4>
            {!hist ? <p className="text-xs text-slate-400">Carregando…</p> : !hist.length ? <p className="text-xs text-slate-400">Sem registros.</p> : (
              <div className="max-h-80 overflow-y-auto rounded-lg border border-slate-200">
                <table className="w-full text-left text-[11px]">
                  <thead className="sticky top-0 text-slate-500" style={{ background: "var(--gm-pop, #f8fafc)" }}><tr><th className="px-2 py-1">Quando</th><th className="px-2 py-1">Origem</th><th className="px-2 py-1">Campo</th><th className="px-2 py-1">De → Para</th><th className="px-2 py-1">Quem / justificativa</th></tr></thead>
                  <tbody>
                    {hist.map((h) => (
                      <tr key={h.id} className="border-t border-slate-100 align-top">
                        <td className="whitespace-nowrap px-2 py-1 text-slate-500">{horaBR(h.em)}</td>
                        <td className="px-2 py-1">{ORIGENS[h.origem] ?? h.origem}</td>
                        <td className="px-2 py-1 font-medium text-slate-700">{NOMES_CAMPOS[h.campo] ?? h.campo}</td>
                        <td className="px-2 py-1 text-slate-600"><span className="text-slate-400 line-through">{mostrar(h.de)}</span> → {mostrar(h.para)}</td>
                        <td className="px-2 py-1 text-slate-600">{h.usuario_nome ?? ""}{h.justificativa && <div className="italic text-slate-500">“{h.justificativa}”</div>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
          <p className="text-[10.5px] text-slate-400">Atualizado em {horaBR(c.atualizado_em)} · valor {brl(c.valor_estimado)}</p>
        </div>
      </div>

      {modalStatus && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/40 p-4" onClick={(e) => { e.stopPropagation(); setModalStatus(false); }}>
          <div className="w-full max-w-md space-y-3 rounded-xl p-4 shadow-xl" style={{ background: "var(--gm-pop, #fff)" }} onClick={(e) => e.stopPropagation()}>
            <h4 className="text-sm font-bold text-slate-800">Alterar status (com auditoria)</h4>
            <p className="text-xs text-slate-500">Atual: <b>{c.status_atual}</b>. A justificativa fica no histórico imutável, com o seu nome, a data e a hora, e vai no aviso ao Elo.</p>
            <Campo rotulo="Novo status">
              <select className={entrada} value={novoStatus} onChange={(e) => setNovoStatus(e.target.value)}>
                <optgroup label="Fluxo">{TODOS_STATUS.filter((s) => !EXCECOES.includes(s)).map((s) => <option key={s}>{s}</option>)}</optgroup>
                <optgroup label="Exceções">{EXCECOES.map((s) => <option key={s}>{s}</option>)}</optgroup>
              </select>
            </Campo>
            <Campo rotulo="Justificativa (obrigatória)"><textarea className={`${entrada} min-h-[80px]`} value={justificativa} onChange={(e) => setJustificativa(e.target.value)} placeholder="Motivo da alteração (ex.: suspenso por impugnação acolhida; adiado a pedido da unidade, Of nº …)" /></Campo>
            {novoStatus === S.ADIADO && <p className="text-[11px] text-amber-700">Lembrete: adiamento ou cancelamento exige expediente formal da unidade pedindo a alteração do PCA.</p>}
            <div className="flex justify-end gap-2">
              <button className={botao} onClick={() => setModalStatus(false)}>Cancelar</button>
              <button className={botaoPrimario} disabled={ocupado || novoStatus === c.status_atual || justificativa.trim().length < 10} onClick={() => void trocarStatus()}>Confirmar</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
