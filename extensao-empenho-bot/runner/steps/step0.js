/**
 * step0.js — Pré-navegação: Minuta → BuscaCompra → Selecionar Contrato
 *
 * Estas funções são serializadas via chrome.scripting.executeScript (não podem importar).
 * O stateMachine orquestra as chamadas e aguarda a navegação entre cada fase.
 */

/**
 * Clica em "Adicionar Minuta de Empenho" na lista de minutas.
 */
export function step0ClickAdicionarMinuta() {
  // Tenta por href (mais confiável)
  let btn = document.querySelector('a[href*="buscacompra"]');
  if (!btn) {
    btn = Array.from(document.querySelectorAll('a'))
      .find(a => (a.textContent ?? '').trim().toLowerCase().includes('adicionar minuta'));
  }
  if (!btn) {
    const links = Array.from(document.querySelectorAll('a.btn, a.ladda-button'))
      .map(a => `"${a.textContent?.trim()}"[${a.href}]`).join('; ');
    return {
      ok: false,
      error: `"Adicionar Minuta de Empenho" não encontrado. Links btn disponíveis: ${links.slice(0, 300)}`,
    };
  }
  btn.click();
  return { ok: true };
}

/**
 * Preenche o formulário de busca no buscacompra e submete.
 * @param {string} contrato — Número do contrato, ex: "010/2026"
 */
export function step0PesquisarContrato(contrato) {
  const partes   = (contrato ?? '').split('/');
  const numero   = partes[0]?.replace(/\D/g, '') ?? '';
  const ano      = partes[1]?.trim() ?? '';

  // Tenta campos separados primeiro (número + ano)
  const inputNumero =
    document.querySelector('input[name*="numero_contrato"], input[id*="numero_contrato"]') ||
    document.querySelector('input[name*="contrato"],       input[id*="contrato"]')         ||
    document.querySelector('input[placeholder*="ontrato" i]')                              ||
    document.querySelector('input[name*="numero"],         input[id*="numero"]')           ||
    document.querySelector('input[type="text"]:not([type="hidden"]):not([type="submit"])');

  if (!inputNumero) {
    const allInputs = Array.from(document.querySelectorAll('input'))
      .map(i => `${i.type}[name=${i.name},id=${i.id}]`).join('; ');
    return { ok: false, error: `Campo de pesquisa não encontrado. Inputs: ${allInputs.slice(0, 300)}` };
  }

  const inputAno =
    document.querySelector('input[name*="ano_contrato"], input[id*="ano_contrato"]') ||
    document.querySelector('input[name*="ano"],          input[id*="ano"]');

  function setVal(el, v) {
    el.focus();
    el.value = v;
    el.dispatchEvent(new Event('input',  { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }

  if (inputAno && ano) {
    setVal(inputNumero, numero);
    setVal(inputAno, ano);
  } else {
    // Campo único: coloca NNN/ANO completo, ou só NNN como fallback
    setVal(inputNumero, contrato || numero);
  }

  const btnSubmit =
    document.querySelector('button[type="submit"]')                               ||
    document.querySelector('input[type="submit"]')                                ||
    document.querySelector('button[id*="pesquisar" i], button[id*="buscar" i]')  ||
    document.querySelector('button.btn-primary')                                  ||
    document.querySelector('button.btn');

  if (btnSubmit) { btnSubmit.click(); return { ok: true }; }

  const form = inputNumero.closest('form');
  if (form) { form.submit(); return { ok: true, method: 'form.submit' }; }

  return { ok: false, error: 'Botão de pesquisa não encontrado na página buscacompra.' };
}

/**
 * Seleciona o contrato correto nos resultados da busca.
 * @param {string} contrato — ex: "010/2026"
 */
export function step0SelecionarContrato(contrato) {
  const numero = (contrato ?? '').split('/')[0].replace(/\D/g, '');

  const rows = document.querySelectorAll('table tbody tr');
  if (!rows.length) {
    const snippet = (document.body.textContent ?? '').slice(0, 400);
    return { ok: false, error: `Tabela de resultados não encontrada para "${contrato}". Conteúdo: ${snippet}` };
  }

  // Encontra a linha que contém o número do contrato; fallback = primeira linha
  let targetRow = null;
  for (const row of rows) {
    if ((row.textContent ?? '').includes(numero)) { targetRow = row; break; }
  }
  if (!targetRow) targetRow = rows[0];

  // Clica no link/botão de seleção da linha
  const clickEl =
    targetRow.querySelector('a[href*="empenho"], a[href*="etapa"]') ||
    targetRow.querySelector('a, button');

  if (!clickEl) {
    return {
      ok: false,
      error: `Linha "${numero}" encontrada mas sem link de seleção. HTML: ${targetRow.innerHTML.slice(0, 300)}`,
    };
  }

  clickEl.click();
  return { ok: true };
}
