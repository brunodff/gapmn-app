// Unidades apoiadas (Reajustes › Configurações, revisão 4 da SCON). Dados fictícios. Rodar na pasta gapmn-app:
//   node --test src/lib/apostilamento/unidades.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { acharUnidade, configDaUnidade, configSemCadastro, normalizarUnidade, pendenciasUnidade, siglaChave, unidadeDaConfig, unidadeVazia } from "./unidades.ts";
import { CONFIG_VAZIA } from "./tipos.ts";

const gap = normalizarUnidade({
  sigla: "GAP-MN", padrao: true, cefa: true, nome: "Grupamento de Apoio de Manaus", ug: "120630",
  ordenador: { ...CONFIG_VAZIA.ordenador, nome: "FULANO DE TESTE", posto: "Cel Int" }, aci: { nome: "BELTRANO", posto: "Maj Int", funcao: "Agente de Controle Interno do GAP-MN" },
  ug_apoio: CONFIG_VAZIA.ug_apoio, texto_fixo: "**I – CONTRATANTE:** texto do GAP-MN",
});
const cindacta = normalizarUnidade({ sigla: "CINDACTA IV", grafias: ["DACTA IV", "CINDACTAIV"], nome: "Quarto Centro Integrado de Defesa Aérea e Controle de Tráfego Aéreo",
  ordenador: { ...CONFIG_VAZIA.ordenador, nome: "SICRANO DE TESTE" }, texto_fixo: "**I – CONTRATANTE:** texto do CINDACTA" });
const bamn = normalizarUnidade({ sigla: "BAMN", artigo: "da", nome: "Base Aérea de Manaus", ordenador: { ...CONFIG_VAZIA.ordenador, nome: "OUTRO", feminino: true } });
const lista = [gap, cindacta, bamn];

test("acha a unidade pela sigla ou por outra grafia, sem acento, espaço ou hífen", () => {
  assert.equal(siglaChave("Cindacta-IV"), "CINDACTAIV");
  assert.equal(acharUnidade(lista, "GAPMN")?.sigla, "GAP-MN");
  assert.equal(acharUnidade(lista, "dacta iv")?.sigla, "CINDACTA IV");
  assert.equal(acharUnidade(lista, "CINDACTAIV")?.sigla, "CINDACTA IV");
  assert.equal(acharUnidade(lista, "HAMN"), null);
  assert.equal(acharUnidade(lista, ""), null);
});

test("configuração do motor: dados da unidade que assina, texto fixo pela sigla do contrato e cargo com o artigo", () => {
  const c = configDaUnidade(cindacta, "DACTA IV", 45);
  assert.equal(c.ordenador.nome, "SICRANO DE TESTE");
  assert.equal(c.ordenador.om_sigla, "CINDACTA IV");
  assert.equal(c.textos_fixos_om["DACTA IV"], "**I – CONTRATANTE:** texto do CINDACTA");
  assert.equal(c.textos_fixos_om["CINDACTA IV"], "**I – CONTRATANTE:** texto do CINDACTA");
  assert.equal(c.aci.funcao, "Agente de Controle Interno do CINDACTA IV");
  assert.equal(c.ug_apoio.nome, "QUARTO CENTRO INTEGRADO DE DEFESA AÉREA E CONTROLE DE TRÁFEGO AÉREO");
  assert.equal(c.dias_alerta, 45);
  const b = configDaUnidade(bamn, "BAMN");
  assert.equal((b.ordenador as Record<string, unknown>).funcao_assinatura, "Ordenadora de Despesas da BAMN");
  assert.deepEqual(b.textos_fixos_om, {});
  assert.equal((configDaUnidade(gap, "GAP-MN").ordenador as Record<string, unknown>).funcao_assinatura, undefined);
});

test("OM sem cadastro: campos em branco, nunca o Ordenador do GAP-MN", () => {
  const c = configSemCadastro("hamn");
  assert.equal(c.ordenador.nome, "");
  assert.equal(c.ordenador.om_sigla, "HAMN");
  assert.equal(c.aci.nome, "");
  assert.match(c.ug_apoio.nome, /HAMN – cadastrar/);
  assert.deepEqual(c.textos_fixos_om, {});
});

test("migração da configuração única, unidade nova copiando outra e pendências", () => {
  const u = unidadeDaConfig({ ...CONFIG_VAZIA, textos_fixos_om: { "GAP-MN": "texto" } });
  assert.equal(u.sigla, "GAP-MN"); assert.equal(u.padrao, true); assert.equal(u.texto_fixo, "texto"); assert.equal(u.cefa, true);
  const nova = unidadeVazia("ala 8", gap);
  assert.equal(nova.sigla, "ALA 8"); assert.equal(nova.padrao, false); assert.equal(nova.ordenador.om_sigla, "ALA 8"); assert.equal(nova.ordenador.nome, "FULANO DE TESTE");
  assert.deepEqual(pendenciasUnidade(bamn), ["nome do Agente de Controle Interno", "código da UG", "autoridade do campo 19 da Ficha (OM fora do CEFA)"]);
  assert.deepEqual(pendenciasUnidade(gap), []);
});
