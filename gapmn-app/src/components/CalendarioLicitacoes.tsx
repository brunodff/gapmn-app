import { useState, useEffect, useCallback } from "react";
import { supabase } from "../lib/supabase";

// ── Tipos ────────────────────────────────────────────────────────────────────

type Row = {
  id: string;
  ano: number;
  num_ordem: number | null;
  num_contratacao: string | null;
  num_dfd: string | null;
  data_limite_remessa: string | null;
  chegada_doc: string | null;
  modalidade: string | null;
  descricao_objeto: string | null;
  apoiada: string | null;
  previsao_finalizacao: string | null;
  num_pag: string | null;
  situacao_detalhada: string | null;
  status: string | null;
  cod: string | null;
  responsavel: string | null;
  responsavel_email: string | null;
  valor_estimado: number | null;
  responsavel_apoiada: string | null;
  pam_s: string | null;
  envio_pam_aci: string | null;
  data_abertura_pag: string | null;
  num_irp: string | null;
  edital_autorizacao_anexos: string | null;
  parecer_referencial: string | null;
  envio_cju: string | null;
  recebimento_analise_cju: string | null;
  envio_parecer_apoiada: string | null;
  recebimento_correcoes_cju: string | null;
  aprovacao_aci: string | null;
  envio_edital_assinatura: string | null;
  publicacao_comprasnet: string | null;
  publicacao_dou_pncp: string | null;
  publicacao_ebc: string | null;
  publicacao_portal_fab: string | null;
  autuacao_subprocesso_pub: string | null;
  pregoeiro_cpl: string | null;
  num_siasg: string | null;
  abertura_sessao_publica: string | null;
  data_homologacao: string | null;
  tempo_licitacao: string | null;
  homologado: boolean;
  cancelada: boolean;
  subprocesso_fase_externa: string | null;
  anotacao_interna: string | null;
  observacao: string | null;
  historico: string | null;
};

type FormData = Omit<Row, "id">;

const EMPTY_FORM: FormData = {
  ano: new Date().getFullYear(),
  num_ordem: null, num_contratacao: null, num_dfd: null,
  data_limite_remessa: null, chegada_doc: null, modalidade: null,
  descricao_objeto: null, apoiada: null, previsao_finalizacao: null,
  num_pag: null, situacao_detalhada: null, status: null, cod: null,
  responsavel: null, responsavel_email: null, valor_estimado: null,
  responsavel_apoiada: null, pam_s: null, envio_pam_aci: null,
  data_abertura_pag: null, num_irp: null, edital_autorizacao_anexos: null,
  parecer_referencial: null, envio_cju: null, recebimento_analise_cju: null,
  envio_parecer_apoiada: null, recebimento_correcoes_cju: null,
  aprovacao_aci: null, envio_edital_assinatura: null,
  publicacao_comprasnet: null, publicacao_dou_pncp: null,
  publicacao_ebc: null, publicacao_portal_fab: null,
  autuacao_subprocesso_pub: null, pregoeiro_cpl: null, num_siasg: null,
  abertura_sessao_publica: null, data_homologacao: null,
  tempo_licitacao: null, homologado: false, cancelada: false,
  subprocesso_fase_externa: null, anotacao_interna: null,
  observacao: null, historico: null,
};

const STATUS_OPTIONS = [
  "Aguardando DFD", "DFD Recebido", "Aguardando DNR",
  "Em elaboração do TR/ETP", "TR/ETP Elaborado",
  "Aguardando aprovação ACI", "Aprovado pela ACI",
  "Enviado à CJU", "Em análise CJU",
  "Aguardando correções da apoiada",
  "Edital em fase de publicação", "Em licitação",
  "Aguardando homologação", "Homologado", "Contrato assinado",
  "Cancelado", "Suspenso", "Deserto", "Fracassado",
];

const MODALIDADE_OPTIONS = [
  "Pregão Eletrônico", "Concorrência", "Dispensa de Licitação",
  "Inexigibilidade", "Adesão ARP", "Credenciamento",
  "Diálogo Competitivo", "Leilão",
];

const SECOES = [
  "Identificação",
  "Status",
  "Tramitação",
  "Fase Jurídica",
  "Publicação",
  "Resultado",
  "Observações",
];

