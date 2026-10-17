// Teste de fumaça da aba BD do Painel de Governança.
// Lê GAPMN_BD_URL e GAPMN_BD_TOKEN do .env.local, busca o doGet do Apps Script
// e mostra linhas, competências e a competência de referência (regra D.1).
// Nunca imprime a URL nem o token, e não grava a BD em disco.
//
// Uso (na pasta gapmn-app):  node scripts/indicadores-smoke.mjs

import { readFileSync } from "node:fs";

const COLUNAS = [
  "ID", "DIVISAO", "CATEGORIA", "INDICADOR", "UNIDADE", "FORMULA", "META_TXT", "META_NUM",
  "DIRECAO", "TIPO", "ANO", "MES_NUM", "MES", "DATA", "VALOR",
  "VAR1_NOME", "VAR1_VALOR", "VAR2_NOME", "VAR2_VALOR", "VAR3_NOME", "VAR3_VALOR",
];
const NUMERICAS = ["META_NUM", "ANO", "MES_NUM", "VALOR", "VAR1_VALOR", "VAR2_VALOR", "VAR3_VALOR"];
const DIVISOES = ["DRH", "DIE", "DA", "AJUR", "ASESO", "DOC", "ACI"];
const EXTRAS_ESPERADOS = {
  "Pendências do e-Pessoal": 18,
  "Plano de Contratações Anual": 5,
  "Ressarcimento ao Erário": 3,
};

function lerEnv(arquivo) {
  const env = {};
  for (const linha of readFileSync(arquivo, "utf8").split(/\r?\n/)) {
    const m = linha.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
  return env;
}

const env = lerEnv(new URL("../.env.local", import.meta.url));
const URL_BD = env.GAPMN_BD_URL, TOKEN = env.GAPMN_BD_TOKEN;
if (!URL_BD || !TOKEN) {
  console.error("GAPMN_BD_URL e GAPMN_BD_TOKEN precisam estar no .env.local");
  process.exit(1);
}
const limpar = (s) => String(s).split(URL_BD).join("<URL>").split(TOKEN).join("<TOKEN>");

const cmpId = (a, b) => {
  const pa = String(a).split(".").map(Number), pb = String(b).split(".").map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? -1) - (pb[i] ?? -1);
    if (d) return d;
  }
  return 0;
};
const rotulo = (r) => `${r.MES}/${String(r.ANO).slice(2)}`;
const contar = (lista, f) => lista.reduce((m, x) => (m[f(x)] = (m[f(x)] || 0) + 1, m), {});
const tab = (obj) => Object.entries(obj).map(([k, v]) => `${k}: ${v}`).join(" · ");

let payload;
try {
  const t0 = Date.now();
  const res = await fetch(`${URL_BD}?token=${encodeURIComponent(TOKEN)}`, { redirect: "follow" });
  const texto = await res.text();
  console.log(`HTTP ${res.status} em ${((Date.now() - t0) / 1000).toFixed(1)} s, ${(texto.length / 1024).toFixed(0)} KB`);
  try { payload = JSON.parse(texto); }
  catch { console.error("A resposta não é JSON. Início:", limpar(texto.slice(0, 200))); process.exit(1); }
} catch (e) {
  console.error("Falha na busca:", limpar(e?.cause?.message || e?.message || e));
  process.exit(1);
}
if (!payload.ok) { console.error("Endpoint recusou:", limpar(JSON.stringify(payload))); process.exit(1); }

const bd = payload.bd || [];
console.log(`Planilha: ${payload.planilha} | gerado em ${payload.gerado_em} (${payload.timezone})`);
console.log(`Linhas: BD = ${bd.length} | BD_integridade = ${(payload.bd_integridade || []).length}`);

// ── Contrato das colunas ──────────────────────────────────────────────────────
const vistas = new Set(bd.flatMap((r) => Object.keys(r)));
const faltam = COLUNAS.filter((c) => !vistas.has(c));
const sobram = [...vistas].filter((c) => !COLUNAS.includes(c));
console.log(`\nColunas: ${vistas.size} | faltam: ${faltam.join(", ") || "nenhuma"} | a mais: ${sobram.join(", ") || "nenhuma"}`);

// ── IDs ───────────────────────────────────────────────────────────────────────
const ids = [...new Set(bd.map((r) => r.ID))].sort(cmpId);
const idsRuins = ids.filter((id) => typeof id !== "string" || !/^\d+(\.\d+)?$/.test(id));
console.log(`\nIDs distintos: ${ids.length}`);
console.log(`IDs fora do padrão (ex.: viraram data): ${idsRuins.length ? idsRuins.map((x) => JSON.stringify(x)).join(", ") : "nenhum"}`);
console.log(`Ordem: ${ids.join(" ")}`);

// ── Tipos numéricos ───────────────────────────────────────────────────────────
const tiposRuins = [];
for (const r of bd) for (const c of NUMERICAS) {
  const v = r[c];
  if (v !== null && v !== undefined && typeof v !== "number") tiposRuins.push(`ID ${r.ID} ${rotulo(r)} ${c}=${JSON.stringify(v)}`);
}
console.log(`\nValores numéricos que vieram como texto: ${tiposRuins.length}`);
tiposRuins.slice(0, 15).forEach((x) => console.log("  " + x));
if (tiposRuins.length > 15) console.log(`  … e mais ${tiposRuins.length - 15}`);

