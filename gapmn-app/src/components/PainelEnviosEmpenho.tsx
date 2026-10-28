// Painel dos e-mails ao fiscal (solicitações de empenho): o envio é automático (função
// auto-solicitacoes-empenho, a cada 15 minutos) e aqui se acompanha o que saiu, para quem, por dia,
// quem mais recebe, as falhas e cada verificação automática.
// Os envios vêm das próprias solicitações (data do e-mail de emitida e de assinada), que guardam todo
// o histórico; o log de e-mails (notificacoes_empenho_log) entra só para as falhas.

import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { supabase } from "../lib/supabase";

type TipoEnvio = "EMITIDA" | "ASSINADA";

type Sol = {
  id: string;
  numero: string;
  responsavel: string | null;
  email: string | null;
  status: string;
  ne_siafi: string | null;
  fornecedor: string | null;
  valor: number | null;
  nd: string | null;
  pag: string | null;
  subprocesso: string | null;
  notificado_emitida_em: string | null;
  notificado_assinada_em: string | null;
  sem_destinatario: boolean;
  notificacao_ativa: boolean;
  data_emissao: string | null;
  revisado_em: string | null;
  pdf_ne_url: string | null;
};

type Falha = { id: string; solicitacao_id: string | null; tipo: string; email_destino: string; enviado_em: string; erro: string | null };

type ItemExecucao = { numero: string; ne: string; tipo: TipoEnvio; nova: boolean; email: string | null; resultado: string; motivo: string | null };
type Execucao = {
  id: number; executado_em: string; origem: string; duracao_ms: number | null; nes_lidas: number; novas: number; atualizadas: number;
  enviados: number; sem_email: number; inativas: number; erros: number; itens: ItemExecucao[]; erro: string | null;
};

type Envio = { chave: string; em: string; dia: string; tipo: TipoEnvio; sol: Sol };

