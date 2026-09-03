const _ext = typeof browser !== 'undefined' ? browser : chrome;

// Mapeamento completo de códigos de situação de item do ComprasNet
const SITUACAO_ITEM = {
  '1': 'Em Seleção',
  '2': 'Adjudicado',
  '3': 'Homologado',
  '4': 'Cancelado',
  '5': 'Fracassado',
  '6': 'Deserto',
  '7': 'Revogado',
  '8': 'Encerrado',
  '9': 'Suspenso',
};
const _rt  = _ext.runtime;

const CNET_URL  = 'https://cnetmobile.estaleiro.serpro.gov.br/comprasnet-area-trabalho-web/seguro/governo/area-trabalho';
const SUPA_URL  = 'https://fychrtyyqbzlfbzbvzqp.supabase.co';
const SUPA_KEY  = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZ5Y2hydHl5cWJ6bGZiemJ2enFwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzA5Mzk5NzcsImV4cCI6MjA4NjUxNTk3N30.i27qaCYX9qZ6liL9iXaOtYgddWgKyiM5eoobIN1loFw';

let allItems       = [];
let filtroAtivo    = 'todos';
let currentTab     = null;  // ComprasNet tab used for scripting
let authToken      = null;  // raw JWT (without "Bearer " prefix)
let detalheId      = null;  // identificador resolved for current detail view
let detalhamentosMap = {};  // { itemNum → descricaoDetalhada } — populated when process detail loads
let detalheProcesso  = null; // processo atual no detalhe (objeto da lista)
let detalheItens     = [];   // itens carregados no detalhe atual

// ── GAPMN Auth ────────────────────────────────────────────────────────────────

const VALID_ROLES = new Set(['SEO', 'SLIC', 'SCON', 'ADMIN', 'DEV']);
let hasCnetData  = false;
let gapmn_token  = null;
let gapmn_user   = null; // { nome, setor }

function updateSyncBtn() {
  document.getElementById('btn-app-sync').style.display =
    (hasCnetData && gapmn_user) ? 'inline-block' : 'none';
}

function updateAuthUI() {
  const status    = document.getElementById('auth-status');
  const btnConn   = document.getElementById('btn-auth-connect');
  const btnLogout = document.getElementById('btn-auth-logout');
  if (gapmn_user) {
    status.textContent = '✅ ' + gapmn_user.nome + ' · ' + gapmn_user.setor;
    status.style.color = '#34d399';
    btnConn.style.display   = 'none';
    btnLogout.style.display = 'inline-block';
  } else {
    status.textContent = '🔐 Desconectado';
    status.style.color = '#f87171';
    btnConn.style.display   = 'inline-block';
    btnLogout.style.display = 'none';
  }
  updateSyncBtn();
}

async function gapmn_getUserFromToken(token) {
  const ur = await fetch(SUPA_URL + '/auth/v1/user', {
    headers: { 'Authorization': 'Bearer ' + token, 'apikey': SUPA_KEY },
  });
  if (!ur.ok) return null;
  const userData = await ur.json();
  const userId = userData.id;
  const pr = await fetch(
    SUPA_URL + '/rest/v1/profiles?select=setor,nome_guerra&id=eq.' + userId + '&limit=1',
    { headers: { 'Authorization': 'Bearer ' + token, 'apikey': SUPA_KEY, 'Accept': 'application/json' } }
  );
  if (!pr.ok) return null;
  const profiles = await pr.json();
  const setor = (profiles[0]?.setor ?? '').trim().toUpperCase();
  if (!VALID_ROLES.has(setor)) return null;
  return { nome: profiles[0]?.nome_guerra ?? 'Usuário', setor };
}

