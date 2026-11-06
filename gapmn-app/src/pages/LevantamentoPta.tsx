// Levantamento dos projetos e atividades do PTA — aberto por link, sem login (como a coleta mensal dos indicadores).
// Cada pessoa cadastra um projeto ou uma atividade por vez, num passo a passo com o exemplo da planilha em cada
// passo, e no fim pode cadastrar outro. Quem cadastrou é reconhecido pela chave pessoal deste navegador (ou pelo
// link pessoal) e pode editar ou excluir o que cadastrou. Tudo é gravado pelo banco, que confere o código do link.
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  CONTRATACAO, FREQUENCIA, MATRIZ_OPC, NATUREZA_NECESSIDADE, POSTOS, PRIORIDADE, SETORES, SIM_NAO, UNIDADE,
  avisosEtapa, avisosNecessidade, avisosTarefa, entregasPorTrimestre, etapaVazia, exemploAtividade, exemploNecessidade, exemploProjeto, jaExisteNaMatriz, lerReais,
  mesesDoAno, moeda, necessidadeVazia, nomeSetor, novoCadastro, pendencias, tarefaVazia, totalNecessidades, trimestreDe,
  type Cadastro, type CadastroAtividade, type CadastroNecessidade, type CadastroProjeto, type DadosAtividade, type DadosProjeto, type Etapa, type Necessidade, type TarefaRotina, type Tipo,
} from "../lib/ptaLevantamento/cadastro.ts";
import { COMO_FUNCIONA, FONTES, GUIA, LISTA_NECESSIDADES, PARA_QUE_SERVE, PROJETO_OU_ATIVIDADE } from "../lib/ptaLevantamento/guia.ts";
import { MATRIZ_PREVISTA } from "../lib/ptaLevantamento/matrizPrevista.ts";
import {
  carregarFormulario, chaveDoNavegador, excluirCadastro, linkPessoal, salvarCadastro, type Levantamento,
} from "../lib/ptaLevantamento/api.ts";
import "./coletaIndicadores.css";
import "./levantamentoPta.css";

const CHAVE_QUEM = "gapmn_pta_lev_quem_v1";
const CHAVE_RASCUNHO = "gapmn_pta_lev_rascunho_v1";

type Quem = { posto: string; nomeGuerra: string; setor: string; secao: string };
type Rascunho = { cad: Cadastro; passo: number; em: string };
type Tela =
  | { qual: "inicio" }
  | { qual: "editor"; cad: Cadastro; passo: number; original: string; soLeitura: boolean }
  | { qual: "enviado"; cad: Cadastro; novo: boolean };

const PASSOS: Record<Tipo, string[]> = {
  projeto: ["Quem preenche", "O projeto", "Prazo e responsável", "Dinheiro e prioridade", "Etapas", "Revisão e envio"],
  atividade: ["Quem preenche", "A atividade", "Como acompanhar", "Responsável e dinheiro", "Tarefas", "Revisão e envio"],
  necessidade: ["Quem preenche", "Necessidades", "Revisão e envio"],
};

function lerJson<T>(chave: string): T | null {
  try { return JSON.parse(localStorage.getItem(chave) ?? "null") as T | null; } catch { return null; }
}
function gravarJson(chave: string, valor: unknown) {
  try { if (valor === null) localStorage.removeItem(chave); else localStorage.setItem(chave, JSON.stringify(valor)); } catch { /* sem armazenamento */ }
}

const dataHora = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleString("pt-BR", { timeZone: "America/Manaus", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "";
const dataBR = (iso: string | null | undefined) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : "");
const DIAS = ["domingo", "segunda-feira", "terça-feira", "quarta-feira", "quinta-feira", "sexta-feira", "sábado"];
const prazoExtenso = (iso: string) => `${dataBR(iso)} (${DIAS[new Date(`${iso}T12:00:00`).getDay()]})`;
const comArtigo = (t: Tipo) => (t === "projeto" ? "o projeto" : t === "atividade" ? "a atividade" : "a lista de necessidades");

// ── campos que cada passo pede ───────────────────────────────────────────────
// Só a identificação, a divisão e o nome são exigidos para enviar (o banco precisa deles); na lista de
// necessidades, a seção e pelo menos um item. O resto é aviso: a pessoa pode avançar e completar depois.
const ESSENCIAIS = ["posto", "nomeGuerra", "setor", "nome", "secao", "necessidades"];

function faltasDoPasso(c: Cadastro, passo: number): string[] {
  const f: string[] = [];
  const v = (s: string | null | undefined) => !s || !s.trim();
  if (passo === 0) {
    if (v(c.posto)) f.push("posto");
    if (v(c.nomeGuerra) || c.nomeGuerra.trim().length < 2) f.push("nomeGuerra");
    if (v(c.setor)) f.push("setor");
    if (c.tipo === "necessidade" && v(c.secao)) f.push("secao");
  }
  if (c.tipo === "necessidade") {
    if (passo === 1) {
      if (!c.etapas.some((n) => !v(n.descricao))) f.push("necessidades");
      else if (c.etapas.some((n) => avisosNecessidade(n).length)) f.push("itensAviso");
    }
    return f;
  }
  if (c.tipo === "projeto") {
    const d = c.dados;
    if (passo === 1) {
      if (v(c.nome) || c.nome.trim().length < 3) f.push("nome");
      if (v(d.entrega)) f.push("entrega");
      if (v(d.porque)) f.push("porque");
    }
    if (passo === 2) {
      if (v(d.inicio)) f.push("inicio");
      if (v(d.termino)) f.push("termino");
      if (v(d.responsavel)) f.push("responsavel");
    }
    if (passo === 3) {
      if (v(d.precisaDinheiro)) f.push("precisaDinheiro");
      if (d.precisaDinheiro === "Sim") {
        if (d.valor === null || d.valor <= 0) f.push("valor");
        if (v(d.compra)) f.push("compra");
        if (v(d.contratacao)) f.push("contratacao");
      }
      if (v(d.prioridade)) f.push("prioridade");
    }
    if (passo === 4) {
      if (!c.etapas.some((e) => e.tipo === "Tarefa")) f.push("tarefas");
      if (!c.etapas.some((e) => e.tipo === "Marco")) f.push("marcos");
      if (c.etapas.some((e) => avisosEtapa(e, d).length)) f.push("etapasAviso");
    }
  } else {
    const d = c.dados;
    if (passo === 1) {
      if (v(c.nome) || c.nome.trim().length < 3) f.push("nome");
      if (v(d.oQueE)) f.push("oQueE");
    }
    if (passo === 2) {
      if (v(d.itemControle)) f.push("itemControle");
      if (v(d.indicador)) f.push("indicador");
      if (v(d.calculo)) f.push("calculo");
      if (v(d.meta)) f.push("meta");
    }
    if (passo === 3) {
      if (v(d.responsavel)) f.push("responsavel");
      if (v(d.precisaDinheiro)) f.push("precisaDinheiro");
      if (d.precisaDinheiro === "Sim") {
        if (d.valor === null || d.valor <= 0) f.push("valor");
        if (v(d.compra)) f.push("compra");
      }
    }
    if (passo === 4) {
      if (!c.etapas.length) f.push("tarefas");
      if (c.etapas.some((t) => avisosTarefa(t).length)) f.push("etapasAviso");
    }
  }
  return f;
}

const ROTULO_FALTA: Record<string, string> = {
  posto: "posto ou graduação", nomeGuerra: "nome de guerra", setor: "divisão ou assessoria", nome: "nome",
  entrega: "o que vai ficar pronto", porque: "por que é necessário", inicio: "mês de início", termino: "mês de término",
  responsavel: "responsável pelo acompanhamento", precisaDinheiro: "se precisa de dinheiro", valor: "valor estimado",
  compra: "o que será comprado ou contratado", contratacao: "situação da contratação", prioridade: "prioridade",
  tarefas: "pelo menos uma tarefa", marcos: "pelo menos um marco", etapasAviso: "avisos nas etapas",
  oQueE: "o que é feito", itemControle: "item de controle", indicador: "nome do indicador", calculo: "como calcular", meta: "meta",
  secao: "seção", necessidades: "pelo menos uma necessidade", itensAviso: "avisos nas necessidades",
};

// ── página ───────────────────────────────────────────────────────────────────

export default function LevantamentoPta() {
  const params = useMemo(() => new URLSearchParams(window.location.search), []);
  const token = params.get("c") ?? "";
  const [{ chave, guardada }] = useState(() => chaveDoNavegador(params.get("k")));
  const [lev, setLev] = useState<Levantamento | null>(null);
  const [meus, setMeus] = useState<Cadastro[]>([]);
  const [erro, setErro] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [tela, setTela] = useState<Tela>({ qual: "inicio" });
  const [rascunho, setRascunho] = useState<Rascunho | null>(() => lerJson<Rascunho>(CHAVE_RASCUNHO));
  const [enviando, setEnviando] = useState(false);
  const [erroEnvio, setErroEnvio] = useState<string | null>(null);
  const topo = useRef<HTMLDivElement>(null);

  // o link pessoal (?k=) não fica na barra de endereço: a chave já está guardada neste navegador
  useEffect(() => {
    if (params.get("k") && guardada) window.history.replaceState(null, "", `${window.location.pathname}?c=${encodeURIComponent(token)}`);
  }, [params, guardada, token]);

  const carregar = useCallback(async () => {
    if (!token) { setErro("Este endereço está incompleto. Use o link enviado pela APLG."); setCarregando(false); return; }
    try {
      const r = await carregarFormulario(token, chave);
      setLev(r.levantamento);
      setMeus(r.meus);
      setErro(null);
    } catch (e) {
      setErro(e instanceof Error ? e.message : String(e));
    } finally {
      setCarregando(false);
    }
  }, [token, chave]);
  useEffect(() => { void carregar(); }, [carregar]);

  // fora dos buscadores
  useEffect(() => {
    const antes = document.title;
    document.title = "Levantamento do PTA · GAP-MN";
    const m = document.createElement("meta");
    m.name = "robots"; m.content = "noindex, nofollow";
    document.head.appendChild(m);
    return () => { document.title = antes; m.remove(); };
  }, []);

  // rascunho: o que está sendo preenchido fica guardado neste navegador até ser enviado
  const editando = tela.qual === "editor" && !tela.soLeitura ? tela : null;
  const sujo = !!editando && JSON.stringify(editando.cad) !== editando.original;
  useEffect(() => {
    if (!editando || !sujo) return;
    const r: Rascunho = { cad: editando.cad, passo: editando.passo, em: new Date().toISOString() };
    gravarJson(CHAVE_RASCUNHO, r);
    setRascunho(r);
  }, [editando, sujo]);
  useEffect(() => {
    if (!sujo) return;
    const aviso = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ""; };
    window.addEventListener("beforeunload", aviso);
    return () => window.removeEventListener("beforeunload", aviso);
  }, [sujo]);

  const subir = () => topo.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  const ano = lev?.ano ?? new Date().getFullYear() + 1;
  const aberta = lev?.aberta ?? false;

  const comecar = (tipo: Tipo) => {
    const q = lerJson<Quem>(CHAVE_QUEM) ?? undefined;
    const cad = novoCadastro(tipo, q);
    setErroEnvio(null);
    setTela({ qual: "editor", cad, passo: q?.setor && q.posto && q.nomeGuerra ? 1 : 0, original: JSON.stringify(cad), soLeitura: false });
    subir();
  };
  const abrir = (c: Cadastro, soLeitura: boolean) => {
    setErroEnvio(null);
    setTela({ qual: "editor", cad: c, passo: soLeitura ? PASSOS[c.tipo].length - 1 : 1, original: JSON.stringify(c), soLeitura });
    subir();
  };
  const continuarRascunho = () => {
    if (!rascunho) return;
    setErroEnvio(null);
    const original = meus.find((m) => m.id && m.id === rascunho.cad.id);
    setTela({ qual: "editor", cad: rascunho.cad, passo: rascunho.passo, original: JSON.stringify(original ?? novoCadastro(rascunho.cad.tipo)), soLeitura: false });
    subir();
  };
  const descartarRascunho = () => { gravarJson(CHAVE_RASCUNHO, null); setRascunho(null); };
  const voltarAoInicio = () => { setTela({ qual: "inicio" }); subir(); };

  const enviar = async (cad: Cadastro) => {
    setEnviando(true);
    setErroEnvio(null);
    try {
      const salvo = await salvarCadastro(token, chave, cad);
      gravarJson(CHAVE_QUEM, { posto: cad.posto, nomeGuerra: cad.nomeGuerra.trim(), setor: cad.setor, secao: cad.secao.trim() } satisfies Quem);
      gravarJson(CHAVE_RASCUNHO, null);
      setRascunho(null);
      setMeus((m) => (cad.id ? m.map((x) => (x.id === salvo.id ? salvo : x)) : [...m, salvo]));
      setTela({ qual: "enviado", cad: salvo, novo: !cad.id });
      subir();
    } catch (e) {
      setErroEnvio(e instanceof Error ? e.message : String(e));
    } finally {
      setEnviando(false);
    }
  };

  const excluir = async (c: Cadastro) => {
    if (!c.id) return;
    await excluirCadastro(token, chave, c.id);
    setMeus((m) => m.filter((x) => x.id !== c.id));
    if (rascunho?.cad.id === c.id) descartarRascunho();
  };

  if (carregando) return <Moldura ano={null}><div className="ci-cartao ci-centro">Carregando o formulário…</div></Moldura>;
  if (erro || !lev) {
    return (
      <Moldura ano={null}>
        <div className="ci-cartao ci-centro" role="alert">
          <p className="ci-titulo-erro">Não foi possível abrir o formulário</p>
          <p className="ci-sub">{erro}</p>
          <button type="button" className="ci-btn" style={{ marginTop: 12 }} onClick={() => { setCarregando(true); void carregar(); }}>Tentar de novo</button>
        </div>
      </Moldura>
    );
  }

  return (
    <Moldura ano={ano} refTopo={topo}>
      {tela.qual === "inicio" && (
        <Inicio
          lev={lev} meus={meus} rascunho={rascunho} link={linkPessoal(window.location.origin, token, chave)} guardada={guardada}
          aoComecar={comecar} aoAbrir={abrir} aoExcluir={excluir} aoContinuar={continuarRascunho} aoDescartar={descartarRascunho}
        />
      )}
      {tela.qual === "editor" && (
        <Editor
          key={`${tela.cad.id ?? "novo"}-${tela.cad.tipo}`}
          cad={tela.cad} passo={tela.passo} ano={ano} soLeitura={tela.soLeitura || !aberta}
          enviando={enviando} erroEnvio={erroEnvio}
          aoMudar={(cad) => setTela((t) => (t.qual === "editor" ? { ...t, cad } : t))}
          aoIrPara={(passo) => { setTela((t) => (t.qual === "editor" ? { ...t, passo } : t)); subir(); }}
          aoEnviar={enviar} aoSair={voltarAoInicio}
        />
      )}
      {tela.qual === "enviado" && (
        <Enviado cad={tela.cad} novo={tela.novo} primeiro={meus.length === 1 && tela.novo}
          link={linkPessoal(window.location.origin, token, chave)} aoComecar={comecar} aoInicio={voltarAoInicio} aoEditar={() => abrir(tela.cad, false)} />
      )}
    </Moldura>
  );
}

