import { useState, useRef, useEffect } from "react";
import { supabase } from "../lib/supabase";
import type { ContratoRef } from "./TermoApostilamentoContrato";
import DocFormatBar from "./DocFormatBar";

const TEMPLATE_TIPO = "aditivo";

// ─────────────────────────────────────────────────────────────────────────────
// TIPOS
// ─────────────────────────────────────────────────────────────────────────────
export type TipoAditivo = "prorrogacao" | "alteracao";

type ItemTabela = { id: string; item: string; descricao: string; unidade: string; vlAtual: string; vlNovo: string; vlTotal: string };

type AditivoCfg = {
  tipoAditivo:               TipoAditivo;
  numeroTermo:               string;
  nupProcesso:               string;
  local:                     string;
  dataAssinatura:            string;
  // Ordenadora
  ordenadoraNome:            string;
  ordenadoraGraduacao:       string;
  ordenadoraPortaria:        string;
  ordenadoraPortariaData:    string;
  ordenadoraBoletim:         string;
  ordenadoraBoletimData:     string;
  ordenadoraMatricula:       string;
  // Contratada
  contratadaEndereco:        string;
  contratadaCidade:          string;
  contratadaUF:              string;
  contratadaRepresentante:   string;
  // Prorrogação
  novoPrazo:                 string;
  unidadePrazo:              "meses" | "anos";
  dataInicioProrrogacao:     string;
  dataFimProrrogacao:        string;
  valorMensal:               string;
  valorTotal:                string;
  incluirRepactuacao:        boolean;
  // Acréscimo/Supressão
  incluirAcrescimo:          boolean;
  incluirSupressao:          boolean;
  tipoQuantQualAcrescimo:    string;
  tipoQuantQualSupressao:    string;
  descricaoAcrescimo:        string;
  descricaoSupressao:        string;
  artFundamentoAcrescimo:    string;
  artFundamentoSupressao:    string;
  percentualAcrescimo:       string;
  percentualSupressao:       string;
  tipoValorTabela:           "global" | "mensal";
  novoValorContrato:         string;
  novoValorMensal:           string;
  novoValorAnual:            string;
  tabelaItens:               ItemTabela[];
  // Dotação (comum)
  dotacaoGestao:             string;
  dotacaoFonte:              string;
  dotacaoPrograma:           string;
  dotacaoElemento:           string;
  dotacaoPlano:              string;
  dotacaoNE:                 string;
  // Garantia (comum)
  garantiaValor:             string;
  garantiaPerc:              string;
  garantiaDias:              string;
  // Produção de efeitos
  producaoEfeitoTipo:        "assinatura" | "data";
  producaoEfeitoData:        string;
  // Toggles de cláusulas
  clGarantia:                boolean;
  clProgramaIntegridade:     boolean;
  // Brasão
  brasaoSize:                number;
  // Texto livre por cláusula (override)
  txtObjeto:                 string;
  txtPreco:                  string;
  txtDotacao:                string;
  txtGarantia:               string;
  txtIntegridade:            string;
  txtEfeitos:                string;
  txtRatificacao:            string;
  txtPublicacao:             string;
};

const CFG_KEY = "gapmn_aditivo_v2_cfg";

const ITEM_BLANK = (): ItemTabela => ({ id: String(Date.now()), item: "", descricao: "", unidade: "", vlAtual: "", vlNovo: "", vlTotal: "" });

const DEFAULT: AditivoCfg = {
  tipoAditivo: "prorrogacao",
  numeroTermo: "1º", nupProcesso: "", local: "Manaus", dataAssinatura: "",
  ordenadoraNome: "SUSAN KELLY PRADO ANDRADE", ordenadoraGraduacao: "Cel Int",
  ordenadoraPortaria: "", ordenadoraPortariaData: "", ordenadoraBoletim: "", ordenadoraBoletimData: "", ordenadoraMatricula: "",
  contratadaEndereco: "", contratadaCidade: "", contratadaUF: "", contratadaRepresentante: "",
  novoPrazo: "12", unidadePrazo: "meses", dataInicioProrrogacao: "", dataFimProrrogacao: "",
  valorMensal: "", valorTotal: "", incluirRepactuacao: true,
  incluirAcrescimo: true, incluirSupressao: false,
  tipoQuantQualAcrescimo: "quantitativo", tipoQuantQualSupressao: "quantitativo",
  descricaoAcrescimo: "", descricaoSupressao: "",
  artFundamentoAcrescimo: "124, inciso I", artFundamentoSupressao: "124, inciso I",
  percentualAcrescimo: "", percentualSupressao: "",
  tipoValorTabela: "global", novoValorContrato: "", novoValorMensal: "", novoValorAnual: "",
  tabelaItens: [ITEM_BLANK()],
  dotacaoGestao: "", dotacaoFonte: "", dotacaoPrograma: "", dotacaoElemento: "", dotacaoPlano: "", dotacaoNE: "",
  garantiaValor: "", garantiaPerc: "5", garantiaDias: "30",
  producaoEfeitoTipo: "assinatura", producaoEfeitoData: "",
  clGarantia: true, clProgramaIntegridade: false,
  brasaoSize: 110,
  txtObjeto: "", txtPreco: "", txtDotacao: "", txtGarantia: "", txtIntegridade: "", txtEfeitos: "", txtRatificacao: "", txtPublicacao: "",
};

function loadCfg(): AditivoCfg {
  try { const r = localStorage.getItem(CFG_KEY); return r ? { ...DEFAULT, ...JSON.parse(r) } : { ...DEFAULT }; }
  catch { return { ...DEFAULT }; }
}
function saveCfg(c: AditivoCfg) { localStorage.setItem(CFG_KEY, JSON.stringify(c)); }

const ph = (v: string | null | undefined, fb = "______") => v?.trim() || fb;
const ORDINAL: Record<string, string> = { "1º":"PRIMEIRO","2º":"SEGUNDO","3º":"TERCEIRO","4º":"QUARTO","5º":"QUINTO","6º":"SEXTO","7º":"SÉTIMO","8º":"OITAVO","9º":"NONO","10º":"DÉCIMO" };
const toExt = (v: string) => ORDINAL[v.trim()] ?? v.toUpperCase();

// ─────────────────────────────────────────────────────────────────────────────
// NOTAS AGU (mostradas no painel, não imprimidas)
// ─────────────────────────────────────────────────────────────────────────────
const NOTAS: Record<string, string> = {
  objeto_prorrogacao:
    "Art. 107 da Lei 14.133/21: contratos de serviços contínuos podem ser prorrogados sucessivamente, respeitada a vigência máxima decenal. Informe o prazo e as datas de início e término do novo período.",
  objeto_acrescimo:
    "Art. 124, I da Lei 14.133/21 (acréscimo/supressão quantitativo) ou art. 124, II (alteração qualitativa). Identifique o artigo correto. Informe o percentual em relação ao valor inicial atualizado do contrato.",
  preco_prorrogacao:
    "Informe o valor mensal e o valor global estimado para o novo período. A cláusula de repactuação garante ao contratado o direito à repactuação por custos de mão de obra decorrentes de ACT/CCT/Dissídio.",
  preco_acrescimo:
    "Escolha entre valor global (compras/obras) ou valor mensal+anual (serviços contínuos). Preencha a tabela com os itens alterados mostrando valores atuais e novos.",
  dotacao:
    "Informe os dados orçamentários do novo exercício. Para exercícios futuros, a dotação será indicada por apostilamento após aprovação da LOA.",
  garantia_prorrogacao:
    "O contratado deve renovar a garantia no mesmo percentual já exigido no contrato original. Prazo típico: 30 dias corridos da assinatura.",
  garantia_acrescimo:
    "Para acréscimo: o contratado deve adequar a garantia proporcionalmente ao novo valor. Para supressão: é facultada ao contratado a manutenção da garantia já prestada.",
  integridade:
    "Cláusula obrigatória para contratos acima do limite de dispensa quando a contratada for pessoa jurídica. Fundamento: art. 25, §4º, Lei 14.133/21; Decreto 12.304/2024; Portaria SE/CGU nº 226/2025.",
  efeitos:
    "Escolha entre 'a partir da data de sua assinatura' (mais comum) ou uma data específica (ex: início do próximo exercício). Atenção: efeitos retroativos exigem justificativa.",
  publicacao:
    "Obrigatório: publicar no PNCP (art. 94 da Lei 14.133/21) e no sítio oficial do órgão (art. 91). A cláusula padrão do modelo AGU já cobre os dois requisitos legais.",
};

