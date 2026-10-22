import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { MousePointerClick, Pin } from "lucide-react";
import { fmtData, fmtDiaMes, fmtDias, fmtMoeda, fmtNC } from "../../lib/orcamento/formato.ts";
import type { IdadeCredito, NotaNoSaldo, UnidadeDisponivel } from "../../lib/orcamento/tipos.ts";
import { Logo } from "./Graficos";

type Alvo = { sigla: string; linha: HTMLElement };

/** Cor da idade: até 30 dias, até 90 dias, acima disso. */
const faixaDaIdade = (dias: number) => (dias <= 30 ? "novo" : dias <= 90 ? "medio" : "antigo");

/** Até quantas notas de crédito aparecem por linha de saldo (as mais novas). */
const NOTAS_POR_LINHA = 3;

/** Uma nota de crédito: número, data, a parte dela que está no saldo e a descrição (observação) do SIAFI. */
function Nota({ nota }: { nota: NotaNoSaldo }) {
  const parcial = nota.noSaldo < nota.valor - 0.005;
  return (
    <div className="po-nc">
      <span className="po-nc-cab">
        <b>{nota.nc ? fmtNC(nota.nc) : "Nota de crédito"}</b>
        {" · "}{fmtData(nota.data)}
        {" · "}<span className="num">{fmtMoeda(nota.noSaldo)}</span>
        {parcial && <span className="po-nc-de"> de {fmtMoeda(nota.valor)}</span>}
      </span>
      {nota.obs && <span className="po-nc-obs">{nota.obs}</span>}
    </div>
  );
}

