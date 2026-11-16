import { useEffect, useMemo, useState } from "react";
import { supabase } from "../../lib/supabase";
import { motor } from "../../lib/apostilamento/motor";
import { buscarIndice, periodoDoReajuste, urlCalculadora } from "../../lib/apostilamento/indice";
import { dadosIniciais, itensColados, paraMotor, reajustesAplicados, type ContratoScon } from "../../lib/apostilamento/cadastro";
import type { ConfigApostilamento, DadosReajuste, ItemContrato, ResultadoChecagem, ResultadoGeracao } from "../../lib/apostilamento/tipos";
import { Caixa, Campo, CampoNumero, Secao, brl } from "./campos";

type UltimaNE = { ne: string; pi: string; unidade: string } | null;
type Props = {
  contrato: ContratoScon;
  config: ConfigApostilamento;
  nomeUsuario: string;
  ultimaNE: UltimaNE;
  aoVoltar: () => void;
  aoSalvar: (r: { numero_contrato: string; data_base: string; reajustes_aplicados: number; dedicacao_exclusiva: boolean; atualizado_em: string }) => void;
};

const INDICES = ["IPCA", "INPC", "IGP-M", "IGP-DI", "IPCA-E", "INCC"];
const ICONE = { OK: "✅", ATENCAO: "⚠️", FALTA: "❌" } as const;

/** Tela do reajuste de um contrato: cadastro (salvo no banco), índice do Banco Central, prints da Calculadora,
 *  quadro de checagem e geração dos 4 documentos pelo motor da SCON. */
