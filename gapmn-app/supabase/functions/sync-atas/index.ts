// @ts-nocheck
/**
 * Edge Function: sync-atas (nov/2026)
 *
 * Atas de Registro de Preço do GAP-MN (UASG 120630 gerenciadora) pelas APIs públicas, sem
 * ninguém logado no Contratos.gov.br (antes só o bookmarklet arp-bot.js, rodado à mão):
 *   • PNCP, consulta /v1/atas (vigentes hoje, uma página de 500 por CNPJ) e /v1/atas/atualizacao
 *     (alteradas nos últimos 30 dias): ata nova, vigência (prorrogação) e cancelamento — na hora.
 *   • Dados Abertos do Compras.gov.br, modulo-arp/2_consultarARPItem: itens das atas que ainda
 *     não têm itens (fornecedor, quantidade, valores, adesão). Essa base atrasa — em nov/2026, a
 *     ata mais nova dela era de 31/08 —, então ata recém-assinada fica sem itens até a base
 *     publicar; o bookmarklet do Contratos.gov.br continua podendo completar antes.
 * Não apaga nada e não mexe no PDF do TR (pdf_url) nem nos itens que já existem.
 * Cada rodada fica em processos_sync_log (fonte 'atas').
 *
 * Quem pode chamar: o agendamento (cabeçalho x-sync-key = secret SYNC_PROCESSOS_KEY) ou um
 * usuário do app da SLIC/ADMIN/DEV (Authorization: Bearer <JWT do usuário>).
 *
 * Deploy: supabase functions deploy sync-atas --no-verify-jwt
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// ─── Configuração ────────────────────────────────────────────────────────────
const UASG          = "120630";
// Comando da Aeronáutica (desde 2025) e o CNPJ antigo do GAP-MN (atas de compras até 2024)
const CNPJS         = ["00394429000100", "00394429018824"];
const PNCP_CONSULTA = "https://pncp.gov.br/api/consulta/v1";
const DADOS         = "https://dadosabertos.compras.gov.br";
const DIAS_ALTERADAS = 30;
const TEMPO_MAX_MS  = 105_000;
const DIA           = 864e5;

const CORS = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-sync-key",
};

// Campos de atas_gap_mn que esta função mantém (comparados para gravar só o que mudou)
const CAMPOS = ["vigencia_inicial", "vigencia_final", "situacao", "link_pncp", "numero_controle_pncp", "objeto"];

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
    if (!user) return json({ ok: false, error: "Faça login no app para atualizar as atas." }, 401);
    const { data: perfil } = await admin.from("profiles").select("setor, role").eq("id", user.id).maybeSingle();
    const setor = String(perfil?.setor || "").toUpperCase();
    if (!["SLIC", "ADMIN", "DEV"].includes(setor) && perfil?.role !== "admin") {
      return json({ ok: false, error: "Só a SLIC, ADMIN ou DEV podem atualizar as atas." }, 403);
    }
    usuario = user.id;
  }

  // ── Uma rodada por vez ──
  const { data: emCurso } = await admin.from("processos_sync_log")
    .select("id").eq("fonte", "atas").is("fim", null)
    .gte("inicio", new Date(Date.now() - 3 * 60_000).toISOString()).limit(1);
  if (emCurso?.length) {
    return json({ ok: false, emAndamento: true, error: "Já existe uma atualização das atas em andamento — aguarde 2 minutos." }, 409);
  }
  const { data: log } = await admin.from("processos_sync_log")
    .insert({ fonte: "atas", origem, usuario }).select("id").single();

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
  return {
    inicio,
    restante: () => TEMPO_MAX_MS - (Date.now() - inicio),
    avisos: [] as string[],
    filaDados: Promise.resolve() as Promise<unknown>,   // Dados Abertos: uma chamada por vez
  };
}

// ─── Rodada ──────────────────────────────────────────────────────────────────
async function sincronizar(admin, ctx) {
  const hoje = hojeManaus();
  const resumo = {
    pncp_atas: 0, novas: 0, alteradas: 0,
    novas_lista: [] as string[], vigencia: [] as string[], canceladas: [] as string[],
    itens_novos: 0, atas_com_itens_novos: 0, aguardando_itens: [] as string[],
    total_atas: 0, avisos: ctx.avisos,
  };

  // 1) PNCP: vigentes hoje + alteradas nos últimos 30 dias
  const doPncp = new Map<string, any>();
  let pncpRespondeu = false;
  for (const cnpj of CNPJS) {
    const base = { cnpj, codigoUnidadeAdministrativa: UASG };
    const vigentes = await paginarPncp(ctx, "/atas", { ...base, dataInicial: ymd(hoje), dataFinal: ymd(hoje) });
    const alteradas = await paginarPncp(ctx, "/atas/atualizacao", { ...base, dataInicial: ymd(somaDias(hoje, -DIAS_ALTERADAS)), dataFinal: ymd(hoje) });
    if (vigentes || alteradas) pncpRespondeu = true;
    for (const a of [...(vigentes || []), ...(alteradas || [])]) {
      if (String(a?.codigoUnidadeOrgao || "") !== UASG || !a.numeroAtaRegistroPreco || !a.anoAta) continue;
      const k = numeroAta(a);
      const ja = doPncp.get(k);
      if (!ja || String(a.dataAtualizacaoGlobal || "") >= String(ja.dataAtualizacaoGlobal || "")) doPncp.set(k, a);
    }
  }
  if (!pncpRespondeu) ctx.avisos.push("PNCP não respondeu: atas novas, prorrogações e cancelamentos ficam para a próxima rodada");
  resumo.pncp_atas = doPncp.size;

  // 2) Atas no banco: novas e o que mudou
  const banco = await lerTodos(admin, "atas_gap_mn", "id,numero_ata,situacao,tipo_uasg,vigencia_inicial,vigencia_final,link_pncp,numero_controle_pncp,objeto");
  const porNumero = new Map(banco.map((a) => [a.numero_ata, a]));
  const agora = new Date().toISOString();
  const novas = [], mudancas = [];
  for (const [num, p] of doPncp) {
    const b = porNumero.get(num);
    // Ata de outra UASG em que o GAP-MN participa pode ter o mesmo número: essa não é desta fonte
    if (b && /particip/i.test(b.tipo_uasg || "")) continue;
    const situacao = p.cancelado ? "Cancelada" : (!b?.situacao || /cancelad/i.test(b.situacao) ? "Ativa" : b.situacao);
    const campos = {
      vigencia_inicial: p.vigenciaInicio || null,
      vigencia_final: p.vigenciaFim || null,
      situacao,
      link_pncp: linkAta(p),
      numero_controle_pncp: p.numeroControlePNCPAta || null,
      objeto: String(p.objetoContratacao || "").replace(/\s+/g, " ").trim().slice(0, 2000) || null,
    };
    if (!b) {
      novas.push({ numero_ata: num, tipo_uasg: "Gerenciadora", ...campos, sync_em: agora });
      continue;
    }
    const mudou = CAMPOS.filter((c) => !igual(b[c], campos[c]));
    if (!mudou.length) continue;
    mudancas.push({ id: b.id, numero_ata: num, ...campos, sync_em: agora });
    if (mudou.includes("vigencia_final") && b.vigencia_final) resumo.vigencia.push(`${num}: ${b.vigencia_final} → ${campos.vigencia_final}`);
    if (situacao === "Cancelada" && !/cancelad/i.test(b.situacao || "")) resumo.canceladas.push(num);
  }
  for (let i = 0; i < novas.length; i += 300) {
    const { error } = await admin.from("atas_gap_mn").upsert(novas.slice(i, i + 300), { onConflict: "numero_ata", ignoreDuplicates: true });
    if (error) throw new Error("atas novas: " + error.message);
  }
  for (let i = 0; i < mudancas.length; i += 300) {
    const { error } = await admin.from("atas_gap_mn").upsert(mudancas.slice(i, i + 300), { onConflict: "id" });
    if (error) throw new Error("atas: " + error.message);
  }
  resumo.novas = novas.length;
  resumo.novas_lista = novas.map((a) => a.numero_ata).slice(0, 50);
  resumo.alteradas = mudancas.length;

  // 3) Itens das atas que ainda não têm (Dados Abertos)
  const comItens = new Set((await lerTodos(admin, "itens_ata_gap_mn", "ata_numero")).map((r) => r.ata_numero));
  const semItens = [...banco, ...novas].filter((a) =>
    !comItens.has(a.numero_ata) && !/particip/i.test(a.tipo_uasg || "") && /^\d{4}-\d{2}-\d{2}/.test(String(a.vigencia_inicial || "")));
  if (semItens.length) {
    const alvo = new Set(semItens.map((a) => a.numero_ata));
    const adesao = new Map([...doPncp].map(([k, p]) => [k, p.possibilidadeAdesao]));
    // Por ano de vigência inicial (janela curta: a base recusa ou demora com janelas longas)
    const porAno = new Map<string, string[]>();
    for (const a of semItens) {
      const d = String(a.vigencia_inicial).slice(0, 10);
      const ano = d.slice(0, 4);
      porAno.set(ano, [...(porAno.get(ano) || []), d]);
    }
    const linhas = [];
    for (const [, datas] of [...porAno].sort()) {
      if (ctx.restante() < 15_000) { ctx.avisos.push("tempo da rodada: parte dos itens fica para a próxima"); break; }
      datas.sort();
      try {
        const lista = await paginarDados(ctx, "/modulo-arp/2_consultarARPItem", {
          codigoUnidadeGerenciadora: UASG, dataVigenciaInicialMin: datas[0], dataVigenciaInicialMax: datas[datas.length - 1],
        });
        for (const i of lista) {
          if (i.itemExcluido || !alvo.has(String(i.numeroAtaRegistroPreco || ""))) continue;
          const linha = itemDaAta(i, adesao.get(i.numeroAtaRegistroPreco));
          if (linha) linhas.push(linha);
        }
      } catch (e: any) {
        ctx.avisos.push("Dados Abertos (itens): " + String(e?.message || e).slice(0, 120));
      }
    }
    // mesma chave do índice único (ata, item, fornecedor): a base às vezes repete
    const unicas = [...new Map(linhas.map((l) => [`${l.ata_numero}|${l.numero_ata}|${l.cnpj_fornecedor}`, l])).values()];
    for (let i = 0; i < unicas.length; i += 300) {
      const { error } = await admin.from("itens_ata_gap_mn")
        .upsert(unicas.slice(i, i + 300), { onConflict: "ata_numero,numero_ata,cnpj_fornecedor", ignoreDuplicates: true });
      if (error) throw new Error("itens: " + error.message);
    }
    const comNovos = new Set(unicas.map((l) => l.ata_numero));
    resumo.itens_novos = unicas.length;
    resumo.atas_com_itens_novos = comNovos.size;
    resumo.aguardando_itens = semItens.map((a) => a.numero_ata).filter((n) => !comNovos.has(n)).sort().slice(0, 60);
  }

  resumo.total_atas = banco.length + novas.length;
  return resumo;
}

// ─── Conversões ──────────────────────────────────────────────────────────────
// "00179" + 2025 → "00179/2025" (o formato do Contratos.gov.br, usado no banco)
function numeroAta(a) {
  return `${String(a.numeroAtaRegistroPreco).replace(/\D/g, "").padStart(5, "0")}/${a.anoAta}`;
}

// "00394429000100-1-000427/2025-000001" → https://pncp.gov.br/app/atas/00394429000100/2025/427/1
function linkAta(a) {
  const m = String(a.numeroControlePNCPAta || "").match(/^(\d{14})-\d+-(\d+)\/(\d{4})-(\d+)$/);
  return m ? `https://pncp.gov.br/app/atas/${m[1]}/${m[3]}/${Number(m[2])}/${Number(m[4])}` : null;
}

function fmtDoc(ni) {
  const d = String(ni || "").replace(/\D/g, "");
  if (d.length === 14) return d.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, "$1.$2.$3/$4-$5");
  if (d.length === 11) return d.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, "$1.$2.$3-$4");
  return d || null;
}

// Item da base pública → linha de itens_ata_gap_mn (mesmos campos que o bookmarklet grava)
function itemDaAta(i, possibilidadeAdesao) {
  const numeroItem = String(i.numeroItem || "").replace(/\D/g, "");
  if (!numeroItem) return null;
  const maximo = Number(i.maximoAdesao) || 0;
  const aceita = possibilidadeAdesao === true || possibilidadeAdesao === false ? possibilidadeAdesao : maximo > 0;
  return {
    ata_numero: String(i.numeroAtaRegistroPreco),
    numero_ata: numeroItem.padStart(5, "0"),
    descricao: String(i.descricaoItem || "").replace(/\s+/g, " ").trim() || null,
    cnpj_fornecedor: fmtDoc(i.niFornecedor),
    fornecedor_nome: String(i.nomeRazaoSocialFornecedor || "").trim() || null,
    quantidade_registrada: num(i.quantidadeHomologadaVencedor) ?? num(i.quantidadeHomologadaItem),
    valor_unitario: num(i.valorUnitario),
    valor_total: num(i.valorTotal),
    qtd_limite_adesao: maximo > 0 ? Math.round(maximo) : null,
    aceita_adesao: aceita ? "Sim" : "Não",
    numero_compra: i.numeroCompra && i.anoCompra ? `${i.numeroCompra}/${i.anoCompra}` : null,
  };
}

const num = (v) => (v === null || v === undefined || v === "" || isNaN(Number(v)) ? null : Number(v));

function hojeManaus() {
  const d = new Date(Date.now() - 4 * 3600e3);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}
const somaDias = (d, n) => new Date(d.getTime() + n * DIA);
const ymd = (d) => d.toISOString().slice(0, 10).replace(/-/g, "");

function igual(a, b) {
  if (a == null && b == null) return true;
  if (a == null || b == null) return false;
  if (/^\d{4}-\d{2}-\d{2}/.test(String(a)) && /^\d{4}-\d{2}-\d{2}/.test(String(b))) return String(a).slice(0, 10) === String(b).slice(0, 10);
  return String(a) === String(b);
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

// ─── HTTP ────────────────────────────────────────────────────────────────────
async function pedir(ctx, url, { tentativas = 3, timeoutMs = 45_000 } = {}) {
  let ultimo = "";
  for (let t = 1; t <= tentativas; t++) {
    const ctl = new AbortController();
    const tm = setTimeout(() => ctl.abort(), Math.min(timeoutMs, Math.max(5_000, ctx.restante())));
    try {
      const r = await fetch(url, { headers: { accept: "application/json", "user-agent": "GAPMN-Atas/1.0" }, signal: ctl.signal });
      if (r.status === 204 || r.status === 404) return null;
      if (r.status === 429) {
        const s = Number((((await r.text()) || "").match(/(\d+)\s*second/) || [])[1] || 20);
        if (ctx.restante() < (s + 6) * 1000) throw new Error("429: limite de consultas da API — continua na próxima rodada");
        await dormir((s + 1) * 1000);
        continue;
      }
      if (r.status >= 500) { ultimo = "HTTP " + r.status; await dormir(800 * t); continue; }
      if (!r.ok) throw new Error(`HTTP ${r.status} em ${url.replace(/^https:\/\/[^/]+/, "").slice(0, 90)}`);
      const txt = await r.text();
      return txt.trim() ? JSON.parse(txt) : null;
    } catch (e: any) {
      ultimo = e?.name === "AbortError" ? "sem resposta (tempo esgotado)" : String(e?.message || e);
      if (t === tentativas || /^429|HTTP 4/.test(ultimo) || ctx.restante() < 8_000) throw new Error(ultimo);
      await dormir(700 * t);
    } finally { clearTimeout(tm); }
  }
  throw new Error(ultimo || "sem resposta");
}

// Consulta do PNCP em páginas de 500 (as vigentes do GAP-MN cabem numa só). null = não respondeu.
async function paginarPncp(ctx, caminho, params) {
  const out = [];
  for (let pg = 1; pg <= 10; pg++) {
    const qs = new URLSearchParams(Object.entries({ ...params, pagina: pg, tamanhoPagina: 500 }).map(([k, v]) => [k, String(v)])).toString();
    let r;
    try { r = await pedir(ctx, `${PNCP_CONSULTA}${caminho}?${qs}`, { tentativas: 2, timeoutMs: 60_000 }); }
    catch (e: any) {
      ctx.avisos.push(`PNCP ${caminho} (${params.cnpj}): ${String(e?.message || e).slice(0, 100)}`);
      return pg === 1 ? null : out;
    }
    const lista = Array.isArray(r?.data) ? r.data : [];
    out.push(...lista);
    if (!lista.length || !r.totalPaginas || pg >= r.totalPaginas) break;
  }
  return out;
}

// Dados Abertos limita as consultas: uma por vez, com intervalo
function pedirDados(ctx, url) {
  const vez = ctx.filaDados.then(() => dormir(400)).then(() => pedir(ctx, url));
  ctx.filaDados = vez.catch(() => {});
  return vez;
}

async function paginarDados(ctx, caminho, params) {
  const out = [];
  for (let pg = 1; pg <= 40; pg++) {
    if (ctx.restante() < 10_000) { ctx.avisos.push("tempo da rodada: itens incompletos, continua na próxima"); break; }
    const qs = new URLSearchParams(Object.entries({ ...params, pagina: pg, tamanhoPagina: 500 }).map(([k, v]) => [k, String(v)])).toString();
    const r = await pedirDados(ctx, `${DADOS}${caminho}?${qs}`);
    const lista = Array.isArray(r?.resultado) ? r.resultado : [];
    out.push(...lista);
    if (!lista.length || !r.totalPaginas || pg >= r.totalPaginas) break;
  }
  return out;
}

const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { ...CORS, "Content-Type": "application/json" } });
}
