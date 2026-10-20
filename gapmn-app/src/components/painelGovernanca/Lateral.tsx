import { fmtPercentual, fmtValor, fmtVariacaoPct, larguraCss, metaExibida } from "../../lib/indicadores/formato.ts";
import type { IndicadorPainel, Painel } from "../../lib/indicadores/tipos.ts";
import { VISUAL_STATUS, setaMesAnterior } from "./visual";

// Coluna da direita. Sem ranking entre divisões (decisão de 20/10/2026): o painel mostra a
// evolução da organização e os indicadores que pedem atenção ou que mais progrediram.
// Os números são o resultado do próprio indicador; o atingimento da meta só decide o status
// e a ordem das listas (pedido de 20/10/2026).

const meta = (i: IndicadorPainel) => metaExibida(i.metaTxt, i.metaNum, i.unidade, i.direcao);

/** Saúde geral em cada competência (respeita o filtro de divisão do painel). */
export function EvolucaoSaude({ painel, maximo = 6 }: { painel: Painel; maximo?: number }) {
  const serie = painel.serieSaude.slice(-maximo);
  const r = painel.resumo;
  const delta = r.saudeGeral !== null && painel.saudeAnterior !== null ? r.saudeGeral - painel.saudeAnterior : null;
  const escopo = painel.filtroDivisoes.length ? painel.filtroDivisoes.join(", ") : "todas as divisões";
  return (
    <section className="pg-card pg-evolucao" aria-label="Evolução da saúde geral">
      <div className="pg-secao-topo">
        <span className="pg-rotulo">Evolução da saúde geral</span>
        <span className="pg-sub">{escopo}</span>
      </div>
      {serie.length === 0 ? (
        <div className="pg-vazio">Sem competências com dado.</div>
      ) : (
        <div className="pg-evo-graf" style={{ gridTemplateColumns: `repeat(${serie.length}, minmax(0, 1fr))` }}>
          {serie.map((s) => {
            const atual = s.data === painel.referencia?.data;
            return (
              <div className="pg-evo-col" key={s.data} data-atual={atual ? "1" : undefined}>
                <div className="pg-evo-area">
                  {s.saude === null ? (
                    <span className="pg-hist-traco" style={{ background: "var(--neutro)" }} title="Sem indicadores avaliáveis" />
                  ) : (
                    <>
                      <span className="pg-evo-barra" style={{ height: larguraCss(s.saude, 1) }} />
                      <span className="pg-evo-rot" style={{ bottom: `calc(${larguraCss(s.saude, 1)} + 3px)` }}>
                        {fmtPercentual(s.saude, 1)}
                      </span>
                    </>
                  )}
                </div>
                <div className="pg-evo-comp">{s.label}</div>
              </div>
            );
          })}
        </div>
      )}
      <div className="pg-sub">
        {painel.anterior && <>vs {painel.anterior.label}: <b>{fmtVariacaoPct(delta)}</b> · </>}
        tendência 3M: <b>{fmtVariacaoPct(painel.tendenciaSaude)}</b>
      </div>
    </section>
  );
}

export function Piores({ piores }: { piores: IndicadorPainel[] }) {
  return (
    <section className="pg-card" aria-label="Atenção prioritária">
      <div className="pg-secao-topo">
        <span className="pg-rotulo">Atenção prioritária</span>
        <span className="pg-sub">mais longe da meta</span>
      </div>
      {piores.length === 0 ? (
        <div className="pg-vazio">Nenhum indicador em atenção ou crítico nesta competência.</div>
      ) : (
        piores.map((i) => {
          const v = VISUAL_STATUS[i.status];
          return (
            <div className="pg-pior" key={i.id}>
              <div className="pg-pior-topo">
                <span className="pg-pior-nome">{i.id} · {i.indicador}</span>
                <span className="pg-num" style={{ color: v.texto, fontWeight: 800, fontSize: 13, whiteSpace: "nowrap" }}>
                  <v.Icone size={12} color={v.cor} aria-hidden="true" style={{ display: "inline-block", verticalAlign: "-1px", marginRight: 3 }} />
                  {fmtValor(i.valor, i.unidade)}
                </span>
              </div>
              <div className="pg-sub">{i.divisaoExibida} · meta {meta(i)}</div>
            </div>
          );
        })
      )}
    </section>
  );
}

/** Indicadores que mais progrediram em relação à competência anterior (pela distância da meta). */
export function Progressos({ progressos, anterior }: { progressos: IndicadorPainel[]; anterior: string | null }) {
  return (
    <section className="pg-card" aria-label="Progressos">
      <div className="pg-secao-topo">
        <span className="pg-rotulo">Progressos</span>
        {anterior && <span className="pg-sub">em relação a {anterior}</span>}
      </div>
      {progressos.length === 0 ? (
        <div className="pg-vazio">
          {anterior ? `Nenhum indicador progrediu em relação a ${anterior}.` : "Sem competência anterior para comparar."}
        </div>
      ) : (
        progressos.map((i) => {
          const v = VISUAL_STATUS[i.status];
          const seta = setaMesAnterior(i)?.seta ?? "↑";
          return (
            <div className="pg-pior" key={i.id}>
              <div className="pg-pior-topo">
                <span className="pg-pior-nome" title={`Indicador ${i.id}`}>{i.divisaoExibida} · {i.indicador}</span>
                <span className="pg-num" style={{ color: "var(--ok)", fontWeight: 800, fontSize: 13, whiteSpace: "nowrap" }}>
                  {seta} {fmtValor(i.mesAnterior?.valor ?? null, i.unidade)} → {fmtValor(i.valor, i.unidade)}
                </span>
              </div>
              <div className="pg-sub">
                meta {meta(i)} · <span style={{ color: v.texto }}>{v.curto}</span>
              </div>
            </div>
          );
        })
      )}
    </section>
  );
}
