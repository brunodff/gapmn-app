import { test } from "node:test";
import assert from "node:assert/strict";
import { CONFIG_PADRAO, S, type Contratacao, type Elo, type MembroEquipe, type RegraMjr } from "./tipos.ts";
import { alertasDe, calcularKpis, categoriaProvavel, normalizarIdContratacao, normalizarPag, pagValido, semelhanca, situacaoPrazo, sugerirModalidade, triagemJuridica } from "./regras.ts";
import { agruparPgc, resumirObjeto } from "./pgc.ts";
import { cruzarDnr, juntarLeituras, lerDocumento, lerPlanilhaSiloms, referenciasDoEmail, tipoDoEmail, type DadosDnr } from "./documentos.ts";
import { acharDou, acharPublicado, aplicar, avisosDoDia, contratacaoNova, cruzarPublicacao, precisaD30, processarEvento, registrarDnr, sincronizarPgc, validarEdicao, type Estado, type ProcessoPublico } from "./motor.ts";

// Dados fictícios (nomes, PAG e e-mails inventados)
const HOJE = "2027-02-10";
const elos: Elo[] = [{ id: 1, om: "HAMN", nome_om: "Hospital", elo_nome: "Elo Teste", elo_email: "elo.hamn@exemplo.mil.br", areas_pgc: ["19862"], interno: false, ativo: true },
  { id: 2, om: "SIE", nome_om: "Seção de Infraestrutura", elo_nome: "Elo Interno", elo_email: "sie@exemplo.mil.br", areas_pgc: ["18018"], interno: true, ativo: true }];
const equipe: MembroEquipe[] = [{ id: 1, nome: "2º Ten Pregoeiro Teste", email: "pregoeiro@exemplo.mil.br", funcao: "Pregoeiro", ativo: true }];
const regraMjr: RegraMjr = { id: 7, titulo: "MJR material de consumo comum", agu_id: 99, categorias: ["Aquisição"], modalidades: ["Pregão Eletrônico"], valor_maximo: 500000, palavras: [], srp: null, vigencia_fim: "2028-01-01", ativo: true };
const estado = (x: Partial<Estado> = {}): Estado => ({
  hoje: HOJE, agora: `${HOJE}T12:00:00Z`, cfg: { ...CONFIG_PADRAO, email_slic: "slic@exemplo.mil.br" }, elos, equipe, regras: [regraMjr],
  irregularidades: new Map(), eventos: new Map(), ...x,
});
const c0 = (x: Partial<Contratacao> = {}): Contratacao => contratacaoNova("c1", 2027, {
  id_contratacao_pgc: "120630-110/2027", chave_pgc: "material de limpeza|2027-03-12", objeto: "Aquisição de material de limpeza e higiene para a guarnição",
  objeto_resumido: "Material de limpeza e higiene", categoria: "Aquisição", valor_estimado: 250000, valor_origem: "pca", om_apoiada: "HAMN",
  data_estimada_chegada: "2027-03-12", data_estimada_conclusao: "2027-07-01", itens_pca: [40, 41], ...x,
}, `${HOJE}T08:00:00Z`);

test("PAG e número da contratação: máscara e normalização", () => {
  assert.equal(normalizarPag("PAG 67000.000123/2027-11"), "67000.000123/2027-11");
  assert.equal(normalizarPag("67000000123202711"), "67000.000123/2027-11");
  assert.equal(normalizarPag("xxxxx.xxxxxx/xxxx-xx"), null);
  assert.ok(pagValido("67000.000123/2027-11"));
  assert.ok(!pagValido("67000.000123/2027"));
  assert.equal(normalizarIdContratacao("Identificador: 120630 - 0110/2027"), "120630-110/2027");
});

