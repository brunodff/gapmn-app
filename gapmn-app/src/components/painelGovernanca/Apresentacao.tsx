// Modo apresentação (reunião): tela cheia, uma tela por vez, tudo cabendo no monitor.
// Tela 1: visão geral. Depois, uma tela por divisão (como as páginas do Power BI).
// Navegação: setas do teclado, PageUp/PageDown, botões e as siglas no rodapé. Esc sai.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronLeft, ChevronRight, House, X } from "lucide-react";
import { CORTE_ADEQUADO, CORTE_ATENCAO, ORDEM_DIVISOES, calcularPainel, contarStatus } from "../../lib/indicadores/calculo.ts";
import {
  competenciaPorExtenso, fmtGeradoEm, fmtNumero, fmtPercentual, fmtValor, fmtVariacaoPct, larguraCss, metaExibida, unidadeCurta,
} from "../../lib/indicadores/formato.ts";
import type { FichaCatalogo, IndicadorPainel, LinhaBD, Painel, Status } from "../../lib/indicadores/tipos.ts";
import { CartaoGrupo } from "./Contagem";
import { FichaIndicador } from "./Detalhe";
import { EvolucaoSaude, Progressos } from "./Lateral";
import { NOMES_DIVISOES, VISUAL_STATUS, textoContagem } from "./visual";

type Slide = { tipo: "geral" } | { tipo: "divisao"; sigla: string };

const SEM_BARRA: Status[] = ["Aguardando informação", "Sem dados no mês de referência"];
const SETA = { melhora: "↑", piora: "↓", "estável": "→" } as const;

function statusDaSaude(s: number | null): Status | null {
  if (s === null) return null;
  if (s >= CORTE_ADEQUADO - 1e-9) return "Adequado";
  if (s >= CORTE_ATENCAO - 1e-9) return "Atenção";
  return "Crítico";
}

function Saude({ painel }: { painel: Painel }) {
  const s = painel.resumo.saudeGeral;
  const st = statusDaSaude(s);
  const v = st ? VISUAL_STATUS[st] : null;
  const delta = s !== null && painel.saudeAnterior !== null ? s - painel.saudeAnterior : null;
  const contagem = textoContagem(contarStatus(painel.indicadores));
  return (
    <section className="pg-ap-saude" aria-label="Saúde geral dos indicadores">
      <div className="pg-ap-saude-topo">
        <span className="pg-ap-saude-rotulo">Saúde geral dos indicadores</span>
        <span className="pg-ap-saude-valor" style={{ color: v?.cor ?? "var(--txt-2)" }}>
          {s === null ? "—" : fmtPercentual(s, 1)}
          <small>{st ?? "sem indicadores avaliáveis"}</small>
        </span>
      </div>
      <div className="pg-ap-saude-trilha" aria-hidden="true">
        {s !== null && <span style={{ width: larguraCss(s, 1), background: v?.cor }} />}
      </div>
      <div className="pg-ap-saude-rodape">
        {painel.anterior && <span>vs {painel.anterior.label}: <b>{fmtVariacaoPct(delta)}</b></span>}
        <span>tendência 3M: <b>{fmtVariacaoPct(painel.tendenciaSaude)}</b></span>
        {contagem && <span className="pg-ap-apagado">{contagem}</span>}
      </div>
    </section>
  );
}

/** Resultado em cima da coluna: número na 1ª linha e a unidade embaixo (unidades longas não cabem numa linha só). */
function RotuloValor({ valor, unidade, seta }: { valor: number | null; unidade: string; seta: string }) {
  const u = valor === null ? "" : unidadeCurta(unidade, valor);
  if (!u || u === "%" || u === "×") return <>{fmtValor(valor, unidade)} {seta}</>;
  return <>{fmtNumero(valor)} {seta}<small>{u}</small></>;
}

