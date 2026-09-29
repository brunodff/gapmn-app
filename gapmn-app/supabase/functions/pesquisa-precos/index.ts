// @ts-nocheck
/**
 * Edge Function: pesquisa-precos
 * Ponte entre o app e o MCP Compras.gov.br (servidor MCP hospedado, Streamable HTTP).
 *
 * O MCP não expõe CORS, então o navegador não fala com ele direto: esta função
 * faz o handshake MCP (initialize → notifications/initialized), guarda o
 * Mcp-Session-Id enquanto o isolate estiver quente e repassa tools/call.
 *
 * Ações (POST JSON):
 *   { action: "call", tool: "<nome>", arguments: {...} }  → { result }
 *   { action: "extrair_itens", texto: "<texto do TR>" }   → { itens: [...] }
 *
 * Deploy (com verificação de JWT — só usuários logados):
 *   supabase functions deploy pesquisa-precos
 *
 * Secrets:
 *   GROQ_API_KEY      (já usado pelo claude-chat — necessário para extrair_itens)
 *   MCP_COMPRAS_URL   (opcional; padrão = servidor público oficial)
 */

import { corsHeaders } from "../_shared/cors.ts";

const MCP_URL = Deno.env.get("MCP_COMPRAS_URL") ?? "https://mcp-compras.up.railway.app/mcp";
const GROQ_API_KEY = Deno.env.get("GROQ_API_KEY") ?? "";
const GROQ_MODEL = Deno.env.get("GROQ_MODEL") ?? "llama-3.3-70b-versatile";
const PROTOCOL_VERSION = "2025-06-18";

// Só tools de leitura usadas pelo módulo. Evita que a função vire proxy aberto
// para as 100 tools do MCP.
const TOOLS_PERMITIDAS = new Set([
  "compras_pesquisar_precos_para_etp",
  "compras_pesquisar_preco_material",
  "compras_pesquisar_preco_servico",
  "compras_catmat_consultar",
  "compras_catser_consultar",
  "compras_arp_itens_listar",
  "compras_versao",
]);

let sessao: string | null = null;
let rpcId = 0;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

/** Lê a resposta JSON-RPC, venha ela em application/json ou em SSE. */
async function lerResposta(res: Response, id: number) {
  const tipo = res.headers.get("content-type") ?? "";
  const corpo = await res.text();
  if (tipo.includes("text/event-stream")) {
    for (const linha of corpo.split(/\r?\n/)) {
      if (!linha.startsWith("data:")) continue;
      try {
        const msg = JSON.parse(linha.slice(5).trim());
        if (msg.id === id) return msg;
      } catch { /* evento sem JSON — ignora */ }
    }
    throw new Error("Resposta SSE do MCP sem mensagem para a requisição");
  }
  return JSON.parse(corpo);
}

async function postMcp(payload: Record<string, unknown>) {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "Accept": "application/json, text/event-stream",
    "mcp-protocol-version": PROTOCOL_VERSION,
  };
  if (sessao) headers["mcp-session-id"] = sessao;
  return await fetch(MCP_URL, { method: "POST", headers, body: JSON.stringify(payload) });
}

async function iniciarSessao() {
  sessao = null;
  const id = ++rpcId;
  const res = await postMcp({
    jsonrpc: "2.0", id, method: "initialize",
    params: {
      protocolVersion: PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: { name: "gapmn-app", version: "1.0" },
    },
  });
  if (!res.ok) throw new Error(`MCP initialize falhou (HTTP ${res.status})`);
  sessao = res.headers.get("mcp-session-id");
  await lerResposta(res, id);
  await postMcp({ jsonrpc: "2.0", method: "notifications/initialized" });
}

async function chamarTool(nome: string, args: Record<string, unknown>) {
  if (!sessao) await iniciarSessao();

  for (let tentativa = 0; tentativa < 3; tentativa++) {
    const id = ++rpcId;
    const res = await postMcp({
      jsonrpc: "2.0", id, method: "tools/call",
      params: { name: nome, arguments: args },
    });

    // Servidor reiniciou e perdeu a sessão → refaz o handshake e repete.
    if (res.status === 404 || res.status === 400) {
      await iniciarSessao();
      continue;
    }
    // Cold start / sobrecarga → backoff curto.
    if (res.status >= 500 || res.status === 429) {
      await new Promise((r) => setTimeout(r, 800 * (tentativa + 1)));
      continue;
    }
    if (!res.ok) throw new Error(`MCP respondeu HTTP ${res.status}`);

    const msg = await lerResposta(res, id);
    if (msg.error) throw new Error(msg.error.message ?? "Erro JSON-RPC do MCP");
    const r = msg.result ?? {};
    const texto = r.content?.find((c: any) => c.type === "text")?.text ?? "";
    if (r.isError) throw new Error(texto || "A tool do MCP devolveu erro");
    if (r.structuredContent) return r.structuredContent;
    try { return JSON.parse(texto); } catch { return { texto }; }
  }
  throw new Error("MCP indisponível após 3 tentativas");
}

