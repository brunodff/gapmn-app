// Cliente do worker do kit de Termos Aditivos: uma instância por aba, pedidos numerados (como o motor de reajuste).
import type { PedidoAditivo, RespostaAditivo } from "./aditivo.worker";
import type { DadosAditivo, ResultadoRegularidade, ResultadoSicaf } from "./tipos";

type Pendente = { ok: (r: { resultado: unknown; arquivo?: ArrayBuffer }) => void; erro: (e: Error) => void; progresso?: (etapa: string) => void };
let worker: Worker | null = null;
let seq = 0;
const pendentes = new Map<number, Pendente>();

function obterWorker(): Worker {
  if (worker) return worker;
  worker = new Worker(new URL("./aditivo.worker.ts", import.meta.url), { type: "module" });
  worker.onmessage = (ev: MessageEvent<RespostaAditivo>) => {
    const r = ev.data;
    if (r.tipo === "progresso") { for (const q of pendentes.values()) q.progresso?.(r.etapa); return; }
    const p = pendentes.get(r.id);
    if (!p) return;
    pendentes.delete(r.id);
    if (r.tipo === "ok") p.ok({ resultado: r.resultado, arquivo: r.arquivo });
    else p.erro(new Error(r.erro));
  };
  worker.onerror = (ev) => {
    const e = new Error(ev.message || "o kit parou");
    for (const p of pendentes.values()) p.erro(e);
    pendentes.clear();
    worker?.terminate();
    worker = null;
  };
  return worker;
}

type SemId<T> = T extends { id: number } ? Omit<T, "id"> : never;
function pedir(pedido: SemId<PedidoAditivo>, progresso?: (etapa: string) => void, transferir: Transferable[] = []) {
  const id = ++seq;
  return new Promise<{ resultado: unknown; arquivo?: ArrayBuffer }>((ok, erro) => {
    pendentes.set(id, { ok, erro, progresso });
    obterWorker().postMessage({ ...pedido, id } as PedidoAditivo, transferir);
  });
}

export interface DocumentoGerado { nome: string; ok: boolean; arquivos: string[]; erros: string[]; avisos: string[]; saida: string }
export interface Conferencia {
  pareceres: { descobertas: string[]; pareceres: { numero: string; motivo_texto: string }[] };
  itens: { chave: string; texto: string }[]; objeto: string; valor_atual: number | null; valor_novo: number | null;
  erros_ficha: string[]; avisos_ficha: string[]; passa_1_milhao: boolean; documentos: string[];
  tem_prorrogacao: boolean; motivos_anuencia: string[]; objeto_vantajosidade: string;
}

export const kitAditivo = {
  iniciar: (progresso?: (etapa: string) => void) => pedir({ tipo: "iniciar" }, progresso).then(() => true),
  conferir: async (dados: DadosAditivo, progresso?: (etapa: string) => void) => (await pedir({ tipo: "conferir", dados }, progresso)).resultado as Conferencia,
  sicaf: async (texto: string, cnpj: string, progresso?: (etapa: string) => void) => (await pedir({ tipo: "sicaf", texto, cnpj }, progresso)).resultado as ResultadoSicaf,
  consolidadaTexto: async (texto: string, progresso?: (etapa: string) => void) => (await pedir({ tipo: "consolidada_texto", texto }, progresso)).resultado as ResultadoRegularidade,
  consolidadaJson: async (json: unknown, progresso?: (etapa: string) => void) => (await pedir({ tipo: "consolidada_json", json }, progresso)).resultado as ResultadoRegularidade,
  /** Junta os PDFs na ordem recebida (item 13: consolidada + certidões que faltaram) */
  juntar: async (pdfs: ArrayBuffer[], progresso?: (etapa: string) => void) => {
    const copias = pdfs.map((b) => b.slice(0));
    const r = await pedir({ tipo: "juntar", pdfs: copias }, progresso, copias);
    return new Blob([r.arquivo!], { type: "application/pdf" });
  },
  /** Gera os documentos que se aplicam e o .zip numerado pela Lista (montar_zip.py), com os anexos por item da Lista */
  gerar: async (dados: DadosAditivo, extras: { chave: string; nome: string; bytes: ArrayBuffer }[], progresso?: (etapa: string) => void) => {
    const copias = extras.map((x) => ({ chave: x.chave, nome: x.nome, bytes: x.bytes.slice(0) }));
    const r = await pedir({ tipo: "gerar", dados, extras: copias }, progresso, copias.map((x) => x.bytes));
    const res = r.resultado as { documentos: Record<string, DocumentoGerado>; arquivos: string[]; faltando: string[] };
    return { ...res, zip: new Blob([r.arquivo!], { type: "application/zip" }) };
  },
};
