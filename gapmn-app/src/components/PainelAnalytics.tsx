import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";

// Design tokens — mesmos do AppChat
const C = {
  card:  "rgba(255,255,255,0.04)",
  card2: "rgba(255,255,255,0.07)",
  bdr:   "rgba(255,255,255,0.08)",
  bdr2:  "rgba(255,255,255,0.14)",
  row:   "rgba(255,255,255,0.03)",
  txt:   "#eaf1fb",
  mut:   "rgba(234,241,251,0.45)",
  mut2:  "rgba(234,241,251,0.22)",
  cyan:  "#38bdf8",
  grn:   "#34d399",
  gold:  "#fbbf24",
  vio:   "#a78bfa",
  mono:  "'JetBrains Mono','Fira Mono',monospace",
};

interface Log {
  id:          string;
  user_id:     string | null;
  setor:       string | null;
  nome_guerra: string | null;
  action:      string;
  entity:      string | null;
  value:       string | null;
  created_at:  string;
}

function groupCount(items: Log[], key: (i: Log) => string): { label: string; count: number }[] {
  const map = new Map<string, number>();
  for (const i of items) {
    const k = key(i);
    if (!k) continue;
    map.set(k, (map.get(k) ?? 0) + 1);
  }
  return [...map.entries()].map(([label, count]) => ({ label, count })).sort((a, b) => b.count - a.count);
}

