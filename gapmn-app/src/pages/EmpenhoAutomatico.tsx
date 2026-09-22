import { useState, useRef, useCallback, useEffect } from "react";
import {
  parsePdfSolicitacao,
  formatCNPJ,
  type SolicitacaoEmpenho,
  type ItemEmpenho,
} from "../lib/empenhoParser";

const LS_EXT_KEY = "gapmn_empenho_ext_id";

type DocStatus = "pending" | "sending" | "done" | "error";
interface DocEntry {
  payload: SolicitacaoEmpenho;
  status: DocStatus;
  ne?: string;
  errorMsg?: string;
}

const MODALIDADE_LABELS: Record<string, string> = {
  "76": "05 - Pregão",
  "74": "06 - Dispensa",
  "75": "07 - Inexigibilidade",
  "73": "01 - Convite",
  "77": "02 - Tomada de Preços",
  "71": "03 - Concorrência",
  "": "(selecionar)",
};

const TIPO_LABELS: Record<string, string> = {
  compra: "Compra",
  contrato: "Contrato",
  ambiguo: "⚠ Ambíguo — escolher",
};

function fmtBRL(n: number) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(n);
}

// ── Field row ─────────────────────────────────────────────────────────────────
function FieldRow({
  label,
  value,
  low,
  onChange,
  textarea,
  select,
  selectOpts,
}: {
  label: string;
  value: string;
  low?: boolean;
  onChange: (v: string) => void;
  textarea?: boolean;
  select?: boolean;
  selectOpts?: { value: string; label: string }[];
}) {
  const base =
    "w-full rounded-lg border px-3 py-1.5 text-sm font-mono focus:outline-none focus:ring-1 focus:ring-blue-400 " +
    (low
      ? "border-yellow-400 bg-yellow-900/40 text-yellow-200"
      : "border-slate-600 bg-slate-700 text-slate-100");

  return (
    <tr className={low ? "bg-yellow-900/10" : ""}>
      <td className="py-1.5 pr-3 text-xs text-slate-400 whitespace-nowrap align-top pt-2">
        {low && <span className="mr-1 text-yellow-400">⚠</span>}
        {label}
      </td>
      <td className="py-1">
        {select ? (
          <select className={base} value={value} onChange={e => onChange(e.target.value)}>
            {(selectOpts ?? []).map(o => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        ) : textarea ? (
          <textarea
            rows={3}
            className={base + " resize-none"}
            value={value}
            onChange={e => onChange(e.target.value)}
          />
        ) : (
          <input
            type="text"
            className={base}
            value={value}
            onChange={e => onChange(e.target.value)}
          />
        )}
      </td>
    </tr>
  );
}

// ── Conference panel ──────────────────────────────────────────────────────────
function ConferencePanel({
  doc,
  onChange,
}: {
  doc: DocEntry;
  onChange: (updated: SolicitacaoEmpenho) => void;
}) {
  const p = doc.payload;
  const low = new Set(p._lowConf);

  function field<K extends keyof SolicitacaoEmpenho>(
    label: string,
    key: K,
    extra: Partial<Parameters<typeof FieldRow>[0]> = {}
  ) {
    return (
      <FieldRow
        key={String(key)}
        label={label}
        value={String(p[key] ?? "")}
        low={low.has(key as string)}
        onChange={v => onChange({ ...p, [key]: v })}
        {...extra}
      />
    );
  }

  function updateItem(idx: number, patch: Partial<ItemEmpenho>) {
    const itens = p.itens.map((it, i) => (i === idx ? { ...it, ...patch } : it));
    onChange({ ...p, itens });
  }

  const totalOk = p.itens.length > 0 && p.itens.every(it => it.subelemento);
  const errors: string[] = [];
  if (!p.numeroSolicitacao) errors.push("Número da Solicitação ausente");
  if (!p.fornecedorCNPJ || p.fornecedorCNPJ.length !== 14) errors.push("CNPJ do fornecedor inválido");
  if (!totalOk) errors.push("Preencha o Subelemento de todos os itens");
  if (!p.nd) errors.push("ND ausente");
  if (!p.ptres) errors.push("PTRES ausente");
  if (p.tipoOrigem === "ambiguo") errors.push("Defina o Tipo (Compra/Contrato)");

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <span className="text-xl font-bold text-blue-300">{p.numeroSolicitacao || "Sem número"}</span>
          <span className="ml-3 text-sm text-slate-400">{p.fornecedorNome}</span>
        </div>
        <div className="text-right">
          <div className="text-xs text-slate-500">{p._arquivo}</div>
          {p._md5 && <div className="text-xs text-slate-600 font-mono">MD5 {p._md5.slice(0, 8)}…</div>}
        </div>
      </div>

      {/* Low-conf warning */}
      {p._lowConf.length > 0 && (
        <div className="rounded-lg border border-yellow-700 bg-yellow-900/20 px-4 py-2 text-xs text-yellow-300">
          ⚠ {p._lowConf.length} campo(s) com baixa confiança (destacados em amarelo) — revise antes de enviar.
        </div>
      )}

      {/* Fields table */}
      <div className="rounded-xl border border-slate-700 bg-slate-800 overflow-hidden">
        <table className="w-full text-sm">
          <tbody className="divide-y divide-slate-700/50">
            {field("Nº Solicitação", "numeroSolicitacao")}
            {field("Local de Entrega", "localEntrega")}
            {field("CNPJ Fornecedor", "fornecedorCNPJ")}
            {field("Nome Fornecedor", "fornecedorNome")}
            <FieldRow
              label="Tipo"
              value={p.tipoOrigem}
              low={p.tipoOrigem === "ambiguo"}
              onChange={v => onChange({ ...p, tipoOrigem: v as "compra" | "contrato" | "ambiguo" })}
              select
              selectOpts={[
                { value: "compra", label: "Compra" },
                { value: "contrato", label: "Contrato" },
                { value: "ambiguo", label: "⚠ Ambíguo" },
              ]}
            />
            <FieldRow
              label="Modalidade"
              value={p.modalidade}
              low={low.has("modalidade")}
              onChange={v => onChange({ ...p, modalidade: v })}
              select
              selectOpts={Object.entries(MODALIDADE_LABELS).map(([value, label]) => ({ value, label }))}
            />
            {field("Nº Compra / Ano", "numeroCompra")}
            {field("Contrato", "contrato")}
            {field("Nº Processo", "numeroProcesso")}
            {field("ND", "nd")}
            {field("PTRES", "ptres")}
            {field("PI", "pi")}
            {field("UGR", "ugr")}
            {field("FONTE", "fonte")}
            {field("CODEMP", "codemp")}
            {field("Descrição / Observação", "descricaoObservacao", { textarea: true })}
          </tbody>
        </table>
      </div>

      {/* Items */}
      <div className="rounded-xl border border-slate-700 bg-slate-800 overflow-hidden">
        <div className="bg-slate-700/50 px-4 py-2 text-xs font-semibold text-slate-300 uppercase tracking-wide">
          Itens ({p.itens.length})
        </div>
        <table className="w-full text-xs">
          <thead>
            <tr className="text-slate-500 border-b border-slate-700">
              <th className="py-2 px-3 text-left font-normal">Item</th>
              <th className="py-2 px-3 text-left font-normal">Descrição</th>
              <th className="py-2 px-3 text-left font-normal">Qtd</th>
              <th className="py-2 px-3 text-left font-normal">Unid</th>
              <th className="py-2 px-3 text-left font-normal">Vl. Unit.</th>
              <th className="py-2 px-3 text-left font-normal">Vl. Total</th>
              <th className="py-2 px-3 text-left font-normal">
                Subelemento
                {!totalOk && <span className="ml-1 text-yellow-400">⚠</span>}
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-700/50">
            {p.itens.map((it, idx) => (
              <tr key={idx} className={!it.subelemento ? "bg-yellow-900/10" : ""}>
                <td className="py-1.5 px-3 font-mono text-slate-300">{String(it.numeroItem).padStart(5, "0")}</td>
                <td className="py-1.5 px-3 text-slate-400 max-w-[200px] truncate" title={it.descricao}>{it.descricao}</td>
                <td className="py-1.5 px-3">
                  <input
                    type="text"
                    className="w-16 rounded bg-slate-700 border border-slate-600 px-2 py-0.5 text-slate-100 font-mono focus:outline-none focus:border-blue-400"
                    value={String(it.quantidade).replace(".", ",")}
                    onChange={e => {
                      const v = parseFloat(e.target.value.replace(",", ".")) || 0;
                      updateItem(idx, { quantidade: v });
                    }}
                  />
                </td>
                <td className="py-1.5 px-3 text-slate-400">{it.unidade}</td>
                <td className="py-1.5 px-3 text-slate-300 font-mono">
                  {fmtBRL(it.valorUnitario)}
                </td>
                <td className="py-1.5 px-3 text-slate-300 font-mono">
                  {fmtBRL(it.valorTotal)}
                </td>
                <td className="py-1.5 px-3">
                  <input
                    type="text"
                    placeholder="Ex: 24"
                    className={
                      "w-16 rounded border px-2 py-0.5 font-mono focus:outline-none focus:border-blue-400 " +
                      (it.subelemento
                        ? "border-slate-600 bg-slate-700 text-slate-100"
                        : "border-yellow-500 bg-yellow-900/40 text-yellow-200")
                    }
                    value={it.subelemento ?? ""}
                    onChange={e => updateItem(idx, { subelemento: e.target.value })}
                  />
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t border-slate-600">
              <td colSpan={5} className="py-2 px-3 text-right text-slate-400 text-xs">Total:</td>
              <td colSpan={2} className="py-2 px-3 font-mono font-bold text-slate-200">
                {fmtBRL(p._total)}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>

      {/* Validation errors */}
      {errors.length > 0 && (
        <div className="rounded-lg border border-red-700 bg-red-900/20 px-4 py-2 text-xs text-red-300 space-y-1">
          {errors.map((e, i) => <div key={i}>✕ {e}</div>)}
        </div>
      )}
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function EmpenhoAutomatico() {
  const [docs, setDocs]       = useState<DocEntry[]>([]);
  const [selIdx, setSelIdx]   = useState<number>(0);
  const [parsing, setParsing] = useState(false);
  const [parseErr, setParseErr] = useState<string[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const [extId, setExtId]     = useState(() => localStorage.getItem(LS_EXT_KEY) ?? "");
  const [extStatus, setExtStatus] = useState<"checking" | "ok" | "none">("none");
  const [showExtConfig, setShowExtConfig] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  // ── Extension ping ─────────────────────────────────────────────────────────
  const pingExt = useCallback(async (id: string) => {
    if (!id || typeof (window as any).chrome?.runtime?.sendMessage !== "function") {
      setExtStatus("none");
      return;
    }
    setExtStatus("checking");
    const chrome = (window as any).chrome;
    try {
      await new Promise<void>((resolve, reject) => {
        chrome.runtime.sendMessage(id, { type: "PING" }, (res: any) => {
          if (chrome.runtime.lastError || !res?.ok) reject(new Error("não respondeu"));
          else resolve();
        });
        setTimeout(() => reject(new Error("timeout")), 2000);
      });
      setExtStatus("ok");
    } catch {
      setExtStatus("none");
    }
  }, []);

  useEffect(() => { pingExt(extId); }, [extId, pingExt]);

  function saveExtId(id: string) {
    setExtId(id);
    localStorage.setItem(LS_EXT_KEY, id);
    pingExt(id);
  }

  // ── File handling ──────────────────────────────────────────────────────────
  async function handleFiles(files: FileList | File[]) {
    setParsing(true);
    setParseErr([]);
    const arr = Array.from(files);
    const errs: string[] = [];
    const newDocs: DocEntry[] = [];

    for (const f of arr) {
      if (f.type !== "application/pdf") { errs.push(`${f.name}: não é PDF`); continue; }
      try {
        const payload = await parsePdfSolicitacao(f);
        newDocs.push({ payload, status: "pending" });
      } catch (e: any) {
        errs.push(`${f.name}: ${e.message ?? "erro ao parsear"}`);
      }
    }

    setDocs(prev => {
      const next = [...prev, ...newDocs];
      setSelIdx(next.length - newDocs.length);
      return next;
    });
    setParseErr(errs);
    setParsing(false);
  }

  function updateDoc(idx: number, payload: SolicitacaoEmpenho) {
    setDocs(prev => prev.map((d, i) => (i === idx ? { ...d, payload } : d)));
  }

  // ── Send to extension ──────────────────────────────────────────────────────
  async function sendToExt(idx: number) {
    const doc = docs[idx];
    if (!doc) return;

    if (!extId) { alert("Configure o ID da extensão antes de enviar."); setShowExtConfig(true); return; }

    setDocs(prev => prev.map((d, i) => (i === idx ? { ...d, status: "sending" } : d)));

    try {
      const chrome = (window as any).chrome;
      const res = await new Promise<any>((resolve, reject) => {
        chrome.runtime.sendMessage(extId, { type: "START_EMPENHO", payload: doc.payload }, (r: any) => {
          if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
          else resolve(r);
        });
        setTimeout(() => reject(new Error("Extensão não respondeu (timeout)")), 5000);
      });

      if (res?.ok) {
        setDocs(prev => prev.map((d, i) => (i === idx ? { ...d, status: "done", ne: res.ne } : d)));
      } else {
        throw new Error(res?.error ?? "Erro desconhecido");
      }
    } catch (e: any) {
      setDocs(prev => prev.map((d, i) => (i === idx ? { ...d, status: "error", errorMsg: e.message } : d)));
    }
  }

  const currentDoc = docs[selIdx];

  const StatusDot = () => (
    <span
      title={extStatus === "ok" ? "Extensão conectada" : extStatus === "checking" ? "Verificando…" : "Extensão não encontrada"}
      className={
        "inline-block w-2.5 h-2.5 rounded-full mr-1 " +
        (extStatus === "ok" ? "bg-green-400" : extStatus === "checking" ? "bg-yellow-400 animate-pulse" : "bg-red-400")
      }
    />
  );

  // ── Drag-and-drop handlers ─────────────────────────────────────────────────
  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(false);
    if (e.dataTransfer.files.length) handleFiles(e.dataTransfer.files);
  }

  return (
    <div className="min-h-screen" style={{ background: "#0F172A" }}>
      {/* Top bar */}
      <div
        className="sticky top-0 z-30 flex items-center justify-between px-6 py-3 border-b border-slate-700/60"
        style={{ background: "#0F172A" }}
      >
        <div className="flex items-center gap-3">
          <span className="text-2xl">💸</span>
          <div>
            <h1 className="text-lg font-bold text-slate-100">Empenho Automático</h1>
            <p className="text-xs text-slate-500">Upload do PDF → conferência → execução no Contratos.gov.br</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => setShowExtConfig(s => !s)}
            className="flex items-center gap-1.5 rounded-lg border border-slate-600 px-3 py-1.5 text-xs text-slate-300 hover:bg-slate-700 transition"
          >
            <StatusDot />
            Extensão
          </button>
          <a href="/ferramentas" className="text-xs text-slate-500 hover:text-slate-300 transition">← Ferramentas</a>
        </div>
      </div>

      {/* Extension config panel */}
      {showExtConfig && (
        <div className="mx-auto max-w-3xl mt-4 px-4">
          <div className="rounded-xl border border-blue-700/50 bg-blue-900/20 p-4 text-sm space-y-3">
            <div className="font-semibold text-blue-200">Configuração da Extensão Chrome</div>
            <p className="text-slate-400 text-xs leading-relaxed">
              Instale a extensão "GAPMN Empenho Bot" via <strong>chrome://extensions → Load unpacked</strong>,
              selecione a pasta <code className="text-blue-300">extensao-empenho-bot/</code>.
              Depois copie o ID exibido na extensão e cole abaixo.
            </p>
            <div className="flex gap-2">
              <input
                type="text"
                placeholder="Ex: abcdefghijklmnopqrstuvwxyzabcdef"
                className="flex-1 rounded-lg border border-slate-600 bg-slate-800 px-3 py-1.5 text-sm font-mono text-slate-100 focus:outline-none focus:border-blue-400"
                value={extId}
                onChange={e => saveExtId(e.target.value.trim())}
              />
              <button
                onClick={() => pingExt(extId)}
                className="px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold"
              >
                Testar
              </button>
            </div>
            <div className="text-xs">
              {extStatus === "ok" && <span className="text-green-400">✓ Extensão respondendo</span>}
              {extStatus === "none" && <span className="text-red-400">✕ Não encontrada — verifique o ID e se o Contratos.gov.br está aberto</span>}
              {extStatus === "checking" && <span className="text-yellow-400">Verificando…</span>}
            </div>
          </div>
        </div>
      )}

      <div className="mx-auto max-w-7xl px-4 py-6 flex gap-6">
        {/* ── Left: file list ── */}
        <aside className="w-72 shrink-0 space-y-4">
          {/* Upload zone */}
          <div
            onDragOver={e => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={onDrop}
            onClick={() => fileRef.current?.click()}
            className={
              "rounded-xl border-2 border-dashed py-8 px-4 text-center cursor-pointer transition " +
              (dragOver
                ? "border-blue-400 bg-blue-900/20"
                : "border-slate-600 hover:border-slate-400 hover:bg-slate-800/40")
            }
          >
            {parsing ? (
              <div className="flex flex-col items-center gap-2">
                <div className="w-8 h-8 rounded-full border-2 border-blue-400 border-t-transparent animate-spin" />
                <p className="text-xs text-slate-400">Parseando PDFs…</p>
              </div>
            ) : (
              <>
                <div className="text-3xl mb-2">📄</div>
                <p className="text-sm text-slate-300 font-medium">Arraste os PDFs aqui</p>
                <p className="text-xs text-slate-500 mt-1">ou clique para selecionar</p>
                <p className="text-xs text-slate-600 mt-2">Solicitação de Empenho (AQS05044W)</p>
              </>
            )}
          </div>
          <input
            ref={fileRef}
            type="file"
            accept="application/pdf"
            multiple
            className="hidden"
            onChange={e => { if (e.target.files?.length) handleFiles(e.target.files); }}
          />

          {/* Parse errors */}
          {parseErr.length > 0 && (
            <div className="rounded-lg border border-red-700 bg-red-900/20 px-3 py-2 text-xs text-red-300 space-y-1">
              {parseErr.map((e, i) => <div key={i}>✕ {e}</div>)}
            </div>
          )}

          {/* Document list */}
          {docs.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs text-slate-500 uppercase tracking-wide px-1">Documentos ({docs.length})</p>
              {docs.map((d, i) => {
                const isSel = i === selIdx;
                const hasLow = d.payload._lowConf.length > 0;
                return (
                  <button
                    key={i}
                    onClick={() => setSelIdx(i)}
                    className={
                      "w-full text-left rounded-xl p-3 border transition " +
                      (isSel
                        ? "border-blue-500 bg-blue-900/30"
                        : "border-slate-700 bg-slate-800/50 hover:border-slate-500")
                    }
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-mono text-sm font-bold text-blue-300">
                        {d.payload.numeroSolicitacao || "???"}
                      </span>
                      {d.status === "done"
                        ? <span className="text-xs text-green-400">✓ Enviado</span>
                        : d.status === "error"
                        ? <span className="text-xs text-red-400">✕ Erro</span>
                        : d.status === "sending"
                        ? <span className="text-xs text-yellow-400">⏳</span>
                        : hasLow
                        ? <span className="text-xs text-yellow-400">⚠ {d.payload._lowConf.length}</span>
                        : <span className="text-xs text-green-500">✓</span>}
                    </div>
                    <div className="text-xs text-slate-400 truncate mt-0.5">{d.payload.fornecedorNome || d.payload._arquivo}</div>
                    <div className="text-xs text-slate-600 mt-0.5">{fmtBRL(d.payload._total)}</div>
                  </button>
                );
              })}
            </div>
          )}
        </aside>

        {/* ── Right: conference panel ── */}
        <main className="flex-1 min-w-0">
          {!currentDoc ? (
            <div className="flex h-64 items-center justify-center rounded-2xl border border-dashed border-slate-700">
              <div className="text-center text-slate-600">
                <div className="text-5xl mb-3">💸</div>
                <p className="text-sm">Faça upload de um PDF para começar</p>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              <ConferencePanel
                doc={currentDoc}
                onChange={p => updateDoc(selIdx, p)}
              />

              {/* Action bar */}
              <div className="flex items-center gap-3 pt-2 border-t border-slate-700 sticky bottom-0 pb-4" style={{ background: "#0F172A" }}>
                {currentDoc.status === "done" ? (
                  <div className="flex-1 rounded-lg bg-green-900/30 border border-green-700 px-4 py-3 text-sm text-green-300">
                    ✓ Empenho enviado à extensão{currentDoc.ne ? ` — NE: ${currentDoc.ne}` : ""}. Aguarde a confirmação no painel lateral do Chrome.
                  </div>
                ) : currentDoc.status === "error" ? (
                  <>
                    <div className="flex-1 rounded-lg bg-red-900/20 border border-red-700 px-4 py-2 text-xs text-red-300">
                      ✕ {currentDoc.errorMsg}
                    </div>
                    <button
                      onClick={() => sendToExt(selIdx)}
                      className="px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-sm font-semibold"
                    >
                      Tentar novamente
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      onClick={() => sendToExt(selIdx)}
                      disabled={currentDoc.status === "sending"}
                      className="px-6 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-sm font-semibold flex items-center gap-2"
                    >
                      {currentDoc.status === "sending" ? (
                        <>
                          <span className="w-4 h-4 rounded-full border-2 border-white border-t-transparent animate-spin" />
                          Enviando…
                        </>
                      ) : (
                        <>⚡ Executar no Comprasnet</>
                      )}
                    </button>
                    <p className="text-xs text-slate-500">
                      {extStatus === "ok"
                        ? "Extensão conectada. Confirme que o Contratos.gov.br está aberto."
                        : "⚠ Extensão não detectada. Configure o ID acima."}
                    </p>
                  </>
                )}
              </div>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
