// Motor do Acompanhamento do PCA: toda mudança (PGC, DNR, e-mail, SILOMS, PNCP, DOU ou edição da SLIC) passa
// por aplicar(), que deriva o status, sugere a modalidade, faz a triagem jurídica, calcula os alertas, escreve o
// histórico campo a campo e enfileira os e-mails. Nada aqui grava no banco: a função pca-automacao grava.
import {
  type ConfigPca, type Contratacao, type Elo, type MembroEquipe, type NovaIrregularidade, type NovoEmail, type NovoHistorico,
  type RegraMjr, type Status, type Subprocesso, ENCERRADOS, EXCECOES, FLUXOS, S, TODOS_STATUS, fase,
} from "./tipos.ts";
import { alertasDe, dias, modalidadePublicada, normalizarIdContratacao, normalizarPag, podeTrocar, semAcento, semelhanca, statusDosFatos, sugerirModalidade, triagemJuridica } from "./regras.ts";
import { type ContratacaoPgc } from "./pgc.ts";
import { type DadosDnr, cruzarDnr } from "./documentos.ts";
import { emailD30, emailHomologacao, emailImpugnacao, emailMacro, emailSlaCju } from "./emails.ts";

export interface Estado {
  hoje: string;
  agora: string;
  cfg: ConfigPca;
  elos: Elo[];
  equipe: MembroEquipe[];
  regras: RegraMjr[];
  /** contratação → irregularidades abertas que travam o andamento */
  irregularidades: Map<string, number>;
  /** contratação → impugnações/esclarecimentos sem ciência da SLIC */
  eventos: Map<string, { tipo: string; assunto: string }[]>;
}
export interface Ator { origem: NovoHistorico["origem"]; usuario_id?: string | null; usuario_nome?: string | null; justificativa?: string | null }
export interface Resultado { id: string; novo: Contratacao; patch: Partial<Contratacao>; historico: NovoHistorico[]; emails: NovoEmail[] }

/** Tipos de irregularidade que travam o processo em "Irregularidade documental" */
export const IRREGULARIDADES_QUE_TRAVAM = ["documental", "objeto_incompativel", "contratacao_invalida", "contratacao_ausente", "pag_em_uso"];
const SEM_HISTORICO = new Set(["alertas_ativos", "atualizado_em", "status_desde", "status_origem", "criado_em"]);
const igual = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

export function eloDe(c: Pick<Contratacao, "om_apoiada" | "area_pgc">, elos: Elo[]): Elo | null {
  const ativos = elos.filter((e) => e.ativo);
  return (c.om_apoiada ? ativos.find((e) => semAcento(e.om) === semAcento(c.om_apoiada!)) : null)
    ?? (c.area_pgc ? ativos.find((e) => e.areas_pgc.includes(c.area_pgc!)) : null) ?? null;
}
const emailsDo = (nome: string | null | undefined, equipe: MembroEquipe[]) => {
  if (!nome) return [];
  const m = equipe.find((p) => p.ativo && semAcento(p.nome) === semAcento(nome));
  return m?.email ? [m.email] : [];
};

/**
 * Aplica mudanças em uma contratação. statusPedido: troca explícita de status (manual exige justificativa e
 * sempre vale; automática, como "Deserto" vindo do PNCP, respeita a exceção posta pela SLIC).
 */
