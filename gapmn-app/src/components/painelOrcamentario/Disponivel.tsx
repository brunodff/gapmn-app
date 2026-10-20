import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { fmtDiaMes, fmtMoeda } from "../../lib/orcamento/formato.ts";
import type { UnidadeDisponivel } from "../../lib/orcamento/tipos.ts";
import { Logo } from "./Graficos";

type Ativo = { unidade: UnidadeDisponivel; caixa: DOMRect };

/**
 * "Crédito Disponível por Unidade": lista do BI (posição, logo, sigla, saldo e a linha verde),
 * com o tooltip da tabela OM | descrição | PI | ND | Disp ao passar o mouse, focar ou tocar.
 */
export default function Disponivel({ unidades, total, ultimoDia }: {
  unidades: UnidadeDisponivel[];
  total: number;
  ultimoDia: string | null;
}) {
  const [ativo, setAtivo] = useState<Ativo | null>(null);
  const dicaRef = useRef<HTMLDivElement>(null);

  const abrir = (unidade: UnidadeDisponivel, el: HTMLElement) => setAtivo({ unidade, caixa: el.getBoundingClientRect() });
  const fechar = () => setAtivo(null);

  // A posição só é conhecida depois de medir o tooltip: à esquerda da linha; sem espaço, embaixo.
  useLayoutEffect(() => {
    const el = dicaRef.current;
    if (!el || !ativo) return;
    const { width: w, height: h } = el.getBoundingClientRect();
    const r = ativo.caixa, m = 10, vw = window.innerWidth, vh = window.innerHeight;
    let left = r.left - w - m;
    let top = r.top + r.height / 2 - h / 2;
    if (left < m) {
      left = Math.min(Math.max(m, r.right - w), vw - w - m);
      top = r.bottom + 6;
      if (top + h > vh - m) top = r.top - h - 6;
    }
    top = Math.min(Math.max(m, top), Math.max(m, vh - h - m));
    el.style.left = `${Math.max(m, left)}px`;
    el.style.top = `${top}px`;
    el.style.visibility = "visible";
  }, [ativo]);

  useEffect(() => {
    if (!ativo) return;
    const tecla = (e: KeyboardEvent) => { if (e.key === "Escape") fechar(); };
    // A caixa medida fica errada ao rolar a página; o tooltip fecha e reabre no próximo movimento.
    window.addEventListener("keydown", tecla);
    window.addEventListener("scroll", fechar, true);
    window.addEventListener("resize", fechar);
    return () => {
      window.removeEventListener("keydown", tecla);
      window.removeEventListener("scroll", fechar, true);
      window.removeEventListener("resize", fechar);
    };
  }, [ativo]);

  return (
    <aside className="po-direita" aria-label="Crédito disponível por unidade">
      <div className="po-direita-tit">Crédito Disponível por Unidade</div>
      {ultimoDia && (
        <div className="po-direita-sub">
          em verde, o crédito recebido pela unidade em {fmtDiaMes(ultimoDia)}
        </div>
      )}
      {unidades.length === 0 ? (
        <div className="po-vazio po-vazio-escuro">Nenhuma unidade com saldo para este filtro.</div>
      ) : (
        <ul className="po-disp-lista">
          {unidades.map((u) => {
            const recebeu = u.recebidoUltimoDia !== null;
            return (
              <li key={u.sigla}>
                <div className="po-disp-item" tabIndex={0} data-ativo={ativo?.unidade.sigla === u.sigla ? "1" : undefined}
                  aria-label={`${u.rank}º ${u.sigla}: ${fmtMoeda(u.valor)} disponível`}
                  onMouseEnter={(e) => abrir(u, e.currentTarget)} onMouseLeave={fechar}
                  onFocus={(e) => abrir(u, e.currentTarget)} onBlur={fechar}
                  onClick={(e) => abrir(u, e.currentTarget)}>
                  <span className="po-rank">{u.rank}</span>
                  <Logo sigla={u.sigla} src={u.logo} className="po-disp-logo" />
                  <span className="po-disp-sigla" title={u.sigla}>{u.sigla}</span>
                  <span className="po-disp-div" aria-hidden="true" />
                  <span className="po-disp-vals">
                    <span className="po-disp-valor">{fmtMoeda(u.valor)}</span>
                    <span className="po-disp-var" data-pos={recebeu && u.recebidoUltimoDia! > 0 ? "1" : undefined}
                      data-neg={recebeu && u.recebidoUltimoDia! < 0 ? "1" : undefined}
                      title={recebeu ? `Crédito recebido pela unidade em ${fmtDiaMes(ultimoDia)}` : `Sem crédito recebido em ${fmtDiaMes(ultimoDia)}`}>
                      {recebeu ? `${u.recebidoUltimoDia! >= 0 ? "+" : ""}${fmtMoeda(u.recebidoUltimoDia!)}` : " - "}
                    </span>
                  </span>
                </div>
              </li>
            );
          })}
        </ul>
      )}
      <div className="po-disp-total">
        <span>Total disponível</span>
        <b>{fmtMoeda(total)}</b>
      </div>

      {ativo && (
        <div ref={dicaRef} className="po-dica" role="tooltip" style={{ visibility: "hidden", left: 0, top: 0 }}>
          <table>
            <thead>
              <tr><th>OM</th><th>DESCRIÇÃO</th><th>PI</th><th>ND</th><th className="num">Disp</th></tr>
            </thead>
            <tbody>
              {ativo.unidade.linhas.map((l, i) => (
                <tr key={i}>
                  <td>{ativo.unidade.sigla}</td>
                  <td>{l.ndNome}</td>
                  <td>{l.piNome || l.pi}</td>
                  <td>{l.nd}</td>
                  <td className="num">{fmtMoeda(l.valor)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr><td colSpan={4}>Total</td><td className="num">{fmtMoeda(ativo.unidade.valor)}</td></tr>
            </tfoot>
          </table>
        </div>
      )}
    </aside>
  );
}
