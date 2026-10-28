// @ts-nocheck
/**
 * Edge Function: auto-solicitacoes-empenho
 *
 * Envio automático do e-mail ao fiscal quando o empenho da solicitação é emitido e quando é
 * assinado. Lê a planilha "Notas de Empenho" (a mesma do painel), compara com a tabela
 * solicitacoes_empenho e manda os e-mails pela função send-empenho-email (que registra cada envio
 * em notificacoes_empenho_log). Substitui o botão "Sincronizar SIAFI" + "Verificar e Fechar".
 * A regra fica em ../_shared/solicitacoesAuto.ts (com testes).
 *
 * Quem pode chamar: o agendamento (cabeçalho x-sync-key = secret SYNC_PROCESSOS_KEY, o mesmo da
 * sincronização de processos) ou um usuário do app da SEO/ADMIN/DEV (Authorization: Bearer <JWT>).
 *
 * POST JSON (opcional): { "origem": "cron" | "manual", "simular": true }
 *   simular = só diz o que faria, sem gravar nem enviar.
 *
 * Deploy:  supabase functions deploy auto-solicitacoes-empenho --no-verify-jwt
 * Agenda:  migração 20261028_solicitacoes_envio_automatico.sql (pg_cron a cada 15 min, 07h–21h45 de Manaus)
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { lerNEs, parseCSV, pedidoDeEmail, planejar } from "../_shared/solicitacoesAuto.ts";

const PLANILHA_NE =
  Deno.env.get("PLANILHA_NE_URL") ??
  "https://docs.google.com/spreadsheets/d/1XQ5CGcB0dTVADeEGfKjtXRhqtHxsNf1J1H_9VKjBklM/export?format=csv&gid=1297815245";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-sync-key",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });
const esperar = (ms: number) => new Promise((r) => setTimeout(r, ms));

const COLUNAS =
  "id, numero, pag, responsavel, email, obs_original, obs_atraso, status, ne_siafi, subprocesso, nd, fornecedor, valor, pregao, sem_destinatario, notificado_emitida_em, notificado_assinada_em, notificacao_ativa, pdf_ne_url, data_emissao, revisado_em";

async function lerTudo(admin, tabela: string, colunas: string) {
  const linhas = [];
  for (let de = 0; ; de += 1000) {
    const { data, error } = await admin.from(tabela).select(colunas).order("id").range(de, de + 999);
    if (error) throw new Error(`${tabela}: ${error.message}`);
    linhas.push(...(data ?? []));
    if (!data || data.length < 1000) return linhas;
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });

  const URL_SUPABASE = Deno.env.get("SUPABASE_URL")!;
  const CHAVE_SERVICO = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const admin = createClient(URL_SUPABASE, CHAVE_SERVICO, { auth: { persistSession: false } });

  // ── quem chamou ──────────────────────────────────────────────────────────────
  const corpoPedido = await req.json().catch(() => ({}));
  let origem = "manual";
  let usuario: string | null = null;
  const chaveAgenda = Deno.env.get("SYNC_PROCESSOS_KEY") || "";
  if (chaveAgenda && req.headers.get("x-sync-key") === chaveAgenda) {
    origem = corpoPedido?.origem === "manual" ? "manual" : "cron";
  } else {
    const jwt = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
    const { data } = jwt ? await admin.auth.getUser(jwt) : { data: null };
    const user = data?.user;
    if (!user) return json({ ok: false, erro: "Sem login." }, 401);
    const { data: perfil } = await admin.from("profiles").select("setor").eq("id", user.id).maybeSingle();
    if (!["SEO", "ADMIN", "DEV"].includes(String(perfil?.setor || "").toUpperCase())) {
      return json({ ok: false, erro: "Só SEO, ADMIN e DEV podem pedir a verificação." }, 403);
    }
    usuario = user.id;
  }
  const simular = corpoPedido?.simular === true;

  const inicio = Date.now();
  const agora = new Date().toISOString();
  const itens = [];
  let erroGeral: string | null = null;
  let plano = null;

  try {
    // ── leitura ────────────────────────────────────────────────────────────────
    const resp = await fetch(PLANILHA_NE, { headers: { "Cache-Control": "no-cache" } });
    if (!resp.ok) throw new Error(`Planilha de empenhos respondeu ${resp.status}.`);
    const texto = await resp.text();
    if (/^\s*<(!doctype|html)/i.test(texto)) throw new Error("A planilha de empenhos não está publicada por link.");
    const nes = lerNEs(parseCSV(texto));
    if (nes.length < 100) throw new Error(`A planilha veio com só ${nes.length} lançamentos: leitura suspensa por segurança.`);

    const solicitacoes = (await lerTudo(admin, "solicitacoes_empenho", COLUNAS)).map((s) => ({ ...s, valor: s.valor === null ? null : Number(s.valor) }));
    const { data: modelo } = await admin.from("email_templates").select("assunto, corpo").eq("tipo", "FISCAL").maybeSingle();
    plano = planejar(nes, solicitacoes);

    if (simular) {
      return json({
        ok: true, simulacao: true, nes_lidas: plano.nesLidas, novas: plano.novas.length, atualizacoes: plano.atualizacoes.length,
        sem_mudanca: plano.semMudanca,
        acoes: plano.acoes.map((a) => ({ numero: a.numero, ne: a.ne, tipo: a.tipo, resultado: a.resultado, nova: a.nova })),
      });
    }

    // ── registros novos ───────────────────────────────────────────────────────
    const idPorNumero = new Map(solicitacoes.map((s) => [s.numero.toUpperCase(), s.id]));
    if (plano.novas.length) {
      const { error } = await admin.from("solicitacoes_empenho")
        .upsert(plano.novas.map((n) => ({ ...n, updated_at: agora })), { onConflict: "numero", ignoreDuplicates: true });
      if (error) throw new Error(`Gravar solicitações novas: ${error.message}`);
      const { data: criados } = await admin.from("solicitacoes_empenho").select("id, numero").in("numero", plano.novas.map((n) => n.numero));
      for (const c of criados ?? []) idPorNumero.set(c.numero.toUpperCase(), c.id);
    }

    // ── só situação/NE ────────────────────────────────────────────────────────
    for (const u of plano.atualizacoes) {
      await admin.from("solicitacoes_empenho").update({ ...u.patch, updated_at: agora }).eq("id", u.id);
    }

    // ── e-mails ───────────────────────────────────────────────────────────────
    for (const a of plano.acoes) {
      const id = a.id || idPorNumero.get(a.numero.toUpperCase());
      const item = { numero: a.numero, ne: a.ne, tipo: a.tipo, nova: a.nova, email: a.email, resultado: a.resultado, motivo: null };
      if (!id) { itens.push({ ...item, resultado: "ERRO", motivo: "Registro novo não encontrado depois de gravar." }); continue; }
      if (a.patch) await admin.from("solicitacoes_empenho").update({ ...a.patch, updated_at: agora }).eq("id", id);
      if (a.resultado !== "ENVIAR") { itens.push({ ...item, motivo: a.resultado === "SEM_EMAIL" ? "Sem e-mail na observação da NE" : "Notificação desligada" }); continue; }

      // reserva o envio antes de mandar: duas execuções ao mesmo tempo não mandam o mesmo e-mail duas vezes
      const campo = a.tipo === "ASSINADA" ? "notificado_assinada_em" : "notificado_emitida_em";
      const { data: reservado } = await admin.from("solicitacoes_empenho").update({ [campo]: agora }).eq("id", id).is(campo, null).select("id");
      if (!reservado?.length) { itens.push({ ...item, resultado: "JA_ENVIADO", motivo: "Outra execução já enviou." }); continue; }

      const r = await fetch(`${URL_SUPABASE}/functions/v1/send-empenho-email`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${CHAVE_SERVICO}` },
        body: JSON.stringify(pedidoDeEmail(a, id, modelo ?? null)),
      });
      const resposta = await r.json().catch(() => ({}));
      if (r.ok && resposta?.ok !== false) {
        // e-mail de assinada enviado = item verificado (antes era o botão "Verificar e Fechar")
        if (a.tipo === "ASSINADA") await admin.from("solicitacoes_empenho").update({ revisado_em: agora }).eq("id", id);
        itens.push({ ...item, resultado: "ENVIADO" });
      } else {
        await admin.from("solicitacoes_empenho").update({ [campo]: null }).eq("id", id);
        itens.push({ ...item, resultado: "ERRO", motivo: JSON.stringify(resposta?.error ?? resposta).slice(0, 300) });
      }
      await esperar(600); // o Resend aceita poucos envios por segundo
    }
  } catch (e) {
    erroGeral = e instanceof Error ? e.message : String(e);
  }

  const conta = (r: string) => itens.filter((i) => i.resultado === r).length;
  const execucao = {
    executado_em: agora,
    origem,
    usuario,
    duracao_ms: Date.now() - inicio,
    nes_lidas: plano?.nesLidas ?? 0,
    novas: plano?.novas.length ?? 0,
    atualizadas: plano?.atualizacoes.length ?? 0,
    enviados: conta("ENVIADO"),
    sem_email: conta("SEM_EMAIL"),
    inativas: conta("NOTIF_INATIVA"),
    erros: conta("ERRO") + (erroGeral ? 1 : 0),
    itens,
    erro: erroGeral,
  };
  await admin.from("solicitacoes_auto_execucoes").insert(execucao);
  // leituras sem nada a fazer só interessam por um mês (são ~60 por dia)
  const umMes = new Date(Date.now() - 30 * 86_400_000).toISOString();
  await admin.from("solicitacoes_auto_execucoes").delete().lt("executado_em", umMes).eq("itens", "[]").is("erro", null);
  return json({ ok: !erroGeral, ...execucao }, erroGeral ? 500 : 200);
});
