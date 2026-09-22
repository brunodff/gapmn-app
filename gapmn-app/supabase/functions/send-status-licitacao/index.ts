// @ts-nocheck
/**
 * Edge Function: send-status-licitacao
 * Envia e-mail automático ao responsável da apoiada quando o status
 * de um processo licitatório é alterado pela SLIC no Calendário GAPMN.
 *
 * Deploy:
 *   supabase functions deploy send-status-licitacao --no-verify-jwt
 *
 * Secrets (Supabase → Settings → Edge Functions → Secrets):
 *   RESEND_API_KEY  = re_xxxx
 *   RESEND_FROM     = GAPMN <noreply@gapmn.app>
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface Payload {
  processo_id: string;
  novo_status: string;
  email: string;
  responsavel_apoiada: string;
  num_contratacao?: string;
  num_dfd?: string;
  descricao_objeto?: string;
  apoiada?: string;
  situacao_detalhada?: string;
  remetente?: string;
  previsao_finalizacao?: string;
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

function statusColor(s: string): string {
  const v = s.toLowerCase();
  if (v.includes("homolog") || v.includes("assinado")) return "#16a34a";
  if (v.includes("cancel") || v.includes("suspen") || v.includes("deserto") || v.includes("fracas")) return "#dc2626";
  if (v.includes("licitaç") || v.includes("licitac") || v.includes("sessão")) return "#2563eb";
  if (v.includes("cju") || v.includes("aci") || v.includes("publicaç")) return "#7c3aed";
  return "#d97706";
}

function statusBg(s: string): string {
  const v = s.toLowerCase();
  if (v.includes("homolog") || v.includes("assinado")) return "#dcfce7";
  if (v.includes("cancel") || v.includes("suspen") || v.includes("deserto") || v.includes("fracas")) return "#fee2e2";
  if (v.includes("licitaç") || v.includes("licitac") || v.includes("sessão")) return "#dbeafe";
  if (v.includes("cju") || v.includes("aci") || v.includes("publicaç")) return "#ede9fe";
  return "#fef3c7";
}

function buildEmail(p: Payload): { subject: string; html: string; text: string } {
  const identificacao = p.num_contratacao
    ? `Contratação ${p.num_contratacao}${p.num_dfd ? ` (DFD ${p.num_dfd})` : ""}`
    : p.num_dfd
    ? `DFD ${p.num_dfd}`
    : "Processo sem número";

  const subject = `[GAPMN] Atualização de Processo — ${identificacao}`;

  const cor    = statusColor(p.novo_status);
  const fundo  = statusBg(p.novo_status);
  const prevStr = p.previsao_finalizacao
    ? new Date(p.previsao_finalizacao + "T12:00:00").toLocaleDateString("pt-BR")
    : null;

  const text =
    `Prezado(a) ${p.responsavel_apoiada},\n\n` +
    `O status do processo a seguir foi atualizado pela Seção de Licitações do GAP-MN.\n\n` +
    `Processo: ${identificacao}\n` +
    (p.descricao_objeto ? `Objeto: ${p.descricao_objeto}\n` : "") +
    (p.apoiada ? `Apoiada: ${p.apoiada}\n` : "") +
    `\nNovo Status: ${p.novo_status}\n` +
    (p.situacao_detalhada ? `Detalhamento: ${p.situacao_detalhada}\n` : "") +
    (prevStr ? `Previsão de Finalização: ${prevStr}\n` : "") +
    `\nResponsável pelo processo: ${p.remetente ?? "SLIC/GAP-MN"}\n` +
    `\nEste é um e-mail automático enviado pelo Sistema GAPMN.\n` +
    `Para dúvidas, entre em contato com a Seção de Licitações do GAP-MN.\n\n` +
    `Respeitosamente,\nSeção de Licitações — GAP-MN`;

  const html = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${subject}</title>
</head>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:'Segoe UI',Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;padding:32px 0;">
  <tr>
    <td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;">

        <!-- Header -->
        <tr>
          <td style="background:#0f172a;border-radius:12px 12px 0 0;padding:28px 36px;">
            <table width="100%" cellpadding="0" cellspacing="0">
              <tr>
                <td>
                  <span style="color:#38bdf8;font-size:11px;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;">
                    Seção de Licitações — GAP-MN
                  </span>
                  <div style="color:#f8fafc;font-size:19px;font-weight:700;margin-top:6px;line-height:1.3;">
                    Atualização de Processo Licitatório
                  </div>
                </td>
                <td align="right" style="vertical-align:middle;">
                  <div style="background:rgba(56,189,248,0.12);border:1px solid rgba(56,189,248,0.3);border-radius:8px;padding:8px 14px;color:#38bdf8;font-size:11px;font-weight:700;letter-spacing:0.05em;white-space:nowrap;">
                    GAPMN
                  </div>
                </td>
              </tr>
            </table>
          </td>
        </tr>

        <!-- Status badge -->
        <tr>
          <td style="background:#ffffff;padding:28px 36px 20px;">
            <p style="margin:0 0 8px;font-size:12px;color:#64748b;font-weight:600;text-transform:uppercase;letter-spacing:0.08em;">
              Novo Status
            </p>
            <div style="display:inline-block;background:${fundo};border-radius:20px;padding:7px 18px;">
              <span style="color:${cor};font-size:14px;font-weight:700;">${p.novo_status}</span>
            </div>
          </td>
        </tr>

        <!-- Dados do processo -->
        <tr>
          <td style="background:#ffffff;padding:0 36px 28px;">
            <table width="100%" cellpadding="0" cellspacing="0" style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;overflow:hidden;">
              <tr>
                <td colspan="2" style="background:#e2e8f0;padding:10px 16px;">
                  <span style="font-size:11px;font-weight:700;color:#475569;text-transform:uppercase;letter-spacing:0.08em;">Dados do Processo</span>
                </td>
              </tr>
              <tr>
                <td style="padding:10px 16px;font-size:12px;color:#64748b;font-weight:600;width:38%;border-bottom:1px solid #e2e8f0;">Identificação</td>
                <td style="padding:10px 16px;font-size:13px;color:#1e293b;font-weight:700;border-bottom:1px solid #e2e8f0;">${identificacao}</td>
              </tr>
              ${p.descricao_objeto ? `
              <tr>
                <td style="padding:10px 16px;font-size:12px;color:#64748b;font-weight:600;border-bottom:1px solid #e2e8f0;">Objeto</td>
                <td style="padding:10px 16px;font-size:13px;color:#1e293b;border-bottom:1px solid #e2e8f0;">${p.descricao_objeto}</td>
              </tr>` : ""}
              ${p.apoiada ? `
              <tr>
                <td style="padding:10px 16px;font-size:12px;color:#64748b;font-weight:600;border-bottom:1px solid #e2e8f0;">Apoiada</td>
                <td style="padding:10px 16px;font-size:13px;color:#1e293b;border-bottom:1px solid #e2e8f0;">${p.apoiada}</td>
              </tr>` : ""}
              ${p.situacao_detalhada ? `
              <tr>
                <td style="padding:10px 16px;font-size:12px;color:#64748b;font-weight:600;border-bottom:1px solid #e2e8f0;">Detalhamento</td>
                <td style="padding:10px 16px;font-size:13px;color:#1e293b;border-bottom:1px solid #e2e8f0;">${p.situacao_detalhada}</td>
              </tr>` : ""}
              ${prevStr ? `
              <tr>
                <td style="padding:10px 16px;font-size:12px;color:#64748b;font-weight:600;">Previsão de Finalização</td>
                <td style="padding:10px 16px;font-size:13px;color:#1e293b;">${prevStr}</td>
              </tr>` : ""}
            </table>
          </td>
        </tr>

        <!-- Responsável -->
        <tr>
          <td style="background:#ffffff;padding:0 36px 28px;">
            <table width="100%" cellpadding="0" cellspacing="0" style="background:#f0f9ff;border:1px solid #bae6fd;border-radius:10px;padding:14px 16px;">
              <tr>
                <td>
                  <p style="margin:0;font-size:12px;color:#0369a1;font-weight:600;">
                    Responsável pelo processo na SLIC
                  </p>
                  <p style="margin:4px 0 0;font-size:14px;color:#0c4a6e;font-weight:700;">
                    ${p.remetente ?? "Seção de Licitações — GAP-MN"}
                  </p>
                </td>
              </tr>
            </table>
          </td>
        </tr>

        <!-- Footer -->
        <tr>
          <td style="background:#0f172a;border-radius:0 0 12px 12px;padding:20px 36px;">
            <p style="margin:0;font-size:11px;color:rgba(248,250,252,0.45);text-align:center;line-height:1.6;">
              Este é um e-mail automático enviado pelo Sistema GAPMN.<br>
              Para dúvidas, entre em contato com a Seção de Licitações do GAP-MN.<br>
              <span style="color:rgba(248,250,252,0.25);">Grupamento de Apoio de Manaus — Força Aérea Brasileira</span>
            </p>
          </td>
        </tr>

      </table>
    </td>
  </tr>
</table>
</body>
</html>`;

  return { subject, html, text };
}

// ── Handler ───────────────────────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  try {
    const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") ?? "";
    const RESEND_FROM    = Deno.env.get("RESEND_FROM") ?? "GAPMN <noreply@gapmn.app>";

    if (!RESEND_API_KEY) return json({ ok: false, error: "RESEND_API_KEY não configurado" }, 500);

    const payload: Payload = await req.json();
    const { processo_id, novo_status, email } = payload;

    if (!email)       return json({ ok: false, error: "Campo 'email' obrigatório" }, 400);
    if (!novo_status) return json({ ok: false, error: "Campo 'novo_status' obrigatório" }, 400);

    const { subject, html, text } = buildEmail(payload);

    const resendRes = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ from: RESEND_FROM, to: [email], subject, html, text }),
    });

    const resendJson = await resendRes.json();
    const sucesso = resendRes.ok;

    // Registrar no log
    const supa = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    );
    await supa.from("notificacoes_licitacao_log").insert({
      processo_id: processo_id ?? null,
      novo_status,
      email_destino: email,
      sucesso,
      erro: sucesso ? null : JSON.stringify(resendJson),
    });

    if (!sucesso) return json({ ok: false, error: resendJson }, 502);
    return json({ ok: true, resend_id: resendJson.id });

  } catch (err) {
    return json({ ok: false, error: String(err) }, 500);
  }
});
