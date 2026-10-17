import { fmtNumero, fmtPercentual, larguraCss } from "../../lib/indicadores/formato.ts";
import type { GrupoContagem, ItemContagem } from "../../lib/indicadores/tipos.ts";

// Grupos de contagem (EXTRAS): quantidades, sem meta, sem semáforo e fora de qualquer nota.
// 0 quer dizer "não há" e aparece como 0; vazio quer dizer "ainda não informado" e aparece como —.

function Quantidade({ v }: { v: number | null }) {
  if (v === null) return <span className="pg-item-qtd" data-zero="1" title="Informação ainda não registrada">—</span>;
  return <span className="pg-item-qtd" data-zero={v === 0 ? "1" : undefined}>{fmtNumero(v)}</span>;
}

function ItemSimples({ item }: { item: ItemContagem }) {
  return (
    <div className="pg-item" data-ativo={item.realizado !== null && item.realizado > 0 ? "1" : undefined}>
      <span className="pg-item-nome">{item.indicador}</span>
      <Quantidade v={item.realizado} />
    </div>
  );
}

function ItemPlanejado({ item }: { item: ItemContagem }) {
  const base = Math.max(item.planejado ?? 0, item.realizado ?? 0);
  return (
    <div className="pg-pca">
      <div className="pg-item" style={{ border: "none", padding: 0 }} data-ativo="1">
        <span className="pg-item-nome">{item.indicador}</span>
        <span className="pg-item-qtd">
          {fmtNumero(item.realizado)} / {fmtNumero(item.planejado)}
          {item.execucao !== null && <span className="pg-sub" style={{ fontWeight: 600 }}> · {fmtPercentual(item.execucao)}</span>}
        </span>
      </div>
      <div className="pg-pca-trilha" aria-hidden="true" title="Barra: realizado; contorno: planejado">
        {base > 0 && item.realizado !== null && (
          <span className="pg-pca-barra" style={{ width: larguraCss(item.realizado / base, 1) }} />
        )}
      </div>
    </div>
  );
}

function CartaoGrupo({ g, competencia, largo = false }: { g: GrupoContagem; competencia: string; largo?: boolean }) {
  const total = g.emparelhado
    ? `${fmtNumero(g.total)} / ${fmtNumero(g.totalPlanejado)}${g.total !== null && g.totalPlanejado ? ` · ${fmtPercentual(g.total / g.totalPlanejado)}` : ""}`
    : fmtNumero(g.total);
  return (
    <section className="pg-card" aria-label={g.categoria}>
      <div className="pg-secao-topo">
        <span className="pg-rotulo">{g.categoria} · {g.divisao}</span>
        <span className="pg-num" style={{ fontWeight: 800, fontSize: 15 }} title={g.emparelhado ? "Realizado / planejado" : "Total"}>
          {total}
        </span>
      </div>
      {g.emparelhado && <div className="pg-sub" style={{ marginTop: -6, marginBottom: 6 }}>realizado / planejado em {competencia}</div>}
      <div className={largo ? "pg-itens-2" : undefined}>
        {g.itens.map((item) =>
          g.emparelhado ? <ItemPlanejado key={item.id} item={item} /> : <ItemSimples key={item.id} item={item} />,
        )}
      </div>
    </section>
  );
}

export default function Contagem({ grupos, competencia }: { grupos: GrupoContagem[]; competencia: string }) {
  if (grupos.length === 0) return null;
  const [principal, ...resto] = grupos;
  return (
    <section aria-label="Grupos de contagem">
      <div className="pg-secao-topo" style={{ marginBottom: 8 }}>
        <span className="pg-rotulo">Grupos de contagem</span>
        <span className="pg-sub">quantidades em {competencia}, fora da nota</span>
      </div>
      <div className="pg-grupos">
        <CartaoGrupo g={principal} competencia={competencia} largo={principal.itens.length > 6} />
        {resto.length > 0 && (
          <div className="pg-grupos-dir">
            {resto.map((g) => <CartaoGrupo key={g.categoria} g={g} competencia={competencia} />)}
          </div>
        )}
      </div>
    </section>
  );
}