function NotasDaLinha({ notas }: { notas: NotaNoSaldo[] }) {
  const resto = notas.slice(NOTAS_POR_LINHA);
  return (
    <>
      {notas.slice(0, NOTAS_POR_LINHA).map((n, i) => <Nota key={`${n.nc}|${i}`} nota={n} />)}
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
 * com o tooltip da tabela descrição | PI | ND | Disp | chegou há e, embaixo de cada saldo, as notas
 * de crédito que o formam, com o número e a descrição (observação) do SIAFI.
 * Passar o mouse (ou focar) mostra o tooltip da unidade; clicar (ou tocar, ou Enter) fixa: aí ele aceita
 * o mouse, rola por dentro e só fecha no ✕, no Esc, clicando fora ou clicando de novo na unidade.
 * Com uma unidade fixada, passar o mouse em outra mostra a dela e, ao sair, volta para a fixada.
 */
export default function Disponivel({ unidades, total, ultimoDia }: {
  unidades: UnidadeDisponivel[];
  total: number;
  ultimoDia: string | null;
}) {
  const [previa, setPrevia] = useState<Alvo | null>(null);
  const [fixo, setFixo] = useState<Alvo | null>(null);
  const dicaRef = useRef<HTMLDivElement>(null);

  const mostrado = previa && previa.sigla !== fixo?.sigla ? previa : fixo ?? previa;
  const ehFixo = !!fixo && mostrado?.sigla === fixo.sigla;
  // pela sigla, para o tooltip acompanhar a releitura das planilhas (a cada 5 min)
  const unidade = mostrado ? unidades.find((u) => u.sigla === mostrado.sigla) ?? null : null;

  const passar = (u: UnidadeDisponivel, linha: HTMLElement) => setPrevia({ sigla: u.sigla, linha });
  const sair = () => setPrevia(null);
  const fechar = useCallback(() => { setFixo(null); setPrevia(null); }, []);
  const clicar = (u: UnidadeDisponivel, linha: HTMLElement) => {
    if (fixo?.sigla === u.sigla) { setFixo(null); return; }   // clicar de novo solta (fica a prévia)
    setFixo({ sigla: u.sigla, linha });
  };

  // A posição só é conhecida depois de medir o tooltip: à esquerda da linha; sem espaço, embaixo.
  // Devolve false quando a linha saiu da tela (aí o tooltip fecha).
  const posicionar = useCallback((): boolean => {
    const el = dicaRef.current;
    if (!el || !mostrado) return true;
    const r = mostrado.linha.getBoundingClientRect();
    const m = 10, vw = window.innerWidth, vh = window.innerHeight;
    if (r.bottom < 0 || r.top > vh || !mostrado.linha.isConnected) return false;
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
  }, [mostrado]);

  useLayoutEffect(() => { posicionar(); }, [posicionar, unidade]);

  useEffect(() => {
    if (!mostrado) return;
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
  }, [mostrado, posicionar, fechar]);

  // Fixado: clique ou toque fora do tooltip e das unidades fecha (numa unidade, o clique dela decide).
  useEffect(() => {
    if (!fixo) return;
    const fora = (e: PointerEvent) => {
      const alvo = e.target as Element;
      if (dicaRef.current?.contains(alvo) || alvo.closest?.(".po-disp-item")) return;
      fechar();
    };
    document.addEventListener("pointerdown", fora);
    return () => document.removeEventListener("pointerdown", fora);
  }, [fixo, fechar]);

  return (
    <aside className="po-direita" aria-label="Crédito disponível por unidade">
      <div className="po-direita-tit">Crédito Disponível por Unidade</div>
      {ultimoDia && (
        <div className="po-direita-sub">
          em verde, o crédito recebido pela unidade em {fmtDiaMes(ultimoDia)}
        </div>
      )}
      {unidades.length > 0 && (
        <div className="po-direita-dica">
          <MousePointerClick size={14} aria-hidden="true" />
          <span>Passe o mouse para ver o saldo por PI e ND · <b>clique na unidade para fixar</b></span>
        </div>
      )}
      {unidades.length === 0 ? (
        <div className="po-vazio po-vazio-escuro">Nenhuma unidade com saldo para este filtro.</div>
      ) : (
        <ul className="po-disp-lista">
          {unidades.map((u) => {
            const recebeu = u.recebidoUltimoDia !== null;
            const fixada = fixo?.sigla === u.sigla;
            return (
              <li key={u.sigla}>
                <div className="po-disp-item" tabIndex={0} role="button" aria-pressed={fixada}
                  data-ativo={mostrado?.sigla === u.sigla ? "1" : undefined} data-fixo={fixada ? "1" : undefined}
                  aria-label={`${u.rank}º ${u.sigla}: ${fmtMoeda(u.valor)} disponível. ${fixada ? "Detalhe fixado; clique para soltar" : "Clique para fixar o detalhe"}`}
                  title={fixada ? "Detalhe fixado: clique de novo para soltar" : "Clique para fixar o detalhe"}
                  onMouseEnter={(e) => passar(u, e.currentTarget)} onMouseLeave={sair}
                  onFocus={(e) => passar(u, e.currentTarget)} onBlur={sair}
                  onClick={(e) => clicar(u, e.currentTarget)}
                  onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); clicar(u, e.currentTarget); } }}>
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
                  {fixada && <Pin className="po-disp-pino" size={13} aria-hidden="true" />}
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

      {mostrado && unidade && (
        <div ref={dicaRef} className="po-dica" role={ehFixo ? "dialog" : "tooltip"} aria-label={`Crédito disponível de ${unidade.sigla}`}
          data-fixo={ehFixo ? "1" : undefined} style={{ visibility: "hidden", left: 0, top: 0 }}>
          <div className="po-dica-tit">
            <span><b>{unidade.sigla}</b> · crédito disponível por PI e ND</span>
            {ehFixo ? (
              <span className="po-dica-acoes">
                <span className="po-dica-fixado"><Pin size={12} aria-hidden="true" /> Fixado</span>
                <button type="button" className="po-dica-fechar" onClick={fechar} aria-label="Fechar">✕</button>
              </span>
            ) : (
              <span className="po-dica-fixar"><Pin size={12} aria-hidden="true" /> Clique na unidade para fixar</span>
            )}
          </div>
          <table>
            <thead>
              <tr><th>DESCRIÇÃO</th><th>PI</th><th className="po-nd">ND</th><th className="num">Disp</th><th>CHEGOU HÁ</th></tr>
            </thead>
            {unidade.linhas.map((l, i) => (
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
                    <td colSpan={5}><NotasDaLinha notas={l.notas} /></td>
                  </tr>
                )}
              </tbody>
            ))}
            <tfoot>
              <tr>
                <td>Total</td>
                <td />
                <td />
                <td className="num">{fmtMoeda(unidade.valor)}</td>
                <td />
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </aside>
  );
}
