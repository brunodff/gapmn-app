// Laço da conversa do assistente: a IA pede consultas (ferramentas), o servidor roda as dele e devolve o
// resultado; as que são do navegador (planilhas grandes) param o laço e voltam ao app, que as roda e continua.
import type { Fonte, Resultado } from "./ferramentas.ts";

export interface ChamadaFerramenta { id: string; type: "function"; function: { name: string; arguments: string } }
export interface MsgIA { role: "system" | "user" | "assistant" | "tool"; content: string | null; tool_calls?: ChamadaFerramenta[]; tool_call_id?: string }
export type ChamarIA = (mensagens: MsgIA[], comFerramentas: boolean) => Promise<{ content: string | null; tool_calls?: ChamadaFerramenta[] }>;
export interface Pendente { id: string; nome: string; args: Record<string, unknown> }
export interface Estado { mensagens: MsgIA[]; fontes: Fonte[]; consultas: string[]; rodadas: number }
export type Saida =
  | { tipo: "final"; resposta: string; fontes: Fonte[]; consultas: string[] }
  | { tipo: "pendente"; pendentes: Pendente[]; estado: Estado };

export const MAX_TEXTO_FERRAMENTA = 6500;

/** JSON do resultado que cabe no limite: corta as listas pela metade até caber (avisa que cortou) */
export function caber(valor: unknown, max = MAX_TEXTO_FERRAMENTA): string {
  let txt = JSON.stringify(valor);
  if (txt.length <= max || !valor || typeof valor !== "object") return txt.length <= max ? txt : `${txt.slice(0, max)}…`;
  const v = structuredClone(valor) as Record<string, unknown>;
  for (let i = 0; i < 8 && txt.length > max; i++) {
    let cortou = false;
    for (const [k, x] of Object.entries(v)) if (Array.isArray(x) && x.length > 1) { v[k] = x.slice(0, Math.ceil(x.length / 2)); cortou = true; }
    v.obs_corte = "lista encurtada para caber; use o total informado";
    txt = JSON.stringify(v);
    if (!cortou) break;
  }
  return txt.length <= max ? txt : `${txt.slice(0, max)}…`;
}

const lerArgs = (s: string) => { try { const v = JSON.parse(s || "{}"); return v && typeof v === "object" ? v : {}; } catch { return {}; } };

export async function rodar(estado: Estado, op: {
  chamarIA: ChamarIA; executar: (nome: string, args: Record<string, unknown>) => Promise<Resultado>;
  doNavegador: Set<string>; maxRodadas?: number;
}): Promise<Saida> {
  const max = op.maxRodadas ?? 4;
  while (estado.rodadas < max) {
    const r = await op.chamarIA(estado.mensagens, true);
    estado.rodadas++;
    const chamadas = (r.tool_calls ?? []).slice(0, 5);
    if (!chamadas.length) return final(r.content, estado);
    estado.mensagens.push({ role: "assistant", content: r.content ?? "", tool_calls: chamadas });
    const pendentes: Pendente[] = [];
    const doServidor = chamadas.filter((c) => !op.doNavegador.has(c.function.name));
    for (const c of chamadas) {
      estado.consultas.push(c.function.name);
      if (op.doNavegador.has(c.function.name)) pendentes.push({ id: c.id, nome: c.function.name, args: lerArgs(c.function.arguments) });
    }
    const resultados = await Promise.all(doServidor.map(async (c) => {
      try { return await op.executar(c.function.name, lerArgs(c.function.arguments)); } catch (e) { return { paraIA: { erro: String((e as Error)?.message ?? e) }, fontes: [] } as Resultado; }
    }));
    doServidor.forEach((c, i) => {
      estado.fontes.push(...resultados[i].fontes);
      estado.mensagens.push({ role: "tool", tool_call_id: c.id, content: caber(resultados[i].paraIA) });
    });
    if (pendentes.length) return { tipo: "pendente", pendentes, estado };
  }
  const r = await op.chamarIA(estado.mensagens, false);
  return final(r.content, estado);
}

/** Resultados das ferramentas do navegador entram na conversa (o que o app mandou, com tamanho limitado) */
export function juntarResultados(estado: Estado, resultados: { id: string; paraIA: unknown; fontes?: Fonte[] }[]) {
  const pedidos = new Set(estado.mensagens.flatMap((m) => (m.tool_calls ?? []).map((c) => c.id)));
  const respondidos = new Set(estado.mensagens.filter((m) => m.role === "tool").map((m) => m.tool_call_id));
  for (const r of resultados) {
    if (!pedidos.has(r.id) || respondidos.has(r.id)) continue;
    estado.mensagens.push({ role: "tool", tool_call_id: r.id, content: caber(r.paraIA) });
    estado.fontes.push(...(r.fontes ?? []).filter((f) => f && typeof f.link === "string" && typeof f.rotulo === "string").slice(0, 4));
  }
  // consulta pedida e não respondida (erro no navegador): a IA precisa da resposta para continuar
  for (const id of pedidos) if (!respondidos.has(id) && !resultados.some((r) => r.id === id)) {
    estado.mensagens.push({ role: "tool", tool_call_id: id, content: JSON.stringify({ erro: "a consulta não respondeu no navegador" }) });
  }
}

function final(conteudo: string | null, estado: Estado): Saida {
  const vistos = new Set<string>();
  const fontes = estado.fontes.filter((f) => !vistos.has(f.link) && vistos.add(f.link)).slice(0, 8);
  // o gpt-oss escreve hífen e espaço "não separáveis": atrapalham copiar o nº do contrato
  const texto = (conteudo ?? "").replace(/[\u2010\u2011]/g, "-").replace(/[\u00a0\u202f]/g, " ").trim();
  return { tipo: "final", resposta: texto || "Não consegui montar a resposta. Tente perguntar de outro jeito.", fontes, consultas: [...new Set(estado.consultas)] };
}
