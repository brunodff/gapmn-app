// @ts-nocheck
/**
 * Edge Function: assistente (nov/2026) — o chat do gapmn.app responde com os dados do banco.
 *
 * A IA (Groq, plano gratuito; gpt-oss-120b ou o próximo modelo disponível) escolhe as consultas
 * (../_shared/assistente/ferramentas.ts), o servidor as roda com o login de quem pergunta (as mesmas regras
 * de acesso do app) e a IA responde no chat com os dados e as telas onde eles estão. Empenhos e crédito
 * (planilhas grandes do Tesouro Gerencial) rodam no navegador: a função devolve "pendentes" e o app chama de
 * novo com os resultados ("continuar").
 *
 * POST { pergunta, historico?: [{papel: "usuario"|"assistente", texto}] }
 *   ou { continuar: { estado, resultados: [{id, paraIA, fontes}] } }
 * → { resposta, fontes: [{rotulo, link, externo?}], consultas, modelo }
 *   ou { pendentes: [{id, nome, args}], estado }
 *
 * Só usuário logado (verify_jwt ligado). Teste no servidor: cabeçalho x-assistente-teste = secret
 * ASSISTENTE_TESTE (32+ caracteres; sem o secret, esse caminho não existe).
 *
 * Deploy: supabase functions deploy assistente
 * Secrets: GROQ_API_KEY (o mesmo da Pesquisa de Preços); opcional GROQ_MODEL_ASSISTENTE.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { DEFINICOES, DO_NAVEGADOR, executarServidor } from "../_shared/assistente/ferramentas.ts";
import { juntarResultados, rodar, type MsgIA } from "../_shared/assistente/conversa.ts";
import { chamarGroq } from "../_shared/assistente/groq.ts";
import { instrucoes } from "../_shared/assistente/prompt.ts";

const URL_SB = Deno.env.get("SUPABASE_URL") ?? "";
const ANON = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const SERVICO = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const GROQ = Deno.env.get("GROQ_API_KEY") ?? "";
const MODELO = Deno.env.get("GROQ_MODEL_ASSISTENTE") ?? "openai/gpt-oss-120b";
const TESTE = Deno.env.get("ASSISTENTE_TESTE") ?? "";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (corpo: unknown, status = 200) =>
  new Response(JSON.stringify(corpo), { status, headers: { ...CORS, "content-type": "application/json; charset=utf-8" } });
const hojeManaus = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Manaus", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
const corta = (s: unknown, n: number) => String(s ?? "").slice(0, n);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ erro: "use POST" }, 405);
  if (!GROQ) return json({ erro: "GROQ_API_KEY não configurada no Supabase" }, 500);

  // quem pergunta: o login do app (ou o teste do servidor, se o secret existir)
  const auth = req.headers.get("authorization") ?? "";
  let db;
  const teste = TESTE.length >= 32 && req.headers.get("x-assistente-teste") === TESTE;
  if (teste) db = createClient(URL_SB, SERVICO, { auth: { persistSession: false } });
  else {
    db = createClient(URL_SB, ANON, { global: { headers: { Authorization: auth } }, auth: { persistSession: false } });
    const { data } = await db.auth.getUser(auth.replace(/^Bearer\s+/i, ""));
    if (!data?.user) return json({ erro: "Faça login no gapmn.app para usar o assistente." }, 401);
  }

  let corpo;
  try { corpo = await req.json(); } catch { return json({ erro: "corpo inválido" }, 400); }
  const hoje = hojeManaus();
  if (teste && corpo?.modelos) {
    const r = await fetch("https://api.groq.com/openai/v1/models", { headers: { Authorization: `Bearer ${GROQ}` } });
    return json({ modelos: ((await r.json()).data ?? []).map((m) => m.id) });
  }
  const sistema: MsgIA = { role: "system", content: instrucoes(hoje) };

  // conversa nova ou continuação depois das consultas do navegador
  let estado;
  if (corpo?.continuar?.estado) {
    const e = corpo.continuar.estado;
    const msgs = (Array.isArray(e.mensagens) ? e.mensagens : []).filter((m) => m && m.role !== "system").slice(-24)
      .map((m) => ({ role: m.role, content: corta(m.content, 12000), ...(m.tool_calls ? { tool_calls: m.tool_calls.slice(0, 5) } : {}), ...(m.tool_call_id ? { tool_call_id: String(m.tool_call_id) } : {}) }));
    estado = { mensagens: [sistema, ...msgs], fontes: Array.isArray(e.fontes) ? e.fontes.slice(0, 20) : [], consultas: Array.isArray(e.consultas) ? e.consultas.slice(0, 20) : [], rodadas: Math.min(Number(e.rodadas) || 0, 4) };
    juntarResultados(estado, Array.isArray(corpo.continuar.resultados) ? corpo.continuar.resultados.slice(0, 5) : []);
  } else {
    const pergunta = corta(corpo?.pergunta, 1500).trim();
    if (!pergunta) return json({ erro: "faça uma pergunta" }, 400);
    const historico = (Array.isArray(corpo?.historico) ? corpo.historico : []).slice(-6)
      .map((h) => ({ role: h?.papel === "assistente" ? "assistant" : "user", content: corta(h?.texto, 1500) }))
      .filter((h) => h.content);
    estado = { mensagens: [sistema, ...historico, { role: "user", content: pergunta }], fontes: [], consultas: [], rodadas: 0 };
  }

  let modelo = "";
  const uso = { entrada: 0, saida: 0 };
  const diag: unknown[] = [];
  try {
    const saida = await rodar(estado, {
      doNavegador: DO_NAVEGADOR,
      // uma rodada de consultas (várias em paralelo) e a resposta: o plano gratuito do Groq tem poucos tokens por minuto
      maxRodadas: 1,
      executar: async (nome, args) => {
        const r = await executarServidor(nome, args, { db, hoje });
        if (teste) diag.push({ consulta: nome, args, total: r.paraIA?.total ?? r.paraIA?.total_no_filtro, obs: r.paraIA?.obs_busca });
        return r;
      },
      chamarIA: async (mensagens, comFerramentas) => {
        const r = await chamarGroq(mensagens, { chave: GROQ, modelo: MODELO, ferramentas: comFerramentas ? DEFINICOES : undefined, maxTokens: comFerramentas ? 700 : 1500, log: console.log });
        modelo = r.modelo;
        uso.entrada += r.uso?.prompt_tokens ?? 0; uso.saida += r.uso?.completion_tokens ?? 0;
        if (teste) diag.push({ modelo: r.modelo, entrada: r.uso?.prompt_tokens, saida: r.uso?.completion_tokens, esperou_ms: r.esperou_ms, limites: r.limites });
        return r;
      },
    });
    if (saida.tipo === "pendente") return json({ pendentes: saida.pendentes, estado: saida.estado, modelo, ...(teste ? { diag } : {}) });
    return json({ resposta: saida.resposta, fontes: saida.fontes, consultas: saida.consultas, modelo, ...(teste ? { uso, diag } : {}) });
  } catch (e) {
    console.error("assistente:", e);
    return json({ erro: String(e?.message ?? e) }, 502);
  }
});
