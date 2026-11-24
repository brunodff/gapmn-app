// Testes do cadastro pelo Contratos.gov.br. Dados reais (API pública) do CT 037/GAPMN-CINDACTAIV/2025,
// que a SCON cadastrou à mão: o resultado tem de bater com a carga dela.
import { test } from "node:test";
import assert from "node:assert/strict";
import { acharContratoGov, completarCadastro, dadosDoContratosGov, numeroEAno, resumirObjeto, type ContratoGov } from "./contratosGov.ts";

const ct037: ContratoGov = {
  id: 604973, numero: "00037/2025", processo: "67298.002536/2025-17", categoria: "Serviços",
  objeto: "CONTRATAÇÃO DE EMPRESA ESPECIALIZADA NA PRESTAÇÃO DE SERVIÇOS DE MANUTENÇÃO DE ÁREAS VERDES, COM CORTE MECANIZADO E CAPINA MANUAL, CONFORME O TERMO DE REFERÊNCIA.",
  fornecedor: { tipo: "JURIDICA", cnpj_cpf_idgener: "15.791.353/0001-24", nome: "PREMIER SERVICOS ADMINISTRATIVOS LTDA" },
  vigencia_inicio: "2025-09-04", vigencia_fim: "2026-09-04", data_assinatura: "2025-09-04",
  valor_inicial: "184.410,00", valor_global: "184.410,00", valor_parcela: "15.367,50", num_parcelas: 12,
};
const itens037 = [
  { numero_item_compra: "00048", descricao_complementar: "ROÇADA / LIMPEZA DE ÁREA - MANUAL", quantidade: "20700", valorunitario: "3,90", valortotal: "80.730,00" },
  { numero_item_compra: "00047", descricao_complementar: "ROÇADA / LIMPEZA DE ÁREA - MECANIZADA", quantidade: "115200", valorunitario: "0,90", valortotal: "103.680,00" },
];
const hist037 = [
  { tipo: "Contrato", numero: "00037/2025", data_assinatura: "2025-09-04", vigencia_inicio: "2025-09-04", vigencia_fim: "2026-09-04", valor_global: "184.410,00", novo_valor_global: "0,00" },
  { tipo: "Termo Aditivo", numero: "00001/2026", data_assinatura: "2026-08-27", valor_global: "184.410,00", novo_valor_global: "0,00", qualificacao_termo: [{ descricao: "VIGÊNCIA" }] },
];
const nes037 = [
  { numero: "2025NE001112", data_emissao: "2025-09-10", unidade_gestora: "120094", gestao: "00001", fonte_recurso: "1050A00008", programa_trabalho: "229166", planointerno: "DC060401600 - CONTRATOS CONTINUADOS", naturezadespesa: "339039 - OUTROS SERVICOS" },
  { numero: "2026NE001299", data_emissao: "2026-02-03", unidade_gestora: "120094", gestao: "00001", fonte_recurso: "1052000140", programa_trabalho: null, planointerno: "DC060401600 - CONTRATOS CONTINUADOS", naturezadespesa: "339039 - OUTROS SERVICOS" },
];

test("nº do app e do Contratos.gov.br", () => {
  assert.deepEqual(numeroEAno("037/GAPMN-CINDACTAIV/2025"), { n: 37, ano: "2025" });
  assert.deepEqual(numeroEAno("00037/2025"), { n: 37, ano: "2025" });
  assert.deepEqual(numeroEAno("DESPESA 001/GAP-MN/2024"), { n: 1, ano: "2024" });
  assert.deepEqual(numeroEAno("CREDENCIAMENTO 014/2022"), { n: 20014, ano: "2022" });
  assert.deepEqual(numeroEAno("20014/2022"), { n: 20014, ano: "2022" });
});

test("acha o contrato; com dois do mesmo número, desempata pelo PAG", () => {
  const outro = { ...ct037, id: 1, processo: "67298.000001/2025-00", vigencia_inicio: "2025-01-10" };
  assert.equal(acharContratoGov("037/GAPMN-CINDACTAIV/2025", "67298.002536/2025-17", null, [ct037])?.id, 604973);
  assert.equal(acharContratoGov("037/GAPMN-CINDACTAIV/2025", "67298.002536/2025-17", null, [outro, ct037])?.id, 604973);
  assert.equal(acharContratoGov("037/GAPMN-BAMN/2025", null, "2025-01-10", [outro, ct037])?.id, 1);
  assert.equal(acharContratoGov("037/GAPMN-BAMN/2025", null, null, [outro, ct037]), null);
  assert.equal(acharContratoGov("099/GAPMN/2025", null, null, [ct037]), null);
});

