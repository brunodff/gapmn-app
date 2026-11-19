import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "../../lib/supabase";

// Pareceres referenciais da AGU (Manifestações Jurídicas Referenciais, ON AGU nº 55/2014), do buscador público
// da Consultoria-Geral da União (cgu.agu.gov.br/referenciais), atualizados todo dia pela função sync-agu
// (07:30 de Manaus). A busca vai ao banco (índice de texto no número, no assunto e na ementa).

type Grupo = "aeronautica" | "defesa" | "ecju" | "outros";
type Referencial = {
  id: number; orgao: string; grupo: Grupo; parecer: string; data: string | null; assunto: string;
  url: string | null; validade: string | null; licitacoes: boolean; primeira_vez: string;
};
type Rodada = { inicio: string; fim: string | null; ok: boolean | null; erro: string | null; resumo: Record<string, unknown> | null };

type Filtro = Grupo | "proximos" | "todos";
const GRUPOS: [Filtro, string][] = [
  ["proximos", "COJAER + Defesa + e-CJU"], ["aeronautica", "Aeronáutica (COJAER)"], ["defesa", "Defesa e Forças"],
  ["ecju", "Consultorias especializadas (e-CJU)"], ["outros", "Ministérios"], ["todos", "Todos"],
];
const COR: Record<Grupo, string> = {
  aeronautica: "bg-sky-100 text-sky-700", defesa: "bg-violet-100 text-violet-700", ecju: "bg-emerald-100 text-emerald-700", outros: "bg-slate-100 text-slate-600",
};
const COLUNAS = "id, orgao, grupo, parecer, data, assunto, url, validade, licitacoes, primeira_vez";
const LIMITE = 400;

const dataBR = (d: string | null | undefined) => (d ? new Date(d.length === 10 ? d + "T12:00:00" : d).toLocaleDateString("pt-BR") : "–");
const horaBR = (d: string | null | undefined) => (d ? new Date(d).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "–");
const hojeIso = () => new Date(Date.now() - 4 * 3600e3).toISOString().slice(0, 10); // Manaus

