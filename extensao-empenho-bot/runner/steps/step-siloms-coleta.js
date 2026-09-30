/**
 * Funções de coleta de dados do SILOMS — executadas no mundo MAIN da página.
 * IMPORTANTE: cada função exportada deve ser 100% autocontida (sem imports).
 * Chrome.scripting.executeScript serializa a função inteira e a envia à aba.
 */

// ── Verificação: estamos na página de listagem? ───────────────────────────────
export function silomsCheckListPage() {
  return {
    onListPage: !!(
      document.querySelector('#vST_ORDEM_COMPRA_PRE') ||
      document.querySelector('select[name="vST_ORDEM_COMPRA_PRE"]')
    ),
    hasResults: [...document.querySelectorAll('a')]
      .some(a => /^\d{2}S\d+/.test((a.innerText ?? '').trim())),
    url: window.location.href,
  };
}

// ── Clica no menu "Empenho" ───────────────────────────────────────────────────
export function silomsClickMenuEmpenho() {
  const all = [...document.querySelectorAll('a, td, li, span, div, button')];
  const target = all.find(e => {
    const t = (e.innerText ?? e.textContent ?? '').trim();
    return t === 'Empenho' && e.offsetParent !== null;
  });
  if (!target) return { ok: false, error: 'Menu "Empenho" não encontrado. Confirme que o SILOMS está aberto e você está logado.' };
  target.click();
  return { ok: true };
}

// ── Clica no submenu "Solicitação de Empenho (Recebidas)" ─────────────────────
export function silomsClickSubmenu() {
  const all = [...document.querySelectorAll('a, td, li, span, div, button')];
  const target = all.find(e => {
    const t = (e.innerText ?? e.textContent ?? '').trim();
    return t.includes('Solicitação de Empenho') &&
           (t.includes('Receb') || t.includes('receb')) &&
           e.offsetParent !== null;
  });
  if (!target) return { ok: false, error: 'Submenu "Solicitação de Empenho (Recebidas)" não encontrado.' };
  target.click();
  return { ok: true };
}

// ── Define filtro "Assinada UGCred" (H) e clica em Buscar ────────────────────
export function silomsSetFiltroEBuscar() {
  // Localiza o select de status
  const sel =
    document.querySelector('#vST_ORDEM_COMPRA_PRE') ||
    document.querySelector('[name="vST_ORDEM_COMPRA_PRE"]') ||
    document.querySelector('select[id*="ST_ORDEM_COMPRA"]');

  if (sel) {
    sel.value = 'H'; // Assinada UGCred (OD)
    // Dispara evento GeneXus se disponível
    if (typeof gx !== 'undefined' && gx.evt && typeof gx.evt.onchange === 'function') {
      try { gx.evt.onchange(sel); } catch {}
    }
    sel.dispatchEvent(new Event('change', { bubbles: true }));
  }

  // Botão Buscar (BINOCULR.BMP = IMAGE1)
  const btn =
    document.querySelector('#IMAGE1') ||
    document.querySelector('input[name="IMAGE1"]') ||
    document.querySelector('input[src*="BINOCULR"]') ||
    document.querySelector('input[type="image"]');

  if (!btn) return { ok: false, error: 'Botão Buscar (IMAGE1) não encontrado.' };
  btn.click();
  return { ok: true };
}

// ── Parseia lista de solicitações na tabela de resultados ─────────────────────
export function silomsParseListaSolicitacoes() {
  const solLinks = [...document.querySelectorAll('a')]
    .filter(a => /^\d{2}S\d+/.test((a.innerText ?? '').trim()));

  const solicitacoes = solLinks.map(link => {
    const numero = (link.innerText ?? '').trim();
    const row    = link.closest('tr');
    const cells  = row
      ? [...row.querySelectorAll('td')].map(td => (td.innerText ?? '').trim())
      : [];

    return {
      numero,
      ugExec:     cells[1]  ?? '',
      ugCred:     cells[2]  ?? '',
      ugLocal:    cells[3]  ?? '',
      iL:         cells[4]  ?? '',
      nd:         cells[5]  ?? '',
      sb:         cells[6]  ?? '',
      status:     cells[7]  ?? '',
      codemp:     cells[8]  ?? '',
      fornecedor: cells[9]  ?? '',
      pag:        cells[10] ?? '',
      valor:      cells[14] ?? '',
    };
  });

  return { ok: true, count: solicitacoes.length, solicitacoes };
}

// ── Clica no link de uma solicitação pelo número ──────────────────────────────
export function silomsAbrirSolicitacao(numero) {
  const link = [...document.querySelectorAll('a')]
    .find(a => (a.innerText ?? '').trim() === numero);
  if (!link) return { ok: false, error: `Link da solicitação ${numero} não encontrado na lista.` };
  link.click();
  return { ok: true };
}

