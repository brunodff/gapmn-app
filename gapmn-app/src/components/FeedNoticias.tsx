import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";

type FeedItem = {
  id: string;
  titulo: string;
  descricao: string | null;
  tipo: string;
  link_tab: string | null;
  created_at: string;
};

type UserNotif = {
  id: string;
  tipo: string;
  ref_id: string;
  ref_label: string | null;
  mensagem: string;
  lida: boolean;
  created_at: string;
};

const TIPO_ICONS: Record<string, string> = {
  contrato:    "📋",
  contratos:   "📋",
  processo:    "⚖️",
  processos:   "⚖️",
  empenho:     "💰",
  empenhos:    "💰",
  indicador:   "📊",
  indicadores: "📊",
  solicitacao: "📥",
  geral:       "📢",
};

function fmtRelDate(d: string) {
  const diff = Date.now() - new Date(d).getTime();
  const mins  = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days  = Math.floor(diff / 86400000);
  if (mins  <  1) return "agora";
  if (mins  < 60) return `há ${mins} min`;
  if (hours < 24) return `há ${hours}h`;
  if (days  <  2) return "ontem";
  if (days  <  7) return `há ${days} dias`;
  const dt = new Date(d);
  return dt.toLocaleDateString("pt-BR") + " " + dt.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}

interface Props {
  isLoggedIn: boolean;
  onNavigate?: (tab: string) => void;
  canCreate?: boolean;
}

