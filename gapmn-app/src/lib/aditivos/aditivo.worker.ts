// Roda o kit de Termos Aditivos da SCON (Python) no navegador, num worker: Pyodide com python-docx e pypdf, o mesmo
// Python do motor de reajuste (o navegador guarda em cache depois da primeira vez). Os documentos são gerados aqui e
// voltam como .zip; o SICAF e a Consulta Consolidada chegam como texto (lido pelo pdf.js) e voltam conferidos.
import pontePy from "./ponte_aditivo.py?raw";
import pareceresPy from "./kit/pareceres.py?raw";
import listaPy from "./kit/gerar_lista_verificacao.py?raw";
import declaracaoPy from "./kit/gerar_declaracao_orcamentaria.py?raw";
import vantajosidadePy from "./kit/gerar_declaracao_vantajosidade.py?raw";
import parecerPy from "./kit/gerar_parecer_tecnico.py?raw";
import atestadoPy from "./kit/gerar_atestado_adequacao.py?raw";
import montarZipPy from "./kit/montar_zip.py?raw";
import pareceresJson from "./kit/biblioteca_pareceres.json?raw";
import mapaPy from "./kit/gerar_mapa_riscos.py?raw";
import pesquisaPy from "./kit/gerar_pesquisa_precos.py?raw";
import fichaPy from "./kit/gerar_ficha_autorizacao.py?raw";
import sicafPy from "./kit/verificar_sicaf.py?raw";
import regularidadePy from "./kit/consultar_regularidade.py?raw";
import bibliotecaJson from "./kit/biblioteca_riscos.json?raw";
import brasaoUrl from "./kit/brasao.png?url";

const PYODIDE = "https://cdn.jsdelivr.net/pyodide/v314.0.7/full/";
const KIT: [string, string][] = [
  ["pareceres.py", pareceresPy], ["gerar_lista_verificacao.py", listaPy], ["gerar_declaracao_orcamentaria.py", declaracaoPy],
  ["gerar_declaracao_vantajosidade.py", vantajosidadePy], ["gerar_parecer_tecnico.py", parecerPy], ["gerar_atestado_adequacao.py", atestadoPy], ["montar_zip.py", montarZipPy],
  ["gerar_mapa_riscos.py", mapaPy], ["gerar_pesquisa_precos.py", pesquisaPy], ["gerar_ficha_autorizacao.py", fichaPy],
  ["verificar_sicaf.py", sicafPy], ["consultar_regularidade.py", regularidadePy], ["biblioteca_riscos.json", bibliotecaJson], ["biblioteca_pareceres.json", pareceresJson],
];

type Py = {
  loadPackage: (p: string[]) => Promise<void>;
  pyimport: (m: string) => any; // eslint-disable-line @typescript-eslint/no-explicit-any
  runPython: (c: string) => unknown;
  FS: { mkdirTree: (p: string) => void; writeFile: (p: string, d: string | Uint8Array) => void; readFile: (p: string) => Uint8Array; unlink: (p: string) => void };
};

export type PedidoAditivo =
  | { id: number; tipo: "iniciar" }
  | { id: number; tipo: "conferir"; dados: unknown }
  | { id: number; tipo: "sicaf"; texto: string; cnpj: string }
  | { id: number; tipo: "consolidada_texto"; texto: string }
  | { id: number; tipo: "consolidada_json"; json: unknown }
  | { id: number; tipo: "juntar"; pdfs: ArrayBuffer[] }
  | { id: number; tipo: "gerar"; dados: unknown; extras: { chave: string; nome: string; bytes: ArrayBuffer }[] };

export type RespostaAditivo =
  | { id: number; tipo: "progresso"; etapa: string }
  | { id: number; tipo: "ok"; resultado: unknown; arquivo?: ArrayBuffer }
  | { id: number; tipo: "erro"; erro: string };

const ctx = self as unknown as {
  postMessage: (m: RespostaAditivo, transferir?: Transferable[]) => void;
  onmessage: ((ev: MessageEvent<PedidoAditivo>) => void) | null;
};
let carregando: Promise<Py> | null = null;

