// Barra de uso da IA gratuita no chat: o tipo que a função "assistente" devolve e o texto mostrado.

/** Quanto resta da IA gratuita do dia (supabase/functions/_shared/assistente/cota.ts) */
export interface Cota {
  restante_pct: number; restante_tokens: number; limite_tokens: number; perguntas_restantes: number;
  perguntas_24h: number; suas_perguntas_24h: number; libera_em?: string;
}

/** Texto da barra e da explicação da cota (o mesmo no balão do chat e nos testes) */
export function textoCota(c: Cota, agora = new Date()): { rotulo: string; detalhe: string; nivel: "ok" | "atencao" | "fim" } {
  const mil = (n: number) => `${Math.round(n / 1000).toLocaleString("pt-BR")} mil`;
  const hora = c.libera_em ? new Date(c.libera_em).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: "America/Manaus" }) : null;
  const dia = c.libera_em && new Date(c.libera_em).toDateString() !== agora.toDateString() ? " de amanhã" : "";
  const nivel = c.restante_pct <= 0 ? "fim" : c.restante_pct < 25 ? "atencao" : "ok";
  const rotulo = nivel === "fim" ? `IA esgotada${hora ? ` · volta ~${hora}${dia}` : ""}` : `IA: ${c.restante_pct}% · ~${c.perguntas_restantes} perguntas`;
  const detalhe = [
    nivel === "fim" ? `A cota gratuita da IA (Groq), compartilhada por todos os usuários do app (${mil(c.limite_tokens)} tokens), acabou por agora.`
      : `Cota gratuita da IA (Groq), compartilhada por todos os usuários do app: restam ${mil(c.restante_tokens)} de ${mil(c.limite_tokens)} tokens (cerca de ${c.perguntas_restantes} perguntas).`,
    "A cota é contada nas últimas 24 h e volta aos poucos.",
    `Perguntas respondidas pela IA nas últimas 24 h: ${c.perguntas_24h} (suas: ${c.suas_perguntas_24h}).`,
    nivel === "fim" ? `Até a cota voltar${hora ? ` (~${hora}${dia})` : ""}, o chat responde com as respostas fixas, sem consultar o banco.`
      : "Quando a cota acabar, o chat responde com as respostas fixas, sem consultar o banco, até ela voltar.",
  ].join(" ");
  return { rotulo, detalhe, nivel };
}
