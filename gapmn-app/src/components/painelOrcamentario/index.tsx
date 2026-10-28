// Painel Orçamentário — aba Crédito do Power BI "Painel de Controle | DOC-MN", refeita no app.
// Lê as mesmas planilhas do BI direto do Google (lib/orcamento/fonte.ts) e relê sozinho a cada
// 5 minutos; as medidas ficam em lib/orcamento/calculo.ts. Aqui só se busca, filtra e desenha.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BanknoteArrowUp, HandCoins, Maximize, Minimize, Percent, RefreshCw, X } from "lucide-react";
import { montarPainel } from "../../lib/orcamento/calculo.ts";
import { buscarOrcamento, orcamentoGuardado, type ResultadoOrcamento } from "../../lib/orcamento/fonte.ts";
import { fmtCompacto, fmtData, fmtHora, fmtMoeda, fmtPct } from "../../lib/orcamento/formato.ts";
import type { FiltroCredito } from "../../lib/orcamento/tipos.ts";
import Disponivel from "./Disponivel";
import EmpenhosDoDia from "./EmpenhosDoDia";
import { Colunas, Faixa } from "./Graficos";
import "./painelOrcamentario.css";

const ATUALIZAR_A_CADA_MS = 5 * 60_000;
const SEM_FILTRO: FiltroCredito = { om: null, nd: null };

function Kpi({ rotulo, valor, dica, Icone }: { rotulo: string; valor: string; dica: string; Icone: typeof HandCoins }) {
  return (
    <div className="po-kpi" title={dica}>
      <div>
        <div className="po-kpi-rot">{rotulo}</div>
        <div className="po-kpi-val">{valor}</div>
      </div>
      <Icone className="po-kpi-ico" size={40} strokeWidth={1.4} aria-hidden="true" />
    </div>
  );
}