export function aplicar(atual: Contratacao, mudancas: Partial<Contratacao>, ator: Ator, e: Estado, statusPedido?: Status): Resultado {
  const novo: Contratacao = { ...atual, ...mudancas };
  const travas = e.irregularidades.get(atual.id) ?? 0;

  // modalidade sugerida enquanto não houver a escolha da SLIC nem a publicação
  if (novo.modalidade_origem !== "manual" && novo.modalidade_origem !== "publicada") {
    const s = sugerirModalidade(novo, e.cfg);
    novo.modalidade = s.modalidade; novo.modalidade_origem = "sugerida"; novo.modalidade_motivo = s.motivo;
  }
  // triagem jurídica automática quando a DNR chega (a SLIC pode trocar)
  if (novo.enquadramento_juridico === "Pendente de Triagem" && (novo.numero_dnr || novo.data_chegada_dnr) && !("enquadramento_juridico" in mudancas)) {
    const t = triagemJuridica(novo, e.regras, e.hoje);
    novo.enquadramento_juridico = t.enquadramento; novo.mjr_id = t.regra?.id ?? null; novo.enquadramento_motivo = t.motivo;
  }
  // envio à CJU registrado: o enquadramento é o do art. 53
  if (novo.data_envio_cju && novo.enquadramento_juridico !== "Análise CJU - Art. 53") {
    novo.enquadramento_juridico = "Análise CJU - Art. 53"; novo.mjr_id = null;
    novo.enquadramento_motivo = "Enviado à CJU (art. 53 da Lei nº 14.133/2021).";
  }

  // status
  if (statusPedido && ator.origem === "manual") {
    if (statusPedido !== atual.status_atual) { novo.status_atual = statusPedido; novo.status_origem = "manual"; novo.status_desde = e.agora; }
  } else if (statusPedido) {
    if (statusPedido !== atual.status_atual && !(atual.status_origem === "manual" && EXCECOES.includes(atual.status_atual))) {
      novo.status_atual = statusPedido; novo.status_origem = "automatico"; novo.status_desde = e.agora;
    }
  } else {
    const s = statusDosFatos(novo, travas > 0);
    if (podeTrocar(novo, s)) { novo.status_atual = s; novo.status_origem = "automatico"; novo.status_desde = e.agora; }
  }

  novo.alertas_ativos = alertasDe(novo, { hoje: e.hoje, cfg: e.cfg, irregularidadesAbertas: travas, eventosAbertos: e.eventos.get(atual.id) ?? [], temElo: !!eloDe(novo, e.elos)?.elo_email });

  const patch: Partial<Contratacao> = {};
  const historico: NovoHistorico[] = [];
  for (const k of Object.keys(novo) as (keyof Contratacao)[]) {
    if (igual(novo[k], atual[k])) continue;
    (patch as Record<string, unknown>)[k] = novo[k];
    if (SEM_HISTORICO.has(k)) continue;
    historico.push({
      contratacao_id: atual.id, origem: ator.origem, campo: k, de: atual[k] ?? null, para: novo[k] ?? null,
      justificativa: k === "status_atual" ? ator.justificativa ?? null : null, usuario_id: ator.usuario_id ?? null, usuario_nome: ator.usuario_nome ?? null,
    });
  }

  const emails: NovoEmail[] = [];
  if (patch.status_atual) {
    const elo = eloDe(novo, e.elos);
    if (elo?.elo_email) { const m = emailMacro(novo, [elo.elo_email], e.hoje, ator.origem === "manual" && ator.justificativa ? `Motivo: ${ator.justificativa}` : undefined); if (m) emails.push(m); }
    if (novo.status_atual === S.HOMOLOGADO && !novo.encaminhado_em) emails.push(emailHomologacao(novo, e.cfg));
  }
  if (Object.keys(patch).length) patch.atualizado_em = e.agora;
  return { id: atual.id, novo, patch, historico, emails };
}

