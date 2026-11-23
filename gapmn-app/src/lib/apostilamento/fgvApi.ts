// Tabela do INCC da FGV pela ponte da Cloudflare (workers/indice-fgv): o portal da FGV não libera o navegador.
import type { TabelaFgv } from "./indiceFgv";

export const PONTE_FGV = "https://indice-fgv.gapmn.app";

// páginas lidas na sessão: os reajustes de um contrato costumam cair na mesma página anual
const tabelas = new Map<string, Promise<TabelaFgv | null>>();

/** Tabela da página anual do INCC ("incc-m-2026"), ou null se a página não existe */
export function tabelaDaFgv(pagina: string): Promise<TabelaFgv | null> {
  let p = tabelas.get(pagina);
  if (!p) {
    p = (async () => {
      const r = await fetch(`${PONTE_FGV}/?pagina=${encodeURIComponent(pagina)}`, { signal: AbortSignal.timeout(30_000) });
      const j = (await r.json().catch(() => null)) as { tabela?: TabelaFgv | null; erro?: string } | null;
      if (!r.ok || !j) throw new Error(j?.erro ?? `a ponte da FGV respondeu ${r.status}`);
      return j.tabela ?? null;
    })();
    tabelas.set(pagina, p);
    p.catch(() => tabelas.delete(pagina));
  }
  return p;
}