/** `publico`: página aberta, sem login (INTRAER) — esconde e-mails e telefones das observações das notas. */
export default function PainelOrcamentario({ publico = false }: { publico?: boolean }) {
  const [res, setRes] = useState<ResultadoOrcamento | null>(() => orcamentoGuardado());
  const [lendo, setLendo] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [filtro, setFiltro] = useState<FiltroCredito>(SEM_FILTRO);
  const [cheia, setCheia] = useState(false);
  const raiz = useRef<HTMLDivElement>(null);
  const emCurso = useRef(false);
  const ultimaLeitura = useRef(0);

  const atualizar = useCallback(async () => {
    if (emCurso.current) return;
    emCurso.current = true;
    setLendo(true);
    try {
      setRes(await buscarOrcamento());
      setErro(null);
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não foi possível ler as planilhas.");
    } finally {
      emCurso.current = false;
      ultimaLeitura.current = Date.now();
      setLendo(false);
    }
  }, []);

  useEffect(() => {
    atualizar();
    const relogio = setInterval(() => { if (document.visibilityState === "visible") atualizar(); }, ATUALIZAR_A_CADA_MS);
    const aoVoltar = () => {
      if (document.visibilityState === "visible" && Date.now() - ultimaLeitura.current > 60_000) atualizar();
    };
    document.addEventListener("visibilitychange", aoVoltar);
    return () => { clearInterval(relogio); document.removeEventListener("visibilitychange", aoVoltar); };
  }, [atualizar]);

  useEffect(() => {
    const aoMudar = () => setCheia(document.fullscreenElement === raiz.current && !!raiz.current);
    document.addEventListener("fullscreenchange", aoMudar);
    return () => document.removeEventListener("fullscreenchange", aoMudar);
  }, []);

  const alternarTelaCheia = () => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void raiz.current?.requestFullscreen?.().catch(() => undefined);
  };

  const painel = useMemo(() => (res ? montarPainel(res.dados, filtro) : null), [res, filtro]);
  const temFiltro = filtro.om !== null || filtro.nd !== null;

  const acoes = (
    <div className="po-acoes">
      <button type="button" className="po-btn" onClick={atualizar} disabled={lendo} title="Ler as planilhas de novo agora">
        <RefreshCw size={14} className={lendo ? "po-girando" : undefined} aria-hidden="true" />
        {lendo ? "Lendo…" : "Atualizar"}
      </button>
      <button type="button" className="po-btn" onClick={alternarTelaCheia}>
        {cheia ? <Minimize size={14} aria-hidden="true" /> : <Maximize size={14} aria-hidden="true" />}
        {cheia ? "Sair da tela cheia" : "Tela cheia"}
      </button>
    </div>
  );

  if (!painel) {
    return (
      <div className="po po-estado" ref={raiz}>
        {erro ? (
          <>
            <p><b>Não foi possível ler as planilhas do painel.</b></p>
            <p>{erro}</p>
            {acoes}
          </>
        ) : (
          <p className="po-carregando">Lendo as planilhas de crédito, empenho e saldo…</p>
        )}
      </div>
    );
  }

  return (
    <div className="po" ref={raiz} data-cheia={cheia ? "1" : undefined}>
      <div className="po-grade">
        <aside className="po-lateral" aria-label="Filtros">
          <img className="po-lat-logo" src="/om/acantos.png" alt="" />
          <div className="po-lat-tit">Filtros</div>
          <label className="po-campo">
            <span>Selecione a OM</span>
            <select value={filtro.om ?? ""} onChange={(e) => setFiltro((f) => ({ ...f, om: e.target.value || null }))}>
              <option value="">Todas</option>
              {painel.opcoesOM.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </label>
          <label className="po-campo">
            <span>Selecione a ND</span>
            <select value={filtro.nd ?? ""} onChange={(e) => setFiltro((f) => ({ ...f, nd: e.target.value || null }))}>
              <option value="">Todas</option>
              {painel.opcoesND.map((o) => (
                <option key={o.codigo} value={o.codigo}>{o.nome ? `${o.codigo} – ${o.nome}` : o.codigo}</option>
              ))}
            </select>
          </label>
          {temFiltro && (
            <button type="button" className="po-limpar" onClick={() => setFiltro(SEM_FILTRO)}>
              <X size={13} aria-hidden="true" /> Limpar filtros
            </button>
          )}
          <div className="po-info-bloco">
            <div className="po-lat-tit">Quadro Informativo</div>
            <p className="po-info">
              Dados lidos das planilhas de crédito, empenho e saldo do SIAFI. O painel relê tudo sozinho a cada 5 minutos.
            </p>
            <p className="po-info">
              Passe o mouse numa unidade em <i>Crédito Disponível</i> para ver o saldo por PI e ND.
              <b> Clique na unidade para fixar</b> o detalhe e rolar.
            </p>
            <p className="po-info">
              Em <i>Empenhos do dia</i>, escolha o dia nas setas ou no calendário e clique numa nota para ver os detalhes.
            </p>
          </div>
          <div className="po-lat-rodape">
            <div className="po-atualizado">
              Atualizado em {fmtData(painel.atualizadoEm)}
              {res && <span className="po-lido"> · lido às {fmtHora(res.lidoEm)}</span>}
            </div>
            <div className="po-lat-logos" aria-hidden="true">
              <img src="/om/gapmn-brasao.png" alt="" />
              <img src="/om/gladio.png" alt="" />
            </div>
          </div>
        </aside>

        <div className="po-centro">
          <div className="po-topo">
            <h2 className="po-titulo">Painel de Controle | DOC-MN</h2>
            {acoes}
          </div>
          {erro && (
            <div className="po-aviso" role="status">
              Não consegui reler as planilhas agora. {erro} Mostrando a leitura das {res ? fmtHora(res.lidoEm) : "—"}.
            </div>
          )}

          <section className="po-cartao po-kpis" aria-label="Resumo">
            <Kpi rotulo="Crédito Recebido" valor={`R$ ${fmtCompacto(painel.recebido)}`} dica={fmtMoeda(painel.recebido)} Icone={HandCoins} />
            <Kpi rotulo="Empenhado" valor={`R$ ${fmtCompacto(painel.empenhado)}`} dica={fmtMoeda(painel.empenhado)} Icone={BanknoteArrowUp} />
            <Kpi rotulo="% Empenhado" valor={fmtPct(painel.pctEmpenhado)} dica="Empenhado ÷ crédito recebido" Icone={Percent} />
          </section>

          <Faixa faixa={painel.faixa} ano={painel.ano} />

          <Colunas titulo={`Crédito Recebido por meses (${painel.ano ?? "—"})`} itens={painel.porMes} />

          <EmpenhosDoDia dados={res?.dados.lancamentos} filtro={filtro} publico={publico} />
        </div>

        <Disponivel unidades={painel.disponivel} total={painel.totalDisponivel} ultimoDia={painel.atualizadoEm} />
      </div>
    </div>
  );
}
