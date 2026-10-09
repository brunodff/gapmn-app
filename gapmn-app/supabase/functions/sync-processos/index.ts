// @ts-nocheck
/**
 * Edge Function: sync-processos (v2 — out/2026)
 *
 * Traz TODOS os processos do GAP-MN (UASG 120630) das APIs públicas, sem depender de
 * ninguém logado no Compras.gov.br:
 *   • Descoberta: Dados Abertos do Compras.gov.br (lista por modalidade e ano — rápida,
 *     mas fica dias atrás do PNCP) + PNCP (publicados nos últimos 45 dias, na hora).
 *   • Em andamento: itens, situação e vencedores pelo PNCP (na hora).
 *   • Encerrados e carga inicial: itens com vencedor pelos Dados Abertos (1 consulta por
 *     processo).
 *   • Antigos (Leis 8.666/10.520, 2019–2023): Dados Abertos, módulo legado.
 * Grava processos_licitatorios (só as linhas que mudaram — os gatilhos avisam no feed e
 * quem acompanha o processo) e processos_itens; cada rodada fica em processos_sync_log.
 * Trabalha por tempo (~105 s): o que faltar fica para a próxima rodada (agendada 07:00 e
 * 13:00 de Manaus) ou para o botão "Atualizar agora" do app.
 *
 * Limites das APIs (medidos em out/2026): a "consulta" do PNCP recusa (429) depois de
 * ~35 chamadas seguidas — usada só para a lista dos recentes e até 15 processos em
 * andamento por rodada; os itens/resultados do PNCP aguentam ~10 por segundo; os Dados
 * Abertos recusam rajadas — uma chamada por vez.
 *
 * Quem pode chamar: o agendamento (cabeçalho x-sync-key = secret SYNC_PROCESSOS_KEY) ou
 * um usuário do app da SLIC/ADMIN/DEV (Authorization: Bearer <JWT do usuário>).
 * Corpo (opcional): { "legado": true } relista os antigos; { "completo": true } refaz
 * itens e vencedores de todos os processos (em várias rodadas).
 *
 * Deploy: supabase functions deploy sync-processos --no-verify-jwt
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// ─── Configuração ────────────────────────────────────────────────────────────
const UASG          = "120630";
const CNPJ          = "00394429000100";               // Comando da Aeronáutica
const PNCP_CONSULTA = "https://pncp.gov.br/api/consulta/v1";
const PNCP_API      = "https://pncp.gov.br/api/pncp/v1";
const DADOS         = "https://dadosabertos.compras.gov.br";
// Modalidades com processos da UASG 120630 nos Dados Abertos (1 a 60 testados em out/2026):
// 3 Concorrência, 5 Pregão, 6 Dispensa, 7 Inexigibilidade
const MODS_DADOS    = [3, 5, 6, 7];
// As mesmas no PNCP: 4 Concorrência Eletrônica, 6 Pregão Eletrônico, 8 Dispensa, 9 Inexigibilidade
const MODS_PNCP     = [4, 6, 8, 9];
const PNCP_PARA_SIASG: Record<number, string> = { 4: "03", 5: "03", 6: "05", 7: "05", 8: "06", 9: "07" };
const ANO_PNCP_INI  = 2023;
const ANOS_LEGADO   = [2019, 2020, 2021, 2022, 2023];
const DIAS_RECENTES = 45;
const CONSULTAS_MAX = 15;                             // detalhe da compra na "consulta" do PNCP
const TEMPO_MAX_MS  = 105_000;
const OBJ_MAX       = 2000;
const FINAIS        = /^(homologado|deserto|fracassado|revogado|anulado|cancelado|concluído)$/i;
const DIA           = 864e5;

const CORS = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-sync-key",
};

// Campos de processos_licitatorios que esta função mantém (comparados para gravar só o que mudou)
const CAMPOS = [
  "id_compra", "fonte", "ano", "modalidade", "numero_processo", "objeto", "data_publicacao",
  "abertura_proposta", "encerramento_proposta", "valor_estimado", "valor_homologado",
  "situacao_api", "link_sistema", "srp", "numero_controle_pncp", "processo_nup", "situacao",
  "amparo_legal", "modo_disputa", "link_pncp", "qtd_itens", "qtd_itens_homologados",
  "qtd_itens_andamento", "qtd_itens_sem_sucesso", "data_atualizacao_pncp", "itens_sync_em",
];
const CALCULADOS = ["situacao", "qtd_itens", "qtd_itens_homologados", "qtd_itens_andamento",
  "qtd_itens_sem_sucesso", "itens_sync_em"];

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
    if (!user) return json({ ok: false, error: "Faça login no app para atualizar os processos." }, 401);
    const { data: perfil } = await admin.from("profiles").select("setor, role").eq("id", user.id).maybeSingle();
    const setor = String(perfil?.setor || "").toUpperCase();
    if (!["SLIC", "ADMIN", "DEV"].includes(setor) && perfil?.role !== "admin") {
      return json({ ok: false, error: "Só a SLIC, ADMIN ou DEV podem atualizar os processos." }, 403);
    }
    usuario = user.id;
  }

  // ── Uma rodada por vez ──
  const { data: emCurso } = await admin.from("processos_sync_log")
    .select("id, inicio").eq("fonte", "publica").is("fim", null)
    .gte("inicio", new Date(Date.now() - 3 * 60_000).toISOString()).limit(1);
  if (emCurso?.length) {
    return json({ ok: false, emAndamento: true, error: "Já existe uma atualização em andamento — aguarde 2 minutos." }, 409);
  }
  const { data: log } = await admin.from("processos_sync_log")
    .insert({ fonte: "publica", origem, usuario }).select("id").single();

  const ctx = novaRodada();
  try {
    const resumo = await sincronizar(admin, ctx, corpo);
    await admin.from("processos_sync_log").update({
      fim: new Date().toISOString(), ok: true, resumo,
    }).eq("id", log?.id);
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

// ─── Rodada ──────────────────────────────────────────────────────────────────
function novaRodada() {
  const inicio = Date.now();
  return {
    inicio,
    restante: () => TEMPO_MAX_MS - (Date.now() - inicio),
    avisos: [] as string[],
    filaDados: Promise.resolve() as Promise<unknown>,   // Dados Abertos: uma chamada por vez
    consultas: 0,
    consultaBloqueada: false,
  };
}

async function sincronizar(admin, ctx, corpo) {
  const agora = new Date().toISOString();

  // ── Estado atual do banco ──
  const existentes = await lerTodos(admin, "processos_licitatorios", "id, chave, " + CAMPOS.join(", "));
  const porChave = new Map(existentes.map((r) => [r.chave, r]));
  const porIdCompra = new Map(existentes.filter((r) => r.id_compra).map((r) => [r.id_compra, r]));
  const temLegado = existentes.some((r) => r.fonte === "LEGADO");

  // ── 1. Descoberta ──
  const anoAtual = new Date().getUTCFullYear();
  const anos = [];
  for (let a = ANO_PNCP_INI; a <= anoAtual; a++) anos.push(a);

  const [listaDados, listaRecentes, listaLegado] = await Promise.all([
    listarDados14133(ctx, anos),
    listarPncpRecentes(ctx),
    (corpo.legado || !temLegado) ? listarLegado(ctx) : Promise.resolve([]),
  ]);

  // id_compra → processo (PNCP vence o legado; o PNCP "recente" vence os Dados Abertos)
  const processos = new Map<string, any>();
  for (const p of listaLegado) processos.set(p.id_compra, p);
  for (const p of listaDados) {
    const ant = processos.get(p.id_compra);
    processos.set(p.id_compra, { ...(ant && ant.fonte !== "LEGADO" ? ant : {}), ...p });
  }
  for (const p of listaRecentes) processos.set(p.id_compra, { ...(processos.get(p.id_compra) || {}), ...semNulos(p) });

  // Mantém a identidade (chave) de quem já está no banco — acompanhamentos e controle
  // apontam para a linha existente
  for (const p of processos.values()) {
    const ja = porIdCompra.get(p.id_compra);
    if (ja && ja.chave !== p.chave) p.chave = ja.chave;
    const antigo = porChave.get(p.chave);
    if (antigo) {
      // O que os detalhes calcularam não some só porque a lista não traz
      for (const c of CALCULADOS) if (p[c] === undefined) p[c] = antigo[c];
      if (!p.objeto && antigo.objeto) p.objeto = antigo.objeto;
      if (p.valor_homologado == null && antigo.valor_homologado != null && p.fonte !== "LEGADO") {
        p.valor_homologado = antigo.valor_homologado;
      }
    }
    // Já detalhado: vale a situação calculada pelos itens (salvo revogação/anulação/suspensão)
    p.situacao = (antigo?.itens_sync_em ? situacaoDaCompra(p) || antigo.situacao : null) || situacaoInicial(p);
  }

  const resumo: any = {
    encontrados: processos.size, novos: 0, alterados: 0, detalhadosPncp: 0, detalhadosDados: 0,
    itens: 0, vencedores: 0, pendentes: 0, legadoListado: listaLegado.length, avisos: ctx.avisos,
  };

  // Grava já a lista (se o tempo acabar nos detalhes, a lista não se perde)
  await gravarProcessos(admin, [...processos.values()], porChave, resumo, agora);

  // ── 2. Itens e vencedores ──
  const itensAntigos = await lerTodos(admin, "processos_itens",
    "id_compra, numero_item, fornecedor_ni, fornecedor_nome, fornecedor_porte, quantidade_homologada, valor_unitario_homologado, valor_total_homologado, data_resultado, item_atualizado_pncp");
  const itensPorCompra = new Map<string, Map<number, any>>();
  for (const it of itensAntigos) {
    if (!itensPorCompra.has(it.id_compra)) itensPorCompra.set(it.id_compra, new Map());
    itensPorCompra.get(it.id_compra)!.set(it.numero_item, it);
  }

  const { pncp: filaPncp, dados: filaDados } = filasDeDetalhes([...processos.values()], porChave, !!corpo.completo);
  const legadoSemItens = [...new Map([...existentes, ...processos.values()]
    .filter((p) => p.fonte === "LEGADO" && !porChave.get(p.chave)?.itens_sync_em)
    .map((p) => [p.chave, porChave.get(p.chave) ? { ...porChave.get(p.chave), ...p } : p])).values()];

  const detalhe = async (p, fn, chaveResumo) => {
    try {
      const r = await fn(ctx, p, itensPorCompra.get(p.id_compra) || new Map());
      if (!r) return;
      if (r.itens.length) await gravarItens(admin, r.itens);
      resumo.itens += r.itens.length;
      resumo.vencedores += r.vencedores;
      resumo[chaveResumo]++;
      await gravarProcessos(admin, [p], porChave, resumo, agora);
    } catch (e: any) {
      ctx.avisos.push(`${p.modalidade || ""} ${p.numero_processo || p.id_compra}: ${String(e?.message || e).slice(0, 120)}`);
    }
  };

  // PNCP (em andamento) e Dados Abertos (encerrados, depois os antigos) ao mesmo tempo:
  // cada um tem o seu limite de consultas
  let legadoItens = 0;
  await Promise.all([
    emLotes(filaPncp, 3, async (p) => {
      if (ctx.restante() < 12_000) return;
      await detalhe(p, detalharPncp, "detalhadosPncp");
    }),
    (async () => {
      for (const p of filaDados) {
        if (ctx.restante() < 10_000) return;
        await detalhe(p, detalharDados, "detalhadosDados");
      }
      for (const p of legadoSemItens) {
        if (ctx.restante() < 10_000) return;
        try {
          const itens = await itensLegado(ctx, p);
          if (itens.length) await gravarItens(admin, itens);
          Object.assign(p, contarItens(itens), { itens_sync_em: new Date().toISOString() });
          if (itens.length) p.situacao = situacaoPorItens(p, itens) || p.situacao;
          if (!p.objeto && itens.length) {
            p.objeto = texto([...new Set(itens.map((it) => it.descricao).filter(Boolean))].join("; ").slice(0, 400));
          }
          await gravarProcessos(admin, [p], porChave, resumo, agora);
          legadoItens++;
        } catch (e: any) {
          ctx.avisos.push(`antigo ${p.numero_processo}: ${String(e?.message || e).slice(0, 120)}`);
        }
      }
    })(),
  ]);

  resumo.legadoItens = legadoItens;
  resumo.pendentes = filaPncp.filter((p) => !p._detalhado).length +
    filaDados.filter((p) => !p._detalhado).length + (legadoSemItens.length - legadoItens);
  resumo.consultaBloqueada = ctx.consultaBloqueada;
  resumo.segundos = Math.round((Date.now() - ctx.inicio) / 1000);
  return resumo;
}

// Quem precisa de itens/vencedores e por qual caminho:
//   PNCP  — não encerrado e publicado há menos de 400 dias (precisa estar fresco)
//   Dados — nunca detalhado e mais antigo, ou o rodízio dos encerrados (1 consulta)
function filasDeDetalhes(lista, porChave, completo) {
  const agora = Date.now();
  const pncp = [], dados = [];
  for (const p of lista) {
    if (p.fonte === "LEGADO" || !p.seq_pncp) continue;
    const ant = porChave.get(p.chave);
    const sync = ant?.itens_sync_em ? Date.parse(ant.itens_sync_em) : 0;
    const pub = p.data_publicacao ? Date.parse(p.data_publicacao) : 0;
    const final = FINAIS.test(String(p.situacao || ""));
    const recente = agora - pub < 400 * DIA;
    const mudou = p.data_atualizacao_pncp && Date.parse(p.data_atualizacao_pncp) > sync;
    if (!final && recente && (sync === 0 ? agora - pub < 120 * DIA : true)) {
      pncp.push([(sync ? 2 : 3) + pub / 1e13, p]);
    } else if (completo || !sync || mudou) {
      dados.push([(sync ? 1 : 2) + pub / 1e13, p]);
    } else if (agora - sync > 30 * DIA) {
      dados.push([1 - sync / 1e13, p]);                 // rodízio: o mais velho primeiro
    }
  }
  const ordenar = (l) => l.sort((a, b) => b[0] - a[0]).map(([, p]) => p);
  return { pncp: ordenar(pncp), dados: ordenar(dados) };
}

// ─── Descoberta ──────────────────────────────────────────────────────────────
async function listarDados14133(ctx, anos) {
  const out = [];
  for (const ano of anos) {
    for (const mod of MODS_DADOS) {
      try {
        const rows = await paginarDados(ctx, "/modulo-contratacoes/1_consultarContratacoes_PNCP_14133", {
          unidadeOrgaoCodigoUnidade: UASG, codigoModalidade: mod,
          dataPublicacaoPncpInicial: `${ano}-01-01`, dataPublicacaoPncpFinal: `${ano}-12-31`,
        });
        for (const r of rows) if (!r.contratacaoExcluida) { const p = deDados(r); if (p) out.push(p); }
      } catch (e: any) { ctx.avisos.push(`lista ${ano}/mod ${mod}: ${String(e?.message || e).slice(0, 100)}`); }
    }
  }
  return out;
}

async function listarPncpRecentes(ctx) {
  const fim = new Date(), ini = new Date(Date.now() - DIAS_RECENTES * DIA);
  const d = (x: Date) => x.toISOString().slice(0, 10).replace(/-/g, "");
  const out = [];
  for (const mod of MODS_PNCP) {
    for (let pg = 1; pg <= 10; pg++) {
      const r = await pedirConsulta(ctx, `${PNCP_CONSULTA}/contratacoes/publicacao?dataInicial=${d(ini)}&dataFinal=${d(fim)}` +
        `&codigoModalidadeContratacao=${mod}&cnpj=${CNPJ}&codigoUnidadeAdministrativa=${UASG}&pagina=${pg}&tamanhoPagina=50`);
      for (const x of r?.data || []) { const p = deConsulta(x); if (p) out.push(p); }
      if (!r || !r.paginasRestantes) break;
    }
  }
  return out;
}

async function listarLegado(ctx) {
  const porId = new Map<string, any>();
  const juntar = (p) => { if (p) porId.set(p.id_compra, { ...(porId.get(p.id_compra) || {}), ...semNulos(p) }); };
  for (const ano of ANOS_LEGADO) {
    const de = `${ano}-01-01`, ate = `${ano}-12-31`;
    try {
      for (const r of await paginarDados(ctx, "/modulo-legado/1_consultarLicitacao",
        { uasg: UASG, data_publicacao_inicial: de, data_publicacao_final: ate })) {
        if (!r.pertence14133) juntar(deLegadoLicitacao(r));
      }
      for (const r of await paginarDados(ctx, "/modulo-legado/3_consultarPregoes",
        { co_uasg: UASG, dt_data_edital_inicial: de, dt_data_edital_final: ate })) {
        if (!r.pertence14133) juntar(deLegadoPregao(r));
      }
      for (const r of await paginarDados(ctx, "/modulo-legado/5_consultarComprasSemLicitacao",
        { co_uasg: UASG, dt_ano_aviso: ano })) {
        const p = !r.pertence14133 && deLegadoSemLicitacao(r);
        if (p && !porId.has(p.id_compra)) porId.set(p.id_compra, p);
      }
    } catch (e: any) { ctx.avisos.push(`antigos ${ano}: ${String(e?.message || e).slice(0, 100)}`); }
  }
  return [...porId.values()];
}

// ─── Normalização ────────────────────────────────────────────────────────────
function deDados(r) {
  const m = String(r.numeroControlePNCP || "").match(/-(\d+)\/(\d{4})$/);
  const id = String(r.idCompra || "");
  if (!m || !/^\d{17}$/.test(id)) return null;
  const anoCompra = Number(id.slice(13));
  return {
    id_compra: id, chave: "PNCP:" + r.numeroControlePNCP, fonte: "PNCP_14133",
    numero_controle_pncp: r.numeroControlePNCP, ano_pncp: Number(m[2]), seq_pncp: Number(m[1]),
    ano: anoCompra,
    modalidade: r.modalidadeNome || null,
    numero_processo: `${Number(r.numeroCompra) || r.numeroCompra}/${anoCompra}`,
    objeto: texto(r.objetoCompra),
    data_publicacao: soData(r.dataPublicacaoPncp),
    abertura_proposta: soData(r.dataAberturaPropostaPncp),
    encerramento_proposta: soData(r.dataEncerramentoPropostaPncp),
    valor_estimado: num(r.valorTotalEstimado),
    valor_homologado: positivo(r.valorTotalHomologado),
    situacao_api: r.situacaoCompraNomePncp || null,
    link_sistema: linkCompra(id),
    link_pncp: linkPncp(m[2], m[1]),
    srp: typeof r.srp === "boolean" ? r.srp : null,
    processo_nup: nup(r.processo),
    amparo_legal: r.amparoLegalNome || null,
    modo_disputa: r.modoDisputaNomePncp || null,
    data_atualizacao_pncp: horaBR(r.dataAtualizacaoPncp),
  };
}

function deConsulta(x) {
  const ano = Number(x.anoCompra), seq = Number(x.sequencialCompra);
  if (!ano || !seq) return null;
  const doLink = String(x.linkSistemaOrigem || "").match(/compra=(\d{17})/);
  const mod = PNCP_PARA_SIASG[Number(x.modalidadeId)];
  const id = doLink ? doLink[1]
    : mod ? `${UASG}${mod}${String(Number(x.numeroCompra) || 0).padStart(5, "0")}${ano}` : null;
  if (!id) return null;
  const numeroControle = x.numeroControlePNCP || `${CNPJ}-1-${String(seq).padStart(6, "0")}/${ano}`;
  return {
    id_compra: id, chave: "PNCP:" + numeroControle, fonte: "PNCP_14133",
    numero_controle_pncp: numeroControle, ano_pncp: ano, seq_pncp: seq,
    ano: Number(id.slice(13)),
    modalidade: x.modalidadeNome || null,
    numero_processo: `${Number(x.numeroCompra) || x.numeroCompra}/${Number(id.slice(13))}`,
    objeto: texto(x.objetoCompra),
    data_publicacao: soData(x.dataPublicacaoPncp),
    abertura_proposta: soData(x.dataAberturaProposta),
    encerramento_proposta: soData(x.dataEncerramentoProposta),
    valor_estimado: num(x.valorTotalEstimado),
    valor_homologado: positivo(x.valorTotalHomologado),
    situacao_api: x.situacaoCompraNome || null,
    link_sistema: linkCompra(id),
    link_pncp: linkPncp(ano, seq),
    srp: typeof x.srp === "boolean" ? x.srp : null,
    processo_nup: nup(x.processo),
    amparo_legal: x.amparoLegal?.nome || null,
    modo_disputa: x.modoDisputaNome || null,
    data_atualizacao_pncp: horaBR(x.dataAtualizacaoGlobal || x.dataAtualizacao),
  };
}

function baseLegado(id) {
  if (!/^\d{17}$/.test(String(id || ""))) return null;
  const ano = Number(id.slice(13));
  return {
    id_compra: id, chave: "LEGADO:" + id, fonte: "LEGADO", ano,
    numero_processo: `${Number(id.slice(8, 13))}/${ano}`, link_sistema: linkCompra(id),
  };
}

function deLegadoLicitacao(r) {
  const b = baseLegado(r.id_compra); if (!b) return null;
  return {
    ...b,
    modalidade: titulo(r.nome_modalidade) + (r.tipo_pregao ? " - " + tipoPregao(r.tipo_pregao) : ""),
    objeto: texto(desquebrar(r.objeto).replace(/^\s*preg[ãa]o (eletr[ôo]nico|presencial)\s+/i, "")),
    data_publicacao: soData(r.data_publicacao),
    abertura_proposta: soData(r.data_abertura_proposta),
    valor_estimado: num(r.valor_estimado_total),
    valor_homologado: positivo(r.valor_homologado_total),
    situacao_api: r.situacao_aviso || null,
    processo_nup: nup(r.numero_processo),
    qtd_itens: r.numero_itens ?? undefined,
  };
}

function deLegadoPregao(r) {
  const b = baseLegado(r.id_compra); if (!b) return null;
  return {
    ...b,
    modalidade: "Pregão" + (r.ds_tipo_pregao ? " - " + tipoPregao(r.ds_tipo_pregao) : ""),
    objeto: texto(r.tx_objeto),
    data_publicacao: soData(r.dt_data_edital),
    abertura_proposta: soData(r.dt_inicio_proposta),
    encerramento_proposta: soData(r.dt_fim_proposta),
    valor_estimado: num(r.valor_estimado_total),
    valor_homologado: positivo(r.valor_homologado_total),
    situacao_api: r.ds_situacao_pregao ? titulo(r.ds_situacao_pregao) : null,
    srp: /srp/i.test(String(r.ds_tipo_pregao_compra || "")) ? true : null,
    processo_nup: nup(r.co_processo),
  };
}

function deLegadoSemLicitacao(r) {
  const b = baseLegado(r.id_compra); if (!b) return null;
  const mod = Number(r.co_modalidade_licitacao);
  return {
    ...b,
    modalidade: mod === 7 ? "Inexigibilidade" : "Dispensa",
    objeto: texto(linhas(r.ds_objeto_licitacao).replace(/^\s*objeto:\s*/i, "")),
    data_publicacao: soData(r.dt_publicacao || r.dt_ratificacao || r.dt_declaracao_dispensa),
    valor_estimado: num(r.vr_estimado),
    situacao_api: r.dt_ratificacao ? "Ratificada" : null,
    processo_nup: nup(r.nu_processo),
    amparo_legal: texto(linhas(r.ds_fundamento_legal).replace(/^\s*fundamento legal:\s*/i, "")),
    qtd_itens: r.qt_total_item ?? undefined,
  };
}

