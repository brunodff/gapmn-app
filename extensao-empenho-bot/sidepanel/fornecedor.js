/**
 * Verificação do fornecedor pelo servidor do gapmn.app (função verificar-fornecedor, no Supabase):
 *   - sanções do Portal da Transparência: CEIS, CNEP e CEPIM (da filial e da matriz);
 *   - "ativo" e "habilitado a licitar" do cadastro no Compras.gov.br (SICAF);
 *   - situação cadastral do CNPJ na Receita Federal.
 * Até a 2.9.3 a consulta ia ao servidor MCP Compras (mcp-compras.up.railway.app), que saiu do ar.
 *
 * Não cobre as certidões de regularidade (CND Receita/PGFN, FGTS, trabalhista):
 * elas só aparecem na "Situação do Fornecedor" do SICAF, com login gov.br.
 */

const URL_VERIFICAR = 'https://fychrtyyqbzlfbzbvzqp.supabase.co/functions/v1/verificar-fornecedor';
// chave pública do gapmn.app (a mesma da contagem de uso): só chama a função, não lê o banco
const CHAVE = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZ5Y2hydHl5cWJ6bGZiemJ2enFwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzA5Mzk5NzcsImV4cCI6MjA4NjUxNTk3N30.i27qaCYX9qZ6liL9iXaOtYgddWgKyiM5eoobIN1loFw';

// A consulta tem prazo: servidor lento deixaria o cartão "verificando" para sempre
const PRAZO = 45000;
async function comPrazo(fn, ms = PRAZO) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fn(ctrl.signal);
  } catch (e) {
    if (ctrl.signal.aborted) throw new Error(`o servidor de verificação não respondeu em ${ms / 1000} s`);
    throw e;
  } finally {
    clearTimeout(t);
  }
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
  } else if (perfil && !sancoes?.fontes_com_erro?.sicaf) {
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
    ? `Sem sanções ou impedimentos — situação cadastral ${String(situacao).toLowerCase()} na Receita · habilitado a licitar · CEIS/CNEP: nada consta (certidões: ver SICAF)`
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
  const j = await comPrazo(async signal => {
    const r = await fetch(URL_VERIFICAR, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: CHAVE, Authorization: 'Bearer ' + CHAVE },
      body: JSON.stringify({ cnpj }),
      signal,
    });
    const corpo = await r.json().catch(() => null);
    if (!r.ok || !corpo) throw new Error(corpo?.erro ?? `o servidor de verificação respondeu ${r.status}`);
    return corpo;
  });
  return classificar(j.perfil ?? null, j.sancoes ?? null);
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
