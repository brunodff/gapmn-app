// Gráficos do Painel do Auxílio Transporte: colunas (meses, faixas de valor) e barras deitadas (OM, situação).
// Uma série só por gráfico (o título diz o que é), barras finas, rótulo só no destaque e dica no
// passar do mouse ou no foco do teclado. Clique numa barra filtra o painel quando `aoEscolher` vem.
import { useState } from "react";
import { fmtMoeda, fmtNumero } from "../../lib/auxilioTransporte/dados.ts";

export type Barra = { chave: string; rotulo: string; quantidade: number; valor: number; ativo?: boolean; neutra?: boolean };

type Dica = { chave: string; x: number; y: number } | null;

function TextoDica({ b }: { b: Barra }) {
  return (
    <>
      <strong className="at-dica-valor">{fmtNumero(b.quantidade)} {b.quantidade === 1 ? "solicitação" : "solicitações"}</strong>
      <span className="at-dica-sub">{b.rotulo}</span>
      <span className="at-dica-sub">{fmtMoeda(b.valor)} no total</span>
    </>
  );
}

/** Colunas verticais (uma por categoria), valor no topo só da maior e da última. */
export function Colunas({ barras, aoEscolher, rotuloAcao }: { barras: Barra[]; aoEscolher?: (b: Barra) => void; rotuloAcao?: string }) {
  const [dica, setDica] = useState<Dica>(null);
  const max = Math.max(1, ...barras.map((b) => b.quantidade));
  const iMax = barras.findIndex((b) => b.quantidade === max);
  const ativa = dica ? barras.find((b) => b.chave === dica.chave) : null;
  return (
    <div className="at-colunas" onPointerLeave={() => setDica(null)}>
      <div className="at-colunas-area" role="list">
        {barras.map((b, i) => {
          const h = (b.quantidade / max) * 100;
          const rotular = b.quantidade > 0 && (i === iMax || i === barras.length - 1);
          const conteudo = (
            <>
              <span className="at-coluna-trilha">
                {rotular && <span className="at-coluna-num" style={{ bottom: `calc(${h}% + 4px)` }}>{fmtNumero(b.quantidade)}</span>}
                <span className="at-coluna" style={{ height: `${Math.max(h, b.quantidade ? 1.5 : 0)}%` }} data-ativo={b.ativo ? "1" : undefined} />
              </span>
              <span className="at-coluna-rot">{b.rotulo}</span>
            </>
          );
          const mostrar = (e: React.PointerEvent | React.FocusEvent) => {
            const alvo = (e.currentTarget as HTMLElement).getBoundingClientRect();
            const caixa = (e.currentTarget as HTMLElement).closest(".at-colunas")!.getBoundingClientRect();
            setDica({ chave: b.chave, x: alvo.left - caixa.left + alvo.width / 2, y: 0 });
          };
          return aoEscolher ? (
            <button key={b.chave} type="button" role="listitem" className="at-coluna-alvo" aria-pressed={!!b.ativo}
              aria-label={`${b.rotulo}: ${fmtNumero(b.quantidade)} solicitações, ${fmtMoeda(b.valor)}. ${rotuloAcao ?? ""}`}
              onPointerEnter={mostrar} onFocus={mostrar} onBlur={() => setDica(null)} onClick={() => aoEscolher(b)}>
              {conteudo}
            </button>
          ) : (
            <div key={b.chave} role="listitem" tabIndex={0} className="at-coluna-alvo"
              aria-label={`${b.rotulo}: ${fmtNumero(b.quantidade)} solicitações, ${fmtMoeda(b.valor)}`}
              onPointerEnter={mostrar} onFocus={mostrar} onBlur={() => setDica(null)}>
              {conteudo}
            </div>
          );
        })}
      </div>
      {ativa && dica && (
        <div className="at-dica" style={{ left: dica.x }} role="status"><TextoDica b={ativa} /></div>
      )}
    </div>
  );
}

/** Barras deitadas, uma por linha: nome, barra e a quantidade na ponta. */
export function Barras({ barras, aoEscolher, rotuloAcao }: { barras: Barra[]; aoEscolher?: (b: Barra) => void; rotuloAcao?: string }) {
  const [dica, setDica] = useState<Dica>(null);
  const max = Math.max(1, ...barras.map((b) => b.quantidade));
  const ativa = dica ? barras.find((b) => b.chave === dica.chave) : null;
  return (
    <div className="at-barras" onPointerLeave={() => setDica(null)}>
      {barras.map((b) => {
        const mostrar = (e: React.PointerEvent | React.FocusEvent) => {
          const alvo = (e.currentTarget as HTMLElement).getBoundingClientRect();
          const caixa = (e.currentTarget as HTMLElement).closest(".at-barras")!.getBoundingClientRect();
          setDica({ chave: b.chave, x: Math.min(alvo.width - 140, Math.max(0, (b.quantidade / max) * alvo.width * 0.62)), y: alvo.top - caixa.top });
        };
        const corpo = (
          <>
            <span className="at-barra-nome" title={b.rotulo}>{b.rotulo}</span>
            <span className="at-barra-trilha">
              <span className="at-barra" data-neutra={b.neutra ? "1" : undefined} data-ativo={b.ativo ? "1" : undefined}
                style={{ width: `${Math.max((b.quantidade / max) * 100, b.quantidade ? 1 : 0)}%` }} />
            </span>
            <span className="at-barra-num">{fmtNumero(b.quantidade)}</span>
          </>
        );
        const props = {
          className: "at-barra-linha",
          onPointerEnter: mostrar, onFocus: mostrar, onBlur: () => setDica(null),
        };
        return aoEscolher && !b.neutra ? (
          <button key={b.chave} type="button" {...props} aria-pressed={!!b.ativo}
            aria-label={`${b.rotulo}: ${fmtNumero(b.quantidade)} solicitações, ${fmtMoeda(b.valor)}. ${rotuloAcao ?? ""}`}
            onClick={() => aoEscolher(b)}>{corpo}</button>
        ) : (
          <div key={b.chave} {...props} tabIndex={0} aria-label={`${b.rotulo}: ${fmtNumero(b.quantidade)} solicitações, ${fmtMoeda(b.valor)}`}>{corpo}</div>
        );
      })}
      {ativa && dica && (
        <div className="at-dica at-dica-barra" style={{ left: dica.x, top: dica.y }} role="status"><TextoDica b={ativa} /></div>
      )}
    </div>
  );
}