// ─── Itens e vencedores ──────────────────────────────────────────────────────
// PNCP: itens frescos; vencedor com um pedido por item (só dos itens que mudaram)
async function detalharPncp(ctx, p, antigos: Map<number, any>) {
  const ref = `${CNPJ}/compras/${p.ano_pncp}/${p.seq_pncp}`;
  if (ctx.consultas < CONSULTAS_MAX) {
    ctx.consultas++;
    const compra = await pedirConsulta(ctx, `${PNCP_CONSULTA}/orgaos/${ref}`);
    const fresco = compra && deConsulta(compra);
    if (fresco) for (const [k, v] of Object.entries(fresco)) if (v != null && k !== "chave" && k !== "id_compra") p[k] = v;
  }

  const brutos = [];
  for (let pg = 1; pg <= 20; pg++) {
    const r = await pedir(ctx, `${PNCP_API}/orgaos/${ref}/itens?pagina=${pg}&tamanhoPagina=500`);
    const lista = Array.isArray(r) ? r : [];
    brutos.push(...lista);
    if (lista.length < 500) break;
  }

  const agora = new Date().toISOString();
  const itens = brutos.map((it) => {
    const ant = antigos.get(Number(it.numeroItem));
    const atualizado = horaBR(it.dataAtualizacao);
    const mudou = !ant || !ant.item_atualizado_pncp || Date.parse(atualizado || "") > Date.parse(ant.item_atualizado_pncp);
    const guardado = it.temResultado && ant?.fornecedor_ni ? ant : null;   // vencedor que já temos
    return {
      _buscar: !!it.temResultado && (mudou || !guardado),
      id_compra: p.id_compra, numero_item: Number(it.numeroItem), fonte: "PNCP",
      descricao: texto(it.descricao), material_servico: it.materialOuServicoNome || null,
      unidade: it.unidadeMedida || null, quantidade: num(it.quantidade),
      valor_unitario_estimado: num(it.valorUnitarioEstimado), valor_total_estimado: num(it.valorTotal),
      situacao: it.situacaoCompraItemNome || null, criterio_julgamento: it.criterioJulgamentoNome || null,
      beneficio: it.tipoBeneficioNome || null, tem_resultado: !!it.temResultado,
      fornecedor_ni: guardado?.fornecedor_ni ?? null, fornecedor_nome: guardado?.fornecedor_nome ?? null,
      fornecedor_porte: guardado?.fornecedor_porte ?? null, quantidade_homologada: guardado?.quantidade_homologada ?? null,
      valor_unitario_homologado: guardado?.valor_unitario_homologado ?? null,
      valor_total_homologado: guardado?.valor_total_homologado ?? null, data_resultado: guardado?.data_resultado ?? null,
      item_atualizado_pncp: atualizado, atualizado_em: agora,
    };
  }).filter((it) => it.numero_item > 0);

  let vencedores = 0, faltou = false;
  await emLotes(itens.filter((it) => it._buscar), 4, async (it) => {
    if (ctx.restante() < 8_000) { faltou = true; return; }
    let rs;
    try { rs = await pedir(ctx, `${PNCP_API}/orgaos/${ref}/itens/${it.numero_item}/resultados`); }
    catch { faltou = true; return; }
    const validos = (Array.isArray(rs) ? rs : []).filter((x) => !x.dataCancelamento)
      .sort((a, b) => (a.ordemClassificacaoSrp ?? a.sequencialResultado ?? 0) - (b.ordemClassificacaoSrp ?? b.sequencialResultado ?? 0));
    const v = validos[0];
    if (!v) return;
    it.fornecedor_ni = v.niFornecedor || null;
    it.fornecedor_nome = v.nomeRazaoSocialFornecedor || null;
    it.fornecedor_porte = v.porteFornecedorNome || null;
    it.quantidade_homologada = num(v.quantidadeHomologada);
    it.valor_unitario_homologado = num(v.valorUnitarioHomologado);
    it.valor_total_homologado = validos.reduce((s, x) => s + (num(x.valorTotalHomologado) || 0), 0) || null;
    it.data_resultado = soData(v.dataResultado);
    vencedores++;
  });
  // O que não deu para buscar volta na próxima rodada
  for (const it of itens) { if (it._buscar && !it.fornecedor_ni) it.item_atualizado_pncp = null; delete it._buscar; }

  fecharProcesso(p, itens, faltou ? null : agora);
  return { itens, vencedores };
}

