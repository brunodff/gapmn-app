import { test } from "node:test";
import assert from "node:assert/strict";
import { classificarAcordao, cruzar, dataISO, filaCadirreg, informativoDe, LeitorCsvTcu, lerCsvTcu, sancaoDe, temasDe, textoFeed } from "./tcu.ts";

test("acórdão de licitação entra, com os temas", () => {
  const c = classificarAcordao("REPRESENTAÇÃO. IRREGULARIDADES EM PREGÃO ELETRÔNICO. ATA DE REGISTRO DE PREÇO. DETERMINAÇÃO PARA NÃO ADESÃO DE NOVOS ÓRGÃOS À ATA.");
  assert.equal(c.relevante, true);
  assert.deepEqual(c.temas, ["Licitação", "Registro de preços"]);
  assert.equal(c.destaque, false);
});

test("pessoal, pensão e aposentadoria ficam fora, mesmo citando reajuste", () => {
  assert.equal(classificarAcordao("PESSOAL. APOSENTADORIA. VALORES NÃO ABSORVIDOS POR REAJUSTES REMUNERATÓRIOS.").relevante, false);
  assert.equal(classificarAcordao("REVISÃO DE OFÍCIO. PENSÃO CIVIL. DISPENSA DE NOVO EXAME.").relevante, false);
  assert.equal(classificarAcordao("TOMADA DE CONTAS ESPECIAL. PROGRAMA FARMÁCIA POPULAR. DISPENSAÇÕES SEM NOTA FISCAL.").relevante, false);
});

test("TCE só de obra de convênio fica fora; com superfaturamento entra", () => {
  assert.equal(classificarAcordao("TOMADA DE CONTAS ESPECIAL. DNOCS. OBRA DE ABASTECIMENTO DE ÁGUA. OBRA INCOMPLETA.").relevante, false);
  const c = classificarAcordao("TOMADA DE CONTAS ESPECIAL. SUPERFATURAMENTO NO CONTRATO 14/2006. OBRAS DA FERROVIA.");
  assert.equal(c.relevante, true);
  assert.ok(c.temas.includes("Preços e orçamento"));
});

test("contrato de repasse não é contratação; destaque para Defesa e Manaus", () => {
  assert.equal(classificarAcordao("TOMADA DE CONTAS ESPECIAL. CONTRATO DE REPASSE. PRESTAÇÃO DE CONTAS. RESCISÃO.").relevante, false);
  assert.equal(classificarAcordao("DENÚNCIA. PREGÃO DO BATALHÃO DE INFANTARIA. REGISTRO DE PREÇOS.").destaque, true);
  assert.equal(classificarAcordao("REPRESENTAÇÃO. PREGÃO. FORNECIMENTO DE REFEIÇÕES EM MANAUS/AM.").destaque, true);
});

test("temas do enunciado do informativo", () => {
  assert.deepEqual(temasDe("Em licitações de serviços contínuos com dedicação exclusiva de mão de obra, é irregular a desclassificação…"), ["Licitação", "Mão de obra"]);
  assert.deepEqual(temasDe("A repactuação de preços depende de pedido da contratada"), ["Execução do contrato"]);
});

test("CSV do TCU: pipe, aspas dobradas e quebra de linha no campo", () => {
  const csv = '"KEY"|"TITULO"|"COLEGIADO"|"TEXTOACORDAO"|"ENUNCIADO"|"NUMERO"|"TEXTOINFO"\n'
    + '"ILC-1"|"Informativo de Licitações e Contratos 535/2026"|"Plenário"|"<acordao_decisao_tcu colegiado=""Plenário"" numero=""2271"" ano=""2026"" >Acórdão 2271/2026 Plenário</acordao_decisao_tcu>, Representação"|"É irregular a desclassificação em licitação por ""quantitativo"" inferior."|"535"|"Linha 1\nLinha 2"\r\n'
    + '"ILC-2"|"Informativo de Licitações e Contratos 1/2010"|"Plenário"|""|""|"1"|""\n';
  const r = lerCsvTcu(csv);
  assert.equal(r.length, 2);
  assert.equal(r[0].ENUNCIADO, 'É irregular a desclassificação em licitação por "quantitativo" inferior.');
  assert.equal(r[0].TEXTOINFO, "Linha 1\nLinha 2");
  const i = informativoDe(r[0])!;
  assert.equal(i.numero, 535);
  assert.equal(i.ano, 2026);
  assert.equal(i.acordao, "Acórdão 2271/2026 Plenário, Representação");
  assert.deepEqual(i.temas, ["Licitação"]);
  assert.equal(informativoDe(r[1]), null); // sem enunciado
});