/** Linha nova (criada pelo PGC ou à mão pela SLIC) */
export function contratacaoNova(id: string, ano: number, campos: Partial<Contratacao>, agora: string): Contratacao {
  return {
    id, ano, chave_pgc: null, id_contratacao_pgc: null, numeros_dfd: [], itens_pca: [], numero_pag: null, numero_certame: null, id_compra: null,
    objeto: "", objeto_resumido: null, categoria: null, categoria_origem: null, sistema_srp: null, modalidade: null, modalidade_origem: null,
    modalidade_motivo: null, valor_estimado: null, valor_origem: null, om_apoiada: null, area_pgc: null, data_estimada_chegada: null,
    data_estimada_conclusao: null, numero_dnr: null, data_chegada_dnr: null, responsavel_apoiada: null, responsavel_gapmn: null,
    pregoeiro_responsavel: null, documentacao_inicial_ok: false, subprocesso_fase_interna: null, subprocesso_pos_cju: null,
    enquadramento_juridico: "Pendente de Triagem", mjr_id: null, enquadramento_motivo: null, data_envio_cju: null, data_retorno_cju: null,
    liberado_publicacao_em: null, pncp_publicado_em: null, link_pncp: null, status_publicacao_dou: false, dou_data: null, dou_link: null,
    status_publicacao_ebc: false, ebc_data: null, ebc_link: null, subprocesso_fase_externa: null, data_homologacao: null, encaminhado_em: null,
    status_atual: S.PLANEJADO, status_origem: "automatico", status_desde: agora, alertas_ativos: [], pgc_ausente_desde: null, email_d30_em: null,
    observacao: null, criado_em: agora, atualizado_em: agora, ...campos,
  };
}

// ── Módulo A: PGC ────────────────────────────────────────────────────────────
export interface PlanoSync { novas: Contratacao[]; historicoNovas: NovoHistorico[]; resultados: Resultado[] }
export function sincronizarPgc(atuais: Contratacao[], pgc: ContratacaoPgc[], ano: number, e: Estado, novoId: () => string): PlanoSync {
  const plano: PlanoSync = { novas: [], historicoNovas: [], resultados: [] };
  const vistos = new Set<string>();
  const ator: Ator = { origem: "pgc" };
  for (const p of pgc) {
    const c = (p.id_contratacao_pgc ? atuais.find((x) => x.id_contratacao_pgc === p.id_contratacao_pgc) : undefined)
      ?? atuais.find((x) => x.chave_pgc === p.chave_pgc);
    const campos: Partial<Contratacao> = {
      chave_pgc: p.chave_pgc, numeros_dfd: p.numeros_dfd, itens_pca: p.itens_pca, objeto: p.objeto, area_pgc: p.area_pgc,
      data_estimada_chegada: p.data_estimada_chegada, data_estimada_conclusao: p.data_estimada_conclusao, pgc_ausente_desde: null,
    };
    if (p.id_contratacao_pgc) campos.id_contratacao_pgc = p.id_contratacao_pgc;
    if (!c) {
      const elo = eloDe({ om_apoiada: null, area_pgc: p.area_pgc }, e.elos);
      const nova = contratacaoNova(novoId(), ano, { ...campos, objeto_resumido: p.objeto_resumido, categoria: p.categoria, categoria_origem: "pgc", valor_estimado: p.valor_estimado, valor_origem: "pca", om_apoiada: elo?.om ?? null }, e.agora);
      const r = aplicar(nova, {}, ator, e);
      plano.novas.push(r.novo);
      plano.historicoNovas.push({ contratacao_id: nova.id, origem: "pgc", campo: "criacao", de: null, para: `${p.id_contratacao_pgc ?? "sem nº"} — ${p.objeto_resumido}` });
      vistos.add(nova.id);
      continue;
    }
    vistos.add(c.id);
    if (c.categoria_origem !== "manual") { campos.categoria = p.categoria; campos.categoria_origem = "pgc"; }
    if (c.valor_origem == null || c.valor_origem === "pca") { campos.valor_estimado = p.valor_estimado; campos.valor_origem = "pca"; }
    if (!c.om_apoiada) { const elo = eloDe({ om_apoiada: null, area_pgc: p.area_pgc }, e.elos); if (elo) campos.om_apoiada = elo.om; }
    const r = aplicar(c, campos, ator, e);
    if (Object.keys(r.patch).length) plano.resultados.push(r);
  }
  for (const c of atuais) {
    if (vistos.has(c.id) || c.ano !== ano || !c.chave_pgc || c.pgc_ausente_desde) continue;
    const r = aplicar(c, { pgc_ausente_desde: e.hoje }, ator, e);
    if (Object.keys(r.patch).length) plano.resultados.push(r);
  }
  return plano;
}

