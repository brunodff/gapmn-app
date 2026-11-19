// Mapa das compras: licitações publicadas no PNCP por município, igual ao do CCGP, no layout do gapmn.app.
// Com palavra-chave, a busca é exata (o PNCP acha palavras parecidas: CLAUDE trazia Claudia): o app confere
// as 500 compras mais recentes que o PNCP devolve e fica só com as que têm a palavra ou frase inteira.
import { useMemo, useState } from "react";
import { filtrarExato } from "../../lib/buscaExata";
import MapaBrasil, { type PontoMapa } from "./MapaBrasil";
import { ESFERAS, MODALIDADES, SITUACOES, UFS, linkPncp, urlPncp, usePaginasPncp, type FiltrosPncp, type ItemPncp } from "./pncp";

const PAGINAS = 2;        // sem palavra-chave: as 200 compras mais recentes
const PAGINAS_EXATO = 5;  // com palavra-chave: confere as 500 mais recentes e fica com as que têm a palavra exata

const BRL = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const numero = (n: number) => n.toLocaleString("pt-BR");
const dataBR = (d: string | null) => (d ? new Date(d.length === 10 ? d + "T12:00:00" : d).toLocaleDateString("pt-BR") : "");
const campo = "w-full rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs outline-none focus:ring-2 focus:ring-sky-200";

export default function MapaCompras() {
  const [f, setF] = useState<FiltrosPncp>({ q: "ar condicionado", uf: "", modalidade: "", esfera: "", status: "recebendo_proposta" });
  const [municipio, setMunicipio] = useState<string | null>(null);
  const urls = useMemo(() => Array.from({ length: f.q ? PAGINAS_EXATO : PAGINAS }, (_, i) => urlPncp(f, i + 1, 100)), [f]);
  const { itens: brutos, total, erro, carregando, recarregar } = usePaginasPncp(urls);
  const itens = useMemo(() => (brutos ? filtrarExato(brutos, f.q) : undefined), [brutos, f.q]);

  const pontos = useMemo<PontoMapa[]>(() => {
    const m = new Map<string, PontoMapa>();
    for (const i of itens ?? []) {
      if (!i.codigo_ibge) continue;
      const p = m.get(i.codigo_ibge) ?? { codigoIbge: i.codigo_ibge, municipio: i.municipio_nome, uf: i.uf, quantidade: 0, valor: 0 };
      p.quantidade += 1;
      p.valor += i.valor_global ?? 0;
      m.set(i.codigo_ibge, p);
    }
    return [...m.values()];
  }, [itens]);
  const lista = useMemo(() => (itens ?? []).filter((i) => !municipio || i.codigo_ibge === municipio), [itens, municipio]);
  const ufs = useMemo(() => {
    const c = new Map<string, number>();
    for (const i of itens ?? []) c.set(i.uf, (c.get(i.uf) ?? 0) + 1);
    return [...c.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);
  }, [itens]);
  const escolhido = pontos.find((p) => p.codigoIbge === municipio);
  const mudar = (n: FiltrosPncp) => { setF(n); setMunicipio(null); };
  const nItens = itens?.length ?? 0, nBrutos = brutos?.length ?? 0;

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-base font-bold text-slate-800">Mapa das compras</h2>
        <p className="text-xs text-slate-500">Compras publicadas no PNCP por qualquer órgão do país, por município. Clique num ponto para ver a lista.</p>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-4">
        <Filtros key={f.q} valor={f} mudar={mudar} />
      </div>

      {erro && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
          {erro} <button onClick={recarregar} className="ml-1 underline">Tentar de novo</button>
        </div>
      )}

      <div className="grid gap-4 xl:grid-cols-5">
        <div className="rounded-xl border border-slate-200 bg-white p-4 xl:col-span-3">
          {carregando ? <p className="py-16 text-center text-sm text-slate-500">Consultando o PNCP e montando o mapa…</p> : (
            <>
              <p className="mb-2 text-sm text-slate-600">
                📍 <strong className="text-slate-800">{numero(nItens)}</strong> {nItens === 1 ? "compra" : "compras"} no mapa
                {f.q
                  ? <> com “{f.q}” exatamente (conferidas {total && total > nBrutos ? <>as {numero(nBrutos)} mais recentes de {numero(total)}</> : numero(nBrutos)} que a busca do PNCP trouxe)</>
                  : total && total > nItens ? ` (as mais recentes de ${numero(total)})` : ""}
                {" "}em {numero(pontos.length)} {pontos.length === 1 ? "município" : "municípios"}
              </p>
              <MapaBrasil pontos={pontos} selecionado={municipio} aoSelecionar={setMunicipio} />
              {ufs.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-2 text-xs">
                  {ufs.map(([uf, n]) => (
                    <button key={uf} onClick={() => mudar({ ...f, uf: f.uf === uf ? "" : uf })} title={f.uf === uf ? "Tirar o filtro de UF" : `Ver só ${uf}`}
                      className={`rounded-full border px-2.5 py-1 ${f.uf === uf ? "border-sky-600 bg-sky-600 text-white" : "border-slate-200 bg-slate-100 text-slate-600"}`}>
                      {uf}: <b>{n}</b>
                    </button>
                  ))}
                </div>
              )}
              <p className="mt-2 text-[11px] text-slate-500">Tamanho do ponto = número de compras no município. Ponto no centro aproximado do município (malha do IBGE).</p>
            </>
          )}
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-4 xl:col-span-2">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-sm font-semibold text-slate-800">{escolhido ? `${escolhido.municipio}/${escolhido.uf}` : "Compras"}</h3>
            {escolhido && <button onClick={() => setMunicipio(null)} className="text-xs text-slate-500 hover:text-slate-800">✕ Ver todas</button>}
          </div>
          {!carregando && itens && !itens.length && (
            <p className="mt-3 text-sm text-slate-500">Nenhuma compra com esses filtros. {f.q ? "Confira a grafia da palavra (a busca é exata), " : "Tente "}outra UF ou a situação Todas.</p>
          )}
          <ul className="mt-1 max-h-[720px] divide-y divide-slate-100 overflow-y-auto pr-1">
            {lista.slice(0, 80).map((i) => <ItemLicitacao key={i.id} i={i} />)}
          </ul>
          {lista.length > 80 && <p className="mt-2 text-[11px] text-slate-500">Mostrando 80 de {numero(lista.length)}. Clique num município ou filtre a UF para ver os demais.</p>}
          <p className="mt-3 text-[11px] text-slate-400">Fonte: PNCP – Portal Nacional de Contratações Públicas (busca pública)</p>
        </div>
      </div>
    </div>
  );
}

