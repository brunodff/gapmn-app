// "Empenhos do dia": emissões, reforços e anulações de empenho de um dia, com os filtros de OM e ND
// do painel. Cada linha abre os detalhes da nota (itens, PI, PAG, favorecido e os outros lançamentos).
// Os dados vêm da mesma planilha de empenhos que o painel relê a cada 5 minutos (lib/orcamento/lancamentos.ts).

import { useMemo, useState } from "react";
import { ChevronDown, ChevronLeft, ChevronRight, ChevronsRight } from "lucide-react";
import { fmtData, fmtMoeda } from "../../lib/orcamento/formato.ts";
import {
  diasComLancamento, resumirDia, semContatos,
  type LancamentosEmpenho, type Lancamento, type NotaDoDia, type TipoLancamento,
} from "../../lib/orcamento/lancamentos.ts";
import type { FiltroCredito } from "../../lib/orcamento/tipos.ts";

const ROTULO: Record<TipoLancamento, string> = { emissao: "Emissão", reforco: "Reforço", anulacao: "Anulação" };
const ROTULO_PLURAL: Record<TipoLancamento, string> = { emissao: "Emitidos", reforco: "Reforçados", anulacao: "Anulados" };
const TIPOS: TipoLancamento[] = ["emissao", "reforco", "anulacao"];

const fmtCNPJ = (d: string) =>
  d.length === 14 ? `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}` : d;
const diaSemana = (iso: string) =>
  new Date(`${iso}T12:00:00`).toLocaleDateString("pt-BR", { weekday: "long" });

function objetoDa(n: NotaDoDia): string {
  const maior = n.itens.reduce<NotaDoDia["itens"][number] | null>((m, it) => (!m || it.valor > m.valor ? it : m), null);
  const nome = maior?.nome || n.observacao;
  return n.itens.length > 1 ? `${nome} e mais ${n.itens.length - 1} ${n.itens.length === 2 ? "item" : "itens"}` : nome;
}

export default function EmpenhosDoDia({ dados, filtro, publico = false }: {
  dados: LancamentosEmpenho | undefined;
  filtro: FiltroCredito;
  publico?: boolean;
}) {
  const notas = useMemo(() => new Map((dados?.notas ?? []).map((n) => [n.ne, n])), [dados]);

  // lançamentos que passam nos filtros de OM e ND do painel
  const filtrados = useMemo(() => (dados?.lancamentos ?? []).filter((l) => {
    const n = notas.get(l.ne);
    if (!n) return false;
    if (filtro.om !== null && n.sigla !== filtro.om) return false;
    if (filtro.nd !== null && n.nd !== filtro.nd) return false;
    return true;
  }), [dados, notas, filtro]);

  const dias = useMemo(() => diasComLancamento(filtrados), [filtrados]);
  const [dia, setDia] = useState<string | null>(null);
  const [tipos, setTipos] = useState<Set<TipoLancamento>>(() => new Set(TIPOS));
  const [aberto, setAberto] = useState<string | null>(null);

  // sem dia escolhido, mostra o mais recente que tem empenho
  const diaAtual = dia ?? dias[0] ?? null;
  const irPara = (d: string | null) => { setDia(d); setAberto(null); };

  const doDia = useMemo(() => filtrados.filter((l) => l.data === diaAtual), [filtrados, diaAtual]);
  const resumo = useMemo(() => resumirDia(doDia), [doDia]);
  const visiveis = doDia.filter((l) => tipos.has(l.tipo))
    .sort((a, b) => TIPOS.indexOf(a.tipo) - TIPOS.indexOf(b.tipo) || Math.abs(b.valor) - Math.abs(a.valor));

  // `dias` vem do mais recente para o mais antigo; as setas pulam para o dia com empenho mais próximo
  const anterior = diaAtual ? dias.find((d) => d < diaAtual) ?? null : null;
  const seguinte = diaAtual ? [...dias].reverse().find((d) => d > diaAtual) ?? null : null;

  const alternarTipo = (t: TipoLancamento) => setTipos((s) => {
    const n = new Set(s);
    if (n.has(t) && n.size > 1) n.delete(t); else n.add(t);
    return n;
  });

  return (
    <section className="po-cartao po-emp" aria-label="Empenhos do dia">
      <div className="po-emp-topo">
        <div className="po-cartao-tit po-emp-tit">
          Empenhos do dia
          {diaAtual && <span className="po-emp-dia-nome"> · {diaSemana(diaAtual)}</span>}
        </div>
        <div className="po-emp-nav" role="group" aria-label="Escolher o dia">
          <button type="button" className="po-emp-seta" disabled={!anterior} onClick={() => anterior && irPara(anterior)}
            title={anterior ? `Dia anterior com empenho: ${fmtData(anterior)}` : "Não há dia anterior com empenho"}>
            <ChevronLeft size={15} aria-hidden="true" />
          </button>
          <input type="date" className="po-emp-data" aria-label="Dia" value={diaAtual ?? ""}
            min={dias[dias.length - 1]} max={dias[0]}
            onChange={(e) => irPara(e.target.value || null)} />
          <button type="button" className="po-emp-seta" disabled={!seguinte} onClick={() => seguinte && irPara(seguinte)}
            title={seguinte ? `Próximo dia com empenho: ${fmtData(seguinte)}` : "Não há dia seguinte com empenho"}>
            <ChevronRight size={15} aria-hidden="true" />
          </button>
          <button type="button" className="po-emp-seta" disabled={!dias.length || diaAtual === dias[0]} onClick={() => irPara(dias[0] ?? null)}
            title="Ir para o dia mais recente">
            <ChevronsRight size={15} aria-hidden="true" />
          </button>
        </div>
      </div>

      {!dados ? (
        <div className="po-vazio">Lendo os lançamentos de empenho…</div>
      ) : (
        <>
          <div className="po-emp-resumo" role="group" aria-label="Mostrar por tipo">
            {TIPOS.map((t) => (
              <button type="button" key={t} className="po-emp-chip" data-tipo={t} aria-pressed={tipos.has(t)}
                onClick={() => alternarTipo(t)} title={tipos.has(t) ? "Clique para esconder" : "Clique para mostrar"}>
                <span className="po-emp-chip-rot">{ROTULO_PLURAL[t]}</span>
                <span className="po-emp-chip-n">{resumo[t].quantidade}</span>
                <span className="po-emp-chip-v">{fmtMoeda(resumo[t].valor)}</span>
              </button>
            ))}
          </div>

          {visiveis.length === 0 ? (
            <div className="po-vazio">
              {diaAtual ? `Nenhum empenho ${tipos.size < 3 ? "desse tipo " : ""}em ${fmtData(diaAtual)} para este filtro.` : "Sem empenhos para este filtro."}
            </div>
          ) : (
            <ul className="po-emp-lista">
              {visiveis.map((l) => {
                const n = notas.get(l.ne)!;
                const abrir = aberto === l.id;
                return (
                  <li key={l.id} className="po-emp-item" data-aberto={abrir ? "1" : undefined}>
                    <button type="button" className="po-emp-linha" aria-expanded={abrir} onClick={() => setAberto(abrir ? null : l.id)}>
                      <ChevronDown size={14} className="po-emp-chev" aria-hidden="true" />
                      <span className="po-emp-tipo" data-tipo={l.tipo}>{ROTULO[l.tipo]}</span>
                      <span className="po-emp-ne">{l.ne}</span>
                      <span className="po-emp-om">{n.sigla ?? n.ug}</span>
                      <span className="po-emp-obj" title={objetoDa(n)}>{objetoDa(n)}</span>
                      <span className="po-emp-val" data-neg={l.valor < 0 ? "1" : undefined}>
                        {fmtMoeda(l.valor)}{l.origem === "a conferir" && <sup title="A planilha não fecha com o valor atual da nota: conferir no SIAFI"> *</sup>}
                      </span>
                    </button>
                    {abrir && <Detalhe nota={n} lancamento={l} publico={publico} />}
                  </li>
                );
              })}
            </ul>
          )}
        </>
      )}
    </section>
  );
}