export default function FeedNoticias({ isLoggedIn, onNavigate, canCreate }: Props) {
  const [modo,     setModo]     = useState<"geral" | "meus">("geral");
  const [items,    setItems]    = useState<FeedItem[]>([]);
  const [notifs,   setNotifs]   = useState<UserNotif[]>([]);
  const [loading,  setLoading]  = useState(true);
  const [userId,   setUserId]   = useState<string | null>(null);
  const [unread,   setUnread]   = useState(0);

  // Form de criação
  const [showForm, setShowForm] = useState(false);
  const [fTitulo,  setFTitulo]  = useState("");
  const [fDesc,    setFDesc]    = useState("");
  const [fTipo,    setFTipo]    = useState("geral");
  const [fTab,     setFTab]     = useState("");
  const [saving,   setSaving]   = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setUserId(data.session?.user.id ?? null);
    });
  }, []);

  useEffect(() => { loadFeed(); }, []);
  useEffect(() => { if (isLoggedIn && userId) loadNotifs(userId); }, [userId, isLoggedIn]);

  async function loadFeed() {
    const { data } = await supabase
      .from("feed_items")
      .select("id,titulo,descricao,tipo,link_tab,created_at")
      .order("created_at", { ascending: false })
      .limit(15);
    setItems(data ?? []);
    setLoading(false);
  }

  async function loadNotifs(uid: string) {
    const { data } = await supabase
      .from("user_notifications")
      .select("id,tipo,ref_id,ref_label,mensagem,lida,created_at")
      .eq("user_id", uid)
      .order("created_at", { ascending: false })
      .limit(30);
    const list = data ?? [];
    setNotifs(list);
    setUnread(list.filter((n) => !n.lida).length);
  }

  async function marcarLidas() {
    if (!userId) return;
    await supabase
      .from("user_notifications")
      .update({ lida: true })
      .eq("user_id", userId)
      .eq("lida", false);
    setNotifs((prev) => prev.map((n) => ({ ...n, lida: true })));
    setUnread(0);
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!fTitulo.trim()) return;
    setSaving(true);
    const { data: sess } = await supabase.auth.getSession();
    await supabase.from("feed_items").insert({
      titulo: fTitulo.trim(), descricao: fDesc.trim() || null,
      tipo: fTipo, link_tab: fTab.trim() || null,
      created_by: sess.session?.user.id,
    });
    setFTitulo(""); setFDesc(""); setFTipo("geral"); setFTab("");
    setShowForm(false);
    setSaving(false);
    loadFeed();
  }

  async function handleDelete(id: string) {
    await supabase.from("feed_items").delete().eq("id", id);
    setItems((prev) => prev.filter((i) => i.id !== id));
  }

  const tipoLink: Record<string, string> = {
    contrato: "contratos", processo: "processos",
    empenho: "empenhos",  indicador: "indicadores",
  };

  return (
    <div className="space-y-3">
      {/* Cabeçalho + toggle */}
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <h3 className="text-sm font-semibold text-slate-700">Atualizações</h3>

        {isLoggedIn && (
          <div className="flex items-center gap-1 rounded-xl border border-slate-200 bg-slate-50 p-0.5 text-xs">
            <button
              onClick={() => setModo("geral")}
              className={`rounded-lg px-2.5 py-1 transition-colors ${
                modo === "geral" ? "bg-white shadow-sm font-medium text-slate-800" : "text-slate-500 hover:text-slate-700"
              }`}
            >
              Todas
            </button>
            <button
              onClick={() => { setModo("meus"); if (unread > 0) marcarLidas(); }}
              className={`relative rounded-lg px-2.5 py-1 transition-colors ${
                modo === "meus" ? "bg-white shadow-sm font-medium text-slate-800" : "text-slate-500 hover:text-slate-700"
              }`}
            >
              Meus acompanhamentos
              {unread > 0 && (
                <span className="ml-1.5 inline-flex h-4 min-w-[1rem] items-center justify-center rounded-full bg-sky-500 px-1 text-[10px] font-bold text-white">
                  {unread}
                </span>
              )}
            </button>
          </div>
        )}

        {canCreate && modo === "geral" && (
          <button
            onClick={() => setShowForm((v) => !v)}
            className="text-xs text-sky-600 hover:text-sky-800 font-medium border border-sky-200 rounded-lg px-2 py-0.5"
          >
            {showForm ? "Cancelar" : "+ Nova"}
          </button>
        )}
      </div>

      {/* Form criação */}
      {showForm && canCreate && modo === "geral" && (
        <form onSubmit={handleCreate} className="rounded-xl border border-slate-200 bg-white p-3 space-y-2 text-xs">
          <input value={fTitulo} onChange={(e) => setFTitulo(e.target.value)}
            placeholder="Título*" required
            className="w-full rounded-lg border px-2 py-1.5 outline-none focus:ring-1 focus:ring-sky-200" />
          <input value={fDesc} onChange={(e) => setFDesc(e.target.value)}
            placeholder="Descrição (opcional)"
            className="w-full rounded-lg border px-2 py-1.5 outline-none focus:ring-1 focus:ring-sky-200" />
          <div className="flex gap-2">
            <select value={fTipo} onChange={(e) => setFTipo(e.target.value)}
              className="flex-1 rounded-lg border px-2 py-1.5 outline-none">
              <option value="geral">Geral</option>
              <option value="contratos">Contratos</option>
              <option value="processos">Processos</option>
              <option value="empenhos">Empenhos</option>
              <option value="indicadores">Indicadores</option>
            </select>
            <select value={fTab} onChange={(e) => setFTab(e.target.value)}
              className="flex-1 rounded-lg border px-2 py-1.5 outline-none">
              <option value="">Sem link</option>
              <option value="contratos">→ Contratos</option>
              <option value="processos">→ Processos</option>
              <option value="indicadores">→ Indicadores</option>
              <option value="empenhos">→ Empenhos</option>
            </select>
          </div>
          <button disabled={saving}
            className="w-full rounded-lg bg-sky-600 text-white py-1.5 font-medium hover:bg-sky-700 disabled:opacity-60">
            {saving ? "Publicando..." : "Publicar"}
          </button>
        </form>
      )}

      {/* Lista — Feed geral */}
      {modo === "geral" && (
        loading ? (
          <div className="text-xs text-slate-400 animate-pulse py-2">Carregando...</div>
        ) : items.length === 0 ? (
          <div className="text-xs text-slate-400 py-2">Nenhuma atualização recente.</div>
        ) : (
          <div className="space-y-2">
            {items.map((item) => (
              <div key={item.id} className="rounded-xl border border-slate-100 bg-white p-3 shadow-sm hover:border-slate-200 transition-colors">
                <div className="flex items-start gap-2.5">
                  <div className={`shrink-0 w-8 h-8 rounded-full flex items-center justify-center text-sm ${
                    item.tipo === "contratos"   ? "bg-sky-100"    :
                    item.tipo === "processos"   ? "bg-violet-100" :
                    item.tipo === "empenhos"    ? "bg-emerald-100":
                    item.tipo === "indicadores" ? "bg-amber-100"  : "bg-slate-100"
                  }`}>
                    {TIPO_ICONS[item.tipo] ?? "📢"}
                  </div>
                  <div className="flex-1 min-w-0">
                    {item.titulo.split("\n").map((line, i) => (
                      <div key={i} className={`break-words leading-snug ${i === 0 ? "text-sm font-medium text-slate-800" : "text-xs text-slate-600 mt-0.5"}`}>
                        {line}
                      </div>
                    ))}
                    {item.descricao && (
                      isLoggedIn
                        ? <div className="text-xs text-slate-500 mt-0.5 break-words">{item.descricao}</div>
                        : <div className="text-xs text-slate-400 mt-0.5 italic">Faça login para ver os detalhes</div>
                    )}
                    <div className="flex items-center justify-between mt-1.5 gap-2">
                      <time className="text-[11px] text-slate-400" title={new Date(item.created_at).toLocaleString("pt-BR")}>
                        {fmtRelDate(item.created_at)}
                      </time>
                      <div className="flex items-center gap-2">
                        {item.link_tab && (
                          <button
                            onClick={() => {
                              if (!isLoggedIn) document.getElementById("login-form")?.scrollIntoView({ behavior: "smooth" });
                              else onNavigate?.(item.link_tab!);
                            }}
                            className="text-xs text-sky-600 hover:text-sky-800 font-medium whitespace-nowrap"
                          >
                            {isLoggedIn ? "Ver →" : "Entrar →"}
                          </button>
                        )}
                        {canCreate && (
                          <button onClick={() => handleDelete(item.id)}
                            className="text-xs text-red-300 hover:text-red-500" title="Remover">✕</button>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )
      )}

      {/* Lista — Meus acompanhamentos */}
      {modo === "meus" && (
        notifs.length === 0 ? (
          <div className="text-xs text-slate-400 py-4 text-center">
            Nenhuma alteração nos seus acompanhamentos ainda.<br />
            <span className="text-[11px]">Quando um item que você acompanha for atualizado, aparecerá aqui.</span>
          </div>
        ) : (
          <div className="space-y-2">
            {notifs.map((n) => (
              <div key={n.id} className={`rounded-xl border p-3 shadow-sm transition-colors ${n.lida ? "bg-white border-slate-100" : "bg-sky-50 border-sky-200"}`}>
                <div className="flex items-start gap-2.5">
                  <div className={`shrink-0 w-8 h-8 rounded-full flex items-center justify-center text-sm ${
                    n.tipo === "contrato"  ? "bg-sky-100"    :
                    n.tipo === "processo"  ? "bg-violet-100" :
                    n.tipo === "empenho"   ? "bg-emerald-100":
                    n.tipo === "indicador" ? "bg-amber-100"  : "bg-slate-100"
                  }`}>
                    {TIPO_ICONS[n.tipo] ?? "🔔"}
                    {!n.lida && <span className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-sky-500" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    {n.mensagem.split("\n").map((line, i) => (
                      <div key={i} className={`break-words leading-snug ${
                        i === 0
                          ? n.lida ? "text-sm text-slate-700" : "text-sm font-medium text-slate-900"
                          : "text-xs text-slate-600 mt-0.5"
                      }`}>
                        {line}
                      </div>
                    ))}
                    <div className="flex items-center justify-between mt-1.5 gap-2">
                      <time className="text-[11px] text-slate-400" title={new Date(n.created_at).toLocaleString("pt-BR")}>
                        {fmtRelDate(n.created_at)}
                      </time>
                      {tipoLink[n.tipo] && isLoggedIn && (
                        <button
                          onClick={() => onNavigate?.(tipoLink[n.tipo])}
                          className="text-xs text-sky-600 hover:text-sky-800 font-medium whitespace-nowrap"
                        >
                          Ver →
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )
      )}
    </div>
  );
}
