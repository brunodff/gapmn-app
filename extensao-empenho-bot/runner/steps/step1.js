/**
 * Etapa 1 — Contrato/Compra
 *
 * Seletores baseados no HTML real capturado (Julho/2026):
 *   #opc_compra, #opc_contrato, #modalidade_id, #numero_ano,
 *   #select2_ajax_unidade_origem_id, button.submeter
 *
 * Esta função é serializada e executada no mundo MAIN da página
 * (tem acesso a window.jQuery, window.$, select2).
 */
export async function executeStep1(payload) {
  // ── helpers inline (não podem importar) ──────────────────────────────────

  function fillInput(selector, value) {
    const el = document.querySelector(selector);
    if (!el) return false;
    el.focus();
    el.value = value;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  }

  function setSelect2Array(selector, value) {
    const $ = window.jQuery || window.$;
    if (!$ || !$(selector).length) return false;
    $(selector).val(value).trigger('change');
    return true;
  }

  async function setSelect2Ajax(selector, searchTerm, matchText) {
    const $ = window.jQuery || window.$;
    if (!$) return { ok: false, error: 'jQuery ausente' };
    const $el = $(selector);
    if (!$el.length) return { ok: false, error: `${selector} não encontrado` };

    $el.select2('open');
    await new Promise(r => setTimeout(r, 400));

    const si = document.querySelector('.select2-search__field, .select2-container--open input[type="search"]');
    if (!si) return { ok: false, error: 'Campo de busca select2 não encontrado' };

    si.value = searchTerm;
    si.dispatchEvent(new Event('input', { bubbles: true }));
    si.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true }));

    // Aguarda resultados (até 8s)
    const found = await new Promise(resolve => {
      let waited = 0;
      const p = setInterval(() => {
        waited += 300;
        const opts = document.querySelectorAll(
          '.select2-results__option:not(.select2-results__option--loading)'
        );
        if (opts.length > 0 || waited > 8000) { clearInterval(p); resolve(opts.length > 0); }
      }, 300);
    });

    if (!found) return { ok: false, error: `Sem resultados para "${searchTerm}"` };

    const opts = document.querySelectorAll('.select2-results__option');
    let target = null;
    for (const o of opts) {
      if (o.classList.contains('select2-results__option--disabled')) continue;
      if (!matchText || o.textContent?.includes(matchText)) { target = o; break; }
    }

    if (!target) return { ok: false, error: `Opção "${matchText ?? searchTerm}" não encontrada nos resultados` };

    target.click();
    await new Promise(r => setTimeout(r, 400));
    return { ok: true };
  }

  async function humanDelay(min = 300, max = 700) {
    await new Promise(r => setTimeout(r, min + Math.random() * (max - min)));
  }

  // ── Lógica da Etapa 1 ────────────────────────────────────────────────────

  const { tipoOrigem, modalidade, numeroCompra, contrato, unidadeCompra = '120630' } = payload;

  // 1. Selecionar o tipo de empenho
  const tipoRadio = tipoOrigem === 'contrato'
    ? document.getElementById('opc_contrato')
    : document.getElementById('opc_compra');

  if (!tipoRadio) {
    return { ok: false, step: 1, error: 'Radio de tipo não encontrado — verifique se está na Etapa 1' };
  }

  tipoRadio.click();
  await humanDelay();

  // 2. Modalidade (select2 array — opções já estão no DOM)
  if (tipoOrigem !== 'contrato') {
    if (!modalidade) {
      return { ok: false, step: 1, error: 'Modalidade não definida — defina na tela de conferência', needsInput: 'modalidade' };
    }
    const ok = setSelect2Array('#modalidade_id', modalidade);
    if (!ok) return { ok: false, step: 1, error: 'Select de modalidade não encontrado' };
    await humanDelay();
  }

  // 3. Número / Ano da compra
  if (tipoOrigem !== 'contrato') {
    if (!numeroCompra) {
      return { ok: false, step: 1, error: 'Número da compra não definido', needsInput: 'numeroCompra' };
    }
    const ok = fillInput('#numero_ano', numeroCompra);
    if (!ok) return { ok: false, step: 1, error: 'Input #numero_ano não encontrado' };
    await humanDelay();
  }

  // 4. Contrato (select2 AJAX — busca pelo "NNN/ANO", aceita 1ª opção)
  if (tipoOrigem === 'contrato' && contrato) {
    const r = await setSelect2Ajax('#select2_ajax_id', contrato, null);
    if (!r.ok) return { ok: false, step: 1, error: `Contrato: ${r.error}` };
    await humanDelay();
  }

  // 5. Unidade Compradora (select2 AJAX — busca por código)
  if (tipoOrigem !== 'contrato') {
    const r = await setSelect2Ajax('#select2_ajax_unidade_origem_id', unidadeCompra, unidadeCompra);
    if (!r.ok) {
      // Não-fatal: pode já estar pré-selecionada
      console.warn('[EmpenhoBot] Unidade Compra não selecionada via AJAX:', r.error);
    }
    await humanDelay();
  }

  // 6. Clicar Próxima Etapa
  const btn =
    document.querySelector('button.submeter') ||
    Array.from(document.querySelectorAll('button')).find(b => b.textContent?.trim().includes('Próxima'));
  if (!btn) return { ok: false, step: 1, error: 'Botão "Próxima Etapa" não encontrado' };
  btn.click();

  return { ok: true, step: 1, done: true };
}

/**
 * Stub para executar via chrome.scripting.executeScript.
 * Serializa o executeStep1 acima e chama com o payload.
 * Background.js usa: { func: step1Runner, args: [payload] }
 */
