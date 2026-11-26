// Chamadas ao Contratos.gov.br pela Edge Function contratos-gov (a API não libera CORS).
import { supabase } from "../supabase";
import type { ContratoGov, EmpenhoGov, HistoricoGov, ItemGov } from "./contratosGov";
import { dadosDoContratosGov, type ResultadoGov } from "./contratosGov";
import { acharTrNoPacote, type ArquivoLido } from "./documentosGov";
import { extrairDoTexto, type AchadosPdf } from "./lerPdfs";
import { textoDoPdf } from "./pdfTexto";

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

/** Empenhos de um contrato como a API devolve (empenhado, liquidado, pago, restos a pagar em texto "1.234,56") */
export const empenhosDoContrato = (id: number) => rota<Record<string, string | null>[]>(`${id}/empenhos`);

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

// ── Documentos oficiais: PDF do contrato (Contratos.gov.br) e TR da compra (PNCP) ────────────────────────
async function chamar<T>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke("contratos-gov", { body });
  if (error) {
    let msg = error.message;
    try { const c = await (error as { context?: Response }).context?.json(); if (c?.erro) msg = c.erro; } catch { /* mantém a mensagem */ }
    throw new Error(msg);
  }
  return data as T;
}
async function binario(body: Record<string, unknown>): Promise<Uint8Array> {
  const dados = await chamar<Blob | ArrayBuffer>(body);
  return new Uint8Array(dados instanceof Blob ? await dados.arrayBuffer() : dados);
}

interface ArquivoGov { id: number; tipo: string; descricao: string | null; path_arquivo: string | null }
interface CompraPncp { compra: { cnpj: string; ano: string; seq: string; controle: string | null; titulo: string | null } | null; arquivos: { n: number; titulo: string; tipo: string }[] }

/** PDF do contrato assinado, da aba "Arquivos" do Contratos.gov.br */
export async function pdfDoContrato(c: ContratoGov): Promise<ArquivoLido | null> {
  const lista = await rota<ArquivoGov[]>(`${c.id}/arquivos`);
  const contratos = (lista ?? []).filter((a) => /^contrato$/i.test(a.tipo) && a.path_arquivo?.toLowerCase().endsWith(".pdf"));
  const escolhido = contratos.find((a) => /assinad/i.test(a.descricao ?? "")) ?? contratos[0];
  if (!escolhido?.path_arquivo) return null;
  return { nome: escolhido.descricao ?? "Contrato", bytes: await binario({ rota: "arquivo", url: escolhido.path_arquivo }) };
}

/** Termo de Referência da compra no PNCP (sozinho ou dentro do pacote do edital) */
export async function trDaCompra(c: ContratoGov): Promise<(ArquivoLido & { compra: string }) | null> {
  const numero = (c.licitacao_numero ?? "").trim(), uasg = (c.unidade_compra ?? "").trim();
  if (!/^\d{1,6}\/\d{4}$/.test(numero) || !/^\d{6}$/.test(uasg)) return null;
  const r = await chamar<CompraPncp>({ rota: "pncp-compra", uasg, numero });
  if (!r.compra) return null;
  const ordem = [...r.arquivos].sort((a, b) => Number(/refer/i.test(b.tipo)) - Number(/refer/i.test(a.tipo)) || Number(/edital/i.test(b.tipo)) - Number(/edital/i.test(a.tipo)));
  for (const a of ordem.filter((x) => /refer|edital/i.test(x.tipo)).slice(0, 2)) {
    const bytes = await binario({ rota: "pncp-arquivo", cnpj: r.compra.cnpj, ano: r.compra.ano, seq: r.compra.seq, n: a.n });
    const tr = acharTrNoPacote({ nome: a.titulo, bytes });
    if (tr) return { ...tr, compra: r.compra.controle ?? `${r.compra.cnpj}/${r.compra.ano}/${r.compra.seq}` };
  }
  return null;
}

export interface LeituraOficial { contrato: AchadosPdf | null; tr: AchadosPdf | null; avisos: string[]; origemContrato: string; origemTr: string }

/** Lê o contrato e o TR oficiais (um não depende do outro; o que falhar vira aviso) */
export async function lerDocumentosOficiais(c: ContratoGov, cnpjEmpresa?: string): Promise<LeituraOficial> {
  const avisos: string[] = [];
  const [pdfC, pdfT] = await Promise.all([
    pdfDoContrato(c).catch((e: unknown) => { avisos.push(`PDF do contrato: ${e instanceof Error ? e.message : String(e)}`); return null; }),
    trDaCompra(c).catch((e: unknown) => { avisos.push(`TR no PNCP: ${e instanceof Error ? e.message : String(e)}`); return null; }),
  ]);
  const ler = async (a: ArquivoLido | null) => (a ? extrairDoTexto(await textoDoPdf(a.bytes), { cnpjEmpresa }) : null);
  const [contrato, tr] = await Promise.all([ler(pdfC), ler(pdfT)]);
  if (!pdfC) avisos.push("O Contratos.gov.br não tem o PDF do contrato na aba Arquivos.");
  if (!pdfT) avisos.push("Não achei o Termo de Referência da compra no PNCP.");
  return { contrato, tr, avisos, origemContrato: `PDF do contrato (Contratos.gov.br)`, origemTr: pdfT ? `TR no PNCP (${pdfT.compra})` : "TR no PNCP" };
}