test("modalidade sugerida pela Lei nº 14.133/2021 e categoria pelo PGC", () => {
  const cfg = CONFIG_PADRAO;
  const s = (x: Partial<Contratacao>) => sugerirModalidade({ categoria: "Aquisição", valor_estimado: 50000, objeto: "material de expediente", sistema_srp: false, ...x }, cfg);
  assert.equal(s({}).modalidade, "Dispensa Eletrônica");
  assert.match(s({}).motivo, /art\. 75, II/);
  assert.equal(s({ valor_estimado: 70000 }).modalidade, "Pregão Eletrônico");
  assert.equal(s({ sistema_srp: true }).modalidade, "Pregão Eletrônico");
  assert.equal(s({ categoria: "Serviço de Engenharia", valor_estimado: 100000 }).modalidade, "Dispensa Eletrônica");
  assert.match(s({ categoria: "Serviço de Engenharia", valor_estimado: 100000 }).motivo, /art\. 75, I /);
  assert.equal(s({ categoria: "Serviço de Engenharia", valor_estimado: 300000 }).modalidade, "Pregão Eletrônico");
  assert.equal(s({ categoria: "Obra", valor_estimado: 30000 }).modalidade, "Concorrência");
  assert.equal(s({ objeto: "Credenciamento de clínicas" }).modalidade, "Credenciamento");
  assert.equal(s({ categoria: "Locação", objeto: "Locação de imóvel para depósito" }).modalidade, "Inexigibilidade");
  assert.equal(categoriaProvavel("Serviço de manutenção predial das instalações", "S", null), "Serviço de Engenharia");
  assert.equal(categoriaProvavel("Aquisição de notebooks", "M", "Material"), "TIC");
  assert.equal(categoriaProvavel("Gêneros alimentícios", "M", "Material"), "Aquisição");
  assert.equal(categoriaProvavel("Construção de hangar", "S", "Obras e Serviços de Engenharia"), "Obra");
});

test("PGC: itens dos Dados Abertos viram uma contratação por projeto, com o código do PNCP", () => {
  const itens = [
    { descricaoArtefato: "4/2027", codigoAreaDfd: "18018", tipoItem: "M", valorTotalItem: 1000.5, tituloProjetoCompra: "Aquisição de material de limpeza", descricaoProjetoCompra: "Material de limpeza para a guarnição", dataInicioProcessoCompra: "2027-03-29T01:00:00", dataFimProcessoCompra: "2027-07-07T01:00:00", numeroItemPncp: 498 },
    { descricaoArtefato: "4/2027", codigoAreaDfd: "18018", tipoItem: "M", valorTotalItem: 2000, tituloProjetoCompra: "Aquisição de material de limpeza", descricaoProjetoCompra: "Material de limpeza para a guarnição", dataInicioProcessoCompra: "2027-03-29T01:00:00", dataFimProcessoCompra: "2027-07-07T01:00:00", numeroItemPncp: 499 },
    { descricaoArtefato: "35/2027", codigoAreaDfd: "19862", tipoItem: "S", valorTotalItem: 5000, tituloProjetoCompra: "Serviço de controle de pragas", dataInicioProcessoCompra: "2027-01-10T01:00:00", dataFimProcessoCompra: "2027-04-10T01:00:00", numeroItemPncp: 900 },
  ];
  const pncp = [{ numeroItem: 498, grupoContratacaoCodigo: "120630-4/2027", categoriaItemPcaNome: "Material" }, { numeroItem: 499, grupoContratacaoCodigo: "120630-4/2027" }];
  const g = agruparPgc(itens, pncp);
  assert.equal(g.length, 2);
  assert.equal(g[0].objeto_resumido, "Serviço de controle de pragas");
  assert.equal(g[0].id_contratacao_pgc, null); // ainda não publicado no PNCP
  assert.equal(g[1].id_contratacao_pgc, "120630-4/2027");
  assert.equal(g[1].valor_estimado, 3000.5);
  assert.deepEqual(g[1].itens_pca, [498, 499]);
  assert.equal(g[1].data_estimada_chegada, "2027-03-29");
  assert.equal(g[1].data_estimada_conclusao, "2027-07-07");
  assert.equal(g[0].categoria, "Serviço Comum");
  assert.equal(resumirObjeto("Contratação de empresa especializada em limpeza."), "Empresa especializada em limpeza");
});

