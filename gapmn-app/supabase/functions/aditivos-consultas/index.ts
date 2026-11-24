// @ts-nocheck
/**
 * Edge Function: aditivos-consultas (nov/2026) — consultas automáticas dos Termos Aditivos (item 13 da Lista).
 *
 * POST { acao: "tcu", cnpj }  → Consulta Consolidada de Pessoa Jurídica do TCU (CEIS, CNEP, CNJ e Inidôneos):
 *      UMA chamada JSON + UMA chamada PDF na mesma URL, como o botão "Baixar PDF" do TCU (kit da SCON,
 *      consultar_regularidade.py). O firewall do TCU recusa robôs às vezes: aí volta { bloqueado: true } e a tela
 *      mostra o caminho manual (abrir o site, baixar o PDF e anexar). Não repete a chamada.
 * POST { acao: "cnj", documento, tipoPessoa: "J"|"F" } → certidão do CNIA (CNJ): pesquisa e baixa a Negativa ou a
 *      Positiva (PDF direto, sem login nem captcha).
 * → { ok, ... , pdf_base64 } (o PDF vai junto, em base64)
 *
 * Só usuário logado (verify_jwt ligado + auth.getUser). Deploy: supabase functions deploy aditivos-consultas --use-api
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (corpo: unknown, status = 200) => new Response(JSON.stringify(corpo), { status, headers: { ...CORS, "content-type": "application/json; charset=utf-8" } });
const UA = { "User-Agent": "Mozilla/5.0 (GAP-MN SCON - consulta de regularidade)" };
const digitos = (s: unknown) => String(s ?? "").replace(/\D/g, "");
const cnpjFmt = (c: string) => `${c.slice(0, 2)}.${c.slice(2, 5)}.${c.slice(5, 8)}/${c.slice(8, 12)}-${c.slice(12)}`;
const cpfFmt = (c: string) => `${c.slice(0, 3)}.${c.slice(3, 6)}.${c.slice(6, 9)}-${c.slice(9)}`;
function base64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
const ehPdf = (b: Uint8Array) => b.length > 4 && b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46;

async function tcu(cnpj: string) {
  const url = `https://certidoes-apf.apps.tcu.gov.br/api/rest/publico/certidoes/${cnpj}`;
  const pedir = async (accept: string) => {
    const r = await fetch(url, { headers: { ...UA, Accept: `${accept},application/json`, "X-Slow-Request": "true" }, signal: AbortSignal.timeout(90000) });
    const bytes = new Uint8Array(await r.arrayBuffer());
    const tipo = r.headers.get("content-type") ?? "";
    const inicio = new TextDecoder("latin1").decode(bytes.slice(0, 3000)).toLowerCase();
    if (inicio.includes("rejeitada") || tipo.includes("text/html")) {
      const e = new Error("O firewall do TCU recusou a consulta automática ('Requisição rejeitada'): use o caminho manual (abrir a Consulta Consolidada, Baixar PDF e anexar).");
      (e as Error & { bloqueado?: boolean }).bloqueado = true;
      throw e;
    }
    if (!r.ok) throw new Error(`O TCU respondeu HTTP ${r.status}.`);
    return { bytes, tipo };
  };
  const j = await pedir("application/json");
  const dados = JSON.parse(new TextDecoder().decode(j.bytes));
  let pdf_base64 = null, pdf_erro = null;
  try {
    const p = await pedir("application/pdf");
    if (ehPdf(p.bytes)) pdf_base64 = base64(p.bytes);
    else pdf_erro = "O TCU não devolveu o PDF da consolidada: baixe pelo site e anexe.";
  } catch (e) { pdf_erro = e.message; }
  return { ok: true, json: dados, pdf_base64, pdf_erro, nome_pdf: `ConsultaConsolidada_${cnpj}.pdf` };
}

async function cnj(documento: string, tipoPessoa: "J" | "F") {
  const base = "https://www.cnj.jus.br/improbidade_adm/";
  const fmt = tipoPessoa === "J" ? cnpjFmt(documento) : cpfFmt(documento);
  const form = new URLSearchParams({ tipoPessoa, num_cpf_cnpj: fmt, nom_requerido: "", hidNumCpfCnpj: documento, hidTipPessoa: tipoPessoa, num_registros: "0" });
  const r = await fetch(`${base}consultar_requerido.php?validar=form`, {
    method: "POST", headers: { ...UA, "Content-Type": "application/x-www-form-urlencoded" }, body: form, signal: AbortSignal.timeout(60000),
  });
  const html = new TextDecoder("latin1").decode(new Uint8Array(await r.arrayBuffer())).toLowerCase();
  let tipo = "N", consta: boolean | null = false;
  if (html.includes("nenhum requerido encontrado")) { tipo = "N"; consta = false; }
  else if (html.includes("btncertidaopositiva") || digitos(html).includes(documento.slice(0, 8))) { tipo = "P"; consta = true; }
  else { tipo = "N"; consta = null; } // não deu para confirmar pela pesquisa
  const c = await fetch(`${base}certidao.php?tipoCertidao=${tipo}&cpfCnpj=${documento}&tipoPessoa=${tipoPessoa}`, { headers: UA, signal: AbortSignal.timeout(60000) });
  const bytes = new Uint8Array(await c.arrayBuffer());
  if (!ehPdf(bytes)) throw new Error("O CNJ não devolveu um PDF: consulte manualmente.");
  return { ok: true, tipo: tipo === "P" ? "Positiva" : "Negativa", consta, pdf_base64: base64(bytes), nome_pdf: `Certidao_CNJ_${tipo === "P" ? "Positiva" : "Negativa"}_${documento}.pdf` };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ ok: false, error: "use POST" }, 405);
  const auth = req.headers.get("authorization") ?? "";
  const db = createClient(Deno.env.get("SUPABASE_URL") ?? "", Deno.env.get("SUPABASE_ANON_KEY") ?? "", { global: { headers: { Authorization: auth } }, auth: { persistSession: false } });
  const { data } = await db.auth.getUser(auth.replace(/^Bearer\s+/i, ""));
  if (!data?.user) return json({ ok: false, error: "Faça login no gapmn.app." }, 401);
  let corpo;
  try { corpo = await req.json(); } catch { return json({ ok: false, error: "corpo inválido" }, 400); }
  try {
    if (corpo?.acao === "tcu") {
      const c = digitos(corpo.cnpj);
      if (c.length !== 14) return json({ ok: false, error: "CNPJ inválido." }, 400);
      return json(await tcu(c));
    }
    if (corpo?.acao === "cnj") {
      const tipo = corpo.tipoPessoa === "F" ? "F" : "J";
      const d = digitos(corpo.documento);
      if ((tipo === "J" && d.length !== 14) || (tipo === "F" && d.length !== 11)) return json({ ok: false, error: "CPF/CNPJ inválido." }, 400);
      return json(await cnj(d, tipo));
    }
    return json({ ok: false, error: "ação desconhecida" }, 400);
  } catch (e) {
    return json({ ok: false, bloqueado: !!e?.bloqueado, error: String(e?.message ?? e) }, e?.bloqueado ? 200 : 502);
  }
});
