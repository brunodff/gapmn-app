// Chamada ao Groq (API compatível com a OpenAI) para o assistente: o Groq tira modelos do plano gratuito sem aviso
// (o llama-3.3-70b saiu em 2026), então, se o modelo sumir ou a cota do dia acabar, troca pelo próximo da lista
// que existir na conta; no limite por minuto, espera o tempo que o Groq pede (até 25 s) e tenta de novo.
import type { ChamadaFerramenta, MsgIA } from "./conversa.ts";

export const PREFERENCIA = [/gpt-oss-120b/, /llama-4-maverick/, /qwen3/, /llama-4-scout/, /gpt-oss-20b/, /kimi-k2/, /llama.*70b/];

export interface OpcoesGroq {
  chave: string; modelo?: string; ferramentas?: unknown[]; maxTokens?: number;
  buscar?: typeof fetch; esperar?: (ms: number) => Promise<void>; log?: (s: string) => void;
}
export interface RespostaGroq { content: string | null; tool_calls?: ChamadaFerramenta[]; modelo: string; uso?: Record<string, number>; limites?: Record<string, string>; esperou_ms?: number }

let modeloDaInstancia = "";
const esgotados = new Set<string>();

/** Segundos de espera que o Groq pede ("try again in 7.52s", "in 1m3.5s") */
export function segundosDeEspera(texto: string): number | null {
  const m = /try again in\s+(?:(\d+)m)?\s*([\d.]+)s/i.exec(texto) ?? /try again in\s+(\d+)m(?!s)/i.exec(texto);
  if (!m) return null;
  return Number(m[1] ?? 0) * 60 + Number(m[2] ?? 0);
}
export const cotaDoDia = (texto: string) => /per day|\(TPD\)|\(RPD\)|tokens per day|requests per day/i.test(texto);

async function listarModelos(chave: string, buscar: typeof fetch): Promise<string[]> {
  const r = await buscar("https://api.groq.com/openai/v1/models", { headers: { Authorization: `Bearer ${chave}` } });
  if (!r.ok) throw new Error(`Groq: falha ao listar modelos (HTTP ${r.status})`);
  return (((await r.json()).data ?? []) as { id: unknown }[]).map((m) => String(m.id)).filter((id: string) => !/whisper|tts|guard|embed|vision|compound|prompt|orpheus|playai/i.test(id));
}

/** Próximo modelo da preferência que existe na conta e não esgotou a cota hoje */
export function escolherModelo(ids: string[], evitar: Set<string>): string | null {
  for (const rx of PREFERENCIA) { const id = ids.find((x) => rx.test(x) && !evitar.has(x)); if (id) return id; }
  return ids.find((x) => !evitar.has(x)) ?? null;
}

export async function chamarGroq(mensagens: MsgIA[], op: OpcoesGroq): Promise<RespostaGroq> {
  const buscar = op.buscar ?? fetch;
  const esperar = op.esperar ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  let modelo = modeloDaInstancia || op.modelo || "openai/gpt-oss-120b";
  let semRaciocinio = false;
  let esperou = 0;
  let trocouPorMinuto = false;
  for (let tentativa = 1; tentativa <= 6; tentativa++) {
    const corpo: Record<string, unknown> = { model: modelo, messages: mensagens, temperature: 0.2, max_tokens: op.maxTokens ?? 900 };
    if (op.ferramentas?.length) { corpo.tools = op.ferramentas; corpo.tool_choice = "auto"; }
    if (/gpt-oss/.test(modelo) && !semRaciocinio) corpo.reasoning_effort = "low";
    const r = await buscar("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${op.chave}` }, body: JSON.stringify(corpo),
    });
    if (r.ok) {
      const j = await r.json();
      modeloDaInstancia = modelo;
      const m = j.choices?.[0]?.message ?? {};
      const limites: Record<string, string> = {};
      for (const k of ["limit-tokens", "remaining-tokens", "limit-requests", "remaining-requests"]) { const v = r.headers.get(`x-ratelimit-${k}`); if (v) limites[k] = v; }
      return { content: m.content ?? null, tool_calls: m.tool_calls, modelo, uso: j.usage, limites, esperou_ms: esperou };
    }
    const texto = await r.text();
    op.log?.(`groq ${modelo} HTTP ${r.status}: ${texto.slice(0, 200)}`);
    if (r.status === 400 && /reasoning_effort/i.test(texto)) { semRaciocinio = true; continue; }
    if (r.status === 400 && /tool_use_failed|failed_generation/i.test(texto) && tentativa <= 2) continue;
    const sumiu = (r.status === 404 || r.status === 400) && /model_not_found|decommissioned|does not exist|not supported/i.test(texto);
    if (sumiu || (r.status === 429 && cotaDoDia(texto))) {
      esgotados.add(modelo);
      const proximo = escolherModelo(await listarModelos(op.chave, buscar), esgotados);
      if (!proximo) throw new Error("A cota gratuita de IA do dia acabou. Tente amanhã.");
      modelo = proximo; modeloDaInstancia = ""; semRaciocinio = false;
      continue;
    }
    if (r.status === 429) {
      const s = segundosDeEspera(texto) ?? 5;
      // limite por minuto: cada modelo tem a sua cota; trocar é mais rápido que esperar (uma vez por chamada)
      if (s > 6 && !trocouPorMinuto) {
        const outro = escolherModelo(await listarModelos(op.chave, buscar), new Set([...esgotados, modelo]));
        if (outro) { trocouPorMinuto = true; modelo = outro; semRaciocinio = false; continue; }
      }
      if (s > 25) throw new Error(`Muitas perguntas agora: o limite da IA gratuita libera em ${Math.ceil(s)} s.`);
      await esperar(s * 1000 + 300);
      esperou += s * 1000 + 300;
      continue;
    }
    if (r.status === 413) throw new Error("A consulta ficou grande demais para a IA gratuita. Faça uma pergunta mais específica.");
    throw new Error(`A IA respondeu com erro (HTTP ${r.status}).`);
  }
  throw new Error("A IA não respondeu depois de várias tentativas.");
}
