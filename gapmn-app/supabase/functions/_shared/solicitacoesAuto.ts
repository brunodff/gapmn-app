// Regras do envio automático do e-mail ao fiscal (solicitações de empenho), sem banco e sem rede,
// para a função auto-solicitacoes-empenho e para os testes. É a mesma regra do antigo botão
// "Sincronizar SIAFI" do painel de Solicitações, agora rodando sozinha no servidor:
//   1. NE nova na planilha (desde 03/08/2026) com solicitação que ainda não está no banco: cria o
//      registro; se a NE já chega assinada pela OD, manda o e-mail.
//   2. Solicitação que muda de situação (emitida → assinada): atualiza e manda o e-mail.
//   3. E-mail de "assinada" enviado: o registro já sai da lista como verificado (antes era o botão
//      "Verificar e Fechar").
// Só a assinatura da OD gera e-mail (desde 29/10/2026): o aviso de NE emitida deixou de sair, porque
// havia fiscal com mais de 80 e-mails. O "Reenviar" manual da lista continua podendo mandar qualquer um.
// Diferenças em relação ao botão antigo: um e-mail por solicitação (antes, duas NEs da mesma solicitação
// na mesma leitura geravam dois); o valor é o valor atual da NE (soma dos itens), não o do lançamento;
// o modelo do fiscal vale também para a NE que já chega assinada; a solicitação nova conta pela data da
// primeira NE dela (antes, um reforço depois de 03/08 numa NE antiga também criava o registro); e o envio
// que falhou (ou cujo e-mail foi cadastrado depois) sai na leitura seguinte, desde que o registro não
// tenha sido arquivado.

export const INICIO_AUTOMATICO = "2026-08-03";

export type Status = "IMPORTADA" | "EMITIDA" | "ASSINADA" | "ENCERRADA";
export type TipoEnvio = "EMITIDA" | "ASSINADA";

/** Uma linha de lançamento da planilha "Notas de Empenho" (só o que o envio usa). */
export type LinhaNE = {
  data: string;      // DD/MM/AAAA, como na planilha (vai no e-mail)
  dataISO: string;   // AAAA-MM-DD
  ne: string;        // 2026NE000123
  solicitacao: string;
  assinada: boolean;
  descricao: string; // observação da NE (traz o e-mail e o nome do fiscal)
  pag: string;
  cnpj: string;
  favorecido: string;
  natureza: string;
  ugcred: string;
  /** Valor atual da NE: soma do valor atual dos itens (coluna G). */
  valorNE: number;
};

export type Solicitacao = {
  id: string;
  numero: string;
  pag: string | null;
  responsavel: string | null;
  email: string | null;
  obs_original: string | null;
  obs_atraso: string | null;
  status: Status;
  ne_siafi: string | null;
  subprocesso: string | null;
  nd: string | null;
  fornecedor: string | null;
  valor: number | null;
  pregao: string | null;
  sem_destinatario: boolean;
  notificado_emitida_em: string | null;
  notificado_assinada_em: string | null;
  notificacao_ativa: boolean;
  pdf_ne_url: string | null;
  data_emissao: string | null;
  revisado_em: string | null;
};

export type NovaSolicitacao = {
  numero: string;
  pag: string | null;
  cnpj_fornecedor: string | null;
  fornecedor: string | null;
  valor: number | null;
  nd: string | null;
  ugcred: string | null;
  ne_siafi: string | null;
  obs_original: string | null;
  responsavel: string | null;
  email: string | null;
  sem_destinatario: boolean;
  status: Status;
  data_emissao: string | null;
  notificacao_ativa: boolean;
};

export type Resultado = "ENVIAR" | "SEM_EMAIL" | "NOTIF_INATIVA";

/** O que fazer com uma solicitação nesta leitura. `id` vazio = registro novo (o id sai do insert). */
export type Acao = {
  id: string;
  numero: string;
  tipo: TipoEnvio;
  resultado: Resultado;
  email: string | null;
  ne: string;
  nova: boolean;
  /** Campos a gravar no registro existente (situação e NE). */
  patch: Partial<Solicitacao> | null;
  /** Como o registro fica depois do patch (para montar o e-mail). */
  registro: Solicitacao | NovaSolicitacao;
  dataNE: string;
};

