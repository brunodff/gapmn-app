import { fmtPercentual, fmtPontosPercentuais, fmtValor, larguraCss, metaExibida } from "../../lib/indicadores/formato.ts";
import type { IndicadorPainel, Painel } from "../../lib/indicadores/tipos.ts";
import { VISUAL_STATUS } from "./visual";

// Coluna da direita. Sem ranking entre divisões (decisão de 20/10/2026): o painel mostra a
// evolução da organização e os indicadores que pedem atenção ou que mais avançaram.

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
        {painel.anterior && <>vs {painel.anterior.label}: <b>{fmtPontosPercentuais(delta)}</b> · </>}
        tendência 3M: <b>{fmtPontosPercentuais(painel.tendenciaSaude)}</b>
      </div>
    </section>
  );
}

export function Piores({ piores }: { piores: IndicadorPainel[] }) {
  return (
    <section className="pg-card" aria-label="Atenção prioritária">
      <div className="pg-secao-topo">
        <span className="pg-rotulo">Atenção prioritária</span>
        <span className="pg-sub">menor atingimento</span>
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
                  {fmtPercentual(i.atingimento)}
                </span>
              </div>
              <div className="pg-sub">
                {i.divisaoExibida} · {fmtValor(i.valor, i.unidade)} · meta {metaExibida(i.metaTxt, i.metaNum, i.unidade, i.direcao)}
              </div>
            </div>
          );
        })
      )}
    </section>
  );
}

/** Indicadores que mais melhoraram o atingimento em relação à competência anterior. */
export function Avancos({ avancos, anterior }: { avancos: IndicadorPainel[]; anterior: string | null }) {
  return (
    <section className="pg-card" aria-label="Maiores avanços">
      <div className="pg-secao-topo">
        <span className="pg-rotulo">Maiores avanços</span>
        {anterior && <span className="pg-sub">em relação a {anterior}</span>}
      </div>
      {avancos.length === 0 ? (
        <div className="pg-vazio">
          {anterior ? `Nenhum indicador subiu de atingimento em relação a ${anterior}.` : "Sem competência anterior para comparar."}
        </div>
      ) : (
        avancos.map((i) => {
          const v = VISUAL_STATUS[i.status];
          return (
            <div className="pg-pior" key={i.id}>
              <div className="pg-pior-topo">
                <span className="pg-pior-nome">{i.id} · {i.indicador}</span>
                <span className="pg-num" style={{ color: "var(--ok)", fontWeight: 800, fontSize: 13, whiteSpace: "nowrap" }}>
                  ↑ {fmtPercentual(i.mesAnterior?.atingimento)} → {fmtPercentual(i.atingimento)}
                </span>
              </div>
              <div className="pg-sub">
                {i.divisaoExibida} · {fmtValor(i.valor, i.unidade)} · <span style={{ color: v.texto }}>{v.curto}</span>
              </div>
            </div>
          );
        })
      )}
    </section>
  );
}
