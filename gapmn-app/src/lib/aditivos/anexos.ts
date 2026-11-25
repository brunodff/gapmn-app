// PDFs anexados na tela do aditivo (SICAF, consolidada, certidões, item 13, memória de cálculo e os demais itens da
// Lista): ficam na memória da aba e também GUARDADOS no aditivo (depósito privado aditivos-docs, revisão 4 da SCON,
// seção 3H), para o .zip sair completo em outra sessão ou outro computador. O item 14 (CPF do sócio) fica só na
// memória: o CPF não é guardado no site.
import { supabase } from "../supabase";
import type { AnexoGuardado } from "./tipos";

export interface Arquivo { nome: string; bytes: ArrayBuffer }
export interface AnexosConsultas {
  sicaf: Arquivo[];
  consolidada: Arquivo | null;
  complementos: Record<string, Arquivo>;
  item13: Arquivo | null;
  socio: Arquivo[];
}
export const anexosVazios = (): AnexosConsultas => ({ sicaf: [], consolidada: null, complementos: {}, item13: null, socio: [] });

const BUCKET = "aditivos-docs";
const MIME: Record<string, string> = {
  pdf: "application/pdf", docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", zip: "application/zip",
};
/** Nome aceito pelo depósito (sem acento nem símbolo), com a hora na frente para não sobrescrever */
export function nomeSeguro(nome: string): string {
  const limpo = nome.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^0-9A-Za-z_. ()-]+/g, "_").replace(/_+/g, "_").slice(-120);
  return `${Date.now()}-${limpo || "arquivo.pdf"}`;
}

export async function guardarAnexo(aditivoId: string, chave: string, a: Arquivo, por: string | null): Promise<AnexoGuardado> {
  const caminho = `${aditivoId}/${chave.toLowerCase().replace(/[^a-z0-9_]/g, "_")}/${nomeSeguro(a.nome)}`;
  const ext = (/\.([a-z0-9]+)$/i.exec(a.nome)?.[1] ?? "pdf").toLowerCase();
  const { error } = await supabase.storage.from(BUCKET).upload(caminho, new Blob([a.bytes], { type: MIME[ext] ?? "application/pdf" }), { upsert: false, contentType: MIME[ext] ?? "application/pdf" });
  if (error) throw new Error(/bucket.*not.*found|not found/i.test(error.message) ? "O depósito dos anexos ainda não existe (migração 20261125c_aditivos_rev4): o arquivo fica só nesta sessão." : `Não guardei ${a.nome}: ${error.message}`);
  return { nome: a.nome, caminho, tamanho: a.bytes.byteLength, em: new Date().toISOString(), por };
}

export async function baixarAnexo(g: AnexoGuardado): Promise<Arquivo> {
  const { data, error } = await supabase.storage.from(BUCKET).download(g.caminho);
  if (error || !data) throw new Error(`Não consegui baixar ${g.nome}: ${error?.message ?? "sem dados"}`);
  return { nome: g.nome, bytes: await data.arrayBuffer() };
}

/** Tira do depósito os arquivos trocados ou removidos pelo fiscal (falha aqui não impede nada) */
export async function apagarAnexos(lista: (AnexoGuardado | null | undefined)[]): Promise<void> {
  const caminhos = lista.filter((g): g is AnexoGuardado => !!g).map((g) => g.caminho);
  if (caminhos.length) await supabase.storage.from(BUCKET).remove(caminhos).catch(() => undefined);
}
