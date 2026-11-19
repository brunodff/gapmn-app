// Testes dos documentos oficiais: achar o TR no pacote do edital do PNCP e levar os achados ao cadastro.
import { test } from "node:test";
import assert from "node:assert/strict";
import { gzipSync, zipSync } from "fflate";
import { acharTrNoPacote, aplicarAchados, lerTar } from "./documentosGov.ts";
import { extrairDoTexto } from "./lerPdfs.ts";
import type { DadosReajuste } from "./tipos.ts";

const enc = new TextEncoder();
const pdf = (s: string) => enc.encode(`%PDF-1.4 ${s}`);
/** .tar mínimo (ustar) com os arquivos dados */
function tar(arqs: [string, Uint8Array][]): Uint8Array {
  const partes: Uint8Array[] = [];
  for (const [nome, dados] of arqs) {
    const cab = new Uint8Array(512);
    cab.set(enc.encode(nome).subarray(0, 100), 0);
    cab.set(enc.encode(dados.length.toString(8).padStart(11, "0") + "\0"), 124);
    cab[156] = 48;
    cab.set(enc.encode("ustar\0"), 257);
    partes.push(cab, dados, new Uint8Array((512 - (dados.length % 512)) % 512));
  }
  partes.push(new Uint8Array(1024));
  const out = new Uint8Array(partes.reduce((s, p) => s + p.length, 0));
  let i = 0; for (const p of partes) { out.set(p, i); i += p.length; }
  return out;
}

test("acha o TR dentro do pacote do edital (zip com .tar.gz dentro, como o Compras.gov.br publica)", () => {
  const dentro = gzipSync(tar([["EDITAL1_2024.pdf", pdf("edital")], ["ANEXO I - Termo de Referencia.pdf", pdf("tr")], ["Apendice - ETP.pdf", pdf("etp")]]));
  const pacote = zipSync({ "PE - 90001.zip": dentro, "RelacaoItens.pdf": pdf("itens") });
  const tr = acharTrNoPacote({ nome: "edital.zip", bytes: pacote });
  assert.equal(tr?.nome, "ANEXO I - Termo de Referencia.pdf");
  assert.equal(lerTar(tar([["a.pdf", pdf("x")]]))[0].nome, "a.pdf");
  assert.equal(acharTrNoPacote({ nome: "edital.zip", bytes: zipSync({ "edital.pdf": pdf("só edital") }) }), null);
  assert.equal(acharTrNoPacote({ nome: "TR.pdf", bytes: pdf("tr direto") })?.nome, "TR.pdf");
});

const TEXTO = `TERMO DE CONTRATO N° 001/2025 A União, Ministério da Defesa, por intermédio do Comando da Aeronáutica, representada pela UNIDADE DE EXEMPLO DA AERONÁUTICA , com sede na Av. Exemplo, 1, inscrito no CNPJ sob o nº 00.000.000/0000-00, neste ato representado pelo seu Ordenador de Despesas, doravante denominado CONTRATANTE , e a Empresa FICTÍCIA LTDA , inscrito(a) no CNPJ/MF sob o n° 11.222.333/0001-44, sediado(a) na Rua A, 1, Centro, Belém/PA – CEP: 66000-000, doravante designado CONTRATADO , neste ato representado(a) pela Sra MARIA DE TESTE , conforme atos constitutivos da empresa, tendo em vista o que consta no Processo. CLÁUSULA SÉTIMA - REAJUSTE 7.1 Os preços são fixos e irreajustáveis no prazo de um ano contado da data do orçamento estimado, em 10/03/2025. 7.2 Após o interregno de um ano os preços iniciais serão reajustados, mediante a aplicação, pelo contratante, do índice INPC.`;

test("leva os achados ao cadastro só nos campos vazios; cabeçalho só quando a OM não é a unidade de apoio", () => {
  const base = { indice: { nome: "", clausula: "", fonte_curta: "" }, data_base: "", empresa: { nome: "FICTÍCIA LTDA", cnpj: "11.222.333/0001-44", endereco: "Rua já digitada", representante: "" },
    om_contratante_sigla: "UEA", om_contratante_nome: "" } as unknown as DadosReajuste;
  const achados = extrairDoTexto(TEXTO, { cnpjEmpresa: "11.222.333/0001-44" });
  const { dados, preenchidos } = aplicarAchados(base, achados, null, { ugApoioNome: "GRUPAMENTO DE APOIO DE MANAUS" });
  assert.equal(dados.indice.nome, "INPC");
  assert.equal(dados.indice.clausula, "a CLÁUSULA SÉTIMA, item 7.2, do Contrato");
  assert.equal(dados.data_base, "03/2025");
  assert.equal(dados.empresa.representante, "MARIA DE TESTE");
  assert.equal(dados.empresa.representante_feminino, true);
  assert.equal(dados.empresa.endereco, "Rua já digitada", "não troca o que já estava preenchido");
  assert.equal(dados.om_contratante_nome, "UNIDADE DE EXEMPLO DA AERONÁUTICA");
  assert.equal(dados.termo_om_nome, "UNIDADE DE EXEMPLO DA AERONÁUTICA");
  assert.match(dados.contratante_paragrafo ?? "", /^\*\*I – CONTRATANTE:\*\* A União/);
  assert.match(dados.contratada_paragrafo ?? "", /^\*\*II – CONTRATADA:\*\* A Empresa FICTÍCIA LTDA/);
  assert.ok(!preenchidos.some((p) => p.campo === "empresa.endereco"));
  // a própria unidade de apoio não vira cabeçalho (o padrão já é ela)
  const daUg = aplicarAchados(base, achados, null, { ugApoioNome: "Unidade de Exemplo da Aeronáutica" });
  assert.equal(daUg.dados.termo_om_nome, undefined);
  // na falta do contrato, a data do orçamento vem do TR
  const soTr = aplicarAchados(base, null, extrairDoTexto("TERMO DE REFERÊNCIA ... orçamento estimado, em 05/02/2025 ..."));
  assert.equal(soTr.dados.data_base, "02/2025");
});

test("sigla da OM do contrato só no lugar da sigla da unidade de apoio (a sugerida pela UG)", () => {
  const comSigla = extrairDoTexto(`${TEXTO} 1.1 Passagens para os militares da Unidade de Exemplo da Aeronáutica (UEX).`, { cnpjEmpresa: "11.222.333/0001-44" });
  const base = (sigla: string) => ({ indice: { nome: "", clausula: "", fonte_curta: "" }, data_base: "", empresa: { nome: "", cnpj: "", endereco: "", representante: "" },
    om_contratante_sigla: sigla, om_contratante_nome: "" } as unknown as DadosReajuste);
  const op = { ugApoioNome: "GRUPAMENTO DE APOIO DE MANAUS", siglasPadrao: ["OM-X", "GAP-MN"] };
  assert.equal(aplicarAchados(base("GAP-MN"), comSigla, null, op).dados.om_contratante_sigla, "UEX");
  assert.equal(aplicarAchados(base(""), comSigla, null, op).dados.om_contratante_sigla, "UEX");
  assert.equal(aplicarAchados(base("BAMN"), comSigla, null, op).dados.om_contratante_sigla, "BAMN", "sigla tirada do número do contrato fica");
});
