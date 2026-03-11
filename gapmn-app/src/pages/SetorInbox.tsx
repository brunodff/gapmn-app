import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabase";
import { Card } from "../components/Card";
import GerenciamentoProcessos from "../components/GerenciamentoProcessos";
import GerenciamentoContratos from "../components/GerenciamentoContratos";
import IndicadoresLotacao from "../components/IndicadoresLotacao";
import PainelDashboard from "../components/PainelDashboard";

type Setor = "SEO" | "SCON" | "SLIC" | "ADMIN";

type TicketStatus = "open" | "answered" | "closed";

type Profile = {
  id: string;
  nome_guerra: string | null;
  email: string | null;
  setor: Setor | null;
};

type Ticket = {
  id: string; // uuid
  created_at: string;
  updated_at?: string | null;
  user_id: string;
  nome_guerra: string | null;
  email: string | null;
  unidade: string | null;
  setor: Setor;
  mensagem: string;
  status: TicketStatus;
  resposta: string | null;
  respondido_em?: string | null;
  responded_by?: string | null;
};

function isAgent(profile?: Profile | null) {
  const setor = profile?.setor?.toUpperCase();
  return setor === "ADMIN" || setor === "SEO" || setor === "SCON" || setor === "SLIC";
}

function formatSetor(s: string | null | undefined): string {
  switch ((s ?? "").toUpperCase()) {
    case "SLIC":  return "Seção de Licitações";
    case "SEO":   return "Seção de Execução Orçamentária";
    case "SCON":  return "Seção de Contratos";
    case "ADMIN": return "Administração";
    default:      return s ?? "-";
  }
}

