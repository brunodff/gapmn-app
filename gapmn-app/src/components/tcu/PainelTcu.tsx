import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { supabase } from "../../lib/supabase";

// Dados Abertos do TCU, atualizados todo dia pela função sync-tcu (07:20 de Manaus):
// fornecedores do GAP-MN nas listas do TCU, acórdãos sobre licitações e contratos e o
// Informativo de Licitações e Contratos. O app só avisa: nada aqui bloqueia contrato ou empenho.

type Aba = "fornecedores" | "acordaos" | "informativos";

type Sancao = {
  id: number; cnpj: string; lista: "INIDONEO" | "CONTAS_IRREGULARES"; processo: string; nome: string | null;
  acordao: string | null; data_acordao: string | null; data_transito: string | null; data_final: string | null;
  link_deliberacao: string | null; link_processo: string | null; vinculos: { contratos?: string[]; atas?: string[] };
  primeira_vez: string; ultima_vez: string;
};
type Acordao = {
  key: string; numero: number | null; ano: number | null; colegiado: string | null; data_sessao: string | null;
  relator: string | null; sumario: string | null; temas: string[]; destaque: boolean; url_acordao: string | null; url_pdf: string | null;
};
type Informativo = { key: string; numero: number; ano: number | null; colegiado: string | null; acordao: string | null; enunciado: string; texto: string | null; temas: string[] };
type Rodada = { inicio: string; fim: string | null; ok: boolean | null; erro: string | null; resumo: Record<string, unknown> | null };

const TEMAS = ["Licitação", "Contratação direta", "Registro de preços", "Preços e orçamento", "Execução do contrato", "Mão de obra", "Sanções", "Obras e engenharia", "TI"];
const POR_PAGINA = 30;

const dataBR = (d: string | null | undefined) => (d ? new Date(d.length === 10 ? d + "T12:00:00" : d).toLocaleDateString("pt-BR") : "–");
const horaBR = (d: string | null | undefined) => (d ? new Date(d).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "–");
const fmtCnpj = (c: string) => c.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, "$1.$2.$3/$4-$5");
const norm = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

