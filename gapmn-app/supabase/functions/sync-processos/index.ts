// @ts-nocheck
/**
 * Edge Function: sync-processos
 *
 * Busca processos licitatórios da UASG 120630 via API pública do governo
 * (dadosabertos.compras.gov.br) e sincroniza na tabela processos_licitatorios.
 *
 * Deploy:
 *   supabase functions deploy sync-processos --no-verify-jwt
 *
 * Teste local:
 *   supabase functions serve sync-processos
 *   curl -X POST http://localhost:54321/functions/v1/sync-processos
 *
 * Nota: Este arquivo roda no runtime Deno do Supabase.
 * O VS Code pode mostrar erros de importação sem a extensão Deno — isso é esperado.
 * O código funciona corretamente quando implantado no Supabase.
 *
 * Nota de timeout: ~45 chamadas à API + paginação + lookups de resultado ≈ 40–80 segundos.
 * Planos pagos do Supabase suportam até 150s — recomendado para este caso.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// ─── Configuração ──────────────────────────────────────────────────────────
const UASG        = 120630;
const ANOS        = [2024, 2025, 2026];
const PAGE_SIZE   = 500;
const BASE_URL    = "https://dadosabertos.compras.gov.br";
const PNCP_MODS   = [1, 2, 3, 4, 5, 6, 7, 12, 20, 22, 33, 44, 57];
const OBJ_MAX_LEN = 600;
const SLEEP_MS    = 80;

const CORS = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// ─── Tipos ─────────────────────────────────────────────────────────────────
interface ProcessoRow {
  chave:                 string;
  fonte:                 string;
  ano:                   number;
  modalidade:            string | null;
  numero_processo:       string | null;
  objeto:                string | null;
  data_publicacao:       string | null;
  abertura_proposta:     string | null;
  encerramento_proposta: string | null;
  valor_estimado:        number | null;
  valor_homologado:      number | null;
  situacao_api:          string | null;
  link_sistema:          string | null;
  srp:                   boolean | null;
  ultima_sync:           string;
}

// ─── Handler principal ─────────────────────────────────────────────────────
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: CORS });
  }

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    console.log("Iniciando sync UASG", UASG);
    const rows = await coletarProcessos();
    console.log("Total coletado:", rows.length);

    if (rows.length === 0) {
      return json({ ok: false, error: "Nenhum processo encontrado na API." }, 404);
    }

    const syncAt = new Date().toISOString();
    const upsertRows = rows.map((r) => ({ ...r, ultima_sync: syncAt }));

    // Upsert em lotes de 200
    let upserted = 0;
    for (let i = 0; i < upsertRows.length; i += 200) {
      const batch = upsertRows.slice(i, i + 200);
      const { error } = await supabase
        .from("processos_licitatorios")
        .upsert(batch, { onConflict: "chave" });
      if (error) throw error;
      upserted += batch.length;
    }

    console.log("Upserted:", upserted);
    return json({ ok: true, total: upserted, synced_at: syncAt });
  } catch (err: any) {
    console.error(err);
    return json({ ok: false, error: err.message }, 500);
  }
});

// ─── Coleta via API ────────────────────────────────────────────────────────
async function coletarProcessos(): Promise<ProcessoRow[]> {
  const seen = new Set<string>();

  // Paralleliza por ano para reduzir tempo total
  const porAno = await Promise.all(ANOS.map((ano) => coletarAno(ano)));

  const todos: ProcessoRow[] = [];
  for (const rows of porAno) {
    for (const r of rows) {
      if (seen.has(r.chave)) continue;
      seen.add(r.chave);
      todos.push(r);
    }
  }

  console.log("Total coletado (deduplicado):", todos.length);
  return todos;
}

async function coletarAno(ano: number): Promise<ProcessoRow[]> {
  const rows: ProcessoRow[] = [];
  const de  = `${ano}-01-01`;
  const ate = `${ano}-12-31`;

  // 1) LEGADO LICITAÇÕES
  try {
    const licit = await fetchPages("/modulo-legado/1_consultarLicitacao", {
      uasg: UASG, data_publicacao_inicial: de, data_publicacao_final: ate,
    });
    for (const r of licit) {
      const k = buildChaveLegado("LICIT", r);
      rows.push(transformLicit(k, ano, r));
    }
    console.log(`Legado Licit ${ano}: ${licit.length}`);
  } catch (e) { console.error(`Legado Licit ${ano}:`, e); }

  // 2) LEGADO PREGÕES
  try {
    const preg = await fetchPages("/modulo-legado/3_consultarPregoes", {
      co_uasg: UASG, dt_data_edital_inicial: de, dt_data_edital_final: ate,
    });
    for (const r of preg) {
      const k = buildChaveLegado("PREGAO", r);
      rows.push(transformPregao(k, ano, r));
    }
    console.log(`Legado Pregao ${ano}: ${preg.length}`);
  } catch (e) { console.error(`Legado Pregao ${ano}:`, e); }

  // 3) PNCP 14.133 — todas as modalidades em paralelo
  const pncpResults = await Promise.allSettled(
    PNCP_MODS.map(async (modal) => {
      await sleep(SLEEP_MS * (PNCP_MODS.indexOf(modal) % 4));
      const pncp = await fetchPages(
        "/modulo-contratacoes/1_consultarContratacoes_PNCP_14133",
        {
          unidadeOrgaoCodigoUnidade: String(UASG),
          dataPublicacaoPncpInicial: de,
          dataPublicacaoPncpFinal:   ate,
          codigoModalidade:          modal,
        },
      );
      if (pncp.length) console.log(`PNCP mod=${modal} ${ano}: ${pncp.length}`);
      return pncp.map((r: any) => {
        // FIX: chave estável — prioriza numeroControlePNCP (formato CNPJ-ano-seq, imutável)
        const k = buildChavePNCP(r);
        return transformPNCP(k, ano, r);
      });
    })
  );

  const pncpRows: ProcessoRow[] = [];
  for (const res of pncpResults) {
    if (res.status === "fulfilled") pncpRows.push(...res.value);
  }

  // FIX: enriquecer processos PNCP sem situação/valor_homologado via endpoint de resultado
  const enriquecidos = await enriquecerResultados(pncpRows);
  rows.push(...enriquecidos);

  return rows;
}

// ─── FIX: chaves estáveis ──────────────────────────────────────────────────

function buildChavePNCP(r: any): string {
  // numeroControlePNCP é o identificador canônico do PNCP (formato: CNPJ-ano-seq)
  // idCompra é interno do dadosabertos e pode variar entre syncs
  const id = r.numeroControlePNCP || r.idCompra;
  if (id) return `PNCP:${String(id).trim()}`;
  // fallback determinístico: usa CNPJ + ano + sequencial se disponíveis
  const cnpj = r.cnpjOrgao || r.cnpj || "";
  const anoC = r.anoCompraPncp || r.anoCompra || "";
  const seq  = r.numeroCompra  || r.sequencialCompra || "";
  if (cnpj && anoC && seq) return `PNCP:${cnpj}-${anoC}-${seq}`;
  // último recurso: hash dos campos-chave (evita UUID aleatório que quebra upsert)
  return `PNCP:fallback:${cnpj}:${anoC}:${seq}:${r.modalidadeId || ""}`;
}

function buildChaveLegado(tipo: "LICIT" | "PREGAO", r: any): string {
  const id = r.id_compra || r.numero_aviso || r.co_processo || r.numero || r.nu_pregao;
  if (id) return `${tipo}:${String(id).trim()}`;
  return `${tipo}:fallback:${r.uasg || r.co_uasg || ""}:${r.data_publicacao || r.dt_data_edital || ""}`;
}

// ─── FIX: enriquecimento via endpoint de resultado ─────────────────────────

// Status considerados finais — não precisam de lookup
function statusFinal(sit: string): boolean {
  return (
    sit.includes("homolog") || sit.includes("adjudic") ||
    sit.includes("revogad") || sit.includes("anulad")  ||
    sit.includes("conclu")  || sit.includes("finaliz") ||
    sit.includes("deserta") || sit.includes("fracas")
  );
}

async function enriquecerResultados(rows: ProcessoRow[]): Promise<ProcessoRow[]> {
  // Busca status atual para TODO processo sem status final confirmado
  // dadosabertos.compras.gov.br tem lag — "Divulgada no PNCP" pode já ser Homologada/Revogada
  const precisaLookup = rows.filter((r) => {
    if (r.valor_homologado !== null) return false;
    const sit = (r.situacao_api || "").toLowerCase();
    return !statusFinal(sit);
  });

  console.log(`Buscando status atual para ${precisaLookup.length} processos PNCP...`);

  // Lotes de 8 para não sobrecarregar o pncp.gov.br
  const LOTE = 8;
  for (let i = 0; i < precisaLookup.length; i += LOTE) {
    const lote = precisaLookup.slice(i, i + LOTE);
    await Promise.allSettled(lote.map(async (proc) => {
      try {
        const resultado = await fetchStatusAtualPNCP(proc.chave);
        if (!resultado) return;
        const original = rows.find((r) => r.chave === proc.chave);
        if (!original) return;
        // Prioriza campo do portal PNCP; dadosabertos usa "NomePncp" sufixo
        const sit = resultado.situacaoCompraNomePncp || resultado.situacaoCompraNome || null;
        if (sit) original.situacao_api = sit;
        const vlHom = resultado.valorTotalHomologado ?? resultado.valorHomologadoTotal ?? null;
        if (vlHom != null) original.valor_homologado = toNumber(vlHom);
        const vlEst = resultado.valorTotalEstimado ?? resultado.valorEstimadoTotal ?? null;
        if (vlEst != null && original.valor_estimado == null) original.valor_estimado = toNumber(vlEst);
      } catch (e) {
        console.warn(`Status lookup falhou para ${proc.chave}:`, e);
      }
    }));
    if (i + LOTE < precisaLookup.length) await sleep(300);
  }

  return rows;
}

async function fetchStatusAtualPNCP(chave: string): Promise<any | null> {
  const raw = chave.replace(/^PNCP:/, "");

  // numeroControlePNCP formato real do dadosabertos:
  // "{CNPJ14}-{codigoUnidade}-{sequencial6}/{ano4}"
  // Ex: "00394429018824-1-000047/2024"
  const matchPNCP = raw.match(/^(\d{14})-(\d+)-(\d+)\/(\d{4})$/);
  if (matchPNCP) {
    const [, cnpj, , seqStr, ano] = matchPNCP;
    const seqNum = parseInt(seqStr, 10);

    // 1) Tenta API do portal PNCP (fonte autoritativa)
    for (const urlPortal of [
      `https://pncp.gov.br/api/pncp/v1/orgaos/${cnpj}/compras/${ano}/${seqNum}`,
      `https://pncp.gov.br/api/pncp/v1/orgaos/${cnpj}/compras/${ano}/${seqStr}`,
    ]) {
      try {
        const res = await fetch(urlPortal, {
          headers: { accept: "application/json", "User-Agent": "GAPMN-Sync/1.0" },
        });
        if (res.ok) {
          const data = await res.json();
          const item = Array.isArray(data) ? data[0] : data;
          if (item?.situacaoCompraNomePncp || item?.situacaoCompraNome) return item;
        }
        if (res.status === 404) break; // não existe nesse formato
      } catch { /* fallthrough */ }
    }
    await sleep(150);
  }

  // 2) Fallback: dadosabertos com o numeroControlePNCP completo
  const urlDados = `${BASE_URL}/modulo-contratacoes/1_consultarContratacao_PNCP_14133?numeroControlePNCP=${encodeURIComponent(raw)}`;
  try {
    const res = await fetch(urlDados, { headers: { accept: "application/json" } });
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data?.resultado) && data.resultado.length > 0) return data.resultado[0];
      if (data?.situacaoCompraNomePncp) return data;
    }
  } catch {}

  return null;
}