export default function SetorInbox() {
  const nav = useNavigate();
  const [me, setMe] = useState<Profile | null>(null);
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [loading, setLoading] = useState(true);

  const [active, setActive] = useState<Ticket | null>(null);
  const [reply, setReply] = useState("");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Aba ativa — todos os usuários logados veem contratos/processos/indicadores
  const defaultTab = me?.setor === "SEO" ? "indicadores" : "contratos";
  const [tab, setTab] = useState<"processos" | "prestacao" | "contratos" | "indicadores">(defaultTab as any);
  const showProcessosTab   = true;
  const showContratosTab   = true;
  const showIndicadoresTab = true;
  const showAnyExtraTab    = true;
  // Painel de prestação: apenas SCON, SLIC e admin (SEO já tem seu painel integrado)
  const showPrestacaoTab   = me?.setor === "SCON" || me?.setor === "SLIC" || me?.setor === "ADMIN";

  // Permissões de importação: apenas o setor responsável + admin
  const canImportIndicadores = me?.setor === "SEO"   || me?.setor === "ADMIN";
  const canImportContratos   = me?.setor === "SCON"  || me?.setor === "ADMIN";
  const canImportProcessos   = me?.setor === "SLIC"  || me?.setor === "ADMIN";

  const canAnswer = useMemo(() => reply.trim().length > 0 && !saving && !!active, [reply, saving, active]);

  const [filtroTicket, setFiltroTicket] = useState<"todos" | "open" | "answered">("todos");
  const [prestacaoSubTab, setPrestacaoSubTab] = useState<"SCON" | "SLIC">("SCON");

  const ticketsFiltrados = useMemo(
    () => filtroTicket === "todos" ? tickets : tickets.filter((t) => t.status === filtroTicket),
    [tickets, filtroTicket]
  );

  useEffect(() => {
    (async () => {
      setLoading(true);
      setErr(null);

      const { data: sess } = await supabase.auth.getSession();
      const uid = sess.session?.user.id;
      if (!uid) {
        setLoading(false);
        setErr("Sessão inválida. Faça login novamente.");
        return;
      }

      const { data: prof, error: e1 } = await supabase
        .from("profiles")
        .select("id, nome_guerra, email, setor")
        .eq("id", uid)
        .maybeSingle();

      if (e1) {
        setLoading(false);
        setErr(e1.message);
        return;
      }

      const raw = (prof ?? null) as any;
      const p: Profile | null = raw
        ? { ...raw, setor: raw.setor?.toUpperCase() ?? null }
        : null;
      setMe(p);

      // Carrega tickets apenas para agentes (usado se a aba inbox for reativada)
      if (p && isAgent(p)) {
        const q = supabase
          .from("help_tickets")
          .select("id, created_at, user_id, nome_guerra, email, unidade, setor, mensagem, status, resposta, respondido_em, responded_by")
          .order("created_at", { ascending: false });
        const { data, error: e2 } = p.setor === "ADMIN" ? await q : await q.eq("setor", p.setor!);
        if (e2) setErr(e2.message);
        else setTickets((data as any) ?? []);
      }

      setLoading(false);
    })();
  }, []);

  async function refresh() {
    if (!me || !isAgent(me)) return;

    setErr(null);
    setLoading(true);

    const q = supabase
      .from("help_tickets")
      .select("id, created_at, user_id, nome_guerra, email, unidade, setor, mensagem, status, resposta, respondido_em, responded_by")
      .order("created_at", { ascending: false });

    const { data, error } =
      me.setor === "ADMIN"
        ? await q
        : await q.eq("setor", me.setor as any);

    if (error) setErr(error.message);
    else setTickets((data as any) ?? []);

    // atualiza active
    if (active) {
      const updated = (data as any[])?.find((t) => t.id === active.id);
      if (updated) setActive(updated);
    }

    setLoading(false);
  }

  async function answerTicket() {
    if (!active || !canAnswer) return;

    setSaving(true);
    setErr(null);

    try {
      const { data: sess } = await supabase.auth.getSession();
      const uid = sess.session?.user.id;
      if (!uid) throw new Error("Sessão inválida.");

      const payload = {
        resposta: reply.trim(),
        status: "answered" as TicketStatus,
        responded_by: uid,
        respondido_em: new Date().toISOString(),
      };

      const { error } = await supabase.from("help_tickets").update(payload).eq("id", active.id);
      if (error) throw error;

      setReply("");
      await refresh();
    } catch (e: any) {
      setErr(e?.message ?? "Não foi possível responder.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4">
      <Card>
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-lg font-semibold text-slate-900">
              {tab === "processos"   ? "Processos"
                : tab === "prestacao"   ? "Prestação de Contas"
                : tab === "contratos"   ? "Contratos"
                : "Indicadores de Lotação"}
            </div>
            <div className="text-sm text-slate-600">
              {me?.setor === "ADMIN" ? "Chefe do GAP" : `Setor: ${formatSetor(me?.setor)}`}
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => nav("/app")}
              className="rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50"
            >
              ← Início
            </button>
            <button
              onClick={async () => { await supabase.auth.signOut(); nav("/login"); }}
              className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 hover:bg-red-100"
            >
              Sair
            </button>
          </div>
        </div>

        {/* Abas */}
        {showAnyExtraTab && (
          <div className="mt-3 flex flex-wrap gap-1 border-b border-slate-200">
            {(["contratos", "processos", "indicadores", ...(showPrestacaoTab ? ["prestacao" as const] : [])] as const).map((t) => {
              const labels: Record<string, string> = {
                indicadores: "Indicadores de Lotação",
                contratos:   "Contratos",
                processos:   "Processos",
                prestacao:   "Prestação de Contas",
              };
              return (
                <button
                  key={t}
                  onClick={() => setTab(t)}
                  className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                    tab === t
                      ? "border-sky-600 text-sky-700"
                      : "border-transparent text-slate-500 hover:text-slate-700"
                  }`}
                >
                  {labels[t]}
                </button>
              );
            })}
          </div>
        )}

        {err && (
          <div className="mt-3 rounded-xl border border-red-200 bg-red-50 p-2 text-sm text-red-700">
            {err}
          </div>
        )}
      </Card>

      {/* Conteúdo da aba Indicadores de Lotação */}
      {tab === "indicadores" && (
        <IndicadoresLotacao canImport={canImportIndicadores} />
      )}

      {/* Conteúdo da aba Gerenciamento de Processos */}
      {tab === "processos" && <GerenciamentoProcessos canImport={canImportProcessos} />}

      {/* Conteúdo da aba Gerenciamento de Contratos */}
      {tab === "contratos" && <GerenciamentoContratos canImport={canImportContratos} />}

      {/* Conteúdo da aba Prestação de Contas */}
      {tab === "prestacao" && showPrestacaoTab && (
        me?.setor === "ADMIN" ? (
          <div className="space-y-3">
            <div className="flex gap-2 border-b border-slate-200 pb-0">
              {(["SCON", "SLIC"] as const).map((s) => (
                <button
                  key={s}
                  onClick={() => setPrestacaoSubTab(s)}
                  className={`px-5 py-2 text-sm font-medium border-b-2 transition-colors ${
                    prestacaoSubTab === s
                      ? "border-sky-600 text-sky-700"
                      : "border-transparent text-slate-500 hover:text-slate-700"
                  }`}
                >
                  {s === "SCON" ? "Contratos (SCON)" : "Processos (SLIC)"}
                </button>
              ))}
            </div>
            <PainelDashboard setor={prestacaoSubTab} isAdmin={false} />
          </div>
        ) : (
          <PainelDashboard setor={me?.setor ?? null} isAdmin={false} />
        )
      )}

      {/* Aba Inbox removida — restaurar pelo git (branch main) se necessário */}
    </div>
  );
}