const TR = `MINISTÉRIO DA DEFESA
TERMO DE REFERÊNCIA
(Processo Administrativo n° 67000.000123/2027-11)
1. CONDIÇÕES GERAIS DA CONTRATAÇÃO
   1.1. Aquisição de material de limpeza e higiene para a guarnição, nos termos da tabela abaixo, conforme condições.
2.2. O objeto da contratação está previsto no Plano de Contratações Anual 2027, conforme detalhamento a seguir:
      I) ID PCA no PNCP: 00394429000100-0-000020/2027;
      III) Id do item no PCA: 40, 41;
      V) Identificador da Futura Contratação: 120630-110/2027;
4.3. Diante das conclusões extraídas do processo administrativo nº xxxxx.xxxxxx/xxxx-xx, a Administração
                                              FULANO DE TAL 1º Ten Int
                                                     Presidente da Equipe de Planejamento
Assinado via ASSINATURA CADASTRAL por 1º Ten FULANO DE TAL no dia 10/01/2027 às 10:00`;
const OFICIO = `OFÍCIO Nº 12/SLIC/2027
Assunto: Abertura de PAG — DNR nº 345/2027
Encaminho a DNR 345/2027 para abertura do PAG nº 67000.000999/2027-22, referente ao material de limpeza.
Manaus, 5 de fevereiro de 2027.`;

test("leitura do TR e do Ofício: PAG, contratação, itens, objeto, assinante e DNR", () => {
  const tr = lerDocumento(TR);
  assert.equal(tr.tipo, "TR");
  assert.equal(tr.pag, "67000.000123/2027-11");
  assert.equal(tr.numero_contratacao, "120630-110/2027");
  assert.deepEqual(tr.itens_pca, [40, 41]);
  assert.match(tr.objeto ?? "", /^Aquisição de material de limpeza e higiene para a guarnição$/);
  assert.equal(tr.assinante, "FULANO DE TAL 1º Ten Int");
  const of = lerDocumento(OFICIO);
  assert.equal(of.tipo, "OFICIO");
  assert.equal(of.pag, "67000.000999/2027-22");
  assert.equal(of.numero_dnr, "345/2027");
  assert.equal(of.data, "2027-02-05");
  const j = juntarLeituras([tr, of]);
  assert.equal(j.pag_oficio, "67000.000999/2027-22");
  assert.equal(j.pag_tr, "67000.000123/2027-11");
  assert.equal(j.numero_dnr, "345/2027");
  assert.equal(j.assinante_tr, "FULANO DE TAL 1º Ten Int");
  // sem o bloco do presidente: a primeira assinatura eletrônica
  assert.equal(lerDocumento("TERMO DE REFERÊNCIA\nAssinado via ASSINATURA CADASTRAL por Cap BELTRANO SILVA no dia 01/01/2027").assinante, "Cap BELTRANO SILVA");
});

const dnr = (x: Partial<DadosDnr> = {}): DadosDnr => ({ numero_dnr: "345/2027", data_chegada: "2027-02-09", pag_oficio: "67000.000999/2027-22", pag_tr: "67000.000999/2027-22", numero_contratacao: "120630-110/2027", itens_pca: [40], objeto: "Aquisição de material de limpeza e higiene", assinante_tr: "FULANO DE TAL", fonte: "upload", ...x });

test("cruzamento DNR × PCA: Ofício prevalece, divergência vira alerta, número ruim vai para a fila", () => {
  const pca = [c0(), c0({ id: "c2", id_contratacao_pgc: "120630-200/2027", objeto: "Aquisição de gêneros alimentícios perecíveis", objeto_resumido: "Gêneros alimentícios", chave_pgc: "x" })];
  let r = cruzarDnr(dnr(), pca);
  assert.equal(r.contratacao?.id, "c1");
  assert.equal(r.irregularidades.length, 0);
  r = cruzarDnr(dnr({ pag_tr: "67000.000123/2027-11" }), pca);
  assert.equal(r.contratacao?.id, "c1");
  assert.equal(r.pag, "67000.000999/2027-22");
  assert.equal(r.irregularidades[0].tipo, "pag_divergente");
  r = cruzarDnr(dnr({ numero_contratacao: null }), pca);
  assert.equal(r.contratacao, null);
  assert.equal(r.irregularidades[0].tipo, "contratacao_ausente");
  assert.equal(r.candidata?.id, "c1"); // pelo objeto
  r = cruzarDnr(dnr({ numero_contratacao: "110/2027 do PCA" }), pca);
  assert.equal(r.irregularidades[0].tipo, "contratacao_invalida");
  r = cruzarDnr(dnr({ numero_contratacao: "120630-999/2027" }), pca);
  assert.equal(r.irregularidades[0].tipo, "contratacao_invalida");
  r = cruzarDnr(dnr({ numero_contratacao: "120630-200/2027" }), pca);
  assert.equal(r.contratacao, null);
  assert.equal(r.irregularidades[0].tipo, "objeto_incompativel");
  r = cruzarDnr(dnr({ itens_pca: [40, 77] }), pca);
  assert.equal(r.contratacao?.id, "c1");
  assert.equal(r.irregularidades[0].tipo, "item_fora_da_contratacao");
  const comPag = [c0({ numero_pag: "67000.000999/2027-22", id: "c9", id_contratacao_pgc: "120630-5/2027", chave_pgc: "y" }), ...pca];
  r = cruzarDnr(dnr(), comPag);
  assert.equal(r.irregularidades[0].tipo, "pag_em_uso");
  assert.ok(semelhanca("Aquisição de material de limpeza", "Materiais de limpeza e higiene") > 0.5);
});

