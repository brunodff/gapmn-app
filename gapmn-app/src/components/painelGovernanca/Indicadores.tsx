import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Search } from "lucide-react";
import { CORTE_ADEQUADO, STATUS, filtrarIndicadores } from "../../lib/indicadores/calculo.ts";
import { temFiltro, type EstadoFiltros } from "../../lib/indicadores/filtros.ts";
import {
  competenciaPorExtenso, fmtNumero, fmtPercentual, fmtTendencia, fmtValor, fraseVariacao, larguraCss, metaExibida,
} from "../../lib/indicadores/formato.ts";
import type { IndicadorPainel, Painel, Status } from "../../lib/indicadores/tipos.ts";
import { MultiSelect, StatusChip } from "./Comum";
import { VISUAL_STATUS } from "./visual";

type Alvo = { id: string; fixado: boolean; x?: number; left: number; top?: number; bottom?: number; maxHeight: number };

const SEM_BARRA: Status[] = ["Aguardando informação", "Sem dados no mês de referência"];

/** Posição do tooltip junto da linha, sem sair da tela. */
function posicao(el: HTMLElement, clientX?: number): Omit<Alvo, "id" | "fixado" | "x"> {
  const r = el.getBoundingClientRect();
  const largura = Math.min(380, window.innerWidth - 24);
  const base = clientX ?? r.left + 48;
  const left = Math.max(12, Math.min(base - 24, window.innerWidth - largura - 12));
  const abaixo = window.innerHeight - r.bottom;
  if (abaixo >= 320 || abaixo >= r.top) return { left, top: r.bottom + 6, maxHeight: abaixo - 18 };
  return { left, bottom: window.innerHeight - r.top + 6, maxHeight: r.top - 18 };
}

function partesVariavel(nome: string): [string, string] {
  const i = nome.indexOf("=");
  return i > 0 ? [nome.slice(0, i).trim(), nome.slice(i + 1).trim()] : [nome.trim(), ""];
}

function Tooltip({ ind, alvo, competencia }: { ind: IndicadorPainel; alvo: Alvo; competencia: string }) {
  const aguardando = ind.status === "Aguardando informação";
  const semDados = ind.status === "Sem dados no mês de referência";
  const t = ind.tendencia;
  return createPortal(
    <div
      id="pg-tooltip"
      role="tooltip"
      className="pg-tokens pg-tooltip"
      style={{ left: alvo.left, top: alvo.top, bottom: alvo.bottom, maxHeight: Math.max(160, alvo.maxHeight) }}
    >
      <p className="pg-tt-nome">{ind.indicador}</p>
      <div className="pg-sub">{aguardando ? ind.categoriaExibida : `${ind.divisaoExibida} · ${ind.categoriaExibida}`}</div>

      {aguardando ? (
        <p style={{ margin: "10px 0 0" }}>Informação ainda não registrada para esta competência.</p>
      ) : (
        <>
          <dl className="pg-tt-grade">
            <dt>Resultado</dt><dd>{fmtValor(ind.valor, ind.unidade)}</dd>
            <dt>Meta</dt><dd>{metaExibida(ind.metaTxt, ind.metaNum, ind.unidade, ind.direcao)}</dd>
            <dt>Atingimento</dt><dd>{fmtPercentual(ind.atingimento)}</dd>
            <dt>Status</dt><dd><StatusChip status={ind.status} curto /></dd>
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
              <div className="pg-rotulo">Variáveis informadas ({competencia})</div>
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
    </div>,
    document.body,
  );
}

function Linha({ ind, ativa, aoAbrir, aoFechar, aoAlternar }: {
  ind: IndicadorPainel;
  ativa: boolean;
  aoAbrir: (el: HTMLElement, x?: number) => void;
  aoFechar: (forcar: boolean) => void;
  aoAlternar: (el: HTMLElement, x?: number) => void;
}) {
  const semBarra = SEM_BARRA.includes(ind.status);
  const v = VISUAL_STATUS[ind.status];
  return (
    <div
      className="pg-linha"
      role="listitem"
      tabIndex={0}
      data-ativa={ativa ? "1" : undefined}
      aria-describedby={ativa ? "pg-tooltip" : undefined}
      onMouseEnter={(e) => aoAbrir(e.currentTarget, e.clientX)}
      onMouseLeave={() => aoFechar(false)}
      onFocus={(e) => aoAbrir(e.currentTarget)}
      onBlur={() => aoFechar(true)}
      onClick={(e) => aoAlternar(e.currentTarget, e.clientX)}
      onKeyDown={(e) => {
        if (e.key === "Escape") aoFechar(true);
        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); aoAlternar(e.currentTarget); }
      }}
    >
      <div className="pg-linha-topo">
        <span className="pg-id">{ind.id}</span>
        <span className="pg-nome" title={ind.indicador}>{ind.indicador}</span>
        <span className="pg-valor">
          {fmtValor(ind.valor, ind.unidade)}
          <span className="pg-meta">(meta: {metaExibida(ind.metaTxt, ind.metaNum, ind.unidade, ind.direcao)})</span>
        </span>
      </div>
      <div className="pg-linha-base">
        {semBarra ? (
          <span className="pg-tracejado" aria-hidden="true" />
        ) : (
          <span className="pg-trilha" aria-hidden="true">
            <span className="pg-barra" style={{ width: larguraCss(ind.atingimento), background: v.cor }} />
            <span className="pg-marca-meta" style={{ left: larguraCss(CORTE_ADEQUADO) }} />
          </span>
        )}
        {!semBarra && <span className="pg-ating" style={{ color: v.texto }}>{fmtPercentual(ind.atingimento)}</span>}
        <StatusChip status={ind.status} curto />
        <span className="pg-div">{ind.divisaoExibida}</span>
      </div>
    </div>
  );
}