function Colunas({ inds, anterior, aoAbrir }: { inds: IndicadorPainel[]; anterior: string | null; aoAbrir: (i: IndicadorPainel) => void }) {
  const legenda: Status[] = ["Adequado", "Atenção", "Crítico", "Sem dados no mês de referência", "Aguardando informação"];
  return (
    <section className="pg-card pg-ap-grafico" aria-label="Indicadores da divisão">
      <div className="pg-ap-legenda">
        {legenda.map((s) => {
          const v = VISUAL_STATUS[s];
          return <span key={s}><v.Icone size={13} color={v.cor} aria-hidden="true" />{v.curto}</span>;
        })}
        <span className="pg-ap-apagado">
          altura da barra = distância da meta (— — meta) · número = resultado do indicador{anterior ? ` · barra fina e clara = ${anterior}` : ""} · toque na barra para ver o histórico
        </span>
      </div>
      <div className="pg-ap-colunas" style={{ gridTemplateColumns: `repeat(${inds.length}, minmax(0, 1fr))` }}>
        {inds.map((ind) => {
          const semBarra = SEM_BARRA.includes(ind.status);
          const v = VISUAL_STATUS[ind.status];
          const altura = larguraCss(ind.atingimento);
          const seta = ind.tendencia?.sentido ? SETA[ind.tendencia.sentido] : "";
          const ant = ind.mesAnterior;
          const antTemBarra = ant && !SEM_BARRA.includes(ant.status) && ant.atingimento !== null;
          return (
            <button key={ind.id} type="button" className="pg-ap-col" onClick={() => aoAbrir(ind)}
              title={`${ind.indicador} — meta ${metaExibida(ind.metaTxt, ind.metaNum, ind.unidade, ind.direcao)}`}>
              <span className="pg-ap-col-area">
                <span className="pg-ap-col-meta" style={{ bottom: larguraCss(CORTE_ADEQUADO) }} aria-hidden="true" />
                {antTemBarra && (
                  <span
                    className="pg-ap-col-ant"
                    style={{ height: larguraCss(ant.atingimento), background: VISUAL_STATUS[ant.status].cor }}
                    title={`${ant.label}: ${fmtValor(ant.valor, ind.unidade)}`}
                  />
                )}
                {semBarra ? (
                  <>
                    <span className="pg-ap-col-traco" style={{ background: v.cor }} />
                    <span className="pg-ap-col-rotulo" style={{ bottom: "10px", color: "var(--txt-2)" }}>
                      {ind.status === "Aguardando informação" ? "aguardando" : "sem dados no mês"}
                    </span>
                  </>
                ) : (
                  <>
                    <span className="pg-ap-col-barra" style={{ height: altura, background: v.cor }} />
                    <span className="pg-ap-col-rotulo" style={{ bottom: `calc(${altura} + 6px)` }}>
                      <RotuloValor valor={ind.valor} unidade={ind.unidade} seta={seta} />
                    </span>
                  </>
                )}
              </span>
              <span className="pg-ap-col-nome">{ind.indicador}</span>
            </button>
          );
        })}
      </div>
    </section>
  );
}

function VisaoGeral({ painel }: { painel: Painel }) {
  const r = painel.resumo;
  const c = r.completude;
  const delta = r.saudeGeral !== null && painel.saudeAnterior !== null ? r.saudeGeral - painel.saudeAnterior : null;
  const cards: [string, string, string, string][] = [
    ["Saúde geral", fmtPercentual(r.saudeGeral, 1), `vs ${painel.anterior?.label ?? "—"}: ${fmtVariacaoPct(delta)} · 3M: ${fmtVariacaoPct(painel.tendenciaSaude)}`, "#7FB8FF"],
    ["Adequados", String(r.adequados), `${r.adequados}/${r.n} avaliados`, "var(--ok)"],
    ["Atenção", String(r.atencao), `entre ${fmtPercentual(CORTE_ATENCAO)} e ${fmtPercentual(CORTE_ADEQUADO - 0.01)} da meta`, "var(--atencao)"],
    ["Críticos", String(r.criticos), `abaixo de ${fmtPercentual(CORTE_ATENCAO)} da meta`, "var(--critico)"],
    ["Completude", fmtPercentual(c.percentual), `${c.preenchidos} de ${c.esperados} preenchidos`, "var(--sem-dados)"],
  ];
  return (
    <div className="pg-ap-geral">
      <div className="pg-ap-cards">
        {cards.map(([rotulo, valor, sub, acento]) => (
          <div key={rotulo} className="pg-card pg-resumo" style={{ ["--acento" as string]: acento }}>
            <span className="pg-rotulo">{rotulo}</span>
            <span className="pg-ap-numero">{valor}</span>
            <span className="pg-sub">{sub}</span>
          </div>
        ))}
      </div>
      <div className="pg-ap-meio">
        <EvolucaoSaude painel={painel} maximo={12} />
        <div className="pg-ap-dir">
          <section className="pg-card pg-ap-piores" aria-label="Atenção prioritária">
            <div className="pg-secao-topo"><span className="pg-rotulo">Atenção prioritária</span></div>
            {painel.piores.map((i) => {
              const v = VISUAL_STATUS[i.status];
              return (
                <div className="pg-pior" key={i.id}>
                  <div className="pg-pior-topo">
                    <span className="pg-pior-nome">{i.divisaoExibida} · {i.indicador}</span>
                    <span className="pg-num" style={{ color: v.texto, fontWeight: 800, whiteSpace: "nowrap" }}>{fmtValor(i.valor, i.unidade)}</span>
                  </div>
                </div>
              );
            })}
          </section>
          <Progressos progressos={painel.avancos} anterior={painel.anterior?.label ?? null} />
        </div>
      </div>
    </div>
  );
}