test("triagem jurídica: regra de MJR vigente ou CJU", () => {
  const c = { categoria: "Aquisição" as const, modalidade: "Pregão Eletrônico", valor_estimado: 200000, objeto: "material de limpeza", sistema_srp: true };
  assert.equal(triagemJuridica(c, [regraMjr], HOJE).enquadramento, "Parecer Referencial AGU");
  assert.equal(triagemJuridica({ ...c, valor_estimado: 900000 }, [regraMjr], HOJE).enquadramento, "Análise CJU - Art. 53");
  assert.equal(triagemJuridica(c, [{ ...regraMjr, vigencia_fim: "2027-01-01" }], HOJE).enquadramento, "Análise CJU - Art. 53");
  assert.equal(triagemJuridica({ ...c, categoria: "Obra" }, [regraMjr], HOJE).enquadramento, "Análise CJU - Art. 53");
});

test("motor: DNR → minutas → MJR com o OD → publicação → homologação, com histórico e e-mails", () => {
  const e = estado();
  let c = c0();
  const d = registrarDnr(dnr(), [c], { origem: "manual", usuario_nome: "SLIC Teste" }, e);
  assert.equal(d.situacao, "vinculada");
  c = d.resultado!.novo;
  assert.equal(c.status_atual, S.DNR);
  assert.equal(c.numero_pag, "67000.000999/2027-22");
  assert.equal(c.responsavel_apoiada, "FULANO DE TAL");
  assert.equal(c.enquadramento_juridico, "Parecer Referencial AGU"); // triagem automática na chegada da DNR (pregão, aquisição, 250 mil)
  assert.ok(d.resultado!.historico.some((h) => h.campo === "status_atual" && h.para === S.DNR));
  assert.equal(d.resultado!.emails[0].para[0], "elo.hamn@exemplo.mil.br");
  assert.match(d.resultado!.emails[0].assunto, /Chegada da DNR/);

  let r = aplicar(c, { responsavel_gapmn: "3S Aux Teste", subprocesso_fase_interna: { nome: "DNR 345 - LIMPEZA", fluxo: 2, marcos: { minutas: "2027-02-11" } } }, { origem: "manual" }, e);
  assert.equal(r.novo.status_atual, S.MINUTAS);
  c = r.novo;
  r = aplicar(c, { subprocesso_fase_interna: { ...c.subprocesso_fase_interna!, marcos: { ...c.subprocesso_fase_interna!.marcos, aci: "2027-02-15", od: "2027-02-16" } } }, { origem: "siloms" }, e);
  assert.equal(r.novo.status_atual, S.MJR);
  c = r.novo;
  const proc: ProcessoPublico = { id_compra: "12063005001102027", modalidade: "Pregão - Eletrônico", numero_processo: "110/2027", processo_nup: "67000.000999/2027-22", situacao: "Em andamento", srp: true, valor_estimado: 240000, data_publicacao: "2027-02-20", link_pncp: "https://pncp.gov.br/x", objeto: "Material de limpeza" };
  r = cruzarPublicacao(c, proc, new Set(), e)!;
  assert.equal(r.novo.status_atual, S.PUBLICADO);
  assert.equal(r.novo.modalidade_origem, "publicada");
  assert.equal(r.novo.valor_estimado, 240000);
  assert.equal(r.novo.valor_origem, "edital");
  assert.equal(r.novo.sistema_srp, true);
  assert.ok(r.novo.alertas_ativos.some((a) => a.codigo === "dou_pendente") && r.novo.alertas_ativos.some((a) => a.codigo === "ebc_pendente"));
  c = r.novo;
  r = cruzarPublicacao(c, { ...proc, situacao: "Homologado", data_resultado: "2027-04-01" }, new Set(), e)!;
  assert.equal(r.novo.status_atual, S.HOMOLOGADO);
  assert.equal(r.novo.data_homologacao, "2027-04-01");
  const h = r.emails.find((m) => m.tipo === "homologacao_srp");
  assert.deepEqual(h?.para, ["atas.guarnaemn@gmail.com"]);
  assert.ok(r.emails.some((m) => m.tipo === "macro"));
  r = aplicar(r.novo, { encaminhado_em: "2027-04-02" }, { origem: "sistema" }, e);
  assert.equal(r.novo.status_atual, S.ENCAMINHADO);
});