async function gapmn_checkAuth() {
  const stored = await _ext.storage.local.get(['gapmn_token', 'gapmn_refresh']);
  if (!stored.gapmn_token) return false;
  let user = await gapmn_getUserFromToken(stored.gapmn_token).catch(() => null);
  if (!user && stored.gapmn_refresh) {
    try {
      const r = await fetch(SUPA_URL + '/auth/v1/token?grant_type=refresh_token', {
        method: 'POST',
        headers: { 'apikey': SUPA_KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify({ refresh_token: stored.gapmn_refresh }),
      });
      if (r.ok) {
        const d = await r.json();
        await _ext.storage.local.set({ gapmn_token: d.access_token, gapmn_refresh: d.refresh_token });
        gapmn_token = d.access_token;
        user = await gapmn_getUserFromToken(d.access_token).catch(() => null);
      }
    } catch {}
  }
  if (user) { gapmn_token = gapmn_token || stored.gapmn_token; gapmn_user = user; return true; }
  await _ext.storage.local.remove(['gapmn_token', 'gapmn_refresh']);
  return false;
}

async function gapmn_login(email, password) {
  const r = await fetch(SUPA_URL + '/auth/v1/token?grant_type=password', {
    method: 'POST',
    headers: { 'apikey': SUPA_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const d = await r.json();
  if (!r.ok) throw new Error(d.error_description || d.message || 'Credenciais inválidas.');
  await _ext.storage.local.set({ gapmn_token: d.access_token, gapmn_refresh: d.refresh_token });
  const user = await gapmn_getUserFromToken(d.access_token);
  if (!user) throw new Error('Usuário sem perfil autorizado (SEO, SLIC, SCON, ADMIN ou DEV).');
  gapmn_token = d.access_token;
  gapmn_user  = user;
}

async function gapmn_logout() {
  await _ext.storage.local.remove(['gapmn_token', 'gapmn_refresh']);
  gapmn_token = null;
  gapmn_user  = null;
  updateAuthUI();
}

// ── Bootstrap ─────────────────────────────────────────────────────────────────

(async () => {
  const isWindow = new URLSearchParams(location.search).has('w');
  if (!isWindow) {
    const win = await _ext.windows.create({
      url: _rt.getURL('popup.html?w=1'),
      type: 'popup', width: 1000, height: 720, focused: true,
    });
    setTimeout(() => {
      if (win?.id != null) _ext.windows.update(win.id, { focused: true });
    }, 150);
    window.close();
    return;
  }

  // Auth listeners
  document.getElementById('btn-auth-connect').addEventListener('click', () => {
    document.getElementById('login-email').value    = '';
    document.getElementById('login-password').value = '';
    document.getElementById('login-error').style.display = 'none';
    document.getElementById('login-modal').classList.add('open');
  });
  document.getElementById('btn-auth-logout').addEventListener('click', gapmn_logout);
  document.getElementById('btn-login-cancel').addEventListener('click', () => {
    document.getElementById('login-modal').classList.remove('open');
  });
  document.getElementById('btn-login-confirm').addEventListener('click', async () => {
    const email    = document.getElementById('login-email').value.trim();
    const password = document.getElementById('login-password').value;
    const errEl    = document.getElementById('login-error');
    const btn      = document.getElementById('btn-login-confirm');
    errEl.style.display = 'none';
    btn.disabled = true; btn.textContent = 'Entrando…';
    try {
      await gapmn_login(email, password);
      document.getElementById('login-modal').classList.remove('open');
      updateAuthUI();
    } catch (e) {
      errEl.textContent = e.message;
      errEl.style.display = 'block';
    } finally {
      btn.disabled = false; btn.textContent = 'Entrar';
    }
  });
  // Allow Enter key in password field
  document.getElementById('login-password').addEventListener('keydown', e => {
    if (e.key === 'Enter') document.getElementById('btn-login-confirm').click();
  });

  // Other listeners
  document.getElementById('btn-close').addEventListener('click', () => window.close());
  document.getElementById('btn-sync').addEventListener('click', sincronizar);
  document.getElementById('btn-app-sync').addEventListener('click', sincronizarApp);
  document.getElementById('btn-back').addEventListener('click', mostrarLista);
  document.getElementById('btn-xls').addEventListener('click', exportarProcessoXLS);
  document.querySelectorAll('.chip').forEach(chip => {
    chip.addEventListener('click', () => {
      document.querySelectorAll('.chip').forEach(c => c.classList.remove('ativo'));
      chip.classList.add('ativo');
      filtroAtivo = chip.dataset.sit;
      renderTable();
    });
  });

  // Check GAPMN auth on load (restores session from storage)
  await gapmn_checkAuth();
  updateAuthUI();
})();

// ── cnetFetch — runs in MAIN world of ComprasNet tab ─────────────────────────

function cnetFetch() {
  const BASE = '/comprasnet-area-trabalho';

  function getToken() {
    try {
      const direct = localStorage.getItem('areaTrabalhoGovernoToken');
      if (direct && direct.startsWith('eyJ')) return { source: 'localStorage.areaTrabalhoGovernoToken', token: direct };
    } catch {}

    try {
      if (window.keycloak && window.keycloak.token) return { source: 'window.keycloak', token: window.keycloak.token };
      if (window._keycloak && window._keycloak.token) return { source: 'window._keycloak', token: window._keycloak.token };
      if (window.kcInstance && window.kcInstance.token) return { source: 'window.kcInstance', token: window.kcInstance.token };
    } catch {}

    try {
      for (const key of Object.keys(window)) {
        try {
          const obj = window[key];
          if (obj && typeof obj === 'object' && typeof obj.token === 'string' && obj.token.startsWith('eyJ')) {
            return { source: 'window.' + key + '.token', token: obj.token };
          }
        } catch {}
      }
    } catch {}

    function extractJWT(val) {
      if (typeof val === 'string') {
        if (val.startsWith('eyJ')) return val;
        if (val.startsWith('{') || val.startsWith('[')) {
          try { return extractJWT(JSON.parse(val)); } catch {}
        }
        return null;
      }
      if (Array.isArray(val)) {
        for (const v of val) { const t = extractJWT(v); if (t) return t; }
        return null;
      }
      if (val && typeof val === 'object') {
        for (const prio of ['access_token', 'token', 'jwt', 'bearer', 'id_token', 'accessToken']) {
          if (val[prio]) { const t = extractJWT(val[prio]); if (t) return t; }
        }
        for (const k of Object.keys(val)) { const t = extractJWT(val[k]); if (t) return t; }
      }
      return null;
    }

    for (const store of [sessionStorage, localStorage]) {
      for (let i = 0; i < store.length; i++) {
        const key = store.key(i) || '';
        const raw = store.getItem(key) || '';
        const jwt = extractJWT(raw);
        if (jwt) return { source: (store === localStorage ? 'localStorage' : 'sessionStorage') + '.' + key, token: jwt };
      }
    }

    return null;
  }

  async function get(path, authHeader) {
    const headers = { Accept: 'application/json, text/plain, */*' };
    if (authHeader) headers['Authorization'] = authHeader;
    const r = await fetch(BASE + path, { credentials: 'include', headers });
    if (r.status !== 200 && r.status !== 206) {
      let body = '';
      try { body = await r.text(); } catch {}
      throw new Error('HTTP ' + r.status + (body ? ' | ' + body.slice(0, 120) : ''));
    }
    return r.json();
  }

  async function fetchGroup(id, authHeader) {
    const rows = [];
    for (let pg = 0; ; pg++) {
      const qs = 'size=100&page=' + pg
        + '&somenteFavoritos=false&comPendencia=false'
        + '&sobMinhaResponsabilidade=false&avisosAlice=false'
        + '&etapas=&itensTrabelho=&ultimosDias=0'
        + '&dataInicial=&dataFinal=&filtroUasg=';
      const raw = await get('/v2/agrupamento/' + id + '/itemtrabalho?' + qs, authHeader);
      // API can return either a plain array or a Spring Page object { content: [...] }
      const page = Array.isArray(raw) ? raw : (raw.content || raw.itens || raw.data || []);
      if (!page.length) break;
      rows.push(...page);
      if (page.length < 100) break;
    }
    return rows;
  }

  return (async () => {
    const authInfo = getToken();
    const authHeader = authInfo ? 'Bearer ' + authInfo.token : null;

    const grupos = [
      { id: 2, nome: 'Selecao do Fornecedor' },
      { id: 3, nome: 'Compras Finalizadas' },
      { id: 4, nome: 'Grupo 4' },
      { id: 5, nome: 'Grupo 5' },
      { id: 6, nome: 'Grupo 6' },
    ];

    const items = [];
    const erros = [];

    for (const g of grupos) {
      try {
        const rows = await fetchGroup(g.id, authHeader);
        if (!rows.length) continue;
        for (const it of rows) {
          const m = (it.identificacao || '').match(/(\d+)\/(\d{4})$/);
          items.push({
            id:              it.idItemTrabalho,
            identificacao:   it.identificacao || '',
            numero:          m ? m[1] : '',
            ano:             m ? m[2] : '',
            situacao:        it.situacao || '',
            acao:            it.acao ? (it.acao.nome || '') : '',
            acaoUrl:         it.acao ? (it.acao.url || '') : '',
            possuiPendencia: it.sinalizador ? (it.sinalizador.possuiPendencia || false) : false,
            agrupamento:     g.nome,
          });
        }
      } catch (e) {
        if (!e.message.includes('HTTP 404') && !e.message.includes('HTTP 422')) erros.push(g.nome + ': ' + e.message);
      }
    }

    return {
      ok: true, items, erros,
      authSource: authInfo ? authInfo.source : 'NENHUM',
      authToken:  authInfo ? authInfo.token  : null,
    };
  })();
}

// ── cnetResolveIdentificador — resolve identificador from action URL only

function cnetResolveIdentificador(acaoUrl, rawToken) {
  const BASE_AT = '/comprasnet-area-trabalho';
  const hdrs = { Accept: 'application/json, text/plain, */*' };
  if (rawToken) hdrs['Authorization'] = 'Bearer ' + rawToken;

  return (async () => {
    try {
      const redir = await fetch(BASE_AT + acaoUrl, {
        credentials: 'include', headers: hdrs, redirect: 'follow',
      });

      let identificador = (redir.url.match(/identificador=(\d+)/) || [])[1];

      if (!identificador) {
        try {
          const body = await redir.clone().json();
          identificador = body.identificador || body.idCompra || body.id || null;
          if (identificador) identificador = String(identificador);
          if (!identificador) {
            const s = JSON.stringify(body);
            const m = s.match(/"(?:identificador|idCompra)":\s*"?(\d{15,18})"?/)
                   || s.match(/identificador=(\d{15,18})/);
            if (m) identificador = m[1];
          }
        } catch {}
      }

      if (!identificador) {
        try {
          const txt = await redir.text();
          const m = txt.match(/identificador[=:]["']?(\d{15,18})["']?/)
                 || txt.match(/\/compras\/(\d{15,18})\//)
                 || txt.match(/"(?:id|idCompra|compraId)":\s*"?(\d{15,18})"?/);
          if (m) identificador = m[1];
        } catch {}
      }

      if (!identificador)
        return { ok: false, error: 'identificador não encontrado. URL: ' + redir.url.slice(0, 200) };

      return { ok: true, identificador };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  })();
}

// ── cnetFetchItensPage — fetches ONE page of items (one executeScript per call)

function cnetFetchItensPage(identificador, page, rawToken) {
  const BASE_FE = '/comprasnet-fase-externa';
  const hdrs = { Accept: 'application/json, text/plain, */*' };
  if (rawToken) hdrs['Authorization'] = 'Bearer ' + rawToken;

  return (async () => {
    try {
      const r = await fetch(
        BASE_FE + '/v1/compras/' + identificador
          + '/itens/em-selecao-fornecedores?tamanhoPagina=20&pagina=' + page,
        { credentials: 'include', headers: hdrs }
      );
      if (!r.ok) {
        let body = ''; try { body = await r.text(); } catch {}
        return { ok: false, status: r.status, error: 'HTTP ' + r.status + (body ? ' | ' + body.slice(0, 100) : '') };
      }
      const raw = await r.json();
      const items = Array.isArray(raw) ? raw : (raw.content || raw.itens || []);
      return { ok: true, items };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  })();
}

// ── cnetFetchItensGrupo — busca sub-itens de um grupo/lote ──────────────────────
// Tenta múltiplos endpoints pois a estrutura varia por tipo de processo

function cnetFetchItensGrupo(identificador, loteNum, grupoId, rawToken) {
  const BASE_FE = '/comprasnet-fase-externa';
  const hdrs = { Accept: 'application/json, text/plain, */*' };
  if (rawToken) hdrs['Authorization'] = 'Bearer ' + rawToken;
  const absNum = Math.abs(Number(loteNum));
  // grupoId é o identificador do grupo na API (ex: "G1", "G2")
  const gid = grupoId || ('G' + absNum);

  return (async () => {
    // Endpoint correto descoberto via DevTools:
    // /itens/em-selecao-fornecedores/{numeroGrupo}/itens-grupo
    // onde numeroGrupo é o numero negativo do item de grupo (ex: -1)
    const candidates = [
      BASE_FE + '/v1/compras/' + identificador + '/itens/em-selecao-fornecedores/' + loteNum + '/itens-grupo?tamanhoPagina=100&pagina=0',
      // Fallbacks caso o processo use estrutura diferente
      BASE_FE + '/v1/compras/' + identificador + '/grupos/' + gid + '/itens/em-selecao-fornecedores?tamanhoPagina=100&pagina=0',
      BASE_FE + '/v1/compras/' + identificador + '/grupos/' + gid + '/itens?tamanhoPagina=100&pagina=0',
      BASE_FE + '/v1/compras/' + identificador + '/itens/em-selecao-fornecedores?identificadorGrupo=' + gid + '&tamanhoPagina=100&pagina=0',
      BASE_FE + '/v1/compras/' + identificador + '/itens/em-selecao-fornecedores?tamanhoPagina=100&pagina=0&lote=' + absNum,
      BASE_FE + '/v1/compras/' + identificador + '/lotes/' + absNum + '/itens?tamanhoPagina=100&pagina=0',
    ];
    for (const url of candidates) {
      try {
        const r = await fetch(url, { credentials: 'include', headers: hdrs });
        if (!r.ok) continue;
        const raw = await r.json();
        const items = Array.isArray(raw) ? raw : (raw.content || raw.itens || raw.data || []);
        if (items.length > 0) return { ok: true, items, url };
      } catch {}
    }
    return { ok: false, error: 'Nenhum endpoint retornou sub-itens para grupo ' + gid };
  })();
}

// ── cnetFetchDetalhamento — single item description (lazy, avoids timeout)

function cnetFetchDetalhamento(identificador, numItem, rawToken) {
  const BASE_FE = '/comprasnet-fase-externa';
  const hdrs = { Accept: 'application/json, text/plain, */*' };
  if (rawToken) hdrs['Authorization'] = 'Bearer ' + rawToken;
  return (async () => {
    try {
      const r = await fetch(
        BASE_FE + '/v1/compras/' + identificador + '/itens/' + numItem + '/detalhamento',
        { credentials: 'include', headers: hdrs }
      );
      if (!r.ok) return { ok: false };
      const data = await r.json();
      return { ok: true, data };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  })();
}

// ── cnetFetchItensParticipante — itens ganhos e não ganhos por um fornecedor

function cnetFetchItensParticipante(identificador, cnpj, rawToken) {
  const BASE_FE = '/comprasnet-fase-externa';
  const authHeader = rawToken ? 'Bearer ' + rawToken : null;
  const hdrs = { Accept: 'application/json, text/plain, */*' };
  if (authHeader) hdrs['Authorization'] = authHeader;

  async function fetchAllPages(baseUrl, flag) {
    const PS = 20, all = [];
    for (let pg = 0; pg <= 500; pg++) {
      const r = await fetch(baseUrl + '&melhorClassificado=' + flag + '&pagina=' + pg, { credentials: 'include', headers: hdrs });
      if (!r.ok) break;
      const raw = await r.json();
      const page = Array.isArray(raw) ? raw : (raw.content || []);
      all.push(...page);
      if (!page.length || page.length < PS) break;
    }
    return all;
  }

  return (async () => {
    try {
      const base = BASE_FE + '/v1/compras/' + identificador
        + '/em-selecao-fornecedores/participantes/' + cnpj + '/itens?tamanhoPagina=20';
      const [ganhos, naoGanhos] = await Promise.all([
        fetchAllPages(base, 'true'),
        fetchAllPages(base, 'false'),
      ]);
      return { ok: true, ganhos, naoGanhos };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  })();
}

// ── cnetFetchParticipantes — runs in MAIN world, fetches suppliers for one item

function cnetFetchParticipantes(identificador, _itemNum, rawToken) {
  const BASE_FE = '/comprasnet-fase-externa';
  const authHeader = rawToken ? 'Bearer ' + rawToken : null;
  const hdrs = { Accept: 'application/json, text/plain, */*' };
  if (authHeader) hdrs['Authorization'] = authHeader;

  return (async () => {
    try {
      const url = BASE_FE + '/v1/compras/' + identificador
        + '/em-selecao-fornecedores/participantes?tamanhoPagina=200&pagina=0';
      const resp = await fetch(url, { credentials: 'include', headers: hdrs });
      if (!resp.ok) {
        let body = ''; try { body = await resp.text(); } catch {}
        return { ok: false, error: 'HTTP ' + resp.status + (body ? ' | ' + body.slice(0, 100) : '') };
      }
      const raw = await resp.json();
      const participantes = Array.isArray(raw) ? raw
        : (raw.content || raw.participantes || []);
      return { ok: true, participantes, _debugParticipante: JSON.stringify(participantes[0] || {}) };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  })();
}

// ── Sincronizar (process list from ComprasNet) ────────────────────────────────

async function sincronizar() {
  const btn = document.getElementById('btn-sync');
  btn.disabled = true;
  setMsg('🔍 Procurando aba do ComprasNet…');

  const tabs = await _ext.tabs.query({ url: '*://cnetmobile.estaleiro.serpro.gov.br/*' });
  if (!tabs.length) {
    setMsg('⚠ Nenhuma aba do ComprasNet aberta. Clique em <b>Abrir ComprasNet</b>, faça login e tente novamente.');
    btn.disabled = false;
    return;
  }

  currentTab = tabs[0];
  setMsg('⏳ Executando busca na aba do ComprasNet…');

  try {
    const [result] = await _ext.scripting.executeScript({
      target: { tabId: currentTab.id },
      func: cnetFetch,
      world: 'MAIN',
    });

    const data = result?.result;
    if (!data) throw new Error('Script não retornou dados — recarregue a extensão.');

    allItems  = data.items || [];
    authToken = data.authToken || null;

    let msg = '';
    if (allItems.length > 0) {
      msg = '✅ ' + allItems.length + ' processo(s) carregados · Clique em uma linha para ver detalhes';
      if (data.erros?.length) msg += ' · <span style="color:#f87171">' + data.erros.join(' | ') + '</span>';
    } else {
      const authLine = 'Token: <b>' + (data.authSource || 'NENHUM') + '</b>';
      const erroLine = data.erros?.length
        ? '<br><span style="color:#f87171">Erro: ' + data.erros[0] + '</span>'
        : '';
      msg = '⚠ ' + authLine + erroLine;
    }

    setMsg(msg);

    if (allItems.length) {
      hasCnetData = true;
      updateSyncBtn();
      renderTable();
    }
  } catch (e) {
    setMsg('❌ ' + e.message);
  }
  btn.disabled = false;
}

// ── Sincronizar com App (upsert to Supabase) ──────────────────────────────────

async function supaUpsert(table, payload, token) {
  const r = await fetch(SUPA_URL + '/rest/v1/' + table, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'apikey': SUPA_KEY,
      'Authorization': 'Bearer ' + (token || SUPA_KEY),
      'Prefer': 'resolution=merge-duplicates',
    },
    body: JSON.stringify(payload),
  });
  if (!r.ok) { const b = await r.text(); throw new Error(table + ' ' + r.status + ': ' + b.slice(0, 120)); }
  return r;
}

async function autoSyncItens(identificacao, itens, grupoNumero = null) {
  if (!gapmn_token || !itens.length) return;
  const payload = itens.map(it => ({
    identificacao,
    numero_item:             it.numeroItem ?? it.numero ?? null,
    descricao:               it.descricao ?? null,
    descricao_detalhada:     it.descricaoDetalhada ?? null,
    unidade:                 it.unidadeFornecimento ?? it.unidadeMedida ?? null,
    quantidade:              it.quantidadeSolicitada ?? it.quantidade ?? null,
    valor_estimado_unitario: it.valorEstimadoUnitario ?? it.valorEstimado ?? null,
    valor_estimado_total:    it.valorEstimadoTotal ?? null,
    situacao:                it.homologado ? 'Homologado' : (SITUACAO_ITEM[String(it.situacao ?? '')] ?? String(it.situacao ?? '')),
    homologado:              it.homologado ?? false,
    lote:                    it.lote ?? it.numeroLote ?? null,
    grupo_numero:            grupoNumero,
    sincronizado_em:         new Date().toISOString(),
  })).filter(r => r.numero_item != null);
  try { await supaUpsert('cnet_itens', payload, gapmn_token); } catch {}
}

async function autoSyncParticipantes(identificacao, participantes) {
  if (!gapmn_token || !participantes.length) return;
  const payload = participantes.map(p => ({
    identificacao,
    cnpj:              p.identificacaoParticipante ?? p.cnpj ?? null,
    nome:              p.nomeParticipante ?? p.nome ?? null,
    me_epp:            p.declaracaoMeEpp ?? false,
    qtd_itens_selecao: p.qtdeTotalItensParaSelecao ?? null,
    sincronizado_em:   new Date().toISOString(),
  })).filter(r => r.cnpj);
  try { await supaUpsert('cnet_participantes', payload, gapmn_token); } catch {}
}

// Sincroniza vencedor por item — usa função inline + URL absoluta (mesma abordagem
// do exportarProcessoXLS, que funciona para processos em qualquer fase)
async function autoSyncVencedores(identificacao, identificadorInterno, participantes, tabId, token) {
  if (!gapmn_token || !participantes.length) return;

  try {
    const [res] = await _ext.scripting.executeScript({
      target: { tabId },
      world: 'MAIN',
      func: async (compraId, parts, rawToken) => {
        const BASE = 'https://cnetmobile.estaleiro.serpro.gov.br/comprasnet-fase-externa';
        const hdrs = { 'Authorization': 'Bearer ' + rawToken, 'Accept': 'application/json' };
        const map = {};
        const PS = 20;
        await Promise.all(parts.map(async (p) => {
          const cnpj = p.identificacaoParticipante ?? p.cnpj;
          const nome = p.nomeParticipante ?? p.nome ?? null;
          if (!cnpj) return;
          for (let pg = 0; pg <= 500; pg++) {
            try {
              const r = await fetch(
                BASE + '/v1/compras/' + compraId
                  + '/em-selecao-fornecedores/participantes/' + cnpj
                  + '/itens?tamanhoPagina=20&melhorClassificado=true&pagina=' + pg,
                { credentials: 'include', headers: hdrs }
              );
              if (!r.ok) break;
              const raw = await r.json();
              const page = Array.isArray(raw) ? raw : (raw.content || []);
              for (const it of page) {
                const num = it.numero ?? it.numeroItem;
                if (num == null) continue;
                let vlrUnit = null, vlrTotal = null;
                try {
                  const calc = it.propostaItem.valores.valorPropostaInicialOuLances.valorCalculado;
                  vlrUnit  = calc.valorUnitario ?? null;
                  vlrTotal = calc.valorTotal    ?? null;
                } catch {}
                map[num] = { cnpj, nome, vlrUnit, vlrTotal,
                  qtde: it.quantidadeSolicitada ?? it.quantidade ?? null };
              }
              if (!page.length || page.length < PS) break;
            } catch { break; }
          }
        }));
        return map;
      },
      args: [identificadorInterno, participantes, token],
    });

    const itemWinnerMap = res?.result ?? {};
    const updates = Object.entries(itemWinnerMap).map(([num, w]) => ({
      identificacao,
      numero_item:             Number(num),
      vencedor_cnpj:           w.cnpj,
      vencedor_nome:           w.nome,
      valor_vencedor_unitario: w.vlrUnit,
      valor_vencedor_total:    w.vlrTotal ?? (w.vlrUnit != null && w.qtde != null ? w.vlrUnit * w.qtde : null),
    }));

    if (updates.length) {
      await supaUpsert('cnet_itens', updates, gapmn_token);
      setMsg('✅ Vencedores: ' + updates.length + ' itens — ' + identificacao);
    } else {
      setMsg('⚠ Sem vencedores via API: ' + identificacao + ' (' + participantes.length + ' forn.)');
    }
  } catch (e) {
    setMsg('❌ Vencedores ERRO (' + identificacao + '): ' + e.message.slice(0, 80));
  }
}

// Busca estado atual dos processos no Supabase para comparação incremental
async function fetchStoredProcessos() {
  try {
    const r = await fetch(
      SUPA_URL + '/rest/v1/cnet_processos?select=identificacao,situacao,acao&limit=2000',
      { headers: { 'apikey': SUPA_KEY, 'Authorization': 'Bearer ' + gapmn_token, 'Accept': 'application/json' } }
    );
    if (!r.ok) return new Map();
    const data = await r.json();
    const map = new Map();
    for (const p of data) map.set(p.identificacao, { situacao: p.situacao, acao: p.acao });
    return map;
  } catch { return new Map(); }
}

// Busca identificacoes que já têm pelo menos 1 item com vencedor_cnpj populado
async function fetchProcessosComVencedor() {
  try {
    const r = await fetch(
      SUPA_URL + '/rest/v1/cnet_itens?select=identificacao&vencedor_cnpj=not.is.null&limit=5000',
      { headers: { 'apikey': SUPA_KEY, 'Authorization': 'Bearer ' + gapmn_token, 'Accept': 'application/json' } }
    );
    if (!r.ok) return new Set();
    const data = await r.json();
    const s = new Set();
    for (const row of data) s.add(row.identificacao);
    return s;
  } catch { return new Set(); }
}

async function sincronizarApp() {
  if (!allItems.length) {
    setMsg('⚠ Sincronize primeiro com o ComprasNet.');
    return;
  }
  if (!currentTab || !authToken) {
    setMsg('⚠ Nenhuma aba do ComprasNet ativa. Clique em Sincronizar primeiro.');
    return;
  }

  const btn     = document.getElementById('btn-app-sync');
  const btnSync = document.getElementById('btn-sync');
  btn.disabled = true; btnSync.disabled = true;

  try {
    const agora = new Date().toISOString();

    // ── 0. Busca estado anterior ANTES de atualizar (para diff incremental) ──
    setMsg('⏳ Verificando processos já sincronizados…');
    const storedMap = await fetchStoredProcessos();
    const temVencedorSet = await fetchProcessosComVencedor();

    // ── 1. Lista de processos ────────────────────────────────────────────────
    setMsg('⏳ Enviando lista de ' + allItems.length + ' processos…');
    await supaUpsert('cnet_processos', allItems.map(it => ({
      id:               it.id,
      identificacao:    it.identificacao,
      numero:           it.numero,
      ano:              it.ano,
      situacao:         it.situacao,
      acao:             it.acao,
      acao_url:         it.acaoUrl || '',
      possui_pendencia: it.possuiPendencia,
      agrupamento:      it.agrupamento,
      sincronizado_em:  agora,
    })), gapmn_token);

    // ── 2. Itens + Fornecedores — apenas processos que mudaram ───────────────
    const FINALIZADO = /homolog|cancel|fracass|desert|revog|anulad/i;
    const comUrl   = allItems.filter(it => it.acaoUrl);
    const PAGE_SIZE = 20;
    let itensTotal = 0;
    let partTotal  = 0;
    let procOk     = 0;
    let skipped    = 0;

    for (let i = 0; i < comUrl.length; i++) {
      const proc = comUrl[i];

      // Pula processos finalizados cujo estado não mudou E que já têm vencedor populado
      const finalizado = FINALIZADO.test(proc.situacao || '');
      if (finalizado) {
        const stored = storedMap.get(proc.identificacao);
        const temVencedor = temVencedorSet.has(proc.identificacao);
        if (stored && stored.situacao === proc.situacao && stored.acao === proc.acao && temVencedor) {
          skipped++;
          continue;
        }
      }

      setMsg(
        '⏳ Itens ' + (i + 1) + '/' + comUrl.length + ' — ' + proc.identificacao +
        ' &nbsp;·&nbsp; <span style="color:#34d399">' + itensTotal + ' itens · ' + partTotal + ' forn.</span>' +
        (skipped ? ' &nbsp;<span style="color:#64748b">(' + skipped + ' sem alteração)</span>' : '')
      );

      try {
        // 2a. Resolve identificador
        const [rr] = await _ext.scripting.executeScript({
          target: { tabId: currentTab.id },
          func: cnetResolveIdentificador,
          args: [proc.acaoUrl, authToken],
          world: 'MAIN',
        });
        const rd = rr?.result;
        if (!rd?.ok) continue;
        const identificador = rd.identificador;

        // 2b. Itens — todas as páginas
        const procItens = [];
        let retries = 0;
        for (let pg = 0; pg <= 500; pg++) {
          if (pg > 0) await new Promise(r => setTimeout(r, 400));
          const [pr] = await _ext.scripting.executeScript({
            target: { tabId: currentTab.id },
            func: cnetFetchItensPage,
            args: [identificador, pg, authToken],
            world: 'MAIN',
          });
          const pd = pr?.result;
          if (!pd?.ok && pd?.status === 429) {
            if (retries >= 3) break;
            retries++;
            setMsg('⏳ Rate limit — aguardando ' + (retries * 2) + 's… (' + proc.identificacao + ')');
            await new Promise(r => setTimeout(r, retries * 2000));
            pg--; continue;
          }
          retries = 0;
          if (!pd?.ok || !pd.items) break;
          procItens.push(...pd.items);
          if (!pd.items.length || pd.items.length < PAGE_SIZE) break;
        }

        if (procItens.length) {
          await autoSyncItens(proc.identificacao, procItens);
          itensTotal += procItens.length;

          // 2b-extra: Para cada grupo (numeroItem < 0), busca sub-itens e sincroniza
          const grupos = procItens.filter(it => {
            const n = it.numeroItem ?? it.numero;
            return (typeof n === 'number' && n < 0) ||
              (String(n ?? '').startsWith('-')) ||
              (it.valorEstimadoUnitario == null && it.valorEstimadoTotal != null);
          });
          for (const grupo of grupos) {
            const loteNum = grupo.numeroItem ?? grupo.numero;
            const grupoId = grupo.identificador ?? null;
            try {
              const [gr] = await _ext.scripting.executeScript({
                target: { tabId: currentTab.id },
                func: cnetFetchItensGrupo,
                args: [identificador, loteNum, grupoId, authToken],
                world: 'MAIN',
              });
              const gd = gr?.result;
              if (gd?.ok && gd.items?.length) {
                await autoSyncItens(proc.identificacao, gd.items, Number(loteNum));
                itensTotal += gd.items.length;
              }
              await new Promise(r => setTimeout(r, 300));
            } catch {}
          }
        }

        // 2c. Fornecedores
        await new Promise(r => setTimeout(r, 400));
        const [partRes] = await _ext.scripting.executeScript({
          target: { tabId: currentTab.id },
          func: cnetFetchParticipantes,
          args: [identificador, null, authToken],
          world: 'MAIN',
        });
        const pp = partRes?.result;
        if (pp?.ok && pp.participantes?.length) {
          await autoSyncParticipantes(proc.identificacao, pp.participantes);
          partTotal += pp.participantes.length;

          // Sincroniza vencedor por item para todos os processos ativos (não cancelados)
          const isCancelled = /cancel|fracass|desert|revog|anulad/i.test(proc.situacao || '');
          if (!isCancelled) {
            await autoSyncVencedores(proc.identificacao, identificador, pp.participantes, currentTab.id, authToken);
          }
        }

        procOk++;
      } catch {}

      // Pausa entre processos para evitar rate limit
      await new Promise(r => setTimeout(r, 300));
    }

    // ── 3. Feed ───────────────────────────────────────────────────────────────
    const andamento = allItems.filter(i => !/homolog|cancel|fracass|desert|revog|anulad/i.test(i.situacao || '')).length;
    await supaUpsert('feed_items', [{
      titulo:     '🔄 ComprasNet sincronizado — ' + procOk + ' processo(s) com itens',
      descricao:  allItems.length + ' processos · ' + itensTotal + ' itens · ' + partTotal + ' fornecedores — ' + andamento + ' em andamento · UASG 120630',
      tipo:       'processos',
      link_tab:   'processos',
      created_at: agora,
    }], gapmn_token).catch(() => {});

    setMsg(
      '✅ ' + allItems.length + ' processos · ' +
      '<span style="color:#34d399">' + itensTotal + ' itens · ' + partTotal + ' fornecedores</span> sincronizados' +
      (skipped ? ' · <span style="color:#64748b">' + skipped + ' finalizados sem alteração (pulados)</span>' : '') + '!'
    );

  } catch (e) {
    setMsg('❌ Erro ao sincronizar: ' + e.message);
  }

  btn.disabled = false; btnSync.disabled = false;
}

// ── Detail view ───────────────────────────────────────────────────────────────

async function mostrarDetalhe(it) {
  if (!currentTab || !authToken) {
    setMsg('⚠ Sincronize primeiro.');
    return;
  }

  if (!it.acaoUrl) {
    setMsg('⚠ Processo sem URL de ação — detalhes indisponíveis.');
    return;
  }

  detalheProcesso = it;
  detalheItens    = [];

  document.getElementById('lista-view').style.display = 'none';
  const panel = document.getElementById('detalhe-view');
  panel.style.display = 'flex';

  document.getElementById('detalhe-titulo').textContent = it.identificacao;
  document.getElementById('detalhe-sit').innerHTML =
    '<span class="badge ' + classeSit(it.situacao) + '">' + it.situacao + '</span>';
  document.getElementById('detalhe-acao').textContent = it.acao || '';
  document.getElementById('btn-xls').style.display = 'none';
  document.getElementById('detalhe-itens').innerHTML =
    '<div style="color:#64748b;padding:16px 0">⏳ Resolvendo processo…</div>';

  try {
    // Step 1: resolve identificador (one executeScript, fast)
    const [resolveResult] = await _ext.scripting.executeScript({
      target: { tabId: currentTab.id },
      func: cnetResolveIdentificador,
      args: [it.acaoUrl, authToken],
      world: 'MAIN',
    });
    const resolveData = resolveResult?.result;
    if (!resolveData?.ok)
      throw new Error(resolveData?.error || 'Não foi possível resolver o identificador.');

    detalheId = resolveData.identificador;

    // Step 2: fetch items page by page — one executeScript per page (no timeout risk)
    const PAGE_SIZE = 20;
    const allItens  = [];
    let firstDebug  = null;
    let lastStatus  = 'ok';

    let retries = 0;
    for (let pg = 0; pg <= 500; pg++) {
      document.getElementById('detalhe-itens').innerHTML =
        '<div style="color:#64748b;padding:16px 0">⏳ Página ' + pg
        + ' — ' + allItens.length + ' itens carregados…</div>';

      // Delay entre páginas para evitar 429 (rate limit)
      if (pg > 0) await new Promise(r => setTimeout(r, 400));

      const [pageResult] = await _ext.scripting.executeScript({
        target: { tabId: currentTab.id },
        func: cnetFetchItensPage,
        args: [detalheId, pg, authToken],
        world: 'MAIN',
      });
      const pd = pageResult?.result;

      if (!pd) { lastStatus = 'executeScript null pg=' + pg; break; }

      // 429: espera e tenta de novo (máx 3 retries por página)
      if (!pd.ok && pd.status === 429) {
        if (retries >= 3) { lastStatus = '429 persistente pg=' + pg; break; }
        retries++;
        document.getElementById('detalhe-itens').innerHTML =
          '<div style="color:#fbbf24;padding:16px 0">⏳ Rate limit (429) — aguardando ' + (retries * 2) + 's… ' + allItens.length + ' itens</div>';
        await new Promise(r => setTimeout(r, retries * 2000));
        pg--; // retry mesmo pg
        continue;
      }
      retries = 0; // reset ao ter sucesso

      if (!pd.ok) { lastStatus = 'API error pg=' + pg + ': ' + pd.error; break; }
      if (!pd.items) { lastStatus = 'no items prop pg=' + pg; break; }

      if (pg === 0) firstDebug = JSON.stringify(pd.items[0] || {});
      allItens.push(...pd.items);
      if (!pd.items.length || pd.items.length < PAGE_SIZE) { lastStatus = 'last page pg=' + pg + ' count=' + pd.items.length; break; }
    }

    // Show total count + stop reason in header for diagnostics
    document.getElementById('detalhe-acao').textContent =
      (it.acao || '') + '  ·  ' + allItens.length + ' itens  [' + lastStatus + ']';

    renderItens(allItens, firstDebug);
  } catch (e) {
    document.getElementById('detalhe-itens').innerHTML =
      '<div style="color:#f87171;padding:16px 0">❌ ' + e.message + '</div>';
  }
}

function mostrarLista() {
  document.getElementById('detalhe-view').style.display = 'none';
  document.getElementById('lista-view').style.display = 'block';
  detalheId = null;
}

// ── Render items ──────────────────────────────────────────────────────────────

function renderItens(itens, debugItem) {
  detalheItens = itens; // salva para exportação XLS
  // Sync itens to Supabase silently if GAPMN auth is active
  if (detalheProcesso) autoSyncItens(detalheProcesso.identificacao, itens);
  const container = document.getElementById('detalhe-itens');

  if (!itens.length) {
    container.innerHTML = '<div style="color:#64748b;padding:16px 0">Nenhum item encontrado neste processo.</div>';
    return;
  }
  document.getElementById('btn-xls').style.display = 'inline-block';

  const fmtVal = v => (v != null && v !== '' && !isNaN(Number(v)))
    ? 'R$ ' + Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 2 })
    : '—';

  function strSit(s) {
    if (!s && s !== 0) return '';
    if (typeof s === 'object') return s.descricao || s.nome || s.label || JSON.stringify(s);
    return String(s);
  }

  let html = '';

  // Debug block — shows raw JSON of first item to identify field names
  if (debugItem) {
    html += '<details style="margin-bottom:12px">'
      + '<summary style="font-size:10px;color:#64748b;cursor:pointer">🔍 Campos brutos (item 1) — para diagnóstico</summary>'
      + '<pre style="font-size:9px;color:#94a3b8;background:#060c1c;padding:8px;border-radius:6px;white-space:pre-wrap;margin-top:6px;max-height:160px;overflow:auto">'
      + esc(debugItem) + '</pre></details>';
  }

  detalhamentosMap = {};  // reset ao carregar novo processo

  html += '<table class="itens-table"><thead><tr>'
    + '<th>#</th><th>Item</th><th>Qtde Sol.</th><th>Valor Est. Unit.</th><th>Situação</th><th></th>'
    + '</tr></thead><tbody>';

  for (const item of itens) {
    const num  = item.numeroItem ?? item.numero ?? item.numItem ?? item.id ?? '?';
    const desc = item.descricaoDetalhada ?? item.descricao ?? item.descricaoItem ?? item.objeto ?? item.nome ?? '—';
    const qtde = item.quantidadeSolicitada ?? item.quantidade ?? item.qtde ?? item.quantidadeTotal ?? '—';
    const vlr  = item.valorEstimadoUnitario ?? item.valorEstimado ?? item.valorUnitarioEstimado
              ?? item.valorReferencia ?? item.valorUnitario ?? item.preco ?? null;

    const sitCod = String(item.situacao ?? item.situacaoItem ?? '');
    const sit = item.homologado
      ? 'Homologado'
      : (SITUACAO_ITEM[sitCod] ?? strSit(sitCod));

    // Detecta se é um grupo/lote (numero negativo ou sem valor unitário mas com valor total)
    const isGrupo = (typeof num === 'number' && num < 0)
      || (String(num).startsWith('-'))
      || (vlr == null && (item.valorEstimadoTotal ?? item.valorTotal) != null)
      || String(desc).match(/^grupo\s*\d+$/i);

    detalhamentosMap[num] = desc;

    // Extra fields for expanded detail
    const vlrTotal   = item.valorEstimadoTotal ?? item.valorTotal ?? null;
    const unidade    = item.unidadeFornecimento ?? item.unidadeMedida ?? item.unidade ?? '';
    const criterio   = item.criterioJulgamento ?? item.critJulgamento
                    ?? (item.criterio ? (item.criterio.descricao ?? item.criterio) : '') ?? '';
    const tratamento = item.tratamentoDiferenciado ?? item.descricaoTratamento ?? '';
    const margemPref = item.aplicabilidadeMargemPreferencia ?? item.margemPreferencia ?? '';

    // Prefixo de grupo na célula do número
    const numLabel = isGrupo
      ? '<span style="color:#818cf8;font-size:9px;font-weight:700;display:block">GRUPO</span>' + String(num)
      : num;

    html += '<tr' + (isGrupo ? ' style="background:rgba(129,140,248,0.06)"' : '') + '>'
      + '<td style="color:#94a3b8;font-weight:600;white-space:nowrap">' + numLabel + '</td>'
      + '<td style="font-size:11px;max-width:420px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis" title="' + esc(desc) + '">'
      + (isGrupo ? '<span style="color:#818cf8;font-weight:600">📦 ' + desc + '</span>' : desc)
      + '</td>'
      + '<td style="color:#94a3b8;font-size:11px;white-space:nowrap">' + (isGrupo ? '—' : qtde) + '</td>'
      + '<td style="font-size:11px;white-space:nowrap">' + (isGrupo ? (vlrTotal ? '<span style="color:#64748b;font-size:10px">Total: </span>' + fmtVal(vlrTotal) : '—') : fmtVal(vlr)) + '</td>'
      + '<td><span class="badge ' + classeSit(sit) + '">' + sit + '</span></td>'
      + '<td style="white-space:nowrap">'
      + (isGrupo
        ? '<button class="btn-exp btn-grupo-itens" data-lote="' + num + '" data-grupoid="' + esc(item.identificador ?? '') + '" style="margin-right:4px;background:rgba(129,140,248,0.15);border-color:#818cf8;color:#818cf8">▼ Itens do Grupo</button>'
        : '<button class="btn-exp" data-det="' + num + '" style="margin-right:4px">▼ Detalhes</button>'
      )
      + '</td>'
      + '</tr>'
      + '<tr id="drow-' + num + '" style="display:none">'
      + '<td colspan="6"><div id="ddet-' + num + '" style="padding:10px 14px;background:rgba(0,0,0,0.18);border-radius:6px;font-size:11px;color:#94a3b8;line-height:1.7">'
      + (isGrupo
        ? '<div style="color:#818cf8;font-size:11px;padding:4px 0">⏳ Carregando itens do grupo…</div>'
        : (unidade    ? '<div><b style="color:#64748b">Unidade:</b> '               + esc(String(unidade))    + '</div>' : '')
          + (criterio ? '<div><b style="color:#64748b">Critério:</b> '              + esc(String(criterio))   + '</div>' : '')
          + (vlrTotal ? '<div><b style="color:#64748b">Valor est. total:</b> '      + fmtVal(vlrTotal)        + '</div>' : '')
          + (tratamento ? '<div><b style="color:#64748b">Tratamento:</b> '          + esc(String(tratamento)) + '</div>' : '')
          + (margemPref ? '<div><b style="color:#64748b">Margem de preferência:</b> ' + esc(String(margemPref)) + '</div>' : '')
          + '<div id="desc-det-' + num + '" style="color:#64748b;font-size:11px">⏳ Carregando descrição detalhada…</div>'
      )
      + '</div></td>'
      + '</tr>';
  }

  html += '</tbody></table>';

  // Fornecedores section (process-level, lazy loaded)
  html += '<div style="margin-top:16px">'
    + '<button id="btn-fornecedores-proc" class="btn-exp" style="font-size:12px;padding:7px 16px">'
    + '🏢 Ver todos os fornecedores do processo</button>'
    + '<div id="fornecedores-proc-inner" style="margin-top:10px"></div>'
    + '</div>';

  container.innerHTML = html;

  document.getElementById('btn-fornecedores-proc').addEventListener('click', async function() {
    const inner = document.getElementById('fornecedores-proc-inner');
    if (inner.dataset.loaded) {
      inner.style.display = inner.style.display === 'none' ? 'block' : 'none';
      this.textContent = inner.style.display === 'none'
        ? '🏢 Ver todos os fornecedores do processo'
        : '🏢 Ocultar fornecedores';
      return;
    }
    this.textContent = '⏳ Carregando…';
    try {
      const [res] = await _ext.scripting.executeScript({
        target: { tabId: currentTab.id },
        func: cnetFetchParticipantes,
        args: [detalheId, null, authToken],
        world: 'MAIN',
      });
      const pd = res?.result;
      if (!pd?.ok) throw new Error(pd?.error || 'Sem dados');
      renderParticipantes(inner, pd.participantes || []);
      if (detalheProcesso) autoSyncParticipantes(detalheProcesso.identificacao, pd.participantes || []);
      inner.dataset.loaded = '1';

      // Sincroniza vencedores de TODOS os fornecedores automaticamente
      // (roda em background — usuário não precisa clicar em cada fornecedor)
      if (detalheProcesso && detalheId && gapmn_token && pd.participantes?.length) {
        const isCancelled = /cancel|fracass|desert|revog|anulad/i.test(detalheProcesso.situacao || '');
        if (!isCancelled) {
          autoSyncVencedores(detalheProcesso.identificacao, detalheId, pd.participantes, currentTab.id, authToken);
        }
      }
      this.textContent = '🏢 Ocultar fornecedores';
    } catch (e) {
      inner.innerHTML = '<span style="color:#f87171;font-size:11px">Erro: ' + e.message + '</span>';
      this.textContent = '🏢 Ver todos os fornecedores do processo';
    }
  });

  container.querySelectorAll('[data-det]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const num  = btn.dataset.det;
      const drow = document.getElementById('drow-' + num);
      if (drow.style.display !== 'none') {
        drow.style.display = 'none';
        btn.textContent = '▼ Detalhes';
        return;
      }
      drow.style.display = 'table-row';
      btn.textContent = '▲ Fechar';

      // Lazy-fetch descricaoDetalhada on first open (one request, no timeout)
      const descEl = document.getElementById('desc-det-' + num);
      if (descEl && !descEl.dataset.loaded) {
        descEl.dataset.loaded = '1';
        if (detalheId && currentTab && authToken) {
          try {
            const [res] = await _ext.scripting.executeScript({
              target: { tabId: currentTab.id },
              func: cnetFetchDetalhamento,
              args: [detalheId, num, authToken],
              world: 'MAIN',
            });
            const d = res?.result;
            if (d?.ok && d?.data?.descricaoDetalhada) {
              descEl.innerHTML = '<b style="color:#64748b">Descrição detalhada:</b> ' + esc(d.data.descricaoDetalhada);
              detalhamentosMap[num] = d.data.descricaoDetalhada;
            } else {
              descEl.style.display = 'none';
            }
          } catch {
            descEl.style.display = 'none';
          }
        } else {
          descEl.style.display = 'none';
        }
      }
    });
  });

  container.querySelectorAll('.btn-exp').forEach(btn => {
    btn.addEventListener('click', async () => {
      const num  = btn.dataset.num;
      const prow = document.getElementById('prow-' + num);

      if (prow.style.display !== 'none') {
        prow.style.display = 'none';
        btn.textContent = '+ Fornecedores';
        return;
      }

      prow.style.display = 'table-row';
      btn.textContent = '− Fechar';
      const inner = document.getElementById('pinner-' + num);
      inner.textContent = '⏳ Carregando fornecedores…';

      try {
        const [res] = await _ext.scripting.executeScript({
          target: { tabId: currentTab.id },
          func: cnetFetchParticipantes,
          args: [detalheId, num, authToken],
          world: 'MAIN',
        });
        const pd = res?.result;
        if (!pd?.ok) throw new Error(pd?.error || 'Sem dados');
        renderParticipantes(inner, pd.participantes || [], pd._debugParticipante);
      } catch (e) {
        inner.innerHTML = '<span style="color:#f87171">Erro: ' + e.message + '</span>';
      }
    });
  });

  // Botão "Itens do Grupo" — busca sub-itens de um lote/grupo
  container.querySelectorAll('.btn-grupo-itens').forEach(btn => {
    btn.addEventListener('click', async () => {
      const loteNum = btn.dataset.lote;
      const grupoId = btn.dataset.grupoid || null;
      const drow = document.getElementById('drow-' + loteNum);
      const ddet = document.getElementById('ddet-' + loteNum);

      if (drow.style.display !== 'none') {
        drow.style.display = 'none';
        btn.textContent = '▼ Itens do Grupo';
        return;
      }

      drow.style.display = 'table-row';
      btn.textContent = '▲ Fechar';

      if (ddet.dataset.loaded) return;
      ddet.dataset.loaded = '1';

      if (!detalheId || !currentTab) {
        ddet.innerHTML = '<span style="color:#f87171;font-size:11px">Sem conexão com ComprasNet.</span>';
        return;
      }

      ddet.innerHTML = '<div style="color:#818cf8;font-size:11px">⏳ Buscando itens do grupo…</div>';

      try {
        const [res] = await _ext.scripting.executeScript({
          target: { tabId: currentTab.id },
          func: cnetFetchItensGrupo,
          args: [detalheId, loteNum, grupoId, authToken],
          world: 'MAIN',
        });
        const pd = res?.result;

        if (!pd?.ok || !pd.items?.length) {
          ddet.innerHTML = '<span style="color:#f87171;font-size:11px">'
            + (pd?.error || 'Nenhum sub-item encontrado para este grupo.')
            + '</span><br><span style="color:#64748b;font-size:10px">O processo pode usar estrutura diferente — expanda "Campos brutos" para diagnóstico.</span>';
          return;
        }

        // Armazena sub-itens para sincronização
        if (detalheProcesso) {
          autoSyncItens(detalheProcesso.identificacao, pd.items, Number(loteNum));
          // Adiciona ao detalheItens para exportação XLS
          for (const si of pd.items) {
            if (!detalheItens.find(i => (i.numeroItem ?? i.numero) === (si.numeroItem ?? si.numero))) {
              detalheItens.push(si);
            }
          }
        }

        const fmtVal2 = v => (v != null && !isNaN(Number(v)))
          ? 'R$ ' + Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 2 })
          : '—';

        // Prefixo único por grupo para evitar colisão de IDs
        const gpfx = 'g' + String(loteNum).replace(/[^a-z0-9]/gi, '_');

        let h = '<table class="itens-table" style="font-size:10px;margin-top:4px"><thead><tr>'
          + '<th>#</th><th>Descrição</th><th>Qtde</th><th>Val. Est. Unit.</th><th>Val. Est. Total</th><th>Situação</th><th></th>'
          + '</tr></thead><tbody>';

        for (const si of pd.items) {
          const sNum  = si.numeroItem ?? si.numero ?? '?';
          const sDesc = si.descricaoDetalhada ?? si.descricao ?? si.descricaoItem ?? '—';
          const sQtde = si.quantidadeSolicitada ?? si.quantidade ?? '—';
          const sVlrU = si.valorEstimadoUnitario ?? si.valorEstimado ?? null;
          const sVlrT = si.valorEstimadoTotal ?? null;
          const sUnd  = si.unidadeFornecimento ?? si.unidadeMedida ?? si.unidade ?? '';
          const sCrit = si.criterioJulgamento ?? '';
          const sTrat = si.tratamentoDiferenciado ?? '';
          const sSit  = si.homologado ? 'Homologado' : (SITUACAO_ITEM[String(si.situacao ?? '')] ?? String(si.situacao ?? ''));
          detalhamentosMap[sNum] = sDesc;
          const rowId = gpfx + '_' + sNum;
          h += '<tr>'
            + '<td style="color:#94a3b8;font-weight:600">' + sNum + '</td>'
            + '<td style="max-width:300px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis" title="' + esc(sDesc) + '">' + sDesc + '</td>'
            + '<td style="color:#94a3b8;text-align:center">' + sQtde + '</td>'
            + '<td>' + fmtVal2(sVlrU) + '</td>'
            + '<td>' + fmtVal2(sVlrT) + '</td>'
            + '<td><span class="badge ' + classeSit(sSit) + '">' + sSit + '</span></td>'
            + '<td><button class="btn-exp btn-si-det" data-sinum="' + sNum + '" data-rowid="' + rowId + '" style="font-size:9px;padding:2px 8px">▼ Detalhes</button></td>'
            + '</tr>'
            + '<tr id="sirow-' + rowId + '" style="display:none">'
            + '<td colspan="7"><div id="sidet-' + rowId + '" style="padding:8px 14px;background:rgba(0,0,0,0.22);border-radius:6px;font-size:10px;color:#94a3b8;line-height:1.8">'
            + (sUnd  ? '<div><b style="color:#64748b">Unidade:</b> ' + esc(sUnd)  + '</div>' : '')
            + (sCrit ? '<div><b style="color:#64748b">Critério:</b> ' + esc(String(sCrit)) + '</div>' : '')
            + (sTrat ? '<div><b style="color:#64748b">Tratamento:</b> ' + esc(String(sTrat)) + '</div>' : '')
            + (sVlrT ? '<div><b style="color:#64748b">Val. est. total:</b> ' + fmtVal2(sVlrT) + '</div>' : '')
            + '<div id="sidetd-' + rowId + '" style="color:#64748b;font-size:10px">⏳ Carregando descrição…</div>'
            + '</div></td>'
            + '</tr>';
        }

        h += '</tbody></table>';
        h += '<div style="color:#64748b;font-size:9px;margin-top:4px">Endpoint: ' + esc(pd.url || '') + '</div>';
        ddet.innerHTML = h;

        // Handlers para "▼ Detalhes" de cada sub-item
        ddet.querySelectorAll('.btn-si-det').forEach(sbtn => {
          sbtn.addEventListener('click', async () => {
            const sNum  = sbtn.dataset.sinum;
            const rowId = sbtn.dataset.rowid;
            const srow  = document.getElementById('sirow-' + rowId);
            if (srow.style.display !== 'none') {
              srow.style.display = 'none';
              sbtn.textContent = '▼ Detalhes';
              return;
            }
            srow.style.display = 'table-row';
            sbtn.textContent = '▲ Fechar';

            const detEl = document.getElementById('sidetd-' + rowId);
            if (!detEl || detEl.dataset.loaded) return;
            detEl.dataset.loaded = '1';

            if (!detalheId || !currentTab || !authToken) {
              detEl.style.display = 'none';
              return;
            }
            try {
              const [res] = await _ext.scripting.executeScript({
                target: { tabId: currentTab.id },
                func: cnetFetchDetalhamento,
                args: [detalheId, sNum, authToken],
                world: 'MAIN',
              });
              const d = res?.result;
              if (d?.ok && d?.data?.descricaoDetalhada) {
                detEl.innerHTML = '<b style="color:#64748b">Descrição detalhada:</b> ' + esc(d.data.descricaoDetalhada);
                detalhamentosMap[sNum] = d.data.descricaoDetalhada;
              } else {
                detEl.style.display = 'none';
              }
            } catch {
              detEl.style.display = 'none';
            }
          });
        });
      } catch (e) {
        ddet.innerHTML = '<span style="color:#f87171;font-size:11px">Erro: ' + esc(e.message) + '</span>';
      }
    });
  });
}

// ── Render participants ───────────────────────────────────────────────────────

function renderParticipantes(container, participantes, debugParticipante) {
  let html = '';

  if (debugParticipante) {
    html += '<details style="margin-bottom:8px">'
      + '<summary style="font-size:10px;color:#64748b;cursor:pointer">🔍 Campos brutos (participante 1)</summary>'
      + '<pre style="font-size:9px;color:#94a3b8;background:#060c1c;padding:8px;border-radius:6px;white-space:pre-wrap;margin-top:4px;max-height:140px;overflow:auto">'
      + esc(debugParticipante) + '</pre></details>';
  }

  if (!participantes.length) {
    container.innerHTML = html + '<span style="color:#64748b;font-size:11px">Nenhum fornecedor encontrado.</span>';
    return;
  }

  const sorted = [...participantes].sort((a, b) =>
    (b.qtdeTotalItensParaSelecao ?? 0) - (a.qtdeTotalItensParaSelecao ?? 0)
  );

  html += '<table class="partic-table"><thead><tr>'
    + '<th>CNPJ/CPF</th><th>Empresa</th><th>ME/EPP</th>'
    + '<th title="Total de itens em que participou">Itens</th>'
    + '<th title="Itens aguardando julgamento">Julg.</th>'
    + '<th title="Itens aguardando habilitação">Habil.</th>'
    + '<th></th>'
    + '</tr></thead><tbody>';

  for (const p of sorted) {
    const cnpj   = p.identificacaoParticipante ?? '—';
    const empresa = p.nomeParticipante ?? '—';
    const meEpp  = p.declaracaoMeEpp ? '<span class="badge sit-homologado">ME/EPP</span>' : '';
    const total  = p.qtdeTotalItensParaSelecao ?? 0;
    const julg   = p.qtdeItensAguardandoJulgamento ?? 0;
    const habil  = p.qtdeItensAguardandoHabilitacao ?? 0;
    const cnpjId = cnpj.replace(/\D/g, '') || cnpj.replace(/[^a-zA-Z0-9]/g, '_');

    html += '<tr>'
      + '<td style="white-space:nowrap;font-size:10px;color:#64748b">' + cnpj + '</td>'
      + '<td style="max-width:240px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis" title="' + esc(empresa) + '">' + empresa + '</td>'
      + '<td>' + meEpp + '</td>'
      + '<td style="text-align:center;color:#94a3b8">' + total + '</td>'
      + '<td style="text-align:center;color:' + (julg  > 0 ? '#fbbf24' : '#475569') + '">' + julg  + '</td>'
      + '<td style="text-align:center;color:' + (habil > 0 ? '#818cf8' : '#475569') + '">' + habil + '</td>'
      + '<td style="white-space:nowrap">'
      + '<button class="btn-exp btn-itens-forn" data-cnpj="' + esc(cnpj) + '" data-cnpjid="' + cnpjId + '" data-nome="' + esc(empresa) + '">▼ Itens</button>'
      + '</td>'
      + '</tr>'
      + '<tr id="irow-' + cnpjId + '" style="display:none">'
      + '<td colspan="7" style="padding:0"><div id="iinner-' + cnpjId + '" style="padding:8px 14px"></div></td>'
      + '</tr>';
  }

  html += '</tbody></table>';
  container.innerHTML = html;

  container.querySelectorAll('.btn-itens-forn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const cnpj   = btn.dataset.cnpj;
      const cnpjId = btn.dataset.cnpjid;
      const irow   = document.getElementById('irow-' + cnpjId);
      const inner  = document.getElementById('iinner-' + cnpjId);

      if (irow.style.display !== 'none') {
        irow.style.display = 'none';
        btn.textContent = '▼ Itens';
        return;
      }

      irow.style.display = 'table-row';
      btn.textContent = '▲ Fechar';

      if (inner.dataset.loaded) return;

      inner.textContent = '⏳ Carregando itens…';

      try {
        const [res] = await _ext.scripting.executeScript({
          target: { tabId: currentTab.id },
          func: cnetFetchItensParticipante,
          args: [detalheId, cnpj, authToken],
          world: 'MAIN',
        });
        const pd = res?.result;
        if (!pd?.ok) throw new Error(pd?.error || 'Sem dados');
        renderItensParticipante(inner, pd.ganhos || [], pd.naoGanhos || []);
        inner.dataset.loaded = '1';

        // Salva vencedores no App imediatamente — o popup já tem os dados, garantido
        if (pd.ganhos?.length && detalheProcesso && gapmn_token) {
          const nomeForn = btn.dataset.nome || null;
          const vencUpdates = pd.ganhos.map(it => {
            const num = it.numero ?? it.numeroItem;
            if (num == null) return null;
            let vlrUnit = null, vlrTotal = null;
            try {
              const calc = it.propostaItem.valores.valorPropostaInicialOuLances.valorCalculado;
              vlrUnit  = calc.valorUnitario ?? null;
              vlrTotal = calc.valorTotal    ?? null;
            } catch {}
            return {
              identificacao:           detalheProcesso.identificacao,
              numero_item:             Number(num),
              vencedor_cnpj:           cnpj,
              vencedor_nome:           nomeForn,
              valor_vencedor_unitario: vlrUnit,
              valor_vencedor_total:    vlrTotal ?? (vlrUnit != null && (it.quantidadeSolicitada ?? it.quantidade) != null
                                         ? vlrUnit * (it.quantidadeSolicitada ?? it.quantidade) : null),
            };
          }).filter(Boolean);
          if (vencUpdates.length) {
            supaUpsert('cnet_itens', vencUpdates, gapmn_token)
              .then(() => { inner.dataset.synced = '1'; })
              .catch(() => {});
          }
        }
      } catch (e) {
        inner.innerHTML = '<span style="color:#f87171;font-size:11px">Erro: ' + e.message + '</span>';
        btn.textContent = '▼ Itens';
        irow.style.display = 'none';
      }
    });
  });
}

