/**
 * Verificação do fornecedor pelo MCP Compras.gov.br (o mesmo servidor do gapmn.app):
 *   - sanções do Portal da Transparência: CEIS, CNEP e CEPIM;
 *   - impedimentos registrados no Comprasnet (SICAF);
 *   - "habilitado a licitar" do cadastro no Compras.gov.br;
 *   - situação cadastral do CNPJ na Receita Federal.
 *
 * Não cobre as certidões de regularidade (CND Receita/PGFN, FGTS, trabalhista):
 * elas só aparecem na "Situação do Fornecedor" do SICAF, com login gov.br.
 */

const MCP_URL = 'https://mcp-compras.up.railway.app/mcp';
const PROTOCOL_VERSION = '2025-06-18';

let sessao = null;
let rpcId = 0;
let handshake = null;

async function postMcp(payload) {
  const headers = {
    'Content-Type': 'application/json',
    'Accept': 'application/json, text/event-stream',
    'mcp-protocol-version': PROTOCOL_VERSION,
  };
  if (sessao) headers['mcp-session-id'] = sessao;
  return fetch(MCP_URL, { method: 'POST', headers, body: JSON.stringify(payload) });
}

// Resposta em JSON ou em SSE (event-stream), conforme o servidor escolher
async function lerResposta(res, id) {
  const corpo = await res.text();
  if ((res.headers.get('content-type') ?? '').includes('text/event-stream')) {
    for (const linha of corpo.split('\n')) {
      if (!linha.startsWith('data:')) continue;
      try {
        const msg = JSON.parse(linha.slice(5));
        if (msg.id === id) return msg;
      } catch { /* evento sem JSON */ }
    }
    throw new Error('resposta do MCP sem a mensagem pedida');
  }
  return JSON.parse(corpo);
}

async function iniciarSessao() {
  sessao = null;
  const id = ++rpcId;
  const res = await postMcp({
    jsonrpc: '2.0', id, method: 'initialize',
    params: { protocolVersion: PROTOCOL_VERSION, capabilities: {}, clientInfo: { name: 'gapmn-empenho-bot', version: '1.0' } },
  });
  if (!res.ok) throw new Error(`MCP indisponível (HTTP ${res.status})`);
  sessao = res.headers.get('mcp-session-id');
  await lerResposta(res, id);
  await postMcp({ jsonrpc: '2.0', method: 'notifications/initialized' });
}

async function chamarTool(nome, args) {
  if (!sessao) {
    handshake ??= iniciarSessao().finally(() => { handshake = null; });
    await handshake;
  }
  for (let tentativa = 0; tentativa < 3; tentativa++) {
    const id = ++rpcId;
    const res = await postMcp({ jsonrpc: '2.0', id, method: 'tools/call', params: { name: nome, arguments: args } });
    if (res.status === 404 || res.status === 400) { await iniciarSessao(); continue; }  // sessão perdida
    if (res.status >= 500 || res.status === 429) { await new Promise(r => setTimeout(r, 800 * (tentativa + 1))); continue; }
    if (!res.ok) throw new Error(`MCP respondeu HTTP ${res.status}`);
    const msg = await lerResposta(res, id);
    if (msg.error) throw new Error(msg.error.message ?? 'erro do MCP');
    const r = msg.result ?? {};
    const texto = r.content?.find(c => c.type === 'text')?.text ?? '';
    if (r.isError) throw new Error(texto || 'a consulta devolveu erro');
    if (r.structuredContent) return r.structuredContent;
    try { return JSON.parse(texto); } catch { return { texto }; }
  }
  throw new Error('MCP indisponível após 3 tentativas');
}

// ── Regras ────────────────────────────────────────────────────────────────────

const norm = s => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim().toUpperCase();

function dataBR(s) {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(String(s ?? '').trim());
  return m ? new Date(+m[3], +m[2] - 1, +m[1], 23, 59, 59) : null;
}
const expirada = (r, hoje) => { const fim = dataBR(r?.dataFimSancao); return !!fim && fim < hoje; };
const ate = r => (dataBR(r?.dataFimSancao) ? ` (até ${r.dataFimSancao})` : '');
const orgao = r => {
  const o = r?.orgaoSancionador ?? {};
  const nome = o.nome ?? r?.fonteSancao?.nomeExibicao ?? 'órgão não informado';
  return o.siglaUf && !nome.includes(`(${o.siglaUf})`) ? `${nome}/${o.siglaUf}` : nome;
};

/**
 * Sanção do CEIS contra um órgão federal (GAP-MN): bloqueia se valer para a União.
 * Inidoneidade vale em todas as esferas; impedimento vale no ente que o aplicou
 * (Lei 14.133, art. 156); suspensão "no órgão sancionador" só naquele órgão.
 */
export function classificarCeis(r, hoje = new Date()) {
  if (expirada(r, hoje)) return null;
  const tipo = norm(r.tipoSancao?.descricaoResumida);
  const o = r.orgaoSancionador ?? {};
  const esfera = norm(o.esfera);
  const poder = norm(o.poder);
  const abrangencia = norm(r.abrangenciaDefinidaDecisaoJudicial);
  const bloqueia =
    /INIDONE/.test(tipo) ||
    /TODAS AS ESFERAS|TODOS OS PODERES/.test(abrangencia) ||
    /AERONAUTICA|MINISTERIO DA DEFESA/.test(norm(o.nome)) ||
    (esfera === 'FEDERAL' && /IMPEDIMENTO|PROIBI/.test(tipo)) ||
    (poder === 'JUDICIARIO' && /IMPEDIMENTO|PROIBI/.test(tipo) && !/ORGAO SANCIONADOR/.test(abrangencia));
  return {
    nivel: bloqueia ? 'bloqueio' : 'atencao',
    texto: `CEIS: ${r.tipoSancao?.descricaoResumida ?? 'sanção'} — ${orgao(r)}${ate(r)}`,
  };
}

