// Painel do Auxílio Transporte: filtros numa fileira, quatro números, quatro gráficos e a tabela.
// Tudo responde aos mesmos filtros; clicar num mês, numa situação, numa OM ou numa faixa de valor filtra.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Bus, Maximize, Minimize, RefreshCw } from "lucide-react";
import {
  FAIXAS, FILTRO_VAZIO, filtrar, fmtMoeda, fmtNumero, opcoes, porFaixa, porMes, porOM, porSituacao, resumir,
  type DadosAT, type FiltroAT, type Leitura,
} from "../../lib/auxilioTransporte/dados.ts";
import Filtros from "./Filtros";
import { Barras, Colunas } from "./Graficos";
import Tabela from "./Tabela";

const compacto = (v: number) =>
  v.toLocaleString("pt-BR", { style: "currency", currency: "BRL", notation: "compact", maximumFractionDigits: 1 });

function quando(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  const dia = (x: Date) => x.toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" });
  const hora = d.toLocaleTimeString("pt-BR", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit" });
  return dia(d) === dia(new Date()) ? `hoje às ${hora}` : `${dia(d)} às ${hora}`;
}

function Atualizacao({ leituras }: { leituras: Leitura[] }) {
  const ok = leituras.find((l) => l.status === "ok");
  const completa = leituras.find((l) => l.status === "ok" && !l.parcial);
  const ultima = leituras[0];
  const falhou = ultima && ultima.status === "erro" && (!ok || ultima.iniciada_em > ok.iniciada_em);
  const novidades = ok ? [
    ok.novas ? `${fmtNumero(ok.novas)} novas` : "",
    ok.alteradas ? `${fmtNumero(ok.alteradas)} alteradas` : "",
    ok.sairam ? `${fmtNumero(ok.sairam)} saíram da lista` : "",
  ].filter(Boolean).join(" · ") : "";
  return (
    <div className="at-atualizacao">
      <span className="at-selo" data-tipo={ok ? "ok" : "neutro"}>
        <span className="at-ponto" aria-hidden="true" />
        {ok ? `Lido do SIGPES ${quando(ok.concluida_em)}` : "Ainda sem leitura completa do SIGPES"}
      </span>
      {novidades && <span className="at-atualizacao-sub">Na última leitura: {novidades}</span>}
      {ok?.parcial && (
        <span className="at-atualizacao-sub" title="Quem sincronizou vê só parte da lista no SIGPES: as solicitações que vieram foram atualizadas e as demais ficaram como estavam.">
          Leitura parcial (perfil que vê só parte da lista){completa ? ` · última completa ${quando(completa.concluida_em)}` : ""}
        </span>
      )}
      {!ok?.parcial && !!ok?.faltaram && (
        <span className="at-atualizacao-sub" title="O paginador do SIGPES contou mais solicitações do que as páginas entregaram. As que vieram foram atualizadas e ninguém saiu da lista por isso.">
          {fmtNumero(ok.faltaram)} das {fmtNumero(ok.total ?? 0)} contadas pelo SIGPES não vieram na leitura
        </span>
      )}
      {falhou && (
        <span className="at-selo" data-tipo="alerta" title={ultima.erro ?? undefined}>
          <span className="at-ponto" aria-hidden="true" /> A leitura de {quando(ultima.iniciada_em)} falhou{ultima.erro ? `: ${ultima.erro}` : ""}
        </span>
      )}
    </div>
  );
}

function Kpi({ rotulo, valor, sub, destaque = false, titulo }: { rotulo: string; valor: string; sub: string; destaque?: boolean; titulo?: string }) {
  return (
    <div className="at-kpi" data-destaque={destaque ? "1" : undefined} title={titulo}>
      <div className="at-kpi-rot">{rotulo}</div>
      <div className="at-kpi-val">{valor}</div>
      <div className="at-kpi-sub">{sub}</div>
    </div>
  );
}

const alternar = (lista: string[], v: string) => (lista.includes(v) ? lista.filter((x) => x !== v) : [...lista, v]);

export default function PainelAT({ dados, lendo, aoRecarregar }: { dados: DadosAT; lendo: boolean; aoRecarregar: () => void }) {
  const [filtro, setFiltro] = useState<FiltroAT>(FILTRO_VAZIO);
  const mudar = useCallback((f: FiltroAT) => setFiltro(f), []);
  const base = dados.solicitacoes;
  const filtradas = useMemo(() => filtrar(base, filtro), [base, filtro]);
  const naLista = useMemo(() => base.filter((s) => !s.foraDaLista).length, [base]);
  const op = useMemo(() => opcoes(base), [base]);
  const r = useMemo(() => resumir(filtradas), [filtradas]);
  const meses = useMemo(() => porMes(filtradas, 12), [filtradas]);
  const situacoes = useMemo(() => porSituacao(filtradas), [filtradas]);
  const oms = useMemo(() => porOM(filtradas, 10), [filtradas]);
  const faixas = useMemo(() => porFaixa(filtradas), [filtradas]);

  // tela cheia para apresentações: o painel inteiro, com rolagem; Esc ou o botão saem
  const raiz = useRef<HTMLDivElement>(null);
  const [cheia, setCheia] = useState(false);
  useEffect(() => {
    const aoMudar = () => setCheia(!!raiz.current && document.fullscreenElement === raiz.current);
    document.addEventListener("fullscreenchange", aoMudar);
    return () => document.removeEventListener("fullscreenchange", aoMudar);
  }, []);
  const alternarTelaCheia = () => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void raiz.current?.requestFullscreen?.().catch(() => undefined);
  };

  const mesAtivo = (mes: string) => {
    const [a, m] = mes.split("-").map(Number);
    const fim = new Date(Date.UTC(a, m, 0)).toISOString().slice(0, 10);
    return filtro.de === `${mes}-01` && filtro.ate === fim;
  };

  return (
    <div className="at-painel" ref={raiz} data-lendo={lendo ? "1" : undefined} data-cheia={cheia ? "1" : undefined}>
      <header className="at-topo">
        <div className="at-marca">
          <span className="at-marca-icone" aria-hidden="true"><Bus size={22} /></span>
          <div>
            <h1 className="at-titulo">Auxílio Transporte</h1>
            <p className="at-subtitulo">Solicitações lidas do SIGPES · {fmtNumero(naLista)} na lista</p>
          </div>
        </div>
        <div className="at-topo-dir">
          <Atualizacao leituras={dados.leituras} />
          <button type="button" className="at-botao" onClick={aoRecarregar} disabled={lendo}>
            <RefreshCw size={15} className={lendo ? "at-girando" : undefined} aria-hidden="true" /> {lendo ? "Carregando…" : "Recarregar"}
          </button>
          <button type="button" className="at-botao" onClick={alternarTelaCheia} aria-pressed={cheia}>
            {cheia ? <Minimize size={15} aria-hidden="true" /> : <Maximize size={15} aria-hidden="true" />}
            {cheia ? "Sair da tela cheia" : "Tela cheia"}
          </button>
        </div>
      </header>

      <Filtros filtro={filtro} aoMudar={mudar} opcoes={op} />

      <section className="at-kpis" aria-label="Resumo">
        <Kpi destaque rotulo="Solicitações" valor={fmtNumero(r.quantidade)}
          sub={r.quantidade === naLista && !filtro.incluirForaDaLista ? "todas as da lista do SIGPES" : `de ${fmtNumero(naLista)} na lista do SIGPES`} />
        <Kpi rotulo="Valor total" valor={compacto(r.valorTotal)} sub="soma dos valores solicitados" titulo={fmtMoeda(r.valorTotal)} />
        <Kpi rotulo="Valor médio" valor={r.valorMedio === null ? "—" : fmtMoeda(r.valorMedio)} sub="por solicitação" />
        <Kpi rotulo="Em andamento" valor={fmtNumero(r.emAndamento)} sub={`${fmtNumero(r.finalizadas)} finalizadas · ${fmtNumero(r.canceladas)} canceladas`} />
      </section>

      <div className="at-grade">
        <section className="at-cartao at-largo" aria-label="Solicitações por mês">
          <div className="at-cartao-topo">
            <div>
              <h2 className="at-cartao-tit">Solicitações por mês</h2>
              <p className="at-cartao-sub">Pela data da solicitação; clique num mês para filtrar</p>
            </div>
          </div>
          {meses.length ? (
            <Colunas rotuloAcao="Clique para filtrar este mês."
              barras={meses.map((m) => ({ chave: m.mes, rotulo: m.rotulo, quantidade: m.quantidade, valor: m.valor, ativo: mesAtivo(m.mes) }))}
              aoEscolher={(b) => {
                if (mesAtivo(b.chave)) { setFiltro({ ...filtro, de: null, ate: null }); return; }
                const [a, m] = b.chave.split("-").map(Number);
                setFiltro({ ...filtro, de: `${b.chave}-01`, ate: new Date(Date.UTC(a, m, 0)).toISOString().slice(0, 10) });
              }} />
          ) : <p className="at-vazio">Sem solicitações com data.</p>}
        </section>

        <section className="at-cartao" aria-label="Por situação">
          <div className="at-cartao-topo">
            <div>
              <h2 className="at-cartao-tit">Por situação</h2>
              <p className="at-cartao-sub">Clique para filtrar</p>
            </div>
          </div>
          <Barras rotuloAcao="Clique para filtrar esta situação."
            barras={situacoes.map((s) => ({ chave: s.rotulo, rotulo: s.rotulo, quantidade: s.quantidade, valor: s.valor, ativo: filtro.situacoes.includes(s.rotulo) }))}
            aoEscolher={(b) => setFiltro({ ...filtro, situacoes: alternar(filtro.situacoes, b.chave) })} />
        </section>

        <section className="at-cartao" aria-label="Por OM">
          <div className="at-cartao-topo">
            <div>
              <h2 className="at-cartao-tit">Por OM</h2>
              <p className="at-cartao-sub">As 10 com mais solicitações; clique para filtrar</p>
            </div>
          </div>
          <Barras rotuloAcao="Clique para filtrar esta OM."
            barras={oms.map((o) => ({ chave: o.rotulo, rotulo: o.rotulo, quantidade: o.quantidade, valor: o.valor, ativo: filtro.oms.includes(o.rotulo), neutra: o.outras }))}
            aoEscolher={(b) => setFiltro({ ...filtro, oms: alternar(filtro.oms, b.chave) })} />
        </section>

        <section className="at-cartao" aria-label="Faixas de valor">
          <div className="at-cartao-topo">
            <div>
              <h2 className="at-cartao-tit">Faixas de valor</h2>
              <p className="at-cartao-sub">Em reais; clique numa faixa para filtrar</p>
            </div>
          </div>
          <Colunas rotuloAcao="Clique para filtrar esta faixa de valor."
            barras={faixas.map((f) => ({
              chave: f.rotulo, rotulo: f.rotulo, quantidade: f.quantidade, valor: f.valor,
              ativo: filtro.valorMin === f.faixa.min && filtro.valorMax === (f.faixa.max === null ? null : f.faixa.max - 0.01),
            }))}
            aoEscolher={(b) => {
              const f = FAIXAS.find((x) => x.rotulo === b.chave)!;
              const max = f.max === null ? null : f.max - 0.01;
              const ja = filtro.valorMin === f.min && filtro.valorMax === max;
              setFiltro({ ...filtro, valorMin: ja ? null : f.min, valorMax: ja ? null : max });
            }} />
        </section>
      </div>

      <Tabela lista={filtradas} />

      <footer className="at-rodape">Dados do SIGPES, lidos uma vez por dia pela extensão &ldquo;Auxílio Transporte — Leitor do SIGPES&rdquo;.</footer>
    </div>
  );
}