export type Plano = {
  novas: NovaSolicitacao[];
  acoes: Acao[];
  /** Registros que só mudam situação ou NE, sem e-mail a mandar. */
  atualizacoes: { id: string; numero: string; patch: Partial<Solicitacao> }[];
  semMudanca: number;
  nesLidas: number;
};

// ── leitura da planilha ─────────────────────────────────────────────────────────

const DATA = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/;
const dataISO = (v: string) => { const m = DATA.exec((v ?? "").trim()); return m ? `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}` : null; };
const neCurta = (v: string) => /(\d{4}NE\d{6})\s*$/i.exec((v ?? "").trim())?.[1].toUpperCase() ?? null;
export const numero = (v: string) => {
  const s = (v ?? "").replace(/[R$\s]/g, "");
  if (!s) return 0;
  const n = s.includes(",") ? Number(s.replace(/\./g, "").replace(",", ".")) : Number(s);
  return Number.isFinite(n) ? n : 0;
};
export const solicitacaoDe = (texto: string) => /\b2[2-9][SM]\d{4,6}\b/i.exec(texto ?? "")?.[0].toUpperCase() ?? "";

/** CSV do Google Sheets: vírgula, aspas duplas, quebra de linha dentro de aspas. */
export function parseCSV(texto: string): string[][] {
  const linhas: string[][] = [];
  let linha: string[] = [];
  let campo = "";
  let aspas = false;
  for (let i = 0; i < texto.length; i++) {
    const c = texto[i];
    if (aspas) {
      if (c === '"') { if (texto[i + 1] === '"') { campo += '"'; i++; } else aspas = false; } else campo += c;
    } else if (c === '"') aspas = true;
    else if (c === ",") { linha.push(campo); campo = ""; }
    else if (c === "\n") { linha.push(campo.replace(/\r$/, "")); linhas.push(linha); linha = []; campo = ""; }
    else campo += c;
  }
  if (campo || linha.length) { linha.push(campo.replace(/\r$/, "")); linhas.push(linha); }
  return linhas;
}

/**
 * Lançamentos da planilha "Notas de Empenho" (21 colunas, A–U): A data, B NE (só na 1ª linha do
 * lançamento), C item, G valor atual do item, H observação, I UG, K natureza, O PAG, P/Q favorecido,
 * T situação da assinatura. As colunas R e S (assinante) não são lidas.
 */
export function lerNEs(linhas: string[][]): LinhaNE[] {
  const saida: LinhaNE[] = [];
  const itens = new Map<string, Map<string, number>>();
  let neAtual = "", dia = "", item = "";
  for (const c of linhas) {
    if (c.length < 21) continue;
    const iso = dataISO(c[0]);
    if (!iso) continue;
    const ne = neCurta(c[1]);
    if (ne) { neAtual = ne; dia = c[0].trim(); item = ""; }
    if (neAtual && c[0].trim() === dia) {
      const seq = (c[2] ?? "").trim();
      if (seq) item = seq;
      const m = itens.get(neAtual) ?? new Map<string, number>();
      itens.set(neAtual, m);
      m.set(item || "1", numero(c[6]));
    }
    if (!ne) continue;
    const descricao = (c[7] ?? "").trim();
    saida.push({
      data: c[0].trim(), dataISO: iso, ne, solicitacao: solicitacaoDe(descricao),
      assinada: /^ASSINAD/i.test((c[19] ?? "").trim()), descricao,
      pag: (c[14] ?? "").trim(), cnpj: (c[15] ?? "").trim(), favorecido: (c[16] ?? "").trim(),
      natureza: (c[10] ?? "").trim(), ugcred: (c[8] ?? "").trim(), valorNE: 0,
    });
  }
  for (const l of saida) l.valorNE = [...(itens.get(l.ne)?.values() ?? [])].reduce((s, v) => s + v, 0);
  const n = (ne: string) => parseInt(ne.replace(/.*NE0*/i, "") || "0", 10);
  return saida.sort((a, b) => n(a.ne) - n(b.ne));
}

// ── contato do fiscal e modelo do e-mail (iguais aos do painel) ──────────────────

