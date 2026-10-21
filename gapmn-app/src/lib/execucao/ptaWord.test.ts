// Testes da minuta do PTA em Word: troca do cap. VII, renumeração de artigos, sumário e códigos de tarefa.
// Documento e dados fictícios. Rodar na pasta gapmn-app:  npm test

import { test } from "node:test";
import assert from "node:assert/strict";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";

import type { ArtigoPTA } from "./pta.ts";
import type { ConteudoCap7 } from "./ptaMinuta.ts";
import { aplicarCap7, atualizarDocx, blocos, ehDocx, texto, trocarTexto } from "./ptaWord.ts";

// ── documento fictício no formato do PTA ──────────────────────────────────────
const R = '<w:rPr><w:rFonts w:ascii="Calibri"/></w:rPr>';
const p = (...runs: string[]) => `<w:p w14:paraId="0000AAAA"><w:pPr><w:jc w:val="both"/></w:pPr>${runs.map((t) => `<w:r>${R}<w:t xml:space="preserve">${t}</w:t></w:r>`).join("")}</w:p>`;
const sumario = (titulo: string, num: string) => `<w:p><w:r>${R}<w:t>${titulo}</w:t><w:tab/><w:t xml:space="preserve"> ${num}</w:t></w:r></w:p>`;
const tc = (t: string) => `<w:tc><w:tcPr><w:tcW w:w="1000" w:type="dxa"/></w:tcPr>${p(t)}</w:tc>`;
const tr = (...cs: string[]) => `<w:tr><w:trPr><w:cantSplit w:val="0"/></w:trPr>${cs.map(tc).join("")}</w:tr>`;
const tbl = (...linhas: string[]) => `<w:tbl><w:tblPr><w:tblStyle w:val="T1"/></w:tblPr><w:tblGrid><w:gridCol w:w="1000"/></w:tblGrid>${linhas.join("")}</w:tbl>`;
const comentado = (id: number, t: string) => `<w:p><w:commentRangeStart w:id="${id}"/><w:r>${R}<w:t>${t}</w:t></w:r><w:commentRangeEnd w:id="${id}"/><w:r><w:commentReference w:id="${id}"/></w:r></w:p>`;

