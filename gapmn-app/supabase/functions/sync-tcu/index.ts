// @ts-nocheck
/**
 * Edge Function: sync-tcu (nov/2026)
 *
 * Uma vez por dia, pelos Dados Abertos do TCU (sem login, APIs públicas):
 *   • Licitantes inidôneos (lista inteira, uma chamada) cruzados com os fornecedores do GAP-MN:
 *     CNPJ de contrato vigente (contratos_scon) e de item de ata vigente (itens_ata_gap_mn).
 *   • Contas julgadas irregulares (CADIRREG), consultado por CNPJ, em rodízio: cada fornecedor é
 *     conferido de novo depois de 7 dias (a lista inteira passa de 4,5 MB e não termina a tempo).
 *   • Acórdãos novos sobre licitações e contratos (a API traz os mais novos primeiro; uma página de
 *     400 cobre umas duas semanas de sessões). A regra do que entra está em ../_shared/tcu.ts.
 *   • Informativo de Licitações e Contratos (CSV dos Dados Abertos): só baixa quando o arquivo muda
 *     (ETag) e grava os enunciados que ainda não estão no banco.
 * O app só AVISA: nada aqui bloqueia contrato, ata ou empenho.
 * Cada rodada fica em processos_sync_log (fonte 'tcu'); um resumo do dia vai para o feed do app.
 *
 * Limites do TCU: a API de acórdãos responde 429 se chamada mais de uma vez por minuto; os
 * serviços podem ficar fora do ar das 20h às 21h (Brasília).
 *
 * Quem pode chamar: o agendamento (cabeçalho x-sync-key = secret SYNC_PROCESSOS_KEY) ou um
 * usuário do app da SLIC/SCON/ADMIN/DEV (Authorization: Bearer <JWT do usuário>).
 *
 * Deploy: supabase functions deploy sync-tcu --no-verify-jwt
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { classificarAcordao, cruzar, dataISO, filaCadirreg, informativoDe, lerCsvTcu, soDigitos, textoFeed } from "../_shared/tcu.ts";

// ─── Configuração ────────────────────────────────────────────────────────────
const ACORDAOS      = "https://dados-abertos.apps.tcu.gov.br/api/acordao/recupera-acordaos";
const SANCOES       = "https://certidoes.apps.tcu.gov.br/api/publico";
const INFORMATIVO   = "https://sites.tcu.gov.br/dados-abertos/jurisprudencia/arquivos/boletim-informativo-lc/informativo-lc.csv";
const QTD_ACORDAOS  = 400;
const CADIRREG_DIAS = 7;
const CADIRREG_MAX  = 150;
const PARALELO      = 3;
const TEMPO_MAX_MS  = 130_000;
const UA            = "GAPMN-TCU/1.0 (gapmn.app)";

const CORS = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-sync-key",
};

// ─── Handler ─────────────────────────────────────────────────────────────────
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
    if (!user) return json({ ok: false, error: "Faça login no app para atualizar os dados do TCU." }, 401);
    const { data: perfil } = await admin.from("profiles").select("setor, role").eq("id", user.id).maybeSingle();
    const setor = String(perfil?.setor || "").toUpperCase();
    if (!["SLIC", "SCON", "ADMIN", "DEV"].includes(setor) && perfil?.role !== "admin") {
      return json({ ok: false, error: "Só a SLIC, a SCON, ADMIN ou DEV podem atualizar os dados do TCU." }, 403);
    }
    usuario = user.id;
  }

  // ── Uma rodada por vez ──
  const { data: emCurso } = await admin.from("processos_sync_log")
    .select("id").eq("fonte", "tcu").is("fim", null)
    .gte("inicio", new Date(Date.now() - 3 * 60_000).toISOString()).limit(1);
  if (emCurso?.length) {
    return json({ ok: false, emAndamento: true, error: "Já existe uma atualização do TCU em andamento — aguarde 2 minutos." }, 409);
  }
  const { data: log } = await admin.from("processos_sync_log")
    .insert({ fonte: "tcu", origem, usuario }).select("id").single();

  const ctx = novaRodada();
  try {
    const resumo = await sincronizar(admin, ctx);
    await admin.from("processos_sync_log").update({ fim: new Date().toISOString(), ok: true, resumo }).eq("id", log?.id);
    return json({ ok: true, ...resumo });
  } catch (err: any) {
    console.error(err);
    await admin.from("processos_sync_log").update({
      fim: new Date().toISOString(), ok: false, erro: String(err?.message || err).slice(0, 500),
      resumo: { avisos: ctx.avisos.slice(0, 20) },
    }).eq("id", log?.id);
    return json({ ok: false, error: String(err?.message || err) }, 500);
  }
});

function novaRodada() {
  const inicio = Date.now();
  return { inicio, restante: () => TEMPO_MAX_MS - (Date.now() - inicio), avisos: [] as string[] };
}

// ─── Rodada ──────────────────────────────────────────────────────────────────
async function sincronizar(admin, ctx) {
  const agora = new Date();
  const resumo = {
    fornecedores: 0,
    inidoneos_lista: null as number | null, inidoneos: 0,
    cadirreg_conferidos: 0, cadirreg_pendentes: 0, contas_irregulares: 0,
    alertas_novos: 0, alertas_novos_lista: [] as string[],
    acordaos_lidos: 0, acordaos_relevantes: 0, acordaos_novos: 0, acordao_mais_novo: null as string | null,
    informativo_mudou: false, informativos_novos: 0, informativo_mais_novo: null as string | null,
    feed: false, avisos: ctx.avisos,
  };

  // 1) Fornecedores do GAP-MN: contratos vigentes e itens de atas vigentes
  const nossos = await fornecedores(admin, agora);
  resumo.fornecedores = nossos.size;
  const cnpjs = new Set(nossos.keys());

  // 2) Licitantes inidôneos (lista inteira)
  try {
    const lista = await pedirJson(ctx, `${SANCOES}/responsaveis-inidoneos`, { metodo: "POST", corpo: {} });
    if (!Array.isArray(lista)) throw new Error("resposta sem lista");
    resumo.inidoneos_lista = lista.length;
    const achados = cruzar(lista, "INIDONEO", cnpjs);
    // na primeira conferência, quem já estava na lista não é novidade
    const primeira = !(await lerEstado(admin, "inidoneos_conferido_em"));
    const r = await gravarSancoes(admin, "INIDONEO", achados, nossos, { todos: true, primeira });
    await gravarEstado(admin, "inidoneos_conferido_em", new Date().toISOString());
    resumo.inidoneos = achados.length;
    resumo.alertas_novos += r.novos.length;
    resumo.alertas_novos_lista.push(...r.novos);
  } catch (e: any) {
    ctx.avisos.push(`Inidôneos: ${msg(e)} — fica para a próxima rodada`);
  }

  // 3) Acórdãos novos sobre licitações e contratos
  try {
    const lista = await pedirJson(ctx, `${ACORDAOS}?inicio=0&quantidade=${QTD_ACORDAOS}`, { tentativas: 2, esperar429: 62_000, timeoutMs: 60_000 });
    if (!Array.isArray(lista)) throw new Error("resposta sem lista");
    resumo.acordaos_lidos = lista.length;
    const linhas = [];
    for (const a of lista) {
      const c = classificarAcordao(a.sumario, a.titulo);
      if (!c.relevante || !a.key) continue;
      linhas.push({
        key: a.key, numero: Number(a.numeroAcordao) || null, ano: Number(a.anoAcordao) || null,
        colegiado: a.colegiado || null, data_sessao: dataISO(a.dataSessao), relator: a.relator || null,
        titulo: a.titulo || null, sumario: a.sumario || null, situacao: a.situacao || null,
        temas: c.temas, destaque: c.destaque,
        url_acordao: a.urlAcordao || null, url_pdf: a.urlArquivoPdf || a.urlArquivoPDF || null,
      });
    }
    resumo.acordaos_relevantes = linhas.length;
    resumo.acordao_mais_novo = lista[0]?.dataSessao ?? null;
    const ja = await chavesExistentes(admin, "tcu_acordaos", linhas.map((l) => l.key));
    const vazia = !(await temLinhas(admin, "tcu_acordaos"));
    for (const lote of lotes(linhas, 200)) {
      const { error } = await admin.from("tcu_acordaos").upsert(lote, { onConflict: "key" });
      if (error) throw new Error(`tcu_acordaos: ${error.message}`);
    }
    // na primeira carga não é novidade: só a partir da segunda rodada vai para o feed
    resumo.acordaos_novos = vazia ? 0 : linhas.filter((l) => !ja.has(l.key)).length;
  } catch (e: any) {
    ctx.avisos.push(`Acórdãos: ${msg(e)} — fica para a próxima rodada`);
  }

  // 4) Informativo de Licitações e Contratos (só quando o arquivo muda)
  try {
    const etag = await lerEstado(admin, "informativo_etag");
    const r = await pedirTexto(ctx, INFORMATIVO, etag);
    if (r) {
      resumo.informativo_mudou = true;
      const todos = lerCsvTcu(r.texto).map(informativoDe).filter(Boolean);
      const ja = new Set((await lerTodos(admin, "tcu_informativos", "key")).map((x) => x.key));
      const novos = todos.filter((i) => !ja.has(i.key));
      for (const lote of lotes(novos, 300)) {
        const { error } = await admin.from("tcu_informativos").upsert(lote, { onConflict: "key", ignoreDuplicates: true });
        if (error) throw new Error(`tcu_informativos: ${error.message}`);
      }
      resumo.informativos_novos = ja.size ? novos.length : 0;
      const ult = todos.reduce((m, i) => (!m || i.numero > m.numero ? i : m), null);
      resumo.informativo_mais_novo = ult?.titulo ?? null;
      await gravarEstado(admin, "informativo_etag", r.etag);
      await gravarEstado(admin, "informativo_atualizado", r.modificado);
    }
  } catch (e: any) {
    ctx.avisos.push(`Informativo de Licitações e Contratos: ${msg(e)} — fica para a próxima rodada`);
  }

  // 5) CADIRREG por CNPJ, em rodízio, com o tempo que sobrou
  try {
    const conferidos = new Map((await lerTodos(admin, "tcu_cnpj_conferido", "cnpj,cadirreg_em")).map((x) => [x.cnpj, x.cadirreg_em]));
    const fila = filaCadirreg([...cnpjs], conferidos, agora, CADIRREG_DIAS, CADIRREG_MAX);
    let i = 0;
    const trabalhador = async () => {
      while (i < fila.length && ctx.restante() > 12_000) {
        const cnpj = fila[i++];
        try {
          const lista = await pedirJson(ctx, `${SANCOES}/responsaveis-contas-irregulares`, { metodo: "POST", corpo: { cnpj }, tentativas: 2, timeoutMs: 20_000 });
          if (!Array.isArray(lista)) throw new Error("resposta sem lista");
          const achados = cruzar(lista, "CONTAS_IRREGULARES", new Set([cnpj]));
          // primeira conferência do CNPJ: o que achar não é "novo" (já existia antes do app olhar)
          const r = await gravarSancoes(admin, "CONTAS_IRREGULARES", achados, nossos, { cnpj, primeira: !conferidos.has(cnpj) });
          resumo.contas_irregulares += achados.length;
          resumo.alertas_novos += r.novos.length;
          resumo.alertas_novos_lista.push(...r.novos);
          await admin.from("tcu_cnpj_conferido").upsert({ cnpj, cadirreg_em: new Date().toISOString() }, { onConflict: "cnpj" });
          resumo.cadirreg_conferidos++;
        } catch (e: any) {
          if (ctx.avisos.length < 15) ctx.avisos.push(`CADIRREG ${cnpj}: ${msg(e)}`);
        }
      }
    };
    await Promise.all(Array.from({ length: PARALELO }, trabalhador));
    // os que ainda passaram dos 7 dias sem conferência ficam para as próximas rodadas
    const precisavam = filaCadirreg([...cnpjs], conferidos, agora, CADIRREG_DIAS, Number.MAX_SAFE_INTEGER).length;
    resumo.cadirreg_pendentes = Math.max(0, precisavam - resumo.cadirreg_conferidos);
  } catch (e: any) {
    ctx.avisos.push(`CADIRREG: ${msg(e)}`);
  }

  // 6) Resumo do dia no feed do app (sem nome de empresa)
  const titulo = textoFeed(resumo);
  if (titulo) {
    const { error } = await admin.from("feed_items").insert({
      titulo, tipo: "tcu", link_tab: "tcu",
      descricao: "Dados Abertos do TCU: jurisprudência de licitações e contratos e fornecedores do GAP-MN nas listas do Tribunal.",
    });
    resumo.feed = !error;
    if (error) ctx.avisos.push(`feed: ${error.message}`);
  }

  resumo.alertas_novos_lista = resumo.alertas_novos_lista.slice(0, 30);
  return resumo;
}

// ─── Fornecedores do GAP-MN ──────────────────────────────────────────────────
async function fornecedores(admin, agora: Date) {
  const hoje = new Date(agora.getTime() - 4 * 3600e3).toISOString().slice(0, 10); // Manaus
  const vigente = (fim) => !fim || String(fim).slice(0, 10) >= hoje;
  const mapa = new Map<string, { nome: string; contratos: string[]; atas: string[] }>();
  const add = (cnpj, nome, tipo, numero) => {
    const c = soDigitos(cnpj);
    if (c.length !== 14) return;
    const f = mapa.get(c) ?? { nome: nome || "", contratos: [], atas: [] };
    if (!f.nome && nome) f.nome = nome;
    if (numero && !f[tipo].includes(numero)) f[tipo].push(numero);
    mapa.set(c, f);
  };
  for (const c of await lerTodos(admin, "contratos_scon", "numero_contrato,cnpj,fornecedor,data_final")) {
    if (vigente(c.data_final)) add(c.cnpj, c.fornecedor, "contratos", c.numero_contrato);
  }
  const atas = await lerTodos(admin, "atas_gap_mn", "numero_ata,vigencia_final,situacao");
  const atasVigentes = new Set(atas.filter((a) => vigente(a.vigencia_final) && !/cancelad/i.test(a.situacao || "")).map((a) => a.numero_ata));
  for (const i of await lerTodos(admin, "itens_ata_gap_mn", "ata_numero,cnpj_fornecedor,fornecedor_nome")) {
    if (atasVigentes.has(i.ata_numero)) add(i.cnpj_fornecedor, i.fornecedor_nome, "atas", i.ata_numero);
  }
  return mapa;
}

/** Grava os achados de uma lista. `todos`: a lista veio inteira, então o que não veio saiu dela;
 *  `cnpj`: só aquele CNPJ foi consultado. Devolve os registros que apareceram agora. */
