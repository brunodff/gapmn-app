// @ts-nocheck
/**
 * Edge Function: obs-transparencia
 * Ordens Bancárias emitidas por uma Unidade Gestora, pela API do Portal da
 * Transparência (/api-de-dados/despesas/documentos, fase 3 = pagamento).
 * Usada pela extensão "Anexador de Ordens Bancárias SILOMS" no lugar do e-mail
 * do Tesouro Gerencial → Google Sheets.
 *
 * POST JSON:
 *   { ug: "120630", gestao?: "00001", dataInicio: "AAAA-MM-DD", dataFim: "AAAA-MM-DD" }
 *   → { obs: [...], dias: [...], incompleto?: { proximaData } }
 *
 * A API aceita só UM dia por consulta (e pagina o resultado): esta função percorre
 * os dias do período, no máximo 10 por chamada — a extensão chama de novo a
 * partir de `incompleto.proximaData` quando o prazo da função aperta.
 *
 * A API NÃO traz banco/agência/conta do favorecido (sigilo bancário).
 *
 * OB paga a um intermediário (boleto/fatura: a OB vai ao Banco do Brasil, que paga a
 * "Lista de Faturas"): o favorecido do documento é o banco. Para essas OBs — marcadas
 * com favorecidoListaFaturas/favorecidoIntermediario OU pagas a banco, porque a marca
 * falta em parte delas — quem recebeu de fato é o favorecido do(s) empenho(s) da OB
 * (documentos-relacionados → documentos/{NE}), devolvido em `favorecidosFinais`.
 * O endpoint favorecidos-finais-por-documento volta vazio para essas OBs (testado em
 * out/2026 com OBs de julho a setembro), por isso não é usado.
 *
 * Deploy (com verificação de JWT — a extensão manda a chave anon):
 *   supabase functions deploy obs-transparencia
 * Secret (cadastro gratuito em portaldatransparencia.gov.br/api-de-dados/cadastrar-email):
 *   supabase secrets set TRANSPARENCIA_API_KEY=<chave>
 */

import { corsHeaders } from "../_shared/cors.ts";

const API = "https://api.portaldatransparencia.gov.br/api-de-dados/despesas";
const CHAVE = Deno.env.get("TRANSPARENCIA_API_KEY") ?? "";
const MAX_DIAS = 10;
const PRAZO_MS = 110_000;          // a função tem ~150 s; sobra para responder
const INTERVALO_MS = 700;          // ~85 consultas/min, abaixo do limite do Portal
const MAX_PAGINAS_DIA = 40;
// Bancos que recebem OB de boleto/fatura em nome do credor (raiz do CNPJ)
const RAIZES_BANCO = new Set(["00000000" /* Banco do Brasil */, "00360305" /* Caixa */]);

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

