import { useEffect, useMemo, useRef, useState } from "react";
import { Caixa, Campo, CampoNumero, Secao } from "../reajustes/campos";
import {
  aditivosAssinados, alertasDoAditivo, alteracoes, analisarPareceres, brl, citarPareceres, daBiblioteca, eCefa, ementaDoParecer, faltandoNoZip, fimPrevisto,
  fraseObjetoVantajosidade, fraseObservacaoParecer, geradosPrevistos, incisosVantajosidade, itensDaLista, numero, objetoDaFicha, pareceresDoAditivo,
  limparObjeto, pareceresSugeridos, passa1Milhao, valorNovo, AUTORIDADE_CEFA, GERADOS_PELO_SITE, NOMES, SUGESTOES_VANTAJOSIDADE, type AguParecer,
} from "../../lib/aditivos/regras";
import { bytesDeBase64, carregarAditivo, consultaAutomatica, omDaUnidade, parecerDoCadastro, pareceresAgu, salvarAditivo, cadastroReajuste } from "../../lib/aditivos/dados";
import { kitAditivo, type DocumentoGerado } from "../../lib/aditivos/kitAditivo";
import { ALTERACOES, NATUREZAS, type Alteracao, type AnexoGuardado, type DadosAditivo, type EstadoAditivo, type ParecerReferencial, type RegistroAditivo, type Vantajosidade } from "../../lib/aditivos/tipos";
import MapaRiscos from "./MapaRiscos";
import { Regularidade, Sicaf } from "./Consultas";
import { anexosVazios, apagarAnexos, baixarAnexo, guardarAnexo, type AnexosConsultas, type Arquivo } from "../../lib/aditivos/anexos";
import { MemoriaAditivo, PesquisaAditivo } from "./PesquisaMemoria";
import { acharUnidade, type UnidadeApoiada } from "../../lib/apostilamento/unidades";
import { carregarUnidades } from "../../lib/apostilamento/unidadesBanco";
import { baixarPrint } from "../../lib/apostilamento/prints";
import type { DadosReajuste } from "../../lib/apostilamento/tipos";
import { alertasParecer } from "../../lib/aditivos/parecer";
import ParecerTecnico from "./ParecerTecnico";

/** Itens da Lista que o fiscal junta como PDF (anuência, parecer técnico, procuração…): os outros o site gera ou têm tela própria */
const ITENS_COM_TELA = ["sicaf", "consulta_cnpj", "consulta_cpf_socio", "memoria_calculo", "bol_aci", "bol_od", "bol_fiscalizacao", "calculadora"];
const anexavel = (chave: string) => !chave.startsWith("parecer_referencial") && !GERADOS_PELO_SITE.includes(chave) && !ITENS_COM_TELA.includes(chave);

const hojeISO = () => new Date(Date.now() - 4 * 3600e3).toISOString().slice(0, 10);
const botao = "rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50";
const primario = "rounded-lg bg-sky-600 px-4 py-2 text-sm font-semibold text-white hover:bg-sky-700 disabled:opacity-50";
const sel = "w-full rounded-lg border border-slate-200 px-2 py-1.5 text-sm outline-none";
const baixarBlob = (b: Blob, nome: string) => { const u = URL.createObjectURL(b); const l = document.createElement("a"); l.href = u; l.download = nome; l.click(); setTimeout(() => URL.revokeObjectURL(u), 5000); };