function Detalhe({ nota: n, lancamento: l, publico }: { nota: NotaDoDia; lancamento: Lancamento; publico: boolean }) {
  const fav = n.favorecido.tipo === "pessoa"
    ? "Pessoa física"
    : `${n.favorecido.nome}${n.favorecido.documento ? ` (${n.favorecido.tipo === "empresa" ? fmtCNPJ(n.favorecido.documento) : `UG ${n.favorecido.documento}`})` : ""}`;
  const obs = publico ? semContatos(n.observacao) : n.observacao;
  return (
    <div className="po-emp-det">
      {l.origem === "a conferir" && (
        <p className="po-emp-aviso">* Os lançamentos desta nota na planilha não fecham com o valor atual dela. O valor mostrado é o que veio da planilha: conferir no SIAFI.</p>
      )}
      {l.origem === "deduzido" && (
        <p className="po-emp-nota">Nota zerada: o valor de cada lançamento foi deduzido da planilha, que repete o movimento em cada operação dos itens.</p>
      )}
      <dl className="po-emp-campos">
        <div><dt>Unidade</dt><dd>{n.ugNome || n.ug}{n.ug ? ` (${n.ug})` : ""}</dd></div>
        <div><dt>Favorecido</dt><dd>{fav}</dd></div>
        <div><dt>Natureza</dt><dd>{n.nd}{n.ndNome ? ` – ${n.ndNome}` : ""}</dd></div>
        <div><dt>PI</dt><dd>{n.pi}{n.piNome ? ` – ${n.piNome}` : ""}</dd></div>
        {n.pag && <div><dt>PAG</dt><dd>{n.pag}</dd></div>}
        {n.solicitacao && <div><dt>Solicitação</dt><dd>{n.solicitacao}</dd></div>}
        <div><dt>Valor atual da nota</dt><dd>{fmtMoeda(n.valorAtual)}</dd></div>
        <div><dt>Assinatura</dt><dd>{n.assinada ? "Assinada" : "Pendente"}</dd></div>
      </dl>

      <div className="po-emp-sub">Lançamentos da nota</div>
      <ol className="po-emp-hist">
        {n.lancamentos.map((x) => (
          <li key={x.id} data-atual={x.id === l.id ? "1" : undefined}>
            <span>{fmtData(x.data)}</span>
            <span className="po-emp-tipo" data-tipo={x.tipo}>{ROTULO[x.tipo]}</span>
            <span className="po-emp-val" data-neg={x.valor < 0 ? "1" : undefined}>{fmtMoeda(x.valor)}{x.origem === "a conferir" && " *"}</span>
          </li>
        ))}
      </ol>

      {n.itens.length > 0 && (
        <>
          <div className="po-emp-sub">Itens (valor atual)</div>
          <ul className="po-emp-itens">
            {n.itens.map((it) => (
              <li key={it.seq} title={it.descricao}>
                <span className="po-emp-seq">{it.seq}</span>
                <span className="po-emp-item-nome">{it.descricao.replace(/^item\s*compra\s*:\s*/i, "")}</span>
                <span className="po-emp-val">{fmtMoeda(it.valor)}</span>
              </li>
            ))}
          </ul>
        </>
      )}

      {obs && (
        <>
          <div className="po-emp-sub">Observação</div>
          <p className="po-emp-obs">{obs}</p>
        </>
      )}
    </div>
  );
}