function fmtTime(iso: string) {
  return new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

function timeAgo(iso: string): string {
  const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (diff < 60)   return `${diff}s atrás`;
  if (diff < 3600) return `${Math.floor(diff / 60)}min atrás`;
  return `${Math.floor(diff / 3600)}h atrás`;
}

const ONLINE_MS = 5 * 60 * 1000;

const ACTION_LABEL: Record<string, string> = {
  page_view:     "Página acessada",
  tab_change:    "Aba acessada",
  chatbot_query: "Pergunta ao chatbot",
  search:        "Busca",
  button_click:  "Ação",
  heartbeat:     "App aberto",
};

const ENTITY_LABEL: Record<string, string> = {
  dashboard:          "Dashboard",
  processos:          "Processos",
  contratos:          "Contratos",
  indicadores:        "Indicadores",
  atas:               "Atas de RP",
  solicitacoes:       "Solicitações",
  setor:              "Área de Trabalho",
  configuracoes:      "Configurações",
  analytics:          "Analytics DEV",
  "painel-orcamento": "Painel Orçamentário",
  "painel-rp":        "Painel RP",
  "painel-processos": "Painel Processos",
  "painel-execucao":  "Painel Execução",
  "painel-governanca":"Painel Governança",
  ferramentas:        "Ferramentas",
  admin:              "Administração",
};

type SubTab = "live" | "resumo" | "usuarios" | "historico";

export default function PainelAnalytics() {
  const [todayLogs,  setTodayLogs]  = useState<Log[]>([]);
  const [periodLogs, setPeriodLogs] = useState<Log[]>([]);
  const [loadingP,   setLoadingP]   = useState(true);
  const [period,     setPeriod]     = useState<7 | 30 | 90>(30);
  const [tab,        setTab]        = useState<SubTab>("live");
  const [pulse,      setPulse]      = useState(false);
  const [tick,       setTick]       = useState(0);

  useEffect(() => {
    const id = setInterval(() => setTick(n => n + 1), 30_000);
    return () => clearInterval(id);
  }, []);

  async function loadToday() {
    const since = new Date(); since.setHours(0, 0, 0, 0);
    const { data } = await supabase
      .from("activity_log").select("*")
      .gte("created_at", since.toISOString())
      .order("created_at", { ascending: false }).limit(500);
    setTodayLogs((data ?? []) as Log[]);
  }

  async function loadPeriod() {
    setLoadingP(true);
    const since = new Date(); since.setDate(since.getDate() - period);
    const { data } = await supabase
      .from("activity_log").select("*")
      .gte("created_at", since.toISOString())
      .order("created_at", { ascending: false }).limit(3000);
    setPeriodLogs((data ?? []) as Log[]);
    setLoadingP(false);
  }

  useEffect(() => {
    loadToday();
    const ch = supabase.channel("analytics_live")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "activity_log" }, (payload) => {
        const log = payload.new as Log;
        const today = new Date(); today.setHours(0, 0, 0, 0);
        if (new Date(log.created_at) >= today) setTodayLogs(prev => [log, ...prev]);
        setPulse(true);
        setTimeout(() => setPulse(false), 800);
      })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, []);

  useEffect(() => { loadPeriod(); }, [period]);

  // ── Derivados TODAY ──────────────────────────────────────────────────────────
  const now = Date.now(); void tick;

  const userMap = new Map<string, {
    nome: string; setor: string | null;
    lastSeen: string; lastAction: string; lastEntity: string | null; count: number;
  }>();
  for (const l of todayLogs) {
    const key = l.user_id ?? l.nome_guerra ?? "?";
    const ex = userMap.get(key);
    if (!ex || l.created_at > ex.lastSeen)
      userMap.set(key, { nome: l.nome_guerra ?? "?", setor: l.setor, lastSeen: l.created_at, lastAction: l.action, lastEntity: l.entity, count: (ex?.count ?? 0) + 1 });
    else ex.count++;
  }

  const usersToday  = [...userMap.values()];
  const onlineNow   = usersToday.filter(u => now - new Date(u.lastSeen).getTime() < ONLINE_MS);
  const eventosHoje = todayLogs.filter(l => l.action !== "heartbeat").length;
  const acoesHoje   = todayLogs.filter(l => ["button_click","search","chatbot_query"].includes(l.action)).length;

  // ── Derivados PERIOD ─────────────────────────────────────────────────────────
  const logs       = periodLogs;
  const topPages   = groupCount(logs.filter(l => l.action === "page_view"),     l => ENTITY_LABEL[l.entity ?? ""] || l.entity || "");
  const topTabs    = groupCount(logs.filter(l => l.action === "tab_change"),    l => ENTITY_LABEL[l.entity ?? ""] || l.entity || "");
  const topQueries = groupCount(logs.filter(l => l.action === "chatbot_query"), l => l.value ?? "");
  const topSearch  = groupCount(logs.filter(l => l.action === "search"),        l => l.value ?? "");
  const bySetor    = groupCount(logs, l => l.setor ?? "Sem setor");
  const byHour     = groupCount(logs, l => new Date(l.created_at).getHours().toString().padStart(2, "0") + "h");

  const pUserMap = new Map<string, { nome: string; setor: string | null; lastSeen: string; count: number }>();
  for (const l of logs) {
    const key = l.user_id ?? l.nome_guerra ?? "?";
    const ex = pUserMap.get(key);
    if (!ex || l.created_at > ex.lastSeen)
      pUserMap.set(key, { nome: l.nome_guerra ?? "?", setor: l.setor, lastSeen: l.created_at, count: (ex?.count ?? 0) + 1 });
    else ex.count++;
  }
  const usersArr = [...pUserMap.values()].sort((a, b) => b.count - a.count);

  // ── Estilos reutilizáveis ────────────────────────────────────────────────────
  const cardStyle: React.CSSProperties = {
    background: C.card, border: `1px solid ${C.bdr}`, borderRadius: 16, overflow: "hidden",
  };
  const thStyle: React.CSSProperties = {
    padding: "8px 16px", textAlign: "left", fontSize: 10, fontWeight: 700,
    color: C.mut2, textTransform: "uppercase", letterSpacing: "0.07em",
    borderBottom: `1px solid ${C.bdr}`, background: "rgba(255,255,255,0.02)",
  };
  const tdStyle: React.CSSProperties = {
    padding: "9px 16px", borderBottom: `1px solid ${C.bdr}`, fontSize: 12, color: C.txt,
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16, fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif" }}>

      {/* ── Header ── */}
      <div style={{ ...cardStyle, padding: "20px 24px", overflow: "visible" }}>
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", flexWrap: "wrap", gap: 12 }}>
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <span style={{ fontSize: 15, fontWeight: 700, color: C.txt }}>Analytics — DEV</span>
              <span style={{
                display: "inline-flex", alignItems: "center", gap: 5,
                background: pulse ? "rgba(52,211,153,0.15)" : "rgba(255,255,255,0.06)",
                border: `1px solid ${pulse ? "rgba(52,211,153,0.5)" : C.bdr}`,
                borderRadius: 20, padding: "2px 9px", fontSize: 10, fontWeight: 700,
                color: pulse ? C.grn : C.mut, transition: "all 0.3s",
              }}>
                <span className={pulse ? "animate-pulse" : ""} style={{
                  width: 6, height: 6, borderRadius: "50%",
                  background: pulse ? C.grn : "#334155", display: "inline-block",
                }} />
                LIVE
              </span>
            </div>
            <div style={{ fontSize: 11, color: C.mut, marginTop: 4 }}>
              {onlineNow.length} online agora · {usersToday.length} logado(s) hoje · {eventosHoje} eventos
            </div>
          </div>

          <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
            {tab !== "live" && ([7, 30, 90] as const).map(p => (
              <button key={p} onClick={() => setPeriod(p)} style={{
                background: period === p ? "rgba(56,189,248,0.12)" : "rgba(255,255,255,0.04)",
                border: `1px solid ${period === p ? "rgba(56,189,248,0.5)" : C.bdr}`,
                color: period === p ? C.cyan : C.mut,
                borderRadius: 8, padding: "4px 12px", fontSize: 11, fontWeight: 600, cursor: "pointer",
              }}>{p}d</button>
            ))}
            <button onClick={() => { loadToday(); if (tab !== "live") loadPeriod(); }} style={{
              background: "rgba(255,255,255,0.04)", border: `1px solid ${C.bdr}`,
              color: C.mut, borderRadius: 8, padding: "4px 12px", fontSize: 15, cursor: "pointer",
            }}>↺</button>
          </div>
        </div>

        {/* KPI cards */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 12, marginTop: 20 }}>
          {[
            { label: "Online agora", value: onlineNow.length,  icon: "🟢", accent: C.grn,  bg: "rgba(52,211,153,0.08)",  bdr: "rgba(52,211,153,0.22)"  },
            { label: "Logados hoje", value: usersToday.length, icon: "👥", accent: C.cyan, bg: "rgba(56,189,248,0.08)",  bdr: "rgba(56,189,248,0.22)"  },
            { label: "Eventos hoje", value: eventosHoje,       icon: "⚡", accent: C.gold, bg: "rgba(251,191,36,0.08)",  bdr: "rgba(251,191,36,0.22)"  },
            { label: "Ações hoje",   value: acoesHoje,         icon: "🎯", accent: C.vio,  bg: "rgba(167,139,250,0.08)", bdr: "rgba(167,139,250,0.22)" },
          ].map(k => (
            <div key={k.label} style={{ background: k.bg, border: `1px solid ${k.bdr}`, borderRadius: 12, padding: "14px 18px" }}>
              <div style={{ fontSize: 24, fontWeight: 800, color: k.accent, fontFamily: C.mono }}>{k.value}</div>
              <div style={{ fontSize: 11, fontWeight: 600, color: C.mut, marginTop: 4 }}>{k.icon} {k.label}</div>
            </div>
          ))}
        </div>

        {/* Sub-tabs */}
        <div style={{ display: "flex", gap: 28, marginTop: 20, borderBottom: `1px solid ${C.bdr}` }}>
          {(["live", "resumo", "usuarios", "historico"] as const).map(t => (
            <button key={t} onClick={() => setTab(t)} style={{
              paddingBottom: 10, marginBottom: -1, fontSize: 12, fontWeight: 600,
              color: tab === t ? C.cyan : C.mut,
              background: "none", border: "none", borderBottom: `2px solid ${tab === t ? C.cyan : "transparent"}`,
              cursor: "pointer", whiteSpace: "nowrap",
            }}>
              {t === "live" ? "🟢 Ao Vivo" : t === "resumo" ? "Resumo" : t === "usuarios" ? "Usuários" : "Histórico"}
            </button>
          ))}
        </div>
      </div>

      {/* ── AO VIVO ── */}
      {tab === "live" && <>

        {/* Online agora */}
        <div style={cardStyle}>
          <SectionHead left={<><GreenDot pulse /> Online agora <Muted>(últimos 5 min)</Muted></>} right={`${onlineNow.length} usuário(s)`} />
          {onlineNow.length === 0
            ? <Empty>Nenhum usuário ativo nos últimos 5 minutos.</Empty>
            : <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <tbody>
                  {[...onlineNow].sort((a, b) => b.lastSeen.localeCompare(a.lastSeen)).map((u, i) => (
                    <tr key={i}
                      onMouseEnter={e => (e.currentTarget.style.background = C.row)}
                      onMouseLeave={e => (e.currentTarget.style.background = "transparent")}>
                      <td style={{ ...tdStyle, display: "flex", alignItems: "center", gap: 8 }}>
                        <GreenDot pulse />
                        <span style={{ color: C.txt, fontWeight: 600 }}>{u.nome}</span>
                        <Tag>{u.setor ?? "?"}</Tag>
                      </td>
                      <td style={{ ...tdStyle, color: C.mut }}>
                        {ACTION_LABEL[u.lastAction] ?? u.lastAction}
                        {u.lastEntity ? ` · ${ENTITY_LABEL[u.lastEntity] || u.lastEntity}` : ""}
                      </td>
                      <td style={{ ...tdStyle, color: C.mut, textAlign: "right", whiteSpace: "nowrap" }}>{timeAgo(u.lastSeen)}</td>
                      <td style={{ ...tdStyle, color: C.mut2, textAlign: "right", fontFamily: C.mono, fontSize: 11 }}>{u.count} hoje</td>
                    </tr>
                  ))}
                </tbody>
              </table>
          }
        </div>

        {/* Quem usou hoje */}
        <div style={cardStyle}>
          <SectionHead left="👥 Quem usou o app hoje" />
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                {["Usuário","Setor","Eventos","Status","Último acesso"].map((h, i) => (
                  <th key={h} style={{ ...thStyle, textAlign: i >= 2 && i <= 2 ? "right" : "left" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {usersToday.length === 0 && (
                <tr><td colSpan={5}><Empty>Nenhuma atividade hoje.</Empty></td></tr>
              )}
              {[...usersToday].sort((a, b) => b.lastSeen.localeCompare(a.lastSeen)).map((u, i) => {
                const online = now - new Date(u.lastSeen).getTime() < ONLINE_MS;
                return (
                  <tr key={i}
                    onMouseEnter={e => (e.currentTarget.style.background = C.row)}
                    onMouseLeave={e => (e.currentTarget.style.background = "transparent")}>
                    <td style={{ ...tdStyle, fontWeight: 600 }}>{u.nome}</td>
                    <td style={tdStyle}><Tag>{u.setor ?? "—"}</Tag></td>
                    <td style={{ ...tdStyle, textAlign: "right", fontFamily: C.mono }}>{u.count}</td>
                    <td style={tdStyle}>
                      {online
                        ? <span style={{ display: "flex", alignItems: "center", gap: 5, color: C.grn, fontWeight: 600, fontSize: 12 }}>
                            <GreenDot pulse /> Online
                          </span>
                        : <span style={{ color: C.mut, fontSize: 12 }}>Offline</span>
                      }
                    </td>
                    <td style={{ ...tdStyle, color: C.mut, fontFamily: C.mono, fontSize: 11 }}>{fmtTime(u.lastSeen)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Feed de hoje */}
        <div style={cardStyle}>
          <SectionHead left={<>⚡ Feed de hoje <Muted>(tempo real)</Muted></>} right={`${eventosHoje} eventos`} />
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                {["Horário","Usuário","Ação","Detalhe"].map(h => <th key={h} style={thStyle}>{h}</th>)}
              </tr>
            </thead>
            <tbody>
              {eventosHoje === 0 && <tr><td colSpan={4}><Empty>Nenhuma atividade hoje.</Empty></td></tr>}
              {todayLogs.filter(l => l.action !== "heartbeat").slice(0, 100).map(l => (
                <tr key={l.id}
                  onMouseEnter={e => (e.currentTarget.style.background = C.row)}
                  onMouseLeave={e => (e.currentTarget.style.background = "transparent")}>
                  <td style={{ ...tdStyle, color: C.mut, whiteSpace: "nowrap", fontFamily: C.mono, fontSize: 11 }}>{fmtTime(l.created_at)}</td>
                  <td style={{ ...tdStyle, fontWeight: 600 }}>
                    {l.nome_guerra ?? "?"} <span style={{ color: C.mut, fontWeight: 400 }}>({l.setor ?? "?"})</span>
                  </td>
                  <td style={{ ...tdStyle, color: C.mut }}>{ACTION_LABEL[l.action] ?? l.action}</td>
                  <td style={{ ...tdStyle, color: C.mut2, maxWidth: 280, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {ENTITY_LABEL[l.entity ?? ""] || l.entity || ""}
                    {l.value ? ` — "${l.value}"` : ""}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </>}

      {/* ── RESUMO ── */}
      {tab === "resumo" && loadingP && <Spinner />}
      {tab === "resumo" && !loadingP && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
          <DarkCard title="📄 Páginas mais acessadas"><RankList items={topPages} /></DarkCard>
          <DarkCard title="🗂 Abas mais acessadas"><RankList items={topTabs} /></DarkCard>
          <DarkCard title="💬 Perguntas ao chatbot" span>
            {topQueries.length === 0 ? <Empty>Nenhuma pergunta registrada.</Empty> : <RankList items={topQueries.slice(0, 10)} truncate />}
          </DarkCard>
          {topSearch.length > 0 && (
            <DarkCard title="🔍 Termos buscados" span><RankList items={topSearch.slice(0, 10)} truncate /></DarkCard>
          )}
          <DarkCard title="🕐 Acessos por horário"><HourChart items={byHour} /></DarkCard>
          <DarkCard title="🏢 Acessos por setor"><RankList items={bySetor} /></DarkCard>
        </div>
      )}

      {/* ── USUÁRIOS ── */}
      {tab === "usuarios" && loadingP && <Spinner />}
      {tab === "usuarios" && !loadingP && (
        <div style={cardStyle}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                {["Usuário","Setor","Eventos","Último acesso"].map(h => <th key={h} style={thStyle}>{h}</th>)}
              </tr>
            </thead>
            <tbody>
              {usersArr.length === 0 && <tr><td colSpan={4}><Empty>Nenhum dado no período.</Empty></td></tr>}
              {usersArr.map((u, i) => (
                <tr key={i}
                  onMouseEnter={e => (e.currentTarget.style.background = C.row)}
                  onMouseLeave={e => (e.currentTarget.style.background = "transparent")}>
                  <td style={{ ...tdStyle, fontWeight: 600 }}>{u.nome}</td>
                  <td style={tdStyle}><Tag>{u.setor ?? "—"}</Tag></td>
                  <td style={{ ...tdStyle, fontFamily: C.mono }}>{u.count}</td>
                  <td style={{ ...tdStyle, color: C.mut, fontFamily: C.mono, fontSize: 11 }}>{fmtDate(u.lastSeen)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* ── HISTÓRICO ── */}
      {tab === "historico" && loadingP && <Spinner />}
      {tab === "historico" && !loadingP && (
        <div style={cardStyle}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                {["Data/Hora","Usuário","Ação","Detalhe"].map(h => <th key={h} style={thStyle}>{h}</th>)}
              </tr>
            </thead>
            <tbody>
              {logs.length === 0 && <tr><td colSpan={4}><Empty>Nenhum dado no período.</Empty></td></tr>}
              {logs.slice(0, 200).map(l => (
                <tr key={l.id}
                  onMouseEnter={e => (e.currentTarget.style.background = C.row)}
                  onMouseLeave={e => (e.currentTarget.style.background = "transparent")}>
                  <td style={{ ...tdStyle, color: C.mut, whiteSpace: "nowrap", fontFamily: C.mono, fontSize: 11 }}>{fmtDate(l.created_at)}</td>
                  <td style={{ ...tdStyle, fontWeight: 600 }}>
                    {l.nome_guerra ?? "?"} <span style={{ color: C.mut, fontWeight: 400 }}>({l.setor ?? "?"})</span>
                  </td>
                  <td style={{ ...tdStyle, color: C.mut }}>{ACTION_LABEL[l.action] ?? l.action}</td>
                  <td style={{ ...tdStyle, color: C.mut2, maxWidth: 260, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {ENTITY_LABEL[l.entity ?? ""] || l.entity || ""}
                    {l.value ? ` — "${l.value}"` : ""}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {logs.length > 200 && (
            <div style={{ padding: "8px 16px", fontSize: 11, color: C.mut, borderTop: `1px solid ${C.bdr}` }}>
              Exibindo 200 de {logs.length} eventos. Reduza o período para ver menos.
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Micro-components ──────────────────────────────────────────────────────────

function SectionHead({ left, right }: { left: React.ReactNode; right?: React.ReactNode }) {
  return (
    <div style={{
      display: "flex", alignItems: "center", justifyContent: "space-between",
      padding: "10px 16px", borderBottom: `1px solid ${C.bdr}`,
      background: "rgba(255,255,255,0.02)", fontSize: 12, fontWeight: 700, color: C.txt,
    }}>
      <span style={{ display: "flex", alignItems: "center", gap: 6 }}>{left}</span>
      {right && <span style={{ fontSize: 11, color: C.mut, fontWeight: 400 }}>{right}</span>}
    </div>
  );
}

function GreenDot({ pulse }: { pulse?: boolean }) {
  return (
    <span className={pulse ? "animate-pulse" : ""} style={{
      display: "inline-block", width: 8, height: 8, borderRadius: "50%",
      background: "#34d399", flexShrink: 0,
    }} />
  );
}

function Tag({ children }: { children: React.ReactNode }) {
  return (
    <span style={{
      background: "rgba(255,255,255,0.07)", border: `1px solid rgba(255,255,255,0.1)`,
      borderRadius: 20, padding: "1px 8px", fontSize: 10, color: "rgba(234,241,251,0.6)",
    }}>{children}</span>
  );
}

function Muted({ children }: { children: React.ReactNode }) {
  return <span style={{ color: "rgba(234,241,251,0.4)", fontWeight: 400 }}>{children}</span>;
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ padding: "28px 16px", textAlign: "center", fontSize: 12, color: "rgba(234,241,251,0.3)" }}>
      {children}
    </div>
  );
}

function Spinner() {
  return <div style={{ textAlign: "center", padding: "32px", fontSize: 12, color: "rgba(234,241,251,0.3)" }}>Carregando…</div>;
}

function DarkCard({ title, children, span }: { title: string; children: React.ReactNode; span?: boolean }) {
  return (
    <div style={{
      background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)",
      borderRadius: 14, padding: "16px 20px",
      gridColumn: span ? "1 / -1" : undefined,
    }}>
      <div style={{ fontSize: 12, fontWeight: 700, color: "rgba(234,241,251,0.8)", marginBottom: 14 }}>{title}</div>
      {children}
    </div>
  );
}

function RankList({ items, truncate }: { items: { label: string; count: number }[]; truncate?: boolean }) {
  if (!items.length) return <Empty>Sem dados no período.</Empty>;
  const max = items[0].count;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {items.slice(0, 8).map((it, i) => (
        <div key={i} style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ width: 16, textAlign: "right", fontSize: 10, color: "rgba(234,241,251,0.25)", flexShrink: 0 }}>{i + 1}</span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{
              fontSize: 12, color: "rgba(234,241,251,0.75)",
              overflow: truncate ? "hidden" : undefined,
              textOverflow: truncate ? "ellipsis" : undefined,
              whiteSpace: truncate ? "nowrap" : undefined,
            }} title={it.label}>{it.label || "—"}</div>
            <div style={{ marginTop: 3, height: 4, borderRadius: 4, background: "rgba(255,255,255,0.06)", overflow: "hidden" }}>
              <div style={{ height: "100%", borderRadius: 4, background: "#38bdf8", opacity: 0.7, width: `${Math.round((it.count / max) * 100)}%` }} />
            </div>
          </div>
          <span style={{ fontSize: 11, color: "rgba(234,241,251,0.4)", flexShrink: 0, fontFamily: "'JetBrains Mono',monospace" }}>{it.count}</span>
        </div>
      ))}
    </div>
  );
}

function HourChart({ items }: { items: { label: string; count: number }[] }) {
  if (!items.length) return <Empty>Sem dados no período.</Empty>;
  const sorted = [...items].sort((a, b) => parseInt(a.label) - parseInt(b.label));
  const max = Math.max(...sorted.map(i => i.count));
  return (
    <div style={{ display: "flex", alignItems: "flex-end", gap: 4, height: 80 }}>
      {sorted.map((it, i) => (
        <div key={i} style={{ display: "flex", flexDirection: "column", alignItems: "center", flex: 1, gap: 3 }}>
          <div
            style={{
              width: "100%", borderRadius: "4px 4px 0 0",
              background: "#38bdf8", opacity: 0.65,
              height: `${Math.max(4, Math.round((it.count / max) * 64))}px`,
              transition: "height 0.2s",
            }}
            title={`${it.label}: ${it.count}`}
          />
          {parseInt(it.label) % 6 === 0 && (
            <span style={{ fontSize: 9, color: "rgba(234,241,251,0.25)" }}>{it.label}</span>
          )}
        </div>
      ))}
    </div>
  );
}
