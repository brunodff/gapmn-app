// Cota da IA gratuita (Groq) para a barra do chat: quanto ainda resta antes de o chat voltar às respostas fixas.
// O Groq só informa nos cabeçalhos as chamadas do dia e os tokens do minuto; o limite que acaba primeiro são os
// tokens por dia de cada modelo (200 mil; cada pergunta gasta 3 a 6 mil). Por isso as funções gravam os tokens de
// cada chamada na tabela assistente_uso e a conta é a soma das últimas 24 h (a cota do Groq libera aos poucos,
// em janela móvel). Quando o Groq avisa que a cota acabou ("Limit 200000, Used 199912 … try again in 24m"), esse
// aviso vale mais que a soma: o modelo fica esgotado até a hora indicada e o uso informado corrige a estimativa
// (a Pesquisa de Preços e testes também gastam a mesma cota).

/** Tokens por dia de cada modelo no plano gratuito (console.groq.com/docs/rate-limits, nov/2026: gpt-oss-120b,
 *  gpt-oss-20b e qwen3.8-27b). O limite que o Groq informa no aviso de cota esgotada substitui este. */
export const TPD_PADRAO = 200_000;
export const JANELA_MS = 24 * 3600_000;
/** Tokens de uma pergunta, enquanto não há perguntas suficientes nas últimas 24 h para tirar a média */
export const POR_PERGUNTA_PADRAO = 4500;

export interface LinhaUso {
  em: string; usuario: string | null; origem: string; modelo: string; tokens: number; resposta: boolean;
  esgotado_ate: string | null; limite_dia: number | null; usado_dia: number | null;
}
export type NovaLinhaUso = Partial<LinhaUso> & { modelo: string };

export interface Cota {
  /** 0 a 100: quanto resta da cota de todos os modelos somados */
  restante_pct: number;
  restante_tokens: number;
  limite_tokens: number;
  /** estimativa pela média de tokens por pergunta das últimas 24 h */
  perguntas_restantes: number;
  /** perguntas respondidas pela IA nas últimas 24 h: todas e as de quem pergunta */
  perguntas_24h: number;
  suas_perguntas_24h: number;
  modelos: { modelo: string; restante_pct: number; esgotado_ate?: string }[];
  /** cota zerada: quando o primeiro modelo volta */
  libera_em?: string;
}

/** Limite e uso do aviso de cota do dia do Groq ("… tokens per day (TPD): Limit 200000, Used 199912, Requested 3512 …") */
export function lerEsgotado(texto: string): { limite: number | null; usado: number | null } {
  // o aviso de chamadas por dia (RPD) tem o mesmo formato, mas conta chamadas, não tokens
  const m = /tokens per day|\(TPD\)/i.test(texto) ? /Limit\s+(\d+)\s*,\s*Used\s+(\d+)/i.exec(texto) : null;
  return m ? { limite: Number(m[1]), usado: Number(m[2]) } : { limite: null, usado: null };
}

const ms = (iso: string | null | undefined) => (iso ? Date.parse(iso) : NaN);