// Dados Abertos: todos os itens com vencedor numa consulta só (atrasa dias — bom para
// os encerrados e para a carga inicial)
async function detalharDados(ctx, p) {
  const rs = await paginarDados(ctx, "/modulo-contratacoes/2.1_consultarItensContratacoes_PNCP_14133_Id",
    { tipo: "idCompra", codigo: p.id_compra }, false);
  const agora = new Date().toISOString();
  // Um item pode vir em várias linhas (um por fornecedor, quando a quantidade foi dividida):
  // fica uma linha por item, com os totais somados e o maior fornecedor como vencedor
  const porItem = new Map<number, any[]>();
  for (const x of rs) {
    const n = Number(x.numeroItemPncp ?? x.numeroItemCompra);
    if (!porItem.has(n)) porItem.set(n, []);
    porItem.get(n)!.push(x);
  }
  const itens = [...porItem.values()].map((linhas) => {
    const x = linhas.reduce((a, b) => ((num(b.valorTotalResultado) || 0) > (num(a.valorTotalResultado) || 0) ? b : a));
    const soma = (c) => linhas.some((l) => num(l[c]) != null) ? arred(linhas.reduce((t, l) => t + (num(l[c]) || 0), 0)) : null;
    return { ...x, valorTotalResultado: soma("valorTotalResultado"), quantidadeResultado: soma("quantidadeResultado") };
  }).map((x) => ({
    id_compra: p.id_compra, numero_item: Number(x.numeroItemPncp ?? x.numeroItemCompra), fonte: "DADOS",
    numero_grupo: Number(x.numeroGrupo) || null,
    descricao: texto(x.descricaodetalhada || x.descricaoResumida), material_servico: x.materialOuServicoNome || null,
    unidade: x.unidadeMedida || null, quantidade: num(x.quantidade),
    valor_unitario_estimado: num(x.valorUnitarioEstimado), valor_total_estimado: num(x.valorTotal),
    situacao: x.situacaoCompraItemNome || null, criterio_julgamento: x.criterioJulgamentoNome || null,
    beneficio: x.tipoBeneficioNome || null, tem_resultado: !!x.temResultado,
    fornecedor_ni: x.codFornecedor || null, fornecedor_nome: x.nomeFornecedor || null, fornecedor_porte: null,
    quantidade_homologada: num(x.quantidadeResultado), valor_unitario_homologado: num(x.valorUnitarioResultado),
    valor_total_homologado: num(x.valorTotalResultado), data_resultado: soData(x.dataResultado),
    item_atualizado_pncp: horaBR(x.dataAtualizacaoPncp), atualizado_em: agora,
  })).filter((it) => it.numero_item > 0);
  fecharProcesso(p, itens, agora);
  return { itens, vencedores: itens.filter((it) => it.fornecedor_ni).length };
}

