// @ts-nocheck
/**
 * Edge Function: contratos-gov (nov/2026)
 *
 * Ponte para dados públicos de contratação que não liberam chamada direta do navegador (sem CORS ou com o
 * cabeçalho CORS duplicado): a API do Contratos.gov.br, os PDFs dos contratos e o PNCP. Usada pelo reajuste
 * completo para preencher o cadastro do contrato — no GAP-MN e na tela de outras OMs da FAB. Só leitura.
 *
 * POST { rota } — só estas rotas:
 *   "ug/<6 dígitos>"                         contratos ativos da UG (a do GAP-MN leva ~40 s)
 *   "<id>/itens|historico|empenhos|arquivos" dados de um contrato
 *   "arquivo"      + { url }                 PDF da aba "Arquivos" (só https://contratos.comprasnet.gov.br/storage/contrato/…)
 *   "pncp-compra"  + { uasg, numero }        compra no PNCP (busca "UASG número/ano") e a lista dos arquivos dela
 *   "pncp-arquivo" + { cnpj, ano, seq, n }   arquivo da compra no PNCP (TR, edital…)
 * Sem prepostos, responsáveis e terceirizados (dados pessoais). CPF de fornecedor pessoa física sai
 * mascarado (***.456.789-**), como no Portal da Transparência. Arquivos voltam como application/octet-stream.
 *
 * Chamada pelo app com a chave pública (verify_jwt ligado). Deploy:
 *   supabase functions deploy contratos-gov --project-ref <ref> --use-api
 */
import { corsHeaders } from "../_shared/cors.ts";

const BASE = "https://contratos.comprasnet.gov.br/api/contrato";
const STORAGE = "https://contratos.comprasnet.gov.br/storage/contrato/";
const PNCP = "https://pncp.gov.br";
const UA = "GAPMN-App/1.0 (gapmn.app; dados publicos)";
const SUB = new Set(["itens", "historico", "empenhos", "arquivos"]);
const LIMITE_ARQUIVO = 20 * 1024 * 1024;

const resposta = (corpo: string, status = 200) =>
  new Response(corpo, { status, headers: { ...corsHeaders, "content-type": "application/json; charset=utf-8" } });
const erro = (msg: string, status = 400) => resposta(JSON.stringify({ erro: msg }), status);
const mascararCpf = (t: string) => t.replace(/(?<![\d.])\d{3}\.(\d{3})\.(\d{3})-\d{2}(?!\d)/g, "***.$1.$2-**");

/** GET com até 3 tentativas (as duas fontes oscilam); devolve a Response ou lança com mensagem clara */
async function buscar(url: string, ms: number, aceitar = "application/json"): Promise<Response> {
  let ultimo = "";
  for (let t = 1; t <= 3; t++) {
    try {
      const r = await fetch(url, { headers: { "user-agent": UA, accept: aceitar }, signal: AbortSignal.timeout(ms) });
      if (r.ok || (r.status < 500 && r.status !== 429)) return r;
      ultimo = `respondeu ${r.status}`;
    } catch (e) {
      ultimo = e?.name === "TimeoutError" ? "demorou demais para responder" : "não respondeu";
    }
    await new Promise((ok) => setTimeout(ok, 800 * t * t));
  }
  throw new Error(ultimo);
}

async function arquivo(url: string): Promise<Response> {
  const r = await buscar(url, 60_000, "*/*");
  if (!r.ok) return erro(`O arquivo não abriu (${r.status}).`, 502);
  const bytes = new Uint8Array(await r.arrayBuffer());
  if (bytes.length > LIMITE_ARQUIVO) return erro("Arquivo maior que 20 MB.", 413);
  return new Response(bytes, { headers: { ...corsHeaders, "content-type": "application/octet-stream" } });
}

/** Compra no PNCP pela busca pública ("120630 90077/2024"), conferindo a UASG e o número, e os arquivos dela */
async function compraPncp(uasg: string, numero: string): Promise<Response> {
  const q = encodeURIComponent(`${uasg} ${numero}`);
  const r = await buscar(`${PNCP}/api/search/?q=${q}&tipos_documento=edital&ordenacao=relevancia&pagina=1&tam_pagina=10`, 30_000);
  if (!r.ok) return erro(`O PNCP respondeu ${r.status}.`, 502);
  const itens = ((await r.json())?.items ?? []) as Record<string, string>[];
  const achado = itens.find((i) => String(i.unidade_codigo) === uasg && String(i.title ?? "").includes(numero));
  if (!achado) return resposta(JSON.stringify({ compra: null, arquivos: [] }));
  const compra = { cnpj: String(achado.orgao_cnpj), ano: String(achado.ano), seq: String(Number(achado.numero_sequencial)),
    controle: achado.numero_controle_pncp ?? null, titulo: achado.title ?? null };
  const ra = await buscar(`${PNCP}/api/pncp/v1/orgaos/${compra.cnpj}/compras/${compra.ano}/${compra.seq}/arquivos`, 30_000);
  const lista = ra.ok ? ((await ra.json()) as Record<string, unknown>[]) : [];
  const arquivos = lista.map((a) => ({ n: a.sequencialDocumento, titulo: a.titulo, tipo: a.tipoDocumentoNome, data: a.dataPublicacaoPncp }));
  return resposta(JSON.stringify({ compra, arquivos }));
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return erro("Use POST.", 405);
  let c: Record<string, unknown> = {};
  try { c = await req.json(); } catch { return erro("Pedido inválido."); }
  const rota = String(c.rota ?? "");

  try {
    if (rota === "arquivo") {
      const url = String(c.url ?? "");
      if (!url.startsWith(STORAGE) || url.includes("..") || !/^[\w./%-]+$/.test(url.slice(STORAGE.length))) return erro("Arquivo fora do Contratos.gov.br.", 404);
      return await arquivo(url);
    }
    if (rota === "pncp-compra") {
      const uasg = String(c.uasg ?? ""), numero = String(c.numero ?? "");
      if (!/^\d{6}$/.test(uasg) || !/^\d{1,6}\/\d{4}$/.test(numero)) return erro("Informe a UASG (6 dígitos) e o número da compra (NNNNN/AAAA).");
      return await compraPncp(uasg, numero);
    }
    if (rota === "pncp-arquivo") {
      const [cnpj, ano, seq, n] = [c.cnpj, c.ano, c.seq, c.n].map((x) => String(x ?? ""));
      if (!/^\d{14}$/.test(cnpj) || !/^\d{4}$/.test(ano) || !/^\d{1,7}$/.test(seq) || !/^\d{1,4}$/.test(n)) return erro("Arquivo do PNCP inválido.");
      return await arquivo(`${PNCP}/pncp-api/v1/orgaos/${cnpj}/compras/${ano}/${seq}/arquivos/${n}`);
    }

    let destino: string | null = null;
    const ug = /^ug\/(\d{6})$/.exec(rota);
    const sub = /^(\d{1,9})\/([a-z]+)$/.exec(rota);
    if (ug) destino = `${BASE}/ug/${ug[1]}`;
    else if (sub && SUB.has(sub[2])) destino = `${BASE}/${sub[1]}/${sub[2]}`;
    if (!destino) return erro("Rota não disponível.", 404);
    const r = await buscar(destino, ug ? 120_000 : 45_000);
    const texto = await r.text();
    if (r.ok && /^\s*[[{]/.test(texto)) return resposta(mascararCpf(texto));
    return erro(`O Contratos.gov.br respondeu ${r.status}.`, 502);
  } catch (e) {
    return erro(`A fonte pública ${e?.message ?? "não respondeu"}.`, 504);
  }
});