export default function PainelTcu({ podeAtualizar }: { podeAtualizar: boolean }) {
  const [aba, setAba] = useState<Aba>("fornecedores");
  const [rodada, setRodada] = useState<Rodada | null>(null);
  const [sancoes, setSancoes] = useState<Sancao[] | null>(null);
  const [atualizando, setAtualizando] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; txt: string } | null>(null);

  const carregar = useCallback(async () => {
    const [r, s] = await Promise.all([
      supabase.from("processos_sync_log").select("inicio, fim, ok, erro, resumo").eq("fonte", "tcu").not("fim", "is", null).order("inicio", { ascending: false }).limit(1),
      supabase.from("tcu_sancoes").select("*").eq("ativo", true).order("lista").order("data_transito", { ascending: false }),
    ]);
    setRodada((r.data?.[0] as Rodada) ?? null);
    setSancoes((s.data ?? []) as Sancao[]);
    if (s.error) setMsg({ ok: false, txt: /does not exist|schema cache/i.test(s.error.message) ? "As tabelas do TCU ainda não existem no banco (migração 20261117_tcu_dados_abertos pendente)." : s.error.message });
  }, []);
  useEffect(() => { carregar(); }, [carregar]);

  async function atualizarAgora() {
    setAtualizando(true);
    setMsg({ ok: true, txt: "Consultando o TCU… pode levar até 2 minutos." });
    try {
      const { data, error } = await supabase.functions.invoke("sync-tcu", { body: { origem: "manual" } });
      if (error) {
        let texto = error.message;
        try { const corpo = await (error as { context?: { json?: () => Promise<{ error?: string }> } }).context?.json?.(); if (corpo?.error) texto = corpo.error; } catch { /* sem corpo */ }
        throw new Error(texto);
      }
      if (!data?.ok) throw new Error(data?.error ?? "A atualização não terminou.");
      const partes = [
        data.alertas_novos ? `${data.alertas_novos} registro(s) novo(s) de fornecedor` : "",
        data.acordaos_novos ? `${data.acordaos_novos} acórdão(s) novo(s)` : "",
        data.informativos_novos ? `${data.informativos_novos} enunciado(s) novo(s)` : "",
      ].filter(Boolean);
      const avisos = (data.avisos as string[] | undefined)?.length ? ` Avisos: ${(data.avisos as string[]).slice(0, 2).join("; ")}.` : "";
      setMsg({ ok: true, txt: (partes.length ? "✅ " + partes.join(" · ") : "✅ Nada novo desde a última atualização.") + avisos });
      await carregar();
    } catch (e) {
      setMsg({ ok: false, txt: "❌ " + (e instanceof Error ? e.message : String(e)) });
    } finally { setAtualizando(false); }
  }

  const resumo = (rodada?.resumo ?? {}) as { fornecedores?: number; cadirreg_pendentes?: number; avisos?: string[] };
  const nAvisos = sancoes?.length ?? 0;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start gap-3">
        <div>
          <h2 className="text-base font-bold text-slate-800">TCU — jurisprudência e sanções</h2>
          <p className="text-xs text-slate-500">
            Dados Abertos do TCU, atualizados todo dia às 07:20 (Manaus).
            {rodada && <> Última atualização: {horaBR(rodada.fim ?? rodada.inicio)}{rodada.ok === false ? " (com erro)" : ""}.</>}
          </p>
        </div>
        {podeAtualizar && (
          <button onClick={atualizarAgora} disabled={atualizando}
            className="ml-auto rounded-lg border border-sky-200 bg-sky-50 px-3 py-1.5 text-xs font-medium text-sky-700 hover:bg-sky-100 disabled:opacity-60">
            {atualizando ? "Atualizando…" : "↻ Atualizar agora"}
          </button>
        )}
      </div>
      {msg && <div className={`rounded-lg border px-3 py-2 text-xs ${msg.ok ? "border-sky-200 bg-sky-50 text-sky-700" : "border-red-200 bg-red-50 text-red-700"}`}>{msg.txt}</div>}
      {rodada?.ok && !!resumo.avisos?.length && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">Na última rodada: {resumo.avisos.slice(0, 3).join("; ")}.</div>
      )}

      <div className="flex gap-1 rounded-lg border border-slate-200 bg-white p-1 w-fit">
        {([["fornecedores", `Fornecedores${nAvisos ? ` (${nAvisos})` : ""}`], ["acordaos", "Acórdãos recentes"], ["informativos", "Informativo de Licitações e Contratos"]] as [Aba, string][]).map(([id, rot]) => (
          <button key={id} onClick={() => setAba(id)}
            className={`rounded-md px-3 py-1.5 text-xs font-medium ${aba === id ? "bg-slate-800 text-white" : "text-slate-600 hover:bg-slate-50"}`}>{rot}</button>
        ))}
      </div>

      {aba === "fornecedores" && <Fornecedores sancoes={sancoes} total={resumo.fornecedores} pendentes={resumo.cadirreg_pendentes} />}
      {aba === "acordaos" && <Acordaos />}
      {aba === "informativos" && <Informativos />}
    </div>
  );
}