function fecharProcesso(p, itens, syncEm) {
  Object.assign(p, contarItens(itens));
  p.situacao = situacaoPorItens(p, itens) || situacaoInicial(p);
  if (p.valor_homologado == null) {
    const soma = itens.reduce((s, it) => s + (it.valor_total_homologado || 0), 0);
    if (soma > 0) p.valor_homologado = arred(soma);
  }
  p.itens_sync_em = syncEm;       // null = volta na próxima rodada
  p._detalhado = !!syncEm;
}

async function itensLegado(ctx, p) {
  const id = p.id_compra, mod = id.slice(6, 8);
  const agora = new Date().toISOString();
  const nItem = (x) => Number(String(x.id_compra_item || "").slice(-5)) || Number(x.numero_item_licitacao) || 0;
  if (mod === "06" || mod === "07") {
    const rs = await paginarDados(ctx, "/modulo-legado/6.1_consultarItensComprasSemLicitacao_Id", { id_compra: id }, false);
    return rs.map((x) => ({
      id_compra: id, numero_item: nItem(x), fonte: "LEGADO",
      descricao: texto(x.ds_detalhada || x.no_servico || x.no_conjunto_materiais), material_servico: titulo(x.in_material_servico),
      unidade: x.no_unidade_medida || null, quantidade: num(x.qt_material_alt),
      valor_total_estimado: num(x.vr_estimado), situacao: x.no_fornecedor_vencedor ? "Homologado" : null,
      tem_resultado: !!x.no_fornecedor_vencedor, fornecedor_ni: x.nu_cnpj_vencedor || x.nu_cpf_vencedor || null,
      fornecedor_nome: x.no_fornecedor_vencedor || null, atualizado_em: agora,
    })).filter((x) => x.numero_item > 0);
  }
  if (mod === "05") {
    const rs = await paginarDados(ctx, "/modulo-legado/4.1_consultarItensPregoes_Id", { id_compra: id }, false);
    return rs.map((x) => {
      const q = num(x.quantidade_item), ve = num(x.valor_estimado_item), vh = num(x.valor_homologado_item);
      return {
        id_compra: id, numero_item: nItem(x), fonte: "LEGADO",
        descricao: texto(x.descricao_detalhada_item || x.descricao_item), unidade: x.unidade_fornecimento || null,
        quantidade: q, valor_unitario_estimado: ve,
        valor_total_estimado: ve != null && q != null ? arred(ve * q) : null,
        situacao: titulo(x.situacao_item), tem_resultado: vh != null,
        valor_unitario_homologado: vh, valor_total_homologado: vh != null && q != null ? arred(vh * q) : null,
        data_resultado: soData(x.dt_hom || x.dt_adjudic), atualizado_em: agora,
      };
    }).filter((x) => x.numero_item > 0);
  }
  const rs = await paginarDados(ctx, "/modulo-legado/2.1_consultarItemLicitacao_Id", { id_compra: id }, false);
  return rs.map((x) => ({
    id_compra: id, numero_item: nItem(x), fonte: "LEGADO",
    descricao: texto(x.nome_material || x.nome_servico || x.descricao_item), unidade: x.unidade || null,
    quantidade: num(x.quantidade), valor_total_estimado: num(x.valor_estimado),
    criterio_julgamento: x.criterio_julgamento || null, beneficio: x.beneficio || null,
    tem_resultado: !!(x.cnpj_fornecedor || x.cpf_vencedor),
    fornecedor_ni: x.cnpj_fornecedor || x.cpf_vencedor || null, fornecedor_nome: x.nome_fornecedor || x.nome_vencedor_pf || null,
    atualizado_em: agora,
  })).filter((x) => x.numero_item > 0);
}