// ─── Transformadores ───────────────────────────────────────────────────────
function transformLicit(chave: string, ano: number, r: any): ProcessoRow {
  const num = r.numero_aviso || r.numero || "";
  const numero = String(num).includes("/")
    ? String(num).trim()
    : num ? `${num}/${ano}` : "";
  return {
    chave, fonte: "LEGADO_LICITACAO", ano,
    modalidade:            r.nome_modalidade || r.modalidade || null,
    numero_processo:       numero || null,
    objeto:                truncate(r.objeto || r.tx_objeto || ""),
    data_publicacao:       parseDate(r.data_publicacao),
    abertura_proposta:     parseDate(r.dt_inicio_proposta || r.dataAberturaProposta),
    encerramento_proposta: parseDate(r.dt_encerramento_proposta || r.dataEncerramentoProposta),
    valor_estimado:        toNumber(r.valor_estimado_total || r.valorEstimadoTotal),
    valor_homologado:      toNumber(r.valor_homologado_total || r.valorTotalHomologado),
    situacao_api:          r.situacao_aviso || r.situacao || null,
    link_sistema:          r.linkSistemaOrigem || r.link_sistema_origem || null,
    srp:                   null,
    ultima_sync:           new Date().toISOString(),
  };
}

function transformPregao(chave: string, ano: number, r: any): ProcessoRow {
  const n = r.numero || r.nu_pregao || "";
  return {
    chave, fonte: "LEGADO_PREGAO", ano,
    modalidade:            r.ds_tipo_pregao || r.tipo_pregao || null,
    numero_processo:       n ? `${n}/${ano}` : null,
    objeto:                truncate(r.tx_objeto || r.objeto || ""),
    data_publicacao:       parseDate(r.dt_data_edital || r.dt_portaria),
    abertura_proposta:     parseDate(r.dt_inicio_proposta || r.dataAberturaProposta),
    encerramento_proposta: parseDate(r.dt_encerramento_proposta || r.dataEncerramentoProposta),
    valor_estimado:        toNumber(r.valor_estimado_total || r.valorEstimadoTotal),
    valor_homologado:      toNumber(r.valor_homologado_total || r.valorTotalHomologado),
    situacao_api:          r.ds_situacao_pregao || r.situacao || null,
    link_sistema:          r.linkSistemaOrigem || r.link_sistema_origem || null,
    srp:                   null,
    ultima_sync:           new Date().toISOString(),
  };
}