export async function step1Runner(payload) {
  // Inline copy of executeStep1 (necessário porque executeScript serializa a função)
  // Este arquivo é importado pelo background; a função real será passada via func:

  function fillInput(sel, val) {
    const el = document.querySelector(sel);
    if (!el) return false;
    el.focus(); el.value = val;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  }

  function setSelect2Array(sel, val) {
    const $ = window.jQuery || window.$;
    if (!$ || !$(sel).length) return false;
    $(sel).val(val).trigger('change');
    return true;
  }

  async function setSelect2Ajax(sel, term, match) {
    const $ = window.jQuery || window.$;
    if (!$) return { ok: false, error: 'jQuery ausente' };
    const $el = $(sel);
    if (!$el.length) return { ok: false, error: `${sel} não encontrado` };

    $el.select2('open');
    await new Promise(r => setTimeout(r, 500));

    const si = document.querySelector('.select2-search__field, .select2-container--open input[type="search"]');
    if (!si) return { ok: false, error: 'campo busca não encontrado' };

    // Limpa e digita o termo para disparar a busca AJAX
    si.value = '';
    si.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise(r => setTimeout(r, 200));
    si.value = term;
    si.dispatchEvent(new Event('input', { bubbles: true }));
    si.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true }));

    // Aguarda resultados carregarem (loading desaparecer)
    const found = await new Promise(res => {
      let w = 0;
      const p = setInterval(() => {
        w += 300;
        const loading = document.querySelectorAll('.select2-results__option--loading');
        const ready  = document.querySelectorAll('.select2-results__option:not(.select2-results__option--loading):not(.select2-results__option--disabled)');
        if ((loading.length === 0 && ready.length > 0) || w > 10000) { clearInterval(p); res(ready.length > 0); }
      }, 300);
    });
    if (!found) return { ok: false, error: `sem resultados para "${term}"` };

    await new Promise(r => setTimeout(r, 300));

    // Seleciona a opção correta (match) ou a primeira disponível
    // match pode ser texto direto OU CNPJ (14 dígitos) — compara sem formatação
    const opts = document.querySelectorAll('.select2-results__option:not(.select2-results__option--loading):not(.select2-results__option--disabled)');
    let target = null;
    if (match) {
      const matchDigits = match.replace(/\D/g, '');
      const useCnpj = matchDigits.length >= 11; // CNPJ tem 14 dígitos
      for (const o of opts) {
        const txt = o.textContent ?? '';
        if (useCnpj
          ? txt.replace(/\D/g, '').includes(matchDigits)   // comparação por dígitos
          : txt.includes(match)) {                           // comparação textual normal
          target = o; break;
        }
      }
    }
    if (!target) target = opts[0];
    if (!target) return { ok: false, error: 'nenhuma opção disponível após busca' };

    // select2 v4 precisa de mousedown+mouseup+click para registrar a seleção
    target.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
    await new Promise(r => setTimeout(r, 80));
    target.dispatchEvent(new MouseEvent('mouseup',   { bubbles: true, cancelable: true }));
    target.dispatchEvent(new MouseEvent('click',     { bubbles: true, cancelable: true }));

    await new Promise(r => setTimeout(r, 500));
    return { ok: true };
  }

  async function hd(a = 300, b = 700) { await new Promise(r => setTimeout(r, a + Math.random() * (b - a))); }

  const { tipoOrigem, modalidade, numeroCompra, contrato, unidadeCompra = '120630', fornecedorCnpj = '' } = payload;

  const radioEl = tipoOrigem === 'contrato'
    ? document.getElementById('opc_contrato')
    : document.getElementById('opc_compra');
  if (!radioEl) return { ok: false, step: 1, error: 'Radio tipo não encontrado — confirme que está na Etapa 1' };

  radioEl.click(); await hd();

  if (tipoOrigem !== 'contrato') {
    if (!modalidade) return { ok: false, step: 1, error: 'Modalidade não definida', needsInput: 'modalidade' };
    setSelect2Array('#modalidade_id', modalidade); await hd();
    if (!numeroCompra) return { ok: false, step: 1, error: 'Número compra ausente', needsInput: 'numeroCompra' };
    fillInput('#numero_ano', numeroCompra); await hd();
    const ru = await setSelect2Ajax('#select2_ajax_unidade_origem_id', unidadeCompra, unidadeCompra);
    if (!ru.ok) console.warn('[EmpenhoBot] Unidade Compra:', ru.error);
    await hd();
  } else if (contrato) {
    // Busca por "NNN/20" (número + prefixo do século) para retornar contratos de vários anos,
    // depois seleciona pelo CNPJ do fornecedor (remove formatação na comparação).
    // Ex: "034/2025" → busca "034/20" → seleciona linha que contém "07503890000101"
    const numRaw = /^(\d+)/.exec(contrato ?? '')?.[1] ?? ''; // mantém zeros à esquerda: "034"
    const searchTerm = numRaw ? numRaw + '/20' : contrato;
    const rc = await setSelect2Ajax('#select2_ajax_id', searchTerm, fornecedorCnpj || null);
    if (!rc.ok) return { ok: false, step: 1, error: `Contrato: ${rc.error}` };
    await hd();
  }

  const btn =
    document.querySelector('button.submeter') ||
    Array.from(document.querySelectorAll('button')).find(b => b.textContent?.trim().includes('Próxima'));
  if (!btn) return { ok: false, step: 1, error: 'Botão Próxima Etapa não encontrado' };
  btn.click();
  return { ok: true, step: 1, done: true };
}
