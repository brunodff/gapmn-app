import { useEffect, useMemo, useState } from "react";
import { Caixa, Campo, CampoNumero, Secao } from "../reajustes/campos";
import {
  alertasDoAditivo, alteracoes, analisarPareceres, brl, eCefa, fimPrevisto, fraseObservacaoParecer, itensDaLista, numero, objetoDaFicha,
  pareceresSugeridos, passa1Milhao, valorNovo, NOMES, type AguParecer,
} from "../../lib/aditivos/regras";
import { carregarAditivo, omsCadastradas, pareceresAgu, salvarAditivo, salvarOm, cadastroReajuste, type OmCadastrada } from "../../lib/aditivos/dados";
import { kitAditivo, type DocumentoGerado } from "../../lib/aditivos/kitAditivo";
import { ALTERACOES, NATUREZAS, type Alteracao, type DadosAditivo, type EstadoAditivo, type ParecerReferencial, type RegistroAditivo } from "../../lib/aditivos/tipos";
import MapaRiscos from "./MapaRiscos";
import { Regularidade, Sicaf } from "./Consultas";
import { anexosVazios, type AnexosConsultas, type Arquivo } from "../../lib/aditivos/anexos";
import { MemoriaAditivo, PesquisaAditivo } from "./PesquisaMemoria";

const hojeISO = () => new Date(Date.now() - 4 * 3600e3).toISOString().slice(0, 10);
const botao = "rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50";
const primario = "rounded-lg bg-sky-600 px-4 py-2 text-sm font-semibold text-white hover:bg-sky-700 disabled:opacity-50";
const sel = "w-full rounded-lg border border-slate-200 px-2 py-1.5 text-sm outline-none";
const baixarBlob = (b: Blob, nome: string) => { const u = URL.createObjectURL(b); const l = document.createElement("a"); l.href = u; l.download = nome; l.click(); setTimeout(() => URL.revokeObjectURL(u), 5000); };

