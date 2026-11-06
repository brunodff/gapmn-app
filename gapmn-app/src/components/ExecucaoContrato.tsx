// Aba "Execução" do contrato: as NEs ligadas a ele (lib/contratos/execucao.ts), com os mesmos totais da
// lista e de Dados Gerais, e os itens de cada NE com a soma.
import { useEffect, useMemo, useState, type ReactNode } from "react";
import type { ExecucaoContrato as Exec, MotivoVinculo, NotaContrato, SaldoAEmpenhar } from "../lib/contratos/execucao.ts";
import type { Lancamento } from "../lib/contratos/useExecucaoContratos";
import type { NotaEmpenho } from "../lib/execucao/empenhos.ts";

const fmt = (v: number | null | undefined) =>
  v == null ? "–" : v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const dataBR = (iso: string) => iso.split("-").reverse().join("/");
const quase = (a: number, b: number) => Math.abs(a - b) < 0.05;


const MOTIVO: Partial<Record<MotivoVinculo, { rotulo: string; dica: string }>> = {
  "cita o contrato": { rotulo: "cita", dica: "A observação da NE cita o número deste contrato" },
  "PAG do contrato": { rotulo: "PAG", dica: "NE do PAG do contrato (único contrato do PAG)" },
  "mesmo fornecedor no PAG": { rotulo: "CNPJ", dica: "PAG de vários contratos: ligada pelo fornecedor" },
};

type ItemDoContrato = { chave: string; itemCompra: string | null; nome: string; valor: number; nes: Set<string>; ultima: string };

