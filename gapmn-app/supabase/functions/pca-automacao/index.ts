// @ts-nocheck
/**
 * Edge Function: pca-automacao (nov/2026) — Acompanhamento do PCA da SLIC (pedido da Ten Gabriela).
 * As regras ficam em src/lib/pca (as mesmas da tela, com testes); aqui só se lê, se grava e se envia e-mail.
 *
 * POST { acao, ... }
 *   sincronizar                       PGC (Dados Abertos + PNCP), publicação (processos_licitatorios), DOU, D-30,
 *                                     prazo da CJU, alertas e e-mails. Agendada 07:50 e 13:50 de Manaus.
 *   dnr        { registros[] }        DNR lida dos PDFs, da planilha do SILOMS ou do robô do SILOMS.
 *   evento     { eventos[] }          E-mails da caixa da SLIC (Apps Script) e marcos do SILOMS (robô).
 *   editar     { id, campos, status?, justificativa? }   edição pela SLIC (status manual exige justificativa).
 *   criar      { campos }             contratação fora do PGC.
 *   irregularidade { id, descricao }  irregularidade documental registrada pela SLIC.
 *   resolver   { irregularidade_id, decisao: vincular|descartar|resolvida, contratacao_id?, observacao? }
 *   ciente     { evento_id }          ciência da impugnação/esclarecimento (o alerta some).
 *   enviar     { ids? , pendentes? }  envia e-mails da fila agora.
 *
 * Quem chama: o agendamento (x-sync-key = SYNC_PROCESSOS_KEY; só sincronizar), o Apps Script da caixa
 * licita.guarnaemn@gmail.com e o robô do SILOMS (x-pca-key = PCA_WEBHOOK_KEY; só dnr e evento) e usuários
 * SLIC, ADMIN e DEV logados (tudo).
 *
 * Deploy: supabase functions deploy pca-automacao --no-verify-jwt --use-api
 * Secrets: PCA_WEBHOOK_KEY (32+ caracteres); RESEND_API_KEY e RESEND_FROM (os do e-mail ao fiscal).
 * E-mail só sai sozinho com pca_config.envio_automatico = true; desligado, fica na fila para a SLIC enviar.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { CONFIG_PADRAO, S } from "../../../src/lib/pca/tipos.ts";
import {
  IRREGULARIDADES_QUE_TRAVAM, acharDou, acharPublicado, aplicar, avisosDoDia, contratacaoNova, cruzarPublicacao, processarEvento,
  registrarDnr, sincronizarPgc, validarEdicao, vincularDnr,
} from "../../../src/lib/pca/motor.ts";
import { agruparPgc } from "../../../src/lib/pca/pgc.ts";
import { normalizarIdContratacao, normalizarPag } from "../../../src/lib/pca/regras.ts";
import { referenciasDoEmail, tipoDoEmail } from "../../../src/lib/pca/documentos.ts";

const URL_SB = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICO = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const CHAVE_SYNC = Deno.env.get("SYNC_PROCESSOS_KEY") ?? "";
const CHAVE_PCA = Deno.env.get("PCA_WEBHOOK_KEY") ?? "";
const RESEND_KEY = Deno.env.get("RESEND_API_KEY") ?? "";
const RESEND_FROM = Deno.env.get("RESEND_FROM") ?? "GAPMN <noreply@gapmn.app>";
const CNPJ = "00394429000100";
const UASG = "120630";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-sync-key, x-pca-key",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (corpo: unknown, status = 200) => new Response(JSON.stringify(corpo), { status, headers: { ...CORS, "content-type": "application/json; charset=utf-8" } });
const esperar = (ms: number) => new Promise((r) => setTimeout(r, ms));
const hojeManaus = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Manaus", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
const erroDb = (r: { error: unknown }, onde: string) => { if (r.error) throw new Error(`${onde}: ${r.error.message ?? r.error}`); };

// ── Quem está chamando ───────────────────────────────────────────────────────
async function quem(req: Request, db) {
  if (CHAVE_SYNC && req.headers.get("x-sync-key") === CHAVE_SYNC) return { papel: "cron", usuario_id: null, usuario_nome: "rotina" };
  if (CHAVE_PCA.length >= 32 && req.headers.get("x-pca-key") === CHAVE_PCA) return { papel: "webhook", usuario_id: null, usuario_nome: "integração" };
  const jwt = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!jwt) return null;
  const { data } = await db.auth.getUser(jwt);
  if (!data?.user) return null;
  const { data: p } = await db.from("profiles").select("nome_guerra, setor").eq("id", data.user.id).maybeSingle();
  if (!["SLIC", "ADMIN", "DEV"].includes(String(p?.setor ?? "").toUpperCase())) return { papel: "leitor", usuario_id: data.user.id, usuario_nome: p?.nome_guerra ?? data.user.email };
  return { papel: "slic", usuario_id: data.user.id, usuario_nome: p?.nome_guerra ?? data.user.email };
}

// ── Leitura do estado ────────────────────────────────────────────────────────
const NUMEROS = ["valor_estimado", "mjr_id"];
function linha(c) {
  const x = { ...c };
  for (const k of NUMEROS) if (x[k] != null) x[k] = Number(x[k]);
  x.numeros_dfd = x.numeros_dfd ?? []; x.itens_pca = (x.itens_pca ?? []).map(Number); x.alertas_ativos = x.alertas_ativos ?? [];
  return x;
}
async function carregar(db) {
  const [cfgR, elosR, eqR, mjrR] = await Promise.all([
    db.from("pca_config").select("*").eq("id", 1).maybeSingle(), db.from("pca_elos").select("*"), db.from("pca_equipe").select("*"), db.from("pca_mjr").select("*"),
  ]);
  erroDb(cfgR, "configuração");
  const c = cfgR.data ?? {};
  const cfg = { ...CONFIG_PADRAO, ...Object.fromEntries(Object.entries(c).filter(([, v]) => v != null)) };
  cfg.limite_dispensa_demais = Number(cfg.limite_dispensa_demais); cfg.limite_dispensa_engenharia = Number(cfg.limite_dispensa_engenharia);
  const [listaR, irrR, evR] = await Promise.all([
    db.from("pca_contratacoes").select("*").eq("ano", cfg.ano).limit(5000),
    db.from("pca_irregularidades").select("contratacao_id, tipo").is("resolvido_em", null).not("contratacao_id", "is", null),
    db.from("pca_eventos").select("contratacao_id, tipo, assunto").in("tipo", ["impugnacao", "esclarecimento"]).is("ciente_em", null).not("contratacao_id", "is", null),
  ]);
  erroDb(listaR, "contratações");
  const irregularidades = new Map();
  for (const i of irrR.data ?? []) if (IRREGULARIDADES_QUE_TRAVAM.includes(i.tipo)) irregularidades.set(i.contratacao_id, (irregularidades.get(i.contratacao_id) ?? 0) + 1);
  const eventos = new Map();
  for (const e of evR.data ?? []) eventos.set(e.contratacao_id, [...(eventos.get(e.contratacao_id) ?? []), { tipo: e.tipo, assunto: e.assunto ?? "" }]);
  const estado = {
    hoje: hojeManaus(), agora: new Date().toISOString(), cfg,
    elos: (elosR.data ?? []).map((e) => ({ ...e, areas_pgc: e.areas_pgc ?? [] })), equipe: eqR.data ?? [],
    regras: (mjrR.data ?? []).map((r) => ({ ...r, valor_maximo: r.valor_maximo == null ? null : Number(r.valor_maximo), categorias: r.categorias ?? [], modalidades: r.modalidades ?? [], palavras: r.palavras ?? [] })),
    irregularidades, eventos,
  };
  return { estado, lista: (listaR.data ?? []).map(linha) };
}

// ── Gravação: acumula por contratação e grava uma vez ────────────────────────
function acumulador(lista) {
  const atual = new Map(lista.map((c) => [c.id, c]));
  const porId = new Map();
  const novas = [];
  const historico = [];
  const emails = [];
  return {
    atual, novas, historico, emails,
    lista: () => [...atual.values()],
    somar(r) {
      if (!r) return;
      atual.set(r.id, r.novo);
      historico.push(...r.historico); emails.push(...r.emails);
      if (novas.some((n) => n.id === r.id)) { const i = novas.findIndex((n) => n.id === r.id); novas[i] = r.novo; return; }
      porId.set(r.id, { ...(porId.get(r.id) ?? {}), ...r.patch });
    },
    nova(c, hist) { novas.push(c); atual.set(c.id, c); historico.push(...hist); },
    async gravar(db) {
      if (novas.length) erroDb(await db.from("pca_contratacoes").insert(novas), "inserir contratações");
      for (const [id, patch] of porId) if (Object.keys(patch).length) erroDb(await db.from("pca_contratacoes").update(patch).eq("id", id), "atualizar contratação");
      for (let i = 0; i < historico.length; i += 500) erroDb(await db.from("pca_historico").insert(historico.slice(i, i + 500)), "histórico");
      const fila = emails.filter((m) => m.para?.length).map((m) => ({ contratacao_id: m.contratacao_id, tipo: m.tipo, para: m.para, assunto: m.assunto, html: m.html, texto: m.texto, chave: m.chave }));
      if (fila.length) erroDb(await db.from("pca_emails").upsert(fila, { onConflict: "chave", ignoreDuplicates: true }), "fila de e-mails");
      return { novas: novas.length, atualizadas: [...porId.values()].filter((p) => Object.keys(p).length).length, historico: historico.length, emails: fila.length };
    },
  };
}

// ── Fontes externas ──────────────────────────────────────────────────────────
async function getJson(url: string, tentativas = 3) {
  for (let t = 1; t <= tentativas; t++) {
    const r = await fetch(url, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(40000) });
    if (r.status === 204) return null;
    if (r.status === 429 && t < tentativas) { await esperar(3000 * t); continue; }
    if (!r.ok) throw new Error(`${new URL(url).host} respondeu ${r.status}`);
    return await r.json();
  }
}
async function lerPgc(ano: number) {
  const itens = [];
  for (let p = 1; p <= 10; p++) {
    const j = await getJson(`https://dadosabertos.compras.gov.br/modulo-pgc/1_consultarPgcDetalhe?pagina=${p}&tamanhoPagina=500&orgao=${CNPJ}&anoPcaProjetoCompra=${ano}&codigoUasg=${UASG}`);
    itens.push(...(j?.resultado ?? []));
    if (!j || !j.paginasRestantes) break;
    await esperar(800);
  }
  // PCA publicado no PNCP: o sequencial do GAP-MN no ano (lista consolidada das unidades) e os itens com o código da contratação
  let pncp = [];
  try {
    const unidades = await getJson(`https://pncp.gov.br/api/pncp/v1/orgaos/${CNPJ}/pca/${ano}/consolidado/unidades?pagina=1&tamanhoPagina=200`);
    const seq = (Array.isArray(unidades) ? unidades : []).find((u) => String(u.codigoUnidade) === UASG)?.sequencialPca;
    if (seq) for (let p = 1; p <= 10; p++) {
      const j = await getJson(`https://pncp.gov.br/api/pncp/v1/orgaos/${CNPJ}/pca/${ano}/${seq}/itens?pagina=${p}&tamanhoPagina=500`);
      if (!Array.isArray(j) || !j.length) break;
      pncp.push(...j);
      if (j.length < 500) break;
    }
  } catch (e) { pncp = []; console.log("PNCP (PCA) indisponível:", e.message); }
  return { itens, pncp };
}

// ── E-mail (Resend) ──────────────────────────────────────────────────────────
async function enviarFila(db, cfg, filtro: { ids?: string[]; automatico?: boolean }, por: string, estado, lista) {
  if (!RESEND_KEY) return { enviados: 0, erros: 0, aviso: "RESEND_API_KEY não configurada" };
  let q = db.from("pca_emails").select("*");
  if (filtro.ids?.length) q = q.in("id", filtro.ids).in("situacao", ["pendente", "erro"]);
  else if (filtro.automatico) {
    if (!cfg.envio_automatico) return { enviados: 0, erros: 0, aviso: "envio automático desligado" };
    // só os da fila recente: ligar o envio automático não dispara avisos velhos
    q = q.eq("situacao", "pendente").gte("criado_em", new Date(Date.now() - 3 * 86400000).toISOString());
  } else q = q.eq("situacao", "pendente"); // "Enviar todos" da SLIC
  const { data: fila } = await q.order("criado_em").limit(40);
  let enviados = 0, erros = 0;
  const acc = acumulador(lista ?? []);
  for (const m of fila ?? []) {
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST", headers: { Authorization: `Bearer ${RESEND_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: RESEND_FROM, to: m.para, subject: m.assunto, html: m.html, text: m.texto ?? undefined, ...(cfg.email_slic ? { reply_to: cfg.email_slic } : {}) }),
    });
    const ok = r.ok;
    const erro = ok ? null : `Resend ${r.status}: ${(await r.text()).slice(0, 200)}`;
    await db.from("pca_emails").update({ situacao: ok ? "enviado" : "erro", enviado_em: ok ? new Date().toISOString() : null, erro, enviado_por: por }).eq("id", m.id);
    if (ok) enviados++; else erros++;
    // homologado e encaminhado à Atas/SCON: o processo passa a "Encaminhado para Ata/Contrato"
    if (ok && m.contratacao_id && (m.tipo === "homologacao_srp" || m.tipo === "homologacao_contrato") && estado) {
      const c = acc.atual.get(m.contratacao_id);
      if (c && !c.encaminhado_em) acc.somar(aplicar(c, { encaminhado_em: estado.hoje }, { origem: "sistema", usuario_nome: por }, estado));
    }
    await esperar(600); // o Resend aceita poucos envios por segundo
  }
  if (estado) await acc.gravar(db);
  return { enviados, erros };
}

// ── Ações ────────────────────────────────────────────────────────────────────
async function sincronizar(db, origem: string, usuario) {
  const log = await db.from("processos_sync_log").insert({ fonte: "pca", origem, usuario: usuario?.usuario_id ?? null }).select("id").single();
  const avisos = [];
  const resumo = {};
  try {
    const { estado, lista } = await carregar(db);
    const acc = acumulador(lista);
    // A: PGC
    try {
      const { itens, pncp } = await lerPgc(estado.cfg.ano);
      if (!itens.length) avisos.push(`PGC ${estado.cfg.ano} sem itens nos Dados Abertos (atraso da base ou PCA ainda não publicado)`);
      else {
        const pgc = agruparPgc(itens, pncp);
        const plano = sincronizarPgc(acc.lista(), pgc, estado.cfg.ano, estado, () => crypto.randomUUID());
        for (const c of plano.novas) acc.nova(c, plano.historicoNovas.filter((h) => h.contratacao_id === c.id));
        for (const r of plano.resultados) acc.somar(r);
        resumo.pgc = { itens: itens.length, itens_pncp: pncp.length, contratacoes: pgc.length, novas: plano.novas.length, alteradas: plano.resultados.length };
      }
    } catch (e) { avisos.push(`PGC: ${e.message}`); }
    // F/H: publicação e resultado (processos_licitatorios, alimentada pela sync-processos)
    const { data: procs } = await db.from("processos_licitatorios").select("id_compra, modalidade, numero_processo, processo_nup, situacao, srp, valor_estimado, data_publicacao, link_pncp, objeto")
      .gte("ano", estado.cfg.ano - 1).not("id_compra", "is", null).limit(3000);
    const homologados = (procs ?? []).filter((p) => /^homologado/i.test(p.situacao ?? "")).map((p) => p.id_compra);
    const datas = new Map();
    for (let i = 0; i < homologados.length; i += 100) {
      const { data } = await db.from("processos_itens").select("id_compra, data_resultado").in("id_compra", homologados.slice(i, i + 100)).not("data_resultado", "is", null);
      for (const d of data ?? []) if (!datas.has(d.id_compra) || d.data_resultado > datas.get(d.id_compra)) datas.set(d.id_compra, d.data_resultado);
    }
    const publicos = (procs ?? []).map((p) => ({ ...p, valor_estimado: p.valor_estimado == null ? null : Number(p.valor_estimado), data_resultado: datas.get(p.id_compra) ?? null }));
    let nPub = 0;
    for (const c of acc.lista()) {
      if (c.status_atual === S.ENCAMINHADO) continue;
      const p = acharPublicado(c, publicos);
      if (!p) continue;
      const usados = new Set(acc.lista().filter((x) => x.id !== c.id && x.numero_pag).map((x) => x.numero_pag));
      const r = cruzarPublicacao(c, p, usados, estado);
      if (r) { acc.somar(r); nPub++; }
    }
    resumo.publicacao = nPub;
    // F: DOU (alertas do DOU já buscados pela sync-dou)
    const { data: dou } = await db.from("dou_publicacoes").select("id, titulo, resumo, data, url, tipo").gte("data", new Date(Date.now() - 200 * 86400000).toISOString().slice(0, 10)).limit(3000);
    let nDou = 0;
    for (const c of acc.lista()) {
      if (!c.pncp_publicado_em || c.status_publicacao_dou) continue;
      const p = acharDou(c, dou ?? [], UASG);
      if (p) { acc.somar(aplicar(c, { status_publicacao_dou: true, dou_data: p.data, dou_link: p.url }, { origem: "dou" }, estado)); nDou++; }
    }
    resumo.dou = nDou;
    // B e E: D-30 e prazo da CJU; e alertas do dia para todos
    let nD30 = 0, nSla = 0;
    for (const c of acc.lista()) {
      const av = avisosDoDia(c, estado);
      acc.emails.push(...av.emails);
      nSla += av.emails.filter((m) => m.tipo === "sla_cju").length;
      if (av.marcarD30) { nD30++; acc.somar(aplicar(c, { email_d30_em: estado.agora }, { origem: "sistema" }, estado)); }
      else acc.somar(aplicar(acc.atual.get(c.id), {}, { origem: "sistema" }, estado));
    }
    resumo.d30 = nD30; resumo.sla_cju = nSla;
    resumo.gravado = await acc.gravar(db);
    resumo.envio = await enviarFila(db, estado.cfg, { automatico: true }, "rotina", estado, acc.lista());
    await db.from("processos_sync_log").update({ fim: new Date().toISOString(), ok: true, resumo: { ...resumo, avisos } }).eq("id", log.data?.id);
    return { ok: true, resumo, avisos };
  } catch (e) {
    await db.from("processos_sync_log").update({ fim: new Date().toISOString(), ok: false, erro: String(e.message ?? e), resumo: { ...resumo, avisos } }).eq("id", log.data?.id);
    throw e;
  }
}

async function receberDnr(db, registros, ator) {
  const { estado, lista } = await carregar(db);
  const acc = acumulador(lista);
  const saida = [];
  for (const d0 of (registros ?? []).slice(0, 200)) {
    const d = {
      numero_dnr: d0.numero_dnr ? String(d0.numero_dnr).trim() : null, data_chegada: /^\d{4}-\d{2}-\d{2}$/.test(d0.data_chegada ?? "") ? d0.data_chegada : null,
      pag_oficio: normalizarPag(d0.pag_oficio), pag_tr: normalizarPag(d0.pag_tr), numero_contratacao: d0.numero_contratacao ? String(d0.numero_contratacao) : null,
      itens_pca: Array.isArray(d0.itens_pca) ? d0.itens_pca.map(Number).filter(Number.isFinite) : [], objeto: d0.objeto ?? null, assinante_tr: d0.assinante_tr ?? null,
      om_apoiada: d0.om_apoiada ?? null, fonte: ["upload", "planilha", "siloms", "manual"].includes(d0.fonte) ? d0.fonte : "manual",
    };
    if (!d.pag_oficio && !d.pag_tr && !d.numero_dnr) { saida.push({ situacao: "ignorada", motivo: "sem PAG e sem nº da DNR" }); continue; }
    const ins = await db.from("pca_dnr").insert({ ...d, criado_por: ator.usuario_nome, arquivos: Array.isArray(d0.arquivos) ? d0.arquivos.slice(0, 10) : [] }).select("id").single();
    erroDb(ins, "registrar DNR");
    const r = registrarDnr(d, acc.lista(), ator, estado);
    if (r.resultado) acc.somar(r.resultado);
    if (r.irregularidades.length) erroDb(await db.from("pca_irregularidades").insert(r.irregularidades.map((i) => ({ ...i, dnr_id: ins.data.id, contratacao_id: i.contratacao_id ?? r.candidata_id ?? null }))), "irregularidades");
    await db.from("pca_dnr").update({ situacao: r.situacao, contratacao_id: r.contratacao_id }).eq("id", ins.data.id);
    const c = r.contratacao_id ? acc.atual.get(r.contratacao_id) : null;
    saida.push({ dnr_id: ins.data.id, situacao: r.situacao, contratacao: c ? { id: c.id, id_contratacao_pgc: c.id_contratacao_pgc, objeto: c.objeto_resumido, status: c.status_atual } : null,
      irregularidades: r.irregularidades.map((i) => ({ tipo: i.tipo, descricao: i.descricao })) });
  }
  await acc.gravar(db);
  return { ok: true, registros: saida };
}

async function receberEventos(db, eventos, ator) {
  const { estado, lista } = await carregar(db);
  const acc = acumulador(lista);
  const lidos = (eventos ?? []).slice(0, 100).map((e) => {
    const texto = `${e.assunto ?? ""}\n${e.texto ?? ""}`;
    const tipo = e.tipo ?? (e.caixa ? tipoDoEmail(e.assunto ?? "", e.caixa) : null);
    const ref = referenciasDoEmail(texto);
    return { origem: e.origem === "siloms" ? "siloms" : "gmail", tipo, chave: String(e.chave ?? e.id ?? `${tipo}:${e.assunto}:${e.data}`).slice(0, 300), pag: normalizarPag(e.pag) ?? ref.pag,
      certame: e.certame ?? ref.certame, assunto: (e.assunto ?? "").slice(0, 500), remetente: (e.remetente ?? "").slice(0, 200), data: e.data ?? estado.agora, dados: e.dados ?? null };
  }).filter((e) => ["cju_envio", "cju_retorno", "impugnacao", "esclarecimento", "subprocesso", "fase_externa", "homologacao", "liberacao"].includes(e.tipo));
  if (!lidos.length) return { ok: true, novos: 0 };
  const { data: ja } = await db.from("pca_eventos").select("chave").in("chave", lidos.map((e) => e.chave));
  const vistos = new Set((ja ?? []).map((x) => x.chave));
  let novos = 0;
  const irregs = [];
  for (const ev of lidos) {
    if (vistos.has(ev.chave)) continue;
    vistos.add(ev.chave);
    const ins = await db.from("pca_eventos").insert({ origem: ev.origem, tipo: ev.tipo, chave: ev.chave, pag: ev.pag, assunto: ev.assunto, remetente: ev.remetente, data: ev.data, dados: ev.dados }).select("id").single();
    if (ins.error) continue; // chave repetida em chamadas simultâneas
    novos++;
    const r = processarEvento({ id: ins.data.id, tipo: ev.tipo, pag: ev.pag, certame: ev.certame, assunto: ev.assunto, data: String(ev.data), dados: ev.dados }, acc.lista(), estado);
    if (r.contratacao) await db.from("pca_eventos").update({ contratacao_id: r.contratacao.id }).eq("id", ins.data.id);
    if (r.resultado) acc.somar(r.resultado);
    acc.emails.push(...r.emails);
    if (r.irregularidade) irregs.push(r.irregularidade);
  }
  if (irregs.length) await db.from("pca_irregularidades").insert(irregs);
  await acc.gravar(db);
  const envio = await enviarFila(db, estado.cfg, { automatico: true }, ator.usuario_nome, estado, acc.lista());
  return { ok: true, novos, envio };
}

async function editar(db, corpo, ator) {
  const { estado, lista } = await carregar(db);
  const c = lista.find((x) => x.id === corpo.id);
  if (!c) return json({ ok: false, error: "Contratação não encontrada." }, 404);
  const v = validarEdicao(c, corpo.campos ?? {}, lista, corpo.status ?? null, corpo.justificativa ?? null);
  if (v.erro) return json({ ok: false, error: v.erro }, 400);
  const acc = acumulador(lista);
  acc.somar(aplicar(c, v.mudancas, { ...ator, justificativa: corpo.justificativa ?? null }, estado, v.status));
  const g = await acc.gravar(db);
  const envio = await enviarFila(db, estado.cfg, { automatico: true }, ator.usuario_nome, estado, acc.lista());
  return json({ ok: true, contratacao: acc.atual.get(c.id), gravado: g, envio });
}

async function criar(db, corpo, ator) {
  const { estado, lista } = await carregar(db);
  const objeto = String(corpo.campos?.objeto ?? "").trim();
  if (objeto.length < 5) return json({ ok: false, error: "Informe o objeto." }, 400);
  const base = contratacaoNova(crypto.randomUUID(), estado.cfg.ano, { objeto, objeto_resumido: objeto.slice(0, 80) }, estado.agora);
  const v = validarEdicao(base, corpo.campos ?? {}, lista);
  if (v.erro) return json({ ok: false, error: v.erro }, 400);
  const r = aplicar(base, v.mudancas, ator, estado);
  const acc = acumulador(lista);
  acc.nova(r.novo, [{ contratacao_id: base.id, origem: "manual", campo: "criacao", de: null, para: `Criada pela SLIC: ${objeto.slice(0, 120)}`, usuario_id: ator.usuario_id, usuario_nome: ator.usuario_nome }]);
  await acc.gravar(db);
  return json({ ok: true, contratacao: r.novo });
}

async function registrarIrregularidade(db, corpo, ator) {
  const descricao = String(corpo.descricao ?? "").trim();
  if (descricao.length < 10) return json({ ok: false, error: "Descreva a irregularidade (mínimo de 10 caracteres)." }, 400);
  erroDb(await db.from("pca_irregularidades").insert({ contratacao_id: corpo.id, tipo: "documental", descricao, detalhe: { registrada_por: ator.usuario_nome } }), "irregularidade");
  const { estado, lista } = await carregar(db);
  const c = lista.find((x) => x.id === corpo.id);
  const acc = acumulador(lista);
  if (c) acc.somar(aplicar(c, {}, { ...ator, origem: "manual" }, estado));
  await acc.gravar(db);
  await enviarFila(db, estado.cfg, { automatico: true }, ator.usuario_nome, estado, acc.lista());
  return json({ ok: true });
}

async function resolver(db, corpo, ator) {
  const { data: irr } = await db.from("pca_irregularidades").select("*").eq("id", corpo.irregularidade_id).maybeSingle();
  if (!irr) return json({ ok: false, error: "Irregularidade não encontrada." }, 404);
  if (irr.resolvido_em) return json({ ok: false, error: "Essa irregularidade já foi resolvida." }, 400);
  const decisao = String(corpo.decisao ?? "");
  const obs = String(corpo.observacao ?? "").trim();
  let alvo = irr.contratacao_id;
  if (decisao === "vincular") {
    if (!irr.dnr_id || !corpo.contratacao_id) return json({ ok: false, error: "Escolha a contratação para vincular a DNR." }, 400);
    alvo = corpo.contratacao_id;
  }
  const marcar = async (q) => q.update({ resolvido_em: new Date().toISOString(), resolvido_por: ator.usuario_nome, decisao: `${decisao}${obs ? `: ${obs}` : ""}` });
  // vincular resolve todas as pendências abertas da mesma DNR
  if (decisao === "vincular") await marcar(db.from("pca_irregularidades").eq("dnr_id", irr.dnr_id).is("resolvido_em", null));
  else await marcar(db.from("pca_irregularidades").eq("id", irr.id));
  const { estado, lista } = await carregar(db);
  const acc = acumulador(lista);
  if (decisao === "vincular") {
    const { data: d } = await db.from("pca_dnr").select("*").eq("id", irr.dnr_id).single();
    const c = lista.find((x) => x.id === alvo);
    if (!c) return json({ ok: false, error: "Contratação não encontrada." }, 404);
    const pag = d.pag_oficio ?? d.pag_tr;
    if (pag && lista.some((x) => x.id !== c.id && x.numero_pag === pag)) return json({ ok: false, error: `O PAG ${pag} já está em outra contratação.` }, 400);
    const r = vincularDnr({ ...d, itens_pca: d.itens_pca ?? [] }, c, pag, [], { ...ator, origem: "manual" }, estado);
    acc.somar(r.resultado);
    acc.historico.push({ contratacao_id: c.id, origem: "manual", campo: "decisao_irregularidade", de: irr.descricao, para: `DNR vinculada pela SLIC${obs ? `: ${obs}` : ""}`, usuario_id: ator.usuario_id, usuario_nome: ator.usuario_nome });
    await db.from("pca_dnr").update({ situacao: "vinculada", contratacao_id: c.id }).eq("id", irr.dnr_id);
  } else if (alvo) {
    const c = lista.find((x) => x.id === alvo);
    if (c) {
      acc.somar(aplicar(c, {}, { ...ator, origem: "manual" }, estado));
      acc.historico.push({ contratacao_id: c.id, origem: "manual", campo: "decisao_irregularidade", de: irr.descricao, para: `${decisao === "descartar" ? "Descartada" : "Resolvida"}${obs ? `: ${obs}` : ""}`, usuario_id: ator.usuario_id, usuario_nome: ator.usuario_nome });
    }
    if (decisao === "descartar" && irr.dnr_id) await db.from("pca_dnr").update({ situacao: "descartada" }).eq("id", irr.dnr_id).eq("situacao", "irregular");
  }
  await acc.gravar(db);
  await enviarFila(db, estado.cfg, { automatico: true }, ator.usuario_nome, estado, acc.lista());
  return json({ ok: true });
}

async function ciente(db, corpo, ator) {
  const { data: ev } = await db.from("pca_eventos").update({ ciente_em: new Date().toISOString(), ciente_por: ator.usuario_nome }).eq("id", corpo.evento_id).select("contratacao_id, tipo, assunto").maybeSingle();
  if (ev?.contratacao_id) {
    const { estado, lista } = await carregar(db);
    const c = lista.find((x) => x.id === ev.contratacao_id);
    const acc = acumulador(lista);
    if (c) {
      acc.somar(aplicar(c, {}, { ...ator, origem: "manual" }, estado));
      acc.historico.push({ contratacao_id: c.id, origem: "manual", campo: "ciencia_evento", de: ev.tipo, para: ev.assunto, usuario_id: ator.usuario_id, usuario_nome: ator.usuario_nome });
    }
    await acc.gravar(db);
  }
  return json({ ok: true });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ ok: false, error: "use POST" }, 405);
  const db = createClient(URL_SB, SERVICO, { auth: { persistSession: false } });
  let corpo;
  try { corpo = await req.json(); } catch { return json({ ok: false, error: "corpo inválido" }, 400); }
  const q = await quem(req, db);
  if (!q) return json({ ok: false, error: "Faça login no gapmn.app." }, 401);
  const acao = String(corpo?.acao ?? "");
  const permitido = q.papel === "slic" || (q.papel === "cron" && acao === "sincronizar") || (q.papel === "webhook" && (acao === "evento" || acao === "dnr"));
  if (!permitido) return json({ ok: false, error: "Sem permissão: só a SLIC, ADMIN e DEV alteram o Acompanhamento do PCA." }, 403);
  const ator = { origem: q.papel === "webhook" ? (corpo?.origem === "siloms" ? "siloms" : "email") : "manual", usuario_id: q.usuario_id, usuario_nome: q.usuario_nome };
  try {
    switch (acao) {
      case "sincronizar": return json(await sincronizar(db, corpo.origem === "cron" || q.papel === "cron" ? "cron" : "manual", q));
      case "dnr": return json(await receberDnr(db, corpo.registros, { ...ator, origem: q.papel === "webhook" ? "siloms" : "manual" }));
      case "evento": return json(await receberEventos(db, corpo.eventos, ator));
      case "editar": return await editar(db, corpo, ator);
      case "criar": return await criar(db, corpo, ator);
      case "irregularidade": return await registrarIrregularidade(db, corpo, ator);
      case "resolver": return await resolver(db, corpo, ator);
      case "ciente": return await ciente(db, corpo, ator);
      case "enviar": {
        const { estado, lista } = await carregar(db);
        return json({ ok: true, ...(await enviarFila(db, estado.cfg, { ids: Array.isArray(corpo.ids) ? corpo.ids : undefined, automatico: false }, q.usuario_nome, estado, lista)) });
      }
      default: return json({ ok: false, error: `ação desconhecida: ${acao}` }, 400);
    }
  } catch (e) {
    console.error("pca-automacao:", e);
    return json({ ok: false, error: String(e?.message ?? e) }, 500);
  }
});