// ── Módulo F/H: publicação e resultado (processos_licitatorios, alimentada pela sync-processos) ──
export interface ProcessoPublico {
  id_compra: string; modalidade: string | null; numero_processo: string | null; processo_nup: string | null; situacao: string | null;
  srp: boolean | null; valor_estimado: number | null; data_publicacao: string | null; link_pncp: string | null; objeto: string | null;
  /** maior data de resultado dos itens (homologação) */
  data_resultado?: string | null;
}
/** O processo publicado desta contratação: pelo PAG; senão pelo nº do certame igual ao da contratação, com objeto parecido */
export function acharPublicado(c: Contratacao, procs: ProcessoPublico[]): ProcessoPublico | null {
  if (c.id_compra) { const p = procs.find((x) => x.id_compra === c.id_compra); if (p) return p; }
  if (c.numero_pag) { const p = procs.find((x) => normalizarPag(x.processo_nup) === c.numero_pag); if (p) return p; }
  const id = normalizarIdContratacao(c.id_contratacao_pgc);
  if (!id) return null;
  const [, num, ano] = /-(\d+)\/(\d{4})$/.exec(id) ?? [];
  const candidatos = procs.filter((x) => {
    const m = /^0*(\d+)\/(\d{4})$/.exec(x.numero_processo ?? "");
    if (!m || m[2] !== ano) return false;
    const n = Number(m[1]);
    return n === Number(num) || n === 90000 + Number(num);
  });
  const melhor = candidatos.map((p) => ({ p, s: semelhanca(p.objeto ?? "", c.objeto) })).sort((a, b) => b.s - a.s)[0];
  return melhor && melhor.s >= 0.3 ? melhor.p : null;
}

const SITUACAO_STATUS: Record<string, Status> = {
  "Deserto": S.DESERTO, "Fracassado": S.FRACASSADO, "Cancelado": S.CANCELADO, "Revogado": S.REVOGADO, "Anulado": S.ANULADO, "Suspenso": S.SUSPENSO,
};
export function cruzarPublicacao(c: Contratacao, p: ProcessoPublico, usados: Set<string>, e: Estado): Resultado | null {
  const campos: Partial<Contratacao> = { id_compra: p.id_compra, numero_certame: p.numero_processo, link_pncp: p.link_pncp ?? c.link_pncp };
  if (p.data_publicacao && !c.pncp_publicado_em) campos.pncp_publicado_em = p.data_publicacao;
  const mod = modalidadePublicada(p.modalidade);
  if (mod) { campos.modalidade = mod; campos.modalidade_origem = "publicada"; campos.modalidade_motivo = "Modalidade do certame publicado no PNCP/Compras.gov.br."; }
  if (p.valor_estimado && p.valor_estimado > 0 && c.valor_origem !== "manual") { campos.valor_estimado = Number(p.valor_estimado); campos.valor_origem = "edital"; }
  if (p.srp != null && c.sistema_srp == null) campos.sistema_srp = p.srp;
  const pag = normalizarPag(p.processo_nup);
  if (!c.numero_pag && pag && !usados.has(pag)) campos.numero_pag = pag;
  let statusPedido: Status | undefined;
  const sit = p.situacao ?? "";
  if (/^homologado/i.test(sit)) {
    if (!c.data_homologacao) campos.data_homologacao = p.data_resultado ?? e.hoje;
    // explícito: sai até de uma suspensão automática; nunca volta de "Encaminhado"
    if (c.status_atual !== S.HOMOLOGADO && c.status_atual !== S.ENCAMINHADO) statusPedido = S.HOMOLOGADO;
  } else if (SITUACAO_STATUS[sit]) statusPedido = SITUACAO_STATUS[sit];
  else if (/andamento/i.test(sit) && c.status_atual === S.SUSPENSO && c.status_origem === "automatico") statusPedido = S.PUBLICADO;
  const r = aplicar(c, campos, { origem: "pncp" }, e, statusPedido);
  return Object.keys(r.patch).length ? r : null;
}