test("CT 037: mesmos dados que a SCON cadastrou à mão", () => {
  const r = dadosDoContratosGov(ct037, itens037, hist037, nes037);
  assert.equal(r.dados.nup, "67298.002536/2025-17");
  assert.equal(r.dados.empresa?.nome, "PREMIER SERVICOS ADMINISTRATIVOS LTDA");
  assert.equal(r.dados.empresa?.cnpj, "15.791.353/0001-24");
  assert.deepEqual(r.dados.itens?.map((i) => [i.item, i.qtd, i.valor_unit, i.valor_base]), [[47, 115200, 0.9, 103680], [48, 20700, 3.9, 80730]]);
  assert.deepEqual(r.dados.historico_valores, [{ documento: "Contrato inicial", valor: 184410 }, { documento: "1º Termo Aditivo", valor: 184410 }]);
  assert.equal(r.dados.base, "ANUAL");
  assert.deepEqual(r.dados.orcamento, { gestao_unidade: "00001/120094", fonte: "1052000140", programa_trabalho: "229166", plano_interno: "DC060401600", natureza_despesa: "339039", exercicio: 2026 });
  assert.equal(r.ultimo_empenho?.ne, "2026NE001299");
  assert.deepEqual(r.documentos.map((d) => d.tipo), ["CONTRATO", "TERMO_ADITIVO"]);
  assert.equal(r.dados.objeto_resumido, "Serviços de manutenção de áreas verdes");
  assert.equal(r.dados.fator_anual, 1, "0,90 × 115.200 = 103.680: a qtd já é a do ano");
  assert.equal(r.dados.numero_instrumento, 1);
});

test("apostila de reajuste vira reajuste já aplicado, com o percentual quando o termo traz", () => {
  const h = [...hist037, { tipo: "Termo de Apostilamento", numero: "00001/2026", data_assinatura: "2026-09-10", valor_global: "184.410,00", novo_valor_global: "193.123,21",
    observacao: "REAJUSTE PELO IPCA DE 4,724910% A PARTIR DE 01/06/2026" }];
  const r = dadosDoContratosGov(ct037, itens037, h, nes037);
  assert.deepEqual(r.dados.reajustes, [{ n: 1, indice_pct: 4.72491, novo: false, documento: "1º Termo de Apostilamento" }]);
  assert.deepEqual(r.dados.historico_valores?.[r.dados.historico_valores.length - 1], { documento: "1º Termo de Apostilamento", valor: 193123.21 });
  assert.equal(r.dados.numero_instrumento, 2);
});

test("completar só preenche o vazio: o que a SCON digitou fica", () => {
  const atual = { nup: "", empresa: { nome: "Nome digitado", cnpj: "", endereco: "Rua X", representante: "" }, itens: [{ item: 47, descricao: "Manutenção de áreas verdes", qtd: 1, valor_unit: 1, valor_base: 1 }],
    reajustes: [{ n: 1, indice_pct: null, novo: true }] };
  const gov = dadosDoContratosGov(ct037, itens037, hist037, nes037).dados;
  const { dados, preenchidos } = completarCadastro(atual, gov);
  assert.equal(dados.empresa?.nome, "Nome digitado");
  assert.equal(dados.empresa?.cnpj, "15.791.353/0001-24");
  assert.equal(dados.empresa?.endereco, "Rua X");
  assert.equal(dados.itens?.[0].descricao, "Manutenção de áreas verdes");
  assert.equal(dados.nup, "67298.002536/2025-17");
  assert.ok(preenchidos.includes("empresa.cnpj") && preenchidos.includes("historico_valores") && !preenchidos.includes("itens"));
  assert.ok(!preenchidos.includes("fator_anual") && dados.fator_anual == null, "itens da SCON: o fator do Contratos.gov.br não vale");
  assert.equal(completarCadastro({}, gov).dados.fator_anual, 1);
});

