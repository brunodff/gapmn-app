// Chamadas ao Contratos.gov.br pela Edge Function contratos-gov (a API não libera CORS).
import { supabase } from "../supabase";
import type { ContratoGov, EmpenhoGov, HistoricoGov, ItemGov } from "./contratosGov";
import { dadosDoContratosGov, type ResultadoGov } from "./contratosGov";

async function rota<T>(r: string): Promise<T> {
  const { data, error } = await supabase.functions.invoke("contratos-gov", { body: { rota: r } });
  if (error) {
    let msg = error.message;
    try { const c = await (error as { context?: Response }).context?.json(); if (c?.erro) msg = c.erro; } catch { /* mantém a mensagem */ }
    throw new Error(msg);
  }
  if (data && typeof data === "object" && "erro" in (data as object)) throw new Error(String((data as { erro: string }).erro));
  return data as T;
}

/** Contratos ativos da UG (a lista do GAP-MN, com ~330 contratos, leva cerca de 40 s) */
export const contratosDaUg = (ug: string) => rota<ContratoGov[]>(`ug/${ug}`);

// lista da UG guardada na sessão: a do GAP-MN leva ~40 s no Contratos.gov.br
const listas = new Map<string, Promise<ContratoGov[]>>();
export function listaDaUg(ug: string): Promise<ContratoGov[]> {
  let p = listas.get(ug);
  if (!p) { p = contratosDaUg(ug); listas.set(ug, p); p.catch(() => listas.delete(ug)); }
  return p;
}

/** Itens, termos e empenhos de um contrato, já convertidos para o cadastro do reajuste */
export async function cadastroDoContrato(c: ContratoGov): Promise<ResultadoGov> {
  const [itens, historico, empenhos] = await Promise.all([
    rota<ItemGov[]>(`${c.id}/itens`), rota<HistoricoGov[]>(`${c.id}/historico`), rota<EmpenhoGov[]>(`${c.id}/empenhos`),
  ]);
  return dadosDoContratosGov(c, itens ?? [], historico ?? [], empenhos ?? []);
}

// cadastro público de CNPJ, com CORS liberado; a BrasilAPI às vezes falha, a Minha Receita (mesmos campos) é a reserva
const FONTES_CNPJ = ["https://brasilapi.com.br/api/cnpj/v1/", "https://minhareceita.org/"];

/** Endereço da empresa pelo cadastro público de CNPJ; null se não achar */
export async function enderecoPeloCnpj(cnpj: string): Promise<string | null> {
  const d = cnpj.replace(/\D/g, "");
  if (d.length !== 14) return null;
  for (const fonte of FONTES_CNPJ) {
    const end = await enderecoEm(fonte + d);
    if (end) return end;
  }
  return null;
}

async function enderecoEm(url: string): Promise<string | null> {
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(15_000) });
    if (!r.ok) return null;
    const j = (await r.json()) as Record<string, string | null>;
    const cap = (s: string | null | undefined) => String(s ?? "").toLowerCase().replace(/(^|\s)\S/g, (x) => x.toUpperCase()).trim();
    const partes = [
      `${cap(j.descricao_tipo_de_logradouro)} ${cap(j.logradouro)}`.trim(),
      j.numero ? `nº ${j.numero}` : "", cap(j.complemento), j.bairro ? `Bairro ${cap(j.bairro)}` : "",
    ].filter(Boolean);
    if (!partes.length) return null;
    const cep = String(j.cep ?? "").replace(/\D/g, "");
    return `na ${partes.join(", ")}, em ${cap(j.municipio)}/${j.uf ?? ""}${cep.length === 8 ? `, CEP ${cep.slice(0, 5)}-${cep.slice(5)}` : ""}`;
  } catch {
    return null;
  }
}
