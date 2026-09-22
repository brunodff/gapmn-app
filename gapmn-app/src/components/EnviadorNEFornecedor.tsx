import { useCallback, useRef, useState } from "react";
import * as pdfjsLib from "pdfjs-dist";
import { supabase } from "../lib/supabase";

// Worker via CDN para evitar problemas de bundling
(pdfjsLib as any).GlobalWorkerOptions.workerSrc =
  `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${(pdfjsLib as any).version}/pdf.worker.min.js`;

// ─── Extração de texto ─────────────────────────────────────────────────────────

async function extractPDFText(file: File): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const pdf   = await (pdfjsLib as any).getDocument({ data: bytes }).promise;
  const parts: string[] = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const page    = await pdf.getPage(i);
    const content = await page.getTextContent();
    parts.push(content.items.map((it: any) => it.str).join(" "));
  }
  return parts.join("\n");
}

async function fileToBase64(file: File): Promise<string> {
  return new Promise((res, rej) => {
    const reader = new FileReader();
    reader.onload  = () => res((reader.result as string).split(",")[1]);
    reader.onerror = rej;
    reader.readAsDataURL(file);
  });
}

// ─── Parsing da NE ────────────────────────────────────────────────────────────

interface ParsedNE {
  neNumero:      string;
  cnpj:          string;
  omNome:        string;
  contato:       string;
  favorecidoNome: string;
  descricaoRaw:  string;
}

const CNPJ_RE = /\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}/g;

function parseNE(text: string): ParsedNE {
  // — CNPJ do favorecido —
  // Na NE há 2 CNPJs: UG Emitente (label "CNPJ") e fornecedor (label "Código").
  // Estratégia: achar e excluir o da UG — o restante é do fornecedor.
  const allCNPJs = text.match(CNPJ_RE) ?? [];
  let cnpj = "";
  let ugCnpj: string | null = null;
  for (const m of text.matchAll(/\bCNPJ\b/gi)) {
    const trecho = text.slice(m.index, m.index! + 120);
    const found = trecho.match(/(\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2})/);
    if (found) { ugCnpj = found[1]; break; }
  }
  const fornCnpjs = allCNPJs.filter(c => c !== ugCnpj);
  if (fornCnpjs.length > 0) {
    cnpj = fornCnpjs[0];
  } else if (allCNPJs.length > 0) {
    cnpj = allCNPJs[allCNPJs.length - 1];
  }

  // — Número da NE —
  // Tenta "2026NE000550" direto, ou "2026 NE 550"
  let neNumero = "";
  const neFull = text.match(/\b(20\d{2}NE\d{3,8})\b/i);
  if (neFull) {
    neNumero = neFull[1].toUpperCase();
  } else {
    const neParts = text.match(/\b(20\d{2})\s+NE\s+(\d{1,6})\b/i);
    if (neParts) {
      neNumero = `${neParts[1]}NE${neParts[2].padStart(6, "0")}`;
    }
  }

  // — Nome da OM emitente —
  // Após "UG Emitente": código 6 dígitos → nome → "REAL"
  let omNome = "";
  const omMatch = text.match(/\b\d{6}\s+([A-ZÁÉÍÓÚÀÂÃÊÕÜÇ][A-ZÁÉÍÓÚÀÂÃÊÕÜÇ\s\-]+?)(?=\s+REAL\s|\s+CNPJ\s)/i);
  if (omMatch) omNome = omMatch[1].replace(/\s+/g, " ").trim();

  // — Nome do favorecido —
  // Vem logo após o CNPJ do "Código"; corta antes de "Endereço", "CEP" etc.
  let favorecidoNome = "";
  if (cnpj) {
    const cnpjIdx = text.indexOf(cnpj);
    if (cnpjIdx !== -1) {
      const nomeRaw = text.slice(cnpjIdx + cnpj.length)
        .replace(/[\r\n]+/g, " ")
        .replace(/\s{2,}/g, " ")
        .trim();
      const nomeCut = nomeRaw.replace(
        /\s*(Endere[çc]o|CEP\b|Munic[ií]pio|Telefone|\bUF\b|Fax\b|Bairro).*/i, ""
      );
      if (nomeCut.length > 2) favorecidoNome = nomeCut.slice(0, 80).trim();
    }
  }

  // — Contato do militar responsável —
  // Padrão: posto/graduação + nome + telefone
  let contato = "";
  const RANKS = "Gen|Brig|Cel|TC|Maj|Cap|1T|2T|1TEN|2TEN|Sub|Cb|Sd|Asp|CF|CC|CT|CMG|Alv|CV";
  const contatoRe = new RegExp(
    `\\b(${RANKS})[\\.\\s]+([A-ZÁÉÍÓÚÀÂÃÊÕÜÇ][A-Za-záéíóúàâãêôõüç\\s]{3,40}?)(\\(\\d{2}\\)\\s*[\\d\\s\\-]{8,13})`,
    "i"
  );
  const contatoMatch = text.match(contatoRe);
  if (contatoMatch) {
    contato = `${contatoMatch[1]} ${contatoMatch[2].trim()} ${contatoMatch[3].trim()}`;
  }

  // Descrição raw: trecho relevante do texto para o usuário revisar
  const descIdx = text.search(/Descri[çc][aã]o/i);
  const descricaoRaw = descIdx >= 0 ? text.slice(descIdx, descIdx + 800).trim() : text.slice(0, 800);

  return { neNumero, cnpj, omNome, contato, favorecidoNome, descricaoRaw };
}