async function gravarSancoes(admin, lista, achados, nossos, op: { todos?: boolean; cnpj?: string; primeira?: boolean }) {
  let q = admin.from("tcu_sancoes").select("id,cnpj,processo,ativo").eq("lista", lista);
  if (op.cnpj) q = q.eq("cnpj", op.cnpj);
  const { data: antes, error: e1 } = await q;
  if (e1) throw new Error(`tcu_sancoes: ${e1.message}`);
  const chave = (s) => `${s.cnpj}|${s.processo}`;
  const antesMap = new Map((antes || []).map((s) => [chave(s), s]));
  const primeira = !!op.primeira;
  const agora = new Date().toISOString();
  const novos: string[] = [];
  const linhas = achados.map((s) => {
    const f = nossos.get(s.cnpj);
    const ja = antesMap.get(chave(s));
    if ((!ja || !ja.ativo) && !primeira) novos.push(`${lista === "INIDONEO" ? "Inidôneo" : "Contas irregulares"}: ${s.cnpj}`);
    return { ...s, vinculos: { contratos: f?.contratos ?? [], atas: f?.atas ?? [] }, ativo: true, ultima_vez: agora, saiu_em: null };
  });
  if (linhas.length) {
    const { error } = await admin.from("tcu_sancoes").upsert(linhas, { onConflict: "cnpj,lista,processo" });
    if (error) throw new Error(`tcu_sancoes: ${error.message}`);
  }
  // o que estava ativo e não veio desta vez saiu da lista (sanção vencida, recurso provido…)
  const agoraChaves = new Set(achados.map(chave));
  const sairam = (antes || []).filter((s) => s.ativo && !agoraChaves.has(chave(s))).map((s) => s.id);
  if (sairam.length) await admin.from("tcu_sancoes").update({ ativo: false, saiu_em: agora }).in("id", sairam);
  return { novos };
}

