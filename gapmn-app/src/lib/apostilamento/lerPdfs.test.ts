// Testes da leitura dos PDFs do contrato. Textos no modelo da AGU com dados fictícios.
import { test } from "node:test";
import assert from "node:assert/strict";
import { extrairDoTexto, tipoDoDocumento } from "./lerPdfs.ts";

const CONTRATO = `MINISTÉRIO DA DEFESA COMANDO DA AERONÁUTICA CONTRATO Nº 099/GAPMN-BAMN/2025 TERMO DE CONTRATO DE PRESTAÇÃO DE SERVIÇOS
I – CONTRATANTE: A União, por intermédio do Comando da Aeronáutica, representada pelo GRUPAMENTO DE APOIO DE MANAUS, com sede na Avenida Rodrigo Otávio, 780,
neste ato representado pelo Ordenador de Despesas, o Sr. Cel Int FULANO DE TAL BELTRANO, e
II – CONTRATADA: EMPRESA EXEMPLO SERVIÇOS LTDA, inscrita no CNPJ/MF sob o nº 12.345.678/0001-90, sediada na Rua das Flores, nº 100, Bairro Centro, em Manaus/AM, CEP 69000-000,
DDD/Telefone (92) 0000-0000, e-mail contato@exemplo.com, neste ato representada por sua sócia-administradora, a Sra. MARIA DA SILVA SOUZA, conforme atos constitutivos da empresa,
portadora da Carteira de Identidade nº 0000000, tendo em vista o que consta no Processo nº 67298.000000/2025-00,
CLÁUSULA PRIMEIRA – OBJETO (art. 92, I e II) 1.1. O objeto do presente instrumento é a contratação de serviços continuados de limpeza e conservação predial, nas condições estabelecidas no Termo de Referência.
CLÁUSULA SÉTIMA – REAJUSTE (art. 92, V) 7.1. Os preços inicialmente contratados são fixos e irreajustáveis no prazo de um ano contado da data do orçamento estimado, em 12/06/2025.
7.2. Após o interregno de um ano, e independentemente de pedido do contratado, os preços iniciais serão reajustados, mediante a aplicação, pelo contratante, do índice Nacional de Preços ao Consumidor Amplo (IPCA), exclusivamente para as obrigações iniciadas e concluídas após a ocorrência da anualidade.`;

test("contrato no modelo da AGU: índice, cláusula com o item, data-base, representante e endereço da contratada", () => {
  const r = extrairDoTexto(CONTRATO, { cnpjEmpresa: "12345678000190" });
  assert.equal(r.tipo, "CONTRATO");
  assert.equal(r.indice?.valor, "IPCA");
  assert.equal(r.clausula?.valor, "a CLÁUSULA SÉTIMA, item 7.2, do Contrato");
  assert.equal(r.dataBase?.valor, "06/2025");
  assert.deepEqual(r.representante?.valor, { nome: "MARIA DA SILVA SOUZA", feminino: true });
  assert.equal(r.endereco?.valor, "na Rua das Flores, nº 100, Bairro Centro, em Manaus/AM, CEP 69000-000");
  assert.match(r.objeto?.valor ?? "", /^contratação de serviços continuados de limpeza/);
});

test("não confunde o representante do contratante com o da contratada", () => {
  const r = extrairDoTexto(CONTRATO, { cnpjEmpresa: "12.345.678/0001-90" });
  assert.notEqual(r.representante?.valor.nome, "FULANO DE TAL BELTRANO");
});

test("TR com orçamento por extenso e INPC; mapa comparativo pela data de assinatura", () => {
  const tr = `TERMO DE REFERÊNCIA ... 9. REAJUSTE CLÁUSULA NONA – DO REAJUSTE 9.1 Os preços são fixos e irreajustáveis no prazo de um ano contado da data do orçamento estimado, em março de 2024.
9.2 Após o interregno de um ano os preços serão reajustados pelo Índice Nacional de Preços ao Consumidor – INPC.`;
  const r = extrairDoTexto(tr);
  assert.equal(r.tipo, "TERMO DE REFERÊNCIA");
  assert.equal(r.indice?.valor, "INPC");
  assert.equal(r.dataBase?.valor, "03/2024");
  assert.equal(r.clausula?.valor, "a CLÁUSULA NONA, item 9.2, do Termo de Referência");
  const mapa = extrairDoTexto("MAPA COMPARATIVO DE PREÇOS Item 1 ... Manaus, 15 de julho de 2023. Assinado.");
  assert.equal(mapa.tipo, "MAPA COMPARATIVO");
  assert.equal(mapa.dataBase?.valor, "07/2023");
});

