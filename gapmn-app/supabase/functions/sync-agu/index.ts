// @ts-nocheck
/**
 * Edge Function: sync-agu (nov/2026)
 *
 * Uma vez por dia, lê o buscador público de Manifestações Jurídicas Referenciais da Consultoria-Geral da
 * União (https://cgu.agu.gov.br/referenciais/, sem login): a página traz a lista inteira (~900 pareceres
 * referenciais, com órgão, assunto, ementa, link do PDF e validade). Grava tudo em agu_referenciais; o que
 * sumiu da página fica marcado (na_lista = false). Pareceres novos sobre licitações e contratos vão para o
 * feed do app (a partir da segunda rodada). A regra de leitura está em ../_shared/agu.ts.
 * Cada rodada fica em processos_sync_log (fonte 'agu').
 *
 * Quem pode chamar: o agendamento (cabeçalho x-sync-key = secret SYNC_PROCESSOS_KEY) ou um usuário do app
 * da SLIC/SCON/ADMIN/DEV (Authorization: Bearer <JWT do usuário>).
 *
 * Deploy: supabase functions deploy sync-agu --no-verify-jwt
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { FONTE_AGU, lerReferenciais, textoFeedAgu, vigente } from "../_shared/agu.ts";

const UA = "GAPMN-AGU/1.0 (gapmn.app; dados publicos)";
const MINIMO = 100;  // menos que isso na página = página incompleta: nada é alterado
const LOTE = 200;

const CORS = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-sync-key",
};
const json = (corpo: unknown, status = 200) =>
  new Response(JSON.stringify(corpo), { status, headers: { ...CORS, "content-type": "application/json; charset=utf-8" } });
const msg = (e: any) => String(e?.message || e);

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
    const user = data?.user;
    if (!user) return json({ ok: false, error: "Faça login no app para atualizar os pareceres da AGU." }, 401);
    const { data: perfil } = await admin.from("profiles").select("setor, role").eq("id", user.id).maybeSingle();
    const setor = String(perfil?.setor || "").toUpperCase();
    if (!["SLIC", "SCON", "ADMIN", "DEV"].includes(setor) && perfil?.role !== "admin") {
      return json({ ok: false, error: "Só a SLIC, a SCON, ADMIN ou DEV podem atualizar os pareceres da AGU." }, 403);
    }
    usuario = user.id;
  }

  // ── Uma rodada por vez ──
  const { data: emCurso } = await admin.from("processos_sync_log")
    .select("id").eq("fonte", "agu").is("fim", null)
    .gte("inicio", new Date(Date.now() - 2 * 60_000).toISOString()).limit(1);
  if (emCurso?.length) return json({ ok: false, emAndamento: true, error: "Já existe uma atualização da AGU em andamento — aguarde 1 minuto." }, 409);
  const { data: log } = await admin.from("processos_sync_log").insert({ fonte: "agu", origem, usuario }).select("id").single();

  const avisos: string[] = [];
  try {
    const resumo = await sincronizar(admin, avisos);
    await admin.from("processos_sync_log").update({ fim: new Date().toISOString(), ok: true, resumo }).eq("id", log?.id);
    return json({ ok: true, ...resumo });
  } catch (err: any) {
    console.error(err);
    await admin.from("processos_sync_log").update({
      fim: new Date().toISOString(), ok: false, erro: msg(err).slice(0, 500), resumo: { avisos: avisos.slice(0, 20) },
    }).eq("id", log?.id);
    return json({ ok: false, error: msg(err) }, 500);
  }
});

/** GET com até 3 tentativas (a página às vezes demora) */
async function pagina(): Promise<string> {
  let ultimo = "";
  for (let t = 1; t <= 3; t++) {
    try {
      const r = await fetch(FONTE_AGU, { headers: { "user-agent": UA, accept: "text/html" }, signal: AbortSignal.timeout(45_000) });
      if (r.ok) return await r.text();
      ultimo = `respondeu ${r.status}`;
    } catch (e) {
      ultimo = e?.name === "TimeoutError" ? "demorou demais para responder" : "não respondeu";
    }
    await new Promise((ok) => setTimeout(ok, 1500 * t));
  }
  throw new Error(`O buscador de referenciais da AGU ${ultimo}.`);
}

async function sincronizar(admin, avisos: string[]) {
  const lista = lerReferenciais(await pagina());
  if (lista.length < MINIMO) throw new Error(`A página da AGU trouxe só ${lista.length} referenciais: parece incompleta, nada foi alterado.`);

  // o que já está no banco (para saber o que é novo e o que saiu da página)
  const existentes = new Map<number, boolean>();
  for (let de = 0; ; de += 1000) {
    const { data, error } = await admin.from("agu_referenciais").select("id, na_lista").range(de, de + 999);
    if (error) throw new Error(`agu_referenciais: ${error.message}`);
    for (const x of data ?? []) existentes.set(x.id, x.na_lista);
    if (!data || data.length < 1000) break;
  }
  const primeiraCarga = existentes.size === 0;
  const agora = new Date().toISOString();

  for (let i = 0; i < lista.length; i += LOTE) {
    const lote = lista.slice(i, i + LOTE).map((r) => ({ ...r, na_lista: true, atualizado_em: agora }));
    const { error } = await admin.from("agu_referenciais").upsert(lote, { onConflict: "id" });
    if (error) throw new Error(`gravar referenciais: ${error.message}`);
  }
  const naPagina = new Set(lista.map((r) => r.id));
  const sairam = [...existentes].filter(([id, na]) => na && !naPagina.has(id)).map(([id]) => id);
  for (let i = 0; i < sairam.length; i += LOTE) {
    const { error } = await admin.from("agu_referenciais").update({ na_lista: false, atualizado_em: agora }).in("id", sairam.slice(i, i + LOTE));
    if (error) avisos.push(`marcar os que saíram: ${error.message}`);
  }

  const novos = primeiraCarga ? [] : lista.filter((r) => !existentes.has(r.id));
  const hoje = new Date(Date.now() - 4 * 3600e3).toISOString().slice(0, 10); // Manaus
  const resumo = {
    lidos: lista.length,
    vigentes: lista.filter((r) => vigente(r, hoje)).length,
    vigentes_licitacoes: lista.filter((r) => r.licitacoes && vigente(r, hoje)).length,
    primeira_carga: primeiraCarga,
    novos: novos.length,
    novos_lista: novos.slice(0, 20).map((r) => r.parecer),
    sairam: sairam.length,
    feed: false,
    avisos,
  };

  const titulo = textoFeedAgu(novos);
  if (titulo) {
    const { error } = await admin.from("feed_items").insert({
      titulo, tipo: "agu", link_tab: "agu",
      descricao: "Pareceres referenciais da AGU (buscador da Consultoria-Geral da União).",
    });
    resumo.feed = !error;
    if (error) avisos.push(`feed: ${error.message}`);
  }
  return resumo;
}