// ─── Situação ────────────────────────────────────────────────────────────────
function contarItens(itens) {
  const s = (it) => String(it.situacao || "").toLowerCase();
  return {
    qtd_itens: itens.length,
    qtd_itens_homologados: itens.filter((it) => /homolog/.test(s(it))).length,
    qtd_itens_andamento: itens.filter((it) => /andamento|aberto|em sele/.test(s(it))).length,
    qtd_itens_sem_sucesso: itens.filter((it) => /desert|fracass|cancel|anulad|revogad/.test(s(it))).length,
  };
}

function situacaoDaCompra(p) {
  const s = String(p.situacao_api || "").toLowerCase();
  if (/revogad/.test(s)) return "Revogado";
  if (/anulad/.test(s)) return "Anulado";
  if (/suspens/.test(s)) return "Suspenso";
  return null;
}

function situacaoPorItens(p, itens) {
  const daCompra = situacaoDaCompra(p);
  if (daCompra) return daCompra;
  if (!itens.length) return null;
  const s = (it) => String(it.situacao || "").toLowerCase();
  const hom = itens.filter((it) => /homolog/.test(s(it))).length;
  const sem = itens.filter((it) => /desert|fracass|cancel|anulad|revogad/.test(s(it))).length;
  const and = itens.length - hom - sem;
  if (and > 0) return hom > 0 ? "Homologado parcialmente" : "Em andamento";
  if (hom > 0) return "Homologado";
  if (itens.every((it) => /desert/.test(s(it)))) return "Deserto";
  if (itens.some((it) => /fracass/.test(s(it)))) return "Fracassado";
  return "Cancelado";
}

