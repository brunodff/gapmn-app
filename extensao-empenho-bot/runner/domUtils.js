/**
 * Utilitários DOM executados no contexto MAIN da página (via chrome.scripting.executeScript).
 * Têm acesso a window.jQuery, window.$, window.select2, etc.
 *
 * ATENÇÃO: estas funções são serializadas e injetadas na página via func:.
 * Não podem usar imports nem closures sobre variáveis externas.
 * Recebem tudo via parâmetros.
 */

/**
 * Aguarda um elemento ou predicado com MutationObserver + polling.
 * @param {string|Function} target - seletor CSS ou função () => boolean
 * @param {number} timeout - ms (default 20000)
 * @returns {Promise<Element|true>}
 */
export async function waitFor(target, timeout = 20000) {
  const check = typeof target === 'string'
    ? () => document.querySelector(target)
    : target;

  const found = check();
  if (found) return found;

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      observer.disconnect();
      reject(new Error(`waitFor timeout: ${typeof target === 'string' ? target : 'predicate'}`));
    }, timeout);

    const observer = new MutationObserver(() => {
      const el = check();
      if (el) {
        clearTimeout(timer);
        observer.disconnect();
        resolve(el);
      }
    });

    observer.observe(document.body, { childList: true, subtree: true, attributes: true });
  });
}

/**
 * Preenche um <input> disparando eventos reais (para Laravel/jQuery ouvintes).
 */
export function fillInput(selector, value) {
  const el = document.querySelector(selector);
  if (!el) return false;
  el.focus();
  el.value = value;
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
  el.blur();
  return true;
}

/**
 * Define valor em um select2 "from array" (opções já no DOM).
 * Usa jQuery do próprio site.
 */
export function setSelect2Array(selector, value) {
  const $ = window.jQuery || window.$;
  if (!$) return false;
  const $el = $(selector);
  if (!$el.length) return false;
  $el.val(value).trigger('change');
  return true;
}

/**
 * Define valor em um select2 AJAX pesquisando pelo termo.
 * Aguarda os resultados aparecerem e clica na primeira opção correspondente.
 * @param {string} selector - ex: '#select2_ajax_unidade_origem_id'
 * @param {string} searchTerm - ex: '120630'
 * @param {string|null} exactMatch - se fornecido, valida que o resultado contém esse texto
 */
export async function setSelect2Ajax(selector, searchTerm, exactMatch = null) {
  const $ = window.jQuery || window.$;
  if (!$) return { ok: false, error: 'jQuery não disponível na página' };

  const $select = $(selector);
  if (!$select.length) return { ok: false, error: `Elemento não encontrado: ${selector}` };

  // Abre o dropdown
  $select.select2('open');
  await new Promise(r => setTimeout(r, 300));

  // Digita no campo de busca
  const searchInput = document.querySelector('.select2-search__field, .select2-container--open input[type="search"]');
  if (!searchInput) return { ok: false, error: 'Campo de busca do select2 não encontrado' };

  searchInput.value = searchTerm;
  searchInput.dispatchEvent(new Event('input', { bubbles: true }));
  searchInput.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true }));

  // Aguarda resultados
  const resultsAppeared = await new Promise(resolve => {
    let waited = 0;
    const poll = setInterval(() => {
      const opts = document.querySelectorAll('.select2-results__option:not(.select2-results__option--loading):not(.select2-results__option--load-more)');
      waited += 200;
      if (opts.length > 0 || waited > 8000) {
        clearInterval(poll);
        resolve(opts.length > 0);
      }
    }, 200);
  });

  if (!resultsAppeared) return { ok: false, error: `Sem resultados para "${searchTerm}"` };

  // Seleciona a opção correta
  const opts = document.querySelectorAll('.select2-results__option');
  let target = null;
  for (const opt of opts) {
    if (opt.classList.contains('select2-results__option--disabled')) continue;
    if (!exactMatch || opt.textContent?.includes(exactMatch)) {
      target = opt;
      break;
    }
  }

  if (!target) return { ok: false, error: `Nenhuma opção contém "${exactMatch ?? searchTerm}"` };

  target.click();
  await new Promise(r => setTimeout(r, 300));
  return { ok: true };
}

