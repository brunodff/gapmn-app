// Painel de Governança — GAP-MN (aba dos Painéis Gerenciais, só ADMIN/DEV).
// Lê a aba BD pela Edge Function `indicadores-bd`; as regras ficam em lib/indicadores/calculo.ts.
// Aqui só se busca, guarda o estado da tela (filtros na URL) e desenha.

import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { CircleCheck, CircleX, ExternalLink, Maximize, RefreshCw, TriangleAlert, type LucideIcon } from "lucide-react";
import { CORTE_ADEQUADO, CORTE_ATENCAO, calcularPainel } from "../../lib/indicadores/calculo.ts";
import { gravarFiltros, lerFiltros, type EstadoFiltros } from "../../lib/indicadores/filtros.ts";
import { buscarBD, ultimoGuardado, type ResultadoBD } from "../../lib/indicadores/fonte.ts";
import { competenciaPorExtenso, fmtGeradoEm, fmtPercentual, fmtPontosPercentuais } from "../../lib/indicadores/formato.ts";
import type { Painel } from "../../lib/indicadores/tipos.ts";
import Apresentacao from "./Apresentacao";
import { Esqueleto } from "./Comum";
import Contagem from "./Contagem";
import Indicadores from "./Indicadores";
import { Piores, Podio, PorDivisao } from "./Lateral";
import { Legenda, Monitoramento } from "./Rodape";
import "./painelGovernanca.css";

function CardResumo({ rotulo, valor, sub, acento, Icone }: {
  rotulo: string; valor: string; sub: string; acento: string; Icone?: LucideIcon;
}) {
  return (
    <div className="pg-card pg-resumo" style={{ ["--acento" as string]: acento }}>
      <div className="pg-resumo-topo">
        <span className="pg-rotulo">{rotulo}</span>
        {Icone && <Icone size={15} color={acento} aria-hidden="true" />}
      </div>
      <div className="pg-numero">{valor}</div>
      <div className="pg-sub">{sub}</div>
    </div>
  );
}

function Cards({ painel }: { painel: Painel }) {
  const r = painel.resumo;
  const c = r.completude;
  const delta = r.saudeGeral !== null && painel.saudeAnterior !== null ? r.saudeGeral - painel.saudeAnterior : null;
  const comparacao = [
    painel.anterior ? `vs ${painel.anterior.label}: ${fmtPontosPercentuais(delta)}` : "",
    `tendência 3M: ${fmtPontosPercentuais(painel.tendenciaSaude)}`,
  ].filter(Boolean).join(" · ");
  const partes = [
    `${c.preenchidos} de ${c.esperados}`,
    c.comResultado ? `${c.comResultado} com resultado` : "",
    r.semDados ? `${r.semDados} sem evento no mês` : "",
    r.aguardando ? `${r.aguardando} aguardando` : "",
  ].filter(Boolean);
  return (
    <section className="pg-cards" aria-label="Resumo da competência">
      <CardResumo rotulo="Saúde geral" valor={fmtPercentual(r.saudeGeral, 1)} sub={`${r.n} indicadores avaliados · ${comparacao}`} acento="#7FB8FF" />
      <CardResumo rotulo="Adequados" valor={String(r.adequados)} sub={`${r.adequados}/${r.n} avaliados`} acento="var(--ok)" Icone={CircleCheck} />
      <CardResumo rotulo="Atenção" valor={String(r.atencao)} sub={`entre ${fmtPercentual(CORTE_ATENCAO)} e ${fmtPercentual(CORTE_ADEQUADO - 0.01)} da meta`} acento="var(--atencao)" Icone={TriangleAlert} />
      <CardResumo rotulo="Críticos" valor={String(r.criticos)} sub={`abaixo de ${fmtPercentual(CORTE_ATENCAO)} da meta`} acento="var(--critico)" Icone={CircleX} />
      <CardResumo rotulo="Completude" valor={fmtPercentual(c.percentual)} sub={partes.join(" · ")} acento="var(--sem-dados)" />
    </section>
  );
}