export default function AditivoContrato({ id, usuario, onVoltar, onAbrir }: { id: string; usuario: string | null; onVoltar: () => void; onAbrir: (link: string) => void }) {
  const [reg, setReg] = useState<RegistroAditivo | null>(null);
  const [d, setD] = useState<DadosAditivo | null>(null);
  const [e, setE] = useState<EstadoAditivo | null>(null);
  const [sujo, setSujo] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; txt: string } | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [agu, setAgu] = useState<AguParecer[]>([]);
  const [unidades, setUnidades] = useState<UnidadeApoiada[] | null>(null);
  const [anexos, setAnexos] = useState<AnexosConsultas>(anexosVazios());
  const [memoria, setMemoria] = useState<Arquivo | null>(null);
  /** PDFs dos itens da Lista que o fiscal junta (anuência, parecer técnico, procuração…), por chave */
  const [listaArq, setListaArq] = useState<Record<string, Arquivo[]>>({});
  const [restaurando, setRestaurando] = useState(false);
  const [indiceContrato, setIndiceContrato] = useState("");
  /** cadastro do contrato nos Reajustes (histórico, itens, cláusulas, documentos assinados e prints da Calculadora) */
  const [cad, setCad] = useState<{ dados: DadosReajuste | null; carga: Record<string, unknown> | null } | null>(null);
  const [printsCad, setPrintsCad] = useState<Arquivo[]>([]);
  const [geracao, setGeracao] = useState<{ docs: Record<string, DocumentoGerado>; zip: Blob; nome: string; faltando: string[] } | null>(null);
  const hoje = hojeISO();

  useEffect(() => {
    let vivo = true;
    Promise.all([carregarAditivo(id), pareceresAgu(), carregarUnidades()]).then(([r, a, u]) => {
      if (!vivo) return;
      setReg(r); setD(r.dados); setE(r.estado); setAgu(a); setUnidades(u.unidades);
      void restaurarAnexos(r.estado, () => vivo);
      void cadastroReajuste(r.numero_contrato).then(async (c) => {
        if (!vivo) return;
        setCad(c); setIndiceContrato(c.dados?.indice?.nome ?? "");
        // aditivo iniciado antes da rev5.1: o Parecer Técnico começa com o que o cadastro tem (salva junto na próxima vez)
        if (!r.dados.historico) {
          const p = parecerDoCadastro(c.dados, c.carga as Record<string, unknown> | null);
          setD((x) => (x ? { ...x, contratada: x.contratada ?? p.contratada, objeto_resumido: x.objeto_resumido ?? p.objeto_resumido, historico: p.historico,
            itens: x.itens ?? p.itens, parecer_tecnico: { numero: null, natureza: "continuado", anexos: null, motivos: null, cronograma_escopo: [], ...p.parecer, ...(x.parecer_tecnico ?? {}) } } : x));
        }
        // prints da Calculadora guardados no módulo Reajustes (reajustes pedidos agora)
        const refs = (c.dados?.reajustes ?? []).filter((y) => y.novo && y.print).map((y) => y.print!);
        const arqs = await Promise.all(refs.map(async (p) => { try { const f = await baixarPrint(p); return { nome: f.name, bytes: await f.arrayBuffer() }; } catch { return null; } }));
        if (vivo) setPrintsCad(arqs.filter((x): x is Arquivo => !!x));
      }).catch(() => undefined);
    }).catch((x) => vivo && setErro(x instanceof Error ? x.message : String(x)));
    return () => { vivo = false; };
  }, [id]);

  const mudar = (f: (x: DadosAditivo) => DadosAditivo) => { setD((x) => (x ? f(x) : x)); setSujo(true); };
  const mudarE = (p: Partial<EstadoAditivo>) => { setE((x) => (x ? { ...x, ...p } : x)); setSujo(true); };

  // pareceres: seguem o catálogo da SCON conforme as alterações, a natureza e a lei, até a SCON editar a lista à mão
  const sugeridos = useMemo(() => (d && e ? pareceresSugeridos(alteracoes(d), e.natureza, e.lei, agu).map((p) => {
    const q: ParecerReferencial & { conferido?: boolean; url?: string | null } = { ...p };
    if (q.url && !daBiblioteca(q.numero)) q.pdf = q.url;
    delete q.conferido; delete q.url; return q as ParecerReferencial;
  }) : []), [d, e, agu]);
  const manuais = !!e?.pareceres_manuais;
  // o que vai ao kit: pareceres (sugeridos ou da SCON) e o objeto do contrato (Atestado e Declaração de Vantajosidade)
  const dx = useMemo(() => (d && e ? { ...d, objeto_contrato: e.objeto_contrato, lei: e.lei, ...(manuais ? {} : { pareceres_referenciais: sugeridos }) } : null), [d, e, manuais, sugeridos]);
  // prints da Calculadora: os trocados neste aditivo ou os do módulo Reajustes
  const printsEfetivos = listaArq.calculadora_prints?.length ? listaArq.calculadora_prints : printsCad;
  // nº do próximo TA = maior TA assinado + 1 (documentos da carga + histórico de valores)
  const ta = useMemo(() => (cad ? aditivosAssinados((cad.carga as { documentos?: { tipo?: string; numero?: string | null }[] } | null)?.documentos, cad.dados?.historico_valores) : null), [cad]);

  const unidadeOm = useMemo(() => (unidades && d ? acharUnidade(unidades, d.om_signataria.sigla) : null), [unidades, d]);
  const an = useMemo(() => (dx ? analisarPareceres(dx, hoje) : null), [dx, hoje]);
  const itens = useMemo(() => (dx ? itensDaLista(dx, hoje) : []), [dx, hoje]);
  const alertas = useMemo(() => (dx && e ? alertasDoAditivo(dx, e, hoje, { sicaf: anexos.sicaf.length > 0, regularidade: !!(anexos.consolidada || anexos.item13) },
    { unidadeCadastrada: unidades ? !!unidadeOm : null }).concat(alertasParecer(dx, printsEfetivos.length),
      ta && ta.numeros.length && dx.numero_aditivo !== ta.proximo ? [{ nivel: "atencao" as const, texto: `Nº do termo aditivo: pelos TAs já assinados (${ta.numeros.map((x) => `${x}º`).join(", ")}) o próximo é o ${ta.proximo}º, e este está como ${dx.numero_aditivo ?? "?"}º.`, secao: "contrato" }] : [],
      ta && ta.faltando.length ? [{ nivel: "info" as const, texto: `TA não localizado nos documentos nem no histórico: ${ta.faltando.map((x) => `${x}º`).join(", ")} (confira no SILOMS).`, secao: "contrato" }] : []) : []),
    [dx, e, hoje, anexos, unidades, unidadeOm, printsEfetivos, ta]);
  const bloqueios = alertas.filter((a) => a.bloqueia);
  // o .zip: o que o site gera + o que está anexado (memória da aba, restaurada do que ficou guardado no aditivo)
  const temArquivo = (c: string) => (dx ? geradosPrevistos(dx, hoje).includes(c) : false) || (c === "sicaf" && anexos.sicaf.length > 0)
    || (c === "consulta_cnpj" && !!(anexos.item13 || anexos.consolidada)) || (c === "consulta_cpf_socio" && anexos.socio.length > 0)
    || (c === "memoria_calculo" && !!memoria) || !!listaArq[c]?.length;
  const faltando = dx ? faltandoNoZip(dx, hoje, temArquivo) : [];

  // ── anexos guardados no aditivo (depósito aditivos-docs): cada anexo novo é enviado e o aditivo é salvo junto ──
  const refs = useRef<{ reg: RegistroAditivo | null; dx: DadosAditivo | null; e: EstadoAditivo | null; anexos: AnexosConsultas; fila: Promise<void> }>({ reg: null, dx: null, e: null, anexos: anexosVazios(), fila: Promise.resolve() });
  refs.current.reg = reg; refs.current.dx = dx; refs.current.e = e; refs.current.anexos = anexos;
  async function restaurarAnexos(est: EstadoAditivo, vivo: () => boolean) {
    const g = est.anexos ?? {};
    const i13 = est.anexos_item13 ?? {};
    if (!Object.keys(g).length && !i13.consolidada && !Object.keys(i13.complementos ?? {}).length) return;
    setRestaurando(true);
    // um arquivo que não abre não impede os outros: ele só fica de fora (e a tela avisa qual)
    const falhas: string[] = [];
    const um = async (a: AnexoGuardado | null | undefined) => { if (!a) return null; try { return await baixarAnexo(a); } catch { falhas.push(a.nome); return null; } };
    const varios = async (l?: AnexoGuardado[]) => (await Promise.all((l ?? []).map(um))).filter((x): x is Arquivo => !!x);
    const [sicaf, item13, consolidada, mem] = await Promise.all([varios(g.sicaf), um(g.consulta_cnpj?.[0]), um(i13.consolidada), um(g.memoria_calculo?.[0])]);
    const complementos: Record<string, Arquivo> = {};
    for (const [k, a] of Object.entries(i13.complementos ?? {})) { const x = await um(a); if (x) complementos[k] = x; }
    const outros: Record<string, Arquivo[]> = {};
    for (const [k, l] of Object.entries(g)) if (anexavel(k)) outros[k] = await varios(l);
    if (!vivo()) return;
    setAnexos((x) => ({ ...x, sicaf, item13, consolidada, complementos }));
    setMemoria(mem); setListaArq(outros); setRestaurando(false);
    if (falhas.length) setMsg({ ok: false, txt: `Não consegui abrir ${falhas.length} anexo(s) guardado(s): ${falhas.join(", ")}. Anexe de novo para irem no .zip.` });
  }
  /** Envia os arquivos novos, grava o estado novo no aditivo e tira do depósito os que foram trocados (uma tarefa por vez) */
  function guardarNoAditivo(tarefa: (g: Record<string, AnexoGuardado[]>, i13: NonNullable<EstadoAditivo["anexos_item13"]>, velhos: AnexoGuardado[], id: string) => Promise<void>) {
    refs.current.fila = refs.current.fila.then(async () => {
      const r0 = refs.current.reg, e0 = refs.current.e;
      if (!r0 || !e0) return;
      const g = { ...(e0.anexos ?? {}) };
      const i13 = { consolidada: e0.anexos_item13?.consolidada ?? null, complementos: { ...(e0.anexos_item13?.complementos ?? {}) } };
      const velhos: AnexoGuardado[] = [];
      try {
        await tarefa(g, i13, velhos, r0.id);
        const atual = refs.current;
        const r = await salvarAditivo(atual.reg ?? r0, atual.dx ?? r0.dados, { ...(atual.e ?? e0), anexos: g, anexos_item13: i13 }, usuario);
        // a próxima tarefa da fila parte do que acabou de ser salvo (sem esperar a tela redesenhar)
        refs.current.reg = r; refs.current.e = r.estado; refs.current.dx = r.dados;
        setReg(r); setD(r.dados); setE(r.estado); setSujo(false);
        await apagarAnexos(velhos);
        setMsg({ ok: true, txt: "Anexo guardado no aditivo (vai no .zip mesmo em outra sessão; o aditivo foi salvo junto)." });
      } catch (x) { setMsg({ ok: false, txt: `${x instanceof Error ? x.message : String(x)} O arquivo vale nesta sessão.` }); }
    });
  }
  function aoAnexar(p: Partial<AnexosConsultas>) {
    const antes = refs.current.anexos;
    setAnexos((x) => ({ ...x, ...p }));
    const por = usuario;
    guardarNoAditivo(async (g, i13, velhos, idAd) => {
      if (p.sicaf) { velhos.push(...(g.sicaf ?? [])); g.sicaf = await Promise.all(p.sicaf.map((a) => guardarAnexo(idAd, "sicaf", a, por))); }
      if ("item13" in p) { velhos.push(...(g.consulta_cnpj ?? [])); if (p.item13) g.consulta_cnpj = [await guardarAnexo(idAd, "consulta_cnpj", p.item13, por)]; else delete g.consulta_cnpj; }
      if ("consolidada" in p) { if (i13.consolidada) velhos.push(i13.consolidada); i13.consolidada = p.consolidada ? await guardarAnexo(idAd, "consolidada", p.consolidada, por) : null; }
      if (p.complementos) {
        const novo: Record<string, AnexoGuardado> = {};
        for (const [k, a] of Object.entries(p.complementos)) novo[k] = antes.complementos[k] === a && i13.complementos?.[k] ? i13.complementos[k] : await guardarAnexo(idAd, `complemento_${k}`, a, por);
        for (const [k, a] of Object.entries(i13.complementos ?? {})) if (novo[k] !== a) velhos.push(a);
        i13.complementos = novo;
      }
      // item 14 (CPF do sócio): só nesta sessão, o CPF não é guardado no site
    });
  }
  function aoMemoria(a: Arquivo) {
    setMemoria(a);
    guardarNoAditivo(async (g, _i, velhos, idAd) => { velhos.push(...(g.memoria_calculo ?? [])); g.memoria_calculo = [await guardarAnexo(idAd, "memoria_calculo", a, usuario)]; });
  }
  async function anexarItem(chave: string, files: FileList | null) {
    if (!files?.length) return;
    const novos = await Promise.all(Array.from(files).map(async (f) => ({ nome: f.name, bytes: await f.arrayBuffer() })));
    setListaArq((x) => ({ ...x, [chave]: [...(x[chave] ?? []), ...novos] }));
    guardarNoAditivo(async (g, _i, _v, idAd) => { g[chave] = [...(g[chave] ?? []), ...(await Promise.all(novos.map((a) => guardarAnexo(idAd, chave, a, usuario))))]; });
  }
  function removerItem(chave: string, i: number) {
    setListaArq((x) => ({ ...x, [chave]: (x[chave] ?? []).filter((_, j) => j !== i) }));
    guardarNoAditivo(async (g, _i, velhos) => { const l = g[chave] ?? []; if (l[i]) velhos.push(l[i]); g[chave] = l.filter((_, j) => j !== i); if (!g[chave].length) delete g[chave]; });
  }

  if (erro) return <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{erro} <button className="ml-2 underline" onClick={onVoltar}>voltar</button></div>;
  if (!reg || !d || !dx || !e || !an) return <p className="text-sm text-slate-500">Abrindo o aditivo…</p>;

  const novo = valorNovo(dx);
  const acimaMilhao = passa1Milhao(dx);
  const ad = d.aditivo;

  async function salvar(situacao?: RegistroAditivo["situacao"]) {
    if (!reg || !dx || !e) return null;
    setOcupado(true); setMsg(null);
    try {
      await refs.current.fila;
      const r = await salvarAditivo(refs.current.reg ?? reg, dx, e, usuario, situacao);
      setD(r.dados);
      setReg(r); setSujo(false);
      setMsg({ ok: true, txt: "Aditivo salvo." });
      return r;
    } catch (x) { setMsg({ ok: false, txt: x instanceof Error ? x.message : String(x) }); return null; } finally { setOcupado(false); }
  }
  /** Traz para este aditivo nome, UG, artigo e autoridade do cadastro da unidade (Reajustes › Configurações) */
  function usarCadastroDaUnidade() {
    if (!unidadeOm) return;
    const { om, autoridade_superior } = omDaUnidade(unidadeOm);
    mudar((x) => ({ ...x, om_signataria: om, autoridade_superior: autoridade_superior ?? x.autoridade_superior }));
    setMsg({ ok: true, txt: `Dados da ${om.sigla} trazidos do cadastro de unidades apoiadas.` });
  }
  async function recarregarCadastro() {
    if (!reg) return;
    const { dados } = await cadastroReajuste(reg.numero_contrato);
    if (!dados) { setMsg({ ok: false, txt: "Sem cadastro nos Reajustes para este contrato." }); return; }
    const hist = (dados.historico_valores ?? []).filter((h) => h.valor != null);
    const p = parecerDoCadastro(dados, null);
    mudar((x) => ({
      ...x, valor_atual: hist.length ? hist[hist.length - 1].valor : x.valor_atual,
      historico: p.historico, itens: p.itens, contratada: p.contratada ?? x.contratada, objeto_resumido: p.objeto_resumido ?? x.objeto_resumido,
      parecer_tecnico: { ...(x.parecer_tecnico ?? {}), base: p.parecer.base, clausula_vigencia: x.parecer_tecnico?.clausula_vigencia || p.parecer.clausula_vigencia, clausula_reajuste: x.parecer_tecnico?.clausula_reajuste || p.parecer.clausula_reajuste },
      empenho: dados.orcamento ? { ...x.empenho, gestao_unidade: dados.orcamento.gestao_unidade, fonte: dados.orcamento.fonte, programa_trabalho: dados.orcamento.programa_trabalho, acao: dados.orcamento.acao || null, plano_interno: dados.orcamento.plano_interno, natureza_despesa: dados.orcamento.natureza_despesa, exercicio: dados.orcamento.exercicio } : x.empenho,
    }));
    setMsg({ ok: true, txt: "Valor atual, dotação do empenho, histórico de valores, itens e cláusulas trazidos do cadastro dos Reajustes (atualizado pelo Contratos.gov.br quando a SCON busca lá)." });
  }
  function marcar(k: Alteracao, v: boolean) {
    mudar((x) => ({ ...x, aditivo: { ...x.aditivo, [k]: v ? (k === "prorrogacao" ? { modalidade: "com_valor", meses: 12, inicio: null } : k === "reajuste" ? { indice: null, percentual: null, valor: null } : { valor: null, percentual: null, descricao: null }) : null } }));
  }
  function valorAlteracao(k: "acrescimo" | "supressao", campo: "valor" | "percentual" | "descricao", v: number | string | null) {
    mudar((x) => {
      const atual = numero(x.valor_atual);
      const a = { ...(x.aditivo[k] ?? { valor: null, percentual: null, descricao: null }), [campo]: v };
      // valor ⇄ percentual pelo valor atual do contrato
      if (campo === "valor" && atual && typeof v === "number") a.percentual = Math.round((v / atual) * 10000) / 100;
      if (campo === "percentual" && atual && typeof v === "number") a.valor = Math.round(atual * v) / 100;
      return { ...x, aditivo: { ...x.aditivo, [k]: a } };
    });
  }
  function naoAnexado(chave: string, marcado: boolean) {
    mudar((x) => { const n = { ...x.nao_anexados }; if (marcado) n[chave] = n[chave] ?? ""; else delete n[chave]; return { ...x, nao_anexados: n }; });
  }
  function listaPareceres(f: (l: ParecerReferencial[]) => ParecerReferencial[]) {
    const base = dx!.pareceres_referenciais;
    mudar((x) => ({ ...x, pareceres_referenciais: f(base) }));
    if (!manuais) mudarE({ pareceres_manuais: true });
  }
  const parecer = (i: number, p: Partial<ParecerReferencial>) => listaPareceres((l) => l.map((q, j) => (j === i ? { ...q, ...p } : q)));
  /** Parecer fora da biblioteca da SCON: objeto pela EMENTA do PDF da AGU (seção 2.4.1) */
  async function lerEmenta(i: number) {
    const p = dx?.pareceres_referenciais[i];
    if (!p?.pdf) return;
    setMsg({ ok: true, txt: "Baixando o PDF do parecer na AGU e lendo a ementa…" });
    try {
      const x = await consultaAutomatica<{ ok: boolean; error?: string; pdf_base64?: string }>({ acao: "parecer_pdf", url: p.pdf });
      if (!x.ok || !x.pdf_base64) throw new Error(x.error ?? "a AGU não devolveu o PDF");
      const { textoDoPdf } = await import("../../lib/apostilamento/pdfTexto");
      const ementa = ementaDoParecer(await textoDoPdf(new Uint8Array(bytesDeBase64(x.pdf_base64))), p.cobre);
      if (!ementa) throw new Error("não achei o bloco EMENTA no PDF: copie o objeto à mão");
      parecer(i, { objeto: ementa, fonte_objeto: "Ementa do PDF do parecer" });
      setMsg({ ok: true, txt: "Objeto tirado da ementa do parecer: confira e ajuste se precisar." });
    } catch (x) { setMsg({ ok: false, txt: `Não li a ementa: ${x instanceof Error ? x.message : String(x)}` }); }
  }
  const vant: Vantajosidade = d.vantajosidade ?? { motivos: [] };
  const setVant = (p: Partial<Vantajosidade>) => mudar((x) => ({ ...x, vantajosidade: { ...(x.vantajosidade ?? { motivos: [] }), ...p } }));
  const objetoAuto = fraseObjetoVantajosidade({ objeto_contrato: e.objeto_contrato, vantajosidade: null });
  const cabecalhoAuto = (d.om_signataria.nome ?? "").toUpperCase();
  async function irParaPesquisa() {
    if (sujo && !(await salvar())) return;
    onAbrir(`/app?vista=pesquisa-precos&aditivo=${reg!.id}`);
  }
  async function gerar() {
    if (!dx || !reg || !e) return;
    await refs.current.fila; // anexos ainda sendo guardados
    const r0 = sujo ? await salvar() : refs.current.reg ?? reg;
    if (!r0) return;
    setOcupado(true); setGeracao(null); setMsg({ ok: true, txt: "Preparando o kit da SCON (na primeira vez o navegador baixa o Python, cerca de 15 MB)…" });
    try {
      const ct = dx.contrato.replace(/\//g, "-");
      // anexos por item da Lista: o montar_zip.py do kit numera pela Lista e junta vários PDFs da mesma chave num só
      const extras: { chave: string; nome: string; bytes: ArrayBuffer }[] = [];
      anexos.sicaf.forEach((a) => extras.push({ chave: "sicaf", ...a }));
      const i13 = anexos.item13 ?? anexos.consolidada;
      if (i13) extras.push({ chave: "consulta_cnpj", ...i13 });
      anexos.socio.forEach((a) => extras.push({ chave: "consulta_cpf_socio", ...a }));
      if (memoria && ad.reajuste) extras.push({ chave: "memoria_calculo", ...memoria });
      for (const [k, l] of Object.entries(listaArq)) l.forEach((a) => extras.push({ chave: k, ...a }));
      // prints da Calculadora (Parecer Técnico, item 9): os do módulo Reajustes, se o aditivo não trocou
      if (ad.reajuste && !listaArq.calculadora_prints?.length) printsCad.forEach((a) => extras.push({ chave: "calculadora_prints", ...a }));
      // unidade do CEFA que o kit não reconhece pelo nome: autoridade do campo 19 = DIRAD
      const dk = unidadeOm?.cefa && !eCefa(dx.om_signataria) && !dx.autoridade_superior?.trim() ? { ...dx, autoridade_superior: AUTORIDADE_CEFA } : dx;
      const r = await kitAditivo.gerar(dk, extras, (t) => setMsg({ ok: true, txt: t }));
      const nome = `Termo Aditivo ${dx.numero_aditivo ?? ""} - CT ${ct}.zip`;
      setGeracao({ docs: r.documentos, zip: r.zip, nome, faltando: r.faltando ?? [] });
      const falhas = Object.values(r.documentos).filter((x) => !x.ok);
      setMsg({ ok: !falhas.length, txt: falhas.length ? `${falhas.length} documento(s) não saíram: veja os erros abaixo.` : `${r.arquivos.length} arquivo(s) no .zip.` });
      baixarBlob(r.zip, nome);
      const atualizado = await salvarAditivo(r0, dx, { ...(refs.current.e ?? e), gerado_em: new Date().toISOString(), arquivos_gerados: r.arquivos }, usuario, "gerado");
      setReg(atualizado); setE(atualizado.estado); setSujo(false);
    } catch (x) { setMsg({ ok: false, txt: x instanceof Error ? x.message : String(x) }); } finally { setOcupado(false); }
  }

  const cefa = eCefa(d.om_signataria) || !!unidadeOm?.cefa;
  const pareceresEfetivos = pareceresDoAditivo(dx.pareceres_referenciais);
  const orgaos = new Set(an.pareceres.map((p) => pareceresEfetivos.find((q) => q.numero === p.numero)?.orgao_consultivo ?? null));
  const atestado = an.pareceres.length > 0 && !an.descobertas.length;
  return (
    <div className="space-y-3 pb-24">
      <div className="flex flex-wrap items-center gap-2">
        <button className={botao} onClick={onVoltar}>← Aditivos</button>
        <h2 className="text-base font-bold text-slate-800">{d.numero_aditivo ?? "?"}º Termo Aditivo — Contrato {d.contrato}</h2>
        <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${reg.situacao === "gerado" ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-800"}`}>{reg.situacao === "gerado" ? "documentos gerados" : "rascunho"}</span>
        <span className="text-[11px] text-slate-400">salvo por {reg.atualizado_nome ?? "—"} em {new Date(reg.atualizado_em).toLocaleString("pt-BR")}</span>
      </div>
      {msg && <div className={`rounded-lg border px-3 py-2 text-xs ${msg.ok ? "border-sky-200 bg-sky-50 text-sky-700" : "border-red-200 bg-red-50 text-red-700"}`}>{msg.txt}</div>}
      {restaurando && <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">Abrindo os anexos guardados neste aditivo…</div>}

      <Secao titulo="Contrato e OMs" direita={<button className={botao} onClick={() => void recarregarCadastro()}>↻ Trazer do cadastro dos Reajustes</button>}>
        <div className="grid gap-2 sm:grid-cols-4">
          <Campo rotulo="Nº do contrato" valor={d.contrato} onChange={(v) => mudar((x) => ({ ...x, contrato: v }))} />
          <Campo rotulo="PAG (processo)" valor={d.pag} onChange={(v) => mudar((x) => ({ ...x, pag: v }))} />
          <label className="block"><span className="block text-[11px] font-medium text-slate-600 mb-0.5">Nº do termo aditivo</span>
            <CampoNumero valor={d.numero_aditivo} casas={0} onChange={(v) => mudar((x) => ({ ...x, numero_aditivo: v }))} />
            {ta && ta.numeros.length > 0 && d.numero_aditivo !== ta.proximo && <button className="mt-0.5 block text-[11px] text-sky-700 underline" onClick={() => mudar((x) => ({ ...x, numero_aditivo: ta.proximo }))}>usar o {ta.proximo}º (maior TA assinado + 1)</button>}</label>
          <label className="block"><span className="block text-[11px] font-medium text-slate-600 mb-0.5">CNPJ da contratada</span>
            <input className={sel} value={e.cnpj} onChange={(ev) => mudarE({ cnpj: ev.target.value })} /></label>
          <div className="sm:col-span-2"><Campo rotulo="OM solicitante/responsável (cabeçalho da Lista)" valor={d.om_nome} onChange={(v) => mudar((x) => ({ ...x, om_nome: v }))} /></div>
          <div className="sm:col-span-2"><Campo rotulo="Objeto do contrato" valor={e.objeto_contrato} ro onChange={() => {}} /></div>
        </div>
        <div className="mt-3 rounded-lg border border-slate-200 p-2">
          <div className="mb-1 text-[11px] font-semibold text-slate-600">OM que assina o contrato (Declaração, Mapa de Riscos, Ficha e o ACI da Lista)</div>
          <div className="grid gap-2 sm:grid-cols-5">
            <div className="sm:col-span-2"><Campo rotulo="Nome" valor={d.om_signataria.nome} onChange={(v) => mudar((x) => ({ ...x, om_signataria: { ...x.om_signataria, nome: v } }))} /></div>
            <Campo rotulo="Sigla" valor={d.om_signataria.sigla} onChange={(v) => mudar((x) => ({ ...x, om_signataria: { ...x.om_signataria, sigla: v } }))} />
            <Campo rotulo="Código da UG" valor={d.om_signataria.ug} onChange={(v) => mudar((x) => ({ ...x, om_signataria: { ...x.om_signataria, ug: v.replace(/\D/g, "") } }))} />
            <label className="block"><span className="block text-[11px] font-medium text-slate-600 mb-0.5">Artigo</span>
              <select className={sel} value={d.om_signataria.artigo} onChange={(ev) => mudar((x) => ({ ...x, om_signataria: { ...x.om_signataria, artigo: ev.target.value as "do" | "da" } }))}><option value="do">do</option><option value="da">da</option></select></label>
          </div>
          {unidades && (unidadeOm
            ? <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-slate-600">
                <span>Dados da contratante: <b>cadastro {unidadeOm.sigla}</b>{unidadeOm.atualizado_em ? ` (atualizado em ${new Date(unidadeOm.atualizado_em).toLocaleDateString("pt-BR")}${unidadeOm.atualizado_nome ? ` por ${unidadeOm.atualizado_nome}` : ""})` : ""}{unidadeOm.cefa ? " · CEFA" : ""}</span>
                <button className={botao} onClick={usarCadastroDaUnidade}>↻ Usar os dados do cadastro</button>
                <button className={botao} onClick={() => onAbrir(`/app?vista=reajustes&aba=config&nova=${encodeURIComponent(unidadeOm.sigla)}`)}>Editar o cadastro ↗</button>
              </div>
            : <div className="mt-2 rounded-md border border-amber-200 bg-amber-50 px-2 py-1.5 text-[11px] text-amber-800">
                A OM signatária <b>{d.om_signataria.sigla || "?"}</b> não está cadastrada em Reajustes › Configurações: cadastre antes de gerar os documentos.
                <button className="ml-2 rounded-md border border-amber-300 bg-white px-2 py-0.5 font-medium hover:bg-amber-100" onClick={() => onAbrir(`/app?vista=reajustes&aba=config&nova=${encodeURIComponent(d.om_signataria.sigla)}`)}>Cadastrar esta unidade ↗</button>
              </div>)}
        </div>
      </Secao>

      <Secao titulo="1. O que o aditivo vai fazer">
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-2">
            <label className="block"><span className="block text-[11px] font-medium text-slate-600 mb-0.5">Valor atual do contrato (período vigente: inicial + acréscimos + reajustes − supressões)</span>
              <CampoNumero valor={numero(d.valor_atual)} onChange={(v) => mudar((x) => ({ ...x, valor_atual: v }))} /></label>
            <div className="text-xs text-slate-600">Valor que o contrato passará a ter: <b>{novo == null ? "—" : brl(novo)}</b>{acimaMilhao && <span className="ml-1 rounded bg-amber-100 px-1 text-amber-800">acima de R$ 1 milhão: entra a Ficha de Autorização</span>}</div>
            <label className="block"><span className="block text-[11px] font-medium text-slate-600 mb-0.5">Outro valor final (só para caso especial; vazio = calculado)</span>
              <CampoNumero valor={numero(d.valor_novo)} onChange={(v) => mudar((x) => ({ ...x, valor_novo: v }))} /></label>
          </div>
          <div className="space-y-2">
            <Caixa rotulo="Prorrogação de vigência" marcado={!!ad.prorrogacao} onChange={(v) => marcar("prorrogacao", v)} />
            {ad.prorrogacao && (
              <div className="ml-5 grid gap-2 sm:grid-cols-2">
                <label className="block sm:col-span-2"><span className="block text-[11px] font-medium text-slate-600 mb-0.5">Modalidade</span>
                  <select className={sel} value={ad.prorrogacao.modalidade} onChange={(ev) => mudar((x) => ({ ...x, aditivo: { ...x.aditivo, prorrogacao: { ...x.aditivo.prorrogacao!, modalidade: ev.target.value as "com_valor" | "sem_valor" } } }))}>
                    <option value="com_valor">Com valor – renova o valor contratual do período</option><option value="sem_valor">Sem valor – em sentido estrito (só estende a vigência)</option></select></label>
                <label className="block"><span className="block text-[11px] font-medium text-slate-600 mb-0.5">Meses</span>
                  <CampoNumero valor={ad.prorrogacao.meses} casas={0} onChange={(v) => mudar((x) => ({ ...x, aditivo: { ...x.aditivo, prorrogacao: { ...x.aditivo.prorrogacao!, meses: v, fim: null } } }))} /></label>
                <Campo rotulo="Início do novo período (dd/mm/aaaa)" valor={ad.prorrogacao.inicio ?? ""} onChange={(v) => mudar((x) => ({ ...x, aditivo: { ...x.aditivo, prorrogacao: { ...x.aditivo.prorrogacao!, inicio: v || null, fim: null } } }))} />
                <Campo rotulo="Fim (calculado; editável)" valor={ad.prorrogacao.fim ?? fimPrevisto(ad.prorrogacao.inicio, ad.prorrogacao.meses) ?? ""} onChange={(v) => mudar((x) => ({ ...x, aditivo: { ...x.aditivo, prorrogacao: { ...x.aditivo.prorrogacao!, fim: v || null } } }))} />
              </div>
            )}
            <Caixa rotulo="Reajuste" marcado={!!ad.reajuste} onChange={(v) => marcar("reajuste", v)} />
            {ad.reajuste && (
              <div className="ml-5 grid gap-2 sm:grid-cols-3">
                <Campo rotulo="Índice" valor={ad.reajuste.indice ?? ""} onChange={(v) => mudar((x) => ({ ...x, aditivo: { ...x.aditivo, reajuste: { ...x.aditivo.reajuste!, indice: v || null } } }))} />
                <Campo rotulo="Percentual" valor={ad.reajuste.percentual ?? ""} onChange={(v) => mudar((x) => ({ ...x, aditivo: { ...x.aditivo, reajuste: { ...x.aditivo.reajuste!, percentual: v || null } } }))} />
                <label className="block"><span className="block text-[11px] font-medium text-slate-600 mb-0.5">Valor (R$)</span>
                  <CampoNumero valor={ad.reajuste.valor} onChange={(v) => mudar((x) => ({ ...x, aditivo: { ...x.aditivo, reajuste: { ...x.aditivo.reajuste!, valor: v } } }))} /></label>
                <p className="sm:col-span-3 text-[11px] text-slate-500">Os três vêm da seção 9 (Memória de Cálculo), pelo motor dos Reajustes.</p>
              </div>
            )}
            {(["acrescimo", "supressao"] as const).map((k) => (
              <div key={k}>
                <Caixa rotulo={k === "acrescimo" ? "Acréscimo" : "Supressão"} marcado={!!ad[k]} onChange={(v) => marcar(k, v)} />
                {ad[k] && (
                  <div className="ml-5 grid gap-2 sm:grid-cols-3">
                    <label className="block"><span className="block text-[11px] font-medium text-slate-600 mb-0.5">Valor (R$)</span><CampoNumero valor={ad[k]!.valor} onChange={(v) => valorAlteracao(k, "valor", v)} /></label>
                    <label className="block"><span className="block text-[11px] font-medium text-slate-600 mb-0.5">Percentual (%)</span><CampoNumero valor={ad[k]!.percentual} onChange={(v) => valorAlteracao(k, "percentual", v)} /></label>
                    <Campo rotulo="Descrição (referente a…)" valor={ad[k]!.descricao ?? ""} onChange={(v) => valorAlteracao(k, "descricao", v || null)} />
                    {(numero(ad[k]!.percentual) ?? 0) > 25 && <p className="sm:col-span-3 text-[11px] font-semibold text-red-600">Acima de 25% (art. 125 da Lei 14.133/2021; 50% só para reforma de edifício/equipamento).</p>}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </Secao>

      <Secao titulo="2. Pareceres referenciais (um para cada alteração)">
        <div className="grid gap-2 sm:grid-cols-3">
          <label className="block sm:col-span-2"><span className="block text-[11px] font-medium text-slate-600 mb-0.5">Natureza do objeto</span>
            <select className={sel} value={e.natureza} onChange={(ev) => mudarE({ natureza: ev.target.value as EstadoAditivo["natureza"] })}>{NATUREZAS.map(([k, n]) => <option key={k} value={k}>{n}</option>)}</select></label>
          <label className="block"><span className="block text-[11px] font-medium text-slate-600 mb-0.5">Lei do contrato</span>
            <select className={sel} value={e.lei} onChange={(ev) => mudarE({ lei: ev.target.value as EstadoAditivo["lei"] })}><option value="14133">Lei 14.133/2021</option><option value="8666">Lei 8.666/1993</option></select></label>
        </div>
        <ul className="mt-2 space-y-1 text-xs">
          {an.pareceres.map((p) => <li key={p.numero} className="rounded-md border border-emerald-200 bg-emerald-50 px-2 py-1 text-emerald-800">🟢 {p.fundamenta.map((a) => NOMES[a]).join(" e ").replace(/^./, (c) => c.toUpperCase())}: fundamentados no {p.numero} (válido até {p.validade ?? "?"}).</li>)}
          {an.descobertas.map((x) => <li key={x} className="rounded-md border border-red-200 bg-red-50 px-2 py-1 font-semibold text-red-700">🔴 {x.replace(/^./, (c) => c.toUpperCase())}: sem parecer referencial vigente. Este termo aditivo deverá ir para análise jurídica (CJU).</li>)}
          {atestado
            ? <li className="rounded-md border border-slate-200 bg-slate-50 px-2 py-1 text-slate-700">📄 Atestado de adequação: <b>um só</b>, do processo {citarPareceres(an.pareceres)} — gerado e incluído no .zip.{(orgaos.size !== 1 || orgaos.has(null)) && <span className="text-amber-700"> Órgão consultivo não identificado (ou diferente entre os pareceres): confira o trecho "a cargo da…" do atestado.</span>}</li>
            : an.pareceres.length > 0 && <li className="rounded-md border border-slate-200 bg-slate-50 px-2 py-1 text-slate-600">Sem Atestado de adequação: com alteração sem parecer referencial, o aditivo vai para a CJU.</li>}
        </ul>
        <div className="mt-2 space-y-2">
          {dx.pareceres_referenciais.map((p, i) => {
            const bib = daBiblioteca(p.numero);
            const objetoEfetivo = pareceresDoAditivo([p])[0]?.objeto ?? p.objeto ?? "";
            return (
            <div key={i} className="rounded-lg border border-slate-200 p-2 text-xs">
              <div className="grid gap-2 sm:grid-cols-4">
                <div className="sm:col-span-2"><Campo rotulo="Nº completo do parecer" valor={p.numero} onChange={(v) => parecer(i, { numero: v })} /></div>
                <Campo rotulo="Data" valor={p.data ?? bib?.data ?? ""} onChange={(v) => parecer(i, { data: v || null })} />
                <Campo rotulo="Válido até" valor={p.validade ?? bib?.validade ?? ""} onChange={(v) => parecer(i, { validade: v || null })} />
                <div className="sm:col-span-4">
                  <Campo rotulo="Objeto (texto do próprio parecer, voltado para a alteração)" valor={objetoEfetivo} longo onChange={(v) => parecer(i, { objeto: v, objeto_fixo: true })} />
                  <div className="mt-0.5 flex flex-wrap items-center gap-2 text-[11px] text-slate-500">
                    {bib && !p.objeto_fixo && <span>📚 da biblioteca de pareceres da SCON ({bib.fonte_objeto})</span>}
                    {bib && p.objeto_fixo && <button className="text-sky-700 underline" onClick={() => parecer(i, { objeto: bib.objeto, objeto_fixo: false })}>voltar ao objeto da biblioteca da SCON</button>}
                    {!bib && p.pdf && <button className={botao} onClick={() => void lerEmenta(i)}>📄 Ler a ementa no PDF do parecer</button>}
                    {!bib && !p.pdf && <span>Fora da biblioteca da SCON e sem o PDF: escreva o objeto pela ementa do parecer.</span>}
                  </div>
                </div>
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-3">
                <span className="text-slate-600">Fundamenta:</span>
                {ALTERACOES.map((a) => <label key={a} className="flex items-center gap-1"><input type="checkbox" checked={p.cobre.includes(a)} onChange={(ev) => parecer(i, { cobre: ev.target.checked ? [...p.cobre, a] : p.cobre.filter((x) => x !== a) })} />{NOMES[a]}</label>)}
                <label className="flex items-center gap-1">limite % <input className="w-14 rounded border border-slate-200 px-1" value={p.limite_percentual ?? ""} onChange={(ev) => parecer(i, { limite_percentual: numero(ev.target.value) })} /></label>
                <button className="ml-auto text-red-600 underline" onClick={() => listaPareceres((l) => l.filter((_, j) => j !== i))}>remover</button>
              </div>
            </div>
            );
          })}
          <div className="flex flex-wrap gap-2 text-xs">
            <select className="max-w-[520px] rounded-lg border border-slate-200 px-2 py-1" value="" onChange={(ev) => {
              const a = agu.find((x) => String(x.id) === ev.target.value);
              if (!a) return;
              listaPareceres((l) => [...l, { numero: a.parecer ?? "", objeto: limparObjeto(a.assunto), data: a.data ? a.data.split("-").reverse().join("/") : null, validade: a.validade ? a.validade.split("-").reverse().join("/") : null, cobre: [], pdf: a.url ?? null }]);
            }}>
              <option value="">+ Incluir um parecer da página AGU (pareceres referenciais vigentes)…</option>
              {agu.filter((a) => !a.validade || a.validade >= hoje).map((a) => <option key={a.id} value={a.id}>{(a.parecer ?? "").slice(0, 70)} — {(a.assunto ?? "").slice(0, 80)}</option>)}
            </select>
            {manuais && <button className={botao} onClick={() => mudarE({ pareceres_manuais: false })}>Voltar às sugestões do catálogo da SCON</button>}
          </div>
        </div>
      </Secao>

      <Secao titulo="3. Lista de Verificação">
        <div className="flex flex-wrap gap-4">
          <Caixa rotulo="Incluir a consulta do CPF do sócio majoritário" marcado={d.consulta_socio} onChange={(v) => mudar((x) => ({ ...x, consulta_socio: v }))} />
          <Caixa rotulo="O representante da empresa mudou (procuração)" marcado={d.representante_mudou} onChange={(v) => mudar((x) => ({ ...x, representante_mudou: v }))} />
          <Caixa rotulo="Contratação por inexigibilidade (atestado de exclusividade)" marcado={d.inexigibilidade} onChange={(v) => mudar((x) => ({ ...x, inexigibilidade: v }))} />
        </div>
        <ol className="mt-2 space-y-1 text-xs">
          {itens.map((it, i) => {
            const nao = it.chave in d.nao_anexados;
            return (
              <li key={it.chave} className={`rounded-md border px-2 py-1 ${nao ? "border-amber-200 bg-amber-50" : "border-slate-100"}`}>
                <div className="flex gap-2">
                  <span className="w-5 shrink-0 text-right font-semibold text-slate-500">{i + 1}.</span>
                  <span className="flex-1 whitespace-pre-line text-slate-700">{it.texto}</span>
                  <label className="flex shrink-0 items-center gap-1 text-[11px] text-slate-600"><input type="checkbox" checked={nao} onChange={(ev) => naoAnexado(it.chave, ev.target.checked)} /> não será anexado</label>
                </div>
                {nao && <input className="mt-1 w-full rounded border border-amber-300 px-2 py-1" placeholder="Justificativa (obrigatória; vai para a Observação)" value={d.nao_anexados[it.chave]} onChange={(ev) => mudar((x) => ({ ...x, nao_anexados: { ...x.nao_anexados, [it.chave]: ev.target.value } }))} />}
                {!nao && anexavel(it.chave) && (
                  <div className="mt-1 flex flex-wrap items-center gap-2 pl-7 text-[11px]">
                    {(listaArq[it.chave] ?? []).map((a, j) => <span key={j} className="rounded bg-emerald-50 px-1.5 py-0.5 text-emerald-800">📎 {a.nome} <button className="text-red-600" title="tirar do aditivo" onClick={() => removerItem(it.chave, j)}>✕</button></span>)}
                    <label className="cursor-pointer text-sky-700 underline">anexar PDF (vai no .zip)<input type="file" accept="application/pdf,.docx" multiple className="hidden" onChange={(ev) => { void anexarItem(it.chave, ev.target.files); ev.target.value = ""; }} /></label>
                  </div>
                )}
              </li>
            );
          })}
        </ol>
        <div className="mt-2"><Campo rotulo="Observação (texto livre do fiscal)" valor={d.observacao} longo onChange={(v) => mudar((x) => ({ ...x, observacao: v }))} /></div>
        {fraseObservacaoParecer(an) && <p className="mt-1 text-[11px] text-slate-500">Vai também para a Observação: "{fraseObservacaoParecer(an)}".</p>}
      </Secao>

      <Secao titulo="4. Declaração de Disponibilidade Orçamentária (último empenho)">
        <p className="mb-2 text-[11px] text-slate-500">Último empenho: {e.ultimo_empenho?.ne ?? d.empenho.numero ?? "—"} ({e.ultimo_empenho?.origem ?? "cadastro"}). Para buscar no Contratos.gov.br, use "Buscar no Contratos.gov.br" no contrato dos Reajustes e depois "Trazer do cadastro dos Reajustes" acima.</p>
        <div className="grid gap-2 sm:grid-cols-4">
          {([["gestao_unidade", "Gestão/Unidade"], ["fonte", "Fonte de Recursos"], ["programa_trabalho", "Programa de Trabalho (PTRES)"], ["acao", "Ação"], ["plano_interno", "Plano Interno"], ["natureza_despesa", "Natureza de Despesa"]] as const).map(([k, n]) => (
            <Campo key={k} rotulo={n} valor={String(d.empenho[k] ?? "")} onChange={(v) => mudar((x) => ({ ...x, empenho: { ...x.empenho, [k]: k === "acao" ? v || null : v } }))} />
          ))}
          <Campo rotulo="Exercício" valor={String(d.empenho.exercicio ?? "")} onChange={(v) => mudar((x) => ({ ...x, empenho: { ...x.empenho, exercicio: Number(v) || v || null } }))} />
        </div>
      </Secao>

      {ad.prorrogacao && (
        <Secao titulo="5. Declaração de Vantajosidade Econômica (prorrogação de vigência)">
          <div className="grid gap-2 sm:grid-cols-2">
            <Campo rotulo="OM do cabeçalho (a que assina o contrato)" valor={vant.om_cabecalho ?? cabecalhoAuto}
              onChange={(v) => setVant({ om_cabecalho: v.trim() && v.trim().toUpperCase() !== cabecalhoAuto.trim() ? v : null })} dica="vazio = o nome da OM signatária" />
            <Campo rotulo='Objeto na declaração ("cujo objeto é …")' valor={vant.objeto ?? objetoAuto}
              onChange={(v) => setVant({ objeto: v.trim() && v.trim() !== objetoAuto ? v : null })} dica="montado do objeto do contrato; corrija se precisar" />
          </div>
          <div className="mt-2 space-y-1 text-xs">
            <span className="block text-[11px] font-medium text-slate-600">Motivos da vantajosidade (incisos I, II, III… – pelo menos 1)</span>
            {vant.motivos.map((m, i) => (
              <div key={i} className="flex items-start gap-2">
                <span className="w-8 shrink-0 pt-1.5 text-right font-semibold text-slate-500">{["I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X"][i] ?? i + 1} –</span>
                <textarea className="min-h-[44px] flex-1 rounded-lg border border-slate-200 px-2 py-1 text-xs" value={m} onChange={(ev) => setVant({ motivos: vant.motivos.map((x, j) => (j === i ? ev.target.value : x)) })} />
                <button className="pt-1.5 text-red-600" title="tirar este motivo" onClick={() => setVant({ motivos: vant.motivos.filter((_, j) => j !== i) })}>🗑</button>
              </div>
            ))}
            <div className="flex flex-wrap gap-2">
              <button className={botao} onClick={() => setVant({ motivos: [...vant.motivos, ""] })}>+ Adicionar motivo</button>
              {SUGESTOES_VANTAJOSIDADE(indiceContrato || ad.reajuste?.indice || "").filter((t) => !vant.motivos.includes(t)).map((t, i) => (
                <button key={i} className="rounded-lg border border-dashed border-slate-300 px-2 py-1 text-left text-[11px] text-slate-600 hover:bg-slate-50" title={t} onClick={() => setVant({ motivos: [...vant.motivos.filter((x) => x.trim()), t] })}>Usar sugestão: {t.slice(0, 60)}…</button>
              ))}
            </div>
          </div>
          <div className="mt-2 rounded-md bg-slate-50 p-2 text-[11px] text-slate-700">
            <b>Prévia:</b> Considerando a prorrogação de vigência do Contrato nº {d.contrato}, cujo objeto é {fraseObjetoVantajosidade({ objeto_contrato: e.objeto_contrato, vantajosidade: vant }) || "«objeto»"}, declaro que é vantajosa economicamente a prorrogação do contrato em questão, pois:
            {incisosVantajosidade(vant.motivos).map(([n, t]) => <div key={n} className="pl-4">{n} – {t}</div>)}
            <div className="mt-1 text-slate-500">Assinam: Gestor do Contrato e Ordenador de Despesas (só o cargo). Vai no .zip como item da Lista.</div>
          </div>
        </Secao>
      )}

      <Secao titulo="6. Parecer Técnico de Alteração Contratual (item 5 da Lista)">
        <ParecerTecnico d={dx} onChange={mudar} prints={printsEfetivos} printsDoAditivo={!!listaArq.calculadora_prints?.length}
          onTrocarPrints={(f) => void anexarItem("calculadora_prints", f)} onTirarPrint={(i) => removerItem("calculadora_prints", i)}
          onAbrirReajustes={() => onAbrir(`/app?vista=reajustes&contrato=${encodeURIComponent(reg.numero_contrato)}&instrumento=aditivo&ta=${d.numero_aditivo ?? ""}`)}
          onTrazerCadastro={() => void recarregarCadastro()} />
      </Secao>

      <Secao titulo="7. Mapa de Riscos">
        <MapaRiscos riscos={d.riscos} tipo={e.tipo_risco} onChange={(r) => mudar((x) => ({ ...x, riscos: r }))} onTipo={(t) => mudarE({ tipo_risco: t })} />
      </Secao>

      <Secao titulo="8. SICAF (obrigatório)">
        <Sicaf estado={e} anexos={anexos} onEstado={mudarE} onAnexos={aoAnexar} />
      </Secao>

      <Secao titulo="9. Regularidade CEIS / CNEP / CNJ / TCU (obrigatório)">
        <Regularidade estado={e} anexos={anexos} contrato={d.contrato} consultaSocio={d.consulta_socio} onEstado={mudarE} onAnexos={aoAnexar} />
      </Secao>

      <Secao titulo="10. Pesquisa de Preços (obrigatória)">
        <PesquisaAditivo d={d} numeroContrato={reg.numero_contrato} onPesquisa={(p) => mudar((x) => ({ ...x, pesquisa_precos: p }))} onFazer={() => void irParaPesquisa()} />
      </Secao>

      {ad.reajuste && (
        <Secao titulo="11. Memória de Cálculo + Calculadora do Cidadão (reajuste)">
          <MemoriaAditivo d={d} numeroContrato={reg.numero_contrato} memoria={memoria} onMemoria={aoMemoria}
            onReajuste={(rj) => mudar((x) => ({ ...x, aditivo: { ...x.aditivo, reajuste: rj } }))}
            onAbrirReajustes={() => onAbrir(`/app?vista=reajustes&contrato=${encodeURIComponent(reg.numero_contrato)}&instrumento=aditivo&ta=${d.numero_aditivo ?? ""}`)} />
        </Secao>
      )}

      {acimaMilhao && (
        <Secao titulo="12. Ficha para a Autorização da Prorrogação (acima de R$ 1 milhão)">
          <pre className="whitespace-pre-wrap rounded-md bg-slate-50 p-2 text-[11px] text-slate-700">{objetoDaFicha(dx)}</pre>
          <div className="mt-2"><Campo rotulo="9. Mérito administrativo (justificativa do fiscal) – obrigatório" valor={d.merito_administrativo} longo onChange={(v) => mudar((x) => ({ ...x, merito_administrativo: v }))} /></div>
          {!cefa && <div className="mt-2"><Campo rotulo="19. Cargo da autoridade que autoriza (OM fora do CEFA)" valor={d.autoridade_superior ?? ""} onChange={(v) => mudar((x) => ({ ...x, autoridade_superior: v || null }))} dica="GAP-MN e Prefeitura: Diretor de Administração da Aeronáutica (automático)." /></div>}
          <div className="mt-2 grid gap-2 sm:grid-cols-3">
            {([["parecer_juridico", "13/14. Parecer jurídico (CJU), se houver"], ["ratificacao", "15. Ratificação pela autoridade superior"], ["aprovacao_superior", "16. Aprovação da autoridade superior"]] as const).map(([k, n]) => (
              <div key={k} className="space-y-1">
                <Campo rotulo={`${n} – nº`} valor={d[k]?.numero ?? ""} onChange={(v) => mudar((x) => ({ ...x, [k]: v ? { numero: v, data: x[k]?.data ?? "" } : null }))} />
                <Campo rotulo="data" valor={d[k]?.data ?? ""} onChange={(v) => mudar((x) => ({ ...x, [k]: x[k] ? { ...x[k]!, data: v } : null }))} />
              </div>
            ))}
          </div>
        </Secao>
      )}

      <Secao titulo="Alertas e geração dos documentos">
        <ul className="space-y-1 text-xs">
          {alertas.length === 0 && <li className="text-emerald-700">Nenhum alerta.</li>}
          {faltando.length > 0 && <li className="rounded-md border border-amber-200 bg-amber-50 px-2 py-1 text-amber-800">⚠️ O .zip vai sair sem: {faltando.map((x) => `item ${x.n} – ${x.nome}`).join("; ")}. Anexe o PDF no item da Lista ou marque "não será anexado" com a justificativa.</li>}
          {alertas.map((a, i) => <li key={i} className={`rounded-md border px-2 py-1 ${a.nivel === "critico" ? "border-red-200 bg-red-50 text-red-700" : a.nivel === "atencao" ? "border-amber-200 bg-amber-50 text-amber-800" : "border-slate-200 bg-slate-50 text-slate-600"}`}>{a.bloqueia ? "⛔ " : a.nivel === "critico" ? "🔴 " : a.nivel === "atencao" ? "⚠️ " : "ℹ️ "}{a.texto}</li>)}
        </ul>
        {geracao && (
          <div className="mt-3 space-y-1 text-xs">
            {Object.values(geracao.docs).map((doc) => (
              <div key={doc.nome} className={doc.ok ? "text-emerald-700" : "text-red-700"}>{doc.ok ? "✔" : "✖"} {doc.nome}{doc.erros.length ? `: ${doc.erros.join("; ")}` : ""}{doc.avisos.length ? <span className="text-amber-700"> · {doc.avisos.join("; ")}</span> : null}</div>
            ))}
            {geracao.faltando.length > 0 && <div className="text-amber-700">Ficaram fora do .zip: {geracao.faltando.join("; ")}.</div>}
            <button className={botao} onClick={() => baixarBlob(geracao.zip, geracao.nome)}>⬇ Baixar de novo: {geracao.nome}</button>
          </div>
        )}
      </Secao>

      <div className="sticky bottom-0 z-30 -mx-1 flex rounded-lg pr-20 flex-wrap items-center justify-end gap-2 border-t border-slate-200 px-4 py-2" style={{ background: "var(--gm-pop, #fff)" }}>
        {bloqueios.length > 0 && <span className="mr-auto text-xs text-red-600">{bloqueios.length} pendência(s) impedem a geração.</span>}
        <button className={botao} disabled={ocupado || !sujo} onClick={() => void salvar()}>{sujo ? "Salvar" : "Salvo"}</button>
        <button className={primario} disabled={ocupado || bloqueios.length > 0} onClick={() => void gerar()}>{ocupado ? "Aguarde…" : "Gerar os documentos (.zip)"}</button>
      </div>
    </div>
  );
}