function transformPNCP(chave: string, ano: number, r: any): ProcessoRow {
  const n    = r.numeroCompra    || r.numeroCompraPncp || "";
  const anoC = r.anoCompraPncp   || r.anoCompra        || ano;
  const srpRaw = r.srp ?? r.registroPrecos ?? r.sistemasDeRegistroDePrecos ?? null;
  const srp = srpRaw === true || srpRaw === "true" || srpRaw === 1 ? true
            : srpRaw === false || srpRaw === "false" || srpRaw === 0 ? false
            : null;
  return {
    chave, fonte: "PNCP_14133", ano,
    modalidade:            r.modalidadeNome || r.modalidadeNomePncp || null,
    numero_processo:       n ? `${String(n).trim()}/${String(anoC).trim()}` : null,
    objeto:                truncate(r.objetoCompra || r.objeto || ""),
    data_publicacao:       parseDate(r.dataPublicacaoPncp),
    abertura_proposta:     parseDate(r.dataAberturaProposta || r.dt_inicio_proposta),
    encerramento_proposta: parseDate(r.dataEncerramentoProposta || r.dt_encerramento_proposta),
    valor_estimado:        toNumber(r.valorTotalEstimado  || r.valorEstimadoTotal),
    valor_homologado:      toNumber(r.valorTotalHomologado || r.valorHomologadoTotal),
    situacao_api:          r.situacaoCompraNomePncp || r.situacaoCompra || null,
    link_sistema:          r.linkSistemaOrigem || r.link_sistema_origem || null,
    srp,
    ultima_sync:           new Date().toISOString(),
  };
}

