import { fmtPercentual, fmtValor, larguraCss, metaExibida } from "../../lib/indicadores/formato.ts";
import type { DivisaoPainel, IndicadorPainel } from "../../lib/indicadores/tipos.ts";
import { VISUAL_STATUS, textoContagem } from "./visual";

const plural = (n: number, um: string, varios: string) => `${n} ${n === 1 ? um : varios}`;

export function Podio({ podio, filtradas, ranqueadas }: {
  podio: DivisaoPainel[];
  /** Com filtro de divisão: as divisões filtradas, com a posição do ranking geral. */
  filtradas?: DivisaoPainel[];
  ranqueadas: number;
}) {
  if (filtradas) {
    return (
      <section className="pg-card" aria-label="Posição no ranking geral">
        <div className="pg-secao-topo"><span className="pg-rotulo">Posição no ranking geral</span></div>
        {filtradas.map((d) => (
          <div className="pg-divisao" key={d.sigla}>
            <div className="pg-pior-topo">
              <span className="pg-degrau-sigla" style={{ fontSize: 20 }}>{d.sigla}</span>
              <span className="pg-degrau-score">
                {d.posicao ? `${d.posicao}º de ${ranqueadas}` : d.foraDoRanking ? "fora do ranking" : "sem posição"}
              </span>
            </div>
            <div className="pg-sub">
              {d.score !== null ? `nota ${fmtPercentual(d.score, 1)} · ${plural(d.n, "indicador avaliado", "indicadores avaliados")}` : d.foraDoRanking ? "acompanhamento" : "sem indicadores avaliáveis"}
            </div>
          </div>
        ))}
      </section>
    );
  }
  // Ordem visual: 2º, 1º, 3º (o 1º no centro, mais alto)
  const lugares = [podio[1], podio[0], podio[2]];
  return (
    <section className="pg-card" aria-label="Pódio das divisões">
      <div className="pg-secao-topo"><span className="pg-rotulo">Pódio das divisões</span></div>
      {podio.length === 0 ? (
        <div className="pg-vazio">Nenhuma divisão com indicadores avaliáveis nesta competência.</div>
      ) : (
        <ol className="pg-podio" style={{ listStyle: "none", margin: 0, padding: 0 }}>
          {lugares.map((d, i) =>
            d ? (
              <li key={d.sigla} className="pg-degrau" data-pos={d.posicao ?? undefined}>
                <div className="pg-degrau-pos">{d.posicao}º</div>
                <div className="pg-degrau-sigla">{d.sigla}</div>
                <div className="pg-degrau-score">{fmtPercentual(d.score, 1)}</div>
                <div className="pg-sub">{plural(d.n, "indicador avaliado", "indicadores avaliados")}</div>
              </li>
            ) : (
              <li key={`vazio-${i}`} aria-hidden="true" />
            ),
          )}
        </ol>
      )}
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
                  <v.Icone size={12} color={v.cor} aria-hidden="true" style={{ verticalAlign: "-1px", marginRight: 3 }} />
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

export function PorDivisao({ divisoes }: { divisoes: DivisaoPainel[] }) {
  return (
    <section className="pg-card" aria-label="Nota por divisão">
      <div className="pg-secao-topo">
        <span className="pg-rotulo">Por divisão</span>
        <span className="pg-sub">nota (Wilson, 95%)</span>
      </div>
      {divisoes.map((d) => (
        <div className="pg-divisao" key={d.sigla}>
          <div className="pg-divisao-linha">
            <span className="pg-divisao-sigla">{d.sigla}</span>
            {d.score !== null ? (
              <>
                <span className="pg-trilha" aria-hidden="true">
                  <span className="pg-barra" style={{ width: larguraCss(d.score, 1), background: "#7FB8FF" }} />
                </span>
                <span className="pg-num" style={{ fontWeight: 800, fontSize: 13, textAlign: "right" }}>{fmtPercentual(d.score, 1)}</span>
                <span className="pg-divisao-pos">{d.posicao}º</span>
              </>
            ) : (
              <span className="pg-sub" style={{ gridColumn: "span 3" }}>
                {d.foraDoRanking ? "Acompanhamento, fora do ranking" : "Sem indicadores avaliáveis"}
              </span>
            )}
          </div>
          <div className="pg-sub" style={{ marginTop: 3 }}>
            {d.n > 0 && `${plural(d.n, "avaliado", "avaliados")} · `}{textoContagem(d.contagem) || "sem indicadores nesta competência"}
          </div>
        </div>
      ))}
    </section>
  );
}
