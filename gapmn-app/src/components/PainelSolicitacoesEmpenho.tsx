import { useEffect, useRef, useState, useCallback } from "react";
import * as XLSX from "xlsx";
import { supabase } from "../lib/supabase";
import { SHEET_URLS, toEmpenhosNF } from "../lib/gsheets";

const ENVIO_AUTOMATICO_ATIVO = true;

const DATA_INICIO_SIAFI   = new Date(2026, 7, 3); // 03/08/2026 — auto-feed cria registros a partir daqui
const DATA_INICIO_ANTIGAS = new Date(2026, 7, 5); // 05/08/2026 — registros pré-03/08 ASSINADOS passam a aparecer

// ─── Types ────────────────────────────────────────────────────────────────────

type Status = "IMPORTADA" | "EMITIDA" | "ASSINADA" | "ENCERRADA";
type ResultadoEnvio = "ENVIADO" | "PENDENTE_DESATIVADO" | "SEM_EMAIL" | "NOTIF_INATIVA" | "ERRO";

interface Solicitacao {
  id: string;
  numero: string;
  pag: string | null;
  responsavel: string | null;
  email: string | null;
  obs_original: string | null;
  obs_atraso: string | null;
  status: Status;
  ne_siafi: string | null;
  ne_siloms: string | null;
  subprocesso: string | null;
  ugexec: string | null;
  ugcred: string | null;
  indicador_lotacao: string | null;
  nd: string | null;
  fornecedor: string | null;
  valor: number | null;
  pregao: string | null;
  status_siloms: string | null;
  sem_destinatario: boolean;
  notificado_emitida_em: string | null;
  notificado_assinada_em: string | null;
  notificacao_ativa: boolean;
  pdf_ne_url: string | null;
  data_emissao: string | null;
  revisado_em: string | null;
  created_at: string;
}

interface SyncReportItem {
  id: string;
  numero: string;
  ne_siafi: string;
  tipo: "EMITIDA" | "ASSINADA";
  email: string | null;
  resultado: ResultadoEnvio;
  motivo?: string;
}

interface SyncReport {
  executado_em: string;
  itens: SyncReportItem[];
  sem_mudanca: number;
}

// ─── SILOMS column indices (17 cols A–Q) ─────────────────────────────────────
const COL = {
  NUMERO:           0,
  UGEXEC:           1,
  UGCRED:           2,
  INDICADOR:        3,
  ND:               4,
  SUBPROCESSO:      5,
  STATUS_SILOMS:    6,
  COD_FORNECEDOR:   7,
  FORNECEDOR:       8,
  PAG:              9,
  PREGAO:           10,
  USUARIO:          11,
  DT_SOLICITACAO:   12,
  VALOR:            13,
  OBS:              14,
  OC_GERADA:        15,
  REQUISICOES:      16,
} as const;

function normalizeSilomStatus(raw: string): Status {
  const s = (raw ?? "").trim().toLowerCase();
  if (s.startsWith("assinada"))  return "ASSINADA";
  if (s.startsWith("aguarda"))   return "EMITIDA";
  if (s === "encerrada")         return "ENCERRADA";
  return "IMPORTADA";
}

function parseSheetDate(s: string): Date | null {
  const m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!m) return null;
  return new Date(+m[3], +m[2] - 1, +m[1]);
}

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso + "T12:00:00").toLocaleDateString("pt-BR");
}

function extractEmail(obs: string): string {
  const m = obs.match(/([A-Za-z0-9._%+-]+@fab\.mil\.br)/i);
  return m ? m[1].toLowerCase() : "";
}

function extractResponsavelFromDesc(desc: string, email: string): string {
  if (email) {
    const idx = desc.toUpperCase().indexOf(email.toUpperCase());
    if (idx > 0) {
      const before = desc.slice(0, idx).replace(/\s*(CTT|CONTATO|E-MAIL:?)\s*$/i, "").trim();
      const m = before.match(/(\d?[A-Za-z]+\s+\w+)\s*$/i);
      if (m) return m[1].trim();
    }
  }
  const m = desc.match(/(?:RESPONS[ÁA]VEL|RESP\.?)[:\s]+([^,.()\n@]{2,40})/i);
  return m ? m[1].trim() : "";
}

function extractNumeroSolicitacao(raw: unknown): string {
  const s = String(raw ?? "").trim();
  const m = s.match(/\b2[2-9][SM]\d{4,6}\b/i);
  return m ? m[0].toUpperCase() : "";
}

function fmtBRL(v: number | null): string {
  if (!v) return "—";
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(v);
}

const STATUS_LABEL: Record<Status, string> = {
  IMPORTADA:  "Importada",
  EMITIDA:    "Emitida",
  ASSINADA:   "Assinada",
  ENCERRADA:  "Encerrada",
};

const STATUS_CLASS: Record<Status, string> = {
  IMPORTADA:  "bg-slate-100 text-slate-600",
  EMITIDA:    "bg-blue-100 text-blue-700",
  ASSINADA:   "bg-green-100 text-green-700",
  ENCERRADA:  "bg-slate-200 text-slate-500",
};

const RESULTADO_LABEL: Record<ResultadoEnvio, string> = {
  ENVIADO:             "✓ Enviado",
  PENDENTE_DESATIVADO: "⏸ Pendente (envio desativado)",
  SEM_EMAIL:           "✗ Sem e-mail",
  NOTIF_INATIVA:       "✗ Notificação inativa",
  ERRO:                "✗ Erro",
};

const RESULTADO_CLASS: Record<ResultadoEnvio, string> = {
  ENVIADO:             "text-green-700 font-semibold",
  PENDENTE_DESATIVADO: "text-amber-600 font-semibold",
  SEM_EMAIL:           "text-red-600",
  NOTIF_INATIVA:       "text-slate-500",
  ERRO:                "text-red-700 font-semibold",
};

// ─── Component ────────────────────────────────────────────────────────────────

interface Props {
  canManage: boolean;
}

interface Pendencia {
  numero: string;
  motivo: string;
}

