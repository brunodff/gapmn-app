import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "../../lib/supabase";

// Alertas do Diário Oficial da União, no jeito do Ro-dou (clipping do DOU do Ministério da Gestão): a função
// sync-dou busca cada termo cadastrado no DOU (busca exata, três seções) às 07:40 e às 13:40 de Manaus e guarda o
// que achou. Qualquer usuário cadastra termos (nome da OM, UASG, CNPJ de fornecedor, número de processo…).

type Publicacao = {
  id: string; titulo: string; tipo: string | null; secao: string | null; data: string | null; edicao: string | null;
  pagina: string | null; orgao: string | null; resumo: string; url: string | null; termos: string[]; primeira_vez: string;
};
type Termo = { id: number; termo: string; ativo: boolean };
type Rodada = { inicio: string; fim: string | null; ok: boolean | null; erro: string | null; resumo: Record<string, unknown> | null };

const COLUNAS = "id, titulo, tipo, secao, data, edicao, pagina, orgao, resumo, url, termos, primeira_vez";
const LIMITE = 300;
const SECOES: [string, string][] = [["", "Todas as seções"], ["DO1", "Seção 1 (atos normativos)"], ["DO2", "Seção 2 (pessoal)"], ["DO3", "Seção 3 (contratos e licitações)"]];

const dataBR = (d: string | null | undefined) => (d ? new Date(d.length === 10 ? d + "T12:00:00" : d).toLocaleDateString("pt-BR") : "–");
const horaBR = (d: string | null | undefined) => (d ? new Date(d).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "–");
const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/\p{M}/gu, "");

async function chamarSync(body: Record<string, unknown>) {
  const { data, error } = await supabase.functions.invoke("sync-dou", { body });
  if (error) {
    let texto = error.message;
    try { const corpo = await (error as { context?: { json?: () => Promise<{ error?: string }> } }).context?.json?.(); if (corpo?.error) texto = corpo.error; } catch { /* sem corpo */ }
    throw new Error(texto);
  }
  if (!data?.ok) throw new Error(data?.error ?? "A busca não terminou.");
  return data as { achadas: number; novas: number; avisos: string[] };
}