export function extrairEmail(obs: string): string {
  const m = (obs ?? "").match(/([A-Za-z0-9._%+-]+@fab\.mil\.br)/i);
  return m ? m[1].toLowerCase() : "";
}

export function extrairResponsavel(desc: string, email: string): string {
  if (email) {
    const idx = desc.toUpperCase().indexOf(email.toUpperCase());
    if (idx > 0) {
      const antes = desc.slice(0, idx).replace(/\s*(CTT|CONTATO|E-MAIL:?)\s*$/i, "").trim();
      const m = antes.match(/(\d?[A-Za-z]+\s+\w+)\s*$/i);
      if (m) return m[1].trim();
    }
  }
  const m = desc.match(/(?:RESPONS[ÁA]VEL|RESP\.?)[:\s]+([^,.()\n@]{2,40})/i);
  return m ? m[1].trim() : "";
}

export function extrairTelefone(obs: string | null): string {
  if (!obs) return "";
  const m = obs.match(/TELEFONE[:\s]+(\(?\d{2}\)?\s*\d{4,5}[\s.-]?\d{4})/i);
  return m ? m[1].trim() : "";
}

export const fmtBRL = (v: number | null | undefined) =>
  !v ? "—" : new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(v);

type Campos = Pick<Solicitacao, "numero" | "ne_siafi" | "fornecedor" | "responsavel" | "email" | "obs_original" | "valor" | "nd" | "pag" | "subprocesso">;

/** Troca as marcas {{...}} do modelo do fiscal pelos dados da solicitação. */
export function aplicarModelo(texto: string, it: Partial<Campos>): string {
  return texto
    .replace(/\{\{ne_siafi\}\}/g, it.ne_siafi ?? "—")
    .replace(/\{\{numero\}\}/g, it.numero ?? "—")
    .replace(/\{\{fornecedor\}\}/g, it.fornecedor ?? "—")
    .replace(/\{\{responsavel\}\}/g, it.responsavel ?? "—")
    .replace(/\{\{email_responsavel\}\}/g, it.email ?? "—")
    .replace(/\{\{telefone_responsavel\}\}/g, extrairTelefone(it.obs_original ?? null))
    .replace(/\{\{valor\}\}/g, fmtBRL(it.valor))
    .replace(/\{\{nd\}\}/g, it.nd ?? "—")
    .replace(/\{\{pag\}\}/g, it.pag ?? "—")
    .replace(/\{\{subprocesso\}\}/g, it.subprocesso ?? "—");
}

/** Corpo do pedido à função send-empenho-email (o mesmo que o painel mandava). */
export function pedidoDeEmail(a: Acao, id: string, modelo: { assunto: string; corpo: string } | null): Record<string, unknown> {
  const r = a.registro as Partial<Solicitacao> & NovaSolicitacao;
  const corpo: Record<string, unknown> = {
    solicitacao_id: id,
    tipo: a.tipo,
    email: a.email,
    responsavel: r.responsavel || r.numero,
    numero: r.numero,
    subprocesso: r.subprocesso ?? null,
    ne_siafi: a.ne,
    pag: r.pag,
    fornecedor: r.fornecedor,
    valor: r.valor,
    nd: r.nd,
    pregao: r.pregao ?? null,
    obs_atraso: r.obs_atraso ?? null,
    pdf_ne_url: r.pdf_ne_url ?? null,
    data_emissao: a.dataNE,
  };
  if (a.tipo === "ASSINADA" && modelo) {
    const campos = { ...r, ne_siafi: a.ne };
    corpo.assunto_customizado = aplicarModelo(modelo.assunto, campos);
    corpo.corpo_customizado = aplicarModelo(modelo.corpo, campos);
  }
  return corpo;
}

// ── o plano de cada leitura ─────────────────────────────────────────────────────