// ─── Banco ───────────────────────────────────────────────────────────────────
async function lerTodos(admin, tabela, colunas) {
  const out = [];
  for (let de = 0; ; de += 1000) {
    const { data, error } = await admin.from(tabela).select(colunas).range(de, de + 999);
    if (error) throw new Error(`${tabela}: ${error.message}`);
    out.push(...(data || []));
    if (!data || data.length < 1000) break;
  }
  return out;
}

async function chavesExistentes(admin, tabela, chaves: string[]) {
  const ja = new Set<string>();
  for (const lote of lotes(chaves, 200)) {
    const { data, error } = await admin.from(tabela).select("key").in("key", lote);
    if (error) throw new Error(`${tabela}: ${error.message}`);
    for (const r of data || []) ja.add(r.key);
  }
  return ja;
}

async function temLinhas(admin, tabela) {
  const { count } = await admin.from(tabela).select("key", { count: "exact", head: true });
  return (count ?? 0) > 0;
}

async function lerEstado(admin, chave) {
  const { data } = await admin.from("tcu_estado").select("valor").eq("chave", chave).maybeSingle();
  return data?.valor ?? null;
}
async function gravarEstado(admin, chave, valor) {
  await admin.from("tcu_estado").upsert({ chave, valor, atualizado_em: new Date().toISOString() }, { onConflict: "chave" });
}

