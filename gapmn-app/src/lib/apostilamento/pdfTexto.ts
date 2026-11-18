// Texto de um PDF no navegador (pdf.js, o mesmo da pesquisa de preços). Nada sai do computador.
import * as pdfjsLib from "pdfjs-dist/legacy/build/pdf.mjs";
import type { TextItem } from "pdfjs-dist/types/src/display/api";

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/legacy/build/pdf.worker.min.mjs", import.meta.url).toString();

/** Texto do PDF em ordem de leitura, uma linha por linha visual (até 60 páginas) */
export async function textoDoPdf(arquivo: File): Promise<string> {
  const doc = await pdfjsLib.getDocument({ data: new Uint8Array(await arquivo.arrayBuffer()) }).promise;
  const paginas: string[] = [];
  for (let p = 1; p <= Math.min(doc.numPages, 60); p++) {
    const pag = await doc.getPage(p);
    const conteudo = await pag.getTextContent();
    const linhas = new Map<number, string[]>();
    for (const it of conteudo.items as TextItem[]) {
      if (!("str" in it) || !it.str.trim()) continue;
      const y = Math.round(it.transform[5]);
      linhas.set(y, [...(linhas.get(y) ?? []), it.str]);
    }
    paginas.push([...linhas.entries()].sort((a, b) => b[0] - a[0]).map(([, l]) => l.join(" ")).join("\n"));
  }
  await doc.destroy();
  return paginas.join("\n");
}
