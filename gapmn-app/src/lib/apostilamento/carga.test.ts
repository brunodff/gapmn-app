import { test } from "node:test";
import assert from "node:assert/strict";
import { cargaGuardada, casarContratos, cargaMaisNova, fonteDaDataBase, lerCarga, mesclarDados, motivoForaDaAutomacao, nucleoNumero, pendenciasCadastro, proximoApostilamento, situacaoCadastro } from "./carga.ts";
import { completarReajustesDevidos } from "./cadastro.ts";
import type { DadosReajuste } from "./tipos.ts";

// Contrato fictício completo (mesma forma dos registros COMPLETO da carga)
const completo = (): Partial<DadosReajuste> => ({
  contrato: "900/GAPMN-TESTE/2025", nup: "67000.000001/2025-00", om_contratante_sigla: "TESTE", om_contratante_nome: "UNIDADE DE TESTE",
  objeto_completo: "Serviço de teste", objeto_resumido: "Serviço", data_base: "06/2025", base: "ANUAL",
  empresa: { nome: "EMPRESA FICTÍCIA LTDA", cnpj: "00.000.000/0001-91", endereco: "Rua A, 1", representante: "", representantes: [{ nome: "FULANO", feminino: false }] },
  indice: { nome: "IPCA", clausula: "a CLÁUSULA 7" }, contratante_paragrafo: "**I – CONTRATANTE:** …",
  itens: [{ item: 1, descricao: "A", qtd: 10, valor_unit: 10, valor_base: 100 }, { item: 2, descricao: "B", qtd: 1, valor_unit: 50, valor_base: 50 }],
  itens_total_inicial: 150, historico_valores: [{ documento: "Contrato inicial", valor: 150 }],
  orcamento: { gestao_unidade: "00001/120000", fonte: "1000000000", programa_trabalho: "123456", plano_interno: "PI", natureza_despesa: "339039", exercicio: 2026 },
  reajustes: [],
});
const op = { textosFixos: { "GAP-MN": "**I – CONTRATANTE:** texto fixo" }, omPadrao: "GAP-MN" };

test("lerCarga: versão 1, chave em todos, sem repetir", () => {
  assert.equal(lerCarga({ versao: 1, contratos: [{ chave: " 001/A/2025 " }] }).contratos[0].chave, "001/A/2025");
  assert.equal(lerCarga({ versao: 1, contratos: [{ dados: { contrato: "002/A/2025" } }] }).contratos[0].chave, "002/A/2025");
  assert.throws(() => lerCarga({ versao: 2, contratos: [] }), /não é uma carga/);
  assert.throws(() => lerCarga({ versao: 1, contratos: [{ chave: "X" }, { chave: "X" }] }), /repetido/);
  assert.throws(() => lerCarga({ versao: 1, contratos: [{}] }), /sem 'chave'/);
});

test("pendências: completo não tem; vazio tem as de sempre; dedicação exclusiva não se aplica", () => {
  assert.deepEqual(pendenciasCadastro(completo(), op), []);
  assert.equal(situacaoCadastro(pendenciasCadastro(completo(), op), false), "COMPLETO");
  const p = pendenciasCadastro({ contrato: "001/A/2025", nup: "1", om_contratante_sigla: "A", om_contratante_nome: "A" }, op);
  for (const t of ["Falta Objeto completo", "Falta Data do orçamento", "Falta o CNPJ da empresa", "Falta o representante da empresa",
    "Falta o índice de reajuste e/ou a cláusula", "Falta a tabela de itens", "Falta PTRES do último empenho"]) assert.ok(p.includes(t), t);
  assert.deepEqual(pendenciasCadastro({}, { ...op, dedicacao: true }), []);
  assert.equal(situacaoCadastro([], true), "NAO_SE_APLICA");
});

test("fora da automação: dedicação exclusiva ou o motivo que a carga trouxe (adesão, credenciamento)", () => {
  assert.equal(motivoForaDaAutomacao({ dedicacao_exclusiva: true }), "dedicação exclusiva de mão de obra (repactuação)");
  assert.equal(motivoForaDaAutomacao({}, true), "dedicação exclusiva de mão de obra (repactuação)");
  assert.equal(motivoForaDaAutomacao({ reajuste_nao_aplicavel: "preços pela tabela de referência do credenciamento" }), "preços pela tabela de referência do credenciamento");
  assert.equal(motivoForaDaAutomacao({ status: "ATIVO" }), null);
  assert.equal(motivoForaDaAutomacao(undefined), null);
});

test("origem da data do orçamento: no registro ou dentro dos dados, guardada com a carga", () => {
  const carga = { versao: 1, gerado_em: "2026-11-23", contratos: [] };
  const f = { fonte: "Termo de Referência", documento: "TR", subprocesso: "12", trecho: "data do orçamento: 03/2025", conferir: true };
  assert.deepEqual(cargaGuardada({ chave: "A", data_base_fonte: f }, carga).data_base_fonte, f);
  assert.deepEqual(fonteDaDataBase({ chave: "B", dados: { data_base_fonte: f } }), f);
  assert.equal("data_base_fonte" in cargaGuardada({ chave: "C" }, carga), false);
  assert.equal(fonteDaDataBase({ chave: "D", data_base_fonte: {} }), undefined);
});