// ── Fornecedores do GAP-MN nas listas do TCU ─────────────────────────────────
function Fornecedores({ sancoes, total, pendentes }: { sancoes: Sancao[] | null; total?: number; pendentes?: number }) {
  if (!sancoes) return <p className="text-sm text-slate-500">Carregando…</p>;
  return (
    <div className="space-y-3">
      <p className="text-xs text-slate-500">
        {total ? `${total} fornecedores com contrato ou ata vigente. ` : ""}A lista de licitantes inidôneos é conferida todo dia; as contas julgadas irregulares
        (CADIRREG), uma vez por semana para cada CNPJ{pendentes ? ` (${pendentes} ainda na fila)` : ""}. O app só avisa: a decisão sobre o contrato é da Administração.
      </p>
      {!sancoes.length && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-700">
          ✅ Nenhum fornecedor com contrato ou ata vigente aparece na lista de inidôneos nem no cadastro de contas irregulares do TCU.
        </div>
      )}
      {sancoes.map((s) => {
        const inid = s.lista === "INIDONEO";
        const contratos = s.vinculos?.contratos ?? [], atas = s.vinculos?.atas ?? [];
        return (
          <div key={s.id} className={`rounded-xl border p-4 ${inid ? "border-red-200 bg-red-50" : "border-amber-200 bg-amber-50"}`}>
            <div className="flex flex-wrap items-center gap-2">
              <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${inid ? "bg-red-600 text-white" : "bg-amber-100 text-amber-800"}`}>
                {inid ? "Declarada inidônea pelo TCU" : "Contas julgadas irregulares (CADIRREG)"}
              </span>
              <span className="text-sm font-semibold text-slate-800">{s.nome || "–"}</span>
              <span className="text-xs text-slate-500">CNPJ {fmtCnpj(s.cnpj)}</span>
            </div>
            <p className="mt-2 text-xs text-slate-700">
              {inid
                ? <>Declaração de inidoneidade (Lei 8.443/1992, art. 46): proíbe participar de licitação na Administração Pública Federal{s.data_final ? <> até <b>{dataBR(s.data_final)}</b></> : ""}.</>
                : <>Contas julgadas irregulares, com trânsito em julgado em {dataBR(s.data_transito)}. Por si, não impede contratar; serve de informação para a gestão e a fiscalização do contrato.</>}
            </p>
            <div className="mt-2 grid gap-1 text-xs text-slate-600 sm:grid-cols-2">
              <div>Processo TCU {s.processo || "–"}{s.acordao ? ` · Acórdão ${s.acordao}` : ""}{s.data_acordao ? ` de ${dataBR(s.data_acordao)}` : ""}</div>
              <div>No GAP-MN: {[contratos.length ? `contrato ${contratos.join(", ")}` : "", atas.length ? `ata ${atas.join(", ")}` : ""].filter(Boolean).join(" · ") || "–"}</div>
              <div>Visto pelo app em {dataBR(s.primeira_vez)}; conferido de novo em {dataBR(s.ultima_vez)}</div>
              <div className="flex gap-3">
                {s.link_deliberacao && <a href={s.link_deliberacao} target="_blank" rel="noreferrer" className="text-sky-700 hover:underline">Deliberação ↗</a>}
                {s.link_processo && <a href={s.link_processo} target="_blank" rel="noreferrer" className="text-sky-700 hover:underline">Processo ↗</a>}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── Acórdãos recentes sobre licitações e contratos ───────────────────────────
function Acordaos() {
  const [lista, setLista] = useState<Acordao[] | null>(null);
  const [tema, setTema] = useState<string | null>(null);
  const [soDefesa, setSoDefesa] = useState(false);
  const [busca, setBusca] = useState("");
  const [aberto, setAberto] = useState<string | null>(null);

  useEffect(() => {
    supabase.from("tcu_acordaos").select("key, numero, ano, colegiado, data_sessao, relator, sumario, temas, destaque, url_acordao, url_pdf")
      .order("data_sessao", { ascending: false }).order("numero", { ascending: false }).limit(300)
      .then(({ data }) => setLista((data ?? []) as Acordao[]));
  }, []);

  const visiveis = useMemo(() => (lista ?? []).filter((a) => (!tema || a.temas.includes(tema)) && (!soDefesa || a.destaque)
    && (!busca.trim() || norm(`${a.sumario} ${a.numero}/${a.ano} ${a.relator}`).includes(norm(busca)))), [lista, tema, soDefesa, busca]);

  if (!lista) return <p className="text-sm text-slate-500">Carregando…</p>;
  return (
    <div className="space-y-3">
      <p className="text-xs text-slate-500">Acórdãos das últimas sessões do TCU sobre licitações e contratos, separados pelo sumário (pessoal e aposentadoria ficam de fora).</p>
      <Filtros tema={tema} setTema={setTema} busca={busca} setBusca={setBusca} placeholder="Buscar no sumário, número ou relator…">
        <label className="inline-flex items-center gap-1.5 text-xs text-slate-600">
          <input type="checkbox" checked={soDefesa} onChange={(e) => setSoDefesa(e.target.checked)} /> Só Defesa, Forças Armadas e Manaus
        </label>
      </Filtros>
      {!visiveis.length && <p className="text-sm text-slate-500">Nenhum acórdão neste filtro.</p>}
      {visiveis.map((a) => (
        <div key={a.key} className="rounded-xl border border-slate-200 bg-white p-3">
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="font-semibold text-slate-800">Acórdão {a.numero}/{a.ano} – {a.colegiado}</span>
            <span className="text-slate-500">sessão de {dataBR(a.data_sessao)} · relator {a.relator ?? "–"}</span>
            {a.destaque && <span className="rounded-full bg-violet-100 px-2 py-0.5 text-[10px] font-medium text-violet-700">Defesa / Manaus</span>}
            {a.temas.map((t) => <span key={t} className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] text-slate-600">{t}</span>)}
          </div>
          <p className="mt-1.5 text-xs text-slate-700 cursor-pointer" onClick={() => setAberto(aberto === a.key ? null : a.key)}>
            {aberto === a.key || (a.sumario ?? "").length <= 320 ? a.sumario : `${a.sumario!.slice(0, 320)}… `}
            {aberto !== a.key && (a.sumario ?? "").length > 320 && <span className="text-sky-700">ver tudo</span>}
          </p>
          <div className="mt-1.5 flex gap-3 text-xs">
            {a.url_acordao && <a href={a.url_acordao} target="_blank" rel="noreferrer" className="text-sky-700 hover:underline">Abrir no TCU ↗</a>}
            {a.url_pdf && <a href={a.url_pdf} target="_blank" rel="noreferrer" className="text-sky-700 hover:underline">Relatório, voto e acórdão (PDF) ↗</a>}
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Informativo de Licitações e Contratos ────────────────────────────────────
function Informativos() {
  const [lista, setLista] = useState<Informativo[] | null>(null);
  const [tema, setTema] = useState<string | null>(null);
  const [busca, setBusca] = useState("");
  const [termo, setTermo] = useState("");
  const [qtd, setQtd] = useState(POR_PAGINA);
  const [mais, setMais] = useState(false);
  const [aberto, setAberto] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  // a busca vai ao banco (índice de texto em português) depois de uma pausa na digitação
  useEffect(() => { const t = setTimeout(() => setTermo(busca.trim()), 400); return () => clearTimeout(t); }, [busca]);
  useEffect(() => { setQtd(POR_PAGINA); }, [termo, tema]);

  useEffect(() => {
    let q = supabase.from("tcu_informativos").select("key, numero, ano, colegiado, acordao, enunciado, texto, temas");
    if (termo) q = q.textSearch("busca", termo, { type: "websearch", config: "portuguese" });
    if (tema) q = q.contains("temas", [tema]);
    let vivo = true;
    q.order("numero", { ascending: false }).order("key").range(0, qtd).then(({ data, error }) => {
      if (!vivo) return;
      setErro(error?.message ?? null);
      const linhas = (data ?? []) as Informativo[];
      setMais(linhas.length > qtd);
      setLista(linhas.slice(0, qtd));
    });
    return () => { vivo = false; };
  }, [termo, tema, qtd]);

  return (
    <div className="space-y-3">
      <p className="text-xs text-slate-500">
        Enunciados que o TCU publica no Informativo de Licitações e Contratos (desde 2010). O arquivo dos Dados Abertos é atualizado pelo TCU de tempos em tempos; o app confere todo dia.
      </p>
      <Filtros tema={tema} setTema={setTema} busca={busca} setBusca={setBusca} placeholder="Buscar nos enunciados (ex.: repactuação, adesão à ata, atestado)…" />
      {erro && <p className="text-xs text-red-600">{erro}</p>}
      {!lista ? <p className="text-sm text-slate-500">Carregando…</p> : !lista.length ? <p className="text-sm text-slate-500">Nenhum enunciado encontrado.</p> : lista.map((i) => (
        <div key={i.key} className="rounded-xl border border-slate-200 bg-white p-3">
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="font-semibold text-slate-800">Informativo nº {i.numero}{i.ano ? `/${i.ano}` : ""}</span>
            <span className="text-slate-500">{i.acordao}</span>
            {i.temas.map((t) => <span key={t} className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] text-slate-600">{t}</span>)}
          </div>
          <p className="mt-1.5 text-sm text-slate-800">{i.enunciado}</p>
          {i.texto && (
            <button onClick={() => setAberto(aberto === i.key ? null : i.key)} className="mt-1 text-xs text-sky-700 hover:underline">
              {aberto === i.key ? "esconder o caso" : "ver o caso"}
            </button>
          )}
          {aberto === i.key && <p className="mt-1 text-xs text-slate-600 whitespace-pre-line">{i.texto}</p>}
        </div>
      ))}
      {mais && <button onClick={() => setQtd((q) => q + POR_PAGINA)} className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-50">Mostrar mais</button>}
    </div>
  );
}

function Filtros({ tema, setTema, busca, setBusca, placeholder, children }: {
  tema: string | null; setTema: (t: string | null) => void; busca: string; setBusca: (s: string) => void; placeholder: string; children?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder={placeholder}
        className="w-full sm:w-80 rounded-lg border border-slate-200 px-3 py-1.5 text-xs outline-none focus:ring-1 focus:ring-sky-300" />
      <div className="flex flex-wrap gap-1">
        <button onClick={() => setTema(null)} className={`rounded-full border px-2.5 py-0.5 text-[11px] ${!tema ? "bg-slate-800 text-white border-slate-800" : "border-slate-200 text-slate-600 bg-white"}`}>Todos</button>
        {TEMAS.map((t) => (
          <button key={t} onClick={() => setTema(tema === t ? null : t)}
            className={`rounded-full border px-2.5 py-0.5 text-[11px] ${tema === t ? "bg-slate-800 text-white border-slate-800" : "border-slate-200 text-slate-600 bg-white"}`}>{t}</button>
        ))}
      </div>
      {children}
    </div>
  );
}
