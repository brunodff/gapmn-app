// @ts-nocheck
/**
 * Edge Function: send-empenho-email
 * Envia e-mail de notificação de status de Solicitação de Empenho via Resend.
 *
 * Deploy:
 *   supabase functions deploy send-empenho-email --no-verify-jwt
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
  solicitacao_id: string;
  tipo: "EMITIDA" | "ASSINADA";
  email: string;
  responsavel: string;
  numero: string;       // ex: "25S2012"
  subprocesso?: string; // col F (SB)
  ne_siafi: string;
  pag?: string;
  fornecedor?: string;
  valor?: number | null;
  nd?: string;
  pregao?: string;
  obs_atraso?: string;
  pdf_ne_url?: string | null;
  data_emissao?: string; // DD/MM/YYYY
}

function fmtBRL(v: number | null | undefined): string {
  if (!v) return "—";
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(v);
}

function buildInfoEmpenho(p: Payload): string {
  const parts: string[] = [];
  if (p.pag)       parts.push(`PAG: ${p.pag}`);
  if (p.fornecedor) parts.push(`Fornecedor: ${p.fornecedor}`);
  if (p.valor)     parts.push(`Valor: ${fmtBRL(p.valor)}`);
  if (p.nd)        parts.push(`ND: ${p.nd}`);
  if (p.pregao)    parts.push(`Pregão: ${p.pregao}`);
  return parts.join(" | ") || "—";
}

// ── E-mail 1: Empenho emitido ─────────────────────────────────────────────────
function buildEmail1(p: Payload): { subject: string; html: string; text: string } {
  const subject = `[GAPMN] Solicitação ${p.numero} — Empenho emitido`;
  const infoEmpenho = buildInfoEmpenho(p);

  const text = `Prezado(a),\n\nSua solicitação de empenho ${p.numero} foi emitida!\nAcompanhe pelo subprocesso ${p.subprocesso ?? "—"}\nNúmero do empenho emitido: ${p.ne_siafi}\nInformações do empenho: ${infoEmpenho}\n\nO(a) Senhor(a) receberá um novo e-mail com o documento anexado, assim que a Nota de Empenho for assinada.\n\nRespeitosamente,\nSeção de Execução Orçamentária do GAP-MN`;

  const html = `<!DOCTYPE html>
<html lang="pt-BR">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:Arial,Helvetica,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;padding:32px 0;">
<tr><td align="center">
<table width="600" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:14px;overflow:hidden;max-width:600px;box-shadow:0 1px 6px rgba(0,0,0,.08);">

  <tr>
    <td style="background:#0f172a;padding:24px 32px;">
      <p style="margin:0;color:#94a3b8;font-size:11px;letter-spacing:2px;text-transform:uppercase;">GAP-MN · Seção de Execução Orçamentária</p>
      <h1 style="margin:6px 0 0;color:#fff;font-size:20px;font-weight:700;">Empenho Emitido</h1>
    </td>
  </tr>

  <tr>
    <td style="padding:28px 32px 8px;">
      <p style="margin:0 0 20px;font-size:15px;color:#334155;line-height:1.6;">Prezado(a),</p>
      <p style="margin:0 0 20px;font-size:15px;color:#334155;line-height:1.6;">
        Sua solicitação de empenho <strong>${p.numero}</strong> foi <strong>emitida</strong>!
      </p>
    </td>
  </tr>

  <tr>
    <td style="padding:0 32px 28px;">
      <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;border-radius:10px;overflow:hidden;border:1px solid #e2e8f0;">
        <tr style="background:#e2e8f0;">
          <td colspan="2" style="padding:10px 14px;font-size:11px;font-weight:700;color:#475569;text-transform:uppercase;letter-spacing:1px;">Detalhes do Empenho</td>
        </tr>
        <tr style="background:#f8fafc;">
          <td style="padding:9px 14px;font-size:13px;font-weight:600;color:#64748b;white-space:nowrap;width:160px;">Solicitação</td>
          <td style="padding:9px 14px;font-size:13px;color:#0f172a;"><strong>${p.numero}</strong></td>
        </tr>
        ${p.data_emissao ? `<tr><td style="padding:9px 14px;font-size:13px;font-weight:600;color:#64748b;white-space:nowrap;">Data de Emissão</td><td style="padding:9px 14px;font-size:13px;color:#0f172a;">${p.data_emissao}</td></tr>` : ""}
        <tr${p.data_emissao ? "" : ` style="background:#f8fafc;"`}>
          <td style="padding:9px 14px;font-size:13px;font-weight:600;color:#64748b;white-space:nowrap;">Subprocesso</td>
          <td style="padding:9px 14px;font-size:13px;color:#0f172a;">${p.subprocesso ?? "—"}</td>
        </tr>
        <tr style="background:#f8fafc;">
          <td style="padding:9px 14px;font-size:13px;font-weight:600;color:#64748b;white-space:nowrap;">NE SIAFI</td>
          <td style="padding:9px 14px;font-size:13px;color:#0f172a;"><strong>${p.ne_siafi}</strong></td>
        </tr>
        <tr>
          <td style="padding:9px 14px;font-size:13px;font-weight:600;color:#64748b;white-space:nowrap;">Informações</td>
          <td style="padding:9px 14px;font-size:13px;color:#0f172a;">${infoEmpenho}</td>
        </tr>
        ${p.obs_atraso ? `<tr style="background:#fef2f2;"><td style="padding:9px 14px;font-size:13px;font-weight:600;color:#dc2626;white-space:nowrap;">Obs. Atraso</td><td style="padding:9px 14px;font-size:13px;color:#dc2626;">${p.obs_atraso}</td></tr>` : ""}
      </table>
    </td>
  </tr>

  <tr>
    <td style="padding:0 32px 28px;">
      <p style="margin:0;font-size:14px;color:#334155;line-height:1.7;background:#f0f9ff;border-left:3px solid #0ea5e9;padding:12px 16px;border-radius:0 8px 8px 0;">
        O(a) Senhor(a) receberá um novo e-mail com o documento anexado, assim que a Nota de Empenho for assinada.
      </p>
    </td>
  </tr>

  <tr>
    <td style="padding:16px 32px 24px;background:#f8fafc;border-top:1px solid #e2e8f0;">
      <p style="margin:0 0 6px;font-size:13px;color:#475569;font-weight:600;">Respeitosamente,</p>
      <p style="margin:0 0 8px;font-size:13px;color:#475569;">Seção de Execução Orçamentária do GAP-MN</p>
      <p style="margin:0;font-size:11px;color:#94a3b8;">Este é um e-mail automático do sistema GAPMN. Não responda a esta mensagem.</p>
    </td>
  </tr>

</table>
</td></tr>
</table>
</body>
</html>`;

  return { subject, html, text };
}

// ── E-mail 2: Empenho assinado ────────────────────────────────────────────────
// NOTA: anexo do documento NE pendente confirmação — e-mail enviado sem anexo por ora.
function buildEmail2(p: Payload): { subject: string; html: string; text: string } {
  const subject = `[GAPMN] Solicitação ${p.numero} — Nota de Empenho assinada`;
  const infoEmpenho = buildInfoEmpenho(p);

  const pdfLine = p.pdf_ne_url ? `\nDownload da NE: ${p.pdf_ne_url}\n` : "";
  const text = `Prezado(a),\n\nSua solicitação de empenho ${p.numero} foi assinada!\nNúmero do empenho: ${p.ne_siafi}\nAcompanhe pelo subprocesso ${p.subprocesso ?? "—"}\nInformações do empenho: ${infoEmpenho}\n${pdfLine}\nA Nota de Empenho já foi assinada pelo(a) Ordenador(a) de Despesas e está em vigor.\n\nCaso não seja o responsável pela Solicitação de Empenho, entre em contato com o atual responsável para que seja realizada a correção da descrição da Solicitação de Empenho.\n\nRespeitosamente,\nSeção de Execução Orçamentária do GAP-MN`;

  const html = `<!DOCTYPE html>
<html lang="pt-BR">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:Arial,Helvetica,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;padding:32px 0;">
<tr><td align="center">
<table width="600" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:14px;overflow:hidden;max-width:600px;box-shadow:0 1px 6px rgba(0,0,0,.08);">

  <tr>
    <td style="background:#14532d;padding:24px 32px;">
      <p style="margin:0;color:#bbf7d0;font-size:11px;letter-spacing:2px;text-transform:uppercase;">GAP-MN · Seção de Execução Orçamentária</p>
      <h1 style="margin:6px 0 0;color:#fff;font-size:20px;font-weight:700;">✅ Nota de Empenho Assinada</h1>
    </td>
  </tr>

  <tr>
    <td style="padding:28px 32px 8px;">
      <p style="margin:0 0 20px;font-size:15px;color:#334155;line-height:1.6;">Prezado(a),</p>
      <p style="margin:0 0 20px;font-size:15px;color:#334155;line-height:1.6;">
        A Nota de Empenho referente à solicitação <strong>${p.numero}</strong> foi <strong>assinada</strong> pelo(a) Ordenador(a) de Despesas e está em vigor.
      </p>
      ${p.pdf_ne_url ? `<div style="text-align:center;margin-bottom:20px;"><a href="${p.pdf_ne_url}" target="_blank" style="display:inline-block;background:#15803d;color:#fff;padding:10px 24px;border-radius:8px;font-size:14px;font-weight:700;text-decoration:none;">📄 Baixar Nota de Empenho (PDF)</a></div>` : ""}
    </td>
  </tr>

  <tr>
    <td style="padding:0 32px 28px;">
      <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;border-radius:10px;overflow:hidden;border:1px solid #e2e8f0;">
        <tr style="background:#dcfce7;">
          <td colspan="2" style="padding:10px 14px;font-size:11px;font-weight:700;color:#14532d;text-transform:uppercase;letter-spacing:1px;">Detalhes do Empenho</td>
        </tr>
        <tr style="background:#f8fafc;">
          <td style="padding:9px 14px;font-size:13px;font-weight:600;color:#64748b;white-space:nowrap;width:160px;">Solicitação</td>
          <td style="padding:9px 14px;font-size:13px;color:#0f172a;"><strong>${p.numero}</strong></td>
        </tr>
        ${p.data_emissao ? `<tr><td style="padding:9px 14px;font-size:13px;font-weight:600;color:#64748b;white-space:nowrap;">Data de Emissão</td><td style="padding:9px 14px;font-size:13px;color:#0f172a;">${p.data_emissao}</td></tr>` : ""}
        <tr style="background:#f8fafc;">
          <td style="padding:9px 14px;font-size:13px;font-weight:600;color:#64748b;white-space:nowrap;">NE SIAFI</td>
          <td style="padding:9px 14px;font-size:13px;color:#0f172a;"><strong>${p.ne_siafi}</strong></td>
        </tr>
        <tr>
          <td style="padding:9px 14px;font-size:13px;font-weight:600;color:#64748b;white-space:nowrap;">Subprocesso</td>
          <td style="padding:9px 14px;font-size:13px;color:#0f172a;">${p.subprocesso ?? "—"}</td>
        </tr>
        <tr style="background:#f8fafc;">
          <td style="padding:9px 14px;font-size:13px;font-weight:600;color:#64748b;white-space:nowrap;">Informações</td>
          <td style="padding:9px 14px;font-size:13px;color:#0f172a;">${infoEmpenho}</td>
        </tr>
      </table>
    </td>
  </tr>

  <tr>
    <td style="padding:16px 32px 24px;background:#f8fafc;border-top:1px solid #e2e8f0;">
      <p style="margin:0 0 8px;font-size:12px;color:#475569;line-height:1.7;">
        Caso não seja o responsável pela Solicitação de Empenho, entre em contato com o atual responsável para que seja realizada a correção da descrição da Solicitação de Empenho.
      </p>
      <p style="margin:6px 0 0;font-size:13px;color:#475569;font-weight:600;">Respeitosamente,</p>
      <p style="margin:0 0 8px;font-size:13px;color:#475569;">Seção de Execução Orçamentária do GAP-MN</p>
      <p style="margin:0;font-size:11px;color:#94a3b8;">Este é um e-mail automático do sistema GAPMN. Não responda a esta mensagem.</p>
    </td>
  </tr>

</table>
</td></tr>
</table>
</body>
</html>`;

  return { subject, html, text };
}

// ── Handler ───────────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });

  try {
    const payload: Payload = await req.json();
    const { solicitacao_id, tipo, email } = payload;

    const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") ?? "";
    const RESEND_FROM    = Deno.env.get("RESEND_FROM") ?? "GAPMN <noreply@gapmn.app>";

    const { subject, html, text } = tipo === "EMITIDA"
      ? buildEmail1(payload)
      : buildEmail2(payload);

    const resendRes = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ from: RESEND_FROM, to: [email], subject, html, text }),
    });

    const resendJson = await resendRes.json();
    const sucesso    = resendRes.ok;

    const supa = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    await supa.from("notificacoes_empenho_log").insert({
      solicitacao_id,
      tipo,
      email_destino: email,
      sucesso,
      erro: sucesso ? null : JSON.stringify(resendJson),
    });

    if (!sucesso) return json({ ok: false, error: resendJson }, 500);
    return json({ ok: true, resend_id: resendJson.id });
  } catch (err) {
    console.error(err);
    return json({ ok: false, error: String(err) }, 500);
  }
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}
