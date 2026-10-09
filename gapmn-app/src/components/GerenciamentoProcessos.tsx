import { useState, useEffect, useMemo, Fragment } from "react";
import { utils, writeFile } from "xlsx";
import { supabase } from "../lib/supabase";
import { Card } from "./Card";

// Processos licitatórios do GAP-MN (UASG 120630) — duas fontes juntas por id_compra:
//   • processos_licitatorios + processos_itens: APIs públicas (PNCP e Dados Abertos),
//     atualizadas sozinhas 07:00 e 13:00 pela função sync-processos — TODOS os processos.
//   • cnet_processos / cnet_itens / cnet_participantes: o que só existe com login no
//     Compras.gov.br (fase da sessão, ação pendente, participantes), enviado pela extensão
//     "GAP-MN — Processos ao Vivo" do pessoal da SLIC.

// ─── Tipos ───────────────────────────────────────────────────────────────────
type Processo = {
  id: string; chave: string; id_compra: string | null; fonte: string; ano: number | null;
  modalidade: string | null; numero_processo: string | null; objeto: string | null;
  data_publicacao: string | null; abertura_proposta: string | null; encerramento_proposta: string | null;
  valor_estimado: number | null; valor_homologado: number | null; situacao: string | null;
  situacao_api: string | null; srp: boolean | null; processo_nup: string | null;
  amparo_legal: string | null; modo_disputa: string | null; link_pncp: string | null; link_sistema: string | null;
  qtd_itens: number | null; qtd_itens_homologados: number | null; qtd_itens_andamento: number | null;
  qtd_itens_sem_sucesso: number | null; itens_sync_em: string | null; ultima_sync: string | null;
  situacao_manual: string | null; homologado_manual: boolean | null; valor_homologado_manual: number | null;
};

type CnetProcesso = {
  id: number; identificacao: string; numero: string; ano: string; situacao: string; acao: string;
  acao_url: string; possui_pendencia: boolean; agrupamento: string; sincronizado_em: string;
  id_compra: string | null;
};

type ItemPublico = {
  id_compra: string; numero_item: number; numero_grupo: number | null; fonte: string;
  descricao: string | null; material_servico: string | null; unidade: string | null; quantidade: number | null;
  valor_unitario_estimado: number | null; valor_total_estimado: number | null; situacao: string | null;
  criterio_julgamento: string | null; beneficio: string | null; tem_resultado: boolean;
  fornecedor_ni: string | null; fornecedor_nome: string | null; fornecedor_porte: string | null;
  quantidade_homologada: number | null; valor_unitario_homologado: number | null;
  valor_total_homologado: number | null; data_resultado: string | null;
};

type CnetItem = {
  id: number; numero_item: number; descricao: string | null; descricao_detalhada: string | null;
  unidade: string | null; quantidade: number | null; valor_estimado_unitario: number | null;
  valor_estimado_total: number | null; situacao: string | null; homologado: boolean; lote: string | null;
  vencedor_cnpj: string | null; vencedor_nome: string | null; valor_vencedor_unitario: number | null;
  valor_vencedor_total: number | null; grupo_numero: number | null;
};

type CnetParticipante = { id: number; cnpj: string; nome: string | null; me_epp: boolean; qtd_itens_selecao: number | null };

type Grupo = "andamento" | "homologado" | "sem_sucesso" | "revogado" | "concluido";

type Linha = {
  chave: string; id_compra: string | null; titulo: string; modalidade: string; ano: string;
  objeto: string | null; situacao: string; grupo: Grupo; aoVivo: boolean;
  p: Processo | null; c: CnetProcesso | null; data: string | null;
  estimado: number | null; homologado: number | null;
};

type SyncLog = { inicio: string; fim: string | null; ok: boolean | null; resumo: any; erro: string | null };

const COLS_PROCESSO = "id, chave, id_compra, fonte, ano, modalidade, numero_processo, objeto, data_publicacao, " +
  "abertura_proposta, encerramento_proposta, valor_estimado, valor_homologado, situacao, situacao_api, srp, " +
  "processo_nup, amparo_legal, modo_disputa, link_pncp, link_sistema, qtd_itens, qtd_itens_homologados, " +
  "qtd_itens_andamento, qtd_itens_sem_sucesso, itens_sync_em, ultima_sync, situacao_manual, homologado_manual, " +
  "valor_homologado_manual";
const CNET_URL = "https://cnetmobile.estaleiro.serpro.gov.br";
const AO_VIVO_DIAS = 3;      // leitura do ComprasNet mais velha que isso não manda na situação

