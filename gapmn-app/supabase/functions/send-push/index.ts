// @ts-nocheck
/**
 * Edge Function: send-push
 * Envia push notifications personalizadas para usuários inscritos.
 *
 * Deploy:
 *   supabase functions deploy send-push --no-verify-jwt
 *
 * Segredos (Supabase → Settings → Edge Functions → Secrets):
 *   VAPID_PRIVATE_KEY = DMY7JW_3Sgcz1g6PDICbgAjo6b_JWW36tM2KLR0JD9g
 *   VAPID_PUBLIC_KEY  = BCvuRXyksc1BHTLw-T76nDzBi5cjjA0iHH7RLU5qU3W6vYyJGuHoMKgef8tUaunut8rVxrPcyIgzwfvvJ9tW0mE
 *   VAPID_SUBJECT     = mailto:gapmn@eb.mil.br
 *
 * Body esperado (POST):
 * {
 *   source: "processos" | "contratos" | "indicadores" | "orcamento" | "custom",
 *   user_ids?: string[],   // opcional — se omitido envia para todos os inscritos
 *   // para source="custom": title e body são obrigatórios
 *   title?: string,
 *   body?: string,
 *   url?: string,
 * }
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// ── Formata a mensagem personalizada por fonte e nome do usuário ────────────

function buildMessage(source: string, nome: string): { title: string; body: string; url: string } {
  const primeiroNome = (nome ?? "").split(" ")[0] || "militar";

  switch (source) {
    case "processos":
      return {
        title: "GAP-MN — Atualização de Processos",
        body: `Prezado(a), houve atualização diária nas informações dos processos licitatórios (em andamento ou publicado). Toque para acessar o aplicativo.`,
        url: "/setor",
      };
    case "contratos":
      return {
        title: "GAP-MN — Atualização de Contratos",
        body: `Prezado(a), Houve atualização diária nas informações dos contratos. Toque para acessar o aplicativo.`,
        url: "/setor",
      };
    case "indicadores":
      return {
        title: "GAP-MN — Atualização de Indicadores de Lotação",
        body: `Prezado(a), Houve atualização diária nas informações dos indicadores de lotação. Toque para acessar o aplicativo.`,
        url: "/setor",
      };
    case "orcamento":
      return {
        title: "GAP-MN — Painel Orçamentário Atualizado",
        body: `Prezado(a), Houve atualização diária do Painel Orçamentário com novas informações sobre Crédito Disponível e Solicitações de Empenho. Toque para acessar o aplicativo.`,
        url: "/orcamento",
      };
    default:
      return {
        title: "GAP-MN — Nova Atualização",
        body: `Prezado(a), Há informações atualizadas disponíveis no sistema. Toque para acessar o aplicativo.`,
        url: "/app",
      };
  }
}

// ── Handler principal ───────────────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });

  try {
    const body = await req.json();
    const { source = "custom", user_ids, title: customTitle, body: customBody, url: customUrl } = body;

    const vapidPublicKey  = Deno.env.get("VAPID_PUBLIC_KEY")!;
    const vapidPrivateKey = Deno.env.get("VAPID_PRIVATE_KEY")!;
    const vapidSubject    = Deno.env.get("VAPID_SUBJECT") ?? "mailto:gapmn@eb.mil.br";

    webpush.setVapidDetails(vapidSubject, vapidPublicKey, vapidPrivateKey);

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Busca subscriptions
    let query = supabase
      .from("push_subscriptions")
      .select("id, user_id, endpoint, subscription");
    if (user_ids?.length) query = query.in("user_id", user_ids);

    const { data: subs, error } = await query;
    if (error) throw error;

    // Busca nomes dos usuários em profiles
    const uniqueIds = [...new Set((subs ?? []).map((r: any) => r.user_id))];
    const { data: profiles } = uniqueIds.length
      ? await supabase.from("profiles").select("id, nome_guerra").in("id", uniqueIds)
      : { data: [] };
    const nameMap = new Map((profiles ?? []).map((p: any) => [p.id, p.nome_guerra]));

    const results = [];

    for (const row of subs ?? []) {
      const nome = nameMap.get(row.user_id) ?? "militar";

      // Monta mensagem: customizada ou baseada no source
      let title: string, msgBody: string, url: string;
      if (source === "custom" && customTitle && customBody) {
        title   = customTitle;
        msgBody = customBody;
        url     = customUrl ?? "/app";
      } else {
        ({ title, body: msgBody, url } = buildMessage(source, nome));
      }

      const payload = JSON.stringify({ title, body: msgBody, url, tag: source });

      try {
        await webpush.sendNotification(row.subscription, payload, { TTL: 86400 });
        results.push({ user_id: row.user_id, nome, ok: true });
      } catch (err: any) {
        const status = err.statusCode ?? 0;
        // Remove subscriptions expiradas/canceladas
        if (status === 410 || status === 404) {
          await supabase.from("push_subscriptions").delete().eq("id", row.id);
        }
        results.push({ user_id: row.user_id, nome, ok: false, status, error: err.message });
      }
    }

    const sent = results.filter((r) => r.ok).length;
    return json({ ok: true, sent, total: results.length, results });
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
