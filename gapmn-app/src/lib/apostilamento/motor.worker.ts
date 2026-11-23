// Roda o motor de reajuste da SCON (Python) no navegador, num worker: Pyodide (Python em WebAssembly) com
// python-docx e openpyxl. Nada sai do computador de quem usa: os documentos são gerados aqui e voltam
// como .zip. Na primeira vez o navegador baixa cerca de 15 MB (Pyodide e pacotes), que ficam em cache.
import motorPy from "./motor/gerar_apostilamento.py?raw";
import indiceFgvPy from "./motor/indice_fgv.py?raw";
import indiceBcbPy from "./motor/indice_bcb.py?raw";
import checklistPy from "./motor/checklist.py?raw";
import pontePy from "./motor/ponte.py?raw";
import brasaoUrl from "./motor/brasao.jpg?url";

const PYODIDE = "https://cdn.jsdelivr.net/pyodide/v314.0.7/full/";

type Py = {
  loadPackage: (p: string[]) => Promise<void>;
  pyimport: (m: string) => any; // eslint-disable-line @typescript-eslint/no-explicit-any
  runPython: (c: string) => unknown;
  FS: { mkdirTree: (p: string) => void; writeFile: (p: string, d: string | Uint8Array) => void; readFile: (p: string) => Uint8Array; unlink: (p: string) => void };
};

export type Pedido =
  | { id: number; tipo: "iniciar" }
  | { id: number; tipo: "checar"; dados: unknown; config: unknown }
  | { id: number; tipo: "gerar"; dados: unknown; config: unknown; prints: { nome: string; bytes: ArrayBuffer }[]; zip: boolean; checklist?: unknown }
  | { id: number; tipo: "checklist"; dados: unknown; config: unknown; checklist: unknown };

export type Resposta =
  | { id: number; tipo: "progresso"; etapa: string }
  | { id: number; tipo: "ok"; resultado: unknown; zip?: ArrayBuffer }
  | { id: number; tipo: "erro"; erro: string };

// (sem a lib "webworker" no tsconfig, que briga com a lib DOM do resto do app)
const ctx = self as unknown as {
  postMessage: (m: Resposta, transferir?: Transferable[]) => void;
  onmessage: ((ev: MessageEvent<Pedido>) => void) | null;
};
let carregando: Promise<Py> | null = null;

async function carregar(avisar: (etapa: string) => void): Promise<Py> {
  avisar("Baixando o Python do navegador (só na primeira vez)…");
  const { loadPyodide } = await import(/* @vite-ignore */ `${PYODIDE}pyodide.mjs`);
  const py: Py = await loadPyodide({ indexURL: PYODIDE });
  avisar("Instalando python-docx e openpyxl…");
  await py.loadPackage(["micropip", "lxml", "typing-extensions"]);
  await py.pyimport("micropip").install(["python-docx", "openpyxl"]);
  avisar("Carregando o motor da SCON…");
  py.FS.mkdirTree("/motor");
  py.FS.writeFile("/motor/gerar_apostilamento.py", motorPy);
  py.FS.writeFile("/motor/indice_fgv.py", indiceFgvPy);
  py.FS.writeFile("/motor/indice_bcb.py", indiceBcbPy);
  py.FS.writeFile("/motor/checklist.py", checklistPy);
  py.FS.writeFile("/motor/ponte.py", pontePy);
  py.FS.writeFile("/motor/brasao.jpg", new Uint8Array(await (await fetch(brasaoUrl)).arrayBuffer()));
  py.runPython("import sys; sys.path.insert(0, '/motor'); import ponte");
  return py;
}

/** Erro do Python: só a última linha (a mensagem), sem o traceback. */
function mensagem(e: unknown): string {
  const t = e instanceof Error ? e.message : String(e);
  const linhas = t.trim().split("\n").filter(Boolean);
  const ult = linhas[linhas.length - 1] ?? t;
  return ult.replace(/^(\w+Error|SystemExit):\s*/, "") || t;
}

ctx.onmessage = async (ev: MessageEvent<Pedido>) => {
  const p = ev.data;
  const avisar = (etapa: string) => ctx.postMessage({ id: p.id, tipo: "progresso", etapa } satisfies Resposta);
  try {
    carregando ??= carregar(avisar);
    carregando.catch(() => { carregando = null; });
    const py = await carregando;
    const ponte = py.pyimport("ponte");
    if (p.tipo === "iniciar") { ctx.postMessage({ id: p.id, tipo: "ok", resultado: true } satisfies Resposta); return; }
    if (p.tipo === "checar") {
      const r = JSON.parse(ponte.checar(JSON.stringify(p.dados), JSON.stringify(p.config)));
      ctx.postMessage({ id: p.id, tipo: "ok", resultado: r } satisfies Resposta);
      return;
    }
    if (p.tipo === "checklist") {
      avisar("Gerando o checklist…");
      const destino = "/tmp/checklist.docx";
      const r = JSON.parse(ponte.checklist(JSON.stringify(p.dados), JSON.stringify(p.config), JSON.stringify(p.checklist), destino));
      const bytes = py.FS.readFile(destino);
      py.FS.unlink(destino);
      const docx = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
      ctx.postMessage({ id: p.id, tipo: "ok", resultado: r, zip: docx } satisfies Resposta, [docx]);
      return;
    }
    avisar(p.zip ? "Gerando os documentos…" : "Calculando…");
    py.FS.mkdirTree("/tmp/prints");
    const caminhos = p.prints.map((f, i) => {
      const ext = (/\.(png|jpe?g)$/i.exec(f.nome)?.[1] ?? "png").toLowerCase();
      const c = `/tmp/prints/print_${i + 1}.${ext}`;
      py.FS.writeFile(c, new Uint8Array(f.bytes));
      return c;
    });
    const destino = p.zip ? "/tmp/apostilamento.zip" : "";
    const r = JSON.parse(ponte.gerar(JSON.stringify(p.dados), JSON.stringify(p.config), JSON.stringify(caminhos), destino,
      p.checklist ? JSON.stringify(p.checklist) : ""));
    if (!destino) { ctx.postMessage({ id: p.id, tipo: "ok", resultado: r } satisfies Resposta); return; }
    const bytes = py.FS.readFile(destino);
    py.FS.unlink(destino);
    const zip = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
    ctx.postMessage({ id: p.id, tipo: "ok", resultado: r, zip } satisfies Resposta, [zip]);
  } catch (e) {
    ctx.postMessage({ id: p.id, tipo: "erro", erro: mensagem(e) } satisfies Resposta);
  }
};