function statusColor(s: string | null) {
  if (!s) return "bg-slate-100 text-slate-500";
  const v = s.toLowerCase();
  if (v.includes("homolog") || v.includes("assinado")) return "bg-green-100 text-green-800";
  if (v.includes("cancel") || v.includes("suspen") || v.includes("deserto") || v.includes("fracas"))
    return "bg-red-100 text-red-700";
  if (v.includes("licitaç") || v.includes("licitac") || v.includes("sessão"))
    return "bg-blue-100 text-blue-800";
  if (v.includes("cju") || v.includes("aci") || v.includes("publicaç"))
    return "bg-violet-100 text-violet-700";
  return "bg-amber-100 text-amber-800";
}

function fmtDate(d: string | null) {
  if (!d) return "—";
  try { return new Date(d + "T12:00:00").toLocaleDateString("pt-BR"); } catch { return d; }
}

function fmtMoney(v: number | null) {
  if (v == null) return "—";
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(v);
}

type Props = { canEdit: boolean; userNome: string | null };

// ── Helpers de campo ─────────────────────────────────────────────────────────

const LBL = "block text-xs font-semibold text-slate-600 uppercase tracking-wide mb-1";
const INP = "w-full border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-sky-400 bg-white";

// ── Component ────────────────────────────────────────────────────────────────