// ── Módulo F: DOU ────────────────────────────────────────────────────────────
export interface PublicacaoDou { id: string; titulo: string; resumo: string | null; data: string | null; url: string | null; tipo: string | null }
export function acharDou(c: Contratacao, pubs: PublicacaoDou[], uasg = "120630"): PublicacaoDou | null {
  const m = /^0*(\d+)\/(\d{4})$/.exec(c.numero_certame ?? "");
  if (!m) return null;
  const num = Number(m[1]); const ano = m[2];
  const mod = semAcento(c.modalidade ?? "");
  const palavra = mod.includes("pregao") ? "pregao" : mod.includes("dispensa") ? "dispensa" : mod.includes("concorr") ? "concorr" : mod.includes("inexig") ? "inexig" : "";
  const achados = pubs.filter((p) => {
    const t = semAcento(`${p.titulo} ${p.resumo ?? ""}`);
    if (!t.includes(uasg) && !/gap\s*-?\s*mn/.test(t)) return false;
    if (palavra && !semAcento(p.titulo).includes(palavra)) return false;
    if (/extrato|penalidade|resultado|homologa/.test(semAcento(p.titulo))) return false;
    const n = /n[º°o.]*\s*0*(\d{1,6})\s*\/[^/]{0,15}?\/?\s*(\d{4})/.exec(semAcento(p.titulo).replace(/[º°]/g, "o"));
    if (!n || n[2] !== ano) return false;
    const x = Number(n[1]);
    return x === num || x === 90000 + num || x + 90000 === num;
  });
  return achados.sort((a, b) => (a.data ?? "").localeCompare(b.data ?? ""))[0] ?? null;
}

// ── Módulo B (D-30) e Módulo E (prazo da CJU) ────────────────────────────────
/** Avisar o Elo: chegada daqui a 30 dias (tolera 3 dias de atraso da rotina), sem DNR e sem aviso anterior */
export function precisaD30(c: Contratacao, e: Estado): boolean {
  if (!c.data_estimada_chegada || c.email_d30_em || c.numero_dnr || c.data_chegada_dnr) return false;
  if (EXCECOES.includes(c.status_atual) || ENCERRADOS.includes(c.status_atual) || fase(c.status_atual) > fase(S.PLANEJADO)) return false;
  const d = dias(e.hoje, c.data_estimada_chegada);
  return d <= e.cfg.dias_alerta_chegada && d >= e.cfg.dias_alerta_chegada - 3;
}
export function avisosDoDia(c: Contratacao, e: Estado): { emails: NovoEmail[]; marcarD30: boolean } {
  const emails: NovoEmail[] = [];
  let marcarD30 = false;
  if (precisaD30(c, e)) {
    const elo = eloDe(c, e.elos);
    if (elo?.elo_email) { emails.push(emailD30(c, [elo.elo_email], e.cfg)); marcarD30 = true; }
  }
  if (c.data_envio_cju && !c.data_retorno_cju && dias(c.data_envio_cju, e.hoje) > e.cfg.sla_cju_dias) {
    const m = emailSlaCju(c, dias(c.data_envio_cju, e.hoje), e.cfg);
    if (m) emails.push(m);
  }
  return { emails, marcarD30 };
}