export function calcularCota(linhas: readonly LinhaUso[], modelos: readonly string[], agora: number, usuario: string | null): Cota {
  const recentes = linhas.filter((l) => agora - ms(l.em) < JANELA_MS);
  const lista = modelos.length ? [...modelos] : [...new Set(recentes.map((l) => l.modelo))];
  let limiteTotal = 0, restanteTotal = 0;
  const porModelo: Cota["modelos"] = [];
  for (const modelo of lista) {
    const dele = recentes.filter((l) => l.modelo === modelo).sort((a, b) => ms(a.em) - ms(b.em));
    const avisos = dele.filter((l) => l.usado_dia != null || l.limite_dia != null || l.esgotado_ate);
    const aviso = avisos[avisos.length - 1];
    const limite = aviso?.limite_dia ?? TPD_PADRAO;
    let usado = dele.reduce((t, l) => t + (l.tokens || 0), 0);
    if (aviso?.usado_dia != null) {
      // o uso informado pelo Groq vai saindo da janela de 24 h; depois dele, soma o que foi gasto
      const t = ms(aviso.em);
      const depois = dele.filter((l) => ms(l.em) > t).reduce((s, l) => s + (l.tokens || 0), 0);
      usado = Math.max(usado, aviso.usado_dia * Math.max(0, 1 - (agora - t) / JANELA_MS) + depois);
    }
    const ate = Math.max(...dele.map((l) => ms(l.esgotado_ate)).filter((x) => x > agora), -Infinity);
    const restante = Number.isFinite(ate) ? 0 : Math.min(limite, Math.max(0, limite - usado));
    limiteTotal += limite; restanteTotal += restante;
    porModelo.push({ modelo, restante_pct: Math.round((100 * restante) / limite), ...(Number.isFinite(ate) ? { esgotado_ate: new Date(ate).toISOString() } : {}) });
  }
  const doChatLinhas = recentes.filter((l) => l.origem === "assistente");
  const respostas = doChatLinhas.filter((l) => l.resposta);
  const doChat = doChatLinhas.reduce((t, l) => t + (l.tokens || 0), 0);
  const media = respostas.length >= 3 ? doChat / respostas.length : POR_PERGUNTA_PADRAO;
  const pct = limiteTotal ? (100 * restanteTotal) / limiteTotal : 0;
  const voltas = porModelo.map((m) => ms(m.esgotado_ate)).filter((x) => x > agora);
  return {
    // arredonda para baixo perto do fim: "1%" ainda responde, "0%" já não
    restante_pct: restanteTotal > 0 ? Math.max(1, Math.floor(pct)) : 0,
    restante_tokens: Math.round(restanteTotal), limite_tokens: limiteTotal,
    perguntas_restantes: Math.floor(restanteTotal / Math.max(1, media)),
    perguntas_24h: respostas.length,
    suas_perguntas_24h: usuario ? respostas.filter((l) => l.usuario === usuario).length : 0,
    modelos: porModelo,
    ...(restanteTotal <= 0 && voltas.length ? { libera_em: new Date(Math.min(...voltas)).toISOString() } : {}),
  };
}

// ── Leitura e gravação (PostgREST com a chave de serviço; a tabela não tem política para o app) ──
const COLS = "em,usuario,origem,modelo,tokens,resposta,esgotado_ate,limite_dia,usado_dia";

export async function lerUso(url: string, chave: string, agora: number, buscar: typeof fetch = fetch): Promise<LinhaUso[] | null> {
  if (!url || !chave) return null;
  const desde = new Date(agora - JANELA_MS).toISOString();
  const r = await buscar(`${url}/rest/v1/assistente_uso?select=${COLS}&em=gt.${encodeURIComponent(desde)}&order=em.asc&limit=10000`,
    { headers: { apikey: chave, Authorization: `Bearer ${chave}` } });
  if (!r.ok) return null; // tabela ainda não criada: o chat segue sem a barra
  return (await r.json()) as LinhaUso[];
}

export async function gravarUso(url: string, chave: string, linhas: readonly NovaLinhaUso[], buscar: typeof fetch = fetch): Promise<boolean> {
  if (!url || !chave || !linhas.length) return false;
  // o PostgREST grava várias linhas de uma vez só se todas tiverem as mesmas colunas
  const agora = new Date().toISOString();
  const corpo = linhas.map((l) => ({
    em: l.em ?? agora, usuario: l.usuario ?? null, origem: l.origem ?? "assistente", modelo: l.modelo, tokens: Math.round(l.tokens ?? 0),
    resposta: !!l.resposta, esgotado_ate: l.esgotado_ate ?? null, limite_dia: l.limite_dia ?? null, usado_dia: l.usado_dia ?? null,
  }));
  const r = await buscar(`${url}/rest/v1/assistente_uso`, {
    method: "POST",
    headers: { apikey: chave, Authorization: `Bearer ${chave}`, "Content-Type": "application/json", Prefer: "return=minimal" },
    body: JSON.stringify(corpo),
  });
  return r.ok;
}