// ── Extração de itens do TR via LLM ─────────────────────────────────────────

const PROMPT_EXTRACAO = `Você extrai a lista de itens de um Termo de Referência (TR) de contratação pública brasileira.
Responda APENAS com JSON no formato:
{"objeto": "<objeto da contratação, uma frase>", "itens": [{"numero": 1, "descricao": "<especificação resumida, até 300 caracteres>", "tipo": "material" | "servico", "codigo": <código CATMAT ou CATSER como número, ou null>, "unidade": "<unidade de fornecimento/medida>", "quantidade": <número ou null>, "valor_unitario": <valor unitário estimado que consta no TR, número, ou null>}]}
Regras:
- Liste cada item/lote da tabela de itens do TR, na ordem em que aparecem.
- "codigo" é o código CATMAT (materiais) ou CATSER (serviços) informado no TR. Nunca invente código: se não houver, use null.
- "tipo" = "servico" quando o código for CATSER ou o item for prestação de serviço; senão "material".
- Quantidade: use a quantidade total do item. Números no formato brasileiro (1.000,50) devem virar 1000.5.
- Não inclua itens repetidos nem linhas de total.`;

// O Groq aposenta modelos sem aviso. Se o configurado sumir, escolhe o melhor
// disponível na conta pela ordem de preferência abaixo.
const PREFERENCIA_MODELOS = [/gpt-oss-120b/, /llama.*70b/, /llama-4.*maverick/, /qwen.*32b/, /llama-4.*scout/, /gpt-oss-20b/, /llama/];
let modeloAtual = GROQ_MODEL;

async function escolherModeloDisponivel(): Promise<string> {
  const res = await fetch("https://api.groq.com/openai/v1/models", {
    headers: { "Authorization": `Bearer ${GROQ_API_KEY}` },
  });
  if (!res.ok) throw new Error(`Groq: falha ao listar modelos (HTTP ${res.status})`);
  const ids: string[] = ((await res.json()).data ?? [])
    .map((m: any) => String(m.id))
    .filter((id: string) => !/whisper|tts|guard|embed|vision|compound/i.test(id));
  for (const rx of PREFERENCIA_MODELOS) {
    const achado = ids.find((id) => rx.test(id));
    if (achado) return achado;
  }
  if (ids.length) return ids[0];
  throw new Error("Nenhum modelo de texto disponível na conta Groq");
}

async function chamarGroq(texto: string) {
  return await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": `Bearer ${GROQ_API_KEY}` },
    body: JSON.stringify({
      model: modeloAtual,
      temperature: 0,
      max_tokens: 4096,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: PROMPT_EXTRACAO },
        { role: "user", content: texto },
      ],
    }),
  });
}

async function extrairItens(texto: string) {
  if (!GROQ_API_KEY) throw new Error("GROQ_API_KEY não configurada no Supabase");
  let res = await chamarGroq(texto);
  if (res.status === 404 || res.status === 400) {
    const corpo = await res.text();
    if (!/model_not_found|decommissioned|does not exist/i.test(corpo)) {
      throw new Error(`Groq respondeu HTTP ${res.status}: ${corpo.slice(0, 300)}`);
    }
    modeloAtual = await escolherModeloDisponivel();
    console.log(`pesquisa-precos: modelo Groq trocado para ${modeloAtual}`);
    res = await chamarGroq(texto);
  }
  if (!res.ok) throw new Error(`Groq respondeu HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const data = await res.json();
  const conteudo = data.choices?.[0]?.message?.content ?? "{}";
  const obj = JSON.parse(conteudo);
  return { objeto: obj.objeto ?? null, itens: Array.isArray(obj.itens) ? obj.itens : [] };
}

// ── Handler ────────────────────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const body = await req.json();

    if (body.action === "call") {
      const tool = String(body.tool ?? "");
      if (!TOOLS_PERMITIDAS.has(tool)) return json({ error: `Tool não permitida: ${tool}` }, 400);
      const result = await chamarTool(tool, body.arguments ?? {});
      return json({ result });
    }

    if (body.action === "extrair_itens") {
      const texto = String(body.texto ?? "").slice(0, 40000);
      if (texto.trim().length < 50) return json({ error: "Texto do TR vazio ou curto demais" }, 400);
      return json(await extrairItens(texto));
    }

    return json({ error: "action inválida (use 'call' ou 'extrair_itens')" }, 400);
  } catch (e: any) {
    console.error("pesquisa-precos:", e);
    return json({ error: e?.message ?? String(e) }, 502);
  }
});