// ── Render per-supplier items (ganhos / não ganhos) ───────────────────────────

function renderItensParticipante(container, ganhos, naoGanhos) {
  const fmtVal = v => (v != null && v !== '' && !isNaN(Number(v)))
    ? 'R$ ' + Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 2 })
    : '—';

  function getValorProposto(item) {
    try {
      const calc = item.propostaItem.valores.valorPropostaInicialOuLances.valorCalculado;
      // Grupos usam valorTotal (disputaPorValorUnitario=false); itens normais usam valorUnitario
      return calc.valorUnitario ?? calc.valorTotal ?? null;
    }
    catch { return null; }
  }

  function getValorPropostoTotal(item) {
    try {
      const calc = item.propostaItem.valores.valorPropostaInicialOuLances.valorCalculado;
      return calc.valorTotal ?? null;
    }
    catch { return null; }
  }

  function fmtEco(vlrEst, vlrProp) {
    if (vlrEst == null || vlrProp == null || isNaN(vlrEst) || isNaN(vlrProp) || vlrEst <= 0) return '—';
    const eco = ((Number(vlrEst) - Number(vlrProp)) / Number(vlrEst)) * 100;
    return (eco >= 0 ? '-' : '+') + Math.abs(eco).toFixed(1) + '%';
  }

  function renderSection(title, items, cor) {
    if (!items.length) {
      return '<div style="color:#475569;font-size:10px;padding:4px 0 8px">' + title + ': nenhum</div>';
    }
    let h = '<div style="margin-bottom:12px">'
      + '<div style="font-size:11px;font-weight:700;color:' + cor + ';margin-bottom:6px">'
      + title + ' (' + items.length + ')</div>'
      + '<table class="partic-table" style="font-size:10px"><thead><tr>'
      + '<th>#</th><th>Item</th><th>Qtde</th>'
      + '<th>Val. Est.</th><th>Val. Proposto</th>'
      + '<th title="Economia em relação ao estimado">Eco.</th><th>Hom.</th>'
      + '</tr></thead><tbody>';

    for (const item of items) {
      const num     = item.numero ?? item.numeroItem ?? '?';
      const isGroup = item.tipo === 'G' || Number(num) < 0;
      const desc    = detalhamentosMap[num] ?? item.descricaoDetalhada ?? item.descricao ?? item.descricaoItem ?? '—';
      const qtde    = isGroup ? '—' : (item.quantidadeSolicitada ?? item.quantidade ?? '—');

      // Grupos: comparar totais; itens normais: comparar unitários
      const vlrEst  = isGroup
        ? (item.valorEstimadoTotal ?? null)
        : (item.valorEstimadoUnitario ?? item.valorEstimadoTotal ?? null);
      const vlrProp = isGroup ? getValorPropostoTotal(item) : getValorProposto(item);
      const eco      = fmtEco(vlrEst, vlrProp);
      const ecoColor = (vlrProp != null && vlrEst != null && Number(vlrProp) < Number(vlrEst))
        ? '#34d399' : '#94a3b8';
      const hom      = item.homologado
        ? '<span class="badge sit-homologado" style="font-size:9px">✓</span>'
        : '<span class="badge sit-outro" style="font-size:9px">—</span>';

      // Label do número: grupos mostram "GRUPO" em roxo
      const numLabel = isGroup
        ? '<span style="color:#818cf8;font-size:8px;font-weight:700;display:block">GRUPO</span>' + num
        : num;
      // Label do valor estimado: "(total)" para grupos
      const vlrEstLabel = isGroup
        ? fmtVal(vlrEst) + '<span style="color:#64748b;font-size:8px"> total</span>'
        : fmtVal(vlrEst);
      const vlrPropLabel = isGroup
        ? fmtVal(vlrProp) + '<span style="color:#64748b;font-size:8px"> total</span>'
        : fmtVal(vlrProp);

      h += '<tr' + (isGroup ? ' style="background:rgba(129,140,248,0.06)"' : '') + '>'
        + '<td style="color:#94a3b8;font-weight:600;white-space:nowrap">' + numLabel + '</td>'
        + '<td style="max-width:200px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis" title="' + esc(desc) + '">'
        + (isGroup ? '<span style="color:#818cf8">' + desc + '</span>' : desc) + '</td>'
        + '<td style="text-align:center;color:#94a3b8">' + qtde + '</td>'
        + '<td style="white-space:nowrap">' + vlrEstLabel + '</td>'
        + '<td style="white-space:nowrap;color:#a5b4fc">' + vlrPropLabel + '</td>'
        + '<td style="white-space:nowrap;color:' + ecoColor + '">' + eco + '</td>'
        + '<td>' + hom + '</td>'
        + '</tr>';
    }

    h += '</tbody></table></div>';
    return h;
  }

  container.innerHTML =
    '<div style="padding:4px 0">'
    + renderSection('🥇 Itens ganhos', ganhos, '#34d399')
    + renderSection('Itens não ganhos', naoGanhos, '#94a3b8')
    + '</div>';
}