export default function ReajusteContrato({ contrato, config, nomeUsuario, ultimaNE, aoVoltar, aoSalvar }: Props) {
  const [d, setD] = useState<DadosReajuste | null>(null);
  const [dedicacao, setDedicacao] = useState(false);
  const [versao, setVersao] = useState<number | null>(null);
  const [alterado, setAlterado] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; txt: string } | null>(null);
  const [prints, setPrints] = useState<Record<number, File>>({});
  const [checagem, setChecagem] = useState<ResultadoChecagem | null>(null);
  const [simulacao, setSimulacao] = useState<ResultadoGeracao | null>(null);
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [colar, setColar] = useState<string | null>(null);
  const [buscandoIdx, setBuscandoIdx] = useState<number | null>(null);

  // carrega o cadastro (ou começa pelo que o app já sabe do contrato)
  useEffect(() => {
    let vivo = true;
    supabase.from("contratos_apostilamento").select("dados, dedicacao_exclusiva, versao").eq("numero_contrato", contrato.numero_contrato).maybeSingle()
      .then(({ data, error }) => {
        if (!vivo) return;
        if (error) setMsg({ ok: false, txt: `Não li o cadastro: ${error.message}` });
        if (data?.dados && Object.keys(data.dados).length) {
          setD({ ...dadosIniciais(contrato), ...(data.dados as DadosReajuste) });
          setDedicacao(!!data.dedicacao_exclusiva);
          setVersao(data.versao);
        } else {
          setD(dadosIniciais(contrato));
          setAlterado(true);
        }
      });
    // o Python começa a carregar já (na primeira vez demora)
    motor.iniciar().catch(() => undefined);
    return () => { vivo = false; };
  }, [contrato]);

  const muda = (f: (x: DadosReajuste) => DadosReajuste) => { setD((x) => (x ? f(x) : x)); setAlterado(true); setChecagem(null); setSimulacao(null); };
  const set = <K extends keyof DadosReajuste>(k: K, v: DadosReajuste[K]) => muda((x) => ({ ...x, [k]: v }));

  const totalItens = useMemo(() => (d?.itens ?? []).reduce((s, it) => s + (it.valor_base ?? 0), 0), [d?.itens]);
  const temTextoFixo = !!config.textos_fixos_om[d?.om_ordenador || config.ordenador.om_sigla || "GAP-MN"];
  const novos = (d?.reajustes ?? []).filter((r) => r.novo);
  const printsNovos = novos.map((r) => prints[r.n]).filter((f): f is File => !!f);

  if (!d) return <div className="p-6 text-sm text-slate-500">Carregando o contrato…</div>;

  async function salvar() {
    if (!d) return;
    setOcupado("Salvando…"); setMsg(null);
    const { data: s } = await supabase.auth.getSession();
    const linha = {
      numero_contrato: contrato.numero_contrato, dados: d, reajustes_aplicados: reajustesAplicados(d), dedicacao_exclusiva: dedicacao,
      atualizado_por: s.session?.user.id ?? null, atualizado_nome: nomeUsuario, atualizado_em: new Date().toISOString(),
    };
    let erro: string | null = null;
    if (versao == null) {
      const { error } = await supabase.from("contratos_apostilamento").insert({ ...linha, versao: 1 });
      if (error) erro = error.code === "23505" ? "outra pessoa criou o cadastro deste contrato agora — recarregue a página" : error.message;
      else setVersao(1);
    } else {
      const { data, error } = await supabase.from("contratos_apostilamento").update({ ...linha, versao: versao + 1 })
        .eq("numero_contrato", contrato.numero_contrato).eq("versao", versao).select("versao");
      if (error) erro = error.message;
      else if (!data?.length) erro = "outra pessoa salvou este cadastro depois que você abriu — recarregue a página para não apagar o que ela fez";
      else setVersao(versao + 1);
    }
    setOcupado(null);
    if (erro) { setMsg({ ok: false, txt: `Não salvou: ${erro}` }); return; }
    setAlterado(false);
    setMsg({ ok: true, txt: "Cadastro salvo." });
    aoSalvar({ numero_contrato: linha.numero_contrato, data_base: d.data_base, reajustes_aplicados: linha.reajustes_aplicados, dedicacao_exclusiva: dedicacao, atualizado_em: linha.atualizado_em });
  }

  async function rodar<T>(rotulo: string, f: (progresso: (e: string) => void) => Promise<T>): Promise<T | null> {
    setOcupado(rotulo); setMsg(null);
    try { return await f((e) => setOcupado(e)); }
    catch (e) { setMsg({ ok: false, txt: e instanceof Error ? e.message : String(e) }); return null; }
    finally { setOcupado(null); }
  }

  async function checar() {
    if (!d) return null;
    const q = await rodar("Conferindo os dados…", (p) => motor.checar(paraMotor(d), config, p));
    if (q) setChecagem(q);
    return q;
  }
  async function conferir() {
    if (!d) return;
    const q = await checar();
    if (!q) return;
    if (!q.pode_gerar) { setMsg({ ok: false, txt: "Há campos marcados com ❌ no quadro de checagem: preencha antes de conferir os valores." }); return; }
    const r = await rodar("Calculando…", (p) => motor.simular(paraMotor(d), config, p));
    if (r) setSimulacao(r);
  }
  async function gerar() {
    if (!d) return;
    const q = await checar();
    if (!q?.pode_gerar) { if (q) setMsg({ ok: false, txt: "Há campos marcados com ❌ no quadro de checagem." }); return; }
    const r = await rodar("Gerando os documentos…", (p) => motor.gerar(paraMotor(d), config, printsNovos, p));
    if (!r) return;
    setSimulacao(r);
    const a = document.createElement("a");
    a.href = URL.createObjectURL(r.zip);
    a.download = `Apostilamento - CT ${contrato.numero_contrato.replace(/\//g, "-")}.zip`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 30000);
    setMsg({ ok: true, txt: `Documentos gerados: ${r.arquivos.length} arquivos no .zip baixado.` });
  }

  /** Valor para a Calculadora: total dos itens corrigido pelos reajustes anteriores (como no print da SCON). */
  function valorParaCalculadora(n: number): number {
    let v = totalItens;
    for (const r of d!.reajustes) if (r.n < n && r.indice_pct != null) v = Math.round(v * (1 + r.indice_pct / 100) * 100) / 100;
    return v;
  }
  async function buscarNoBC(idx: number) {
    const r = d!.reajustes[idx];
    if (!/^\d{2}\/\d{4}$/.test(d!.data_base)) { setMsg({ ok: false, txt: "Informe a data do orçamento (MM/AAAA) antes." }); return; }
    if (!d!.indice.nome) { setMsg({ ok: false, txt: "Informe o índice do contrato antes." }); return; }
    const per = periodoDoReajuste(d!.data_base, r.n);
    setBuscandoIdx(idx); setMsg(null);
    try {
      const res = await buscarIndice(d!.indice.nome, per.inicio, per.fim, valorParaCalculadora(r.n));
      muda((x) => ({ ...x, reajustes: x.reajustes.map((y, i) => (i === idx ? { ...y, indice_pct: res.percentual } : y)) }));
      setMsg({ ok: res.completo, txt: res.completo
        ? `${res.indice} ${per.inicio} a ${per.fim}: ${res.percentual.toLocaleString("pt-BR", { minimumFractionDigits: 6 })}% (${res.meses} meses, como na Calculadora). Confira e anexe o print da Calculadora.`
        : `${res.indice} ${per.inicio} a ${per.fim}: só ${res.meses} meses divulgados — o índice do último mês ainda não saiu.` });
    } catch (e) {
      setMsg({ ok: false, txt: e instanceof Error ? e.message : String(e) });
    } finally { setBuscandoIdx(null); }
  }

  const setItem = (i: number, campo: keyof ItemContrato, v: unknown) => muda((x) => ({ ...x, itens: x.itens.map((it, j) => (j === i ? { ...it, [campo]: v } : it)) }));
  const cel = "rounded border border-slate-200 px-1.5 py-1 text-xs";

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <button onClick={() => { if (!alterado || confirm("Há alterações não salvas. Sair mesmo assim?")) aoVoltar(); }} className="text-sm text-sky-700 hover:underline">← Painel</button>
        <h2 className="text-lg font-semibold text-slate-800">Contrato {contrato.numero_contrato}</h2>
        <span className="text-xs text-slate-500">{contrato.fornecedor}</span>
        {alterado && <span className="text-xs text-amber-600">alterações não salvas</span>}
      </div>

      <Secao titulo="1. Contrato">
        <div className="grid md:grid-cols-3 gap-3">
          <Campo rotulo="NUP / PAG" valor={d.nup} onChange={(v) => set("nup", v)} />
          <Campo rotulo="OM contratante (sigla, vai no cabeçalho)" valor={d.om_contratante_sigla} onChange={(v) => set("om_contratante_sigla", v)} dica="sugerida pelo número do contrato — confira (ex.: 2º GDAAE)" />
          <Campo rotulo="OM contratante (nome por extenso)" valor={d.om_contratante_nome} onChange={(v) => set("om_contratante_nome", v)} placeholder="2º GRUPO DE DEFESA ANTIAÉREA" />
          <Campo rotulo="OM do Ordenador que assina" valor={d.om_ordenador ?? ""} onChange={(v) => set("om_ordenador", v.toUpperCase())} placeholder={config.ordenador.om_sigla || "GAP-MN"} dica="vazio = a da configuração" />
        </div>
        <div className="grid md:grid-cols-2 gap-3 mt-3">
          <Campo rotulo="Objeto completo (cláusula do objeto)" valor={d.objeto_completo} onChange={(v) => set("objeto_completo", v)} longo />
          <Campo rotulo="Objeto resumido" valor={d.objeto_resumido} onChange={(v) => set("objeto_resumido", v)} longo placeholder="Contratação de serviços de outsourcing de impressão" />
        </div>
        <Caixa rotulo="Dedicação exclusiva de mão de obra (repactuação — fica fora do painel e desta automação)" marcado={dedicacao} onChange={(v) => { setDedicacao(v); setAlterado(true); }} />
      </Secao>

      <Secao titulo="2. Empresa (II – CONTRATADA, 1ª página do contrato)">
        <div className="grid md:grid-cols-2 gap-3">
          <Campo rotulo="Razão social" valor={d.empresa.nome} onChange={(v) => set("empresa", { ...d.empresa, nome: v })} />
          <Campo rotulo="CNPJ" valor={d.empresa.cnpj} onChange={(v) => set("empresa", { ...d.empresa, cnpj: v })} />
          <Campo rotulo="Endereço (como no contrato)" valor={d.empresa.endereco} onChange={(v) => set("empresa", { ...d.empresa, endereco: v })} placeholder="na Alameda…, n° …, Bairro…, em Cidade/UF - CEP: …" />
          <Campo rotulo="Representante da empresa" valor={d.empresa.representante} onChange={(v) => set("empresa", { ...d.empresa, representante: v })} />
        </div>
        <Caixa rotulo="Representante do sexo feminino" marcado={!!d.empresa.representante_feminino} onChange={(v) => set("empresa", { ...d.empresa, representante_feminino: v })} />
        <div className="grid md:grid-cols-2 gap-3 mt-3">
          <Campo rotulo="Parágrafo II – CONTRATADA (opcional, use **negrito**)" valor={d.contratada_paragrafo ?? ""} onChange={(v) => set("contratada_paragrafo", v)} longo />
          {temTextoFixo
            ? <p className="text-xs text-emerald-700 bg-emerald-50 rounded-lg px-3 py-2 self-start">O "I – CONTRATANTE" sai do texto fixo da OM {d.om_ordenador || config.ordenador.om_sigla} (Configurações).</p>
            : <Campo rotulo="Parágrafo I – CONTRATANTE (OM sem texto fixo: copie da 1ª página do contrato)" valor={d.contratante_paragrafo ?? ""} onChange={(v) => set("contratante_paragrafo", v)} longo />}
        </div>
      </Secao>

      <Secao titulo="3. Índice e reajustes">
        <div className="grid md:grid-cols-4 gap-3">
          <label className="block">
            <span className="block text-[11px] font-medium text-slate-600 mb-0.5">Índice</span>
            <input list="indices-reajuste" className="w-full rounded-lg border border-slate-200 px-2 py-1.5 text-sm" value={d.indice.nome} onChange={(e) => set("indice", { ...d.indice, nome: e.target.value.toUpperCase() })} />
            <datalist id="indices-reajuste">{INDICES.map((i) => <option key={i} value={i} />)}</datalist>
          </label>
          <div className="md:col-span-3"><Campo rotulo="Cláusula do reajuste" valor={d.indice.clausula} onChange={(v) => set("indice", { ...d.indice, clausula: v })} placeholder="a CLÁUSULA SÉTIMA, item 7.2, do Termo de Referência" /></div>
          <Campo rotulo="Data do orçamento (MM/AAAA)" valor={d.data_base} onChange={(v) => set("data_base", v)} placeholder="07/2024" dica="TR de 2025 em diante; antes, a assinatura do Mapa Comparativo de Preços" />
          <label className="block">
            <span className="block text-[11px] font-medium text-slate-600 mb-0.5">Base dos valores</span>
            <select className="w-full rounded-lg border border-slate-200 px-2 py-1.5 text-sm" value={d.base} onChange={(e) => set("base", e.target.value as DadosReajuste["base"])}>
              <option value="ANUAL">Anual</option><option value="MENSAL">Mensal</option><option value="TOTAL">Total</option>
            </select>
          </label>
          <div className="md:col-span-2 pt-4"><Caixa rotulo="Mostrar a coluna de valor unitário na memória" marcado={d.mostrar_unitario} onChange={(v) => set("mostrar_unitario", v)} /></div>
        </div>
        <table className="w-full text-xs mt-3">
          <thead className="text-slate-500"><tr><th className="text-left py-1">Reajuste</th><th className="text-left">Período (12 índices)</th><th className="text-left">Índice (%)</th><th className="text-left">Situação</th><th className="text-left">Print da Calculadora</th><th /></tr></thead>
          <tbody>
            {d.reajustes.map((r, i) => {
              const per = /^\d{2}\/\d{4}$/.test(d.data_base) ? periodoDoReajuste(d.data_base, r.n) : null;
              const link = per && d.indice.nome ? urlCalculadora(d.indice.nome, per.inicio, per.fim, valorParaCalculadora(r.n)) : null;
              return (
                <tr key={i} className="border-t border-slate-100 align-top">
                  <td className="py-1.5 font-medium">{r.n}º</td>
                  <td className="py-1.5 text-slate-600">{per ? `${per.inicio} a ${per.fim} · efeitos 01/${per.aniversario}` : "–"}</td>
                  <td className="py-1.5">
                    <CampoNumero valor={r.indice_pct} casas={6} className="w-28" onChange={(v) => muda((x) => ({ ...x, reajustes: x.reajustes.map((y, j) => (j === i ? { ...y, indice_pct: v } : y)) }))} />
                    {r.novo && <button disabled={buscandoIdx != null} onClick={() => buscarNoBC(i)} className="ml-2 text-sky-700 hover:underline disabled:opacity-40">{buscandoIdx === i ? "buscando…" : "Buscar no Banco Central"}</button>}
                  </td>
                  <td className="py-1.5">
                    <select className={cel} value={r.novo ? "novo" : "aplicado"} onChange={(e) => muda((x) => ({ ...x, reajustes: x.reajustes.map((y, j) => (j === i ? { ...y, novo: e.target.value === "novo" } : y)) }))}>
                      <option value="novo">Pedido agora</option><option value="aplicado">Já aplicado</option>
                    </select>
                    {!r.novo && <input className={`${cel} ml-1 w-44`} placeholder="Documento (ex.: 1º Termo de Apostilamento)" value={r.documento ?? ""} onChange={(e) => muda((x) => ({ ...x, reajustes: x.reajustes.map((y, j) => (j === i ? { ...y, documento: e.target.value } : y)) }))} />}
                  </td>
                  <td className="py-1.5">
                    {r.novo && <>
                      <input type="file" accept="image/png,image/jpeg" className="text-[11px] w-48" onChange={(e) => { const f = e.target.files?.[0]; setPrints((p) => { const q = { ...p }; if (f) q[r.n] = f; else delete q[r.n]; return q; }); }} />
                      {link && <a href={link} target="_blank" rel="noreferrer" className="block text-sky-700 hover:underline">abrir a Calculadora já preenchida ↗</a>}
                    </>}
                  </td>
                  <td className="py-1.5 text-right"><button className="text-red-400 hover:text-red-600" onClick={() => muda((x) => ({ ...x, reajustes: x.reajustes.filter((_, j) => j !== i) }))}>✕</button></td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <button className="mt-2 text-xs text-sky-700 hover:underline" onClick={() => muda((x) => ({ ...x, reajustes: [...x.reajustes, { n: (x.reajustes.reduce((m, r) => Math.max(m, r.n), 0) || 0) + 1, indice_pct: null, novo: true }] }))}>+ reajuste</button>
        <p className="text-[11px] text-slate-400 mt-1">Os já aplicados vêm antes dos pedidos agora. Os prints (um por reajuste pedido) vão como anexo do parecer; não ficam guardados — escolha de novo ao gerar.</p>
      </Secao>

      <Secao titulo="4. Itens (numeração igual à do contrato)" direita={<button className="text-xs text-sky-700 hover:underline" onClick={() => setColar("")}>Colar da planilha</button>}>
        {colar != null && (
          <div className="mb-3 rounded-lg bg-slate-50 p-3">
            <p className="text-[11px] text-slate-600 mb-1">Cole as linhas da planilha (colunas: item, descrição, CATSER, quantidade, unitário mensal, valor do item na base). As linhas substituem os itens atuais.</p>
            <textarea className="w-full rounded border border-slate-200 p-2 text-xs font-mono min-h-[90px]" value={colar} onChange={(e) => setColar(e.target.value)} />
            <div className="flex gap-2 mt-1">
              <button className="rounded bg-sky-600 text-white px-2 py-1 text-xs disabled:opacity-40" disabled={!itensColados(colar).length} onClick={() => { set("itens", itensColados(colar)); setColar(null); }}>Usar {itensColados(colar).length} itens</button>
              <button className="text-xs text-slate-500" onClick={() => setColar(null)}>Cancelar</button>
            </div>
          </div>
        )}
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="text-slate-500"><tr>
              <th className="text-left py-1 w-14">Item</th><th className="text-left">Descrição</th><th className="text-left w-20">CATSER</th>
              <th className="text-right w-20">Qtd atual</th><th className="text-right w-20" title="só se houve supressão ou acréscimo">Qtd inicial</th>
              <th className="text-right w-28">Unitário mensal</th><th className="text-right w-28">Valor na base</th><th />
            </tr></thead>
            <tbody>
              {d.itens.map((it, i) => (
                <tr key={i} className="border-t border-slate-100">
                  <td><input className={`${cel} w-12`} value={it.item} onChange={(e) => setItem(i, "item", Number(e.target.value.replace(/\D/g, "")) || 0)} /></td>
                  <td><input className={`${cel} w-full`} value={it.descricao} onChange={(e) => setItem(i, "descricao", e.target.value)} /></td>
                  <td><input className={`${cel} w-20`} value={it.catser ?? ""} onChange={(e) => setItem(i, "catser", e.target.value)} /></td>
                  <td className="text-right"><CampoNumero valor={it.qtd} casas={0} className="w-20" onChange={(v) => setItem(i, "qtd", v)} /></td>
                  <td className="text-right"><CampoNumero valor={it.qtd_inicial ?? null} casas={0} className="w-20" onChange={(v) => setItem(i, "qtd_inicial", v)} /></td>
                  <td className="text-right"><CampoNumero valor={it.valor_unit} className="w-28" onChange={(v) => setItem(i, "valor_unit", v)} /></td>
                  <td className="text-right"><CampoNumero valor={it.valor_base} className="w-28" onChange={(v) => setItem(i, "valor_base", v)} /></td>
                  <td className="text-right"><button className="text-red-400 hover:text-red-600" onClick={() => muda((x) => ({ ...x, itens: x.itens.filter((_, j) => j !== i) }))}>✕</button></td>
                </tr>
              ))}
            </tbody>
            <tfoot><tr className="border-t border-slate-200 font-medium"><td colSpan={6} className="text-right py-1.5 pr-2">Soma dos itens</td><td className="text-right">{brl(totalItens)}</td><td /></tr></tfoot>
          </table>
        </div>
        <div className="flex flex-wrap items-end gap-4 mt-2">
          <button className="text-xs text-sky-700 hover:underline" onClick={() => muda((x) => ({ ...x, itens: [...x.itens, { item: (x.itens.reduce((m, it) => Math.max(m, it.item), 0) || 0) + 1, descricao: "", catser: "", qtd: 1, valor_unit: null, valor_base: null }] }))}>+ item</button>
          <label className="text-xs text-slate-600">Valor do contrato na base (conferência da soma):{" "}
            <CampoNumero valor={d.itens_total_inicial} className="w-32" onChange={(v) => set("itens_total_inicial", v)} />
          </label>
        </div>
      </Secao>

      <Secao titulo="5. Histórico de valores e termos aditivos">
        <p className="text-[11px] text-slate-500 mb-2">Valor que o contrato passou a ter depois de cada documento, em ordem de assinatura (item 5 do parecer).</p>
        {d.historico_valores.map((h, i) => (
          <div key={i} className="flex gap-2 mb-1">
            <input className={`${cel} flex-1`} value={h.documento} onChange={(e) => set("historico_valores", d.historico_valores.map((x, j) => (j === i ? { ...x, documento: e.target.value } : x)))} />
            <CampoNumero valor={h.valor} className="w-36" onChange={(v) => set("historico_valores", d.historico_valores.map((x, j) => (j === i ? { ...x, valor: v } : x)))} />
            <button className="text-red-400 text-xs" onClick={() => set("historico_valores", d.historico_valores.filter((_, j) => j !== i))}>✕</button>
          </div>
        ))}
        <button className="text-xs text-sky-700 hover:underline" onClick={() => set("historico_valores", [...d.historico_valores, { documento: `${d.historico_valores.length}º Termo Aditivo`, valor: null }])}>+ documento</button>
        <h4 className="text-xs font-semibold text-slate-700 mt-4 mb-1">Supressões e acréscimos no meio do período</h4>
        {d.alteracoes_quantitativas.map((a, i) => (
          <div key={i} className="grid md:grid-cols-[180px_130px_1fr_24px] gap-2 mb-1">
            <input className={cel} placeholder="1º Termo Aditivo" value={a.documento} onChange={(e) => set("alteracoes_quantitativas", d.alteracoes_quantitativas.map((x, j) => (j === i ? { ...x, documento: e.target.value } : x)))} />
            <input className={cel} placeholder="dd/mm/aaaa (última assinatura)" value={a.data_assinatura} onChange={(e) => set("alteracoes_quantitativas", d.alteracoes_quantitativas.map((x, j) => (j === i ? { ...x, data_assinatura: e.target.value } : x)))} />
            <input className={cel} placeholder="a supressão quantitativa de …" value={a.descricao} onChange={(e) => set("alteracoes_quantitativas", d.alteracoes_quantitativas.map((x, j) => (j === i ? { ...x, descricao: e.target.value } : x)))} />
            <button className="text-red-400 text-xs" onClick={() => set("alteracoes_quantitativas", d.alteracoes_quantitativas.filter((_, j) => j !== i))}>✕</button>
          </div>
        ))}
        <button className="text-xs text-sky-700 hover:underline" onClick={() => set("alteracoes_quantitativas", [...d.alteracoes_quantitativas, { documento: "", data_assinatura: "", descricao: "" }])}>+ supressão/acréscimo</button>
        {d.alteracoes_quantitativas.length > 0 && <div><Caixa rotulo="Incluir o complemento do reajuste sobre as unidades suprimidas (regra da SCON)" marcado={d.complemento_supressao} onChange={(v) => set("complemento_supressao", v)} /></div>}
      </Secao>

      <Secao titulo="6. Último empenho (Declaração de Disponibilidade Orçamentária)">
        {ultimaNE && (
          <p className="text-xs text-slate-600 mb-2">Última NE do contrato no app: <strong>{ultimaNE.ne}</strong> (PI {ultimaNE.pi || "–"}, UG {ultimaNE.unidade || "–"}){" "}
            <button className="text-sky-700 hover:underline" onClick={() => set("orcamento", { ...d.orcamento, plano_interno: d.orcamento.plano_interno || ultimaNE.pi, gestao_unidade: d.orcamento.gestao_unidade || ultimaNE.unidade })}>usar PI e UG</button>
            {" "}— fonte, PTRES e natureza estão no documento da NE.</p>
        )}
        <div className="grid md:grid-cols-4 gap-3">
          <Campo rotulo="Gestão/Unidade (UG)" valor={d.orcamento.gestao_unidade} onChange={(v) => set("orcamento", { ...d.orcamento, gestao_unidade: v })} />
          <Campo rotulo="Fonte" valor={d.orcamento.fonte} onChange={(v) => set("orcamento", { ...d.orcamento, fonte: v })} />
          <Campo rotulo="Programa de trabalho (PTRES)" valor={d.orcamento.programa_trabalho} onChange={(v) => set("orcamento", { ...d.orcamento, programa_trabalho: v })} />
          <Campo rotulo="Ação (se houver)" valor={d.orcamento.acao ?? ""} onChange={(v) => set("orcamento", { ...d.orcamento, acao: v })} />
          <Campo rotulo="Plano interno" valor={d.orcamento.plano_interno} onChange={(v) => set("orcamento", { ...d.orcamento, plano_interno: v })} />
          <Campo rotulo="Natureza de despesa" valor={d.orcamento.natureza_despesa} onChange={(v) => set("orcamento", { ...d.orcamento, natureza_despesa: v })} />
          <Campo rotulo="Exercício" valor={String(d.orcamento.exercicio ?? "")} onChange={(v) => set("orcamento", { ...d.orcamento, exercicio: Number(v.replace(/\D/g, "")) || v })} />
          <Campo rotulo='"a cargo do …" (só se o OD for de outra OM)' valor={d.orcamento.ug_texto ?? ""} onChange={(v) => set("orcamento", { ...d.orcamento, ug_texto: v })} />
        </div>
      </Secao>

      <Secao titulo="7. Documento">
        <div className="grid md:grid-cols-4 gap-3">
          <Campo rotulo="Nº do apostilamento" valor={d.numero_instrumento == null ? "" : String(d.numero_instrumento)} onChange={(v) => set("numero_instrumento", v.replace(/\D/g, "") ? Number(v.replace(/\D/g, "")) : null)} placeholder="1" />
          <label className="block">
            <span className="block text-[11px] font-medium text-slate-600 mb-0.5">Instrumento</span>
            <select className="w-full rounded-lg border border-slate-200 px-2 py-1.5 text-sm" value={d.instrumento} onChange={(e) => set("instrumento", e.target.value)}>
              <option>Termo de Apostilamento</option><option>Termo Aditivo</option>
            </select>
          </label>
          <Campo rotulo="Nº do Parecer Técnico" valor={d.parecer_numero} onChange={(v) => set("parecer_numero", v)} placeholder="001/2026" />
          <label className="block">
            <span className="block text-[11px] font-medium text-slate-600 mb-0.5">Data da declaração</span>
            <input type="date" className="w-full rounded-lg border border-slate-200 px-2 py-1.5 text-sm" value={d.data_declaracao ?? ""} onChange={(e) => set("data_declaracao", e.target.value)} />
            <span className="block text-[10px] text-slate-400 mt-0.5">vazio = "data conforme assinatura eletrônica"</span>
          </label>
        </div>
        <div className="mt-3">
          <Campo rotulo="Observações extras da memória de cálculo (uma por linha — ex.: decisão sobre unitário que não bate)" longo
            valor={d.observacoes_extras.join("\n")} onChange={(v) => set("observacoes_extras", v.split("\n"))} />
        </div>
      </Secao>

      {checagem && (
        <Secao titulo={`Quadro de checagem — ${checagem.pode_gerar ? "pode gerar" : "falta preencher"}`}>
          <table className="w-full text-xs">
            <tbody>
              {checagem.itens.map((q, i) => (
                <tr key={i} className={`border-t border-slate-100 ${q.status === "FALTA" ? "bg-red-50" : q.status === "ATENCAO" ? "bg-amber-50" : ""}`}>
                  <td className="py-1 w-6">{ICONE[q.status]}</td>
                  <td className="py-1 font-medium text-slate-700">{q.campo}</td>
                  <td className="py-1 text-slate-600 max-w-[360px] truncate" title={String(q.valor ?? "")}>{String(q.valor ?? "")}</td>
                  <td className="py-1 text-slate-500">{q.mensagem}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Secao>
      )}

      {simulacao && (
        <Secao titulo="Valores (motor da SCON)">
          <div className="grid md:grid-cols-4 gap-3 text-sm">
            <div><div className="text-[11px] text-slate-500">Valor atual</div><div className="font-semibold">{brl(simulacao.resumo.valor_atual)}</div></div>
            <div><div className="text-[11px] text-slate-500">Valor reajustado</div><div className="font-semibold">{brl(simulacao.resumo.valor_reajustado)}</div></div>
            <div><div className="text-[11px] text-slate-500">Valor do termo</div><div className="font-semibold text-emerald-700">{brl(simulacao.resumo.valor_termo)}</div><div className="text-[10px] text-slate-500">{simulacao.resumo.valor_termo_extenso}</div></div>
            <div><div className="text-[11px] text-slate-500">Efeitos financeiros</div><div className="font-semibold">{simulacao.resumo.efeitos_financeiros}</div></div>
          </div>
          {simulacao.resumo.complemento_supressao > 0 && <p className="text-xs text-slate-600 mt-2">Inclui o complemento da supressão: {brl(simulacao.resumo.complemento_supressao)}.</p>}
          <ul className="text-xs text-slate-600 mt-2 list-disc pl-5">
            {simulacao.resumo.reajustes.map((r) => <li key={r.n}>{r.n}º reajuste {r.novo ? "(pedido agora)" : "(já aplicado)"}: {r.inicio} a {r.fim}, {r.indice_pct.toLocaleString("pt-BR", { minimumFractionDigits: 6 })}%, efeitos {r.efeitos}</li>)}
          </ul>
          {simulacao.avisos.length > 0 && <ul className="text-xs text-amber-700 mt-2 list-disc pl-5">{simulacao.avisos.map((a, i) => <li key={i}>{a}</li>)}</ul>}
        </Secao>
      )}

      <div className="sticky bottom-0 z-20 -mx-4 border-t border-slate-200 px-4 py-3" style={{ background: "rgba(6,14,31,0.97)" }}>
        <div className="flex flex-wrap items-center gap-2">
          <button onClick={salvar} disabled={!!ocupado} className="rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-slate-700 px-3 py-2 text-sm disabled:opacity-50">Salvar cadastro</button>
          <button onClick={checar} disabled={!!ocupado} className="rounded-lg border border-sky-300 text-sky-700 hover:bg-sky-50 px-3 py-2 text-sm disabled:opacity-50">Checar dados</button>
          <button onClick={conferir} disabled={!!ocupado} className="rounded-lg border border-sky-300 text-sky-700 hover:bg-sky-50 px-3 py-2 text-sm disabled:opacity-50">Conferir valores</button>
          <button onClick={gerar} disabled={!!ocupado} className="rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white px-3 py-2 text-sm font-medium disabled:opacity-50">
            Gerar os 4 documentos (.zip){novos.length ? ` · ${printsNovos.length}/${novos.length} prints` : ""}
          </button>
          {ocupado && <span className="text-xs text-slate-500 animate-pulse">{ocupado}</span>}
          {!ocupado && msg && <span className={`text-xs ${msg.ok ? "text-emerald-700" : "text-red-600"}`}>{msg.txt}</span>}
        </div>
      </div>
    </div>
  );
}
