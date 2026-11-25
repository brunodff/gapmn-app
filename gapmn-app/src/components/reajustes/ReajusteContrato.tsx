import { useEffect, useMemo, useState } from "react";
import { armazemBanco, type Armazem } from "../../lib/apostilamento/armazem";
import type { ContratoGov } from "../../lib/apostilamento/contratosGov";
import CompletarAutomatico from "./CompletarAutomatico";
import { motor } from "../../lib/apostilamento/motor";
import { buscarIndice, chaveIndice, periodoDoReajuste, SERIES_SGS, urlCalculadora } from "../../lib/apostilamento/indice";
import { acumuladoFgv, ehFgv, linksFgv } from "../../lib/apostilamento/indiceFgv";
import { tabelaDaFgv } from "../../lib/apostilamento/fgvApi";
import { ITENS_CHECKLIST, avisosChecklist, checklistIniciado, marcar, normalizarChecklist } from "../../lib/apostilamento/checklist";
import { completarReajustesDevidos, dadosIniciais, itensColados, paraMotor, reajustesAplicados, type ContratoScon } from "../../lib/apostilamento/cadastro";
import { motivoForaDaAutomacao, pendenciasCadastro, proximoApostilamento, situacaoCadastro, type CargaGuardada, type FonteDataBase } from "../../lib/apostilamento/carga";
import type { ConfigApostilamento, DadosReajuste, ItemContrato, MarcacaoChecklist, ResultadoChecagem, ResultadoGeracao } from "../../lib/apostilamento/tipos";
import { Caixa, Campo, CampoNumero, Secao, brl } from "./campos";
import { acharUnidade, configDaUnidade, configSemCadastro, pendenciasUnidade, type UnidadeApoiada } from "../../lib/apostilamento/unidades";
import { baixarPrint, guardarPrint } from "../../lib/apostilamento/prints";

type UltimaNE = { ne: string; pi: string; unidade: string } | null;
type Props = {
  contrato: ContratoScon;
  config: ConfigApostilamento;
  nomeUsuario: string;
  ultimaNE: UltimaNE;
  aoVoltar: () => void;
  aoSalvar: (r: { numero_contrato: string; data_base: string; reajustes_aplicados: number; dedicacao_exclusiva: boolean; atualizado_em: string;
    situacao_cadastro: string; pendencias: string[] }) => void;
  /** onde o cadastro fica: no banco (GAP-MN, padrão) ou no navegador (outras OMs) */
  armazem?: Armazem;
  /** UG no Contratos.gov.br para completar o cadastro (GAP-MN = 120630); sem ela, o botão não aparece */
  ugGov?: string;
  contratoGov?: ContratoGov;
  /** valores para o primeiro cadastro (outras OMs: sigla e nome da OM) */
  padroes?: Partial<DadosReajuste>;
  /** unidades apoiadas (GAP-MN): os documentos usam o cadastro da OM que assina o contrato; sem a lista, vale `config` */
  unidades?: UnidadeApoiada[];
  /** abre Configurações com o formulário da unidade (OM signatária sem cadastro) */
  aoCadastrarUnidade?: (sigla: string) => void;
  /** vindo do termo aditivo ("Fazer o reajuste no módulo Reajustes"): instrumento Termo Aditivo com este nº */
  taPedido?: number | null;
};

const INDICES = ["IPCA", "INPC", "IGP-M", "IGP-DI", "IPCA-E", "INCC"];
const ICONE = { OK: "✅", ATENCAO: "⚠️", FALTA: "❌" } as const;

/** Valor para a Calculadora: total dos itens corrigido pelos reajustes anteriores (como no print da SCON). */
function valorParaCalculadora(d: DadosReajuste, n: number): number {
  let v = (d.itens ?? []).reduce((s, it) => s + (it.valor_base ?? 0), 0);
  for (const r of d.reajustes) if (r.n < n && r.indice_pct != null) v = Math.round(v * (1 + r.indice_pct / 100) * 100) / 100;
  return v;
}

/** Percentual com as casas da fonte: 6 na Calculadora do Cidadão, 2 na tabela da FGV (INCC) */
const casasDoIndice = (nome: string) => (ehFgv(nome) ? 2 : 6);
const pct = (v: number, casas: number) => v.toLocaleString("pt-BR", { minimumFractionDigits: casas, maximumFractionDigits: casas });

/** Busca o índice dos reajustes pedidos agora que ainda estão sem percentual: INCC na tabela anual da FGV (pela
 *  ponte da Cloudflare), os demais no Banco Central (os que não estão no SGS, como o IPCA-E, continuam digitados). */
