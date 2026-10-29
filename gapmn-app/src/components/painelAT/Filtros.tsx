// Barra de filtros do Painel do Auxílio Transporte: uma fileira acima de tudo, vale para cartões,
// gráficos e tabela. Busca em todos os campos, faixa de valor, OM, situação, posto e período.
import { useEffect, useRef, useState } from "react";
import { Check, ChevronDown, Search, X } from "lucide-react";
import { FAIXAS, FILTRO_VAZIO, filtroAtivo, lerValor, semAcento, type FiltroAT } from "../../lib/auxilioTransporte/dados.ts";

/** Lista de escolha múltipla com busca (OM, situação, posto). */
function Escolha({ rotulo, opcoes, marcados, aoMudar }: {
  rotulo: string; opcoes: string[]; marcados: string[]; aoMudar: (v: string[]) => void;
}) {
  const [aberto, setAberto] = useState(false);
  const [busca, setBusca] = useState("");
  const raiz = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!aberto) return;
    const fora = (e: PointerEvent) => { if (!raiz.current?.contains(e.target as Node)) setAberto(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setAberto(false); };
    document.addEventListener("pointerdown", fora);
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("pointerdown", fora); document.removeEventListener("keydown", esc); };
  }, [aberto]);
  const sel = new Set(marcados);
  const visiveis = busca ? opcoes.filter((o) => semAcento(o).includes(semAcento(busca))) : opcoes;
  const resumo = !marcados.length ? "todas" : marcados.length === 1 ? marcados[0] : `${marcados[0]} +${marcados.length - 1}`;
  const alternar = (o: string) => aoMudar(sel.has(o) ? marcados.filter((x) => x !== o) : [...marcados, o]);
  return (
    <div className="at-escolha" ref={raiz}>
      <button type="button" className="at-campo at-escolha-botao" data-ativo={marcados.length ? "1" : undefined}
        aria-expanded={aberto} aria-haspopup="listbox" onClick={() => setAberto((a) => !a)}>
        <span className="at-campo-rot">{rotulo}</span>
        <span className="at-escolha-resumo">{resumo}</span>
        <ChevronDown size={14} aria-hidden="true" />
      </button>
      {aberto && (
        <div className="at-escolha-caixa" role="dialog" aria-label={rotulo}>
          {opcoes.length > 8 && (
            <input className="at-escolha-busca" autoFocus placeholder={`Procurar ${rotulo.toLowerCase()}…`} value={busca}
              onChange={(e) => setBusca(e.target.value)} />
          )}
          <ul role="listbox" aria-multiselectable="true">
            {visiveis.map((o) => (
              <li key={o} role="option" aria-selected={sel.has(o)}>
                <button type="button" onClick={() => alternar(o)}>
                  <span className="at-check">{sel.has(o) && <Check size={14} strokeWidth={3} aria-hidden="true" />}</span>
                  {o}
                </button>
              </li>
            ))}
            {!visiveis.length && <li className="at-escolha-vazio">Nada encontrado</li>}
          </ul>
          {marcados.length > 0 && <button type="button" className="at-link" onClick={() => aoMudar([])}>Limpar {rotulo.toLowerCase()}</button>}
        </div>
      )}
    </div>
  );
}

/**
 * Campo de valor em reais: aceita "5000", "5.000" e "R$ 5.000,00"; aplica ao sair do campo ou no Enter.
 * Quem usa passa `key` com o valor, para o campo recomeçar quando o filtro muda por fora (faixa, gráfico, limpar).
 */
function CampoValor({ rotulo, valor, aoMudar }: { rotulo: string; valor: number | null; aoMudar: (v: number | null) => void }) {
  const [texto, setTexto] = useState(valor === null ? "" : valor.toLocaleString("pt-BR"));
  const lido = lerValor(texto);
  const aplicar = () => { if (lido !== undefined && lido !== valor) aoMudar(lido); };
  return (
    <label className="at-valor-campo">
      <span className="at-oculto">{rotulo}</span>
      <span aria-hidden="true">R$</span>
      <input inputMode="decimal" value={texto} placeholder={rotulo === "Valor mínimo" ? "de" : "até"} aria-invalid={lido === undefined}
        onChange={(e) => setTexto(e.target.value)} onBlur={aplicar} onKeyDown={(e) => { if (e.key === "Enter") aplicar(); }} />
    </label>
  );
}

