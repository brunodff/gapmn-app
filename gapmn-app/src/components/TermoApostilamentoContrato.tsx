import { useState, useRef, useEffect } from "react";
import { fetchIpcaRange, IpcaResult } from "./AtasRegistroPreco";
import { supabase } from "../lib/supabase";
import DocFormatBar from "./DocFormatBar";

const TEMPLATE_TIPO = "apostilamento";

// ── Contrato mínimo necessário ──────────────────────────────────────────────
export interface ContratoRef {
  id:              string;
  numero_contrato: string;
  descricao:       string | null;
  fornecedor:      string | null;
  cnpj:            string | null;
  fiscal:          string | null;
  vl_contratual:   number | null;
  vl_a_empenhar:   number | null;
  vl_atual:        number | null; // saldo ajustado — base para reajuste
  pag_nup:         string | null;
  data_orcamento:  string | null; // YYYY-MM-DD (dia sempre 01)
}

// ── Signatário dinâmico ─────────────────────────────────────────────────────
type AptSig = { id: string; nome: string; cargo: string };

// ── Config persistida em localStorage ──────────────────────────────────────
type ContratoAptConfig = {
  numeroTermo:            string;
  nupApostilamento:       string;
  ordenadoraNome:         string;
  ordenadoraGraduacao:    string;
  ordenadoraPortaria:     string;
  ordenadoraPortariaData: string;
  ordenadoraBoletim:      string;
  ordenadoraBoletimData:  string;
  ordenadoraMatricula:    string;
  contratadaEndereco:     string;
  contratadaRepresentante:string;
  novoValorContrato:      string;
  percentualReajuste:     string;
  valorReajuste:          string;
  tipoIndice:             string; // "INCC" | "IPCA"
  indiceReajuste:         string;
  dataOrcamentoContrato:  string; // MM/AAAA — base para cálculo automático
  dataVigencia:           string;
  baseLegal:              string;
  itemObjetoContratual:   string;
  testemunha1:            string;
  testemunha2:            string;
  // text overrides (vazio = usa padrão)
  txt_abertura:           string;
  txt_11:                 string;
  txt_21:                 string;
  txt_31:                 string;
  txt_41:                 string;
  txt_final:              string;
  // dynamic sigs
  signatarios:            AptSig[];
  showRepresentante:      boolean;
  showTestemunha1:        boolean;
  showTestemunha2:        boolean;
  // legacy (migração)
  fiscalNome:             string;
  aciNome:                string;
  aciGraduacao:           string;
  dirigentNome:           string;
  dirigentGraduacao:      string;
  // brasão
  brasaoSize:             number;
};

type ContratoAptStrKey = Exclude<keyof ContratoAptConfig,
  "signatarios" | "showRepresentante" | "showTestemunha1" | "showTestemunha2" | "tipoIndice">;

const CFG_KEY = "gapmn_contrato_apt_cfg";

const DEFAULT: ContratoAptConfig = {
  numeroTermo:            "1º",
  nupApostilamento:       "",
  ordenadoraNome:         "SUSAN KELLY PRADO ANDRADE",
  ordenadoraGraduacao:    "Cel Int",
  ordenadoraPortaria:     "",
  ordenadoraPortariaData: "",
  ordenadoraBoletim:      "",
  ordenadoraBoletimData:  "",
  ordenadoraMatricula:    "",
  contratadaEndereco:     "",
  contratadaRepresentante:"",
  novoValorContrato:      "",
  percentualReajuste:     "",
  valorReajuste:          "",
  tipoIndice:             "INCC",
  indiceReajuste:         "INCC (Índice Nacional de Custos de Construção)",
  dataOrcamentoContrato:  "",
  dataVigencia:           "",
  baseLegal:              "inciso II do Art. 124, da Lei nº 14.133/21",
  itemObjetoContratual:   "",
  testemunha1:            "",
  testemunha2:            "",
  txt_abertura:           "",
  txt_11:                 "",
  txt_21:                 "",
  txt_31:                 "",
  txt_41:                 "",
  txt_final:              "",
  signatarios: [
    { id: "fiscal",    nome: "", cargo: "Fiscal do Contrato" },
    { id: "aci",       nome: "MAINÃ FARIA CUNHA DE JESUS Cap INT", cargo: "Agente de Controle Interno do GAP-MN" },
    { id: "dirigente", nome: "SUSAN KELLY PRADO ANDRADE Cel Int",  cargo: "Dirigente Máximo do GAP-MN" },
  ],
  showRepresentante: true,
  showTestemunha1:   false,
  showTestemunha2:   false,
  // legacy
  fiscalNome: "", aciNome: "", aciGraduacao: "", dirigentNome: "", dirigentGraduacao: "",
  brasaoSize: 110,
};

function loadCfg(fiscal: string | null): ContratoAptConfig {
  try {
    const raw = localStorage.getItem(CFG_KEY);
    const saved = raw ? JSON.parse(raw) : {};
    const merged: ContratoAptConfig = { ...DEFAULT, ...saved };
    // migrate legacy sig fields
    if (!Array.isArray(merged.signatarios) || merged.signatarios.length === 0) {
      merged.signatarios = [
        { id: "fiscal",    nome: merged.fiscalNome   || fiscal || "",                               cargo: "Fiscal do Contrato" },
        { id: "aci",       nome: (merged.aciNome || DEFAULT.signatarios[1].nome) + (merged.aciGraduacao ? ` - ${merged.aciGraduacao}` : ""), cargo: "Agente de Controle Interno do GAP-MN" },
        { id: "dirigente", nome: (merged.dirigentNome || DEFAULT.signatarios[2].nome) + (merged.dirigentGraduacao ? ` - ${merged.dirigentGraduacao}` : ""), cargo: "Dirigente Máximo do GAP-MN" },
      ];
    }
    if (merged.signatarios[0].nome === "" && fiscal) {
      merged.signatarios[0].nome = fiscal;
    }
    return merged;
  } catch { return { ...DEFAULT, signatarios: DEFAULT.signatarios.map(s => ({ ...s })) }; }
}
function saveCfg(c: ContratoAptConfig) {
  localStorage.setItem(CFG_KEY, JSON.stringify(c));
}

