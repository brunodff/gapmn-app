// Busca pública do PNCP (pncp.gov.br/api/search) direto do navegador: libera CORS e aceita o agente do navegador.
// Mesma lógica do Mapa das compras do CCGP: várias páginas somadas, cache de 10 min e novas tentativas,
// porque o PNCP derruba consultas em sequência.
import { useEffect, useState } from "react";

export interface ItemPncp {
  id: string; title: string; description: string; item_url: string; document_type: string;
  orgao_nome: string; orgao_cnpj: string; unidade_nome: string; unidade_codigo: string;
  municipio_nome: string; codigo_ibge: string; uf: string; esfera_nome: string;
  modalidade_licitacao_nome: string | null; situacao_nome: string | null; tipo_nome: string | null;
  data_publicacao_pncp: string | null; data_inicio_vigencia: string | null; data_fim_vigencia: string | null;
  valor_global: number | null; numero_controle_pncp: string; fornecedor_nome?: string | null;
}
interface RespostaPncp { items: ItemPncp[]; total: number }

export const UFS = ["AC", "AL", "AM", "AP", "BA", "CE", "DF", "ES", "GO", "MA", "MG", "MS", "MT", "PA", "PB", "PE", "PI", "PR", "RJ", "RN", "RO", "RR", "RS", "SC", "SE", "SP", "TO"];
export const MODALIDADES: [string, string][] = [
  ["6", "Pregão eletrônico"], ["8", "Dispensa"], ["4", "Concorrência eletrônica"], ["9", "Inexigibilidade"],
  ["12", "Credenciamento"], ["1", "Leilão eletrônico"], ["7", "Pregão presencial"], ["5", "Concorrência presencial"],
];
export const SITUACOES: [string, string][] = [["recebendo_proposta", "Recebendo propostas"], ["em_julgamento", "Em julgamento"], ["encerradas", "Encerradas"], ["todos", "Todas"]];
export const ESFERAS: [string, string][] = [["", "Todas as esferas"], ["F", "Federal"], ["E", "Estadual"], ["M", "Municipal"]];

export interface FiltrosPncp { q: string; uf: string; modalidade: string; esfera: string; status: string }

export function urlPncp(f: FiltrosPncp, pagina: number, tam = 100): string {
  const p = new URLSearchParams({ tipos_documento: "edital", ordenacao: "-data", pagina: String(pagina), tam_pagina: String(tam), status: f.status || "recebendo_proposta" });
  if (f.q) p.set("q", f.q.slice(0, 120));
  if (f.uf) p.set("ufs", f.uf);
  if (f.modalidade) p.set("modalidades", f.modalidade);
  if (f.esfera) p.set("esferas", f.esfera);
  return `https://pncp.gov.br/api/search/?${p}`;
}

export function linkPncp(i: ItemPncp): string {
  if (!i.item_url) return "https://pncp.gov.br/app/editais";
  return `https://pncp.gov.br/app/editais${i.item_url.replace(/^\/compras/, "")}`;
}

const cache = new Map<string, { em: number; r: RespostaPncp }>();
const VALIDADE_MS = 10 * 60_000;

async function obterPagina(url: string): Promise<RespostaPncp> {
  const c = cache.get(url);
  if (c && Date.now() - c.em < VALIDADE_MS) return c.r;
  let ultimo = "";
  for (let t = 1; t <= 4; t++) {
    try {
      const resp = await fetch(url, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(25_000) });
      if (resp.ok) {
        const j = (await resp.json()) as Partial<RespostaPncp>;
        const r = { items: j.items ?? [], total: j.total ?? 0 };
        cache.set(url, { em: Date.now(), r });
        return r;
      }
      ultimo = `o PNCP respondeu ${resp.status}`;
      if (resp.status < 500 && resp.status !== 429) break;
    } catch (e) {
      ultimo = e instanceof DOMException && e.name === "TimeoutError" ? "o PNCP demorou demais para responder" : "o PNCP não respondeu";
    }
    await new Promise((ok) => setTimeout(ok, 700 * t * t));
  }
  throw new Error(`Não foi possível consultar o PNCP: ${ultimo}. Tente de novo em instantes.`);
}

/** Várias páginas da busca do PNCP somadas (para o mapa). A 1ª precisa vir; das seguintes, fica o que chegou. */
export function usePaginasPncp(urls: string[]) {
  const chave = urls.join(" ");
  const [estado, setEstado] = useState<{ chave: string; itens?: ItemPncp[]; total?: number; erro?: string }>({ chave: "" });
  const [versao, setVersao] = useState(0);
  useEffect(() => {
    if (!chave) return;
    let vivo = true;
    (async () => {
      const itens: ItemPncp[] = [];
      let total = 0;
      try {
        for (const [n, u] of chave.split(" ").entries()) {
          let r: RespostaPncp;
          try { r = await obterPagina(u); } catch (e) { if (n === 0) throw e; break; }
          total = r.total;
          itens.push(...r.items);
          if (r.items.length < 100) break;
        }
        if (vivo) setEstado({ chave, itens, total });
      } catch (e) {
        if (vivo) setEstado({ chave, erro: e instanceof Error ? e.message : String(e) });
      }
    })();
    return () => { vivo = false; };
  }, [chave, versao]);
  const atual = estado.chave === chave;
  return {
    itens: atual ? estado.itens : undefined, total: atual ? estado.total : undefined, erro: atual ? estado.erro : undefined,
    carregando: !!chave && !atual,
    recarregar: () => { for (const u of urls) cache.delete(u); setEstado({ chave: "" }); setVersao((v) => v + 1); },
  };
}
