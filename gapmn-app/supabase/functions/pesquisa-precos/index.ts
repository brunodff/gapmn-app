// @ts-nocheck
/**
 * Edge Function: pesquisa-precos
 * Ponte entre o app e a API de Dados Abertos do Compras.gov.br (módulos Pesquisa de Preço, Material e Serviço).
 *
 * A API não libera CORS para o navegador ("Invalid CORS request"), então esta função consulta por ele.
 * Até 23/11/2026 a consulta passava pelo servidor MCP Compras (mcp-compras.up.railway.app), que saiu do ar
 * (aplicação e repositório apagados): agora a função lê a API direto. Os nomes das "tools" continuam os
 * mesmos para o app não mudar; a estatística (Tukey, faixas) é feita no app (src/lib/mcpCompras.ts).
 *
 * Ações (POST JSON):
 *   { action: "call", tool: "<nome>", arguments: {...} }  → { result }
 *     compras_versao                      → a API respondeu (status da tela)
 *     compras_pesquisar_precos_para_etp   { tipo, codigo_item_catalogo, periodo_meses, max_paginas, uf? }
 *                                         → { amostra_total, registros, data_inicio, data_fim, _registros_truncados_em }
 *     compras_atas_para_etp               { tipo, codigo_item_catalogo, meses?, max_paginas? }
 *                                         → itens de atas de registro de preços (art. 5º, II), com unidade, UF e órgão
 *     compras_catmat_consultar / compras_catser_consultar { codigo_item } → { encontrado, item }
 *   A consulta de itens do PNCP por código (modulo-contratacoes/2_consultarItensContratacoes…) não responde nem para
 *   3 dias (testado em 23/11/2026), por isso as contratações do PNCP não entram como fonte separada.
 *   { action: "extrair_itens", texto: "<texto do TR>" }   → { itens: [...] }
 *
 * Deploy (com verificação de JWT — só usuários logados):
 *   supabase functions deploy pesquisa-precos --project-ref <ref> --use-api
 *
 * Secrets:
 *   GROQ_API_KEY      (já usado pelo claude-chat — necessário para extrair_itens)
 */

import { corsHeaders } from "../_shared/cors.ts";
import { gravarUso } from "../_shared/assistente/cota.ts";

const API = "https://dadosabertos.compras.gov.br";
const TAM_PAGINA = 500;
const GROQ_API_KEY = Deno.env.get("GROQ_API_KEY") ?? "";
const GROQ_MODEL = Deno.env.get("GROQ_MODEL") ?? "openai/gpt-oss-120b"; // o llama-3.3-70b saiu do plano gratuito em 2026

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

/** GET com até 3 tentativas (a API oscila); 4xx volta com a mensagem da API */
async function buscarJson(url: string, ms = 60_000): Promise<any> {
  let ultimo = "";
  for (let t = 1; t <= 3; t++) {
    try {
      const r = await fetch(url, { headers: { accept: "application/json", "user-agent": "GAPMN-App/1.0 (gapmn.app)" }, signal: AbortSignal.timeout(ms) });
      if (r.ok) return await r.json();
      const corpo = await r.text();
      if (r.status < 500 && r.status !== 429) {
        let detalhe = corpo.slice(0, 200);
        try { const j = JSON.parse(corpo); detalhe = j.detail ?? j.message ?? detalhe; } catch { /* texto */ }
        throw Object.assign(new Error(`A API do Compras.gov.br recusou a consulta (${r.status}): ${detalhe}`), { definitivo: true });
      }
      ultimo = `respondeu ${r.status}`;
    } catch (e: any) {
      if (e?.definitivo) throw e;
      ultimo = e?.name === "TimeoutError" ? "demorou demais para responder" : "não respondeu";
    }
    await new Promise((ok) => setTimeout(ok, 800 * t * t));
  }
  throw new Error(`A API de Dados Abertos do Compras.gov.br ${ultimo}. Tente de novo em instantes.`);
}

const iso = (d: Date) => d.toISOString().slice(0, 10);
const limitar = (v: unknown, min: number, max: number, padrao: number) => {
  const n = Math.trunc(Number(v));
  return Number.isFinite(n) && n >= min ? Math.min(n, max) : padrao;
};

