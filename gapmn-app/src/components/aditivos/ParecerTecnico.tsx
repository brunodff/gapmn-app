import { useEffect, useMemo } from "react";
import { Campo, CampoNumero } from "../reajustes/campos";
import { brlP, previaParecer } from "../../lib/aditivos/parecer";
import type { DadosAditivo, EtapaEscopo, HistoricoParecer, ItemParecer, ParecerTecnico as PT } from "../../lib/aditivos/tipos";
import type { Arquivo } from "../../lib/aditivos/anexos";

// Parecer Técnico de Alteração Contratual (item 5 da Lista; revisão 5.1 da SCON, seção 3J). O site monta os itens 5 a
// 11 pelas opções do aditivo e pelo cadastro do contrato; o fiscal completa o nº, as cláusulas, os motivos e a tabela.
// Trecho entre ⟦ ⟧ = dado que falta (sai em amarelo no documento).

const botao = "rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50";
const sel = "w-full rounded-lg border border-slate-200 px-2 py-1.5 text-sm outline-none";
const semMarca = (t: string) => t.replace(/[⟦⟧]/g, "");
/** Texto com os trechos que faltam destacados (como sai no documento) */
function Marcado({ t }: { t: string }) {
  const partes = t.split(/(⟦[^⟧]*⟧)/g);
  return <>{partes.map((x, i) => (x.startsWith("⟦") ? <mark key={i} className="rounded bg-yellow-200 px-0.5 text-slate-900">{x.slice(1, -1)}</mark> : <span key={i}>{x}</span>))}</>;
}

