// Ponte do gapmn.app para a tabela do INCC da FGV (Cloudflare Worker "gapmn-indice-fgv").
// O portal da FGV não libera o navegador (sem CORS) e só aceita TLS 1.2 com troca de chave RSA, que a função do
// Supabase (Deno) não usa; a Cloudflare usa. Só lê as páginas anuais do INCC (portal.fgv.br/noticias/incc-m-<ano>)
// e devolve a tabela já lida pelo mesmo código do app (lerTabelaFgv). Dado público, sem login e sem segredo.
//   GET /?pagina=incc-m-2026 → { pagina, url, tabela: { "out/26": [0.35, 6.75], … } }
//   tabela null = a página não existe (a FGV manda para a lista de notícias) ou não tem a tabela
// Guarda cada página por 6 h na memória do Worker (a FGV publica uma vez por mês).
// Deploy, nesta pasta: npx wrangler deploy
import { PAGINA_FGV_VALIDA, lerTabelaFgv, type TabelaFgv } from "../../../src/lib/apostilamento/indiceFgv.ts";

const FGV = "https://portal.fgv.br/noticias/";
const SEIS_HORAS = 6 * 3600 * 1000;
const CORS = { "access-control-allow-origin": "*", "access-control-allow-methods": "GET, OPTIONS" };

type Leitura = { pagina: string; url: string | null; tabela: TabelaFgv | null };
const guardadas = new Map<string, { ate: number; leitura: Leitura }>();

const json = (corpo: unknown, status = 200) =>
  new Response(JSON.stringify(corpo), { status, headers: { ...CORS, "content-type": "application/json; charset=utf-8" } });

async function ler(pagina: string): Promise<Leitura> {
  const r = await fetch(FGV + pagina, {
    headers: { "user-agent": "GAPMN-App/1.0 (gapmn.app; dados publicos)", accept: "text/html" },
    signal: AbortSignal.timeout(25_000),
  });
  // página que não existe redireciona para a lista de notícias
  if (r.status === 404 || (r.ok && !new URL(r.url || FGV + pagina).pathname.endsWith(`/${pagina}`))) return { pagina, url: null, tabela: null };
  if (!r.ok) throw new Error(`a FGV respondeu ${r.status}`);
  const tabela = lerTabelaFgv(await r.text());
  return { pagina, url: FGV + pagina, tabela: Object.keys(tabela).length ? tabela : null };
}

export default {
  async fetch(req: Request): Promise<Response> {
    if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
    if (req.method !== "GET") return json({ erro: "Use GET." }, 405);
    const pagina = new URL(req.url).searchParams.get("pagina") ?? "";
    if (!PAGINA_FGV_VALIDA.test(pagina)) return json({ erro: "Página da FGV inválida (ex.: incc-m-2026)." }, 400);
    const g = guardadas.get(pagina);
    if (g && g.ate > Date.now()) return json(g.leitura);
    try {
      const leitura = await ler(pagina);
      guardadas.set(pagina, { ate: Date.now() + (leitura.tabela ? SEIS_HORAS : SEIS_HORAS / 6), leitura });
      return json(leitura);
    } catch (e) {
      const motivo = e instanceof Error ? e.message : String(e);
      return json({ erro: `Não consegui ler a página da FGV (${motivo.slice(0, 160)}).` }, 502);
    }
  },
};