export default function PainelAgu({ podeAtualizar }: { podeAtualizar: boolean }) {
  const [rodada, setRodada] = useState<Rodada | null>(null);
  const [lista, setLista] = useState<Referencial[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [grupo, setGrupo] = useState<Filtro>("proximos");
  const [soVigentes, setSoVigentes] = useState(true);
  const [soLicitacoes, setSoLicitacoes] = useState(true);
  const [busca, setBusca] = useState("");
  const [termo, setTermo] = useState("");
  const [aberto, setAberto] = useState<number | null>(null);
  const [ementas, setEmentas] = useState<Record<number, string>>({});
  const [atualizando, setAtualizando] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; txt: string } | null>(null);
  const [versao, setVersao] = useState(0);

  const carregarRodada = useCallback(async () => {
    const { data } = await supabase.from("processos_sync_log").select("inicio, fim, ok, erro, resumo")
      .eq("fonte", "agu").not("fim", "is", null).order("inicio", { ascending: false }).limit(1);
    setRodada((data?.[0] as Rodada) ?? null);
  }, []);
  useEffect(() => { carregarRodada(); }, [carregarRodada]);

  // a busca vai ao banco depois de uma pausa na digitação
  useEffect(() => { const t = setTimeout(() => setTermo(busca.trim()), 400); return () => clearTimeout(t); }, [busca]);

  useEffect(() => {
    let q = supabase.from("agu_referenciais").select(COLUNAS).eq("na_lista", true);
    if (soLicitacoes) q = q.eq("licitacoes", true);
    if (soVigentes) q = q.or(`validade.is.null,validade.gte.${hojeIso()}`);
    if (grupo === "proximos") q = q.in("grupo", ["aeronautica", "defesa", "ecju"]);
    else if (grupo !== "todos") q = q.eq("grupo", grupo);
    if (termo) q = q.textSearch("busca", termo, { type: "websearch", config: "portuguese" });
    let vivo = true;
    q.order("data", { ascending: false, nullsFirst: false }).order("id", { ascending: false }).limit(LIMITE).then(({ data, error }) => {
      if (!vivo) return;
      setErro(error ? (/does not exist|schema cache/i.test(error.message)
        ? "A tabela dos pareceres da AGU ainda não existe no banco (migração 20261118_agu_referenciais pendente)." : error.message) : null);
      setLista((data ?? []) as Referencial[]);
    });
    return () => { vivo = false; };
  }, [grupo, soVigentes, soLicitacoes, termo, versao]);

  // "novo": entrou no banco depois da primeira carga, nos últimos 10 dias
  const primeiraCarga = useMemo(() => (lista ?? []).reduce((m, r) => (r.primeira_vez < m ? r.primeira_vez : m), "9999"), [lista]);
  const ehNovo = (r: Referencial) => Date.now() - new Date(r.primeira_vez).getTime() < 10 * 86400e3
    && new Date(r.primeira_vez).getTime() - new Date(primeiraCarga).getTime() > 86400e3;

  async function verEmenta(id: number) {
    if (aberto === id) { setAberto(null); return; }
    setAberto(id);
    if (ementas[id] != null) return;
    const { data } = await supabase.from("agu_referenciais").select("observacao").eq("id", id).maybeSingle();
    setEmentas((e) => ({ ...e, [id]: (data?.observacao as string | undefined) || "Sem ementa no buscador da AGU." }));
  }

  async function atualizarAgora() {
    setAtualizando(true);
    setMsg({ ok: true, txt: "Lendo o buscador da AGU… leva alguns segundos." });
    try {
      const { data, error } = await supabase.functions.invoke("sync-agu", { body: { origem: "manual" } });
      if (error) {
        let texto = error.message;
        try { const corpo = await (error as { context?: { json?: () => Promise<{ error?: string }> } }).context?.json?.(); if (corpo?.error) texto = corpo.error; } catch { /* sem corpo */ }
        throw new Error(texto);
      }
      if (!data?.ok) throw new Error(data?.error ?? "A atualização não terminou.");
      setMsg({ ok: true, txt: data.primeira_carga
        ? `✅ Primeira carga: ${data.lidos} pareceres referenciais (${data.vigentes_licitacoes} vigentes sobre licitações e contratos).`
        : data.novos ? `✅ ${data.novos} parecer(es) novo(s).` : "✅ Nada novo desde a última atualização." });
      await carregarRodada();
      setVersao((v) => v + 1);
    } catch (e) {
      setMsg({ ok: false, txt: "❌ " + (e instanceof Error ? e.message : String(e)) });
    } finally { setAtualizando(false); }
  }

  const hoje = hojeIso();
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start gap-3">
        <div>
          <h2 className="text-base font-bold text-slate-800">AGU — pareceres referenciais</h2>
          <p className="text-xs text-slate-500">
            Manifestações Jurídicas Referenciais do <a href="https://cgu.agu.gov.br/referenciais/" target="_blank" rel="noreferrer" className="text-sky-700 hover:underline">buscador da Consultoria-Geral da União</a>,
            atualizadas todo dia às 07:30 (Manaus).
            {rodada && <> Última atualização: {horaBR(rodada.fim ?? rodada.inicio)}{rodada.ok === false ? " (com erro)" : ""}.</>}
          </p>
          <p className="text-xs text-slate-500">O referencial dispensa a análise jurídica individual só nos casos que ele descreve e para os órgãos assessorados por quem o emitiu: confira a ementa e a validade.</p>
        </div>
        {podeAtualizar && (
          <button onClick={atualizarAgora} disabled={atualizando}
            className="ml-auto rounded-lg border border-sky-200 bg-sky-50 px-3 py-1.5 text-xs font-medium text-sky-700 hover:bg-sky-100 disabled:opacity-60">
            {atualizando ? "Atualizando…" : "↻ Atualizar agora"}
          </button>
        )}
      </div>
      {msg && <div className={`rounded-lg border px-3 py-2 text-xs ${msg.ok ? "border-sky-200 bg-sky-50 text-sky-700" : "border-red-200 bg-red-50 text-red-700"}`}>{msg.txt}</div>}
      {rodada?.ok === false && rodada.erro && <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">A última leitura falhou: {rodada.erro}</div>}

      <div className="rounded-xl border border-slate-200 bg-white p-3 space-y-2">
        <div className="flex flex-wrap gap-1.5">
          {GRUPOS.map(([id, rot]) => (
            <button key={id} onClick={() => setGrupo(id)}
              className={`rounded-full border px-2.5 py-1 text-[11px] font-medium ${grupo === id ? "border-sky-600 bg-sky-600 text-white" : "border-slate-200 text-slate-600 hover:bg-slate-50"}`}>{rot}</button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar no número, assunto e ementa (ex.: prorrogação, repactuação, adesão à ata)…"
            className="min-w-[260px] flex-1 rounded-lg border border-slate-200 px-3 py-1.5 text-xs outline-none focus:ring-2 focus:ring-sky-200" />
          <label className="inline-flex items-center gap-1.5 text-xs text-slate-600">
            <input type="checkbox" checked={soLicitacoes} onChange={(e) => setSoLicitacoes(e.target.checked)} /> Só licitações e contratos
          </label>
          <label className="inline-flex items-center gap-1.5 text-xs text-slate-600">
            <input type="checkbox" checked={soVigentes} onChange={(e) => setSoVigentes(e.target.checked)} /> Só dentro da validade
          </label>
        </div>
      </div>

      {erro && <p className="text-xs text-red-600">{erro}</p>}
      {!lista ? <p className="text-sm text-slate-500">Carregando…</p> : (
        <>
          <p className="text-xs text-slate-500">{lista.length}{lista.length >= LIMITE ? "+" : ""} parecer{lista.length === 1 ? "" : "es"} neste filtro, do mais novo para o mais antigo.</p>
          {!lista.length && !erro && <p className="text-sm text-slate-500">Nenhum parecer referencial neste filtro.</p>}
          {lista.map((r) => {
            const vencido = !!r.validade && r.validade < hoje;
            return (
              <div key={r.id} className="rounded-xl border border-slate-200 bg-white p-3">
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <span className="font-semibold text-slate-800">{r.parecer || `Referencial ${r.id}`}</span>
                  <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${COR[r.grupo]}`}>{r.orgao}</span>
                  {ehNovo(r) && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-800">novo</span>}
                  <span className="text-slate-500">de {dataBR(r.data)}</span>
                  <span className={vencido ? "text-red-600" : "text-slate-500"}>{r.validade ? `${vencido ? "venceu em" : "válido até"} ${dataBR(r.validade)}` : "sem prazo de validade informado"}</span>
                </div>
                <p className="mt-1.5 text-sm text-slate-800">{r.assunto || "–"}</p>
                <div className="mt-1.5 flex flex-wrap gap-3 text-xs">
                  <button onClick={() => void verEmenta(r.id)} className="text-sky-700 hover:underline">{aberto === r.id ? "esconder a ementa" : "ver a ementa"}</button>
                  {r.url && <a href={r.url} target="_blank" rel="noreferrer" className="text-sky-700 hover:underline">Abrir o parecer ↗</a>}
                </div>
                {aberto === r.id && <p className="mt-1.5 whitespace-pre-line text-xs text-slate-600">{ementas[r.id] ?? "Carregando…"}</p>}
              </div>
            );
          })}
        </>
      )}
    </div>
  );
}