export default function PainelSolicitacoesEmpenho({ canManage }: Props) {
  const fileRef    = useRef<HTMLInputElement>(null);
  const pdfInputRef = useRef<HTMLInputElement>(null);
  const pdfTargetId = useRef<string | null>(null);

  const [items, setItems]           = useState<Solicitacao[]>([]);
  const [loading, setLoading]       = useState(false);
  const [syncing, setSyncing]       = useState(false);
  const [importing, setImporting]   = useState(false);
  const [msg, setMsg]               = useState<{ text: string; ok: boolean } | null>(null);

  // Edição inline
  const [editingObs, setEditingObs]     = useState<string | null>(null);
  const [obsValue, setObsValue]         = useState("");
  const [editingEmail, setEditingEmail] = useState<string | null>(null);
  const [emailValue, setEmailValue]     = useState("");

  // Filtros
  const [filterStatus, setFilterStatus]     = useState<"" | Status>("");
  const [filterSemEmail, setFilterSemEmail] = useState(false);
  const [search, setSearch]                 = useState("");
  const [showVerificados, setShowVerificados] = useState(false);

  // Modais
  const [showLog, setShowLog]               = useState(false);
  const [logs, setLogs]                     = useState<any[]>([]);
  const [pendencias, setPendencias]         = useState<Pendencia[]>([]);
  const [showPendencias, setShowPendencias] = useState(false);
  const [showSyncReport, setShowSyncReport] = useState(false);
  const [syncReport, setSyncReport]         = useState<SyncReport | null>(null);

  // Delete / upload
  const [confirmDeleteAll, setConfirmDeleteAll] = useState(false);
  const [deleting, setDeleting]   = useState<string | null>(null);
  const [expandedRow, setExpandedRow] = useState<string | null>(null);
  const [uploadingPdf, setUploadingPdf] = useState<string | null>(null);
  const [verifying, setVerifying] = useState(false);

  // ── Load ──────────────────────────────────────────────────────────────────

  const load = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase
      .from("solicitacoes_empenho")
      .select("*")
      .order("numero");
    setItems((data as Solicitacao[]) ?? []);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const flash = (text: string, ok = true) => {
    setMsg({ text, ok });
    setTimeout(() => setMsg(null), 6000);
  };

  // ── Excel Import ──────────────────────────────────────────────────────────

  async function handleFile(file: File) {
    setImporting(true);
    setPendencias([]);
    try {
      const buf = await file.arrayBuffer();
      const wb  = XLSX.read(buf, { type: "array" });
      const ws  = wb.Sheets[wb.SheetNames[0]];
      const raw: unknown[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" });

      type Row = {
        numero: string;
        ugexec: string | null; ugcred: string | null; indicador_lotacao: string | null;
        nd: string | null; subprocesso: string | null; status_siloms: string | null;
        fornecedor: string | null; pag: string | null; pregao: string | null;
        valor: number | null; obs_original: string | null;
        responsavel: string | null; email: string | null; sem_destinatario: boolean;
      };

      const rows: Row[] = [];
      const pends: Pendencia[] = [];

      for (let i = 2; i < raw.length; i++) {
        const r = raw[i] as unknown[];
        const numero = extractNumeroSolicitacao(r[COL.NUMERO]);
        if (!numero) continue;

        const obs = String(r[COL.OBS] ?? "").trim();
        const email = extractEmail(obs);
        const responsavel = extractResponsavelFromDesc(obs, email);

        const valorRaw = r[COL.VALOR];
        const valor = typeof valorRaw === "number"
          ? valorRaw
          : parseFloat(String(valorRaw ?? "").replace(",", ".")) || null;

        rows.push({
          numero,
          ugexec:            String(r[COL.UGEXEC]      ?? "").trim() || null,
          ugcred:            String(r[COL.UGCRED]      ?? "").trim() || null,
          indicador_lotacao: String(r[COL.INDICADOR]   ?? "").trim() || null,
          nd:                String(r[COL.ND]          ?? "").trim() || null,
          subprocesso:       String(r[COL.SUBPROCESSO] ?? "").trim() || null,
          status_siloms:     String(r[COL.STATUS_SILOMS] ?? "").trim() || null,
          fornecedor:        String(r[COL.FORNECEDOR]  ?? "").trim() || null,
          pag:               String(r[COL.PAG]         ?? "").trim() || null,
          pregao:            String(r[COL.PREGAO]      ?? "").trim() || null,
          valor,
          obs_original:  obs || null,
          responsavel:   responsavel || null,
          email:         email || null,
          sem_destinatario: !email,
        });

        if (!email) pends.push({ numero, motivo: obs ? "OBS sem e-mail @fab.mil.br" : "Coluna OBS vazia" });
      }

      if (!rows.length) {
        flash("Nenhuma solicitação encontrada (col A, linhas a partir de 3). Verifique o arquivo.", false);
        return;
      }

      const { error } = await supabase
        .from("solicitacoes_empenho")
        .upsert(
          rows.map(r => ({ ...r, updated_at: new Date().toISOString() })),
          { onConflict: "numero", ignoreDuplicates: false }
        );

      if (error) throw error;

      setPendencias(pends);
      if (pends.length) setShowPendencias(true);

      const semEmail = rows.filter(r => r.sem_destinatario).length;
      flash(
        `${rows.length} solicitação(ões) importada(s). ` +
        `${rows.length - semEmail} com e-mail · ${semEmail} sem destinatário.`,
        semEmail === 0
      );
      await load();
    } catch (e: any) {
      flash("Erro ao importar: " + e.message, false);
    } finally {
      setImporting(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (f) handleFile(f);
  }

  // ── Sync com planilha SIAFI ────────────────────────────────────────────────

  async function syncWithSiafi() {
    setSyncing(true);
    try {
      const res = await fetch(SHEET_URLS.empenhosNF);
      if (!res.ok) throw new Error("Falha ao buscar planilha NE SIAFI.");
      const csv  = await res.text();
      const rows = csv.split("\n").map((l) =>
        l.split(",").map((c) => c.replace(/^"|"$/g, "").trim())
      );
      const nes = toEmpenhosNF(rows);

      const bySolic = new Map<string, typeof nes>();
      for (const ne of nes) {
        const sol = (ne.solicitacao ?? "").toUpperCase();
        if (!sol) continue;
        if (!bySolic.has(sol)) bySolic.set(sol, []);
        bySolic.get(sol)!.push(ne);
      }

      const { data: current } = await supabase
        .from("solicitacoes_empenho")
        .select("*")
        .order("numero");
      let dbItems = (current as Solicitacao[]) ?? [];

      // ── Auto-feed: criar registros para NEs novas a partir de DATA_INICIO_SIAFI ──
      const nesRecentes = nes.filter(ne => {
        const d = parseSheetDate(ne.data);
        return d && d >= DATA_INICIO_SIAFI && ne.solicitacao;
      });
      const existingNums = new Set(dbItems.map(i => i.numero.toUpperCase()));
      const nesNovas = nesRecentes.filter(ne => !existingNums.has(ne.solicitacao!.toUpperCase()));

      if (nesNovas.length > 0) {
        const records = nesNovas.map(ne => {
          const email       = extractEmail(ne.descricao);
          const responsavel = extractResponsavelFromDesc(ne.descricao, email);
          const status: Status = (ne.nota_empenho && ne.pendente_od !== "Pendente")
            ? "ASSINADA" : "EMITIDA";
          const dateObj = parseSheetDate(ne.data);
          return {
            numero:            ne.solicitacao!,
            pag:               ne.pag || null,
            fornecedor:        ne.nome_fantasia || null,
            valor:             ne.valor || null,
            nd:                ne.natureza || null,
            ugcred:            ne.ugcred_code || null,
            ne_siafi:          ne.nota_empenho || null,
            obs_original:      ne.descricao || null,
            responsavel:       responsavel || null,
            email:             email || null,
            sem_destinatario:  !email,
            status,
            data_emissao:      dateObj ? dateObj.toISOString().slice(0, 10) : null,
            notificacao_ativa: true,
            updated_at:        new Date().toISOString(),
          };
        });

        const { error: upsertErr } = await supabase.from("solicitacoes_empenho").upsert(records, {
          onConflict: "numero",
          ignoreDuplicates: true,
        });
        if (upsertErr) console.error("[GAPMN] Auto-feed upsert error:", upsertErr);

        if (ENVIO_AUTOMATICO_ATIVO) {
          for (const ne of nesNovas) {
            const email = extractEmail(ne.descricao);
            if (!email) continue;
            const status: Status = (ne.nota_empenho && ne.pendente_od !== "Pendente")
              ? "ASSINADA" : "EMITIDA";
            const responsavel = extractResponsavelFromDesc(ne.descricao, email);
            await supabase.functions.invoke("send-empenho-email", {
              body: {
                solicitacao_id: ne.solicitacao!,
                tipo:           status,
                email,
                responsavel:    responsavel || ne.solicitacao!,
                numero:         ne.solicitacao!,
                ne_siafi:       ne.nota_empenho || "",
                pag:            ne.pag,
                fornecedor:     ne.nome_fantasia,
                valor:          ne.valor,
                nd:             ne.natureza,
                data_emissao:   ne.data,
              },
            });
          }
        }

        const { data: refreshed } = await supabase.from("solicitacoes_empenho").select("*").order("numero");
        dbItems = (refreshed as Solicitacao[]) ?? [];
      }

      const reportItens: SyncReportItem[] = [];
      let semMudanca = 0;

      for (const item of dbItems) {
        if (item.status === "ENCERRADA") continue;

        // Registros pré-03/08: não processa até 05/08
        if (item.data_emissao && item.data_emissao < "2026-08-03" && new Date() < DATA_INICIO_ANTIGAS) continue;

        const sheetNEs = bySolic.get(item.numero.toUpperCase());
        if (!sheetNEs?.length) continue;

        const bestNE = sheetNEs[sheetNEs.length - 1];

        const anyAssinada = sheetNEs.some(ne => ne.nota_empenho && ne.pendente_od !== "Pendente");
        const anyEmitida  = sheetNEs.some(ne => ne.pendente_od === "Pendente");

        const newStatus: Status = anyAssinada ? "ASSINADA" : anyEmitida ? "EMITIDA" : item.status;

        if (newStatus === item.status && item.ne_siafi) { semMudanca++; continue; }

        const now = new Date().toISOString();

        // Determina se este é um novo evento de notificação
        const isNovaEmissao  = newStatus === "EMITIDA"  && !item.notificado_emitida_em;
        const isNovaAssinada = newStatus === "ASSINADA" && !item.notificado_assinada_em;
        const isNovoEvento   = isNovaEmissao || isNovaAssinada;

        // Patch base — não inclui timestamps de notificação ainda
        const patch: Record<string, unknown> = {
          status:     newStatus,
          ne_siafi:   bestNE.nota_empenho || item.ne_siafi,
          updated_at: now,
        };

        const tipo = (isNovaEmissao ? "EMITIDA" : "ASSINADA") as "EMITIDA" | "ASSINADA";
        const neNum = bestNE.nota_empenho || item.ne_siafi || "";

        if (isNovoEvento) {
          const temEmail     = !!(item.email && !item.sem_destinatario);
          const notifAtiva   = item.notificacao_ativa;

          if (!temEmail) {
            reportItens.push({ id: item.id, numero: item.numero, ne_siafi: neNum, tipo, email: null, resultado: "SEM_EMAIL", motivo: "Sem e-mail cadastrado" });
          } else if (!notifAtiva) {
            reportItens.push({ id: item.id, numero: item.numero, ne_siafi: neNum, tipo, email: item.email, resultado: "NOTIF_INATIVA", motivo: "Notificação manual desativada" });
          } else if (!ENVIO_AUTOMATICO_ATIVO) {
            // Registra que o evento foi detectado mas e-mail não enviado
            reportItens.push({ id: item.id, numero: item.numero, ne_siafi: neNum, tipo, email: item.email, resultado: "PENDENTE_DESATIVADO", motivo: "Ative ENVIO_AUTOMATICO_ATIVO para enviar" });
          } else {
            // ── Envio automático ativo ─────────────────────────────────────
            let resultadoEnvio: ResultadoEnvio = "ERRO";
            let motivoErro: string | undefined;
            try {
              const { error: fnErr } = await supabase.functions.invoke("send-empenho-email", {
                body: {
                  solicitacao_id: item.id,
                  tipo,
                  email:       item.email,
                  responsavel: item.responsavel ?? item.numero,
                  numero:      item.numero,
                  subprocesso: item.subprocesso,
                  ne_siafi:    neNum,
                  pag:         item.pag,
                  fornecedor:  item.fornecedor,
                  valor:       item.valor,
                  nd:          item.nd,
                  pregao:      item.pregao,
                  obs_atraso:  item.obs_atraso,
                  pdf_ne_url:  item.pdf_ne_url,
                },
              });
              if (!fnErr) {
                resultadoEnvio = "ENVIADO";
                // Marca o timestamp somente quando o e-mail foi de fato enviado
                if (isNovaEmissao)  patch.notificado_emitida_em  = now;
                if (isNovaAssinada) patch.notificado_assinada_em = now;
              } else {
                motivoErro = fnErr.message;
              }
            } catch (e: any) {
              motivoErro = String(e);
            }
            reportItens.push({ id: item.id, numero: item.numero, ne_siafi: neNum, tipo, email: item.email, resultado: resultadoEnvio, motivo: motivoErro });
          }
        } else {
          semMudanca++;
        }

        await supabase.from("solicitacoes_empenho").update(patch).eq("id", item.id);
      }

      const report: SyncReport = { executado_em: new Date().toISOString(), itens: reportItens, sem_mudanca: semMudanca };
      setSyncReport(report);
      setShowSyncReport(true);

      const enviados = reportItens.filter(i => i.resultado === "ENVIADO").length;
      const pendentes = reportItens.filter(i => i.resultado === "PENDENTE_DESATIVADO").length;
      const falhas   = reportItens.filter(i => ["SEM_EMAIL","NOTIF_INATIVA","ERRO"].includes(i.resultado)).length;

      flash(
        reportItens.length === 0
          ? `Sincronizado. ${semMudanca} sem mudança.`
          : `Sincronizado. ${enviados} e-mail(s) enviado(s) · ${pendentes} pendente(s) · ${falhas} sem envio.`,
        falhas === 0
      );
      await load();
    } catch (e: any) {
      flash("Erro na sincronização: " + e.message, false);
    } finally {
      setSyncing(false);
    }
  }

  // ── Verificar relatório ───────────────────────────────────────────────────
  // Marca como revisadas as NEs ASSINADAS que tiveram e-mail enviado.
  // NEs EMITIDAS ficam na página pois ainda aguardam assinatura.

  async function verificarRelatorio() {
    if (!syncReport) return;
    setVerifying(true);
    const idsAssinadasEnviadas = syncReport.itens
      .filter(i => i.tipo === "ASSINADA" && i.resultado === "ENVIADO")
      .map(i => i.id);

    if (idsAssinadasEnviadas.length) {
      await supabase
        .from("solicitacoes_empenho")
        .update({ revisado_em: new Date().toISOString() })
        .in("id", idsAssinadasEnviadas);
    }
    setSyncReport(null);
    setShowSyncReport(false);
    setVerifying(false);
    await load();
    flash(
      idsAssinadasEnviadas.length
        ? `${idsAssinadasEnviadas.length} NE(s) assinada(s) marcada(s) como verificadas e removidas da lista.`
        : "Relatório verificado. Nenhuma NE assinada com e-mail enviado para remover.",
      true
    );
  }

  // ── Edição inline: OBS atraso ─────────────────────────────────────────────

  async function saveObs(id: string) {
    await supabase
      .from("solicitacoes_empenho")
      .update({ obs_atraso: obsValue || null, updated_at: new Date().toISOString() })
      .eq("id", id);
    setEditingObs(null);
    await load();
  }

  // ── Edição inline: E-mail ─────────────────────────────────────────────────

  async function saveEmail(id: string) {
    const trimmed = emailValue.trim().toLowerCase();
    await supabase
      .from("solicitacoes_empenho")
      .update({ email: trimmed || null, sem_destinatario: !trimmed, updated_at: new Date().toISOString() })
      .eq("id", id);
    setEditingEmail(null);
    await load();
  }

  // ── Toggle notificação ────────────────────────────────────────────────────

  async function toggleNotif(item: Solicitacao) {
    await supabase
      .from("solicitacoes_empenho")
      .update({ notificacao_ativa: !item.notificacao_ativa })
      .eq("id", item.id);
    await load();
  }

  // ── Delete ────────────────────────────────────────────────────────────────

  async function deleteOne(id: string) {
    setDeleting(id);
    await supabase.from("solicitacoes_empenho").delete().eq("id", id);
    setDeleting(null);
    await load();
  }

  async function deleteAll() {
    setDeleting("all");
    await supabase.from("solicitacoes_empenho").delete()
      .neq("id", "00000000-0000-0000-0000-000000000000");
    setDeleting(null);
    setConfirmDeleteAll(false);
    await load();
  }

  // ── PDF ───────────────────────────────────────────────────────────────────

  function openPdfPicker(id: string) {
    pdfTargetId.current = id;
    pdfInputRef.current?.click();
  }

  async function handlePdfChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    const id   = pdfTargetId.current;
    if (!file || !id) return;
    if (file.type !== "application/pdf") { flash("Selecione um arquivo PDF.", false); return; }
    setUploadingPdf(id);
    try {
      const item = items.find(i => i.id === id);
      const path = `${item?.numero ?? id}/${Date.now()}.pdf`;
      if (item?.pdf_ne_url) {
        const oldPath = item.pdf_ne_url.split("/empenhos-pdf/")[1];
        if (oldPath) await supabase.storage.from("empenhos-pdf").remove([oldPath]);
      }
      const { error: upErr } = await supabase.storage
        .from("empenhos-pdf")
        .upload(path, file, { contentType: "application/pdf", upsert: true });
      if (upErr) throw upErr;
      const { data: urlData } = supabase.storage.from("empenhos-pdf").getPublicUrl(path);
      await supabase.from("solicitacoes_empenho")
        .update({ pdf_ne_url: urlData.publicUrl, updated_at: new Date().toISOString() })
        .eq("id", id);
      flash("PDF da NE anexado com sucesso.");
      await load();
    } catch (e: any) {
      flash("Erro ao enviar PDF: " + e.message, false);
    } finally {
      setUploadingPdf(null);
      if (pdfInputRef.current) pdfInputRef.current.value = "";
    }
  }

  async function removePdf(item: Solicitacao) {
    if (!item.pdf_ne_url) return;
    const path = item.pdf_ne_url.split("/empenhos-pdf/")[1];
    if (path) await supabase.storage.from("empenhos-pdf").remove([path]);
    await supabase.from("solicitacoes_empenho")
      .update({ pdf_ne_url: null, updated_at: new Date().toISOString() })
      .eq("id", item.id);
    flash("PDF removido.");
    await load();
  }

  // ── Log ───────────────────────────────────────────────────────────────────

  async function loadLog() {
    const { data } = await supabase
      .from("notificacoes_empenho_log")
      .select("*, solicitacoes_empenho(numero)")
      .order("enviado_em", { ascending: false })
      .limit(100);
    setLogs(data ?? []);
    setShowLog(true);
  }

  // ── Reenviar manual ───────────────────────────────────────────────────────

  async function reenviar(it: Solicitacao) {
    if (!it.email) { flash("Sem e-mail cadastrado.", false); return; }
    if (!it.ne_siafi) { flash("Sincronize primeiro (sem NE SIAFI).", false); return; }
    const { error } = await supabase.functions.invoke("send-empenho-email", {
      body: {
        solicitacao_id: it.id,
        tipo:        it.status === "ASSINADA" ? "ASSINADA" : "EMITIDA",
        email:       it.email,
        responsavel: it.responsavel ?? it.numero,
        numero:      it.numero,
        subprocesso: it.subprocesso,
        ne_siafi:    it.ne_siafi,
        pag:         it.pag,
        fornecedor:  it.fornecedor,
        valor:       it.valor,
        nd:          it.nd,
        pregao:      it.pregao,
        obs_atraso:  it.obs_atraso,
        pdf_ne_url:  it.pdf_ne_url,
      },
    });
    if (error) flash("Falha ao reenviar.", false);
    else flash(`E-mail reenviado para ${it.email}.`);
  }

  // ── Filtro ────────────────────────────────────────────────────────────────

  const q = search.toLowerCase();
  const agora = new Date();
  const filtered = items.filter((it) => {
    // Visibilidade por data de emissão
    if (it.data_emissao) {
      if (it.data_emissao < "2026-08-03") {
        // Registro antigo: só aparece se ASSINADA E a partir de 05/08
        if (it.status !== "ASSINADA" || agora < DATA_INICIO_ANTIGAS) return false;
      }
    }
    if (!showVerificados && it.revisado_em) return false;
    if (filterStatus && it.status !== filterStatus) return false;
    if (filterSemEmail && !it.sem_destinatario) return false;
    if (q &&
      !it.numero.toLowerCase().includes(q) &&
      !(it.responsavel ?? "").toLowerCase().includes(q) &&
      !(it.fornecedor ?? "").toLowerCase().includes(q)
    ) return false;
    return true;
  });

  const sorted = [...filtered].sort((a, b) => {
    if (!a.data_emissao && !b.data_emissao) return 0;
    if (!a.data_emissao) return 1;
    if (!b.data_emissao) return -1;
    return b.data_emissao.localeCompare(a.data_emissao);
  });

  const counts = {
    IMPORTADA: items.filter(i => i.status === "IMPORTADA" && !i.revisado_em).length,
    EMITIDA:   items.filter(i => i.status === "EMITIDA"   && !i.revisado_em).length,
    ASSINADA:  items.filter(i => i.status === "ASSINADA"  && !i.revisado_em).length,
    ENCERRADA: items.filter(i => i.status === "ENCERRADA").length,
    semEmail:  items.filter(i => i.sem_destinatario && !i.revisado_em).length,
    verificados: items.filter(i => !!i.revisado_em).length,
  };

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-4">

      {/* ── Flash ── */}
      {msg && (
        <div className={`rounded-xl px-4 py-3 text-sm font-medium ${
          msg.ok ? "bg-green-50 text-green-800 border border-green-200"
                 : "bg-red-50 text-red-800 border border-red-200"
        }`}>
          {msg.text}
        </div>
      )}

      {/* ── Banner: envio desativado ── */}
      {!ENVIO_AUTOMATICO_ATIVO && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-2.5 text-xs text-amber-800 flex items-center gap-2">
          <span className="font-bold">⏸ Envio automático desativado.</span>
          <span>O sync detectará novos empenhos e gerará o relatório, mas não enviará e-mails até que <code className="font-mono bg-amber-100 px-1 rounded">ENVIO_AUTOMATICO_ATIVO</code> seja ativado.</span>
        </div>
      )}

      {/* ── Toolbar ── */}
      <div className="flex flex-wrap items-center gap-2">
        {canManage && (
          <>
            <button
              onClick={() => fileRef.current?.click()}
              disabled={importing}
              className="rounded-lg bg-sky-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-sky-700 disabled:opacity-60 transition-colors"
            >
              {importing ? "Importando…" : "Importar SILOMS Excel"}
            </button>
            <input ref={fileRef} type="file" accept=".xls,.xlsx,.ods" className="hidden" onChange={handleFileChange} />
            <input ref={pdfInputRef} type="file" accept="application/pdf" className="hidden" onChange={handlePdfChange} />

            <button
              onClick={syncWithSiafi}
              disabled={syncing || loading}
              className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-60 transition-colors"
            >
              {syncing ? "Sincronizando…" : "↻ Sincronizar SIAFI"}
            </button>

            {confirmDeleteAll ? (
              <div className="flex items-center gap-1 rounded-lg border border-red-300 bg-red-50 px-2 py-1">
                <span className="text-xs text-red-700 font-medium">Apagar todos os {items.length} registros?</span>
                <button
                  onClick={deleteAll}
                  disabled={deleting === "all"}
                  className="rounded px-2 py-0.5 text-xs font-bold bg-red-600 text-white hover:bg-red-700 disabled:opacity-60"
                >
                  {deleting === "all" ? "Apagando…" : "Confirmar"}
                </button>
                <button onClick={() => setConfirmDeleteAll(false)} className="rounded px-2 py-0.5 text-xs text-red-600 hover:bg-red-100">
                  Cancelar
                </button>
              </div>
            ) : (
              <button
                onClick={() => setConfirmDeleteAll(true)}
                disabled={items.length === 0}
                className="rounded-lg border border-red-200 bg-red-50 px-3 py-1.5 text-xs font-semibold text-red-700 hover:bg-red-100 disabled:opacity-40 transition-colors"
              >
                🗑 Apagar Tudo
              </button>
            )}
          </>
        )}

        {/* Último relatório */}
        {syncReport && (
          <button
            onClick={() => setShowSyncReport(true)}
            className="rounded-lg border border-sky-200 bg-sky-50 px-3 py-1.5 text-xs font-semibold text-sky-700 hover:bg-sky-100 transition-colors"
          >
            📋 Ver Relatório ({syncReport.itens.length})
          </button>
        )}

        <button onClick={loadLog} className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-50 transition-colors">
          📧 Log E-mails
        </button>

        {pendencias.length > 0 && (
          <button
            onClick={() => setShowPendencias(true)}
            className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-1.5 text-xs font-semibold text-amber-700 hover:bg-amber-100 transition-colors"
          >
            ⚠ {pendencias.length} sem destinatário
          </button>
        )}

        <button onClick={load} disabled={loading} className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-50 disabled:opacity-60 transition-colors">
          {loading ? "Carregando…" : "↺ Atualizar"}
        </button>

        {/* Filtros */}
        <div className="ml-auto flex items-center gap-2 flex-wrap">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar nº, responsável ou fornecedor…"
            className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs w-52 focus:outline-none focus:ring-2 focus:ring-sky-300"
          />
          <select
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value as "" | Status)}
            className="rounded-lg border border-slate-200 px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-sky-300"
          >
            <option value="">Todos os status</option>
            <option value="IMPORTADA">Importada</option>
            <option value="EMITIDA">Emitida</option>
            <option value="ASSINADA">Assinada</option>
            <option value="ENCERRADA">Encerrada</option>
          </select>
          <label className="flex items-center gap-1 text-xs text-slate-600 cursor-pointer">
            <input type="checkbox" checked={filterSemEmail} onChange={(e) => setFilterSemEmail(e.target.checked)} className="rounded" />
            Sem e-mail
          </label>
          {counts.verificados > 0 && (
            <label className="flex items-center gap-1 text-xs text-slate-500 cursor-pointer">
              <input type="checkbox" checked={showVerificados} onChange={(e) => setShowVerificados(e.target.checked)} className="rounded" />
              Mostrar verificadas ({counts.verificados})
            </label>
          )}
        </div>
      </div>

      {/* ── Contadores ── */}
      <div className="flex flex-wrap gap-3 text-xs text-slate-500">
        <span>{filtered.length} exibidas</span>
        {(["IMPORTADA","EMITIDA","ASSINADA","ENCERRADA"] as Status[]).map((s) => (
          <span key={s}>
            <span className={`inline-block px-2 py-0.5 rounded-full font-medium ${STATUS_CLASS[s]}`}>
              {STATUS_LABEL[s]}
            </span>{" "}{counts[s as keyof typeof counts]}
          </span>
        ))}
        {counts.semEmail > 0 && (
          <span className="text-amber-600 font-medium">⚠ {counts.semEmail} sem e-mail</span>
        )}
      </div>

      {/* ── Tabela ── */}
      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-slate-200 bg-slate-50 text-left text-slate-500">
              <th className="px-3 py-2.5 font-semibold">Nº Solicitação</th>
              <th className="px-3 py-2.5 font-semibold">Data</th>
              <th className="px-3 py-2.5 font-semibold">Responsável / E-mail</th>
              <th className="px-3 py-2.5 font-semibold">PAG</th>
              <th className="px-3 py-2.5 font-semibold">Fornecedor</th>
              <th className="px-3 py-2.5 font-semibold">Valor</th>
              <th className="px-3 py-2.5 font-semibold">NE SIAFI</th>
              <th className="px-3 py-2.5 font-semibold">Status</th>
              <th className="px-3 py-2.5 font-semibold">Obs. Atraso</th>
              <th className="px-3 py-2.5 font-semibold text-center">Notif.</th>
              {canManage && <th className="px-3 py-2.5 font-semibold">Ações</th>}
            </tr>
          </thead>
          <tbody>
            {sorted.length === 0 && (
              <tr>
                <td colSpan={canManage ? 11 : 10} className="py-10 text-center text-slate-400">
                  {loading ? "Carregando…" : "Nenhuma solicitação pendente. Use os filtros ou ative 'Mostrar verificadas'."}
                </td>
              </tr>
            )}
            {sorted.map((it) => (
              <>
                <tr
                  key={it.id}
                  className={`border-b border-slate-100 hover:bg-slate-50 transition-colors cursor-pointer ${
                    it.revisado_em ? "opacity-40" :
                    it.sem_destinatario ? "bg-amber-50/40" : ""
                  }`}
                  onClick={() => setExpandedRow(expandedRow === it.id ? null : it.id)}
                >
                  {/* Nº */}
                  <td className="px-3 py-2.5">
                    <div className="font-mono font-semibold text-slate-800">{it.numero}</div>
                    {it.subprocesso && <div className="text-slate-400 text-[10px]">SP: {it.subprocesso}</div>}
                    {it.sem_destinatario && <div className="text-amber-600 text-[10px] font-medium">⚠ sem e-mail</div>}
                    {it.revisado_em && <div className="text-slate-400 text-[10px]">✓ verificado</div>}
                  </td>

                  {/* Data */}
                  <td className="px-3 py-2.5 text-slate-600 whitespace-nowrap">{fmtDate(it.data_emissao)}</td>

                  {/* Responsável / E-mail */}
                  <td className="px-3 py-2.5" onClick={e => e.stopPropagation()}>
                    <div className="text-slate-700">{it.responsavel || "—"}</div>
                    {editingEmail === it.id ? (
                      <div className="flex items-center gap-1 mt-0.5">
                        <input
                          autoFocus
                          type="email"
                          value={emailValue}
                          onChange={(e) => setEmailValue(e.target.value)}
                          placeholder="email@fab.mil.br"
                          className="rounded border border-slate-300 bg-white px-2 py-0.5 text-[11px] w-44 text-slate-800 focus:outline-none focus:ring-2 focus:ring-sky-300"
                          onKeyDown={(e) => {
                            if (e.key === "Enter") saveEmail(it.id);
                            if (e.key === "Escape") setEditingEmail(null);
                          }}
                        />
                        <button onClick={() => saveEmail(it.id)} className="text-green-600 hover:text-green-800 font-bold text-xs">✓</button>
                        <button onClick={() => setEditingEmail(null)} className="text-slate-400 hover:text-slate-600 text-xs">✕</button>
                      </div>
                    ) : (
                      <div className="flex items-center gap-1 group mt-0.5">
                        {it.email
                          ? <a href={`mailto:${it.email}`} onClick={e => e.stopPropagation()} className="text-sky-600 hover:underline text-[11px]">{it.email}</a>
                          : <span className="text-slate-400 text-[11px]">—</span>}
                        {canManage && (
                          <button
                            onClick={() => { setEditingEmail(it.id); setEmailValue(it.email ?? ""); }}
                            className="opacity-0 group-hover:opacity-100 text-slate-400 hover:text-sky-600 transition-opacity ml-1 text-[11px]"
                            title="Editar e-mail"
                          >✏</button>
                        )}
                      </div>
                    )}
                  </td>

                  {/* PAG */}
                  <td className="px-3 py-2.5 text-slate-600 font-mono">{it.pag || "—"}</td>

                  {/* Fornecedor */}
                  <td className="px-3 py-2.5 text-slate-700 max-w-[160px] truncate" title={it.fornecedor ?? ""}>{it.fornecedor || "—"}</td>

                  {/* Valor */}
                  <td className="px-3 py-2.5 text-slate-800 font-mono whitespace-nowrap">{fmtBRL(it.valor)}</td>

                  {/* NE SIAFI */}
                  <td className="px-3 py-2.5 font-mono text-slate-800">{it.ne_siafi || "—"}</td>

                  {/* Status */}
                  <td className="px-3 py-2.5">
                    <span className={`inline-block px-2 py-0.5 rounded-full font-semibold ${STATUS_CLASS[it.status]}`}>
                      {STATUS_LABEL[it.status]}
                    </span>
                    {it.status_siloms && <div className="text-slate-400 text-[10px] mt-0.5">{it.status_siloms}</div>}
                    {it.status === "EMITIDA" && it.notificado_emitida_em && (
                      <div className="text-slate-400 text-[10px]">E-mail {new Date(it.notificado_emitida_em).toLocaleDateString("pt-BR")}</div>
                    )}
                    {it.status === "ASSINADA" && it.notificado_assinada_em && (
                      <div className="text-slate-400 text-[10px]">E-mail {new Date(it.notificado_assinada_em).toLocaleDateString("pt-BR")}</div>
                    )}
                  </td>

                  {/* Obs. Atraso */}
                  <td className="px-3 py-2.5" onClick={e => e.stopPropagation()}>
                    {editingObs === it.id ? (
                      <div className="flex items-center gap-1">
                        <input
                          autoFocus
                          value={obsValue}
                          onChange={(e) => setObsValue(e.target.value)}
                          className="rounded border border-slate-300 bg-white px-2 py-1 text-xs w-44 text-slate-800 focus:outline-none focus:ring-2 focus:ring-sky-300"
                          onKeyDown={(e) => {
                            if (e.key === "Enter") saveObs(it.id);
                            if (e.key === "Escape") setEditingObs(null);
                          }}
                        />
                        <button onClick={() => saveObs(it.id)} className="text-green-600 hover:text-green-800 font-bold">✓</button>
                        <button onClick={() => setEditingObs(null)} className="text-slate-400 hover:text-slate-600">✕</button>
                      </div>
                    ) : (
                      <div className="flex items-center gap-1 group">
                        <span className={it.obs_atraso ? "text-red-600" : "text-slate-400"}>{it.obs_atraso || "—"}</span>
                        {canManage && (
                          <button
                            onClick={() => { setEditingObs(it.id); setObsValue(it.obs_atraso ?? ""); }}
                            className="opacity-0 group-hover:opacity-100 text-slate-400 hover:text-sky-600 transition-opacity ml-1"
                          >✏</button>
                        )}
                      </div>
                    )}
                  </td>

                  {/* Notif. */}
                  <td className="px-3 py-2.5 text-center" onClick={e => e.stopPropagation()}>
                    {canManage ? (
                      <button
                        onClick={() => toggleNotif(it)}
                        title={it.notificacao_ativa ? "Ativa — clique para desativar" : "Inativa — clique para ativar"}
                        className={`text-base ${it.notificacao_ativa ? "opacity-100" : "opacity-30"}`}
                      >🔔</button>
                    ) : (
                      <span className={it.notificacao_ativa ? "text-base" : "text-base opacity-30"}>🔔</span>
                    )}
                  </td>

                  {/* Ações */}
                  {canManage && (
                    <td className="px-3 py-2.5" onClick={e => e.stopPropagation()}>
                      <div className="flex items-center gap-1 flex-wrap">
                        <button
                          onClick={() => reenviar(it)}
                          disabled={!it.email || !it.ne_siafi}
                          className="rounded border border-slate-200 px-2 py-1 text-[11px] text-slate-600 hover:bg-slate-50 disabled:opacity-40 transition-colors"
                          title="Reenviar e-mail manualmente"
                        >✉</button>

                        {it.pdf_ne_url ? (
                          <div className="flex items-center gap-0.5">
                            <a
                              href={it.pdf_ne_url}
                              target="_blank"
                              rel="noreferrer"
                              onClick={e => e.stopPropagation()}
                              className="rounded border border-emerald-200 bg-emerald-50 px-2 py-1 text-[11px] text-emerald-700 hover:bg-emerald-100 transition-colors"
                            >📄 NE</a>
                            <button
                              onClick={(e) => { e.stopPropagation(); removePdf(it); }}
                              className="rounded border border-slate-200 px-1 py-1 text-[11px] text-slate-400 hover:text-red-500 hover:bg-red-50 transition-colors"
                            >✕</button>
                          </div>
                        ) : (
                          <button
                            onClick={(e) => { e.stopPropagation(); openPdfPicker(it.id); }}
                            disabled={uploadingPdf === it.id}
                            className="rounded border border-slate-200 px-2 py-1 text-[11px] text-slate-500 hover:bg-slate-50 disabled:opacity-40 transition-colors"
                          >{uploadingPdf === it.id ? "…" : "📎 PDF"}</button>
                        )}

                        <button
                          onClick={() => deleteOne(it.id)}
                          disabled={deleting === it.id}
                          className="rounded border border-red-200 px-2 py-1 text-[11px] text-red-600 hover:bg-red-50 disabled:opacity-40 transition-colors"
                        >{deleting === it.id ? "…" : "🗑"}</button>
                      </div>
                    </td>
                  )}
                </tr>

                {/* Linha expandida */}
                {expandedRow === it.id && (
                  <tr key={`${it.id}-exp`} className="border-b border-slate-100 bg-slate-50">
                    <td colSpan={canManage ? 11 : 10} className="px-4 py-3">
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                        <div><span className="text-slate-400">ND</span><div className="text-slate-800 font-medium">{it.nd || "—"}</div></div>
                        <div><span className="text-slate-400">Pregão</span><div className="text-slate-800 font-medium">{it.pregao || "—"}</div></div>
                        <div><span className="text-slate-400">UG Exec.</span><div className="text-slate-800 font-medium">{it.ugexec || "—"}</div></div>
                        <div><span className="text-slate-400">UG Créd.</span><div className="text-slate-800 font-medium">{it.ugcred || "—"}</div></div>
                        <div><span className="text-slate-400">I/Lotação</span><div className="text-slate-800 font-medium">{it.indicador_lotacao || "—"}</div></div>
                        <div><span className="text-slate-400">Subprocesso</span><div className="text-slate-800 font-medium">{it.subprocesso || "—"}</div></div>
                        <div className="col-span-2"><span className="text-slate-400">OBS Original</span><div className="text-slate-600 break-words">{it.obs_original || "—"}</div></div>
                      </div>
                    </td>
                  </tr>
                )}
              </>
            ))}
          </tbody>
        </table>
      </div>

      {/* ── Modal: Relatório de Sincronização ── */}
      {showSyncReport && syncReport && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ backgroundColor: "rgba(0,0,0,0.55)" }}>
          <div className="svmodal w-full max-w-3xl max-h-[85vh] flex flex-col rounded-2xl shadow-2xl overflow-hidden" style={{ backgroundColor: "#ffffff" }}>

            {/* Header */}
            <div className="flex items-center justify-between px-5 py-4" style={{ backgroundColor: "#f8fafc", borderBottom: "1px solid #e2e8f0" }}>
              <div>
                <h3 className="font-semibold text-sm" style={{ color: "#0f172a" }}>Relatório de Sincronização</h3>
                <p className="text-xs mt-0.5" style={{ color: "#64748b" }}>
                  {new Date(syncReport.executado_em).toLocaleString("pt-BR")} · {syncReport.itens.length} evento(s) · {syncReport.sem_mudanca} sem mudança
                </p>
              </div>
              <button onClick={() => setShowSyncReport(false)} className="text-lg leading-none" style={{ color: "#94a3b8" }}>✕</button>
            </div>

            {/* Resumo */}
            <div className="flex gap-2 px-5 py-3 flex-wrap text-xs" style={{ backgroundColor: "#f1f5f9", borderBottom: "1px solid #e2e8f0" }}>
              {(() => {
                const env  = syncReport.itens.filter(i => i.resultado === "ENVIADO").length;
                const pend = syncReport.itens.filter(i => i.resultado === "PENDENTE_DESATIVADO").length;
                const sEm  = syncReport.itens.filter(i => i.resultado === "SEM_EMAIL").length;
                const inac = syncReport.itens.filter(i => i.resultado === "NOTIF_INATIVA").length;
                const err  = syncReport.itens.filter(i => i.resultado === "ERRO").length;
                return (
                  <>
                    {env  > 0 && <span className="rounded-full px-2.5 py-1 font-semibold" style={{ backgroundColor: "#dcfce7", color: "#15803d" }}>✓ {env} enviado(s)</span>}
                    {pend > 0 && <span className="rounded-full px-2.5 py-1 font-semibold" style={{ backgroundColor: "#fef3c7", color: "#92400e" }}>⏸ {pend} pendente(s)</span>}
                    {sEm  > 0 && <span className="rounded-full px-2.5 py-1 font-semibold" style={{ backgroundColor: "#fee2e2", color: "#dc2626" }}>✗ {sEm} sem e-mail</span>}
                    {inac > 0 && <span className="rounded-full px-2.5 py-1"               style={{ backgroundColor: "#f1f5f9", color: "#475569" }}>✗ {inac} notif. inativa</span>}
                    {err  > 0 && <span className="rounded-full px-2.5 py-1 font-semibold" style={{ backgroundColor: "#fee2e2", color: "#b91c1c" }}>✗ {err} erro(s)</span>}
                    {syncReport.itens.length === 0 && <span style={{ color: "#64748b" }}>Nenhum evento novo detectado.</span>}
                  </>
                );
              })()}
            </div>

            {/* Banner: envio desativado */}
            {!ENVIO_AUTOMATICO_ATIVO && (
              <div className="mx-5 mt-3 rounded-lg px-3 py-2 text-xs" style={{ border: "1px solid #fbbf24", backgroundColor: "#fffbeb", color: "#92400e" }}>
                <strong>⏸ Envio automático desativado.</strong> Os itens abaixo foram detectados mas nenhum e-mail foi enviado.{" "}
                Quando ativar <code className="rounded px-1" style={{ backgroundColor: "#fef3c7", fontFamily: "monospace" }}>ENVIO_AUTOMATICO_ATIVO</code>, o próximo sync enviará automaticamente.
              </div>
            )}

            {/* Tabela de eventos */}
            {syncReport.itens.length > 0 ? (
              <div className="overflow-auto flex-1 px-5 py-3" style={{ backgroundColor: "#ffffff" }}>
                <table className="w-full text-xs">
                  <thead>
                    <tr style={{ borderBottom: "1px solid #e2e8f0" }}>
                      <th className="py-2 text-left font-semibold" style={{ color: "#475569" }}>Nº Solicitação</th>
                      <th className="py-2 text-left font-semibold" style={{ color: "#475569" }}>NE SIAFI</th>
                      <th className="py-2 text-left font-semibold" style={{ color: "#475569" }}>Tipo</th>
                      <th className="py-2 text-left font-semibold" style={{ color: "#475569" }}>E-mail Destino</th>
                      <th className="py-2 text-left font-semibold" style={{ color: "#475569" }}>Resultado</th>
                      <th className="py-2 text-left font-semibold" style={{ color: "#475569" }}>Motivo</th>
                    </tr>
                  </thead>
                  <tbody>
                    {syncReport.itens.map((item, idx) => (
                      <tr key={idx} style={{ borderBottom: "1px solid #f1f5f9", backgroundColor: idx % 2 === 0 ? "#ffffff" : "#f8fafc" }}>
                        <td className="py-2 font-mono font-semibold" style={{ color: "#0f172a" }}>{item.numero}</td>
                        <td className="py-2 font-mono" style={{ color: "#475569" }}>{item.ne_siafi || "—"}</td>
                        <td className="py-2">
                          <span className="rounded-full px-2 py-0.5 font-medium text-[11px]" style={{
                            backgroundColor: item.tipo === "ASSINADA" ? "#dcfce7" : "#dbeafe",
                            color:           item.tipo === "ASSINADA" ? "#15803d"  : "#1d4ed8",
                          }}>{item.tipo}</span>
                        </td>
                        <td className="py-2" style={{ color: "#475569" }}>{item.email || "—"}</td>
                        <td className={`py-2 text-[11px] ${RESULTADO_CLASS[item.resultado]}`}>
                          {RESULTADO_LABEL[item.resultado]}
                        </td>
                        <td className="py-2" style={{ color: "#64748b" }}>{item.motivo || "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="flex-1 flex items-center justify-center py-8" style={{ backgroundColor: "#ffffff" }}>
                <p className="text-sm" style={{ color: "#94a3b8" }}>Nenhum evento novo detectado nesta sincronização.</p>
              </div>
            )}

            {/* Footer */}
            <div className="px-5 py-4 flex items-center justify-between gap-3 flex-wrap" style={{ backgroundColor: "#f8fafc", borderTop: "1px solid #e2e8f0" }}>
              <div className="text-xs" style={{ color: "#64748b" }}>
                {canManage && syncReport.itens.some(i => i.tipo === "ASSINADA" && i.resultado === "ENVIADO") && (
                  <span>NEs assinadas com e-mail enviado serão removidas ao verificar.</span>
                )}
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setShowSyncReport(false)}
                  className="rounded-lg px-4 py-2 text-xs transition-colors"
                  style={{ border: "1px solid #e2e8f0", color: "#475569", backgroundColor: "#ffffff" }}
                >
                  Fechar
                </button>
                {canManage && (
                  <button
                    onClick={verificarRelatorio}
                    disabled={verifying}
                    className="rounded-lg px-4 py-2 text-xs font-semibold text-white transition-colors disabled:opacity-60"
                    style={{ backgroundColor: "#059669" }}
                  >
                    {verifying ? "Verificando…" : "✓ Verificar e Fechar"}
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Modal: Pendências ── */}
      {showPendencias && pendencias.length > 0 && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="svmodal w-full max-w-lg flex flex-col rounded-2xl bg-white shadow-2xl max-h-[70vh]">
            <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
              <h3 className="font-semibold text-slate-900 text-sm">⚠ Registros sem destinatário ({pendencias.length})</h3>
              <button onClick={() => setShowPendencias(false)} className="text-slate-400 hover:text-slate-700">✕</button>
            </div>
            <p className="px-5 py-2 text-xs text-slate-500">Revise a coluna OBS (col O) no Excel. Nenhum e-mail será enviado para eles.</p>
            <div className="overflow-auto flex-1 px-5 pb-4">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-left text-slate-500 border-b border-slate-200">
                    <th className="py-2 font-semibold">Nº Solicitação</th>
                    <th className="py-2 font-semibold">Motivo</th>
                  </tr>
                </thead>
                <tbody>
                  {pendencias.map((p) => (
                    <tr key={p.numero} className="border-b border-slate-100">
                      <td className="py-1.5 font-mono font-semibold text-amber-700">{p.numero}</td>
                      <td className="py-1.5 text-slate-600">{p.motivo}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ── Modal: Log de E-mails ── */}
      {showLog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="svmodal w-full max-w-3xl max-h-[80vh] flex flex-col rounded-2xl bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
              <h3 className="font-semibold text-slate-900 text-sm">Log de Notificações — últimos 100</h3>
              <button onClick={() => setShowLog(false)} className="text-slate-400 hover:text-slate-700">✕</button>
            </div>
            <div className="overflow-auto flex-1 p-2">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-left text-slate-500 border-b border-slate-200">
                    <th className="px-2 py-2">Data/Hora</th>
                    <th className="px-2 py-2">Solicitação</th>
                    <th className="px-2 py-2">Tipo</th>
                    <th className="px-2 py-2">E-mail</th>
                    <th className="px-2 py-2">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {logs.length === 0 && (
                    <tr><td colSpan={5} className="py-8 text-center text-slate-400">Nenhum log encontrado.</td></tr>
                  )}
                  {logs.map((lg) => (
                    <tr key={lg.id} className="border-b border-slate-100">
                      <td className="px-2 py-1.5 text-slate-500">{new Date(lg.enviado_em).toLocaleString("pt-BR")}</td>
                      <td className="px-2 py-1.5 font-mono font-semibold">{lg.solicitacoes_empenho?.numero ?? lg.solicitacao_id?.slice(0, 8)}</td>
                      <td className="px-2 py-1.5">
                        <span className={`px-2 py-0.5 rounded-full font-medium ${lg.tipo === "ASSINADA" ? "bg-green-100 text-green-700" : "bg-blue-100 text-blue-700"}`}>
                          {lg.tipo}
                        </span>
                      </td>
                      <td className="px-2 py-1.5 text-slate-600">{lg.email_destino}</td>
                      <td className="px-2 py-1.5">
                        {lg.sucesso
                          ? <span className="text-green-700 font-semibold">✓ Enviado</span>
                          : <span className="text-red-600 font-semibold">✗ Falha</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
