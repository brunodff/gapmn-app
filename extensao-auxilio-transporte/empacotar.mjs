// Gera o pacote da extensão do Auxílio Transporte com as chaves reais embutidas.
// Uso: node extensao-auxilio-transporte/empacotar.mjs <arquivo .zip de saída> [<arquivo de acesso>]
// O repositório guarda só marcadores no config.js; este script fica de fora do pacote.
// As chaves vêm do arquivo de acesso (fora do repositório) e nunca são impressas.
import { cpSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const origem = path.dirname(fileURLToPath(import.meta.url));
const [destino, acesso = path.join(os.homedir(), "OneDrive", "Área de Trabalho", "Auxílio Transporte - acesso (não compartilhar).txt")] = process.argv.slice(2);
if (!destino) throw new Error("uso: node empacotar.mjs <saída.zip> [arquivo de acesso]");

const m = readFileSync(acesso, "utf8").match(/AT1\.([A-Za-z0-9_-]{20,})\.([A-Za-z0-9_-]{20,})/);
if (!m) throw new Error("não achei o código AT1.<envio>.<painel> no arquivo de acesso");
const [, envio, painel] = m;

const tmp = mkdtempSync(path.join(os.tmpdir(), "ext_at_"));
try {
  cpSync(origem, tmp, { recursive: true, filter: (p) => path.basename(p) !== "empacotar.mjs" });
  const arq = path.join(tmp, "config.js");
  const antes = readFileSync(arq, "utf8");
  if (!antes.includes('"__CHAVE_DE_ENVIO__"') || !antes.includes('"__CODIGO_DO_PAINEL__"')) throw new Error("config.js sem os marcadores esperados");
  writeFileSync(arq, antes.replace('"__CHAVE_DE_ENVIO__"', JSON.stringify(envio)).replace('"__CODIGO_DO_PAINEL__"', JSON.stringify(painel)));

  // nada de marcador sobrando em arquivo nenhum
  const sobra = [];
  const varrer = (d) => { for (const n of readdirSync(d)) { const p = path.join(d, n); if (statSync(p).isDirectory()) varrer(p); else if (/\.(js|json|html|css)$/.test(n) && /__(CHAVE_DE_ENVIO|CODIGO_DO_PAINEL)__/.test(readFileSync(p, "utf8"))) sobra.push(n); } };
  varrer(tmp);
  if (sobra.length) throw new Error("marcador sobrando em " + sobra.join(", "));

  const manifesto = JSON.parse(readFileSync(path.join(tmp, "manifest.json"), "utf8"));
  if (existsSync(destino)) rmSync(destino);
  execFileSync("powershell.exe", ["-NoProfile", "-Command", "Compress-Archive -Path (Join-Path $env:ORIGEM '*') -DestinationPath $env:DESTINO"],
    { env: { ...process.env, ORIGEM: tmp, DESTINO: destino }, stdio: "inherit" });
  const impressao = (v) => createHash("sha256").update(v).digest("hex").slice(0, 8);
  console.log(`pacote ${path.basename(destino)} · versão ${manifesto.version} · ${statSync(destino).size} bytes`);
  console.log(`chave de envio sha256:${impressao(envio)}… · código do painel sha256:${impressao(painel)}…`);
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