export default function ParecerTecnico({ d, onChange, prints, printsDoAditivo, onTrocarPrints, onTirarPrint, onAbrirReajustes, onTrazerCadastro }: {
  d: DadosAditivo; onChange: (f: (x: DadosAditivo) => DadosAditivo) => void;
  prints: Arquivo[]; printsDoAditivo: boolean; onTrocarPrints: (f: FileList | null) => void; onTirarPrint: (i: number) => void;
  onAbrirReajustes: () => void; onTrazerCadastro: () => void;
}) {
  const p = useMemo(() => previaParecer(d), [d]);
  const pt: PT = d.parecer_tecnico ?? {};
  const ad = d.aditivo;
  const setPT = (q: Partial<PT>) => onChange((x) => ({ ...x, parecer_tecnico: { ...(x.parecer_tecnico ?? {}), ...q } }));
  const setHist = (f: (h: HistoricoParecer[]) => HistoricoParecer[]) => onChange((x) => ({ ...x, historico: f(x.historico ?? []) }));
  const setItens = (f: (h: ItemParecer[]) => ItemParecer[]) => onChange((x) => ({ ...x, itens: f(x.itens ?? []) }));
  const setEtapas = (f: (h: EtapaEscopo[]) => EtapaEscopo[]) => setPT({ cronograma_escopo: f(pt.cronograma_escopo ?? []) });
  // motivos na tela: os do fiscal ou as sugestões; qualquer edição vira a lista do fiscal (sem as marcas ⟦ ⟧)
  const motivos = p.motivos;
  const editados = !!pt.motivos?.length;
  const setMotivos = (l: string[]) => setPT({ motivos: l.map(semMarca) });
  const escopo = pt.natureza === "escopo";
  const meses = Number(ad.prorrogacao?.meses) || 12;
  const mostraMensal = (pt.base ?? "anual") === "anual" && ad.prorrogacao?.modalidade !== "sem_valor";
  const n = d.numero_aditivo ?? "?";

  // miniaturas dos prints
  const urls = useMemo(() => prints.map((a) => URL.createObjectURL(new Blob([a.bytes], { type: /\.jpe?g$/i.test(a.nome) ? "image/jpeg" : "image/png" }))), [prints]);
  useEffect(() => () => urls.forEach((x) => URL.revokeObjectURL(x)), [urls]);

  return (
    <div className="space-y-3 text-xs">
      <div className="grid gap-2 sm:grid-cols-4">
        <Campo rotulo="Nº do Parecer Técnico (controle da OM/fiscal)" valor={pt.numero ?? ""} onChange={(v) => setPT({ numero: v || null })} placeholder="001/SCON/2026" />
        <label className="block"><span className="mb-0.5 block text-[11px] font-medium text-slate-600">Natureza do contrato</span>
          <select className={sel} value={pt.natureza ?? "continuado"} onChange={(e) => setPT({ natureza: e.target.value as PT["natureza"] })}><option value="continuado">Contínuo</option><option value="escopo">Por escopo</option></select></label>
        <label className="block"><span className="mb-0.5 block text-[11px] font-medium text-slate-600">Base dos valores</span>
          <select className={sel} value={pt.base ?? "anual"} onChange={(e) => setPT({ base: e.target.value as PT["base"] })}><option value="anual">anual</option><option value="mensal">mensal</option><option value="total">total</option></select></label>
        <div className="text-[11px] text-slate-500 sm:pt-4">Lei: <b>{p.lei === "8666" ? "8.666/1993" : "14.133/2021"}</b> (campo "Lei do contrato", seção 2)</div>
        {ad.prorrogacao && <div className="sm:col-span-2"><Campo rotulo="Cláusula de vigência" valor={pt.clausula_vigencia ?? ""} onChange={(v) => setPT({ clausula_vigencia: v || null })} placeholder="CLÁUSULA SEGUNDA – VIGÊNCIA E PRORROGAÇÃO, item 2.1" dica="lida do PDF do contrato nos Reajustes; confira" /></div>}
        {ad.reajuste && <div className="sm:col-span-2"><Campo rotulo="Cláusula de reajuste" valor={pt.clausula_reajuste ?? ""} onChange={(v) => setPT({ clausula_reajuste: v || null })} placeholder="CLÁUSULA SÉTIMA – REAJUSTE, item 7.2" /></div>}
      </div>
      {ad.reajuste && <p className="text-slate-600">Anexos (automático): <b>Consulta índice {ad.reajuste.indice || "____"}.</b> Sem reajuste a linha não sai.</p>}

      <div className="rounded-lg border border-slate-200 p-2">
        <div className="mb-1 flex flex-wrap items-center gap-2"><b className="text-slate-700">5. Valores totais do contrato</b><span className="text-slate-500">(valor que o contrato passou a ter depois de cada documento, na ordem de assinatura)</span>
          <button className="ml-auto text-sky-700 underline" onClick={onTrazerCadastro}>↻ trazer do cadastro dos Reajustes</button></div>
        {(d.historico ?? []).map((h, i) => (
          <div key={i} className={`flex items-center gap-2 py-0.5 ${h.valor == null ? "rounded bg-yellow-50" : ""}`}>
            <input className="w-56 rounded border border-slate-200 px-1.5 py-1" value={h.documento} onChange={(e) => setHist((l) => l.map((x, j) => (j === i ? { ...x, documento: e.target.value } : x)))} />
            <CampoNumero valor={h.valor} className="w-36" placeholder="valor (preencher)" onChange={(v) => setHist((l) => l.map((x, j) => (j === i ? { ...x, valor: v } : x)))} />
            <button className="text-red-500" title="tirar" onClick={() => setHist((l) => l.filter((_, j) => j !== i))}>✕</button>
          </div>
        ))}
        <button className="mt-1 text-sky-700 underline" onClick={() => setHist((l) => [...l, { documento: `${l.filter((x) => /aditivo/i.test(x.documento)).length + 1}º Termo Aditivo`, valor: null }])}>+ documento</button>
        <p className="mt-1 text-slate-600">6. Valor do {n}º termo aditivo a ser firmado: <b>{p.valor_novo_extenso ?? "—"}</b></p>
      </div>

      <div className="rounded-lg border border-slate-200 p-2">
        <p><b className="text-slate-700">7. Enquadramento legal:</b> {p.enquadramento ? `${p.enquadramento}.` : "—"}</p>
        <p className="mt-1"><b className="text-slate-700">8. Tipo(s) de alteração:</b></p>
        {p.tipos.map((t, i) => <p key={i} className="pl-4">{p.tipos.length > 1 ? `${"abcdefg"[i]}) ` : ""}<Marcado t={t} />{i === p.tipos.length - 1 ? "." : ";"}</p>)}
      </div>

      <div className="rounded-lg border border-slate-200 p-2">
        <div className="mb-1 flex flex-wrap items-center gap-2"><b className="text-slate-700">9. Motivo(s)</b>
          <span className="text-slate-500">{editados ? "texto do fiscal" : "sugestões do site (edite, apague ou acrescente)"}</span>
          {editados && <button className="ml-auto text-sky-700 underline" onClick={() => setPT({ motivos: null })}>Restaurar sugestões</button>}</div>
        {motivos.map((m, i) => (
          <div key={i} className="mb-1 flex items-start gap-2">
            <textarea className="min-h-[70px] flex-1 rounded-lg border border-slate-200 px-2 py-1 text-xs" value={semMarca(m)} onChange={(e) => setMotivos(motivos.map((x, j) => (j === i ? e.target.value : x)))} />
            <button className="pt-1 text-red-600" title="tirar este motivo" onClick={() => setMotivos(motivos.filter((_, j) => j !== i))}>🗑</button>
          </div>
        ))}
        {!editados && motivos.some((m) => m.includes("⟦")) && <p className="text-amber-700">Trechos que faltam (cláusula, valores…) saem em amarelo no documento enquanto você não editar o texto.</p>}
        <button className={botao} onClick={() => setMotivos([...motivos, ""])}>+ Adicionar motivo</button>
        {ad.reajuste && (
          <div className="mt-2 rounded-md bg-slate-50 p-2">
            <div className="flex flex-wrap items-center gap-2">
              <b className="text-slate-700">Prints da Calculadora do Cidadão</b>
              <span className="text-slate-500">{prints.length ? `${prints.length} print(s) ${printsDoAditivo ? "anexados neste aditivo" : "do módulo Reajustes"}` : "nenhum print"}</span>
              <button className={botao} onClick={onAbrirReajustes}>Fazer o reajuste no módulo Reajustes ↗</button>
              <label className="cursor-pointer text-sky-700 underline">trocar os prints<input type="file" accept="image/png,image/jpeg" multiple className="hidden" onChange={(e) => { onTrocarPrints(e.target.files); e.target.value = ""; }} /></label>
            </div>
            <div className="mt-1 flex flex-wrap gap-2">
              {urls.map((u, i) => (
                <figure key={i} className="relative">
                  <img src={u} alt={prints[i]?.nome} className="h-24 rounded border border-slate-200 object-contain" />
                  {printsDoAditivo && <button className="absolute right-1 top-1 rounded bg-white/90 px-1 text-red-600" title="tirar" onClick={() => onTirarPrint(i)}>✕</button>}
                </figure>
              ))}
            </div>
            <p className="mt-1 text-slate-500">Os prints saem dentro do parecer, logo abaixo dos motivos. O módulo Reajustes abre com Instrumento = Termo Aditivo e o nº {n}; anexe lá o print e salve.</p>
          </div>
        )}
      </div>

      <div className="rounded-lg border border-slate-200 p-2">
        <div className="mb-1 flex flex-wrap items-center gap-2"><b className="text-slate-700">10. Cronograma físico-financeiro</b>
          {!escopo && <button className="ml-auto text-sky-700 underline" onClick={onTrazerCadastro}>↻ trazer os itens do cadastro</button>}
          {!escopo && p.valor_atual != null && (d.itens ?? []).length > 0 && <button className="text-sky-700 underline" title="distribui o valor atual do contrato pelos itens, na proporção do cadastro"
            onClick={() => { const soma = (d.itens ?? []).reduce((s, i) => s + (i.valor_atual ?? 0), 0); if (!soma) return; const f = p.valor_atual! / soma;
              setItens((l) => { const m = l.map((i) => ({ ...i, valor_atual: Math.round((i.valor_atual ?? 0) * f * 100) / 100 })); const dif = Math.round((p.valor_atual! - m.reduce((s, i) => s + (i.valor_atual ?? 0), 0)) * 100) / 100;
                if (dif && m.length) { const k = m.reduce((b, i, j) => ((i.valor_atual ?? 0) > (m[b].valor_atual ?? 0) ? j : b), 0); m[k] = { ...m[k], valor_atual: Math.round(((m[k].valor_atual ?? 0) + dif) * 100) / 100 }; } return m; }); }}>
            ajustar os valores atuais ao valor do contrato</button>}
        </div>
        {escopo ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px]">
              <thead className="text-[10.5px] uppercase text-slate-500"><tr><th className="p-1 text-left">Etapa</th><th className="p-1 text-left">Entrega</th><th className="p-1 text-left">Recebimento</th><th className="p-1 text-left">Pagamento</th><th className="p-1 text-right">Valor (R$)</th><th /></tr></thead>
              <tbody>
                {(pt.cronograma_escopo ?? []).map((e, i) => (
                  <tr key={i}>
                    {(["etapa", "entrega", "recebimento", "pagamento"] as const).map((k) => <td key={k} className="p-0.5"><input className="w-full rounded border border-slate-200 px-1 py-0.5" value={e[k]} onChange={(ev) => setEtapas((l) => l.map((x, j) => (j === i ? { ...x, [k]: ev.target.value } : x)))} /></td>)}
                    <td className="p-0.5 text-right"><CampoNumero valor={e.valor} className="w-28" onChange={(v) => setEtapas((l) => l.map((x, j) => (j === i ? { ...x, valor: v } : x)))} /></td>
                    <td><button className="text-red-500" onClick={() => setEtapas((l) => l.filter((_, j) => j !== i))}>✕</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
            <button className="mt-1 text-sky-700 underline" onClick={() => setEtapas((l) => [...l, { etapa: `Etapa ${l.length + 1}`, entrega: "", recebimento: "", pagamento: "", valor: null }])}>+ etapa</button>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px]">
              <thead className="text-[10.5px] uppercase text-slate-500"><tr><th className="p-1 text-left">Item</th><th className="p-1 text-left">Descrição</th><th className="p-1 text-right">Valor atual</th><th className="p-1 text-right">Após o {n}º TA</th>{mostraMensal && <th className="p-1 text-right">Mensal após</th>}</tr></thead>
              <tbody>
                {(d.itens ?? []).map((it, i) => {
                  const calc = p.itens[i];
                  return (
                    <tr key={i} className="border-t border-slate-100">
                      <td className="p-1">{it.item}</td>
                      <td className="max-w-[280px] p-1">{it.descricao}</td>
                      <td className="p-1 text-right"><CampoNumero valor={it.valor_atual} className="w-28" onChange={(v) => setItens((l) => l.map((x, j) => (j === i ? { ...x, valor_atual: v } : x)))} /></td>
                      <td className="p-1 text-right"><CampoNumero valor={it.valor_apos ?? null} className="w-28" placeholder={calc?.valor_apos != null ? calc.valor_apos.toLocaleString("pt-BR", { minimumFractionDigits: 2 }) : ""} onChange={(v) => setItens((l) => l.map((x, j) => (j === i ? { ...x, valor_apos: v } : x)))} /></td>
                      {mostraMensal && <td className="p-1 text-right text-slate-600">{calc?.valor_apos != null ? brlP(Math.round((calc.valor_apos / meses) * 100) / 100).slice(3) : "—"}</td>}
                    </tr>
                  );
                })}
                {!!p.itens.length && <tr className="border-t border-slate-200 font-semibold"><td colSpan={2} className="p-1 text-right">TOTAL</td>
                  <td className="p-1 text-right">{brlP(p.itens.reduce((s, i) => s + (i.valor_atual ?? 0), 0)).slice(3)}</td>
                  <td className="p-1 text-right">{brlP(p.itens.reduce((s, i) => s + (i.valor_apos ?? 0), 0)).slice(3)}</td>
                  {mostraMensal && <td className="p-1 text-right">{brlP(p.itens.reduce((s, i) => s + Math.round(((i.valor_apos ?? 0) / meses) * 100) / 100, 0)).slice(3)}</td>}</tr>}
              </tbody>
            </table>
            <p className="mt-1 text-slate-500">"Após" vazio = calculado (proporcional ao valor que o contrato passará a ter; os centavos vão para o item de maior valor). Digite para acrescer ou suprimir um item específico.</p>
          </div>
        )}
      </div>

      <div className="rounded-lg border border-slate-200 bg-slate-50 p-2 text-slate-700">
        <b>11. Parecer do fiscal:</b> <Marcado t={p.parecer_fiscal} />
        <p className="mt-1 text-slate-500">Assinam (só cargos): Gestor do Contrato e Ordenador de Despesas {d.om_signataria.artigo} {d.om_signataria.sigla}. Vai no .zip como item 5 da Lista.</p>
      </div>
    </div>
  );
}