// ─── Paginação HTTP ────────────────────────────────────────────────────────
async function fetchPages(
  endpoint: string,
  params: Record<string, string | number>,
): Promise<any[]> {
  const out: any[] = [];
  let page = 1;

  while (true) {
    const qs = new URLSearchParams(
      Object.fromEntries(
        [...Object.entries(params), ["pagina", page], ["tamanhoPagina", PAGE_SIZE]]
          .map(([k, v]) => [k, String(v)]),
      ),
    ).toString();

    const url = `${BASE_URL}${endpoint}?${qs}`;

    let data: any = null;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const res = await fetch(url, { headers: { accept: "application/json" } });
        if (res.status === 429 || res.status >= 500) { await sleep(400 * attempt); continue; }
        if (!res.ok) break;
        data = await res.json();
        break;
      } catch { await sleep(200 * attempt); }
    }

    if (!data) break;

    const resultado: any[] = Array.isArray(data?.resultado) ? data.resultado : [];
    out.push(...resultado);

    if (!resultado.length)                                     break;
    if (data.totalPaginas    && page >= data.totalPaginas)    break;
    if (!data.totalPaginas   && data.paginasRestantes === 0)  break;

    page++;
    await sleep(SLEEP_MS);
  }

  return out;
}

// ─── Helpers ───────────────────────────────────────────────────────────────
function parseDate(v: any): string | null {
  if (!v) return null;
  const m = String(v).match(/(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : String(v).slice(0, 10) || null;
}

function toNumber(v: any): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return isNaN(n) ? null : n;
}

function truncate(s: string): string {
  const c = String(s || "").replace(/\s+/g, " ").trim();
  return c.length > OBJ_MAX_LEN ? c.slice(0, OBJ_MAX_LEN - 3) + "..." : c;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}
