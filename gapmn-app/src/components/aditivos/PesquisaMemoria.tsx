import { useState } from "react";
import { unzipSync } from "fflate";
import { supabase } from "../../lib/supabase";
import { motor } from "../../lib/apostilamento/motor";
import { paraMotor } from "../../lib/apostilamento/cadastro";
import { CONFIG_VAZIA, type ConfigApostilamento } from "../../lib/apostilamento/tipos";
import { cadastroReajuste } from "../../lib/aditivos/dados";
import { brl, estatistica, numero, resumoPesquisa } from "../../lib/aditivos/regras";
import type { DadosAditivo, PesquisaPrecosAditivo, ReajusteAditivo } from "../../lib/aditivos/tipos";
import type { Arquivo } from "../../lib/aditivos/anexos";

const botao = "rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50";
const num2 = (v: number | null | undefined) => (v == null ? "" : v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }));

// Pesquisa de preços (seção 3E): feita na tela Licitações › Pesquisa de Preços, que volta com os itens e os preços;
// aqui entra o preço que o contrato terá no novo período (com o reajuste, se marcado) e sai o quadro comparativo.
export function PesquisaAditivo({ d, numeroContrato, onPesquisa, onFazer, ro }: {
  d: DadosAditivo; numeroContrato: string; onPesquisa: (p: PesquisaPrecosAditivo | null) => void; onFazer: () => void; ro?: boolean;
}) {
  const [msg, setMsg] = useState<string | null>(null);
  const pp = d.pesquisa_precos;
  const rp = resumoPesquisa(d);
  async function precosDoContrato() {
    if (!pp) return;
    const { dados } = await cadastroReajuste(numeroContrato);
    const pct = d.aditivo.reajuste ? numero(d.aditivo.reajuste.percentual) ?? 0 : 0;
    let n = 0;
    const itens = pp.itens.map((it) => {
      const c = dados?.itens?.find((x) => x.item === it.item);
      if (!c?.valor_unit) return it;
      n++;
      return { ...it, preco_contratado: Math.round(c.valor_unit * (1 + pct / 100) * 100) / 100 };
    });
    onPesquisa({ ...pp, itens });
    setMsg(n ? `${n} preço(s) preenchido(s) com o unitário do contrato${pct ? ` reajustado em ${pct.toLocaleString("pt-BR")}%` : ""}: confira.` : "Nenhum item do cadastro do contrato tem o mesmo número dos itens da pesquisa: preencha à mão.");
  }
  return (
    <div className="space-y-2 text-xs">
      <div className="flex flex-wrap gap-2">
        {!ro && <button type="button" className={botao} onClick={onFazer}>🔎 {pp ? "Refazer" : "Fazer"} a pesquisa de preços</button>}
        {pp && !ro && <button type="button" className={botao} onClick={() => void precosDoContrato()}>Preencher o preço contratado pelos itens do contrato</button>}
        {pp && !ro && <button type="button" className={botao} onClick={() => onPesquisa(null)}>Descartar a pesquisa</button>}
      </div>
      {msg && <p className="text-slate-600">{msg}</p>}
      {!pp && <p className="text-slate-500">A pesquisa abre a tela de Pesquisa de Preços já com o contrato, o PAG e o Termo de Referência vinculado; no relatório, clique em "Enviar ao termo aditivo".</p>}
      {pp && (
        <>
          <p className="text-slate-500">TR: {pp.fonte_tr || "—"} · pesquisa de {pp.data_pesquisa} · {pp.atualizacao || "sem atualização"} ·
            critério <select className="rounded border border-slate-200 px-1" value={pp.criterio} disabled={ro} onChange={(e) => onPesquisa({ ...pp, criterio: e.target.value as PesquisaPrecosAditivo["criterio"] })}>
              <option value="mediana">mediana</option><option value="media">média</option><option value="menor">menor preço</option></select></p>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-left">
              <thead className="text-[10.5px] uppercase text-slate-500"><tr><th className="p-1">Item</th><th className="p-1">Descrição</th><th className="p-1">Qtd</th><th className="p-1">Preço contratado (novo período)</th><th className="p-1">Preços</th><th className="p-1">Referência</th><th className="p-1">Diferença</th></tr></thead>
              <tbody>
                {pp.itens.map((it, i) => {
                  const e = estatistica(it, pp.criterio);
                  const dif = e && it.preco_contratado != null ? ((it.preco_contratado - e.referencia) / e.referencia) * 100 : null;
                  return (
                    <tr key={i} className="border-t border-slate-100 align-top">
                      <td className="p-1">{it.item}</td>
                      <td className="max-w-[320px] p-1">{it.descricao}<div className="text-slate-400">{it.codigo} · {it.unidade}</div></td>
                      <td className="p-1">{it.quantidade}</td>
                      <td className="p-1"><input className="w-28 rounded border border-slate-200 px-1 py-0.5 text-right" readOnly={ro} defaultValue={num2(it.preco_contratado)}
                        onBlur={(ev) => onPesquisa({ ...pp, itens: pp.itens.map((x, j) => (j === i ? { ...x, preco_contratado: numero(ev.target.value) } : x)) })} /></td>
                      <td className={`p-1 ${e && e.n < 3 ? "font-bold text-amber-700" : ""}`}>{e?.n ?? 0}</td>
                      <td className="p-1">{e ? brl(e.referencia) : "—"}</td>
                      <td className={`p-1 ${dif != null && dif > 0 ? "font-bold text-red-600" : "text-emerald-700"}`}>{dif == null ? "—" : `${dif > 0 ? "+" : ""}${dif.toFixed(2).replace(".", ",")}%`}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {rp && <p className={rp.vantajosa ? "font-semibold text-emerald-700" : "font-semibold text-red-700"}>Total contratado {brl(rp.totalContratado)} × referência de mercado {brl(rp.totalReferencia)}: {rp.vantajosa ? "prorrogação vantajosa." : "acima do mercado – negociar redução ou justificar a vantajosidade."}</p>}
        </>
      )}
    </div>
  );
}

// Memória de Cálculo (seção 3F): o mesmo motor dos Reajustes, com o instrumento "Termo Aditivo"; o reajuste é
// preparado na tela de Reajustes (índice e período) e aqui só se calcula e se gera a memória.
async function configReajuste(): Promise<ConfigApostilamento> {
  const { data } = await supabase.from("apostilamento_config").select("ordenador, aci, cidade, ug_apoio, textos_fixos_om, dias_alerta").eq("id", "padrao").maybeSingle();
  return { ...CONFIG_VAZIA, ...(data ?? {}) } as ConfigApostilamento;
}
export function MemoriaAditivo({ d, numeroContrato, memoria, onReajuste, onMemoria, onAbrirReajustes, ro }: {
  d: DadosAditivo; numeroContrato: string; memoria: Arquivo | null; onReajuste: (r: ReajusteAditivo) => void; onMemoria: (a: Arquivo) => void; onAbrirReajustes: () => void; ro?: boolean;
}) {
  const [msg, setMsg] = useState<{ ok: boolean; txt: string } | null>(null);
  const [ocupado, setOcupado] = useState(false);
  async function preparar() {
    const { dados } = await cadastroReajuste(numeroContrato);
    if (!dados) throw new Error("O contrato não tem cadastro nos Reajustes: abra-o nos Reajustes e complete o cadastro.");
    if (!dados.reajustes?.some((r) => r.novo)) throw new Error("Nenhum reajuste pedido agora no cadastro dos Reajustes: abra o contrato nos Reajustes, confira o índice e o período e volte.");
    return { dados: paraMotor({ ...dados, instrumento: "Termo Aditivo", numero_instrumento: d.numero_aditivo }), config: await configReajuste() };
  }
  async function calcular() {
    setOcupado(true); setMsg({ ok: true, txt: "Calculando no motor dos Reajustes…" });
    try {
      const { dados, config } = await preparar();
      const r = await motor.simular(dados, config, (t) => setMsg({ ok: true, txt: t }));
      const novos = r.resumo.reajustes.filter((x) => x.novo);
      const pct = novos.map((x) => `${x.indice_pct.toFixed(6).replace(".", ",")}%`).join(" e ");
      onReajuste({ indice: dados.indice?.nome || null, percentual: pct || null, valor: Math.round(r.resumo.valor_termo * 100) / 100 });
      setMsg({ ok: true, txt: `Reajuste ${dados.indice?.nome ?? ""} ${pct}: ${brl(r.resumo.valor_termo)} (valor reajustado ${brl(r.resumo.valor_reajustado)}).${r.avisos.length ? ` Avisos: ${r.avisos.join("; ")}` : ""}` });
    } catch (e) { setMsg({ ok: false, txt: e instanceof Error ? e.message : String(e) }); } finally { setOcupado(false); }
  }
  async function gerarMemoria() {
    setOcupado(true); setMsg({ ok: true, txt: "Gerando a memória de cálculo…" });
    try {
      const { dados, config } = await preparar();
      const r = await motor.gerar(dados, config, [], (t) => setMsg({ ok: true, txt: t }));
      const arquivos = unzipSync(new Uint8Array(await r.zip.arrayBuffer()));
      const nome = Object.keys(arquivos).find((n) => /^1 - Memoria de Calculo/i.test(n));
      if (!nome) throw new Error("O motor não devolveu a memória de cálculo.");
      const b = arquivos[nome];
      onMemoria({ nome: `20 - ${nome.replace(/^1 - /, "")}`, bytes: b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer });
      setMsg({ ok: true, txt: `Memória de cálculo pronta: ${nome}. Os prints da Calculadora do Cidadão vão dentro do Parecer Técnico (consulta no RESUMO dos Reajustes).` });
    } catch (e) { setMsg({ ok: false, txt: e instanceof Error ? e.message : String(e) }); } finally { setOcupado(false); }
  }
  return (
    <div className="space-y-2 text-xs">
      <div className="flex flex-wrap gap-2">
        <button type="button" className={botao} onClick={onAbrirReajustes}>Abrir o contrato nos Reajustes ↗</button>
        {!ro && <button type="button" className={botao} disabled={ocupado} onClick={() => void calcular()}>🧮 Calcular o reajuste (Termo Aditivo)</button>}
        {!ro && <button type="button" className={botao} disabled={ocupado} onClick={() => void gerarMemoria()}>📊 Gerar a Memória de Cálculo</button>}
      </div>
      {msg && <p className={msg.ok ? "text-slate-600" : "text-red-700"}>{msg.txt}</p>}
      {memoria && <p className="text-emerald-700">✔ {memoria.nome} (vai no .zip como item 20 da Lista)</p>}
    </div>
  );
}
