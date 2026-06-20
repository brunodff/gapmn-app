import { useEffect, useRef, useState, useCallback } from "react";
import * as XLSX from "xlsx";
import { supabase } from "../lib/supabase";
import { SHEET_URLS, toEmpenhosNF } from "../lib/gsheets";

// ─── Types ────────────────────────────────────────────────────────────────────

type Status = "IMPORTADA" | "EMITIDA" | "ASSINADA";

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
  notificado_emitida_em: string | null;
  notificado_assinada_em: string | null;
  notificacao_ativa: boolean;
  created_at: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function extractEmail(obs: string): string {
  const m = obs.match(/[\w.+-]+@fab\.mil\.br/i);
  return m ? m[0].toLowerCase() : "";
}

function extractResponsavel(obs: string): string {
  const m = obs.match(/RESPONS[ÁA]VEL[:\s]+([^.]+)/i);
  return m ? m[1].trim() : "";
}

function extractPag(obs: string): string {
  const m = obs.match(/PAG[:\s]+([^\s.]+)/i);
  return m ? m[1].trim() : "";
}

function extractNumeroSolicitacao(raw: unknown): string {
  const s = String(raw ?? "").trim();
  // Accepts formats like 25S2012, 26M0034, etc.
  const m = s.match(/\b2[2-9][SM]\d{4,6}\b/i);
  return m ? m[0].toUpperCase() : "";
}

const STATUS_LABEL: Record<Status, string> = {
  IMPORTADA: "Importada",
  EMITIDA:   "Emitida",
  ASSINADA:  "Assinada",
};

const STATUS_CLASS: Record<Status, string> = {
  IMPORTADA: "bg-slate-100 text-slate-600",
  EMITIDA:   "bg-blue-100 text-blue-700",
  ASSINADA:  "bg-green-100 text-green-700",
};

// ─── Component ────────────────────────────────────────────────────────────────

interface Props {
  canManage: boolean; // true for SEO / ADMIN / DEV
}