// ─── Helpers ─────────────────────────────────────────────────────────────────
function grupoDe(s: string): Grupo {
  const l = (s ?? "").toLowerCase();
  if (/revog|anulad/.test(l)) return "revogado";
  if (/desert|fracass|cancel/.test(l)) return "sem_sucesso";
  if (/conclu|encerrad|finaliz|ratific/.test(l)) return "concluido";
  if (/^homologad[oa]$/.test(l.trim()) || /^homologad[oa] \(/.test(l)) return "homologado";
  return "andamento";
}

function classeSit(s: string): string {
  const l = (s ?? "").toLowerCase();
  if (/parcial/.test(l))                                                                      return "bg-sky-50 border-sky-200 text-sky-700";
  if (/homolog|conclu/.test(l))                                                               return "bg-emerald-100 border-emerald-300 text-emerald-700";
  if (/desert/.test(l))                                                                       return "bg-amber-100 border-amber-300 text-amber-800";
  if (/fracass/.test(l))                                                                      return "bg-orange-100 border-orange-300 text-orange-800";
  if (/cancel/.test(l))                                                                       return "bg-red-100 border-red-300 text-red-700";
  if (/revog/.test(l))                                                                        return "bg-purple-100 border-purple-300 text-purple-800";
  if (/anulad/.test(l))                                                                       return "bg-pink-100 border-pink-300 text-pink-800";
  if (/suspens/.test(l))                                                                      return "bg-amber-50 border-amber-300 text-amber-800";
  return "bg-sky-50 border-sky-200 text-sky-700";
}

function fmtDateTime(d: string | null | undefined): string {
  if (!d) return "—";
  try { return new Date(d).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" }); }
  catch { return d; }
}
function fmtData(d: string | null | undefined): string {
  if (!d) return "—";
  const m = String(d).match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : d;
}
function fmtBRL(v: number | null | undefined): string {
  if (v == null) return "—";
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}
function fmtCurto(v: number): string {
  if (Math.abs(v) >= 1e6) return "R$ " + (v / 1e6).toLocaleString("pt-BR", { maximumFractionDigits: 1 }) + " mi";
  if (Math.abs(v) >= 1e3) return "R$ " + (v / 1e3).toLocaleString("pt-BR", { maximumFractionDigits: 0 }) + " mil";
  return fmtBRL(v);
}
function fmtCnpj(cnpj: string): string {
  const n = (cnpj ?? "").replace(/\D/g, "");
  if (n.length === 14) return n.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, "$1.$2.$3/$4-$5");
  if (n.length === 11) return n.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, "$1.$2.$3-$4");
  return cnpj;
}
function economia(est: number | null | undefined, hom: number | null | undefined): number | null {
  return est != null && hom != null && est > 0 ? ((est - hom) / est) * 100 : null;
}
function Eco({ v }: { v: number | null }) {
  if (v == null) return <span className="text-slate-300">—</span>;
  return <span className={v >= 0 ? "text-emerald-600" : "text-red-500"}>{v >= 0 ? "-" : "+"}{Math.abs(v).toFixed(1)}%</span>;
}
// "Pregão - Eletrônico" → "Pregão Eletrônico"
function modalidadeCurta(m: string | null | undefined): string {
  return String(m ?? "").replace(/\s*-\s*/g, " ").replace(/\s+/g, " ").trim() || "Processo";
}
// "Pregão Eletrônico 120630 - 90020/2026" → { modalidade: "Pregão Eletrônico", numero: "90020/2026" }
function partesCnet(ident: string) {
  const m = String(ident ?? "").match(/^(.*?)\s*\d{6}\s*-\s*(\d+\/\d{4})\s*$/);
  return m ? { modalidade: m[1].replace(/\s*\(Legado\)/i, ""), numero: m[2] } : { modalidade: ident, numero: "" };
}
function diasDesde(d: string | null | undefined): number {
  return d ? (Date.now() - Date.parse(d)) / 864e5 : Infinity;
}

async function lerTudo<T>(tabela: string, colunas: string): Promise<T[]> {
  const out: T[] = [];
  for (let de = 0; ; de += 1000) {
    const { data, error } = await supabase.from(tabela).select(colunas).range(de, de + 999);
    if (error) throw error;
    out.push(...((data ?? []) as T[]));
    if (!data || data.length < 1000) break;
  }
  return out;
}

function montarLinhas(processos: Processo[], cnet: CnetProcesso[]): Linha[] {
  const cnetPorId = new Map(cnet.filter((c) => c.id_compra).map((c) => [c.id_compra!, c]));
  const usados = new Set<string>();
  const linhas: Linha[] = processos.map((p) => {
    const c = p.id_compra ? cnetPorId.get(p.id_compra) ?? null : null;
    if (c) usados.add(c.identificacao);
    const pub = p.situacao_manual || p.situacao || (p.homologado_manual ? "Homologado" : "") || "Publicado";
    // A leitura do ComprasNet manda quando é recente e o público ainda não encerrou
    const aoVivo = !!c?.situacao && !p.situacao_manual && grupoDe(pub) === "andamento" && diasDesde(c.sincronizado_em) <= AO_VIVO_DIAS;
    const situacao = aoVivo ? c!.situacao : pub;
    const hom = p.valor_homologado_manual ?? p.valor_homologado;
    return {
      chave: p.chave, id_compra: p.id_compra, ano: String(p.ano ?? ""),
      titulo: `${modalidadeCurta(p.modalidade)} ${p.numero_processo ?? ""}`.trim(),
      modalidade: modalidadeCurta(p.modalidade), objeto: p.objeto, situacao, grupo: grupoDe(situacao), aoVivo,
      p, c, data: p.data_publicacao ?? p.abertura_proposta, estimado: p.valor_estimado, homologado: hom,
    };
  });
  // Processos que só o ComprasNet conhece (ainda não publicados nas APIs)
  for (const c of cnet) {
    if (usados.has(c.identificacao)) continue;
    const { modalidade, numero } = partesCnet(c.identificacao);
    linhas.push({
      chave: "CNET:" + c.identificacao, id_compra: c.id_compra, ano: c.ano, titulo: `${modalidade} ${numero}`.trim(),
      modalidade, objeto: null, situacao: c.situacao || "—", grupo: grupoDe(c.situacao), aoVivo: true,
      p: null, c, data: null, estimado: null, homologado: null,
    });
  }
  return linhas.sort((a, b) => String(b.data ?? b.ano).localeCompare(String(a.data ?? a.ano)));
}

