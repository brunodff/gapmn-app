// Prints da consulta do índice (Calculadora do Cidadão / tabela da FGV) guardados por contrato e por reajuste, no
// depósito privado reajustes-prints (revisão 5.1 da SCON, seção 3.4): o parecer do apostilamento e o Parecer Técnico
// do termo aditivo usam o mesmo print, em qualquer sessão. Só no banco do GAP-MN (outras OMs: só no navegador).
import { supabase } from "../supabase";

const BUCKET = "reajustes-prints";
export interface PrintGuardado { caminho: string; nome: string; em: string }

const pasta = (numeroContrato: string) =>
  numeroContrato.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^0-9A-Za-z_-]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 80) || "contrato";
const nomeSeguro = (nome: string) =>
  `${Date.now()}-${nome.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^0-9A-Za-z_. ()-]+/g, "_").slice(-100) || "print.png"}`;

export async function guardarPrint(numeroContrato: string, n: number, f: File): Promise<PrintGuardado> {
  const caminho = `${pasta(numeroContrato)}/${n}/${nomeSeguro(f.name)}`;
  const { error } = await supabase.storage.from(BUCKET).upload(caminho, f, { upsert: false, contentType: f.type || "image/png" });
  if (error) throw new Error(/not found/i.test(error.message) ? "O depósito dos prints ainda não existe (migração 20261125d): o print vale só nesta sessão." : error.message);
  return { caminho, nome: f.name, em: new Date().toISOString() };
}

export async function baixarPrint(p: PrintGuardado): Promise<File> {
  const { data, error } = await supabase.storage.from(BUCKET).download(p.caminho);
  if (error || !data) throw new Error(`Não abri o print ${p.nome}: ${error?.message ?? "sem dados"}`);
  return new File([data], p.nome, { type: data.type || (/\.jpe?g$/i.test(p.nome) ? "image/jpeg" : "image/png") });
}