// Antes de ter os itens
function situacaoInicial(p) {
  const daCompra = situacaoDaCompra(p);
  if (daCompra) return daCompra;
  const s = String(p.situacao_api || "").toLowerCase();
  if (p.fonte === "LEGADO") {
    if (/cancel/.test(s)) return "Cancelado";
    if (/desert/.test(s)) return "Deserto";
    if (/fracass/.test(s)) return "Fracassado";
    if (/homolog/.test(s) || p.valor_homologado > 0) return "Homologado";
    return "Concluído";
  }
  return p.valor_homologado > 0 ? "Homologado" : "Publicado";
}

// ─── Gravação ────────────────────────────────────────────────────────────────
async function gravarProcessos(admin, lista, porChave, resumo, agora) {
  const mudaram = [];
  for (const p of lista) {
    const ant = porChave.get(p.chave);
    const linha: any = { chave: p.chave };
    for (const c of CAMPOS) if (p[c] !== undefined) linha[c] = p[c];
    if (linha.objeto && linha.objeto.length > OBJ_MAX) linha.objeto = linha.objeto.slice(0, OBJ_MAX - 1) + "…";
    if (ant && CAMPOS.every((c) => linha[c] === undefined || igual(linha[c], ant[c]))) continue;
    linha.ultima_sync = agora;
    mudaram.push(linha);
    if (!ant) resumo.novos++; else resumo.alterados++;
    porChave.set(p.chave, { ...(ant || {}), ...linha });
  }
  for (let i = 0; i < mudaram.length; i += 100) {
    const lote = mudaram.slice(i, i + 100);
    const { error } = await admin.from("processos_licitatorios").upsert(lote, { onConflict: "chave" });
    if (!error) continue;
    // Um registro ruim não derruba o lote: grava um por um
    for (const linha of lote) {
      const { error: e1 } = await admin.from("processos_licitatorios").upsert(linha, { onConflict: "chave" });
      if (e1) resumo.avisos.push(`gravar ${linha.numero_processo}: ${e1.message.slice(0, 120)}`);
    }
  }
}

