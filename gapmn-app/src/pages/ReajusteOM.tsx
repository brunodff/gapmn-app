import { useEffect, useMemo, useState } from "react";
import ReajusteContrato from "../components/reajustes/ReajusteContrato";
import ConfigReajustes from "../components/reajustes/ConfigReajustes";
import { armazemNavegador, cadastrosNoNavegador } from "../lib/apostilamento/armazem";
import type { ContratoScon } from "../lib/apostilamento/cadastro";
import { numBR, type ContratoGov } from "../lib/apostilamento/contratosGov";
import { listaDaUg } from "../lib/apostilamento/contratosGovApi";
import { CONFIG_VAZIA, type ConfigApostilamento } from "../lib/apostilamento/tipos";

// Reajuste por apostilamento para qualquer OM da FAB, dentro do app (/app?vista=reajuste-om): os contratos
// vêm do Contratos.gov.br pela UG; o cadastro, a configuração e os documentos ficam só neste navegador (nada vai
// para o banco do gapmn.app). Nome e sigla da unidade saem do Contratos.gov.br enquanto a OM não preenche a
// configuração — sem isso o motor usaria os padrões do GAP-MN no cabeçalho e no "I – CONTRATANTE".

const CHAVE_UG = "reajuste-om:ug";
const chaveConfig = (ug: string) => `reajuste-om:config:${ug}`;
const CONFIG_OM: ConfigApostilamento = {
  ...CONFIG_VAZIA,
  ordenador: { ...CONFIG_VAZIA.ordenador, om_sigla: "" },
  aci: { nome: "", posto: "", funcao: "Agente de Controle Interno" },
  cidade: "",
  ug_apoio: { nome: "", sigla: "", endereco: "", cnpj: "" },
  textos_fixos_om: {},
};
const ler = <T,>(k: string, padrao: T): T => { try { const s = localStorage.getItem(k); return s ? (JSON.parse(s) as T) : padrao; } catch { return padrao; } };
const guardar = (k: string, v: unknown) => { try { localStorage.setItem(k, JSON.stringify(v)); return null; } catch { return "o navegador não deixou guardar"; } };
const data = (iso: string | null) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : "—");
const brl = (v: number | null) => (v == null ? "—" : v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" }));

function contratoDoGov(c: ContratoGov): ContratoScon & { data_inicio: string | null } {
  return {
    id: String(c.id), numero_contrato: c.numero, pag_nup: c.processo, fornecedor: c.fornecedor?.nome ?? null, cnpj: c.fornecedor?.cnpj_cpf_idgener ?? null,
    descricao: c.objeto, data_orcamento: null, data_final: c.vigencia_fim, vl_contratual: numBR(c.valor_global), data_inicio: c.vigencia_inicio,
  };
}

export default function ReajusteOM() {
  const [ug, setUg] = useState<string>(() => ler(CHAVE_UG, ""));
  const [ugDigitada, setUgDigitada] = useState(ug);
  const [config, setConfig] = useState<ConfigApostilamento>(() => (ug ? ler(chaveConfig(ug), CONFIG_OM) : CONFIG_OM));
  const [contratos, setContratos] = useState<ContratoGov[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [tentativa, setTentativa] = useState(0);
  const [aberto, setAberto] = useState<ContratoGov | null>(null);
  const [aba, setAba] = useState<"contratos" | "config">("contratos");
  const [busca, setBusca] = useState("");
  const [salvos, setSalvos] = useState(() => (ug ? cadastrosNoNavegador(ug) : {}));

  useEffect(() => {
    if (!ug) return;
    let vivo = true;
    listaDaUg(ug).then(
      (l) => { if (vivo) { setContratos(l); setErro(null); } },
      (e: unknown) => { if (vivo) setErro(e instanceof Error ? e.message : String(e)); },
    );
    return () => { vivo = false; };
  }, [ug, tentativa]);

  const armazem = useMemo(() => armazemNavegador(ug), [ug]);
  const lista = useMemo(() => {
    const q = busca.toLowerCase();
    return (contratos ?? []).filter((c) => !q || `${c.numero} ${c.fornecedor?.nome} ${c.objeto} ${c.processo}`.toLowerCase().includes(q))
      .sort((a, b) => (b.vigencia_fim ?? "").localeCompare(a.vigencia_fim ?? ""));
  }, [contratos, busca]);
  // unidade no Contratos.gov.br (contratante dos contratos da UG)
  const unidadeGov = useMemo(() => {
    const ugs = (contratos ?? []).map((c) => c.contratante?.orgao?.unidade_gestora).filter(Boolean);
    return ugs.find((u) => u?.codigo === ug) ?? ugs[0] ?? null;
  }, [contratos, ug]);
  // configuração usada: a da OM, completando nome e sigla da unidade pelo Contratos.gov.br
  const configUsada = useMemo<ConfigApostilamento>(() => {
    if (!unidadeGov) return config;
    const sigla = config.ug_apoio.sigla || unidadeGov.nome_resumido || "";
    return { ...config, ug_apoio: { ...config.ug_apoio, nome: config.ug_apoio.nome || unidadeGov.nome || "", sigla },
      ordenador: { ...config.ordenador, om_sigla: config.ordenador.om_sigla || sigla } };
  }, [config, unidadeGov]);
  const configIncompleta = !configUsada.ordenador.nome || !configUsada.aci.nome || !configUsada.ug_apoio.nome || !configUsada.cidade;
  // estáveis entre renders: o ReajusteContrato recarrega o cadastro quando eles mudam
  const contratoAberto = useMemo(() => (aberto ? contratoDoGov(aberto) : null), [aberto]);
  const siglaAberto = aberto?.contratante?.orgao?.unidade_gestora?.nome_resumido || configUsada.ug_apoio.sigla;
  // o nome por extenso da OM contratante vem do PDF do contrato (ou do Contratos.gov.br) no "Buscar"
  const padroes = useMemo(() => ({ om_contratante_sigla: siglaAberto }), [siglaAberto]);

  function escolherUg(e: React.FormEvent) {
    e.preventDefault();
    const u = ugDigitada.replace(/\D/g, "");
    if (u.length !== 6) { setErro("A UG tem 6 dígitos (ex.: 120630)."); return; }
    guardar(CHAVE_UG, u);
    setContratos(null); setErro(null);
    setConfig(ler(chaveConfig(u), CONFIG_OM)); setSalvos(cadastrosNoNavegador(u)); setUg(u);
  }

  function baixarCopia() {
    const blob = new Blob([JSON.stringify({ versao: 1, ug, config, cadastros: cadastrosNoNavegador(ug), salvo_em: new Date().toISOString() }, null, 1)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob); a.download = `reajuste-om-${ug}-${new Date().toISOString().slice(0, 10)}.json`; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }
  async function carregarCopia(f: File) {
    try {
      const j = JSON.parse(await f.text()) as { versao: number; ug: string; config: ConfigApostilamento; cadastros: Record<string, unknown> };
      if (j.versao !== 1 || !/^\d{6}$/.test(j.ug)) throw new Error("arquivo que não é cópia desta página");
      guardar(CHAVE_UG, j.ug); guardar(chaveConfig(j.ug), j.config);
      for (const [n, reg] of Object.entries(j.cadastros ?? {})) guardar(`reajuste-om:${j.ug}:${n}`, reg);
      setUgDigitada(j.ug); setConfig(j.config); setSalvos(cadastrosNoNavegador(j.ug));
      if (j.ug !== ug) { setContratos(null); setErro(null); setAberto(null); setUg(j.ug); }
    } catch (e) { setErro(`Não carreguei a cópia: ${e instanceof Error ? e.message : String(e)}`); }
  }

  return (
    <div className="space-y-4 text-slate-800">
      <div className="flex flex-wrap items-center gap-3">
          <div>
            <h1 className="text-lg font-bold text-slate-800">Reajuste de contratos de outra UG</h1>
            <p className="text-xs text-slate-500">Contratos pelo Contratos.gov.br · índice do Banco Central · termo, parecer, declaração e memória de cálculo gerados no seu computador</p>
          </div>
          {ug && (
            <div className="ml-auto flex flex-wrap items-center gap-2 text-xs">
              <span className="rounded-full bg-sky-50 px-2.5 py-1 font-medium text-sky-700">UG {ug}</span>
              <button onClick={baixarCopia} className="rounded-lg border border-slate-200 px-2.5 py-1 hover:bg-slate-50">💾 Baixar cópia</button>
              <label className="cursor-pointer rounded-lg border border-slate-200 px-2.5 py-1 hover:bg-slate-50">📂 Carregar cópia
                <input type="file" accept=".json" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) void carregarCopia(f); e.target.value = ""; }} />
              </label>
              <button onClick={() => { setUg(""); setContratos(null); setAberto(null); }} className="text-slate-500 hover:text-slate-800">trocar UG</button>
            </div>
          )}
      </div>

        <div className="rounded-xl border border-sky-200 bg-sky-50 p-3 text-xs text-sky-900">
          Feito no GAP-MN para a SCON e aberto a qualquer OM da FAB. <b>Nada do que você digita sai deste navegador</b>: o cadastro dos contratos e a
          configuração (Ordenador, ACI) ficam guardados aqui. Use “Baixar cópia” para levar a outro computador ou guardar no processo.
          Os contratos vêm da API pública do Contratos.gov.br; os PDFs do contrato são lidos aqui mesmo.
        </div>

        {!ug ? (
          <form onSubmit={escolherUg} className="mx-auto max-w-md space-y-3 rounded-xl border border-slate-200 bg-white p-6">
            <h2 className="font-semibold">Qual é a UG da sua OM?</h2>
            <p className="text-xs text-slate-500">A UG que assina os contratos no Contratos.gov.br (6 dígitos). O sistema traz os contratos ativos dela.</p>
            <input value={ugDigitada} onChange={(e) => setUgDigitada(e.target.value)} inputMode="numeric" placeholder="ex.: 120630"
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" aria-label="UG" />
            {erro && <p className="text-xs text-red-700">{erro}</p>}
            <button className="w-full rounded-lg bg-sky-600 px-4 py-2 text-sm font-medium text-white hover:bg-sky-700">Buscar meus contratos</button>
            <label className="block cursor-pointer text-center text-xs text-sky-700 hover:underline">ou carregue uma cópia salva
              <input type="file" accept=".json" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) void carregarCopia(f); e.target.value = ""; }} />
            </label>
          </form>
        ) : aberto && contratoAberto ? (
          <ReajusteContrato contrato={contratoAberto} config={configUsada} nomeUsuario="" ultimaNE={null} armazem={armazem} ugGov={ug} contratoGov={aberto}
            padroes={padroes}
            aoVoltar={() => { setAberto(null); setSalvos(cadastrosNoNavegador(ug)); }} aoSalvar={() => setSalvos(cadastrosNoNavegador(ug))} />
        ) : (
          <>
            <div className="flex gap-1 border-b border-slate-200">
              {(["contratos", "config"] as const).map((a) => (
                <button key={a} onClick={() => setAba(a)} className={`border-b-2 px-4 py-2 text-sm ${aba === a ? "border-sky-600 font-medium text-slate-800" : "border-transparent text-slate-500"}`}>
                  {a === "contratos" ? "Contratos" : `Configuração da OM${configIncompleta ? " ⚠️" : ""}`}
                </button>
              ))}
            </div>
            {aba === "config" ? (
              <ConfigReajustes config={configUsada} podeEditar nomeUsuario="" aoSalvar={setConfig} guardar={async (c) => guardar(chaveConfig(ug), c)} />
            ) : (
              <div className="space-y-3">
                {configIncompleta && <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">Preencha a Configuração da OM (Ordenador de Despesas, ACI, endereço e cidade da OM) antes de gerar: eles vão no termo e no parecer. Nome e sigla da unidade já vieram do Contratos.gov.br.</div>}
                {!contratos && !erro && <div className="rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-500">⏳ Buscando os contratos da UG {ug} no Contratos.gov.br (pode levar até 1 minuto)…</div>}
                {erro && <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">{erro} <button className="underline" onClick={() => { setErro(null); setTentativa((t) => t + 1); }}>Tentar de novo</button></div>}
                {contratos && (
                  <div className="rounded-xl border border-slate-200 bg-white p-3">
                    <div className="mb-2 flex flex-wrap items-center gap-2">
                      <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar por número, fornecedor, objeto ou processo"
                        className="min-w-0 flex-1 rounded-lg border border-slate-300 px-3 py-1.5 text-sm" aria-label="Buscar contrato" />
                      <span className="text-xs text-slate-500">{lista.length} de {contratos.length} contratos ativos</span>
                    </div>
                    {!contratos.length && <p className="p-4 text-sm text-slate-500">A UG {ug} não tem contratos ativos no Contratos.gov.br.</p>}
                    <div className="overflow-x-auto">
                      <table className="w-full min-w-[720px] text-sm">
                        <thead className="bg-slate-50 text-left text-[11px] uppercase text-slate-500">
                          <tr><th className="px-2 py-2">Contrato</th><th className="px-2 py-2">Fornecedor e objeto</th><th className="px-2 py-2">Vigência até</th><th className="px-2 py-2 text-right">Valor global</th><th className="px-2 py-2">Cadastro</th></tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {lista.slice(0, 300).map((c) => {
                            const s = salvos[c.numero] as { situacao_cadastro?: string } | undefined;
                            return (
                              <tr key={c.id} className="cursor-pointer hover:bg-sky-50/60" onClick={() => setAberto(c)}>
                                <td className="px-2 py-2 font-medium text-sky-700">{c.numero}</td>
                                <td className="max-w-md px-2 py-2"><div className="truncate">{c.fornecedor?.nome}</div><div className="truncate text-xs text-slate-500">{c.objeto}</div></td>
                                <td className="px-2 py-2 text-xs">{data(c.vigencia_fim)}</td>
                                <td className="px-2 py-2 text-right text-xs">{brl(numBR(c.valor_global))}</td>
                                <td className="px-2 py-2 text-xs">{s ? (s.situacao_cadastro === "COMPLETO" ? <span className="text-emerald-700">✓ completo</span> : <span className="text-amber-700">pendente</span>) : <span className="text-slate-400">—</span>}</td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </div>
            )}
          </>
        )}
    </div>
  );
}