test("motor: CJU (envio, prazo e retorno) e subprocesso pós-CJU até a liberação", () => {
  const e = estado({ regras: [] });
  let c = aplicar(c0({ numero_dnr: "1", data_chegada_dnr: "2027-02-01", responsavel_gapmn: "Aux" }), {}, { origem: "sistema" }, e).novo;
  assert.equal(c.enquadramento_juridico, "Análise CJU - Art. 53");
  const ev = processarEvento({ id: "m1", tipo: "cju_envio", pag: null, assunto: "SOLICITAÇÃO DE ANÁLISE JURÍDICA - PAG:67000.000999/2027-22", data: "2027-01-20" }, [{ ...c, numero_pag: "67000.000999/2027-22" }], e);
  c = ev.resultado!.novo;
  assert.equal(c.status_atual, S.CJU);
  assert.equal(c.data_envio_cju, "2027-01-20");
  assert.ok(c.alertas_ativos.some((a) => a.codigo === "cju_sla")); // 21 dias em 10/02
  const av = avisosDoDia(c, e);
  assert.equal(av.emails[0].tipo, "sla_cju");
  c = processarEvento({ id: "m2", tipo: "cju_retorno", pag: "67000.000999/2027-22", data: "2027-02-12" }, [c], e).resultado!.novo;
  assert.equal(c.status_atual, S.RETORNO_CJU);
  c = processarEvento({ id: "s1", tipo: "subprocesso", pag: "67000.000999/2027-22", data: "2027-02-14", dados: { nome: "DNR 1 - LIMPEZA", fluxo: "FASE INTERNA DA LICITAÇÃO GAP-MN - PÓS CJU", marco: "aci" } }, [c], e).resultado!.novo;
  assert.equal(c.status_atual, S.POS_CJU);
  assert.equal(c.subprocesso_pos_cju?.fluxo, 4);
  c = processarEvento({ id: "s2", tipo: "subprocesso", pag: "67000.000999/2027-22", data: "2027-02-15", dados: { fluxo: 4, marco: "od" } }, [c], e).resultado!.novo;
  assert.equal(c.status_atual, S.LIBERADO);
});