function Filtros({ valor, mudar }: { valor: FiltrosPncp; mudar: (f: FiltrosPncp) => void }) {
  const [q, setQ] = useState(valor.q);
  return (
    <form className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6" onSubmit={(e) => { e.preventDefault(); mudar({ ...valor, q: q.trim() }); }}>
      <label className="space-y-1 sm:col-span-2">
        <span className="block text-[11px] font-medium text-slate-600">Palavra-chave do objeto</span>
        <input className={campo} placeholder="ex.: ar condicionado, vigilância, combustível" value={q} onChange={(e) => setQ(e.target.value)}
          onBlur={() => q.trim() !== valor.q && mudar({ ...valor, q: q.trim() })} />
        <span className="block text-[10px] text-slate-500">Busca exata: só aparecem as compras com a palavra ou frase inteira, como digitada (maiúsculas e acentos não contam).</span>
      </label>
      <label className="space-y-1">
        <span className="block text-[11px] font-medium text-slate-600">UF</span>
        <select className={campo} value={valor.uf} onChange={(e) => mudar({ ...valor, q, uf: e.target.value })}>
          <option value="">Todas</option>{UFS.map((u) => <option key={u}>{u}</option>)}
        </select>
      </label>
      <label className="space-y-1">
        <span className="block text-[11px] font-medium text-slate-600">Modalidade</span>
        <select className={campo} value={valor.modalidade} onChange={(e) => mudar({ ...valor, q, modalidade: e.target.value })}>
          <option value="">Todas</option>{MODALIDADES.map(([v, t]) => <option key={v} value={v}>{t}</option>)}
        </select>
      </label>
      <label className="space-y-1">
        <span className="block text-[11px] font-medium text-slate-600">Esfera</span>
        <select className={campo} value={valor.esfera} onChange={(e) => mudar({ ...valor, q, esfera: e.target.value })}>
          {ESFERAS.map(([v, t]) => <option key={v} value={v}>{t}</option>)}
        </select>
      </label>
      <label className="space-y-1">
        <span className="block text-[11px] font-medium text-slate-600">Situação</span>
        <select className={campo} value={valor.status} onChange={(e) => mudar({ ...valor, q, status: e.target.value })}>
          {SITUACOES.map(([v, t]) => <option key={v} value={v}>{t}</option>)}
        </select>
      </label>
      <button type="submit" className="sr-only">Buscar</button>
    </form>
  );
}

function ItemLicitacao({ i }: { i: ItemPncp }) {
  const [aberto, setAberto] = useState(false);
  const desc = (i.description ?? "").trim();
  const longo = desc.length > 220;
  const encerra = i.data_fim_vigencia;
  return (
    <li className="py-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <a href={linkPncp(i)} target="_blank" rel="noreferrer" className="text-sm font-medium text-slate-800 hover:text-sky-700">{i.title}</a>
        {i.valor_global ? <span className="text-sm font-semibold text-slate-800">{BRL.format(i.valor_global)}</span> : null}
      </div>
      <p className="mt-0.5 break-words text-xs text-slate-500">{i.orgao_nome}{i.unidade_nome && i.unidade_nome !== i.orgao_nome ? ` · ${i.unidade_nome}` : ""}</p>
      {desc && (
        <div className="mt-1.5 text-xs text-slate-700">
          <p className={`whitespace-pre-line break-words ${longo && !aberto ? "line-clamp-3" : ""}`}>{desc}</p>
          {longo && <button onClick={() => setAberto(!aberto)} className="text-[11px] font-medium text-sky-700 hover:underline">{aberto ? "ver menos" : "ver tudo"}</button>}
        </div>
      )}
      <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[11px] text-slate-500">
        <span>📍 {i.municipio_nome}/{i.uf}</span>
        {i.modalidade_licitacao_nome && <span className="rounded-full bg-sky-100 px-2 py-0.5 text-sky-700">{i.modalidade_licitacao_nome}</span>}
        {i.situacao_nome && <span className="rounded-full bg-slate-100 px-2 py-0.5 text-slate-600">{i.situacao_nome}</span>}
        {i.esfera_nome && <span className="rounded-full bg-slate-100 px-2 py-0.5 text-slate-600">{i.esfera_nome}</span>}
        {encerra && <span>🗓 propostas até {dataBR(encerra)}</span>}
        <a href={linkPncp(i)} target="_blank" rel="noreferrer" className="ml-auto text-sky-700 hover:underline">PNCP ↗</a>
      </div>
    </li>
  );
}
