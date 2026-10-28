// Testes dos lançamentos de empenho (emissão, reforço e anulação) da lista "Empenhos do dia".
// Dados fictícios no layout de 21 colunas da planilha "Notas de Empenho". Rodar na pasta gapmn-app:
//   node --test src/lib/orcamento/lancamentos.test.ts

import { test } from "node:test";
import assert from "node:assert/strict";

import { diasComLancamento, fatorDosLancamentos, lerLancamentos, resumirDia, semContatos } from "./lancamentos.ts";

/** Linha da planilha: data, NE (vazia nas linhas de item), item, descrição, valor atual do item, valor do lançamento. */
function linha(data: string, ne: string, seq: string, desc: string, valorItem: string, valorLanc: string, extra: Partial<Record<number, string>> = {}): string[] {
  const c = Array.from({ length: 21 }, () => "");
  c[0] = data; c[1] = ne ? `120630000012026${ne}` : ""; c[2] = seq; c[3] = desc; c[6] = valorItem; c[20] = valorLanc;
  c[7] = "SOLICITACAO DE EMPENHO 26S0101. CTT: 1T FULANO fulano@fab.mil.br (92) 99123-4567";
  c[8] = "120630"; c[9] = "GRUPAMENTO DE APOIO DE MANAUS"; c[10] = "339030"; c[11] = "MATERIAL DE CONSUMO";
  c[12] = "SF0001"; c[13] = "VIDA VEGETATIVA - SEFA"; c[14] = "67298.000001/2026-11";
  c[15] = "12345678000190"; c[16] = "EMPRESA TESTE LTDA"; c[17] = "00000000000"; c[18] = "ASSINANTE"; c[19] = "ASSINADA";
  for (const [k, v] of Object.entries(extra)) c[Number(k)] = v as string;
  return c;
}

test("emissão, reforço e anulação de uma NE que fecha com o valor atual", () => {
  const r = lerLancamentos([
    ["Notas de Empenho"],
    linha("10/03/2026", "NE000010", "1", "Item compra: 00001 - PAPEL A4, 75 G", "800", "1000"),
    linha("20/03/2026", "NE000010", "1", "Item compra: 00001 - PAPEL A4, 75 G", "800", "300"),
    linha("02/04/2026", "NE000010", "1", "Item compra: 00001 - PAPEL A4, 75 G", "800", "-500"),
  ]);
  assert.equal(r.notas.length, 1);
  const n = r.notas[0];
  assert.equal(n.valorAtual, 800);
  assert.equal(n.sigla, "GAP-MN");
  assert.equal(n.solicitacao, "26S0101");
  assert.equal(n.favorecido.tipo, "empresa");
  assert.deepEqual(n.lancamentos.map((l) => [l.data, l.tipo, l.valor, l.conferido]), [
    ["2026-03-10", "emissao", 1000, true],
    ["2026-03-20", "reforco", 300, true],
    ["2026-04-02", "anulacao", -500, true],
  ]);
  // a lista geral vem do mais recente para o mais antigo
  assert.deepEqual(r.lancamentos.map((l) => l.data), ["2026-04-02", "2026-03-20", "2026-03-10"]);
  assert.deepEqual(diasComLancamento(r.lancamentos), ["2026-04-02", "2026-03-20", "2026-03-10"]);
});

test("lançamentos multiplicados pela repetição de linhas são divididos pelo fator", () => {
  const r = lerLancamentos([
    linha("19/02/2026", "NE000081", "1", "Solicitacao de Emissao de Empenho", "2935,95", "5994"),
    linha("17/03/2026", "NE000081", "1", "Solicitacao de Emissao de Empenho", "2935,95", "-122,1"),
  ]);
  const ls = r.notas[0].lancamentos;
  assert.equal(ls[0].valor, 2997);
  assert.ok(Math.abs(ls[1].valor - -61.05) < 1e-9);
  assert.equal(ls[1].tipo, "anulacao");
  assert.ok(ls.every((l) => l.conferido));
});

test("NE que não fecha fica 'a conferir' com o valor como veio", () => {
  const r = lerLancamentos([
    linha("01/02/2026", "NE000020", "1", "Item compra: 00002 - CANETA", "100", "130"),
    linha("05/02/2026", "NE000020", "1", "Item compra: 00002 - CANETA", "100", "7"),
  ]);
  const ls = r.notas[0].lancamentos;
  assert.deepEqual(ls.map((l) => [l.tipo, l.valor, l.conferido]), [["emissao", 130, false], ["reforco", 7, false]]);
});

test("anulação total (valor atual zero) fecha sem fator", () => {
  assert.equal(fatorDosLancamentos([716, -1.83, -714.17], 0), 1);
  assert.equal(fatorDosLancamentos([500, 10], 0), null);
  assert.equal(fatorDosLancamentos([4500000, 6000000, 4500000], 5000000), 3);
});

test("itens: linhas sem NE no mesmo dia são do lançamento de cima; repetição do item não duplica", () => {
  const r = lerLancamentos([
    linha("26/01/2026", "NE000007", "1", "Item compra: 00038 - REAGENTE A", "2766,72", "4558,14"),
    linha("26/01/2026", "", "2", "Item compra: 00040 - REAGENTE B", "1791,42", "4558,14"),
    linha("26/01/2026", "", "", "", "1791,42", "4558,14"),
    linha("27/01/2026", "", "3", "Item de outro dia", "999", "999"),
  ]);
  const n = r.notas[0];
  assert.deepEqual(n.itens.map((i) => [i.seq, i.nome, i.valor]), [["1", "REAGENTE A", 2766.72], ["2", "REAGENTE B", 1791.42]]);
  assert.ok(Math.abs(n.valorAtual - 4558.14) < 1e-9);
});

test("favorecido pessoa física não expõe nome nem documento", () => {
  const r = lerLancamentos([linha("10/03/2026", "NE000030", "1", "DIARIAS", "500", "500", { 15: "12345678901", 16: "FULANO DE TAL" })]);
  assert.deepEqual(r.notas[0].favorecido, { tipo: "pessoa", documento: null, nome: "Pessoa física" });
});

test("resumo do dia por tipo e máscara de contatos", () => {
  const r = lerLancamentos([
    linha("10/03/2026", "NE000040", "1", "X", "100", "100"),
    linha("10/03/2026", "NE000041", "1", "Y", "50", "50"),
    linha("10/03/2026", "NE000040", "1", "X", "100", "0"),
  ]);
  const dia = r.lancamentos.filter((l) => l.data === "2026-03-10");
  const res = resumirDia(dia);
  assert.equal(res.emissao.quantidade, 2);
  assert.equal(res.emissao.valor, 150);
  assert.equal(semContatos("CTT: 1T FULANO fulano@fab.mil.br (92) 99123-4567 ou 92 3654-1234"), "CTT: 1T FULANO [e-mail] [telefone] ou [telefone]");
  assert.equal(semContatos("PAG 67298.003336/2024-92, R$ 1.234.567,89"), "PAG 67298.003336/2024-92, R$ 1.234.567,89");
});
