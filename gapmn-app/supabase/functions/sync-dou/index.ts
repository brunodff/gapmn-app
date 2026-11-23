// @ts-nocheck
/**
 * Edge Function: sync-dou (nov/2026) — alertas do Diário Oficial da União, no jeito do Ro-dou
 * (gestaogovbr/Ro-dou, clipping do DOU do Ministério da Gestão).
 *
 * Para cada termo ativo de dou_termos, busca no DOU (busca exata, três seções, período pedido; padrão: últimos
 * 7 dias) e grava em dou_publicacoes, juntando os termos que acharam cada publicação. A leitura da página está
 * em ../_shared/dou.ts. Cada rodada fica em processos_sync_log (fonte 'dou').
 *
 * POST { origem?, periodo?: "dia"|"semana"|"mes", termo? } — `termo` busca só aquele (ex.: termo recém-cadastrado).
 * Quem pode chamar: o agendamento (cabeçalho x-sync-key = secret SYNC_PROCESSOS_KEY) ou qualquer usuário logado
 * do app (Authorization: Bearer <JWT do usuário>).
 *
 * Deploy: supabase functions deploy sync-dou --no-verify-jwt
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { lerBuscaDou, urlBuscaDou } from "../_shared/dou.ts";

const UA = "Mozilla/5.0 (compatible; GAPMN-DOU/1.0; gapmn.app)";
const PERIODOS = new Set(["dia", "semana", "mes"]);

const CORS = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-sync-key",
};
const json = (corpo: unknown, status = 200) =>
  new Response(JSON.stringify(corpo), { status, headers: { ...CORS, "content-type": "application/json; charset=utf-8" } });
const msg = (e: any) => String(e?.message || e);

async function buscar(termo: string, periodo: string) {
  let ultimo = "";
  for (let t = 1; t <= 3; t++) {
    try {
      const r = await fetch(urlBuscaDou(termo, periodo), { headers: { "user-agent": UA, accept: "text/html" }, signal: AbortSignal.timeout(40_000) });
      if (r.ok) return lerBuscaDou(await r.text());
      ultimo = `o DOU respondeu ${r.status}`;
    } catch (e) {
      if (/mudou/.test(msg(e))) throw e;
      ultimo = e?.name === "TimeoutError" ? "o DOU demorou demais" : "o DOU não respondeu";
    }
    await new Promise((ok) => setTimeout(ok, 1500 * t));
  }
  throw new Error(ultimo);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });

  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  let corpo: any = {};
  try { corpo = await req.json(); } catch { /* sem corpo */ }

  // ── Quem chamou ──
  let origem = "manual", usuario: string | null = null;
  const chaveSync = Deno.env.get("SYNC_PROCESSOS_KEY") || "";
  if (chaveSync && req.headers.get("x-sync-key") === chaveSync) {
    origem = corpo.origem === "cron" ? "cron" : "chave";
  } else {
    const jwt = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
    const { data } = jwt ? await admin.auth.getUser(jwt) : { data: null };
    if (!data?.user) return json({ ok: false, error: "Faça login no app para buscar no Diário Oficial." }, 401);
    usuario = data.user.id;
  }
  const periodo = PERIODOS.has(corpo.periodo) ? corpo.periodo : "semana";

  // ── Uma rodada por vez ──
  const { data: emCurso } = await admin.from("processos_sync_log")
    .select("id").eq("fonte", "dou").is("fim", null)
    .gte("inicio", new Date(Date.now() - 3 * 60_000).toISOString()).limit(1);
  if (emCurso?.length) return json({ ok: false, emAndamento: true, error: "Já existe uma busca no DOU em andamento — aguarde um pouco." }, 409);
  const { data: log } = await admin.from("processos_sync_log").insert({ fonte: "dou", origem, usuario }).select("id").single();

  const avisos: string[] = [];
  try {
    let q = admin.from("dou_termos").select("termo").eq("ativo", true);
    if (typeof corpo.termo === "string" && corpo.termo.trim()) q = admin.from("dou_termos").select("termo").eq("termo", corpo.termo.trim());
    const { data: termos, error: et } = await q;
    if (et) throw et;

    // publicação → termos que a acharam
    const achadas = new Map<string, any>();
    let falhas = 0;
    for (const { termo } of termos ?? []) {
      try {
        for (const p of await buscar(termo, periodo)) {
          const atual = achadas.get(p.id);
          achadas.set(p.id, { ...p, termos: [...new Set([...(atual?.termos ?? []), termo])] });
        }
      } catch (e) {
        falhas++;
        avisos.push(`${termo}: ${msg(e)}`);
      }
    }
    if (termos?.length && falhas === termos.length) throw new Error(`nenhum termo foi buscado (${avisos[0]})`);

    // junta com os termos que já estavam gravados
    const ids = [...achadas.keys()];
    const existentes = new Map<string, string[]>();
    for (let i = 0; i < ids.length; i += 200) {
      const { data } = await admin.from("dou_publicacoes").select("id, termos").in("id", ids.slice(i, i + 200));
      for (const r of data ?? []) existentes.set(r.id, r.termos ?? []);
    }
    const agora = new Date().toISOString();
    const linhas = [...achadas.values()].map((p) => ({
      ...p, termos: [...new Set([...(existentes.get(p.id) ?? []), ...p.termos])], atualizado_em: agora,
    }));
    for (let i = 0; i < linhas.length; i += 200) {
      const { error } = await admin.from("dou_publicacoes").upsert(linhas.slice(i, i + 200), { onConflict: "id" });
      if (error) throw error;
    }

    const resumo = { periodo, termos: termos?.length ?? 0, achadas: linhas.length, novas: linhas.filter((l) => !existentes.has(l.id)).length, avisos };
    await admin.from("processos_sync_log").update({ fim: new Date().toISOString(), ok: true, resumo }).eq("id", log?.id);
    return json({ ok: true, ...resumo });
  } catch (err) {
    await admin.from("processos_sync_log").update({
      fim: new Date().toISOString(), ok: false, erro: msg(err).slice(0, 500), resumo: { avisos: avisos.slice(0, 20) },
    }).eq("id", log?.id);
    return json({ ok: false, error: msg(err) }, 500);
  }
});