// ── Extrai dados completos do documento de solicitação ────────────────────────
export function silomsExtrairDocumento() {
  try {
    const allText = document.body.innerText ?? '';

    // Células TD para busca de rótulo→valor
    const tds     = [...document.querySelectorAll('td')];
    const tdTxts  = tds.map(td => (td.innerText ?? '').trim());

    const afterLabel = (label) => {
      const i = tdTxts.findIndex(t => t === label);
      if (i < 0) return '';
      for (let j = i + 1; j < Math.min(i + 5, tdTxts.length); j++) {
        if (tdTxts[j]) return tdTxts[j];
      }
      return '';
    };

    const reExtract = (pat, flags = 'i') => {
      const m = allText.match(new RegExp(pat, flags));
      return m ? (m[1] ?? '').trim() : '';
    };

    // Número da solicitação (ex: 26S1342)
    const numero = reExtract(String.raw`\b(\d{2}S\d{4,})\b`);

    // LOCAL DE ENTREGA: linha grande após o header "SOLICITAÇÃO DE EMPENHO"
    const solIdx = tdTxts.findIndex(t => t === 'SOLICITAÇÃO DE EMPENHO');
    const localEntrega = solIdx >= 0 ? (tdTxts[solIdx + 1] ?? '') : '';

    // Fornecedor nome
    const fornIdx = tdTxts.findIndex(t => t === 'FORNECEDOR');
    const fornecedorNome = fornIdx >= 0 ? (tdTxts[fornIdx + 1] ?? '') : '';

    // CNPJ do fornecedor (14 dígitos)
    const cnpjRaw = reExtract(
      String.raw`CNPJ[:\s]*([\d]{14}|[\d]{2}\.[\d]{3}\.[\d]{3}\/[\d]{4}-[\d]{2})`
    );
    const fornecedorCNPJ = cnpjRaw.replace(/\D/g, '');

    // Compradora
    const compradora = afterLabel('COMPRADORA') ||
                       reExtract(String.raw`COMPRADORA[:\s]*([\w-]+)`);

    // Data da solicitação
    const data = reExtract(String.raw`(\d{2}\/\d{2}\/\d{4})`);

    // ── Tabela de itens ───────────────────────────────────────────────────────
    const items = [];
    const tables = [...document.querySelectorAll('table')];
    let itemTable = null;
    for (const t of tables) {
      const th = t.innerText ?? '';
      if ((th.includes('REQUISIÇÃO') || th.includes('SUB')) &&
          (th.includes('QUANT') || th.includes('PRC UNITARIO'))) {
        itemTable = t; break;
      }
    }

    if (itemTable) {
      const rows = [...itemTable.querySelectorAll('tr')];
      for (const row of rows) {
        const cells = [...row.querySelectorAll('td')].map(c => (c.innerText ?? '').trim());
        if (cells.length < 6) continue;
        // Pula linhas de cabeçalho e rodapé
        if (['ITEM', 'TOTAL', 'PAG', 'LICIT'].some(k => cells[0].startsWith(k))) continue;
        // Aceita se tem quantidade ou preço
        if (!cells[5] && !cells[7]) continue;
        items.push({
          item:      cells[0],
          requisicao:cells[1],
          sub:       cells[2],
          descricao: cells[3],
          ref:       cells[4],
          quant:     cells[5],
          unid:      cells[6],
          prcUnit:   cells[7],
          prcTotal:  cells[8] ?? '',
        });
      }
    }

    // ── Campos do rodapé ──────────────────────────────────────────────────────
    const pag = reExtract(String.raw`PAG[:\s]*([\d.]+\/\d{4}-\d{2})`);

    // Contrato: "DESPESA 030/GAPMN-DA" → pega só "030/GAPMN-DA" parte inicial
    const contratoRaw = reExtract(
      String.raw`Contrato[:\s]+(?:DESPESA\s+)?([\w\d/.-]+)`
    );
    const contrato = contratoRaw.split(/\s/)[0] ?? '';

    const iL    = reExtract(String.raw`I\/L[:\s]*([\w\d]+)`);
    const cgmatch = allText.match(/UG\s*[Cc]red\s*(\d+)/i) ||
                    allText.match(/UGCRED[:\s]*(\d+)/i);
    const ugCred  = cgmatch ? cgmatch[1] : afterLabel('UG Cred');
    const codemp  = reExtract(String.raw`CODEMP[:\s]*([\w\d$]+)`);
    const licit   = reExtract(String.raw`Licit[:\s]*([\w\d/.-]+)`);
    const ptres   = reExtract(String.raw`PTRES[:\s]*(\d+)`);
    const fonte   = reExtract(String.raw`FONTE[:\s]*(\d+)`);
    const pi      = reExtract(String.raw`\bPI[:\s]*([\w\d]+)`);
    const nd      = reExtract(String.raw`\bND[:\s]*(\d+)`);
    const total   = reExtract(String.raw`TOTAL[:\s]*([\d.,]+)`);

    // OBS: texto de observação no rodapé
    const obsI = allText.search(/\bOBS[:\s]/i);
    const obs  = obsI >= 0
      ? allText.slice(obsI + 4).split('\n').slice(0, 3).join(' ').trim()
      : '';

    return {
      ok: true,
      numero, localEntrega, compradora, data,
      fornecedorNome, fornecedorCNPJ,
      items,
      pag, contrato, iL, ugCred, codemp,
      licit, ptres, fonte, pi, nd, total, obs,
    };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

// ── Volta para a lista (history.back) ────────────────────────────────────────
export function silomsVoltar() {
  window.history.back();
  return { ok: true };
}
