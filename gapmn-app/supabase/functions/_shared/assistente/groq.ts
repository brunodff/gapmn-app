// Chamada ao Groq (API compatível com a OpenAI) para o assistente: o Groq tira modelos do plano gratuito sem aviso
// (o llama-3.3-70b saiu em 2026), então, se o modelo sumir ou a cota do dia acabar, troca pelo próximo da lista
// que existir na conta; no limite por minuto, espera o tempo que o Groq pede (até 25 s) e tenta de novo.
import type { ChamadaFerramenta, MsgIA } from "./conversa.ts";

export const PREFERENCIA = [/gpt-oss-120b/, /llama-4-maverick/, /qwen3/, /llama-4-scout/, /gpt-oss-20b/, /kimi-k2/, /llama.*70b/];

export interface OpcoesGroq {
  chave: string; modelo?: string; ferramentas?: unknown[]; maxTokens?: number;
  buscar?: typeof fetch; esperar?: (ms: number) => Promise<void>; log?: (s: string) => void;
  /** modelos sem cota até o horário (ms), já avisados pelo Groq em outra chamada (tabela assistente_uso) */
  evitar?: Iterable<[string, number]>;
  /** o Groq avisou que a cota do dia do modelo acabou (texto do aviso, espera pedida em s) */
  aoEsgotar?: (modelo: string, texto: string, segundos: number | null) => void;
  agora?: () => number;
}
export interface RespostaGroq { content: string | null; tool_calls?: ChamadaFerramenta[]; modelo: string; uso?: Record<string, number>; limites?: Record<string, string>; esperou_ms?: number }

let modeloDaInstancia = "";
/** modelo → até quando está sem cota (a cota do Groq volta aos poucos: não vale para sempre) */
const esgotados = new Map<string, number>();
let listagem: { chave: string; em: number; ids: string[] } | null = null;
/** Para os testes: esquece o modelo, os esgotados e a lista de modelos guardados na instância */
export function esquecerEstado() { modeloDaInstancia = ""; esgotados.clear(); listagem = null; }

/** Segundos de espera que o Groq pede ("try again in 7.52s", "in 1m3.5s") */
export function segundosDeEspera(texto: string): number | null {
  const m = /try again in\s+(?:(\d+)m)?\s*([\d.]+)s/i.exec(texto) ?? /try again in\s+(\d+)m(?!s)/i.exec(texto);
  if (!m) return null;
  return Number(m[1] ?? 0) * 60 + Number(m[2] ?? 0);
}
export const cotaDoDia = (texto: string) => /per day|\(TPD\)|\(RPD\)|tokens per day|requests per day/i.test(texto);

/** Modelos de texto da conta (guardados por 1 hora na instância) */
export async function listarModelos(chave: string, buscar: typeof fetch = fetch): Promise<string[]> {
  if (listagem && listagem.chave === chave && Date.now() - listagem.em < 3600_000) return listagem.ids;
  const r = await buscar("https://api.groq.com/openai/v1/models", { headers: { Authorization: `Bearer ${chave}` } });
  if (!r.ok) throw new Error(`Groq: falha ao listar modelos (HTTP ${r.status})`);
  const ids = (((await r.json()).data ?? []) as { id: unknown }[]).map((m) => String(m.id)).filter((id: string) => !/whisper|tts|guard|embed|vision|compound|prompt|orpheus|playai/i.test(id));
  listagem = { chave, em: Date.now(), ids };
  return ids;
}

/** Os modelos que o assistente usa, na ordem da preferência (a cota do chat é a soma deles) */
export const modelosDaPreferencia = (ids: readonly string[]) => PREFERENCIA.flatMap((rx) => ids.filter((x) => rx.test(x))).filter((x, i, a) => a.indexOf(x) === i);

/** Próximo modelo da preferência que existe na conta e não esgotou a cota hoje */
export function escolherModelo(ids: string[], evitar: Set<string>): string | null {
  for (const rx of PREFERENCIA) { const id = ids.find((x) => rx.test(x) && !evitar.has(x)); if (id) return id; }
  return ids.find((x) => !evitar.has(x)) ?? null;
}

export async function chamarGroq(mensagens: MsgIA[], op: OpcoesGroq): Promise<RespostaGroq> {
  const buscar = op.buscar ?? fetch;
  const esperar = op.esperar ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  const agora = op.agora ?? Date.now;
  for (const [m, ate] of op.evitar ?? []) if (ate > (esgotados.get(m) ?? 0)) esgotados.set(m, ate);
  for (const [m, ate] of esgotados) if (ate <= agora()) esgotados.delete(m);
  const semCota = () => new Set(esgotados.keys());
  let modelo = modeloDaInstancia || op.modelo || "openai/gpt-oss-120b";
  if (esgotados.has(modelo)) {
    const proximo = escolherModelo(await listarModelos(op.chave, buscar), semCota());
    if (!proximo) throw new Error("A cota gratuita de IA do dia acabou. Tente mais tarde.");
    modelo = proximo; modeloDaInstancia = "";
  }
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
      const s = sumiu ? null : segundosDeEspera(texto);
      // modelo que sumiu fica de fora até a lista de modelos ser relida; cota do dia, até a hora que o Groq pede
      esgotados.set(modelo, agora() + (s ?? 3600) * 1000);
      if (!sumiu) op.aoEsgotar?.(modelo, texto, s);
      const proximo = escolherModelo(await listarModelos(op.chave, buscar), semCota());
      if (!proximo) throw new Error("A cota gratuita de IA do dia acabou. Tente mais tarde.");
      modelo = proximo; modeloDaInstancia = ""; semRaciocinio = false;
      continue;
    }
    if (r.status === 429) {
      const s = segundosDeEspera(texto) ?? 5;
      // limite por minuto: cada modelo tem a sua cota; trocar é mais rápido que esperar (uma vez por chamada)
      if (s > 6 && !trocouPorMinuto) {
        const outro = escolherModelo(await listarModelos(op.chave, buscar), new Set([...esgotados.keys(), modelo]));
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
