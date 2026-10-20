import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { fmtData, fmtDiaMes, fmtDias, fmtMoeda } from "../../lib/orcamento/formato.ts";
import type { IdadeCredito, UnidadeDisponivel } from "../../lib/orcamento/tipos.ts";
import { Logo } from "./Graficos";

type Ativo = { unidade: UnidadeDisponivel; linha: HTMLElement };

/** Cor da idade: até 30 dias, até 90 dias, acima disso. */
const faixaDaIdade = (dias: number) => (dias <= 30 ? "novo" : dias <= 90 ? "medio" : "antigo");

function CelulaIdade({ idade }: { idade: IdadeCredito | null }) {
  if (!idade) return <td className="po-idade">—</td>;
  return (
    <td className="po-idade" data-faixa={faixaDaIdade(idade.dias)}>
      <b>{idade.parcial ? "≥ " : ""}{fmtDias(idade.dias)}</b>
      <small>{fmtData(idade.desde)}{idade.ultimo !== idade.desde ? ` · último ${fmtDiaMes(idade.ultimo)}` : ""}</small>
    </td>
  );
}

/**
 * "Crédito Disponível por Unidade": lista do BI (posição, logo, sigla, saldo e a linha verde),
 * com o tooltip da tabela OM | descrição | PI | ND | Disp | chegou há, ao passar o mouse, focar ou tocar.
 */
export default function Disponivel({ unidades, total, ultimoDia, hoje }: {
  unidades: UnidadeDisponivel[];
  total: number;
  ultimoDia: string | null;
  /** Data de referência da idade do crédito. */
  hoje: string;
}) {
  const [ativo, setAtivo] = useState<Ativo | null>(null);
  const dicaRef = useRef<HTMLDivElement>(null);

  const abrir = (unidade: UnidadeDisponivel, linha: HTMLElement) => setAtivo({ unidade, linha });
  const fechar = () => setAtivo(null);

  // A posição só é conhecida depois de medir o tooltip: à esquerda da linha; sem espaço, embaixo.
  // Devolve false quando a linha saiu da tela (aí o tooltip fecha).
  const posicionar = useCallback((): boolean => {
    const el = dicaRef.current;
    if (!el || !ativo) return true;
    const r = ativo.linha.getBoundingClientRect();
    const m = 10, vw = window.innerWidth, vh = window.innerHeight;
    if (r.bottom < 0 || r.top > vh || !ativo.linha.isConnected) return false;
    const { width: w, height: h } = el.getBoundingClientRect();
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
    return true;
  }, [ativo]);

  useLayoutEffect(() => { posicionar(); }, [posicionar]);

  useEffect(() => {
    if (!ativo) return;
    const tecla = (e: KeyboardEvent) => { if (e.key === "Escape") fechar(); };
    // Ao rolar (inclusive a rolagem que o celular faz até a linha tocada) o tooltip acompanha a linha.
    let quadro = 0;
    const acompanhar = () => {
      cancelAnimationFrame(quadro);
      quadro = requestAnimationFrame(() => { if (!posicionar()) fechar(); });
    };
    window.addEventListener("keydown", tecla);
    window.addEventListener("scroll", acompanhar, true);
    window.addEventListener("resize", acompanhar);
    return () => {
      cancelAnimationFrame(quadro);
      window.removeEventListener("keydown", tecla);
      window.removeEventListener("scroll", acompanhar, true);
      window.removeEventListener("resize", acompanhar);
    };
  }, [ativo, posicionar]);

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
              <tr><th className="po-col-om">OM</th><th>DESCRIÇÃO</th><th>PI</th><th className="po-nd">ND</th><th className="num">Disp</th><th>CHEGOU HÁ</th></tr>
            </thead>
            <tbody>
              {ativo.unidade.linhas.map((l, i) => (
                <tr key={i}>
                  <td className="po-col-om">{ativo.unidade.sigla}</td>
                  <td>{l.ndNome}</td>
                  <td>{l.piNome || l.pi}</td>
                  <td className="po-nd">{l.nd}</td>
                  <td className="num">{fmtMoeda(l.valor)}</td>
                  <CelulaIdade idade={l.idade} />
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td className="po-col-om">Total</td>
                <td><span className="po-so-estreito">Total</span></td>
                <td />
                <td />
                <td className="num">{fmtMoeda(ativo.unidade.valor)}</td>
                {ativo.unidade.idadeMaxima === null ? <td className="po-idade">—</td> : (
                  <td className="po-idade" data-faixa={faixaDaIdade(ativo.unidade.idadeMaxima)}>
                    <b>{fmtDias(ativo.unidade.idadeMaxima)}</b><small>o mais antigo</small>
                  </td>
                )}
              </tr>
            </tfoot>
          </table>
          <p className="po-dica-nota">
            <b>Chegou há:</b> tempo, até hoje ({fmtData(hoje)}), desde o crédito mais antigo que ainda forma o saldo
            (os empenhos gastam primeiro o crédito mais antigo). Verde até 30 dias, amarelo até 90, vermelho acima disso.
          </p>
        </div>
      )}
    </aside>
  );
}
