// Testes da regra do envio automático ao fiscal. Dados fictícios. Rodar na pasta gapmn-app:
//   node --test supabase/functions/_shared/solicitacoesAuto.test.ts

import { test } from "node:test";
import assert from "node:assert/strict";

import { aplicarModelo, extrairEmail, extrairResponsavel, lerNEs, pedidoDeEmail, planejar, type LinhaNE, type Solicitacao } from "./solicitacoesAuto.ts";

const OBS = "SOLICITACAO DE EMPENHO 26S0500. OBS: CONTRATO 010. CTT: 1T SILVA silva@fab.mil.br TELEFONE: (92) 3654-1234";

function linha(data: string, ne: string, seq: string, valorItem: string, situacao = "ASSINADA", obs = OBS): string[] {
  const c = Array.from({ length: 21 }, () => "");
  c[0] = data; c[1] = ne ? `120630000012026${ne}` : ""; c[2] = seq; c[6] = valorItem; c[7] = ne ? obs : "";
  c[8] = "120630"; c[10] = "339039"; c[14] = "67298.000010/2026-01"; c[15] = "12345678000190"; c[16] = "EMPRESA X";
  c[19] = situacao; c[20] = valorItem;
  return c;
}

const ne = (p: Partial<LinhaNE>): LinhaNE => ({
  data: "10/09/2026", dataISO: "2026-09-10", ne: "2026NE001000", solicitacao: "26S0500", assinada: false, descricao: OBS,
  pag: "67298.000010/2026-01", cnpj: "12345678000190", favorecido: "EMPRESA X", natureza: "339039", ugcred: "120630", valorNE: 1000, ...p,
});

const sol = (p: Partial<Solicitacao>): Solicitacao => ({
  id: "id-1", numero: "26S0500", pag: null, responsavel: "1T SILVA", email: "silva@fab.mil.br", obs_original: OBS, obs_atraso: null,
  status: "EMITIDA", ne_siafi: "2026NE001000", subprocesso: null, nd: "339039", fornecedor: "EMPRESA X", valor: 1000, pregao: null,
  sem_destinatario: false, notificado_emitida_em: "2026-09-10T12:00:00Z", notificado_assinada_em: null, notificacao_ativa: true,
  pdf_ne_url: null, data_emissao: "2026-09-10", revisado_em: null, ...p,
});

test("leitura: NE, solicitação, situação e valor atual pela soma dos itens", () => {
  const nes = lerNEs([
    ["Notas de Empenho"],
    linha("10/09/2026", "NE001000", "1", "600", "PENDENTE"),
    linha("10/09/2026", "", "2", "400", "PENDENTE"),
    linha("20/09/2026", "NE001000", "1", "600", "ASSINADA"),
  ]);
  assert.equal(nes.length, 2);
  assert.deepEqual(nes.map((n) => [n.ne, n.solicitacao, n.assinada, n.valorNE, n.dataISO]), [
    ["2026NE001000", "26S0500", false, 1000, "2026-09-10"],
    ["2026NE001000", "26S0500", true, 1000, "2026-09-20"],
  ]);
});

test("contato do fiscal tirado da observação", () => {
  const email = extrairEmail(OBS);
  assert.equal(email, "silva@fab.mil.br");
  assert.equal(extrairResponsavel(OBS, email), "1T SILVA");
});

test("NE nova cria o registro e manda um e-mail só, mesmo com dois lançamentos", () => {
  const p = planejar([ne({}), ne({ data: "11/09/2026", dataISO: "2026-09-11" })], []);
  assert.equal(p.novas.length, 1);
  assert.equal(p.novas[0].status, "EMITIDA");
  assert.equal(p.novas[0].email, "silva@fab.mil.br");
  assert.equal(p.acoes.length, 1);
  assert.deepEqual([p.acoes[0].tipo, p.acoes[0].resultado, p.acoes[0].nova], ["EMITIDA", "ENVIAR", true]);
});