export default function Indicadores({ painel, filtros, aoMudar }: {
  painel: Painel;
  filtros: EstadoFiltros;
  aoMudar: (f: Partial<EstadoFiltros>) => void;
}) {
  const divisoes = useMemo(
    () => painel.divisoes.map((d) => d.sigla).filter((s) => painel.indicadores.some((i) => i.divisaoExibida === s)),
    [painel.divisoes, painel.indicadores],
  );
  const categorias = useMemo(() => {
    const vistas = new Map<string, number>();
    for (const i of painel.indicadores) if (!vistas.has(i.categoriaExibida)) vistas.set(i.categoriaExibida, parseInt(i.categoria, 10) || 99);
    return [...vistas.entries()].sort((a, b) => a[1] - b[1] || a[0].localeCompare(b[0])).map(([c]) => c);
  }, [painel.indicadores]);
  const opcoesStatus = useMemo(() => STATUS.filter((s) => s !== "Sem meta"), []);

  // Busca: o campo guarda o texto e só grava na URL depois de uma pausa na digitação
  // (gravar a cada tecla perdia letras e impedia o espaço entre palavras).
  const [busca, setBusca] = useState(filtros.busca);
  useEffect(() => {
    if (busca === filtros.busca) return;
    const t = setTimeout(() => aoMudar({ busca }), 250);
    return () => clearTimeout(t);
  }, [busca, filtros.busca, aoMudar]);
  const efetivos = useMemo(() => ({ ...filtros, busca }), [filtros, busca]);
  const visiveis = useMemo(() => filtrarIndicadores(painel.indicadores, efetivos), [painel.indicadores, efetivos]);

  // Estado do tooltip espelhado em ref: os eventos (hover, foco, rolagem) decidem na hora,
  // sem esperar o React aplicar a atualização anterior.
  const [alvo, setAlvo] = useState<Alvo | null>(null);
  const alvoRef = useRef<Alvo | null>(null);
  const elAlvo = useRef<HTMLElement | null>(null);
  const definir = useCallback((a: Alvo | null) => { alvoRef.current = a; setAlvo(a); }, []);

  const abrir = useCallback((id: string, el: HTMLElement, x?: number) => {
    const a = alvoRef.current;
    if (a?.fixado && a.id !== id) return;
    elAlvo.current = el;
    definir({ id, x, fixado: a?.id === id ? a.fixado : false, ...posicao(el, x) });
  }, [definir]);
  const fechar = useCallback((forcar: boolean) => {
    const a = alvoRef.current;
    if (a && (forcar || !a.fixado)) definir(null);
  }, [definir]);
  const alternar = useCallback((id: string, el: HTMLElement, x?: number) => {
    const a = alvoRef.current;
    if (a && a.id === id && a.fixado) { definir(null); return; }
    elAlvo.current = el;
    definir({ id, x, fixado: true, ...posicao(el, x) });
  }, [definir]);

  // Na rolagem o tooltip acompanha a linha; só fecha quando a linha sai da tela.
  const aberto = alvo !== null;
  useEffect(() => {
    if (!aberto) return;
    const seguir = () => {
      const a = alvoRef.current, el = elAlvo.current;
      if (!a) return;
      const r = el?.isConnected ? el.getBoundingClientRect() : null;
      if (!el || !r || r.bottom < 0 || r.top > window.innerHeight) { definir(null); return; }
      definir({ ...a, ...posicao(el, a.x) });
    };
    window.addEventListener("scroll", seguir, true);
    window.addEventListener("resize", seguir);
    return () => { window.removeEventListener("scroll", seguir, true); window.removeEventListener("resize", seguir); };
  }, [aberto, definir]);

  const ativo = alvo ? painel.indicadores.find((i) => i.id === alvo.id) ?? null : null;
  const ref = painel.referencia;
  const filtrado = temFiltro(efetivos);

  return (
    <section aria-label="Desempenho por indicador">
      <div className="pg-secao-topo">
        <span className="pg-rotulo">Desempenho por indicador</span>
        <span className="pg-sub">
          {filtrado ? `${visiveis.length} de ${painel.indicadores.length} indicadores` : `${painel.indicadores.length} indicadores com meta`}
        </span>
      </div>

      <div className="pg-filtros">
        <MultiSelect rotulo="Divisão" opcoes={divisoes} valores={filtros.divisoes} aoMudar={(v) => aoMudar({ divisoes: v })} />
        <MultiSelect rotulo="Categoria" opcoes={categorias} valores={filtros.categorias} aoMudar={(v) => aoMudar({ categorias: v })} />
        <MultiSelect
          rotulo="Status"
          vazio="todos"
          opcoes={opcoesStatus}
          valores={filtros.status}
          aoMudar={(v) => aoMudar({ status: v as Status[] })}
        />
        <select
          className="pg-campo"
          aria-label="Competência"
          value={ref?.label ?? ""}
          onChange={(e) => aoMudar({ competencia: e.target.value === painel.referenciaPadrao?.label ? null : e.target.value })}
        >
          {[...painel.competenciasComDados].reverse().map((c) => (
            <option key={c.data} value={c.label} title={competenciaPorExtenso(c.label)}>
              Competência: {c.label}{c.data === painel.referenciaPadrao?.data ? " (padrão)" : ""}
            </option>
          ))}
        </select>
        <label className="pg-busca">
          <Search size={14} aria-hidden="true" />
          <input
            className="pg-campo"
            type="search"
            placeholder="Buscar indicador"
            aria-label="Buscar indicador pelo nome ou número"
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
          />
        </label>
        {filtrado && (
          <button type="button" className="pg-btn pg-btn-texto" onClick={() => { setBusca(""); aoMudar({ divisoes: [], categorias: [], status: [], busca: "" }); }}>
            Limpar filtros
          </button>
        )}
      </div>

      {visiveis.length === 0 ? (
        <div className="pg-vazio">Nenhum indicador com esses filtros.</div>
      ) : (
        <div className="pg-lista" role="list">
          {visiveis.map((ind) => (
            <Linha
              key={ind.id}
              ind={ind}
              ativa={alvo?.id === ind.id}
              aoAbrir={(el, x) => abrir(ind.id, el, x)}
              aoFechar={fechar}
              aoAlternar={(el, x) => alternar(ind.id, el, x)}
            />
          ))}
        </div>
      )}

      {ativo && alvo && ref && <Tooltip ind={ativo} alvo={alvo} competencia={ref.label} />}
    </section>
  );
}
