import { CORTE_ADEQUADO, CORTE_ATENCAO } from "../../lib/indicadores/calculo.ts";
import { fmtPercentual, fmtValor } from "../../lib/indicadores/formato.ts";
import type { IndicadorPainel, Status } from "../../lib/indicadores/tipos.ts";
import { VISUAL_STATUS } from "./visual";

const abaixoDe = (f: number) => fmtPercentual(f - 0.01);

const DESCRICOES: [Status, string][] = [
  ["Adequado", `atingimento de ${fmtPercentual(CORTE_ADEQUADO)} da meta ou mais`],
  ["Atenção", `de ${fmtPercentual(CORTE_ATENCAO)} a ${abaixoDe(CORTE_ADEQUADO)} da meta`],
  ["Crítico", `abaixo de ${fmtPercentual(CORTE_ATENCAO)} da meta`],
  ["Aguardando informação", "informação ainda não registrada para a competência"],
  ["Sem dados no mês de referência", "não houve o evento que serve de base para o cálculo"],
  ["Sem meta", "acompanhamento, fora da nota"],
];

export function Monitoramento({ itens }: { itens: IndicadorPainel[] }) {
  return (
    <section className="pg-card" aria-label="Monitoramento">
      <div className="pg-secao-topo">
        <span className="pg-rotulo">Monitoramento (sem meta)</span>
        <span className="pg-sub">fora da nota e do ranking</span>
      </div>
      {itens.map((i) => (
        <div className="pg-item" key={i.id} data-ativo="1">
          <span className="pg-item-nome">{i.id} · {i.indicador} <span className="pg-sub">({i.divisaoExibida})</span></span>
          <span className="pg-item-qtd">{fmtValor(i.valor, i.unidade)}</span>
        </div>
      ))}
    </section>
  );
}

export function Legenda({ sozinha }: { sozinha: boolean }) {
  return (
    <section className="pg-card" aria-label="Legenda" style={sozinha ? { gridColumn: "1 / -1" } : undefined}>
      <div className="pg-secao-topo"><span className="pg-rotulo">Legenda</span></div>
      <div className="pg-legenda">
        {DESCRICOES.map(([s, d]) => {
          const v = VISUAL_STATUS[s];
          return (
            <div className="pg-legenda-item" key={s}>
              <v.Icone size={14} color={v.cor} aria-hidden="true" />
              <span><b style={{ color: v.texto }}>{s}</b> — {d}</span>
            </div>
          );
        })}
      </div>
      <ul className="pg-notas">
        <li>A barra vai até 150% da meta; o traço vertical marca 100%. O percentual mostrado é o real, sem teto.</li>
        <li>
          Nota da divisão: limite inferior de Wilson (95%) sobre os pontos de cada indicador (adequado 1, atenção 0,5,
          crítico 0). Divisões com poucos indicadores avaliados não ficam à frente só por isso.
        </li>
        <li>Eventos Promovidos para o Efetivo (COMSOC) e os grupos de contagem são acompanhamento: ficam fora da nota.</li>
        <li>Nas variações mensais (indicadores 16 e 22), o resultado conta quando há redução em relação ao mês anterior.</li>
        <li>
          Os indicadores são instrumento de gestão, não de fiscalização ou punição: cada resultado deve ser lido com a
          tendência e o contexto do período (Catálogo de Indicadores de Desempenho, perguntas 2 e 28).
        </li>
      </ul>
    </section>
  );
}