// ── Eventos (e-mails da SLIC e robô do SILOMS) ───────────────────────────────
export interface Evento {
  id: string;
  tipo: "cju_envio" | "cju_retorno" | "impugnacao" | "esclarecimento" | "subprocesso" | "fase_externa" | "homologacao" | "liberacao";
  pag?: string | null;
  certame?: { numero: number; ano: number } | null;
  assunto?: string | null;
  data: string;
  dados?: Record<string, unknown> | null;
}
export function localizarEvento(ev: Evento, lista: Contratacao[]): Contratacao | null {
  const pag = normalizarPag(ev.pag) ?? normalizarPag(ev.assunto);
  if (pag) { const c = lista.find((x) => x.numero_pag === pag); if (c) return c; }
  if (ev.certame) {
    const { numero, ano } = ev.certame;
    return lista.find((x) => {
      const m = /^0*(\d+)\/(\d{4})$/.exec(x.numero_certame ?? "");
      return !!m && Number(m[2]) === ano && (Number(m[1]) === numero || Number(m[1]) === numero - 90000 || Number(m[1]) + 90000 === numero);
    }) ?? null;
  }
  return null;
}
export function fluxoPeloNome(nome: unknown): number | null {
  const n = Number(nome);
  if (Number.isInteger(n) && FLUXOS.some((f) => f.id === n)) return n;
  const t = semAcento(String(nome ?? "")).replace(/[^a-z0-9]+/g, " ");
  const f = FLUXOS.find((x) => t.includes(semAcento(x.nome).replace(/[^a-z0-9]+/g, " ").trim()));
  return f?.id ?? null;
}

export interface ResultadoEvento { contratacao: Contratacao | null; resultado: Resultado | null; emails: NovoEmail[]; irregularidade: NovaIrregularidade | null; abreAlerta: boolean }
export function processarEvento(ev: Evento, lista: Contratacao[], e: Estado): ResultadoEvento {
  const c = localizarEvento(ev, lista);
  const data = ev.data.slice(0, 10);
  if (!c) {
    return { contratacao: null, resultado: null, emails: ev.tipo === "impugnacao" || ev.tipo === "esclarecimento" ? [emailImpugnacao(null, ev.tipo, ev.assunto ?? "", data, e.cfg.email_slic ? [e.cfg.email_slic] : [], ev.id)].filter((m) => m.para.length) : [],
      irregularidade: { contratacao_id: null, tipo: "evento_sem_processo", descricao: `Evento "${ev.tipo}" (${ev.assunto ?? "sem assunto"}) sem processo identificado${ev.pag ? ` (PAG ${ev.pag} não cadastrado)` : ""}.`, detalhe: { evento_id: ev.id } }, abreAlerta: false };
  }
  const ator: Ator = { origem: ev.tipo === "subprocesso" || ev.tipo === "fase_externa" || ev.tipo === "homologacao" || ev.tipo === "liberacao" ? "siloms" : "email" };
  const campos: Partial<Contratacao> = {};
  const emails: NovoEmail[] = [];
  let abreAlerta = false;
  switch (ev.tipo) {
    case "cju_envio": if (!c.data_envio_cju) campos.data_envio_cju = data; break;
    case "cju_retorno": if (!c.data_retorno_cju) campos.data_retorno_cju = data; if (!c.data_envio_cju) campos.data_envio_cju = data; break;
    case "impugnacao": case "esclarecimento": {
      abreAlerta = true;
      const elo = eloDe(c, e.elos);
      const para = [...emailsDo(c.pregoeiro_responsavel, e.equipe), ...(e.cfg.email_slic ? [e.cfg.email_slic] : []), ...(ev.tipo === "impugnacao" && elo?.elo_email ? [elo.elo_email] : [])];
      if (para.length) emails.push(emailImpugnacao(c, ev.tipo, ev.assunto ?? "", data, [...new Set(para)], ev.id));
      break;
    }
    case "subprocesso": {
      const d = ev.dados ?? {};
      const fluxo = fluxoPeloNome(d.fluxo);
      const posCju = !!FLUXOS.find((f) => f.id === fluxo)?.posCju;
      const atual = posCju ? c.subprocesso_pos_cju : c.subprocesso_fase_interna;
      const marco = String(d.marco ?? "") as keyof Subprocesso["marcos"];
      const sp: Subprocesso = {
        nome: String(d.nome ?? atual?.nome ?? ""), fluxo: fluxo ?? atual?.fluxo ?? 0, etapa: (d.etapa as string) ?? atual?.etapa ?? null,
        marcos: { ...(atual?.marcos ?? {}), ...(["minutas", "irp", "aci", "od"].includes(marco) ? { [marco]: data } : {}) }, atualizado_em: e.agora,
      };
      if (posCju) campos.subprocesso_pos_cju = sp; else campos.subprocesso_fase_interna = sp;
      break;
    }
    case "fase_externa": campos.subprocesso_fase_externa = String(ev.dados?.nome ?? ev.assunto ?? ""); break;
    case "homologacao": if (!c.data_homologacao) campos.data_homologacao = data; break;
    case "liberacao": if (!c.liberado_publicacao_em) campos.liberado_publicacao_em = data; break;
  }
  if (abreAlerta) e.eventos.set(c.id, [...(e.eventos.get(c.id) ?? []), { tipo: ev.tipo, assunto: ev.assunto ?? "" }]);
  const r = aplicar(c, campos, ator, e);
  return { contratacao: c, resultado: Object.keys(r.patch).length ? r : null, emails, irregularidade: null, abreAlerta };
}

