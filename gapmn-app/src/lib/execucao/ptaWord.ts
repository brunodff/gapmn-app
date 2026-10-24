// Minuta do PTA em Word (.docx). O documento nasce de uma cópia do PTA em vigor, que mantém a formatação
// aprovada, e o app só mexe no que é dele:
// - troca o cap. VII (Composição Orçamentária) pelo da minuta do painel, no formato das tabelas que já estão lá;
// - renumera os artigos do anexo e o sumário;
// - refaz os códigos de tarefa na ordem do documento: ano + trigrama + sequencial do trigrama, sem repetir nem
//   saltar. Desde o PTA 2027 o trigrama é o do macroprocesso da Matriz de Atividades e Tarefas Mínimas da DIRAD
//   (ptaMatriz.ts): as tarefas da Matriz mantêm o código e as próprias do GAP-MN continuam depois delas. Trigrama
//   de setor (PTA 2026 e anteriores, DCA 11-1/2020, Anexo G, item VI) segue numerado do 001. A mesma tarefa que
//   aparece de novo no cap. VII fica com o mesmo código.
// O resto do texto é de quem edita no Word.

import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { ACAO_A_CONFIRMAR, totalArtigo } from "./pta.ts";
import { ehDaMatriz, ultimoDaMatriz } from "./ptaMatriz.ts";
import type { ConteudoCap7 } from "./ptaMinuta.ts";

export const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

// ─── XML ──────────────────────────────────────────────────────────────────────