// ─── Componente ───────────────────────────────────────────────────────────────

interface Props {
  onClose: () => void;
}

type Step = "idle" | "extracting" | "review" | "sending" | "done" | "error";

const S = {
  bg:    "#111c35",
  bg2:   "#1e2d50",
  bdr:   "rgba(99,102,241,0.25)",
  bdr2:  "rgba(99,102,241,0.45)",
  txt:   "#e2e8f0",
  muted: "#64748b",
  accent:"#818cf8",
  label: { fontSize: 11, fontWeight: 600, color: "#818cf8", textTransform: "uppercase" as const, letterSpacing: "0.05em" },
  input: { background: "#1e2d50", border: "1px solid rgba(99,102,241,0.3)", borderRadius: 8, padding: "8px 12px", fontSize: 13, color: "#e2e8f0", outline: "none", width: "100%", boxSizing: "border-box" as const },
};

export function EnviadorNEFornecedor({ onClose }: Props) {
  const [step,   setStep]   = useState<Step>("idle");
  const [dragging, setDragging] = useState(false);
  const [pdfFile,  setPdfFile]  = useState<File | null>(null);
  const [parsed,   setParsed]   = useState<ParsedNE | null>(null);
  const [errMsg,   setErrMsg]   = useState("");

  // Campos editáveis (inicializados com o resultado do parser)
  const [neNumero,      setNeNumero]      = useState("");
  const [cnpj,          setCnpj]          = useState("");
  const [omNome,        setOmNome]        = useState("");
  const [contato,       setContato]       = useState("");
  const [emailForn,     setEmailForn]     = useState("");
  const [emailManual,   setEmailManual]   = useState(false);
  const [lookupStatus,  setLookupStatus]  = useState<"idle"|"found"|"notfound">("idle");

  const fileRef = useRef<HTMLInputElement>(null);

  // — Processa PDF —
  const processPDF = useCallback(async (file: File) => {
    if (!file.type.includes("pdf")) { setErrMsg("Arquivo inválido — arraste um PDF."); setStep("error"); return; }
    setPdfFile(file);
    setStep("extracting");
    try {
      const text = await extractPDFText(file);
      const data = parseNE(text);
      setParsed(data);
      setNeNumero(data.neNumero);
      setCnpj(data.cnpj);
      setOmNome(data.omNome);
      setContato(data.contato);
      setStep("review");

      // Lookup de e-mail pelo CNPJ
      if (data.cnpj) {
        const clean = data.cnpj.replace(/\D/g, "");
        const { data: fn } = await supabase
          .from("fornecedores_email")
          .select("email")
          .eq("cnpj", clean)
          .single();
        if (fn?.email) {
          setEmailForn(fn.email);
          setLookupStatus("found");
        } else {
          setLookupStatus("notfound");
          setEmailManual(true);
        }
      } else {
        setLookupStatus("notfound");
        setEmailManual(true);
      }
    } catch (e) {
      console.error(e);
      setErrMsg("Erro ao ler o PDF. Verifique se o arquivo é uma NE válida.");
      setStep("error");
    }
  }, []);

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) processPDF(file);
  }, [processPDF]);

  // — Envio —
  const handleSend = async () => {
    if (!pdfFile) return;
    if (!emailForn.trim()) { setErrMsg("Informe o e-mail do fornecedor."); return; }
    setErrMsg("");
    setStep("sending");
    try {
      const pdf_base64  = await fileToBase64(pdfFile);
      const pdf_filename = `NE-${neNumero || "empenho"}.pdf`;
      const { error } = await supabase.functions.invoke("send-empenho-email", {
        body: {
          tipo:            "CONVOCACAO",
          email:           emailForn.trim().toLowerCase(),
          ne_numero:       neNumero.trim(),
          om_nome:         omNome.trim() || "GRUPAMENTO DE APOIO DE MANAUS",
          contato:         contato.trim(),
          favorecido_nome: parsed?.favorecidoNome ?? "",
          pdf_base64,
          pdf_filename,
        },
      });
      if (error) throw error;
      setStep("done");
    } catch (e: any) {
      setErrMsg(e?.message ?? "Falha ao enviar. Tente novamente.");
      setStep("review");
    }
  };

  const reset = () => {
    setStep("idle"); setPdfFile(null); setParsed(null); setNeNumero(""); setCnpj("");
    setOmNome(""); setContato(""); setEmailForn(""); setEmailManual(false);
    setLookupStatus("idle"); setErrMsg("");
  };

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 60, display: "flex", alignItems: "center", justifyContent: "center", padding: 16, backgroundColor: "rgba(0,0,0,0.65)" }}>
      <div style={{ width: "100%", maxWidth: 640, maxHeight: "92vh", display: "flex", flexDirection: "column", borderRadius: 18, overflow: "hidden", background: S.bg, border: `1px solid ${S.bdr}`, boxShadow: "0 24px 64px rgba(0,0,0,0.5)" }}>

        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "16px 20px", background: S.bg2, borderBottom: `1px solid ${S.bdr}` }}>
          <div>
            <div style={{ fontWeight: 700, fontSize: 15, color: S.txt }}>📨 Enviar NE ao Fornecedor</div>
            <div style={{ fontSize: 11, color: S.muted, marginTop: 2 }}>Arraste o PDF da NE assinada — o sistema extrai o CNPJ e envia a convocação</div>
          </div>
          <button onClick={onClose} style={{ background: "none", border: "none", color: S.muted, fontSize: 20, cursor: "pointer", lineHeight: 1 }}>✕</button>
        </div>

        <div style={{ flex: 1, overflowY: "auto", padding: 20, background: S.bg }}>

          {/* ── IDLE: Drop zone ── */}
          {(step === "idle" || step === "error") && (
            <div>
              <div
                onDragOver={e => { e.preventDefault(); setDragging(true); }}
                onDragLeave={() => setDragging(false)}
                onDrop={onDrop}
                onClick={() => fileRef.current?.click()}
                style={{
                  border: `2px dashed ${dragging ? "#818cf8" : "rgba(99,102,241,0.4)"}`,
                  borderRadius: 14,
                  padding: "48px 24px",
                  textAlign: "center",
                  cursor: "pointer",
                  background: dragging ? "rgba(99,102,241,0.08)" : "rgba(99,102,241,0.03)",
                  transition: "all 0.15s",
                }}
              >
                <div style={{ fontSize: 44, marginBottom: 12 }}>📄</div>
                <div style={{ fontSize: 15, fontWeight: 600, color: S.txt, marginBottom: 6 }}>Arraste o PDF da NE assinada aqui</div>
                <div style={{ fontSize: 12, color: S.muted }}>ou clique para selecionar o arquivo</div>
              </div>
              <input ref={fileRef} type="file" accept="application/pdf" style={{ display: "none" }} onChange={e => { const f = e.target.files?.[0]; if (f) processPDF(f); }} />
              {errMsg && <div style={{ marginTop: 14, padding: "10px 14px", borderRadius: 8, background: "rgba(239,68,68,0.12)", border: "1px solid rgba(239,68,68,0.3)", color: "#fca5a5", fontSize: 13 }}>{errMsg}</div>}
            </div>
          )}

          {/* ── EXTRACTING ── */}
          {step === "extracting" && (
            <div style={{ textAlign: "center", padding: "60px 0", color: S.muted }}>
              <div style={{ fontSize: 36, marginBottom: 12 }}>⏳</div>
              <div style={{ fontSize: 14, color: S.txt }}>Lendo o PDF e extraindo os dados…</div>
            </div>
          )}

          {/* ── REVIEW: Formulário ── */}
          {step === "review" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>

              {/* NE Número */}
              <div>
                <label style={S.label}>Número da NE</label>
                <input value={neNumero} onChange={e => setNeNumero(e.target.value)} style={{ ...S.input, marginTop: 4, fontFamily: "monospace", fontWeight: 700 }} placeholder="Ex: 2026NE000550" />
              </div>

              {/* CNPJ + email */}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <div>
                  <label style={S.label}>CNPJ do Favorecido</label>
                  <input value={cnpj} onChange={e => { setCnpj(e.target.value); setLookupStatus("idle"); setEmailForn(""); setEmailManual(true); }} style={{ ...S.input, marginTop: 4, fontFamily: "monospace" }} placeholder="00.000.000/0000-00" />
                </div>
                <div>
                  <label style={S.label}>
                    E-mail do Fornecedor
                    {lookupStatus === "found" && <span style={{ color: "#4ade80", fontWeight: 400, marginLeft: 6, textTransform: "none" }}>✓ encontrado no banco</span>}
                    {lookupStatus === "notfound" && <span style={{ color: "#fb923c", fontWeight: 400, marginLeft: 6, textTransform: "none" }}>⚠ CNPJ sem cadastro</span>}
                  </label>
                  <input
                    value={emailForn}
                    onChange={e => setEmailForn(e.target.value)}
                    readOnly={lookupStatus === "found" && !emailManual}
                    style={{ ...S.input, marginTop: 4, opacity: (lookupStatus === "found" && !emailManual) ? 0.7 : 1 }}
                    placeholder="contato@empresa.com.br"
                  />
                  {lookupStatus === "found" && !emailManual && (
                    <button onClick={() => setEmailManual(true)} style={{ background: "none", border: "none", color: S.accent, fontSize: 11, cursor: "pointer", padding: "2px 0" }}>editar</button>
                  )}
                </div>
              </div>

              {/* OM nome */}
              <div>
                <label style={S.label}>Local (OM Emitente)</label>
                <input value={omNome} onChange={e => setOmNome(e.target.value)} style={{ ...S.input, marginTop: 4 }} placeholder="GRUPAMENTO DE APOIO DE MANAUS" />
              </div>

              {/* Contato */}
              <div>
                <label style={S.label}>Contato do Militar Responsável</label>
                <input value={contato} onChange={e => setContato(e.target.value)} style={{ ...S.input, marginTop: 4 }} placeholder="2T NOME COMPLETO (92) 98000-0000" />
              </div>

              {/* Descrição raw para referência */}
              {parsed?.descricaoRaw && (
                <div>
                  <label style={{ ...S.label, color: S.muted }}>Descrição extraída (referência)</label>
                  <textarea readOnly value={parsed.descricaoRaw} rows={5} style={{ ...S.input, marginTop: 4, fontFamily: "monospace", fontSize: 11, resize: "vertical", opacity: 0.6 }} />
                </div>
              )}

              {errMsg && <div style={{ padding: "10px 14px", borderRadius: 8, background: "rgba(239,68,68,0.12)", border: "1px solid rgba(239,68,68,0.3)", color: "#fca5a5", fontSize: 13 }}>{errMsg}</div>}
            </div>
          )}

          {/* ── SENDING ── */}
          {step === "sending" && (
            <div style={{ textAlign: "center", padding: "60px 0", color: S.muted }}>
              <div style={{ fontSize: 36, marginBottom: 12 }}>📤</div>
              <div style={{ fontSize: 14, color: S.txt }}>Enviando e-mail com a NE em anexo…</div>
            </div>
          )}

          {/* ── DONE ── */}
          {step === "done" && (
            <div style={{ textAlign: "center", padding: "60px 0" }}>
              <div style={{ fontSize: 44, marginBottom: 16 }}>✅</div>
              <div style={{ fontSize: 16, fontWeight: 700, color: "#4ade80", marginBottom: 8 }}>E-mail enviado com sucesso!</div>
              <div style={{ fontSize: 13, color: S.muted, marginBottom: 4 }}>NE: <span style={{ color: S.accent, fontFamily: "monospace" }}>{neNumero}</span></div>
              <div style={{ fontSize: 13, color: S.muted }}>Destinatário: <span style={{ color: S.txt }}>{emailForn}</span></div>
            </div>
          )}

        </div>

        {/* Footer */}
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, padding: "14px 20px", background: S.bg2, borderTop: `1px solid ${S.bdr}` }}>
          {step === "done" ? (
            <>
              <button onClick={reset} style={{ background: "rgba(99,102,241,0.15)", border: `1px solid ${S.bdr}`, borderRadius: 8, padding: "7px 18px", fontSize: 13, color: S.accent, cursor: "pointer" }}>Enviar outra NE</button>
              <button onClick={onClose} style={{ background: "#4f46e5", border: "none", borderRadius: 8, padding: "7px 18px", fontSize: 13, fontWeight: 600, color: "#fff", cursor: "pointer" }}>Fechar</button>
            </>
          ) : step === "review" ? (
            <>
              <button onClick={reset} style={{ background: "transparent", border: `1px solid ${S.bdr}`, borderRadius: 8, padding: "7px 18px", fontSize: 13, color: S.muted, cursor: "pointer" }}>↩ Trocar PDF</button>
              <button
                onClick={handleSend}
                disabled={!emailForn.trim() || !neNumero.trim()}
                style={{ background: "#4f46e5", border: "none", borderRadius: 8, padding: "7px 18px", fontSize: 13, fontWeight: 600, color: "#fff", cursor: "pointer", opacity: (!emailForn.trim() || !neNumero.trim()) ? 0.5 : 1 }}
              >📨 Enviar ao Fornecedor</button>
            </>
          ) : step === "idle" || step === "error" ? (
            <button onClick={onClose} style={{ background: "transparent", border: `1px solid ${S.bdr}`, borderRadius: 8, padding: "7px 18px", fontSize: 13, color: S.muted, cursor: "pointer" }}>Cancelar</button>
          ) : null}
        </div>

      </div>
    </div>
  );
}