export default function PainelGovernanca({ urlPowerBI }: { urlPowerBI?: string }) {
  const [sp, setSp] = useSearchParams();
  const filtros = useMemo(() => lerFiltros(sp), [sp]);
  const [res, setRes] = useState<ResultadoBD | null>(() => ultimoGuardado());
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);

  const carregar = useCallback(async (forcar: boolean) => {
    setCarregando(true);
    try {
      setRes(await buscarBD(forcar));
      setErro(null);
    } catch (e) {
      setErro(e instanceof Error ? e.message : String(e));
    } finally {
      setCarregando(false);
    }
  }, []);

  useEffect(() => { void carregar(false); }, [carregar]);

  const mudar = useCallback(
    (f: Partial<EstadoFiltros>) => setSp((atual) => gravarFiltros(atual, f), { replace: true }),
    [setSp],
  );

  const [apresentando, setApresentando] = useState(false);
  const painel = useMemo(
    () => (res ? calcularPainel(res.payload.bd, { competencia: filtros.competencia, divisoes: filtros.divisoes }) : null),
    [res, filtros.competencia, filtros.divisoes],
  );

  const apresentar = () => {
    // Pedido direto no clique: o Firefox só aceita tela cheia dentro do gesto do usuário.
    void document.documentElement.requestFullscreen?.().catch(() => {});
    setApresentando(true);
  };

  if (!res || !painel) {
    if (carregando) return <Esqueleto />;
    return (
      <div className="pg-tokens pg">
        <div className="pg-card" role="alert" style={{ textAlign: "center", padding: 32 }}>
          <p style={{ margin: "0 0 12px", fontWeight: 600 }}>{erro ?? "Não foi possível carregar os indicadores agora."}</p>
          <button type="button" className="pg-btn" onClick={() => void carregar(true)}>
            <RefreshCw size={14} aria-hidden="true" /> Tentar de novo
          </button>
        </div>
      </div>
    );
  }

  const ref = painel.referencia;
  const escolhida = ref && painel.referenciaPadrao && ref.data !== painel.referenciaPadrao.data;
  const aviso = res.aviso ?? (erro ? `${erro} Exibindo dados de ${fmtGeradoEm(res.payload.gerado_em)}.` : null);

  return (
    <div className="pg-tokens pg">
      <header className="pg-cabecalho">
        <div className="pg-cab-esq">
          <h3 className="pg-titulo">PAINEL DE GOVERNANÇA — GAP-MN</h3>
          {ref && (
            <span
              className="pg-selo"
              title={
                escolhida
                  ? `Competência escolhida: ${competenciaPorExtenso(ref.label)}. A referência padrão é ${painel.referenciaPadrao!.label}.`
                  : `Competência de referência: ${competenciaPorExtenso(ref.label)}`
              }
            >
              <span className="pg-selo-ponto" style={escolhida ? { background: "var(--atencao)" } : undefined} />
              Competência: {ref.label}
            </span>
          )}
        </div>
        <div className="pg-cab-dir">
          <span className="pg-sub">Dados de {fmtGeradoEm(res.payload.gerado_em)}</span>
          <button type="button" className="pg-btn" onClick={() => void carregar(true)} disabled={carregando}>
            <RefreshCw size={14} className={carregando ? "pg-girando" : undefined} aria-hidden="true" />
            {carregando ? "Atualizando…" : "Atualizar agora"}
          </button>
          <button type="button" className="pg-btn" onClick={apresentar} title="Modo apresentação em tela cheia (Esc sai)">
            <Maximize size={14} aria-hidden="true" /> Tela cheia
          </button>
          {urlPowerBI && (
            <a className="pg-btn pg-btn-texto" href={urlPowerBI} target="_blank" rel="noreferrer" title="Abrir a versão anterior no Power BI">
              Power BI <ExternalLink size={12} aria-hidden="true" />
            </a>
          )}
        </div>
      </header>

      {aviso && <div className="pg-faixa" role="status">{aviso}</div>}

      {!ref ? (
        <div className="pg-card pg-vazio">Nenhuma competência preenchida ainda.</div>
      ) : (
        <>
          {painel.filtroDivisoes.length > 0 && (
            <div className="pg-sub">
              Filtrado por {painel.filtroDivisoes.join(", ")}: todos os números abaixo são dessa seleção; a posição no ranking é a geral.
            </div>
          )}
          <Cards painel={painel} />

          <div className="pg-principal">
            <div className="pg-card"><Indicadores painel={painel} filtros={filtros} aoMudar={mudar} /></div>
            <div className="pg-coluna">
              <Podio
                podio={painel.podio}
                filtradas={painel.filtroDivisoes.length ? painel.divisoes : undefined}
                ranqueadas={painel.divisoesRanqueadas}
              />
              <Piores piores={painel.piores} />
              <PorDivisao divisoes={painel.divisoes} />
            </div>
          </div>

          <Contagem grupos={painel.grupos} competencia={ref.label} />

          <div className="pg-rodape">
            {painel.monitoramento.length > 0 && <Monitoramento itens={painel.monitoramento} />}
            <Legenda sozinha={painel.monitoramento.length === 0} />
          </div>

          {apresentando && (
            <Apresentacao
              bd={res.payload.bd}
              competencia={filtros.competencia}
              inicio={filtros.divisoes.length === 1 ? filtros.divisoes[0] : null}
              geradoEm={res.payload.gerado_em}
              aoSair={() => setApresentando(false)}
            />
          )}

          {res.avisosDados.length > 0 && (
            <details className="pg-sub">
              <summary>{res.avisosDados.length} aviso(s) de formato na planilha</summary>
              <ul>{res.avisosDados.slice(0, 30).map((a) => <li key={a}>{a}</li>)}</ul>
            </details>
          )}
        </>
      )}
    </div>
  );
}