const ESC: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" };
export const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ESC[c]);
const ENT: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
const desc = (s: string) => s.replace(/&(amp|lt|gt|quot|apos|#\d+|#x[0-9a-f]+);/gi, (_m, n: string) =>
  n[0] === "#" ? String.fromCodePoint(n[1] === "x" || n[1] === "X" ? parseInt(n.slice(2), 16) : Number(n.slice(1))) : ENT[n.toLowerCase()]);
const escRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Texto visível de um trecho de XML do Word (só os w:t, na ordem). */
export function texto(xml: string): string {
  let s = "";
  for (const m of xml.matchAll(/<w:t(?: [^>]*)?>([^<]*)<\/w:t>/g)) s += desc(m[1]);
  return s;
}
const limpo = (xml: string) => texto(xml).replace(/\s+/g, " ").trim();

type Tag = "w:p" | "w:tbl" | "w:tr" | "w:tc";

/** Fim (exclusivo) do elemento `tag` que abre em `ini`, contando os aninhados. */
function fimDe(xml: string, ini: number, tag: Tag): number {
  const re = new RegExp(`<${tag}(?=[ >/])|</${tag}>`, "g");
  re.lastIndex = ini;
  let d = 0;
  for (let m = re.exec(xml); m; m = re.exec(xml)) {
    if (m[0][1] === "/") { d--; if (d === 0) return m.index + m[0].length; continue; }
    const fecha = xml.indexOf(">", m.index);
    if (xml[fecha - 1] === "/") { if (d === 0) return fecha + 1; continue; }
    d++;
  }
  return xml.length;
}

/** Elementos `tag` do primeiro nível de `xml` (os aninhados ficam dentro do pai). */
export function filhos(xml: string, tag: Tag): { ini: number; fim: number }[] {
  const out: { ini: number; fim: number }[] = [];
  const re = new RegExp(`<${tag}(?=[ >/])`, "g");
  for (let m = re.exec(xml); m; m = re.exec(xml)) {
    const fim = fimDe(xml, m.index, tag);
    out.push({ ini: m.index, fim });
    re.lastIndex = fim;
  }
  return out;
}

type Bloco = { tipo: "p" | "tbl" | "sect"; ini: number; fim: number };

/** Parágrafos e tabelas do corpo do documento, na ordem. */
export function blocos(corpo: string): Bloco[] {
  const out: Bloco[] = [];
  const re = /<w:(p|tbl|sectPr)(?=[ >/])/g;
  for (let m = re.exec(corpo); m; m = re.exec(corpo)) {
    let fim: number;
    if (m[1] === "sectPr") {
      const f = corpo.indexOf("</w:sectPr>", m.index);
      fim = f < 0 ? corpo.length : f + 11;
      out.push({ tipo: "sect", ini: m.index, fim });
    } else {
      fim = fimDe(corpo, m.index, m[1] === "p" ? "w:p" : "w:tbl");
      out.push({ tipo: m[1] === "p" ? "p" : "tbl", ini: m.index, fim });
    }
    re.lastIndex = fim;
  }
  return out;
}

/**
 * Troca, no texto de um trecho de XML (parágrafo, célula), a primeira ocorrência de `re` por `novo`,
 * mesmo quando o Word quebrou o texto em vários runs. O texto novo fica no run onde o trecho começava.
 */
export function trocarTexto(xml: string, re: RegExp, novo: string | ((m: RegExpExecArray) => string)): string {
  const nos = [...xml.matchAll(/<w:t(?: [^>]*)?>([^<]*)<\/w:t>/g)].map((m) => ({ ini: m.index!, fim: m.index! + m[0].length, txt: desc(m[1]) }));
  if (!nos.length) return xml;
  const tudo = nos.map((n) => n.txt).join("");
  const m = new RegExp(re.source, re.flags.replace("g", "")).exec(tudo);
  if (!m) return xml;
  const subst = typeof novo === "string" ? novo : novo(m);
  const a = m.index;
  const b = a + m[0].length;
  const ini: number[] = [];
  nos.reduce((s, n) => { ini.push(s); return s + n.txt.length; }, 0);
  let primeiro = nos.findIndex((n, k) => ini[k] <= a && a < ini[k] + n.txt.length);
  if (primeiro < 0) primeiro = nos.length - 1;
  let out = "";
  let cur = 0;
  nos.forEach((n, k) => {
    const i0 = ini[k];
    const i1 = i0 + n.txt.length;
    let t = n.txt;
    if (k === primeiro || (i0 < b && i1 > a)) {
      const antes = t.slice(0, Math.max(0, Math.min(t.length, a - i0)));
      const depois = t.slice(Math.max(0, Math.min(t.length, b - i0)));
      t = antes + (k === primeiro ? subst : "") + depois;
    }
    out += xml.slice(cur, n.ini) + (t === n.txt ? xml.slice(n.ini, n.fim) : `<w:t xml:space="preserve">${esc(t)}</w:t>`);
    cur = n.fim;
  });
  return out + xml.slice(cur);
}

/** Propriedades do run com realce amarelo, na posição que o esquema do Word exige. */
export function comRealce(rPr: string): string {
  const hl = '<w:highlight w:val="yellow"/>';
  if (!rPr) return `<w:rPr>${hl}</w:rPr>`;
  if (/<w:highlight [^>]*\/>/.test(rPr)) return rPr.replace(/<w:highlight [^>]*\/>/, hl);
  const m = /<w:(u|effect|bdr|shd|fitText|vertAlign|rtl|cs|em|lang|eastAsianLayout|specVanish|oMath|rPrChange)(?=[ />])/.exec(rPr);
  if (m) return rPr.slice(0, m.index) + hl + rPr.slice(m.index);
  return rPr.replace("</w:rPr>", `${hl}</w:rPr>`);
}

export type Trecho = { t: string; realce?: boolean };

const run = (t: string, rPr: string) => `<w:r>${rPr}<w:t xml:space="preserve">${esc(t)}</w:t></w:r>`;

/** rPr dos runs com texto de um parágrafo, na ordem. */
function rPrDosRuns(p: string): string[] {
  const fimPPr = p.indexOf("</w:pPr>");
  const resto = fimPPr < 0 ? p : p.slice(fimPPr);
  const out: string[] = [];
  for (const m of resto.matchAll(/<w:r(?: [^>]*)?>([\s\S]*?)<\/w:r>/g)) {
    if (!/<w:t[ >]/.test(m[1])) continue;
    out.push(/^\s*(<w:rPr>[\s\S]*?<\/w:rPr>)/.exec(m[1])?.[1] ?? "");
  }
  return out;
}

const semIds = (tag: string) => tag.replace(/\s+w14:(paraId|textId)="[^"]*"/g, "");

/** Parágrafo com a formatação de `modelo` e o texto `trechos` (cada trecho pode pedir o rPr de um run do modelo). */
function paragrafo(modelo: string, trechos: (Trecho & { run?: number })[]): string {
  const abre = semIds(/^<w:p(?: [^>]*)?>/.exec(modelo)?.[0] ?? "<w:p>");
  const pPr = /<w:pPr>[\s\S]*?<\/w:pPr>/.exec(modelo)?.[0] ?? "";
  const rPrs = rPrDosRuns(modelo);
  const corpo = trechos.filter((t) => t.t).map((t) => {
    const base = rPrs[Math.min(t.run ?? 0, rPrs.length - 1)] ?? "";
    return run(t.t, t.realce ? comRealce(base) : base);
  }).join("");
  return `${abre}${pPr}${corpo}</w:p>`;
}

function celula(modelo: string, trechos: Trecho[]): string {
  const abre = /^<w:tc(?: [^>]*)?>/.exec(modelo)?.[0] ?? "<w:tc>";
  const tcPr = /^<w:tc(?: [^>]*)?>\s*(<w:tcPr>[\s\S]*?<\/w:tcPr>)/.exec(modelo)?.[1] ?? "";
  const ps = filhos(modelo, "w:p");
  const p = ps.length ? modelo.slice(ps[0].ini, ps[0].fim) : "<w:p></w:p>";
  return `${abre}${tcPr}${paragrafo(p, trechos)}</w:tc>`;
}

function linha(modelo: string, celulas: Trecho[][]): string {
  const tcs = filhos(modelo, "w:tc");
  if (!tcs.length) return modelo;
  const prefixo = modelo.slice(0, tcs[0].ini);
  const cels = celulas.map((c, k) => celula(modelo.slice(tcs[Math.min(k, tcs.length - 1)].ini, tcs[Math.min(k, tcs.length - 1)].fim), c));
  return `${prefixo}${cels.join("")}</w:tr>`;
}

// ─── Capítulo VII ─────────────────────────────────────────────────────────────

const fmtNum = (v: number) => (Number(v) || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const ordinal = (n: number) => (n < 10 ? `${n}º` : String(n));
const RE_ARTIGO = /^\s*Art\.?\s*(\d+)(?:\s*[º°])?/;
const RE_CODIGO = /^(\d{2})([A-Z]{3})(\d{3})$/;
const marca = (k: number) => `§T${k}§`;
const RE_MARCA = /^§T(\d+)§$/;

type Modelos = { artigo: string; abreTabela: string; cabecalho: string; linha: string; vazio: string };

function montarCap7(m: Modelos, c: ConteudoCap7, primeiro: number): string {
  let k = 0;
  return c.artigos.map((a, i) => {
    const pendente = !a.acao || a.acao === ACAO_A_CONFIRMAR;
    const titulo = paragrafo(m.artigo, [
      { t: `Art. ${ordinal(primeiro + i)}  `, run: 0 },
      { t: `${a.titulo} – ND ${a.nd} – Ação: `, run: 1 },
      { t: pendente ? "«a confirmar»" : a.acao, realce: pendente, run: 1 },
      { t: ` – R$ ${fmtNum(totalArtigo(a))}`, run: 1 },
    ]);
    const linhas = a.tarefas.map((t) => linha(m.linha, [
      [{ t: marca(k++) }],
      [t.periodo.trim() ? { t: t.periodo.trim() } : { t: "«período»", realce: true }],
      [t.descricao.trim() ? { t: t.descricao.trim() } : { t: "«tarefa»", realce: true }],
      [{ t: fmtNum(t.valor) }],
    ]));
    return `${titulo}${m.abreTabela}${m.cabecalho}${linhas.join("")}</w:tbl>${m.vazio}`;
  }).join("");
}

/** Normaliza a descrição da tarefa para reconhecer a mesma tarefa em capítulos diferentes. */
const chaveTarefa = (s: string) => s.toLowerCase().normalize("NFD").replace(/\p{M}/gu, "").replace(/[^a-z0-9]+/g, " ").trim();

/**
 * Refaz os códigos de tarefa de todas as tabelas, na ordem do documento. Células com a marca §Tk§ são as
 * tarefas novas do cap. VII (o código antigo e a descrição vêm de `cap7`).
 */
function renumerarCodigos(corpo: string, aa: string, cap7: { codigo: string; descricao: string }[]) {
  const cont = new Map<string, number>();
  const vistos = new Map<string, string>();
  const novos: string[] = new Array(cap7.length).fill("");
  const trocas: [string, string][] = [];
  const semSetor: string[] = [];
  let out = "";
  let cur = 0;
  for (const b of blocos(corpo)) {
    if (b.tipo !== "tbl") continue;
    const tbl = corpo.slice(b.ini, b.fim);
    let nova = "";
    let c2 = 0;
    for (const r of filhos(tbl, "w:tr")) {
      const tr = tbl.slice(r.ini, r.fim);
      const tcs = filhos(tr, "w:tc").map((c) => ({ ...c, txt: limpo(tr.slice(c.ini, c.fim)) }));
      const i = tcs.findIndex((c) => RE_CODIGO.test(c.txt) || RE_MARCA.test(c.txt));
      if (i < 0) continue;
      const mk = RE_MARCA.exec(tcs[i].txt);
      const antigo = mk ? cap7[Number(mk[1])].codigo.trim().toUpperCase() : tcs[i].txt;
      const desc0 = mk ? cap7[Number(mk[1])].descricao : tcs.filter((_c, j) => j !== i).reduce((x, c) => (c.txt.length > x.length ? c.txt : x), "");
      const cod = RE_CODIGO.exec(antigo);
      let novo: string;
      if (!cod) {
        novo = "«código»";
        semSetor.push(desc0.slice(0, 60));
      } else if (ehDaMatriz(cod[2], Number(cod[3]))) {
        // tarefa da Matriz da DIRAD: código fixo, só o ano acompanha o PTA
        novo = `${aa}${cod[2]}${cod[3]}`;
      } else {
        const chave = `${antigo}|${chaveTarefa(desc0)}`;
        novo = vistos.get(chave) ?? "";
        if (!novo) {
          const n = (cont.get(cod[2]) ?? ultimoDaMatriz(cod[2])) + 1;
          cont.set(cod[2], n);
          novo = `${aa}${cod[2]}${String(n).padStart(3, "0")}`;
          vistos.set(chave, novo);
        }
      }
      if (mk) novos[Number(mk[1])] = novo;
      else if (novo !== antigo) trocas.push([antigo, novo]);
      const tc = tr.slice(tcs[i].ini, tcs[i].fim);
      let tcNovo = trocarTexto(tc, new RegExp(escRe(tcs[i].txt)), novo);
      if (!cod) tcNovo = tcNovo.replace(/<w:r>(<w:rPr>[\s\S]*?<\/w:rPr>)?(<w:t xml:space="preserve">«código»<\/w:t>)/, (_m, rp: string | undefined, t: string) => `<w:r>${comRealce(rp ?? "")}${t}`);
      nova += tbl.slice(c2, r.ini) + tr.slice(0, tcs[i].ini) + tcNovo + tr.slice(tcs[i].fim);
      c2 = r.fim;
    }
    out += corpo.slice(cur, b.ini) + nova + tbl.slice(c2);
    cur = b.fim;
  }
  return { corpo: out + corpo.slice(cur), novos, trocas, semSetor };
}

const titulos = (corpo: string, bs: Bloco[]) => bs.map((b) => (b.tipo === "p" ? limpo(corpo.slice(b.ini, b.fim)) : ""));

function indices(corpo: string, bs: Bloco[]) {
  const t = titulos(corpo, bs);
  const i8 = t.findIndex((x) => /^CAP[IÍ]TULO VIII$/i.test(x));
  let i7 = -1;
  for (let k = (i8 < 0 ? t.length : i8) - 1; k >= 0; k--) if (/^CAP[IÍ]TULO VII$/i.test(t[k])) { i7 = k; break; }
  const iSumario = t.findIndex((x) => /^SUMÁRIO$/i.test(x));
  const i1 = t.findIndex((x, k) => k > iSumario && /^CAP[IÍ]TULO I$/i.test(x));
  return { t, i1, i7, i8, iSumario };
}

export type ResultadoWord = { xml: string; conteudo: ConteudoCap7; mudancas: string[]; avisos: string[]; comentariosRemovidos: string[] };

/**
 * Põe o cap. VII da minuta no document.xml do PTA: substitui os artigos e tabelas do capítulo, renumera os
 * artigos do anexo (o da portaria fica de fora), o sumário e os códigos de tarefa. Devolve também a minuta com
 * os códigos e o número do primeiro artigo que ficaram no Word.
 */
export function aplicarCap7(documentXml: string, conteudo: ConteudoCap7): ResultadoWord {
  const iBody = documentXml.indexOf("<w:body>");
  const fBody = documentXml.lastIndexOf("</w:body>");
  if (iBody < 0 || fBody < 0) throw new Error("O arquivo não parece um documento do Word.");
  let corpo = documentXml.slice(iBody + 8, fBody);
  const aa = String(conteudo.ano).slice(-2);
  const avisos: string[] = [];
  const mudancas: string[] = [];

  // ── 1. onde está o cap. VII e o formato das tabelas dele
  let bs = blocos(corpo);
  let ix = indices(corpo, bs);
  if (ix.i1 < 0) throw new Error("Não achei o título “CAPÍTULO I” (depois do sumário) no Word: é dele que começa a numeração dos artigos.");
  if (ix.i7 < 0 || ix.i8 < 0) throw new Error("Não achei os títulos “CAPÍTULO VII” e “CAPÍTULO VIII” no Word, cada um num parágrafo só dele.");
  let iArt = -1;
  let iUlt = -1;
  let iTab = -1;
  for (let k = ix.i7 + 1; k < ix.i8; k++) {
    if (iArt < 0 && bs[k].tipo === "p" && RE_ARTIGO.test(ix.t[k])) iArt = k;
    if (iArt >= 0 && bs[k].tipo === "tbl") { iUlt = k; if (iTab < 0) iTab = k; }
  }
  if (iArt < 0 || iTab < 0) throw new Error("O cap. VII do Word precisa ter ao menos um artigo com tabela, para o app copiar o formato.");
  const tbl = corpo.slice(bs[iTab].ini, bs[iTab].fim);
  const trs = filhos(tbl, "w:tr");
  if (trs.length < 2) throw new Error("A tabela do cap. VII no Word precisa ter o cabeçalho e ao menos uma linha de tarefa.");
  const posTab = bs[iTab + 1];
  const vazio = posTab && posTab.tipo === "p" && !limpo(corpo.slice(posTab.ini, posTab.fim)) && !corpo.slice(posTab.ini, posTab.fim).includes("<w:sectPr")
    ? semIds(corpo.slice(posTab.ini, posTab.fim)) : "<w:p/>";
  const modelos: Modelos = {
    artigo: corpo.slice(bs[iArt].ini, bs[iArt].fim),
    abreTabela: tbl.slice(0, trs[0].ini),
    cabecalho: semIds(tbl.slice(trs[0].ini, trs[0].fim)),
    linha: tbl.slice(trs[1].ini, trs[1].fim),
    vazio,
  };

  // ── 2. artigos antes do cap. VII → número do primeiro artigo dele
  const antes: number[] = [];
  for (let k = ix.i1; k < ix.i7; k++) if (bs[k].tipo === "p" && RE_ARTIGO.test(ix.t[k])) antes.push(k);
  const primeiro = antes.length + 1;
  const artigosVelhos = (() => { let n = 0; for (let k = ix.i7 + 1; k < ix.i8; k++) if (bs[k].tipo === "p" && RE_ARTIGO.test(ix.t[k])) n++; return n; })();

  // ── 3. troca o capítulo (do primeiro artigo ao fim da última tabela)
  const removido = corpo.slice(bs[iArt].ini, bs[iUlt].fim);
  const comentariosRemovidos = [...new Set([...removido.matchAll(/<w:comment(?:RangeStart|RangeEnd|Reference) [^>]*w:id="(\d+)"/g)].map((m) => m[1]))];
  corpo = corpo.slice(0, bs[iArt].ini) + montarCap7(modelos, conteudo, primeiro) + corpo.slice(bs[iUlt].fim);
  for (const id of comentariosRemovidos) {
    corpo = corpo.replace(new RegExp(`<w:comment(?:RangeStart|RangeEnd) [^>]*w:id="${id}"[^>]*/>`, "g"), "")
      .replace(new RegExp(`<w:r(?: [^>]*)?>(?:(?!</w:r>)[\\s\\S])*?<w:commentReference [^>]*w:id="${id}"[^>]*/>(?:(?!</w:r>)[\\s\\S])*?</w:r>`, "g"), "");
  }
  if (comentariosRemovidos.length) avisos.push(`${comentariosRemovidos.length} comentário(s) do Word que estavam dentro do cap. VII saíram com o capítulo antigo.`);

  // ── 4. renumera os artigos do anexo
  bs = blocos(corpo);
  ix = indices(corpo, bs);
  const deNovo = new Map<number, number>();
  const mudaram: [number, number][] = [];
  let n = 0;
  let saida = "";
  let cur = 0;
  let ult7 = primeiro - 1;
  for (let k = ix.i1; k < bs.length; k++) {
    if (bs[k].tipo !== "p") continue;
    const m = RE_ARTIGO.exec(ix.t[k]);
    if (!m) continue;
    n++;
    const velho = Number(m[1]);
    const no7 = k > ix.i7 && k < ix.i8;
    if (no7) ult7 = n;
    else if (!deNovo.has(velho)) deNovo.set(velho, n);
    if (!no7 && velho !== n) mudaram.push([velho, n]);
    const p = corpo.slice(bs[k].ini, bs[k].fim);
    const novoP = trocarTexto(p, RE_ARTIGO, `Art. ${ordinal(n)}`);
    saida += corpo.slice(cur, bs[k].ini) + novoP;
    cur = bs[k].fim;
  }
  corpo = saida + corpo.slice(cur);
  mudancas.push(`Cap. VII: ${conteudo.artigos.length} artigos (arts. ${primeiro} a ${ult7}, antes eram ${artigosVelhos}) e ${conteudo.artigos.reduce((s, a) => s + a.tarefas.length, 0)} tarefas, total R$ ${fmtNum(conteudo.artigos.reduce((s, a) => s + totalArtigo(a), 0))}.`);
  if (mudaram.length) mudancas.push(`Artigos renumerados fora do cap. VII: ${mudaram.length} (ex.: art. ${mudaram[0][0]} → ${mudaram[0][1]}${mudaram.length > 1 ? `, art. ${mudaram[mudaram.length - 1][0]} → ${mudaram[mudaram.length - 1][1]}` : ""}).`);

  // ── 5. sumário
  bs = blocos(corpo);
  ix = indices(corpo, bs);
  let nSumario = 0;
  if (ix.iSumario >= 0) {
    saida = "";
    cur = 0;
    for (let k = ix.iSumario + 1; k < ix.i1; k++) {
      if (bs[k].tipo !== "p") continue;
      const t = ix.t[k];
      const m = /(\d+)\s*[º°]?(?:\s*\/\s*(\d+)\s*[º°]?)?\s*$/.exec(t);
      if (!m || /^Art\.?$/i.test(t)) continue;
      let valor: string;
      if (/^CAP[IÍ]TULO VII\b(?!I)/i.test(t)) valor = primeiro === ult7 ? ordinal(primeiro) : `${ordinal(primeiro)}/${ordinal(ult7)}`;
      else {
        const a = deNovo.get(Number(m[1]));
        const b = m[2] ? deNovo.get(Number(m[2])) : undefined;
        if (a === undefined || (m[2] && b === undefined)) { avisos.push(`Sumário: não achei o artigo de “${t.slice(0, 60)}”. Conferir à mão.`); continue; }
        valor = b !== undefined ? `${ordinal(a)}/${ordinal(b)}` : ordinal(a);
      }
      const atual = m[0].replace(/\s+/g, "");
      if (atual === valor) continue;
      const p = corpo.slice(bs[k].ini, bs[k].fim);
      saida += corpo.slice(cur, bs[k].ini) + trocarTexto(p, /(\d+)\s*[º°]?(?:\s*\/\s*(\d+)\s*[º°]?)?\s*$/, valor);
      cur = bs[k].fim;
      nSumario++;
    }
    corpo = saida + corpo.slice(cur);
  } else avisos.push("Não achei o sumário (título “SUMÁRIO”): os números de artigo dele não foram atualizados.");
  if (nSumario) mudancas.push(`Sumário: ${nSumario} linha(s) com os números de artigo atualizados.`);

  // ── 6. citações a artigos que mudaram de número
  if (mudaram.length) {
    const mudou = new Set(mudaram.map((x) => x[0]));
    bs = blocos(corpo);
    ix = indices(corpo, bs);
    const citacoes: string[] = [];
    for (let k = ix.i1; k < bs.length; k++) {
      const t = ix.t[k] || limpo(corpo.slice(bs[k].ini, bs[k].fim));
      for (const m of t.replace(RE_ARTIGO, "").matchAll(/\bart(?:igo)?s?\.?\s*(\d+)/gi)) {
        if (mudou.has(Number(m[1]))) citacoes.push(`“${m[0]}” em “${t.slice(0, 50)}…”`);
      }
    }
    if (citacoes.length) avisos.push(`O texto cita artigo que mudou de número (conferir se a citação é deste PTA): ${citacoes.slice(0, 5).join("; ")}${citacoes.length > 5 ? ` e mais ${citacoes.length - 5}` : ""}.`);
  }

  // ── 7. códigos de tarefa
  const tarefas = conteudo.artigos.flatMap((a) => a.tarefas);
  const r = renumerarCodigos(corpo, aa, tarefas);
  corpo = r.corpo;
  const novoConteudo: ConteudoCap7 = JSON.parse(JSON.stringify(conteudo));
  novoConteudo.primeiroArtigo = primeiro;
  let k = 0;
  let trocados7 = 0;
  for (const a of novoConteudo.artigos) for (const t of a.tarefas) {
    const novo = r.novos[k++];
    if (novo && novo !== "«código»" && novo !== t.codigo) { t.codigo = novo; trocados7++; }
  }
  if (trocados7) mudancas.push(`Códigos do cap. VII: ${trocados7} passaram a continuar a numeração dos outros capítulos.`);
  if (r.trocas.length) {
    const ex = r.trocas.slice(0, 4).map(([x, y]) => `${x} → ${y}`).join(", ");
    mudancas.push(`Códigos de tarefa renumerados fora do cap. VII: ${r.trocas.length} (${ex}${r.trocas.length > 4 ? ", …" : ""}).`);
  }
  if (r.semSetor.length) avisos.push(`${r.semSetor.length} tarefa(s) do cap. VII sem código válido ficaram com «código» no Word: ${r.semSetor.slice(0, 3).join("; ")}.`);

  return { xml: documentXml.slice(0, iBody + 8) + corpo + documentXml.slice(fBody), conteudo: novoConteudo, mudancas, avisos, comentariosRemovidos };
}

// ─── Arquivo .docx ────────────────────────────────────────────────────────────

/** Tira do pacote os comentários cujo trecho saiu do documento (e os registros ligados a eles). */
function tirarComentarios(arqs: Record<string, Uint8Array>, ids: string[]) {
  const ler = (n: string) => (arqs[n] ? strFromU8(arqs[n]) : null);
  const gravar = (n: string, s: string) => { arqs[n] = strToU8(s); };
  const com = ler("word/comments.xml");
  if (!com) return;
  const paraIds: string[] = [];
  let novo = com;
  for (const id of ids) {
    novo = novo.replace(new RegExp(`<w:comment [^>]*w:id="${id}"[^>]*>[\\s\\S]*?</w:comment>`), (m) => {
      for (const p of m.matchAll(/w14:paraId="([^"]+)"/g)) paraIds.push(p[1]);
      return "";
    });
  }
  gravar("word/comments.xml", novo);
  const duraveis: string[] = [];
  const ext = ler("word/commentsExtended.xml");
  if (ext) gravar("word/commentsExtended.xml", paraIds.reduce((s, p) => s.replace(new RegExp(`<w15:commentEx [^>]*w15:paraId="${p}"[^>]*/>`), ""), ext));
  const cids = ler("word/commentsIds.xml");
  if (cids) gravar("word/commentsIds.xml", paraIds.reduce((s, p) => s.replace(new RegExp(`<w16cid:commentId [^>]*w16cid:paraId="${p}"[^>]*/>`), (m) => {
    const d = /w16cid:durableId="([^"]+)"/.exec(m)?.[1];
    if (d) duraveis.push(d);
    return "";
  }), cids));
  const cex = ler("word/commentsExtensible.xml");
  if (cex) gravar("word/commentsExtensible.xml", duraveis.reduce((s, d) => s
    .replace(new RegExp(`<w16cex:commentExtensible [^>]*w16cex:durableId="${d}"[^>]*/>`), "")
    .replace(new RegExp(`<w16cex:commentExtensible [^>]*w16cex:durableId="${d}"[^>]*>[\\s\\S]*?</w16cex:commentExtensible>`), ""), cex));
}