const dorme = (ms: number) => new Promise((r) => setTimeout(r, ms));
const dataBR = (iso: string) => iso.split("-").reverse().join("/");     // AAAA-MM-DD → DD/MM/AAAA
function proximoDia(iso: string) {
  const d = new Date(iso + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}
// "2.331,96" | "2331.96" | "2331,96" → número
function numero(v: unknown) {
  const t = String(v ?? "").trim();
  if (!t) return 0;
  return t.includes(",") ? parseFloat(t.replace(/\./g, "").replace(",", ".")) : parseFloat(t);
}

// Cache em memória enquanto a instância estiver viva: dia antigo muda pouco
const cache = new Map<string, { ts: number; docs: any[] }>();
function validade(iso: string) {
  const dias = (Date.now() - new Date(iso + "T12:00:00Z").getTime()) / 86_400_000;
  return dias > 10 ? 6 * 3_600_000 : 20 * 60_000;
}

let ultimaConsulta = 0;
async function consultar(caminho: string, params: URLSearchParams) {
  for (let tentativa = 0; tentativa < 4; tentativa++) {
    const espera = ultimaConsulta + INTERVALO_MS - Date.now();
    if (espera > 0) await dorme(espera);
    ultimaConsulta = Date.now();
    const res = await fetch(`${API}/${caminho}?${params}`, { headers: { "chave-api-dados": CHAVE, Accept: "application/json" } });
    if (res.status === 429 || res.status >= 500) { await dorme(4000 * (tentativa + 1)); continue; }
    if (res.status === 401 || res.status === 403) throw new Error("Chave da API do Portal da Transparência inválida ou não autorizada");
    if (!res.ok) throw new Error(`Portal da Transparência respondeu HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
    return await res.json();   // lista nas consultas, objeto no detalhe (documentos/{codigo})
  }
  throw new Error("Portal da Transparência indisponível (muitas tentativas)");
}

/** Todos os documentos de pagamento do dia (todas as páginas). */
async function documentosDoDia(ug: string, gestao: string, iso: string) {
  const chave = `${ug}|${gestao}|${iso}`;
  const c = cache.get(chave);
  if (c && Date.now() - c.ts < validade(iso)) return c.docs;
  const docs: any[] = [];
  for (let pagina = 1; pagina <= MAX_PAGINAS_DIA; pagina++) {
    const params = new URLSearchParams({ unidadeGestora: ug, gestao, dataEmissao: dataBR(iso), fase: "3", pagina: String(pagina) });
    const lote = lista(await consultar("documentos", params));
    if (!lote.length) break;
    docs.push(...lote);
  }
  cache.set(chave, { ts: Date.now(), docs });
  return docs;
}

const lista = (x: any) => (Array.isArray(x) ? x : []);

function pagaABanco(o: any) {
  return RAIZES_BANCO.has(String(o.favorecidoCodigo).replace(/\D/g, "").slice(0, 8));
}

/** Favorecido (código e nome) de um empenho — vários pagamentos usam o mesmo. */
const cacheEmpenho = new Map<string, { codigo: string; nome: string } | null>();
async function favorecidoDoEmpenho(codigo: string) {
  if (cacheEmpenho.has(codigo)) return cacheEmpenho.get(codigo);
  const d = await consultar(`documentos/${codigo}`, new URLSearchParams());
  const r = d && !Array.isArray(d) ? { codigo: String(d.codigoFavorecido ?? ""), nome: String(d.nomeFavorecido ?? d.favorecido ?? "") } : null;
  cacheEmpenho.set(codigo, r);
  return r;
}

/** Quem recebeu de fato uma OB paga a banco: o(s) favorecido(s) do(s) empenho(s) dela. */
const cacheFinais = new Map<string, { ts: number; finais: any[] }>();
async function favorecidosFinais(o: any) {
  const c = cacheFinais.get(o.documento);
  if (c && Date.now() - c.ts < 6 * 3_600_000) return c.finais;
  const rel = lista(await consultar("documentos-relacionados", new URLSearchParams({ codigoDocumento: o.documento, fase: "3" })));
  const finais: any[] = [];
  for (const e of rel) {
    if (!/empenho/i.test(String(e.fase ?? "")) || !e.documento) continue;
    const fav = await favorecidoDoEmpenho(String(e.documento));
    const codigo = fav?.codigo ?? "";
    const nome = (fav?.nome || String(e.favorecido ?? "")).trim();
    if (!codigo && !nome) continue;
    const empenho = String(e.documentoResumido ?? e.documento);
    const ja = finais.find((f) => (codigo && f.codigo === codigo) || f.nome === nome);
    if (ja) { if (!ja.empenhos.includes(empenho)) ja.empenhos.push(empenho); continue; }
    finais.push({ codigo, nome, empenhos: [empenho] });
  }
  // O próprio banco como credor (tarifa, p.ex.): não houve intermediário
  const outros = finais.filter((f) => f.codigo !== o.favorecidoCodigo);
  cacheFinais.set(o.documento, { ts: Date.now(), finais: outros });
  return outros;
}

/** Só Ordens Bancárias (fase 3 também traz DARF, GPS, GRU…), no formato da extensão. */
function paraOB(d: any, ug: string, gestao: string, iso: string) {
  const doc = String(d.documento ?? "");
  const resumido = String(d.documentoResumido ?? "");
  const ob = (/(\d{4}OB\d{6})/i.exec(resumido) ?? /(\d{4}OB\d{6})/i.exec(doc))?.[1]?.toUpperCase();
  if (!ob) return null;
  return {
    ug: String(d.codigoUg ?? ug),
    unidade: String(d.ug ?? ""),
    gestao,
    data: d.data ? String(d.data) : dataBR(iso),
    documento: doc || ob,
    ob,
    observacao: String(d.observacao ?? ""),
    favorecidoCodigo: String(d.codigoFavorecido ?? ""),
    favorecidoNome: String(d.nomeFavorecido ?? d.favorecido ?? ""),
    valor: numero(d.valor),
    numeroProcesso: String(d.numeroProcesso ?? ""),
    elemento: String(d.elemento ?? ""),
    intermediario: !!(d.favorecidoListaFaturas || d.favorecidoIntermediario),   // marca do Portal (falta em parte)
  };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const inicio = Date.now();
  try {
    if (!CHAVE) return json({ error: "TRANSPARENCIA_API_KEY não configurada no Supabase" }, 500);
    const body = await req.json();
    const ug = String(body.ug ?? "").replace(/\D/g, "");
    const gestao = String(body.gestao ?? "00001").replace(/\D/g, "").padStart(5, "0");
    const di = String(body.dataInicio ?? "");
    const df = String(body.dataFim ?? di);
    if (ug.length !== 6) return json({ error: "UG inválida (6 dígitos, ex: 120630)" }, 400);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(di) || !/^\d{4}-\d{2}-\d{2}$/.test(df) || df < di) {
      return json({ error: "Período inválido (dataInicio/dataFim no formato AAAA-MM-DD)" }, 400);
    }

    const obs: any[] = [];
    const dias: { data: string; documentos: number; obs: number }[] = [];
    let dia = di;
    dias: for (let n = 0; dia <= df && n < MAX_DIAS; n++, dia = proximoDia(dia)) {
      if (Date.now() - inicio > PRAZO_MS) break;
      const docs = await documentosDoDia(ug, gestao, dia);
      const doDia = docs.map((d) => paraOB(d, ug, gestao, dia)).filter(Boolean);
      for (const o of doDia) {
        if (!o.intermediario && !pagaABanco(o)) continue;
        // Prazo apertou no meio do dia: o dia volta inteiro na próxima chamada (com cache).
        // O primeiro dia da chamada vai até o fim, senão um dia cheio nunca terminaria.
        if (n > 0 && Date.now() - inicio > PRAZO_MS) break dias;
        try { o.favorecidosFinais = await favorecidosFinais(o); }
        catch (e: any) { o.finaisErro = e?.message ?? String(e); }
      }
      obs.push(...doDia);
      dias.push({ data: dataBR(dia), documentos: docs.length, obs: doDia.length });
    }
    return json(dia <= df ? { obs, dias, incompleto: { proximaData: dia } } : { obs, dias });
  } catch (e: any) {
    console.error("obs-transparencia:", e);
    return json({ error: e?.message ?? String(e) }, 502);
  }
});
