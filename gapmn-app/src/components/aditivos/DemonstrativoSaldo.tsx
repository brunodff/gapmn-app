import { useState } from "react";
import { Campo, CampoNumero, brl } from "../reajustes/campos";
import { empenhosMarcados, periodoAnalisado, previaSaldo } from "../../lib/aditivos/saldo";
import type { DadosAditivo, EmpenhoPeriodo, PendentePeriodo, SaldoPeriodo } from "../../lib/aditivos/tipos";

const botao = "rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50";
const cel = "rounded border border-slate-200 px-1.5 py-1 text-xs";
const vazio = (): SaldoPeriodo => ({ empenhos: [], pendentes: [] });
const neVazia = (): EmpenhoPeriodo => ({ numero: "", data: "", empenhado: null, liquidado: null, pago: null, a_liquidar: null, marcado: true, origem: "digitada" });
const somaDe = (l: EmpenhoPeriodo[], k: "liquidado") => Math.round(empenhosMarcados(l).reduce((s, e) => s + (e[k] ?? 0), 0) * 100) / 100;
const semMarcas = (t: string) => t.replace(/[⟦⟧]/g, "");

// Demonstrativo de Execução e Saldo do Período de Vigência (seção 3K da SCON): o fiscal mostra o que sobrou do período
// que termina, o que ainda vai pagar serviço do período e o que a SCON retira do SILOMS e anula no SIAFI.
export default function DemonstrativoSaldo({ d, onChange, onBuscarEmpenhos }: {
  d: DadosAditivo;
  onChange: (f: (x: DadosAditivo) => DadosAditivo) => void;
  /** busca as NEs do contrato no Contratos.gov.br, já marcadas as do período */
  onBuscarEmpenhos: (periodo: { inicio: string | null; fim: string | null }) => Promise<EmpenhoPeriodo[]>;
}) {
  const [msg, setMsg] = useState<{ ok: boolean; txt: string } | null>(null);
  const [buscando, setBuscando] = useState(false);
  const sp = d.saldo_periodo;
  const set = (p: Partial<SaldoPeriodo>) => onChange((x) => ({ ...x, saldo_periodo: { ...(x.saldo_periodo ?? vazio()), ...p } }));
  if (!sp) {
    return (
      <div className="space-y-2 text-xs">
        <p className="text-slate-600">Na prorrogação, mostre à Seção de Contratos quanto sobrou do valor do período que termina, quanto dessa sobra ainda vai pagar serviço executado no período e quanto deve ser retirado do SILOMS e anulado no SIAFI (o novo período entra só com o valor do termo aditivo).</p>
        <button className={botao} onClick={() => onChange((x) => ({ ...x, saldo_periodo: vazio() }))}>Preencher o demonstrativo</button>
      </div>
    );
  }
  const auto = periodoAnalisado({ ...d, saldo_periodo: { ...sp, inicio: null, fim: null } });
  const per = periodoAnalisado(d);
  const p = previaSaldo(d);
  const q = p.quadro;
  const marcadas = empenhosMarcados(sp.empenhos).filter((e) => e.numero.trim());
  const ne = (i: number, campo: Partial<EmpenhoPeriodo>) => set({ empenhos: sp.empenhos.map((e, j) => (j === i ? { ...e, ...campo } : e)) });
  const pend = (i: number, campo: Partial<PendentePeriodo>) => set({ pendentes: sp.pendentes.map((x, j) => (j === i ? { ...x, ...campo } : x)) });

  async function buscar() {
    setBuscando(true); setMsg({ ok: true, txt: "Buscando as notas de empenho do contrato no Contratos.gov.br…" });
    try {
      const novas = await onBuscarEmpenhos({ inicio: per.inicio, fim: per.fim });
      if (!novas.length) { setMsg({ ok: false, txt: "O Contratos.gov.br não trouxe notas de empenho para este contrato: adicione à mão." }); return; }
      // as que o fiscal já tinha (corrigidas ou digitadas) ficam; as novas entram com a marcação do período
      const antes = d.saldo_periodo?.empenhos ?? [];
      const ja = new Set(antes.map((e) => e.numero.trim()));
      const entram = novas.filter((e) => !ja.has(e.numero));
      set({ empenhos: [...antes, ...entram] });
      const rp = entram.filter((e) => /restos/.test(e.origem ?? "")).length;
      setMsg({ ok: true, txt: `${entram.length} nota(s) de empenho trazida(s)${novas.length > entram.length ? ` (${novas.length - entram.length} já estavam na lista e ficaram como estavam)` : ""}; marcadas as emitidas no período analisado.${rp ? ` ${rp} de exercício anterior com valores de restos a pagar: confira.` : ""} Confira os valores.` });
    } catch (e) { setMsg({ ok: false, txt: `Não consegui buscar no Contratos.gov.br: ${e instanceof Error ? e.message : String(e)}. Adicione as NEs à mão.` }); }
    finally { setBuscando(false); }
  }

  return (
    <div className="space-y-3 text-xs">
      <div className="grid gap-2 sm:grid-cols-4">
        <Campo rotulo="Início do período analisado" valor={sp.inicio ?? ""} placeholder={auto.inicio ?? "dd/mm/aaaa"} onChange={(v) => set({ inicio: v || null })} dica={sp.inicio ? undefined : "vazio = o fim menos os meses do período"} />
        <Campo rotulo="Fim do período analisado" valor={sp.fim ?? ""} placeholder={auto.fim ?? "dd/mm/aaaa"} onChange={(v) => set({ fim: v || null })} dica={sp.fim ? undefined : "vazio = véspera do novo período"} />
        <Campo rotulo="Documento que fixou o período" valor={sp.documento_periodo ?? ""} placeholder="ex.: 2º Termo Aditivo" onChange={(v) => set({ documento_periodo: v || null })} />
        <label className="block"><span className="block text-[11px] font-medium text-slate-600 mb-0.5">(A) Valor do contrato para o período</span>
          <CampoNumero valor={sp.valor_periodo ?? null} placeholder={d.valor_atual != null ? brl(d.valor_atual) : ""} onChange={(v) => set({ valor_periodo: v })} className="w-full py-1.5" />
          <span className="block text-[10px] text-slate-400 mt-0.5">vazio = o valor atual do contrato (seção 1)</span></label>
      </div>

      <div>
        <div className="mb-1 flex flex-wrap items-center gap-2">
          <b className="text-slate-700">1. Notas de empenho do período</b>
          <button className={botao} disabled={buscando} onClick={() => void buscar()}>{buscando ? "Buscando…" : "🔎 Buscar empenhos no Contratos.gov.br"}</button>
          <button className={botao} onClick={() => set({ empenhos: [...sp.empenhos, neVazia()] })}>+ Adicionar NE</button>
        </div>
        {msg && <p className={msg.ok ? "text-sky-700" : "text-red-600"}>{msg.txt}</p>}
        {sp.empenhos.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-left">
              <thead className="text-[10.5px] uppercase text-slate-500"><tr><th className="p-1">Entra</th><th className="p-1">Nota de empenho</th><th className="p-1">Emissão</th><th className="p-1">Empenhado</th><th className="p-1">Liquidado</th><th className="p-1">Pago</th><th className="p-1">A liquidar</th><th className="p-1" /></tr></thead>
              <tbody>
                {sp.empenhos.map((e, i) => (
                  <tr key={i} className={`border-t border-slate-100 ${e.marcado === false ? "opacity-50" : ""}`}>
                    <td className="p-1"><input type="checkbox" checked={e.marcado !== false} onChange={(ev) => ne(i, { marcado: ev.target.checked })} title="entra no demonstrativo" /></td>
                    <td className="p-1"><input className={`${cel} w-32`} value={e.numero} placeholder="2026NE000123" onChange={(ev) => ne(i, { numero: ev.target.value.toUpperCase().trim() })} />
                      {e.origem && e.origem !== "digitada" && <div className="text-[10px] text-slate-400">{e.origem}</div>}</td>
                    <td className="p-1"><input className={`${cel} w-24`} value={e.data} placeholder="dd/mm/aaaa" onChange={(ev) => ne(i, { data: ev.target.value })} /></td>
                    {(["empenhado", "liquidado", "pago"] as const).map((k) => <td key={k} className="p-1"><CampoNumero valor={e[k]} onChange={(v) => ne(i, { [k]: v })} className="w-28" /></td>)}
                    <td className="p-1"><CampoNumero valor={e.a_liquidar ?? null} placeholder={e.empenhado != null ? brl(e.empenhado - (e.liquidado ?? 0)) : ""} onChange={(v) => ne(i, { a_liquidar: v })} className="w-28" /></td>
                    <td className="p-1"><button className="text-red-600" title="tirar esta NE" onClick={() => set({ empenhos: sp.empenhos.filter((_, j) => j !== i) })}>🗑</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="text-[10.5px] text-slate-400">A liquidar vazio = empenhado − liquidado. Desmarcada, a NE fica só na tela (não entra no documento).</p>
          </div>
        )}
      </div>

      <label className="block max-w-xs"><span className="block text-[11px] font-medium text-slate-600 mb-0.5">(B) Executado e já liquidado no período</span>
        <CampoNumero valor={sp.liquidado ?? null} placeholder={brl(somaDe(sp.empenhos, "liquidado"))} onChange={(v) => set({ liquidado: v })} className="w-full py-1.5" />
        <span className="block text-[10px] text-slate-400 mt-0.5">vazio = soma do liquidado das NEs marcadas; ajuste se uma NE pagou serviço de outro período</span></label>

      <div>
        <div className="mb-1 flex flex-wrap items-center gap-2">
          <b className="text-slate-700">2. Serviços executados no período e ainda não pagos (C)</b>
          <button className={botao} onClick={() => set({ pendentes: [...sp.pendentes, { descricao: "", periodo: "", nf: "", valor: null, empenho: "" }] })}>+ Adicionar serviço</button>
        </div>
        {!sp.pendentes.length && <p className="text-slate-500">Nenhum: o documento diz "Não há serviços executados no período pendentes de pagamento."</p>}
        {sp.pendentes.map((x, i) => (
          <div key={i} className="mb-1 grid items-end gap-2 sm:grid-cols-12">
            <div className="sm:col-span-3"><Campo rotulo="Serviço / competência" valor={x.descricao} onChange={(v) => pend(i, { descricao: v })} placeholder="Manutenção – competência fevereiro/2026" /></div>
            <div className="sm:col-span-2"><Campo rotulo="Período de execução" valor={x.periodo} onChange={(v) => pend(i, { periodo: v })} placeholder="01/02/2026 a 28/02/2026" /></div>
            <div className="sm:col-span-2"><Campo rotulo="Nota fiscal (opcional)" valor={x.nf} onChange={(v) => pend(i, { nf: v })} /></div>
            <label className="block sm:col-span-2"><span className="block text-[11px] font-medium text-slate-600 mb-0.5">Valor</span><CampoNumero valor={x.valor} onChange={(v) => pend(i, { valor: v })} className="w-full py-1.5" /></label>
            <label className="block sm:col-span-2"><span className="block text-[11px] font-medium text-slate-600 mb-0.5">NE que vai pagar</span>
              <select className="w-full rounded-lg border border-slate-200 px-2 py-1.5 text-xs" value={x.empenho} onChange={(ev) => pend(i, { empenho: ev.target.value })}>
                <option value="">a mais recente com saldo</option>
                {marcadas.map((e) => <option key={e.numero} value={e.numero}>{e.numero}</option>)}
                {x.empenho && !marcadas.some((e) => e.numero === x.empenho) && <option value={x.empenho}>{x.empenho} (fora da lista)</option>}
              </select></label>
            <button className="pb-2 text-red-600 sm:col-span-1" title="tirar este serviço" onClick={() => set({ pendentes: sp.pendentes.filter((_, j) => j !== i) })}>🗑</button>
          </div>
        ))}
      </div>

      <Campo rotulo="Observações da fiscalização (texto livre)" valor={sp.observacoes ?? ""} longo onChange={(v) => set({ observacoes: v })} />

      <div className="rounded-md bg-slate-50 p-2">
        <b className="text-slate-700">Prévia do quadro e das providências</b> <span className="text-slate-500">· período {p.inicio ?? "?"} a {p.fim ?? "?"}{p.semValor ? " · prorrogação sem valor: o saldo continua no contrato" : ""}</span>
        <table className="mt-1 w-full max-w-xl">
          <tbody>
            {([["A", "Valor do contrato para o período de vigência analisado", q.A], ["B", "Executado e já liquidado (atestado) no período", q.B], ["C", "Executado no período e ainda não pago (item 2)", q.C],
              ["D", "Saldo do período sem utilização (A − B − C) → retirar do SILOMS", q.D], ["E", "Saldo a liquidar das notas de empenho do período (item 1)", q.E], ["F", "Saldo das notas de empenho sem uso (E − C) → anular no SIAFI", q.F]] as const).map(([l, t, v]) => (
              <tr key={l} className={`border-t border-slate-200 ${l === "D" || l === "F" ? "bg-amber-50 font-semibold" : ""}`}>
                <td className="w-6 p-1 text-center">{l}</td><td className="p-1">{t}</td><td className="p-1 text-right">{v == null ? "—" : brl(v)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="mt-2 space-y-0.5 text-slate-700">{p.providencias.map((t, i) => <div key={i} className="pl-4 -indent-4">{semMarcas(t)}</div>)}</div>
        {p.avisos.length > 0 && <ul className="mt-2 space-y-0.5">{p.avisos.map((a, i) => <li key={i} className={a.startsWith("🔴") ? "font-semibold text-red-700" : "text-amber-700"}>{a.startsWith("🔴") ? a : `🟡 ${a}`}</li>)}</ul>}
        <p className="mt-1 text-slate-500">Assina: Gestor do Contrato (só o cargo). Vai no .zip como item da Lista, logo depois da Declaração de Vantajosidade.</p>
      </div>
    </div>
  );
}