const corpo = [
  p("PORTARIA GAP-MN Nº 1/APLG"),
  p("Art. 1º  Aprovar o Programa de Trabalho Anual."),
  p("Art. 2º  Revoga-se a portaria anterior."),
  p("SUMÁRIO"), p("Art."),
  sumario("CAPÍTULO I – DISPOSIÇÕES PRELIMINARES", "1º/2º"),
  sumario("CAPÍTULO VII – COMPOSIÇÃO ORÇAMENTÁRIA", "3/4"),
  sumario("CAPÍTULO VIII – AQUISIÇÕES DE TI", "5"),
  sumario("CAPÍTULO IX – DISPOSIÇÕES FINAIS", "6"),
  p("CAPÍTULO I"), p("DISPOSIÇÕES PRELIMINARES"),
  p("Art. 1º  Finalidade."),
  p("Ar", "t. 2º  Projeto de reforma:"), // o Word às vezes quebra o "Art." em dois runs
  tbl(tr("CÓDIGO", "TAREFA", "PRAZO"), tr("26DIE001", "Fazer o projeto", "31/05/2026"), tr("26DIE002", "Executar a obra", "30/11/2026")),
  p("CAPÍTULO VII"), p("COMPOSIÇÃO ORÇAMENTÁRIA"), p(""),
  p("Art. 3  ", "MATERIAL DE CONSUMO – ND 339030 – Ação: 2000 – R$ ", "10,00"),
  tbl(tr("CÓDIGO", "PERÍODO", "TAREFA", "TOTAL (R$)"), tr("26DIE003", "Mensal", "Tarefa antiga", "10,00")),
  p(""),
  comentado(7, "Art. 4  SERVIÇOS – ND 339039 – Ação: 2000 – R$ 5,00"),
  tbl(tr("CÓDIGO", "PERÍODO", "TAREFA", "TOTAL (R$)"), tr("26DOC001", "Anual", "Outra antiga", "5,00")),
  p(""),
  p("CAPÍTULO VIII"), p("AQUISIÇÕES DE TI"),
  p("Art. 5  AQUISIÇÕES DE TI, conforme o art. 6:"),
  tbl(tr("CÓDIGO", "TIPO", "DESCRIÇÃO"), tr("26DIE004", "Software", "Pacote de escritório")),
  p("CAPÍTULO IX"), p("DISPOSIÇÕES FINAIS"),
  p("Art. 6  Os casos não previstos serão levados à Chefe."),
].join("");
const NS = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:w14="http://schemas.microsoft.com/office/word/2010/wordml"';
const DOC = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document ${NS}><w:body>${corpo}<w:sectPr/></w:body></w:document>`;

const tarefa = (id: string, codigo: string, descricao: string, valor: number, periodo = "Mensal") =>
  ({ id, codigo, periodo, descricao, valor, base: valor, nes: 1, contrato: null, observacao: "" });
const artigo = (id: string, nd: string, acao: string, tarefas: ReturnType<typeof tarefa>[]): ArtigoPTA =>
  ({ id, nd, ndNome: "X", pi: "PI1", piNome: "VIDA VEGETATIVA", titulo: `TÍTULO ${id}`, acao, tarefas });

const minuta = (): ConteudoCap7 => ({
  ano: 2027, anoBase: 2026, ug: "120630", geradoEm: "2026-10-21T00:00:00Z", recorte: "2026-10-15", excluidos: [], pontos: [], primeiroArtigo: 38,
  artigos: [
    artigo("A", "339030", "a confirmar", [tarefa("A1", "27DIE001", "Adquirir material", 100), tarefa("A2", "26DIE001", "Fazer o projeto", 50)]),
    artigo("B", "339039", "2000", [tarefa("B1", "27DOC001", "Contratar limpeza", 300, "")]),
    artigo("C", "449052", "a confirmar", [tarefa("C1", "", "Adquirir mobiliário", 20), tarefa("C2", "27DAD001", "Adquirir freezer", 30)]),
  ],
});

const corpoDe = (xml: string) => xml.slice(xml.indexOf("<w:body>") + 8, xml.lastIndexOf("</w:body>"));
const textos = (xml: string) => { const c = corpoDe(xml); return blocos(c).map((b) => texto(c.slice(b.ini, b.fim)).replace(/\s+/g, " ").trim()); };

test("troca o cap. VII e renumera os artigos do anexo, sem mexer nos da portaria", () => {
  const r = aplicarCap7(DOC, minuta());
  const t = textos(r.xml);
  assert.ok(t.includes("Art. 1º Aprovar o Programa de Trabalho Anual."));
  assert.ok(t.includes("Art. 2º Revoga-se a portaria anterior."));
  assert.ok(t.includes("Art. 2º Projeto de reforma:"));
  assert.ok(t.some((x) => /^Art\. 3º TÍTULO A – ND 339030 – Ação: «a confirmar» – R\$ 150,00$/.test(x)));
  assert.ok(t.some((x) => /^Art\. 4º TÍTULO B – ND 339039 – Ação: 2000 – R\$ 300,00$/.test(x)));
  assert.ok(t.some((x) => /^Art\. 5º TÍTULO C/.test(x)));
  assert.ok(t.includes("Art. 6º AQUISIÇÕES DE TI, conforme o art. 6:"));
  assert.ok(t.includes("Art. 7º Os casos não previstos serão levados à Chefe."));
  assert.ok(!t.some((x) => /Tarefa antiga|Outra antiga/.test(x)), "o cap. VII antigo saiu");
  assert.equal(r.conteudo.primeiroArtigo, 3);
});

test("atualiza o sumário pelos artigos novos", () => {
  const t = textos(aplicarCap7(DOC, minuta()).xml);
  assert.ok(t.includes("CAPÍTULO I – DISPOSIÇÕES PRELIMINARES 1º/2º"));
  assert.ok(t.includes("CAPÍTULO VII – COMPOSIÇÃO ORÇAMENTÁRIA 3º/5º"));
  assert.ok(t.includes("CAPÍTULO VIII – AQUISIÇÕES DE TI 6º"));
  assert.ok(t.includes("CAPÍTULO IX – DISPOSIÇÕES FINAIS 7º"));
});

test("códigos de tarefa: ano do PTA, sequencial por setor na ordem do documento, mesma tarefa com o mesmo código", () => {
  const r = aplicarCap7(DOC, minuta());
  const t = textos(r.xml).join("|");
  // cap. I: 26DIE001/002 → 27DIE001/002; cap. VII continua; cap. VIII depois
  assert.match(t, /27DIE001Fazer o projeto31\/05\/2026/);
  assert.match(t, /27DIE002Executar a obra/);
  const codigos = r.conteudo.artigos.flatMap((a) => a.tarefas.map((x) => x.codigo));
  assert.deepEqual(codigos, ["27DIE003", "27DIE001", "27DOC001", "", "27DAD001"]);
  assert.match(t, /27DIE004SoftwarePacote de escritório/);
  assert.match(t, /«código»/, "tarefa sem código fica marcada no Word");
  assert.ok(r.avisos.some((a) => /sem código válido/.test(a)));
});

test("o que falta decidir fica realçado em amarelo", () => {
  const c = corpoDe(aplicarCap7(DOC, minuta()).xml);
  assert.match(c, /<w:highlight w:val="yellow"\/><\/w:rPr><w:t xml:space="preserve">«a confirmar»<\/w:t>/);
  assert.match(c, /<w:highlight w:val="yellow"\/><\/w:rPr><w:t xml:space="preserve">«período»<\/w:t>/);
  const novo7 = c.slice(c.indexOf("TÍTULO A"), c.indexOf("CAPÍTULO VIII"));
  assert.ok(!/w14:paraId/.test(novo7), "parágrafos copiados sem paraId repetido");
});

test("comentários do Word dentro do cap. VII antigo saem junto; citações a artigos renumerados viram aviso", () => {
  const r = aplicarCap7(DOC, minuta());
  assert.deepEqual(r.comentariosRemovidos, ["7"]);
  assert.ok(!/w:id="7"/.test(r.xml));
  assert.ok(r.avisos.some((a) => /cita artigo que mudou de número/.test(a) && /art\. 6/.test(a)));
  assert.ok(r.mudancas.some((m) => /Cap\. VII: 3 artigos \(arts\. 3 a 5, antes eram 2\)/.test(m)));
});

test("sem os títulos dos capítulos, explica o que falta", () => {
  assert.throws(() => aplicarCap7(DOC.replace("<w:t xml:space=\"preserve\">CAPÍTULO VIII</w:t>", "<w:t>CAP 8</w:t>"), minuta()), /CAPÍTULO VII” e “CAPÍTULO VIII/);
  assert.throws(() => aplicarCap7("<x/>", minuta()), /não parece um documento do Word/);
});

test("trocarTexto atravessa runs", () => {
  const x = p("Ar", "t. 12", "  resto");
  assert.equal(texto(trocarTexto(x, /^Art\. \d+/, "Art. 9º")), "Art. 9º  resto");
});

test("atualizarDocx: abre, troca e fecha o .docx, e limpa o comentário que saiu", () => {
  const comentarios = `<w:comments ${NS}><w:comment w:id="7" w:author="A"><w:p w14:paraId="00CC0001"><w:r><w:t>ver</w:t></w:r></w:p></w:comment><w:comment w:id="8" w:author="A"><w:p w14:paraId="00CC0002"><w:r><w:t>fica</w:t></w:r></w:p></w:comment></w:comments>`;
  const ext = `<w15:commentsEx xmlns:w15="x"><w15:commentEx w15:paraId="00CC0001" w15:done="0"/><w15:commentEx w15:paraId="00CC0002" w15:done="0"/></w15:commentsEx>`;
  const zip = zipSync({ "[Content_Types].xml": strToU8("<Types/>"), "word/document.xml": strToU8(DOC), "word/comments.xml": strToU8(comentarios), "word/commentsExtended.xml": strToU8(ext) });
  assert.ok(ehDocx(zip));
  assert.ok(!ehDocx(strToU8("não é zip")));
  const r = atualizarDocx(zip, minuta());
  const arqs = unzipSync(r.bytes);
  assert.equal(Object.keys(arqs)[0], "[Content_Types].xml");
  assert.match(strFromU8(arqs["word/document.xml"]), /TÍTULO C/);
  const com = strFromU8(arqs["word/comments.xml"]);
  assert.ok(!/w:id="7"/.test(com) && /w:id="8"/.test(com));
  const e2 = strFromU8(arqs["word/commentsExtended.xml"]);
  assert.ok(!/00CC0001/.test(e2) && /00CC0002/.test(e2));
  assert.throws(() => atualizarDocx(strToU8("lixo"), minuta()), /não é um \.docx válido/);
});
