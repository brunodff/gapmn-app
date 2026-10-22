// Formulário mensal dos indicadores de desempenho — aberto por link, sem login (como um Google Forms).
// A pessoa se identifica (posto, nome de guerra e divisão), preenche as variáveis dos indicadores da
// divisão e vê na hora o resultado e a classificação, com as mesmas regras do Painel de Governança.
// Atenção/Crítico pedem justificativa; o comprovante é opcional. A DOC também informa os contratos
// e atas essenciais. Tudo é gravado pelo banco (gov_salvar), que confere o código do link.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { fmtValor, metaExibida } from "../lib/indicadores/formato.ts";
import type { Status } from "../lib/indicadores/tipos.ts";
import { DIVISOES, POSTOS, competenciaExtenso, nomeDivisao, nomeSecao } from "../lib/governanca/cadastros.ts";
import { carregarFormulario, enviarAnexo, problemaDoAnexo, salvarDivisao } from "../lib/governanca/coleta.ts";
import { lerNumero, numeroParaCampo, quantasVariaveis } from "../lib/governanca/formulas.ts";
import { pedeJustificativa, previaDoIndicador } from "../lib/governanca/previa.ts";
import type { ContratoGov, Formulario, Identificacao, IndicadorGov, ItemParaSalvar, StatusContrato, TipoLancamento } from "../lib/governanca/tipos.ts";
import "./coletaIndicadores.css";

const CHAVE_IDENT = "gapmn_coleta_identificacao_v1";

type Campos = { t1: string; t2: string; t3: string; comentario: string; arquivo: File | null };
const VAZIO: Campos = { t1: "", t2: "", t3: "", comentario: "", arquivo: null };
const chave = (id: string, tipo: TipoLancamento) => `${id}|${tipo}`;

const STATUS_VISUAL: Partial<Record<Status, { rotulo: string; classe: string }>> = {
  "Adequado": { rotulo: "Adequado", classe: "ok" },
  "Atenção": { rotulo: "Atenção", classe: "atencao" },
  "Crítico": { rotulo: "Crítico", classe: "critico" },
  "Sem dados no mês de referência": { rotulo: "Sem evento no mês", classe: "neutro" },
  "Aguardando informação": { rotulo: "Falta informar", classe: "neutro" },
};

function lerIdentGuardada(): Identificacao {
  try {
    const j = JSON.parse(localStorage.getItem(CHAVE_IDENT) ?? "null");
    if (j && typeof j === "object") return { posto: String(j.posto ?? ""), nome: String(j.nome ?? ""), divisao: String(j.divisao ?? "") };
  } catch { /* navegação privada */ }
  return { posto: "", nome: "", divisao: "" };
}