test("documento sem relação não traz nada", () => {
  assert.equal(tipoDoDocumento("Nota fiscal de serviço eletrônica"), "OUTRO");
  const r = extrairDoTexto("Nota fiscal de serviço eletrônica IPCA reajuste");
  assert.equal(r.indice, undefined);
});

// Modelo usado pelas OMs da FAB (texto do PDF quebrado em linhas, "representado(a)", cláusula com título de repactuação)
const CONTRATO_FAB = `OSTENSIVO Termo de Contrato n° 012/GAPMN-EXEMPLO/2025 MINISTÉRIO DA DEFESA COMANDO DA AERONÁUTICA
UNIDADE DE EXEMPLO DA AERONÁUTICA (Processo Administrativo n° 67000.000000/2025-00) CONTRATO ADMINISTRATIVO N° 012/2025, QUE FAZEM
ENTRE SI A UNIÃO, POR INTERMÉDIO DA UNIDADE DE EXEMPLO DA AERONÁUTICA E A EMPRESA FICTÍCIA LTDA. A União, Ministério da Defesa, por
intermédio do Comando da Aeronáutica, representada pela UNIDADE DE EXEMPLO DA AERONÁUTICA , com sede na Av. Exemplo, 100, na cidade de
Manaus-AM CEP: 69000-000, inscrito no CNPJ sob o nº 00.000.000/0000-00, neste ato representado pelo seu Ordenador de Despesas, o Sr Cel
FULANO DE EXEMPLO , doravante denominado CONTRATANTE , e a Empresa EMPRESA FICTÍCIA LTDA , inscrito(a) no CNPJ/MF sob o n°
11.222.333/0001-44, sediado(a) na Rua das Palmeiras, 10, Centro, Belém/PA – CEP: 66000-000, doravante designado CONTRATADO , neste ato
representado(a) pelo Sr CICRANO DE TESTE , conforme atos constitutivos da empresa, tendo em vista o que consta no Processo n°
67000.000000/2025-00, resolvem celebrar o presente Termo de Contrato.
1.1 O objeto é o serviço de passagens para os militares da Unidade de Exemplo da Aeronáutica (UEX) e unidades subordinadas.
7. CLÁUSULA SÉTIMA - REPACTUAÇÃO DOS PREÇOS CONTRATADOS (art. 92, V e X, Lei nº 14.133, de 2021) 7.1 Os preços inicialmente contratados são
fixos e irreajustáveis no prazo de um ano contado da data do orçamento estimado, em 23/12/2024. 7.2 Após o interregno de um ano, e
independentemente de pedido do contratado, os preços iniciais serão reajustados, mediante a aplicação, pelo contratante, do índice IPCA
exclusivamente para as obrigações iniciadas e concluídas após a ocorrência da anualidade.`;

test("PDF sem texto (escaneado) é avisado", () => {
  assert.equal(extrairDoTexto("  \n ").semTexto, true);
});

test("modelo da FAB: partes do contrato inicial, OM contratante e cláusula pela frase do índice", () => {
  const r = extrairDoTexto(CONTRATO_FAB, { cnpjEmpresa: "11.222.333/0001-44" });
  assert.equal(r.tipo, "CONTRATO");
  assert.equal(r.indice?.valor, "IPCA");
  assert.equal(r.clausula?.valor, "a CLÁUSULA SÉTIMA, item 7.2, do Contrato");
  assert.equal(r.dataBase?.valor, "12/2024");
  assert.deepEqual(r.representante?.valor, { nome: "CICRANO DE TESTE", feminino: false });
  assert.equal(r.endereco?.valor, "na Rua das Palmeiras, 10, Centro, Belém/PA – CEP: 66000-000");
  assert.equal(r.omContratante?.valor, "UNIDADE DE EXEMPLO DA AERONÁUTICA");
  assert.equal(r.omSigla?.valor, "UEX"); // o nome em minúsculas, com a sigla entre parênteses
  assert.equal(r.semTexto, undefined);
  assert.match(r.contratante?.valor ?? "", /^\*\*I – CONTRATANTE:\*\* A União, Ministério da Defesa, .* representada pela UNIDADE DE EXEMPLO DA AERONÁUTICA, com sede .* doravante denominado CONTRATANTE\.$/);
  assert.match(r.contratada?.valor ?? "", /^\*\*II – CONTRATADA:\*\* A Empresa EMPRESA FICTÍCIA LTDA, inscrito\(a\) .* representado\(a\) pelo Sr CICRANO DE TESTE, conforme atos constitutivos da empresa\.$/);
});
