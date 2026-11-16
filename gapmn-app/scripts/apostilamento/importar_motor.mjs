// Traz para o app o motor de reajuste por apostilamento da SCON (pacote "automacao-apostilamento",
// feito com o Chefe da SCON) e o deixa pronto para rodar no navegador (Pyodide).
//
//   node scripts/apostilamento/importar_motor.mjs <pasta do pacote>
//
// Copia apostilamento/gerar_apostilamento.py e apostilamento/brasao.jpg para src/lib/apostilamento/motor/ (o app os importa como texto e arquivo; roda no navegador pelo Pyodide).
// Os dados da Ordenadora de Despesas, do Agente de Controle Interno e o texto fixo do "I – CONTRATANTE"
// saem do código (o repositório é público): o app os passa ao motor a partir da tabela
// apostilamento_config. Rode de novo sempre que a SCON mandar versão nova do motor.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const origem = process.argv[2];
if (!origem) throw new Error("uso: node scripts/apostilamento/importar_motor.mjs <pasta do pacote automacao-apostilamento>");
const AQUI = path.dirname(new URL(import.meta.url).pathname).replace(/^\/([A-Z]:)/, "$1");
const DESTINO = path.join(AQUI, "..", "..", "src", "lib", "apostilamento", "motor");

const fonte = fs.readFileSync(path.join(origem, "apostilamento", "gerar_apostilamento.py"), "utf8");

/** Fim do bloco que abre no `{` da posição `ini` (conta chaves fora de strings). */
function fimDoBloco(txt, ini) {
  let n = 0, aspas = null;
  for (let i = ini; i < txt.length; i++) {
    const c = txt[i];
    if (aspas) { if (c === "\\") i++; else if (c === aspas) aspas = null; continue; }
    if (c === '"' || c === "'") aspas = c;
    else if (c === "{") n++;
    else if (c === "}" && --n === 0) return i + 1;
  }
  throw new Error("bloco sem fim");
}
function trocarBloco(txt, marca, novo) {
  const i = txt.indexOf(marca);
  if (i < 0) throw new Error(`não achei ${marca} no motor`);
  const abre = txt.indexOf("{", i);
  return txt.slice(0, i) + novo + txt.slice(fimDoBloco(txt, abre));
}

// valores pessoais do original, para conferir que não ficou nenhum
const pessoais = [];
for (const chave of ['"ordenador": {', '"aci": {']) {
  const i = fonte.indexOf(chave), abre = fonte.indexOf("{", i);
  for (const m of fonte.slice(abre, fimDoBloco(fonte, abre)).matchAll(/"(nome|portaria|publicacao|matricula)":\s*"([^"]+)"/g)) pessoais.push(m[2]);
}
if (pessoais.length < 4) throw new Error("formato do DEFAULTS mudou: confira o motor antes de importar");

let motor = fonte;
motor = trocarBloco(motor, '"ordenador": {', `"ordenador": {   # dados reais: tabela apostilamento_config do gapmn.app
        "nome": "«nome do Ordenador de Despesas»", "posto": "«posto»", "feminino": False,
        "portaria": "«portaria de nomeação»", "publicacao": "«publicação»", "matricula": "«matrícula»",
        "om_sigla": "GAP-MN",
    }`);
motor = trocarBloco(motor, '"aci": {', `"aci": {"nome": "«nome do ACI»", "posto": "«posto»", "funcao": "Agente de Controle Interno"}`);
motor = trocarBloco(motor, "TEXTOS_FIXOS_OM = {", "TEXTOS_FIXOS_OM = {}  # textos fixos por OM: tabela apostilamento_config do gapmn.app");
const sobrou = pessoais.filter((v) => motor.includes(v));
if (sobrou.length) throw new Error(`dado pessoal ainda no motor: ${sobrou.join(", ")}`);

fs.mkdirSync(DESTINO, { recursive: true });
fs.writeFileSync(path.join(DESTINO, "gerar_apostilamento.py"), motor);
fs.copyFileSync(path.join(origem, "apostilamento", "brasao.jpg"), path.join(DESTINO, "brasao.jpg"));
const hash = crypto.createHash("sha256").update(fonte).digest("hex").slice(0, 12);
fs.writeFileSync(path.join(DESTINO, "VERSAO.txt"),
  `Motor de reajuste por apostilamento da SCON (pacote automacao-apostilamento)\n` +
  `gerar_apostilamento.py original: sha256 ${hash}\nimportado em ${new Date().toISOString().slice(0, 10)}\n`);
console.log(`✓ src/lib/apostilamento/motor/gerar_apostilamento.py (${motor.length} caracteres, ${pessoais.length} dados pessoais retirados), brasao.jpg, VERSAO.txt`);