/** É um .docx (zip com word/document.xml)? */
export function ehDocx(bytes: Uint8Array): boolean {
  if (bytes.length < 4 || bytes[0] !== 0x50 || bytes[1] !== 0x4b) return false;
  try {
    return !!unzipSync(bytes, { filter: (f) => f.name === "word/document.xml" })["word/document.xml"];
  } catch {
    return false;
  }
}

/** Gera um .docx novo com o cap. VII da minuta, a partir de um .docx do PTA. */
export function atualizarDocx(bytes: Uint8Array, conteudo: ConteudoCap7): Omit<ResultadoWord, "xml"> & { bytes: Uint8Array } {
  let arqs: Record<string, Uint8Array>;
  try {
    arqs = unzipSync(bytes);
  } catch {
    throw new Error("O arquivo não é um .docx válido.");
  }
  const doc = arqs["word/document.xml"];
  if (!doc) throw new Error("O arquivo não é um .docx válido (falta o word/document.xml).");
  const r = aplicarCap7(strFromU8(doc), conteudo);
  arqs["word/document.xml"] = strToU8(r.xml);
  if (r.comentariosRemovidos.length) tirarComentarios(arqs, r.comentariosRemovidos);
  return { bytes: zipSync(arqs, { level: 6 }), conteudo: r.conteudo, mudancas: r.mudancas, avisos: r.avisos, comentariosRemovidos: r.comentariosRemovidos };
}