export function planejar(nes: LinhaNE[], solicitacoes: Solicitacao[], inicio = INICIO_AUTOMATICO): Plano {
  const porSolicitacao = new Map<string, LinhaNE[]>();
  for (const l of nes) {
    if (!l.solicitacao) continue;
    const lista = porSolicitacao.get(l.solicitacao) ?? [];
    lista.push(l);
    porSolicitacao.set(l.solicitacao, lista);
  }
  const existentes = new Set(solicitacoes.map((s) => s.numero.toUpperCase()));

  const novas: NovaSolicitacao[] = [];
  const acoes: Acao[] = [];
  const atualizacoes: Plano["atualizacoes"] = [];
  let semMudanca = 0;

  // 1. NEs novas com solicitação que ainda não está no banco
  for (const [numero, lista] of porSolicitacao) {
    if (existentes.has(numero)) continue;
    // a primeira data da solicitação na planilha (a emissão) decide: reforço depois de 03/08 de NE mais antiga não conta
    const primeira = lista.reduce((m, l) => (l.dataISO < m.dataISO ? l : m), lista[0]);
    if (primeira.dataISO < inicio) continue;
    const ultima = lista[lista.length - 1];
    const assinada = lista.some((l) => l.assinada);
    const email = extrairEmail(primeira.descricao);
    const responsavel = extrairResponsavel(primeira.descricao, email);
    const nova: NovaSolicitacao = {
      numero,
      pag: primeira.pag || null,
      cnpj_fornecedor: primeira.cnpj.replace(/\D/g, "") || null,
      fornecedor: primeira.favorecido || null,
      valor: ultima.valorNE || null,
      nd: primeira.natureza || null,
      ugcred: primeira.ugcred || null,
      ne_siafi: ultima.ne,
      obs_original: primeira.descricao || null,
      responsavel: responsavel || null,
      email: email || null,
      sem_destinatario: !email,
      status: assinada ? "ASSINADA" : "EMITIDA",
      data_emissao: primeira.dataISO,
      notificacao_ativa: true,
    };
    novas.push(nova);
    // ainda sem a assinatura da OD: só entra na lista; o e-mail sai quando a NE for assinada
    if (!assinada) continue;
    acoes.push({
      id: "", numero, tipo: "ASSINADA", resultado: email ? "ENVIAR" : "SEM_EMAIL",
      email: email || null, ne: ultima.ne, nova: true, patch: null, registro: nova, dataNE: primeira.data,
    });
  }

  // 2. Solicitações que já estão no banco
  for (const s of solicitacoes) {
    if (s.status === "ENCERRADA") continue;
    const lista = porSolicitacao.get(s.numero.toUpperCase());
    if (!lista?.length) continue;
    const melhor = lista[lista.length - 1];
    const novoStatus: Status = lista.some((l) => l.assinada) ? "ASSINADA" : "EMITIDA";
    // só a assinatura da OD gera e-mail: NE emitida e ainda não assinada não manda nada
    const faltaAssinada = novoStatus === "ASSINADA" && !s.notificado_assinada_em;
    const mudou = novoStatus !== s.status || !s.ne_siafi;
    const temEmail = !!(s.email && !s.sem_destinatario);
    // envio que ficou para trás (falhou ou o e-mail foi cadastrado depois) só sai se o registro não foi
    // arquivado; sem e-mail ou com a notificação desligada, a pendência só aparece quando a situação muda
    const pendente = faltaAssinada && !s.revisado_em && temEmail && s.notificacao_ativa;
    if (!mudou && !pendente) { semMudanca++; continue; }

    const patch: Partial<Solicitacao> = {};
    if (novoStatus !== s.status) patch.status = novoStatus;
    if (melhor.ne && melhor.ne !== s.ne_siafi) patch.ne_siafi = melhor.ne;
    const registro: Solicitacao = { ...s, ...patch };

    if (!faltaAssinada) {
      if (Object.keys(patch).length) atualizacoes.push({ id: s.id, numero: s.numero, patch });
      else semMudanca++;
      continue;
    }
    acoes.push({
      id: s.id, numero: s.numero, tipo: "ASSINADA",
      resultado: !temEmail ? "SEM_EMAIL" : !s.notificacao_ativa ? "NOTIF_INATIVA" : "ENVIAR",
      email: s.email, ne: registro.ne_siafi ?? melhor.ne, nova: false,
      patch: Object.keys(patch).length ? patch : null, registro, dataNE: melhor.data,
    });
  }

  return { novas, acoes, atualizacoes, semMudanca, nesLidas: nes.length };
}
