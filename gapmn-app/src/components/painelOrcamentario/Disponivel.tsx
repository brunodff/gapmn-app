import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { fmtData, fmtDiaMes, fmtDias, fmtMoeda, fmtNC } from "../../lib/orcamento/formato.ts";
import type { IdadeCredito, NotaCredito, NotaNoSaldo, UnidadeDisponivel } from "../../lib/orcamento/tipos.ts";
import { Logo } from "./Graficos";

type Ativo = { unidade: UnidadeDisponivel; linha: HTMLElement };

/** Cor da idade: até 30 dias, até 90 dias, acima disso. */
const faixaDaIdade = (dias: number) => (dias <= 30 ? "novo" : dias <= 90 ? "medio" : "antigo");

/** Até quantas notas de crédito aparecem por linha de saldo (as mais novas). */
const NOTAS_POR_LINHA = 3;

/** Uma nota de crédito: número, data, valor e a descrição (observação) que veio do SIAFI. */
function Nota({ nota, ultimoDia, noSaldo, descricaoAcima }: {
  nota: NotaCredito; ultimoDia: string | null; noSaldo?: number;
  /** A descrição já aparece no bloco "Recebido em": não repete. */
  descricaoAcima?: boolean;
}) {
  const nova = !!ultimoDia && nota.data === ultimoDia;
  const parcial = noSaldo !== undefined && noSaldo < nota.valor - 0.005;
  return (
    <div className="po-nc" data-nova={nova ? "1" : undefined}>
      <span className="po-nc-cab">
        <b>{nota.nc ? fmtNC(nota.nc) : "Nota de crédito"}</b>
        {" · "}{fmtData(nota.data)}
        {" · "}<span className="num">{fmtMoeda(noSaldo ?? nota.valor)}</span>
        {parcial && <span className="po-nc-de"> de {fmtMoeda(nota.valor)}</span>}
        {nova && <span className="po-nc-selo">nova</span>}
        {descricaoAcima && nota.obs && <span className="po-nc-de"> · descrição acima</span>}
      </span>
      {nota.obs && !descricaoAcima && <span className="po-nc-obs">{nota.obs}</span>}
    </div>
  );
}

function NotasDaLinha({ notas, ultimoDia, jaMostradas }: { notas: NotaNoSaldo[]; ultimoDia: string | null; jaMostradas: Set<string> }) {
  const resto = notas.slice(NOTAS_POR_LINHA);
  return (
    <>
      {notas.slice(0, NOTAS_POR_LINHA).map((n, i) => <Nota key={`${n.nc}|${i}`} nota={n} ultimoDia={ultimoDia} noSaldo={n.noSaldo} descricaoAcima={!!n.nc && jaMostradas.has(n.nc)} />)}
      {resto.length > 0 && (
        <div className="po-nc-mais">
          + {resto.length} nota{resto.length > 1 ? "s" : ""} mais antiga{resto.length > 1 ? "s" : ""} ({fmtMoeda(resto.reduce((s, n) => s + n.noSaldo, 0))})
        </div>
      )}
    </>
  );
}

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
 * com o tooltip da tabela descrição | PI | ND | Disp | chegou há, ao passar o mouse, focar ou tocar.
 * O tooltip também mostra as notas de crédito do último dia (a linha verde) e, embaixo de cada saldo,
 * as notas que o formam, com o número e a descrição (observação) do SIAFI.
 */
