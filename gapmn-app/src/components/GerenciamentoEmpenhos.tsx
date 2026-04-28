import { useState, useEffect, useMemo, useRef } from "react";
import * as XLSX from "xlsx";
import { supabase } from "../lib/supabase";
import { Card } from "./Card";
import { fetchCSV, toEmpenhosNF, SHEET_URLS, EmpenhoNF } from "../lib/gsheets";

// ─── Tipos ────────────────────────────────────────────────────────────────────

interface NeIdent {
  ne_siafi:      string;
  identificador: string;
  solicitacao:   string | null;
  subprocesso?:  string | null;
}

interface Props { canSync?: boolean; userRole?: string; }

// ─── Helpers ─────────────────────────────────────────────────────────────────

function fmtValor(v?: number | null) {
  if (!v && v !== 0) return "–";
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

// ─── Parser planilha de controle ─────────────────────────────────────────────
// Col A (índice 0) = Identificador (26E...)
// Col C (índice 2) = NE SIAFI (2026NE...)  ← chave de ligação
// Col P (índice 15) = SE / Solicitação

function parsePlanilhaControle(wb: XLSX.WorkBook): NeIdent[] {
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json<string[]>(ws, { header: 1, raw: false });
  const out: NeIdent[] = [];
  for (const row of rows) {
    const identificador = String(row[0]  ?? "").trim();
    const ne_siafi      = String(row[2]  ?? "").trim();
    const solicitacao   = String(row[15] ?? "").trim() || null;
    if (!ne_siafi.match(/\d{4}NE\d+/i)) continue;
    out.push({ ne_siafi, identificador, solicitacao });
  }
  return out;
}

// ─── Componente ──────────────────────────────────────────────────────────────

export default function GerenciamentoEmpenhos({ canSync = false, userRole }: Props) {
  const canEdit = ["SEO", "DEV", "ADMIN"].includes((userRole ?? "").toUpperCase());
  const isDev   = ["DEV", "ADMIN"].includes((userRole ?? "").toUpperCase());

  // Dados
  const [empenhos,  setEmpenhos]  = useState<EmpenhoNF[]>([]);
  const [neIdents,  setNeIdents]  = useState<NeIdent[]>([]);
  const [loading,   setLoading]   = useState(false);

  // Import planilha controle
  const [importMsg,       setImportMsg]       = useState<string | null>(null);
  const [importando,      setImportando]      = useState(false);
  const planilhaControlRef = useRef<HTMLInputElement>(null);

  // Expand linha
  const [expandedNE, setExpandedNE] = useState<string | null>(null);

  // Filtros
  const [busca,      setBusca]      = useState("");
  const [semSubproc, setSemSubproc] = useState(false);

  // Bot (DEV only)
  const [botDisponivel, setBotDisponivel] = useState(false);
  const [showBotModal,  setShowBotModal]  = useState(false);
  const [botCpf,        setBotCpf]        = useState(() => localStorage.getItem("bot_cpf")   || "");
  const [botSenha,      setBotSenha]      = useState(() => localStorage.getItem("bot_senha") || "");
  const [botAno,        setBotAno]        = useState("2026");
  const [botRunning,    setBotRunning]    = useState(false);
  const [botLog,        setBotLog]        = useState<string[]>([]);
  const [uploadBot,     setUploadBot]     = useState(false);
  const botLogRef  = useRef<HTMLDivElement>(null);
  const botPollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── Polling bot (DEV) ─────────────────────────────────────────────────────
  useEffect(() => {
    if (!isDev) return;
    const check = () => {
      const ctrl  = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 2500);
      fetch("http://localhost:3333/status", { signal: ctrl.signal })
        .then(r => { clearTimeout(timer); setBotDisponivel(r.ok); })
        .catch(() => { clearTimeout(timer); setBotDisponivel(false); });
    };
    check();
    const t = setInterval(check, 4000);
    return () => clearInterval(t);
  }, []); // eslint-disable-line

  useEffect(() => { if (isDev && botCpf)   localStorage.setItem("bot_cpf",   botCpf);   }, [botCpf,   isDev]);
  useEffect(() => { if (isDev && botSenha) localStorage.setItem("bot_senha", botSenha); }, [botSenha, isDev]);

  // ── Fetch ─────────────────────────────────────────────────────────────────
  async function carregarPlanilha() {
    setLoading(true);
    try {
      const csv = await fetchCSV(SHEET_URLS.empenhosNF);
      setEmpenhos(toEmpenhosNF(csv));
    } catch { /* offline */ }
    setLoading(false);
  }

  async function carregarNeIdentificadores() {
    const { data, error } = await supabase
      .from("siloms_ne_identificadores")
      .select("*")
      .limit(2000);
    if (error) console.error("[NE Idents]", error.message);
    if (data) setNeIdents(data as NeIdent[]);
  }

  useEffect(() => {
    carregarPlanilha();
    carregarNeIdentificadores();
  }, []); // eslint-disable-line

  // ── Import planilha controle ──────────────────────────────────────────────
  async function onPlanilhaControleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setImportando(true);
    setImportMsg("⏳ Lendo planilha...");
    try {
      const buf = await file.arrayBuffer();
      const wb  = XLSX.read(buf);
      const registros = parsePlanilhaControle(wb);
      if (!registros.length) {
        setImportMsg("⚠️ Nenhuma NE encontrada. Verifique se a coluna C tem formato 2026NE...");
        return;
      }
      setImportMsg(`⏳ Salvando ${registros.length} registros...`);

      const { error: delErr } = await supabase
        .from("siloms_ne_identificadores").delete().gte("ne_siafi", "");
      if (delErr) throw new Error(`Erro ao limpar tabela: ${delErr.message}`);

      let salvos = 0;
      for (let i = 0; i < registros.length; i += 100) {
        const lote = registros.slice(i, i + 100);
        const { error: insErr } = await supabase
          .from("siloms_ne_identificadores").insert(lote);
        if (insErr) throw new Error(`Erro lote ${Math.floor(i / 100) + 1}: ${insErr.message}`);
        salvos += lote.length;
      }
      setImportMsg(`✅ ${salvos} NEs importadas`);
      await carregarNeIdentificadores();
    } catch (err: unknown) {
      setImportMsg(`❌ ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setImportando(false);
      if (planilhaControlRef.current) planilhaControlRef.current.value = "";
    }
  }

  // ── Bot: rodar ────────────────────────────────────────────────────────────
  async function rodarBot() {
    if (!botCpf || !botSenha) return;
    const ok = await fetch("http://localhost:3333/status").then(r => r.ok).catch(() => false);
    if (!ok) { setBotLog(["❌ Servidor offline. Execute: node server.js"]); return; }
    setBotDisponivel(true);
    setBotRunning(true);
    setBotLog(["⏳ Iniciando robô..."]);
    try {
      await fetch("http://localhost:3333/rodar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cpf: botCpf, senha: botSenha, ano: botAno }),
      });
      if (botPollRef.current) clearInterval(botPollRef.current);
      botPollRef.current = setInterval(async () => {
        const res  = await fetch("http://localhost:3333/status").catch(() => null);
        if (!res) return;
        const data = await res.json();
        const msgs = (data.log ?? []).map((l: { msg: string }) => l.msg);
        setBotLog(msgs.length ? msgs : ["⏳ Aguardando..."]);
        if (botLogRef.current) botLogRef.current.scrollTop = botLogRef.current.scrollHeight;
        if (!data.running) {
          clearInterval(botPollRef.current!);
          setBotRunning(false);
          if (!data.error) { setShowBotModal(false); await carregarNeIdentificadores(); }
        }
      }, 1500);
    } catch {
      setBotLog(["❌ Erro ao iniciar. Execute: node server.js"]);
      setBotRunning(false);
    }
  }

  // ── Bot: upload subprocesso ao Supabase ───────────────────────────────────
  async function uploadDoBotLocal() {
    setUploadBot(true);
    setImportMsg("⏳ Buscando dados do bot...");
    try {
      const resp = await fetch("http://localhost:3333/dados").catch(() => null);
      if (!resp) { setImportMsg("❌ Servidor offline. Execute: node server.js"); return; }
      const { docs } = await resp.json();
      if (!docs?.length) { setImportMsg("⚠️ Nenhum dado no servidor."); return; }

      let ok = 0, errs = 0;
      for (const doc of docs as { ne_siafi: string; subprocesso: string }[]) {
        const { error } = await supabase
          .from("siloms_ne_identificadores")
          .update({ subprocesso: doc.subprocesso ?? "" })
          .eq("ne_siafi", doc.ne_siafi);
        if (error) errs++; else ok++;
      }
      setImportMsg(`✅ Subprocessos: ${ok} atualizados${errs ? `, ${errs} erros` : ""}`);
      await carregarNeIdentificadores();
    } catch (err: unknown) {
      setImportMsg(`❌ ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setUploadBot(false);
    }
  }

  // ── Join: planilha + identificadores + subprocesso ────────────────────────
  const rows = useMemo(() => {
    const neIdentsMap = new Map(neIdents.map(r => [r.ne_siafi.toUpperCase(), r]));
    return empenhos.map(ne => {
      const ident = neIdentsMap.get(ne.nota_empenho.toUpperCase());
      return {
        ne,
        nota_empenho:  ne.nota_empenho,
        data:          ne.data,
        valor:         ne.valor,
        identificador: ident?.identificador ?? "",
        solicitacao:   ident?.solicitacao   ?? "",
        subprocesso:   ident?.subprocesso   ?? null,
      };
    });
  }, [empenhos, neIdents]);

  const filtrado = useMemo(() => {
    const q = busca.trim().toUpperCase();
    return rows.filter(r => {
      if (semSubproc && r.subprocesso) return false;
      if (!q) return true;
      return (
        r.nota_empenho.toUpperCase().includes(q) ||
        r.identificador.toUpperCase().includes(q) ||
        (r.solicitacao  ?? "").toUpperCase().includes(q) ||
        (r.subprocesso  ?? "").toUpperCase().includes(q)
      );
    });
  }, [rows, busca, semSubproc]);

  const totalValor = useMemo(
    () => filtrado.reduce((s, r) => s + (r.valor ?? 0), 0),
    [filtrado]
  );

  const semSubprocCount = useMemo(
    () => rows.filter(r => !r.subprocesso).length,
    [rows]
  );

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-3">

      {/* Modal bot */}
      {showBotModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
          onClick={() => !botRunning && setShowBotModal(false)}>
          <div className="bg-white rounded-2xl shadow-2xl border max-w-md w-full mx-4 p-5 space-y-3"
            onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <span className="font-semibold text-slate-800 text-sm">🤖 Robô SILOMS — Subprocessos</span>
              {!botRunning && (
                <button onClick={() => setShowBotModal(false)} className="text-slate-400 hover:text-slate-600">✕</button>
              )}
            </div>
            <p className="text-xs text-slate-500">
              O robô buscará o <strong>Nr. Documento (Subprocesso)</strong> de cada NE SIAFI em
              <em> Documentos na Unidade</em> (Ativos e Arquivados).
              Apenas NEs <strong>sem subprocesso</strong> serão pesquisadas.
            </p>
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div>
                <label className="text-slate-500 font-semibold uppercase text-[10px] block mb-0.5">CPF (só números)</label>
                <input value={botCpf} onChange={e => setBotCpf(e.target.value)}
                  disabled={botRunning} placeholder="00000000000"
                  className="w-full rounded-lg border px-2 py-1.5 outline-none focus:ring-2 focus:ring-violet-200" />
              </div>
              <div>
                <label className="text-slate-500 font-semibold uppercase text-[10px] block mb-0.5">Senha</label>
                <input type="password" value={botSenha} onChange={e => setBotSenha(e.target.value)}
                  disabled={botRunning} placeholder="••••••"
                  className="w-full rounded-lg border px-2 py-1.5 outline-none focus:ring-2 focus:ring-violet-200" />
              </div>
              <div>
                <label className="text-slate-500 font-semibold uppercase text-[10px] block mb-0.5">Ano</label>
                <input value={botAno} onChange={e => setBotAno(e.target.value)}
                  disabled={botRunning} placeholder="2026"
                  className="w-full rounded-lg border px-2 py-1.5 outline-none focus:ring-2 focus:ring-violet-200" />
              </div>
            </div>
            {botLog.length > 0 && (
              <div ref={botLogRef}
                className="bg-slate-900 text-green-400 font-mono text-[10px] rounded-xl p-3 h-40 overflow-y-auto space-y-0.5">
                {botLog.map((l, i) => <div key={i}>{l}</div>)}
              </div>
            )}
            <button onClick={rodarBot} disabled={botRunning || !botCpf || !botSenha}
              className="w-full rounded-xl bg-violet-600 text-white py-2 text-sm font-medium hover:bg-violet-700 disabled:opacity-50">
              {botRunning ? "🔄 Rodando — aguarde..." : "▶ Iniciar"}
            </button>
          </div>
        </div>
      )}

      <Card>
        <div className="flex flex-wrap items-center gap-2 mb-2">
          <div className="flex-1">
            <div className="text-sm font-semibold text-slate-900">
              NEs SIAFI
              {rows.length > 0 && (
                <span className="ml-2 text-xs font-normal text-slate-500">
                  {filtrado.length} / {rows.length}
                </span>
              )}
            </div>
            <div className="text-xs text-slate-500">
              Planilha Google Sheets · Identificador e subprocesso via planilha de controle + robô
              {loading && <span className="ml-2 text-slate-400">↻ carregando...</span>}
            </div>
          </div>

          {/* Planilha Controle */}
          {canEdit && (
            <>
              <button onClick={() => planilhaControlRef.current?.click()} disabled={importando}
                className="rounded-xl border border-indigo-300 bg-indigo-50 px-3 py-1.5 text-xs text-indigo-700 hover:bg-indigo-100 disabled:opacity-50">
                {importando ? "Importando..." : "📥 Planilha Controle"}
              </button>
              <input ref={planilhaControlRef} type="file" accept=".xls,.xlsx"
                className="hidden" onChange={onPlanilhaControleChange} />
            </>
          )}

          {/* Bot (DEV only) */}
          {isDev && (
            <>
              <button onClick={() => setShowBotModal(true)} disabled={botRunning}
                title={botDisponivel ? "Buscar subprocessos no SILOMS" : "Servidor offline — inicie: node server.js"}
                className={`rounded-xl border px-3 py-1.5 text-xs font-medium disabled:opacity-50 ${botDisponivel ? "border-violet-300 bg-violet-50 text-violet-700 hover:bg-violet-100" : "border-slate-300 bg-slate-50 text-slate-400"}`}>
                {botRunning ? "🔄 Rodando..." : botDisponivel ? "🤖 Rodar Bot" : "🤖 Bot (offline)"}
              </button>
              <button onClick={uploadDoBotLocal} disabled={uploadBot}
                title={botDisponivel ? "Envia subprocessos ao Supabase" : "Servidor offline"}
                className={`rounded-xl border px-3 py-1.5 text-xs font-medium disabled:opacity-50 ${botDisponivel ? "border-emerald-300 bg-emerald-50 text-emerald-700 hover:bg-emerald-100" : "border-slate-300 bg-slate-50 text-slate-400"}`}>
                {uploadBot ? "Enviando..." : "⬆ Upload Bot"}
              </button>
            </>
          )}

          {canSync && (
            <button onClick={() => { carregarPlanilha(); carregarNeIdentificadores(); }} disabled={loading}
              className="rounded-xl border border-sky-200 bg-sky-50 px-3 py-1.5 text-xs font-medium text-sky-700 hover:bg-sky-100 disabled:opacity-60">
              <span className={loading ? "animate-spin inline-block" : ""}>↻</span> Atualizar
            </button>
          )}

          <input value={busca} onChange={e => setBusca(e.target.value)} placeholder="Buscar..."
            className="rounded-xl border px-3 py-1.5 text-xs outline-none focus:ring-2 focus:ring-sky-200 w-36" />
        </div>

        {/* Filtro sem subprocesso */}
        <div className="flex gap-2">
          <button onClick={() => setSemSubproc(v => !v)}
            className={`rounded-xl border px-3 py-1.5 text-xs font-medium ${semSubproc ? "border-amber-400 bg-amber-50 text-amber-700" : "border-slate-200 text-slate-500 hover:bg-slate-50"}`}>
            {semSubproc ? "● " : ""}Sem subprocesso
            {semSubprocCount > 0 && (
              <span className={`ml-1.5 rounded-full px-1.5 py-0.5 text-[10px] font-bold ${semSubproc ? "bg-amber-200 text-amber-800" : "bg-slate-100 text-slate-500"}`}>
                {semSubprocCount}
              </span>
            )}
          </button>
        </div>

        {importMsg && (
          <div className={`mt-2 text-xs px-3 py-2 rounded-lg ${
            importMsg.startsWith("✅") ? "bg-green-50 text-green-700" :
            importMsg.startsWith("❌") ? "bg-red-50 text-red-700" :
            "bg-blue-50 text-blue-600"}`}>
            {importMsg}
          </div>
        )}
      </Card>

      <div className="rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="max-h-[70vh] overflow-y-auto overflow-x-auto rounded-2xl">
          <table className="w-full text-xs border-collapse table-fixed" style={{ minWidth: "700px" }}>
            <colgroup>
              <col style={{ width: "18px" }} />
              <col style={{ width: "148px" }} />
              <col style={{ width: "88px" }} />
              <col style={{ width: "108px" }} />
              <col style={{ width: "110px" }} />
              <col style={{ width: "120px" }} />
              <col style={{ width: "120px" }} />
            </colgroup>
            <thead className="bg-slate-50 text-left sticky top-0 z-20">
              <tr className="border-b border-slate-200">
                <th className="px-1 py-2"></th>
                <th className="px-3 py-2 font-semibold text-slate-600 whitespace-nowrap">NE SIAFI</th>
                <th className="px-2 py-2 font-semibold text-slate-600 whitespace-nowrap">Dt. Emissão</th>
                <th className="px-2 py-2 font-semibold text-slate-600 whitespace-nowrap text-right">Valor</th>
                <th className="px-2 py-2 font-semibold text-slate-600 whitespace-nowrap">Identificador</th>
                <th className="px-2 py-2 font-semibold text-slate-600 whitespace-nowrap">SE</th>
                <th className="px-2 py-2 font-semibold text-slate-600 whitespace-nowrap">Subprocesso</th>
              </tr>
            </thead>
            <tbody>
              {filtrado.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-10 text-center text-slate-400">
                    {rows.length === 0 ? "Carregando NEs da planilha..." : "Sem resultados para os filtros aplicados."}
                  </td>
                </tr>
              ) : filtrado.map((row, i) => {
                const isExpanded = expandedNE === row.nota_empenho;
                const temSubproc = !!row.subprocesso;
                return (
                  <>
                    <tr key={`${row.nota_empenho}||${i}`}
                      className={`border-b transition-colors cursor-pointer ${isExpanded ? "bg-sky-50" : "hover:bg-slate-50/70"}`}
                      onClick={() => setExpandedNE(prev => prev === row.nota_empenho ? null : row.nota_empenho)}>

                      {/* indicador subprocesso */}
                      <td className="px-1 py-1.5">
                        <span className={`inline-block w-2 h-2 rounded-full ${temSubproc ? "bg-emerald-400" : "bg-slate-200"}`}
                          title={temSubproc ? `Subprocesso: ${row.subprocesso}` : "Sem subprocesso"} />
                      </td>

                      {/* NE SIAFI */}
                      <td className="px-3 py-1.5 font-mono font-semibold text-sky-700 text-[11px] whitespace-nowrap">
                        {row.nota_empenho}
                        <span className="ml-1 text-slate-300 text-[9px]">{isExpanded ? "▲" : "▼"}</span>
                      </td>

                      {/* Dt. Emissão */}
                      <td className="px-2 py-1.5 text-slate-500 text-[11px] whitespace-nowrap">
                        {row.data || <span className="text-slate-300">–</span>}
                      </td>

                      {/* Valor */}
                      <td className="px-2 py-1.5 font-mono text-slate-700 text-[11px] whitespace-nowrap text-right">
                        {fmtValor(row.valor)}
                      </td>

                      {/* Identificador */}
                      <td className="px-2 py-1.5 font-mono text-indigo-600 text-[11px] whitespace-nowrap overflow-hidden">
                        {row.identificador || <span className="text-slate-300">–</span>}
                      </td>

                      {/* SE */}
                      <td className="px-2 py-1.5 font-mono text-slate-600 text-[11px] whitespace-nowrap overflow-hidden">
                        {row.solicitacao || <span className="text-slate-300">–</span>}
                      </td>

                      {/* Subprocesso */}
                      <td className="px-2 py-1.5 font-mono text-[11px] whitespace-nowrap overflow-hidden">
                        {row.subprocesso
                          ? <span className="text-emerald-700 font-semibold">{row.subprocesso}</span>
                          : row.subprocesso === ""
                            ? <span className="text-slate-300 italic text-[10px]">não encontrado</span>
                            : <span className="text-slate-300">–</span>}
                      </td>
                    </tr>

                    {/* Linha expandida — detalhes da NE */}
                    {isExpanded && (
                      <tr key={`exp-${row.nota_empenho}`} className="bg-sky-50 border-b">
                        <td colSpan={7} className="px-4 py-3">
                          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-[11px]">
                            {row.ne.descricao && (
                              <div className="col-span-2 sm:col-span-3 bg-white rounded-lg border border-sky-100 px-3 py-2 text-slate-600 leading-relaxed break-words">
                                {row.ne.descricao}
                              </div>
                            )}
                            {[
                              ["UGCred",     row.ne.ugcred_code],
                              ["Natureza",   row.ne.natureza],
                              ["PI",         row.ne.pi],
                              ["PI Desc",    row.ne.pi_desc],
                              ["Solicitação (planilha)", row.ne.solicitacao],
                            ].filter(([, v]) => v).map(([l, v]) => (
                              <div key={l as string} className="bg-white rounded-lg border border-sky-100 px-3 py-1.5">
                                <p className="text-[9px] font-semibold uppercase text-slate-400 mb-0.5">{l}</p>
                                <p className="font-mono text-slate-700">{v}</p>
                              </div>
                            ))}
                          </div>
                        </td>
                      </tr>
                    )}
                  </>
                );
              })}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-slate-200 bg-slate-50 sticky bottom-0">
                <td colSpan={3} className="px-3 py-2 text-xs font-semibold text-slate-500 text-right">Total</td>
                <td className="px-2 py-2 text-right font-mono font-bold text-slate-800 whitespace-nowrap">
                  {fmtValor(totalValor)}
                </td>
                <td colSpan={3} />
              </tr>
            </tfoot>
          </table>
        </div>
      </div>
    </div>
  );
}