async function carregar(avisar: (etapa: string) => void): Promise<Py> {
  avisar("Baixando o Python do navegador (só na primeira vez)…");
  const { loadPyodide } = await import(/* @vite-ignore */ `${PYODIDE}pyodide.mjs`);
  const py: Py = await loadPyodide({ indexURL: PYODIDE });
  avisar("Instalando python-docx e pypdf…");
  await py.loadPackage(["micropip", "lxml", "typing-extensions"]);
  await py.pyimport("micropip").install(["python-docx", "pypdf"]);
  avisar("Carregando o kit da SCON…");
  py.FS.mkdirTree("/aditivos/kit");
  py.FS.writeFile("/aditivos/ponte_aditivo.py", pontePy);
  for (const [nome, conteudo] of KIT) py.FS.writeFile(`/aditivos/kit/${nome}`, conteudo);
  py.FS.writeFile("/aditivos/kit/brasao.png", new Uint8Array(await (await fetch(brasaoUrl)).arrayBuffer()));
  py.runPython("import sys; sys.path.insert(0, '/aditivos'); import ponte_aditivo");
  return py;
}

function mensagem(e: unknown): string {
  const t = e instanceof Error ? e.message : String(e);
  const linhas = t.trim().split("\n").filter(Boolean);
  return (linhas[linhas.length - 1] ?? t).replace(/^(\w+Error|SystemExit):\s*/, "") || t;
}
const recortar = (b: Uint8Array) => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;

ctx.onmessage = async (ev: MessageEvent<PedidoAditivo>) => {
  const p = ev.data;
  const avisar = (etapa: string) => ctx.postMessage({ id: p.id, tipo: "progresso", etapa } satisfies RespostaAditivo);
  try {
    carregando ??= carregar(avisar);
    carregando.catch(() => { carregando = null; });
    const py = await carregando;
    const ponte = py.pyimport("ponte_aditivo");
    const ok = (resultado: unknown, arquivo?: ArrayBuffer) =>
      ctx.postMessage({ id: p.id, tipo: "ok", resultado, arquivo } satisfies RespostaAditivo, arquivo ? [arquivo] : []);
    switch (p.tipo) {
      case "iniciar": ok(true); return;
      case "conferir": ok(JSON.parse(ponte.conferir(JSON.stringify(p.dados)))); return;
      case "sicaf": ok(JSON.parse(ponte.sicaf(p.texto, p.cnpj, ""))); return;
      case "consolidada_texto": ok(JSON.parse(ponte.consolidada_texto(p.texto))); return;
      case "consolidada_json": ok(JSON.parse(ponte.consolidada_json(JSON.stringify(p.json)))); return;
      case "juntar": {
        avisar("Juntando os PDFs…");
        py.FS.mkdirTree("/tmp/juntar");
        const caminhos = p.pdfs.map((b, i) => { const c = `/tmp/juntar/parte_${i + 1}.pdf`; py.FS.writeFile(c, new Uint8Array(b)); return c; });
        ponte.juntar(JSON.stringify(caminhos), "/tmp/juntar/final.pdf");
        const final = recortar(py.FS.readFile("/tmp/juntar/final.pdf"));
        for (const c of [...caminhos, "/tmp/juntar/final.pdf"]) py.FS.unlink(c);
        ok(true, final);
        return;
      }
      case "gerar": {
        avisar("Gerando os documentos do termo aditivo…");
        py.FS.mkdirTree("/tmp/extras");
        const extras = p.extras.map((x, i) => {
          // a extensão vai no caminho: o montar_zip.py do kit dá ao arquivo do .zip a extensão do anexo
          const ext = /\.[a-z0-9]{2,5}$/i.exec(x.nome)?.[0]?.toLowerCase() ?? ".pdf";
          const caminho = `/tmp/extras/extra_${i + 1}${ext}`;
          py.FS.writeFile(caminho, new Uint8Array(x.bytes));
          return { caminho, chave: x.chave };
        });
        const destino = "/tmp/aditivo.zip";
        const r = JSON.parse(ponte.gerar(JSON.stringify(p.dados), destino, JSON.stringify(extras)));
        const zip = recortar(py.FS.readFile(destino));
        py.FS.unlink(destino);
        for (const x of extras) py.FS.unlink(x.caminho);
        ok(r, zip);
        return;
      }
    }
  } catch (e) {
    ctx.postMessage({ id: p.id, tipo: "erro", erro: mensagem(e) } satisfies RespostaAditivo);
  }
};