async function indicesFaltando(d: DadosReajuste): Promise<{ dados: DadosReajuste; achados: string[]; avisos: string[]; fonte: string }> {
  const achados: string[] = [], avisos: string[] = [];
  const fgv = ehFgv(d.indice.nome);
  const fonte = fgv ? "da FGV" : "do BCB";
  const faltam = d.reajustes.filter((r) => r.novo && r.indice_pct == null);
  if (!faltam.length || !/^\d{2}\/\d{4}$/.test(d.data_base) || !d.indice.nome) return { dados: d, achados, avisos, fonte };
  if (!fgv && !SERIES_SGS[chaveIndice(d.indice.nome)]) {
    avisos.push(`O ${d.indice.nome} não está no Banco Central: digite o índice e anexe o print da fonte.`);
    return { dados: d, achados, avisos, fonte };
  }
  let reajustes = d.reajustes;
  for (const r of faltam) {
    const per = periodoDoReajuste(d.data_base, r.n);
    try {
      const res = fgv
        ? { ...(await acumuladoFgv(d.indice.nome, per.inicio, per.fim, tabelaDaFgv)), completo: true }
        : await buscarIndice(d.indice.nome, per.inicio, per.fim, valorParaCalculadora({ ...d, reajustes }, r.n));
      if (!res.completo) { avisos.push(`${r.n}º reajuste: o ${res.indice} de ${per.fim} ainda não saiu.`); continue; }
      reajustes = reajustes.map((x) => (x.n === r.n ? { ...x, indice_pct: res.percentual } : x));
      achados.push(`${r.n}º ${pct(res.percentual, casasDoIndice(d.indice.nome))}%`);
    } catch (e) {
      const m = e instanceof Error ? e.message : String(e);
      avisos.push(fgv ? `${r.n}º reajuste: não consegui o índice na FGV (${m}). Abra a consulta do índice, digite o percentual e anexe o print.`
        : `${r.n}º reajuste: não consegui o índice no Banco Central (${m}).`);
    }
  }
  return { dados: { ...d, reajustes }, achados, avisos, fonte };
}

function baixar(arquivo: Blob, nome: string) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(arquivo);
  a.download = nome;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 30000);
}

/** Tela do reajuste de um contrato: cadastro (salvo no banco), índice do Banco Central ou da FGV (INCC), prints
 *  da consulta do índice, checklist do fiscal, quadro de checagem e geração dos documentos pelo motor da SCON. */