// ── Módulo C: DNR ────────────────────────────────────────────────────────────
export interface ResultadoDnr { resultado: Resultado | null; irregularidades: NovaIrregularidade[]; contratacao_id: string | null; candidata_id: string | null; situacao: "vinculada" | "irregular" }
export function registrarDnr(d: DadosDnr, lista: Contratacao[], ator: Ator, e: Estado): ResultadoDnr {
  const x = cruzarDnr(d, lista);
  if (!x.contratacao) return { resultado: null, irregularidades: x.irregularidades, contratacao_id: null, candidata_id: x.candidata?.id ?? null, situacao: "irregular" };
  return vincularDnr(d, x.contratacao, x.pag, x.irregularidades, ator, e);
}
/** Vincula a DNR à contratação (direto, quando bate, ou por decisão da SLIC na fila de irregularidades) */
export function vincularDnr(d: DadosDnr, c: Contratacao, pag: string | null, irregularidades: NovaIrregularidade[], ator: Ator, e: Estado): ResultadoDnr {
  const campos: Partial<Contratacao> = {};
  if (d.numero_dnr) campos.numero_dnr = d.numero_dnr;
  campos.data_chegada_dnr = d.data_chegada ?? c.data_chegada_dnr ?? e.hoje;
  if (pag && pag !== c.numero_pag) campos.numero_pag = pag;
  if (d.assinante_tr && !c.responsavel_apoiada) campos.responsavel_apoiada = d.assinante_tr;
  if (d.om_apoiada && !c.om_apoiada) campos.om_apoiada = d.om_apoiada;
  const travam = irregularidades.filter((i) => IRREGULARIDADES_QUE_TRAVAM.includes(i.tipo)).length;
  if (travam) e.irregularidades.set(c.id, (e.irregularidades.get(c.id) ?? 0) + travam);
  const r = aplicar(c, campos, ator, e);
  return { resultado: r, irregularidades: irregularidades.map((i) => ({ ...i, contratacao_id: i.contratacao_id ?? c.id })), contratacao_id: c.id, candidata_id: c.id, situacao: "vinculada" };
}

// ── Edição pela SLIC ─────────────────────────────────────────────────────────
export const CAMPOS_EDITAVEIS = [
  "id_contratacao_pgc", "numero_pag", "numero_certame", "objeto", "objeto_resumido", "categoria", "sistema_srp", "modalidade", "valor_estimado",
  "om_apoiada", "data_estimada_chegada", "data_estimada_conclusao", "numero_dnr", "data_chegada_dnr", "responsavel_apoiada", "responsavel_gapmn",
  "pregoeiro_responsavel", "documentacao_inicial_ok", "subprocesso_fase_interna", "subprocesso_pos_cju", "enquadramento_juridico", "mjr_id",
  "data_envio_cju", "data_retorno_cju", "liberado_publicacao_em", "pncp_publicado_em", "link_pncp", "status_publicacao_dou", "dou_data", "dou_link",
  "status_publicacao_ebc", "ebc_data", "ebc_link", "subprocesso_fase_externa", "data_homologacao", "observacao",
] as const;

