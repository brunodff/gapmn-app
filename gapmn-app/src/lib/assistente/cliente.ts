// Conversa do chat com a função "assistente" do Supabase: manda a pergunta; se a IA pedir consultas que rodam
// no navegador (empenhos, crédito), roda aqui e devolve para ela continuar.
import { supabase } from "../supabase";
import { executarNoNavegador, type Fonte } from "./navegador.ts";

export type { Fonte };
export interface RespostaAssistente { resposta: string; fontes: Fonte[]; modelo?: string }
export interface Turno { papel: "usuario" | "assistente"; texto: string }

const NOMES: Record<string, string> = { execucao_contratos: "a execução dos contratos (planilhas do SIAFI; pode levar uns segundos)", empenhos: "a planilha de empenhos do Tesouro Gerencial (pode levar uns segundos)", credito: "a planilha de crédito" };

async function chamar(corpo: Record<string, unknown>): Promise<Record<string, unknown>> {
  const { data, error } = await supabase.functions.invoke("assistente", { body: corpo });
  if (error) {
    // a função responde { erro } com status de erro: o supabase-js põe a resposta em error.context
    let msg = error.message;
    try { const j = await (error as { context?: Response }).context?.json(); if (j?.erro) msg = j.erro; } catch { /* sem corpo */ }
    throw new Error(msg);
  }
  if (!data || typeof data !== "object") throw new Error("o assistente não respondeu");
  if (data.erro) throw new Error(String(data.erro));
  return data as Record<string, unknown>;
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
  if (typeof r.resposta !== "string") throw new Error("O assistente não terminou a resposta.");
  return { resposta: r.resposta, fontes: (r.fontes as Fonte[]) ?? [], modelo: r.modelo as string | undefined };
}

/** Link interno do app (/app?vista=…&busca=…) → tela e busca */
export function lerLinkApp(link: string): { vista: string; busca: string | null; contrato: string | null } | null {
  try {
    const u = new URL(link, "https://gapmn.app");
    if (u.origin !== "https://gapmn.app" || u.pathname !== "/app") return null;
    const vista = u.searchParams.get("vista");
    return vista ? { vista, busca: u.searchParams.get("busca"), contrato: u.searchParams.get("contrato") } : null;
  } catch { return null; }
}
