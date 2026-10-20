import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Search } from "lucide-react";
import { CORTE_ADEQUADO, STATUS, filtrarIndicadores } from "../../lib/indicadores/calculo.ts";
import { temFiltro, type EstadoFiltros } from "../../lib/indicadores/filtros.ts";
import { competenciaPorExtenso, fmtValor, larguraCss, metaExibida } from "../../lib/indicadores/formato.ts";
import type { IndicadorPainel, Painel, Status } from "../../lib/indicadores/tipos.ts";
import { MultiSelect, StatusChip } from "./Comum";
import { DetalheIndicador, FichaIndicador } from "./Detalhe";
import { VISUAL_STATUS, setaMesAnterior } from "./visual";

type Alvo = { id: string; x?: number; left: number; top?: number; bottom?: number; maxHeight: number };

const SEM_BARRA: Status[] = ["Aguardando informação", "Sem dados no mês de referência"];

/** Posição do tooltip junto da linha, sem sair da tela. */
function posicao(el: HTMLElement, clientX?: number): Omit<Alvo, "id" | "x"> {
  const r = el.getBoundingClientRect();
  const largura = Math.min(380, window.innerWidth - 24);
  const base = clientX ?? r.left + 48;
  const left = Math.max(12, Math.min(base - 24, window.innerWidth - largura - 12));
  const abaixo = window.innerHeight - r.bottom;
  if (abaixo >= 320 || abaixo >= r.top) return { left, top: r.bottom + 6, maxHeight: abaixo - 18 };
  return { left, bottom: window.innerHeight - r.top + 6, maxHeight: r.top - 18 };
}

function Tooltip({ ind, alvo, competencia }: { ind: IndicadorPainel; alvo: Alvo; competencia: string }) {
  return createPortal(
    <div
      id="pg-tooltip"
      role="tooltip"
      className="pg-tokens pg-tooltip"
      style={{ left: alvo.left, top: alvo.top, bottom: alvo.bottom, maxHeight: Math.max(160, alvo.maxHeight) }}
    >
      <DetalheIndicador ind={ind} competencia={competencia} dica />
    </div>,
    document.body,
  );
}

function Linha({ ind, ativa, aoAbrir, aoFechar, aoFicha }: {
  ind: IndicadorPainel;
  ativa: boolean;
  aoAbrir: (el: HTMLElement, x?: number) => void;
  aoFechar: () => void;
  aoFicha: (teclado: boolean) => void;
}) {
  const semBarra = SEM_BARRA.includes(ind.status);
  const v = VISUAL_STATUS[ind.status];
  const ant = ind.mesAnterior;
  const seta = setaMesAnterior(ind);
  return (
    <div
      className="pg-linha"
      role="listitem"
      tabIndex={0}
      data-ativa={ativa ? "1" : undefined}
      aria-describedby={ativa ? "pg-tooltip" : undefined}
      onMouseEnter={(e) => aoAbrir(e.currentTarget, e.clientX)}
      onMouseLeave={aoFechar}
      onFocus={(e) => aoAbrir(e.currentTarget)}
      onBlur={aoFechar}
      onClick={() => aoFicha(false)}
      onKeyDown={(e) => {
        if (e.key === "Escape") aoFechar();
        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); aoFicha(true); }
      }}
    >
      <div className="pg-linha-topo">
        <span className="pg-id">{ind.id}</span>
        <span className="pg-nome" title={ind.indicador}>{ind.indicador}</span>
        <span className="pg-valor">
          <span className="pg-meta">meta {metaExibida(ind.metaTxt, ind.metaNum, ind.unidade, ind.direcao)}</span>
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
        {!semBarra && <span className="pg-ating" style={{ color: v.texto }}>{fmtValor(ind.valor, ind.unidade)}</span>}
        <StatusChip status={ind.status} curto />
        {ant && (
          <span className="pg-ant" title={`Resultado em ${ant.label}: ${ant.status}${seta ? ` (atual ${seta.texto})` : ""}`}>
            {seta && <b style={{ color: seta.cor }} aria-hidden="true">{seta.seta}</b>}
            {ant.label}: <b>{fmtValor(ant.valor, ind.unidade)}</b>
          </span>
        )}
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
  const divisoes = painel.siglasDivisoes;
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

  const [ficha, setFicha] = useState<{ ind: IndicadorPainel; teclado: boolean } | null>(null);
  const abrir = useCallback((id: string, el: HTMLElement, x?: number) => {
    elAlvo.current = el;
    definir({ id, x, ...posicao(el, x) });
  }, [definir]);
  const fechar = useCallback(() => { if (alvoRef.current) definir(null); }, [definir]);
  const abrirFicha = useCallback((ind: IndicadorPainel, teclado: boolean) => { definir(null); setFicha({ ind, teclado }); }, [definir]);
  const fecharFicha = useCallback(() => setFicha(null), []);

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
          {filtrado ? `${visiveis.length} de ${painel.totalIndicadores} indicadores` : `${painel.totalIndicadores} indicadores com meta`}
          {painel.anterior && ` · resultado de ${ref?.label} com ${painel.anterior.label} ao lado · clique para o histórico`}
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
              aoFicha={(teclado) => abrirFicha(ind, teclado)}
            />
          ))}
        </div>
      )}

      {ativo && alvo && ref && !ficha && <Tooltip ind={ativo} alvo={alvo} competencia={ref.label} />}
      {ficha && ref && <FichaIndicador ind={ficha.ind} competencia={ref.label} aoFechar={fecharFicha} devolverFoco={ficha.teclado} />}
    </section>
  );
}