test("status manual exige justificativa, vai ao histórico e a automação respeita a exceção", () => {
  const e = estado();
  const c = aplicar(c0({ numero_dnr: "1" }), {}, { origem: "sistema" }, e).novo;
  const v = validarEdicao(c, {}, [c], S.SUSPENSO, "curta");
  assert.ok("erro" in v);
  const ok = validarEdicao(c, {}, [c], S.SUSPENSO, "Impugnação acolhida, edital em revisão.");
  assert.ok("status" in ok);
  const r = aplicar(c, {}, { origem: "manual", usuario_nome: "SLIC Teste", justificativa: "Impugnação acolhida, edital em revisão." }, e, S.SUSPENSO);
  assert.equal(r.novo.status_atual, S.SUSPENSO);
  assert.equal(r.novo.status_origem, "manual");
  const h = r.historico.find((x) => x.campo === "status_atual")!;
  assert.equal(h.justificativa, "Impugnação acolhida, edital em revisão.");
  assert.equal(h.usuario_nome, "SLIC Teste");
  // fatos novos não tiram da exceção; o PNCP também não tira a exceção posta à mão
  assert.equal(aplicar(r.novo, { pncp_publicado_em: "2027-03-01" }, { origem: "pncp" }, e).novo.status_atual, S.SUSPENSO);
  assert.equal(aplicar(r.novo, {}, { origem: "pncp" }, e, S.DESERTO).novo.status_atual, S.SUSPENSO);
  // suspensão automática (PNCP) volta para Publicado quando o PNCP diz "Em andamento"
  const pub = { ...r.novo, status_atual: S.SUSPENSO, status_origem: "automatico" as const, pncp_publicado_em: "2027-03-01", numero_pag: "67000.000999/2027-22" };
  const volta = cruzarPublicacao(pub, { id_compra: "1", modalidade: "Pregão", numero_processo: "110/2027", processo_nup: "67000.000999/2027-22", situacao: "Em andamento", srp: false, valor_estimado: 0, data_publicacao: "2027-03-01", link_pncp: null, objeto: "x" }, new Set(), e)!;
  assert.equal(volta.novo.status_atual, S.PUBLICADO);
  // deserto automático fica
  const des = cruzarPublicacao(pub, { id_compra: "1", modalidade: "Pregão", numero_processo: "110/2027", processo_nup: "67000.000999/2027-22", situacao: "Deserto", srp: false, valor_estimado: 0, data_publicacao: "2027-03-01", link_pncp: null, objeto: "x" }, new Set(), e)!;
  assert.equal(des.novo.status_atual, S.DESERTO);
  assert.equal(aplicar(des.novo, { pregoeiro_responsavel: "X" }, { origem: "manual" }, e).novo.status_atual, S.DESERTO);
});

test("edição: PAG na máscara e único, DOU/EBC com data", () => {
  const a = c0(); const b = c0({ id: "c2", numero_pag: "67000.000555/2027-01", id_contratacao_pgc: "120630-2/2027" });
  assert.ok("erro" in validarEdicao(a, { numero_pag: "123" }, [a, b]));
  assert.match((validarEdicao(a, { numero_pag: "67000.000555/2027-01" }, [a, b]) as { erro: string }).erro, /já está/);
  assert.equal((validarEdicao(a, { numero_pag: "67000000777202702" }, [a, b]) as { mudancas: Partial<Contratacao> }).mudancas.numero_pag, "67000.000777/2027-02");
  assert.ok("erro" in validarEdicao(a, { status_publicacao_dou: true }, [a]));
  assert.ok("mudancas" in validarEdicao(a, { status_publicacao_dou: true, dou_data: "2027-03-02", dou_link: "https://in.gov.br/x" }, [a]));
  assert.ok("erro" in validarEdicao(a, { status_atual: "x" }, [a]));
  const m = validarEdicao(a, { modalidade: "Concorrência" }, [a]) as { mudancas: Partial<Contratacao> };
  assert.equal(m.mudancas.modalidade_origem, "manual");
  assert.equal(aplicar(a, m.mudancas, { origem: "manual" }, estado()).novo.modalidade, "Concorrência"); // a sugestão não sobrescreve
});

test("PGC: cria, atualiza sem mexer no valor da SLIC e marca o que saiu do PGC", () => {
  const e = estado();
  const existente = c0({ valor_origem: "manual", valor_estimado: 999, om_apoiada: null, area_pgc: "19862" });
  const sumiu = c0({ id: "c3", chave_pgc: "antigo|2027-01-01", id_contratacao_pgc: null });
  const pgc = [
    { chave_pgc: "material de limpeza|2027-03-12", id_contratacao_pgc: "120630-110/2027", numeros_dfd: ["4/2027"], itens_pca: [40], objeto: "Material de limpeza (novo texto)", objeto_resumido: "Material de limpeza", categoria: "Aquisição" as const, valor_estimado: 260000, area_pgc: "19862", data_estimada_chegada: "2027-03-15", data_estimada_conclusao: "2027-07-01" },
    { chave_pgc: "pragas|2027-04-01", id_contratacao_pgc: null, numeros_dfd: ["35/2027"], itens_pca: [], objeto: "Controle de pragas", objeto_resumido: "Controle de pragas", categoria: "Serviço Comum" as const, valor_estimado: 30000, area_pgc: "18018", data_estimada_chegada: "2027-04-01", data_estimada_conclusao: "2027-06-01" },
  ];
  let n = 0;
  const p = sincronizarPgc([existente, sumiu], pgc, 2027, e, () => `novo${++n}`);
  assert.equal(p.novas.length, 1);
  assert.equal(p.novas[0].om_apoiada, "SIE"); // área 18018 → Elo da SIE
  assert.equal(p.novas[0].modalidade, "Dispensa Eletrônica");
  assert.equal(p.novas[0].modalidade_origem, "sugerida");
  const atual = p.resultados.find((r) => r.id === "c1")!;
  assert.equal(atual.novo.valor_estimado, 999);
  assert.equal(atual.novo.data_estimada_chegada, "2027-03-15");
  assert.equal(atual.novo.om_apoiada, "HAMN");
  assert.ok(atual.historico.every((h) => h.origem === "pgc"));
  assert.equal(p.resultados.find((r) => r.id === "c3")?.novo.pgc_ausente_desde, HOJE);
});

