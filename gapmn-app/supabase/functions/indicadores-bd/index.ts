// @ts-nocheck
/**
 * Edge Function: indicadores-bd
 *
 * Entrega ao Painel de Governança (aba em /orcamento) a aba BD da planilha de
 * indicadores, lida pelo doGet do Apps Script. A URL e o token do Apps Script ficam
 * só aqui, como secrets — nunca no navegador nem no repositório:
 *
 *   supabase secrets set GAPMN_BD_URL=... GAPMN_BD_TOKEN=...
 *   supabase functions deploy indicadores-bd
 *
 * Acesso: usuário logado com setor ADMIN ou DEV (a mesma regra da aba).
 * Corpo opcional: { "forcar": true } ignora o cache (botão "Atualizar agora").
 * Cache: 5 minutos em memória. Se a planilha falhar e houver cache, devolve o cache
 * com um aviso; o painel nunca recebe zeros no lugar de dado.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const CACHE_MS = 5 * 60_000;
const SETORES = ["ADMIN", "DEV"];

let cache: { payload: any; em: number } | null = null;
let emVoo: Promise<any> | null = null;

function json(obj: unknown, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...CORS, "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });
}

/** Tira a URL e o token de qualquer texto que possa sair desta função. */
function limpar(s: unknown, url: string, token: string) {
  let t = String(s ?? "");
  if (url) t = t.split(url).join("<url>");
  if (token) t = t.split(token).join("<token>").split(encodeURIComponent(token)).join("<token>");
  return t.slice(0, 300);
}

async function buscarPlanilha(url: string, token: string) {
  const res = await fetch(`${url}?token=${encodeURIComponent(token)}`, {
    redirect: "follow",
    signal: AbortSignal.timeout(45_000),
  });
  if (!res.ok) throw new Error(`a planilha respondeu HTTP ${res.status}`);
  let j: any;
  try { j = await res.json(); } catch { throw new Error("a planilha não devolveu JSON"); }
  if (!j || j.ok !== true || !Array.isArray(j.bd)) {
    throw new Error(j?.erro ? `a planilha recusou (${j.erro})` : "resposta da planilha fora do formato");
  }
  // ID é sempre texto: "17.1" tratado como número vira data.
  for (const r of j.bd) if (r && r.ID !== null && r.ID !== undefined) r.ID = String(r.ID);
  return {
    ok: true,
    gerado_em: j.gerado_em ?? null,
    timezone: j.timezone ?? null,
    planilha: j.planilha ?? null,
    bd: j.bd,
    // Segunda fase: ainda não usada pelo painel.
    bd_integridade: [],
    // Ficha técnica por indicador (aba CATALOGO); vazia enquanto a aba não existir.
    catalogo: Array.isArray(j.catalogo)
      ? j.catalogo.map((r: any) => (r && r.ID !== null && r.ID !== undefined ? { ...r, ID: String(r.ID) } : r))
      : [],
  };
}

function resposta(c: { payload: any; em: number }, deCache: boolean, aviso: string | null = null) {
  return json({ ...c.payload, buscado_em: new Date(c.em).toISOString(), de_cache: deCache, aviso });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });

  const URL_BD = Deno.env.get("GAPMN_BD_URL") || "";
  const TOKEN = Deno.env.get("GAPMN_BD_TOKEN") || "";

  try {
    // ── Quem chamou ──
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const jwt = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
    const { data } = jwt ? await admin.auth.getUser(jwt) : { data: null };
    const user = data?.user;
    if (!user) return json({ ok: false, erro: "nao_autenticado" }, 401);
    const { data: perfil } = await admin.from("profiles").select("setor").eq("id", user.id).maybeSingle();
    if (!SETORES.includes(String(perfil?.setor || "").toUpperCase())) {
      return json({ ok: false, erro: "sem_permissao" }, 403);
    }

    if (!URL_BD || !TOKEN) return json({ ok: false, erro: "nao_configurado" }, 500);

    let corpo: any = {};
    try { corpo = await req.json(); } catch { /* sem corpo */ }
    const forcar = corpo?.forcar === true;

    if (!forcar && cache && Date.now() - cache.em < CACHE_MS) return resposta(cache, true);

    try {
      // Várias abas abertas ao mesmo tempo fazem uma busca só.
      if (!emVoo) emVoo = buscarPlanilha(URL_BD, TOKEN).finally(() => { emVoo = null; });
      const payload = await emVoo;
      cache = { payload, em: Date.now() };
      return resposta(cache, false);
    } catch (e) {
      const motivo = limpar(e?.message || e, URL_BD, TOKEN);
      console.error("indicadores-bd:", motivo);
      if (cache) return resposta(cache, true, `Não foi possível atualizar agora (${motivo}).`);
      return json({ ok: false, erro: "falha_planilha", detalhe: motivo }, 502);
    }
  } catch (e) {
    const motivo = limpar(e?.message || e, URL_BD, TOKEN);
    console.error("indicadores-bd:", motivo);
    return json({ ok: false, erro: "falha_interna", detalhe: motivo }, 500);
  }
});