export default function AditivoContrato({ id, usuario, onVoltar, onAbrir }: { id: string; usuario: string | null; onVoltar: () => void; onAbrir: (link: string) => void }) {
  const [reg, setReg] = useState<RegistroAditivo | null>(null);
  const [d, setD] = useState<DadosAditivo | null>(null);
  const [e, setE] = useState<EstadoAditivo | null>(null);
  const [sujo, setSujo] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; txt: string } | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [agu, setAgu] = useState<AguParecer[]>([]);
  const [oms, setOms] = useState<OmCadastrada[]>([]);
  const [anexos, setAnexos] = useState<AnexosConsultas>(anexosVazios());
  const [memoria, setMemoria] = useState<Arquivo | null>(null);
  const [geracao, setGeracao] = useState<{ docs: Record<string, DocumentoGerado>; zip: Blob; nome: string } | null>(null);
  const hoje = hojeISO();

  useEffect(() => {
    let vivo = true;
    Promise.all([carregarAditivo(id), pareceresAgu(), omsCadastradas()]).then(([r, a, o]) => {
      if (!vivo) return;
      setReg(r); setD(r.dados); setE(r.estado); setAgu(a); setOms(o);
    }).catch((x) => vivo && setErro(x instanceof Error ? x.message : String(x)));
    return () => { vivo = false; };
  }, [id]);

  const mudar = (f: (x: DadosAditivo) => DadosAditivo) => { setD((x) => (x ? f(x) : x)); setSujo(true); };
  const mudarE = (p: Partial<EstadoAditivo>) => { setE((x) => (x ? { ...x, ...p } : x)); setSujo(true); };

  // pareceres: seguem o catálogo da SCON conforme as alterações, a natureza e a lei, até a SCON editar a lista à mão
  const sugeridos = useMemo(() => (d && e ? pareceresSugeridos(alteracoes(d), e.natureza, e.lei, agu).map((p) => { const q: ParecerReferencial & { conferido?: boolean; url?: string | null } = { ...p }; delete q.conferido; delete q.url; return q as ParecerReferencial; }) : []), [d, e, agu]);
  const manuais = !!e?.pareceres_manuais;
  const dx = useMemo(() => (d ? (manuais ? d : { ...d, pareceres_referenciais: sugeridos }) : null), [d, manuais, sugeridos]);

  const an = useMemo(() => (dx ? analisarPareceres(dx, hoje) : null), [dx, hoje]);
  const itens = useMemo(() => (dx ? itensDaLista(dx, hoje) : []), [dx, hoje]);
  const alertas = useMemo(() => (dx && e ? alertasDoAditivo(dx, e, hoje, { sicaf: anexos.sicaf.length > 0, regularidade: !!anexos.consolidada }) : []), [dx, e, hoje, anexos]);
  const bloqueios = alertas.filter((a) => a.bloqueia);

  if (erro) return <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{erro} <button className="ml-2 underline" onClick={onVoltar}>voltar</button></div>;
  if (!reg || !d || !dx || !e || !an) return <p className="text-sm text-slate-500">Abrindo o aditivo…</p>;

  const novo = valorNovo(dx);
  const acimaMilhao = passa1Milhao(dx);
  const ad = d.aditivo;

  async function salvar(situacao?: RegistroAditivo["situacao"]) {
    if (!reg || !dx || !e) return null;
    setOcupado(true); setMsg(null);
    try {
      const r = await salvarAditivo(reg, dx, e, usuario, situacao);
      setD(r.dados);
      setReg(r); setSujo(false);
      setMsg({ ok: true, txt: "Aditivo salvo." });
      return r;
    } catch (x) { setMsg({ ok: false, txt: x instanceof Error ? x.message : String(x) }); return null; } finally { setOcupado(false); }
  }
  async function guardarOm() {
    if (!d) return;
    try {
      await salvarOm({ sigla: d.om_signataria.sigla, nome: d.om_signataria.nome, ug: d.om_signataria.ug || null, artigo: d.om_signataria.artigo, autoridade_superior: d.autoridade_superior }, usuario);
      setOms(await omsCadastradas());
      setMsg({ ok: true, txt: `Dados da ${d.om_signataria.sigla} guardados para os próximos aditivos.` });
    } catch (x) { setMsg({ ok: false, txt: x instanceof Error ? x.message : String(x) }); }
  }
  async function recarregarCadastro() {
    if (!reg) return;
    const { dados } = await cadastroReajuste(reg.numero_contrato);
    if (!dados) { setMsg({ ok: false, txt: "Sem cadastro nos Reajustes para este contrato." }); return; }
    const hist = (dados.historico_valores ?? []).filter((h) => h.valor != null);
    mudar((x) => ({
      ...x, valor_atual: hist.length ? hist[hist.length - 1].valor : x.valor_atual,
      empenho: dados.orcamento ? { ...x.empenho, gestao_unidade: dados.orcamento.gestao_unidade, fonte: dados.orcamento.fonte, programa_trabalho: dados.orcamento.programa_trabalho, acao: dados.orcamento.acao || null, plano_interno: dados.orcamento.plano_interno, natureza_despesa: dados.orcamento.natureza_despesa, exercicio: dados.orcamento.exercicio } : x.empenho,
    }));
    setMsg({ ok: true, txt: "Valor atual e dotação do empenho trazidos do cadastro dos Reajustes (atualizado pelo Contratos.gov.br quando a SCON busca lá)." });
  }
  function marcar(k: Alteracao, v: boolean) {
    mudar((x) => ({ ...x, aditivo: { ...x.aditivo, [k]: v ? (k === "prorrogacao" ? { modalidade: "com_valor", meses: 12, inicio: null } : k === "reajuste" ? { indice: null, percentual: null, valor: null } : { valor: null, percentual: null, descricao: null }) : null } }));
  }
  function valorAlteracao(k: "acrescimo" | "supressao", campo: "valor" | "percentual" | "descricao", v: number | string | null) {
    mudar((x) => {
      const atual = numero(x.valor_atual);
      const a = { ...(x.aditivo[k] ?? { valor: null, percentual: null, descricao: null }), [campo]: v };
      // valor ⇄ percentual pelo valor atual do contrato
      if (campo === "valor" && atual && typeof v === "number") a.percentual = Math.round((v / atual) * 10000) / 100;
      if (campo === "percentual" && atual && typeof v === "number") a.valor = Math.round(atual * v) / 100;
      return { ...x, aditivo: { ...x.aditivo, [k]: a } };
    });
  }
  function naoAnexado(chave: string, marcado: boolean) {
    mudar((x) => { const n = { ...x.nao_anexados }; if (marcado) n[chave] = n[chave] ?? ""; else delete n[chave]; return { ...x, nao_anexados: n }; });
  }
  function listaPareceres(f: (l: ParecerReferencial[]) => ParecerReferencial[]) {
    const base = dx!.pareceres_referenciais;
    mudar((x) => ({ ...x, pareceres_referenciais: f(base) }));
    if (!manuais) mudarE({ pareceres_manuais: true });
  }
  const parecer = (i: number, p: Partial<ParecerReferencial>) => listaPareceres((l) => l.map((q, j) => (j === i ? { ...q, ...p } : q)));
  async function irParaPesquisa() {
    if (sujo && !(await salvar())) return;
    onAbrir(`/app?vista=pesquisa-precos&aditivo=${reg!.id}`);
  }
  async function gerar() {
    if (!dx || !reg || !e) return;
    const r0 = sujo ? await salvar() : reg;
    if (!r0) return;
    setOcupado(true); setGeracao(null); setMsg({ ok: true, txt: "Preparando o kit da SCON (na primeira vez o navegador baixa o Python, cerca de 15 MB)…" });
    try {
      const ct = dx.contrato.replace(/\//g, "-");
      const extras: { nome: string; bytes: ArrayBuffer }[] = [];
      anexos.sicaf.forEach((a, i) => extras.push({ nome: `12 - SICAF - CT ${ct}${anexos.sicaf.length > 1 ? ` (${i + 1})` : ""}.pdf`, bytes: a.bytes }));
      if (anexos.item13) extras.push({ nome: anexos.item13.nome, bytes: anexos.item13.bytes });
      else if (anexos.consolidada) extras.push({ nome: `13 - Consulta Consolidada - CT ${ct}.pdf`, bytes: anexos.consolidada.bytes });
      anexos.socio.forEach((a, i) => extras.push({ nome: `14 - Consulta CPF do socio - CT ${ct} (${i + 1}).pdf`, bytes: a.bytes }));
      if (memoria && ad.reajuste) extras.push({ nome: memoria.nome, bytes: memoria.bytes });
      const r = await kitAditivo.gerar(dx, extras, (t) => setMsg({ ok: true, txt: t }));
      const nome = `${dx.numero_aditivo ?? ""}º Termo Aditivo - CT ${ct}.zip`;
      setGeracao({ docs: r.documentos, zip: r.zip, nome });
      const falhas = Object.values(r.documentos).filter((x) => !x.ok);
      setMsg({ ok: !falhas.length, txt: falhas.length ? `${falhas.length} documento(s) não saíram: veja os erros abaixo.` : `${r.arquivos.length} arquivo(s) no .zip.` });
      baixarBlob(r.zip, nome);
      const atualizado = await salvarAditivo(r0, dx, { ...e, gerado_em: new Date().toISOString(), arquivos_gerados: r.arquivos }, usuario, "gerado");
      setReg(atualizado); setE(atualizado.estado); setSujo(false);
    } catch (x) { setMsg({ ok: false, txt: x instanceof Error ? x.message : String(x) }); } finally { setOcupado(false); }
  }

  const cefa = eCefa(d.om_signataria);
  const omCad = oms.find((o) => o.sigla.toUpperCase() === d.om_signataria.sigla.toUpperCase());
  return (
    <div className="space-y-3 pb-24">
      <div className="flex flex-wrap items-center gap-2">
        <button className={botao} onClick={onVoltar}>← Aditivos</button>
        <h2 className="text-base font-bold text-slate-800">{d.numero_aditivo ?? "?"}º Termo Aditivo — Contrato {d.contrato}</h2>
        <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${reg.situacao === "gerado" ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-800"}`}>{reg.situacao === "gerado" ? "documentos gerados" : "rascunho"}</span>
        <span className="text-[11px] text-slate-400">salvo por {reg.atualizado_nome ?? "—"} em {new Date(reg.atualizado_em).toLocaleString("pt-BR")}</span>
      </div>
      {msg && <div className={`rounded-lg border px-3 py-2 text-xs ${msg.ok ? "border-sky-200 bg-sky-50 text-sky-700" : "border-red-200 bg-red-50 text-red-700"}`}>{msg.txt}</div>}

      <Secao titulo="Contrato e OMs" direita={<button className={botao} onClick={() => void recarregarCadastro()}>↻ Trazer do cadastro dos Reajustes</button>}>
        <div className="grid gap-2 sm:grid-cols-4">
          <Campo rotulo="Nº do contrato" valor={d.contrato} onChange={(v) => mudar((x) => ({ ...x, contrato: v }))} />
          <Campo rotulo="PAG (processo)" valor={d.pag} onChange={(v) => mudar((x) => ({ ...x, pag: v }))} />
          <label className="block"><span className="block text-[11px] font-medium text-slate-600 mb-0.5">Nº do termo aditivo</span>
            <CampoNumero valor={d.numero_aditivo} casas={0} onChange={(v) => mudar((x) => ({ ...x, numero_aditivo: v }))} /></label>
          <label className="block"><span className="block text-[11px] font-medium text-slate-600 mb-0.5">CNPJ da contratada</span>
            <input className={sel} value={e.cnpj} onChange={(ev) => mudarE({ cnpj: ev.target.value })} /></label>
          <div className="sm:col-span-2"><Campo rotulo="OM solicitante/responsável (cabeçalho da Lista)" valor={d.om_nome} onChange={(v) => mudar((x) => ({ ...x, om_nome: v }))} /></div>
          <div className="sm:col-span-2"><Campo rotulo="Objeto do contrato" valor={e.objeto_contrato} ro onChange={() => {}} /></div>
        </div>
        <div className="mt-3 rounded-lg border border-slate-200 p-2">
          <div className="mb-1 text-[11px] font-semibold text-slate-600">OM que assina o contrato (Declaração, Mapa de Riscos, Ficha e o ACI da Lista)</div>
          <div className="grid gap-2 sm:grid-cols-5">
            <div className="sm:col-span-2"><Campo rotulo="Nome" valor={d.om_signataria.nome} onChange={(v) => mudar((x) => ({ ...x, om_signataria: { ...x.om_signataria, nome: v } }))} /></div>
            <Campo rotulo="Sigla" valor={d.om_signataria.sigla} onChange={(v) => mudar((x) => ({ ...x, om_signataria: { ...x.om_signataria, sigla: v } }))} />
            <Campo rotulo="Código da UG" valor={d.om_signataria.ug} onChange={(v) => mudar((x) => ({ ...x, om_signataria: { ...x.om_signataria, ug: v.replace(/\D/g, "") } }))} />
            <label className="block"><span className="block text-[11px] font-medium text-slate-600 mb-0.5">Artigo</span>
              <select className={sel} value={d.om_signataria.artigo} onChange={(ev) => mudar((x) => ({ ...x, om_signataria: { ...x.om_signataria, artigo: ev.target.value as "do" | "da" } }))}><option value="do">do</option><option value="da">da</option></select></label>
          </div>
          <button className={`${botao} mt-2`} onClick={() => void guardarOm()}>Guardar esta OM para os próximos aditivos{omCad ? " (atualizar)" : ""}</button>
        </div>
      </Secao>

      <Secao titulo="1. O que o aditivo vai fazer">
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-2">
            <label className="block"><span className="block text-[11px] font-medium text-slate-600 mb-0.5">Valor atual do contrato (período vigente: inicial + acréscimos + reajustes − supressões)</span>
              <CampoNumero valor={numero(d.valor_atual)} onChange={(v) => mudar((x) => ({ ...x, valor_atual: v }))} /></label>
            <div className="text-xs text-slate-600">Valor que o contrato passará a ter: <b>{novo == null ? "—" : brl(novo)}</b>{acimaMilhao && <span className="ml-1 rounded bg-amber-100 px-1 text-amber-800">acima de R$ 1 milhão: entra a Ficha de Autorização</span>}</div>
            <label className="block"><span className="block text-[11px] font-medium text-slate-600 mb-0.5">Outro valor final (só para caso especial; vazio = calculado)</span>
              <CampoNumero valor={numero(d.valor_novo)} onChange={(v) => mudar((x) => ({ ...x, valor_novo: v }))} /></label>
          </div>
          <div className="space-y-2">
            <Caixa rotulo="Prorrogação de vigência" marcado={!!ad.prorrogacao} onChange={(v) => marcar("prorrogacao", v)} />
            {ad.prorrogacao && (
              <div className="ml-5 grid gap-2 sm:grid-cols-2">
                <label className="block sm:col-span-2"><span className="block text-[11px] font-medium text-slate-600 mb-0.5">Modalidade</span>
                  <select className={sel} value={ad.prorrogacao.modalidade} onChange={(ev) => mudar((x) => ({ ...x, aditivo: { ...x.aditivo, prorrogacao: { ...x.aditivo.prorrogacao!, modalidade: ev.target.value as "com_valor" | "sem_valor" } } }))}>
                    <option value="com_valor">Com valor – renova o valor contratual do período</option><option value="sem_valor">Sem valor – em sentido estrito (só estende a vigência)</option></select></label>
                <label className="block"><span className="block text-[11px] font-medium text-slate-600 mb-0.5">Meses</span>
                  <CampoNumero valor={ad.prorrogacao.meses} casas={0} onChange={(v) => mudar((x) => ({ ...x, aditivo: { ...x.aditivo, prorrogacao: { ...x.aditivo.prorrogacao!, meses: v, fim: null } } }))} /></label>
                <Campo rotulo="Início do novo período (dd/mm/aaaa)" valor={ad.prorrogacao.inicio ?? ""} onChange={(v) => mudar((x) => ({ ...x, aditivo: { ...x.aditivo, prorrogacao: { ...x.aditivo.prorrogacao!, inicio: v || null, fim: null } } }))} />
                <Campo rotulo="Fim (calculado; editável)" valor={ad.prorrogacao.fim ?? fimPrevisto(ad.prorrogacao.inicio, ad.prorrogacao.meses) ?? ""} onChange={(v) => mudar((x) => ({ ...x, aditivo: { ...x.aditivo, prorrogacao: { ...x.aditivo.prorrogacao!, fim: v || null } } }))} />
              </div>
            )}
            <Caixa rotulo="Reajuste" marcado={!!ad.reajuste} onChange={(v) => marcar("reajuste", v)} />
            {ad.reajuste && (
              <div className="ml-5 grid gap-2 sm:grid-cols-3">
                <Campo rotulo="Índice" valor={ad.reajuste.indice ?? ""} onChange={(v) => mudar((x) => ({ ...x, aditivo: { ...x.aditivo, reajuste: { ...x.aditivo.reajuste!, indice: v || null } } }))} />
                <Campo rotulo="Percentual" valor={ad.reajuste.percentual ?? ""} onChange={(v) => mudar((x) => ({ ...x, aditivo: { ...x.aditivo, reajuste: { ...x.aditivo.reajuste!, percentual: v || null } } }))} />
                <label className="block"><span className="block text-[11px] font-medium text-slate-600 mb-0.5">Valor (R$)</span>
                  <CampoNumero valor={ad.reajuste.valor} onChange={(v) => mudar((x) => ({ ...x, aditivo: { ...x.aditivo, reajuste: { ...x.aditivo.reajuste!, valor: v } } }))} /></label>
                <p className="sm:col-span-3 text-[11px] text-slate-500">Os três vêm da seção 9 (Memória de Cálculo), pelo motor dos Reajustes.</p>
              </div>
            )}
            {(["acrescimo", "supressao"] as const).map((k) => (
              <div key={k}>
                <Caixa rotulo={k === "acrescimo" ? "Acréscimo" : "Supressão"} marcado={!!ad[k]} onChange={(v) => marcar(k, v)} />
                {ad[k] && (
                  <div className="ml-5 grid gap-2 sm:grid-cols-3">
                    <label className="block"><span className="block text-[11px] font-medium text-slate-600 mb-0.5">Valor (R$)</span><CampoNumero valor={ad[k]!.valor} onChange={(v) => valorAlteracao(k, "valor", v)} /></label>
                    <label className="block"><span className="block text-[11px] font-medium text-slate-600 mb-0.5">Percentual (%)</span><CampoNumero valor={ad[k]!.percentual} onChange={(v) => valorAlteracao(k, "percentual", v)} /></label>
                    <Campo rotulo="Descrição (referente a…)" valor={ad[k]!.descricao ?? ""} onChange={(v) => valorAlteracao(k, "descricao", v || null)} />
                    {(numero(ad[k]!.percentual) ?? 0) > 25 && <p className="sm:col-span-3 text-[11px] font-semibold text-red-600">Acima de 25% (art. 125 da Lei 14.133/2021; 50% só para reforma de edifício/equipamento).</p>}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </Secao>

      <Secao titulo="2. Pareceres referenciais (um para cada alteração)">
        <div className="grid gap-2 sm:grid-cols-3">
          <label className="block sm:col-span-2"><span className="block text-[11px] font-medium text-slate-600 mb-0.5">Natureza do objeto</span>
            <select className={sel} value={e.natureza} onChange={(ev) => mudarE({ natureza: ev.target.value as EstadoAditivo["natureza"] })}>{NATUREZAS.map(([k, n]) => <option key={k} value={k}>{n}</option>)}</select></label>
          <label className="block"><span className="block text-[11px] font-medium text-slate-600 mb-0.5">Lei do contrato</span>
            <select className={sel} value={e.lei} onChange={(ev) => mudarE({ lei: ev.target.value as EstadoAditivo["lei"] })}><option value="14133">Lei 14.133/2021</option><option value="8666">Lei 8.666/1993</option></select></label>
        </div>
        <ul className="mt-2 space-y-1 text-xs">
          {an.pareceres.map((p) => <li key={p.numero} className="rounded-md border border-emerald-200 bg-emerald-50 px-2 py-1 text-emerald-800">🟢 {p.fundamenta.map((a) => NOMES[a]).join(" e ").replace(/^./, (c) => c.toUpperCase())}: fundamentados no {p.numero} (válido até {p.validade ?? "?"}).</li>)}
          {an.descobertas.map((x) => <li key={x} className="rounded-md border border-red-200 bg-red-50 px-2 py-1 font-semibold text-red-700">🔴 {x.replace(/^./, (c) => c.toUpperCase())}: sem parecer referencial vigente. Este termo aditivo deverá ir para análise jurídica (CJU).</li>)}
        </ul>
        <div className="mt-2 space-y-2">
          {dx.pareceres_referenciais.map((p, i) => (
            <div key={i} className="rounded-lg border border-slate-200 p-2 text-xs">
              <div className="grid gap-2 sm:grid-cols-4">
                <div className="sm:col-span-2"><Campo rotulo="Nº completo do parecer" valor={p.numero} onChange={(v) => parecer(i, { numero: v })} /></div>
                <Campo rotulo="Data" valor={p.data ?? ""} onChange={(v) => parecer(i, { data: v || null })} />
                <Campo rotulo="Válido até" valor={p.validade ?? ""} onChange={(v) => parecer(i, { validade: v || null })} />
                <div className="sm:col-span-4"><Campo rotulo="Objeto (ementa)" valor={p.objeto ?? ""} longo onChange={(v) => parecer(i, { objeto: v })} /></div>
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-3">
                <span className="text-slate-600">Fundamenta:</span>
                {ALTERACOES.map((a) => <label key={a} className="flex items-center gap-1"><input type="checkbox" checked={p.cobre.includes(a)} onChange={(ev) => parecer(i, { cobre: ev.target.checked ? [...p.cobre, a] : p.cobre.filter((x) => x !== a) })} />{NOMES[a]}</label>)}
                <label className="flex items-center gap-1">limite % <input className="w-14 rounded border border-slate-200 px-1" value={p.limite_percentual ?? ""} onChange={(ev) => parecer(i, { limite_percentual: numero(ev.target.value) })} /></label>
                <button className="ml-auto text-red-600 underline" onClick={() => listaPareceres((l) => l.filter((_, j) => j !== i))}>remover</button>
              </div>
            </div>
          ))}
          <div className="flex flex-wrap gap-2 text-xs">
            <select className="max-w-[520px] rounded-lg border border-slate-200 px-2 py-1" value="" onChange={(ev) => {
              const a = agu.find((x) => String(x.id) === ev.target.value);
              if (!a) return;
              listaPareceres((l) => [...l, { numero: a.parecer ?? "", objeto: a.assunto ?? "", data: a.data ? a.data.split("-").reverse().join("/") : null, validade: a.validade ? a.validade.split("-").reverse().join("/") : null, cobre: [] }]);
            }}>
              <option value="">+ Incluir um parecer da página AGU (pareceres referenciais vigentes)…</option>
              {agu.filter((a) => !a.validade || a.validade >= hoje).map((a) => <option key={a.id} value={a.id}>{(a.parecer ?? "").slice(0, 70)} — {(a.assunto ?? "").slice(0, 80)}</option>)}
            </select>
            {manuais && <button className={botao} onClick={() => mudarE({ pareceres_manuais: false })}>Voltar às sugestões do catálogo da SCON</button>}
          </div>
        </div>
      </Secao>

      <Secao titulo="3. Lista de Verificação">
        <div className="flex flex-wrap gap-4">
          <Caixa rotulo="Incluir a consulta do CPF do sócio majoritário" marcado={d.consulta_socio} onChange={(v) => mudar((x) => ({ ...x, consulta_socio: v }))} />
          <Caixa rotulo="O representante da empresa mudou (procuração)" marcado={d.representante_mudou} onChange={(v) => mudar((x) => ({ ...x, representante_mudou: v }))} />
          <Caixa rotulo="Contratação por inexigibilidade (atestado de exclusividade)" marcado={d.inexigibilidade} onChange={(v) => mudar((x) => ({ ...x, inexigibilidade: v }))} />
        </div>
        <ol className="mt-2 space-y-1 text-xs">
          {itens.map((it, i) => {
            const nao = it.chave in d.nao_anexados;
            return (
              <li key={it.chave} className={`rounded-md border px-2 py-1 ${nao ? "border-amber-200 bg-amber-50" : "border-slate-100"}`}>
                <div className="flex gap-2">
                  <span className="w-5 shrink-0 text-right font-semibold text-slate-500">{i + 1}.</span>
                  <span className="flex-1 whitespace-pre-line text-slate-700">{it.texto}</span>
                  <label className="flex shrink-0 items-center gap-1 text-[11px] text-slate-600"><input type="checkbox" checked={nao} onChange={(ev) => naoAnexado(it.chave, ev.target.checked)} /> não será anexado</label>
                </div>
                {nao && <input className="mt-1 w-full rounded border border-amber-300 px-2 py-1" placeholder="Justificativa (obrigatória; vai para a Observação)" value={d.nao_anexados[it.chave]} onChange={(ev) => mudar((x) => ({ ...x, nao_anexados: { ...x.nao_anexados, [it.chave]: ev.target.value } }))} />}
              </li>
            );
          })}
        </ol>
        <div className="mt-2"><Campo rotulo="Observação (texto livre do fiscal)" valor={d.observacao} longo onChange={(v) => mudar((x) => ({ ...x, observacao: v }))} /></div>
        {fraseObservacaoParecer(an) && <p className="mt-1 text-[11px] text-slate-500">Vai também para a Observação: "{fraseObservacaoParecer(an)}".</p>}
      </Secao>

      <Secao titulo="4. Declaração de Disponibilidade Orçamentária (último empenho)">
        <p className="mb-2 text-[11px] text-slate-500">Último empenho: {e.ultimo_empenho?.ne ?? d.empenho.numero ?? "—"} ({e.ultimo_empenho?.origem ?? "cadastro"}). Para buscar no Contratos.gov.br, use "Buscar no Contratos.gov.br" no contrato dos Reajustes e depois "Trazer do cadastro dos Reajustes" acima.</p>
        <div className="grid gap-2 sm:grid-cols-4">
          {([["gestao_unidade", "Gestão/Unidade"], ["fonte", "Fonte de Recursos"], ["programa_trabalho", "Programa de Trabalho (PTRES)"], ["acao", "Ação"], ["plano_interno", "Plano Interno"], ["natureza_despesa", "Natureza de Despesa"]] as const).map(([k, n]) => (
            <Campo key={k} rotulo={n} valor={String(d.empenho[k] ?? "")} onChange={(v) => mudar((x) => ({ ...x, empenho: { ...x.empenho, [k]: k === "acao" ? v || null : v } }))} />
          ))}
          <Campo rotulo="Exercício" valor={String(d.empenho.exercicio ?? "")} onChange={(v) => mudar((x) => ({ ...x, empenho: { ...x.empenho, exercicio: Number(v) || v || null } }))} />
        </div>
      </Secao>

      <Secao titulo="5. Mapa de Riscos">
        <MapaRiscos riscos={d.riscos} tipo={e.tipo_risco} onChange={(r) => mudar((x) => ({ ...x, riscos: r }))} onTipo={(t) => mudarE({ tipo_risco: t })} />
      </Secao>

      <Secao titulo="6. SICAF (item 12 – obrigatório)">
        <Sicaf estado={e} anexos={anexos} onEstado={mudarE} onAnexos={(a) => setAnexos((x) => ({ ...x, ...a }))} />
      </Secao>

      <Secao titulo="7. Regularidade CEIS / CNEP / CNJ / TCU (item 13 – obrigatório)">
        <Regularidade estado={e} anexos={anexos} contrato={d.contrato} consultaSocio={d.consulta_socio} onEstado={mudarE} onAnexos={(a) => setAnexos((x) => ({ ...x, ...a }))} />
      </Secao>

      <Secao titulo="8. Pesquisa de Preços (obrigatória)">
        <PesquisaAditivo d={d} numeroContrato={reg.numero_contrato} onPesquisa={(p) => mudar((x) => ({ ...x, pesquisa_precos: p }))} onFazer={() => void irParaPesquisa()} />
      </Secao>

      {ad.reajuste && (
        <Secao titulo="9. Memória de Cálculo + Calculadora do Cidadão (reajuste)">
          <MemoriaAditivo d={d} numeroContrato={reg.numero_contrato} memoria={memoria} onMemoria={setMemoria}
            onReajuste={(rj) => mudar((x) => ({ ...x, aditivo: { ...x.aditivo, reajuste: rj } }))}
            onAbrirReajustes={() => onAbrir(`/app?vista=reajustes&contrato=${encodeURIComponent(reg.numero_contrato)}`)} />
        </Secao>
      )}

      {acimaMilhao && (
        <Secao titulo="10. Ficha para a Autorização da Prorrogação (acima de R$ 1 milhão)">
          <pre className="whitespace-pre-wrap rounded-md bg-slate-50 p-2 text-[11px] text-slate-700">{objetoDaFicha(dx)}</pre>
          <div className="mt-2"><Campo rotulo="9. Mérito administrativo (justificativa do fiscal) – obrigatório" valor={d.merito_administrativo} longo onChange={(v) => mudar((x) => ({ ...x, merito_administrativo: v }))} /></div>
          {!cefa && <div className="mt-2"><Campo rotulo="19. Cargo da autoridade que autoriza (OM fora do CEFA)" valor={d.autoridade_superior ?? ""} onChange={(v) => mudar((x) => ({ ...x, autoridade_superior: v || null }))} dica="GAP-MN e Prefeitura: Diretor de Administração da Aeronáutica (automático)." /></div>}
          <div className="mt-2 grid gap-2 sm:grid-cols-3">
            {([["parecer_juridico", "13/14. Parecer jurídico (CJU), se houver"], ["ratificacao", "15. Ratificação pela autoridade superior"], ["aprovacao_superior", "16. Aprovação da autoridade superior"]] as const).map(([k, n]) => (
              <div key={k} className="space-y-1">
                <Campo rotulo={`${n} – nº`} valor={d[k]?.numero ?? ""} onChange={(v) => mudar((x) => ({ ...x, [k]: v ? { numero: v, data: x[k]?.data ?? "" } : null }))} />
                <Campo rotulo="data" valor={d[k]?.data ?? ""} onChange={(v) => mudar((x) => ({ ...x, [k]: x[k] ? { ...x[k]!, data: v } : null }))} />
              </div>
            ))}
          </div>
        </Secao>
      )}

      <Secao titulo="Alertas e geração dos documentos">
        <ul className="space-y-1 text-xs">
          {alertas.length === 0 && <li className="text-emerald-700">Nenhum alerta.</li>}
          {alertas.map((a, i) => <li key={i} className={`rounded-md border px-2 py-1 ${a.nivel === "critico" ? "border-red-200 bg-red-50 text-red-700" : a.nivel === "atencao" ? "border-amber-200 bg-amber-50 text-amber-800" : "border-slate-200 bg-slate-50 text-slate-600"}`}>{a.bloqueia ? "⛔ " : a.nivel === "critico" ? "🔴 " : a.nivel === "atencao" ? "⚠️ " : "ℹ️ "}{a.texto}</li>)}
        </ul>
        {geracao && (
          <div className="mt-3 space-y-1 text-xs">
            {Object.values(geracao.docs).map((doc) => (
              <div key={doc.nome} className={doc.ok ? "text-emerald-700" : "text-red-700"}>{doc.ok ? "✔" : "✖"} {doc.nome}{doc.erros.length ? `: ${doc.erros.join("; ")}` : ""}{doc.avisos.length ? <span className="text-amber-700"> · {doc.avisos.join("; ")}</span> : null}</div>
            ))}
            <button className={botao} onClick={() => baixarBlob(geracao.zip, geracao.nome)}>⬇ Baixar de novo: {geracao.nome}</button>
          </div>
        )}
      </Secao>

      <div className="sticky bottom-0 z-30 -mx-1 flex rounded-lg pr-20 flex-wrap items-center justify-end gap-2 border-t border-slate-200 px-4 py-2" style={{ background: "var(--gm-pop, #fff)" }}>
        {bloqueios.length > 0 && <span className="mr-auto text-xs text-red-600">{bloqueios.length} pendência(s) impedem a geração.</span>}
        <button className={botao} disabled={ocupado || !sujo} onClick={() => void salvar()}>{sujo ? "Salvar" : "Salvo"}</button>
        <button className={primario} disabled={ocupado || bloqueios.length > 0} onClick={() => void gerar()}>{ocupado ? "Aguarde…" : "Gerar os documentos (.zip)"}</button>
      </div>
    </div>
  );
}