/**
 * Configura paginação de DataTable para o maior valor disponível ("Todos" ou 100).
 */
export function datatableMaxPageSize(tableContainerSelector = 'body') {
  const lengthSelect = document.querySelector(
    `${tableContainerSelector} select[name*="_length"], select[name*="_length"]`
  );
  if (!lengthSelect) return false;
  const options = Array.from(lengthSelect.options);
  // Prefere valor -1 (Todos) ou o maior numérico
  const best = options.find(o => o.value === '-1') ?? options.reduce((a, b) =>
    parseInt(b.value) > parseInt(a.value) ? b : a
  );
  if (best) {
    lengthSelect.value = best.value;
    lengthSelect.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  }
  return false;
}

/**
 * Pesquisa em um DataTable usando o campo de busca.
 * @param {string} query - texto para pesquisar
 */
export async function datatableSearch(query) {
  const searchInput = document.querySelector('.dataTables_filter input[type="search"]');
  if (!searchInput) return false;
  searchInput.focus();
  searchInput.value = query;
  searchInput.dispatchEvent(new Event('input', { bubbles: true }));
  searchInput.dispatchEvent(new Event('keyup', { bubbles: true }));
  // Aguarda DataTable processar
  await new Promise(r => setTimeout(r, 600));
  return true;
}

/**
 * Limpa o campo de busca do DataTable.
 */
export async function datatableClearSearch() {
  const searchInput = document.querySelector('.dataTables_filter input[type="search"]');
  if (!searchInput) return false;
  searchInput.value = '';
  searchInput.dispatchEvent(new Event('input', { bubbles: true }));
  searchInput.dispatchEvent(new Event('keyup', { bubbles: true }));
  await new Promise(r => setTimeout(r, 400));
  return true;
}

/**
 * Detecta o número da etapa atual pelo stepper (#rowCabecalho).
 * Retorna 1-8 baseado em qual círculo tem classe de "ativo/completo".
 * Fallback: tenta detectar pelo título da página.
 */
export function detectCurrentStep() {
  const circles = document.querySelectorAll('#rowCabecalho .circulo');
  if (!circles.length) return null;

  // Estratégia: círculos com estilo diferente = ativo ou completo
  for (let i = 0; i < circles.length; i++) {
    const style = window.getComputedStyle(circles[i]);
    const bgColor = style.backgroundColor;
    // Círculo ativo costuma ter cor de destaque (não cinza)
    // Sem saber o HTML das páginas seguintes, usamos uma heurística:
    // o último círculo que tem classe diferente dos outros = etapa atual
    if (circles[i].classList.length > 1 || circles[i].closest('.btn-app')?.classList.length > 2) {
      return i + 1;
    }
  }

  // Fallback: URL pode indicar a etapa
  const url = window.location.href;
  if (url.includes('buscacompra')) return 1;
  if (url.includes('fornecedor'))  return 2;
  if (url.includes('itens'))       return 3;
  if (url.includes('credito'))     return 4;
  if (url.includes('subelemento')) return 5;
  if (url.includes('empenho'))     return 6;
  if (url.includes('passivo'))     return 7;
  if (url.includes('finalizar'))   return 8;

  return null;
}

/**
 * Clica no botão "Próxima Etapa" (button.submeter).
 */
export function clickProxima() {
  const btn = document.querySelector('button.submeter, button[type="button"].btn-success');
  if (!btn) return false;
  btn.click();
  return true;
}

/**
 * Delay com jitter aleatório (simula comportamento humano).
 * @param {number} min - ms mínimo (default 300)
 * @param {number} max - ms máximo (default 800)
 */
export async function humanDelay(min = 300, max = 800) {
  const ms = min + Math.random() * (max - min);
  await new Promise(r => setTimeout(r, ms));
}