/** Preços praticados de um item (CATMAT ou CATSER) no período, percorrendo até `max_paginas` páginas de 500 */
async function precosParaEtp(a: Record<string, unknown>) {
  const tipo = a.tipo === "servico" ? "servico" : "material";
  const codigo = Math.trunc(Number(a.codigo_item_catalogo));
  if (!Number.isFinite(codigo) || codigo <= 0) throw new Error("Código CATMAT/CATSER inválido.");
  const meses = limitar(a.periodo_meses, 1, 60, 12);
  const maxPaginas = limitar(a.max_paginas, 1, 10, 3);
  const uf = typeof a.uf === "string" && /^[A-Z]{2}$/.test(a.uf) ? a.uf : null;
  const fim = new Date(), ini = new Date(fim.getTime() - meses * 30 * 86400000);
  const registros: Record<string, unknown>[] = [];
  let total = 0, truncado: number | null = null;
  for (let pagina = 1; pagina <= maxPaginas; pagina++) {
    const q = new URLSearchParams({ pagina: String(pagina), tamanhoPagina: String(TAM_PAGINA) });
    if (tipo === "material") { q.set("tipo", "codigoItemCatalogo"); q.set("codigo", String(codigo)); }
    else q.set("codigoItemCatalogo", String(codigo));
    q.set("dataCompraInicio", iso(ini));
    q.set("dataCompraFim", iso(fim));
    if (uf) q.set("estado", uf);
    const rota = tipo === "material" ? "1_consultarMaterial" : "3_consultarServico";
    const j = await buscarJson(`${API}/modulo-pesquisa-preco/${rota}?${q}`);
    total = Number(j.totalRegistros ?? total) || 0;
    for (const r of j.resultado ?? []) {
      // serviço não traz idCompraItem: o app usa a chave para não contar o mesmo preço duas vezes
      registros.push({ ...r, idCompraItem: r.idCompraItem ?? (r.idCompra != null ? `${r.idCompra}-${r.idItemCompra ?? r.numeroItemCompra ?? ""}` : undefined) });
    }
    if (!j.paginasRestantes) break;
    if (pagina === maxPaginas) truncado = registros.length;
  }
  return { amostra_total: total, registros, data_inicio: iso(ini), data_fim: iso(fim), _registros_truncados_em: truncado };
}

/** Até `n` tarefas ao mesmo tempo (para não sobrecarregar a API) */
async function emLotes<T, R>(itens: T[], n: number, f: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(itens.length);
  let prox = 0;
  await Promise.all(Array.from({ length: Math.min(n, itens.length) }, async () => {
    while (prox < itens.length) { const i = prox++; out[i] = await f(itens[i]); }
  }));
  return out;
}

/**
 * Itens de atas de registro de preços (IN 65/2021, art. 5º, II: contratações similares, inclusive por SRP, no último
 * ano) de um código CATMAT/CATSER, com vigência iniciada nos últimos `meses`. A ata não traz unidade nem UF: a função
 * completa pela compra no PNCP (itens da compra → unidade; compra → UF, município e órgão), nas 80 compras mais recentes.
 */
async function atasParaEtp(a: Record<string, unknown>) {
  const tipo = a.tipo === "servico" ? "servico" : "material";
  const codigo = Math.trunc(Number(a.codigo_item_catalogo));
  if (!Number.isFinite(codigo) || codigo <= 0) throw new Error("Código CATMAT/CATSER inválido.");
  const meses = limitar(a.meses, 1, 24, 12);
  const maxPaginas = limitar(a.max_paginas, 1, 4, 2);
  const fim = new Date(), ini = new Date(fim.getTime() - meses * 30 * 86400000);
  const linhas: any[] = [];
  let total = 0, truncado: number | null = null;
  for (let pagina = 1; pagina <= maxPaginas; pagina++) {
    const q = new URLSearchParams({ pagina: String(pagina), tamanhoPagina: String(TAM_PAGINA), codigoItem: String(codigo),
      dataVigenciaInicialMin: iso(ini), dataVigenciaInicialMax: iso(fim) });
    const j = await buscarJson(`${API}/modulo-arp/2_consultarARPItem?${q}`);
    total = Number(j.totalRegistros ?? total) || 0;
    linhas.push(...(j.resultado ?? []));
    if (!j.paginasRestantes) break;
    if (pagina === maxPaginas) truncado = linhas.length;
  }
  const doTipo = (t: unknown) => (tipo === "material" ? !/^serv/i.test(String(t ?? "")) : /^serv/i.test(String(t ?? "")));
  const validas = linhas.filter((r) => !r.itemExcluido && !r.dataHoraExclusao && typeof r.valorUnitario === "number" && r.valorUnitario > 0 && doTipo(r.tipoItem));

  const compras = [...new Set(validas.sort((x, y) => String(y.dataAssinatura).localeCompare(String(x.dataAssinatura))).map((r) => String(r.idCompra)))].slice(0, 80);
  const infos = new Map<string, { uf?: string; municipio?: string; orgao?: string; unidades: Map<number, string> }>();
  await emLotes(compras, 8, async (idCompra) => {
    const [compra, itens] = await Promise.allSettled([
      buscarJson(`${API}/modulo-contratacoes/1.1_consultarContratacoes_PNCP_14133_Id?tipo=idCompra&codigo=${idCompra}`, 20_000),
      buscarJson(`${API}/modulo-contratacoes/2.1_consultarItensContratacoes_PNCP_14133_Id?tipo=idCompra&codigo=${idCompra}`, 20_000),
    ]);
    const c = compra.status === "fulfilled" ? (compra.value?.resultado ?? [])[0] : null;
    const unidades = new Map<number, string>();
    for (const it of itens.status === "fulfilled" ? (itens.value?.resultado ?? []) : []) {
      if (it?.unidadeMedida) unidades.set(Number(it.numeroItemCompra), String(it.unidadeMedida));
    }
    infos.set(idCompra, { uf: c?.unidadeOrgaoUfSigla ?? undefined, municipio: c?.unidadeOrgaoMunicipioNome ?? undefined,
      orgao: c?.orgaoEntidadeRazaoSocial ?? undefined, unidades });
  });

  const registros = validas.map((r) => {
    const info = infos.get(String(r.idCompra));
    const data = String(r.dataAssinatura ?? r.dataVigenciaInicial ?? "").slice(0, 10);
    return {
      origem: "ata", idCompraItem: `${r.idCompra}${String(r.numeroItem ?? "").padStart(5, "0")}`, idCompra: r.idCompra,
      dataCompra: data, dataResultado: data, precoUnitario: r.valorUnitario,
      quantidade: r.quantidadeHomologadaVencedor ?? r.quantidadeHomologadaItem, niFornecedor: r.niFornecedor,
      nomeFornecedor: r.nomeRazaoSocialFornecedor, codigoUasg: r.codigoUnidadeGerenciadora, nomeUasg: r.nomeUnidadeGerenciadora,
      nomeOrgao: info?.orgao, estado: info?.uf, municipio: info?.municipio,
      unidadeTexto: info?.unidades.get(Number(r.numeroItem)) ?? null, descricaoItem: r.descricaoItem,
      numeroAta: r.numeroAtaRegistroPreco, vigenciaAta: r.dataVigenciaFinal, numeroControlePncpAta: r.numeroControlePncpAta,
    };
  });
  return { amostra_total: total, registros, data_inicio: iso(ini), data_fim: iso(fim), _registros_truncados_em: truncado };
}