test("publicação: acha pelo PAG ou pelo nº do certame igual ao da contratação; DOU pelo título", () => {
  const c = c0();
  const procs: ProcessoPublico[] = [
    { id_compra: "a", modalidade: "Pregão - Eletrônico", numero_processo: "110/2027", processo_nup: null, situacao: "Em andamento", srp: false, valor_estimado: 1, data_publicacao: "2027-03-01", link_pncp: null, objeto: "Aquisição de material de limpeza" },
    { id_compra: "b", modalidade: "Pregão - Eletrônico", numero_processo: "110/2027", processo_nup: null, situacao: "Em andamento", srp: false, valor_estimado: 1, data_publicacao: "2027-03-01", link_pncp: null, objeto: "Gêneros alimentícios" },
  ];
  assert.equal(acharPublicado(c, procs)?.id_compra, "a");
  assert.equal(acharPublicado({ ...c, objeto: "Serviço de vigilância armada" }, procs), null);
  const pub = { ...c, numero_certame: "110/2027", modalidade: "Pregão Eletrônico" };
  const dou = [
    { id: "1", titulo: "EXTRATO DE CONTRATO Nº 110/2027 - UASG 120630", resumo: "", data: "2027-03-01", url: "x", tipo: "Extrato" },
    { id: "2", titulo: "AVISO DE LICITAÇÃO PREGÃO ELETRÔNICO Nº 90110/2027 - UASG 120630", resumo: "", data: "2027-03-02", url: "https://in.gov.br/a", tipo: "Aviso" },
  ];
  assert.equal(acharDou(pub, dou)?.id, "2");
  assert.equal(acharDou({ ...pub, modalidade: "Dispensa Eletrônica" }, dou), null);
  assert.equal(acharDou(pub, [{ id: "3", titulo: "AVISO DE DISPENSA ELETRÔNICA Nº 262/ GAP - MN /2026 - UASG 120630", resumo: "", data: "2026-11-18", url: "y", tipo: "Aviso" }]), null);
  assert.equal(acharDou({ ...pub, numero_certame: "262/2026", modalidade: "Dispensa Eletrônica" }, [{ id: "3", titulo: "AVISO DE DISPENSA ELETRÔNICA Nº 262/ GAP - MN /2026 - UASG 120630", resumo: "", data: "2026-11-18", url: "y", tipo: "Aviso" }])?.id, "3");
});

test("D-30: aviso ao Elo uma vez, na janela de 30 dias, com o link das listas", () => {
  const e = estado({ hoje: "2027-02-10" });
  const c = c0({ data_estimada_chegada: "2027-03-12" });
  assert.ok(precisaD30(c, e));
  assert.ok(precisaD30({ ...c, data_estimada_chegada: "2027-03-09" }, e)); // rotina atrasada até 3 dias
  assert.ok(!precisaD30({ ...c, data_estimada_chegada: "2027-03-08" }, e));
  assert.ok(!precisaD30({ ...c, email_d30_em: "2027-02-09" }, e));
  assert.ok(!precisaD30({ ...c, numero_dnr: "9" }, e));
  const av = avisosDoDia(c, e);
  assert.equal(av.marcarD30, true);
  assert.deepEqual(av.emails[0].para, ["elo.hamn@exemplo.mil.br"]);
  assert.ok(av.emails[0].html.includes("listas-de-verificacao"));
  assert.ok(av.emails[0].texto.includes("expediente formal"));
  assert.ok(av.emails[0].texto.includes("12/03/2027") && av.emails[0].texto.includes("01/07/2027"));
});

