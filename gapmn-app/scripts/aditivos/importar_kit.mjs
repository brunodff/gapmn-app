// Traz para o app o kit de Termos Aditivos da SCON (pacote "Automacao-Aditivos_gapmnapp", do Chefe da SCON) e o
// deixa pronto para rodar no navegador (Pyodide), como o motor de reajuste.
//
//   node scripts/aditivos/importar_kit.mjs <pasta do pacote (a que tem kit/ e LEIA-ME.md)> [<pacote de revisão> …]
//
// Pacote de revisão que traz só os scripts novos (ex.: rev5.1, só o Parecer Técnico): passe depois do pacote completo;
// de cada arquivo vale o da última pasta que o tiver.
//
// Copia kit/*.py (menos o gerar_aditivo.py, que roda os outros por subprocesso: no navegador quem orquestra é a
// ponte_aditivo.py do app), kit/biblioteca_riscos.json e kit/brasao.png para src/lib/aditivos/kit/ e grava
// VERSAO.txt com o hash de cada arquivo. Recusa arquivo com CPF, e-mail ou CNPJ formatado (o repositório é público).
// Rode de novo sempre que a SCON mandar versão nova do kit.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const origens = process.argv.slice(2);
if (!origens.length) throw new Error("uso: node scripts/aditivos/importar_kit.mjs <pasta do pacote Automacao-Aditivos> [<pacote de revisão> …]");
const AQUI = path.dirname(new URL(import.meta.url).pathname).replace(/^\/([A-Z]:)/, "$1");
const DESTINO = path.join(AQUI, "..", "..", "src", "lib", "aditivos", "kit");
/** O arquivo na última pasta de pacote que o tiver */
const doKit = (nome) => [...origens].reverse().map((o) => path.join(o, "kit", nome)).find((c) => fs.existsSync(c));

const ARQUIVOS = [
  "pareceres.py", "gerar_lista_verificacao.py", "gerar_declaracao_orcamentaria.py", "gerar_declaracao_vantajosidade.py",
  "gerar_parecer_tecnico.py",
  "gerar_mapa_riscos.py", "gerar_pesquisa_precos.py", "gerar_ficha_autorizacao.py", "gerar_atestado_adequacao.py",
  "montar_zip.py", "verificar_sicaf.py", "consultar_regularidade.py", "biblioteca_riscos.json", "biblioteca_pareceres.json",
  "brasao.png",
];
const PESSOAL = [/\b\d{3}\.\d{3}\.\d{3}-\d{2}\b/, /[\w.-]+@[\w-]+\.[\w.]+/, /\b\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}\b/];

fs.mkdirSync(DESTINO, { recursive: true });
const versao = [`Kit de Termos Aditivos da SCON importado em ${new Date().toISOString().slice(0, 10)} de ${origens.map((o) => path.basename(path.resolve(o))).join(" + ")}`];
for (const nome of ARQUIVOS) {
  const de = doKit(nome);
  if (!de) throw new Error(`falta ${nome} no kit`);
  const bytes = fs.readFileSync(de);
  if (!nome.endsWith(".png")) {
    const txt = bytes.toString("utf8");
    for (const rx of PESSOAL) {
      const m = rx.exec(txt);
      if (m) throw new Error(`${nome}: parece dado pessoal ("${m[0]}"); confira antes de importar`);
    }
  }
  fs.writeFileSync(path.join(DESTINO, nome), bytes);
  versao.push(`${nome}  sha256 ${crypto.createHash("sha256").update(bytes).digest("hex").slice(0, 12)}`);
}
fs.writeFileSync(path.join(DESTINO, "VERSAO.txt"), versao.join("\n") + "\n");
// a tela usa a biblioteca de pareceres (objeto, órgão consultivo) sem import de JSON (os testes rodam no node puro)
const bib = JSON.parse(fs.readFileSync(doKit("biblioteca_pareceres.json"), "utf8"));
fs.writeFileSync(path.join(DESTINO, "..", "bibliotecaPareceres.ts"),
  "// Gerado por scripts/aditivos/importar_kit.mjs a partir de kit/biblioteca_pareceres.json (não editar à mão).\n" +
  `export const BIBLIOTECA_PARECERES = ${JSON.stringify(bib.pareceres, null, 1)} as const;\n`);
console.log(versao.join("\n"));
