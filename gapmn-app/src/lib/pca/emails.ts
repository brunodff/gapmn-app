// E-mails do Acompanhamento do PCA (Módulos B, E, G, H e I). Texto institucional, sem enfeite; HTML simples
// que abre bem no Gmail e no Outlook, e a mesma mensagem em texto puro.
import { type ConfigPca, type Contratacao, type NovoEmail, macroDe, proximaAcao } from "./tipos.ts";

const br = (d: string | null | undefined) => (d ? d.slice(0, 10).split("-").reverse().join("/") : "não informada");
const brl = (v: number | null | undefined) => (v == null ? "não informado" : v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" }));
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const ident = (c: Contratacao) => c.numero_pag ? `PAG ${c.numero_pag}` : `Contratação ${c.id_contratacao_pgc ?? "(sem nº no PGC)"}`;

function montar(titulo: string, linhas: [string, string][], paragrafos: string[], rodape: string): { html: string; texto: string } {
  const tabela = linhas.map(([k, v]) => `<tr><td style="padding:4px 10px 4px 0;color:#475569;white-space:nowrap;vertical-align:top"><b>${esc(k)}</b></td><td style="padding:4px 0">${esc(v)}</td></tr>`).join("");
  const ps = paragrafos.map((p) => `<p style="margin:10px 0">${p}</p>`).join("");
  const html = `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#0f172a;max-width:640px">
<h2 style="font-size:16px;margin:0 0 12px">${esc(titulo)}</h2>
<table style="border-collapse:collapse;font-size:14px">${tabela}</table>${ps}
<p style="margin:18px 0 0;font-size:12px;color:#64748b">${esc(rodape)}</p></div>`;
  const texto = [titulo, "", ...linhas.map(([k, v]) => `${k}: ${v}`), "", ...paragrafos.map((p) => p.replace(/<[^>]+>/g, "")), "", rodape].join("\n");
  return { html, texto };
}
const RODAPE = "Mensagem automática do Acompanhamento do PCA do GAP-MN (SLIC). Dúvidas: responda a este e-mail ou procure a SLIC.";

/** Módulo B: aviso D-30 ao Elo, antes da chegada prevista do processo na SLIC */
export function emailD30(c: Contratacao, para: string[], cfg: ConfigPca): NovoEmail {
  const { html, texto } = montar(`PCA ${c.ano}: processo previsto para chegar à SLIC em ${br(c.data_estimada_chegada)}`, [
    ["Contratação (PGC)", c.id_contratacao_pgc ?? "sem nº no PGC"],
    ["Objeto", c.objeto_resumido ?? c.objeto],
    ["OM/setor", c.om_apoiada ?? "não informado"],
    ["Chegada prevista na SLIC", br(c.data_estimada_chegada)],
    ["Conclusão/homologação planejada pelo setor", br(c.data_estimada_conclusao)],
  ], [
    `1. A data prevista para a chegada deste processo (DNR) na SLIC é <b>${br(c.data_estimada_chegada)}</b>.`,
    `2. A conclusão (homologação) planejada pelo próprio setor no PCA é <b>${br(c.data_estimada_conclusao)}</b>.`,
    `3. A instrução deve chegar <b>completa</b>, conforme as listas de verificação documental: <a href="${esc(cfg.link_listas)}">${esc(cfg.link_listas)}</a>.`,
    "4. Em caso de adiamento ou cancelamento da licitação, encaminhar <b>expediente formal</b> solicitando a alteração do PCA.",
  ], RODAPE);
  return { contratacao_id: c.id, tipo: "d30", para, assunto: `[PCA ${c.ano}] Chegada prevista em ${br(c.data_estimada_chegada)}: ${c.objeto_resumido ?? c.objeto}`.slice(0, 180), html, texto, chave: `d30:${c.id}:${c.data_estimada_chegada}` };
}

/** Módulo I: macroalteração do status, ao Elo */
export function emailMacro(c: Contratacao, para: string[], data: string, detalhe?: string): NovoEmail | null {
  const macro = macroDe(c.status_atual);
  if (!macro) return null;
  const { html, texto } = montar(`${ident(c)}: ${macro}`, [
    ["PAG", c.numero_pag ?? "ainda não informado"],
    ["Contratação (PGC)", c.id_contratacao_pgc ?? "—"],
    ["Objeto", c.objeto_resumido ?? c.objeto],
    ["Status atual", c.status_atual],
    ["Data", br(data)],
    ["Próxima ação esperada", proximaAcao(c.status_atual, c.sistema_srp)],
  ], detalhe ? [esc(detalhe)] : [], RODAPE);
  return { contratacao_id: c.id, tipo: "macro", para, assunto: `[${ident(c)}] ${macro}: ${c.objeto_resumido ?? c.objeto}`.slice(0, 180), html, texto, chave: `macro:${c.id}:${c.status_atual}:${data.slice(0, 10)}` };
}

/** Módulo H: homologado → Atas (SRP) ou SCON (contrato) */
export function emailHomologacao(c: Contratacao, cfg: ConfigPca): NovoEmail {
  const srp = !!c.sistema_srp;
  const { html, texto } = montar(`${ident(c)} homologado: ${srp ? "formalizar a Ata de Registro de Preços" : "elaborar o Termo de Contrato"}`, [
    ["PAG", c.numero_pag ?? "—"],
    ["Certame", `${c.modalidade ?? ""} ${c.numero_certame ?? ""}`.trim() || "—"],
    ["Objeto", c.objeto],
    ["OM/setor", c.om_apoiada ?? "—"],
    ["Homologação", br(c.data_homologacao)],
    ["Subprocesso fase externa", c.subprocesso_fase_externa ?? "—"],
    ["Valor estimado", brl(c.valor_estimado)],
    ["PNCP", c.link_pncp ?? "—"],
  ], [srp ? "Processo com Sistema de Registro de Preços: encaminhado para a formalização da ARP." : "Processo sem registro de preços: encaminhado à SCON para a elaboração do Termo de Contrato."], RODAPE);
  return { contratacao_id: c.id, tipo: srp ? "homologacao_srp" : "homologacao_contrato", para: [srp ? cfg.email_atas : cfg.email_scon], assunto: `[${ident(c)}] Homologado: ${srp ? "formalizar ARP" : "elaborar contrato"}: ${c.objeto_resumido ?? c.objeto}`.slice(0, 180), html, texto, chave: `homologacao:${c.id}` };
}

/** Módulo E: CJU passou do prazo de referência, à SLIC */
export function emailSlaCju(c: Contratacao, diasNaCju: number, cfg: ConfigPca): NovoEmail | null {
  if (!cfg.email_slic) return null;
  const { html, texto } = montar(`${ident(c)}: ${diasNaCju} dias na CJU sem retorno`, [
    ["Objeto", c.objeto_resumido ?? c.objeto],
    ["Envio à CJU", br(c.data_envio_cju)],
    ["Dias corridos", String(diasNaCju)],
  ], [`Passou o prazo de referência de ${cfg.sla_cju_dias} dias. Verificar se o envio chegou à CJU ou cobrar o retorno.`], RODAPE);
  return { contratacao_id: c.id, tipo: "sla_cju", para: [cfg.email_slic], assunto: `[${ident(c)}] CJU: ${diasNaCju} dias sem retorno`, html, texto, chave: `sla_cju:${c.id}:${c.data_envio_cju}` };
}

/** Módulo G: impugnação ou esclarecimento, ao pregoeiro e à SLIC */
export function emailImpugnacao(c: Contratacao | null, tipo: "impugnacao" | "esclarecimento", assunto: string, recebido: string, para: string[], eventoId: string): NovoEmail {
  const nome = tipo === "impugnacao" ? "Impugnação" : "Pedido de esclarecimento";
  const { html, texto } = montar(`${nome} recebido${c ? `: ${ident(c)}` : ""}`, [
    ["Assunto do e-mail", assunto],
    ["Recebido em", br(recebido)],
    ["Objeto", c ? (c.objeto_resumido ?? c.objeto) : "processo não identificado"],
    ["Pregoeiro", c?.pregoeiro_responsavel ?? "não designado"],
  ], ["Responder no prazo legal (art. 164 da Lei nº 14.133/2021: até 3 dias úteis antes da abertura do certame para o pedido; resposta em até 3 dias úteis)."], RODAPE);
  return { contratacao_id: c?.id ?? null, tipo: "impugnacao", para, assunto: `[${nome}] ${assunto}`.slice(0, 180), html, texto, chave: `evento:${eventoId}` };
}
