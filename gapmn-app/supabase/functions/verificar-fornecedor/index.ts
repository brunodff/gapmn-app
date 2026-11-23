// @ts-nocheck
/**
 * Edge Function: verificar-fornecedor (nov/2026)
 *
 * Verificação do fornecedor para o Robô de Empenhos, só em fontes públicas, pelo CNPJ:
 *   - sanções do Portal da Transparência: CEIS, CNEP e CEPIM (da filial e da matriz);
 *   - cadastro no Compras.gov.br (SICAF): ativo e habilitado a licitar (API de Dados Abertos);
 *   - situação cadastral na Receita Federal (BrasilAPI; reserva: Minha Receita).
 * Substitui o servidor MCP Compras (mcp-compras.up.railway.app), que saiu do ar em nov/2026. Devolve o mesmo
 * formato que o robô lia dele: { perfil: { receita_federal, cadastro, impedimentos_comprasnet }, sancoes:
 * { detalhamento: { ceis, cnep, cepim }, fontes_com_erro } }. O robô só AVISA: nunca impede o empenho.
 * Os impedimentos de licitar registrados no Compras.gov.br chegam ao CEIS; não há consulta pública separada.
 *
 * POST { cnpj } — chamada pela extensão com a chave pública (verify_jwt ligado). Deploy:
 *   supabase functions deploy verificar-fornecedor --project-ref <ref> --use-api
 * Secret: TRANSPARENCIA_API_KEY (a mesma da obs-transparencia).
 */
import { corsHeaders } from "../_shared/cors.ts";
import { cepimComOrgao, cnpjDaMatriz, juntarSancoes, situacaoReceita } from "../_shared/fornecedor.ts";

const PORTAL = "https://api.portaldatransparencia.gov.br/api-de-dados";
const CHAVE = Deno.env.get("TRANSPARENCIA_API_KEY") ?? "";
const DADOS_ABERTOS = "https://dadosabertos.compras.gov.br";
const FONTES_CNPJ = ["https://brasilapi.com.br/api/cnpj/v1/", "https://minhareceita.org/"];
const UA = "GAPMN-App/1.0 (gapmn.app; dados publicos)";
const SEIS_HORAS = 6 * 3600 * 1000;

// a mesma revisão costuma verificar o mesmo fornecedor várias vezes: guarda o resultado na memória da função
const guardados = new Map<string, { ate: number; corpo: unknown }>();

const resposta = (corpo: unknown, status = 200) =>
  new Response(JSON.stringify(corpo), { status, headers: { ...corsHeaders, "content-type": "application/json; charset=utf-8" } });

/** GET JSON com até 3 tentativas (429 e 5xx esperam e repetem); 404 = null */
async function getJson(url: string, headers: Record<string, string> = {}, ms = 20_000): Promise<any> {
  let ultimo = "";
  for (let t = 1; t <= 3; t++) {
    try {
      const r = await fetch(url, { headers: { accept: "application/json", "user-agent": UA, ...headers }, signal: AbortSignal.timeout(ms) });
      if (r.ok) return await r.json();
      if (r.status === 404) return null;
      if (r.status < 500 && r.status !== 429) throw Object.assign(new Error(`respondeu ${r.status}`), { definitivo: true });
      ultimo = `respondeu ${r.status}`;
    } catch (e) {
      if (e?.definitivo) throw e;
      ultimo = e?.name === "TimeoutError" ? "demorou demais" : "não respondeu";
    }
    await new Promise((ok) => setTimeout(ok, 1000 * t * t));
  }
  throw new Error(ultimo);
}

async function receita(cnpj: string) {
  for (const fonte of FONTES_CNPJ) {
    try {
      const s = situacaoReceita(await getJson(fonte + cnpj, {}, 15_000));
      if (s) return s;
    } catch { /* tenta a próxima fonte */ }
  }
  throw new Error("cadastro de CNPJ fora do ar");
}

async function cadastroComprasGov(cnpj: string) {
  const j = await getJson(`${DADOS_ABERTOS}/modulo-fornecedor/1_consultarFornecedor?pagina=1&tamanhoPagina=10&cnpj=${cnpj}`);
  return j?.resultado?.[0] ?? null;
}

async function listaDoPortal(lista: "ceis" | "cnep" | "cepim", cnpjs: string[]) {
  if (!CHAVE) throw new Error("chave da API do Portal da Transparência não configurada");
  const param = lista === "cepim" ? "cnpjSancionado" : "codigoSancionado";
  const listas = [];
  for (const c of cnpjs) listas.push((await getJson(`${PORTAL}/${lista}?${param}=${c}&pagina=1`, { "chave-api-dados": CHAVE })) ?? []);
  const juntas = juntarSancoes(listas);
  return lista === "cepim" ? juntas.map(cepimComOrgao) : juntas;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return resposta({ erro: "Use POST." }, 405);
  let cnpj = "";
  try { cnpj = String((await req.json())?.cnpj ?? "").replace(/\D/g, ""); } catch { /* corpo inválido */ }
  if (cnpj.length !== 14) return resposta({ erro: "Informe o CNPJ (14 dígitos)." }, 400);

  const g = guardados.get(cnpj);
  if (g && g.ate > Date.now()) return resposta(g.corpo);

  const cnpjs = [cnpj, cnpjDaMatriz(cnpj)].filter(Boolean) as string[];
  const [rec, cad, ceis, cnep, cepim] = await Promise.allSettled([
    receita(cnpj), cadastroComprasGov(cnpj), listaDoPortal("ceis", cnpjs), listaDoPortal("cnep", cnpjs), listaDoPortal("cepim", cnpjs),
  ]);
  const fontes_com_erro: Record<string, string> = {};
  const valor = <T>(nome: string, r: PromiseSettledResult<T>, padrao: T) => {
    if (r.status === "fulfilled") return r.value;
    fontes_com_erro[nome] = String(r.reason?.message ?? r.reason);
    return padrao;
  };
  const corpo = {
    perfil: {
      ...(rec.status === "fulfilled" ? { receita_federal: rec.value } : {}),
      cadastro: valor("sicaf", cad, null),
      impedimentos_comprasnet: [],
    },
    sancoes: {
      detalhamento: { ceis: valor("ceis", ceis, []), cnep: valor("cnep", cnep, []), cepim: valor("cepim", cepim, []) },
      fontes_com_erro,
    },
    consultado_em: new Date().toISOString(),
  };
  // só guarda a consulta completa: com fonte fora do ar, a próxima tenta de novo
  if (!Object.keys(fontes_com_erro).length && rec.status === "fulfilled") guardados.set(cnpj, { ate: Date.now() + SEIS_HORAS, corpo });
  return resposta(corpo);
});
