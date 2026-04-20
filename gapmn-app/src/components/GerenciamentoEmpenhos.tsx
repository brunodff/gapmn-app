import { useState, useEffect, useMemo, useRef } from "react";
import * as XLSX from "xlsx";
import { supabase } from "../lib/supabase";
import { Card } from "./Card";
import { fetchCSV, toEmpenhosNF, SHEET_URLS, EmpenhoNF } from "../lib/gsheets";

// ─── Tipos ────────────────────────────────────────────────────────────────────

interface SilomsRow {
  solicitacao:     string;
  status?:         string;
  oc_gerada?:      string;
  responsavel?:    string;
  subprocesso?:    string;
  empenho_siafi?:  string;
  perfil_atual?:   string;
  fornecedor?:     string;
  valor?:          number;
  dt_solicitacao?: string;
  ug_cred?:        string;
  nd?:             string;
  pag?:            string;
  historico?:      string;
  pregao?:         string;
  usuario?:        string;
  codemp?:         string;
  ug_exec?:        string;
}

type FullRow = SilomsRow & { ne?: EmpenhoNF };

interface Props { canSync?: boolean; userRole?: string; }

// ─── Helpers ─────────────────────────────────────────────────────────────────

function fmtValor(v?: number | null) {
  if (!v) return "–";
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function fmtData(d?: string) {
  if (!d) return "–";
  const m = d.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[3]}/${m[2]}/${m[1]}`;
  return d;
}

// Ponto 5: STATUS só tem 3 estados — AGUARDA / ASSINADA / OC number
function getStatusInfo(status?: string, oc_gerada?: string) {
  const s = (status ?? "").toUpperCase();
  if (s.includes("AGUARDA"))
    return { text: status!, dot: "bg-yellow-400", badge: "bg-yellow-100 text-yellow-700" };
  if (s.includes("ASSINADA"))
    return { text: status!, dot: "bg-red-500",    badge: "bg-red-100 text-red-700" };
  // OC Gerada como terceiro estado
  const oc = oc_gerada?.trim();
  if (oc)
    return { text: oc, dot: "bg-slate-400", badge: "bg-slate-100 text-slate-600" };
  return { text: "–", dot: "bg-slate-200", badge: "" };
}

// Extrai número de NE para sort: "2026NE000435" → 435
function neNum(ne?: string) {
  if (!ne) return Infinity;
  const m = ne.match(/NE0*(\d+)/i);
  return m ? parseInt(m[1], 10) : Infinity;
}

// Extrai número de solicitação para sort: "26S0380" → 380
function solNum(sol?: string) {
  const m = (sol ?? "").match(/(\d+)$/);
  return m ? parseInt(m[1], 10) : 9999999;
}

const RESP = ["Ten Bruno", "3S Anne", "3S Elaine"] as const;

// ─── Parser planilha SILOMS Excel ────────────────────────────────────────────

function parseSilomsExcel(wb: XLSX.WorkBook): SilomsRow[] {
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json<string[]>(ws, { header: 1, raw: false, dateNF: "dd/mm/yyyy" });

  const kw = ["solicit", "status", "fornecedor", "ug", "nd", "hist"];
  let hi = 0, best = 0;
  for (let i = 0; i < Math.min(rows.length, 8); i++) {
    const score = kw.filter(k => (rows[i] || []).some(c => String(c).toLowerCase().includes(k))).length;
    if (score > best) { best = score; hi = i; }
  }
  if (best === 0) return [];

  const headers = (rows[hi] || []).map(h => String(h || "").trim());
  const gi = (k: string) => {
    const exact = headers.findIndex(h => h.toLowerCase().trim() === k.toLowerCase());
    return exact >= 0 ? exact : headers.findIndex(h => h.toLowerCase().includes(k));
  };

  const iSol  = gi("solicitaç") >= 0 ? gi("solicitaç") : gi("solicit");
  const iSt   = gi("status");
  const iForn = gi("fornecedor") >= 0 ? gi("fornecedor") : -1;
  const iOC   = gi("oc gerada") >= 0 ? gi("oc gerada") : gi("oc_gerada");
  const iDt   = gi("dt solic");
  const iUGC  = gi("ug cred") >= 0 ? gi("ug cred") : gi("ugcred");
  const iNd   = gi("n.d") >= 0 ? gi("n.d") : gi("nd");
  const iPag  = gi("pag");
  const iHist = gi("hist");
  const iVal  = gi("valor");

  const g = (r: string[], i: number) => i >= 0 ? String(r[i] ?? "").trim() : "";

  return rows.slice(hi + 1)
    .map(r => ({
      solicitacao:    g(r, iSol),
      status:         g(r, iSt)   || undefined,
      fornecedor:     g(r, iForn) || undefined,
      oc_gerada:      g(r, iOC)   || undefined,
      dt_solicitacao: g(r, iDt)   || undefined,
      ug_cred:        g(r, iUGC)  || undefined,
      nd:             g(r, iNd)   || undefined,
      pag:            g(r, iPag)  || undefined,
      historico:      g(r, iHist) || undefined,
      valor: iVal >= 0 && r[iVal]
        ? parseFloat(String(r[iVal]).replace(/\./g, "").replace(",", ".")) || undefined
        : undefined,
    }))
    .filter(r => r.solicitacao && /\d/.test(r.solicitacao));
}

// ─── Componente ──────────────────────────────────────────────────────────────

export default function GerenciamentoEmpenhos({ canSync = false, userRole }: Props) {
  const canEdit = ["SEO", "DEV", "ADMIN"].includes((userRole ?? "").toUpperCase());
  const isDev   = ["DEV", "ADMIN"].includes((userRole ?? "").toUpperCase());

  const [siloms,   setSiloms]   = useState<SilomsRow[]>([]);
  const [empenhos, setEmpenhos] = useState<EmpenhoNF[]>([]);
  const [loading,  setLoading]  = useState(false);

  // Edição inline — ponto 3
  const [editKey, setEditKey] = useState<string | null>(null);
  const [editBuf, setEditBuf] = useState<Partial<SilomsRow>>({});
  const [saving,  setSaving]  = useState(false);

  // Modal detalhe NE
  const [neModal, setNeModal] = useState<EmpenhoNF | null>(null);

  // Novo registro
  const [showNovo, setShowNovo] = useState(false);
  const [novoForm, setNovoForm] = useState<Partial<SilomsRow & { valor_str: string }>>({});
  const [salNovo,  setSalNovo]  = useState(false);

  // Importar SILOMS Excel
  const fileRef = useRef<HTMLInputElement>(null);
  const [importando, setImportando] = useState(false);
  const [importMsg,  setImportMsg]  = useState<string | null>(null);

  // Upload do bot local (localhost:3333/dados)
  const [uploadBot,     setUploadBot]     = useState(false);
  const [botDisponivel, setBotDisponivel] = useState(false);

  // Modal rodar bot
  const [showBotModal, setShowBotModal] = useState(false);
  const [botCpf,       setBotCpf]       = useState(() => localStorage.getItem("bot_cpf") || "");
  const [botSenha,     setBotSenha]     = useState(() => localStorage.getItem("bot_senha") || "");
  const [botAno,       setBotAno]       = useState("2026");
  const [botRunning,   setBotRunning]   = useState(false);
  const [botLog,       setBotLog]       = useState<string[]>([]);
  const botLogRef  = useRef<HTMLDivElement>(null);
  const botPollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Auto-run a cada 30 min (DEV only)
  const [botCountdown,    setBotCountdown]    = useState<number | null>(null);
  const [botAutoTrigger,  setBotAutoTrigger]  = useState(false);
  const botAutoRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Acompanhamentos
  const [userId,    setUserId]    = useState<string | null>(null);
  const [seguindo,  setSeguindo]  = useState<Set<string>>(new Set());

  useEffect(() => {
    fetch("http://localhost:3333/status", { signal: AbortSignal.timeout(1500) })
      .then(r => r.ok ? setBotDisponivel(true) : null)
      .catch(() => null);
  }, []);

  // Persiste CPF/senha no localStorage (apenas DEV)
  useEffect(() => { if (isDev && botCpf)   localStorage.setItem("bot_cpf",   botCpf);   }, [botCpf,   isDev]);
  useEffect(() => { if (isDev && botSenha) localStorage.setItem("bot_senha", botSenha); }, [botSenha, isDev]);

  // Auto-trigger: quando countdown zera, dispara o bot
  useEffect(() => {
    if (!botAutoTrigger || botRunning || !isDev) return;
    setBotAutoTrigger(false);
    rodarBot();
  }, [botAutoTrigger]); // eslint-disable-line

  // Filtros
  const [filtroUG,   setFiltroUG]   = useState("");
  const [filtroResp, setFiltroResp] = useState("");
  const [semNE,      setSemNE]      = useState(false);
  const [busca,      setBusca]      = useState("");

  // ── Fetch ─────────────────────────────────────────────────────────────────
  async function carregarSiloms() {
    const { data } = await supabase
      .from("siloms_solicitacoes_empenho")
      .select("*")
      .limit(1000);
    if (data) setSiloms(data as SilomsRow[]);
  }

  async function carregarPlanilha() {
    setLoading(true);
    try {
      const csv = await fetchCSV(SHEET_URLS.empenhosNF);
      setEmpenhos(toEmpenhosNF(csv));
    } catch { /* offline */ }
    setLoading(false);
  }

  useEffect(() => {
    carregarSiloms();
    carregarPlanilha();
    supabase.auth.getSession().then(({ data }) => {
      const uid = data.session?.user.id ?? null;
      setUserId(uid);
      if (uid) carregarSeguindo(uid);
    });
  }, []); // eslint-disable-line

  async function carregarSeguindo(uid: string) {
    const { data } = await supabase
      .from("user_acompanhamentos")
      .select("ref_id")
      .eq("user_id", uid)
      .eq("tipo", "solicitacao");
    setSeguindo(new Set((data ?? []).map((r: any) => r.ref_id)));
  }

  async function toggleSeguir(solicitacao: string, label: string) {
    if (!userId) return;
    if (seguindo.has(solicitacao)) {
      await supabase.from("user_acompanhamentos")
        .delete().eq("user_id", userId).eq("tipo", "solicitacao").eq("ref_id", solicitacao);
      setSeguindo(prev => { const s = new Set(prev); s.delete(solicitacao); return s; });
    } else {
      await supabase.from("user_acompanhamentos")
        .insert({ user_id: userId, tipo: "solicitacao", ref_id: solicitacao, ref_label: label, is_fiscal: false });
      setSeguindo(prev => new Set(prev).add(solicitacao));
    }
  }

  // ── Countdown 30 min (DEV only) ──────────────────────────────────────────
  function startCountdown() {
    if (!isDev) return;
    if (botAutoRef.current) clearInterval(botAutoRef.current);
    let secs = 30 * 60;
    setBotCountdown(secs);
    botAutoRef.current = setInterval(() => {
      secs--;
      setBotCountdown(secs);
      if (secs <= 0) {
        clearInterval(botAutoRef.current!);
        setBotCountdown(null);
        setBotAutoTrigger(true);
      }
    }, 1000);
  }

  // ── Bot: rodar extração SILOMS ─────────────────────────────────────────────
  async function rodarBot() {
    if (!botCpf || !botSenha) return;
    if (botAutoRef.current) { clearInterval(botAutoRef.current); setBotCountdown(null); }
    setBotRunning(true);
    setBotLog(["⏳ Iniciando robô — 3 passos..."]);
    try {
      await fetch("http://localhost:3333/rodar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cpf: botCpf, senha: botSenha, ano: botAno }),
      });
      if (botPollRef.current) clearInterval(botPollRef.current);
      botPollRef.current = setInterval(async () => {
        const res = await fetch("http://localhost:3333/status").catch(() => null);
        if (!res) return;
        const json = await res.json();
        const msgs = (json.log ?? []).map((l: { msg: string }) => l.msg);
        setBotLog(msgs.length ? msgs : ["⏳ Aguardando..."]);
        if (botLogRef.current) botLogRef.current.scrollTop = botLogRef.current.scrollHeight;
        if (!json.running) {
          clearInterval(botPollRef.current!);
          setBotRunning(false);
          if (!json.error) {
            await carregarSiloms();
            startCountdown();
          }
        }
      }, 1500);
    } catch {
      setBotLog(["❌ Servidor local não está rodando. Execute: node server.js"]);
      setBotRunning(false);
    }
  }

  // ── Join: planilha como fonte das linhas, SILOMS como enriquecimento ──────
  // Cada linha da planilha = uma linha na tabela (mesmo NE repetido = linhas separadas)
  const rows = useMemo<FullRow[]>(() => {
    // Índice primário: por solicitacao; secundário: por empenho_siafi
    // (Bot pode inserir solicitacao = nota_empenho quando doc.solicitacao é vazio)
    const silomsMap = new Map(
      siloms
        .filter(r => r.solicitacao && /\d/.test(r.solicitacao))
        .map(r => [r.solicitacao.toUpperCase(), r])
    );
    const silomsMapNE = new Map(
      siloms
        .filter(r => r.empenho_siafi)
        .map(r => [r.empenho_siafi!.toUpperCase(), r])
    );

    const matchedSols = new Set<string>();
    const matchedNEs  = new Set<string>();

    // Cada linha da planilha NE = uma linha na tabela
    const sheetRows: FullRow[] = empenhos.map(ne => {
      const solKey = (ne.solicitacao ?? "").toUpperCase();
      const silom  = (solKey ? silomsMap.get(solKey) : undefined)
                  ?? silomsMapNE.get(ne.nota_empenho.toUpperCase());
      if (silom) {
        matchedSols.add(silom.solicitacao);
        if (silom.empenho_siafi) matchedNEs.add(silom.empenho_siafi.toUpperCase());
      }
      return { ...(silom ?? { solicitacao: ne.solicitacao || ne.nota_empenho }), ne };
    });

    // Conjunto dos NE numbers já cobertos pela planilha
    const sheetNESet = new Set(empenhos.map(e => e.nota_empenho));

    // Pendentes: solicitações do Supabase ainda sem NE gerada
    // Exclui: solicitação já matched pela planilha, NE já matched pelo JOIN duplo,
    //         ou empenho_siafi já existe na planilha
    const pending: FullRow[] = siloms
      .filter(s =>
        s.solicitacao &&
        /\d/.test(s.solicitacao) &&
        !matchedSols.has(s.solicitacao) &&
        !matchedNEs.has((s.empenho_siafi ?? "").toUpperCase()) &&
        !sheetNESet.has(s.empenho_siafi ?? "")
      )
      .map(s => ({ ...s }));

    return [...sheetRows, ...pending];
  }, [siloms, empenhos]);

  // ── Sort: NE crescente → mesma NE por data → sem NE por solicitação ──────
  const sorted = useMemo<FullRow[]>(() => {
    const comNE  = rows.filter(r => r.ne?.nota_empenho || r.empenho_siafi);
    const semNEr = rows.filter(r => !r.ne?.nota_empenho && !r.empenho_siafi);
    comNE.sort((a, b) => {
      const na = neNum(a.ne?.nota_empenho || a.empenho_siafi);
      const nb = neNum(b.ne?.nota_empenho || b.empenho_siafi);
      if (na !== nb) return na - nb;
      // Mesmo NE: ordena por data da planilha (DD/MM/YYYY → comparação string)
      const da = (a.ne?.data ?? "").split("/").reverse().join("");
      const db = (b.ne?.data ?? "").split("/").reverse().join("");
      return da.localeCompare(db);
    });
    semNEr.sort((a, b) => solNum(a.solicitacao) - solNum(b.solicitacao));
    return [...comNE, ...semNEr];
  }, [rows]);

  // ── Filtros ───────────────────────────────────────────────────────────────
  const ugOpts = useMemo(() =>
    [...new Set(rows.map(r => r.ug_cred || r.ne?.ugcred_code).filter(Boolean))].sort() as string[], [rows]);
  const respOpts = useMemo(() =>
    [...new Set(rows.map(r => r.responsavel).filter(Boolean))].sort() as string[], [rows]);

  const filtrado = useMemo(() => {
    const q = busca.trim().toUpperCase();
    return sorted.filter(r => {
      if (filtroUG   && (r.ug_cred || r.ne?.ugcred_code) !== filtroUG) return false;
      if (filtroResp && r.responsavel !== filtroResp) return false;
      if (semNE      && (r.ne?.nota_empenho || r.empenho_siafi)) return false;
      // Apenas NEs do ano corrente (2026NE...) — ignora 2024/2025
      const neStr = ((r.ne?.nota_empenho || r.empenho_siafi) ?? "").toUpperCase();
      if (neStr && !neStr.startsWith("2026NE")) return false;

      if (q) {
        const txt = [r.solicitacao, r.ne?.nota_empenho, r.empenho_siafi,
          r.responsavel, r.subprocesso, r.perfil_atual, r.status, r.oc_gerada,
          r.fornecedor, r.historico]
          .join(" ").toUpperCase();
        if (!txt.includes(q)) return false;
      }
      return true;
    });
  }, [sorted, filtroUG, filtroResp, semNE, busca]);

  // Total das linhas com NE (positivos + negativos)
  const totalComNE = useMemo(() =>
    filtrado
      .filter(r => r.ne?.nota_empenho || r.empenho_siafi)
      .reduce((s, r) => s + (r.ne?.valor ?? r.valor ?? 0), 0),
    [filtrado]);

  // ── Salvar edição ─────────────────────────────────────────────────────────
  async function salvar(key: string) {
    setSaving(true);
    await supabase.from("siloms_solicitacoes_empenho").update(editBuf).eq("solicitacao", key);
    setSaving(false);
    setEditKey(null);
    setEditBuf({});
    await carregarSiloms();
  }

  // ── Importar SILOMS Excel ─────────────────────────────────────────────────
  async function onFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setImportando(true);
    setImportMsg("⏳ Lendo planilha...");
    try {
      const buf = await file.arrayBuffer();
      const wb  = XLSX.read(buf);
      const registros = parseSilomsExcel(wb);
      if (!registros.length) { setImportMsg("⚠️ Nenhum dado encontrado."); return; }

      const { data: exist } = await supabase
        .from("siloms_solicitacoes_empenho").select("solicitacao,status");
      const mapa = new Map((exist ?? []).map((r: { solicitacao: string; status: string }) => [r.solicitacao, r.status]));

      const novos   = registros.filter(r => !mapa.has(r.solicitacao));
      const mudados = registros.filter(r =>
        mapa.has(r.solicitacao) &&
        (mapa.get(r.solicitacao) ?? "").toLowerCase() !== (r.status ?? "").toLowerCase()
      );

      const RESP_CYCLE = ["Ten Bruno", "3S Anne", "3S Anne", "3S Elaine", "3S Elaine"] as const;
      const novosComResp = novos.map((r, i) => ({ ...r, responsavel: RESP_CYCLE[i % 5] }));

      for (let i = 0; i < novosComResp.length; i += 100)
        await supabase.from("siloms_solicitacoes_empenho").insert(novosComResp.slice(i, i + 100));
      for (const r of mudados)
        await supabase.from("siloms_solicitacoes_empenho").update({ status: r.status }).eq("solicitacao", r.solicitacao);

      setImportMsg(`✅ ${novosComResp.length} novos, ${mudados.length} atualizados`);
      await carregarSiloms();
    } catch (err: unknown) {
      setImportMsg(`❌ ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setImportando(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  // ── Upload do servidor bot local ──────────────────────────────────────────
  async function uploadDoBotLocal() {
    setUploadBot(true);
    setImportMsg("⏳ Buscando dados do bot local...");
    try {
      const resp = await fetch("http://localhost:3333/dados");
      if (!resp.ok) throw new Error(`Servidor retornou ${resp.status}`);
      const { registros, docs } = await resp.json();
      if ((!registros || registros.length === 0) && (!docs || docs.length === 0)) {
        setImportMsg("⚠️ Nenhum dado no servidor local."); return;
      }

      // ── Passo 1+2: upsert de solicitações ─────────────────────────────────
      const { data: exist } = await supabase
        .from("siloms_solicitacoes_empenho").select("solicitacao,status");
      const mapa = new Map((exist ?? []).map((r: { solicitacao: string; status: string }) => [r.solicitacao, r.status]));

      const novos   = registros.filter((r: { solicitacao: string }) => !mapa.has(r.solicitacao));
      const mudados = registros.filter((r: { solicitacao: string; status?: string }) =>
        mapa.has(r.solicitacao) &&
        (mapa.get(r.solicitacao) ?? "").toLowerCase() !== (r.status ?? "").toLowerCase()
      );

      const RESP_CYCLE = ["Ten Bruno", "3S Anne", "3S Anne", "3S Elaine", "3S Elaine"] as const;
      const novosComResp = novos.map((r: SilomsRow, i: number) => ({ ...r, responsavel: RESP_CYCLE[i % 5] }));

      for (let i = 0; i < novosComResp.length; i += 100)
        await supabase.from("siloms_solicitacoes_empenho").insert(novosComResp.slice(i, i + 100));
      for (const r of mudados)
        await supabase.from("siloms_solicitacoes_empenho").update({ status: r.status }).eq("solicitacao", r.solicitacao);

      // ── Passo 3: upsert de todas as NEs com subprocesso + perfil_atual ──────
      let docsOk = 0, docsErr = 0;
      if (docs && docs.length > 0) {
        type DocEntry = { nota_empenho: string; nr_documento: string; perfil_atual: string; solicitacao: string };

        // Busca quais NEs já existem na tabela (para decidir insert vs update)
        const { data: existentes } = await supabase
          .from("siloms_solicitacoes_empenho")
          .select("solicitacao, empenho_siafi");
        const porNE  = new Map((existentes ?? []).filter((r: { empenho_siafi: string | null }) => r.empenho_siafi)
          .map((r: { solicitacao: string; empenho_siafi: string }) => [r.empenho_siafi, r.solicitacao]));
        const porSol = new Set((existentes ?? []).map((r: { solicitacao: string }) => r.solicitacao));

        for (const doc of docs as DocEntry[]) {
          if (!doc.nota_empenho.toUpperCase().startsWith("2026NE")) continue;
          const isSemSubproc = doc.nr_documento === "s/ subprocesso";
          const neExiste = porNE.has(doc.nota_empenho);

          if (neExiste) {
            // Registro já existe → só atualiza campos
            const campos: Record<string, string | null> = {
              subprocesso: isSemSubproc ? "s/ subprocesso" : doc.nr_documento,
            };
            if (!isSemSubproc && doc.perfil_atual) campos.perfil_atual = doc.perfil_atual;
            const { error } = await supabase.from("siloms_solicitacoes_empenho")
              .update(campos).eq("empenho_siafi", doc.nota_empenho);
            if (error) docsErr++; else docsOk++;
          } else {
            // NE não existe na tabela → insere registro mínimo
            const solicitacaoKey = (doc.solicitacao && !porSol.has(doc.solicitacao))
              ? doc.solicitacao
              : doc.nota_empenho; // usa própria NE como chave se solicitacao já existe ou vazia
            const { error } = await supabase.from("siloms_solicitacoes_empenho")
              .upsert({
                solicitacao:    solicitacaoKey,
                empenho_siafi:  doc.nota_empenho,
                subprocesso:    isSemSubproc ? "s/ subprocesso" : doc.nr_documento,
                perfil_atual:   isSemSubproc ? null : (doc.perfil_atual || null),
                ano:            2026,
                importado_em:   new Date().toISOString(),
              }, { onConflict: "solicitacao" });
            if (error) docsErr++; else docsOk++;
          }
        }
      }

      setImportMsg(
        `✅ Bot: ${novosComResp.length} novos, ${mudados.length} status atualizados` +
        (docs?.length ? ` · NEs (Passo 3): ${docsOk} salvas${docsErr ? `, ${docsErr} erros` : ""}` : "")
      );
      await carregarSiloms();
    } catch (err: unknown) {
      setImportMsg(`❌ ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setUploadBot(false);
    }
  }

  // ── Criar novo registro ───────────────────────────────────────────────────
  async function criarNovo() {
    if (!novoForm.solicitacao) { alert("Informe a Solicitação."); return; }
    setSalNovo(true);
    await supabase.from("siloms_solicitacoes_empenho").upsert({
      solicitacao:    novoForm.solicitacao,
      responsavel:    novoForm.responsavel,
      subprocesso:    novoForm.subprocesso,
      empenho_siafi:  novoForm.empenho_siafi,
      oc_gerada:      novoForm.oc_gerada,
      perfil_atual:   novoForm.perfil_atual,
      ug_cred:        novoForm.ug_cred,
      dt_solicitacao: novoForm.dt_solicitacao,
      status:         novoForm.status,
      valor: novoForm.valor_str
        ? parseFloat(novoForm.valor_str.replace(",", ".")) || undefined
        : undefined,
    }, { onConflict: "solicitacao" });
    setSalNovo(false);
    setShowNovo(false);
    setNovoForm({});
    await carregarSiloms();
  }

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-3">

      {/* Modal rodar bot */}
      {showBotModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
          onClick={() => !botRunning && setShowBotModal(false)}>
          <div className="bg-white rounded-2xl shadow-2xl border max-w-md w-full mx-4 p-5 space-y-3"
            onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <span className="font-semibold text-slate-800 text-sm">🤖 Rodar Robô SILOMS</span>
              {!botRunning && <button onClick={() => setShowBotModal(false)} className="text-slate-400 hover:text-slate-600">✕</button>}
            </div>
            <p className="text-xs text-slate-500">O Chrome abrirá automaticamente e executará <strong>3 passos</strong>: Empenhos Recebidos → Anulação/Reforço → Documentos na Unidade. Mantenha <code className="bg-slate-100 px-1 rounded">node server.js</code> aberto.</p>
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div>
                <label className="text-slate-500 font-semibold uppercase text-[10px] block mb-0.5">CPF (só números)</label>
                <input value={botCpf} onChange={e => setBotCpf(e.target.value)} placeholder="00000000000"
                  disabled={botRunning}
                  className="w-full rounded-lg border px-2 py-1.5 outline-none focus:ring-2 focus:ring-violet-200" />
              </div>
              <div>
                <label className="text-slate-500 font-semibold uppercase text-[10px] block mb-0.5">Senha</label>
                <input type="password" value={botSenha} onChange={e => setBotSenha(e.target.value)} placeholder="••••••"
                  disabled={botRunning}
                  className="w-full rounded-lg border px-2 py-1.5 outline-none focus:ring-2 focus:ring-violet-200" />
              </div>
              <div>
                <label className="text-slate-500 font-semibold uppercase text-[10px] block mb-0.5">Ano</label>
                <input value={botAno} onChange={e => setBotAno(e.target.value)} placeholder="2026"
                  disabled={botRunning}
                  className="w-full rounded-lg border px-2 py-1.5 outline-none focus:ring-2 focus:ring-violet-200" />
              </div>
            </div>
            {botLog.length > 0 && (
              <div ref={botLogRef}
                className="bg-slate-900 text-green-400 font-mono text-[10px] rounded-xl p-3 h-36 overflow-y-auto space-y-0.5">
                {botLog.map((l, i) => <div key={i}>{l}</div>)}
              </div>
            )}
            <button onClick={rodarBot} disabled={botRunning || !botCpf || !botSenha}
              className="w-full rounded-xl bg-violet-600 text-white py-2 text-sm font-medium hover:bg-violet-700 disabled:opacity-50">
              {botRunning ? "🔄 Rodando — aguarde..." : "▶ Iniciar Extração"}
            </button>
          </div>
        </div>
      )}

      {/* Modal detalhe NE SIAFI */}
      {neModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30"
          onClick={() => setNeModal(null)}>
          <div className="bg-white rounded-2xl shadow-2xl border max-w-lg w-full mx-4 p-5"
            onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-3">
              <span className="font-mono font-bold text-sky-700 text-sm">{neModal.nota_empenho}</span>
              <button onClick={() => setNeModal(null)} className="text-slate-400 hover:text-slate-600">✕</button>
            </div>
            <div className="space-y-2 text-xs">
              <div className="bg-slate-50 rounded-lg p-3 text-slate-700 leading-relaxed break-words">
                {neModal.descricao || "–"}
              </div>
              <div className="grid grid-cols-2 gap-2">
                {[
                  ["Data Empenho",   neModal.data],
                  ["UGCred",         neModal.ugcred_code],
                  ["Natureza",       neModal.natureza],
                  ["PI",             neModal.pi],
                  ["PI Desc",        neModal.pi_desc],
                  ["Valor",          fmtValor(neModal.valor)],
                  ["Solicitação",    neModal.solicitacao || "–"],
                ].map(([l, v]) => (
                  <div key={l} className="bg-white rounded-lg border p-2">
                    <p className="text-slate-400 text-[10px] font-semibold uppercase mb-0.5">{l}</p>
                    <p className="text-slate-700 font-medium break-words">{v || "–"}</p>
                  </div>
                ))}
              </div>
              {(() => {
                const perfil = neModal.descricao?.match(/[A-Z]{2,}\|[A-Z]+/)?.[0]
                  || neModal.descricao?.match(/I\/L:\s*([A-Z0-9]+)/i)?.[1];
                return perfil ? (
                  <div className="rounded-lg border border-sky-200 bg-sky-50 p-2">
                    <span className="text-sky-500 font-semibold">Perfil / I/L: </span>
                    <span className="text-sky-800 font-mono font-bold">{perfil}</span>
                  </div>
                ) : null;
              })()}
            </div>
          </div>
        </div>
      )}

      <Card>
        {/* Cabeçalho */}
        <div className="flex flex-wrap items-center gap-2 mb-3">
          <div className="flex-1">
            <div className="text-sm font-semibold text-slate-900">
              Solicitações de Empenho · SILOMS
              {rows.length > 0 && <span className="ml-2 text-xs font-normal text-slate-500">{filtrado.length} / {rows.length}</span>}
            </div>
            <div className="text-xs text-slate-500">
              Banco de dados primário · planilha NE como enriquecimento
              {loading && <span className="ml-2 text-slate-400">↻ planilha...</span>}
            </div>
          </div>
          {canEdit && (
            <button onClick={() => setShowNovo(v => !v)}
              className="rounded-xl bg-sky-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-sky-700">
              + Novo
            </button>
          )}
          {canEdit && (
            <>
              <button onClick={() => fileRef.current?.click()} disabled={importando}
                className="rounded-xl border border-slate-300 px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-50 disabled:opacity-50">
                {importando ? "Importando..." : "⬆ Importar SILOMS"}
              </button>
              <input ref={fileRef} type="file" accept=".xls,.xlsx" className="hidden" onChange={onFileChange} />
              {isDev && botDisponivel && (
                <>
                  <button onClick={() => setShowBotModal(true)} disabled={botRunning}
                    title="Abre o Chrome e extrai dados do SILOMS automaticamente (3 passos)"
                    className="rounded-xl border border-violet-300 bg-violet-50 px-3 py-1.5 text-xs font-medium text-violet-700 hover:bg-violet-100 disabled:opacity-50">
                    {botRunning ? "🔄 Rodando..." : "🤖 Rodar Bot"}
                  </button>
                  <button onClick={uploadDoBotLocal} disabled={uploadBot}
                    title="Envia ao Supabase os dados já extraídos pelo robô"
                    className="rounded-xl border border-emerald-300 bg-emerald-50 px-3 py-1.5 text-xs font-medium text-emerald-700 hover:bg-emerald-100 disabled:opacity-50">
                    {uploadBot ? "Enviando..." : "⬆ Upload Bot"}
                  </button>
                  {botCountdown !== null && (
                    <span className="rounded-xl border border-violet-200 bg-violet-50 px-3 py-1.5 text-xs font-mono text-violet-500"
                      title="Próxima execução automática">
                      ⏱ {Math.floor(botCountdown / 60)}:{String(botCountdown % 60).padStart(2, "0")}
                    </span>
                  )}
                </>
              )}
            </>
          )}
          {canSync && (
            <button onClick={() => { carregarSiloms(); carregarPlanilha(); }} disabled={loading}
              className="rounded-xl border border-sky-200 bg-sky-50 px-3 py-1.5 text-xs font-medium text-sky-700 hover:bg-sky-100 disabled:opacity-60">
              <span className={loading ? "animate-spin inline-block" : ""}>↻</span> Atualizar
            </button>
          )}
          <input value={busca} onChange={e => setBusca(e.target.value)} placeholder="Buscar..."
            className="rounded-xl border px-3 py-1.5 text-xs outline-none focus:ring-2 focus:ring-sky-200 w-36" />
        </div>

        {importMsg && (
          <div className={`mb-3 text-xs px-3 py-2 rounded-lg ${importMsg.startsWith("✅") ? "bg-green-50 text-green-700" : importMsg.startsWith("❌") ? "bg-red-50 text-red-700" : "bg-blue-50 text-blue-600"}`}>
            {importMsg}
          </div>
        )}

        {/* Form novo registro */}
        {showNovo && (
          <div className="mb-4 border rounded-xl p-3 bg-slate-50 space-y-2">
            <p className="text-xs font-semibold text-slate-600">Novo registro manual</p>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
              {([
                { l: "Solicitação *", k: "solicitacao",    ph: "26S0001" },
                { l: "NE SIAFI",      k: "empenho_siafi",  ph: "2026NE000001" },
                { l: "Subprocesso",   k: "subprocesso",    ph: "2026/001" },
                { l: "Perfil Atual",  k: "perfil_atual",   ph: "DA|EMPENHOS" },
                { l: "Data Solic.",   k: "dt_solicitacao", ph: "01/01/2026" },
                { l: "UGCred",        k: "ug_cred",        ph: "120630" },
                { l: "Valor (R$)",    k: "valor_str",      ph: "0,00" },
                { l: "OC Gerada",     k: "oc_gerada",      ph: "26OC000123" },
              ] as const).map(({ l, k, ph }) => (
                <div key={k}>
                  <label className="text-slate-500 text-[10px] font-semibold uppercase block mb-0.5">{l}</label>
                  <input value={(novoForm as Record<string, string>)[k] ?? ""} placeholder={ph}
                    onChange={e => setNovoForm(b => ({ ...b, [k]: e.target.value }))}
                    className="w-full rounded-lg border px-2 py-1.5 text-xs outline-none focus:ring-2 focus:ring-sky-200" />
                </div>
              ))}
              <div>
                <label className="text-slate-500 text-[10px] font-semibold uppercase block mb-0.5">Responsável</label>
                <select value={novoForm.responsavel ?? ""}
                  onChange={e => setNovoForm(b => ({ ...b, responsavel: e.target.value }))}
                  className="w-full rounded-lg border px-2 py-1.5 text-xs outline-none focus:ring-2 focus:ring-sky-200">
                  <option value="">–</option>
                  {RESP.map(r => <option key={r} value={r}>{r}</option>)}
                </select>
              </div>
            </div>
            <div className="flex gap-2">
              <button onClick={criarNovo} disabled={salNovo}
                className="rounded-lg bg-sky-600 px-4 py-1.5 text-xs font-medium text-white hover:bg-sky-700 disabled:opacity-50">
                {salNovo ? "Salvando..." : "Salvar"}
              </button>
              <button onClick={() => setShowNovo(false)}
                className="rounded-lg border px-4 py-1.5 text-xs text-slate-500 hover:bg-white">Cancelar</button>
            </div>
          </div>
        )}

        {/* Filtros */}
        <div className="flex flex-wrap gap-2">
          <button onClick={() => setSemNE(v => !v)}
            className={`rounded-xl border px-3 py-1.5 text-xs font-medium ${semNE ? "border-amber-300 bg-amber-50 text-amber-700" : "border-slate-200 text-slate-500 hover:bg-slate-50"}`}>
            {semNE ? "● Sem NE" : "Sem NE"}
          </button>
          {ugOpts.length > 0 && (
            <select value={filtroUG} onChange={e => setFiltroUG(e.target.value)}
              className="rounded-xl border px-3 py-1.5 text-xs outline-none focus:ring-2 focus:ring-sky-200">
              <option value="">Todas UGCred</option>
              {ugOpts.map(u => <option key={u} value={u}>{u}</option>)}
            </select>
          )}
          {respOpts.length > 0 && (
            <select value={filtroResp} onChange={e => setFiltroResp(e.target.value)}
              className="rounded-xl border px-3 py-1.5 text-xs outline-none focus:ring-2 focus:ring-sky-200">
              <option value="">Todos responsáveis</option>
              {respOpts.map(r => <option key={r} value={r}>{r}</option>)}
            </select>
          )}
        </div>
      </Card>

      {/* Tabela — sticky header, sem scroll horizontal */}
      <div className="rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="max-h-[68vh] overflow-y-auto overflow-x-hidden rounded-2xl">
          <table className="w-full text-xs border-collapse">
            <thead className="bg-slate-50 text-left sticky top-0 z-20">
              <tr className="border-b border-slate-200">
                <th className="px-1.5 py-2 w-4"></th>
                <th className="px-2 py-2 font-semibold text-slate-600 whitespace-nowrap">NE SIAFI</th>
                <th className="px-2 py-2 font-semibold text-slate-600 whitespace-nowrap">Solicitação</th>
                <th className="px-2 py-2 font-semibold text-slate-600 whitespace-nowrap">Dt. Empenho</th>
                <th className="px-2 py-2 font-semibold text-slate-600 whitespace-nowrap">UGCred</th>
                <th className="px-2 py-2 font-semibold text-slate-600 whitespace-nowrap text-right">Valor</th>
                <th className="px-2 py-2 font-semibold text-slate-600 whitespace-nowrap">Responsável</th>
                <th className="px-2 py-2 font-semibold text-slate-600 whitespace-nowrap">Subprocesso</th>
                <th className="px-2 py-2 font-semibold text-slate-600 whitespace-nowrap">Perfil Atual</th>
                <th className="px-2 py-2 font-semibold text-slate-600 whitespace-nowrap">Status / OC</th>
                <th className="px-1.5 py-2 w-16"></th>
              </tr>
            </thead>
            <tbody>
              {filtrado.length === 0 ? (
                <tr><td colSpan={11} className="px-4 py-10 text-center text-slate-400">
                  {rows.length === 0
                    ? "Nenhuma solicitação. Importe a planilha SILOMS ou crie manualmente."
                    : "Sem resultados para os filtros aplicados."}
                </td></tr>
              ) : filtrado.map(row => {
                const isEdit = editKey === row.solicitacao;
                const st = getStatusInfo(row.status, row.oc_gerada);
                const ne = row.ne;
                const neLabel = ne?.nota_empenho || row.empenho_siafi;
                const ugLabel = row.ug_cred || ne?.ugcred_code || "–";
                const valor   = ne?.valor ?? row.valor;
                // Modal: usa dados da planilha ou constrói sintético do SILOMS
                const modalNE: EmpenhoNF | null = ne ?? (row.empenho_siafi ? {
                  nota_empenho:      row.empenho_siafi,
                  nota_empenho_full: row.empenho_siafi,
                  descricao:         row.historico || "",
                  data:              row.dt_solicitacao || "",
                  ugcred_code:       row.ug_cred || "",
                  ugr:               "",
                  natureza:          row.nd || "",
                  pi:                "",
                  pi_desc:           "",
                  valor:             row.valor ?? 0,
                  solicitacao:       row.solicitacao,
                } : null);

                return (
                  <tr key={row.solicitacao}
                    className={`border-b last:border-0 transition-colors ${isEdit ? "bg-sky-50 ring-1 ring-sky-200 ring-inset" : "hover:bg-slate-50/60"}`}>

                    {/* Dot */}
                    <td className="px-1.5 py-1.5">
                      <span className={`inline-block w-2 h-2 rounded-full ${st.dot}`} title={row.status || "sem status"} />
                    </td>

                    {/* NE SIAFI — clicável para expandir detalhes */}
                    <td className="px-2 py-1.5 whitespace-nowrap">
                      {neLabel ? (
                        <button onClick={() => modalNE && setNeModal(modalNE)}
                          className={`font-mono font-semibold text-[11px] ${modalNE ? "text-sky-600 hover:underline cursor-pointer" : "text-slate-500 cursor-default"}`}>
                          {neLabel}
                        </button>
                      ) : <span className="text-slate-300">–</span>}
                    </td>

                    {/* Solicitação */}
                    <td className="px-2 py-1.5 whitespace-nowrap font-mono font-semibold text-sky-700 text-[11px]">
                      {row.solicitacao}
                    </td>

                    {/* Data do Empenho (planilha NE) */}
                    <td className="px-2 py-1.5 whitespace-nowrap text-slate-500 text-[11px]">
                      {ne?.data || <span className="text-slate-300">–</span>}
                    </td>

                    {/* UGCred */}
                    <td className="px-2 py-1.5 whitespace-nowrap text-slate-500 font-mono text-[11px]">{ugLabel}</td>

                    {/* Valor */}
                    <td className="px-2 py-1.5 whitespace-nowrap text-right font-mono text-slate-700 text-[11px]">
                      {neLabel ? fmtValor(valor) : <span className="text-slate-300">–</span>}
                    </td>

                    {/* Responsável — editável */}
                    <td className="px-2 py-1.5" onClick={e => e.stopPropagation()}>
                      {isEdit && canEdit ? (
                        <select value={editBuf.responsavel ?? row.responsavel ?? ""}
                          onChange={e => setEditBuf(b => ({ ...b, responsavel: e.target.value }))}
                          className="rounded-lg border px-1.5 py-1 text-[11px] outline-none focus:ring-2 focus:ring-sky-200 w-24">
                          <option value="">–</option>
                          {RESP.map(r => <option key={r} value={r}>{r}</option>)}
                        </select>
                      ) : <span className={`text-[11px] ${row.responsavel ? "text-slate-700" : "text-slate-300"}`}>{row.responsavel || "–"}</span>}
                    </td>

                    {/* Subprocesso — editável */}
                    <td className="px-2 py-1.5" onClick={e => e.stopPropagation()}>
                      {isEdit && canEdit ? (
                        <input value={editBuf.subprocesso ?? row.subprocesso ?? ""}
                          onChange={e => setEditBuf(b => ({ ...b, subprocesso: e.target.value }))}
                          className="rounded-lg border px-1.5 py-1 text-[11px] outline-none focus:ring-2 focus:ring-sky-200 w-20 font-mono" />
                      ) : <span className={`text-[11px] ${row.subprocesso ? "font-mono text-slate-600" : "text-slate-300"}`}>{row.subprocesso || "–"}</span>}
                    </td>

                    {/* Perfil Atual — editável */}
                    <td className="px-2 py-1.5" onClick={e => e.stopPropagation()}>
                      {isEdit && canEdit ? (
                        <input value={editBuf.perfil_atual ?? row.perfil_atual ?? ""}
                          onChange={e => setEditBuf(b => ({ ...b, perfil_atual: e.target.value }))}
                          placeholder="DA|EMPENHOS"
                          className="rounded-lg border px-1.5 py-1 text-[11px] outline-none focus:ring-2 focus:ring-sky-200 w-24 font-mono" />
                      ) : <span className={`text-[11px] ${row.perfil_atual ? "font-mono text-slate-600" : "text-slate-300"}`}>{row.perfil_atual || "–"}</span>}
                    </td>

                    {/* Status / OC — editável */}
                    <td className="px-2 py-1.5 whitespace-nowrap" onClick={e => e.stopPropagation()}>
                      {isEdit && canEdit ? (
                        <div className="space-y-1">
                          <select value={editBuf.status ?? row.status ?? ""}
                            onChange={e => setEditBuf(b => ({ ...b, status: e.target.value }))}
                            className="rounded-lg border px-2 py-1 text-xs outline-none focus:ring-2 focus:ring-sky-200 w-32">
                            <option value="">–</option>
                            <option value="Aguarda Assinat ACI">Aguarda Assinat ACI</option>
                            <option value="Assinada OD">Assinada OD</option>
                          </select>
                          <input value={editBuf.oc_gerada ?? row.oc_gerada ?? ""}
                            onChange={e => setEditBuf(b => ({ ...b, oc_gerada: e.target.value }))}
                            placeholder="OC: 26OC000123"
                            className="rounded-lg border px-2 py-1 text-xs outline-none focus:ring-2 focus:ring-sky-200 w-32 font-mono" />
                        </div>
                      ) : (
                        st.text !== "–"
                          ? <span className={`inline-block rounded-full px-2 py-0.5 text-[10px] font-semibold ${st.badge}`}>{st.text}</span>
                          : <span className="text-slate-300">–</span>
                      )}
                    </td>

                    {/* Botões editar + acompanhar */}
                    <td className="px-1.5 py-1.5" onClick={e => e.stopPropagation()}>
                      {isEdit ? (
                        <div className="flex gap-1">
                          <button onClick={() => salvar(row.solicitacao)} disabled={saving}
                            className="rounded-lg bg-sky-600 px-2 py-1 text-[11px] font-medium text-white hover:bg-sky-700 disabled:opacity-50">
                            {saving ? "..." : "💾"}
                          </button>
                          <button onClick={() => { setEditKey(null); setEditBuf({}); }}
                            className="rounded-lg border px-2 py-1 text-[11px] text-slate-500 hover:bg-slate-100">✕</button>
                        </div>
                      ) : (
                        <div className="flex gap-1 items-center">
                          <button
                            onClick={() => toggleSeguir(row.solicitacao, row.solicitacao)}
                            title={seguindo.has(row.solicitacao) ? "Deixar de acompanhar" : "Acompanhar esta solicitação"}
                            className={`text-[13px] leading-none hover:scale-110 transition-transform ${seguindo.has(row.solicitacao) ? "text-amber-400" : "text-slate-200 hover:text-amber-300"}`}>
                            ★
                          </button>
                          {canEdit && (
                            <button onClick={() => {
                              setEditKey(row.solicitacao);
                              setEditBuf({
                                responsavel:  row.responsavel,
                                subprocesso:  row.subprocesso,
                                perfil_atual: row.perfil_atual,
                                oc_gerada:    row.oc_gerada,
                                status:       row.status,
                              });
                            }} className="rounded-lg border px-1.5 py-0.5 text-[11px] text-slate-400 hover:text-sky-600 hover:border-sky-300">✏</button>
                          )}
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
            {/* Ponto 2: soma apenas linhas com NE */}
            <tfoot>
              <tr className="border-t-2 border-slate-200 bg-slate-50 sticky bottom-0 z-10">
                <td colSpan={5} className="px-2 py-2 text-xs font-semibold text-slate-500 text-right">
                  Total (com NE)
                </td>
                <td className="px-2 py-2 text-right font-mono font-bold text-slate-800 whitespace-nowrap">
                  {fmtValor(totalComNE)}
                </td>
                <td colSpan={5} />
              </tr>
            </tfoot>
          </table>
        </div>
      </div>
    </div>
  );
}