// ── Tabela (process list) ─────────────────────────────────────────────────────

function classeSit(s) {
  const l = (s || '').toLowerCase();
  if (/julgamento|adjudic|abertura|aguardando|andamento|proposta|sess|analise|recurso|decidindo/.test(l)) return 'sit-andamento';
  if (/homolog/.test(l))  return 'sit-homologado';
  if (/cancel|fracass|desert|revog|anulad/.test(l)) return 'sit-cancelado';
  return 'sit-outro';
}

function esc(s) {
  return String(s || '').replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;');
}

function filtrar() {
  return allItems.filter(it => {
    if (filtroAtivo === 'todos')      return true;
    if (filtroAtivo === 'andamento')  return !/homolog|cancel|fracass|desert|revog|anulad|encerr/i.test(it.situacao);
    if (filtroAtivo === 'homologado') return /homolog/i.test(it.situacao);
    if (filtroAtivo === 'cancelado')  return /cancel|fracass|desert|revog|anulad/i.test(it.situacao);
    if (filtroAtivo === 'pendente')   return it.possuiPendencia;
    return true;
  });
}

function renderTable() {
  const items = filtrar();
  document.getElementById('count').textContent = items.length + ' processo' + (items.length !== 1 ? 's' : '');
  const tbody = document.getElementById('tbody');
  tbody.innerHTML = '';
  if (!items.length) {
    document.getElementById('tabela').style.display = 'none';
    document.getElementById('empty').textContent = allItems.length
      ? 'Nenhum processo corresponde ao filtro.'
      : 'Nenhum dado carregado.';
    document.getElementById('empty').style.display = 'block';
    return;
  }
  document.getElementById('empty').style.display = 'none';
  document.getElementById('tabela').style.display = 'table';
  for (const it of items) {
    const tr = document.createElement('tr');
    tr.title = 'Clique para ver itens e fornecedores';
    tr.innerHTML =
      '<td style="font-weight:600;color:#cbd5e1">' + it.identificacao + '</td>' +
      '<td><span class="badge ' + classeSit(it.situacao) + '">' + it.situacao + '</span></td>' +
      '<td style="color:#64748b;font-size:11px">' + it.agrupamento + '</td>' +
      '<td style="color:#94a3b8;font-size:11px;max-width:220px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + it.acao + '</td>' +
      '<td>' + (it.possuiPendencia ? '<span class="pendencia">⚠</span>' : '') + '</td>';
    tr.addEventListener('click', () => mostrarDetalhe(it));
    tbody.appendChild(tr);
  }
}

