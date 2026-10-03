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
 * A API NÃO traz banco/agência/conta do favorecido (sigilo bancário): a extensão
 * completa esses campos com a planilha do Tesouro Gerencial, quando houver.
 *
 * Deploy (com verificação de JWT — a extensão manda a chave anon):
 *   supabase functions deploy obs-transparencia
 * Secret (cadastro gratuito em portaldatransparencia.gov.br/api-de-dados/cadastrar-email):
 *   supabase secrets set TRANSPARENCIA_API_KEY=<chave>
 */

import { corsHeaders } from "../_shared/cors.ts";

const API = "https://api.portaldatransparencia.gov.br/api-de-dados/despesas/documentos";
const CHAVE = Deno.env.get("TRANSPARENCIA_API_KEY") ?? "";
const MAX_DIAS = 10;
const PRAZO_MS = 110_000;          // a função tem ~150 s; sobra para responder
const INTERVALO_MS = 700;          // ~85 consultas/min, abaixo do limite do Portal
const MAX_PAGINAS_DIA = 40;

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
async function consultar(params: URLSearchParams) {
  for (let tentativa = 0; tentativa < 4; tentativa++) {
    const espera = ultimaConsulta + INTERVALO_MS - Date.now();
    if (espera > 0) await dorme(espera);
    ultimaConsulta = Date.now();
    const res = await fetch(`${API}?${params}`, { headers: { "chave-api-dados": CHAVE, Accept: "application/json" } });
    if (res.status === 429 || res.status >= 500) { await dorme(4000 * (tentativa + 1)); continue; }
    if (res.status === 401 || res.status === 403) throw new Error("Chave da API do Portal da Transparência inválida ou não autorizada");
    if (!res.ok) throw new Error(`Portal da Transparência respondeu HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const corpo = await res.json();
    return Array.isArray(corpo) ? corpo : [];
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
    const lote = await consultar(params);
    if (!lote.length) break;
    docs.push(...lote);
  }
  cache.set(chave, { ts: Date.now(), docs });
  return docs;
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
    for (let n = 0; dia <= df && n < MAX_DIAS; n++, dia = proximoDia(dia)) {
      if (Date.now() - inicio > PRAZO_MS) break;
      const docs = await documentosDoDia(ug, gestao, dia);
      const doDia = docs.map((d) => paraOB(d, ug, gestao, dia)).filter(Boolean);
      obs.push(...doDia);
      dias.push({ data: dataBR(dia), documentos: docs.length, obs: doDia.length });
    }
    return json(dia <= df ? { obs, dias, incompleto: { proximaData: dia } } : { obs, dias });
  } catch (e: any) {
    console.error("obs-transparencia:", e);
    return json({ error: e?.message ?? String(e) }, 502);
  }
});
