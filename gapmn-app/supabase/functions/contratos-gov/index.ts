// @ts-nocheck
/**
 * Edge Function: contratos-gov (nov/2026)
 *
 * Ponte para a API pública do Contratos.gov.br (contratos.comprasnet.gov.br/api), que não libera
 * chamada direta do navegador (sem CORS). Usada pelo reajuste completo para preencher o cadastro do
 * contrato (partes, itens, termos, dotação) — no GAP-MN e na página de outras OMs da FAB.
 *
 * POST { rota } — só estas rotas, só leitura:
 *   "ug/<6 dígitos>"                         contratos ativos da UG (a do GAP-MN leva ~40 s)
 *   "<id>/itens|historico|empenhos|arquivos" dados de um contrato
 * Sem prepostos, responsáveis e terceirizados (dados pessoais). CPF de fornecedor pessoa física sai
 * mascarado (***.456.789-**), como no Portal da Transparência.
 *
 * Chamada pelo app com a chave pública (verify_jwt ligado). Deploy:
 *   supabase functions deploy contratos-gov --project-ref <ref> --use-api
 */
import { corsHeaders } from "../_shared/cors.ts";

const BASE = "https://contratos.comprasnet.gov.br/api/contrato";
const UA = "GAPMN-App/1.0 (gapmn.app; dados publicos)";
const SUB = new Set(["itens", "historico", "empenhos", "arquivos"]);

const resposta = (corpo: string, status = 200) =>
  new Response(corpo, { status, headers: { ...corsHeaders, "content-type": "application/json; charset=utf-8" } });
const erro = (msg: string, status = 400) => resposta(JSON.stringify({ erro: msg }), status);
const mascararCpf = (t: string) => t.replace(/(?<![\d.])\d{3}\.(\d{3})\.(\d{3})-\d{2}(?!\d)/g, "***.$1.$2-**");

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return erro("Use POST.", 405);
  let rota = "";
  try { rota = String((await req.json()).rota ?? ""); } catch { return erro("Pedido inválido."); }

  let destino: string | null = null;
  const ug = /^ug\/(\d{6})$/.exec(rota);
  const sub = /^(\d{1,9})\/([a-z]+)$/.exec(rota);
  if (ug) destino = `${BASE}/ug/${ug[1]}`;
  else if (sub && SUB.has(sub[2])) destino = `${BASE}/${sub[1]}/${sub[2]}`;
  if (!destino) return erro("Rota não disponível.", 404);

  for (let t = 1; t <= 3; t++) {
    try {
      const r = await fetch(destino, { headers: { "user-agent": UA, accept: "application/json" }, signal: AbortSignal.timeout(ug ? 120_000 : 45_000) });
      const texto = await r.text();
      if (r.ok && /^\s*[[{]/.test(texto)) return resposta(mascararCpf(texto));
      if (r.status < 500 && r.status !== 429) return erro(`O Contratos.gov.br respondeu ${r.status}.`, 502);
    } catch (e) {
      if (t === 3) return erro(e?.name === "TimeoutError" ? "O Contratos.gov.br demorou demais para responder." : "Não foi possível falar com o Contratos.gov.br.", 504);
    }
    await new Promise((ok) => setTimeout(ok, 800 * t * t));
  }
  return erro("O Contratos.gov.br não respondeu depois de 3 tentativas.", 502);
});
