// Conversa do chat com a função "assistente" do Supabase: manda a pergunta; se a IA pedir consultas que rodam
// no navegador (empenhos, crédito), roda aqui e devolve para ela continuar.
import { supabase } from "../supabase";
import { executarNoNavegador, type Fonte } from "./navegador.ts";
import type { Cota } from "./cota.ts";

export type { Fonte, Cota };
export { textoCota } from "./cota.ts";
export interface RespostaAssistente { resposta: string; fontes: Fonte[]; modelo?: string; cota?: Cota | null }
export interface Turno { papel: "usuario" | "assistente"; texto: string }
/** Erro do assistente com a cota que veio junto (a barra se atualiza mesmo quando a IA não respondeu) */
export class ErroAssistente extends Error { cota?: Cota | null; constructor(msg: string, cota?: Cota | null) { super(msg); this.cota = cota; } }

const NOMES: Record<string, string> = { execucao_contratos: "a execução dos contratos (planilhas do SIAFI; pode levar uns segundos)", empenhos: "a planilha de empenhos do Tesouro Gerencial (pode levar uns segundos)", credito: "a planilha de crédito" };

async function chamar(corpo: Record<string, unknown>): Promise<Record<string, unknown>> {
  const { data, error } = await supabase.functions.invoke("assistente", { body: corpo });
  if (error) {
    // a função responde { erro, cota } com status de erro: o supabase-js põe a resposta em error.context
    let msg = error.message, cota: Cota | null | undefined;
    try { const j = await (error as { context?: Response }).context?.json(); if (j?.erro) msg = j.erro; cota = j?.cota; } catch { /* sem corpo */ }
    throw new ErroAssistente(msg, cota);
  }
  if (!data || typeof data !== "object") throw new ErroAssistente("o assistente não respondeu");
  if (data.erro) throw new ErroAssistente(String(data.erro), data.cota);
  return data as Record<string, unknown>;
}

/** A cota do dia, sem perguntar nada à IA (null = sem a contagem de uso) */
export async function consultarCota(): Promise<Cota | null> {
  try { return ((await chamar({ cota: true })).cota as Cota | null) ?? null; } catch { return null; }
}

export async function perguntar(pergunta: string, historico: Turno[], aoConsultar?: (texto: string) => void): Promise<RespostaAssistente> {
  let r = await chamar({ pergunta, historico: historico.slice(-6) });
  for (let volta = 0; volta < 3 && Array.isArray(r.pendentes); volta++) {
    const pendentes = r.pendentes as { id: string; nome: string; args: Record<string, unknown> }[];
    aoConsultar?.(`Consultando ${pendentes.map((p) => NOMES[p.nome] ?? p.nome).join(" e ")}…`);
    const resultados = await Promise.all(pendentes.map(async (p) => {
      try { return { id: p.id, ...(await executarNoNavegador(p.nome, p.args)) }; } catch (e) { return { id: p.id, paraIA: { erro: String((e as Error)?.message ?? e) }, fontes: [] }; }
    }));
    aoConsultar?.("Montando a resposta…");
    r = await chamar({ continuar: { estado: r.estado, resultados } });
  }
  if (typeof r.resposta !== "string") throw new ErroAssistente("O assistente não terminou a resposta.", r.cota as Cota | null);
  return { resposta: r.resposta, fontes: (r.fontes as Fonte[]) ?? [], modelo: r.modelo as string | undefined, cota: r.cota as Cota | null | undefined };
}

/** Link interno do app (/app?vista=…&busca=…) → tela e busca */
export function lerLinkApp(link: string): { vista: string; busca: string | null; contrato: string | null; aditivo: string | null } | null {
  try {
    const u = new URL(link, "https://gapmn.app");
    if (u.origin !== "https://gapmn.app" || u.pathname !== "/app") return null;
    const vista = u.searchParams.get("vista");
    return vista ? { vista, busca: u.searchParams.get("busca"), contrato: u.searchParams.get("contrato"), aditivo: u.searchParams.get("aditivo") } : null;
  } catch { return null; }
}
