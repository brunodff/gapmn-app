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
  solicitacao_id?: string;
  tipo: "EMITIDA" | "ASSINADA" | "FORNECEDOR" | "CONVOCACAO";
  email: string;
  responsavel?: string;
  numero?: string;
  ne_siafi?: string;
  pag?: string;
  fornecedor?: string;
  valor?: number | null;
  nd?: string;
  pregao?: string;
  obs_atraso?: string;
  pdf_ne_url?: string | null;
  data_emissao?: string;
  // Campos para EMITIDA/ASSINADA com template customizado
  assunto_customizado?: string;
  corpo_customizado?: string;
  // Campos exclusivos de CONVOCACAO
  ne_numero?: string;
  om_nome?: string;
  contato?: string;
  favorecido_nome?: string;
  pdf_base64?: string;
  pdf_filename?: string;
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

  const text = `Prezado(a),\n\nSua solicitação de empenho ${p.numero} foi emitida!\nNúmero do empenho emitido: ${p.ne_siafi}\nInformações do empenho: ${infoEmpenho}\n\nO(a) Senhor(a) receberá um novo e-mail com o documento anexado, assim que a Nota de Empenho for assinada.\n\nRespeitosamente,\nSeção de Execução Orçamentária do GAP-MN`;

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
function buildEmail2(p: Payload): { subject: string; html: string; text: string } {
  const subject = p.assunto_customizado ?? `[GAPMN] Solicitação ${p.numero} — Nota de Empenho assinada`;
  const infoEmpenho = buildInfoEmpenho(p);

  if (p.corpo_customizado) {
    const text = p.corpo_customizado;
    const htmlCorpo = p.corpo_customizado
      .split(/\n\n+/)
      .map(par => `<p style="margin:0 0 14px;font-size:14px;color:#1e293b;line-height:1.7;">${par.replace(/\n/g, "<br>")}</p>`)
      .join("");
    const html = `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:Arial,Helvetica,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;padding:32px 0;">
<tr><td align="center">
<table width="600" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:14px;overflow:hidden;max-width:600px;box-shadow:0 1px 6px rgba(0,0,0,.08);">
  <tr><td style="background:#14532d;padding:24px 32px;">
    <p style="margin:0;color:#bbf7d0;font-size:11px;letter-spacing:2px;text-transform:uppercase;">GAP-MN · Seção de Execução Orçamentária</p>
    <h1 style="margin:6px 0 0;color:#fff;font-size:20px;font-weight:700;">✅ Nota de Empenho Assinada</h1>
  </td></tr>
  ${p.pdf_ne_url ? `<tr><td style="padding:20px 32px 0;text-align:center;"><a href="${p.pdf_ne_url}" target="_blank" style="display:inline-block;background:#15803d;color:#fff;padding:10px 24px;border-radius:8px;font-size:14px;font-weight:700;text-decoration:none;">📄 Baixar Nota de Empenho (PDF)</a></td></tr>` : ""}
  <tr><td style="padding:20px 32px 24px;">${htmlCorpo}</td></tr>
  <tr><td style="padding:14px 32px 20px;background:#f8fafc;border-top:1px solid #e2e8f0;">
    <p style="margin:0;font-size:11px;color:#94a3b8;">Este é um e-mail automático do sistema GAPMN. Não responda a esta mensagem.</p>
  </td></tr>
</table>
</td></tr>
</table>
</body></html>`;
    return { subject, html, text };
  }

  const pdfLine = p.pdf_ne_url ? `\nDownload da NE: ${p.pdf_ne_url}\n` : "";
  const text = `Prezado(a),\n\nSua solicitação de empenho ${p.numero} foi assinada!\nNúmero do empenho: ${p.ne_siafi}\nInformações do empenho: ${infoEmpenho}\n${pdfLine}\nA Nota de Empenho já foi assinada pelo(a) Ordenador(a) de Despesas e está em vigor.\n\nCaso não seja o responsável pela Solicitação de Empenho, entre em contato com o atual responsável para que seja realizada a correção da descrição da Solicitação de Empenho.\n\nRespeitosamente,\nSeção de Execução Orçamentária do GAP-MN`;

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

// ── E-mail 3: Convocação ao Fornecedor (drag-drop PDF) ────────────────────────
function buildEmailConvocacao(p: Payload): { subject: string; html: string; text: string } {
  const ne     = p.ne_numero ?? "—";
  const om     = p.om_nome  ?? "GRUPAMENTO DE APOIO DE MANAUS";
  const contato = p.contato ?? "—";

  const subject = `[GAP-MN] Convocação — Nota de Empenho ${ne}`;

  const text = `A UNIÃO, por intermédio do ${om} - GAP-MN, está convocando V.Sa., por meio da Nota de Empenho nº ${ne}, juntada em anexo. Solicito a esta Empresa que atentem para as seguintes informações:

1 - LEIA ATENTAMENTE AS INFORMAÇÕES CONTIDAS NO EMPENHO EM ANEXO, ESPECIFICAMENTE: SOBRE A ESPÉCIE DO EMPENHO, PODENDO SER * EMPENHO DE DESPESA = PARA FORNECER OU ANULAÇÃO = CANCELAMENTO DE OUTRO EMPENHO;

2 - SENDO EMPENHO DE DESPESA, A EMPRESA DEVE FORNECER E ATENTAR-SE PARA O PRAZO DE ENTREGA CONSTANTE NO TERMO DE REFERÊNCIA DO PREGÃO GERADOR DO EMPENHO PELO QUAL ESTEJA SENDO CONVOCADO; OU

3 - SENDO EMPENHO DE ANULAÇÃO, DESCONSIDERAR (SE HOUVER) CONVOCAÇÃO ANTERIOR PARA FORNECIMENTO DO OBJETO DO EMPENHO ANULADO;

4 - TRATANDO-SE DE EMPENHO PARA FORNECIMENTO, OS OBJETOS E/OU SERVIÇOS DEVEM SER ENTREGUES ACOMPANHADOS DA NOTA FISCAL NO ENDEREÇO SEGUINTE:

LOCAL: ${om}
Endereço: Av. Santos Dumont, S/Nº - Tarumã — CEP: 69.041.000 - Manaus-AM — Tel: (92) 3652-5872


CONTATO DO MILITAR RESPONSÁVEL:

${contato}


5 - CASO A EMPRESA VENHA NECESSITAR DE ALGUMA DAS INFORMAÇÕES ABAIXO RELACIONADA, POR FAVOR CONTATAR OS SETORES RESPONSÁVEIS:

NOTA FISCAL, DEVERÁ CONTATAR A SEÇÃO DE ALMOXARIFADO PELO TELEFONE (92) 3652-5822 /5824 / 5825; e-mail: moraeslfm@fab.mil.br

LIQUIDAÇÃO, DEVERÁ CONTATAR A SEÇÃO DE LIQUIDAÇÃO PELO TELEFONE (92) 3614-1569 e-mail: moraeslfm@fab.mil.br

PAGAMENTO, DEVERÁ CONTATAR A SEÇÃO DE FINANÇAS PELO TELEFONE (92) 3614-1526, e-mail HELTONHTS@fab.mil.br

Por fim, esta Administração salienta, que caso a Empresa não cumpra o prazo estabelecido no referido termo, esta estará sujeita a sanções conforme prevê no edital, bem como, as normas legais aplicáveis ao processo licitatório, após processo administrativo que assegurem a ampla defesa e o contraditório.

* POR GENTILEZA ACUSAR RECEBIMENTO.



DIVISÃO ADMINISTRATIVA DO GAP-MN

TELEFONE: (92) 3614-1569`;

  const paraStyle = `style="margin:0 0 16px;font-size:14px;color:#1e293b;line-height:1.75;"`;
  const htmlBody = text
    .split(/\n\n+/)
    .map(par => `<p ${paraStyle}>${par.replace(/\n/g, "<br>")}</p>`)
    .join("");

  const html = `<!DOCTYPE html>
<html lang="pt-BR">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:Arial,Helvetica,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;padding:32px 0;">
<tr><td align="center">
<table width="600" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:14px;overflow:hidden;max-width:600px;box-shadow:0 1px 6px rgba(0,0,0,.08);">

  <tr>
    <td style="background:#1e3a5f;padding:24px 32px;">
      <p style="margin:0;color:#93c5fd;font-size:11px;letter-spacing:2px;text-transform:uppercase;">GAP-MN · Divisão Administrativa</p>
      <h1 style="margin:6px 0 0;color:#fff;font-size:20px;font-weight:700;">📋 Convocação — Nota de Empenho</h1>
      <p style="margin:6px 0 0;color:#bfdbfe;font-size:13px;">NE nº <strong>${ne}</strong>${p.favorecido_nome ? ` · ${p.favorecido_nome}` : ""}</p>
    </td>
  </tr>

  <tr>
    <td style="padding:28px 32px 4px;">
      ${htmlBody}
    </td>
  </tr>

  <tr>
    <td style="padding:14px 32px 20px;background:#f8fafc;border-top:1px solid #e2e8f0;">
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
    const { solicitacao_id, tipo, email, pdf_base64, pdf_filename } = payload;

    const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") ?? "";
    const RESEND_FROM    = Deno.env.get("RESEND_FROM") ?? "GAPMN <noreply@gapmn.app>";

    const { subject, html, text } =
      tipo === "EMITIDA"      ? buildEmail1(payload) :
      tipo === "CONVOCACAO"   ? buildEmailConvocacao(payload) :
      tipo === "FORNECEDOR"   ? buildEmailConvocacao(payload) : // legado
                                buildEmail2(payload);

    const resendBody: Record<string, unknown> = {
      from: RESEND_FROM,
      to: [email],
      subject,
      html,
      text,
    };

    // Anexa PDF se fornecido em base64
    if (pdf_base64) {
      resendBody.attachments = [{
        filename: pdf_filename ?? `NE-${payload.ne_numero ?? "empenho"}.pdf`,
        content:  pdf_base64,
      }];
    }

    const resendRes = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(resendBody),
    });

    const resendJson = await resendRes.json();
    const sucesso    = resendRes.ok;

    // Loga apenas quando há solicitacao_id (evita FK violation para CONVOCACAO avulsa)
    if (solicitacao_id) {
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
    }

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
