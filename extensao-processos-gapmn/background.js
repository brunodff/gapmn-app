'use strict';
/**
 * GAP-MN — Processos ao Vivo (background)
 *
 * Para o pessoal da SLIC. O app do GAP-MN já busca sozinho, nas APIs públicas (PNCP e
 * Dados Abertos), todos os processos, itens e vencedores publicados. Esta extensão manda
 * o que só existe com login no ComprasNet: a fase de cada processo e de cada item
 * (aguardando julgamento, habilitação, recurso, adjudicação…), a ação pendente, os
 * participantes e quem está em primeiro em cada item antes da homologação.
 *
 * Quando: ao abrir ou recarregar a Área de Trabalho do ComprasNet e a cada 30 min com ela
 * aberta, se o último envio tiver mais de N horas (padrão 3); ou no botão "Enviar agora".
 * Só processos da UASG 120630. Grava com o login do app (SLIC/ADMIN/DEV) — o banco só
 * aceita esses perfis nas tabelas cnet_*.
 */

const SUPA_URL = 'https://fychrtyyqbzlfbzbvzqp.supabase.co';
// Chave pública (anon) do app — a mesma do site; quem grava é o login do usuário
const SUPA_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZ5Y2hydHl5cWJ6bGZiemJ2enFwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzA5Mzk5NzcsImV4cCI6MjA4NjUxNTk3N30.i27qaCYX9qZ6liL9iXaOtYgddWgKyiM5eoobIN1loFw';
const UASG = '120630';
const CNET_ABAS = '*://cnetmobile.estaleiro.serpro.gov.br/*';
const INTERVALO_PADRAO_H = 3;
const TEMPO_MAX_MS = 4 * 60_000;     // um envio por vez; o que faltar continua no próximo
const PERFIS = ['SLIC', 'ADMIN', 'DEV'];
const FINALIZADO = /homolog|cancel|fracass|desert|revog|anulad|encerrad/i;

// ── Estado (storage.local) ────────────────────────────────────────────────────
//   sessao: { access_token, refresh_token, expira, uid, nome, setor }
//   config: { intervaloH }
//   envio:  { emCurso, inicio, fim, ok, erro, resumo, log[], pendentes[] }
async function ler(chaves) { return chrome.storage.local.get(chaves); }
async function gravarEnvio(parcial) {
  const { envio = {} } = await ler('envio');
  const novo = { ...envio, ...parcial };
  await chrome.storage.local.set({ envio: novo });
  return novo;
}
async function logar(texto) {
  const { envio = {} } = await ler('envio');
  const log = [...(envio.log || []), new Date().toLocaleTimeString('pt-BR') + ' ' + texto].slice(-40);
  await chrome.storage.local.set({ envio: { ...envio, log } });
}
function selo(texto, cor) {
  chrome.action.setBadgeText({ text: texto });
  if (cor) chrome.action.setBadgeBackgroundColor({ color: cor });
}