const FUSO = "America/Manaus";
const diaDe = (iso: string) => new Date(iso).toLocaleDateString("sv-SE", { timeZone: FUSO });
const hojeManaus = () => diaDe(new Date().toISOString());
const somarDias = (dia: string, n: number) => { const d = new Date(`${dia}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const fmtDia = (dia: string) => `${dia.slice(8, 10)}/${dia.slice(5, 7)}`;
const fmtDataHora = (iso: string) => new Date(iso).toLocaleString("pt-BR", { timeZone: FUSO, day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
const fmtBRL = (v: number | null) => (v ? new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(v) : "—");
const haQuanto = (iso: string) => {
  const min = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  if (min < 1) return "agora";
  if (min < 60) return `há ${min} min`;
  const h = Math.floor(min / 60);
  return h < 24 ? `há ${h} h${min % 60 ? ` ${min % 60} min` : ""}` : `há ${Math.floor(h / 24)} d`;
};
/** Horário em que o agendamento roda: 07:00 às 21:45 de Manaus. */
const dentroDaJanela = (d = new Date()) => { const h = Number(d.toLocaleString("en-US", { timeZone: FUSO, hour: "2-digit", hour12: false })); return h >= 7 && h < 22; };

const COR: Record<TipoEnvio, string> = { EMITIDA: "#0ea5e9", ASSINADA: "#10b981" };
const ROTULO: Record<TipoEnvio, string> = { EMITIDA: "Emitida", ASSINADA: "Assinada" };
const ROTULO_RESULTADO: Record<string, string> = {
  ENVIADO: "Enviado", SEM_EMAIL: "Sem e-mail", NOTIF_INATIVA: "Notificação desligada", ERRO: "Erro", JA_ENVIADO: "Já enviado",
};

/** Lê a tabela inteira, de mil em mil linhas (o limite de cada consulta do Supabase). */
async function lerTudo<T>(tabela: string, colunas: string): Promise<T[]> {
  const linhas: T[] = [];
  for (let de = 0; ; de += 1000) {
    const { data, error } = await supabase.from(tabela).select(colunas).order("id").range(de, de + 999);
    if (error) throw error;
    linhas.push(...((data ?? []) as T[]));
    if (!data || data.length < 1000) return linhas;
  }
}

type Periodo = "hoje" | "7" | "30" | "tudo";

export default function PainelEnviosEmpenho({ podeVerificar, verificando, aoVerificar, atualizacao }: {
  podeVerificar: boolean;
  verificando: boolean;
  aoVerificar: () => void;
  /** Muda quando uma verificação manual termina, para o painel reler. */
  atualizacao: number;
}) {
  const [sols, setSols] = useState<Sol[]>([]);
  const [falhas, setFalhas] = useState<Falha[]>([]);
  const [execs, setExecs] = useState<Execucao[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [periodo, setPeriodo] = useState<Periodo>("7");
  const [tipo, setTipo] = useState<"" | TipoEnvio>("");
  const [busca, setBusca] = useState("");
  const [aberto, setAberto] = useState<string | null>(null);
  const [execAberta, setExecAberta] = useState<number | null>(null);
  const [, setRelogio] = useState(0);

  const carregar = useCallback(async () => {
    try {
      const desde = new Date(Date.now() - 90 * 86_400_000).toISOString();
      const [s, f, e] = await Promise.all([
        lerTudo<Sol>("solicitacoes_empenho",
          "id, numero, responsavel, email, status, ne_siafi, fornecedor, valor, nd, pag, subprocesso, notificado_emitida_em, notificado_assinada_em, sem_destinatario, notificacao_ativa, data_emissao, revisado_em, pdf_ne_url"),
        supabase.from("notificacoes_empenho_log").select("id, solicitacao_id, tipo, email_destino, enviado_em, erro")
          .eq("sucesso", false).gte("enviado_em", desde).order("enviado_em", { ascending: false }).limit(200),
        supabase.from("solicitacoes_auto_execucoes").select("*").order("executado_em", { ascending: false }).limit(40),
      ]);
      setSols(s.map((x) => ({ ...x, valor: x.valor === null ? null : Number(x.valor) })));
      setFalhas((f.data as Falha[]) ?? []);
      // sem a migração aplicada a tabela não existe: o painel abre do mesmo jeito, sem o histórico das execuções
      setExecs(e.error ? [] : ((e.data as Execucao[]) ?? []));
      setErro(null);
    } catch (x) {
      setErro(x instanceof Error ? x.message : "Não foi possível ler os envios.");
    } finally {
      setCarregando(false);
    }
  }, []);

  useEffect(() => { carregar(); }, [carregar, atualizacao]);
  useEffect(() => {
    const t = setInterval(() => { if (document.visibilityState === "visible") carregar(); setRelogio((n) => n + 1); }, 60_000);
    return () => clearInterval(t);
  }, [carregar]);

  const porId = useMemo(() => new Map(sols.map((s) => [s.id, s])), [sols]);

  // cada e-mail enviado: a data fica na própria solicitação
  const envios = useMemo<Envio[]>(() => {
    const lista: Envio[] = [];
    for (const s of sols) {
      if (s.notificado_emitida_em) lista.push({ chave: `${s.id}:E`, em: s.notificado_emitida_em, dia: diaDe(s.notificado_emitida_em), tipo: "EMITIDA", sol: s });
      if (s.notificado_assinada_em) lista.push({ chave: `${s.id}:A`, em: s.notificado_assinada_em, dia: diaDe(s.notificado_assinada_em), tipo: "ASSINADA", sol: s });
    }
    return lista.sort((a, b) => b.em.localeCompare(a.em));
  }, [sols]);

  const hoje = hojeManaus();
  const contar = (desde: string) => envios.filter((e) => e.dia >= desde).length;
  const kpis = {
    hoje: contar(hoje),
    semana: contar(somarDias(hoje, -6)),
    mes: contar(`${hoje.slice(0, 7)}-01`),
    total: envios.length,
    aguardando: sols.filter((s) => s.status === "EMITIDA" && !s.revisado_em).length,
    semEmail: sols.filter((s) => s.sem_destinatario && (s.data_emissao ?? "") >= somarDias(hoje, -30)).length,
    destinatarios: new Set(envios.map((e) => (e.sol.email ?? "").toLowerCase()).filter(Boolean)).size,
  };

  // e-mails por dia, últimos 30 dias (inclusive os dias sem envio)
  const porDia = useMemo(() => {
    const dias = Array.from({ length: 30 }, (_, i) => somarDias(hoje, i - 29));
    const mapa = new Map(dias.map((d) => [d, { dia: fmtDia(d), Emitida: 0, Assinada: 0 }]));
    for (const e of envios) { const m = mapa.get(e.dia); if (m) m[e.tipo === "EMITIDA" ? "Emitida" : "Assinada"]++; }
    return [...mapa.values()];
  }, [envios, hoje]);

  const ranking = useMemo(() => {
    const m = new Map<string, { email: string; nome: string | null; total: number; ultimo: string; emitida: number; assinada: number }>();
    for (const e of envios) {
      const email = (e.sol.email ?? "").toLowerCase();
      if (!email) continue;
      const r = m.get(email) ?? { email, nome: null, total: 0, ultimo: e.em, emitida: 0, assinada: 0 };
      r.total++;
      if (e.tipo === "EMITIDA") r.emitida++; else r.assinada++;
      if (e.em >= r.ultimo) { r.ultimo = e.em; r.nome = e.sol.responsavel ?? r.nome; } else r.nome = r.nome ?? e.sol.responsavel;
      m.set(email, r);
    }
    return [...m.values()].sort((a, b) => b.total - a.total || b.ultimo.localeCompare(a.ultimo)).slice(0, 10);
  }, [envios]);
  const maxRanking = Math.max(1, ...ranking.map((r) => r.total));

  const q = busca.trim().toLowerCase();
  const desdePeriodo = periodo === "hoje" ? hoje : periodo === "7" ? somarDias(hoje, -6) : periodo === "30" ? somarDias(hoje, -29) : "";
  const historico = envios.filter((e) => {
    if (desdePeriodo && e.dia < desdePeriodo) return false;
    if (tipo && e.tipo !== tipo) return false;
    if (q && ![e.sol.numero, e.sol.ne_siafi, e.sol.email, e.sol.responsavel, e.sol.fornecedor].some((v) => (v ?? "").toLowerCase().includes(q))) return false;
    return true;
  });

  // situação do automático
  const ultimaCron = execs.find((x) => x.origem === "cron");
  const ultima = execs[0];
  let estado: { cor: string; texto: string };
  if (!ultimaCron) estado = { cor: "amber", texto: "Aguardando a primeira verificação automática" };
  else if (ultimaCron.erro) estado = { cor: "red", texto: `A última verificação automática falhou: ${ultimaCron.erro}` };
  else if (dentroDaJanela() && Date.now() - new Date(ultimaCron.executado_em).getTime() > 45 * 60_000) estado = { cor: "amber", texto: "Sem verificação automática há mais de 45 minutos" };
  else estado = { cor: "emerald", texto: "Envio automático ligado" };
  const corPonto = estado.cor === "emerald" ? "bg-emerald-500" : estado.cor === "amber" ? "bg-amber-500" : "bg-red-500";

  if (carregando) return <div className="py-10 text-center text-sm text-slate-400">Carregando os envios…</div>;

  return (
    <div className="space-y-4">
      {erro && <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-2.5 text-sm text-red-800">{erro}</div>}

      {/* ── Situação do envio automático ── */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border border-slate-200 bg-white px-4 py-3">
        <span className="flex items-center gap-2 text-sm font-semibold text-slate-800">
          <span className={`inline-block h-2.5 w-2.5 rounded-full ${corPonto}`} aria-hidden="true" />
          {estado.texto}
        </span>
        <span className="text-xs text-slate-500">
          A planilha de empenhos é lida a cada 15 minutos, das 07h às 21h45, todos os dias. E-mail de emitida e de assinada sai sozinho.
        </span>
        {ultima && (
          <span className="text-xs text-slate-600">
            Última verificação: <b>{fmtDataHora(ultima.executado_em)}</b> ({haQuanto(ultima.executado_em)}){ultima.origem === "manual" ? " · manual" : ""}
            {" · "}{ultima.enviados} e-mail(s){ultima.novas ? ` · ${ultima.novas} solicitação(ões) nova(s)` : ""}
          </span>
        )}
        {podeVerificar && (
          <button onClick={aoVerificar} disabled={verificando}
            className="ml-auto rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-60 transition-colors">
            {verificando ? "Verificando…" : "↻ Verificar agora"}
          </button>
        )}
      </div>

      {/* ── Números ── */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {[
          { rot: "E-mails hoje", val: kpis.hoje, dica: "Enviados hoje (horário de Manaus)" },
          { rot: "Últimos 7 dias", val: kpis.semana, dica: "Enviados nos últimos 7 dias, contando hoje" },
          { rot: "No mês", val: kpis.mes, dica: "Enviados desde o dia 1º deste mês" },
          { rot: "Total", val: kpis.total, dica: `Todos os e-mails registrados, para ${kpis.destinatarios} destinatários` },
          { rot: "Aguardando assinatura", val: kpis.aguardando, dica: "Solicitações com empenho emitido e ainda não assinado" },
          { rot: "Sem e-mail (30 dias)", val: kpis.semEmail, dica: "Solicitações dos últimos 30 dias sem e-mail @fab.mil.br na observação da NE" },
        ].map((k) => (
          <div key={k.rot} title={k.dica} className="rounded-xl border border-slate-200 bg-white px-4 py-3">
            <div className="text-[11px] font-medium uppercase tracking-wide text-slate-500">{k.rot}</div>
            <div className="mt-1 text-2xl font-bold tabular-nums text-slate-800">{k.val.toLocaleString("pt-BR")}</div>
          </div>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-5">
        {/* ── Por dia ── */}
        <section className="rounded-xl border border-slate-200 bg-white p-4 lg:col-span-3" aria-label="E-mails por dia">
          <h3 className="mb-3 text-sm font-semibold text-slate-800">E-mails por dia · últimos 30 dias</h3>
          <div style={{ height: 230 }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={porDia} margin={{ top: 4, right: 8, left: -18, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.25)" vertical={false} />
                <XAxis dataKey="dia" tick={{ fontSize: 10, fill: "#94a3b8" }} interval="preserveStartEnd" tickLine={false} />
                <YAxis allowDecimals={false} tick={{ fontSize: 10, fill: "#94a3b8" }} tickLine={false} axisLine={false} />
                <Tooltip cursor={{ fill: "rgba(148,163,184,0.12)" }} contentStyle={{ fontSize: 12, borderRadius: 8 }} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Bar dataKey="Emitida" stackId="a" fill={COR.EMITIDA} />
                <Bar dataKey="Assinada" stackId="a" fill={COR.ASSINADA} radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </section>

        {/* ── Quem mais recebe ── */}
        <section className="rounded-xl border border-slate-200 bg-white p-4 lg:col-span-2" aria-label="Quem mais recebe">
          <h3 className="mb-3 text-sm font-semibold text-slate-800">Quem mais recebe</h3>
          {ranking.length === 0 ? (
            <p className="py-6 text-center text-xs text-slate-400">Nenhum e-mail enviado ainda.</p>
          ) : (
            <ol className="space-y-2">
              {ranking.map((r, i) => (
                <li key={r.email} className="text-xs" title={`${r.emitida} de emitida · ${r.assinada} de assinada · último ${fmtDataHora(r.ultimo)}`}>
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="truncate text-slate-700"><b className="text-slate-500">{i + 1}.</b> {r.nome || r.email}</span>
                    <span className="shrink-0 font-semibold tabular-nums text-slate-800">{r.total}</span>
                  </div>
                  <div className="mt-0.5 flex items-center gap-2">
                    <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-100">
                      <div className="h-full rounded-full" style={{ width: `${(r.total / maxRanking) * 100}%`, background: COR.ASSINADA }} />
                    </div>
                    <span className="w-40 shrink-0 truncate text-[10px] text-slate-400">{r.email}</span>
                  </div>
                </li>
              ))}
            </ol>
          )}
        </section>
      </div>

      {/* ── Histórico ── */}
      <section className="rounded-xl border border-slate-200 bg-white" aria-label="Histórico de envios">
        <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 px-4 py-3">
          <h3 className="mr-auto text-sm font-semibold text-slate-800">Histórico de envios <span className="font-normal text-slate-500">· {historico.length}</span></h3>
          <div className="flex overflow-hidden rounded-lg border border-slate-200 text-xs">
            {([["hoje", "Hoje"], ["7", "7 dias"], ["30", "30 dias"], ["tudo", "Tudo"]] as [Periodo, string][]).map(([v, r]) => (
              <button key={v} onClick={() => setPeriodo(v)}
                className={`px-2.5 py-1 ${periodo === v ? "bg-sky-100 font-semibold text-sky-700" : "text-slate-600 hover:bg-slate-50"}`}>{r}</button>
            ))}
          </div>
          <select value={tipo} onChange={(e) => setTipo(e.target.value as "" | TipoEnvio)}
            className="rounded-lg border border-slate-200 px-2 py-1 text-xs">
            <option value="">Emitida e assinada</option>
            <option value="EMITIDA">Só emitida</option>
            <option value="ASSINADA">Só assinada</option>
          </select>
          <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar solicitação, NE, fiscal ou fornecedor…"
            className="w-60 rounded-lg border border-slate-200 px-2.5 py-1 text-xs" />
        </div>
        {historico.length === 0 ? (
          <p className="py-8 text-center text-xs text-slate-400">Nenhum e-mail neste período.</p>
        ) : (
          <div className="max-h-[460px] overflow-auto">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-slate-50">
                <tr className="border-b border-slate-200 text-left text-slate-500">
                  <th className="px-4 py-2 font-semibold">Enviado em</th>
                  <th className="px-3 py-2 font-semibold">Tipo</th>
                  <th className="px-3 py-2 font-semibold">Solicitação</th>
                  <th className="px-3 py-2 font-semibold">NE</th>
                  <th className="px-3 py-2 font-semibold">Destinatário</th>
                  <th className="px-3 py-2 font-semibold">Fornecedor</th>
                  <th className="px-4 py-2 text-right font-semibold">Valor</th>
                </tr>
              </thead>
              <tbody>
                {historico.slice(0, 500).map((e) => {
                  const abrir = aberto === e.chave;
                  const s = e.sol;
                  return (
                    <Fragment key={e.chave}>
                      <tr onClick={() => setAberto(abrir ? null : e.chave)} aria-expanded={abrir}
                        className="cursor-pointer border-b border-slate-100 hover:bg-slate-50">
                        <td className="whitespace-nowrap px-4 py-2 text-slate-600">{fmtDataHora(e.em)}</td>
                        <td className="px-3 py-2">
                          <span className="rounded-full px-2 py-0.5 text-[11px] font-semibold text-white" style={{ background: COR[e.tipo] }}>{ROTULO[e.tipo]}</span>
                        </td>
                        <td className="px-3 py-2 font-mono font-semibold text-slate-800">{s.numero}</td>
                        <td className="px-3 py-2 font-mono text-slate-600">{s.ne_siafi ?? "—"}</td>
                        <td className="px-3 py-2">
                          <div className="text-slate-700">{s.responsavel ?? "—"}</div>
                          <div className="text-[10px] text-slate-400">{s.email}</div>
                        </td>
                        <td className="max-w-[220px] truncate px-3 py-2 text-slate-600" title={s.fornecedor ?? ""}>{s.fornecedor ?? "—"}</td>
                        <td className="whitespace-nowrap px-4 py-2 text-right tabular-nums text-slate-700">{fmtBRL(s.valor)}</td>
                      </tr>
                      {abrir && (
                        <tr className="border-b border-slate-100 bg-slate-50">
                          <td colSpan={7} className="px-6 py-3">
                            <dl className="grid gap-x-6 gap-y-1.5 text-xs sm:grid-cols-2 lg:grid-cols-4">
                              <div><dt className="text-[10px] uppercase tracking-wide text-slate-400">E-mail de emitida</dt><dd className="text-slate-700">{s.notificado_emitida_em ? fmtDataHora(s.notificado_emitida_em) : "não enviado"}</dd></div>
                              <div><dt className="text-[10px] uppercase tracking-wide text-slate-400">E-mail de assinada</dt><dd className="text-slate-700">{s.notificado_assinada_em ? fmtDataHora(s.notificado_assinada_em) : "não enviado"}</dd></div>
                              <div><dt className="text-[10px] uppercase tracking-wide text-slate-400">Situação</dt><dd className="text-slate-700">{s.status === "ASSINADA" ? "Assinada" : s.status === "EMITIDA" ? "Emitida" : s.status}</dd></div>
                              <div><dt className="text-[10px] uppercase tracking-wide text-slate-400">Data da NE</dt><dd className="text-slate-700">{s.data_emissao ? `${s.data_emissao.slice(8, 10)}/${s.data_emissao.slice(5, 7)}/${s.data_emissao.slice(0, 4)}` : "—"}</dd></div>
                              <div><dt className="text-[10px] uppercase tracking-wide text-slate-400">PAG</dt><dd className="text-slate-700">{s.pag ?? "—"}</dd></div>
                              <div><dt className="text-[10px] uppercase tracking-wide text-slate-400">Natureza</dt><dd className="text-slate-700">{s.nd ?? "—"}</dd></div>
                              <div><dt className="text-[10px] uppercase tracking-wide text-slate-400">Subprocesso</dt><dd className="text-slate-700">{s.subprocesso ?? "—"}</dd></div>
                              <div><dt className="text-[10px] uppercase tracking-wide text-slate-400">PDF da NE</dt><dd className="text-slate-700">{s.pdf_ne_url ? <a href={s.pdf_ne_url} target="_blank" rel="noreferrer" className="text-sky-600 underline">abrir</a> : "não anexado"}</dd></div>
                            </dl>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
            {historico.length > 500 && <p className="px-4 py-2 text-[11px] text-slate-400">Mostrando os 500 mais recentes. Use o período ou a busca.</p>}
          </div>
        )}
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* ── Verificações automáticas ── */}
        <section className="rounded-xl border border-slate-200 bg-white" aria-label="Verificações">
          <h3 className="border-b border-slate-200 px-4 py-3 text-sm font-semibold text-slate-800">Verificações da planilha</h3>
          {execs.length === 0 ? (
            <p className="py-6 text-center text-xs text-slate-400">Nenhuma verificação registrada ainda.</p>
          ) : (
            <ul className="max-h-[320px] divide-y divide-slate-100 overflow-auto">
              {execs.map((x) => {
                const abrir = execAberta === x.id;
                return (
                  <li key={x.id} className="text-xs">
                    <button onClick={() => setExecAberta(abrir ? null : x.id)} disabled={!x.itens.length && !x.erro} aria-expanded={abrir}
                      className="flex w-full flex-wrap items-center gap-x-3 gap-y-0.5 px-4 py-2 text-left hover:bg-slate-50 disabled:cursor-default disabled:hover:bg-transparent">
                      <span className="w-24 text-slate-600">{fmtDataHora(x.executado_em)}</span>
                      <span className="text-slate-400">{x.origem === "manual" ? "manual" : "automática"}</span>
                      {x.erro ? <span className="font-semibold text-red-600">falhou</span> : (
                        <>
                          <span className={x.enviados ? "font-semibold text-emerald-700" : "text-slate-500"}>{x.enviados} e-mail(s)</span>
                          {x.novas > 0 && <span className="text-sky-700">{x.novas} nova(s)</span>}
                          {x.sem_email > 0 && <span className="text-amber-600">{x.sem_email} sem e-mail</span>}
                          {x.erros > 0 && <span className="font-semibold text-red-600">{x.erros} erro(s)</span>}
                        </>
                      )}
                      <span className="ml-auto text-slate-400">{x.nes_lidas.toLocaleString("pt-BR")} lançamentos lidos</span>
                    </button>
                    {abrir && (
                      <div className="bg-slate-50 px-4 py-2">
                        {x.erro && <p className="mb-1 text-red-700">{x.erro}</p>}
                        {x.itens.map((it, i) => (
                          <div key={i} className="flex flex-wrap gap-x-3 py-0.5">
                            <span className="font-mono font-semibold text-slate-700">{it.numero}</span>
                            <span className="font-mono text-slate-500">{it.ne}</span>
                            <span style={{ color: COR[it.tipo] }}>{ROTULO[it.tipo]}</span>
                            <span className={it.resultado === "ENVIADO" ? "text-emerald-700" : it.resultado === "ERRO" ? "text-red-600" : "text-amber-600"}>
                              {ROTULO_RESULTADO[it.resultado] ?? it.resultado}
                            </span>
                            {it.email && <span className="text-slate-400">{it.email}</span>}
                            {it.motivo && it.resultado !== "ENVIADO" && <span className="text-slate-400">· {it.motivo}</span>}
                          </div>
                        ))}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        {/* ── Falhas de envio ── */}
        <section className="rounded-xl border border-slate-200 bg-white" aria-label="Falhas de envio">
          <h3 className="border-b border-slate-200 px-4 py-3 text-sm font-semibold text-slate-800">Falhas de envio <span className="font-normal text-slate-500">· últimos 90 dias</span></h3>
          {falhas.length === 0 ? (
            <p className="py-6 text-center text-xs text-slate-400">Nenhuma falha de envio.</p>
          ) : (
            <ul className="max-h-[320px] divide-y divide-slate-100 overflow-auto">
              {falhas.map((f) => {
                const s = f.solicitacao_id ? porId.get(f.solicitacao_id) : undefined;
                return (
                  <li key={f.id} className="px-4 py-2 text-xs">
                    <div className="flex flex-wrap gap-x-3">
                      <span className="text-slate-600">{fmtDataHora(f.enviado_em)}</span>
                      <span className="font-mono font-semibold text-slate-700">{s?.numero ?? "—"}</span>
                      <span className="text-slate-500">{f.tipo}</span>
                      <span className="text-slate-400">{f.email_destino}</span>
                    </div>
                    {f.erro && <div className="mt-0.5 truncate text-[11px] text-red-600" title={f.erro}>{f.erro}</div>}
                  </li>
                );
              })}
            </ul>
          )}
          <p className="border-t border-slate-100 px-4 py-2 text-[11px] text-slate-400">
            O envio que falha é tentado de novo na verificação seguinte. Último e-mail enviado:{" "}
            {envios[0] ? `${fmtDataHora(envios[0].em)} (${haQuanto(envios[0].em)})` : "—"}.
          </p>
        </section>
      </div>
    </div>
  );
}