function lotes<T>(lista: T[], n: number): T[][] {
  const out = [];
  for (let i = 0; i < lista.length; i += n) out.push(lista.slice(i, i + n));
  return out;
}

// ─── HTTP ────────────────────────────────────────────────────────────────────
async function pedirJson(ctx, url, { metodo = "GET", corpo = undefined, tentativas = 3, timeoutMs = 45_000, esperar429 = 0 } = {}) {
  let ultimo = "";
  for (let t = 1; t <= tentativas; t++) {
    const ctl = new AbortController();
    const tm = setTimeout(() => ctl.abort(), Math.min(timeoutMs, Math.max(5_000, ctx.restante())));
    try {
      const r = await fetch(url, {
        method: metodo, signal: ctl.signal,
        headers: { accept: "application/json", "user-agent": UA, ...(corpo !== undefined ? { "content-type": "application/json" } : {}) },
        body: corpo !== undefined ? JSON.stringify(corpo) : undefined,
      });
      if (r.status === 429) {
        // a API de acórdãos aceita uma chamada por minuto
        if (!esperar429 || ctx.restante() < esperar429 + 20_000) throw new Error("429: limite de consultas do TCU");
        await dormir(esperar429);
        continue;
      }
      if (r.status >= 500) { ultimo = "HTTP " + r.status; await dormir(1000 * t); continue; }
      const txt = await r.text();
      if (!r.ok) throw new Error(`HTTP ${r.status}${/firewall/i.test(txt) ? " (bloqueado pelo firewall do TCU)" : ""}`);
      return txt.trim() ? JSON.parse(txt) : null;
    } catch (e: any) {
      ultimo = e?.name === "AbortError" ? "sem resposta (tempo esgotado)" : String(e?.message || e);
      if (t === tentativas || /^429|HTTP 4/.test(ultimo) || ctx.restante() < 8_000) throw new Error(ultimo);
      await dormir(800 * t);
    } finally { clearTimeout(tm); }
  }
  throw new Error(ultimo || "sem resposta");
}

/** Baixa o CSV só se mudou (If-None-Match). null = igual ao da última vez. */
async function pedirTexto(ctx, url, etag: string | null) {
  const ctl = new AbortController();
  const tm = setTimeout(() => ctl.abort(), Math.max(5_000, Math.min(90_000, ctx.restante() - 30_000)));
  try {
    const r = await fetch(url, { headers: { "user-agent": UA, ...(etag ? { "if-none-match": etag } : {}) }, signal: ctl.signal });
    if (r.status === 304) return null;
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const texto = await r.text();
    return { texto, etag: r.headers.get("etag"), modificado: r.headers.get("last-modified") };
  } catch (e: any) {
    throw new Error(e?.name === "AbortError" ? "sem resposta (tempo esgotado)" : String(e?.message || e));
  } finally { clearTimeout(tm); }
}

const msg = (e) => String(e?.message || e).slice(0, 160);
const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { ...CORS, "Content-Type": "application/json" } });
}