/** Cartão "Empenhado por item": quanto foi empenhado em cada item do contrato, somando todas as NEs. */
function EmpenhadoPorItem({ itens, nesSemItens }: { itens: ItemDoContrato[]; nesSemItens: number }) {
  const [todos, setTodos] = useState(false);
  const total = itens.reduce((s, i) => s + i.valor, 0);
  const max = Math.max(...itens.map((i) => i.valor), 0);
  const lista = todos ? itens : itens.slice(0, 8);
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2 mb-2">
        <div className="text-xs font-semibold text-slate-700">Empenhado por item</div>
        <div className="text-[11px] text-slate-500">{itens.length} {itens.length === 1 ? "item" : "itens"} · total <strong className="text-sky-700">{fmt(total)}</strong></div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-[11px]">
          <thead>
            <tr className="text-slate-500 text-left border-b border-slate-200">
              <th className="px-2 py-1 font-semibold w-12">Item</th>
              <th className="px-2 py-1 font-semibold">Descrição</th>
              <th className="px-2 py-1 font-semibold text-right w-12">NEs</th>
              <th className="px-2 py-1 font-semibold text-right">Empenhado</th>
              <th className="px-2 py-1 font-semibold w-28 hidden sm:table-cell"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {lista.map((i) => (
              <tr key={i.chave} title={`Último lançamento: ${dataBR(i.ultima)}`}>
                <td className="px-2 py-1 font-mono text-slate-500">{i.itemCompra ?? "–"}</td>
                <td className="px-2 py-1 text-slate-700">{i.nome}</td>
                <td className="px-2 py-1 text-right text-slate-500">{i.nes.size}</td>
                <td className={`px-2 py-1 text-right font-mono ${i.valor < 0 ? "text-red-600" : "text-sky-700"}`}>{fmt(i.valor)}</td>
                <td className="px-2 py-1 hidden sm:table-cell">
                  <div className="h-1.5 rounded bg-slate-100">
                    <div className="h-1.5 rounded bg-sky-600" style={{ width: `${max > 0 ? Math.max(2, (Math.max(0, i.valor) / max) * 100) : 0}%` }} />
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t border-slate-200 font-semibold">
              <td colSpan={3} className="px-2 py-1 text-right text-slate-600">Total dos itens</td>
              <td className="px-2 py-1 text-right font-mono text-slate-800">{fmt(total)}</td>
              <td className="hidden sm:table-cell" />
            </tr>
          </tfoot>
        </table>
      </div>
      <div className="mt-1.5 flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-500">
        <span>{nesSemItens > 0 ? `${nesSemItens} NE${nesSemItens > 1 ? "s" : ""} sem itens na planilha (anteriores a 2022) não ${nesSemItens > 1 ? "entram" : "entra"} aqui.` : "Soma de todas as NEs do contrato."}</span>
        {itens.length > 8 && (
          <button onClick={() => setTodos((v) => !v)} className="text-sky-700 border border-sky-200 rounded px-2 py-0.5 hover:bg-sky-50">
            {todos ? "Mostrar só os 8 maiores" : `Ver todos os ${itens.length} itens`}
          </button>
        )}
      </div>
    </div>
  );
}

function Valor({ v, cor }: { v: number; cor: string }) {
  return v > 0.004 ? <span className={cor}>{fmt(v)}</span> : <span className="text-slate-300">–</span>;
}

function ListaNEs({ titulo, nes, children }: { titulo: string; nes: NotaContrato[]; children?: ReactNode }) {
  const total = nes.reduce((s, n) => s + n.empenhado, 0);
  return (
    <details className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-800">
      <summary className="cursor-pointer font-medium">
        {titulo}: {nes.length} NE{nes.length > 1 ? "s" : ""} · {fmt(total)}
      </summary>
      {children && <p className="mt-1 text-amber-700">{children}</p>}
      <ul className="mt-1.5 space-y-1">
        {nes.map((n) => (
          <li key={n.ne} className="flex gap-2">
            <span className="font-mono font-semibold whitespace-nowrap">{n.ne}</span>
            <span className="whitespace-nowrap">{fmt(n.empenhado)}</span>
            <span className="text-amber-700 truncate" title={n.descricao}>{n.descricao || "–"}</span>
          </li>
        ))}
      </ul>
    </details>
  );
}

export default function ExecucaoContrato({
  exec, estado, saldo: saldoInfo, temPag, anoAtual, motivoDe, itens, lancamentos, carregandoItens, children,
}: {
  exec: Exec | undefined;
  estado: "carregando" | "ok" | "erro";
  /** saldo a empenhar, o mesmo da lista e de Dados Gerais */
  saldo: SaldoAEmpenhar;
  temPag: boolean;
  anoAtual: number;
  motivoDe: (ne: string) => MotivoVinculo | undefined;
  /** itens das NEs do ano corrente (planilha "Notas de Empenho"), por NE */
  itens: Map<string, NotaEmpenho> | null;
  lancamentos: Map<string, Lancamento[]>;
  carregandoItens: boolean;
  /** previsão do contrato, mostrada no fim */
  children?: ReactNode;
}) {
  const [abertas, setAbertas] = useState<Set<string>>(new Set());
  // largura visível da tabela de NEs, para o detalhe da NE aberta caber nela
  const [caixaTabela, setCaixaTabela] = useState<HTMLDivElement | null>(null);
  const [larguraVisivel, setLarguraVisivel] = useState(0);
  useEffect(() => {
    if (!caixaTabela) return;
    const ro = new ResizeObserver(() => setLarguraVisivel(caixaTabela.clientWidth));
    ro.observe(caixaTabela);
    return () => ro.disconnect();
  }, [caixaTabela]);
  const nes = useMemo(() => exec?.nes ?? [], [exec]);
  const resumoItens = useMemo(() => {
    let n = 0, soma = 0, comItens = 0;
    for (const ne of nes) {
      const it = itens?.get(ne.ne);
      if (!it) continue;
      comItens++; n += it.itens.length; soma += it.valor;
    }
    return { n, soma, comItens };
  }, [nes, itens]);
  // Empenhado por item do contrato: soma de cada item em todas as NEs (pelo número do item da compra;
  // sem ele, pelo nome)
  const porItem = useMemo(() => {
    const m = new Map<string, ItemDoContrato>();
    for (const ne of nes) {
      const it = itens?.get(ne.ne);
      if (!it) continue;
      for (const i of it.itens) {
        const chave = i.itemCompra ? `#${i.itemCompra}` : `n:${i.nome}`;
        const x = m.get(chave) ?? { chave, itemCompra: i.itemCompra, nome: i.nome, valor: 0, nes: new Set<string>(), ultima: "" };
        x.valor += i.valor;
        x.nes.add(ne.ne);
        if (it.ultimoLancamento > x.ultima) x.ultima = it.ultimoLancamento;
        m.set(chave, x);
      }
    }
    return [...m.values()].sort((a, b) => b.valor - a.valor);
  }, [nes, itens]);

  if (estado === "carregando") return <p className="text-xs text-slate-500 text-center py-4">Carregando empenhos do SIAFI…</p>;
  if (estado === "erro") return <p className="text-xs text-red-600 text-center py-4">Não foi possível ler as planilhas do SIAFI agora. Tente de novo em instantes.</p>;

  const t = exec?.totais;
  const saldo = saldoInfo.valor;
  const motivos = new Map<string, number>();
  for (const n of nes) { const m = motivoDe(n.ne); if (m) motivos.set(m, (motivos.get(m) ?? 0) + 1); }
  const alternar = (ne: string) => setAbertas((s) => { const x = new Set(s); if (x.has(ne)) x.delete(ne); else x.add(ne); return x; });

  return (
    <div className="space-y-3">
      {/* Totais — os mesmos da lista e de Dados Gerais */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-xs">
        {[
          { rot: "Empenhado", v: t?.empenhado ?? 0, cls: "bg-sky-50 border-sky-200 text-sky-700" },
          { rot: "A liquidar", v: t?.aLiquidar ?? 0, cls: "bg-amber-50 border-amber-200 text-amber-800" },
          { rot: "Liquidado a pagar", v: t?.liquidadoPagar ?? 0, cls: "bg-indigo-50 border-indigo-200 text-indigo-700" },
          { rot: "Pago", v: t?.pago ?? 0, cls: "bg-green-50 border-green-200 text-green-800" },
          { rot: `Empenhado em ${anoAtual}`, v: t?.empenhadoAno ?? 0, cls: "bg-slate-50 border-slate-200 text-slate-800" },
          { rot: saldoInfo.fonte === "SILOMS" ? "Saldo a empenhar (SILOMS)" : "Saldo a empenhar", v: saldo, cls: saldo != null && saldo < 0 ? "bg-red-50 border-red-200 text-red-700" : "bg-slate-50 border-slate-200 text-slate-800" },
        ].map((k) => (
          <div key={k.rot} className={`rounded-lg border p-2 ${k.cls}`}>
            <div className="opacity-75">{k.rot}</div>
            <div className="font-semibold mt-0.5">{fmt(k.v)}</div>
          </div>
        ))}
      </div>

      <p className="text-[11px] text-slate-500">
        Valores das notas de empenho do SIAFI — os mesmos da lista e de Dados Gerais.
        {nes.length > 0 && <> {nes.length} NE{nes.length > 1 ? "s" : ""} ligada{nes.length > 1 ? "s" : ""} ao contrato
          {[...motivos].map(([m, k]) => ` · ${k} ${m === "cita o contrato" ? "citam o número do contrato" : m === "PAG do contrato" ? "pelo PAG" : "pelo fornecedor"}`).join("")}.</>}
        {saldo != null && saldo < 0 && <span className="text-red-600"> O empenhado passa do valor total do contrato: confira o valor e a vigência cadastrados.</span>}
      </p>

      {exec && exec.semContratoNoPag.length > 0 && (
        <ListaNEs titulo="NEs do PAG sem contrato identificado (fora dos totais)" nes={exec.semContratoNoPag}>
          O PAG tem mais de um contrato com o mesmo fornecedor e estas NEs não citam o número do contrato. Se forem deste, peça
          para citar o contrato na observação das próximas NEs.
        </ListaNEs>
      )}
      {exec && exec.citamOutro.length > 0 && (
        <ListaNEs titulo="NEs do PAG que citam outro contrato (fora dos totais)" nes={exec.citamOutro} />
      )}
      {exec?.empenhadoIncompleto && nes.length > 0 && (
        <p className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-[11px] text-slate-600">
          O valor de cada NE vem da planilha "Notas de Empenho", que começa em 2022. Este contrato começou antes disso
          (ou tem NE de 2021, sem itens): o empenhado pode estar a menor e, por isso, o saldo a empenhar vem do SILOMS.
          O a liquidar e o liquidado a pagar de hoje estão completos.
        </p>
      )}

      {!temPag && nes.length === 0 && (
        <p className="text-xs text-slate-400 italic text-center py-4">PAG/NUP não preenchido — só entram NEs que citam o número do contrato, e nenhuma cita.</p>
      )}
      {temPag && nes.length === 0 && (
        <p className="text-xs text-slate-400 italic text-center py-4">Nenhuma NE ligada a este contrato nas planilhas do SIAFI.</p>
      )}

      {porItem.length > 0 && <EmpenhadoPorItem itens={porItem} nesSemItens={nes.filter((n) => !itens?.has(n.ne)).length} />}

      {nes.length > 0 && (
        <div>
          <div className="flex items-center justify-between gap-2 mb-1.5 px-0.5">
            <div className="text-[11px] text-slate-500">
              {carregandoItens ? "Carregando os itens das NEs…" : resumoItens.comItens
                ? <>Itens: <strong>{resumoItens.n}</strong> em {resumoItens.comItens} NE{resumoItens.comItens > 1 ? "s" : ""} · soma <strong>{fmt(resumoItens.soma)}</strong>. Clique na NE para ver os itens.</>
                : "Nenhuma destas NEs está na planilha \"Notas de Empenho\" (ela começa em 2022)."}
            </div>
            <div className="flex gap-1 shrink-0">
              <button onClick={() => setAbertas(new Set(nes.map((n) => n.ne)))} className="text-[11px] text-sky-700 border border-sky-200 rounded px-2 py-0.5 hover:bg-sky-50">Abrir todas</button>
              <button onClick={() => setAbertas(new Set())} className="text-[11px] text-slate-500 border rounded px-2 py-0.5 hover:bg-slate-50">Fechar</button>
            </div>
          </div>
          <div ref={setCaixaTabela} className="overflow-x-auto rounded-xl border border-slate-200">
            <table className="w-full text-[11px]">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 text-slate-500 text-left">
                  <th className="px-2 py-2 font-semibold whitespace-nowrap">NE</th>
                  <th className="px-2 py-2 font-semibold">Favorecido · descrição</th>
                  <th className="px-2 py-2 text-right font-semibold whitespace-nowrap">Empenhado</th>
                  <th className="px-2 py-2 text-right font-semibold whitespace-nowrap">A liquidar</th>
                  <th className="px-2 py-2 text-right font-semibold whitespace-nowrap">Liq. a pagar</th>
                  <th className="px-2 py-2 text-right font-semibold whitespace-nowrap">Pago</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {nes.map((n) => {
                  const aberta = abertas.has(n.ne);
                  const it = itens?.get(n.ne);
                  const mot = MOTIVO[motivoDe(n.ne) ?? "sem contrato"];
                  const lanc = lancamentos.get(n.ne) ?? [];
                  return [
                    <tr key={n.ne} onClick={() => alternar(n.ne)} className={`cursor-pointer hover:bg-sky-50 ${aberta ? "bg-sky-50" : ""}`}>
                      <td className="px-2 py-1.5 whitespace-nowrap">
                        <span className="text-slate-400 mr-1">{aberta ? "▾" : "▸"}</span>
                        <span className="font-mono font-semibold text-sky-700">{n.ne}</span>
                        {n.rp && <span className="ml-1 rounded px-1 py-0.5 text-[9px] font-bold bg-orange-100 text-orange-700" title="Tem restos a pagar no exercício corrente">RP</span>}
                        {mot && <span className="ml-1 rounded px-1 py-0.5 text-[9px] bg-slate-100 text-slate-500" title={mot.dica}>{mot.rotulo}</span>}
                        {it && <span className="ml-1 text-[9px] text-slate-400">{it.itens.length} {it.itens.length === 1 ? "item" : "itens"}</span>}
                      </td>
                      <td className="px-2 py-1.5 text-slate-600 max-w-[220px] truncate" title={n.descricao}>{n.favorecidoNome || "–"}{n.descricao ? ` · ${n.descricao}` : ""}</td>
                      <td className="px-2 py-1.5 text-right font-mono text-slate-800">{fmt(n.empenhado)}</td>
                      <td className="px-2 py-1.5 text-right font-mono"><Valor v={n.aLiquidar} cor="text-amber-700" /></td>
                      <td className="px-2 py-1.5 text-right font-mono"><Valor v={n.liquidadoPagar} cor="text-indigo-700" /></td>
                      <td className="px-2 py-1.5 text-right font-mono"><Valor v={n.pago} cor="text-green-700" /></td>
                    </tr>,
                    aberta && (
                      <tr key={n.ne + "_det"} className="bg-slate-50">
                        <td colSpan={6} className="px-3 py-2">
                          {/* o detalhe fica na largura visível da tabela (que rola para o lado), sem cortar o valor */}
                          <div className="space-y-2" style={{ position: "sticky", left: 12, width: larguraVisivel ? larguraVisivel - 26 : undefined }}>
                          {it ? (
                            <table className="w-full text-[11px] bg-white rounded border border-slate-200">
                              <thead>
                                <tr className="text-slate-500 text-left border-b border-slate-200">
                                  <th className="px-2 py-1 font-semibold w-10">Seq.</th>
                                  <th className="px-2 py-1 font-semibold w-16 whitespace-nowrap">Item da compra</th>
                                  <th className="px-2 py-1 font-semibold">Descrição</th>
                                  <th className="px-2 py-1 font-semibold text-right">Valor</th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-slate-100">
                                {it.itens.map((i) => (
                                  <tr key={i.seq}>
                                    <td className="px-2 py-1 font-mono text-slate-500">{i.seq}</td>
                                    <td className="px-2 py-1 font-mono text-slate-500">{i.itemCompra ?? "–"}</td>
                                    <td className="px-2 py-1 text-slate-700" title={i.descricao}>
                                      <span className="font-medium">{i.nome}</span>
                                      {i.descricao !== i.nome && <span className="text-slate-400"> · {i.descricao.replace(/^item\s*compra\s*:\s*\d+\s*-\s*/i, "").slice(0, 140)}</span>}
                                    </td>
                                    <td className={`px-2 py-1 text-right font-mono ${i.valor < 0 ? "text-red-600" : "text-slate-800"}`}>{fmt(i.valor)}</td>
                                  </tr>
                                ))}
                              </tbody>
                              <tfoot>
                                <tr className="border-t border-slate-300 font-semibold">
                                  <td colSpan={3} className="px-2 py-1 text-right text-slate-600">Soma dos {it.itens.length} {it.itens.length === 1 ? "item" : "itens"}</td>
                                  <td className="px-2 py-1 text-right font-mono text-slate-900">{fmt(it.valor)}</td>
                                </tr>
                              </tfoot>
                            </table>
                          ) : (
                            <p className="text-[11px] text-slate-500">
                              {carregandoItens ? "Carregando os itens…" : n.ano >= 2022
                                ? "Esta NE ainda não está na planilha \"Notas de Empenho\"."
                                : "A planilha \"Notas de Empenho\" começa em 2022: esta NE não tem itens."}
                            </p>
                          )}
                          {it && n.ano >= anoAtual - 1 && !quase(n.aLiquidar + n.liquidadoPagar + n.pago, n.empenhado) && (
                            <p className="text-[11px] text-amber-700">
                              ⚠ A soma dos itens ({fmt(n.empenhado)}) difere dos saldos da situação e do RP ({fmt(n.aLiquidar + n.liquidadoPagar + n.pago)}). Confira a NE no SIAFI.
                            </p>
                          )}
                          {n.pagoAnterior > 0.004 && (
                            <p className="text-[11px] text-slate-600">
                              {fmt(n.pagoAnterior)} pagos (ou restos a pagar cancelados) entre {n.ano + 1} e {anoAtual - 1}: as planilhas não detalham esses anos, e o valor entra como pago.
                            </p>
                          )}
                          {n.rp && (
                            <p className="text-[11px] text-slate-600">
                              No exercício de {n.ano}: a liquidar {fmt(n.exercicio.aLiquidar)} · liquidado a pagar {fmt(n.exercicio.liquidadoPagar)} · pago {fmt(n.exercicio.pago)}.
                              {" "}Restos a pagar em {anoAtual}: a liquidar {fmt(n.rp.naoProcALiquidar)} · liquidado a pagar {fmt(n.rp.naoProcLiquidadoPagar + n.rp.procAPagar)} · pago {fmt(n.rp.naoProcPago + n.rp.procPago)}.
                            </p>
                          )}
                          {lanc.length > 0 && (
                            <p className="text-[11px] text-slate-600">
                              Lançamentos: {lanc.map((l, i) => (
                                <span key={i}>
                                  {i > 0 && " · "}
                                  <span className={l.valor < 0 ? "text-red-600" : undefined}>
                                    {dataBR(l.data)} {i === 0 ? "emissão" : l.valor < 0 ? "anulação" : "reforço"} {fmt(l.valor)}
                                  </span>
                                </span>
                              ))}
                            </p>
                          )}
                          {n.descricao && <p className="text-[11px] text-slate-400">{n.descricao}</p>}
                          </div>
                        </td>
                      </tr>
                    ),
                  ];
                })}
              </tbody>
              {t && (
                <tfoot>
                  <tr className="border-t-2 border-slate-200 bg-slate-50 font-semibold">
                    <td colSpan={2} className="px-2 py-1.5 text-slate-600">Total · {t.nNE} NE{t.nNE > 1 ? "s" : ""}</td>
                    <td className="px-2 py-1.5 text-right font-mono">{fmt(t.empenhado)}</td>
                    <td className="px-2 py-1.5 text-right font-mono text-amber-700">{fmt(t.aLiquidar)}</td>
                    <td className="px-2 py-1.5 text-right font-mono text-indigo-700">{fmt(t.liquidadoPagar)}</td>
                    <td className="px-2 py-1.5 text-right font-mono text-green-700">{fmt(t.pago)}</td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        </div>
      )}

      {children}
    </div>
  );
}