async function gravarItens(admin, todos) {
  // O banco recusa a mesma chave duas vezes no mesmo lote: fica a última
  const itens = [...new Map(todos.map((it) => [it.id_compra + "|" + it.numero_item, it])).values()];
  for (let i = 0; i < itens.length; i += 300) {
    const { error } = await admin.from("processos_itens")
      .upsert(itens.slice(i, i + 300), { onConflict: "id_compra,numero_item" });
    if (error) throw new Error("itens: " + error.message);
  }
}

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

function igual(a, b) {
  if (a == null && b == null) return true;
  if (a == null || b == null) return false;
  if (typeof a === "number" || typeof b === "number") return Math.abs(Number(a) - Number(b)) < 0.005;
  if (typeof a === "boolean" || typeof b === "boolean") return String(a) === String(b);
  const ta = Date.parse(a), tb = Date.parse(b);
  if (/^\d{4}-\d{2}-\d{2}/.test(String(a)) && !isNaN(ta) && !isNaN(tb)) return ta === tb;
  return String(a) === String(b);
}

// ─── HTTP ────────────────────────────────────────────────────────────────────
async function pedir(ctx, url, { tentativas = 3, timeoutMs = 40_000, esperar429 = true } = {}) {
  let ultimo = "";
  for (let t = 1; t <= tentativas; t++) {
    const ctl = new AbortController();
    const tm = setTimeout(() => ctl.abort(), Math.min(timeoutMs, Math.max(5_000, ctx.restante())));
    try {
      const r = await fetch(url, { headers: { accept: "application/json", "user-agent": "GAPMN-Processos/2.0" }, signal: ctl.signal });
      if (r.status === 204 || r.status === 404) return null;
      if (r.status === 429) {
        const s = Number((((await r.text()) || "").match(/(\d+)\s*second/) || [])[1] || 20);
        if (!esperar429 || ctx.restante() < (s + 6) * 1000) throw new Error("429: limite de consultas da API — continua na próxima rodada");
        await dormir((s + 1) * 1000);
        continue;
      }
      if (r.status >= 500) { ultimo = "HTTP " + r.status; await dormir(700 * t); continue; }
      if (!r.ok) throw new Error(`HTTP ${r.status} em ${url.replace(/^https:\/\/[^/]+/, "").slice(0, 90)}`);
      const txt = await r.text();
      return txt.trim() ? JSON.parse(txt) : null;
    } catch (e: any) {
      ultimo = e?.name === "AbortError" ? "sem resposta (tempo esgotado)" : String(e?.message || e);
      if (t === tentativas || /^429|HTTP 4/.test(ultimo) || ctx.restante() < 8_000) throw new Error(ultimo);
      await dormir(600 * t);
    } finally { clearTimeout(tm); }
  }
  throw new Error(ultimo || "sem resposta");
}