const ORDINAL_EXTENSO: Record<string, string> = {
  "1º": "PRIMEIRO", "1ª": "PRIMEIRO",
  "2º": "SEGUNDO",  "2ª": "SEGUNDO",
  "3º": "TERCEIRO", "3ª": "TERCEIRO",
  "4º": "QUARTO",   "4ª": "QUARTO",
  "5º": "QUINTO",   "5ª": "QUINTO",
  "6º": "SEXTO",    "7º": "SÉTIMO",
  "8º": "OITAVO",   "9º": "NONO",   "10º": "DÉCIMO",
};
const toExtens = (v: string) => ORDINAL_EXTENSO[v.trim()] ?? v.toUpperCase();

const ph = (v: string | null | undefined, fallback = "______") =>
  v && v.trim() ? v.trim() : fallback;

// ── Grupos de campos (só strings) ──────────────────────────────────────────
type Field = { key: ContratoAptStrKey; label: string };
const GROUPS: { title: string; fields: Field[] }[] = [
  {
    title: "Identificação do Termo",
    fields: [
      { key: "numeroTermo",      label: "Número ordinal (ex: 1º, 2º)" },
      { key: "nupApostilamento", label: "NUP do apostilamento" },
    ],
  },
  {
    title: "Ordenadora de Despesa (CONTRATANTE)",
    fields: [
      { key: "ordenadoraNome",         label: "Nome completo" },
      { key: "ordenadoraGraduacao",    label: "Posto/Graduação (ex: Cel Int)" },
      { key: "ordenadoraPortaria",     label: "Portaria de nomeação" },
      { key: "ordenadoraPortariaData", label: "Data da portaria" },
      { key: "ordenadoraBoletim",      label: "Boletim COMAER" },
      { key: "ordenadoraBoletimData",  label: "Data do boletim" },
      { key: "ordenadoraMatricula",    label: "Matrícula Funcional" },
    ],
  },
  {
    title: "Contratada (complementar ao banco de dados)",
    fields: [
      { key: "contratadaEndereco",      label: "Endereço completo (rua, bairro, cidade/UF, CEP)" },
      { key: "contratadaRepresentante", label: "Nome do representante (maiúsculas)" },
    ],
  },
  {
    title: "Reajuste — Cláusula 2ª",
    fields: [
      { key: "dataOrcamentoContrato", label: "Data base do orçamento (MM/AAAA) — calcula INCC automaticamente" },
      { key: "novoValorContrato",  label: "Novo valor do contrato (ex: 745.463,97)" },
      { key: "percentualReajuste", label: "Percentual % (ex: 6,34) — auto-preenchido pelo INCC" },
      { key: "valorReajuste",      label: "Valor absoluto do reajuste (ex: 44.444,62)" },
      { key: "indiceReajuste",     label: "Índice de reajuste" },
      { key: "dataVigencia",       label: "Data de vigência (ex: 01/12/2024)" },
      { key: "baseLegal",          label: "Base legal" },
    ],
  },
  {
    title: "Justificativa — Cláusula 3ª",
    fields: [
      { key: "itemObjetoContratual", label: "Item do objeto contratual (ex: 7.2)" },
    ],
  },
];

type TxtField = { key: ContratoAptStrKey; label: string; ph: string };
const TXT_FIELDS: TxtField[] = [
  { key: "txt_abertura", label: "Parágrafo I — CONTRATANTE (override)", ph: "Deixe em branco para usar o texto padrão" },
  { key: "txt_11",       label: "Cláusula 1ª — 1.1 (override)",         ph: "Deixe em branco para usar o texto padrão" },
  { key: "txt_21",       label: "Cláusula 2ª — 2.1 (override)",         ph: "Deixe em branco para usar o texto padrão" },
  { key: "txt_31",       label: "Cláusula 3ª — 3.1 (override)",         ph: "Deixe em branco para usar o texto padrão" },
  { key: "txt_41",       label: "Cláusula 4ª — 4.1 (override)",         ph: "Deixe em branco para usar o texto padrão" },
  { key: "txt_final",    label: "Parágrafo final (override)",            ph: "Deixe em branco para usar o texto padrão" },
];