test("pendências: texto fixo da OM, soma dos itens e reajuste aplicado sem documento", () => {
  const sem = { ...completo(), contratante_paragrafo: "" };
  assert.ok(pendenciasCadastro(sem, op).some((x) => /OM GAP-MN/.test(x)) === false, "GAP-MN tem texto fixo");
  assert.ok(pendenciasCadastro({ ...sem, ordenador: { om_sigla: "CINDACTA IV" } }, op).some((x) => /OM CINDACTA IV sem texto fixo/.test(x)));
  assert.ok(pendenciasCadastro({ ...completo(), itens_total_inicial: 151 }, op).some((x) => /Soma dos itens/.test(x)));
  assert.deepEqual(pendenciasCadastro({ ...completo(), itens_total_inicial: 150.04 }, op), [], "até 5 centavos de diferença passa");
  assert.ok(pendenciasCadastro({ ...completo(), reajustes: [{ n: 1, indice_pct: 4.5, novo: false }] }, op).some((x) => /1º reajuste já aplicado/.test(x)));
});

test("casamento: nº igual, nº sem prefixo e PAG com o mesmo número; contrato usado não recebe outro", () => {
  assert.equal(nucleoNumero("DESPESA 002/GAP-MN/2024"), "002/GAPMN/2024");
  const app = [
    { numero_contrato: "037/GAPMN-CINDACTAIV/2025", pag_nup: "67000.000037/2025-00" },
    { numero_contrato: "DESPESA 001/GAPMN-BAMN/2025", pag_nup: "67000.000001/2025-00" },
    { numero_contrato: "CRED 014/GAPMN-HAMN/2026", pag_nup: "67436.007456/2022-75" },
    { numero_contrato: "CRED 015/GAPMN-HAMN/2026", pag_nup: "67436.007456/2022-75" },
  ];
  const regs = [
    { chave: "037/GAPMN-CINDACTAIV/2025" },
    { chave: "001/GAPMN-BAMN/2025" },
    { chave: "CREDENCIAMENTO 014/2022", siloms: { pag: "67436.007456/2022-75" } },
    { chave: "035/GAPMN-DACTAIV/2026", siloms: { pag: "67615.009447/2026-34" } },
    { chave: "DESPESA 001/GAPMN-BAMN/2025" },
  ];
  const { pares, semPar } = casarContratos(regs, app);
  assert.deepEqual(pares.map((p) => [p.reg.chave, p.numero_contrato, p.como]), [
    ["037/GAPMN-CINDACTAIV/2025", "037/GAPMN-CINDACTAIV/2025", "exato"],
    ["001/GAPMN-BAMN/2025", "DESPESA 001/GAPMN-BAMN/2025", "numero"],
    ["CREDENCIAMENTO 014/2022", "CRED 014/GAPMN-HAMN/2026", "pag"],
  ]);
  assert.deepEqual(semPar.map((r) => r.chave), ["035/GAPMN-DACTAIV/2026", "DESPESA 001/GAPMN-BAMN/2025"]);
});

test("junção: carga mais nova substitui; mais velha só preenche o vazio; reajustes pedidos agora continuam", () => {
  const app: Partial<DadosReajuste> = { objeto_resumido: "corrigido no app", empresa: { nome: "EMPRESA APP", cnpj: "", endereco: "Rua B", representante: "" },
    reajustes: [{ n: 1, indice_pct: null, novo: true }, { n: 2, indice_pct: null, novo: true }] };
  const daCarga: Partial<DadosReajuste> = { objeto_resumido: "da carga", objeto_completo: "completo da carga",
    empresa: { nome: "EMPRESA CARGA", cnpj: "00.000.000/0001-91", endereco: "", representante: "FULANO" },
    reajustes: [{ n: 1, indice_pct: 5.1, novo: false, documento: "1º Termo de Apostilamento" }] };
  const manda = mesclarDados(app, daCarga, true);
  assert.equal(manda.objeto_resumido, "da carga");
  assert.deepEqual(manda.empresa, { nome: "EMPRESA CARGA", cnpj: "00.000.000/0001-91", endereco: "Rua B", representante: "FULANO" });
  assert.deepEqual(manda.reajustes!.map((r) => [r.n, r.novo]), [[1, false], [2, true]]);
  const preenche = mesclarDados(app, daCarga, false);
  assert.equal(preenche.objeto_resumido, "corrigido no app");
  assert.equal(preenche.objeto_completo, "completo da carga");
  assert.equal(preenche.empresa!.nome, "EMPRESA APP");
  assert.equal(preenche.empresa!.cnpj, "00.000.000/0001-91");
  assert.deepEqual(mesclarDados(null, { contrato: "X", objeto_completo: "" }, true), { contrato: "X" });
});

test("nº do apostilamento, data da carga e reajustes devidos", () => {
  assert.equal(proximoApostilamento(undefined), 1);
  assert.equal(proximoApostilamento([{ tipo: "CONTRATO" }, { tipo: "APOSTILAMENTO" }, { tipo: "TERMO_ADITIVO" }, { tipo: "APOSTILAMENTO" }]), 3);
  assert.equal(cargaMaisNova("2026-11-17", null), true);
  assert.equal(cargaMaisNova("2026-11-17", "2026-11-16T22:00:00Z"), true);
  assert.equal(cargaMaisNova("2026-11-17", "2026-11-17T09:00:00Z"), false);
  // data-base 06/2025, hoje 17/11/2026: o 1º reajuste (06/2025 a 05/2026) é devido; o 2º ainda não
  const hoje = { a: 2026, m: 11, d: 17 };
  const r = completarReajustesDevidos({ data_base: "06/2025", reajustes: [] }, hoje);
  assert.deepEqual(r, [{ n: 1, indice_pct: null, novo: true }]);
  // já aplicado não volta como novo; pedido que já existe não duplica
  assert.deepEqual(completarReajustesDevidos({ data_base: "06/2024", reajustes: [{ n: 1, indice_pct: 5, novo: false, documento: "1º TA" }] }, hoje),
    [{ n: 1, indice_pct: 5, novo: false, documento: "1º TA" }, { n: 2, indice_pct: null, novo: true }]);
  assert.equal(completarReajustesDevidos({ data_base: "", reajustes: [] }, hoje), null);
});