const dataHora = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleString("pt-BR", { timeZone: "America/Manaus", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "";
const dataBR = (iso: string | null | undefined) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : "—");

function diasAte(iso: string | null): number | null {
  if (!iso) return null;
  const hoje = new Date(new Date().toLocaleString("en-US", { timeZone: "America/Manaus" }));
  hoje.setHours(0, 0, 0, 0);
  return Math.round((new Date(`${iso}T00:00:00`).getTime() - hoje.getTime()) / 864e5);
}

export default function ColetaIndicadores() {
  const token = useMemo(() => new URLSearchParams(window.location.search).get("c") ?? "", []);
  const [form, setForm] = useState<Formulario | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [ident, setIdent] = useState<Identificacao>(lerIdentGuardada);
  const [etapa, setEtapa] = useState<"ident" | "preencher">("ident");
  const [campos, setCampos] = useState<Record<string, Campos>>({});
  const [contratos, setContratos] = useState<ContratoGov[]>([]);
  const [contratosSujos, setContratosSujos] = useState(false);
  const [salvando, setSalvando] = useState<string | null>(null);
  const [aviso, setAviso] = useState<{ tipo: "ok" | "erro"; texto: string } | null>(null);
  const [mostrarErros, setMostrarErros] = useState(false);
  const topo = useRef<HTMLDivElement>(null);

  // campos a partir do que já está gravado
  const preencherCampos = useCallback((f: Formulario) => {
    const c: Record<string, Campos> = {};
    for (const l of f.lancamentos) {
      c[chave(l.indicador_id, l.tipo)] = {
        t1: numeroParaCampo(l.v1), t2: numeroParaCampo(l.v2), t3: numeroParaCampo(l.v3), comentario: l.comentario ?? "", arquivo: null,
      };
    }
    setCampos(c);
    setContratos(f.contratos.itens.map((x) => ({ ...x })));
    setContratosSujos(f.contratos.origem !== "competencia");
  }, []);

  const carregar = useCallback(async () => {
    if (!token) { setErro("Este endereço está incompleto. Use o link enviado no grupo."); setCarregando(false); return; }
    try {
      const f = await carregarFormulario(token);
      setForm(f);
      preencherCampos(f);
      setErro(null);
    } catch (e) {
      setErro(e instanceof Error ? e.message : String(e));
    } finally {
      setCarregando(false);
    }
  }, [token, preencherCampos]);

  useEffect(() => { void carregar(); }, [carregar]);

  // fora dos buscadores
  useEffect(() => {
    const antes = document.title;
    document.title = "Indicadores de Desempenho · GAP-MN";
    const m = document.createElement("meta");
    m.name = "robots"; m.content = "noindex, nofollow";
    document.head.appendChild(m);
    return () => { document.title = antes; m.remove(); };
  }, []);

  const indicadores = useMemo(() => (form?.indicadores ?? []).filter((i) => i.divisao === ident.divisao), [form, ident.divisao]);
  const lancado = useMemo(() => new Map((form?.lancamentos ?? []).map((l) => [chave(l.indicador_id, l.tipo), l])), [form]);
  const anterior = useMemo(() => new Map((form?.anteriores ?? []).map((a) => [chave(a.indicador_id, a.tipo), a])), [form]);
  const aberta = form?.competencia.aberta ?? false;
  const ehDoc = ident.divisao === "DOC";

  // o que mudou em relação ao gravado
  const linhasDaDivisao = useMemo(() => indicadores.flatMap((i) => (i.planejado ? (["Planejado", "Realizado"] as const) : (["Realizado"] as const)).map((t) => ({ ind: i, tipo: t as TipoLancamento }))), [indicadores]);
  const estado = useMemo(() => linhasDaDivisao.map(({ ind, tipo }) => {
    const k = chave(ind.id, tipo);
    const c = campos[k] ?? VAZIO;
    const n1 = lerNumero(c.t1), n2 = lerNumero(c.t2), n3 = lerNumero(c.t3);
    const invalido = [n1, n2, n3].some((n) => n === undefined) || [n1, n2, n3].some((n) => typeof n === "number" && n < 0);
    const v = { v1: n1 ?? null, v2: n2 ?? null, v3: n3 ?? null };
    const g = lancado.get(k);
    const mudou = !!c.arquivo || (c.comentario.trim() || null) !== (g?.comentario ?? null)
      || v.v1 !== (g?.v1 ?? null) || v.v2 !== (g?.v2 ?? null) || v.v3 !== (g?.v3 ?? null);
    return { ind, tipo, k, c, v, invalido, mudou, previa: previaDoIndicador(ind, v), gravado: g };
  }), [linhasDaDivisao, campos, lancado]);

  const sujos = estado.filter((e) => e.mudou).length + (ehDoc && contratosSujos ? 1 : 0);
  const preenchidos = estado.filter((e) => (e.ind.calculo === "direto" ? e.v.v1 !== null : e.previa.valor !== null || e.previa.status === "Sem dados no mês de referência")).length;

  useEffect(() => {
    if (!sujos) return;
    const aviso = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ""; };
    window.addEventListener("beforeunload", aviso);
    return () => window.removeEventListener("beforeunload", aviso);
  }, [sujos]);

  const mudar = (k: string, p: Partial<Campos>) => setCampos((c) => ({ ...c, [k]: { ...(c[k] ?? VAZIO), ...p } }));

  const continuar = () => {
    if (!ident.posto || ident.nome.trim().length < 2 || !ident.divisao) { setMostrarErros(true); return; }
    try { localStorage.setItem(CHAVE_IDENT, JSON.stringify({ ...ident, nome: ident.nome.trim() })); } catch { /* sem armazenamento */ }
    setEtapa("preencher");
    setAviso(null);
    topo.current?.scrollIntoView({ behavior: "smooth" });
  };

  async function salvar() {
    if (!form) return;
    const invalidos = estado.filter((e) => e.invalido);
    if (invalidos.length) {
      setAviso({ tipo: "erro", texto: `Corrija ${invalidos.length === 1 ? "o valor" : `${invalidos.length} valores`} em vermelho: só números, sem letras e sem negativos.` });
      document.getElementById(`ind-${invalidos[0].k}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }
    const mudados = estado.filter((e) => e.mudou);
    if (!mudados.length && !(ehDoc && contratosSujos)) { setAviso({ tipo: "ok", texto: "Nada para salvar: está tudo como foi gravado." }); return; }
    setAviso(null);
    try {
      const itens: ItemParaSalvar[] = [];
      let n = 0;
      const comArquivo = mudados.filter((e) => e.c.arquivo).length;
      for (const e of mudados) {
        let anexo: { caminho: string; nome: string } | null = null;
        if (e.c.arquivo) {
          n++;
          setSalvando(`Enviando comprovante ${n} de ${comArquivo}…`);
          anexo = await enviarAnexo(token, e.c.arquivo);
        }
        itens.push({
          indicador_id: e.ind.id, tipo: e.tipo, ...e.v, comentario: e.c.comentario.trim() || null,
          ...(anexo ? { anexo: anexo.caminho, anexo_nome: anexo.nome } : {}),
        });
      }
      setSalvando("Salvando…");
      const r = await salvarDivisao(token, { ...ident, nome: ident.nome.trim() }, itens, ehDoc && contratosSujos ? contratos : null);
      const f = await carregarFormulario(token);
      setForm(f);
      preencherCampos(f);
      const partes = [r.indicadores ? `${r.indicadores} indicador${r.indicadores > 1 ? "es" : ""}` : "", r.contratos ? `${r.contratos} contratos/atas` : ""].filter(Boolean);
      setAviso({ tipo: "ok", texto: `Salvo às ${new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}${partes.length ? ` (${partes.join(" e ")})` : ""}. Dá para voltar e corrigir até o fim da coleta.` });
    } catch (e) {
      setAviso({ tipo: "erro", texto: e instanceof Error ? e.message : String(e) });
    } finally {
      setSalvando(null);
    }
  }

  // ── telas de estado ─────────────────────────────────────────────────────────
  if (carregando) return <Moldura><div className="ci-cartao ci-centro">Carregando o formulário…</div></Moldura>;
  if (erro || !form) {
    return (
      <Moldura>
        <div className="ci-cartao ci-centro" role="alert">
          <p className="ci-titulo-erro">Não foi possível abrir o formulário</p>
          <p>{erro}</p>
          {token && <button type="button" className="ci-btn" onClick={() => { setCarregando(true); void carregar(); }}>Tentar de novo</button>}
        </div>
      </Moldura>
    );
  }

  const comp = form.competencia;
  const secoes = new Map<string, typeof estado>();
  for (const e of estado) {
    const s = nomeSecao(e.ind.categoria);
    if (!secoes.has(s)) secoes.set(s, []);
    secoes.get(s)!.push(e);
  }

  return (
    <Moldura refTopo={topo}>
      <section className="ci-cartao ci-cabecalho">
        <div className="ci-competencia">
          Dados de <b>{competenciaExtenso(comp.codigo, comp.rotulo)}</b>
          <span className="ci-selo-comp">{comp.rotulo}</span>
        </div>
        <p className="ci-sub">
          Informe os números do mês de referência (o mês anterior ao da prestação de contas).
          {comp.prazo && <> Prazo: <b>{dataBR(comp.prazo)}</b>.</>}
        </p>
        {!aberta && <div className="ci-faixa ci-faixa-erro" role="status">A coleta deste mês foi encerrada. Os dados abaixo estão só para consulta.</div>}
      </section>

      {etapa === "ident" ? (
        <section className="ci-cartao" aria-labelledby="ci-ident-tit">
          <h2 id="ci-ident-tit" className="ci-h2">Identificação</h2>
          <p className="ci-sub">Quem preenche fica registrado em cada indicador.</p>
          <div className="ci-grade-ident">
            <label className="ci-campo">
              <span>Posto ou graduação</span>
              <select value={ident.posto} onChange={(e) => setIdent((i) => ({ ...i, posto: e.target.value }))} aria-invalid={mostrarErros && !ident.posto}>
                <option value="">Escolha…</option>
                {POSTOS.map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
            </label>
            <label className="ci-campo">
              <span>Nome de guerra</span>
              <input value={ident.nome} maxLength={40} autoComplete="off" onChange={(e) => setIdent((i) => ({ ...i, nome: e.target.value }))}
                aria-invalid={mostrarErros && ident.nome.trim().length < 2} />
            </label>
            <label className="ci-campo ci-campo-largo">
              <span>Divisão ou assessoria</span>
              <select value={ident.divisao} onChange={(e) => setIdent((i) => ({ ...i, divisao: e.target.value }))} aria-invalid={mostrarErros && !ident.divisao}>
                <option value="">Escolha…</option>
                {DIVISOES.map((d) => <option key={d.sigla} value={d.sigla}>{d.sigla} — {d.nome}</option>)}
              </select>
            </label>
          </div>
          {mostrarErros && (!ident.posto || ident.nome.trim().length < 2 || !ident.divisao) && (
            <p className="ci-erro-texto" role="alert">Preencha posto ou graduação, nome de guerra e divisão.</p>
          )}
          <button type="button" className="ci-btn ci-btn-primario" onClick={continuar}>Continuar</button>
        </section>
      ) : (
        <>
          <section className="ci-cartao ci-quem">
            <div>
              <b>{ident.posto} {ident.nome.trim().toUpperCase()}</b> · {ident.divisao} — {nomeDivisao(ident.divisao)}
            </div>
            <button type="button" className="ci-btn ci-btn-texto" onClick={() => setEtapa("ident")}>trocar</button>
          </section>

          {[...secoes].map(([secao, itens]) => (
            <section key={secao} className="ci-secao" aria-label={secao}>
              <h2 className="ci-h2 ci-secao-tit">{secao}</h2>
              {itens.every((e) => e.ind.direcao === "Monitoramento" && e.ind.calculo === "direto")
                ? <Contagens itens={itens} aberta={aberta} mudar={mudar} anterior={anterior} />
                : itens.map((e) => (
                  <CartaoIndicador key={e.k} e={e} aberta={aberta} mudar={mudar} anterior={anterior.get(e.k) ?? null} />
                ))}
            </section>
          ))}

          {ehDoc && (
            <Contratos itens={contratos} origem={form.contratos} aberta={aberta}
              aoMudar={(c) => { setContratos(c); setContratosSujos(true); }} />
          )}

          <div className="ci-rodape-espaco" />
          <div className="ci-barra" role="region" aria-label="Salvar">
            <div className="ci-barra-info">
              <b>{preenchidos} de {estado.length}</b> preenchidos
              {sujos > 0 && <span className="ci-sujo"> · {sujos} alteraç{sujos > 1 ? "ões" : "ão"} não salva{sujos > 1 ? "s" : ""}</span>}
            </div>
            {aviso && <div className={`ci-barra-aviso ci-${aviso.tipo}`} role={aviso.tipo === "erro" ? "alert" : "status"}>{aviso.texto}</div>}
            <button type="button" className="ci-btn ci-btn-primario" onClick={() => void salvar()} disabled={!aberta || !!salvando}>
              {salvando ?? "Salvar"}
            </button>
          </div>
        </>
      )}
    </Moldura>
  );
}

function Moldura({ children, refTopo }: { children: React.ReactNode; refTopo?: React.Ref<HTMLDivElement> }) {
  return (
    <div className="ci" ref={refTopo}>
      <header className="ci-topo">
        <img src="/om/gapmn-brasao.png" alt="" className="ci-brasao" />
        <div>
          <h1 className="ci-h1">Indicadores de Desempenho</h1>
          <div className="ci-sub">Grupamento de Apoio de Manaus · coleta mensal para a prestação de contas</div>
        </div>
      </header>
      <main className="ci-corpo">{children}</main>
    </div>
  );
}

type Estado = {
  ind: IndicadorGov; tipo: TipoLancamento; k: string; c: Campos; v: { v1: number | null; v2: number | null; v3: number | null };
  invalido: boolean; mudou: boolean; previa: ReturnType<typeof previaDoIndicador>;
  gravado?: { posto: string | null; nome_guerra: string | null; atualizado_em: string; versao: number; anexo_nome: string | null; tem_anexo: boolean };
};

function CampoNumero({ rotulo, valor, aoMudar, desabilitado, id }: { rotulo: string; valor: string; aoMudar: (v: string) => void; desabilitado: boolean; id: string }) {
  const n = lerNumero(valor);
  const ruim = n === undefined || (typeof n === "number" && n < 0);
  return (
    <label className="ci-campo ci-campo-num" htmlFor={id}>
      <span>{rotulo}</span>
      <input id={id} value={valor} inputMode="decimal" autoComplete="off" disabled={desabilitado} aria-invalid={ruim}
        onChange={(e) => aoMudar(e.target.value)} placeholder="0" />
      {ruim && <small className="ci-erro-texto">Só números (ex.: 12,5)</small>}
    </label>
  );
}

function SeloStatus({ status }: { status: Status }) {
  const s = STATUS_VISUAL[status];
  if (!s) return null;
  return <span className={`ci-selo ci-selo-${s.classe}`}>{s.rotulo}</span>;
}

function CartaoIndicador({ e, aberta, mudar, anterior }: {
  e: Estado; aberta: boolean; mudar: (k: string, p: Partial<Campos>) => void;
  anterior: { rotulo: string | null; competencia: string; valor: number | null } | null;
}) {
  const { ind, c, previa, gravado } = e;
  const n = quantasVariaveis(ind.calculo);
  const textos = [c.t1, c.t2, c.t3];
  const temMeta = ind.direcao !== "Monitoramento" && ind.meta_num !== null;
  const justificar = temMeta && pedeJustificativa(previa.status);
  const [abrirComentario, setAbrirComentario] = useState(false);
  const [erroArquivo, setErroArquivo] = useState<string | null>(null);
  const idBase = `ind-${e.k}`.replace(/[^a-zA-Z0-9-]/g, "-");
  return (
    <article id={`ind-${e.k}`} className={`ci-cartao ci-ind${e.mudou ? " ci-ind-sujo" : ""}`} aria-labelledby={`${idBase}-tit`}>
      <header className="ci-ind-cab">
        <div>
          <div className="ci-ind-num">Nº {ind.id}{ind.planejado ? ` · ${e.tipo}` : ""}</div>
          <h3 id={`${idBase}-tit`} className="ci-ind-tit">{ind.indicador}</h3>
          {ind.formula && ind.calculo !== "direto" && <div className="ci-formula">{ind.formula}</div>}
        </div>
        {temMeta && <div className="ci-meta">meta <b>{metaExibida(ind.meta_txt, ind.meta_num, ind.unidade, ind.direcao)}</b></div>}
      </header>

      <div className="ci-vars">
        {Array.from({ length: n }, (_, i) => (
          <CampoNumero key={i} id={`${idBase}-v${i + 1}`}
            rotulo={ind.calculo === "direto" ? `Valor no mês (${ind.unidade.toLowerCase()})` : ind.variaveis[i] ?? `Variável ${i + 1}`}
            valor={textos[i]} desabilitado={!aberta}
            aoMudar={(v) => mudar(e.k, i === 0 ? { t1: v } : i === 1 ? { t2: v } : { t3: v })} />
        ))}
      </div>

      <div className="ci-resultado" aria-live="polite">
        {ind.calculo !== "direto" && (
          <span>Resultado: <b>{previa.valor === null ? "—" : fmtValor(previa.valor, ind.unidade)}</b></span>
        )}
        {temMeta && previa.tocado && <SeloStatus status={previa.status} />}
        {anterior && anterior.valor !== null && (
          <span className="ci-anterior">último informado ({anterior.rotulo ?? anterior.competencia}): {fmtValor(anterior.valor, ind.unidade)}</span>
        )}
      </div>

      {(justificar || abrirComentario || c.comentario) ? (
        <label className="ci-campo ci-comentario">
          <span>{justificar ? "Justificativa do resultado (recomendado em Atenção e Crítico)" : "Comentário"}</span>
          <textarea value={c.comentario} maxLength={2000} rows={3} disabled={!aberta}
            placeholder={justificar ? "O que levou a esse resultado e o que está sendo feito." : ""}
            onChange={(ev) => mudar(e.k, { comentario: ev.target.value })} />
        </label>
      ) : (
        aberta && <button type="button" className="ci-btn ci-btn-texto" onClick={() => setAbrirComentario(true)}>+ comentário</button>
      )}

      <div className="ci-anexo">
        {gravado?.tem_anexo && !c.arquivo && <span className="ci-anexo-ok">📎 Comprovante enviado{gravado.anexo_nome ? `: ${gravado.anexo_nome}` : ""}</span>}
        {c.arquivo && <span className="ci-anexo-novo">📎 {c.arquivo.name} (será enviado ao salvar)</span>}
        {aberta && (
          <label className="ci-btn ci-btn-texto ci-anexo-btn">
            {gravado?.tem_anexo || c.arquivo ? "trocar comprovante" : "📎 anexar comprovante (opcional)"}
            <input type="file" accept="image/png,image/jpeg,image/webp,application/pdf" className="ci-oculto"
              onChange={(ev) => {
                const f = ev.target.files?.[0] ?? null;
                ev.target.value = "";
                if (!f) return;
                const p = problemaDoAnexo(f);
                setErroArquivo(p);
                if (!p) mudar(e.k, { arquivo: f });
              }} />
          </label>
        )}
        {erroArquivo && <span className="ci-erro-texto">{erroArquivo}</span>}
      </div>

      {gravado && (gravado.posto || gravado.nome_guerra) && (
        <div className="ci-quem-lancou">
          lançado por {gravado.posto} {gravado.nome_guerra} em {dataHora(gravado.atualizado_em)}
          {gravado.versao > 1 ? ` · ${gravado.versao - 1} alteraç${gravado.versao > 2 ? "ões" : "ão"}` : ""}
        </div>
      )}
    </article>
  );
}

/** Grupos de contagem (pendências do e-Pessoal, PCA, ressarcimento): uma linha por item. */
function Contagens({ itens, aberta, mudar, anterior }: {
  itens: Estado[]; aberta: boolean; mudar: (k: string, p: Partial<Campos>) => void;
  anterior: Map<string, { rotulo: string | null; valor: number | null }>;
}) {
  const ids = [...new Set(itens.map((e) => e.ind.id))];
  const planejado = itens.some((e) => e.tipo === "Planejado");
  return (
    <div className="ci-cartao ci-contagens">
      <p className="ci-sub">Informe a quantidade de cada item no mês (0 quando não houver).</p>
      <div className={`ci-tab-contagem${planejado ? " ci-tab-2" : ""}`} role="table">
        <div className="ci-tab-cab" role="row">
          <span role="columnheader">Item</span>
          {planejado && <span role="columnheader">Planejado</span>}
          <span role="columnheader">{planejado ? "Realizado" : "Quantidade"}</span>
        </div>
        {ids.map((id) => {
          const linhas = itens.filter((e) => e.ind.id === id);
          const ind = linhas[0].ind;
          return (
            <div key={id} className="ci-tab-linha" role="row">
              <span role="cell" className="ci-tab-item">
                <small>Nº {id}</small> {ind.indicador}
                {(() => {
                  const a = anterior.get(chave(id, "Realizado"));
                  return a && a.valor !== null ? <small className="ci-anterior"> · último ({a.rotulo}): {a.valor}</small> : null;
                })()}
              </span>
              {(planejado ? (["Planejado", "Realizado"] as const) : (["Realizado"] as const)).map((t) => {
                const e = linhas.find((x) => x.tipo === t);
                if (!e) return <span key={t} role="cell" />;
                const ruim = e.invalido;
                return (
                  <span key={t} role="cell">
                    <input aria-label={`${ind.indicador} — ${t}`} value={e.c.t1} inputMode="numeric" disabled={!aberta} aria-invalid={ruim}
                      className={e.mudou ? "ci-sujo-campo" : undefined} onChange={(ev) => mudar(e.k, { t1: ev.target.value })} placeholder="0" />
                  </span>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}

const STATUS_CONTRATO: StatusContrato[] = ["Seguro", "Atenção", "Crítico"];

function Contratos({ itens, origem, aberta, aoMudar }: {
  itens: ContratoGov[]; origem: Formulario["contratos"]; aberta: boolean; aoMudar: (c: ContratoGov[]) => void;
}) {
  const mudar = (i: number, p: Partial<ContratoGov>) => aoMudar(itens.map((c, j) => (j === i ? { ...c, ...p } : c)));
  const contagem = STATUS_CONTRATO.map((s) => [s, itens.filter((c) => c.status === s).length] as const);
  return (
    <section className="ci-secao" aria-labelledby="ci-ctr-tit">
      <h2 id="ci-ctr-tit" className="ci-h2 ci-secao-tit">Contratos e atas essenciais</h2>
      <div className="ci-cartao">
        <p className="ci-sub">
          {origem.origem === "anterior"
            ? <>Trouxemos a situação informada em <b>{origem.de ? competenciaExtenso(origem.de) : "mês anterior"}</b>. Atualize o que mudou e salve.</>
            : origem.origem === "padrao"
              ? <>Informe a situação de cada serviço essencial. Dá para incluir outros no fim da lista.</>
              : <>Situação já informada neste mês. Altere o que precisar e salve.</>}
        </p>
        <div className="ci-ctr-resumo">
          {contagem.map(([s, n]) => <span key={s} className={`ci-selo ci-selo-${s === "Seguro" ? "ok" : s === "Atenção" ? "atencao" : "critico"}`}>{s}: {n}</span>)}
        </div>
      </div>
      {itens.map((c, i) => {
        const dias = diasAte(c.termino);
        return (
          <article key={i} className="ci-cartao ci-ctr">
            <div className="ci-ctr-cab">
              {c.padrao
                ? <h3 className="ci-ind-tit">{c.servico}</h3>
                : <label className="ci-campo ci-campo-largo"><span>Serviço ou objeto</span>
                    <input value={c.servico} maxLength={200} disabled={!aberta} onChange={(e) => mudar(i, { servico: e.target.value })} /></label>}
              {!c.padrao && aberta && (
                <button type="button" className="ci-btn ci-btn-texto ci-remover" onClick={() => aoMudar(itens.filter((_, j) => j !== i))}>remover</button>
              )}
            </div>
            <div className="ci-ctr-grade">
              <label className="ci-campo"><span>NUP</span>
                <input value={c.nup ?? ""} maxLength={40} disabled={!aberta} placeholder="67298.000000/2026-00" onChange={(e) => mudar(i, { nup: e.target.value || null })} /></label>
              <label className="ci-campo"><span>Término da vigência (contrato ou ata)</span>
                <input type="date" value={c.termino ?? ""} disabled={!aberta} onChange={(e) => mudar(i, { termino: e.target.value || null })} />
                {dias !== null && (
                  <small className={dias < 0 ? "ci-erro-texto" : dias <= 90 ? "ci-alerta-texto" : "ci-sub"}>
                    {dias < 0 ? `venceu há ${-dias} dia${dias === -1 ? "" : "s"}` : dias === 0 ? "vence hoje" : `vence em ${dias} dia${dias === 1 ? "" : "s"}`}
                  </small>
                )}
              </label>
              <label className="ci-campo"><span>Situação (risco)</span>
                <select value={c.status ?? ""} disabled={!aberta} className={c.status ? `ci-sel-${c.status === "Seguro" ? "ok" : c.status === "Atenção" ? "atencao" : "critico"}` : undefined}
                  onChange={(e) => mudar(i, { status: (e.target.value || null) as StatusContrato | null })}>
                  <option value="">—</option>
                  {STATUS_CONTRATO.map((s) => <option key={s} value={s}>{s}</option>)}
                </select></label>
            </div>
            <label className="ci-campo ci-comentario"><span>Providências da Administração (mitigação do risco)</span>
              <textarea value={c.providencias ?? ""} rows={2} maxLength={2000} disabled={!aberta} onChange={(e) => mudar(i, { providencias: e.target.value || null })} /></label>
          </article>
        );
      })}
      {aberta && (
        <button type="button" className="ci-btn" onClick={() => aoMudar([...itens, { id: null, ordem: itens.length + 1, servico: "", nup: null, termino: null, status: null, providencias: null, padrao: false }])}>
          + Incluir contrato ou ata
        </button>
      )}
    </section>
  );
}