test("NE nova já assinada manda o e-mail de assinada; sem e-mail fica como pendência", () => {
  const assinada = planejar([ne({ assinada: true })], []);
  assert.equal(assinada.acoes[0].tipo, "ASSINADA");
  const semEmail = planejar([ne({ descricao: "SOLICITACAO DE EMPENHO 26S0500 SEM CONTATO" })], []);
  assert.equal(semEmail.acoes[0].resultado, "SEM_EMAIL");
  assert.equal(semEmail.novas[0].sem_destinatario, true);
});

test("solicitação antiga (emissão antes de 03/08) não cria registro, nem com reforço depois", () => {
  const p = planejar([ne({ data: "20/07/2026", dataISO: "2026-07-20" }), ne({ data: "10/09/2026", dataISO: "2026-09-10" })], []);
  assert.equal(p.novas.length, 0);
  assert.equal(p.acoes.length, 0);
});

test("emitida que vira assinada manda o e-mail de assinada com o modelo do fiscal", () => {
  const p = planejar([ne({ assinada: true })], [sol({})]);
  assert.equal(p.acoes.length, 1);
  const a = p.acoes[0];
  assert.deepEqual([a.tipo, a.resultado, a.patch], ["ASSINADA", "ENVIAR", { status: "ASSINADA" }]);
  const corpo = pedidoDeEmail(a, "id-1", { assunto: "NE {{ne_siafi}} assinada", corpo: "Prezado {{responsavel}}, valor {{valor}}, tel {{telefone_responsavel}}" });
  assert.equal(corpo.solicitacao_id, "id-1");
  assert.equal(corpo.assunto_customizado, "NE 2026NE001000 assinada");
  // o Intl usa espaço não separável depois do "R$"
  assert.equal(String(corpo.corpo_customizado).replace(/\s/g, " "), "Prezado 1T SILVA, valor R$ 1.000,00, tel (92) 3654-1234");
});

test("sem mudança não faz nada; já notificada não manda de novo", () => {
  const p = planejar([ne({ assinada: true })], [sol({ status: "ASSINADA", notificado_assinada_em: "2026-09-21T10:00:00Z", revisado_em: "2026-09-21T10:00:00Z" })]);
  assert.equal(p.acoes.length, 0);
  assert.equal(p.atualizacoes.length, 0);
  assert.equal(p.semMudanca, 1);
});

test("envio que ficou para trás sai de novo, mas não se o registro foi arquivado", () => {
  const pendente = planejar([ne({ assinada: true })], [sol({ status: "ASSINADA", notificado_assinada_em: null })]);
  assert.equal(pendente.acoes.length, 1);
  assert.equal(pendente.acoes[0].patch, null);
  const arquivado = planejar([ne({ assinada: true })], [sol({ status: "ASSINADA", notificado_assinada_em: null, revisado_em: "2026-09-25T10:00:00Z" })]);
  assert.equal(arquivado.acoes.length, 0);
});

test("pendência sem e-mail aparece na mudança de situação e não se repete a cada leitura", () => {
  const mudou = planejar([ne({ assinada: true })], [sol({ email: null, sem_destinatario: true })]);
  assert.equal(mudou.acoes[0].resultado, "SEM_EMAIL");
  const depois = planejar([ne({ assinada: true })], [sol({ status: "ASSINADA", email: null, sem_destinatario: true })]);
  assert.equal(depois.acoes.length, 0);
});

test("notificação desligada e encerrada não mandam e-mail", () => {
  const inativa = planejar([ne({ assinada: true })], [sol({ notificacao_ativa: false })]);
  assert.equal(inativa.acoes[0].resultado, "NOTIF_INATIVA");
  const encerrada = planejar([ne({ assinada: true })], [sol({ status: "ENCERRADA" })]);
  assert.equal(encerrada.acoes.length, 0);
});

test("modelo sem dado mostra traço", () => {
  assert.equal(aplicarModelo("{{pag}} / {{subprocesso}}", { numero: "26S1" }), "— / —");
});