// ── Componente principal ────────────────────────────────────────────────────
export default function TermoApostilamentoContrato({
  contrato, onClose,
}: {
  contrato: ContratoRef;
  onClose: () => void;
}) {
  const [cfg, setCfg]       = useState<ContratoAptConfig>(() => {
    const base = loadCfg(contrato.fiscal);
    const patch: Partial<ContratoAptConfig> = {};
    if (!base.nupApostilamento && contrato.pag_nup) patch.nupApostilamento = contrato.pag_nup;
    if (!base.dataOrcamentoContrato && contrato.data_orcamento) {
      const [yyyy, mm] = contrato.data_orcamento.split("-");
      patch.dataOrcamentoContrato = `${mm}/${yyyy}`;
    }
    return { ...base, ...patch };
  });
  const [draft, setDraft]   = useState<ContratoAptConfig>(() => {
    const base = loadCfg(contrato.fiscal);
    const patch: Partial<ContratoAptConfig> = {};
    if (!base.nupApostilamento && contrato.pag_nup) patch.nupApostilamento = contrato.pag_nup;
    if (!base.dataOrcamentoContrato && contrato.data_orcamento) {
      const [yyyy, mm] = contrato.data_orcamento.split("-");
      patch.dataOrcamentoContrato = `${mm}/${yyyy}`;
    }
    return { ...base, ...patch };
  });
  const [showCfg, setShowCfg] = useState(false);
  const [inccResult, setInccResult] = useState<IpcaResult | null | undefined>(undefined);
  const [loadingIncc, setLoadingIncc] = useState(false);
  const [docSaved,        setDocSaved]        = useState(false);
  const [savingDoc,       setSavingDoc]       = useState(false);
  const [savingTemplate,  setSavingTemplate]  = useState(false);
  const [templateSaved,   setTemplateSaved]   = useState(false);
  const docRef = useRef<HTMLDivElement>(null);

  // ── Edição inline do documento ──────────────────────────────────────────────
  const LS_DOC_KEY = `gapmn_apt_doc_${contrato.id}`;
  const [docEditMode, setDocEditMode]   = useState(false);
  const [savedDocHtml, setSavedDocHtml] = useState<string | null>(() => {
    try { return localStorage.getItem(`gapmn_apt_doc_${contrato.id}`); } catch { return null; }
  });

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

  useEffect(() => {
    function onKey(e: KeyboardEvent) { if ((e.ctrlKey || e.metaKey) && e.key === "s") { e.preventDefault(); saveDocHtml(); } }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Cálculo automático — apenas para IPCA (BCB série 433, dados oficiais IBGE)
  // INCC-M é publicado pela FGV sem API pública compatível — deve ser inserido manualmente
  useEffect(() => {
    if (draft.tipoIndice !== "IPCA") { setInccResult(undefined); return; }
    const mmYYYY = /^\d{2}\/\d{4}$/;
    const dataBase = draft.dataOrcamentoContrato;
    if (!dataBase || !mmYYYY.test(dataBase)) { setInccResult(undefined); return; }

    setLoadingIncc(true);
    const [mm, yyyy] = dataBase.split("/");
    const startDate = new Date(parseInt(yyyy), parseInt(mm) - 1, 1);
    const endDate   = new Date(startDate);
    endDate.setMonth(endDate.getMonth() + 11); // 12 taxas mensais
    const fmtMY = (d: Date) => `${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`;

    fetchIpcaRange(fmtMY(startDate), fmtMY(endDate)).then((res) => {
      setInccResult(res);
      setLoadingIncc(false);
      if (!res) return;

      const pctStr = res.percentual.toLocaleString("pt-BR", { minimumFractionDigits: 4, maximumFractionDigits: 4 });
      const base = contrato.vl_atual != null && contrato.vl_atual > 0
        ? contrato.vl_atual
        : contrato.vl_a_empenhar != null && contrato.vl_a_empenhar > 0
        ? contrato.vl_a_empenhar
        : contrato.vl_contratual;
      const fmtBRL = (v: number) => v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

      if (base != null && base > 0) {
        const novoVal = base * res.fator;
        const valReaj = novoVal - base;
        setDraft(prev => ({
          ...prev,
          percentualReajuste: pctStr,
          novoValorContrato:  fmtBRL(novoVal),
          valorReajuste:      fmtBRL(valReaj),
        }));
      } else {
        setDraft(prev => ({ ...prev, percentualReajuste: pctStr }));
      }
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft.dataOrcamentoContrato, draft.tipoIndice]);

  function setDraftField(k: ContratoAptStrKey, v: string) {
    // Ao digitar percentual manualmente, recalcula novo valor e valor do reajuste
    if (k === "percentualReajuste") {
      const pct = parseFloat(v.replace(",", "."));
      const base = contrato.vl_atual != null && contrato.vl_atual > 0
        ? contrato.vl_atual
        : contrato.vl_a_empenhar != null && contrato.vl_a_empenhar > 0
        ? contrato.vl_a_empenhar
        : contrato.vl_contratual;
      if (!isNaN(pct) && pct > 0 && base != null && base > 0) {
        const fmtBRL = (n: number) => n.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        const novoVal = base * (1 + pct / 100);
        setDraft(prev => ({
          ...prev,
          percentualReajuste: v,
          novoValorContrato:  fmtBRL(novoVal),
          valorReajuste:      fmtBRL(novoVal - base),
        }));
        return;
      }
    }
    setDraft(prev => ({ ...prev, [k]: v }));
  }

  // sig handlers
  function addDraftSig() {
    setDraft(prev => ({
      ...prev,
      signatarios: [...prev.signatarios, { id: `sig_${Date.now()}`, nome: "", cargo: "" }],
    }));
  }
  function removeDraftSig(id: string) {
    setDraft(prev => ({ ...prev, signatarios: prev.signatarios.filter(s => s.id !== id) }));
  }
  function setDraftSig(id: string, field: "nome" | "cargo", value: string) {
    setDraft(prev => ({
      ...prev,
      signatarios: prev.signatarios.map(s => s.id === id ? { ...s, [field]: value } : s),
    }));
  }

  function salvarCfg() {
    saveCfg(draft);
    setCfg({ ...draft });
    setShowCfg(false);
    // Persiste data_orcamento no banco via RPC (SECURITY DEFINER — bypassa RLS)
    if (draft.dataOrcamentoContrato && /^\d{2}\/\d{4}$/.test(draft.dataOrcamentoContrato)) {
      const [mm, yyyy] = draft.dataOrcamentoContrato.split("/");
      supabase.rpc("set_contrato_data_orcamento", {
        p_id: contrato.id,
        p_data_orcamento: `${yyyy}-${mm}-01`,
      });
    }
  }

  function handlePrint() {
    const el = docRef.current;
    if (!el) { window.print(); return; }
    const pw = window.open("", "_blank", "width=900,height=700");
    if (!pw) { window.print(); return; }

    let html = el.outerHTML;
    const brasaoEl = el.querySelector("[data-brasao]") as HTMLImageElement | null;
    const brasaoUrl = brasaoEl?.currentSrc || (window.location.origin + "/brasao.png");
    html = html.replace(/data-brasao="true"\s+src="[^"]*"/, `data-brasao="true" src="${brasaoUrl}"`);

    pw.document.write(`<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<title>${cfg.numeroTermo || "1º"} Termo de Apostilamento — ${contrato.numero_contrato}</title>
<style>
  * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; box-sizing: border-box; }
  body { margin: 0; padding: 0; background: #fff; font-family: Arial, Helvetica, sans-serif; }
  @page { size: A4; margin: 0; }
  .pg { page-break-before: always; break-before: page; }
  .no-break { page-break-inside: avoid; break-inside: avoid; }
  tr { page-break-inside: avoid; break-inside: avoid; }
  p  { margin: 0 0 14px; }
  [data-quebra] { height: 0; overflow: hidden; border: none !important; padding: 0 !important; margin: 0 !important; font-size: 0 !important; color: transparent !important; }
</style>
</head>
<body>${html}<script>window.onload=function(){window.print();};<\/script></body>
</html>`);
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

  async function salvarNoContrato() {
    setSavingDoc(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      const { data: profile } = await supabase.from("profiles").select("nome_guerra").eq("id", user?.id ?? "").maybeSingle();
      const nome = `${ph(cfg.numeroTermo, "1º")} Termo de Apostilamento — ${contrato.numero_contrato}`;
      await supabase.from("contratos_docs").insert({
        numero_contrato: contrato.numero_contrato,
        tipo: "apostilamento",
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

  // ── Valores efetivos ──────────────────────────────────────────────────────
  const numTermo = ph(cfg.numeroTermo, "1º");
  const extTermo = toExtens(numTermo);
  const novoVal  = cfg.novoValorContrato ? `R$ ${cfg.novoValorContrato}` : "R$ ______";
  const pct      = cfg.percentualReajuste ? `${cfg.percentualReajuste}%` : "______%";
  const valReaj  = cfg.valorReajuste ? `R$ ${cfg.valorReajuste}` : "R$ ______";
  const runHdr   = `${numTermo} Termo de Apostilamento ao Contrato de Despesa nº ${contrato.numero_contrato}`;
  const hasEmpresa = cfg.showRepresentante || cfg.showTestemunha1 || cfg.showTestemunha2;

  // ── Estilos do documento ──────────────────────────────────────────────────
  const doc: React.CSSProperties = {
    fontFamily: "Arial, Helvetica, sans-serif",
    fontSize: "11pt",
    color: "#000",
    lineHeight: "1.65",
    width: "210mm",
    minHeight: "297mm",
    padding: "18mm 22mm",
    background: "#fff",
    margin: "0 auto",
  };
  const rHdr: React.CSSProperties = {
    fontSize: "8pt", color: "#555", textAlign: "right",
    marginBottom: "10px", fontStyle: "italic",
  };
  const pStyle: React.CSSProperties = { textAlign: "justify", marginBottom: "14px", fontSize: "11pt" };
  const clTitle: React.CSSProperties = {
    color: "#000", fontWeight: "bold", marginTop: "18px", marginBottom: "4px",
  };
  const sigLineStyle: React.CSSProperties = {
    borderTop: "1px solid #000", paddingTop: "4px", marginBottom: "36px",
    textAlign: "center", fontSize: "10pt",
  };

  return (
    <div className="apt-modal-bg fixed inset-0 z-[9999] flex flex-col bg-slate-200 overflow-hidden">

      {/* ── Barra superior ── */}
      <div className="print:hidden shrink-0 flex items-center justify-between gap-3 bg-slate-800 px-4 py-2 text-white">
        <div className="text-sm font-semibold truncate">
          {numTermo} Termo de Apostilamento — {contrato.numero_contrato}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={() => { setDraft({ ...cfg, signatarios: cfg.signatarios.map(s => ({ ...s })) }); setShowCfg(v => !v); }}
            className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
              showCfg ? "bg-slate-600 text-slate-200" : "bg-amber-500 hover:bg-amber-400 text-white"
            }`}
          >
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
            title="Salvar o documento atual como modelo padrão para futuros apostilamentos"
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
              title="Apaga edições e restaura o texto original gerado">
              🔄 Original
            </button>
          )}
          <button onClick={handlePrint}
            className="flex items-center gap-1.5 rounded-lg bg-sky-600 hover:bg-sky-500 px-3 py-1.5 text-xs font-medium text-white">
            🖨 Imprimir / PDF
          </button>
          <button onClick={salvarNoContrato} disabled={savingDoc || docSaved}
            className="flex items-center gap-1.5 rounded-lg bg-emerald-700 hover:bg-emerald-600 disabled:opacity-60 px-3 py-1.5 text-xs font-medium text-white"
            title="Registra este apostilamento no histórico do contrato">
            {docSaved ? "✓ Salvo" : savingDoc ? "..." : "💾 Salvar no contrato"}
          </button>
          <button onClick={onClose} className="text-slate-400 hover:text-white text-xl px-2 leading-none">✕</button>
        </div>
      </div>

      {docEditMode && <DocFormatBar docRef={docRef} onInsertBreak={inserirQuebra} />}

      {/* ── Corpo ── */}
      <div className="flex flex-1 overflow-hidden print:block print:overflow-visible">

        {/* Painel de campos */}
        {showCfg && (
          <div className="modal-card apt-cfg-panel print:hidden w-80 shrink-0 bg-white border-r border-slate-200 overflow-y-auto flex flex-col">
            <div className="p-4 space-y-4 flex-1">
              <div className="text-sm font-bold">Campos Editáveis</div>
              <p className="text-xs text-slate-500 leading-relaxed">
                Campos salvos no navegador. <strong>Nome da empresa, CNPJ e objeto</strong> vêm automaticamente do contrato selecionado.
              </p>

              {/* Grupos de campos string */}
              {GROUPS.map(grp => (
                <div key={grp.title} className="space-y-2">
                  <div className="text-[11px] font-bold text-sky-700 uppercase tracking-wide border-b pb-0.5 mb-1">
                    {grp.title}
                  </div>
                  {grp.title === "Reajuste — Cláusula 2ª" && (
                    <div>
                      <label className="block text-[11px] font-semibold text-slate-500 mb-0.5">Tipo de índice</label>
                      <select
                        value={draft.tipoIndice}
                        onChange={e => setDraft(prev => ({
                          ...prev,
                          tipoIndice: e.target.value,
                          indiceReajuste: e.target.value === "IPCA"
                            ? "IPCA (Índice Nacional de Preços ao Consumidor Amplo)"
                            : "INCC (Índice Nacional de Custos de Construção)",
                          percentualReajuste: "",
                          novoValorContrato: "",
                          valorReajuste: "",
                        }))}
                        className="w-full rounded-lg border px-2 py-1.5 text-xs outline-none focus:ring-1 focus:ring-sky-200"
                      >
                        <option value="INCC">INCC-M (FGV — Construção Civil)</option>
                        <option value="IPCA">IPCA (IBGE — Inflação Geral)</option>
                      </select>
                    </div>
                  )}
                  {grp.fields.map(({ key, label }) => (
                    <div key={key}>
                      <label className="block text-[11px] font-semibold text-slate-500 mb-0.5">{label}</label>
                      <input
                        value={draft[key] as string}
                        onChange={e => setDraftField(key, e.target.value)}
                        className="w-full rounded-lg border px-2 py-1.5 text-xs outline-none focus:ring-1 focus:ring-sky-200"
                      />
                      {key === "dataOrcamentoContrato" && (
                        draft.tipoIndice === "INCC" ? (
                          <div className="mt-1 rounded-lg bg-sky-50 border border-sky-200 px-2 py-1.5 text-[11px] text-sky-800 leading-relaxed">
                            📌 INCC-M é divulgado pela FGV sem API pública disponível.{" "}
                            <a href="https://portal.fgv.br/noticias/incc-m-2026" target="_blank" rel="noopener noreferrer" className="underline font-semibold">
                              Consulte o valor em portal.fgv.br ↗
                            </a>{" "}
                            e insira manualmente o percentual acumulado nos 12 meses a partir da data-base no campo "Percentual %" abaixo.
                          </div>
                        ) : loadingIncc ? (
                          <div className="mt-1 text-[11px] text-slate-400 animate-pulse">Calculando IPCA…</div>
                        ) : inccResult ? (
                          <div className="mt-1 rounded-lg bg-amber-50 border border-amber-300 px-2 py-1 text-[11px] text-amber-800">
                            📊 IPCA acumulado: <strong>{inccResult.percentual.toLocaleString("pt-BR", { minimumFractionDigits: 4, maximumFractionDigits: 4 })}%</strong>
                            {" "}({inccResult.periodoInicio} a {inccResult.periodoFim}) · fator {inccResult.fator.toFixed(6)}
                            {(() => {
                              const base = contrato.vl_atual ?? contrato.vl_a_empenhar;
                              const lbl  = contrato.vl_atual != null ? "Saldo ajustado" : "Saldo a empenhar";
                              if (base == null) return null;
                              return (
                                <div className="text-[10px] text-amber-700 mt-0.5 font-semibold">
                                  {lbl}: R$ {base.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
                                  {" "}→ Novo valor: R$ {(base * inccResult.fator).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
                                </div>
                              );
                            })()}
                            <div className="text-[10px] text-amber-600 mt-0.5">Campos abaixo auto-preenchidos. Edite se necessário.</div>
                          </div>
                        ) : draft.dataOrcamentoContrato ? (
                          <div className="mt-1 text-[11px] text-red-400">Não foi possível calcular. Verifique o formato MM/AAAA.</div>
                        ) : null
                      )}
                    </div>
                  ))}
                </div>
              ))}

              {/* Signatários CONTRATANTE */}
              <div className="space-y-2">
                <div className="text-[11px] font-bold text-sky-700 uppercase tracking-wide border-b pb-0.5">
                  Assinaturas — Pela CONTRATANTE
                </div>
                {draft.signatarios.map((sig, i) => (
                  <div key={sig.id} className="border rounded-lg p-2 space-y-1 bg-slate-50">
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] font-semibold text-slate-500">Signatário {i + 1}</span>
                      <button
                        onClick={() => removeDraftSig(sig.id)}
                        className="text-red-400 hover:text-red-600 text-xs leading-none"
                        title="Remover"
                      >✕</button>
                    </div>
                    <input
                      placeholder="Nome completo"
                      value={sig.nome}
                      onChange={e => setDraftSig(sig.id, "nome", e.target.value)}
                      className="w-full rounded border px-2 py-1 text-xs outline-none focus:ring-1 focus:ring-sky-200"
                    />
                    <input
                      placeholder="Cargo / Função"
                      value={sig.cargo}
                      onChange={e => setDraftSig(sig.id, "cargo", e.target.value)}
                      className="w-full rounded border px-2 py-1 text-xs outline-none focus:ring-1 focus:ring-sky-200"
                    />
                  </div>
                ))}
                <button
                  onClick={addDraftSig}
                  className="w-full rounded-lg border border-dashed border-sky-300 py-1.5 text-xs text-sky-600 hover:bg-sky-50 transition-colors"
                >
                  + Adicionar signatário
                </button>
              </div>

              {/* Assinaturas CONTRATADA */}
              <div className="space-y-2">
                <div className="text-[11px] font-bold text-sky-700 uppercase tracking-wide border-b pb-0.5">
                  Assinaturas — Pela CONTRATADA
                </div>
                <label className="flex items-center gap-2 text-xs text-slate-600 cursor-pointer">
                  <input type="checkbox" checked={draft.showRepresentante}
                    onChange={e => setDraft(p => ({ ...p, showRepresentante: e.target.checked }))} />
                  Incluir Representante da Empresa
                </label>
                <label className="flex items-center gap-2 text-xs text-slate-600 cursor-pointer">
                  <input type="checkbox" checked={draft.showTestemunha1}
                    onChange={e => setDraft(p => ({ ...p, showTestemunha1: e.target.checked }))} />
                  Incluir Testemunha 1
                </label>
                {draft.showTestemunha1 && (
                  <input placeholder="Nome da testemunha"
                    value={draft.testemunha1}
                    onChange={e => setDraftField("testemunha1", e.target.value)}
                    className="w-full rounded-lg border px-2 py-1.5 text-xs outline-none focus:ring-1 focus:ring-sky-200"
                  />
                )}
                <label className="flex items-center gap-2 text-xs text-slate-600 cursor-pointer">
                  <input type="checkbox" checked={draft.showTestemunha2}
                    onChange={e => setDraft(p => ({ ...p, showTestemunha2: e.target.checked }))} />
                  Incluir Testemunha 2
                </label>
                {draft.showTestemunha2 && (
                  <input placeholder="Nome da testemunha"
                    value={draft.testemunha2}
                    onChange={e => setDraftField("testemunha2", e.target.value)}
                    className="w-full rounded-lg border px-2 py-1.5 text-xs outline-none focus:ring-1 focus:ring-sky-200"
                  />
                )}
              </div>

              {/* Brasão */}
              <div className="space-y-1">
                <div className="text-[11px] font-bold text-sky-700 uppercase tracking-wide border-b pb-0.5 mb-1">Brasão</div>
                <label className="block text-[11px] font-semibold text-slate-500 mb-0.5">Tamanho ({draft.brasaoSize ?? 110}px)</label>
                <input type="range" min={60} max={200} value={draft.brasaoSize ?? 110}
                  onChange={e => setDraft(p => ({ ...p, brasaoSize: Number(e.target.value) }))}
                  className="w-full accent-sky-600" />
                <div className="flex justify-between text-[10px] text-slate-400"><span>60px</span><span>200px</span></div>
              </div>

              {/* Overrides de texto */}
              <div className="space-y-2">
                <div className="text-[11px] font-bold text-sky-700 uppercase tracking-wide border-b pb-0.5">Overrides de Texto</div>
                <p className="text-[11px] text-slate-500">Em branco = usa o texto padrão gerado automaticamente.</p>
                {TXT_FIELDS.map(({ key, label, ph: placeholder }) => (
                  <div key={key}>
                    <label className="block text-[11px] font-semibold text-slate-500 mb-0.5">{label}</label>
                    <textarea rows={3}
                      value={draft[key] as string}
                      onChange={e => setDraftField(key, e.target.value)}
                      placeholder={placeholder}
                      className="w-full rounded-lg border px-2 py-1.5 text-xs outline-none focus:ring-1 focus:ring-sky-200 resize-none"
                    />
                  </div>
                ))}
              </div>
            </div>

            <div className="p-4 border-t shrink-0">
              <button onClick={salvarCfg}
                className="w-full rounded-xl bg-sky-600 text-white py-2 text-sm font-medium hover:bg-sky-700">
                ✓ Salvar e aplicar
              </button>
            </div>
          </div>
        )}

        {/* Área do documento */}
        <div className="flex-1 overflow-y-auto bg-slate-300 print:bg-white p-8 print:p-0">
          {savedDocHtml ? (
            <div ref={docRef} style={doc} contentEditable={docEditMode} suppressContentEditableWarning dangerouslySetInnerHTML={{ __html: savedDocHtml }} />
          ) : (
          <div ref={docRef} style={doc} contentEditable={docEditMode} suppressContentEditableWarning>

            {/* ══ PÁGINA 1 — Preâmbulo ══════════════════════════════════════ */}
            <div style={rHdr}>{runHdr}</div>

            {/* Timbre */}
            <div style={{ textAlign: "center", marginBottom: "20px" }}>
              <div style={{ display: "flex", justifyContent: "center", marginBottom: "8px" }}>
                <img
                  data-brasao="true"
                  src="/brasao.png"
                  onError={e => {
                    const img = e.currentTarget as HTMLImageElement;
                    if (!img.dataset.tried) {
                      img.dataset.tried = "1";
                      img.src = "https://upload.wikimedia.org/wikipedia/commons/thumb/9/9d/Coat_of_arms_of_Brazil.svg/160px-Coat_of_arms_of_Brazil.svg.png";
                    } else { img.style.display = "none"; }
                  }}
                  style={{ height: `${cfg.brasaoSize ?? 110}px`, width: `${cfg.brasaoSize ?? 110}px`, objectFit: "contain" }}
                  alt="Brasão"
                />
              </div>
              <div style={{ fontWeight: "bold" }}>MINISTÉRIO DA DEFESA</div>
              <div style={{ fontWeight: "bold" }}>COMANDO DA AERONÁUTICA</div>
              <div style={{ fontWeight: "bold", textDecoration: "underline" }}>GRUPAMENTO DE APOIO DE MANAUS</div>
            </div>

            {/* Título */}
            <div style={{
              textAlign: "center", fontWeight: "bold", fontSize: "12pt",
              textDecoration: "underline", margin: "24px 0 20px", lineHeight: 1.4,
            }}>
              {extTermo} TERMO DE APOSTILAMENTO AO CONTRATO DE DESPESA Nº {contrato.numero_contrato}
            </div>

            {/* Espécie + NUP */}
            <p style={{ marginBottom: "6px" }}>
              <strong>Espécie:</strong> {numTermo} Termo de Apostilamento
            </p>
            <p style={{ marginBottom: "24px" }}>
              <strong>NUP:</strong> {ph(cfg.nupApostilamento)}
            </p>

            {/* Cláusula I — CONTRATANTE */}
            {cfg.txt_abertura ? (
              <p style={{ ...pStyle, whiteSpace: "pre-wrap" }}>{cfg.txt_abertura}</p>
            ) : (
              <p style={pStyle}>
                <strong>I - CONTRATANTE:</strong> A UNIÃO, Ministério da Defesa, por meio do Comando da Aeronáutica,
                representada pelo <strong>GRUPAMENTO DE APOIO DE MANAUS</strong>, inscrito no CNPJ (MF) nº
                00.394.429/0188-24, localizado na Avenida Rodrigo Otávio, nº 770 – Crespo – Cep: 69073-177 –
                Manaus – AM, na figura de sua Ordenadora de Despesa, a Sr.{" "}
                <strong>{ph(cfg.ordenadoraNome)} {ph(cfg.ordenadoraGraduacao)}</strong>, nomeada pela{" "}
                <strong>{ph(cfg.ordenadoraPortaria)}</strong>, de {ph(cfg.ordenadoraPortariaData)}, publicada no{" "}
                <strong>{ph(cfg.ordenadoraBoletim)}</strong>, de {ph(cfg.ordenadoraBoletimData)}, portadora da
                Matrícula Funcional n° {ph(cfg.ordenadoraMatricula)}.
              </p>
            )}

            {/* Cláusula II — CONTRATADA */}
            <p style={pStyle}>
              <strong>II - CONTRATADA: {(contrato.fornecedor ?? "______").toUpperCase()}</strong>,
              inscrita no CNPJ/MF sob o n° {ph(contrato.cnpj)}, com sede na {ph(cfg.contratadaEndereco)},
              doravante denominado <strong>CONTRATADO</strong>, neste ato representado pelo Sr.{" "}
              <strong>{ph(cfg.contratadaRepresentante)}</strong>.
            </p>

            {/* ══ PÁGINA 2 — CONTEÚDO ══════════════════════════════════════ */}
            <div className="pg" style={{ pageBreakBefore: "always", paddingTop: "18mm" }}>
              <div style={rHdr}>{runHdr}</div>
              <div style={{ textAlign: "center", fontWeight: "bold", fontSize: "12pt", marginBottom: "32px" }}>
                CONTEÚDO
              </div>
              {[
                "CLÁUSULA 1ª – OBJETO",
                "CLÁUSULA 2ª – FINALIDADE E FUNDAMENTO LEGAL",
                "CLÁUSULA 3ª – JUSTIFICATIVA DO APOSTILAMENTO",
                "CLÁUSULA 4ª – DISPOSIÇÕES FINAIS",
              ].map(c => (
                <div key={c} style={{ color: "#000", fontWeight: "bold", lineHeight: "2.4" }}>{c}</div>
              ))}
            </div>

            {/* ══ PÁGINA 3 — Cláusulas ═════════════════════════════════════ */}
            <div className="pg" style={{ pageBreakBefore: "always", paddingTop: "18mm" }}>
              <div style={rHdr}>{runHdr}</div>

              {/* Cláusula 1ª */}
              <div style={clTitle}>CLÁUSULA 1ª – OBJETO</div>
              {cfg.txt_11 ? (
                <p style={{ ...pStyle, whiteSpace: "pre-wrap" }}>{cfg.txt_11}</p>
              ) : (
                <p style={pStyle}>
                  <strong>1.1</strong> – O objeto do presente instrumento é {ph(contrato.descricao, "a contratação descrita no contrato de referência")}.
                </p>
              )}

              {/* Cláusula 2ª */}
              <div style={clTitle}>CLÁUSULA 2ª – FINALIDADE E FUNDAMENTO LEGAL</div>
              {cfg.txt_21 ? (
                <p style={{ ...pStyle, whiteSpace: "pre-wrap" }}>{cfg.txt_21}</p>
              ) : (
                <p style={pStyle}>
                  <strong>2.1</strong> – O presente Termo de Apostilamento tem por finalidade alterar o valor do contrato
                  que passará a ser <strong>{novoVal}</strong> acrescentando <strong>{pct}</strong> (
                  <strong>{valReaj}</strong>), conforme {ph(cfg.indiceReajuste)} apurado nos últimos 12 meses,
                  a contar de {ph(cfg.dataVigencia)}, com base no {ph(cfg.baseLegal)}.
                </p>
              )}

              {/* Cláusula 3ª */}
              <div style={clTitle}>CLÁUSULA 3ª – JUSTIFICATIVA DO APOSTILAMENTO</div>
              {cfg.txt_31 ? (
                <p style={{ ...pStyle, whiteSpace: "pre-wrap" }}>{cfg.txt_31}</p>
              ) : (
                <p style={pStyle}>
                  <strong>3.1</strong> – Considerando o interesse da Administração e o parecer favorável do fiscal
                  do Contrato de Despesa n° {contrato.numero_contrato} e do Ordenador de Despesas, pelo reajuste
                  do valor contratual, conforme o item {ph(cfg.itemObjetoContratual)} do objeto contratual.
                </p>
              )}

              {/* Cláusula 4ª */}
              <div style={clTitle}>CLÁUSULA 4ª – DISPOSIÇÕES FINAIS</div>
              {cfg.txt_41 ? (
                <p style={{ ...pStyle, whiteSpace: "pre-wrap" }}>{cfg.txt_41}</p>
              ) : (
                <p style={pStyle}>
                  <strong>4.1</strong> – Este Termo de Apostilamento está estabelecido em 02 (duas) vias de igual
                  teor, sendo uma para a <strong>CONTRATANTE</strong> e outra para a <strong>CONTRATADA</strong>,
                  dele sendo extraídas tantas cópias quantas forem necessárias à sua execução.
                </p>
              )}

              {cfg.txt_final ? (
                <p style={{ ...pStyle, textAlign: "center", marginTop: "16px", whiteSpace: "pre-wrap" }}>{cfg.txt_final}</p>
              ) : (
                <p style={{ ...pStyle, textAlign: "center", marginTop: "16px" }}>
                  E, por assim estarem acordadas, declaram as partes aceitar todas as condições estabelecidas
                  nas cláusulas do presente <strong>TERMO DE APOSTILAMENTO</strong>, que, após lido e achado
                  conforme, vai devidamente assinado pelos representantes e testemunhas abaixo:
                </p>
              )}
              <p style={{ textAlign: "right", marginTop: "20px", marginBottom: "0" }}>
                Manaus, data conforme assinatura digital.
              </p>
            </div>

            {/* ══ PÁGINA 4 — Assinaturas ═══════════════════════════════════ */}
            <div className="pg" style={{ pageBreakBefore: "always", paddingTop: "18mm" }}>
              <div style={rHdr}>{runHdr}</div>
              <div style={{ fontWeight: "bold", fontSize: "12pt", marginBottom: "32px" }}>Assinaturas</div>

              {hasEmpresa ? (
                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                  <tbody>
                    <tr>
                      {/* CONTRATANTE */}
                      <td style={{ width: "50%", verticalAlign: "top", paddingRight: "16px" }}>
                        <div style={{ fontWeight: "bold", marginBottom: "44px" }}>Pela CONTRATANTE</div>
                        {cfg.signatarios.map(sig => (
                          <div key={sig.id} style={sigLineStyle}>
                            <strong>{sig.nome || "______________________________"}</strong><br />
                            {sig.cargo}
                          </div>
                        ))}
                      </td>

                      {/* CONTRATADA */}
                      <td style={{ width: "50%", verticalAlign: "top", paddingLeft: "16px", borderLeft: "1px solid #ccc" }}>
                        <div style={{ fontWeight: "bold", marginBottom: "44px" }}>Pela CONTRATADA</div>
                        {cfg.showRepresentante && (
                          <div style={sigLineStyle}>
                            <strong>{ph(cfg.contratadaRepresentante)}</strong><br />
                            Representante da Empresa
                          </div>
                        )}
                        {cfg.showTestemunha1 && (
                          <div style={sigLineStyle}>
                            <strong>{cfg.testemunha1 || "______________________________"}</strong><br />
                            Testemunha
                          </div>
                        )}
                        {cfg.showTestemunha2 && (
                          <div style={sigLineStyle}>
                            <strong>{cfg.testemunha2 || "______________________________"}</strong><br />
                            Testemunha
                          </div>
                        )}
                      </td>
                    </tr>
                  </tbody>
                </table>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "28px" }}>
                  {cfg.signatarios.map(sig => (
                    <div key={sig.id} style={{ textAlign: "center" }}>
                      <div style={{ borderTop: "1px solid #000", paddingTop: "3px", minWidth: "220pt", display: "inline-block" }}>
                        <div style={{ fontWeight: "bold", fontSize: "10pt" }}>{sig.nome || "______________________________"}</div>
                        <div style={{ fontSize: "9pt" }}>{sig.cargo}</div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

          </div>
          )}
        </div>
      </div>
    </div>
  );
}
