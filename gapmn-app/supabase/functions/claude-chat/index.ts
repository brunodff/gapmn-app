// @ts-nocheck
/**
 * Edge Function: claude-chat
 * Proxy para a API do Groq (gratuito). Sem uso no app desde nov/2026: o chat usa a função "assistente".
 * Exige login (antes aceitava qualquer chamada e podia gastar a cota do Groq).
 *
 * Deploy:
 *   supabase functions deploy claude-chat
 *
 * Secret:
 *   supabase secrets set GROQ_API_KEY=gsk_...
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";

const GROQ_API_KEY = Deno.env.get("GROQ_API_KEY") ?? "";

const SYSTEM_PROMPT = `Você é o assistente do Aplicativo do GAP-MN (Grupamento de Apoio de Manaus, Força Aérea Brasileira, UASG 120630).

Sua função EXCLUSIVA é responder perguntas sobre os dados do aplicativo:
- Contratos gerenciados pela SCON (contratado, objeto, valor, fiscal, vigência, saldo a empenhar, a liquidar)
- Processos licitatórios da SLIC (número, modalidade, situação, objeto, valor estimado, valor homologado, SRP)
- Empenhos da SEO (número, valor, liquidado, saldo, indicador, PI)
- Indicadores de Lotação da SEO (conta corrente, dotação, utilização, saldo, natureza, ação)

Quando a pergunta incluir dados do banco de dados (fornecidos no CONTEXTO), use esses dados para responder com precisão e detalhes. Cite os valores, datas e nomes exatamente como aparecem nos dados.

Se a pergunta for sobre algo FORA do aplicativo (legislação genérica, outros órgãos, assuntos alheios), responda: "Só consigo responder sobre os dados do Aplicativo do GAP-MN. Para dúvidas jurídicas gerais, consulte um especialista."

Responda sempre em português do Brasil, de forma direta e objetiva. Não invente dados que não estejam no contexto fornecido.`;

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  // só usuário logado do app (a chave pública sozinha não basta)
  const auth = req.headers.get("authorization") ?? "";
  const sb = createClient(Deno.env.get("SUPABASE_URL") ?? "", Deno.env.get("SUPABASE_ANON_KEY") ?? "", { global: { headers: { Authorization: auth } } });
  const { data: quem } = await sb.auth.getUser(auth.replace(/^Bearer\s+/i, ""));
  if (!quem?.user) {
    return new Response(JSON.stringify({ error: "login necessário" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }

  try {
    const body = await req.json();
    const { messages, system, context } = body;

    if (!messages || !Array.isArray(messages)) {
      return new Response(JSON.stringify({ error: "messages required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Monta system prompt com contexto do banco de dados (se houver)
    let systemContent = system || SYSTEM_PROMPT;
    if (context && context.trim()) {
      systemContent += `\n\n--- CONTEXTO DO BANCO DE DADOS (use estes dados para responder) ---\n${context}`;
    }

    const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${GROQ_API_KEY}`,
      },
      body: JSON.stringify({
        model: Deno.env.get("GROQ_MODEL") ?? "openai/gpt-oss-120b",
        max_tokens: 1024,
        messages: [
          { role: "system", content: systemContent },
          ...messages,
        ],
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      console.error("Groq error:", err);
      return new Response(JSON.stringify({ error: "Erro ao consultar Groq API", detail: err }), {
        status: response.status,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const data = await response.json();
    const text = data.choices?.[0]?.message?.content ?? "";

    return new Response(JSON.stringify({ reply: text }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
