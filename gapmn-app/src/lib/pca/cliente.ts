// Acompanhamento do PCA na tela: leitura das tabelas (RLS: todos leem as contratações; a SLIC lê o resto) e
// chamadas à função pca-automacao, que é quem grava (histórico imutável de toda alteração).
import { supabase } from "../supabase";
import { CONFIG_PADRAO, type ConfigPca, type Contratacao, type Elo, type MembroEquipe, type RegraMjr } from "./tipos.ts";

export interface Irregularidade { id: string; criado_em: string; contratacao_id: string | null; dnr_id: string | null; tipo: string; descricao: string; detalhe: Record<string, unknown> | null; resolvido_em: string | null; resolvido_por: string | null; decisao: string | null }
export interface EventoPca { id: string; recebido_em: string; origem: string; tipo: string; pag: string | null; assunto: string | null; remetente: string | null; data: string | null; contratacao_id: string | null; ciente_em: string | null; ciente_por: string | null }
export interface EmailPca { id: string; criado_em: string; contratacao_id: string | null; tipo: string; para: string[]; assunto: string; html: string; situacao: string; enviado_em: string | null; erro: string | null; enviado_por: string | null }
export interface HistoricoPca { id: number; contratacao_id: string; em: string; origem: string; campo: string; de: unknown; para: unknown; justificativa: string | null; usuario_nome: string | null }
export interface DnrPca { id: string; criado_em: string; criado_por: string | null; fonte: string; numero_dnr: string | null; data_chegada: string | null; pag_oficio: string | null; pag_tr: string | null; numero_contratacao: string | null; objeto: string | null; assinante_tr: string | null; situacao: string; contratacao_id: string | null }
export interface Rodada { inicio: string; fim: string | null; ok: boolean | null; erro: string | null; resumo: Record<string, unknown> | null }
export interface AguRef { id: number; grupo: string | null; numero: number | null; ano: number | null; assunto: string | null; validade: string | null; url: string | null }

export interface DadosPca {
  lista: Contratacao[];
  cfg: ConfigPca;
  elos: Elo[];
  equipe: MembroEquipe[];
  regras: RegraMjr[];
  irregularidades: Irregularidade[];
  eventos: EventoPca[];
  rodada: Rodada | null;
  /** tabelas ainda não criadas no banco (migração 20261125_pca_acompanhamento pendente) */
  semTabelas: boolean;
}

const num = (v: unknown) => (v == null ? null : Number(v));
function linha(c: Record<string, unknown>): Contratacao {
  return { ...(c as unknown as Contratacao), valor_estimado: num(c.valor_estimado), mjr_id: num(c.mjr_id), numeros_dfd: (c.numeros_dfd as string[]) ?? [], itens_pca: ((c.itens_pca as number[]) ?? []).map(Number), alertas_ativos: (c.alertas_ativos as Contratacao["alertas_ativos"]) ?? [] };
}