export default function PainelDou({ podeApagarTermo }: { podeApagarTermo: boolean }) {
  const [rodada, setRodada] = useState<Rodada | null>(null);
  const [lista, setLista] = useState<Publicacao[] | null>(null);
  const [termos, setTermos] = useState<Termo[]>([]);
  const [erro, setErro] = useState<string | null>(null);
  const [filtroTermo, setFiltroTermo] = useState("");
  const [secao, setSecao] = useState("");
  const [busca, setBusca] = useState("");
  const [novoTermo, setNovoTermo] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; txt: string } | null>(null);
  const [versao, setVersao] = useState(0);

  const carregar = useCallback(async () => {
    const [r, t, p] = await Promise.all([
      supabase.from("processos_sync_log").select("inicio, fim, ok, erro, resumo").eq("fonte", "dou").not("fim", "is", null).order("inicio", { ascending: false }).limit(1),
      supabase.from("dou_termos").select("id, termo, ativo").order("termo"),
      supabase.from("dou_publicacoes").select(COLUNAS).order("data", { ascending: false, nullsFirst: false }).order("primeira_vez", { ascending: false }).limit(LIMITE),
    ]);
    setRodada((r.data?.[0] as Rodada) ?? null);
    setTermos((t.data ?? []) as Termo[]);
    const falha = t.error ?? p.error;
    setErro(falha ? (/does not exist|schema cache/i.test(falha.message)
      ? "As tabelas do Diário Oficial ainda não existem no banco (migração 20261123c_dou_alertas pendente)." : falha.message) : null);
    setLista((p.data ?? []) as Publicacao[]);
  }, []);
  useEffect(() => { void carregar(); }, [carregar, versao]);

  const visiveis = useMemo(() => (lista ?? []).filter((p) =>
    (!filtroTermo || p.termos.includes(filtroTermo)) && (!secao || (p.secao ?? "").startsWith(secao))
    && (!busca.trim() || norm(`${p.titulo} ${p.tipo ?? ""} ${p.orgao ?? ""} ${p.resumo}`).includes(norm(busca.trim())))), [lista, filtroTermo, secao, busca]);

  // "novo": entrou nas últimas 36 h, depois da primeira busca
  const primeiraBusca = useMemo(() => (lista ?? []).reduce((m, p) => (p.primeira_vez < m ? p.primeira_vez : m), "9999"), [lista]);
  const ehNovo = (p: Publicacao) => Date.now() - new Date(p.primeira_vez).getTime() < 36 * 3600e3
    && new Date(p.primeira_vez).getTime() - new Date(primeiraBusca).getTime() > 3600e3;

  async function buscarAgora(periodo: "semana" | "mes" = "semana", termo?: string) {
    setOcupado(true);
    setMsg({ ok: true, txt: `Buscando no Diário Oficial${termo ? ` "${termo}"` : ""}… leva alguns segundos por termo.` });
    try {
      const r = await chamarSync({ origem: "manual", periodo, ...(termo ? { termo } : {}) });
      setMsg({ ok: true, txt: `✅ ${r.achadas} publicação(ões) no período, ${r.novas} nova(s).${r.avisos?.length ? ` Atenção: ${r.avisos.join("; ")}` : ""}` });
      setVersao((v) => v + 1);
    } catch (e) {
      setMsg({ ok: false, txt: "❌ " + (e instanceof Error ? e.message : String(e)) });
    } finally { setOcupado(false); }
  }

  async function cadastrar() {
    const termo = novoTermo.trim().replace(/\s+/g, " ");
    if (termo.length < 3) { setMsg({ ok: false, txt: "O termo precisa de pelo menos 3 letras." }); return; }
    const { data: s } = await supabase.auth.getSession();
    const { error } = await supabase.from("dou_termos").insert({ termo, criado_nome: s.session?.user.email ?? null });
    if (error) { setMsg({ ok: false, txt: error.code === "23505" ? "Esse termo já está cadastrado." : `Não cadastrou: ${error.message}` }); return; }
    setNovoTermo("");
    await buscarAgora("mes", termo); // traz o último mês do termo novo
  }

  async function alternar(t: Termo) {
    const { error } = await supabase.from("dou_termos").update({ ativo: !t.ativo }).eq("id", t.id);
    if (error) setMsg({ ok: false, txt: `Não mudou: ${error.message}` }); else setVersao((v) => v + 1);
  }
  async function apagar(t: Termo) {
    if (!confirm(`Apagar o termo "${t.termo}"? As publicações já achadas continuam.`)) return;
    const { error } = await supabase.from("dou_termos").delete().eq("id", t.id);
    if (error) setMsg({ ok: false, txt: `Não apagou: ${error.message}` }); else setVersao((v) => v + 1);
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start gap-3">
        <div>
          <h2 className="text-base font-bold text-slate-800">Diário Oficial da União — alertas</h2>
          <p className="text-xs text-slate-500">
            Publicações do <a href="https://www.in.gov.br/servicos/diario-oficial-da-uniao" target="_blank" rel="noreferrer" className="text-sky-700 hover:underline">DOU</a> com
            os termos abaixo (busca exata nas três seções), às 07:40 e às 13:40 de Manaus.
            {rodada && <> Última busca: {horaBR(rodada.fim ?? rodada.inicio)}{rodada.ok === false ? " (com erro)" : ""}.</>}
          </p>
        </div>
        <button onClick={() => void buscarAgora()} disabled={ocupado}
          className="ml-auto rounded-lg border border-sky-200 bg-sky-50 px-3 py-1.5 text-xs font-medium text-sky-700 hover:bg-sky-100 disabled:opacity-60">
          {ocupado ? "Buscando…" : "↻ Buscar agora (7 dias)"}
        </button>
      </div>
      {msg && <div className={`rounded-lg border px-3 py-2 text-xs ${msg.ok ? "border-sky-200 bg-sky-50 text-sky-700" : "border-red-200 bg-red-50 text-red-700"}`}>{msg.txt}</div>}
      {rodada?.ok === false && rodada.erro && <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">A última busca falhou: {rodada.erro}</div>}

      <div className="rounded-xl border border-slate-200 bg-white p-3 space-y-2">
        <div className="text-xs font-semibold text-slate-700">Termos buscados</div>
        <div className="flex flex-wrap gap-1.5">
          {termos.map((t) => (
            <span key={t.id} className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] ${t.ativo ? "border-sky-200 bg-sky-50 text-sky-800" : "border-slate-200 text-slate-400 line-through"}`}>
              <button onClick={() => setFiltroTermo(filtroTermo === t.termo ? "" : t.termo)} title="Ver só as publicações deste termo"
                className={filtroTermo === t.termo ? "font-bold" : ""}>{t.termo}</button>
              <button onClick={() => void alternar(t)} title={t.ativo ? "Parar de buscar" : "Voltar a buscar"} className="text-slate-400 hover:text-slate-700">{t.ativo ? "⏸" : "▶"}</button>
              {podeApagarTermo && <button onClick={() => void apagar(t)} title="Apagar o termo" className="text-slate-400 hover:text-red-600">✕</button>}
            </span>
          ))}
        </div>
        <form className="flex flex-wrap gap-2" onSubmit={(e) => { e.preventDefault(); void cadastrar(); }}>
          <input value={novoTermo} onChange={(e) => setNovoTermo(e.target.value)} disabled={ocupado}
            placeholder="Novo termo: nome da OM, UASG, CNPJ do fornecedor, nº do processo, nome do contrato…"
            className="min-w-[260px] flex-1 rounded-lg border border-slate-200 px-3 py-1.5 text-xs outline-none focus:ring-2 focus:ring-sky-200" />
          <button type="submit" disabled={ocupado || novoTermo.trim().length < 3}
            className="rounded-lg bg-sky-600 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50">+ Cadastrar e buscar o último mês</button>
        </form>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <select value={secao} onChange={(e) => setSecao(e.target.value)} className="rounded-lg border border-slate-200 px-2 py-1.5 text-xs">
          {SECOES.map(([v, t]) => <option key={v} value={v}>{t}</option>)}
        </select>
        <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Filtrar no título, tipo, órgão e resumo…"
          className="min-w-[240px] flex-1 rounded-lg border border-slate-200 px-3 py-1.5 text-xs outline-none focus:ring-2 focus:ring-sky-200" />
        {filtroTermo && <button onClick={() => setFiltroTermo("")} className="text-xs text-sky-700 hover:underline">✕ todos os termos</button>}
      </div>

      {erro && <p className="text-xs text-red-600">{erro}</p>}
      {!lista ? <p className="text-sm text-slate-500">Carregando…</p> : (
        <>
          <p className="text-xs text-slate-500">{visiveis.length} publicação(ões) neste filtro, da mais nova para a mais antiga.</p>
          {!visiveis.length && !erro && <p className="text-sm text-slate-500">Nada encontrado. Use "Buscar agora" ou cadastre um termo.</p>}
          {visiveis.map((p) => (
            <div key={p.id} className="rounded-xl border border-slate-200 bg-white p-3">
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <span className="text-slate-500">{dataBR(p.data)}</span>
                {p.secao && <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-600">{p.secao}{p.pagina ? ` · p. ${p.pagina}` : ""}</span>}
                {p.tipo && <span className="rounded-full bg-sky-100 px-2 py-0.5 text-[10px] font-medium text-sky-700">{p.tipo}</span>}
                {ehNovo(p) && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-800">novo</span>}
                {p.termos.map((t) => <span key={t} className="text-[10px] text-slate-400">#{t}</span>)}
              </div>
              <p className="mt-1.5 text-sm font-medium text-slate-800">{p.titulo || "–"}</p>
              {p.orgao && <p className="text-[11px] text-slate-500">{p.orgao}</p>}
              {p.resumo && <p className="mt-1 text-xs text-slate-600 line-clamp-3">{p.resumo}</p>}
              {p.url && <a href={p.url} target="_blank" rel="noreferrer" className="mt-1.5 inline-block text-xs text-sky-700 hover:underline">Abrir no DOU ↗</a>}
            </div>
          ))}
        </>
      )}
    </div>
  );
}
