// @ts-nocheck
/**
 * Edge Function: check-sheets
 *
 * Detecta mudanças nos Google Sheets do Painel Orçamentário comparando
 * um hash do conteúdo atual com o hash da última verificação armazenado
 * no Supabase. Se o conteúdo mudou, dispara push notification.
 *
 * Deploy:
 *   supabase functions deploy check-sheets --no-verify-jwt
 *
 * Agendamento (Supabase → Cron Jobs):
 *   - Frequência sugerida: a cada 1 hora durante horário comercial
 *   - Expressão cron: 0 7-18 * * 1-5   (7h–18h, seg–sex)
 *   - Método: POST para https://<project>.supabase.co/functions/v1/check-sheets
 *
 * Não requer body — roda automaticamente.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Google Sheets que compõem o Painel Orçamentário
const SHEETS = [
  { name: "credito1", url: "https://docs.google.com/spreadsheets/d/1kB9Ry7jPyroIlFCOhHKXEO5ioK0yiXSKlb27ZHv0b6k/export?format=csv&gid=0" },
  { name: "credito2", url: "https://docs.google.com/spreadsheets/d/1u_CG2MlmNlOinTf0IJAfMIK2BNj0XqUaVHFRovniYRg/export?format=csv&gid=0" },
  { name: "rp",       url: "https://docs.google.com/spreadsheets/d/1-_2fWnFGrXI8UHdBLuJQ2xFHwdQ3CKaI9UKN5ozmQ7s/export?format=csv&gid=0" },
  { name: "empenhos", url: "https://docs.google.com/spreadsheets/d/1Gb-2WkxJQnM7DWHfhMV62dFb8TyPfuWCDHaEnhfhbAU/export?format=csv&gid=0" },
];

const HASH_TABLE = "sheets_hash_cache"; // tabela no Supabase para guardar hashes

async function fetchHash(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
    if (!res.ok) return null;
    const text = await res.text();
    // Hash simples: tamanho + primeiros 500 chars + últimos 200 chars
    const sample = text.slice(0, 500) + text.length + text.slice(-200);
    const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(sample));
    return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
  } catch {
    return null;
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Garante que a tabela de cache existe (cria se não existir via RPC ou ignora erro)
    // A tabela deve ser criada manualmente — veja schema_sheets_hash.sql

    // Busca hashes anteriores
    const { data: cached } = await supabase
      .from(HASH_TABLE)
      .select("name, hash");
    const cacheMap = new Map((cached ?? []).map((r: any) => [r.name, r.hash]));

    let changed = false;
    const updates: { name: string; hash: string }[] = [];

    for (const sheet of SHEETS) {
      const newHash = await fetchHash(sheet.url);
      if (!newHash) continue; // falha ao buscar — ignora

      const oldHash = cacheMap.get(sheet.name);
      if (oldHash !== newHash) {
        changed = true;
        updates.push({ name: sheet.name, hash: newHash });
        console.log(`[check-sheets] Mudança detectada em: ${sheet.name}`);
      }
    }

    if (changed) {
      // Salva novos hashes
      for (const u of updates) {
        await supabase
          .from(HASH_TABLE)
          .upsert({ name: u.name, hash: u.hash, updated_at: new Date().toISOString() }, { onConflict: "name" });
      }

      // Dispara push notification via send-push
      const pushUrl = Deno.env.get("SUPABASE_URL")! + "/functions/v1/send-push";
      const svcKey  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

      await fetch(pushUrl, {
        method: "POST",
        headers: {
          "Content-Type":  "application/json",
          "Authorization": `Bearer ${svcKey}`,
        },
        body: JSON.stringify({ source: "orcamento" }),
      });

      return json({ ok: true, changed: true, sheets: updates.map((u) => u.name) });
    }

    return json({ ok: true, changed: false });
  } catch (err: any) {
    console.error(err);
    return json({ ok: false, error: err.message }, 500);
  }
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}