export default function ReajusteContrato({ contrato, config: configBase, nomeUsuario, ultimaNE, aoVoltar, aoSalvar, armazem = armazemBanco, ugGov, contratoGov, padroes, unidades, aoCadastrarUnidade, taPedido }: Props) {
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
  const [carga, setCarga] = useState<CargaGuardada | null>(null);

  // carrega o cadastro (ou começa pelo que o app já sabe do contrato) e deixa o reajuste pronto:
  // reajustes devidos hoje, nº do apostilamento pelos já assinados e índices do Banco Central
  useEffect(() => {
    let vivo = true;
    (async () => {
      const { registro: data, erro: error } = await armazem.carregar(contrato.numero_contrato);
      if (!vivo) return;
      if (error) setMsg({ ok: false, txt: `Não li o cadastro: ${error}` });
      const c = (data?.carga ?? null) as CargaGuardada | null;
      setCarga(c);
      const temCadastro = !!(data?.dados && Object.keys(data.dados).length);
      let base: DadosReajuste = temCadastro ? { ...dadosIniciais(contrato), ...(data!.dados as DadosReajuste) } : { ...dadosIniciais(contrato), ...padroes };
      if (temCadastro) { setDedicacao(!!data!.dedicacao_exclusiva); setVersao(data!.versao); }
      const feitos: string[] = [];
      const devidos = completarReajustesDevidos(base);
      if (devidos) { base = { ...base, reajustes: devidos }; feitos.push("reajustes devidos hoje incluídos"); }
      if (taPedido && (base.instrumento !== "Termo Aditivo" || base.numero_instrumento !== taPedido)) {
        base = { ...base, instrumento: "Termo Aditivo", numero_instrumento: taPedido };
        feitos.push(`instrumento Termo Aditivo nº ${taPedido} (pedido pelo termo aditivo)`);
      } else if (base.numero_instrumento == null && c?.documentos) {
        base = { ...base, numero_instrumento: proximoApostilamento(c.documentos) };
        feitos.push(`nº do apostilamento ${base.numero_instrumento} (pelos já assinados)`);
      }
      setD(base);
      // prints guardados dos reajustes pedidos agora (o parecer usa sem escolher de novo)
      if (!armazem.local) {
        const guardados = base.reajustes.filter((r) => r.novo && r.print);
        Promise.all(guardados.map(async (r) => [r.n, await baixarPrint(r.print!)] as const))
          .then((l) => { if (vivo && l.length) setPrints((p) => ({ ...Object.fromEntries(l), ...p })); })
          .catch((e) => vivo && setMsg({ ok: false, txt: e instanceof Error ? e.message : String(e) }));
      }
      if (!temCadastro || feitos.length) setAlterado(true);
      const r = await indicesFaltando(base);
      if (!vivo) return;
      if (r.achados.length) { setD((x) => (x ? { ...x, reajustes: r.dados.reajustes } : x)); setAlterado(true); feitos.push(`índice ${r.fonte}: ${r.achados.join("; ")}`); }
      if (feitos.length) setMsg({ ok: true, txt: `Preparado automaticamente: ${feitos.join(" · ")}. Confira e salve.` + (r.avisos.length ? ` ${r.avisos.join(" ")}` : "") });
      else if (r.avisos.length) setMsg({ ok: false, txt: r.avisos.join(" ") });
    })();
    // o Python começa a carregar já (na primeira vez demora)
    motor.iniciar().catch(() => undefined);
    return () => { vivo = false; };
  }, [contrato, armazem, padroes, taPedido]);

  const muda = (f: (x: DadosReajuste) => DadosReajuste) => { setD((x) => (x ? f(x) : x)); setAlterado(true); setChecagem(null); setSimulacao(null); };
  const set = <K extends keyof DadosReajuste>(k: K, v: DadosReajuste[K]) => muda((x) => ({ ...x, [k]: v }));
  // depois de completar pelo Contratos.gov.br ou pelos PDFs, faz o mesmo da abertura do contrato: inclui os
  // reajustes devidos hoje (a data-base pode ter acabado de chegar) e busca o índice (Banco Central ou FGV)
  async function aplicarAutomatico(novo: DadosReajuste) {
    const devidos = completarReajustesDevidos(novo);
    const base = devidos ? { ...novo, reajustes: devidos } : novo;
    muda(() => base);
    const r = await indicesFaltando(base);
    if (r.achados.length) setD((x) => (x ? { ...x, reajustes: r.dados.reajustes } : x));
    const feitos = [...(devidos ? ["reajustes devidos hoje incluídos"] : []), ...(r.achados.length ? [`índice ${r.fonte}: ${r.achados.join("; ")}`] : [])];
    if (feitos.length) setMsg({ ok: true, txt: `Preparado automaticamente: ${feitos.join(" · ")}. Confira e salve.` + (r.avisos.length ? ` ${r.avisos.join(" ")}` : "") });
    else if (r.avisos.length) setMsg({ ok: false, txt: r.avisos.join(" ") });
  }

  // OM que assina (a "OM do Ordenador") → cadastro da unidade apoiada; sem cadastro, campos em branco (nunca os do GAP-MN)
  const omAssina = d?.om_ordenador || d?.ordenador?.om_sigla || configBase.ordenador.om_sigla || "GAP-MN";
  const unidade = unidades ? acharUnidade(unidades, omAssina) : null;
  const config = useMemo(() => (!unidades ? configBase : unidade ? configDaUnidade(unidade, omAssina, configBase.dias_alerta) : configSemCadastro(omAssina, configBase.dias_alerta)),
    [unidades, unidade, omAssina, configBase]);
  const totalItens = useMemo(() => (d?.itens ?? []).reduce((s, it) => s + (it.valor_base ?? 0), 0), [d?.itens]);
  const temTextoFixo = !!config.textos_fixos_om[omAssina];
  // fora da automação: dedicação exclusiva (repactuação) ou a carga do SILOMS diz que não há reajuste por índice
  const motivoFora = motivoForaDaAutomacao(carga?.siloms, dedicacao);
  // pendências para gerar (mesma regra da importação da carga), recalculadas a cada mudança
  const pendencias = useMemo(() => (d ? pendenciasCadastro(d, { dedicacao: !!motivoFora, textosFixos: config.textos_fixos_om, omPadrao: config.ordenador.om_sigla || "GAP-MN" }) : []),
    [d, motivoFora, config]);
  const novos = (d?.reajustes ?? []).filter((r) => r.novo);
  const printsNovos = novos.map((r) => prints[r.n]).filter((f): f is File => !!f);

  if (!d) return <div className="p-6 text-sm text-slate-500">Carregando o contrato…</div>;

  const fgv = ehFgv(d.indice.nome);
  const casas = casasDoIndice(d.indice.nome);
  const ck = normalizarChecklist(d.checklist);
  const comChecklist = checklistIniciado(d.checklist);
  const avisosCk = avisosChecklist(d.checklist);
  // o checklist não mexe nos valores: não apaga a checagem nem a conferência
  const mudaChecklist = (l: MarcacaoChecklist[]) => { setD((x) => (x ? { ...x, checklist: l } : x)); setAlterado(true); };
  const nDocs = (d.instrumento.toLowerCase().startsWith("termo aditivo") ? 3 : 4) + (comChecklist ? 1 : 0);

  async function salvar() {
    if (!d) return;
    setOcupado("Salvando…"); setMsg(null);
    const linha = {
      numero_contrato: contrato.numero_contrato, dados: d, reajustes_aplicados: reajustesAplicados(d), dedicacao_exclusiva: dedicacao,
      situacao_cadastro: situacaoCadastro(pendencias, !!motivoFora), pendencias, atualizado_em: new Date().toISOString(),
    };
    const r = await armazem.salvar(linha, versao, nomeUsuario);
    const erro = r.erro ?? null;
    if (r.versao != null) setVersao(r.versao);
    setOcupado(null);
    if (erro) { setMsg({ ok: false, txt: `Não salvou: ${erro}` }); return; }
    setAlterado(false);
    setMsg({ ok: true, txt: armazem.local ? "Cadastro salvo neste navegador." : "Cadastro salvo." });
    aoSalvar({ numero_contrato: linha.numero_contrato, data_base: d.data_base, reajustes_aplicados: linha.reajustes_aplicados, dedicacao_exclusiva: dedicacao,
      atualizado_em: linha.atualizado_em, situacao_cadastro: linha.situacao_cadastro, pendencias });
  }

  /** Print da consulta do índice: vale na hora e fica guardado com o reajuste (salvando o cadastro) */
  async function escolherPrint(i: number, n: number, f: File | undefined) {
    setPrints((p) => { const q = { ...p }; if (f) q[n] = f; else delete q[n]; return q; });
    if (!f || armazem.local) return;
    try {
      const ref = await guardarPrint(contrato.numero_contrato, n, f);
      muda((x) => ({ ...x, reajustes: x.reajustes.map((y, j) => (j === i ? { ...y, print: ref } : y)) }));
      setMsg({ ok: true, txt: `Print do ${n}º reajuste guardado. Salve o cadastro para ele ficar ligado a este reajuste.` });
    } catch (e) { setMsg({ ok: false, txt: `${e instanceof Error ? e.message : String(e)}` }); }
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
    const r = await rodar("Gerando os documentos…", (p) => motor.gerar(paraMotor(d), config, printsNovos, p, comChecklist ? ck : undefined));
    if (!r) return;
    setSimulacao(r);
    baixar(r.zip, `Apostilamento - CT ${contrato.numero_contrato.replace(/\//g, "-")}.zip`);
    setMsg({ ok: true, txt: `Documentos gerados: ${r.arquivos.length} arquivos no .zip baixado.` });
  }

  /** Só o checklist do fiscal (.docx), sem gerar os outros documentos de novo; os avisos não impedem */
  async function gerarChecklist() {
    if (!d) return;
    const r = await rodar("Gerando o checklist…", (p) => motor.checklist(paraMotor(d), config, ck, p));
    if (!r) return;
    baixar(r.docx, r.arquivo);
    setMsg({ ok: !r.avisos.length, txt: `Checklist gerado: ${r.arquivo}.` + (r.avisos.length ? ` Confira: ${r.avisos.join(" ")}` : "") });
  }

  /** Índice de um reajuste: INCC na tabela anual da FGV; os demais no Banco Central, como a Calculadora */
  async function buscarNaFonte(idx: number) {
    const r = d!.reajustes[idx];
    if (!/^\d{2}\/\d{4}$/.test(d!.data_base)) { setMsg({ ok: false, txt: "Informe a data do orçamento (MM/AAAA) antes." }); return; }
    if (!d!.indice.nome) { setMsg({ ok: false, txt: "Informe o índice do contrato antes." }); return; }
    const per = periodoDoReajuste(d!.data_base, r.n);
    const usar = (v: number) => muda((x) => ({ ...x, reajustes: x.reajustes.map((y, i) => (i === idx ? { ...y, indice_pct: v } : y)) }));
    setBuscandoIdx(idx); setMsg(null);
    try {
      if (fgv) {
        const res = await acumuladoFgv(d!.indice.nome, per.inicio, per.fim, tabelaDaFgv);
        usar(res.percentual);
        setMsg({ ok: true, txt: `${res.indice} ${per.inicio} a ${per.fim}: ${pct(res.percentual, 2)}% (tabela da FGV, linha ${res.linha_tabela}, Acumulado 12 meses). Confira e anexe o print da tabela.` });
        return;
      }
      const res = await buscarIndice(d!.indice.nome, per.inicio, per.fim, valorParaCalculadora(d!, r.n));
      usar(res.percentual);
      setMsg({ ok: res.completo, txt: res.completo
        ? `${res.indice} ${per.inicio} a ${per.fim}: ${pct(res.percentual, 6)}% (${res.meses} meses, como na Calculadora). Confira e anexe o print da Calculadora.`
        : `${res.indice} ${per.inicio} a ${per.fim}: só ${res.meses} meses divulgados — o índice do último mês ainda não saiu.` });
    } catch (e) {
      const m = e instanceof Error ? e.message : String(e);
      setMsg({ ok: false, txt: fgv ? `Não consegui o índice na FGV: ${m}. Abra a consulta do índice e digite o percentual da tabela.` : m });
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

      {unidades && (unidade
        ? <div className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-xs text-slate-600">
            Dados da contratante: <b>cadastro {unidade.sigla}</b>{unidade.atualizado_em ? ` (atualizado em ${new Date(unidade.atualizado_em).toLocaleDateString("pt-BR")}${unidade.atualizado_nome ? ` por ${unidade.atualizado_nome}` : ""})` : ""} — Ordenador, ACI, unidade de apoio e texto fixo vêm de Configurações.
            {pendenciasUnidade(unidade).length > 0 && <span className="text-amber-700"> Falta no cadastro: {pendenciasUnidade(unidade).join(", ")}.</span>}
          </div>
        : <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-2 text-xs text-amber-800">
            A OM signatária <b>{omAssina}</b> não está cadastrada em Configurações – cadastre antes de gerar os documentos (sem cadastro, o Ordenador, o ACI e a unidade de apoio saem em branco).
            {aoCadastrarUnidade && <button className="ml-2 rounded-md border border-amber-300 bg-white px-2 py-0.5 font-medium text-amber-800 hover:bg-amber-100" onClick={() => aoCadastrarUnidade(omAssina)}>Cadastrar esta unidade</button>}
          </div>)}

      {motivoFora && !dedicacao && (
        <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-2 text-xs text-slate-700">
          A carga do SILOMS marca este contrato sem reajuste por índice: <b>{motivoFora}</b>. Ele fica fora do painel de reajustes;
          se mesmo assim houver reajuste por índice, preencha e gere normalmente.
        </div>
      )}
      {!motivoFora && (pendencias.length
        ? <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-800">
            <b>Faltam {pendencias.length} dado{pendencias.length > 1 ? "s" : ""} para gerar os documentos:</b>
            <ul className="mt-1 list-disc pl-5 columns-1 md:columns-2">{pendencias.map((p, i) => <li key={i}>{p}</li>)}</ul>
          </div>
        : <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-2 text-xs text-emerald-700">✓ Cadastro completo: confira o quadro de checagem e gere os documentos.</div>)}

      {ugGov && !dedicacao && (
        <CompletarAutomatico numero={contrato.numero_contrato} pag={contrato.pag_nup} inicio={(contrato as ContratoScon & { data_inicio?: string | null }).data_inicio ?? null}
          ug={ugGov} contratoGov={contratoGov} dados={d} aplicar={(novo) => void aplicarAutomatico(novo)} ugApoioNome={config.ug_apoio.nome} ugApoioSigla={config.ug_apoio.sigla} />
      )}

      {carga && <QuadroCarga carga={carga} />}

      <Secao titulo="1. Contrato">
        <div className="grid md:grid-cols-3 gap-3">
          <Campo rotulo="NUP / PAG" valor={d.nup} onChange={(v) => set("nup", v)} />
          <Campo rotulo="OM contratante (sigla, vai no cabeçalho)" valor={d.om_contratante_sigla} onChange={(v) => set("om_contratante_sigla", v)} dica="sugerida pelo número do contrato — confira (ex.: 2º GDAAE)" />
          <Campo rotulo="OM contratante (nome por extenso)" valor={d.om_contratante_nome} onChange={(v) => set("om_contratante_nome", v)} placeholder="2º GRUPO DE DEFESA ANTIAÉREA" />
          <Campo rotulo="OM do Ordenador que assina" valor={d.om_ordenador ?? ""} onChange={(v) => set("om_ordenador", v.toUpperCase())} placeholder={configBase.ordenador.om_sigla || "GAP-MN"} dica={unidades ? "vazio = a unidade padrão; o cadastro da OM vem de Configurações" : "vazio = a da configuração"} />
          <Campo rotulo="Cabeçalho do termo (nome da OM que assina)" valor={d.termo_om_nome ?? ""} onChange={(v) => set("termo_om_nome", v)} placeholder={config.ug_apoio.nome} dica="vazio = o da unidade de apoio (Configurações)" />
        </div>
        {d.ordenador?.nome
          ? <div className="mt-3 rounded-lg bg-sky-50 px-3 py-2 text-xs text-sky-800">
              Assina pelo contratante: <b>{[d.ordenador.posto, d.ordenador.nome].filter(Boolean).join(" ")}</b> — {d.ordenador.funcao_assinatura || `Ordenador de Despesas do ${d.ordenador.om_sigla ?? omAssina}`}
              {d.aci?.funcao ? <> · controle interno: {d.aci.funcao}</> : null} (dados do contrato, vindos da carga).{" "}
              <button className="text-sky-700 underline" onClick={() => muda((x) => { const y = { ...x }; delete y.ordenador; delete y.aci; return y; })}>usar o Ordenador e o ACI da configuração</button>
            </div>
          : <p className="mt-2 text-[11px] text-slate-400">Assinam o Ordenador e o ACI da configuração ({config.ordenador.om_sigla || "GAP-MN"}).</p>}
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
          {!d.empresa.representantes?.length && <Campo rotulo="Representante da empresa" valor={d.empresa.representante} onChange={(v) => set("empresa", { ...d.empresa, representante: v })} />}
        </div>
        {d.empresa.representantes?.length
          ? <div className="mt-2 space-y-1">
              <span className="block text-[11px] font-medium text-slate-600">Representantes da empresa (todos assinam o termo)</span>
              {d.empresa.representantes.map((r, i) => (
                <div key={i} className="flex items-center gap-2">
                  <input className={`${cel} flex-1`} value={r.nome} placeholder="Nome do representante"
                    onChange={(e) => set("empresa", repsComo(d.empresa, d.empresa.representantes!.map((x, j) => (j === i ? { ...x, nome: e.target.value } : x))))} />
                  <label className="text-xs text-slate-600 flex items-center gap-1"><input type="checkbox" checked={!!r.feminino}
                    onChange={(e) => set("empresa", repsComo(d.empresa, d.empresa.representantes!.map((x, j) => (j === i ? { ...x, feminino: e.target.checked } : x))))} /> feminino</label>
                  <button className="text-red-400 text-xs" onClick={() => set("empresa", repsComo(d.empresa, d.empresa.representantes!.filter((_, j) => j !== i)))}>✕</button>
                </div>
              ))}
              <button className="text-xs text-sky-700 hover:underline" onClick={() => set("empresa", repsComo(d.empresa, [...d.empresa.representantes!, { nome: "", feminino: false }]))}>+ representante</button>
            </div>
          : <div className="flex flex-wrap items-center gap-4">
              <Caixa rotulo="Representante do sexo feminino" marcado={!!d.empresa.representante_feminino} onChange={(v) => set("empresa", { ...d.empresa, representante_feminino: v })} />
              <button className="text-xs text-sky-700 hover:underline mt-2" onClick={() => set("empresa", repsComo(d.empresa,
                [{ nome: d.empresa.representante, feminino: !!d.empresa.representante_feminino }, { nome: "", feminino: false }]))}>+ outro representante</button>
            </div>}
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
          <label className="block">
            <span className="block text-[11px] font-medium text-slate-600 mb-0.5">Fator do unitário</span>
            <CampoNumero valor={d.fator_anual ?? null} casas={0} className="w-24" placeholder={d.base === "MENSAL" ? "1" : d.base === "ANUAL" ? "12" : ""}
              onChange={(v) => muda((x) => { const y = { ...x }; if (v == null) delete y.fator_anual; else y.fator_anual = v; return y; })} />
            <span className="block text-[10px] text-slate-400 mt-0.5">conferência: item = unitário × qtd × fator (preço por unidade = 1)</span>
          </label>
          <div className="pt-4"><Caixa rotulo="Mostrar a coluna de valor unitário na memória" marcado={d.mostrar_unitario} onChange={(v) => set("mostrar_unitario", v)} /></div>
        </div>
        <table className="w-full text-xs mt-3">
          <thead className="text-slate-500"><tr><th className="text-left py-1">Reajuste</th><th className="text-left">Período (12 índices)</th><th className="text-left">Índice (%)</th><th className="text-left">Situação</th><th className="text-left">Print da consulta do índice</th><th /></tr></thead>
          <tbody>
            {d.reajustes.map((r, i) => {
              const per = /^\d{2}\/\d{4}$/.test(d.data_base) ? periodoDoReajuste(d.data_base, r.n) : null;
              // INCC: tabela anual da FGV já rolada até o acumulado; os demais: Calculadora do Cidadão já preenchida
              const lf = per && fgv ? linksFgv(d.indice.nome, per.inicio, per.fim) : null;
              const link = lf ? lf.url_print : per && d.indice.nome ? urlCalculadora(d.indice.nome, per.inicio, per.fim, valorParaCalculadora(d, r.n)) : null;
              return (
                <tr key={i} className="border-t border-slate-100 align-top">
                  <td className="py-1.5 font-medium">{r.n}º</td>
                  <td className="py-1.5 text-slate-600">{per ? `${per.inicio} a ${per.fim} · efeitos 01/${per.aniversario}` : "–"}</td>
                  <td className="py-1.5">
                    <CampoNumero valor={r.indice_pct} casas={casas} className="w-28" onChange={(v) => muda((x) => ({ ...x, reajustes: x.reajustes.map((y, j) => (j === i ? { ...y, indice_pct: v } : y)) }))} />
                    {r.novo && <button disabled={buscandoIdx != null} onClick={() => buscarNaFonte(i)} className="ml-2 text-sky-700 hover:underline disabled:opacity-40">{buscandoIdx === i ? "buscando…" : fgv ? "Buscar na FGV" : "Buscar no Banco Central"}</button>}
                  </td>
                  <td className="py-1.5">
                    <select className={cel} value={r.novo ? "novo" : "aplicado"} onChange={(e) => muda((x) => ({ ...x, reajustes: x.reajustes.map((y, j) => (j === i ? { ...y, novo: e.target.value === "novo" } : y)) }))}>
                      <option value="novo">Pedido agora</option><option value="aplicado">Já aplicado</option>
                    </select>
                    {!r.novo && <input className={`${cel} ml-1 w-44`} placeholder="Documento (ex.: 1º Termo de Apostilamento)" value={r.documento ?? ""} onChange={(e) => muda((x) => ({ ...x, reajustes: x.reajustes.map((y, j) => (j === i ? { ...y, documento: e.target.value } : y)) }))} />}
                  </td>
                  <td className="py-1.5">
                    {r.novo && <>
                      <input type="file" accept="image/png,image/jpeg" className="text-[11px] w-48" onChange={(e) => void escolherPrint(i, r.n, e.target.files?.[0])} />
                      {prints[r.n] && <span className="block text-[10px] text-emerald-700">✓ {prints[r.n].name}{r.print ? " (guardado)" : ""}</span>}
                      {link && <a href={link} target="_blank" rel="noreferrer" className="block text-sky-700 hover:underline">{lf ? "Abrir consulta do índice (FGV) ↗" : "abrir a Calculadora já preenchida ↗"}</a>}
                      {lf && <span className="block text-[10px] text-slate-500">linha {lf.linha_tabela}, coluna Acumulado 12 meses ·{" "}
                        <a href={lf.url_google} target="_blank" rel="noreferrer" className="text-sky-700 hover:underline">não abriu? buscar no Google</a></span>}
                    </>}
                  </td>
                  <td className="py-1.5 text-right"><button className="text-red-400 hover:text-red-600" onClick={() => muda((x) => ({ ...x, reajustes: x.reajustes.filter((_, j) => j !== i) }))}>✕</button></td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <button className="mt-2 text-xs text-sky-700 hover:underline" onClick={() => muda((x) => ({ ...x, reajustes: [...x.reajustes, { n: (x.reajustes.reduce((m, r) => Math.max(m, r.n), 0) || 0) + 1, indice_pct: null, novo: true }] }))}>+ reajuste</button>
        <p className="text-[11px] text-slate-400 mt-1">Os já aplicados vêm antes dos pedidos agora. Os prints (um por reajuste pedido) vão como anexo do parecer e ficam guardados com o cadastro (salve depois de anexar): o Parecer Técnico do termo aditivo usa o mesmo print.
          {fgv && " INCC: vale o \"Acumulado 12 meses\" da linha do último mês do período, com 2 casas, como na tabela da FGV."}</p>
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

      <Secao titulo="8. Checklist do Fiscal (lista de verificação de documentos)"
        direita={<button onClick={gerarChecklist} disabled={!!ocupado} className="text-xs text-sky-700 hover:underline disabled:opacity-40">Gerar só o checklist (.docx)</button>}>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="text-slate-500"><tr>
              <th className="text-left py-1 w-8">Nº</th><th className="text-left">Item</th><th className="w-12">SIM</th><th className="w-12">NÃO</th>
              <th className="text-left w-[34%]">Observação / justificativa</th>
            </tr></thead>
            <tbody>
              {ck.map((m, i) => (
                <tr key={i} className="border-t border-slate-100">
                  <td className="py-1.5 text-slate-500">{i + 1}</td>
                  <td className="py-1.5 pr-2 text-slate-700">{ITENS_CHECKLIST[i]}</td>
                  <td className="text-center"><input type="checkbox" aria-label={`Item ${i + 1}: SIM`} checked={m.sim} onChange={(e) => mudaChecklist(marcar(ck, i, "sim", e.target.checked))} /></td>
                  <td className="text-center"><input type="checkbox" aria-label={`Item ${i + 1}: NÃO`} checked={m.nao} onChange={(e) => mudaChecklist(marcar(ck, i, "nao", e.target.checked))} /></td>
                  <td className="py-1"><input className={`${cel} w-full disabled:cursor-not-allowed disabled:opacity-40`} disabled={!m.nao} placeholder="Justificativa (se NÃO)" value={m.obs}
                    onChange={(e) => mudaChecklist(ck.map((x, j) => (j === i ? { ...x, obs: e.target.value } : x)))} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {comChecklist && avisosCk.length > 0 && <p className="mt-2 text-[11px] text-amber-700">{avisosCk.join(" · ")}</p>}
        <p className="mt-1 text-[11px] text-slate-400">
          Marcado algum item, o checklist vai no .zip como "5 - Checklist do Fiscal" (as justificativas dos itens NÃO saem na Observação).
          Fica salvo com o cadastro. Os avisos não impedem gerar.
        </p>
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
            {simulacao.resumo.reajustes.map((r) => <li key={r.n}>{r.n}º reajuste {r.novo ? "(pedido agora)" : "(já aplicado)"}: {r.inicio} a {r.fim}, {pct(r.indice_pct, casas)}%, efeitos {r.efeitos}</li>)}
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
            Gerar os {nDocs} documentos (.zip){novos.length ? ` · ${printsNovos.length}/${novos.length} prints` : ""}
          </button>
          {ocupado && <span className="text-xs text-slate-500 animate-pulse">{ocupado}</span>}
          {!ocupado && msg && <span className={`text-xs ${msg.ok ? "text-emerald-700" : "text-red-600"}`}>{msg.txt}</span>}
        </div>
      </div>
    </div>
  );
}

/** Empresa com a lista de representantes; o 1º também fica em "representante" (campo antigo do motor).
 *  Lista vazia volta ao representante único. */
function repsComo(emp: DadosReajuste["empresa"], reps: { nome: string; feminino?: boolean }[]): DadosReajuste["empresa"] {
  const e = { ...emp };
  if (!reps.length) { delete e.representantes; return e; }
  return { ...e, representantes: reps, representante: reps[0].nome, representante_feminino: !!reps[0].feminino };
}

/** De onde a SCON tirou a data do orçamento; as marcadas para conferir vieram de documento indireto
 *  (mesmo pregão, ciclo de reajustes ou proposta) e precisam ser vistas antes de assinar */
function FonteData({ f }: { f: FonteDataBase }) {
  const conferir = f.conferir === true || /^(sim|s|true|1)$/i.test(String(f.conferir ?? ""));
  const partes = [f.fonte, f.documento, f.subprocesso != null && f.subprocesso !== "" ? `subprocesso ${f.subprocesso}` : ""].filter(Boolean);
  return (
    <div className={conferir ? "text-amber-700" : ""}>
      Data do orçamento achada em: {partes.join(" · ") || "–"}{conferir && <b> — ⚠ conferir antes de assinar</b>}
      {f.trecho && <span className="block italic text-slate-500">“{f.trecho}”</span>}
    </div>
  );
}

/** O que veio da carga do SILOMS: dados da tela do contrato, documentos assinados e último empenho */
function QuadroCarga({ carga }: { carga: CargaGuardada }) {
  const s = carga.siloms ?? {};
  const ne = carga.ultimo_empenho ?? {};
  const docs = carga.documentos ?? [];
  return (
    <div className="rounded-xl border border-slate-200 bg-white px-4 py-3 text-xs text-slate-600 space-y-1">
      <div><b className="text-slate-700">Carga do SILOMS de {carga.atualizado_em ?? carga.gerado_em ?? "?"}</b>
        {carga.fora_da_carga && <span className="ml-2 text-amber-700">· não veio na última carga (contrato saiu da lista de ativos?)</span>}</div>
      <div>{[s.numero_oficial, s.codigo ? `código ${s.codigo}` : "", s.pag ? `PAG ${s.pag}` : "",
        s.vigencia_inicio ? `vigência ${s.vigencia_inicio} a ${s.vigencia_fim ?? "?"}` : "", s.vigencia_vencida_no_siloms ? "vencida no SILOMS" : ""].filter(Boolean).join(" · ")}</div>
      {!!docs.length && (
        <div>Documentos assinados: {docs.map((x) => [x.numero || x.tipo, x.data_assinatura, x.valor_resultante != null ? brl(x.valor_resultante) : ""].filter(Boolean).join(" ")).join(" · ")}</div>
      )}
      {!!(ne.ne || ne.fonte_dos_dados) && <div>Último empenho: {[ne.ne, ne.data, ne.fonte_dos_dados].filter(Boolean).map(String).join(" · ")}</div>}
      {carga.data_base_fonte && <FonteData f={carga.data_base_fonte} />}
      {!!carga.avisos?.length && (
        <div className="text-amber-700">A coleta pede para conferir: <ul className="list-disc pl-5">{carga.avisos.map((a, i) => <li key={i}>{a}</li>)}</ul></div>
      )}
      {carga.coleta?.etapa && carga.coleta.etapa !== "COMPLETO" && <div className="text-amber-700">Coleta da SCON ainda na etapa "{carga.coleta.etapa}": os documentos do contrato não foram lidos.</div>}
    </div>
  );
}