function Moldura({ ano, children, refTopo }: { ano: number | null; children: React.ReactNode; refTopo?: React.Ref<HTMLDivElement> }) {
  return (
    <div className="ci" ref={refTopo}>
      <header className="ci-topo">
        <img src="/om/gapmn-brasao.png" alt="" className="ci-brasao" />
        <div>
          <h1 className="ci-h1">{ano ? `PTA ${ano} — Projetos e atividades` : "Levantamento do PTA"}</h1>
          <div className="ci-sub">Grupamento de Apoio de Manaus · levantamento da Assessoria de Planejamento e Governança</div>
        </div>
      </header>
      <main className="ci-corpo">{children}</main>
    </div>
  );
}

// ── início ───────────────────────────────────────────────────────────────────

function Inicio({ lev, meus, rascunho, link, guardada, aoComecar, aoAbrir, aoExcluir, aoContinuar, aoDescartar }: {
  lev: Levantamento; meus: Cadastro[]; rascunho: Rascunho | null; link: string; guardada: boolean;
  aoComecar: (t: Tipo) => void; aoAbrir: (c: Cadastro, soLeitura: boolean) => void; aoExcluir: (c: Cadastro) => Promise<void>;
  aoContinuar: () => void; aoDescartar: () => void;
}) {
  const [confirmar, setConfirmar] = useState<string | null>(null);
  const [erroExcluir, setErroExcluir] = useState<string | null>(null);
  const [excluindo, setExcluindo] = useState(false);
  const quem = lerJson<Quem>(CHAVE_QUEM);

  return (
    <>
      <section className="ci-cartao ci-cabecalho" aria-labelledby="pl-tit">
        <h2 id="pl-tit" className="ci-h2">Levantamento de projetos e atividades do PTA {lev.ano}</h2>
        <div className="pl-botoes" style={{ alignItems: "center", marginTop: 4 }}>
          {lev.aberta
            ? <span className="pl-status pl-status-aberto">Aberto{lev.prazo ? ` · envie até ${prazoExtenso(lev.prazo)}` : ""}</span>
            : <span className="pl-status pl-status-fechado">Encerrado</span>}
        </div>
        <p className="pl-p">{PARA_QUE_SERVE(lev.ano)}</p>
        <ul className="pl-lista">{COMO_FUNCIONA.map((t) => <li key={t}>{t}</li>)}</ul>
      </section>

      {lev.aberta && rascunho && (
        <div className="pl-faixa pl-faixa-info" role="status">
          <span>
            Você começou a {rascunho.cad.id ? "editar" : "cadastrar"} {comArtigo(rascunho.cad.tipo)}
            {rascunho.cad.tipo === "necessidade" ? null : <>{" "}<b>{rascunho.cad.nome.trim() || "sem nome"}</b></>} e não enviou ({dataHora(rascunho.em)}).
          </span>
          <span className="pl-botoes">
            <button type="button" className="ci-btn ci-btn-primario" onClick={aoContinuar}>Continuar</button>
            <button type="button" className="ci-btn" onClick={aoDescartar}>Descartar</button>
          </span>
        </div>
      )}

      <section className="ci-cartao" aria-labelledby="pl-novo-tit">
        <h2 id="pl-novo-tit" className="ci-h2">O que você quer cadastrar?</h2>
        {!lev.aberta && <p className="ci-faixa ci-faixa-erro">O levantamento foi encerrado. Fale com a APLG se precisar incluir ou corrigir algo.</p>}
        <div className="pl-escolha">
          {(["projeto", "atividade"] as const).map((t, i) => (
            <button key={t} type="button" className="pl-opcao" disabled={!lev.aberta} onClick={() => aoComecar(t)}>
              <span className="pl-opcao-tit">{t === "projeto" ? "Um projeto" : "Uma atividade"}</span>
              <span className="pl-opcao-desc">{PROJETO_OU_ATIVIDADE[i].texto.split(" Exemplos:")[0]}</span>
              <span className="pl-opcao-ex">Exemplos: {PROJETO_OU_ATIVIDADE[i].texto.split(" Exemplos: ")[1]}</span>
              <span className="pl-opcao-acao">Cadastrar {t === "projeto" ? "projeto" : "atividade"} →</span>
            </button>
          ))}
          <button type="button" className="pl-opcao" disabled={!lev.aberta} onClick={() => aoComecar("necessidade")}>
            <span className="pl-opcao-tit">{LISTA_NECESSIDADES.rotulo}</span>
            <span className="pl-opcao-desc">{LISTA_NECESSIDADES.texto.split(" Exemplos:")[0]}</span>
            <span className="pl-opcao-ex">Exemplos: {LISTA_NECESSIDADES.texto.split(" Exemplos: ")[1]}</span>
            <span className="pl-opcao-acao">Cadastrar lista →</span>
          </button>
        </div>
        <p className="ci-sub" style={{ marginTop: 10 }}><b>Dica:</b> {PROJETO_OU_ATIVIDADE[2].texto}</p>
      </section>

      <section className="ci-cartao" aria-labelledby="pl-meus-tit">
        <h2 id="pl-meus-tit" className="ci-h2">Seus cadastros{meus.length ? ` (${meus.length})` : ""}</h2>
        {!meus.length ? (
          <p className="ci-sub">Nada cadastrado por você neste navegador ainda.{" "}
            Se você cadastrou em outro computador, abra o seu link pessoal para ver e editar.</p>
        ) : (
          <div className="pl-itens">
            {meus.map((c) => {
              const p = pendencias(c);
              return (
                <div key={c.id} className="pl-item">
                  <div>
                    <div className="pl-item-nome"><span className={`pl-tipo pl-tipo-${c.tipo}`}>{c.tipo === "necessidade" ? "necessidades" : c.tipo}</span>{c.nome}</div>
                    <div className="pl-item-meta">
                      {nomeSetor(c.setor)} · {p.length ? <span className="ci-alerta-texto">{p.length === 1 ? "1 pendência" : `${p.length} pendências`}</span> : <span style={{ color: "var(--ok)", fontWeight: 600 }}>completo</span>}
                      {c.atualizadoEm ? ` · salvo em ${dataHora(c.atualizadoEm)}` : ""}
                    </div>
                  </div>
                  <div className="pl-botoes">
                    {lev.aberta ? (
                      <>
                        <button type="button" className="ci-btn" onClick={() => aoAbrir(c, false)} aria-label={`Editar ${c.nome}`}>Editar</button>
                        <button type="button" className="ci-btn pl-btn-perigo" onClick={() => { setConfirmar(c.id); setErroExcluir(null); }} aria-label={`Excluir ${c.nome}`}>Excluir</button>
                      </>
                    ) : (
                      <button type="button" className="ci-btn" onClick={() => aoAbrir(c, true)}>Ver</button>
                    )}
                  </div>
                  {confirmar === c.id && (
                    <div className="pl-confirma" role="alert">
                      <span>Excluir {c.tipo === "necessidade" ? "a" : comArtigo(c.tipo)} <b>{c.nome}</b>? O cadastro sai do levantamento.</span>
                      <button type="button" className="ci-btn pl-btn-perigo-cheio" disabled={excluindo} onClick={async () => {
                        setExcluindo(true);
                        try { await aoExcluir(c); setConfirmar(null); } catch (e) { setErroExcluir(e instanceof Error ? e.message : String(e)); } finally { setExcluindo(false); }
                      }}>{excluindo ? "Excluindo…" : "Sim, excluir"}</button>
                      <button type="button" className="ci-btn" onClick={() => setConfirmar(null)}>Cancelar</button>
                      {erroExcluir && <span style={{ width: "100%" }}>{erroExcluir}</span>}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
        <LinkPessoal link={link} guardada={guardada} />
      </section>

      <JaPrevisto setorInicial={quem?.setor ?? ""} />
      <GuiaCompleto />

      <p className="ci-sub" style={{ textAlign: "center" }}>Dúvidas: fale com a Assessoria de Planejamento e Governança (APLG).</p>
    </>
  );
}

function LinkPessoal({ link, guardada }: { link: string; guardada: boolean }) {
  const [copiado, setCopiado] = useState(false);
  const campo = useRef<HTMLInputElement>(null);
  const copiar = async () => {
    try { await navigator.clipboard.writeText(link); } catch { campo.current?.select(); document.execCommand?.("copy"); }
    setCopiado(true);
    window.setTimeout(() => setCopiado(false), 2500);
  };
  return (
    <div className="pl-link">
      <span><b>Seu link pessoal.</b> Com ele você vê e edita os seus cadastros em qualquer computador. Guarde só para você: quem tiver este link também consegue editar.</span>
      {!guardada && <span className="ci-alerta-texto">Este navegador não guarda dados (janela anônima?). Copie o link pessoal antes de sair, senão não vai dar para editar depois.</span>}
      <div className="pl-link-linha">
        <input ref={campo} readOnly value={link} aria-label="Link pessoal" onFocus={(e) => e.currentTarget.select()} />
        <button type="button" className="ci-btn" onClick={copiar}>{copiado ? "Copiado!" : "Copiar"}</button>
      </div>
    </div>
  );
}

function JaPrevisto({ setorInicial }: { setorInicial: string }) {
  const [aberto, setAberto] = useState(false);
  const [setor, setSetor] = useState(setorInicial);
  const [busca, setBusca] = useState("");
  const grupos = useMemo(() => {
    const q = busca.trim().toLowerCase();
    const m = new Map<string, typeof MATRIZ_PREVISTA>();
    for (const t of MATRIZ_PREVISTA) {
      if (setor && t.setor !== setor) continue;
      if (q && !`${t.atividade} ${t.tarefa} ${t.executa}`.toLowerCase().includes(q)) continue;
      const k = `${t.setor}|${t.atividade}`;
      m.set(k, [...(m.get(k) ?? []), t]);
    }
    return [...m.entries()];
  }, [setor, busca]);
  const total = grupos.reduce((s, [, l]) => s + l.length, 0);
  return (
    <section className="ci-cartao" aria-labelledby="pl-prev-tit">
      <div className="ci-ctr-cab">
        <div>
          <h2 id="pl-prev-tit" className="ci-h2">Já previsto pela DIRAD</h2>
          <p className="ci-sub">Rotinas que a DIRAD já colocou no PTA de todos os GAP (Matriz de Atividades e Tarefas Comuns). Elas já entram no PTA: não precisa cadastrar.</p>
        </div>
        <button type="button" className="ci-btn ci-btn-texto pl-nowrap" aria-expanded={aberto} onClick={() => setAberto((a) => !a)}>{aberto ? "esconder" : "ver a lista"}</button>
      </div>
      {aberto && (
        <>
          <div className="pl-matriz-filtros">
            <label className="ci-campo"><span>Divisão ou assessoria</span>
              <select value={setor} onChange={(e) => setSetor(e.target.value)}>
                <option value="">Todas</option>
                {SETORES.map((s) => <option key={s.sigla} value={s.sigla}>{s.nome} ({s.sigla})</option>)}
              </select>
            </label>
            <label className="ci-campo"><span>Procurar</span>
              <input type="search" value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Ex.: almoxarifado, pagamento, inventário" />
            </label>
          </div>
          <p className="ci-sub" style={{ marginTop: 8 }}>{total ? `${total} tarefa(s) em ${grupos.length} rotina(s).` : "Nenhuma rotina da Matriz para este filtro: o que o setor fizer de rotina pode ser cadastrado como atividade."}</p>
          {grupos.map(([k, lista]) => (
            <details key={k} className="pl-matriz-grupo">
              <summary>{lista[0].atividade} <small>· {lista[0].setor} · {lista.length} tarefa(s)</small></summary>
              <ul>
                {lista.map((t) => (
                  <li key={t.codigo + t.tarefa}>{t.tarefa}
                    <span className="pl-matriz-meta">{[t.frequencia, t.prazo, t.executa].filter(Boolean).join(" · ")}</span>
                  </li>
                ))}
              </ul>
            </details>
          ))}
        </>
      )}
    </section>
  );
}

function GuiaCompleto() {
  const [aberto, setAberto] = useState(false);
  return (
    <section className="ci-cartao" aria-labelledby="pl-guia-tit">
      <div className="ci-ctr-cab">
        <h2 id="pl-guia-tit" className="ci-h2">Guia completo de preenchimento</h2>
        <button type="button" className="ci-btn ci-btn-texto pl-nowrap" aria-expanded={aberto} onClick={() => setAberto((a) => !a)}>{aberto ? "esconder" : "mostrar"}</button>
      </div>
      {aberto && (
        <>
          {GUIA.map((s) => (
            <div key={s.titulo} style={{ marginTop: 12 }}>
              <h3 className="ci-h2" style={{ fontSize: 15 }}>{s.titulo}</h3>
              <ul className="pl-lista">
                {s.itens.map((i) => <li key={i.texto}>{i.rotulo && <b>{i.rotulo}: </b>}{i.texto}</li>)}
              </ul>
            </div>
          ))}
          <p className="ci-sub" style={{ marginTop: 12 }}>{FONTES}</p>
        </>
      )}
    </section>
  );
}

// ── passo a passo ────────────────────────────────────────────────────────────

type PropsEditor = {
  cad: Cadastro; passo: number; ano: number; soLeitura: boolean; enviando: boolean; erroEnvio: string | null;
  aoMudar: (c: Cadastro) => void; aoIrPara: (p: number) => void; aoEnviar: (c: Cadastro) => void; aoSair: () => void;
};

function Editor({ cad, passo, ano, soLeitura, enviando, erroEnvio, aoMudar, aoIrPara, aoEnviar, aoSair }: PropsEditor) {
  const passos = PASSOS[cad.tipo];
  const [visitados, setVisitados] = useState<Set<number>>(() => new Set(cad.id ? passos.map((_, i) => i) : [0, passo]));
  const [mostrarFaltas, setMostrarFaltas] = useState(false);
  const faltas = useMemo(() => new Set(faltasDoPasso(cad, passo)), [cad, passo]);
  const inv = (campo: string) => mostrarFaltas && faltas.has(campo);
  const ultimo = passos.length - 1;

  const ir = (p: number) => {
    setVisitados((v) => new Set(v).add(p));
    setMostrarFaltas(false);
    aoIrPara(p);
  };
  const avancar = (mesmoAssim = false) => {
    const bloqueia = [...faltas].filter((f) => ESSENCIAIS.includes(f));
    if ((faltas.size && !mesmoAssim) || bloqueia.length) { setMostrarFaltas(true); return; }
    ir(passo + 1);
  };

  const mudarBase = (p: Partial<Cadastro>) => aoMudar({ ...cad, ...p } as Cadastro);
  const mudarDados = (p: Partial<DadosProjeto> | Partial<DadosAtividade>) => aoMudar({ ...cad, dados: { ...cad.dados, ...p } } as Cadastro);

  const nomeTipo = cad.tipo === "necessidade" ? "necessidades" : cad.tipo;
  const novo = cad.tipo === "projeto" ? "Novo projeto" : cad.tipo === "atividade" ? "Novo cadastro de atividade" : "Nova lista de necessidades";
  return (
    <>
      <section className="ci-cartao ci-cabecalho">
        <div className="ci-quem">
          <span><span className={`pl-tipo pl-tipo-${cad.tipo}`}>{nomeTipo}</span>{soLeitura ? "Ver cadastro" : cad.id ? "Editar cadastro" : novo}{cad.nome.trim() ? `: ${cad.nome.trim()}` : ""}</span>
          <button type="button" className="ci-btn ci-btn-texto" onClick={aoSair}>← Voltar ao início</button>
        </div>
        {!soLeitura && (
          <>
            <nav className="pl-passos" aria-label="Passos" style={{ marginTop: 10 }}>
              {passos.map((rot, i) => {
                const pend = visitados.has(i) && i !== passo && i < ultimo && faltasDoPasso(cad, i).length > 0;
                const cls = i === passo ? "pl-passo-atual" : pend ? "pl-passo-pend" : visitados.has(i) ? "pl-passo-feito" : "";
                return (
                  <button key={rot} type="button" className={`pl-passo ${cls}`} aria-current={i === passo ? "step" : undefined} aria-label={`Passo ${i + 1}: ${rot}${pend ? " (falta preencher)" : ""}`} title={rot} onClick={() => ir(i)}>
                    <span className="pl-passo-num">{pend ? "!" : visitados.has(i) && i !== passo ? "✓" : i + 1}</span>
                    <span className="pl-passo-rot">{rot}</span>
                  </button>
                );
              })}
            </nav>
            <div className="pl-progresso" aria-hidden><div style={{ width: `${(passo / ultimo) * 100}%` }} /></div>
          </>
        )}
      </section>

      <section className="ci-cartao" aria-labelledby="pl-passo-tit" style={{ display: "grid", gap: 14 }}>
        <div>
          <h2 id="pl-passo-tit" className="ci-h2">{soLeitura ? "Resumo" : `${passo + 1}. ${passos[passo]}`}</h2>
        </div>

        {passo === 0 && <PassoQuem cad={cad} inv={inv} mudar={mudarBase} />}
        {passo > 0 && passo < ultimo && cad.tipo === "projeto" && (
          <PassosProjeto cad={cad} passo={passo} ano={ano} inv={inv} mudarBase={mudarBase} mudarDados={mudarDados} aoMudar={aoMudar} />
        )}
        {passo > 0 && passo < ultimo && cad.tipo === "atividade" && (
          <PassosAtividade cad={cad} passo={passo} inv={inv} mudarBase={mudarBase} mudarDados={mudarDados} aoMudar={aoMudar} />
        )}
        {passo > 0 && passo < ultimo && cad.tipo === "necessidade" && <PassoNecessidades cad={cad} ano={ano} inv={inv} aoMudar={aoMudar} />}
        {passo === ultimo && <Revisao cad={cad} ano={ano} irPara={soLeitura ? undefined : ir} />}

        {mostrarFaltas && faltas.size > 0 && (
          <div className="pl-faixa pl-faixa-alerta pl-falta-passo" role="alert">
            {[...faltas].some((f) => ESSENCIAIS.includes(f)) ? (
              <span>Para continuar, preencha: <b>{[...faltas].filter((f) => ESSENCIAIS.includes(f)).map((f) => ROTULO_FALTA[f]).join(", ")}</b>.</span>
            ) : (
              <>
                <span>Ainda falta: <b>{[...faltas].map((f) => ROTULO_FALTA[f]).join(", ")}</b>. Você pode completar agora ou avançar e completar depois.</span>
                <span className="pl-botoes"><button type="button" className="ci-btn" onClick={() => avancar(true)}>Avançar mesmo assim</button></span>
              </>
            )}
          </div>
        )}
        {passo === ultimo && erroEnvio && <div className="pl-faixa pl-faixa-erro" role="alert">{erroEnvio}</div>}
      </section>

      {!soLeitura && <div className="ci-rodape-espaco" />}
      {!soLeitura && (
        <div className="ci-barra pl-barra">
          <button type="button" className="ci-btn" onClick={() => (passo === 0 ? aoSair() : ir(passo - 1))}>{passo === 0 ? "Cancelar" : "← Voltar"}</button>
          <span className="pl-barra-meio">Passo {passo + 1} de {passos.length} · o que você preenche fica guardado neste navegador até enviar</span>
          {passo < ultimo
            ? <button type="button" className="ci-btn ci-btn-primario" onClick={() => avancar()}>Avançar →</button>
            : <BotaoEnviar cad={cad} enviando={enviando} aoEnviar={aoEnviar} />}
        </div>
      )}
    </>
  );
}

function BotaoEnviar({ cad, enviando, aoEnviar }: { cad: Cadastro; enviando: boolean; aoEnviar: (c: Cadastro) => void }) {
  const faltaEssencial = [0, 1].some((p) => faltasDoPasso(cad, p).some((f) => ESSENCIAIS.includes(f)));
  return (
    <button type="button" className="ci-btn ci-btn-primario" disabled={enviando || faltaEssencial} onClick={() => aoEnviar(cad)}
      title={faltaEssencial
        ? (cad.tipo === "necessidade" ? "Preencha a identificação, a divisão, a seção e pelo menos uma necessidade antes de enviar" : "Preencha a identificação, a divisão e o nome antes de enviar")
        : undefined}>
      {enviando ? "Enviando…" : cad.id ? "Salvar alterações" : `Enviar ${cad.tipo === "necessidade" ? "lista" : cad.tipo}`}
    </button>
  );
}

// campos ─────────────────────────────────────────────────────────────────────

function Campo({ rotulo, dica, obrigatorio, largo, children }: { rotulo: string; dica?: string; obrigatorio?: boolean; largo?: boolean; children: React.ReactNode }) {
  return (
    <label className={`ci-campo${largo ? " ci-campo-largo" : ""}`}>
      <span>{rotulo}{obrigatorio && <span className="pl-obrig" aria-hidden> *</span>}</span>
      {children}
      {dica && <small className="pl-dica">{dica}</small>}
    </label>
  );
}

function Pilulas({ legenda, opcoes, valor, mudar, invalido, nome, dica }: {
  legenda: string; opcoes: readonly string[]; valor: string; mudar: (v: string) => void; invalido?: boolean; nome: string; dica?: string;
}) {
  return (
    <fieldset className="pl-radios" aria-invalid={invalido || undefined}>
      <legend>{legenda}</legend>
      <div className="pl-pilulas">
        {opcoes.map((o) => (
          <label key={o} className={`pl-pilula${valor === o ? " pl-marcada" : ""}`}>
            <input type="radio" name={nome} value={o} checked={valor === o} onChange={() => mudar(o)} />{o}
          </label>
        ))}
      </div>
      {dica && <small className="pl-dica">{dica}</small>}
    </fieldset>
  );
}

function SelectMes({ valor, mudar, ano, invalido, rotulo, vazio = "Escolha o mês" }: { valor: string; mudar: (v: string) => void; ano: number; invalido?: boolean; rotulo: string; vazio?: string }) {
  return (
    <select value={valor} onChange={(e) => mudar(e.target.value)} aria-invalid={invalido || undefined} aria-label={rotulo}>
      <option value="">{vazio}</option>
      {mesesDoAno(ano).map((m) => <option key={m} value={m}>{m}</option>)}
    </select>
  );
}

function Exemplo({ titulo = "Exemplo", children }: { titulo?: string; children: React.ReactNode }) {
  const [aberto, setAberto] = useState(true);
  return (
    <aside className="pl-exemplo" aria-label="Exemplo de preenchimento">
      <div className="pl-exemplo-cab">
        <span>💡 {titulo}</span>
        <button type="button" className="ci-btn ci-btn-texto" style={{ fontSize: 12.5 }} aria-expanded={aberto} onClick={() => setAberto((a) => !a)}>{aberto ? "esconder" : "mostrar"}</button>
      </div>
      {aberto && children}
    </aside>
  );
}

const Pares = ({ pares }: { pares: [string, string | number | null | undefined][] }) => (
  <dl>{pares.map(([r, v]) => <Fragment key={r}><dt>{r}</dt><dd>{v === null || v === undefined || v === "" ? "—" : v}</dd></Fragment>)}</dl>
);

function CampoValor({ valor, mudar, invalido, rotulo, opcional }: { valor: number | null; mudar: (v: number | null) => void; invalido?: boolean; rotulo: string; opcional?: boolean }) {
  const [texto, setTexto] = useState(valor === null ? "" : String(valor).replace(".", ","));
  // se o valor mudou por fora (item removido da lista), vale o valor, não o que estava digitado
  const mostrado = lerReais(texto) === valor ? texto : valor === null ? "" : String(valor).replace(".", ",");
  return (
    <Campo rotulo={rotulo} obrigatorio={!opcional} dica={valor !== null ? `= ${moeda(valor)}` : "Só números. Uma estimativa aproximada já serve. Ex.: 35000"}>
      <input inputMode="decimal" value={mostrado} aria-invalid={invalido || undefined} placeholder="Ex.: 35000"
        onChange={(e) => { setTexto(e.target.value); mudar(lerReais(e.target.value)); }} />
    </Campo>
  );
}

// passo 1: quem preenche ──────────────────────────────────────────────────────

function PassoQuem({ cad, inv, mudar }: { cad: Cadastro; inv: (c: string) => boolean; mudar: (p: Partial<Cadastro>) => void }) {
  return (
    <>
      <p className="ci-sub" style={{ margin: 0 }}>Quem está cadastrando e de que setor é {comArtigo(cad.tipo)}. A APLG usa estes dados se precisar tirar alguma dúvida.</p>
      <div className="pl-grade">
        <Campo rotulo="Seu posto ou graduação" obrigatorio>
          <select value={cad.posto} onChange={(e) => mudar({ posto: e.target.value })} aria-invalid={inv("posto") || undefined}>
            <option value="">Escolha</option>
            {POSTOS.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
        </Campo>
        <Campo rotulo="Seu nome de guerra" obrigatorio>
          <input value={cad.nomeGuerra} maxLength={40} onChange={(e) => mudar({ nomeGuerra: e.target.value })} aria-invalid={inv("nomeGuerra") || undefined} autoComplete="off" />
        </Campo>
        <Campo rotulo="Divisão ou assessoria" obrigatorio dica={cad.tipo === "necessidade" ? "A que a sua seção pertence." : `A que responde pel${cad.tipo === "projeto" ? "o projeto" : "a atividade"}.`}>
          <select value={cad.setor} onChange={(e) => mudar({ setor: e.target.value })} aria-invalid={inv("setor") || undefined}>
            <option value="">Escolha</option>
            {SETORES.map((s) => <option key={s.sigla} value={s.sigla}>{s.nome} ({s.sigla})</option>)}
          </select>
        </Campo>
        {cad.tipo === "necessidade" ? (
          <Campo rotulo="Sua seção" obrigatorio dica="Ex.: Seção de Transporte de Superfície.">
            <input value={cad.secao} maxLength={120} onChange={(e) => mudar({ secao: e.target.value })} aria-invalid={inv("secao") || undefined} />
          </Campo>
        ) : (
          <Campo rotulo="Seção (se houver)" dica="Opcional. Ex.: Seção de Transporte de Superfície.">
            <input value={cad.secao} maxLength={120} onChange={(e) => mudar({ secao: e.target.value })} />
          </Campo>
        )}
      </div>
    </>
  );
}

// passos do projeto ──────────────────────────────────────────────────────────

function PassosProjeto({ cad, passo, ano, inv, mudarBase, mudarDados, aoMudar }: {
  cad: CadastroProjeto; passo: number; ano: number; inv: (c: string) => boolean;
  mudarBase: (p: Partial<Cadastro>) => void; mudarDados: (p: Partial<DadosProjeto>) => void; aoMudar: (c: Cadastro) => void;
}) {
  const d = cad.dados;
  const ex = useMemo(() => exemploProjeto(ano), [ano]);
  const euMesmo = `${cad.posto} ${cad.nomeGuerra.trim()}`.trim();

  if (passo === 1) return (
    <>
      <Exemplo>
        <Pares pares={[["Nome do projeto", ex.nome], ["O que vai ficar pronto", ex.dados.entrega], ["Por que é necessário", ex.dados.porque], ["Se não for feito", ex.dados.seNaoFizer]]} />
      </Exemplo>
      <Campo rotulo="Nome do projeto" obrigatorio largo dica="Comece com substantivo: Reforma…, Aquisição…, Implantação… Evite siglas que só o seu setor conhece.">
        <input value={cad.nome} maxLength={200} onChange={(e) => mudarBase({ nome: e.target.value })} aria-invalid={inv("nome") || undefined} placeholder="Ex.: Reforma dos apartamentos do hotel de trânsito" />
      </Campo>
      <Campo rotulo="O que vai ficar pronto no fim" largo dica="A entrega principal, o que vai existir quando o projeto terminar.">
        <textarea rows={2} value={d.entrega} onChange={(e) => mudarDados({ entrega: e.target.value })} aria-invalid={inv("entrega") || undefined} />
      </Campo>
      <Campo rotulo="Por que é necessário" largo dica="O problema que o projeto resolve.">
        <textarea rows={3} value={d.porque} onChange={(e) => mudarDados({ porque: e.target.value })} aria-invalid={inv("porque") || undefined} />
      </Campo>
      <Campo rotulo="O que acontece se não for feito" largo dica="O risco de não fazer. Ajuda a Chefe a priorizar.">
        <textarea rows={2} value={d.seNaoFizer} onChange={(e) => mudarDados({ seNaoFizer: e.target.value })} />
      </Campo>
    </>
  );

  if (passo === 2) return (
    <>
      <Exemplo>
        <Pares pares={[["Início", ex.dados.inicio], ["Término", ex.dados.termino], ["Responsável", ex.dados.responsavel], ["Ramal", ex.dados.ramal]]} />
      </Exemplo>
      <div className="pl-grade">
        <Campo rotulo="Mês de início" obrigatorio><SelectMes rotulo="Mês de início" ano={ano} valor={d.inicio} mudar={(v) => mudarDados({ inicio: v })} invalido={inv("inicio")} /></Campo>
        <Campo rotulo="Mês de término" obrigatorio>
          <SelectMes rotulo="Mês de término" ano={ano} valor={d.termino} mudar={(v) => mudarDados({ termino: v })} invalido={inv("termino")} />
        </Campo>
        <Campo rotulo="Responsável pelo acompanhamento" obrigatorio dica="Posto ou graduação e nome de guerra. A DIRAD exige um responsável em cada linha do PTA (Of nº 37/CGOV/17513, item 3).">
          <input value={d.responsavel} maxLength={60} onChange={(e) => mudarDados({ responsavel: e.target.value })} aria-invalid={inv("responsavel") || undefined} />
        </Campo>
        <Campo rotulo="Ramal">
          <input value={d.ramal} maxLength={20} inputMode="tel" onChange={(e) => mudarDados({ ramal: e.target.value })} />
        </Campo>
      </div>
      {euMesmo && !d.responsavel && <div><button type="button" className="pl-mini" onClick={() => mudarDados({ responsavel: euMesmo })}>Sou eu ({euMesmo})</button></div>}
      {d.inicio && d.termino && mesesDoAno(ano).indexOf(d.termino) < mesesDoAno(ano).indexOf(d.inicio) && <p className="ci-erro-texto" style={{ margin: 0 }}>O término está antes do início.</p>}
    </>
  );

  if (passo === 3) return (
    <>
      <Exemplo>
        <Pares pares={[["Precisa de dinheiro?", ex.dados.precisaDinheiro], ["Valor estimado", moeda(ex.dados.valor)], ["O que será comprado", ex.dados.compra], ["Situação da contratação", ex.dados.contratacao], ["Prioridade", ex.dados.prioridade]]} />
      </Exemplo>
      <Pilulas nome="dinheiro" legenda="Precisa de dinheiro (comprar ou contratar)?" opcoes={SIM_NAO} valor={d.precisaDinheiro} mudar={(v) => mudarDados({ precisaDinheiro: v })} invalido={inv("precisaDinheiro")} />
      {d.precisaDinheiro && d.precisaDinheiro !== "Não" && (
        <div className="pl-grade">
          <CampoValor rotulo={`Valor estimado para ${ano} (R$)`} valor={d.valor} mudar={(v) => mudarDados({ valor: v })} invalido={inv("valor")} />
          <Campo rotulo="O que será comprado ou contratado" obrigatorio dica="Ex.: empresa de engenharia para a reforma; ferramentas manuais e elétricas.">
            <input value={d.compra} maxLength={300} onChange={(e) => mudarDados({ compra: e.target.value })} aria-invalid={inv("compra") || undefined} />
          </Campo>
          <Campo rotulo="Situação da contratação" obrigatorio largo dica={`PCA = Plano de Contratações Anual de ${ano}.`}>
            <select value={d.contratacao} onChange={(e) => mudarDados({ contratacao: e.target.value })} aria-invalid={inv("contratacao") || undefined}>
              <option value="">Escolha</option>
              {CONTRATACAO.map((o) => <option key={o} value={o}>{o}</option>)}
            </select>
          </Campo>
        </div>
      )}
      <Pilulas nome="prioridade" legenda="Prioridade" opcoes={PRIORIDADE} valor={d.prioridade} mudar={(v) => mudarDados({ prioridade: v })} invalido={inv("prioridade")} />
      <Campo rotulo="Observações" largo dica="Qualquer informação que ajude a APLG.">
        <textarea rows={2} value={d.observacoes} onChange={(e) => mudarDados({ observacoes: e.target.value })} />
      </Campo>
    </>
  );

  // passo 4: etapas
  return <EtapasProjeto cad={cad} ano={ano} ex={ex} inv={inv} aoMudar={aoMudar} />;
}

function EtapasProjeto({ cad, ano, ex, inv, aoMudar }: { cad: CadastroProjeto; ano: number; ex: CadastroProjeto; inv: (c: string) => boolean; aoMudar: (c: Cadastro) => void }) {
  const d = cad.dados;
  const tri = entregasPorTrimestre(cad.etapas);
  const mudar = (etapas: Etapa[]) => aoMudar({ ...cad, etapas });
  const mudarUma = (i: number, p: Partial<Etapa>) => mudar(cad.etapas.map((e, j) => (j === i ? { ...e, ...p, ...(p.tipo === "Marco" ? { inicio: "" } : {}) } : e)));
  const mover = (i: number, para: number) => {
    const l = [...cad.etapas];
    const [x] = l.splice(i, 1);
    l.splice(para, 0, x);
    mudar(l);
  };
  const resp = d.responsavel.trim();
  return (
    <>
      <p className="ci-sub" style={{ margin: 0 }}>Os passos do projeto, em ordem. <b>Tarefa</b> é um passo com duração (comece com verbo: Elaborar, Contratar, Receber). <b>Marco</b> é uma entrega, sem duração (Projeto aprovado, Obra recebida). Todo projeto precisa de pelo menos uma tarefa e um marco.</p>
      <Exemplo titulo="Exemplo: reforma do hotel de trânsito">
        <ol className="pl-exemplo-etapas">
          {ex.etapas.map((e) => <li key={e.descricao}><b>{e.tipo}:</b> {e.descricao} — {e.tipo === "Marco" ? e.fim : `${e.inicio} a ${e.fim}`} · comprova com: {e.comprova}</li>)}
        </ol>
      </Exemplo>

      <div>
        <div className="pl-tri" aria-label="Entregas por trimestre">
          {tri.map((n, i) => <div key={i} className={`pl-tri-cel${n ? "" : " pl-tri-zero"}`}><b>{n}</b>{i + 1}º trimestre</div>)}
        </div>
        <p className="pl-dica" style={{ margin: "6px 0 0" }}>A DIRAD pede entregas nos quatro trimestres (Of nº 37/CGOV/17513, item 3). Se algum trimestre ficou vazio, veja se dá para dividir uma tarefa longa ou criar um marco intermediário.</p>
      </div>

      {(inv("tarefas") || inv("marcos")) && (
        <p className="ci-erro-texto" style={{ margin: 0 }}>{[inv("tarefas") && "Cadastre pelo menos uma tarefa.", inv("marcos") && "Cadastre pelo menos um marco."].filter(Boolean).join(" ")}</p>
      )}

      <div className="pl-etapas">
        {!cad.etapas.length && <div className="pl-vazio">Nenhuma etapa ainda. Comece pela primeira tarefa do projeto.</div>}
        {cad.etapas.map((e, i) => {
          const av = avisosEtapa(e, d);
          return (
            <div key={i} className={`pl-etapa${e.tipo === "Marco" ? " pl-etapa-marco" : ""}`}>
              <div className="pl-etapa-cab">
                <span className="pl-etapa-tit">{i + 1}. {e.tipo}{e.fim ? ` · ${trimestreDe(e.fim)}º trimestre` : ""}</span>
                <span className="pl-etapa-acoes">
                  <span className="pl-segmento" role="group" aria-label="Tarefa ou marco">
                    {(["Tarefa", "Marco"] as const).map((t) => <button key={t} type="button" aria-pressed={e.tipo === t} onClick={() => mudarUma(i, { tipo: t })}>{t}</button>)}
                  </span>
                  <button type="button" className="pl-mini" disabled={i === 0} onClick={() => mover(i, i - 1)} aria-label="Subir">↑</button>
                  <button type="button" className="pl-mini" disabled={i === cad.etapas.length - 1} onClick={() => mover(i, i + 1)} aria-label="Descer">↓</button>
                  <button type="button" className="pl-mini ci-remover" onClick={() => mudar(cad.etapas.filter((_, j) => j !== i))} aria-label={`Remover etapa ${i + 1}`}>Remover</button>
                </span>
              </div>
              <Campo rotulo={e.tipo === "Marco" ? "Entrega (o que fica pronto neste momento)" : "Tarefa (comece com verbo)"} obrigatorio largo>
                <input value={e.descricao} maxLength={300} onChange={(x) => mudarUma(i, { descricao: x.target.value })}
                  placeholder={e.tipo === "Marco" ? "Ex.: Projeto básico aprovado" : "Ex.: Elaborar o projeto básico e o orçamento"} />
              </Campo>
              <div className="pl-grade">
                {e.tipo === "Tarefa" && (
                  <Campo rotulo="Mês de início" obrigatorio><SelectMes rotulo={`Mês de início da etapa ${i + 1}`} ano={ano} valor={e.inicio} mudar={(v) => mudarUma(i, { inicio: v })} /></Campo>
                )}
                <Campo rotulo={e.tipo === "Marco" ? "Mês do marco" : "Mês de término"} obrigatorio>
                  <SelectMes rotulo={`${e.tipo === "Marco" ? "Mês do marco" : "Mês de término"} da etapa ${i + 1}`} ano={ano} valor={e.fim} mudar={(v) => mudarUma(i, { fim: v })} />
                </Campo>
                <Campo rotulo="Responsável" obrigatorio dica="Posto ou graduação e nome de guerra.">
                  <input value={e.responsavel} maxLength={60} onChange={(x) => mudarUma(i, { responsavel: x.target.value })} />
                </Campo>
                <Campo rotulo="Como comprovar" dica="Relatório, termo de recebimento, publicação…">
                  <input value={e.comprova} maxLength={200} onChange={(x) => mudarUma(i, { comprova: x.target.value })} />
                </Campo>
              </div>
              {av.length > 0 && <ul className="pl-avisos" aria-label="Avisos">{av.map((a) => <li key={a}>{a}</li>)}</ul>}
            </div>
          );
        })}
      </div>
      <div className="pl-botoes">
        <button type="button" className="ci-btn" onClick={() => mudar([...cad.etapas, etapaVazia("Tarefa", resp)])}>+ Tarefa</button>
        <button type="button" className="ci-btn" onClick={() => mudar([...cad.etapas, etapaVazia("Marco", resp)])}>+ Marco</button>
      </div>
    </>
  );
}

// passos da atividade ────────────────────────────────────────────────────────

const ROTINAS_MATRIZ = [...new Map(MATRIZ_PREVISTA.map((t) => [`${t.setor}|${t.atividade}`, t])).values()];

function PassosAtividade({ cad, passo, inv, mudarBase, mudarDados, aoMudar }: {
  cad: CadastroAtividade; passo: number; inv: (c: string) => boolean;
  mudarBase: (p: Partial<Cadastro>) => void; mudarDados: (p: Partial<DadosAtividade>) => void; aoMudar: (c: Cadastro) => void;
}) {
  const d = cad.dados;
  const ex = useMemo(() => exemploAtividade(), []);
  const euMesmo = `${cad.posto} ${cad.nomeGuerra.trim()}`.trim();
  const rotinas = useMemo(() => {
    const doSetor = ROTINAS_MATRIZ.filter((r) => r.setor === cad.setor);
    return doSetor.length ? doSetor : ROTINAS_MATRIZ;
  }, [cad.setor]);

  if (passo === 1) return (
    <>
      <Exemplo>
        <Pares pares={[["Nome da atividade", ex.nome], ["O que é feito", ex.dados.oQueE], ["Já existe na Matriz?", ex.dados.matriz]]} />
      </Exemplo>
      <Campo rotulo="Nome da atividade" obrigatorio largo dica="Comece com substantivo: Manutenção…, Controle…, Atendimento…">
        <input value={cad.nome} maxLength={200} onChange={(e) => mudarBase({ nome: e.target.value })} aria-invalid={inv("nome") || undefined} placeholder="Ex.: Manutenção preventiva dos aparelhos de ar-condicionado" />
      </Campo>
      <Campo rotulo="O que é feito" largo dica="Descreva a rotina em poucas palavras.">
        <textarea rows={2} value={d.oQueE} onChange={(e) => mudarDados({ oQueE: e.target.value })} aria-invalid={inv("oQueE") || undefined} />
      </Campo>
      <Pilulas nome="matriz" legenda="Esta rotina já existe na Matriz da DIRAD (lista “Já previsto” do início)?" opcoes={MATRIZ_OPC} valor={d.matriz}
        mudar={(v) => mudarDados({ matriz: v, ...(jaExisteNaMatriz(v) ? {} : { matrizAtividade: "" }) })} />
      {jaExisteNaMatriz(d.matriz) && (
        <Campo rotulo="Qual rotina da Matriz?" largo dica="Assim a APLG junta o que você mandar à rotina certa.">
          <select value={d.matrizAtividade} onChange={(e) => mudarDados({ matrizAtividade: e.target.value })}>
            <option value="">Escolha</option>
            {rotinas.map((r) => <option key={`${r.setor}|${r.atividade}`} value={r.atividade}>{r.atividade} ({r.setor})</option>)}
          </select>
        </Campo>
      )}
    </>
  );

  if (passo === 2) return (
    <>
      <p className="ci-sub" style={{ margin: 0 }}>O <b>item de controle</b> é o resultado da rotina que vamos acompanhar. O <b>indicador</b> é o número que mostra se ela vai bem. Todo item de controle precisa de um indicador (Instruções para Lançamento no GPAer).</p>
      <Exemplo>
        <Pares pares={[["Item de controle", ex.dados.itemControle], ["Indicador", ex.dados.indicador], ["Como calcular", ex.dados.calculo], ["Unidade e meta", `${ex.dados.unidade} · meta ${ex.dados.meta}`], ["Medição", ex.dados.medicao], ["De onde vêm os dados", ex.dados.fonteDados]]} />
      </Exemplo>
      <Campo rotulo="Item de controle (o que vamos acompanhar)" largo>
        <textarea rows={2} value={d.itemControle} onChange={(e) => mudarDados({ itemControle: e.target.value })} aria-invalid={inv("itemControle") || undefined} />
      </Campo>
      <div className="pl-grade">
        <Campo rotulo="Nome do indicador" largo>
          <input value={d.indicador} maxLength={200} onChange={(e) => mudarDados({ indicador: e.target.value })} aria-invalid={inv("indicador") || undefined} />
        </Campo>
        <Campo rotulo="Como calcular" largo dica="Ex.: aparelhos com preventiva no prazo ÷ total de aparelhos × 100.">
          <input value={d.calculo} maxLength={300} onChange={(e) => mudarDados({ calculo: e.target.value })} aria-invalid={inv("calculo") || undefined} />
        </Campo>
        <Campo rotulo="Unidade">
          <select value={d.unidade} onChange={(e) => mudarDados({ unidade: e.target.value })}>
            <option value="">Escolha</option>
            {UNIDADE.map((u) => <option key={u} value={u}>{u}</option>)}
          </select>
        </Campo>
        <Campo rotulo="Meta" dica="O valor que queremos alcançar. Ex.: 95%.">
          <input value={d.meta} maxLength={60} onChange={(e) => mudarDados({ meta: e.target.value })} aria-invalid={inv("meta") || undefined} />
        </Campo>
        <Campo rotulo="De quanto em quanto tempo medir">
          <select value={d.medicao} onChange={(e) => mudarDados({ medicao: e.target.value })}>
            <option value="">Escolha</option>
            {FREQUENCIA.map((u) => <option key={u} value={u}>{u}</option>)}
          </select>
        </Campo>
        <Campo rotulo="De onde vêm os dados" dica="Sistema, planilha ou documento.">
          <input value={d.fonteDados} maxLength={200} onChange={(e) => mudarDados({ fonteDados: e.target.value })} />
        </Campo>
      </div>
    </>
  );

  if (passo === 3) return (
    <>
      <Exemplo>
        <Pares pares={[["Responsável", ex.dados.responsavel], ["Precisa de dinheiro?", ex.dados.precisaDinheiro], ["Valor estimado no ano", moeda(ex.dados.valor)], ["O que será comprado", ex.dados.compra]]} />
      </Exemplo>
      <div className="pl-grade">
        <Campo rotulo="Responsável pelo acompanhamento" obrigatorio dica="Posto ou graduação e nome de guerra. A DIRAD exige um responsável em cada linha do PTA (Of nº 37/CGOV/17513, item 3).">
          <input value={d.responsavel} maxLength={60} onChange={(e) => mudarDados({ responsavel: e.target.value })} aria-invalid={inv("responsavel") || undefined} />
        </Campo>
        <Campo rotulo="Ramal">
          <input value={d.ramal} maxLength={20} inputMode="tel" onChange={(e) => mudarDados({ ramal: e.target.value })} />
        </Campo>
      </div>
      {euMesmo && !d.responsavel && <div><button type="button" className="pl-mini" onClick={() => mudarDados({ responsavel: euMesmo })}>Sou eu ({euMesmo})</button></div>}
      <Pilulas nome="dinheiro" legenda="Precisa de dinheiro (comprar ou contratar)?" opcoes={SIM_NAO} valor={d.precisaDinheiro} mudar={(v) => mudarDados({ precisaDinheiro: v })} invalido={inv("precisaDinheiro")} />
      {d.precisaDinheiro && d.precisaDinheiro !== "Não" && (
        <div className="pl-grade">
          <CampoValor rotulo="Valor estimado no ano (R$)" valor={d.valor} mudar={(v) => mudarDados({ valor: v })} invalido={inv("valor")} />
          <Campo rotulo="O que será comprado ou contratado" obrigatorio>
            <input value={d.compra} maxLength={300} onChange={(e) => mudarDados({ compra: e.target.value })} aria-invalid={inv("compra") || undefined} />
          </Campo>
        </div>
      )}
      <Campo rotulo="Observações" largo>
        <textarea rows={2} value={d.observacoes} onChange={(e) => mudarDados({ observacoes: e.target.value })} />
      </Campo>
    </>
  );

  return <TarefasAtividade cad={cad} ex={ex} inv={inv} aoMudar={aoMudar} />;
}

function TarefasAtividade({ cad, ex, inv, aoMudar }: { cad: CadastroAtividade; ex: CadastroAtividade; inv: (c: string) => boolean; aoMudar: (c: Cadastro) => void }) {
  const mudar = (etapas: TarefaRotina[]) => aoMudar({ ...cad, etapas });
  const mudarUma = (i: number, p: Partial<TarefaRotina>) => mudar(cad.etapas.map((t, j) => (j === i ? { ...t, ...p } : t)));
  const mover = (i: number, para: number) => {
    const l = [...cad.etapas];
    const [x] = l.splice(i, 1);
    l.splice(para, 0, x);
    mudar(l);
  };
  return (
    <>
      <p className="ci-sub" style={{ margin: 0 }}>O que é feito na rotina. Comece cada tarefa com verbo no infinitivo: Atualizar, Executar, Registrar, Encaminhar.</p>
      <Exemplo titulo="Exemplo: manutenção preventiva do ar-condicionado">
        <ol className="pl-exemplo-etapas">
          {ex.etapas.map((t) => <li key={t.tarefa}>{t.tarefa} — {t.frequencia}, {t.quando} · comprova com: {t.comprova}</li>)}
        </ol>
      </Exemplo>
      {inv("tarefas") && <p className="ci-erro-texto" style={{ margin: 0 }}>Cadastre pelo menos uma tarefa.</p>}
      <div className="pl-etapas">
        {!cad.etapas.length && <div className="pl-vazio">Nenhuma tarefa ainda.</div>}
        {cad.etapas.map((t, i) => {
          const av = avisosTarefa(t);
          return (
            <div key={i} className="pl-etapa">
              <div className="pl-etapa-cab">
                <span className="pl-etapa-tit">{i + 1}. Tarefa</span>
                <span className="pl-etapa-acoes">
                  <button type="button" className="pl-mini" disabled={i === 0} onClick={() => mover(i, i - 1)} aria-label="Subir">↑</button>
                  <button type="button" className="pl-mini" disabled={i === cad.etapas.length - 1} onClick={() => mover(i, i + 1)} aria-label="Descer">↓</button>
                  <button type="button" className="pl-mini ci-remover" onClick={() => mudar(cad.etapas.filter((_, j) => j !== i))} aria-label={`Remover tarefa ${i + 1}`}>Remover</button>
                </span>
              </div>
              <Campo rotulo="Tarefa (comece com verbo)" obrigatorio largo>
                <input value={t.tarefa} maxLength={300} onChange={(x) => mudarUma(i, { tarefa: x.target.value })} placeholder="Ex.: Executar a manutenção preventiva conforme o plano" />
              </Campo>
              <div className="pl-grade">
                <Campo rotulo="Frequência" obrigatorio>
                  <select value={t.frequencia} onChange={(x) => mudarUma(i, { frequencia: x.target.value })} aria-label={`Frequência da tarefa ${i + 1}`}>
                    <option value="">Escolha</option>
                    {FREQUENCIA.map((f) => <option key={f} value={f}>{f}</option>)}
                  </select>
                </Campo>
                <Campo rotulo="Prazo ou quando" dica="Ex.: até o 5º dia útil; na 1ª semana do mês; em março.">
                  <input value={t.quando} maxLength={120} onChange={(x) => mudarUma(i, { quando: x.target.value })} />
                </Campo>
                <Campo rotulo="Responsável" obrigatorio dica="Posto ou graduação e nome de guerra.">
                  <input value={t.responsavel} maxLength={60} onChange={(x) => mudarUma(i, { responsavel: x.target.value })} />
                </Campo>
                <Campo rotulo="Como comprovar" dica="Relatório, ordem de serviço, publicação em boletim…">
                  <input value={t.comprova} maxLength={200} onChange={(x) => mudarUma(i, { comprova: x.target.value })} />
                </Campo>
              </div>
              {av.length > 0 && <ul className="pl-avisos" aria-label="Avisos">{av.map((a) => <li key={a}>{a}</li>)}</ul>}
            </div>
          );
        })}
      </div>
      <div className="pl-botoes">
        <button type="button" className="ci-btn" onClick={() => mudar([...cad.etapas, tarefaVazia(cad.dados.responsavel.trim())])}>+ Tarefa</button>
      </div>
    </>
  );
}

// lista de necessidades ──────────────────────────────────────────────────────

function PassoNecessidades({ cad, ano, inv, aoMudar }: { cad: CadastroNecessidade; ano: number; inv: (c: string) => boolean; aoMudar: (c: Cadastro) => void }) {
  const ex = useMemo(() => exemploNecessidade(), []);
  const mudar = (etapas: Necessidade[]) => aoMudar({ ...cad, etapas });
  const mudarUma = (i: number, p: Partial<Necessidade>) => mudar(cad.etapas.map((n, j) => (j === i ? { ...n, ...p } : n)));
  const total = totalNecessidades(cad.etapas);
  return (
    <>
      <div className="pl-faixa pl-faixa-info" role="note">
        <span><b>Só o que não faz parte de um projeto ou atividade.</b> O material ou serviço ligado a um projeto ou atividade fica no cadastro deles: não repita aqui.</span>
      </div>
      <Exemplo>
        <ol className="pl-exemplo-etapas">
          {ex.etapas.map((n) => <li key={n.descricao}><b>{n.natureza}:</b> {n.descricao} — {n.quantidade} · {moeda(n.valor)} · {n.justificativa}</li>)}
        </ol>
      </Exemplo>
      {inv("necessidades") && <p className="ci-erro-texto" style={{ margin: 0 }}>Cadastre pelo menos uma necessidade.</p>}
      <div className="pl-etapas">
        {!cad.etapas.length && <div className="pl-vazio">Nenhuma necessidade ainda.</div>}
        {cad.etapas.map((n, i) => {
          const av = avisosNecessidade(n);
          return (
            <div key={i} className="pl-etapa">
              <div className="pl-etapa-cab">
                <span className="pl-etapa-tit">{i + 1}. {n.natureza || "Necessidade"}</span>
                <span className="pl-etapa-acoes">
                  <button type="button" className="pl-mini ci-remover" onClick={() => mudar(cad.etapas.filter((_, j) => j !== i))} aria-label={`Remover necessidade ${i + 1}`}>Remover</button>
                </span>
              </div>
              <Pilulas nome={`natureza-${i}`} legenda="É material ou serviço?" opcoes={NATUREZA_NECESSIDADE} valor={n.natureza} mudar={(v) => mudarUma(i, { natureza: v })} />
              <Campo rotulo="Qual é a necessidade" obrigatorio largo dica="Descreva sem citar marca nem empresa.">
                <input value={n.descricao} maxLength={300} onChange={(x) => mudarUma(i, { descricao: x.target.value })} aria-invalid={(inv("necessidades") && i === 0) || undefined} placeholder={n.natureza === "Serviço" ? "Ex.: Manutenção do portão eletrônico da garagem" : "Ex.: Cadeiras giratórias para a sala de reuniões"} />
              </Campo>
              <div className="pl-grade">
                <Campo rotulo="Quantidade" obrigatorio dica="Ex.: 12 unidades; 1 serviço; 4 manutenções no ano.">
                  <input value={n.quantidade} maxLength={80} onChange={(x) => mudarUma(i, { quantidade: x.target.value })} />
                </Campo>
                <CampoValor opcional rotulo={`Valor estimado para ${ano} (R$), se souber`} valor={n.valor} mudar={(v) => mudarUma(i, { valor: v })} />
                <Campo rotulo="Por que é necessário" largo dica="Opcional, mas ajuda a APLG a priorizar.">
                  <input value={n.justificativa} maxLength={300} onChange={(x) => mudarUma(i, { justificativa: x.target.value })} />
                </Campo>
              </div>
              {av.length > 0 && <ul className="pl-avisos" aria-label="Avisos">{av.map((a) => <li key={a}>{a}</li>)}</ul>}
            </div>
          );
        })}
      </div>
      <div className="pl-botoes">
        <button type="button" className="ci-btn" disabled={cad.etapas.length >= 80} onClick={() => mudar([...cad.etapas, necessidadeVazia()])}>+ Necessidade</button>
      </div>
      {total > 0 && <p className="ci-sub" style={{ margin: 0 }}>Total estimado da lista: <b>{moeda(total)}</b></p>}
      <Campo rotulo="Observações" largo>
        <textarea rows={2} value={cad.dados.observacoes} onChange={(e) => aoMudar({ ...cad, dados: { observacoes: e.target.value } })} />
      </Campo>
    </>
  );
}

// revisão ────────────────────────────────────────────────────────────────────

function Sec({ titulo, passo, irPara, children }: { titulo: string; passo: number; irPara?: (p: number) => void; children: React.ReactNode }) {
  return (
    <div className="pl-rev-sec">
      <div className="pl-rev-cab"><span>{titulo}</span>{irPara && <button type="button" className="ci-btn ci-btn-texto" onClick={() => irPara(passo)}>editar</button>}</div>
      {children}
    </div>
  );
}

function Revisao({ cad, ano, irPara }: { cad: Cadastro; ano: number; irPara?: (p: number) => void }) {
  const p = pendencias(cad);
  const v = (s: string | number | null | undefined) => (s === null || s === undefined || s === "" ? <span className="pl-rev-falta">não informado</span> : s);
  const quem = (
    <Sec irPara={irPara} titulo="Quem preenche" passo={0}>
      <dl>
        <dt>Preenchido por</dt><dd>{v(`${cad.posto} ${cad.nomeGuerra}`.trim())}</dd>
        <dt>Divisão ou assessoria</dt><dd>{v(cad.setor ? nomeSetor(cad.setor) : "")}</dd>
        <dt>Seção</dt><dd>{v(cad.secao)}</dd>
      </dl>
    </Sec>
  );
  return (
    <div className="pl-rev">
      {p.length ? (
        <div className="pl-faixa pl-faixa-alerta" role="status">
          <div>
            <b>Ainda falta:</b>
            <ul className="pl-lista" style={{ marginTop: 4 }}>{p.map((x) => <li key={x}>{x}</li>)}</ul>
            {irPara && <span>Você pode enviar assim e completar depois (pelo mesmo link), mas a APLG precisa dessas informações para montar o PTA.</span>}
          </div>
        </div>
      ) : (
        <div className="pl-faixa pl-faixa-ok" role="status"><b>Tudo preenchido.</b>{irPara ? " Confira e envie." : ""}</div>
      )}
      {quem}
      {cad.tipo === "necessidade" && (
        <Sec irPara={irPara} titulo={`Necessidades (${cad.etapas.length})`} passo={1}>
          {cad.etapas.length ? (
            <div className="pl-rev-tab-wrap">
              <table className="pl-rev-tab">
                <thead><tr><th>#</th><th>Tipo</th><th>Necessidade</th><th>Quantidade</th><th>Valor estimado</th><th>Por que é necessário</th></tr></thead>
                <tbody>{cad.etapas.map((n, i) => (
                  <tr key={i}><td>{i + 1}</td><td>{n.natureza || "—"}</td><td>{n.descricao || "—"}</td><td>{n.quantidade || "—"}</td><td>{moeda(n.valor)}</td><td>{n.justificativa || "—"}</td></tr>
                ))}</tbody>
              </table>
            </div>
          ) : <p className="pl-rev-falta" style={{ margin: "6px 0 0" }}>nenhuma necessidade</p>}
          <dl>
            <dt>Total estimado</dt><dd>{moeda(totalNecessidades(cad.etapas))}</dd>
            {cad.dados.observacoes && <><dt>Observações</dt><dd>{cad.dados.observacoes}</dd></>}
          </dl>
        </Sec>
      )}
      {cad.tipo === "projeto" && (
        <>
          <Sec irPara={irPara} titulo="O projeto" passo={1}>
            <dl>
              <dt>Nome</dt><dd>{v(cad.nome)}</dd>
              <dt>O que vai ficar pronto</dt><dd>{v(cad.dados.entrega)}</dd>
              <dt>Por que é necessário</dt><dd>{v(cad.dados.porque)}</dd>
              <dt>Se não for feito</dt><dd>{v(cad.dados.seNaoFizer)}</dd>
            </dl>
          </Sec>
          <Sec irPara={irPara} titulo="Prazo e responsável" passo={2}>
            <dl>
              <dt>Período</dt><dd>{v(cad.dados.inicio && cad.dados.termino ? `${cad.dados.inicio} a ${cad.dados.termino}` : cad.dados.inicio || cad.dados.termino)}</dd>
              <dt>Responsável</dt><dd>{v(cad.dados.responsavel)}{cad.dados.ramal ? ` · ramal ${cad.dados.ramal}` : ""}</dd>
            </dl>
          </Sec>
          <Sec irPara={irPara} titulo="Dinheiro e prioridade" passo={3}>
            <dl>
              <dt>Precisa de dinheiro?</dt><dd>{v(cad.dados.precisaDinheiro)}</dd>
              {cad.dados.precisaDinheiro && cad.dados.precisaDinheiro !== "Não" && <>
                <dt>Valor estimado em {ano}</dt><dd>{v(cad.dados.valor === null ? "" : moeda(cad.dados.valor))}</dd>
                <dt>O que será comprado</dt><dd>{v(cad.dados.compra)}</dd>
                <dt>Situação da contratação</dt><dd>{v(cad.dados.contratacao)}</dd>
              </>}
              <dt>Prioridade</dt><dd>{v(cad.dados.prioridade)}</dd>
              {cad.dados.observacoes && <><dt>Observações</dt><dd>{cad.dados.observacoes}</dd></>}
            </dl>
          </Sec>
          <Sec irPara={irPara} titulo={`Etapas (${cad.etapas.length})`} passo={4}>
            {cad.etapas.length ? (
              <div className="pl-rev-tab-wrap">
                <table className="pl-rev-tab">
                  <thead><tr><th>#</th><th>Tipo</th><th>Descrição</th><th>Quando</th><th>Responsável</th><th>Como comprovar</th></tr></thead>
                  <tbody>{cad.etapas.map((e, i) => (
                    <tr key={i}><td>{i + 1}</td><td>{e.tipo}</td><td>{e.descricao || "—"}</td>
                      <td>{e.tipo === "Marco" ? e.fim || "—" : `${e.inicio || "?"} a ${e.fim || "?"}`}</td><td>{e.responsavel || "—"}</td><td>{e.comprova || "—"}</td></tr>
                  ))}</tbody>
                </table>
              </div>
            ) : <p className="pl-rev-falta" style={{ margin: "6px 0 0" }}>nenhuma etapa</p>}
          </Sec>
        </>
      )}
      {cad.tipo === "atividade" && (
        <>
          <Sec irPara={irPara} titulo="A atividade" passo={1}>
            <dl>
              <dt>Nome</dt><dd>{v(cad.nome)}</dd>
              <dt>O que é feito</dt><dd>{v(cad.dados.oQueE)}</dd>
              <dt>Já existe na Matriz?</dt><dd>{v(cad.dados.matriz)}{cad.dados.matrizAtividade ? ` — ${cad.dados.matrizAtividade}` : ""}</dd>
            </dl>
          </Sec>
          <Sec irPara={irPara} titulo="Como acompanhar" passo={2}>
            <dl>
              <dt>Item de controle</dt><dd>{v(cad.dados.itemControle)}</dd>
              <dt>Indicador</dt><dd>{v(cad.dados.indicador)}</dd>
              <dt>Como calcular</dt><dd>{v(cad.dados.calculo)}</dd>
              <dt>Unidade e meta</dt><dd>{v([cad.dados.unidade, cad.dados.meta && `meta ${cad.dados.meta}`].filter(Boolean).join(" · "))}</dd>
              <dt>Medição</dt><dd>{v(cad.dados.medicao)}</dd>
              <dt>De onde vêm os dados</dt><dd>{v(cad.dados.fonteDados)}</dd>
            </dl>
          </Sec>
          <Sec irPara={irPara} titulo="Responsável e dinheiro" passo={3}>
            <dl>
              <dt>Responsável</dt><dd>{v(cad.dados.responsavel)}{cad.dados.ramal ? ` · ramal ${cad.dados.ramal}` : ""}</dd>
              <dt>Precisa de dinheiro?</dt><dd>{v(cad.dados.precisaDinheiro)}</dd>
              {cad.dados.precisaDinheiro && cad.dados.precisaDinheiro !== "Não" && <>
                <dt>Valor estimado no ano</dt><dd>{v(cad.dados.valor === null ? "" : moeda(cad.dados.valor))}</dd>
                <dt>O que será comprado</dt><dd>{v(cad.dados.compra)}</dd>
              </>}
              {cad.dados.observacoes && <><dt>Observações</dt><dd>{cad.dados.observacoes}</dd></>}
            </dl>
          </Sec>
          <Sec irPara={irPara} titulo={`Tarefas (${cad.etapas.length})`} passo={4}>
            {cad.etapas.length ? (
              <div className="pl-rev-tab-wrap">
                <table className="pl-rev-tab">
                  <thead><tr><th>#</th><th>Tarefa</th><th>Frequência</th><th>Quando</th><th>Responsável</th><th>Como comprovar</th></tr></thead>
                  <tbody>{cad.etapas.map((t, i) => (
                    <tr key={i}><td>{i + 1}</td><td>{t.tarefa || "—"}</td><td>{t.frequencia || "—"}</td><td>{t.quando || "—"}</td><td>{t.responsavel || "—"}</td><td>{t.comprova || "—"}</td></tr>
                  ))}</tbody>
                </table>
              </div>
            ) : <p className="pl-rev-falta" style={{ margin: "6px 0 0" }}>nenhuma tarefa</p>}
          </Sec>
        </>
      )}
    </div>
  );
}

// enviado ────────────────────────────────────────────────────────────────────

function Enviado({ cad, novo, primeiro, link, aoComecar, aoInicio, aoEditar }: {
  cad: Cadastro; novo: boolean; primeiro: boolean; link: string; aoComecar: (t: Tipo) => void; aoInicio: () => void; aoEditar: () => void;
}) {
  const p = pendencias(cad);
  const enviado = cad.tipo === "projeto" ? "Projeto enviado" : cad.tipo === "atividade" ? "Atividade enviada" : "Lista de necessidades enviada";
  return (
    <section className="ci-cartao ci-cabecalho" aria-labelledby="pl-env-tit" style={{ display: "grid", gap: 12 }}>
      <h2 id="pl-env-tit" className="ci-h2">{novo ? `${enviado}!` : "Alterações salvas!"}</h2>
      <div className="pl-faixa pl-faixa-ok" role="status"><span><b>{cad.nome}</b> já está com a APLG.</span></div>
      {p.length > 0 && (
        <div className="pl-faixa pl-faixa-alerta">
          <span>Ficou faltando: {p.join("; ")}. Você pode completar quando quiser, pelo mesmo link.</span>
          <button type="button" className="ci-btn" onClick={aoEditar}>Completar agora</button>
        </div>
      )}
      <div>
        <h3 className="ci-h2" style={{ fontSize: 15 }}>Quer cadastrar mais alguma coisa?</h3>
        <div className="pl-botoes" style={{ marginTop: 6 }}>
          <button type="button" className="ci-btn ci-btn-primario" onClick={() => aoComecar("projeto")}>Cadastrar outro projeto</button>
          <button type="button" className="ci-btn ci-btn-primario" onClick={() => aoComecar("atividade")}>Cadastrar uma atividade</button>
          <button type="button" className="ci-btn ci-btn-primario" onClick={() => aoComecar("necessidade")}>Cadastrar lista de necessidades</button>
          <button type="button" className="ci-btn" onClick={aoInicio}>Ver meus cadastros</button>
        </div>
      </div>
      {primeiro && <LinkPessoal link={link} guardada />}
    </section>
  );
}