// ── CSV por processo ──────────────────────────────────────────────────────────

async function exportarProcessoXLS() {
  if (!detalheItens.length || !detalheProcesso) return;

  const btnXls = document.getElementById('btn-xls');
  const origLabel = btnXls.textContent;
  btnXls.disabled = true;
  btnXls.textContent = '⏳ Buscando fornecedores...';

  // Busca vencedores por item via scripting (evita CORS)
  let itemWinnerMap = {}; // { itemNum → { cnpj, empresa } }

  try {
    if (detalheId && authToken && currentTab) {
      const results = await _ext.scripting.executeScript({
        target: { tabId: currentTab.id },
        world: 'MAIN',
        func: async (compraId, token) => {
          const BASE_FE = 'https://cnetmobile.estaleiro.serpro.gov.br/comprasnet-fase-externa';
          const hdrs = { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' };
          try {
            const pr = await fetch(
              BASE_FE + '/v1/compras/' + compraId + '/em-selecao-fornecedores/participantes?tamanhoPagina=200&pagina=0',
              { credentials: 'include', headers: hdrs }
            );
            if (!pr.ok) return {};
            const raw = await pr.json();
            const parts = Array.isArray(raw) ? raw : (raw.content || []);
            const map = {};
            const PS = 20;
            await Promise.all(parts.map(async (p) => {
              const cnpj = p.identificacaoParticipante ?? p.cnpj ?? p.cpfCnpj;
              const nome = p.nomeParticipante ?? p.nome ?? '';
              if (!cnpj) return;
              for (let pg = 0; pg <= 500; pg++) {
                try {
                  const r = await fetch(
                    BASE_FE + '/v1/compras/' + compraId + '/em-selecao-fornecedores/participantes/' + cnpj + '/itens?tamanhoPagina=20&melhorClassificado=true&pagina=' + pg,
                    { credentials: 'include', headers: hdrs }
                  );
                  if (!r.ok) break;
                  const rr = await r.json();
                  const page = Array.isArray(rr) ? rr : (rr.content || []);
                  for (const it of page) {
                    const num = it.numeroItem ?? it.numero;
                    if (num != null) map[num] = { cnpj, empresa: nome };
                  }
                  if (!page.length || page.length < PS) break;
                } catch { break; }
              }
            }));
            return map;
          } catch { return {}; }
        },
        args: [detalheId, authToken],
      });
      itemWinnerMap = results?.[0]?.result ?? {};
    }
  } catch (e) {
    console.warn('[GAP-MN Export] Fornecedores não obtidos:', e.message);
  }

  // ── Gera CSV ───────────────────────────────────────────────────────────────
  const p = detalheProcesso;
  function esc(v) {
    const s = String(v ?? '');
    return s.includes(';') || s.includes('"') || s.includes('\n')
      ? '"' + s.replace(/"/g, '""') + '"'
      : s;
  }

  // Formata CNPJ como XX.XXX.XXX/XXXX-XX para evitar notação científica no Excel
  function fmtCnpj(cnpj) {
    const n = String(cnpj ?? '').replace(/\D/g, '');
    if (n.length !== 14) return cnpj ?? '';
    return n.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5');
  }

  const rows = [
    ['LOTE', 'ITEM', 'REQUISIÇÃO', 'CNPJ', 'EMPRESA', 'QTDE', 'UND', 'VALOR UNIT', 'VALOR TOTAL', 'PRAZO', 'DESCRIÇÃO', 'SITUAÇÃO', 'FORNECEDOR', 'MODELO/VERSAO', 'MARCA'],
  ];

  let count = 1;
  for (const item of detalheItens) {
    const num      = item.numeroItem ?? item.numero ?? '';
    const desc     = item.descricaoDetalhada ?? item.descricao ?? '';
    const unidade  = item.unidadeFornecimento ?? item.unidadeMedida ?? '';
    const qtde     = item.quantidadeSolicitada ?? item.quantidade ?? '';
    const vlrUnit  = item.valorEstimadoUnitario ?? item.valorEstimado ?? '';
    const vlrTotal = item.valorEstimadoTotal ?? (vlrUnit !== '' && qtde ? (Number(vlrUnit) * Number(qtde)).toFixed(2) : '');
    const sitCod   = String(item.situacao ?? '');
    const sit      = item.homologado ? 'Homologado' : (SITUACAO_ITEM[sitCod] ?? sitCod);
    const lote     = item.lote ?? item.numeroLote ?? '';
    const winner   = itemWinnerMap[num] ?? null;
    const cnpj     = fmtCnpj(winner?.cnpj ?? '');
    const empresa  = winner?.empresa ?? '';

    rows.push([
      lote,      // LOTE
      count++,   // ITEM (contagem sequencial)
      '',        // REQUISIÇÃO
      cnpj,      // CNPJ (formatado XX.XXX.XXX/XXXX-XX)
      empresa,   // EMPRESA
      qtde,      // QTDE
      unidade,   // UND
      vlrUnit,   // VALOR UNIT
      vlrTotal,  // VALOR TOTAL
      30,        // PRAZO
      desc,      // DESCRIÇÃO
      sit,       // SITUAÇÃO
      empresa,   // FORNECEDOR
      '',        // MODELO/VERSAO
      '',        // MARCA
    ]);
  }

  const csv = '﻿' + rows.map(r => r.map(esc).join(';')).join('\r\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = (p.identificacao || 'processo').replace(/[/\\:*?"<>|]/g, '-') + '.csv';
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 3000);

  btnXls.disabled = false;
  btnXls.textContent = origLabel;
}

// ── CSV ───────────────────────────────────────────────────────────────────────

function exportCSV() {
  const items = filtrar();
  const rows = [['Identificação', 'Número', 'Ano', 'Situação', 'Grupo', 'Ação', 'Pendência']]
    .concat(items.map(it => [it.identificacao, it.numero, it.ano, it.situacao, it.agrupamento, it.acao, it.possuiPendencia ? 'Sim' : 'Não']));
  const csv = rows.map(r => r.map(c => '"' + String(c || '').replace(/"/g, '""') + '"').join(',')).join('\r\n');
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'ComprasNet-GAP-MN-' + new Date().toISOString().slice(0, 10) + '.csv';
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

function setMsg(html) { document.getElementById('msg').innerHTML = html; }
