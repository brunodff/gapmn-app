import { useState } from "react";
import { fmtCompacto, fmtMoeda } from "../../lib/orcamento/formato.ts";
import type { CartaoUnidade, ValorRotulado } from "../../lib/orcamento/tipos.ts";

/** Logo da OM; sem arquivo (ou se falhar), mostra as iniciais. */
export function Logo({ sigla, src, className }: { sigla: string; src: string | null; className: string }) {
  const [falhou, setFalhou] = useState(false);
  if (!src || falhou) return <span className={`${className} po-sem-logo`} aria-hidden="true">{sigla.slice(0, 2)}</span>;
  return <img className={className} src={src} alt="" loading="lazy" onError={() => setFalhou(true)} />;
}

const PX_POR_SEGUNDO = 70;
const LARGURA_CARTAO = 132;

/** "Crédito Recebido por Unidade em 2026": cartões correndo da direita para a esquerda (o marquee do BI). */
export function Faixa({ faixa, ano }: { faixa: CartaoUnidade[]; ano: number | null }) {
  const cartoes = (copia: boolean) => faixa.map((u) => (
    <li className="po-om-cartao" key={(copia ? "b-" : "a-") + u.sigla} title={`${u.sigla}: ${fmtMoeda(u.valor)}`}>
      <Logo sigla={u.sigla} src={u.logo} className="po-om-logo" />
      <div className="po-om-sigla">{u.sigla}</div>
      <div className="po-om-valor">{fmtMoeda(u.valor)}</div>
    </li>
  ));
  const duracao = Math.max(12, (faixa.length * LARGURA_CARTAO) / PX_POR_SEGUNDO);
  return (
    <section className="po-faixa" aria-label={`Crédito recebido por unidade em ${ano ?? ""}`}>
      <div className="po-faixa-tit">Crédito Recebido por Unidade em {ano ?? "—"}</div>
      <div className="po-faixa-janela" tabIndex={0} title="Passe o mouse para pausar">
        <div className="po-faixa-trilho" style={{ ["--po-dur" as string]: `${duracao}s` }}>
          <ul className="po-faixa-lista">{cartoes(false)}</ul>
          <ul className="po-faixa-lista po-faixa-copia" aria-hidden="true">{cartoes(true)}</ul>
        </div>
      </div>
    </section>
  );
}

const ALTURA_COLUNA = 118;

/** "Crédito Recebido por meses": colunas com rótulo em Mi, na ordem de valor (como no BI). */
export function Colunas({ titulo, itens }: { titulo: string; itens: ValorRotulado[] }) {
  const max = Math.max(0, ...itens.map((i) => i.valor));
  return (
    <section className="po-cartao po-meses" aria-label={titulo}>
      <div className="po-cartao-tit">{titulo}</div>
      {itens.length === 0 ? (
        <div className="po-vazio">Sem crédito recebido para este filtro.</div>
      ) : (
        <div className="po-colunas" role="list">
          {itens.map((i) => (
            <div className="po-coluna" role="listitem" key={i.rotulo} title={`${i.rotulo}: ${fmtMoeda(i.valor)}`}>
              <span className="po-coluna-val">{fmtCompacto(i.valor)}</span>
              <span className="po-coluna-barra" style={{ height: max > 0 ? Math.max(2, (Math.max(0, i.valor) / max) * ALTURA_COLUNA) : 2 }} />
              <span className="po-coluna-rot">{i.rotulo}</span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

/**
 * Barras horizontais com rótulo no fim (8pt, 1 casa). Com `aoEscolher`, cada barra vira botão
 * que filtra a OM — o clique na barra do BI.
 */
export function Barras({ titulo, itens, vazio, selecionado, aoEscolher }: {
  titulo: string;
  itens: ValorRotulado[];
  vazio: string;
  selecionado?: string | null;
  aoEscolher?: (rotulo: string) => void;
}) {
  const max = Math.max(0, ...itens.map((i) => i.valor));
  return (
    <section className="po-cartao po-barras-cartao" aria-label={titulo}>
      <div className="po-cartao-tit">{titulo}</div>
      {itens.length === 0 ? (
        <div className="po-vazio">{vazio}</div>
      ) : (
        <div className="po-barras">
          {itens.map((i) => {
            const fracao = max > 0 ? Math.max(0, i.valor) / max : 0;
            const conteudo = (
              <>
                <span className="po-barra-rot">{i.rotulo}</span>
                <span className="po-barra-trilho">
                  <span className="po-barra" style={{ width: `calc((100% - 64px) * ${fracao.toFixed(4)})` }} />
                  <span className="po-barra-val">{fmtCompacto(i.valor, 1)}</span>
                </span>
              </>
            );
            const dica = `${i.rotulo}: ${fmtMoeda(i.valor)}${i.dica ? "\n\n" + i.dica : ""}`;
            if (!aoEscolher || i.dica !== undefined) {
              return <div className="po-barra-lin" key={i.rotulo} title={dica}>{conteudo}</div>;
            }
            const ativo = selecionado === i.rotulo;
            return (
              <button type="button" className="po-barra-lin po-barra-botao" key={i.rotulo}
                title={`${dica}\n${ativo ? "Clique para tirar o filtro" : "Clique para filtrar esta OM"}`}
                aria-pressed={ativo} data-apagado={selecionado && !ativo ? "1" : undefined}
                onClick={() => aoEscolher(i.rotulo)}>
                {conteudo}
              </button>
            );
          })}
        </div>
      )}
    </section>
  );
}