export default function CalendarioLicitacoes({ canEdit, userNome }: Props) {
  const currentYear = new Date().getFullYear();
  const [anoFiltro, setAnoFiltro] = useState(currentYear);
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [busca, setBusca] = useState("");

  const [modal, setModal] = useState<{ open: boolean; row: Row | null }>({ open: false, row: null });
  const [form, setForm] = useState<FormData>(EMPTY_FORM);
  const [prevStatus, setPrevStatus] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [secao, setSecao] = useState(0);

  const [emailDialog, setEmailDialog] = useState<{
    open: boolean; novoStatus: string; row: Row;
  } | null>(null);
  const [enviandoEmail, setEnviandoEmail] = useState(false);
  const [emailResultado, setEmailResultado] = useState<"ok" | "erro" | null>(null);

  // ── Dados ─────────────────────────────────────────────────────────────────

  const fetchRows = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase
      .from("calendario_licitacoes")
      .select("*")
      .eq("ano", anoFiltro)
      .order("num_ordem", { ascending: true });
    setRows((data ?? []) as Row[]);
    setLoading(false);
  }, [anoFiltro]);

  useEffect(() => { fetchRows(); }, [fetchRows]);

  const [anosDisponiveis, setAnosDisponiveis] = useState<number[]>([currentYear]);
  useEffect(() => {
    (async () => {
      const { data } = await supabase.from("calendario_licitacoes").select("ano");
      if (data) {
        const anos = Array.from(new Set(data.map((r: { ano: number }) => r.ano))).sort((a, b) => b - a);
        if (!anos.includes(currentYear)) anos.unshift(currentYear);
        setAnosDisponiveis(anos as number[]);
      }
    })();
  }, [currentYear]);

  const rowsFiltradas = rows.filter((r) => {
    if (!busca) return true;
    const q = busca.toLowerCase();
    return (
      r.descricao_objeto?.toLowerCase().includes(q) ||
      r.num_contratacao?.toLowerCase().includes(q) ||
      r.num_dfd?.toLowerCase().includes(q) ||
      r.apoiada?.toLowerCase().includes(q) ||
      r.responsavel?.toLowerCase().includes(q) ||
      r.status?.toLowerCase().includes(q) ||
      String(r.num_ordem ?? "").includes(q)
    );
  });

  // ── Modal ─────────────────────────────────────────────────────────────────

  function abrirNovo() {
    setForm({ ...EMPTY_FORM, ano: anoFiltro });
    setPrevStatus(null);
    setSecao(0);
    setModal({ open: true, row: null });
  }

  function abrirEditar(row: Row) {
    const { id: _id, ...rest } = row;
    setForm(rest as FormData);
    setPrevStatus(row.status);
    setSecao(0);
    setModal({ open: true, row });
  }

  function fecharModal() { setModal({ open: false, row: null }); }

  async function salvar() {
    setSaving(true);
    let savedRow: Row | null = null;
    if (modal.row) {
      const { data, error } = await supabase
        .from("calendario_licitacoes").update(form).eq("id", modal.row.id).select().single();
      if (error) { alert("Erro: " + error.message); setSaving(false); return; }
      savedRow = data as Row;
    } else {
      const { data, error } = await supabase
        .from("calendario_licitacoes").insert({ ...form }).select().single();
      if (error) { alert("Erro: " + error.message); setSaving(false); return; }
      savedRow = data as Row;
    }
    setSaving(false);
    fecharModal();
    await fetchRows();
    if (modal.row && form.status && form.status !== prevStatus && form.responsavel_email && savedRow) {
      setEmailDialog({ open: true, novoStatus: form.status, row: savedRow });
    }
  }

  async function deletar(row: Row) {
    if (!confirm(`Excluir processo "${row.num_contratacao ?? row.num_dfd ?? "#" + row.num_ordem}"?`)) return;
    await supabase.from("calendario_licitacoes").delete().eq("id", row.id);
    await fetchRows();
  }

  async function enviarEmail() {
    if (!emailDialog) return;
    const { row, novoStatus } = emailDialog;
    setEnviandoEmail(true);
    setEmailResultado(null);

    const { error } = await supabase.functions.invoke("send-status-licitacao", {
      body: {
        processo_id:        row.id,
        novo_status:        novoStatus,
        email:              row.responsavel_email,
        responsavel_apoiada: row.responsavel_apoiada ?? "Responsável",
        num_contratacao:    row.num_contratacao,
        num_dfd:            row.num_dfd,
        descricao_objeto:   row.descricao_objeto,
        apoiada:            row.apoiada,
        situacao_detalhada: row.situacao_detalhada,
        previsao_finalizacao: row.previsao_finalizacao,
        remetente:          userNome ?? "SLIC/GAP-MN",
      },
    });

    setEnviandoEmail(false);
    setEmailResultado(error ? "erro" : "ok");
    if (!error) setTimeout(() => { setEmailDialog(null); setEmailResultado(null); }, 2000);
  }

  function setField<K extends keyof FormData>(key: K, val: FormData[K]) {
    setForm((p) => ({ ...p, [key]: val || null }));
  }

  // ── Campos do formulário ──────────────────────────────────────────────────

  function txt(key: keyof FormData, label: string, type = "text") {
    return (
      <label key={key} className="flex flex-col">
        <span className={LBL}>{label}</span>
        <input type={type} value={(form[key] as string) ?? ""}
          onChange={(e) => setField(key, (e.target.value || null) as FormData[typeof key])}
          className={INP} disabled={!canEdit} />
      </label>
    );
  }

  function dt(key: keyof FormData, label: string) {
    return (
      <label key={key} className="flex flex-col">
        <span className={LBL}>{label}</span>
        <input type="date" value={(form[key] as string) ?? ""}
          onChange={(e) => setField(key, (e.target.value || null) as FormData[typeof key])}
          className={INP} disabled={!canEdit} />
      </label>
    );
  }

  function sel(key: keyof FormData, label: string, opts: string[]) {
    return (
      <label key={key} className="flex flex-col">
        <span className={LBL}>{label}</span>
        <select value={(form[key] as string) ?? ""}
          onChange={(e) => setField(key, (e.target.value || null) as FormData[typeof key])}
          className={INP + " bg-white"} disabled={!canEdit}>
          <option value="">— Selecionar —</option>
          {opts.map((o) => <option key={o} value={o}>{o}</option>)}
        </select>
      </label>
    );
  }

  function ta(key: keyof FormData, label: string, rows = 3, span2 = true) {
    return (
      <label key={key} className={`flex flex-col${span2 ? " col-span-2" : ""}`}>
        <span className={LBL}>{label}</span>
        <textarea rows={rows} value={(form[key] as string) ?? ""}
          onChange={(e) => setField(key, (e.target.value || null) as FormData[typeof key])}
          className={INP + " resize-none"} disabled={!canEdit} />
      </label>
    );
  }

  // ── Seções ────────────────────────────────────────────────────────────────

  function renderSecao() {
    const g = "grid grid-cols-2 gap-x-6 gap-y-5";
    switch (secao) {
      case 0: return (
        <div className={g}>
          <label className="flex flex-col">
            <span className={LBL}>Ano</span>
            <input type="number" value={form.ano}
              onChange={(e) => setForm((p) => ({ ...p, ano: Number(e.target.value) }))}
              className={INP} disabled={!canEdit} />
          </label>
          <label className="flex flex-col">
            <span className={LBL}>Nº Ordem</span>
            <input type="number" value={form.num_ordem ?? ""}
              onChange={(e) => setForm((p) => ({ ...p, num_ordem: e.target.value ? Number(e.target.value) : null }))}
              className={INP} disabled={!canEdit} />
          </label>
          {txt("num_contratacao", "Nº Contratação (PCA)")}
          {txt("num_dfd", "Nº DFD")}
          {sel("modalidade", "Modalidade", MODALIDADE_OPTIONS)}
          {txt("apoiada", "Apoiada")}
          {ta("descricao_objeto", "Descrição do Objeto")}
          <label className="flex flex-col">
            <span className={LBL}>Valor Estimado (R$)</span>
            <input type="number" step="0.01" value={form.valor_estimado ?? ""}
              onChange={(e) => setForm((p) => ({ ...p, valor_estimado: e.target.value ? Number(e.target.value) : null }))}
              className={INP} disabled={!canEdit} />
          </label>
          {txt("cod", "Cód.")}
        </div>
      );
      case 1: return (
        <div className={g}>
          {sel("status", "Status", STATUS_OPTIONS)}
          {dt("previsao_finalizacao", "Previsão de Finalização")}
          {ta("situacao_detalhada", "Situação Detalhada")}
          {txt("responsavel", "Responsável SLIC")}
          {txt("responsavel_email", "E-mail do Responsável")}
          {txt("responsavel_apoiada", "Responsável da Apoiada")}
        </div>
      );
      case 2: return (
        <div className={g}>
          {dt("data_limite_remessa", "Data Limite de Remessa à DOC")}
          {dt("chegada_doc", "Chegada à DOC do GAP-MN")}
          {txt("num_pag", "Nº do PAG")}
          {dt("data_abertura_pag", "Data de Abertura do PAG")}
          {txt("pam_s", "PAM/S")}
          {dt("envio_pam_aci", "Envio do PAM/S ao ACI")}
          {txt("num_irp", "Nº IRP")}
          {txt("subprocesso_fase_externa", "Subprocesso Fase Externa")}
        </div>
      );
      case 3: return (
        <div className={g}>
          {txt("parecer_referencial", "Parecer Referencial?")}
          {dt("envio_cju", "Envio à CJU")}
          {dt("recebimento_analise_cju", "Recebimento da Análise da CJU")}
          {dt("envio_parecer_apoiada", "Envio Parecer/Nota/Cota à Apoiada")}
          {dt("recebimento_correcoes_cju", "Recebimento de Correções — CJU")}
          {dt("aprovacao_aci", "Aprovação da ACI")}
        </div>
      );
      case 4: return (
        <div className={g}>
          {ta("edital_autorizacao_anexos", "Edital, Autorização e Anexos")}
          {dt("envio_edital_assinatura", "Envio do Edital para Assinatura")}
          {dt("publicacao_comprasnet", "Publicação no ComprasNet")}
          {dt("publicacao_dou_pncp", "Publicação no DOU/PNCP")}
          {dt("publicacao_ebc", "Publicação na EBC")}
          {dt("publicacao_portal_fab", "Publicação no Portal da FAB")}
          {txt("autuacao_subprocesso_pub", "Autuação do Subprocesso de Publicação")}
        </div>
      );
      case 5: return (
        <div className={g}>
          {txt("pregoeiro_cpl", "Pregoeiro / CPL")}
          {txt("num_siasg", "Nº SIASG")}
          {dt("abertura_sessao_publica", "Abertura / Sessão Pública")}
          {dt("data_homologacao", "Data de Homologação")}
          {txt("tempo_licitacao", "Tempo em Aberto")}
          <label className="flex flex-col col-span-2">
            <span className={LBL}>Resultado</span>
            <div className="flex gap-6 mt-1">
              <label className="flex items-center gap-2 text-sm cursor-pointer text-slate-700">
                <input type="checkbox" checked={form.homologado}
                  onChange={(e) => setForm((p) => ({ ...p, homologado: e.target.checked }))}
                  className="h-4 w-4 rounded text-green-600" disabled={!canEdit} />
                Homologado
              </label>
              <label className="flex items-center gap-2 text-sm cursor-pointer text-slate-700">
                <input type="checkbox" checked={form.cancelada}
                  onChange={(e) => setForm((p) => ({ ...p, cancelada: e.target.checked }))}
                  className="h-4 w-4 rounded text-red-600" disabled={!canEdit} />
                Cancelada
              </label>
            </div>
          </label>
        </div>
      );
      case 6: return (
        <div className={g}>
          {ta("anotacao_interna", "Anotação Interna")}
          {ta("observacao", "Observação")}
          {ta("historico", "Histórico", 5)}
        </div>
      );
      default: return null;
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-4 p-1">

      {/* Barra de controles */}
      <div className="rounded-2xl border border-slate-200 bg-white shadow-sm p-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex gap-1 bg-slate-100 rounded-xl p-1">
            {anosDisponiveis.map((a) => (
              <button key={a} onClick={() => setAnoFiltro(a)}
                className={`px-4 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                  anoFiltro === a ? "bg-white text-sky-700 shadow-sm" : "text-slate-500 hover:text-slate-700"
                }`}>{a}</button>
            ))}
          </div>
          <input type="text" placeholder="Buscar por objeto, DFD, apoiada, responsável..."
            value={busca} onChange={(e) => setBusca(e.target.value)}
            className="flex-1 min-w-[220px] border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-400" />
          <div className="ml-auto flex items-center gap-3">
            <span className="text-xs text-slate-400">{rowsFiltradas.length} processo{rowsFiltradas.length !== 1 ? "s" : ""}</span>
            {canEdit && (
              <button onClick={abrirNovo}
                className="rounded-xl bg-sky-600 px-4 py-2 text-xs font-semibold text-white hover:bg-sky-700 transition-colors">
                + Novo Processo
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Tabela */}
      <div className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
        {loading ? (
          <div className="p-12 text-center text-sm text-slate-400">Carregando...</div>
        ) : rowsFiltradas.length === 0 ? (
          <div className="p-12 text-center text-sm text-slate-400">
            Nenhum processo encontrado para {anoFiltro}.{" "}
            {canEdit && <button onClick={abrirNovo} className="text-sky-600 hover:underline">Cadastrar o primeiro</button>}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs text-left">
              <thead>
                <tr className="border-b border-slate-100 bg-slate-50">
                  {["#", "Contratação", "DFD", "Objeto", "Apoiada", "Modalidade", "Status", "Responsável", "Valor Est.", "Previsão", "Hom.", ""].map((h, i) => (
                    <th key={i} className="px-4 py-3 font-semibold text-slate-500 whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rowsFiltradas.map((r, i) => (
                  <tr key={r.id}
                    className={`border-b border-slate-50 hover:bg-slate-50/60 transition-colors ${i % 2 === 1 ? "bg-slate-50/30" : ""} ${r.cancelada ? "opacity-50" : ""}`}>
                    <td className="px-4 py-2.5 text-slate-400 font-mono">{r.num_ordem ?? "—"}</td>
                    <td className="px-4 py-2.5 font-mono text-slate-700 whitespace-nowrap">{r.num_contratacao ?? "—"}</td>
                    <td className="px-4 py-2.5 font-mono text-slate-600 whitespace-nowrap">{r.num_dfd ?? "—"}</td>
                    <td className="px-4 py-2.5 text-slate-800 max-w-[240px]">
                      <span title={r.descricao_objeto ?? ""} className="block truncate">{r.descricao_objeto ?? "—"}</span>
                    </td>
                    <td className="px-4 py-2.5 text-slate-600 whitespace-nowrap">{r.apoiada ?? "—"}</td>
                    <td className="px-4 py-2.5 text-slate-600 whitespace-nowrap">{r.modalidade ?? "—"}</td>
                    <td className="px-4 py-2.5 whitespace-nowrap">
                      {r.status
                        ? <span className={`inline-block rounded-full px-2.5 py-0.5 text-[10px] font-semibold ${statusColor(r.status)}`}>{r.status}</span>
                        : "—"}
                    </td>
                    <td className="px-4 py-2.5 text-slate-600 whitespace-nowrap">{r.responsavel ?? "—"}</td>
                    <td className="px-4 py-2.5 text-slate-600 whitespace-nowrap font-mono">{fmtMoney(r.valor_estimado)}</td>
                    <td className="px-4 py-2.5 text-slate-500 whitespace-nowrap">{fmtDate(r.previsao_finalizacao)}</td>
                    <td className="px-4 py-2.5 text-center">
                      {r.homologado ? <span className="text-green-600 font-bold">✓</span> : <span className="text-slate-200">—</span>}
                    </td>
                    <td className="px-4 py-2.5 whitespace-nowrap">
                      <div className="flex gap-1.5">
                        <button onClick={() => abrirEditar(r)}
                          className="rounded-lg border border-slate-200 px-3 py-1 text-[11px] font-medium text-slate-600 hover:bg-slate-100 transition-colors">
                          {canEdit ? "Editar" : "Ver"}
                        </button>
                        {canEdit && (
                          <button onClick={() => deletar(r)}
                            className="rounded-lg border border-red-200 px-2 py-1 text-[11px] text-red-500 hover:bg-red-50 transition-colors">✕</button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Modal de edição */}
      {modal.open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl flex flex-col max-h-[90vh]">

            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
              <h2 className="text-sm font-bold text-slate-800">
                {modal.row ? "Editar Processo" : "Novo Processo"}
              </h2>
              <button onClick={fecharModal} className="text-slate-400 hover:text-slate-600 text-xl leading-none">×</button>
            </div>

            {/* Abas de seção — sem emojis, texto claro */}
            <div className="flex overflow-x-auto border-b border-slate-100 px-2">
              {SECOES.map((s, i) => (
                <button key={i} onClick={() => setSecao(i)}
                  className={`px-4 py-3 text-xs font-semibold whitespace-nowrap border-b-2 -mb-px transition-colors ${
                    secao === i
                      ? "border-sky-500 text-sky-700"
                      : "border-transparent text-slate-500 hover:text-slate-700 hover:border-slate-300"
                  }`}>
                  {s}
                </button>
              ))}
            </div>

            <div className="overflow-y-auto flex-1 px-6 py-5">
              {renderSecao()}
            </div>

            <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-slate-100">
              <button onClick={fecharModal}
                className="rounded-xl border border-slate-200 px-5 py-2 text-sm text-slate-600 hover:bg-slate-50">
                Cancelar
              </button>
              {canEdit && (
                <button onClick={salvar} disabled={saving}
                  className="rounded-xl bg-sky-600 px-5 py-2 text-sm font-semibold text-white hover:bg-sky-700 disabled:opacity-50 transition-colors">
                  {saving ? "Salvando..." : "Salvar"}
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Dialog de e-mail */}
      {emailDialog?.open && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6 space-y-4">
            <h3 className="text-sm font-bold text-slate-800">Enviar notificação de status?</h3>
            <p className="text-sm text-slate-600">
              O status foi alterado para{" "}
              <span className={`inline-block rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${statusColor(emailDialog.novoStatus)}`}>
                {emailDialog.novoStatus}
              </span>
            </p>
            <div className="rounded-xl bg-slate-50 border border-slate-200 px-4 py-3 text-sm text-slate-700 space-y-1">
              <p><span className="font-semibold text-slate-500">Para:</span> {emailDialog.row.responsavel_apoiada ?? "Responsável da Apoiada"}</p>
              <p><span className="font-semibold text-slate-500">E-mail:</span> {emailDialog.row.responsavel_email}</p>
              <p><span className="font-semibold text-slate-500">Processo:</span> {emailDialog.row.num_contratacao ?? emailDialog.row.num_dfd}</p>
            </div>
            {emailResultado === "ok" && (
              <div className="rounded-xl bg-green-50 border border-green-200 px-4 py-2 text-sm text-green-700 font-semibold text-center">
                E-mail enviado com sucesso!
              </div>
            )}
            {emailResultado === "erro" && (
              <div className="rounded-xl bg-red-50 border border-red-200 px-4 py-2 text-sm text-red-700 text-center">
                Erro ao enviar. Verifique as configurações da edge function.
              </div>
            )}
            <div className="flex gap-3 justify-end">
              <button onClick={() => { setEmailDialog(null); setEmailResultado(null); }}
                disabled={enviandoEmail}
                className="rounded-xl border border-slate-200 px-4 py-2 text-sm text-slate-600 hover:bg-slate-50 disabled:opacity-50">
                Não enviar
              </button>
              <button onClick={enviarEmail} disabled={enviandoEmail || emailResultado === "ok"}
                className="rounded-xl bg-sky-600 px-4 py-2 text-sm font-semibold text-white hover:bg-sky-700 transition-colors disabled:opacity-50">
                {enviandoEmail ? "Enviando..." : "Enviar e-mail"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