/** Confere e normaliza a edição; devolve o erro em português ou as mudanças prontas para aplicar() */
export function validarEdicao(c: Contratacao, campos: Record<string, unknown>, lista: Contratacao[], statusNovo?: string | null, justificativa?: string | null): { erro: string } | { mudancas: Partial<Contratacao>; status?: Status } {
  const mudancas: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(campos)) {
    if (!(CAMPOS_EDITAVEIS as readonly string[]).includes(k)) return { erro: `O campo "${k}" não pode ser editado.` };
    mudancas[k] = typeof v === "string" ? (v.trim() === "" ? null : v.trim()) : v;
  }
  if ("numero_pag" in mudancas && mudancas.numero_pag != null) {
    const pag = normalizarPag(String(mudancas.numero_pag));
    if (!pag) return { erro: "PAG fora do formato XXXXX.XXXXXX/XXXX-XX." };
    const outro = lista.find((x) => x.id !== c.id && x.numero_pag === pag);
    if (outro) return { erro: `O PAG ${pag} já está na contratação ${outro.id_contratacao_pgc ?? outro.objeto_resumido}.` };
    mudancas.numero_pag = pag;
  }
  if ("id_contratacao_pgc" in mudancas && mudancas.id_contratacao_pgc != null) {
    const id = normalizarIdContratacao(String(mudancas.id_contratacao_pgc));
    if (!id) return { erro: "Número da contratação fora do formato UASG-número/ano (ex.: 120630-110/2027)." };
    const outro = lista.find((x) => x.id !== c.id && x.id_contratacao_pgc === id);
    if (outro) return { erro: `A contratação ${id} já existe (${outro.objeto_resumido}).` };
    mudancas.id_contratacao_pgc = id;
  }
  if ("modalidade" in mudancas) { (mudancas as Partial<Contratacao>).modalidade_origem = mudancas.modalidade ? "manual" : null; (mudancas as Partial<Contratacao>).modalidade_motivo = mudancas.modalidade ? "Definida pela SLIC." : null; }
  if ("categoria" in mudancas) (mudancas as Partial<Contratacao>).categoria_origem = "manual";
  if ("valor_estimado" in mudancas) { mudancas.valor_estimado = mudancas.valor_estimado == null ? null : Number(mudancas.valor_estimado); (mudancas as Partial<Contratacao>).valor_origem = "manual"; }
  if ("enquadramento_juridico" in mudancas && !["Pendente de Triagem", "Parecer Referencial AGU", "Análise CJU - Art. 53"].includes(String(mudancas.enquadramento_juridico))) return { erro: "Enquadramento jurídico inválido." };
  for (const k of ["data_estimada_chegada", "data_estimada_conclusao", "data_chegada_dnr", "data_envio_cju", "data_retorno_cju", "liberado_publicacao_em", "pncp_publicado_em", "dou_data", "ebc_data", "data_homologacao"]) {
    if (k in mudancas && mudancas[k] != null && !/^\d{4}-\d{2}-\d{2}$/.test(String(mudancas[k]))) return { erro: `Data inválida em ${k} (use AAAA-MM-DD).` };
  }
  if ((mudancas.status_publicacao_dou === true && !mudancas.dou_data && !c.dou_data) || (mudancas.status_publicacao_ebc === true && !mudancas.ebc_data && !c.ebc_data)) {
    return { erro: "Para marcar a publicação no DOU/EBC, informe a data (e o link ou comprovante, se houver)." };
  }
  if (statusNovo) {
    if (!(TODOS_STATUS as string[]).includes(statusNovo)) return { erro: "Status inválido." };
    if (!justificativa || justificativa.trim().length < 10) return { erro: "Toda alteração manual de status exige justificativa escrita (mínimo de 10 caracteres)." };
    return { mudancas: mudancas as Partial<Contratacao>, status: statusNovo as Status };
  }
  return { mudancas: mudancas as Partial<Contratacao> };
}