type NotaKey = keyof typeof NOTAS;

// ─────────────────────────────────────────────────────────────────────────────
// COMPONENTE PRINCIPAL
// ─────────────────────────────────────────────────────────────────────────────
export default function TermoAditivoContrato({ contrato, onClose }: { contrato: ContratoRef; onClose: () => void }) {
  const [cfg,  setCfg]  = useState<AditivoCfg>(() => {
    const b = loadCfg();
    if (!b.nupProcesso && contrato.pag_nup) b.nupProcesso = contrato.pag_nup;
    return b;
  });
  const [draft, setDraft] = useState<AditivoCfg>(() => {
    const b = loadCfg();
    if (!b.nupProcesso && contrato.pag_nup) b.nupProcesso = contrato.pag_nup;
    return b;
  });
  const [sigs, setSigs] = useState([
    { id: "fiscal",    nome: contrato.fiscal || "", cargo: "Fiscal do Contrato" },
    { id: "aci",       nome: "", cargo: "Agente de Controle Interno do GAP-MN" },
    { id: "dirigente", nome: "SUSAN KELLY PRADO ANDRADE Ten Cel Int", cargo: "Ordenadora de Despesas do GAP-MN" },
  ]);
  const [showCfg, setShowCfg]     = useState(false);
  const [activeTab, setActiveTab] = useState<"campos"|"clausulas"|"notas">("campos");
  const [openNota, setOpenNota]   = useState<NotaKey | null>(null);
  const [docSaved,        setDocSaved]        = useState(false);
  const [savingDoc,       setSavingDoc]       = useState(false);
  const [savingTemplate,  setSavingTemplate]  = useState(false);
  const [templateSaved,   setTemplateSaved]   = useState(false);
  const docRef = useRef<HTMLDivElement>(null);

  // ── Edição inline do documento ──────────────────────────────────────────────
  const LS_DOC_KEY = `gapmn_aditivo_doc_${contrato.id}`;
  const [docEditMode, setDocEditMode]   = useState(false);
  const [savedDocHtml, setSavedDocHtml] = useState<string | null>(() => {
    try { return localStorage.getItem(`gapmn_aditivo_doc_${contrato.id}`); } catch { return null; }
  });

  // Conecta handlers de quebra de página ao entrar em modo de edição
  useEffect(() => {
    const el = docRef.current;
    if (!el || !docEditMode) return;
    el.querySelectorAll<HTMLElement>("[data-quebra]").forEach(e => {
      e.onclick = () => e.remove();
      e.style.cursor = "pointer";
    });
  }, [docEditMode, savedDocHtml]);

  // Carrega modelo do usuário do Supabase se não houver HTML salvo localmente
  useEffect(() => {
    if (savedDocHtml) return;
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!user) return;
      supabase.from("document_templates")
        .select("html_content")
        .eq("user_id", user.id)
        .eq("tipo", TEMPLATE_TIPO)
        .maybeSingle()
        .then(({ data }) => {
          if (data?.html_content) setSavedDocHtml(data.html_content);
        });
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function saveDocHtml() {
    const el = docRef.current;
    if (!el) return;
    const clone = el.cloneNode(true) as HTMLElement;
    clone.querySelectorAll("[contenteditable]").forEach(e => { e.removeAttribute("contenteditable"); (e as HTMLElement).style.outline = ""; });
    const html = clone.innerHTML;
    localStorage.setItem(LS_DOC_KEY, html);
    setSavedDocHtml(html);
  }

  function restoreDocHtml() {
    if (!confirm("Restaurar o texto original? Suas edições serão perdidas.")) return;
    localStorage.removeItem(LS_DOC_KEY);
    setSavedDocHtml(null);
    setDocEditMode(false);
  }

  async function salvarComoModelo() {
    const el = docRef.current;
    if (!el) return;
    setSavingTemplate(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { alert("Faça login para salvar um modelo."); return; }
      const clone = el.cloneNode(true) as HTMLElement;
      clone.querySelectorAll("[contenteditable]").forEach(e => e.removeAttribute("contenteditable"));
      const html = clone.innerHTML;
      const { error } = await supabase.from("document_templates").upsert({
        user_id: user.id,
        tipo: TEMPLATE_TIPO,
        html_content: html,
        updated_at: new Date().toISOString(),
      }, { onConflict: "user_id,tipo" });
      if (error) throw error;
      setTemplateSaved(true);
      setTimeout(() => setTemplateSaved(false), 3000);
    } catch (e) {
      alert("Erro ao salvar modelo.");
      console.error(e);
    } finally {
      setSavingTemplate(false);
    }
  }

  useEffect(() => {
    function onKey(e: KeyboardEvent) { if ((e.ctrlKey || e.metaKey) && e.key === "s") { e.preventDefault(); saveDocHtml(); } }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const set = <K extends keyof AditivoCfg>(k: K, v: AditivoCfg[K]) => setDraft(p => ({ ...p, [k]: v }));

  const baseAtual = contrato.vl_atual != null && contrato.vl_atual > 0
    ? contrato.vl_atual
    : contrato.vl_a_empenhar != null && contrato.vl_a_empenhar > 0
    ? contrato.vl_a_empenhar
    : contrato.vl_contratual;

  const fmtBRL = (n: number) => n.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  function setPercAcrescimo(v: string) {
    const pct = parseFloat(v.replace(",", "."));
    if (!isNaN(pct) && pct > 0 && baseAtual != null && baseAtual > 0) {
      const acrescimo = baseAtual * pct / 100;
      const novoValor = baseAtual + acrescimo;
      setDraft(p => ({ ...p, percentualAcrescimo: v, novoValorContrato: fmtBRL(novoValor) }));
    } else {
      set("percentualAcrescimo", v);
    }
  }

  function setPercSupressao(v: string) {
    const pct = parseFloat(v.replace(",", "."));
    if (!isNaN(pct) && pct > 0 && baseAtual != null && baseAtual > 0) {
      const supressao = baseAtual * pct / 100;
      const novoValor = baseAtual - supressao;
      setDraft(p => ({ ...p, percentualSupressao: v, novoValorContrato: fmtBRL(novoValor) }));
    } else {
      set("percentualSupressao", v);
    }
  }

  function salvar() {
    saveCfg(draft);
    setCfg({ ...draft });
    setShowCfg(false);
  }

  function handlePrint() {
    const el = docRef.current;
    if (!el) { window.print(); return; }
    const pw = window.open("", "_blank", "width=900,height=700");
    if (!pw) { window.print(); return; }
    const brasaoEl = el.querySelector("[data-brasao]") as HTMLImageElement | null;
    const src = brasaoEl?.currentSrc || (window.location.origin + "/brasao.png");
    const html = el.outerHTML.replace(/data-brasao="true"\s+src="[^"]*"/, `data-brasao="true" src="${src}"`);
    pw.document.write(`<!DOCTYPE html><html lang="pt-BR"><head><meta charset="utf-8">
<title>${cfg.numeroTermo} Termo Aditivo — ${contrato.numero_contrato}</title>
<style>*{-webkit-print-color-adjust:exact!important;print-color-adjust:exact!important;box-sizing:border-box}
body{margin:0;padding:0;background:#fff;font-family:Arial,Helvetica,sans-serif}
@page{size:A4;margin:0}p{margin:0 0 14px}table{border-collapse:collapse;width:100%}
td,th{border:1px solid #000;padding:4px 6px;font-size:10pt}
th{background:#f0f0f0;font-weight:bold;text-align:center}
.pg{page-break-before:always;break-before:page}
.no-break{page-break-inside:avoid;break-inside:avoid}
tr{page-break-inside:avoid;break-inside:avoid}
[data-quebra]{height:0;overflow:hidden;border:none!important;padding:0!important;margin:0!important;font-size:0!important;color:transparent!important}
</style></head><body>${html}<script>window.onload=function(){window.print()};<\/script></body></html>`);
    pw.document.close();
  }

  function inserirQuebra() {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return;
    const range = sel.getRangeAt(0);
    const div = document.createElement("div");
    div.className = "pg";
    div.setAttribute("data-quebra", "true");
    div.style.cssText = "page-break-before:always;break-before:page;display:block;border-top:2px dashed #93c5fd;margin:12px 0;padding:2px 6px;color:#60a5fa;font-size:9pt;text-align:center;cursor:pointer;";
    div.textContent = "✕ quebra de página — clique para remover";
    div.title = "Clique para remover";
    div.onclick = () => div.remove();
    range.collapse(false);
    range.insertNode(div);
    sel.removeAllRanges();
  }

  async function salvarNoContrato() {
    setSavingDoc(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      const { data: profile } = await supabase.from("profiles").select("nome_guerra").eq("id", user?.id ?? "").maybeSingle();
      const nome = `${ph(cfg.numeroTermo,"1º")} Termo Aditivo — ${contrato.numero_contrato}`;
      await supabase.from("contratos_docs").insert({
        numero_contrato: contrato.numero_contrato,
        tipo: "aditivo",
        nome,
        url: null,
        user_id: user?.id ?? null,
        user_nome: (profile as any)?.nome_guerra ?? user?.email ?? "Usuário",
      });
      setDocSaved(true);
    } finally {
      setSavingDoc(false);
    }
  }

  // ── valores efetivos do doc ──────────────────────────────────────────────
  const numTermo  = ph(cfg.numeroTermo, "1º");
  const extTermo  = toExt(numTermo);
  const numCtr    = ph(contrato.numero_contrato);
  const isProrr   = cfg.tipoAditivo === "prorrogacao";

  // ── estilos do documento ─────────────────────────────────────────────────
  const doc: React.CSSProperties = { fontFamily:"Arial,Helvetica,sans-serif", fontSize:"11pt", color:"#000", lineHeight:"1.65", width:"210mm", minHeight:"297mm", padding:"18mm 22mm", background:"#fff", margin:"0 auto" };
  const p: React.CSSProperties = { textAlign:"justify", marginBottom:"14px" };
  const cl: React.CSSProperties = { fontWeight:"bold", marginTop:"18px", marginBottom:"4px" };
  const sigLn: React.CSSProperties = { borderTop:"1px solid #000", paddingTop:"4px", marginBottom:"36px", textAlign:"center", fontSize:"10pt", width:"60%", margin:"0 auto 28px" };
  const tbl: React.CSSProperties = { width:"100%", borderCollapse:"collapse", marginBottom:"14px", fontSize:"10pt" };
  const td: React.CSSProperties = { border:"1px solid #000", padding:"4px 6px" };
  const th: React.CSSProperties = { ...td, background:"#f0f0f0", fontWeight:"bold", textAlign:"center" };

  // ── cláusula helper ──────────────────────────────────────────────────────
  function Cl({ num, titulo, override, children }: { num: string; titulo: string; override?: string; children: React.ReactNode }) {
    return <>
      <div style={cl}>CLÁUSULA {num} – {titulo}</div>
      {override?.trim() ? <p style={p}>{override}</p> : children}
    </>;
  }

  // ── renderização das cláusulas por tipo ──────────────────────────────────
  function ClausulaObjeto() {
    if (isProrr) {
      return <Cl num="PRIMEIRA" titulo="OBJETO" override={cfg.txtObjeto}>
        <p style={p}>
          O presente termo aditivo tem por objeto a prorrogação do prazo de vigência do Contrato nº <strong>{numCtr}</strong> por mais{" "}
          <strong>{ph(cfg.novoPrazo)} ({ph(cfg.novoPrazo)}) {cfg.unidadePrazo}</strong>, a partir de{" "}
          <strong>{ph(cfg.dataInicioProrrogacao)}</strong> até <strong>{ph(cfg.dataFimProrrogacao)}</strong>, podendo ser prorrogado sucessivamente, respeitada a vigência máxima decenal, na forma do art. 107 da Lei nº 14.133, de 2021.
        </p>
      </Cl>;
    }
    // Acréscimo/Supressão
    return <Cl num="PRIMEIRA" titulo="OBJETO" override={cfg.txtObjeto}>
      <p style={p}>O presente termo aditivo tem por objeto a(s) seguinte(s) alteração(ões) contratual(is):</p>
      {cfg.incluirAcrescimo && (
        <p style={p}>
          <strong>Acréscimo {cfg.tipoQuantQualAcrescimo}</strong> consistente em {ph(cfg.descricaoAcrescimo)}, o que equivale a{" "}
          <strong>{ph(cfg.percentualAcrescimo)}% ({ph(cfg.percentualAcrescimo)} por cento)</strong> do valor inicial atualizado do Contrato, com fundamento no art.{" "}
          <strong>{ph(cfg.artFundamentoAcrescimo)}</strong> da Lei nº 14.133, de 2021.
        </p>
      )}
      {cfg.incluirSupressao && (
        <p style={p}>
          <strong>Supressão {cfg.tipoQuantQualSupressao}</strong> consistente em {ph(cfg.descricaoSupressao)}, o que equivale a{" "}
          <strong>{ph(cfg.percentualSupressao)}% ({ph(cfg.percentualSupressao)} por cento)</strong> do valor inicial atualizado do Contrato, com fundamento no art.{" "}
          <strong>{ph(cfg.artFundamentoSupressao)}</strong> da Lei nº 14.133, de 2021.
        </p>
      )}
    </Cl>;
  }

  function ClausulaPreco() {
    if (isProrr) {
      return <Cl num="SEGUNDA" titulo="PREÇO" override={cfg.txtPreco}>
        <p style={p}>
          O CONTRATANTE pagará ao CONTRATADO pela execução do objeto deste Contrato o valor mensal de{" "}
          <strong>R$ {ph(cfg.valorMensal)}</strong>, totalizando o valor global de <strong>R$ {ph(cfg.valorTotal)}</strong>,
          conforme descrito na Cláusula Primeira do Contrato. O valor acima é meramente estimativo, de forma que os pagamentos
          devidos ao CONTRATADO dependerão dos quantitativos efetivamente prestados.
        </p>
        {cfg.incluirRepactuacao && (
          <p style={p}>
            Fica assegurado ao CONTRATADO o direito à repactuação de valores ainda não adimplidos referentes ao ciclo de
            vigência imediatamente anterior à presente prorrogação, não concedidos e/ou pendentes de solicitação referentes
            ao aumento de custos em razão da homologação de novos Acordos, Convenções ou Dissídios Coletivos de Trabalho,
            desde que atendidos os requisitos preceituados no Termo de Referência.
          </p>
        )}
      </Cl>;
    }
    // Acréscimo
    return <Cl num="SEGUNDA" titulo="PREÇO" override={cfg.txtPreco}>
      {cfg.tipoValorTabela === "global" ? (
        <p style={p}>Com a(s) alteração(ões), o valor da contratação passará a ser <strong>R$ {ph(cfg.novoValorContrato)}</strong>, conforme tabela abaixo:</p>
      ) : (
        <p style={p}>Com a(s) alteração(ões), o valor mensal da contratação passará a ser <strong>R$ {ph(cfg.novoValorMensal)}</strong>, perfazendo o valor anual de <strong>R$ {ph(cfg.novoValorAnual)}</strong>, conforme tabela abaixo:</p>
      )}
      <table style={tbl}>
        <thead>
          <tr>
            <th style={th}>Item/Grupo</th>
            <th style={th}>Descrição do objeto</th>
            <th style={th}>Unidade</th>
            <th style={th}>Valores unitários atuais</th>
            <th style={th}>Valores unitários após acréscimo/supressão</th>
            <th style={th}>Valores Totais</th>
          </tr>
        </thead>
        <tbody>
          {cfg.tabelaItens.map(it => (
            <tr key={it.id}>
              <td style={td}>{it.item || "–"}</td>
              <td style={td}>{it.descricao || "–"}</td>
              <td style={td}>{it.unidade || "–"}</td>
              <td style={{ ...td, textAlign: "right" }}>{it.vlAtual || "–"}</td>
              <td style={{ ...td, textAlign: "right" }}>{it.vlNovo || "–"}</td>
              <td style={{ ...td, textAlign: "right" }}>{it.vlTotal || "–"}</td>
            </tr>
          ))}
          <tr>
            <td style={{ ...td, fontWeight: "bold", textAlign: "right" }} colSpan={5}>TOTAL</td>
            <td style={{ ...td, fontWeight: "bold", textAlign: "right" }}>{cfg.novoValorContrato || "–"}</td>
          </tr>
        </tbody>
      </table>
      <p style={p}>O valor acima é meramente estimativo, de forma que os pagamentos devidos ao CONTRATADO dependerão dos quantitativos efetivamente prestados.</p>
    </Cl>;
  }

  function ClausulaGarantia(numCl: string) {
    return <Cl num={numCl} titulo="GARANTIA DE EXECUÇÃO" override={cfg.txtGarantia}>
      {isProrr ? (
        <p style={p}>
          O CONTRATADO deverá renovar a garantia prestada, no valor de <strong>R$ {ph(cfg.garantiaValor)}</strong>, correspondente a{" "}
          <strong>{ph(cfg.garantiaPerc)}% ({ph(cfg.garantiaPerc)} por cento)</strong> do valor global do presente termo aditivo, no prazo de{" "}
          <strong>{ph(cfg.garantiaDias)} dias</strong>, a contar da assinatura deste instrumento, prorrogáveis por igual período, a critério da CONTRATANTE.
        </p>
      ) : (
        <>
          <p style={p}>
            O CONTRATADO deverá adequar a garantia contratual anteriormente prestada, mantendo a proporção de{" "}
            <strong>{ph(cfg.garantiaPerc)}% ({ph(cfg.garantiaPerc)} por cento)</strong> em relação ao valor global do contrato, no prazo de{" "}
            <strong>{ph(cfg.garantiaDias)} dias</strong>, a contar da assinatura deste instrumento, prorrogáveis por igual período, a critério da CONTRATANTE.
          </p>
          {cfg.incluirSupressao && (
            <p style={p}>No caso de supressão do objeto, fica facultada ao CONTRATADO a manutenção da garantia contratual já oferecida.</p>
          )}
        </>
      )}
    </Cl>;
  }

  // Numeração dinâmica das cláusulas
  let clNum = 2; // Objeto = 1, Preço = 2
  const nextCl = () => { clNum++; return numToOrdinalTitle(clNum); };
  function numToOrdinalTitle(n: number): string {
    const nomes = ["","PRIMEIRA","SEGUNDA","TERCEIRA","QUARTA","QUINTA","SEXTA","SÉTIMA","OITAVA","NONA","DÉCIMA"];
    return nomes[n] ?? String(n) + "ª";
  }

  // Cláusulas em ordem dinâmica
  const clDotacao      = nextCl(); // 3
  const clGarantiaNum  = cfg.clGarantia ? nextCl() : "";
  const clIntegNum     = cfg.clProgramaIntegridade ? nextCl() : "";
  const clEfeitosNum   = nextCl();
  const clRatifNum     = nextCl();
  const clPubNum       = nextCl();

  return (
    <div className="apt-modal-bg fixed inset-0 z-[9999] flex flex-col bg-slate-200 overflow-hidden">

      {/* ── Barra superior ── */}
      <div className="print:hidden shrink-0 flex items-center justify-between gap-3 bg-slate-800 px-4 py-2 text-white">
        <div className="text-sm font-semibold truncate">
          {numTermo} Termo Aditivo {isProrr ? "(Prorrogação)" : "(Acréscimo/Supressão)"} — {contrato.numero_contrato}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button onClick={() => { setDraft({ ...cfg }); setShowCfg(v => !v); }}
            className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${showCfg ? "bg-slate-600 text-slate-200" : "bg-amber-500 hover:bg-amber-400 text-white"}`}>
            ✏️ {showCfg ? "Fechar painel" : "Editar campos"}
          </button>
          <button
            onClick={() => {
              if (!docEditMode && !savedDocHtml) {
                setSavedDocHtml(docRef.current?.innerHTML ?? "");
              }
              setDocEditMode(v => !v);
            }}
            className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
              docEditMode ? "bg-emerald-600 text-white" : "bg-slate-600 hover:bg-slate-500 text-slate-200"
            }`}
            title="Edição livre — use a barra de formatação para negrito, fonte, tamanho, etc."
          >
            {docEditMode ? "📝 Editando…" : "📝 Editar texto"}
          </button>
          {docEditMode && (
            <button onClick={saveDocHtml}
              className="flex items-center gap-1.5 rounded-lg bg-green-600 hover:bg-green-500 px-3 py-1.5 text-xs font-medium text-white"
              title="Salvar edições deste documento (Ctrl+S)">
              💾 Salvar
            </button>
          )}
          <button
            onClick={salvarComoModelo}
            disabled={savingTemplate}
            title="Salvar o documento atual como modelo padrão para futuros termos aditivos"
            className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
              templateSaved
                ? "bg-teal-700 text-teal-200 cursor-default"
                : "bg-teal-600 hover:bg-teal-500 text-white disabled:opacity-60"
            }`}
          >
            {templateSaved ? "✓ Modelo salvo!" : savingTemplate ? "Salvando…" : "📋 Salvar como modelo"}
          </button>
          {savedDocHtml && (
            <button onClick={restoreDocHtml}
              className="flex items-center gap-1.5 rounded-lg bg-rose-700 hover:bg-rose-600 px-3 py-1.5 text-xs font-medium text-white"
              title="Apagar edições e restaurar o texto gerado automaticamente">
              🔄 Original
            </button>
          )}
          <button onClick={handlePrint}
            className="flex items-center gap-1.5 rounded-lg bg-sky-600 hover:bg-sky-500 px-3 py-1.5 text-xs font-medium text-white">
            🖨 Imprimir / PDF
          </button>
          <button onClick={salvarNoContrato} disabled={savingDoc || docSaved}
            className="flex items-center gap-1.5 rounded-lg bg-emerald-700 hover:bg-emerald-600 disabled:opacity-60 px-3 py-1.5 text-xs font-medium text-white"
            title="Registra este documento no histórico do contrato">
            {docSaved ? "✓ Salvo" : savingDoc ? "..." : "💾 Salvar no contrato"}
          </button>
          <button onClick={onClose} className="text-slate-400 hover:text-white text-xl px-2 leading-none">✕</button>
        </div>
      </div>

      {docEditMode && <DocFormatBar docRef={docRef} onInsertBreak={inserirQuebra} />}

      <div className="flex flex-1 overflow-hidden print:block print:overflow-visible">

        {/* ── Painel lateral ── */}
        {showCfg && (
          <div className="modal-card apt-cfg-panel print:hidden w-80 shrink-0 bg-white border-r border-slate-200 overflow-y-auto flex flex-col">

            {/* Abas do painel */}
            <div className="flex border-b text-xs">
              {(["campos","clausulas","notas"] as const).map(tab => (
                <button key={tab} onClick={() => setActiveTab(tab)}
                  className={`flex-1 py-2 font-semibold capitalize transition-colors ${activeTab === tab ? "bg-sky-50 text-sky-700 border-b-2 border-sky-500" : "text-slate-500 hover:bg-slate-50"}`}>
                  {tab === "campos" ? "📝 Campos" : tab === "clausulas" ? "🔧 Cláusulas" : "💡 Notas AGU"}
                </button>
              ))}
            </div>

            <div className="p-4 space-y-4 flex-1 overflow-y-auto">

              {/* ── ABA CAMPOS ── */}
              {activeTab === "campos" && <>

                {/* Tipo */}
                <div>
                  <div className="text-[11px] font-bold text-sky-700 uppercase tracking-wide border-b pb-0.5 mb-2">Tipo de Aditivo</div>
                  {[{ id:"prorrogacao",label:"Prorrogação de Prazo" },{ id:"alteracao",label:"Acréscimo / Supressão" }].map(t => (
                    <label key={t.id} className="flex items-center gap-2 text-xs text-slate-700 cursor-pointer mb-1.5">
                      <input type="radio" name="tipoAditivo" value={t.id}
                        checked={draft.tipoAditivo === t.id}
                        onChange={() => setDraft(p => ({ ...p, tipoAditivo: t.id as TipoAditivo }))} />
                      {t.label}
                    </label>
                  ))}
                </div>

                {/* Brasão */}
                <div>
                  <div className="text-[11px] font-bold text-sky-700 uppercase tracking-wide border-b pb-0.5 mb-2">Brasão</div>
                  <label className="block text-[10px] font-semibold text-slate-400 mb-0.5">Tamanho ({draft.brasaoSize}px)</label>
                  <input type="range" min={60} max={200} value={draft.brasaoSize}
                    onChange={e => set("brasaoSize", Number(e.target.value))}
                    className="w-full accent-sky-600" />
                  <div className="flex justify-between text-[10px] text-slate-400 mt-0.5"><span>60px</span><span>200px</span></div>
                </div>

                {/* Identificação */}
                <div>
                  <div className="text-[11px] font-bold text-sky-700 uppercase tracking-wide border-b pb-0.5 mb-2">Identificação</div>
                  {([
                    { k:"numeroTermo",    lb:"Número ordinal (ex: 1º)" },
                    { k:"nupProcesso",    lb:"NUP do processo" },
                    { k:"local",          lb:"Local de assinatura" },
                    { k:"dataAssinatura", lb:"Data de assinatura (ex: 15 de maio de 2026)" },
                  ] as {k:keyof AditivoCfg;lb:string}[]).map(({k,lb}) => (
                    <div key={k} className="mb-1.5">
                      <label className="block text-[10px] font-semibold text-slate-400 mb-0.5">{lb}</label>
                      <input value={draft[k] as string} onChange={e => set(k, e.target.value as never)}
                        className="w-full rounded-lg border px-2 py-1 text-xs outline-none focus:ring-1 focus:ring-sky-200" />
                    </div>
                  ))}
                </div>

                {/* Ordenadora */}
                <div>
                  <div className="text-[11px] font-bold text-sky-700 uppercase tracking-wide border-b pb-0.5 mb-2">Ordenadora de Despesa</div>
                  {([
                    { k:"ordenadoraNome",          lb:"Nome completo" },
                    { k:"ordenadoraGraduacao",     lb:"Posto/Graduação" },
                    { k:"ordenadoraPortaria",      lb:"Portaria nº" },
                    { k:"ordenadoraPortariaData",  lb:"Data da portaria" },
                    { k:"ordenadoraBoletim",       lb:"Boletim Interno Ostensivo nº" },
                    { k:"ordenadoraBoletimData",   lb:"Data do boletim (ex: 12 de setembro de 2024)" },
                    { k:"ordenadoraMatricula",     lb:"Matrícula SIAPE" },
                  ] as {k:keyof AditivoCfg;lb:string}[]).map(({k,lb}) => (
                    <div key={k} className="mb-1.5">
                      <label className="block text-[10px] font-semibold text-slate-400 mb-0.5">{lb}</label>
                      <input value={draft[k] as string} onChange={e => set(k, e.target.value as never)}
                        className="w-full rounded-lg border px-2 py-1 text-xs outline-none focus:ring-1 focus:ring-sky-200" />
                    </div>
                  ))}
                </div>

                {/* Contratada */}
                <div>
                  <div className="text-[11px] font-bold text-sky-700 uppercase tracking-wide border-b pb-0.5 mb-2">Contratada</div>
                  {([
                    { k:"contratadaEndereco",      lb:"Endereço (rua, nº, bairro)" },
                    { k:"contratadaCidade",        lb:"Cidade" },
                    { k:"contratadaUF",            lb:"UF" },
                    { k:"contratadaRepresentante", lb:"Nome do representante legal" },
                  ] as {k:keyof AditivoCfg;lb:string}[]).map(({k,lb}) => (
                    <div key={k} className="mb-1.5">
                      <label className="block text-[10px] font-semibold text-slate-400 mb-0.5">{lb}</label>
                      <input value={draft[k] as string} onChange={e => set(k, e.target.value as never)}
                        className="w-full rounded-lg border px-2 py-1 text-xs outline-none focus:ring-1 focus:ring-sky-200" />
                    </div>
                  ))}
                </div>

                {/* Campos específicos por tipo */}
                {draft.tipoAditivo === "prorrogacao" ? (
                  <div>
                    <div className="text-[11px] font-bold text-sky-700 uppercase tracking-wide border-b pb-0.5 mb-2">Prorrogação</div>
                    <div className="flex gap-2 mb-1.5">
                      <div className="flex-1">
                        <label className="block text-[10px] font-semibold text-slate-400 mb-0.5">Prazo</label>
                        <input value={draft.novoPrazo} onChange={e => set("novoPrazo", e.target.value)}
                          className="w-full rounded-lg border px-2 py-1 text-xs outline-none focus:ring-1 focus:ring-sky-200" />
                      </div>
                      <div>
                        <label className="block text-[10px] font-semibold text-slate-400 mb-0.5">Unidade</label>
                        <select value={draft.unidadePrazo} onChange={e => set("unidadePrazo", e.target.value as "meses"|"anos")}
                          className="rounded-lg border px-2 py-1 text-xs outline-none focus:ring-1 focus:ring-sky-200">
                          <option value="meses">meses</option>
                          <option value="anos">anos</option>
                        </select>
                      </div>
                    </div>
                    {([
                      { k:"dataInicioProrrogacao", lb:"Data de início (dd/mm/aaaa)" },
                      { k:"dataFimProrrogacao",    lb:"Data de término (dd/mm/aaaa)" },
                      { k:"valorMensal",           lb:"Valor mensal (R$)" },
                      { k:"valorTotal",            lb:"Valor global estimado (R$)" },
                    ] as {k:keyof AditivoCfg;lb:string}[]).map(({k,lb}) => (
                      <div key={k} className="mb-1.5">
                        <label className="block text-[10px] font-semibold text-slate-400 mb-0.5">{lb}</label>
                        <input value={draft[k] as string} onChange={e => set(k, e.target.value as never)}
                          className="w-full rounded-lg border px-2 py-1 text-xs outline-none focus:ring-1 focus:ring-sky-200" />
                      </div>
                    ))}
                    <label className="flex items-center gap-2 text-xs text-slate-600 cursor-pointer mt-1">
                      <input type="checkbox" checked={draft.incluirRepactuacao} onChange={e => set("incluirRepactuacao", e.target.checked)} />
                      Incluir cláusula de repactuação salarial
                    </label>
                  </div>
                ) : (
                  <div>
                    <div className="text-[11px] font-bold text-sky-700 uppercase tracking-wide border-b pb-0.5 mb-2">Alteração Contratual</div>
                    <label className="flex items-center gap-2 text-xs text-slate-600 cursor-pointer mb-1.5">
                      <input type="checkbox" checked={draft.incluirAcrescimo} onChange={e => set("incluirAcrescimo", e.target.checked)} />
                      Incluir acréscimo
                    </label>
                    {draft.incluirAcrescimo && <>
                      {([
                        { k:"tipoQuantQualAcrescimo", lb:"Tipo (quantitativo / qualitativo / quantitativo e qualitativo)" },
                        { k:"descricaoAcrescimo",     lb:"Descrição do acréscimo" },
                        { k:"artFundamentoAcrescimo", lb:"Art. da Lei 14.133/21 (ex: 124, inciso I)" },
                      ] as {k:keyof AditivoCfg;lb:string}[]).map(({k,lb}) => (
                        <div key={k} className="mb-1.5">
                          <label className="block text-[10px] font-semibold text-slate-400 mb-0.5">{lb}</label>
                          <input value={draft[k] as string} onChange={e => set(k, e.target.value as never)}
                            className="w-full rounded-lg border px-2 py-1 text-xs outline-none focus:ring-1 focus:ring-sky-200" />
                        </div>
                      ))}
                      <div className="mb-1.5">
                        <label className="block text-[10px] font-semibold text-slate-400 mb-0.5">Percentual de acréscimo (ex: 25)</label>
                        <input value={draft.percentualAcrescimo} onChange={e => setPercAcrescimo(e.target.value)}
                          className="w-full rounded-lg border px-2 py-1 text-xs outline-none focus:ring-1 focus:ring-green-300" />
                        {draft.percentualAcrescimo && baseAtual != null && (() => {
                          const pct = parseFloat(draft.percentualAcrescimo.replace(",", "."));
                          if (isNaN(pct) || pct <= 0) return null;
                          const acrescimo = baseAtual * pct / 100;
                          const novo = baseAtual + acrescimo;
                          return (
                            <div className="mt-1 rounded-lg bg-green-50 border border-green-200 px-2 py-1.5 text-[11px] text-green-800">
                              📊 {pct.toLocaleString("pt-BR")}% de R$ {fmtBRL(baseAtual)} = <strong>+R$ {fmtBRL(acrescimo)}</strong>
                              <br/>→ Novo valor: <strong className="text-green-900">R$ {fmtBRL(novo)}</strong>
                            </div>
                          );
                        })()}
                      </div>
                    </>}
                    <label className="flex items-center gap-2 text-xs text-slate-600 cursor-pointer mb-1.5 mt-1">
                      <input type="checkbox" checked={draft.incluirSupressao} onChange={e => set("incluirSupressao", e.target.checked)} />
                      Incluir supressão
                    </label>
                    {draft.incluirSupressao && <>
                      {([
                        { k:"tipoQuantQualSupressao", lb:"Tipo (quantitativo / qualitativo)" },
                        { k:"descricaoSupressao",     lb:"Descrição da supressão" },
                        { k:"artFundamentoSupressao", lb:"Art. da Lei 14.133/21" },
                      ] as {k:keyof AditivoCfg;lb:string}[]).map(({k,lb}) => (
                        <div key={k} className="mb-1.5">
                          <label className="block text-[10px] font-semibold text-slate-400 mb-0.5">{lb}</label>
                          <input value={draft[k] as string} onChange={e => set(k, e.target.value as never)}
                            className="w-full rounded-lg border px-2 py-1 text-xs outline-none focus:ring-1 focus:ring-sky-200" />
                        </div>
                      ))}
                      <div className="mb-1.5">
                        <label className="block text-[10px] font-semibold text-slate-400 mb-0.5">Percentual de supressão (ex: 10)</label>
                        <input value={draft.percentualSupressao} onChange={e => setPercSupressao(e.target.value)}
                          className="w-full rounded-lg border px-2 py-1 text-xs outline-none focus:ring-1 focus:ring-red-200" />
                        {draft.percentualSupressao && baseAtual != null && (() => {
                          const pct = parseFloat(draft.percentualSupressao.replace(",", "."));
                          if (isNaN(pct) || pct <= 0) return null;
                          const supressao = baseAtual * pct / 100;
                          const novo = baseAtual - supressao;
                          return (
                            <div className="mt-1 rounded-lg bg-red-50 border border-red-200 px-2 py-1.5 text-[11px] text-red-800">
                              📊 {pct.toLocaleString("pt-BR")}% de R$ {fmtBRL(baseAtual)} = <strong>−R$ {fmtBRL(supressao)}</strong>
                              <br/>→ Novo valor: <strong className="text-red-900">R$ {fmtBRL(novo)}</strong>
                            </div>
                          );
                        })()}
                      </div>
                    </>}

                    <div className="text-[10px] font-semibold text-slate-400 mt-2 mb-0.5">Tipo de tabela de preços</div>
                    <div className="flex gap-3 mb-2">
                      {[{v:"global",l:"Valor global"},{v:"mensal",l:"Mensal + anual"}].map(o => (
                        <label key={o.v} className="flex items-center gap-1 text-xs cursor-pointer">
                          <input type="radio" name="tipoTabela" value={o.v}
                            checked={draft.tipoValorTabela === o.v}
                            onChange={() => set("tipoValorTabela", o.v as "global"|"mensal")} />
                          {o.l}
                        </label>
                      ))}
                    </div>
                    {draft.tipoValorTabela === "global"
                      ? <div className="mb-1.5"><label className="block text-[10px] font-semibold text-slate-400 mb-0.5">Novo valor global (R$)</label>
                          <input value={draft.novoValorContrato} onChange={e => set("novoValorContrato", e.target.value)}
                            className="w-full rounded-lg border px-2 py-1 text-xs outline-none focus:ring-1 focus:ring-sky-200" /></div>
                      : <>
                          <div className="mb-1.5"><label className="block text-[10px] font-semibold text-slate-400 mb-0.5">Novo valor mensal (R$)</label>
                            <input value={draft.novoValorMensal} onChange={e => set("novoValorMensal", e.target.value)}
                              className="w-full rounded-lg border px-2 py-1 text-xs outline-none focus:ring-1 focus:ring-sky-200" /></div>
                          <div className="mb-1.5"><label className="block text-[10px] font-semibold text-slate-400 mb-0.5">Novo valor anual (R$)</label>
                            <input value={draft.novoValorAnual} onChange={e => set("novoValorAnual", e.target.value)}
                              className="w-full rounded-lg border px-2 py-1 text-xs outline-none focus:ring-1 focus:ring-sky-200" /></div>
                        </>
                    }

                    {/* Tabela de itens */}
                    <div className="text-[10px] font-semibold text-sky-700 mt-2 mb-1">Itens da tabela de preços</div>
                    {draft.tabelaItens.map((it, idx) => (
                      <div key={it.id} className="border rounded-lg p-2 mb-1.5 space-y-1 bg-slate-50">
                        <div className="flex justify-between items-center">
                          <span className="text-[10px] font-semibold text-slate-500">Item {idx + 1}</span>
                          <button onClick={() => set("tabelaItens", draft.tabelaItens.filter(i => i.id !== it.id))}
                            className="text-red-400 hover:text-red-600 text-[10px]">✕</button>
                        </div>
                        {(["item","descricao","unidade","vlAtual","vlNovo","vlTotal"] as (keyof ItemTabela)[]).map(f => (
                          <input key={f} placeholder={f === "item" ? "Nº" : f === "descricao" ? "Descrição" : f === "unidade" ? "Unidade" : f === "vlAtual" ? "Valor atual" : f === "vlNovo" ? "Valor novo" : "Total"}
                            value={it[f]}
                            onChange={e => set("tabelaItens", draft.tabelaItens.map(i => i.id === it.id ? { ...i, [f]: e.target.value } : i))}
                            className="w-full rounded border px-2 py-0.5 text-xs outline-none focus:ring-1 focus:ring-sky-200" />
                        ))}
                      </div>
                    ))}
                    <button onClick={() => set("tabelaItens", [...draft.tabelaItens, ITEM_BLANK()])}
                      className="w-full rounded-lg border border-dashed border-sky-300 py-1 text-xs text-sky-600 hover:bg-sky-50">
                      + Adicionar item
                    </button>
                  </div>
                )}

                {/* Dotação */}
                <div>
                  <div className="text-[11px] font-bold text-sky-700 uppercase tracking-wide border-b pb-0.5 mb-2">Dotação Orçamentária</div>
                  {([
                    { k:"dotacaoGestao",   lb:"Gestão/Unidade" },
                    { k:"dotacaoFonte",    lb:"Fonte de recursos" },
                    { k:"dotacaoPrograma", lb:"Programa de trabalho" },
                    { k:"dotacaoElemento", lb:"Elemento de despesa" },
                    { k:"dotacaoPlano",    lb:"Plano interno" },
                    { k:"dotacaoNE",       lb:"Nota de Empenho" },
                  ] as {k:keyof AditivoCfg;lb:string}[]).map(({k,lb}) => (
                    <div key={k} className="mb-1.5">
                      <label className="block text-[10px] font-semibold text-slate-400 mb-0.5">{lb}</label>
                      <input value={draft[k] as string} onChange={e => set(k, e.target.value as never)}
                        className="w-full rounded-lg border px-2 py-1 text-xs outline-none focus:ring-1 focus:ring-sky-200" />
                    </div>
                  ))}
                </div>

                {/* Garantia */}
                {draft.clGarantia && (
                  <div>
                    <div className="text-[11px] font-bold text-sky-700 uppercase tracking-wide border-b pb-0.5 mb-2">Garantia de Execução</div>
                    {([
                      { k:"garantiaValor", lb:"Valor da garantia (R$)" },
                      { k:"garantiaPerc",  lb:"Percentual (%)" },
                      { k:"garantiaDias",  lb:"Prazo para renovação (dias)" },
                    ] as {k:keyof AditivoCfg;lb:string}[]).map(({k,lb}) => (
                      <div key={k} className="mb-1.5">
                        <label className="block text-[10px] font-semibold text-slate-400 mb-0.5">{lb}</label>
                        <input value={draft[k] as string} onChange={e => set(k, e.target.value as never)}
                          className="w-full rounded-lg border px-2 py-1 text-xs outline-none focus:ring-1 focus:ring-sky-200" />
                      </div>
                    ))}
                  </div>
                )}

                {/* Produção de efeitos */}
                <div>
                  <div className="text-[11px] font-bold text-sky-700 uppercase tracking-wide border-b pb-0.5 mb-2">Produção de Efeitos</div>
                  <div className="flex gap-3 mb-2">
                    {[{v:"assinatura",l:"Da assinatura"},{v:"data",l:"Data específica"}].map(o => (
                      <label key={o.v} className="flex items-center gap-1 text-xs cursor-pointer">
                        <input type="radio" name="efeitoTipo" value={o.v}
                          checked={draft.producaoEfeitoTipo === o.v}
                          onChange={() => set("producaoEfeitoTipo", o.v as "assinatura"|"data")} />
                        {o.l}
                      </label>
                    ))}
                  </div>
                  {draft.producaoEfeitoTipo === "data" && (
                    <input placeholder="dd/mm/aaaa" value={draft.producaoEfeitoData} onChange={e => set("producaoEfeitoData", e.target.value)}
                      className="w-full rounded-lg border px-2 py-1 text-xs outline-none focus:ring-1 focus:ring-sky-200" />
                  )}
                </div>

                {/* Assinaturas */}
                <div>
                  <div className="text-[11px] font-bold text-sky-700 uppercase tracking-wide border-b pb-0.5 mb-2">Assinaturas — CONTRATANTE</div>
                  {sigs.map((sig, i) => (
                    <div key={sig.id} className="border rounded-lg p-2 space-y-1 bg-slate-50 mb-1.5">
                      <div className="flex justify-between">
                        <span className="text-[10px] font-semibold text-slate-500">Signatário {i + 1}</span>
                        <button onClick={() => setSigs(p => p.filter(s => s.id !== sig.id))} className="text-red-400 text-xs">✕</button>
                      </div>
                      <input placeholder="Nome" value={sig.nome}
                        onChange={e => setSigs(p => p.map(s => s.id === sig.id ? { ...s, nome: e.target.value } : s))}
                        className="w-full rounded border px-2 py-0.5 text-xs outline-none focus:ring-1 focus:ring-sky-200" />
                      <input placeholder="Cargo" value={sig.cargo}
                        onChange={e => setSigs(p => p.map(s => s.id === sig.id ? { ...s, cargo: e.target.value } : s))}
                        className="w-full rounded border px-2 py-0.5 text-xs outline-none focus:ring-1 focus:ring-sky-200" />
                    </div>
                  ))}
                  <button onClick={() => setSigs(p => [...p, { id:`s${Date.now()}`, nome:"", cargo:"" }])}
                    className="w-full rounded-lg border border-dashed border-sky-300 py-1 text-xs text-sky-600 hover:bg-sky-50">+ Signatário</button>
                  <div className="text-[11px] font-bold text-sky-700 uppercase tracking-wide border-b pb-0.5 mt-3 mb-2">Representante — CONTRATADA</div>
                  <input placeholder="Nome do representante legal" value={draft.contratadaRepresentante}
                    onChange={e => set("contratadaRepresentante", e.target.value)}
                    className="w-full rounded-lg border px-2 py-1 text-xs outline-none focus:ring-1 focus:ring-sky-200" />
                </div>
              </>}

              {/* ── ABA CLÁUSULAS ── */}
              {activeTab === "clausulas" && <>
                <div className="text-xs text-slate-500 leading-relaxed">
                  Ative/desative cláusulas e sobrescreva o texto de qualquer uma delas. Texto em branco = usa o padrão AGU.
                </div>

                {/* Toggles */}
                <div className="space-y-2">
                  {[
                    { k:"clGarantia"           as keyof AditivoCfg, lb:"Cláusula Garantia de Execução" },
                    { k:"clProgramaIntegridade" as keyof AditivoCfg, lb:"Cláusula Programa de Integridade" },
                  ].map(({k,lb}) => (
                    <label key={k} className="flex items-center gap-2 text-xs text-slate-700 cursor-pointer rounded-lg border px-3 py-2 hover:bg-slate-50">
                      <input type="checkbox" checked={draft[k] as boolean} onChange={e => set(k, e.target.checked as never)} />
                      {lb}
                    </label>
                  ))}
                </div>

                {/* Overrides de texto */}
                <div className="text-[11px] font-bold text-slate-600 border-b pb-0.5 mt-2">Override de texto por cláusula</div>
                <p className="text-[10px] text-slate-400">Deixe em branco para usar o texto padrão AGU.</p>
                {([
                  { k:"txtObjeto",      lb:"Cláusula Primeira — Objeto" },
                  { k:"txtPreco",       lb:"Cláusula Segunda — Preço" },
                  { k:"txtDotacao",     lb:"Cláusula Dotação Orçamentária" },
                  { k:"txtGarantia",    lb:"Cláusula Garantia de Execução" },
                  { k:"txtIntegridade", lb:"Cláusula Programa de Integridade" },
                  { k:"txtEfeitos",     lb:"Cláusula Produção de Efeitos" },
                  { k:"txtRatificacao", lb:"Cláusula Ratificação" },
                  { k:"txtPublicacao",  lb:"Cláusula Publicação" },
                ] as {k:keyof AditivoCfg;lb:string}[]).map(({k,lb}) => (
                  <div key={k}>
                    <label className="block text-[10px] font-semibold text-slate-400 mb-0.5">{lb}</label>
                    <textarea value={draft[k] as string} onChange={e => set(k, e.target.value as never)}
                      placeholder="(padrão AGU)" rows={2}
                      className="w-full rounded-lg border px-2 py-1 text-xs outline-none focus:ring-1 focus:ring-sky-200 resize-none" />
                  </div>
                ))}
              </>}

              {/* ── ABA NOTAS AGU ── */}
              {activeTab === "notas" && <>
                <p className="text-xs text-slate-500 leading-relaxed">
                  Orientações oficiais da AGU para cada cláusula. Não são impressas no documento.
                </p>
                {(Object.entries(NOTAS) as [NotaKey, string][]).map(([key, texto]) => (
                  <div key={key} className="border rounded-lg overflow-hidden">
                    <button
                      onClick={() => setOpenNota(openNota === key ? null : key)}
                      className="w-full flex items-center justify-between px-3 py-2 text-xs font-semibold text-sky-800 bg-sky-50 hover:bg-sky-100 transition-colors text-left"
                    >
                      <span>💡 {key.replace(/_/g," ").replace(/\b\w/g,c=>c.toUpperCase())}</span>
                      <span>{openNota === key ? "▲" : "▼"}</span>
                    </button>
                    {openNota === key && (
                      <div className="px-3 py-2 text-[11px] text-slate-700 leading-relaxed bg-white">
                        {texto}
                      </div>
                    )}
                  </div>
                ))}
              </>}
            </div>

            {/* Salvar */}
            <div className="p-4 border-t shrink-0">
              <button onClick={salvar}
                className="w-full rounded-xl bg-sky-600 hover:bg-sky-500 text-white py-2 text-sm font-semibold transition-colors">
                ✓ Salvar e aplicar
              </button>
            </div>
          </div>
        )}

        {/* ── DOCUMENTO ── */}
        <div className="flex-1 overflow-y-auto bg-slate-300 print:bg-white p-6 print:p-0">
          {savedDocHtml ? (
            <div ref={docRef} style={doc} contentEditable={docEditMode} suppressContentEditableWarning dangerouslySetInnerHTML={{ __html: savedDocHtml }} />
          ) : (
          <div ref={docRef} style={doc} contentEditable={docEditMode} suppressContentEditableWarning>

            {/* Timbre */}
            <div style={{ textAlign:"center", marginBottom:"18px" }}>
              <img data-brasao="true" src="/brasao.png" style={{ width:`${cfg.brasaoSize}px`, height:`${cfg.brasaoSize}px`, objectFit:"contain", display:"block", margin:"0 auto 8px" }}
                onError={e => { (e.target as HTMLImageElement).src = "https://upload.wikimedia.org/wikipedia/commons/thumb/0/05/Brasao_de_armas_oficiais_do_Brasil.svg/240px-Brasao_de_armas_oficiais_do_Brasil.svg.png"; }} />
              <div style={{ fontWeight:"bold", fontSize:"10pt" }}>MINISTÉRIO DA DEFESA</div>
              <div style={{ fontWeight:"bold", fontSize:"10pt" }}>COMANDO DA AERONÁUTICA</div>
              <div style={{ fontWeight:"bold", fontSize:"10pt", textDecoration:"underline" }}>GRUPAMENTO DE APOIO DE MANAUS</div>
            </div>

            {/* Cabeçalho */}
            <div style={{ textAlign:"center", fontSize:"9pt", color:"#555", marginBottom:"4px" }}>
              Processo Administrativo nº {ph(cfg.nupProcesso)}
            </div>
            <div style={{ textAlign:"center", fontWeight:"bold", fontSize:"13pt", marginBottom:"4px", textTransform:"uppercase" }}>
              {numTermo} ({extTermo}) TERMO ADITIVO
            </div>
            <div style={{ textAlign:"center", fontWeight:"bold", fontSize:"10pt", marginBottom:"4px" }}>
              AO CONTRATO Nº {numCtr}
            </div>
            <div style={{ textAlign:"center", fontSize:"10pt", color:"#444", marginBottom:"18px" }}>
              {isProrr ? "Prorrogação do Prazo de Vigência — Lei nº 14.133, de 1º de abril de 2021"
                       : "Acréscimo e/ou Supressão Contratual — Lei nº 14.133, de 1º de abril de 2021"}
            </div>

            {/* Qualificação das partes */}
            <p style={p}>
              A União, Ministério da Defesa, por meio do Comando da Aeronáutica representada pelo{" "}
              <strong>GRUPAMENTO DE APOIO DE MANAUS</strong>, com sede na Avenida Rodrigo Otávio, nº 700 – Crespo,
              na cidade de Manaus/AM, CEP 69.073-177, inscrito no CNPJ sob o nº <strong>00.394.429/0188-24</strong>,
              neste ato representado pela Ordenadora de Despesa, a Srª.{" "}
              <strong>{ph(cfg.ordenadoraNome)}</strong>,{" "}
              <strong>{ph(cfg.ordenadoraGraduacao)}</strong>, nomeada pela{" "}
              PORTARIA {ph(cfg.ordenadoraPortaria)}, DE {ph(cfg.ordenadoraPortariaData)},
              publicada no Boletim Interno Ostensivo nº <strong>{ph(cfg.ordenadoraBoletim)}</strong>,
              de <strong>{ph(cfg.ordenadoraBoletimData)}</strong>, portadora da Matrícula Funcional nº{" "}
              <strong>{ph(cfg.ordenadoraMatricula)}</strong>, doravante denominado <strong>CONTRATANTE</strong>,
            </p>

            <p style={p}>
              e <strong>{ph(contrato.fornecedor)}</strong>, inscrito no CNPJ/MF sob o nº{" "}
              <strong>{ph(contrato.cnpj)}</strong>, sediado no(a){" "}
              {ph(cfg.contratadaEndereco)}, na cidade de {ph(cfg.contratadaCidade)}/{ph(cfg.contratadaUF)},
              doravante designado <strong>CONTRATADO</strong>, neste ato representado por{" "}
              <strong>{ph(cfg.contratadaRepresentante)}</strong>,
            </p>

            <p style={p}>
              tendo em vista o que consta no Processo nº <strong>{ph(cfg.nupProcesso)}</strong> e em observância
              às disposições da <strong>Lei nº 14.133, de 1º de abril de 2021</strong>, e demais legislação aplicável,
              resolvem celebrar o presente <strong>{numTermo} ({extTermo}) Termo Aditivo</strong> ao Contrato nº{" "}
              <strong>{numCtr}</strong>, referente a: <em>{ph(contrato.descricao)}</em>,
              mediante as cláusulas e condições a seguir enunciadas.
            </p>

            <ClausulaObjeto />
            <ClausulaPreco />

            {/* Dotação */}
            <Cl num={clDotacao} titulo="DOTAÇÃO ORÇAMENTÁRIA" override={cfg.txtDotacao}>
              <p style={p}>As despesas decorrentes do presente termo aditivo correrão à conta de recursos específicos consignados no Orçamento Geral da União deste exercício, na dotação abaixo discriminada:</p>
              <p style={{ ...p, paddingLeft: "20px" }}>
                Gestão/Unidade: <strong>{ph(cfg.dotacaoGestao)}</strong>;<br />
                Fonte de recursos: <strong>{ph(cfg.dotacaoFonte)}</strong>;<br />
                Programa de trabalho: <strong>{ph(cfg.dotacaoPrograma)}</strong>;<br />
                Elemento de despesa: <strong>{ph(cfg.dotacaoElemento)}</strong>;<br />
                Plano interno: <strong>{ph(cfg.dotacaoPlano)}</strong>;<br />
                Nota de Empenho: <strong>{ph(cfg.dotacaoNE)}</strong>.
              </p>
              <p style={p}>A dotação relativa aos exercícios financeiros subsequentes será indicada após aprovação da Lei Orçamentária respectiva e liberação dos créditos correspondentes, mediante apostilamento.</p>
            </Cl>

            {/* Garantia */}
            {cfg.clGarantia && clGarantiaNum && ClausulaGarantia(clGarantiaNum)}

            {/* Programa de Integridade */}
            {cfg.clProgramaIntegridade && clIntegNum && (
              <Cl num={clIntegNum} titulo="DA OBRIGATORIEDADE DA IMPLANTAÇÃO DO PROGRAMA DE INTEGRIDADE" override={cfg.txtIntegridade}>
                <p style={p}>
                  A implantação do programa de integridade para fins de atendimento do art. 25, §4º, da Lei n. 14.133, de 2021 pela
                  contratada será obrigatória, devendo observar as disposições do Decreto n. 12.304, de 2024 e da Portaria Normativa
                  SE/CGU n. 226, de 9 de setembro de 2025.
                </p>
              </Cl>
            )}

            {/* Produção de Efeitos */}
            <Cl num={clEfeitosNum} titulo="PRODUÇÃO DOS EFEITOS" override={cfg.txtEfeitos}>
              <p style={p}>
                O presente termo aditivo produzirá efeitos a partir{" "}
                {cfg.producaoEfeitoTipo === "assinatura"
                  ? "da data de sua assinatura."
                  : <><strong>{ph(cfg.producaoEfeitoData)}</strong>.</>}
              </p>
            </Cl>

            {/* Ratificação */}
            <Cl num={clRatifNum} titulo="RATIFICAÇÃO" override={cfg.txtRatificacao}>
              <p style={p}>
                Ficam mantidas e ratificadas as demais cláusulas e condições do Contrato nº <strong>{numCtr}</strong> e seus eventuais
                termos aditivos anteriores, naquilo que não contrariem o presente instrumento.
              </p>
            </Cl>

            {/* Publicação */}
            <Cl num={clPubNum} titulo="PUBLICAÇÃO" override={cfg.txtPublicacao}>
              <p style={p}>
                Incumbirá ao CONTRATANTE divulgar o presente instrumento no Portal Nacional de Contratações Públicas (PNCP), na
                forma prevista no art. 94 da Lei nº 14.133, de 2021, bem como no respectivo sítio oficial na Internet, em atenção
                ao art. 91, <em>caput</em>, da Lei nº 14.133, de 2021, e ao art. 8º, §2º, da Lei nº 12.527, de 2011, c/c art. 7º,
                §3º, inciso V, do Decreto nº 7.724, de 2012.
              </p>
            </Cl>

            {/* Local e data */}
            <p style={{ ...p, textAlign:"center", marginTop:"24px" }}>
              {ph(cfg.local)}, {ph(cfg.dataAssinatura, "[dia] de [mês] de [ano]")}.
            </p>

            {/* Assinaturas CONTRATANTE */}
            <div style={{ marginTop:"36px" }}>
              {sigs.map(sig => (
                <div key={sig.id} style={sigLn}>
                  <div style={{ fontWeight:"bold" }}>{ph(sig.nome)}</div>
                  <div>{sig.cargo}</div>
                  <div style={{ fontSize:"9pt", color:"#555" }}>CONTRATANTE</div>
                </div>
              ))}

              {cfg.contratadaRepresentante && (
                <div style={sigLn}>
                  <div style={{ fontWeight:"bold" }}>{ph(cfg.contratadaRepresentante)}</div>
                  <div>Representante Legal</div>
                  <div style={{ fontSize:"9pt", color:"#555" }}>CONTRATADO — {ph(contrato.fornecedor)}</div>
                </div>
              )}

              {/* Testemunhas */}
              <div style={{ marginTop:"20px" }}>
                <div style={{ fontWeight:"bold", marginBottom:"20px", fontSize:"10pt" }}>TESTEMUNHAS:</div>
                <div style={{ display:"flex", gap:"40px" }}>
                  <div style={{ flex:1, ...sigLn, margin:"0" }}>
                    <div>Nome:</div><div>CPF:</div>
                  </div>
                  <div style={{ flex:1, ...sigLn, margin:"0" }}>
                    <div>Nome:</div><div>CPF:</div>
                  </div>
                </div>
              </div>
            </div>

          </div>
          )}
        </div>
      </div>
    </div>
  );
}