function resumoImpedimento(imp) {
  if (!imp || typeof imp !== 'object') return String(imp ?? '');
  const campo = (...ks) => ks.map(k => imp[k]).find(v => v != null && v !== '');
  const partes = [
    campo('descricaoImpedimento', 'tipoImpedimento', 'motivo', 'descricao', 'tipo', 'sancao'),
    campo('orgao', 'nomeOrgao', 'uasg', 'nomeUasg'),
    campo('dataFim', 'dataFimImpedimento', 'vigenciaFim') ? `até ${campo('dataFim', 'dataFimImpedimento', 'vigenciaFim')}` : null,
  ].filter(Boolean);
  return partes.length ? partes.join(' — ') : JSON.stringify(imp).slice(0, 160);
}

/** Junta perfil + sanções num veredito: 'ok' | 'atencao' | 'bloqueio' */
export function classificar(perfil, sancoes, hoje = new Date()) {
  const itens = [];
  const add = (nivel, texto) => itens.push({ nivel, texto });

  const receita = perfil?.receita_federal;
  const situacao = receita?.situacao_cadastral;
  if (situacao) {
    if (norm(situacao) !== 'ATIVA') add('bloqueio', `Receita Federal: CNPJ ${situacao}`);
  } else {
    add('atencao', 'Receita Federal: situação cadastral não consultada');
  }

  const cadastro = perfil?.cadastro;
  if (cadastro) {
    if (cadastro.habilitadoLicitar === false) add('atencao', 'SICAF: fornecedor não habilitado a licitar');
    if (cadastro.ativo === false) add('atencao', 'Compras.gov.br: cadastro do fornecedor inativo');
  } else if (perfil) {
    add('atencao', 'Fornecedor não encontrado no cadastro do Compras.gov.br (SICAF)');
  }

  for (const imp of perfil?.impedimentos_comprasnet ?? []) add('bloqueio', `Impedimento no Comprasnet/SICAF: ${resumoImpedimento(imp)}`);

  const det = sancoes?.detalhamento;
  const ceis = det?.ceis ?? perfil?.sancoes?.ceis ?? [];
  for (const r of ceis) {
    const c = classificarCeis(r, hoje);
    if (c) add(c.nivel, c.texto);
  }
  for (const r of det?.cnep ?? perfil?.sancoes?.cnep ?? []) {
    if (!expirada(r, hoje)) add('atencao', `CNEP (Lei Anticorrupção): ${r.tipoSancao?.descricaoResumida ?? 'sanção'} — ${orgao(r)}${ate(r)}`);
  }
  for (const r of det?.cepim ?? perfil?.sancoes?.cepim ?? []) {
    add('atencao', `CEPIM: ${r.motivo ?? r.tipoSancao?.descricaoResumida ?? 'entidade impedida'} — ${orgao(r)}`);
  }
  if (!sancoes && !perfil?.sancoes) add('atencao', 'Sanções (CEIS/CNEP) não consultadas');
  for (const fonte of Object.keys(sancoes?.fontes_com_erro ?? {})) add('atencao', `${fonte.toUpperCase()} não consultado (fonte fora do ar)`);

  const nivel = itens.some(i => i.nivel === 'bloqueio') ? 'bloqueio'
    : itens.some(i => i.nivel === 'atencao') ? 'atencao' : 'ok';
  const resumo = nivel === 'ok'
    // Situação cadastral do CNPJ (ATIVA) não é certidão: essas vêm do SICAF (sicaf.js)
    ? `Sem sanções ou impedimentos — CNPJ ${String(situacao).toLowerCase()} na Receita · habilitado a licitar · CEIS/CNEP: nada consta (certidões: ver SICAF)`
    : itens.filter(i => i.nivel === nivel).map(i => i.texto).join(' · ');
  return {
    nivel, resumo, itens,
    razaoSocial: cadastro?.nomeRazaoSocialFornecedor ?? receita?.razao_social ?? '',
    consultadoEm: new Date().toISOString(),
  };
}

// ── API ───────────────────────────────────────────────────────────────────────

const cache = new Map();   // cnpj → Promise do resultado (uma consulta por CNPJ na sessão)

async function consultar(cnpj) {
  const [perfil, sancoes] = await Promise.allSettled([
    chamarTool('compras_perfil_fornecedor_completo', { cnpj }),
    chamarTool('compras_checar_sancoes_fornecedor', { cnpj }),
  ]);
  if (perfil.status === 'rejected' && sancoes.status === 'rejected') throw perfil.reason;
  return classificar(perfil.value ?? null, sancoes.value ?? null);
}

/** Verifica o fornecedor pelo CNPJ. Nunca rejeita: falha vira nivel 'erro'. */
export function verificarFornecedor(cnpj) {
  const c = String(cnpj ?? '').replace(/\D/g, '');
  if (c.length !== 14) {
    return Promise.resolve({ nivel: 'erro', resumo: 'CNPJ ausente ou inválido — fornecedor não verificado', itens: [] });
  }
  if (!cache.has(c)) {
    cache.set(c, consultar(c).catch(e => {
      cache.delete(c);   // tenta de novo na próxima vez
      return { nivel: 'erro', resumo: `Não consegui verificar o fornecedor (${e.message})`, itens: [] };
    }));
  }
  return cache.get(c);
}
