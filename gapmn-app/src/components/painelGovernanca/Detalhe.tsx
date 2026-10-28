// Detalhe do indicador: conteúdo do tooltip e a ficha com o histórico completo
// (aberta ao clicar no indicador, no painel e no modo apresentação).

import { Fragment, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { MessageSquare, X } from "lucide-react";
import { CORTE_ADEQUADO } from "../../lib/indicadores/calculo.ts";
import { VERSAO_CATALOGO } from "../../lib/indicadores/catalogo.ts";
import {
  fmtNumero, fmtTendencia, fmtValor, fraseVariacao, larguraCss, metaExibida,
} from "../../lib/indicadores/formato.ts";
import type { IndicadorPainel, PontoHistorico, Status } from "../../lib/indicadores/tipos.ts";
import { StatusChip } from "./Comum";
import { VISUAL_STATUS, setaMesAnterior } from "./visual";

const SEM_BARRA: Status[] = ["Aguardando informação", "Sem dados no mês de referência"];

function partesVariavel(nome: string): [string, string] {
  const i = nome.indexOf("=");
  return i > 0 ? [nome.slice(0, i).trim(), nome.slice(i + 1).trim()] : [nome.trim(), ""];
}

function MesAnterior({ ind }: { ind: IndicadorPainel }) {
  const ant = ind.mesAnterior;
  if (!ant) return null;
  const s = setaMesAnterior(ind);
  return (
    <>
      <dt>Mês anterior</dt>
      <dd style={{ gridColumn: "span 3" }}>
        {ant.label}: {fmtValor(ant.valor, ind.unidade)} · <StatusChip status={ant.status} curto />
        {s && <span style={{ color: s.cor, marginLeft: 6 }}>{s.seta} {s.texto}</span>}
      </dd>
    </>
  );
}

/** Justificativa da divisão em destaque, na cor do status (no tooltip, cortada em 4 linhas). */
function Justificativa({ ind, competencia, dica }: { ind: IndicadorPainel; competencia: string; dica: boolean }) {
  if (!ind.comentario) return null;
  const cor = VISUAL_STATUS[ind.status]?.cor ?? "var(--atencao)";
  return (
    <div className="pg-just" style={{ ["--cor-just" as string]: cor }} data-dica={dica ? "1" : undefined}>
      <div className="pg-just-tit">
        <MessageSquare size={14} aria-hidden="true" />
        Justificativa da divisão · {competencia}{ind.temAnexo ? " · com comprovante" : ""}
      </div>
      <p className="pg-just-texto">{ind.comentario}</p>
    </div>
  );
}

/** Conteúdo do tooltip e do topo da ficha. */
export function DetalheIndicador({ ind, competencia, dica = false }: { ind: IndicadorPainel; competencia: string; dica?: boolean }) {
  const aguardando = ind.status === "Aguardando informação";
  const semDados = ind.status === "Sem dados no mês de referência";
  const t = ind.tendencia;
  return (
    <>
      <p className="pg-tt-nome">{ind.indicador}</p>
      <div className="pg-sub">{aguardando ? ind.categoriaExibida : `${ind.divisaoExibida} · ${ind.categoriaExibida}`}</div>
      <Justificativa ind={ind} competencia={competencia} dica={dica} />
      {ind.catalogo?.objetivo && <p className="pg-objetivo">{ind.catalogo.objetivo}</p>}

      {aguardando ? (
        <>
          <p style={{ margin: "10px 0 0" }}>Informação ainda não registrada para esta competência.</p>
          {ind.mesAnterior && <dl className="pg-tt-grade"><MesAnterior ind={ind} /></dl>}
        </>
      ) : (
        <>
          <dl className="pg-tt-grade">
            <dt className="pg-tt-meta-rot">Meta</dt>
            <dd style={{ gridColumn: "span 3" }}><span className="pg-tt-meta">{metaExibida(ind.metaTxt, ind.metaNum, ind.unidade, ind.direcao)}</span></dd>
            <dt>Resultado</dt><dd>{fmtValor(ind.valor, ind.unidade)}</dd>
            <dt>Status</dt><dd><StatusChip status={ind.status} curto /></dd>
            <MesAnterior ind={ind} />
            <dt>Tendência 3M</dt>
            <dd style={{ gridColumn: "span 3" }}>
              {fmtTendencia(t, ind.unidade)}{t?.sentido && t.sentido !== "estável" ? ` (${t.sentido})` : ""}
            </dd>
          </dl>
          {semDados && <p style={{ margin: 0 }}>Não houve, nesta competência, o evento que serve de base para o cálculo.</p>}
          {ind.variacao && <p style={{ margin: 0 }}>{fraseVariacao(ind.variacao.de, ind.variacao.para)}</p>}
          {ind.formula && (
            <div className="pg-tt-bloco">
              <div className="pg-rotulo">Como é calculado</div>
              <div className="pg-formula">{ind.formula}</div>
            </div>
          )}
          {ind.variaveis.length > 0 && (
            <div className="pg-tt-bloco">
              <div className="pg-rotulo">Variáveis informadas ({competencia}){ind.temAnexo ? " · com comprovante" : ""}</div>
              {ind.variaveis.map((v) => {
                const [simbolo, descricao] = partesVariavel(v.nome);
                return (
                  <div className="pg-var" key={v.nome}>
                    <b>{simbolo} = {fmtNumero(v.valor)}</b>
                    {descricao && <span>({descricao})</span>}
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}
      {dica && (ind.comentario || ind.historico.length > 1) && (
        <p className="pg-sub" style={{ margin: "10px 0 0" }}>
          {ind.comentario ? "Clique para ler a justificativa inteira e o histórico." : "Clique para ver o histórico completo."}
        </p>
      )}
    </>
  );
}

function GraficoHistorico({ historico, competencia, unidade }: { historico: PontoHistorico[]; competencia: string; unidade: string }) {
  return (
    <div className="pg-hist-graf" style={{ gridTemplateColumns: `repeat(${historico.length}, minmax(0, 1fr))` }} aria-hidden="true">
      {historico.map((h) => {
        const v = VISUAL_STATUS[h.status];
        const semBarra = SEM_BARRA.includes(h.status) || h.atingimento === null;
        const altura = larguraCss(h.atingimento);
        return (
          <div className="pg-hist-col" key={h.data} data-atual={h.label === competencia ? "1" : undefined}>
            <div className="pg-hist-area">
              <span className="pg-ap-col-meta" style={{ bottom: larguraCss(CORTE_ADEQUADO) }} />
              {semBarra ? (
                <span className="pg-hist-traco" style={{ background: v.cor }} />
              ) : (
                <>
                  <span className="pg-hist-barra" style={{ height: altura, background: v.cor }} />
                  <span className="pg-hist-rot" style={{ bottom: `calc(${altura} + 3px)` }}>{fmtValor(h.valor, unidade)}</span>
                </>
              )}
            </div>
            <div className="pg-hist-comp">{h.label}</div>
          </div>
        );
      })}
    </div>
  );
}

/** Ficha do indicador: o resultado exibido, o mês anterior e o histórico de todas as competências. */
export function FichaIndicador({ ind, competencia, aoFechar, devolverFoco = false }: {
  ind: IndicadorPainel;
  competencia: string;
  aoFechar: () => void;
  /** Aberta pelo teclado: ao fechar, o foco volta para onde estava. Pelo mouse/toque, não (evita reabrir o tooltip). */
  devolverFoco?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const antes = document.activeElement as HTMLElement | null;
    ref.current?.focus();
    // Captura antes dos atalhos do modo apresentação: Esc fecha só a ficha e as setas não trocam de tela.
    const tecla = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); aoFechar(); return; }
      if (["ArrowLeft", "ArrowRight", "PageUp", "PageDown", "Home", "End", " "].includes(e.key)) e.stopPropagation();
    };
    window.addEventListener("keydown", tecla, true);
    return () => {
      window.removeEventListener("keydown", tecla, true);
      if (devolverFoco) antes?.focus?.();
    };
  }, [aoFechar, devolverFoco]);

  const linhas = [...ind.historico].reverse();
  return createPortal(
    <div className="pg-ap-detalhe" onClick={aoFechar}>
      <div
        ref={ref}
        className="pg-tokens pg-ficha"
        role="dialog"
        aria-modal="true"
        aria-label={`Histórico: ${ind.indicador}`}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="pg-ficha-topo">
          <span className="pg-rotulo">Indicador {ind.id} · {ind.divisaoExibida}</span>
          <button type="button" className="pg-ap-icone" onClick={aoFechar} aria-label="Fechar"><X size={20} /></button>
        </div>
        <DetalheIndicador ind={ind} competencia={competencia} />

        {ind.catalogo && (
          <div className="pg-tt-bloco">
            <div className="pg-rotulo">Ficha técnica (Catálogo de Indicadores, {VERSAO_CATALOGO})</div>
            <dl className="pg-tt-grade pg-ficha-tecnica">
              {ind.catalogo.origem && <><dt>Origem dos dados</dt><dd>{ind.catalogo.origem}</dd></>}
              {ind.catalogo.periodicidade && <><dt>Periodicidade</dt><dd>{ind.catalogo.periodicidade}</dd></>}
              {ind.catalogo.meta && <><dt>Meta no catálogo</dt><dd>{ind.catalogo.meta}</dd></>}
              {ind.catalogo.unidade && <><dt>Unidade no catálogo</dt><dd>{ind.catalogo.unidade}</dd></>}
            </dl>
          </div>
        )}

        {ind.orientacao && (
          <div className="pg-tt-bloco">
            <div className="pg-rotulo">Como preencher</div>
            <p className="pg-orientacao">{ind.orientacao}</p>
          </div>
        )}

        {ind.historico.length > 0 && (
          <div className="pg-tt-bloco">
            <div className="pg-rotulo">Histórico (resultado por competência; a altura da barra mostra a distância da meta)</div>
            <GraficoHistorico historico={ind.historico} competencia={competencia} unidade={ind.unidade} />
            <div className="pg-hist-tabela">
              <table className="pg-hist">
                <thead>
                  <tr><th>Competência</th><th>Resultado</th><th>Status</th><th>Variáveis</th></tr>
                </thead>
                <tbody>
                  {linhas.map((h) => (
                    <Fragment key={h.data}>
                      <tr data-atual={h.label === competencia ? "1" : undefined}>
                        <td style={{ whiteSpace: "nowrap" }}>
                          {h.label}
                          {h.label === competencia && <span className="pg-hist-marca">exibida</span>}
                          {ind.mesAnterior?.data === h.data && <span className="pg-hist-marca">mês anterior</span>}
                        </td>
                        <td style={{ whiteSpace: "nowrap" }}>{fmtValor(h.valor, ind.unidade)}</td>
                        <td><StatusChip status={h.status} curto /></td>
                        <td className="pg-sub">{h.variaveis.map((v) => `${partesVariavel(v.nome)[0]} = ${fmtNumero(v.valor)}`).join(" · ") || "—"}</td>
                      </tr>
                      {h.comentario && (
                        <tr className="pg-hist-just" data-atual={h.label === competencia ? "1" : undefined}>
                          <td colSpan={4}><MessageSquare size={12} aria-hidden="true" /> Justificativa: “{h.comentario}”</td>
                        </tr>
                      )}
                    </Fragment>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
