// Busca da aba BD para o Painel de Governança.
// O navegador NUNCA fala com o Apps Script: quem tem a URL e o token é a Edge
// Function `indicadores-bd`. Aqui só se chama a função e se guarda o último dado bom.

import { supabase } from "../supabase";
import { prepararPayload } from "./calculo.ts";
import { fmtGeradoEm } from "./formato.ts";
import type { LinhaBD, PayloadBD } from "./tipos.ts";

export type ResultadoBD = {
  payload: PayloadBD;
  /** Quando a função leu a planilha (ISO). */
  buscadoEm: string;
  /** Aviso discreto para a faixa do topo (dado antigo, falha ao atualizar). */
  aviso: string | null;
  /** Problemas de formato encontrados na BD (para diagnóstico). */
  avisosDados: string[];
};

const CHAVE = "gapmn_governanca_ultimo_v1";

const MENSAGENS: Record<string, string> = {
  nao_autenticado: "Sua sessão expirou. Entre de novo no app.",
  sem_permissao: "Acesso restrito a administradores do sistema.",
  nao_configurado: "A leitura da planilha ainda não foi configurada no servidor.",
  falha_planilha: "A planilha de indicadores não respondeu agora.",
};

async function mensagemDoErro(error: unknown): Promise<string> {
  const ctx = (error as { context?: Response })?.context;
  if (ctx && typeof ctx.json === "function") {
    try {
      const j = await ctx.clone().json();
      if (j?.erro && MENSAGENS[j.erro]) return MENSAGENS[j.erro];
    } catch { /* corpo não é JSON */ }
  }
  return "Não foi possível carregar os indicadores agora.";
}

/** Guarda só as competências que têm algum dado (as futuras vazias não servem para nada). */
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

export async function buscarBD(forcar = false): Promise<ResultadoBD> {
  try {
    const { data, error } = await supabase.functions.invoke("indicadores-bd", { body: { forcar } });
    if (error) throw new Error(await mensagemDoErro(error));
    const { payload, avisos } = prepararPayload(data);
    const buscadoEm = String(data?.buscado_em ?? new Date().toISOString());
    guardar(payload, buscadoEm);
    const aviso = data?.aviso ? `${data.aviso} Exibindo dados de ${horaDe(payload, buscadoEm)}.` : null;
    return { payload, buscadoEm, aviso, avisosDados: avisos };
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