export default function PainelSolicitacoesEmpenho({ canManage }: Props) {
  const fileRef = useRef<HTMLInputElement>(null);

  const [items, setItems]             = useState<Solicitacao[]>([]);
  const [loading, setLoading]         = useState(false);
  const [syncing, setSyncing]         = useState(false);
  const [importing, setImporting]     = useState(false);
  const [msg, setMsg]                 = useState<{ text: string; ok: boolean } | null>(null);
  const [editingObs, setEditingObs]   = useState<string | null>(null);
  const [obsValue, setObsValue]       = useState("");
  const [filterStatus, setFilterStatus] = useState<"" | Status>("");
  const [search, setSearch]           = useState("");
  const [showLog, setShowLog]         = useState(false);
  const [logs, setLogs]               = useState<any[]>([]);

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
    setTimeout(() => setMsg(null), 4000);
  };

  // ── Excel Import ──────────────────────────────────────────────────────────

  async function handleFile(file: File) {
    setImporting(true);
    try {
      const buf = await file.arrayBuffer();
      const wb  = XLSX.read(buf, { type: "array" });
      const ws  = wb.Sheets[wb.SheetNames[0]];
      const raw: unknown[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" });

      // Data starts at row index 2 (row 3 in Excel — first 2 are headers)
      const rows: { numero: string; pag: string; responsavel: string; email: string; obs_original: string }[] = [];

      for (let i = 2; i < raw.length; i++) {
        const row = raw[i];
        const numero = extractNumeroSolicitacao(row[0]);
        if (!numero) continue;

        const obsRaw = String(row[12] ?? "").trim(); // col M (index 12)
        rows.push({
          numero,
          obs_original: obsRaw,
          pag:          extractPag(obsRaw),
          responsavel:  extractResponsavel(obsRaw),
          email:        extractEmail(obsRaw),
        });
      }

      if (!rows.length) {
        flash("Nenhuma solicitação encontrada na planilha. Verifique o formato.", false);
        return;
      }

      // Upsert: insert new, ignore existing (keep status/NE fields intact)
      const { error } = await supabase
        .from("solicitacoes_empenho")
        .upsert(rows, { onConflict: "numero", ignoreDuplicates: true });

      if (error) throw error;

      flash(`${rows.length} linha(s) lida(s). Novas solicitações adicionadas.`);
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

  // ── Sync with SIAFI sheet ─────────────────────────────────────────────────

  async function syncWithSiafi() {
    setSyncing(true);
    try {
      // Fetch empenhosNF CSV
      const res = await fetch(SHEET_URLS.empenhosNF);
      if (!res.ok) throw new Error("Falha ao buscar planilha NE SIAFI.");
      const csv  = await res.text();
      const rows = csv.split("\n").map((l) => l.split(",").map((c) => c.replace(/^"|"$/g, "").trim()));
      const nes  = toEmpenhosNF(rows);

      // Group NEs by solicitacao
      const bySolic = new Map<string, typeof nes>();
      for (const ne of nes) {
        const sol = (ne.solicitacao ?? "").toUpperCase();
        if (!sol) continue;
        if (!bySolic.has(sol)) bySolic.set(sol, []);
        bySolic.get(sol)!.push(ne);
      }

      // Reload current DB state
      const { data: current } = await supabase
        .from("solicitacoes_empenho")
        .select("*")
        .order("numero");
      const dbItems = (current as Solicitacao[]) ?? [];

      let updated = 0;
      let sent    = 0;

      for (const item of dbItems) {
        const sheetNEs = bySolic.get(item.numero.toUpperCase());
        if (!sheetNEs?.length) continue;

        // Best status: ASSINADA if any NE has pendente_od !== "Pendente"
        const anyAssinada = sheetNEs.some(
          (ne) => ne.nota_empenho && ne.pendente_od !== "Pendente"
        );
        const anyEmitida = sheetNEs.some((ne) => ne.pendente_od === "Pendente");
        const newStatus: Status = anyAssinada
          ? "ASSINADA"
          : anyEmitida
          ? "EMITIDA"
          : item.status;

        // Pick the NE to store (most recent, or first)
        const bestNE = sheetNEs[sheetNEs.length - 1];

        if (newStatus === item.status && item.ne_siafi) continue;

        const now = new Date().toISOString();
        const patch: Record<string, unknown> = {
          status:    newStatus,
          ne_siafi:  bestNE.nota_empenho || item.ne_siafi,
          updated_at: now,
        };

        // Mark notification timestamps
        if (newStatus === "EMITIDA"  && !item.notificado_emitida_em)  patch.notificado_emitida_em  = now;
        if (newStatus === "ASSINADA" && !item.notificado_assinada_em) patch.notificado_assinada_em = now;

        await supabase.from("solicitacoes_empenho").update(patch).eq("id", item.id);
        updated++;

        // Send email if status changed and notifications enabled and email present
        const shouldNotify =
          item.notificacao_ativa &&
          item.email &&
          ((newStatus === "EMITIDA"  && !item.notificado_emitida_em)  ||
           (newStatus === "ASSINADA" && !item.notificado_assinada_em));

        if (shouldNotify) {
          try {
            const { error: fnErr } = await supabase.functions.invoke("send-empenho-email", {
              body: {
                solicitacao_id: item.id,
                tipo:           newStatus,
                email:          item.email,
                responsavel:    item.responsavel ?? item.numero,
                numero:         item.numero,
                ne_siafi:       bestNE.nota_empenho || item.ne_siafi || "",
                pag:            item.pag,
                obs_atraso:     item.obs_atraso,
              },
            });
            if (!fnErr) sent++;
          } catch (_) {
            // log failures are recorded by the edge function
          }
        }
      }

      flash(`Sincronizado. ${updated} atualizado(s), ${sent} e-mail(s) enviado(s).`);
      await load();
    } catch (e: any) {
      flash("Erro na sincronização: " + e.message, false);
    } finally {
      setSyncing(false);
    }
  }

  // ── Obs Atraso Edit ───────────────────────────────────────────────────────

  async function saveObs(id: string) {
    await supabase
      .from("solicitacoes_empenho")
      .update({ obs_atraso: obsValue || null, updated_at: new Date().toISOString() })
      .eq("id", id);
    setEditingObs(null);
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

  // ── Load log ──────────────────────────────────────────────────────────────

  async function loadLog() {
    const { data } = await supabase
      .from("notificacoes_empenho_log")
      .select("*, solicitacoes_empenho(numero)")
      .order("enviado_em", { ascending: false })
      .limit(100);
    setLogs(data ?? []);
    setShowLog(true);
  }

  // ── Filter ────────────────────────────────────────────────────────────────

  const q = search.toLowerCase();
  const filtered = items.filter((it) => {
    if (filterStatus && it.status !== filterStatus) return false;
    if (q && !it.numero.toLowerCase().includes(q) && !(it.responsavel ?? "").toLowerCase().includes(q)) return false;
    return true;
  });

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-4">

      {/* ── Flash message ── */}
      {msg && (
        <div
          className={`rounded-xl px-4 py-3 text-sm font-medium ${
            msg.ok ? "bg-green-50 text-green-800 border border-green-200" : "bg-red-50 text-red-800 border border-red-200"
          }`}
        >
          {msg.text}
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
            <input
              ref={fileRef}
              type="file"
              accept=".xls,.xlsx,.ods"
              className="hidden"
              onChange={handleFileChange}
            />
            <button
              onClick={syncWithSiafi}
              disabled={syncing || loading}
              className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-60 transition-colors"
            >
              {syncing ? "Sincronizando…" : "↻ Sincronizar SIAFI"}
            </button>
          </>
        )}

        <button
          onClick={loadLog}
          className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-50 transition-colors"
        >
          📋 Log de E-mails
        </button>

        <button
          onClick={load}
          disabled={loading}
          className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-50 disabled:opacity-60 transition-colors"
        >
          {loading ? "Carregando…" : "↺ Atualizar"}
        </button>

        {/* Filters */}
        <div className="ml-auto flex items-center gap-2">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar nº ou responsável…"
            className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs w-48 focus:outline-none focus:ring-2 focus:ring-sky-300"
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
          </select>
        </div>
      </div>

      {/* ── Contagem ── */}
      <div className="flex gap-3 text-xs text-slate-500">
        <span>{items.length} solicitação(ões) total</span>
        {["IMPORTADA","EMITIDA","ASSINADA"].map((s) => (
          <span key={s}>
            <span className={`inline-block px-2 py-0.5 rounded-full font-medium ${STATUS_CLASS[s as Status]}`}>
              {STATUS_LABEL[s as Status]}
            </span>
            {" "}
            {items.filter((i) => i.status === s).length}
          </span>
        ))}
      </div>

      {/* ── Table ── */}
      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-slate-200 bg-slate-50 text-left text-slate-500">
              <th className="px-3 py-2.5 font-semibold">Nº Solicitação</th>
              <th className="px-3 py-2.5 font-semibold">Responsável</th>
              <th className="px-3 py-2.5 font-semibold">E-mail</th>
              <th className="px-3 py-2.5 font-semibold">PAG</th>
              <th className="px-3 py-2.5 font-semibold">NE SIAFI</th>
              <th className="px-3 py-2.5 font-semibold">Status</th>
              <th className="px-3 py-2.5 font-semibold">Obs. Atraso</th>
              <th className="px-3 py-2.5 font-semibold text-center">Notif.</th>
              {canManage && <th className="px-3 py-2.5 font-semibold">Ações</th>}
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 && (
              <tr>
                <td colSpan={canManage ? 9 : 8} className="py-10 text-center text-slate-400">
                  {loading ? "Carregando…" : "Nenhuma solicitação encontrada."}
                </td>
              </tr>
            )}
            {filtered.map((it) => (
              <tr key={it.id} className="border-b border-slate-100 hover:bg-slate-50 transition-colors">

                {/* Nº */}
                <td className="px-3 py-2.5 font-mono font-semibold text-slate-800">
                  {it.numero}
                </td>

                {/* Responsável */}
                <td className="px-3 py-2.5 text-slate-700">{it.responsavel || "—"}</td>

                {/* E-mail */}
                <td className="px-3 py-2.5">
                  {it.email
                    ? <a href={`mailto:${it.email}`} className="text-sky-600 hover:underline">{it.email}</a>
                    : <span className="text-slate-400">—</span>}
                </td>

                {/* PAG */}
                <td className="px-3 py-2.5 text-slate-600 font-mono">{it.pag || "—"}</td>

                {/* NE SIAFI */}
                <td className="px-3 py-2.5 font-mono text-slate-800">{it.ne_siafi || "—"}</td>

                {/* Status */}
                <td className="px-3 py-2.5">
                  <span className={`inline-block px-2 py-0.5 rounded-full font-semibold ${STATUS_CLASS[it.status]}`}>
                    {STATUS_LABEL[it.status]}
                  </span>
                  {it.status === "EMITIDA" && it.notificado_emitida_em && (
                    <div className="text-slate-400 text-[10px] mt-0.5">
                      Notif. {new Date(it.notificado_emitida_em).toLocaleDateString("pt-BR")}
                    </div>
                  )}
                  {it.status === "ASSINADA" && it.notificado_assinada_em && (
                    <div className="text-slate-400 text-[10px] mt-0.5">
                      Notif. {new Date(it.notificado_assinada_em).toLocaleDateString("pt-BR")}
                    </div>
                  )}
                </td>

                {/* Obs. Atraso */}
                <td className="px-3 py-2.5">
                  {editingObs === it.id ? (
                    <div className="flex items-center gap-1">
                      <input
                        autoFocus
                        value={obsValue}
                        onChange={(e) => setObsValue(e.target.value)}
                        className="rounded border border-slate-300 px-2 py-1 text-xs w-48 focus:outline-none focus:ring-2 focus:ring-sky-300"
                        onKeyDown={(e) => {
                          if (e.key === "Enter") saveObs(it.id);
                          if (e.key === "Escape") setEditingObs(null);
                        }}
                      />
                      <button
                        onClick={() => saveObs(it.id)}
                        className="text-green-600 hover:text-green-800 font-bold"
                      >✓</button>
                      <button
                        onClick={() => setEditingObs(null)}
                        className="text-slate-400 hover:text-slate-600"
                      >✕</button>
                    </div>
                  ) : (
                    <div className="flex items-center gap-1 group">
                      <span className={it.obs_atraso ? "text-red-600" : "text-slate-400"}>
                        {it.obs_atraso || "—"}
                      </span>
                      {canManage && (
                        <button
                          onClick={() => { setEditingObs(it.id); setObsValue(it.obs_atraso ?? ""); }}
                          className="opacity-0 group-hover:opacity-100 text-slate-400 hover:text-sky-600 transition-opacity ml-1"
                          title="Editar obs. atraso"
                        >
                          ✏
                        </button>
                      )}
                    </div>
                  )}
                </td>

                {/* Notif. toggle */}
                <td className="px-3 py-2.5 text-center">
                  {canManage ? (
                    <button
                      onClick={() => toggleNotif(it)}
                      title={it.notificacao_ativa ? "Notificação ativa — clique para desativar" : "Notificação inativa — clique para ativar"}
                      className={`text-base ${it.notificacao_ativa ? "opacity-100" : "opacity-30"}`}
                    >
                      🔔
                    </button>
                  ) : (
                    <span className={it.notificacao_ativa ? "text-base" : "text-base opacity-30"}>🔔</span>
                  )}
                </td>

                {/* Ações */}
                {canManage && (
                  <td className="px-3 py-2.5">
                    <button
                      onClick={async () => {
                        if (!it.email) {
                          flash("Esta solicitação não possui e-mail cadastrado.", false);
                          return;
                        }
                        if (!it.ne_siafi) {
                          flash("Sincronize primeiro para obter o número da NE.", false);
                          return;
                        }
                        const { error } = await supabase.functions.invoke("send-empenho-email", {
                          body: {
                            solicitacao_id: it.id,
                            tipo:           it.status === "ASSINADA" ? "ASSINADA" : "EMITIDA",
                            email:          it.email,
                            responsavel:    it.responsavel ?? it.numero,
                            numero:         it.numero,
                            ne_siafi:       it.ne_siafi,
                            pag:            it.pag,
                            obs_atraso:     it.obs_atraso,
                          },
                        });
                        if (error) {
                          flash("Falha ao reenviar e-mail.", false);
                        } else {
                          flash(`E-mail reenviado para ${it.email}.`);
                        }
                      }}
                      disabled={!it.email || !it.ne_siafi}
                      className="rounded border border-slate-200 px-2 py-1 text-[11px] text-slate-600 hover:bg-slate-50 disabled:opacity-40 transition-colors"
                      title="Reenviar e-mail manualmente"
                    >
                      ✉ Reenviar
                    </button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* ── Log modal ── */}
      {showLog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-3xl max-h-[80vh] flex flex-col rounded-2xl bg-white shadow-2xl">
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
                      <td className="px-2 py-1.5 text-slate-500">
                        {new Date(lg.enviado_em).toLocaleString("pt-BR")}
                      </td>
                      <td className="px-2 py-1.5 font-mono font-semibold">
                        {lg.solicitacoes_empenho?.numero ?? lg.solicitacao_id?.slice(0, 8)}
                      </td>
                      <td className="px-2 py-1.5">
                        <span className={`px-2 py-0.5 rounded-full font-medium ${
                          lg.tipo === "ASSINADA" ? "bg-green-100 text-green-700" : "bg-blue-100 text-blue-700"
                        }`}>
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
