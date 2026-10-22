// Busca dos indicadores para o Painel de Governança.
// Desde 22/10/2026 os dados moram no banco do app (coleta mensal pelo formulário, histórico importado
// da planilha): a função gov_bd devolve tudo no formato da antiga aba BD, então as contas não mudaram.
// Só ADMIN e DEV leem. Aqui só se busca e se guarda o último dado bom.

import { supabase } from "../supabase";
import { prepararPayload } from "./calculo.ts";
import { fmtGeradoEm } from "./formato.ts";
import type { LinhaBD, PayloadBD } from "./tipos.ts";

export type ResultadoBD = {
  payload: PayloadBD;
  /** Quando os dados foram lidos (ISO). */
  buscadoEm: string;
  /** Aviso discreto para a faixa do topo (dado antigo, falha ao atualizar). */
  aviso: string | null;
  /** Problemas de formato encontrados nos dados (para diagnóstico). */
  avisosDados: string[];
};

const CHAVE = "gapmn_governanca_ultimo_v2";

function mensagemDoErro(m: string): string {
  if (/sem_permissao|permission denied/i.test(m)) return "Acesso restrito a administradores do sistema.";
  if (/JWT|expired|not authenticated/i.test(m)) return "Sua sessão expirou. Entre de novo no app.";
  if (/could not find the function|does not exist/i.test(m)) return "Os indicadores ainda não estão no banco do app.";
  return "Não foi possível carregar os indicadores agora.";
}

/** Guarda só as competências que têm algum dado. */
function guardar(payload: PayloadBD, buscadoEm: string) {
  try {
    const comDado = new Set(payload.bd.filter((l) => l.VALOR !== null).map((l) => l.DATA));
    const bd: LinhaBD[] = payload.bd.filter((l) => comDado.has(l.DATA));
    localStorage.setItem(CHAVE, JSON.stringify({ payload: { ...payload, bd }, buscadoEm }));
  } catch { /* armazenamento cheio ou bloqueado: segue sem guardar */ }
}

function lerGuardado(): { payload: PayloadBD; buscadoEm: string } | null {
  try {
    const t = localStorage.getItem(CHAVE);
    if (!t) return null;
    const j = JSON.parse(t);
    return { payload: prepararPayload(j.payload).payload, buscadoEm: String(j.buscadoEm ?? "") };
  } catch {
    return null;
  }
}

function horaDe(payload: PayloadBD, buscadoEm: string): string {
  const g = fmtGeradoEm(payload.gerado_em);
  if (g !== "—") return g;
  const d = new Date(buscadoEm);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

/** Último dado guardado neste navegador, para mostrar algo enquanto a busca roda. */
export function ultimoGuardado(): ResultadoBD | null {
  const g = lerGuardado();
  return g ? { ...g, aviso: null, avisosDados: [] } : null;
}

/** Competência com a coleta aberta ('AAAA-MM-01'), para o painel não abrir nela por padrão. Falha → null. */
async function coletaAberta(): Promise<string | null> {
  const { data, error } = await supabase.from("gov_competencias").select("codigo").eq("aberta", true).limit(1);
  if (error || !data?.length) return null;
  return `${(data[0] as { codigo: string }).codigo}-01`;
}

export async function buscarBD(): Promise<ResultadoBD> {
  try {
    const [{ data, error }, aberta] = await Promise.all([supabase.rpc("gov_bd"), coletaAberta()]);
    if (error) throw new Error(mensagemDoErro(error.message ?? ""));
    const { payload, avisos } = prepararPayload({ ...(data as object), coleta_aberta: aberta });
    const buscadoEm = new Date().toISOString();
    guardar(payload, buscadoEm);
    return { payload, buscadoEm, aviso: null, avisosDados: avisos };
  } catch (e) {
    const motivo = e instanceof Error ? e.message : String(e);
    const g = lerGuardado();
    if (g) {
      return {
        ...g,
        aviso: `Não foi possível atualizar agora — exibindo dados de ${horaDe(g.payload, g.buscadoEm)}. (${motivo})`,
        avisosDados: [],
      };
    }
    throw new Error(motivo);
  }
}