export default function Disponivel({ unidades, total, ultimoDia, hoje }: {
  unidades: UnidadeDisponivel[];
  total: number;
  ultimoDia: string | null;
  /** Data de referência da idade do crédito. */
  hoje: string;
}) {
  const [ativo, setAtivo] = useState<Ativo | null>(null);
  /** Fixado por clique ou toque: aceita o mouse, rola por dentro e só fecha no ✕, no Esc ou clicando fora. */
  const [fixo, setFixo] = useState(false);
  const dicaRef = useRef<HTMLDivElement>(null);

  const abrir = (unidade: UnidadeDisponivel, linha: HTMLElement) => setAtivo({ unidade, linha });
  const fechar = () => { setAtivo(null); setFixo(false); };
  const passar = (unidade: UnidadeDisponivel, linha: HTMLElement) => { if (!fixo) abrir(unidade, linha); };
  const sair = () => { if (!fixo) setAtivo(null); };
  const clicar = (unidade: UnidadeDisponivel, linha: HTMLElement) => {
    if (fixo && ativo?.unidade.sigla === unidade.sigla) { fechar(); return; }
    abrir(unidade, linha);
    setFixo(true);
  };

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
    // quando não cabe na tela, o tooltip avisa que dá para fixar e rolar
    el.dataset.transborda = el.scrollHeight > el.clientHeight + 1 ? "1" : "0";
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

  // fixado, fecha ao clicar ou tocar fora dele e da unidade
  useEffect(() => {
    if (!fixo) return;
    const fora = (e: PointerEvent) => {
      const alvo = e.target as Node;
      if (dicaRef.current?.contains(alvo) || ativo?.linha.contains(alvo)) return;
      setAtivo(null);
      setFixo(false);
    };
    document.addEventListener("pointerdown", fora);
    return () => document.removeEventListener("pointerdown", fora);
  }, [fixo, ativo]);

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
                  onMouseEnter={(e) => passar(u, e.currentTarget)} onMouseLeave={sair}
                  onFocus={(e) => passar(u, e.currentTarget)} onBlur={sair}
                  onClick={(e) => clicar(u, e.currentTarget)}>
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
        <div ref={dicaRef} className="po-dica" role={fixo ? "dialog" : "tooltip"} aria-label={`Crédito disponível de ${ativo.unidade.sigla}`}
          data-fixo={fixo ? "1" : undefined} style={{ visibility: "hidden", left: 0, top: 0 }}>
          <div className="po-dica-tit">
            <span><b>{ativo.unidade.sigla}</b> · crédito disponível por PI e ND</span>
            {fixo
              ? <button type="button" className="po-dica-fechar" onClick={fechar} aria-label="Fechar">✕</button>
              : <span className="po-dica-rolar">clique na unidade para fixar e rolar</span>}
          </div>
          {ativo.unidade.notasUltimoDia.length > 0 && (
            <section className="po-dica-dia" aria-label={`Crédito recebido em ${fmtDiaMes(ultimoDia)}`}>
              <div className="po-dica-dia-tit">
                Recebido em {fmtDiaMes(ultimoDia)}
                {ativo.unidade.recebidoUltimoDia !== null && (
                  <b className="num">{ativo.unidade.recebidoUltimoDia >= 0 ? "+" : ""}{fmtMoeda(ativo.unidade.recebidoUltimoDia)}</b>
                )}
              </div>
              {ativo.unidade.notasUltimoDia.map((n, i) => (
                <div key={`${n.nc}|${i}`} className="po-dica-dia-nota">
                  <Nota nota={n} ultimoDia={null} />
                  <span className="po-nc-onde">{n.piNome || n.pi} · ND {n.nd}</span>
                </div>
              ))}
            </section>
          )}
          <table>
            <thead>
              <tr><th>DESCRIÇÃO</th><th>PI</th><th className="po-nd">ND</th><th className="num">Disp</th><th>CHEGOU HÁ</th></tr>
            </thead>
            {ativo.unidade.linhas.map((l, i) => (
              <tbody key={i}>
                <tr>
                  <td>{l.ndNome}</td>
                  <td>{l.piNome || l.pi}</td>
                  <td className="po-nd">{l.nd}</td>
                  <td className="num">{fmtMoeda(l.valor)}</td>
                  <CelulaIdade idade={l.idade} />
                </tr>
                {l.notas.length > 0 && (
                  <tr className="po-nc-linha">
                    <td colSpan={5}><NotasDaLinha notas={l.notas} ultimoDia={ultimoDia} jaMostradas={new Set(ativo.unidade.notasUltimoDia.map((n) => n.nc).filter(Boolean))} /></td>
                  </tr>
                )}
              </tbody>
            ))}
            <tfoot>
              <tr>
                <td>Total</td>
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
            Embaixo de cada saldo, as notas de crédito que o formam, com a descrição do SIAFI.
          </p>
        </div>
      )}
    </aside>
  );
}