export default function Filtros({ filtro, aoMudar, opcoes }: {
  filtro: FiltroAT; aoMudar: (f: FiltroAT) => void; opcoes: { oms: string[]; situacoes: string[]; pgs: string[] };
}) {
  const [busca, setBusca] = useState(filtro.busca);
  // filtro mudado por fora (limpar filtros): o campo acompanha
  const [buscaDoFiltro, setBuscaDoFiltro] = useState(filtro.busca);
  if (filtro.busca !== buscaDoFiltro) { setBuscaDoFiltro(filtro.busca); setBusca(filtro.busca); }
  // a busca filtra enquanto digita, com um respiro para não recalcular a cada tecla
  useEffect(() => {
    if (busca === filtro.busca) return;
    const t = setTimeout(() => aoMudar({ ...filtro, busca }), 220);
    return () => clearTimeout(t);
  }, [busca, filtro, aoMudar]);
  const faixaAtiva = FAIXAS.find((f) => f.min === filtro.valorMin && (f.max === null ? filtro.valorMax === null : filtro.valorMax === f.max - 0.01));
  return (
    <section className="at-filtros" aria-label="Filtros">
      <label className="at-busca">
        <Search size={16} aria-hidden="true" />
        <span className="at-oculto">Buscar</span>
        <input type="search" value={busca} placeholder="Buscar nome, nº de ordem, OM, id, valor…" onChange={(e) => setBusca(e.target.value)} />
      </label>

      <div className="at-campo at-valor" data-ativo={filtro.valorMin !== null || filtro.valorMax !== null ? "1" : undefined}>
        <span className="at-campo-rot">Valor</span>
        <CampoValor key={`min-${filtro.valorMin}`} rotulo="Valor mínimo" valor={filtro.valorMin} aoMudar={(v) => aoMudar({ ...filtro, valorMin: v })} />
        <span className="at-valor-ate" aria-hidden="true">–</span>
        <CampoValor key={`max-${filtro.valorMax}`} rotulo="Valor máximo" valor={filtro.valorMax} aoMudar={(v) => aoMudar({ ...filtro, valorMax: v })} />
        <select className="at-valor-faixa" aria-label="Faixa de valor pronta" value={faixaAtiva?.rotulo ?? ""}
          onChange={(e) => {
            const f = FAIXAS.find((x) => x.rotulo === e.target.value);
            aoMudar({ ...filtro, valorMin: f ? f.min : null, valorMax: f ? (f.max === null ? null : f.max - 0.01) : null });
          }}>
          <option value="">faixas</option>
          {FAIXAS.map((f) => <option key={f.rotulo} value={f.rotulo}>{f.rotulo}</option>)}
        </select>
      </div>

      <Escolha rotulo="OM" opcoes={opcoes.oms} marcados={filtro.oms} aoMudar={(oms) => aoMudar({ ...filtro, oms })} />
      <Escolha rotulo="Situação" opcoes={opcoes.situacoes} marcados={filtro.situacoes} aoMudar={(situacoes) => aoMudar({ ...filtro, situacoes })} />
      <Escolha rotulo="P/G" opcoes={opcoes.pgs} marcados={filtro.pgs} aoMudar={(pgs) => aoMudar({ ...filtro, pgs })} />

      <div className="at-campo at-periodo" data-ativo={filtro.de || filtro.ate ? "1" : undefined}>
        <span className="at-campo-rot">Solicitado</span>
        <input type="date" aria-label="Solicitado a partir de" value={filtro.de ?? ""} onChange={(e) => aoMudar({ ...filtro, de: e.target.value || null })} />
        <span aria-hidden="true">–</span>
        <input type="date" aria-label="Solicitado até" value={filtro.ate ?? ""} onChange={(e) => aoMudar({ ...filtro, ate: e.target.value || null })} />
      </div>

      <label className="at-marcar">
        <input type="checkbox" checked={filtro.incluirForaDaLista} onChange={(e) => aoMudar({ ...filtro, incluirForaDaLista: e.target.checked })} />
        Incluir quem saiu da lista
      </label>

      {filtroAtivo(filtro) && (
        <button type="button" className="at-limpar" onClick={() => aoMudar(FILTRO_VAZIO)}>
          <X size={14} aria-hidden="true" /> Limpar filtros
        </button>
      )}
    </section>
  );
}