// ── Login no app (Supabase) ───────────────────────────────────────────────────
async function supaAuth(tipo, corpo) {
  const r = await fetch(SUPA_URL + '/auth/v1/token?grant_type=' + tipo, {
    method: 'POST', headers: { apikey: SUPA_KEY, 'Content-Type': 'application/json' }, body: JSON.stringify(corpo),
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error_description || d.msg || d.message || 'Falha no login (HTTP ' + r.status + ')');
  return d;
}

async function entrar(email, senha) {
  const d = await supaAuth('password', { email, password: senha });
  const perfil = await fetch(SUPA_URL + '/rest/v1/profiles?select=setor,role,nome_guerra&id=eq.' + d.user.id, {
    headers: { apikey: SUPA_KEY, Authorization: 'Bearer ' + d.access_token },
  }).then((r) => r.json()).then((l) => l[0] || {}).catch(() => ({}));
  const setor = String(perfil.setor || '').toUpperCase();
  if (!PERFIS.includes(setor) && perfil.role !== 'admin') {
    throw new Error('Seu perfil no app (' + (setor || 'sem setor') + ') não pode enviar processos — só SLIC, ADMIN ou DEV.');
  }
  const sessao = {
    access_token: d.access_token, refresh_token: d.refresh_token, expira: Date.now() + (d.expires_in || 3600) * 1000,
    uid: d.user.id, nome: perfil.nome_guerra || d.user.email, setor: setor || 'ADMIN',
  };
  await chrome.storage.local.set({ sessao });
  return sessao;
}

async function tokenDoApp() {
  const { sessao } = await ler('sessao');
  if (!sessao) throw new Error('Entre com seu login do app GAP-MN (clique no ícone da extensão).');
  if (Date.now() < sessao.expira - 120_000) return sessao;
  try {
    const d = await supaAuth('refresh_token', { refresh_token: sessao.refresh_token });
    const nova = { ...sessao, access_token: d.access_token, refresh_token: d.refresh_token, expira: Date.now() + (d.expires_in || 3600) * 1000 };
    await chrome.storage.local.set({ sessao: nova });
    return nova;
  } catch (e) {
    await chrome.storage.local.remove('sessao');
    throw new Error('O login do app expirou — entre de novo pelo ícone da extensão.');
  }
}

async function supa(caminho, { metodo = 'GET', corpo, prefer } = {}) {
  const s = await tokenDoApp();
  const headers = { apikey: SUPA_KEY, Authorization: 'Bearer ' + s.access_token, 'Content-Type': 'application/json' };
  if (prefer) headers.Prefer = prefer;
  const r = await fetch(SUPA_URL + '/rest/v1/' + caminho, { method: metodo, headers, body: corpo ? JSON.stringify(corpo) : undefined });
  if (!r.ok) {
    const t = await r.text().catch(() => '');
    if (/row-level security|permission denied/i.test(t)) throw new Error('O app recusou a gravação: seu perfil não tem permissão (só SLIC, ADMIN ou DEV).');
    throw new Error('App HTTP ' + r.status + ': ' + t.slice(0, 160));
  }
  const t = await r.text();
  return t ? JSON.parse(t) : null;
}
async function upsert(tabela, linhas, conflito) {
  for (let i = 0; i < linhas.length; i += 200) {
    await supa(tabela + '?on_conflict=' + encodeURIComponent(conflito), {
      metodo: 'POST', corpo: linhas.slice(i, i + 200), prefer: 'resolution=merge-duplicates,return=minimal',
    });
  }
}

// ── Aba do ComprasNet ─────────────────────────────────────────────────────────
async function abaDoCnet() {
  const abas = await chrome.tabs.query({ url: CNET_ABAS });
  return abas.find((a) => /\/seguro\//.test(a.url || '')) || abas.find((a) => /area-trabalho/.test(a.url || '')) || null;
}
async function naPagina(tabId, func, args = []) {
  const [r] = await chrome.scripting.executeScript({ target: { tabId }, world: 'MAIN', func, args });
  return r?.result;
}

// ── Funções que rodam DENTRO da aba do ComprasNet (com o login da pessoa) ─────
// Precisam ser autossuficientes: o Chrome as copia para a página.

function cnetListar(uasg) {
  function token() {
    try { const t = localStorage.getItem('areaTrabalhoGovernoToken'); if (t && t.startsWith('eyJ')) return t; } catch {}
    try { for (const k of ['keycloak', '_keycloak', 'kcInstance']) if (window[k]?.token) return window[k].token; } catch {}
    const jwt = (v) => {
      if (typeof v === 'string') { if (v.startsWith('eyJ')) return v; if (/^[[{]/.test(v)) { try { return jwt(JSON.parse(v)); } catch {} } return null; }
      if (v && typeof v === 'object') { for (const k of ['access_token', 'token', 'accessToken']) if (v[k]) { const t = jwt(v[k]); if (t) return t; } for (const k of Object.keys(v)) { const t = jwt(v[k]); if (t) return t; } }
      return null;
    };
    for (const st of [sessionStorage, localStorage]) for (let i = 0; i < st.length; i++) { const t = jwt(st.getItem(st.key(i)) || ''); if (t) return t; }
    return null;
  }
  return (async () => {
    const t = token();
    const hdrs = { Accept: 'application/json' };
    if (t) hdrs.Authorization = 'Bearer ' + t;
    const grupos = [[2, 'Selecao do Fornecedor'], [3, 'Compras Finalizadas'], [4, 'Grupo 4'], [5, 'Grupo 5'], [6, 'Grupo 6']];
    const itens = [], erros = [];
    let semLogin = false;
    for (const [id, nome] of grupos) {
      try {
        for (let pg = 0; pg < 60; pg++) {
          const qs = 'size=100&page=' + pg + '&somenteFavoritos=false&comPendencia=false&sobMinhaResponsabilidade=false' +
            '&avisosAlice=false&etapas=&itensTrabelho=&ultimosDias=0&dataInicial=&dataFinal=&filtroUasg=';
          const r = await fetch('/comprasnet-area-trabalho/v2/agrupamento/' + id + '/itemtrabalho?' + qs, { credentials: 'include', headers: hdrs });
          if (r.status === 401 || r.status === 403) { semLogin = true; break; }
          if (r.status === 404 || r.status === 422) break;
          if (!r.ok) throw new Error('HTTP ' + r.status);
          const raw = await r.json();
          const pagina = Array.isArray(raw) ? raw : (raw.content || raw.itens || []);
          for (const it of pagina) {
            const ident = it.identificacao || '';
            if (!ident.includes(' ' + uasg + ' - ')) continue;
            const m = ident.match(/(\d+)\/(\d{4})\s*$/);
            itens.push({
              id: it.idItemTrabalho, identificacao: ident, numero: m ? m[1] : '', ano: m ? m[2] : '',
              situacao: it.situacao || '', acao: it.acao?.nome || '', acao_url: it.acao?.url || '',
              possui_pendencia: !!it.sinalizador?.possuiPendencia, agrupamento: nome,
            });
          }
          if (pagina.length < 100) break;
        }
      } catch (e) { erros.push(nome + ': ' + e.message); }
      if (semLogin) break;
    }
    return { itens, erros, semLogin, temToken: !!t };
  })();
}

function cnetDetalhar(idCompra, acaoUrl, buscarVencedores) {
  const FE = '/comprasnet-fase-externa/v1/compras/';
  // Mapeamento do Painel ComprasNet (conferido ao vivo): `situacao` só sai de "1" quando o
  // item termina fora do fluxo normal; `fase` carrega a fase de trabalho
  const TERMINAL = { 2: 'Cancelado', 3: 'Anulado', 13: 'Anulado', 4: 'Revogado', 14: 'Revogado', 5: 'Suspenso', 6: 'Deserto', 7: 'Fracassado', 8: 'Fracassado', 9: 'Fracassado' };
  const FASE = {
    AS: 'Aguardando abertura da sessão pública', AP: 'Pendente de análise de propostas', F: 'Aguardando disputa',
    AA: 'Aguardando abertura', LS: 'Disputa suspensa', LA: 'Em disputa', LF: 'Em disputa (etapa fechada)', AL: 'Em disputa',
    FE: 'Aguardando encerramento', RA: 'Aguardando decisão sobre reinício', AF: 'Aguardando disputa fechada',
    AM: 'Aguardando desempate ME/EPP', DM: 'Em desempate ME/EPP', A7: 'Aguardando desempate', D7: 'Em desempate',
    DF: 'Em disputa final', B3: 'Aguardando decisão sobre item de cota', JT: 'Aguardando julgamento de técnica',
    E: 'Aguardando julgamento', JE: 'Aguardando habilitação', HE: 'Aguardando adjudicação', PE: 'Aguardando encerramento',
    PR: 'Aguardando reabertura', JR: 'Julgamento/Habilitação reaberto', AR: 'Aberto para recursos', AC: 'Aberto para contrarrazões',
    D1: 'Aguardando decisão de recursos', D2: 'Aguardando revisão de decisão', AE: 'Apto para homologação',
  };
  const rotulo = (it) => {
    if (it?.homologado) return 'Homologado';
    const t = TERMINAL[String(it?.situacao ?? '')];
    if (t) return it?.fase === 'PE' || it?.fase === 'FE' ? t + ' (aguardando encerramento)' : t;
    return FASE[it?.fase] || it?.fase || 'Em andamento';
  };
  function token() {
    try { const t = localStorage.getItem('areaTrabalhoGovernoToken'); if (t && t.startsWith('eyJ')) return t; } catch {}
    try { for (const k of ['keycloak', '_keycloak', 'kcInstance']) if (window[k]?.token) return window[k].token; } catch {}
    return null;
  }
  const espera = (ms) => new Promise((r) => setTimeout(r, ms));
  return (async () => {
    const t = token();
    const hdrs = { Accept: 'application/json' };
    if (t) hdrs.Authorization = 'Bearer ' + t;
    const get = async (url) => {
      for (let tent = 0; tent < 3; tent++) {
        const r = await fetch(url, { credentials: 'include', headers: hdrs });
        if (r.status === 429) { await espera(2000 * (tent + 1)); continue; }
        if (!r.ok) return { erro: r.status };
        const raw = await r.json();
        return { dados: Array.isArray(raw) ? raw : (raw.content || raw.itens || raw.participantes || []) };
      }
      return { erro: 429 };
    };

    // Identificador da compra: o mesmo código (UASG+modalidade+número+ano); se não
    // servir, o do redirecionamento da ação da Área de Trabalho
    let id = idCompra;
    let primeira = id ? await get(FE + id + '/itens/em-selecao-fornecedores?tamanhoPagina=20&pagina=0') : { erro: 0 };
    if (primeira.erro && acaoUrl) {
      try {
        const r = await fetch('/comprasnet-area-trabalho' + acaoUrl, { credentials: 'include', headers: hdrs, redirect: 'follow' });
        const m = r.url.match(/(?:identificador|compra)=(\d{15,18})/) || (await r.text()).match(/(?:identificador|compra)[=:]["']?(\d{15,18})/);
        if (m) { id = m[1]; primeira = await get(FE + id + '/itens/em-selecao-fornecedores?tamanhoPagina=20&pagina=0'); }
      } catch {}
    }
    if (primeira.erro) return { ok: false, erro: 'itens: HTTP ' + primeira.erro };

    const brutos = [...primeira.dados];
    for (let pg = 1; primeira.dados.length === 20 && pg < 100; pg++) {
      const r = await get(FE + id + '/itens/em-selecao-fornecedores?tamanhoPagina=20&pagina=' + pg);
      if (r.erro || !r.dados.length) break;
      brutos.push(...r.dados);
      if (r.dados.length < 20) break;
      await espera(250);
    }
    const linha = (it, grupo) => ({
      numero_item: Number(it.numeroItem ?? it.numero),
      descricao: it.descricao ?? null,
      descricao_detalhada: it.descricaoDetalhada ?? null,
      unidade: it.unidadeFornecimento ?? it.unidadeMedida ?? null,
      quantidade: it.quantidadeSolicitada ?? it.quantidade ?? null,
      valor_estimado_unitario: it.valorEstimadoUnitario ?? it.valorEstimado ?? null,
      valor_estimado_total: it.valorEstimadoTotal ?? null,
      situacao: rotulo(it),
      homologado: !!it.homologado,
      lote: it.lote ?? it.numeroLote ?? null,
      grupo_numero: grupo,
    });
    const itens = brutos.map((it) => linha(it, null)).filter((x) => Number.isFinite(x.numero_item));
    // Grupos (número negativo): sub-itens
    for (const g of brutos.filter((it) => Number(it.numeroItem ?? it.numero) < 0)) {
      const n = Number(g.numeroItem ?? g.numero);
      const r = await get(FE + id + '/itens/em-selecao-fornecedores/' + n + '/itens-grupo?tamanhoPagina=100&pagina=0');
      if (!r.erro) itens.push(...r.dados.map((it) => linha(it, n)).filter((x) => Number.isFinite(x.numero_item)));
      await espera(250);
    }

    const pr = await get(FE + id + '/em-selecao-fornecedores/participantes?tamanhoPagina=200&pagina=0');
    const participantes = (pr.dados || []).map((p) => ({
      cnpj: p.identificacaoParticipante ?? p.cnpj ?? null, nome: p.nomeParticipante ?? p.nome ?? null,
      me_epp: !!p.declaracaoMeEpp, qtd_itens_selecao: p.qtdeTotalItensParaSelecao ?? null,
    })).filter((p) => p.cnpj);

    // Quem está em primeiro em cada item (antes de homologar, só o ComprasNet sabe)
    const vencedores = [];
    if (buscarVencedores) {
      for (const p of participantes) {
        for (let pg = 0; pg < 100; pg++) {
          const r = await get(FE + id + '/em-selecao-fornecedores/participantes/' + p.cnpj + '/itens?tamanhoPagina=20&melhorClassificado=true&pagina=' + pg);
          if (r.erro || !r.dados.length) break;
          for (const it of r.dados) {
            const num = Number(it.numero ?? it.numeroItem);
            if (!Number.isFinite(num)) continue;
            let unit = null, total = null;
            try {
              const v = it.propostaItem.valores;
              const neg = v.valorNegociado?.valorCalculado, prop = v.valorPropostaInicialOuLances?.valorCalculado;
              const calc = (neg?.valorUnitario ?? neg?.valorTotal) != null ? neg : prop;
              unit = calc?.valorUnitario ?? null; total = calc?.valorTotal ?? null;
            } catch {}
            const q = it.quantidadeSolicitada ?? it.quantidade ?? null;
            vencedores.push({ numero_item: num, vencedor_cnpj: p.cnpj, vencedor_nome: p.nome,
              valor_vencedor_unitario: unit, valor_vencedor_total: total ?? (unit != null && q != null ? unit * q : null) });
          }
          if (r.dados.length < 20) break;
        }
        await espera(300);
      }
    }
    return { ok: true, id, itens, participantes, vencedores };
  })();
}

// ── Envio ─────────────────────────────────────────────────────────────────────
let emCurso = false;

async function enviar(motivo, forcar = false) {
  if (emCurso) return { ok: false, erro: 'Já está enviando.' };
  const { envio = {}, config = {} } = await ler(['envio', 'config']);
  const intervalo = (config.intervaloH || INTERVALO_PADRAO_H) * 3600_000;
  const temPendentes = (envio.pendentes || []).length > 0;
  if (!forcar && !temPendentes && envio.ok && envio.fim && Date.now() - Date.parse(envio.fim) < intervalo) return { ok: true, pulado: true };

  const aba = await abaDoCnet();
  if (!aba) return { ok: false, erro: 'Abra a Área de Trabalho do ComprasNet (com login) e tente de novo.' };

  emCurso = true;
  const inicio = Date.now();
  await chrome.storage.local.set({ envio: { ...envio, emCurso: true, inicio: new Date().toISOString(), erro: null, log: [] } });
  selo('…', '#0ea5e9');
  const resumo = { motivo, processos: 0, detalhados: 0, itens: 0, participantes: 0, vencedores: 0, erros: [] };
  try {
    const sessao = await tokenDoApp();
    await logar('Lendo a Área de Trabalho do ComprasNet…');
    const lista = await naPagina(aba.id, cnetListar, [UASG]);
    if (!lista) throw new Error('A aba do ComprasNet não respondeu — recarregue a página (F5) e tente de novo.');
    if (lista.semLogin || (!lista.itens.length && !lista.temToken)) throw new Error('Faça login no ComprasNet (Área de Trabalho) e tente de novo.');
    if (!lista.itens.length) throw new Error('Nenhum processo da UASG ' + UASG + ' na Área de Trabalho' + (lista.erros.length ? ' (' + lista.erros[0] + ')' : '') + '.');
    resumo.processos = lista.itens.length;
    resumo.erros.push(...lista.erros);
    await logar(lista.itens.length + ' processo(s) da UASG ' + UASG + ' na Área de Trabalho');

    // O que o app já tem (para só detalhar o que mudou)
    const guardados = await supa('cnet_processos?select=identificacao,situacao,acao,id_compra&limit=5000');
    const antes = new Map((guardados || []).map((p) => [p.identificacao, p]));
    const comItens = new Set(((await supa('cnet_itens?select=identificacao&limit=20000')) || []).map((x) => x.identificacao));

    const agora = new Date().toISOString();
    await upsert('cnet_processos', lista.itens.map((it) => ({ ...it, sincronizado_em: agora })), 'identificacao');
    await logar('Lista enviada ao app');

    // Detalhar: em seleção de fornecedor (sempre), mais os encerrados que mudaram ou
    // ainda não têm itens no app; o que sobrar de uma vez anterior vem primeiro
    const fila = [];
    for (const it of lista.itens) {
      const ant = antes.get(it.identificacao);
      const finalizado = it.agrupamento !== 'Selecao do Fornecedor' && FINALIZADO.test(it.situacao);
      const mudou = !ant || ant.situacao !== it.situacao || ant.acao !== it.acao;
      if (!finalizado || mudou || !comItens.has(it.identificacao)) fila.push(it);
    }
    const pendentesAntes = new Set(envio.pendentes || []);
    fila.sort((a, b) => (pendentesAntes.has(b.identificacao) - pendentesAntes.has(a.identificacao)) ||
      ((a.agrupamento === 'Selecao do Fornecedor' ? 0 : 1) - (b.agrupamento === 'Selecao do Fornecedor' ? 0 : 1)));
    const idsDoApp = new Map((guardados || []).map((p) => [p.identificacao, p.id_compra]));

    const feitos = new Set();
    for (const it of fila) {
      if (Date.now() - inicio > TEMPO_MAX_MS) break;
      const idCompra = idsDoApp.get(it.identificacao) || idCompraDe(it.identificacao);
      const ativo = !FINALIZADO.test(it.situacao);
      try {
        const d = await naPagina(aba.id, cnetDetalhar, [idCompra, it.acao_url, ativo]);
        if (!d?.ok) { resumo.erros.push(it.identificacao + ': ' + (d?.erro || 'sem resposta')); feitos.add(it.identificacao); continue; }
        const quando = new Date().toISOString();
        // Vencedor de cada item junto com o item (um envio só)
        const venc = new Map(d.vencedores.map((v) => [v.numero_item, v]));
        const linhasItens = d.itens.map((x) => ({ identificacao: it.identificacao, ...x, ...(venc.get(x.numero_item) || {}), sincronizado_em: quando }));
        if (linhasItens.length) await upsert('cnet_itens', linhasItens, 'identificacao,numero_item');
        if (d.participantes.length) {
          await upsert('cnet_participantes', d.participantes.map((p) => ({ identificacao: it.identificacao, ...p, sincronizado_em: quando })), 'identificacao,cnpj');
        }
        resumo.detalhados++; resumo.itens += linhasItens.length; resumo.participantes += d.participantes.length; resumo.vencedores += venc.size;
        await logar(it.identificacao.replace(/ ?120630 - /, ' ') + ': ' + linhasItens.length + ' itens, ' + d.participantes.length + ' participantes');
      } catch (e) {
        resumo.erros.push(it.identificacao + ': ' + e.message);
        if (/login|permiss/i.test(e.message)) throw e;
      }
      feitos.add(it.identificacao);
    }
    const pendentes = fila.filter((it) => !feitos.has(it.identificacao)).map((it) => it.identificacao);
    resumo.pendentes = pendentes.length;

    await supa('processos_sync_log', {
      metodo: 'POST', prefer: 'return=minimal',
      corpo: { fonte: 'cnet', origem: 'extensao', usuario: sessao.uid, inicio: new Date(inicio).toISOString(), fim: new Date().toISOString(), ok: true, resumo },
    }).catch(() => {});
    await gravarEnvio({ emCurso: false, fim: new Date().toISOString(), ok: true, resumo, pendentes });
    selo(pendentes.length ? String(pendentes.length) : '✓', pendentes.length ? '#f59e0b' : '#16a34a');
    await logar('Pronto: ' + resumo.detalhados + ' processo(s) detalhado(s)' + (pendentes.length ? ', ' + pendentes.length + ' continuam no próximo envio' : ''));
    return { ok: true, resumo };
  } catch (e) {
    await gravarEnvio({ emCurso: false, fim: new Date().toISOString(), ok: false, erro: e.message, resumo });
    selo('!', '#dc2626');
    await logar('❌ ' + e.message);
    return { ok: false, erro: e.message };
  } finally {
    emCurso = false;
  }
}

// "Pregão Eletrônico 120630 - 90020/2026" → 12063005900202026 (o mesmo do app)
function idCompraDe(ident) {
  const m = String(ident || '').match(/^(.*?)\s*(\d{6})\s*-\s*(\d+)\/(\d{4})\s*$/);
  if (!m) return null;
  const mod = /^preg/i.test(ident) ? '05' : /^(dispensa|cota)/i.test(ident) ? '06' : /^concorr/i.test(ident) ? '03' : /^inexig/i.test(ident) ? '07' : null;
  return mod ? m[2] + mod + m[3].padStart(5, '0') + m[4] : null;
}

// ── Gatilhos ──────────────────────────────────────────────────────────────────
chrome.runtime.onInstalled.addListener(() => chrome.alarms.create('verificar', { periodInMinutes: 30 }));
chrome.runtime.onStartup.addListener(() => chrome.alarms.create('verificar', { periodInMinutes: 30 }));
chrome.alarms.onAlarm.addListener((a) => { if (a.name === 'verificar') enviar('automático').catch(() => {}); });

// Abriu/recarregou a Área de Trabalho: espera a página montar e envia (se for a hora)
chrome.tabs.onUpdated.addListener((tabId, mud, aba) => {
  if (mud.status !== 'complete' || !/cnetmobile\.estaleiro\.serpro\.gov\.br\/.*(seguro|area-trabalho)/.test(aba.url || '')) return;
  setTimeout(() => enviar('ComprasNet aberto').catch(() => {}), 8000);
});

chrome.runtime.onMessage.addListener((m, _s, responder) => {
  if (m?.tipo === 'ENTRAR') { entrar(m.email, m.senha).then((s) => responder({ ok: true, nome: s.nome, setor: s.setor }), (e) => responder({ ok: false, erro: e.message })); return true; }
  if (m?.tipo === 'SAIR') { chrome.storage.local.remove(['sessao']).then(() => responder({ ok: true })); return true; }
  if (m?.tipo === 'ENVIAR_AGORA') { enviar('manual', true).then(responder); return true; }
});

// Para os testes
self.__processosAoVivo = { enviar, idCompraDe, cnetListar, cnetDetalhar };