test("e-mails da SLIC: tipo pelo assunto, PAG e certame; impugnação avisa pregoeiro, SLIC e Elo", () => {
  assert.equal(tipoDoEmail("SOLICITAÇÃO DE ANÁLISE JURÍDICA - PAG:67000.000999/2027-22", "enviados"), "cju_envio");
  assert.equal(tipoDoEmail("Re: DEVOLUÇÃO DA ANÁLISE DO PROCESSO Nº 67000.000999/2027-22", "entrada"), "cju_retorno");
  assert.equal(tipoDoEmail("Impugnação ao edital", "entrada"), "impugnacao");
  assert.equal(tipoDoEmail("SOLICITAÇÃO DE ANÁLISE JURÍDICA", "entrada"), null);
  assert.deepEqual(referenciasDoEmail("Impugnação - Pregão Eletrônico nº 90110/2027"), { pag: null, certame: { numero: 90110, ano: 2027 } });
  const e = estado();
  const c = { ...c0(), numero_certame: "110/2027", pregoeiro_responsavel: "2º Ten Pregoeiro Teste" };
  const r = processarEvento({ id: "m9", tipo: "impugnacao", certame: { numero: 90110, ano: 2027 }, assunto: "Impugnação - Pregão Eletrônico nº 90110/2027", data: "2027-03-05" }, [c], e);
  assert.equal(r.contratacao?.id, "c1");
  assert.deepEqual(r.emails[0].para.sort(), ["elo.hamn@exemplo.mil.br", "pregoeiro@exemplo.mil.br", "slic@exemplo.mil.br"]);
  assert.ok(r.abreAlerta);
  const semProc = processarEvento({ id: "m10", tipo: "cju_retorno", pag: "67000.000111/2027-01", data: "2027-03-05" }, [c], e);
  assert.equal(semProc.irregularidade?.tipo, "evento_sem_processo");
});

test("planilha do SILOMS: acha as colunas pelo nome e lê datas do Excel", () => {
  const linhas = [["Relatório de DNR"], ["Nº DNR", "Data de Chegada", "NUP", "Objeto", "OM Solicitante"], ["345/2027", 46427, "67000.000999/2027-22", "Material de limpeza", "HAMN"], ["", "", "", "", ""]];
  const r = lerPlanilhaSiloms(linhas);
  assert.equal(r.length, 1);
  assert.equal(r[0].numero_dnr, "345/2027");
  assert.equal(r[0].pag_oficio, "67000.000999/2027-22");
  assert.equal(r[0].data_chegada, "2027-02-09");
  assert.equal(r[0].om_apoiada, "HAMN");
});

test("prazos, alertas e indicadores do topo", () => {
  const e = estado();
  const atrasada = c0({ data_estimada_chegada: "2027-02-01" });
  assert.equal(situacaoPrazo(atrasada, HOJE), "atrasado");
  assert.ok(alertasDe(atrasada, { hoje: HOJE, cfg: e.cfg, irregularidadesAbertas: 0, eventosAbertos: [], temElo: true }).some((a) => a.codigo === "chegada_atrasada"));
  const noPrazo = c0({ id: "c5", data_estimada_chegada: "2027-06-01", data_estimada_conclusao: "2027-10-01" });
  const cju = c0({ id: "c6", numero_dnr: "1", data_envio_cju: "2027-01-10", data_estimada_chegada: "2027-01-01", data_estimada_conclusao: "2027-09-01", status_atual: S.CJU });
  const pub = c0({ id: "c7", pncp_publicado_em: "2027-02-01", status_atual: S.PUBLICADO, status_publicacao_dou: true, dou_data: "2027-02-02" });
  const k = calcularKpis([atrasada, noPrazo, cju, pub], HOJE, 3);
  assert.equal(k.total, 4);
  assert.equal(k.atrasados, 1);
  assert.equal(k.aguardandoCju, 1);
  assert.equal(k.cjuVencido, 1);
  assert.equal(k.pendentesDouEbc, 1);
  assert.equal(k.irregularidades, 3);
});