test("CSV em pedaços dá o mesmo que inteiro, com o corte em qualquer ponto (aspas, \\r\\n)", () => {
  const csv = '"KEY"|"TITULO"|"ENUNCIADO"|"NUMERO"\r\n'
    + '"A"|"Info 2/2026"|"Texto com ""aspas"" e | barra"|"2"\r\n'
    + '"B"|"Info 1/2026"|"Linha 1\r\nLinha 2"""|"1"\n'
    + '"C"|"Info 1/2026"|""|"1"';
  const inteiro = lerCsvTcu(csv);
  assert.equal(inteiro.length, 3);
  assert.equal(inteiro[1].ENUNCIADO, 'Linha 1\r\nLinha 2"');
  for (let tam = 1; tam <= csv.length; tam++) {
    const l = new LeitorCsvTcu();
    const out: Record<string, string>[] = [];
    for (let i = 0; i < csv.length; i += tam) out.push(...l.ler(csv.slice(i, i + tam)));
    out.push(...l.fim());
    assert.deepEqual(out, inteiro, `pedaços de ${tam}`);
  }
});

test("sanções: só CNPJ, só fornecedor nosso, sem repetir", () => {
  const lista = [
    { numeroProcessoFormatado: "011.773/2022-7", nome: "EMPRESA A", tipoRegistro: "CNPJ", numeroRegistro: "30.139.983/0001-02", numeroAcordaoFormatado: "2180/2023-PL", dataAcordao: "25/10/2023", dataTransitoEmJulgado: "01/02/2025", dataFinalSancao: "01/02/2028" },
    { numeroProcessoFormatado: "011.773/2022-7", nome: "EMPRESA A", tipoRegistro: "CNPJ", numeroRegistro: "30139983000102" },
    { numeroProcessoFormatado: "001.000/2020-1", nome: "FULANO", tipoRegistro: "CPF", numeroRegistro: "000.000.001-91" },
    { numeroProcessoFormatado: "002.000/2021-1", nome: "' EMPRESA B LTDA.'", tipoRegistro: "CNPJ", numeroRegistro: "01.785.999/0001-94" },
  ];
  const s = cruzar(lista, "INIDONEO", new Set(["30139983000102"]));
  assert.equal(s.length, 1);
  assert.deepEqual([s[0].cnpj, s[0].data_final, s[0].data_transito, s[0].acordao], ["30139983000102", "2028-02-01", "2025-02-01", "2180/2023-PL"]);
  assert.equal(sancaoDe(lista[2], "INIDONEO"), null);
  assert.equal(sancaoDe(lista[3], "CONTAS_IRREGULARES")!.nome, "EMPRESA B LTDA.");
});

test("fila do CADIRREG: nunca conferidos primeiro, depois os mais antigos, respeitando os dias", () => {
  const agora = new Date("2026-11-17T12:00:00Z");
  const conf = new Map([["2", "2026-11-16T12:00:00Z"], ["3", "2026-11-01T12:00:00Z"], ["4", "2026-11-05T12:00:00Z"]]);
  assert.deepEqual(filaCadirreg(["4", "3", "2", "1"], conf, agora, 7, 10), ["1", "3", "4"]);
  assert.deepEqual(filaCadirreg(["4", "3", "2", "1"], conf, agora, 7, 2), ["1", "3"]);
});

test("datas e texto do feed", () => {
  assert.equal(dataISO("11/11/2026"), "2026-11-11");
  assert.equal(dataISO(""), null);
  assert.equal(textoFeed({ acordaos_novos: 0, informativos_novos: 0, alertas_novos: 0 }), null);
  assert.equal(textoFeed({ acordaos_novos: 3, informativos_novos: 1, alertas_novos: 1 }),
    "TCU: 1 fornecedor com registro novo no TCU; 3 acórdãos sobre licitações e contratos; 1 enunciado novo do Informativo de Licitações e Contratos");
});