export default function Apresentacao({ bd, catalogo, competencia, emColeta = null, inicio, geradoEm, aoSair }: {
  bd: LinhaBD[];
  catalogo: Record<string, FichaCatalogo>;
  competencia: string | null;
  /** Competência com a coleta aberta: a apresentação também não abre nela por padrão. */
  emColeta?: string | null;
  inicio: string | null;
  geradoEm: string;
  aoSair: () => void;
}) {
  const geral = useMemo(() => calcularPainel(bd, { competencia, catalogo, emColeta }), [bd, competencia, catalogo, emColeta]);
  const slides = useMemo<Slide[]>(() => {
    const siglas = [...geral.siglasDivisoes];
    for (const g of geral.grupos) if (!siglas.includes(g.divisao)) siglas.push(g.divisao);
    const ordem = (s: string) => { const i = ORDEM_DIVISOES.indexOf(s); return i < 0 ? 99 : i; };
    siglas.sort((a, b) => ordem(a) - ordem(b));
    return [{ tipo: "geral" }, ...siglas.map((sigla) => ({ tipo: "divisao" as const, sigla }))];
  }, [geral]);
  const [atual, setAtual] = useState(() => Math.max(0, slides.findIndex((s) => s.tipo === "divisao" && s.sigla === inicio)));
  const [detalhe, setDetalhe] = useState<IndicadorPainel | null>(null);
  const fecharDetalhe = useCallback(() => setDetalhe(null), []);
  const ref = useRef<HTMLDivElement>(null);
  const entrouEmTelaCheia = useRef(false);

  const slide = slides[Math.min(atual, slides.length - 1)];
  const painelDiv = useMemo(
    () => (slide.tipo === "divisao" ? calcularPainel(bd, { competencia, divisoes: [slide.sigla], catalogo, emColeta }) : null),
    [bd, competencia, slide, catalogo, emColeta],
  );

  const sair = useCallback(() => {
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
    aoSair();
  }, [aoSair]);
  const ir = useCallback((n: number) => { setDetalhe(null); setAtual(Math.max(0, Math.min(slides.length - 1, n))); }, [slides.length]);

  useEffect(() => { ref.current?.focus(); }, []);

  useEffect(() => {
    const aoMudarTelaCheia = () => {
      if (document.fullscreenElement) entrouEmTelaCheia.current = true;
      else if (entrouEmTelaCheia.current) aoSair();
    };
    if (document.fullscreenElement) entrouEmTelaCheia.current = true;
    document.addEventListener("fullscreenchange", aoMudarTelaCheia);
    return () => document.removeEventListener("fullscreenchange", aoMudarTelaCheia);
  }, [aoSair]);

  useEffect(() => {
    const tecla = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.preventDefault(); if (detalhe) setDetalhe(null); else sair(); return; }
      if (["ArrowRight", "PageDown", " "].includes(e.key)) { e.preventDefault(); ir(atual + 1); }
      if (["ArrowLeft", "PageUp"].includes(e.key)) { e.preventDefault(); ir(atual - 1); }
      if (e.key === "Home") { e.preventDefault(); ir(0); }
      if (e.key === "End") { e.preventDefault(); ir(slides.length - 1); }
    };
    window.addEventListener("keydown", tecla);
    return () => window.removeEventListener("keydown", tecla);
  }, [atual, detalhe, ir, sair, slides.length]);

  const ref_ = geral.referencia;

  return createPortal(
    <div ref={ref} className="pg-tokens pg-ap" role="dialog" aria-modal="true" aria-label="Painel de Governança — modo apresentação" tabIndex={-1}>
      <header className="pg-ap-topo">
        {slide.tipo === "divisao" ? (
          <button type="button" className="pg-ap-icone" onClick={() => ir(0)} title="Visão geral" aria-label="Visão geral">
            <House size={30} />
          </button>
        ) : <span className="pg-ap-icone-vazio" />}
        <h2 className="pg-ap-titulo">
          {slide.tipo === "geral" ? "Painel de Governança — GAP-MN" : NOMES_DIVISOES[slide.sigla] ?? slide.sigla}
        </h2>
        {ref_ && (
          <span className="pg-selo" title={`Dados de ${fmtGeradoEm(geradoEm)}`}>
            Referência: <b style={{ color: "var(--txt-1)" }}>{competenciaPorExtenso(ref_.label)}</b>
            {geral.anterior && <> · vs {geral.anterior.label}</>}
          </span>
        )}
      </header>

      <main className="pg-ap-conteudo">
        {slide.tipo === "geral" ? (
          <VisaoGeral painel={geral} />
        ) : painelDiv && (
          <div className="pg-ap-div" style={painelDiv.indicadores.length ? undefined : { gridTemplateRows: "minmax(0, 1fr)" }}>
            {painelDiv.indicadores.length > 0 && <Saude painel={painelDiv} />}
            <div className="pg-ap-corpo">
              {painelDiv.indicadores.length > 0 && <Colunas inds={painelDiv.indicadores} anterior={painelDiv.anterior?.label ?? null} aoAbrir={setDetalhe} />}
              {painelDiv.grupos.map((g) => (
                <div key={g.categoria} className={painelDiv.indicadores.length ? "pg-ap-grupo" : "pg-ap-grupo pg-ap-grupo-largo"}>
                  <CartaoGrupo g={g} competencia={ref_?.label ?? ""} largo={!painelDiv.indicadores.length && g.itens.length > 6} />
                </div>
              ))}
              {painelDiv.indicadores.length === 0 && painelDiv.grupos.length === 0 && (
                <div className="pg-card pg-vazio" style={{ flex: 1 }}>Nenhum indicador desta divisão na competência.</div>
              )}
            </div>
          </div>
        )}
      </main>

      <footer className="pg-ap-rodape">
        <button type="button" className="pg-ap-icone" onClick={() => ir(atual - 1)} disabled={atual === 0} aria-label="Tela anterior">
          <ChevronLeft size={22} />
        </button>
        <nav className="pg-ap-abas" aria-label="Telas">
          {slides.map((s, k) => (
            <button key={k} type="button" data-ativa={k === atual ? "1" : undefined} onClick={() => ir(k)}>
              {s.tipo === "geral" ? "Geral" : s.sigla}
            </button>
          ))}
        </nav>
        <button type="button" className="pg-ap-icone" onClick={() => ir(atual + 1)} disabled={atual === slides.length - 1} aria-label="Próxima tela">
          <ChevronRight size={22} />
        </button>
        <span className="pg-sub pg-ap-dica">← → navegam · Esc sai</span>
        <button type="button" className="pg-btn" onClick={sair}><X size={14} aria-hidden="true" /> Sair</button>
      </footer>

      {detalhe && ref_ && <FichaIndicador ind={detalhe} competencia={ref_.label} aoFechar={fecharDetalhe} />}
    </div>,
    document.body,
  );
}
