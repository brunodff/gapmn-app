import { useEffect, useState, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabase";
import { Card } from "../components/Card";

type Tipo = "contrato" | "processo" | "empenho" | "indicador" | "solicitacao";

type Acomp = {
  id: string;
  tipo: Tipo;
  ref_id: string;
  ref_label: string | null;
  is_fiscal: boolean;
  detail?: Record<string, any>;
};

type SearchResult = {
  ref_id: string;
  ref_label: string;
  detail?: Record<string, any>;
};

const TIPO_LABELS: Record<Tipo, string> = {
  contrato:    "Contratos",
  processo:    "Processos",
  empenho:     "Empenhos",
  indicador:   "Indicadores de Lotação",
  solicitacao: "Solicitações SILOMS",
};

const TIPO_ICONS: Record<Tipo, string> = {
  contrato:    "📋",
  processo:    "⚖️",
  empenho:     "💰",
  indicador:   "📊",
  solicitacao: "📩",
};

function fmtMoney(v: number | null | undefined) {
  if (v == null) return "–";
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(v);
}

async function searchItems(tipo: Tipo, q: string): Promise<SearchResult[]> {
  const term = q.trim().toLowerCase();
  if (!term) return [];

  if (tipo === "contrato") {
    const { data } = await supabase
      .from("contratos_scon")
      .select("id, numero_contrato, descricao, fornecedor, status, data_final, saldo, vl_a_empenhar, fiscal")
      .or(`numero_contrato.ilike.%${term}%,descricao.ilike.%${term}%,fornecedor.ilike.%${term}%`)
      .limit(10);
    return (data ?? []).map((r: any) => ({
      ref_id:    r.id,
      ref_label: `${r.numero_contrato} – ${r.fornecedor ?? r.descricao ?? ""}`.trim(),
      detail:    r,
    }));
  }

  if (tipo === "processo") {
    const { data } = await supabase
      .from("processos_licitatorios")
      .select("id, numero_processo, objeto, modalidade, situacao_api, valor_estimado, valor_homologado, ano")
      .or(`numero_processo.ilike.%${term}%,objeto.ilike.%${term}%`)
      .limit(10);
    return (data ?? []).map((r: any) => ({
      ref_id:    r.id,
      ref_label: `${r.modalidade ?? ""} ${r.numero_processo ?? ""} – ${(r.objeto ?? "").slice(0, 80)}`.trim(),
      detail:    r,
    }));
  }

  if (tipo === "empenho") {
    const { data } = await supabase
      .from("empenhos_seo")
      .select("id, empenho, contrato, valor, liquidado, saldo_emp")
      .or(`empenho.ilike.%${term}%,contrato.ilike.%${term}%`)
      .limit(10);
    return (data ?? []).map((r: any) => ({
      ref_id:    r.id,
      ref_label: `${r.empenho ?? ""}${r.contrato ? ` · ${r.contrato}` : ""}`,
      detail:    r,
    }));
  }

  if (tipo === "indicador") {
    const { data } = await supabase
      .from("indicadores_lotacao")
      .select("id, conta_corrente, descricao, natureza, acao, ug_cred, dotacao, utilizacao, saldo")
      .or(`conta_corrente.ilike.%${term}%,natureza.ilike.%${term}%,acao.ilike.%${term}%,descricao.ilike.%${term}%`)
      .limit(10);
    return (data ?? []).map((r: any) => ({
      ref_id:    r.id,
      ref_label: `${r.conta_corrente ?? ""} – ${r.descricao ?? r.natureza ?? ""}`.trim(),
      detail:    r,
    }));
  }

  if (tipo === "solicitacao") {
    const { data } = await supabase
      .from("siloms_solicitacoes_empenho")
      .select("solicitacao, status, responsavel, subprocesso, empenho_siafi, ug_cred, valor")
      .or(`solicitacao.ilike.%${term}%,responsavel.ilike.%${term}%,subprocesso.ilike.%${term}%`)
      .limit(15);
    return (data ?? []).map((r: any) => ({
      ref_id:    r.solicitacao,
      ref_label: `${r.solicitacao}${r.responsavel ? ` · ${r.responsavel}` : ""}${r.subprocesso ? ` · ${r.subprocesso}` : ""}`,
      detail:    r,
    }));
  }

  return [];
}

function DetalheIndicador({ d }: { d: Record<string, any> }) {
  return (
    <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-0.5 text-xs text-slate-600 border-t border-slate-100 pt-2">
      <div><span className="font-medium">Conta Corrente:</span> {d.conta_corrente ?? "–"}</div>
      <div><span className="font-medium">UG Cred:</span> {d.ug_cred ?? "–"}</div>
      <div><span className="font-medium">Natureza:</span> {d.natureza ?? "–"}</div>
      <div><span className="font-medium">Ação:</span> {d.acao ?? "–"}</div>
      <div><span className="font-medium">Dotação:</span> {fmtMoney(d.dotacao)}</div>
      <div><span className="font-medium">Utilização:</span> {fmtMoney(d.utilizacao)}</div>
      <div className="col-span-2"><span className="font-medium">Saldo:</span> {fmtMoney(d.saldo)}</div>
    </div>
  );
}

function DetalheContrato({ d }: { d: Record<string, any> }) {
  return (
    <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-0.5 text-xs text-slate-600 border-t border-slate-100 pt-2">
      <div><span className="font-medium">Status:</span> {d.status ?? "–"}</div>
      <div><span className="font-medium">Vigência:</span> {d.data_final ? new Date(d.data_final + "T12:00:00").toLocaleDateString("pt-BR") : "–"}</div>
      <div><span className="font-medium">A empenhar:</span> {fmtMoney(d.vl_a_empenhar)}</div>
      <div><span className="font-medium">A liquidar:</span> {fmtMoney(d.saldo)}</div>
      {d.fiscal && <div className="col-span-2"><span className="font-medium">Fiscal:</span> {d.fiscal}</div>}
    </div>
  );
}

function DetalheProcesso({ d }: { d: Record<string, any> }) {
  return (
    <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-0.5 text-xs text-slate-600 border-t border-slate-100 pt-2">
      <div><span className="font-medium">Modalidade:</span> {d.modalidade ?? "–"}</div>
      <div><span className="font-medium">Ano:</span> {d.ano ?? "–"}</div>
      <div><span className="font-medium">Situação:</span> {d.situacao_api ?? "–"}</div>
      <div><span className="font-medium">Vl. Estimado:</span> {fmtMoney(d.valor_estimado)}</div>
      {d.valor_homologado != null && (
        <div className="col-span-2"><span className="font-medium">Vl. Homologado:</span> {fmtMoney(d.valor_homologado)}</div>
      )}
      <div className="col-span-2 break-words"><span className="font-medium">Objeto:</span> {d.objeto ?? "–"}</div>
    </div>
  );
}

export default function MeusAcompanhamentos() {
  const nav = useNavigate();
  const [userId,   setUserId]   = useState<string | null>(null);
  const [nomeUser, setNomeUser] = useState("");
  const [acomps,   setAcomps]   = useState<Acomp[]>([]);
  const [tab,      setTab]      = useState<Tipo>("contrato");
  const [loading,  setLoading]  = useState(true);
  const [expanded, setExpanded] = useState<string | null>(null);

  // Busca
  const [query,     setQuery]     = useState("");
  const [results,   setResults]   = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);

  useEffect(() => {
    (async () => {
      const { data: sess } = await supabase.auth.getSession();
      const user = sess.session?.user;
      if (!user) return;
      setUserId(user.id);

      const { data: prof } = await supabase
        .from("profiles").select("nome_guerra").eq("id", user.id).maybeSingle();
      const nome = (prof as any)?.nome_guerra ?? "";
      setNomeUser(nome);

      await loadAcomps(user.id, nome);
    })();
  }, []);

  async function loadAcomps(uid: string, nome: string) {
    setLoading(true);

    const { data: rows } = await supabase
      .from("user_acompanhamentos")
      .select("id, tipo, ref_id, ref_label, is_fiscal")
      .eq("user_id", uid)
      .order("created_at", { ascending: false });

    const saved: Acomp[] = (rows ?? []).map((r: any) => ({
      id: r.id, tipo: r.tipo, ref_id: r.ref_id,
      ref_label: r.ref_label, is_fiscal: r.is_fiscal,
    }));

    // Auto-populate contratos onde é fiscal
    if (nome) {
      const { data: fiscais } = await supabase
        .from("contratos_scon")
        .select("id, numero_contrato, descricao, fornecedor, status, data_final, saldo, vl_a_empenhar, fiscal")
        .ilike("fiscal", `%${nome}%`);

      for (const c of fiscais ?? []) {
        const already = saved.find((a) => a.tipo === "contrato" && a.ref_id === c.id);
        if (!already) {
          saved.push({
            id:        `fiscal-${c.id}`,
            tipo:      "contrato",
            ref_id:    c.id,
            ref_label: `${c.numero_contrato} – ${c.fornecedor ?? c.descricao ?? ""}`.trim(),
            is_fiscal: true,
            detail:    c,
          });
        }
      }
    }

    setAcomps(saved);
    setLoading(false);
  }

  // Busca com debounce
  useEffect(() => {
    if (!query.trim()) { setResults([]); return; }
    const t = setTimeout(async () => {
      setSearching(true);
      const res = await searchItems(tab, query);
      const ids = new Set(acomps.filter((a) => a.tipo === tab).map((a) => a.ref_id));
      setResults(res.filter((r) => !ids.has(r.ref_id)));
      setSearching(false);
    }, 400);
    return () => clearTimeout(t);
  }, [query, tab, acomps]);

  async function addAcomp(item: SearchResult, isFiscal = false) {
    if (!userId) return;
    const { data, error } = await supabase.from("user_acompanhamentos").insert({
      user_id:   userId,
      tipo:      tab,
      ref_id:    item.ref_id,
      ref_label: item.ref_label,
      is_fiscal: isFiscal,
    }).select().maybeSingle();
    if (!error && data) {
      setAcomps((prev) => [{
        id: (data as any).id, tipo: tab,
        ref_id: item.ref_id, ref_label: item.ref_label,
        is_fiscal: isFiscal, detail: item.detail,
      }, ...prev]);
      setQuery(""); setResults([]);
    }
  }

  async function toggleFiscal(a: Acomp) {
    if (a.id.startsWith("fiscal-")) return;
    await supabase.from("user_acompanhamentos").update({ is_fiscal: !a.is_fiscal }).eq("id", a.id);
    setAcomps((prev) => prev.map((x) => x.id === a.id ? { ...x, is_fiscal: !x.is_fiscal } : x));
  }

  async function removeAcomp(a: Acomp) {
    if (a.id.startsWith("fiscal-")) return;
    await supabase.from("user_acompanhamentos").delete().eq("id", a.id);
    setAcomps((prev) => prev.filter((x) => x.id !== a.id));
  }

  const tabItems = useMemo(() => acomps.filter((a) => a.tipo === tab), [acomps, tab]);

  return (
    <div className="space-y-4">
      {/* Header */}
      <Card>
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-base font-semibold text-slate-900">Meus Acompanhamentos</h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Associe-se a contratos, processos e outros itens para ser notificado quando atualizados.
            </p>
          </div>
          <button
            onClick={() => nav("/app")}
            className="text-xs text-slate-500 hover:text-slate-700 border border-slate-200 rounded-lg px-3 py-1.5"
          >
            ← Voltar
          </button>
        </div>

        <div className="flex flex-wrap gap-1 mt-4 border-b border-slate-200">
          {(["contrato", "processo", "empenho", "indicador", "solicitacao"] as Tipo[]).map((t) => (
            <button
              key={t}
              onClick={() => { setTab(t); setQuery(""); setResults([]); setExpanded(null); }}
              className={`px-3 py-2 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
                tab === t
                  ? "border-sky-600 text-sky-700"
                  : "border-transparent text-slate-500 hover:text-slate-700"
              }`}
            >
              {TIPO_ICONS[t]} {TIPO_LABELS[t]}
            </button>
          ))}
        </div>
      </Card>

      {/* Busca + lista */}
      <Card>
        <div className="mb-4">
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={`Buscar ${TIPO_LABELS[tab].toLowerCase()} para acompanhar...`}
            className="w-full rounded-xl border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-sky-200"
          />
          {searching && <div className="text-xs text-slate-400 mt-1 animate-pulse">Buscando...</div>}

          {results.length > 0 && (
            <div className="mt-2 space-y-1">
              {results.map((r) => (
                <div key={r.ref_id} className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
                  <div className="flex items-start justify-between gap-2">
                    <span className="text-sm text-slate-700 break-words flex-1">{r.ref_label}</span>
                    <div className="flex items-center gap-2 shrink-0">
                      {tab === "contrato" && (
                        <button
                          onClick={() => addAcomp(r, true)}
                          className="text-xs text-amber-600 border border-amber-200 rounded-lg px-2 py-0.5 hover:bg-amber-50 whitespace-nowrap"
                        >
                          + Sou fiscal
                        </button>
                      )}
                      <button
                        onClick={() => addAcomp(r, false)}
                        className="text-xs text-sky-600 border border-sky-200 rounded-lg px-2 py-0.5 hover:bg-sky-50 whitespace-nowrap"
                      >
                        + Acompanhar
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {loading ? (
          <div className="text-sm text-slate-400 animate-pulse">Carregando...</div>
        ) : tabItems.length === 0 ? (
          <div className="text-sm text-slate-400 py-4 text-center">
            Nenhum item acompanhado nessa categoria.<br />
            <span className="text-xs">Use o campo acima para buscar e adicionar.</span>
          </div>
        ) : (
          <div className="space-y-2">
            {tabItems.map((a) => {
              const isAutoFiscal = a.id.startsWith("fiscal-");
              const isExp = expanded === a.id;
              return (
                <div key={a.id} className="rounded-xl border border-slate-100 bg-white shadow-sm overflow-hidden">
                  <button
                    className="w-full flex items-start gap-2 px-3 py-2.5 text-left hover:bg-slate-50 transition-colors"
                    onClick={() => setExpanded(isExp ? null : a.id)}
                  >
                    <span className="text-base shrink-0 mt-0.5">{TIPO_ICONS[a.tipo]}</span>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm text-slate-800 break-words leading-snug">{a.ref_label ?? a.ref_id}</div>
                      <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                        {a.is_fiscal && (
                          <span className="rounded-full bg-amber-50 border border-amber-200 px-2 text-[10px] font-medium text-amber-700">
                            Fiscal do contrato
                          </span>
                        )}
                        {isAutoFiscal && (
                          <span className="rounded-full bg-slate-100 px-2 text-[10px] text-slate-500">
                            detectado automaticamente
                          </span>
                        )}
                      </div>
                    </div>
                    <span className="text-slate-400 text-xs shrink-0 mt-1">{isExp ? "▲" : "▼"}</span>
                  </button>

                  {/* Detalhes expandidos */}
                  {isExp && a.detail && (
                    <div className="px-3 pb-3">
                      {a.tipo === "indicador" && <DetalheIndicador d={a.detail} />}
                      {a.tipo === "contrato"  && <DetalheContrato  d={a.detail} />}
                      {a.tipo === "processo"  && <DetalheProcesso  d={a.detail} />}

                      {!isAutoFiscal && (
                        <div className="flex items-center gap-2 mt-3 flex-wrap">
                          {a.tipo === "contrato" && (
                            <button
                              onClick={() => toggleFiscal(a)}
                              className={`text-xs border rounded-lg px-2 py-0.5 ${
                                a.is_fiscal
                                  ? "border-amber-300 text-amber-700 bg-amber-50 hover:bg-amber-100"
                                  : "border-slate-200 text-slate-500 hover:bg-slate-50"
                              }`}
                            >
                              {a.is_fiscal ? "Fiscal ✓" : "Sou fiscal"}
                            </button>
                          )}
                          <button
                            onClick={() => removeAcomp(a)}
                            className="text-xs text-red-400 hover:text-red-600 border border-red-100 rounded-lg px-2 py-0.5"
                          >
                            Remover acompanhamento
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </Card>

      <Card>
        <div className="flex items-start gap-2 text-xs text-slate-500">
          <span className="text-base">🔔</span>
          <div>
            <div className="font-medium text-slate-700">Como funcionam as notificações</div>
            <div className="mt-0.5">
              Quando qualquer item acompanhado for atualizado no sistema, você verá a alteração no feed
              principal selecionando <strong>"Meus acompanhamentos"</strong>. Ative as notificações do
              navegador na tela inicial para receber alertas em tempo real.
            </div>
          </div>
        </div>
      </Card>
    </div>
  );
}