// ── Domínios ──────────────────────────────────────────────────────────────────
const porIndicador = new Map();
for (const r of bd) if (!porIndicador.has(r.ID)) porIndicador.set(r.ID, r);
const inds = [...porIndicador.values()];
console.log(`\nIndicadores por divisão: ${tab(contar(inds, (r) => r.DIVISAO))}`);
const divDesconhecidas = [...new Set(bd.map((r) => r.DIVISAO))].filter((d) => !DIVISOES.includes(d));
console.log(`Divisões fora da lista canônica: ${divDesconhecidas.join(", ") || "nenhuma"}`);
console.log(`UNIDADE: ${tab(contar(inds, (r) => r.UNIDADE))}`);
console.log(`DIRECAO: ${tab(contar(inds, (r) => r.DIRECAO))}`);
console.log(`TIPO (linhas): ${tab(contar(bd, (r) => r.TIPO))}`);
console.log(`Indicadores sem META_NUM: ${inds.filter((r) => r.META_NUM === null).length}`);

const extras = inds.filter((r) => r.UNIDADE === "Quantidade");
const extrasPorCat = contar(extras, (r) => r.CATEGORIA);
console.log(`\nEXTRAS (UNIDADE='Quantidade'): ${extras.length} | IDs ${extras.map((r) => r.ID).sort(cmpId).join(" ")}`);
for (const [cat, esperado] of Object.entries(EXTRAS_ESPERADOS)) {
  const n = extrasPorCat[cat] || 0;
  console.log(`  ${cat}: ${n} itens ${n === esperado ? "✓" : `(esperado ${esperado})`}`);
}
const catsExtras = Object.keys(extrasPorCat).filter((c) => !(c in EXTRAS_ESPERADOS));
if (catsExtras.length) console.log(`  Outras categorias de EXTRAS: ${catsExtras.join(", ")}`);

for (const id of ["16", "22", "35"]) {
  const r = porIndicador.get(id);
  console.log(`ID ${id}: ${r ? `${r.DIVISAO} · ${r.INDICADOR} · meta ${r.META_TXT ?? "—"} (${r.META_NUM ?? "sem META_NUM"}) · ${r.DIRECAO}` : "NÃO ENCONTRADO"}`);
}

// ── Duplicidades ──────────────────────────────────────────────────────────────
const chaves = contar(bd, (r) => `${r.ID}|${r.TIPO}|${r.DATA}`);
const dup = Object.entries(chaves).filter(([, n]) => n > 1);
console.log(`\nLinhas repetidas (mesmo ID, TIPO e DATA): ${dup.length}${dup.length ? " → " + dup.slice(0, 10).map(([k, n]) => `${k} ×${n}`).join(", ") : ""}`);

// ── Competências ──────────────────────────────────────────────────────────────
console.log(`\nCompetências (${(payload.competencias || []).length}), com linhas preenchidas:`);
console.log("  label        DATA         com meta/monit.   EXTRAS (Quantidade)");
for (const c of payload.competencias || []) {
  const linhas = bd.filter((r) => r.DATA === c.data);
  const normais = linhas.filter((r) => r.UNIDADE !== "Quantidade");
  const qtd = linhas.filter((r) => r.UNIDADE === "Quantidade");
  const pn = normais.filter((r) => r.VALOR !== null).length;
  const pq = qtd.filter((r) => r.VALOR !== null).length;
  console.log(`  ${c.label.padEnd(12)} ${String(c.data).padEnd(12)} ${String(pn).padStart(3)} de ${String(normais.length).padEnd(9)} ${String(pq).padStart(3)} de ${qtd.length}`);
}
const jj = (payload.competencias || []).find((c) => c.label === "JAN-JUN/26");
console.log(`JAN-JUN/26 com DATA 2026-06-01: ${jj ? (jj.data === "2026-06-01" ? "✓" : `não, veio ${jj.data}`) : "competência não encontrada"}`);

// ── Competência de referência (D.1) ───────────────────────────────────────────
const comDado = (filtroQtd) => [...new Set(bd
  .filter((r) => r.VALOR !== null && (!filtroQtd || r.UNIDADE !== "Quantidade"))
  .map((r) => r.DATA))].sort();
const datas = comDado(true);
const lbl = (d) => (payload.competencias || []).find((c) => c.data === d)?.label ?? d;
const ref = datas.at(-1), ant = datas.at(-2);
console.log(`\n>>> Competência de referência: ${ref ? lbl(ref) : "nenhuma (sem dados)"}${ref ? ` (${ref})` : ""}`);
console.log(`>>> Competência anterior com dados: ${ant ? `${lbl(ant)} (${ant})` : "—"}`);
console.log(`    Competências com dados (sem EXTRAS): ${datas.map(lbl).join(", ") || "nenhuma"}`);
const semFiltro = comDado(false).at(-1);
if (semFiltro !== ref) console.log(`    Sem o filtro de 'Quantidade', a referência iria para ${lbl(semFiltro)}: o filtro está fazendo diferença.`);