export async function carregarPca(): Promise<DadosPca> {
  const cfgR = await supabase.from("pca_config").select("*").eq("id", 1).maybeSingle();
  if (cfgR.error && /does not exist|schema cache|relation/i.test(cfgR.error.message)) {
    return { lista: [], cfg: CONFIG_PADRAO, elos: [], equipe: [], regras: [], irregularidades: [], eventos: [], rodada: null, semTabelas: true };
  }
  const c = (cfgR.data ?? {}) as Partial<ConfigPca>;
  const cfg: ConfigPca = { ...CONFIG_PADRAO, ...Object.fromEntries(Object.entries(c).filter(([, v]) => v != null)) } as ConfigPca;
  cfg.limite_dispensa_demais = Number(cfg.limite_dispensa_demais); cfg.limite_dispensa_engenharia = Number(cfg.limite_dispensa_engenharia);
  const [lista, elos, equipe, regras, irr, ev, rod] = await Promise.all([
    supabase.from("pca_contratacoes").select("*").eq("ano", cfg.ano).order("data_estimada_chegada", { ascending: true, nullsFirst: false }).limit(5000),
    supabase.from("pca_elos").select("*").order("om"),
    supabase.from("pca_equipe").select("*").order("nome"),
    supabase.from("pca_mjr").select("*").order("titulo"),
    supabase.from("pca_irregularidades").select("*").is("resolvido_em", null).order("criado_em", { ascending: false }).limit(500),
    supabase.from("pca_eventos").select("*").is("ciente_em", null).in("tipo", ["impugnacao", "esclarecimento"]).order("recebido_em", { ascending: false }).limit(200),
    supabase.from("processos_sync_log").select("inicio, fim, ok, erro, resumo").eq("fonte", "pca").not("fim", "is", null).order("inicio", { ascending: false }).limit(1),
  ]);
  if (lista.error) throw new Error(lista.error.message);
  return {
    lista: (lista.data ?? []).map(linha), cfg,
    elos: ((elos.data ?? []) as Elo[]).map((e) => ({ ...e, areas_pgc: e.areas_pgc ?? [] })),
    equipe: (equipe.data ?? []) as MembroEquipe[],
    regras: ((regras.data ?? []) as RegraMjr[]).map((r) => ({ ...r, valor_maximo: num(r.valor_maximo), categorias: r.categorias ?? [], modalidades: r.modalidades ?? [], palavras: r.palavras ?? [] })),
    irregularidades: (irr.data ?? []) as Irregularidade[],
    eventos: (ev.data ?? []) as EventoPca[],
    rodada: ((rod.data ?? [])[0] as Rodada) ?? null,
    semTabelas: false,
  };
}

export async function historicoDe(id: string): Promise<HistoricoPca[]> {
  const { data, error } = await supabase.from("pca_historico").select("*").eq("contratacao_id", id).order("em", { ascending: false }).limit(500);
  if (error) throw new Error(error.message);
  return (data ?? []) as HistoricoPca[];
}
export async function dnrsDe(id: string): Promise<DnrPca[]> {
  const { data } = await supabase.from("pca_dnr").select("*").eq("contratacao_id", id).order("criado_em", { ascending: false });
  return (data ?? []) as DnrPca[];
}
export async function dnr(id: string): Promise<DnrPca | null> {
  const { data } = await supabase.from("pca_dnr").select("*").eq("id", id).maybeSingle();
  return (data as DnrPca) ?? null;
}
export async function emailsPca(limite = 200): Promise<EmailPca[]> {
  const { data, error } = await supabase.from("pca_emails").select("*").order("criado_em", { ascending: false }).limit(limite);
  if (error) throw new Error(error.message);
  return (data ?? []) as EmailPca[];
}
/** Pareceres referenciais da AGU vigentes e de licitação (tabela da sync-agu), para as regras de MJR */
export async function pareceresAgu(): Promise<AguRef[]> {
  const hoje = new Date().toISOString().slice(0, 10);
  const { data } = await supabase.from("agu_referenciais").select("id, grupo, numero, ano, assunto, validade, url").eq("licitacoes", true)
    .or(`validade.is.null,validade.gte.${hoje}`).order("data", { ascending: false }).limit(400);
  return (data ?? []) as AguRef[];
}

/** Chama a função pca-automacao; erro vira Error com a mensagem em português */
export async function acaoPca<T = Record<string, unknown>>(acao: string, corpo: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await supabase.functions.invoke("pca-automacao", { body: { acao, ...corpo } });
  if (error) {
    let msg = error.message;
    try { const j = await (error as { context?: Response }).context?.json(); if (j?.error) msg = j.error; } catch { /* sem corpo */ }
    if (/Failed to send|not found|404/i.test(msg)) msg = "A função pca-automacao ainda não foi publicada no Supabase.";
    throw new Error(msg);
  }
  if (!data?.ok) throw new Error(data?.error ?? "A função não respondeu.");
  return data as T;
}