// ─── Componente principal ────────────────────────────────────────────────────
interface GerProcessosProps { canImport?: boolean; canEdit?: boolean; canEditElaboracao?: boolean; }
export default function GerenciamentoProcessos({ canImport = true }: GerProcessosProps) {
  const [processos, setProcessos] = useState<Processo[]>([]);
  const [cnet, setCnet]           = useState<CnetProcesso[]>([]);
  const [logPublico, setLogPublico] = useState<SyncLog | null>(null);
  const [loading, setLoading]     = useState(true);
  const [err, setErr]             = useState<string | null>(null);
  const [selected, setSelected]   = useState<Linha | null>(null);

  // Atualizar agora
  const [sincronizando, setSincronizando] = useState(false);
  const [msgSync, setMsgSync] = useState<{ tipo: "ok" | "erro" | "info"; texto: string } | null>(null);

  // Filtros
  const [filtroAno,   setFiltroAno]   = useState("todos");
  const [filtroSit,   setFiltroSit]   = useState("todos");
  const [filtroMod,   setFiltroMod]   = useState("todos");
  const [filtroTexto, setFiltroTexto] = useState("");

  useEffect(() => { load(); }, []);

  async function load() {
    setLoading(true); setErr(null);
    try {
      const [ps, cs, log] = await Promise.all([
        lerTudo<Processo>("processos_licitatorios", COLS_PROCESSO),
        lerTudo<CnetProcesso>("cnet_processos", "id, identificacao, numero, ano, situacao, acao, acao_url, possui_pendencia, agrupamento, sincronizado_em, id_compra"),
        supabase.from("processos_sync_log").select("inicio, fim, ok, resumo, erro")
          .eq("fonte", "publica").eq("ok", true).order("inicio", { ascending: false }).limit(1),
      ]);
      setProcessos(ps);
      setCnet(cs);
      setLogPublico(((log as any).data?.[0] as SyncLog) ?? null);
    } catch (e: any) {
      setErr(e?.message ?? "Erro ao carregar processos.");
    } finally { setLoading(false); }
  }

  async function atualizarAgora() {
    setSincronizando(true);
    setMsgSync({ tipo: "info", texto: "Buscando no PNCP e no Compras.gov.br… pode levar até 2 minutos." });
    try {
      const { data, error } = await supabase.functions.invoke("sync-processos", { body: { origem: "manual" } });
      if (error) {
        let texto = error.message;
        try { const corpo = await (error as any).context?.json?.(); if (corpo?.error) texto = corpo.error; } catch { /* sem corpo */ }
        throw new Error(texto);
      }
      if (!data?.ok) throw new Error(data?.error ?? "A atualização não terminou.");
      const partes = [
        data.novos ? `${data.novos} novo(s)` : "",
        data.alterados ? `${data.alterados} atualizado(s)` : "",
        data.vencedores ? `${data.vencedores} vencedor(es) de itens` : "",
      ].filter(Boolean);
      setMsgSync({
        tipo: "ok",
        texto: (partes.length ? "✅ " + partes.join(" · ") : "✅ Nada mudou desde a última atualização") +
          (data.pendentes ? ` — faltam itens de ${data.pendentes} processo(s); continuam nas próximas atualizações automáticas (ou clique de novo).` : "."),
      });
      await load();
    } catch (e: any) {
      setMsgSync({ tipo: "erro", texto: "❌ " + (e?.message ?? "Erro ao atualizar.") });
    } finally { setSincronizando(false); }
  }

  // ── Derivados ─────────────────────────────────────────────────────────────
  const linhas = useMemo(() => montarLinhas(processos, cnet), [processos, cnet]);
  const anos = useMemo(() => [...new Set(linhas.map((l) => l.ano).filter(Boolean))].sort((a, b) => Number(b) - Number(a)), [linhas]);
  const modalidades = useMemo(() => [...new Set(linhas.map((l) => l.modalidade.replace(/ (Eletrônic[oa]|Presencial)$/, "")))].sort(), [linhas]);
  const ultimaCnet = useMemo(() => cnet.reduce<string | null>((m, c) => (!m || (c.sincronizado_em ?? "") > m ? c.sincronizado_em : m), null), [cnet]);

  const filtered = useMemo(() => {
    const q = filtroTexto.trim().toLowerCase();
    return linhas.filter((l) => {
      if (filtroAno !== "todos" && l.ano !== filtroAno) return false;
      if (filtroMod !== "todos" && !l.modalidade.startsWith(filtroMod)) return false;
      if (filtroSit === "ao_vivo" && !l.aoVivo) return false;
      if (filtroSit !== "todos" && filtroSit !== "ao_vivo" && l.grupo !== filtroSit) return false;
      if (q && ![l.titulo, l.objeto, l.situacao, l.p?.processo_nup, l.c?.acao, l.id_compra]
        .some((v) => v?.toLowerCase().includes(q))) return false;
      return true;
    });
  }, [linhas, filtroAno, filtroSit, filtroMod, filtroTexto]);

  const kpis = useMemo(() => {
    const est = filtered.reduce((s, l) => s + (l.estimado ?? 0), 0);
    const comHom = filtered.filter((l) => l.homologado != null && l.estimado != null && l.estimado > 0);
    const hom = filtered.reduce((s, l) => s + (l.homologado ?? 0), 0);
    const eco = comHom.reduce((s, l) => s + (l.estimado! - l.homologado!), 0);
    const estComHom = comHom.reduce((s, l) => s + l.estimado!, 0);
    return {
      total: filtered.length,
      andamento: filtered.filter((l) => l.grupo === "andamento").length,
      homologados: filtered.filter((l) => l.grupo === "homologado" || l.grupo === "concluido").length,
      semSucesso: filtered.filter((l) => l.grupo === "sem_sucesso" || l.grupo === "revogado").length,
      est, hom, eco, ecoPct: estComHom > 0 ? (eco / estComHom) * 100 : null,
    };
  }, [filtered]);

  function exportarLista() {
    if (!filtered.length) return;
    const rows: unknown[][] = [
      ["Processo", "Ano", "Objeto", "Situação", "ComprasNet (ao vivo)", "Ação pendente", "Valor estimado", "Valor homologado",
        "Economia %", "Publicação", "Abertura", "NUP", "SRP", "Itens", "Itens homologados", "PNCP", "Compras.gov.br"],
      ...filtered.map((l) => [
        l.titulo, l.ano, l.objeto ?? "", l.situacao, l.c?.situacao ?? "", l.c?.acao ?? "", l.estimado ?? "", l.homologado ?? "",
        economia(l.estimado, l.homologado)?.toFixed(1) ?? "", fmtData(l.p?.data_publicacao), fmtData(l.p?.abertura_proposta),
        l.p?.processo_nup ?? "", l.p?.srp ? "Sim" : "", l.p?.qtd_itens ?? "", l.p?.qtd_itens_homologados ?? "",
        l.p?.link_pncp ?? "", l.p?.link_sistema ?? "",
      ]),
    ];
    const wb = utils.book_new();
    utils.book_append_sheet(wb, utils.aoa_to_sheet(rows), "Processos");
    writeFile(wb, `processos-gapmn-${new Date().toISOString().slice(0, 10)}.xlsx`);
  }

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-4">

      {/* Cabeçalho */}
      <div className="rounded-2xl border border-slate-200 bg-white shadow-sm px-5 py-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-sm font-bold text-slate-800">Processos Licitatórios — GAP-MN</div>
            <div className="text-xs text-slate-400 mt-0.5 leading-relaxed">
              UASG 120630 · PNCP e Compras.gov.br{" "}
              {logPublico?.fim ? `atualizados em ${fmtDateTime(logPublico.fim)}` : "ainda não sincronizados"}
              {" "}(automático às 07:00 e 13:00)
              {ultimaCnet && <> · ComprasNet ao vivo (extensão da SLIC): {fmtDateTime(ultimaCnet)}</>}
            </div>
            {canImport && (
              <div className="mt-1 text-[11px] text-slate-400">
                Fase da sessão, ação pendente e participantes ao vivo: instale no navegador da SLIC a extensão{" "}
                <a href="/gapmn-processos-ao-vivo.zip" download className="text-sky-700 hover:underline">GAP-MN — Processos ao Vivo</a> (Chrome/Edge).
              </div>
            )}
          </div>
          <div className="flex items-center gap-2">
            {canImport && (
              <button onClick={atualizarAgora} disabled={sincronizando || loading}
                title="Busca agora no PNCP e no Compras.gov.br (API pública)"
                className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-medium text-emerald-700 hover:bg-emerald-100 disabled:opacity-60 transition-colors">
                {sincronizando ? "Atualizando…" : "⟳ Atualizar agora"}
              </button>
            )}
            <button onClick={load} disabled={loading}
              className="rounded-lg border border-sky-200 bg-sky-50 px-3 py-1.5 text-xs font-medium text-sky-700 hover:bg-sky-100 disabled:opacity-60 transition-colors">
              {loading ? "Carregando..." : "↻ Recarregar"}
            </button>
          </div>
        </div>
        {msgSync && (
          <div className={`mt-3 rounded-xl border p-2 text-xs ${msgSync.tipo === "erro" ? "border-red-200 bg-red-50 text-red-700" : msgSync.tipo === "ok" ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-sky-200 bg-sky-50 text-sky-700"}`}>
            {msgSync.texto}
          </div>
        )}
        {err && <div className="mt-3 rounded-xl border border-red-200 bg-red-50 p-2 text-sm text-red-700">{err}</div>}
      </div>

      {/* Números */}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
        {[
          { r: "Processos", v: kpis.total.toLocaleString("pt-BR"), s: `${kpis.semSucesso} sem sucesso/revogados` },
          { r: "Em andamento", v: kpis.andamento.toLocaleString("pt-BR"), s: "publicados, em disputa ou julgamento" },
          { r: "Homologados", v: kpis.homologados.toLocaleString("pt-BR"), s: "inclui concluídos (antigos)" },
          { r: "Valor estimado", v: fmtCurto(kpis.est), s: "soma dos processos filtrados" },
          { r: "Valor homologado", v: fmtCurto(kpis.hom), s: "soma dos homologados" },
          { r: "Economia", v: fmtCurto(kpis.eco), s: kpis.ecoPct != null ? `${kpis.ecoPct.toFixed(1)}% sobre o estimado` : "—" },
        ].map((k) => (
          <div key={k.r} className="rounded-2xl border border-slate-200 bg-white shadow-sm px-4 py-3">
            <div className="text-[10px] font-bold uppercase tracking-wide text-slate-400">{k.r}</div>
            <div className="mt-1 text-lg font-extrabold text-slate-800">{k.v}</div>
            <div className="text-[10px] text-slate-400">{k.s}</div>
          </div>
        ))}
      </div>

      {/* Filtros */}
      <Card>
        <div className="flex flex-wrap items-center gap-3">
          <select value={filtroAno} onChange={(e) => setFiltroAno(e.target.value)}
            className="rounded-xl border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-sky-200">
            <option value="todos">Todos os anos</option>
            {anos.map((a) => <option key={a} value={a}>{a}</option>)}
          </select>
          <select value={filtroSit} onChange={(e) => setFiltroSit(e.target.value)}
            className="rounded-xl border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-sky-200">
            <option value="todos">Todas as situações</option>
            <option value="andamento">Em andamento</option>
            <option value="ao_vivo">Com fase ao vivo (ComprasNet)</option>
            <option value="homologado">Homologados</option>
            <option value="concluido">Concluídos (antigos)</option>
            <option value="sem_sucesso">Desertos / Fracassados / Cancelados</option>
            <option value="revogado">Revogados / Anulados</option>
          </select>
          <select value={filtroMod} onChange={(e) => setFiltroMod(e.target.value)}
            className="rounded-xl border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-sky-200">
            <option value="todos">Todas as modalidades</option>
            {modalidades.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
          <input value={filtroTexto} onChange={(e) => setFiltroTexto(e.target.value)}
            placeholder="Buscar por objeto, número, NUP ou situação..."
            className="flex-1 min-w-[220px] rounded-xl border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-sky-200" />
          <span className="text-xs text-slate-500">
            {filtered.length} de {linhas.length} processo{linhas.length !== 1 ? "s" : ""}
          </span>
          <button onClick={exportarLista} disabled={!filtered.length}
            className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-medium text-emerald-700 hover:bg-emerald-100 disabled:opacity-40 transition-colors">
            📥 Exportar lista
          </button>
        </div>
      </Card>

      {/* Lista + detalhe */}
      <div className={`grid gap-4 ${selected ? "grid-cols-1 xl:grid-cols-[400px_1fr]" : "grid-cols-1"}`}>
        <Card>
          {loading ? (
            <p className="text-sm text-slate-500">Carregando...</p>
          ) : filtered.length === 0 ? (
            <p className="text-sm text-slate-500">
              {linhas.length === 0
                ? (canImport ? "Nenhum processo ainda. Clique em ⟳ Atualizar agora." : "Nenhum processo ainda — a SLIC precisa fazer a primeira atualização.")
                : "Nenhum resultado para os filtros aplicados."}
            </p>
          ) : (
            <div className="space-y-2 max-h-[72vh] overflow-y-auto pr-1">
              {filtered.map((l) => (
                <button key={l.chave} onClick={() => setSelected(l)}
                  className={`w-full rounded-xl border p-3 text-left hover:bg-slate-50 transition-colors ${
                    selected?.chave === l.chave ? "border-sky-300 ring-2 ring-sky-100" : "border-slate-200"}`}>
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-semibold text-slate-900 truncate">
                        {l.titulo}
                        {l.p?.srp && <span className="ml-1.5 rounded border border-indigo-200 bg-indigo-50 px-1 text-[9px] font-bold text-indigo-600 align-middle">SRP</span>}
                      </div>
                      <div className="mt-0.5 text-xs text-slate-500 line-clamp-2">{l.objeto || l.c?.acao || "—"}</div>
                      <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                        <span className={`rounded-full border px-2 py-0.5 text-xs ${classeSit(l.situacao)}`}>
                          {l.aoVivo && <span title="Fase lida no ComprasNet pela extensão da SLIC">● </span>}{l.situacao || "—"}
                        </span>
                        {l.c?.possui_pendencia && <span className="rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-[10px] text-amber-800">pendência</span>}
                        {l.estimado != null && (
                          <span className="text-[11px] text-slate-500">
                            {fmtCurto(l.estimado)}{l.homologado != null && <> → <b className="text-emerald-700">{fmtCurto(l.homologado)}</b></>}
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="text-right text-xs shrink-0 text-slate-400 font-medium">
                      {l.ano}
                      {l.p?.abertura_proposta && <div className="text-[10px] font-normal">abre {fmtData(l.p.abertura_proposta)}</div>}
                    </div>
                  </div>
                </button>
              ))}
            </div>
          )}
        </Card>

        {selected && <DetalheProcesso linha={selected} onFechar={() => setSelected(null)} />}
      </div>
    </div>
  );
}

// ─── Detalhe ─────────────────────────────────────────────────────────────────
function DetalheProcesso({ linha, onFechar }: { linha: Linha; onFechar: () => void }) {
  const { p, c } = linha;
  const [itens, setItens] = useState<ItemPublico[]>([]);
  const [itensCnet, setItensCnet] = useState<CnetItem[]>([]);
  const [participantes, setParticipantes] = useState<CnetParticipante[]>([]);
  const [carregando, setCarregando] = useState(false);
  const [aba, setAba] = useState<"itens" | "vencedores" | "participantes">("itens");
  const [abertos, setAbertos] = useState<Set<number>>(new Set());

  useEffect(() => {
    let vivo = true;
    setItens([]); setItensCnet([]); setParticipantes([]); setAba("itens"); setAbertos(new Set());
    setCarregando(true);
    (async () => {
      const [pub, ci, cp] = await Promise.all([
        linha.id_compra
          ? supabase.from("processos_itens").select("*").eq("id_compra", linha.id_compra).order("numero_item")
          : Promise.resolve({ data: [] }),
        c ? supabase.from("cnet_itens").select("*").eq("identificacao", c.identificacao).order("numero_item") : Promise.resolve({ data: [] }),
        c ? supabase.from("cnet_participantes").select("*").eq("identificacao", c.identificacao).order("qtd_itens_selecao", { ascending: false }) : Promise.resolve({ data: [] }),
      ]);
      if (!vivo) return;
      setItens(((pub as any).data ?? []) as ItemPublico[]);
      setItensCnet(((ci as any).data ?? []) as CnetItem[]);
      setParticipantes(((cp as any).data ?? []) as CnetParticipante[]);
      setCarregando(false);
    })().catch(() => vivo && setCarregando(false));
    return () => { vivo = false; };
  }, [linha.chave]);

  // Itens: os da API pública; sem eles, os lidos no ComprasNet
  const usarCnet = itens.length === 0 && itensCnet.length > 0;
  const itensVista = useMemo(() => usarCnet
    ? itensCnet.filter((it) => it.numero_item > 0).map((it): ItemPublico => ({
        id_compra: linha.id_compra ?? "", numero_item: it.numero_item, numero_grupo: it.grupo_numero != null ? Math.abs(it.grupo_numero) : null,
        fonte: "CNET", descricao: it.descricao_detalhada || it.descricao, material_servico: null, unidade: it.unidade,
        quantidade: it.quantidade, valor_unitario_estimado: it.valor_estimado_unitario, valor_total_estimado: it.valor_estimado_total,
        situacao: it.situacao, criterio_julgamento: null, beneficio: null, tem_resultado: !!it.vencedor_cnpj,
        fornecedor_ni: it.vencedor_cnpj, fornecedor_nome: it.vencedor_nome ?? participantes.find((x) => x.cnpj === it.vencedor_cnpj)?.nome ?? null,
        fornecedor_porte: null, quantidade_homologada: null, valor_unitario_homologado: it.valor_vencedor_unitario,
        valor_total_homologado: it.valor_vencedor_total, data_resultado: null,
      }))
    : itens, [itens, itensCnet, participantes, usarCnet, linha.id_compra]);

  const vencedores = useMemo(() => {
    const m = new Map<string, { ni: string; nome: string; porte: string | null; itens: ItemPublico[]; total: number; est: number }>();
    for (const it of itensVista) {
      if (!it.fornecedor_ni && !it.fornecedor_nome) continue;
      const k = it.fornecedor_ni || it.fornecedor_nome!;
      const v = m.get(k) ?? { ni: it.fornecedor_ni ?? "", nome: it.fornecedor_nome ?? "", porte: it.fornecedor_porte, itens: [], total: 0, est: 0 };
      v.itens.push(it);
      v.total += it.valor_total_homologado ?? 0;
      v.est += it.valor_total_estimado ?? 0;
      m.set(k, v);
    }
    return [...m.values()].sort((a, b) => b.total - a.total);
  }, [itensVista]);

  const totEst = itensVista.reduce((s, it) => s + (it.valor_total_estimado ?? 0), 0);
  const totHom = itensVista.reduce((s, it) => s + (it.valor_total_homologado ?? 0), 0);

  function alternar(n: number) { setAbertos((prev) => { const s = new Set(prev); s.has(n) ? s.delete(n) : s.add(n); return s; }); }

  function exportarItens() {
    if (!itensVista.length) return;
    const numero = p?.numero_processo ?? partesCnet(c?.identificacao ?? "").numero;
    const rows: unknown[][] = [
      // Mesma ordem da planilha da extensão (importada em outro sistema): novas colunas só no fim
      ["LOTE", "ITEM", "REQUISIÇÃO", "CNPJ", "EMPRESA", "QTDE", "UND", "VALOR UNIT", "VALOR TOTAL", "PRAZO", "DESCRIÇÃO", "SITUAÇÃO", "FORNECEDOR", "MODELO/VERSAO", "MARCA", "VALOR ESTIMADO"],
      ...itensVista.map((it) => [
        it.numero_grupo ?? "", it.numero_item, numero, it.fornecedor_ni ?? "", it.fornecedor_nome ?? "",
        it.quantidade ?? "", it.unidade ?? "",
        // Só o valor ofertado: item deserto/sem proposta fica vazio (nunca o estimado)
        it.valor_unitario_homologado ?? "", it.valor_total_homologado ?? "", 30, it.descricao ?? "", it.situacao ?? "",
        it.fornecedor_nome ?? "", "", "", it.valor_unitario_estimado ?? "",
      ]),
    ];
    const wb = utils.book_new();
    utils.book_append_sheet(wb, utils.aoa_to_sheet(rows), "Itens");
    writeFile(wb, linha.titulo.replace(/[/\\:*?"<>|]/g, "-") + ".xlsx");
  }

  const eco = economia(linha.estimado, linha.homologado);
  const info: [string, React.ReactNode][] = [
    ["Nº / Ano", p?.numero_processo ?? partesCnet(c?.identificacao ?? "").numero],
    ["Processo (NUP)", p?.processo_nup],
    ["Modalidade", linha.modalidade + (p?.srp ? " · SRP" : "")],
    ["Amparo legal", p?.amparo_legal],
    ["Modo de disputa", p?.modo_disputa],
    ["Publicação", fmtData(p?.data_publicacao)],
    ["Abertura das propostas", fmtData(p?.abertura_proposta)],
    ["Encerramento das propostas", fmtData(p?.encerramento_proposta)],
    ["Valor estimado", fmtBRL(linha.estimado)],
    ["Valor homologado", <>{fmtBRL(linha.homologado)}{p?.valor_homologado_manual != null && <span className="text-[10px] text-slate-400"> (informado à mão)</span>}</>],
    ["Economia", eco != null && linha.estimado != null && linha.homologado != null ? <>{fmtBRL(linha.estimado - linha.homologado)} (<Eco v={eco} />)</> : "—"],
    ["Itens", p?.qtd_itens != null ? `${p.qtd_itens} · ${p.qtd_itens_homologados ?? 0} homologado(s)` +
      (p.qtd_itens_andamento ? ` · ${p.qtd_itens_andamento} em andamento` : "") +
      (p.qtd_itens_sem_sucesso ? ` · ${p.qtd_itens_sem_sucesso} sem sucesso` : "") : "—"],
  ];

  return (
    <div className="space-y-4 min-w-0">
      <div className="rounded-2xl border border-slate-200 bg-white shadow-sm px-5 py-4">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="text-base font-bold text-slate-900">{linha.titulo}</div>
            <div className="mt-1 flex flex-wrap items-center gap-1.5">
              <span className={`rounded-full border px-2 py-0.5 text-xs ${classeSit(linha.situacao)}`}>{linha.situacao}</span>
              {p?.situacao && linha.aoVivo && p.situacao !== linha.situacao && (
                <span className="text-[10px] text-slate-400">PNCP: {p.situacao}</span>
              )}
              {p?.situacao_api && /suspens|revog|anulad/i.test(p.situacao_api) && (
                <span className="text-[10px] text-slate-400">({p.situacao_api})</span>
              )}
            </div>
          </div>
          <button onClick={onFechar} className="text-xs text-slate-400 hover:text-slate-700 shrink-0">✕ Fechar</button>
        </div>

        {linha.objeto && <p className="mt-3 text-sm text-slate-700 leading-relaxed">{linha.objeto}</p>}

        <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1.5 text-xs text-slate-700">
          {info.filter(([, v]) => v != null && v !== "" && v !== "—").map(([r, v]) => (
            <div key={r}><span className="font-semibold">{r}:</span> {v}</div>
          ))}
        </div>

        {c && (
          <div className="mt-3 rounded-xl border border-sky-200 bg-sky-50 px-3 py-2 text-xs text-sky-700">
            <b>ComprasNet (lido pela extensão da SLIC em {fmtDateTime(c.sincronizado_em)}):</b>{" "}
            {c.situacao || "—"}{c.acao && <> · ação pendente: <b>{c.acao}</b></>}{c.possui_pendencia && " · com pendência"}
            {diasDesde(c.sincronizado_em) > AO_VIVO_DIAS && <span className="text-sky-600"> — leitura antiga</span>}
          </div>
        )}

        <div className="mt-3 flex flex-wrap gap-3 text-xs">
          {p?.link_pncp && <a href={p.link_pncp} target="_blank" rel="noopener noreferrer" className="text-sky-700 hover:underline">Ver no PNCP (edital e arquivos) →</a>}
          {(p?.link_sistema || linha.id_compra) && (
            <a href={p?.link_sistema ?? `${CNET_URL}/comprasnet-web/public/compras/acompanhamento-compra?compra=${linha.id_compra}`}
              target="_blank" rel="noopener noreferrer" className="text-sky-700 hover:underline">Acompanhar no Compras.gov.br →</a>
          )}
          {c?.acao_url && <a href={CNET_URL + "/comprasnet-area-trabalho" + c.acao_url} target="_blank" rel="noopener noreferrer" className="text-sky-700 hover:underline">Abrir na Área de Trabalho (login) →</a>}
        </div>
      </div>

      {/* Abas */}
      <div className="flex gap-1 border-b border-slate-200">
        {([
          ["itens", `📦 Itens${itensVista.length ? ` (${itensVista.length})` : ""}`],
          ["vencedores", `🏆 Vencedores${vencedores.length ? ` (${vencedores.length})` : ""}`],
          ...(participantes.length ? [["participantes", `🏢 Participantes (${participantes.length})`]] : []),
        ] as [typeof aba, string][]).map(([k, r]) => (
          <button key={k} onClick={() => setAba(k)}
            className={`px-4 py-2 text-xs font-semibold border-b-2 -mb-px transition-colors ${
              aba === k ? "border-sky-500 text-sky-700" : "border-transparent text-slate-500 hover:text-slate-700"}`}>
            {r}
          </button>
        ))}
        {carregando && <span className="ml-auto text-xs text-slate-400 self-center pr-2">Carregando...</span>}
        {!carregando && itensVista.length > 0 && (
          <button onClick={exportarItens}
            className="ml-auto self-center rounded-lg border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-[11px] font-medium text-emerald-700 hover:bg-emerald-100">
            📥 Exportar XLS do processo
          </button>
        )}
      </div>

      {aba === "itens" && (
        <Card>
          {carregando ? <p className="text-sm text-slate-400">Carregando itens...</p>
          : itensVista.length === 0 ? (
            <div className="rounded-xl border border-indigo-100 bg-indigo-50 p-4 text-xs text-indigo-800 leading-relaxed">
              {p && !p.itens_sync_em
                ? <>Os itens deste processo ainda não foram buscados — entram nas próximas atualizações automáticas (07:00 e 13:00).</>
                : <>Sem itens publicados para este processo.</>}
            </div>
          ) : (
            <div className="overflow-x-auto">
              {usarCnet && <p className="mb-2 text-[11px] text-slate-400">Itens lidos no ComprasNet pela extensão (a API pública ainda não tem).</p>}
              <table className="w-full text-xs border-collapse">
                <thead>
                  <tr className="bg-slate-50">
                    <th className="text-left px-2 py-2 text-slate-500 font-semibold border-b w-10">#</th>
                    <th className="text-left px-2 py-2 text-slate-500 font-semibold border-b">Descrição / Vencedor</th>
                    <th className="text-left px-2 py-2 text-slate-500 font-semibold border-b w-16">Unid.</th>
                    <th className="text-right px-2 py-2 text-slate-500 font-semibold border-b w-16">Qtde</th>
                    <th className="text-right px-2 py-2 text-slate-500 font-semibold border-b w-28">Est. unit.</th>
                    <th className="text-right px-2 py-2 text-slate-500 font-semibold border-b w-28">Homolog. unit.</th>
                    <th className="text-right px-2 py-2 text-slate-500 font-semibold border-b w-16 text-emerald-600">Eco.%</th>
                    <th className="text-left px-2 py-2 text-slate-500 font-semibold border-b w-28">Situação</th>
                  </tr>
                </thead>
                <tbody>
                  {itensVista.map((it) => {
                    const aberto = abertos.has(it.numero_item);
                    return (
                      <Fragment key={it.numero_item}>
                        <tr className="border-b border-slate-100 hover:bg-slate-50/60 cursor-pointer select-none" onClick={() => alternar(it.numero_item)}>
                          <td className="px-2 py-2 text-slate-400 font-medium whitespace-nowrap">
                            <span className="text-[9px] text-slate-300 mr-0.5">{aberto ? "▲" : "▼"}</span>{it.numero_item}
                            {it.numero_grupo ? <div className="text-[9px] text-indigo-400">lote {it.numero_grupo}</div> : null}
                          </td>
                          <td className="px-2 py-2 text-slate-800 max-w-[360px]">
                            <div className={`font-medium leading-snug ${aberto ? "" : "line-clamp-2"}`}>{it.descricao || "—"}</div>
                            {it.fornecedor_nome && (
                              <div className="mt-0.5 text-[10px] text-slate-500 truncate">🏆 {it.fornecedor_nome}</div>
                            )}
                          </td>
                          <td className="px-2 py-2 text-slate-500">{it.unidade || "—"}</td>
                          <td className="px-2 py-2 text-right text-slate-700">{it.quantidade?.toLocaleString("pt-BR") ?? "—"}</td>
                          <td className="px-2 py-2 text-right text-slate-600">{fmtBRL(it.valor_unitario_estimado)}</td>
                          <td className="px-2 py-2 text-right font-medium text-slate-800">{fmtBRL(it.valor_unitario_homologado)}</td>
                          <td className="px-2 py-2 text-right font-semibold"><Eco v={economia(it.valor_unitario_estimado, it.valor_unitario_homologado)} /></td>
                          <td className="px-2 py-2">
                            <span className={`rounded-full border px-2 py-0.5 text-[10px] font-medium ${classeSit(it.situacao ?? "")}`}>{it.situacao || "—"}</span>
                          </td>
                        </tr>
                        {aberto && (
                          <tr className="border-b border-slate-100 bg-slate-50/60">
                            <td colSpan={8} className="px-5 py-3">
                              <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1 text-[11px] text-slate-600">
                                {it.material_servico && <div><span className="text-slate-500">Tipo:</span> {it.material_servico}</div>}
                                {it.criterio_julgamento && <div><span className="text-slate-500">Critério:</span> {it.criterio_julgamento}</div>}
                                {it.beneficio && it.beneficio !== "Não se aplica" && <div><span className="text-slate-500">Benefício:</span> {it.beneficio}</div>}
                                <div><span className="text-slate-500">Estimado total:</span> {fmtBRL(it.valor_total_estimado)}</div>
                                {it.fornecedor_nome ? (
                                  <>
                                    <div><span className="text-slate-500">Vencedor:</span> <b className="text-slate-800">{it.fornecedor_nome}</b>{it.fornecedor_porte && it.fornecedor_porte !== "Não se aplica" ? ` (${it.fornecedor_porte})` : ""}</div>
                                    {it.fornecedor_ni && <div><span className="text-slate-500">CNPJ/CPF:</span> <span className="font-mono">{fmtCnpj(it.fornecedor_ni)}</span></div>}
                                    <div><span className="text-slate-500">Homologado total:</span> <b className="text-emerald-700">{fmtBRL(it.valor_total_homologado)}</b>{it.quantidade_homologada != null && ` (${it.quantidade_homologada.toLocaleString("pt-BR")} un.)`}</div>
                                    {it.data_resultado && <div><span className="text-slate-500">Resultado em:</span> {fmtData(it.data_resultado)}</div>}
                                  </>
                                ) : (
                                  <div className="text-slate-400 italic">Sem vencedor publicado.</div>
                                )}
                              </div>
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
              {(totEst > 0 || totHom > 0) && (
                <div className="mt-3 flex flex-wrap justify-end gap-x-8 gap-y-1 text-xs border-t pt-2">
                  {totEst > 0 && <div className="text-slate-500">Total estimado: <span className="font-bold text-slate-700">{fmtBRL(totEst)}</span></div>}
                  {totHom > 0 && <div className="text-slate-500">Total homologado: <span className="font-bold text-emerald-700">{fmtBRL(totHom)}</span></div>}
                </div>
              )}
            </div>
          )}
        </Card>
      )}

      {aba === "vencedores" && (
        <Card>
          {vencedores.length === 0 ? (
            <p className="text-sm text-slate-400">{carregando ? "Carregando..." : "Nenhum vencedor publicado ainda."}</p>
          ) : (
            <table className="w-full text-xs border-collapse">
              <thead>
                <tr className="bg-slate-50">
                  <th className="text-left px-2 py-2 text-slate-500 font-semibold border-b">Fornecedor</th>
                  <th className="text-left px-2 py-2 text-slate-500 font-semibold border-b w-36">CNPJ/CPF</th>
                  <th className="text-center px-2 py-2 text-slate-500 font-semibold border-b w-16">Itens</th>
                  <th className="text-right px-2 py-2 text-slate-500 font-semibold border-b w-32">Homologado</th>
                  <th className="text-right px-2 py-2 text-slate-500 font-semibold border-b w-16 text-emerald-600">Eco.%</th>
                </tr>
              </thead>
              <tbody>
                {vencedores.map((v) => (
                  <tr key={v.ni || v.nome} className="border-b border-slate-100">
                    <td className="px-2 py-2 text-slate-800 font-medium">
                      {v.nome || "—"}{v.porte && v.porte !== "Não se aplica" && <span className="ml-1 text-[10px] text-slate-400">({v.porte})</span>}
                      <div className="text-[10px] text-slate-400 truncate max-w-[420px]">itens {v.itens.map((it) => it.numero_item).join(", ")}</div>
                    </td>
                    <td className="px-2 py-2 font-mono text-[10px] text-slate-500">{v.ni ? fmtCnpj(v.ni) : "—"}</td>
                    <td className="px-2 py-2 text-center text-slate-600">{v.itens.length}</td>
                    <td className="px-2 py-2 text-right font-semibold text-emerald-700">{fmtBRL(v.total || null)}</td>
                    <td className="px-2 py-2 text-right font-semibold"><Eco v={economia(v.est || null, v.total || null)} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      )}

      {aba === "participantes" && (
        <Card>
          <p className="mb-2 text-[11px] text-slate-400">Fornecedores que participaram — lidos no ComprasNet pela extensão da SLIC.</p>
          <table className="w-full text-xs border-collapse">
            <thead>
              <tr className="bg-slate-50">
                <th className="text-left px-2 py-2 text-slate-500 font-semibold border-b">CNPJ/CPF</th>
                <th className="text-left px-2 py-2 text-slate-500 font-semibold border-b">Empresa</th>
                <th className="text-center px-2 py-2 text-slate-500 font-semibold border-b w-16">ME/EPP</th>
                <th className="text-center px-2 py-2 text-slate-500 font-semibold border-b w-20">Itens</th>
                <th className="text-center px-2 py-2 text-slate-500 font-semibold border-b w-20 text-emerald-600">Ganhou</th>
              </tr>
            </thead>
            <tbody>
              {participantes.map((pt) => {
                const ganhos = itensVista.filter((it) => (it.fornecedor_ni ?? "").replace(/\D/g, "") === pt.cnpj.replace(/\D/g, "")).length;
                return (
                  <tr key={pt.id} className="border-b border-slate-100">
                    <td className="px-2 py-2 font-mono text-[10px] text-slate-400">{fmtCnpj(pt.cnpj)}</td>
                    <td className="px-2 py-2 text-slate-800 font-medium">{pt.nome || "—"}</td>
                    <td className="px-2 py-2 text-center">{pt.me_epp && <span className="rounded-full border border-green-200 bg-green-50 px-2 py-0.5 text-[10px] text-green-700">ME/EPP</span>}</td>
                    <td className="px-2 py-2 text-center text-slate-600">{pt.qtd_itens_selecao ?? "—"}</td>
                    <td className="px-2 py-2 text-center font-bold">{ganhos ? <span className="text-emerald-600">{ganhos}</span> : <span className="text-slate-300 font-normal">—</span>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}
