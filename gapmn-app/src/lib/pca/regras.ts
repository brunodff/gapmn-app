// Regras de negócio do Acompanhamento do PCA: categoria, modalidade sugerida (Lei nº 14.133/2021), triagem
// jurídica (Manifestação Jurídica Referencial × CJU), status derivado dos fatos, prazos, alertas e indicadores.
import {
  type Alerta, type Categoria, type ConfigPca, type Contratacao, type Enquadramento, type RegraMjr, type Status,
  ENCERRADOS, EXCECOES, FLUXOS, S, fase,
} from "./tipos.ts";

export const semAcento = (t: string) => String(t ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const tem = (texto: string, ...palavras: string[]) => { const t = semAcento(texto); return palavras.some((p) => t.includes(p)); };
export const dataISO = (d: Date) => d.toISOString().slice(0, 10);
/** Dias corridos de a até b (datas AAAA-MM-DD) */
export function dias(a: string, b: string): number {
  return Math.round((Date.parse(b.slice(0, 10) + "T12:00:00Z") - Date.parse(a.slice(0, 10) + "T12:00:00Z")) / 86400000);
}

// ── PAG ──────────────────────────────────────────────────────────────────────
/** Máscara do PAG/NUP: XXXXX.XXXXXX/XXXX-XX */
export const RX_PAG = /(?<!\d)(\d{5})\.?(\d{6})\/?(\d{4})-?(\d{2})(?!\d)/;
/** PAG normalizado (com a máscara) ou null se não tiver o formato */
export function normalizarPag(t: string | null | undefined): string | null {
  const m = RX_PAG.exec(String(t ?? "").replace(/\s+/g, ""));
  return m ? `${m[1]}.${m[2]}/${m[3]}-${m[4]}` : null;
}
export const pagValido = (t: string | null | undefined) => normalizarPag(t) === String(t ?? "").trim();

/** "120630-110/2027" (como no PNCP e no TR, "Identificador da Futura Contratação") */
export function normalizarIdContratacao(t: string | null | undefined): string | null {
  const m = /(\d{6})\s*-\s*0*(\d{1,6})\s*\/\s*(\d{4})/.exec(String(t ?? ""));
  return m ? `${m[1]}-${Number(m[2])}/${m[3]}` : null;
}

// ── Categoria (Módulo A) ─────────────────────────────────────────────────────
/** Categoria provável pelo tipo do item no PGC (M/S), pela categoria do PCA no PNCP e pelo objeto */
export function categoriaProvavel(objeto: string, tipoItem: string | null, categoriaPncp: string | null): Categoria {
  const o = objeto;
  if (categoriaPncp && /obras/i.test(categoriaPncp)) return tem(o, "obra", "construc", "edificac") && !tem(o, "manutenc", "reforma") ? "Obra" : "Serviço de Engenharia";
  if (tem(o, "construcao de", "construção de", "obra de ", "edificacao de", "ampliacao predial")) return "Obra";
  if (tem(o, "engenharia", "reforma", "pavimentac", "impermeabiliz", "manutencao predial", "manutencao das instalac")) return tipoItem === "M" ? "Aquisição" : "Serviço de Engenharia";
  if (tem(o, "software", "licenca de uso", "licencas de", "solucao de ti", "tecnologia da informacao", " tic", "informatica", "computador", "notebook", "nuvem", "subscricao")) return "TIC";
  if (tem(o, "locacao", "aluguel")) return "Locação";
  return tipoItem === "S" || (categoriaPncp != null && /servi/i.test(categoriaPncp)) ? "Serviço Comum" : "Aquisição";
}

// ── Modalidade sugerida (Módulo A) ───────────────────────────────────────────
export interface Sugestao { modalidade: string; motivo: string }
/**
 * Sugestão de modalidade antes da publicação. É só uma sugestão: a SLIC confirma ou troca, e a publicação no
 * PNCP substitui pela modalidade real.
 */
export function sugerirModalidade(c: Pick<Contratacao, "categoria" | "valor_estimado" | "objeto" | "sistema_srp">, cfg: Pick<ConfigPca, "limite_dispensa_engenharia" | "limite_dispensa_demais">): Sugestao {
  const o = c.objeto ?? "";
  const v = c.valor_estimado ?? null;
  const brl = (n: number) => n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
  if (tem(o, "credenciamento")) return { modalidade: "Credenciamento", motivo: "Objeto de credenciamento (art. 79 da Lei nº 14.133/2021)." };
  if (tem(o, "cessao de uso", "permissao de uso", "concessao de uso", "alienacao")) {
    return { modalidade: "Concorrência", motivo: "Cessão/permissão de uso ou alienação: confirmar a modalidade com a SLIC (pode ser leilão ou concorrência)." };
  }
  if (c.categoria === "Locação" && tem(o, "imovel", "imoveis", "predio", "sala comercial")) {
    return { modalidade: "Inexigibilidade", motivo: "Locação de imóvel com características que condicionam a escolha (art. 74, V)." };
  }
  if (c.categoria === "Obra") return { modalidade: "Concorrência", motivo: "Obra: o pregão não se aplica (art. 29, parágrafo único)." };
  const engenharia = c.categoria === "Serviço de Engenharia";
  const limite = engenharia ? cfg.limite_dispensa_engenharia : cfg.limite_dispensa_demais;
  const inciso = engenharia ? "I" : "II";
  if (v != null && v > 0 && v <= limite && !c.sistema_srp) {
    return { modalidade: "Dispensa Eletrônica", motivo: `Valor estimado (${brl(v)}) dentro do limite do art. 75, ${inciso} (${brl(limite)}); confirmar o somatório do exercício com objetos da mesma natureza (art. 75, § 1º).` };
  }
  if (engenharia) return { modalidade: "Pregão Eletrônico", motivo: "Serviço comum de engenharia (art. 6º, XXI, \"a\", e art. 29); se for serviço especial de engenharia, Concorrência." };
  const porque = v == null || v <= 0 ? "sem valor estimado no PCA" : `valor estimado (${brl(v)}) acima do limite do art. 75, II (${brl(cfg.limite_dispensa_demais)})`;
  return { modalidade: "Pregão Eletrônico", motivo: `Bens e serviços comuns, ${c.sistema_srp ? "com registro de preços, " : ""}${porque} (art. 6º, XLI, e art. 29).` };
}

/** Modalidade publicada (PNCP/Compras.gov.br) no nome usado aqui */
export function modalidadePublicada(m: string | null | undefined): string | null {
  const t = semAcento(m ?? "");
  if (!t) return null;
  if (t.includes("pregao")) return "Pregão Eletrônico";
  if (t.includes("dispensa")) return "Dispensa Eletrônica";
  if (t.includes("concorr")) return "Concorrência";
  if (t.includes("inexig")) return "Inexigibilidade";
  if (t.includes("credenc")) return "Credenciamento";
  if (t.includes("leilao")) return "Leilão";
  if (t.includes("dialogo")) return "Diálogo Competitivo";
  return m ?? null;
}

// ── Triagem jurídica (Módulo E) ──────────────────────────────────────────────
export interface Triagem { enquadramento: Enquadramento; regra: RegraMjr | null; motivo: string }
/**
 * Regras de MJR cadastradas pela SLIC (cada uma ligada a um parecer referencial da AGU vigente). A primeira
 * regra que atende categoria, modalidade, valor, SRP e palavras do objeto sugere o parecer; sem regra, CJU.
 */
export function triagemJuridica(c: Pick<Contratacao, "categoria" | "modalidade" | "valor_estimado" | "objeto" | "sistema_srp">, regras: RegraMjr[], hoje: string): Triagem {
  for (const r of regras) {
    if (!r.ativo || (r.vigencia_fim && r.vigencia_fim < hoje)) continue;
    if (r.categorias.length && !r.categorias.includes(c.categoria ?? "")) continue;
    if (r.modalidades.length && !r.modalidades.includes(c.modalidade ?? "")) continue;
    if (r.valor_maximo != null && (c.valor_estimado == null || c.valor_estimado > r.valor_maximo)) continue;
    if (r.srp != null && !!c.sistema_srp !== r.srp) continue;
    if (r.palavras.length && !r.palavras.some((p) => semAcento(c.objeto).includes(semAcento(p)))) continue;
    return { enquadramento: "Parecer Referencial AGU", regra: r, motivo: `Atende à regra "${r.titulo}"${r.vigencia_fim ? ` (vigente até ${r.vigencia_fim.split("-").reverse().join("/")})` : ""}.` };
  }
  return { enquadramento: "Análise CJU - Art. 53", regra: null, motivo: "Nenhuma Manifestação Jurídica Referencial cadastrada atende ao objeto, à categoria e ao valor: análise da CJU (art. 53 da Lei nº 14.133/2021)." };
}

// ── Status derivado dos fatos (automação) ────────────────────────────────────
const marcoOk = (v: string | undefined) => !!v;
/** O OD assinou no subprocesso (marco "od" cumprido) */
export const odAssinou = (sp: Contratacao["subprocesso_fase_interna"]) => !!sp && marcoOk(sp.marcos.od);

/**
 * Status que os fatos registrados indicam (sem olhar o status atual). Usado pela automação de todos os
 * módulos: DNR, minutas, MJR/CJU, publicação, homologação e encaminhamento.
 */
export function statusDosFatos(c: Contratacao, irregularidadeAberta: boolean): Status {
  if (c.encaminhado_em) return S.ENCAMINHADO;
  if (c.data_homologacao) return S.HOMOLOGADO;
  if (c.pncp_publicado_em) return S.PUBLICADO;
  if (c.liberado_publicacao_em) return S.LIBERADO;
  if (c.data_retorno_cju) {
    if (odAssinou(c.subprocesso_pos_cju)) return S.LIBERADO;
    if (c.subprocesso_pos_cju) return S.POS_CJU;
    return S.RETORNO_CJU;
  }
  if (c.data_envio_cju) return S.CJU;
  if (c.enquadramento_juridico === "Parecer Referencial AGU" && odAssinou(c.subprocesso_fase_interna)) return S.MJR;
  if (c.numero_dnr || c.data_chegada_dnr) {
    if (irregularidadeAberta) return S.IRREGULAR;
    if (c.responsavel_gapmn || c.subprocesso_fase_interna) return S.MINUTAS;
    return S.DNR;
  }
  return S.PLANEJADO;
}

/**
 * O status deduzido dos fatos pode substituir o atual? Exceção (Suspenso, Adiado, Deserto, Cancelado…) só sai por
 * troca explícita (SLIC ou PNCP), nunca por dedução; status do fluxo posto à mão só é trocado para frente;
 * status automático segue os fatos.
 */
export function podeTrocar(atual: Contratacao, novo: Status): boolean {
  if (novo === atual.status_atual) return false;
  if (EXCECOES.includes(atual.status_atual)) return false;
  if (atual.status_origem === "manual") return fase(novo) > fase(atual.status_atual);
  return true;
}

// ── Prazos (KPIs) ────────────────────────────────────────────────────────────
export type SituacaoPrazo = "no_prazo" | "em_risco" | "atrasado" | "concluido" | "encerrado";
export function situacaoPrazo(c: Contratacao, hoje: string): SituacaoPrazo {
  if (c.status_atual === S.HOMOLOGADO || c.status_atual === S.ENCAMINHADO) return "concluido";
  if (ENCERRADOS.includes(c.status_atual)) return "encerrado";
  if (c.data_estimada_conclusao && hoje > c.data_estimada_conclusao) return "atrasado";
  if (!c.numero_dnr && !c.data_chegada_dnr && c.data_estimada_chegada && hoje > c.data_estimada_chegada) return "atrasado";
  if (c.data_envio_cju && !c.data_retorno_cju && dias(c.data_envio_cju, hoje) > 15) return "em_risco";
  if (c.data_estimada_conclusao && fase(c.status_atual) < fase(S.PUBLICADO) && fase(c.status_atual) >= 0 && dias(hoje, c.data_estimada_conclusao) <= 30) return "em_risco";
  return "no_prazo";
}

// ── Alertas (Módulos B, C, E, F, G, H) ───────────────────────────────────────
export interface Contexto { hoje: string; cfg: ConfigPca; irregularidadesAbertas: number; eventosAbertos: { tipo: string; assunto: string }[]; temElo: boolean }
export function alertasDe(c: Contratacao, x: Contexto): Alerta[] {
  const a: Alerta[] = [];
  const br = (d: string) => d.slice(0, 10).split("-").reverse().join("/");
  const encerrado = ENCERRADOS.includes(c.status_atual) || c.status_atual === S.HOMOLOGADO;
  const semDnr = !c.numero_dnr && !c.data_chegada_dnr;
  if (!encerrado && semDnr && c.data_estimada_chegada && !EXCECOES.includes(c.status_atual)) {
    const d = dias(x.hoje, c.data_estimada_chegada);
    if (d < 0) a.push({ codigo: "chegada_atrasada", nivel: "critico", texto: `DNR não chegou: prevista para ${br(c.data_estimada_chegada)} (${-d} dia(s) de atraso).` });
    else if (d <= x.cfg.dias_alerta_chegada) a.push({ codigo: "chegada_proxima", nivel: "atencao", texto: `Chegada prevista em ${d} dia(s) (${br(c.data_estimada_chegada)}), sem DNR registrada.` });
  }
  if (!encerrado && c.data_estimada_conclusao && x.hoje > c.data_estimada_conclusao && !EXCECOES.includes(c.status_atual)) {
    a.push({ codigo: "conclusao_atrasada", nivel: "critico", texto: `Homologação planejada para ${br(c.data_estimada_conclusao)} já passou.` });
  }
  if (c.data_envio_cju && !c.data_retorno_cju) {
    const d = dias(c.data_envio_cju, x.hoje);
    if (d > x.cfg.sla_cju_dias) a.push({ codigo: "cju_sla", nivel: "critico", texto: `Na CJU há ${d} dias (referência: ${x.cfg.sla_cju_dias}). Verificar o envio ou cobrar a CJU.` });
  }
  if (c.pncp_publicado_em && !ENCERRADOS.includes(c.status_atual)) {
    if (!c.status_publicacao_dou) a.push({ codigo: "dou_pendente", nivel: "critico", texto: "Publicado no PNCP e ainda sem publicação no DOU registrada." });
    if (!c.status_publicacao_ebc) a.push({ codigo: "ebc_pendente", nivel: "critico", texto: "Publicado no PNCP e ainda sem publicação na EBC registrada." });
  }
  if (x.irregularidadesAbertas > 0) a.push({ codigo: "irregularidade", nivel: "critico", texto: `${x.irregularidadesAbertas} irregularidade(s) aguardando decisão da SLIC.` });
  for (const e of x.eventosAbertos) {
    a.push({ codigo: e.tipo, nivel: "critico", texto: `${e.tipo === "impugnacao" ? "Impugnação" : "Pedido de esclarecimento"} recebido: "${e.assunto.slice(0, 90)}".` });
  }
  const temDnr = !semDnr;
  if (temDnr && !encerrado) {
    if (!c.documentacao_inicial_ok) a.push({ codigo: "documentacao", nivel: "atencao", texto: "Recebimento da documentação inicial da Equipe de Planejamento não validado." });
    if (!c.responsavel_gapmn) a.push({ codigo: "sem_aux_slic", nivel: "atencao", texto: "Sem AUX SLIC designado para as minutas (Edital, Contrato e Ata)." });
    if (c.enquadramento_juridico === "Pendente de Triagem") a.push({ codigo: "triagem", nivel: "atencao", texto: "Triagem jurídica pendente (MJR ou CJU)." });
  }
  if ((c.status_atual === S.LIBERADO || c.status_atual === S.PUBLICADO) && !c.pregoeiro_responsavel) {
    a.push({ codigo: "sem_pregoeiro", nivel: "atencao", texto: "Sem pregoeiro/agente de contratação designado." });
  }
  if (c.status_atual === S.HOMOLOGADO && !c.encaminhado_em) {
    a.push({ codigo: "encaminhamento", nivel: "atencao", texto: `Homologado sem o e-mail de encaminhamento à ${c.sistema_srp ? "formalização da Ata (SRP)" : "SCON (contrato)"}.` });
  }
  if (c.pgc_ausente_desde) a.push({ codigo: "fora_do_pgc", nivel: "atencao", texto: `Não aparece mais no PGC desde ${br(c.pgc_ausente_desde)} (alterado ou excluído do PCA?).` });
  if (!x.temElo && !encerrado) a.push({ codigo: "sem_elo", nivel: "info", texto: "OM apoiada/setor sem Elo cadastrado: os avisos por e-mail não saem." });
  if (c.subprocesso_fase_interna && !FLUXOS.some((f) => f.id === c.subprocesso_fase_interna?.fluxo)) {
    a.push({ codigo: "fluxo_invalido", nivel: "atencao", texto: "Subprocesso com fluxo fora dos 5 fluxos oficiais." });
  }
  return a;
}

// ── Indicadores do topo ──────────────────────────────────────────────────────
export interface Kpis { total: number; noPrazo: number; emRiscoOuAtrasado: number; atrasados: number; aguardandoCju: number; cjuVencido: number; pendentesDouEbc: number; irregularidades: number; concluidos: number }
export function calcularKpis(lista: Contratacao[], hoje: string, irregularidades: number, slaCju = 15): Kpis {
  const k: Kpis = { total: lista.length, noPrazo: 0, emRiscoOuAtrasado: 0, atrasados: 0, aguardandoCju: 0, cjuVencido: 0, pendentesDouEbc: 0, irregularidades, concluidos: 0 };
  for (const c of lista) {
    const p = situacaoPrazo(c, hoje);
    if (p === "no_prazo") k.noPrazo++;
    if (p === "em_risco" || p === "atrasado") k.emRiscoOuAtrasado++;
    if (p === "atrasado") k.atrasados++;
    if (p === "concluido") k.concluidos++;
    if (c.data_envio_cju && !c.data_retorno_cju) { k.aguardandoCju++; if (dias(c.data_envio_cju, hoje) > slaCju) k.cjuVencido++; }
    if (c.pncp_publicado_em && !ENCERRADOS.includes(c.status_atual) && (!c.status_publicacao_dou || !c.status_publicacao_ebc)) k.pendentesDouEbc++;
  }
  return k;
}

// ── Compatibilidade semântica do objeto (Módulo C) ───────────────────────────
const VAZIAS = new Set("a o as os e de da do das dos em no na nos nas para por com um uma que ao aos se sobre the of aquisicao aquisicoes contratacao contratacoes servico servicos prestacao empresa especializada material materiais fornecimento eventual futura registro precos preco gap mn gapmn manaus guarnicao aeronautica destinados destinado atender demanda demandas".split(" "));
/** Raízes das palavras relevantes do objeto */
export function raizes(t: string): Set<string> {
  return new Set(semAcento(t).split(/[^a-z0-9]+/).filter((p) => p.length > 2 && !VAZIAS.has(p)).map((p) => p.replace(/(coes|cao|oes|ais|eis|res|s)$/, "").slice(0, 6)));
}
/** Semelhança de 0 a 1 entre dois objetos (palavras em comum sobre as do menor) */
export function semelhanca(a: string, b: string): number {
  const x = raizes(a), y = raizes(b);
  if (!x.size || !y.size) return 0;
  let comum = 0;
  for (const p of x) if (y.has(p)) comum++;
  return comum / Math.min(x.size, y.size);
}