// "Consulta" do PNCP: no primeiro 429 desiste dela nesta rodada (o resto segue)
async function pedirConsulta(ctx, url) {
  if (ctx.consultaBloqueada) return null;
  try { return await pedir(ctx, url, { tentativas: 2, timeoutMs: 60_000, esperar429: false }); }
  catch (e: any) {
    if (/^429/.test(String(e?.message))) ctx.consultaBloqueada = true;
    else ctx.avisos.push("PNCP consulta: " + String(e?.message || e).slice(0, 100));
    return null;
  }
}

// Dados Abertos limita as consultas: uma por vez, com intervalo
function pedirDados(ctx, url) {
  const vez = ctx.filaDados.then(() => dormir(350)).then(() => pedir(ctx, url));
  ctx.filaDados = vez.catch(() => {});
  return vez;
}

async function paginarDados(ctx, caminho, params, paginado = true) {
  const out = [];
  for (let pg = 1; pg <= 50; pg++) {
    const qs = new URLSearchParams(Object.entries(paginado ? { ...params, pagina: pg, tamanhoPagina: 500 } : params)
      .map(([k, v]) => [k, String(v)])).toString();
    const r = await pedirDados(ctx, `${DADOS}${caminho}?${qs}`);
    const lista = Array.isArray(r?.resultado) ? r.resultado : [];
    out.push(...lista);
    if (!paginado || !lista.length || !r.totalPaginas || pg >= r.totalPaginas) break;
  }
  return out;
}

async function emLotes(lista, n, fn) {
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, lista.length) }, async () => {
    while (i < lista.length) { const x = lista[i++]; await fn(x); }
  }));
}

// ─── Textos dos antigos ──────────────────────────────────────────────────────
const CURTAS = new Set(["de", "da", "do", "das", "dos", "e", "a", "o", "as", "os", "em", "no", "na", "nos", "nas", "para",
  "com", "ao", "aos", "à", "às", "por", "que", "um", "uma", "se", "ou", "sem", "sob", "pelo", "pela", "pelos", "pelas"]);
// Licitações antigas: o texto vem cortado em pedaços de 47 caracteres unidos por um
// espaço — inclusive no meio da palavra ("emp resa"). Primeiro corte na posição 36.
function desquebrar(v) {
  const s = String(v || "");
  const letra = (c) => /[\p{L}\p{N}]/u.test(c || "");
  const palavra = (i, passo) => { let j = i, w = ""; while (letra(s[j])) { w = passo < 0 ? s[j] + w : w + s[j]; j += passo; } return w.toLowerCase(); };
  const tirar = new Set<number>();
  for (let alvo = 36; alvo < s.length; ) {
    let achou = -1, natural = false;
    for (const d of [0, 1, -1, 2, -2]) {
      const k = alvo + d;
      if (s[k] === " " && (s[k + 1] === " " || s[k - 1] === " ")) { achou = s[k + 1] === " " ? k + 1 : k; break; }
    }
    if (achou < 0) for (const d of [0, 1, -1, 2, -2]) {
      const k = alvo + d;
      if (s[k] === " " && !(letra(s[k - 1]) && letra(s[k + 1]))) { achou = k; natural = true; break; }  // ", limpeza"
      if (s[k] === " " && letra(s[k - 1]) && letra(s[k + 1])) {
        achou = k;
        // O corte caiu num espaço de verdade ("de Manaus"): não junta. Letra maiúscula
        // sozinha ("A nálises") é pedaço de palavra.
        const esq = palavra(k - 1, -1);
        natural = (CURTAS.has(esq) && !(esq.length === 1 && s[k - 1] !== s[k - 1].toLowerCase())) ||
          CURTAS.has(palavra(k + 1, 1));
        break;
      }
    }
    if (achou < 0) break;              // não segue o padrão: deixa como veio
    if (!natural) tirar.add(achou);
    alvo = achou + 48;
  }
  return [...s].filter((_, i) => !tirar.has(i)).join("");
}
// Dispensas antigas: linhas de 47 caracteres completadas com espaços (29 = cortou a
// palavra, 30 = havia um espaço de verdade)
function linhas(v) { return String(v || "").replace(/ {30,}/g, " ").replace(/ {8,29}/g, ""); }

// ─── Utilitários ─────────────────────────────────────────────────────────────
function num(v) {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return isNaN(n) ? null : n;
}
function positivo(v) { const n = num(v); return n != null && n > 0 ? n : null; }
function arred(n) { return Math.round(n * 100) / 100; }
function semNulos(o) { return Object.fromEntries(Object.entries(o).filter(([, v]) => v != null)); }
function soData(v) { const m = String(v || "").match(/(\d{4}-\d{2}-\d{2})/); return m ? m[1] : null; }
// Datas do PNCP vêm sem fuso (horário de Brasília)
function horaBR(v) {
  const s = String(v || "");
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(s)) return null;
  return /[zZ]|[+-]\d{2}:?\d{2}$/.test(s) ? s : s + "-03:00";
}
function nup(v) {
  const d = String(v || "").replace(/\D/g, "");
  if (d.length === 17) return `${d.slice(0, 5)}.${d.slice(5, 11)}/${d.slice(11, 15)}-${d.slice(15)}`;
  return v ? String(v).trim() : null;
}
function texto(v) { const s = String(v ?? "").replace(/\s+/g, " ").trim(); return s || null; }
function titulo(v) {
  const s = String(v || "").trim().toLowerCase();
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : null;
}
function tipoPregao(v) {
  const s = String(v || "").toLowerCase();
  return /eletr/.test(s) ? "Eletrônico" : /presen/.test(s) ? "Presencial" : titulo(s);
}
function linkCompra(id) {
  return `https://cnetmobile.estaleiro.serpro.gov.br/comprasnet-web/public/compras/acompanhamento-compra?compra=${id}`;
}
function linkPncp(ano, seq) { return `https://pncp.gov.br/app/editais/${CNPJ}/${ano}/${Number(seq)}`; }
function dormir(ms) { return new Promise((r) => setTimeout(r, ms)); }
function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });
}