test("adesão antiga: o Termo de Adesão é o instrumento inicial", () => {
  const h = [{ tipo: "Termo de Adesão", numero: "00001/2016", data_assinatura: "2016-10-31", valor_global: "186.435,51", novo_valor_global: "0,00" }];
  const r = dadosDoContratosGov({ ...ct037, numero: "00001/2016" }, [], h, []);
  assert.deepEqual(r.dados.historico_valores, [{ documento: "Contrato inicial", valor: 186435.51 }]);
  assert.deepEqual(r.documentos.map((d) => d.tipo), ["CONTRATO"]);
});

test("objeto resumido sugerido", () => {
  assert.equal(resumirObjeto("O presente contrato tem por objeto a contratação de empresa especializada na prestação de serviços de vigilância armada, nos termos do edital."), "Serviços de vigilância armada");
  assert.equal(resumirObjeto(""), "");
});

test("item 5 pelas regras da SCON: nº do termo, apostila sem reajuste fora, supressão nas alterações, lista maior fica", () => {
  const hist = [
    { tipo: "Contrato", numero: "00010/2022", data_assinatura: "2022-03-01", valor_global: "100.000,00", novo_valor_global: "0,00" },
    // o 1º aditivo não está no sistema: o que está é o 00002/2025
    { tipo: "Termo Aditivo", numero: "00002/2025", data_assinatura: "2025-02-20", valor_global: "100.000,00", novo_valor_global: "110.000,00", qualificacao_termo: [{ descricao: "VIGÊNCIA" }, { descricao: "REAJUSTE" }] },
    { tipo: "Termo de Apostilamento", numero: "00001/2025", data_assinatura: "2025-04-10", valor_global: "110.000,00", observacao: "Alteração da dotação orçamentária" },
    { tipo: "Termo Aditivo", numero: "00003/2025", data_assinatura: "2025-09-01", valor_global: "110.000,00", novo_valor_global: "82.500,00", qualificacao_termo: [{ descricao: "ACRÉSCIMO / SUPRESSÃO" }], observacao: "Supressão de 25% do valor do contrato" },
    { tipo: "Termo de Apostilamento", numero: "00002/2025", data_assinatura: "2025-10-01", valor_global: "82.500,00", novo_valor_global: "86.000,00", observacao: "Reajuste pelo IPCA de 4,25%" },
  ];
  const r = dadosDoContratosGov(ct037, itens037, hist, []);
  assert.deepEqual(r.dados.historico_valores, [
    { documento: "Contrato inicial", valor: 100000 }, { documento: "2º Termo Aditivo", valor: 110000 },
    { documento: "3º Termo Aditivo", valor: 82500 }, { documento: "2º Termo de Apostilamento", valor: 86000 },
  ], "nº do termo pelo número no Contratos.gov.br; a 1ª apostila (sem reajuste) fica fora do histórico");
  assert.deepEqual(r.dados.alteracoes_quantitativas, [{ documento: "3º Termo Aditivo", data_assinatura: "01/09/2025", descricao: "Supressão de 25% do valor do contrato" }]);
  assert.equal(r.dados.complemento_supressao, true);
  assert.equal(r.dados.numero_instrumento, 3, "a apostila sem reajuste conta para o nº do próximo apostilamento");

  // completar: só o contrato inicial conta como vazio; lista maior não é trocada por menor
  const soInicial = completarCadastro({ historico_valores: [{ documento: "Contrato inicial", valor: 100000 }] }, r.dados);
  assert.equal(soInicial.dados.historico_valores?.length, 4);
  assert.ok(soInicial.preenchidos.includes("historico_valores") && soInicial.preenchidos.includes("complemento_supressao"));
  const maior = [{ documento: "Contrato inicial", valor: 100000 }, { documento: "1º Termo Aditivo", valor: 100000 }, { documento: "2º Termo Aditivo", valor: 110000 }, { documento: "3º Termo Aditivo", valor: 82500 }, { documento: "1º Termo de Apostilamento", valor: 86000 }];
  assert.deepEqual(completarCadastro({ historico_valores: maior }, r.dados).dados.historico_valores, maior);
});