async function itemDoCatalogo(tipo: "material" | "servico", codigo: number) {
  if (!Number.isFinite(codigo) || codigo <= 0) return { encontrado: false, item: null };
  const url = tipo === "material"
    ? `${API}/modulo-material/4_consultarItemMaterial?pagina=1&tamanhoPagina=10&codigoItem=${codigo}`
    : `${API}/modulo-servico/6_consultarItemServico?pagina=1&tamanhoPagina=10&codigoServico=${codigo}`;
  const item = (await buscarJson(url, 30_000)).resultado?.[0] ?? null;
  return { encontrado: !!item, item };
}

async function chamarTool(nome: string, args: Record<string, unknown>) {
  switch (nome) {
    case "compras_versao":
      await itemDoCatalogo("material", 150512); // a API responde?
      return { versao: "API de Dados Abertos do Compras.gov.br (consulta direta)" };
    case "compras_pesquisar_precos_para_etp":
      return await precosParaEtp(args);
    case "compras_atas_para_etp":
      return await atasParaEtp(args);
    case "compras_catmat_consultar":
      return await itemDoCatalogo("material", Math.trunc(Number(args.codigo_item)));
    case "compras_catser_consultar":
      return await itemDoCatalogo("servico", Math.trunc(Number(args.codigo_item)));
    default:
      return null;
  }
}
const TOOLS_PERMITIDAS = new Set(["compras_versao", "compras_pesquisar_precos_para_etp", "compras_atas_para_etp", "compras_catmat_consultar", "compras_catser_consultar"]);

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
      // Groq (plano gratuito) conta o max_tokens pedido dentro do limite de tokens/min.
      max_tokens: 3000,
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
  // Limite de tokens/min do plano (HTTP 413) ou rajada (429): reenvia com menos
  // texto — a parte que sobra é a mais densa em itens (o app já a prioriza).
  for (let i = 0; i < 3 && (res.status === 413 || res.status === 429); i++) {
    const corpo = await res.text();
    const espera = Number(corpo.match(/try again in ([\d.]+)s/i)?.[1] ?? 0);
    if (res.status === 429 && espera > 0 && espera <= 20) await new Promise((r) => setTimeout(r, espera * 1000 + 300));
    else texto = texto.slice(0, Math.floor(texto.length * 0.6));
    res = await chamarGroq(texto);
  }
  if (!res.ok) throw new Error(`Groq respondeu HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const data = await res.json();
  // a leitura do TR gasta a mesma cota gratuita do Groq que o chat do app: entra na barra de uso do chat
  await gravarUso(Deno.env.get("SUPABASE_URL") ?? "", Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    [{ origem: "pesquisa-precos", modelo: modeloAtual, tokens: data.usage?.total_tokens ?? 0 }]).catch(() => false);
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
      const texto = String(body.texto ?? "").slice(0, 14000);
      if (texto.trim().length < 50) return json({ error: "Texto do TR vazio ou curto demais" }, 400);
      return json(await extrairItens(texto));
    }

    return json({ error: "action inválida (use 'call' ou 'extrair_itens')" }, 400);
  } catch (e: any) {
    console.error("pesquisa-precos:", e);
    return json({ error: e?.message ?? String(e) }, 502);
  }
});
