/**
 * Alteração de empenho já emitido no CNET (reforço, anulação e os "irrisórios"):
 *   Minutas de Empenho → pesquisar a NE → Ações › Alterar Empenho
 *   → Adicionar Alteração do empenho → Subelemento (Tipo Operação + valor/qtd)
 *   → Passivo Anterior → Finalizar (Emitir Empenho SIAFI — igual à Etapa 8)
 *
 * Funções executadas no mundo MAIN da página via chrome.scripting — cada uma
 * precisa ser autocontida (é serializada).
 */

/** Está na lista "Minutas de Empenho"? E o link do menu para ela, se houver. */
export function paginaMinutas() {
  const txt = s => String(s ?? '').replace(/\s+/g, ' ').trim();
  const titulo = txt(document.querySelector('.content-header h1, section.content-header, h1')?.textContent);
  const temAdicionar = !!document.querySelector('a[href*="buscacompra"]') ||
    Array.from(document.querySelectorAll('a')).some(a => /adicionar\s+minuta/i.test(a.textContent ?? ''));
  const naLista = /minutas?\s+de\s+empenho/i.test(titulo) && temAdicionar && !!document.querySelector('table');
  const menu = Array.from(document.querySelectorAll('a[href]'))
    .find(a => /\/empenho\/minuta\/?(?:[?#]|$)/i.test(a.getAttribute('href') ?? '') || /^minutas?(\s+de\s+empenho)?$/i.test(txt(a.textContent)));
  return { naLista, menuHref: menu?.href ?? null, titulo, url: location.href };
}

/**
 * Pesquisa a NE na lista de minutas e devolve o endereço de "Alterar Empenho"
 * da linha dela. Sem a linha: diz se há filtro a remover ("Remover filtros").
 */
export async function buscarNEnaLista(ne) {
  const dorme = ms => new Promise(r => setTimeout(r, ms));
  const txt = s => String(s ?? '').replace(/\s+/g, ' ').trim();
  const $ = window.jQuery || window.$;

  const campo = document.querySelector('.dataTables_filter input, #datatable_search_stack input, input[type="search"]');
  const tabela = document.querySelector('table.dataTable, #crudTable, table');
  let porApi = false;
  try {
    if ($ && $.fn?.dataTable && tabela && $.fn.dataTable.isDataTable(tabela)) {
      $(tabela).DataTable().search(ne).draw();
      porApi = true;
    }
  } catch (e) { /* segue pelo campo */ }
  if (campo) {
    campo.focus();
    campo.value = ne;
    for (const ev of ['input', 'keyup', 'change']) campo.dispatchEvent(new Event(ev, { bubbles: true }));
  } else if (!porApi) {
    return { ok: false, error: 'campo "Pesquisar" da lista de minutas não encontrado' };
  }

  // Linha da NE (a busca é no servidor: espera a tabela redesenhar)
  let linha = null;
  for (let t = 0; t < 20000 && !linha; t += 500) {
    await dorme(500);
    // Tabela redesenhada sem resultado ("Nenhum registro"): não adianta esperar mais
    const vazia = Array.from(document.querySelectorAll('table tbody tr'))
      .some(tr => tr.cells.length === 1 && /nenhum|sem\s+registro|no\s+(data|matching)/i.test(tr.textContent ?? ''));
    if (vazia && t >= 2500) break;
    const linhas = Array.from(document.querySelectorAll('table tbody tr')).filter(tr => tr.cells.length > 1);
    const comNE = linhas.filter(tr => txt(tr.textContent).includes(ne));
    // Célula que é exatamente a NE (Mensagem SIAFI) primeiro
    linha = comNE.find(tr => Array.from(tr.cells).some(td => txt(td.textContent) === ne)) ?? comNE[0] ?? null;
  }
  if (!linha) {
    const remover = Array.from(document.querySelectorAll('a, button')).find(b => /remover\s+filtros/i.test(b.textContent ?? '') && b.offsetParent !== null);
    return { ok: false, removerFiltros: !!remover, error: `NE ${ne} não apareceu na lista de minutas` };
  }

  const achaAlterar = raiz => Array.from(raiz.querySelectorAll('a')).find(a => /^alterar\s+empenho$/i.test(txt(a.textContent)));
  let alterar = achaAlterar(linha);
  if (!alterar) {
    // Menu de Ações ainda fechado (ou desenhado fora da linha): abre e procura
    linha.querySelector('.dropdown-toggle, [data-toggle="dropdown"], [data-bs-toggle="dropdown"]')?.click();
    await dorme(500);
    alterar = achaAlterar(linha) ?? Array.from(document.querySelectorAll('.dropdown-menu a')).find(a => /^alterar\s+empenho$/i.test(txt(a.textContent)) && a.offsetParent !== null);
  }
  if (!alterar) return { ok: false, error: `a linha da NE ${ne} não tem "Alterar Empenho" no menu de Ações` };
  const href = alterar.getAttribute('href') ?? '';
  if (href && !/^(#|javascript:)/i.test(href)) return { ok: true, href: alterar.href };
  alterar.click();
  return { ok: true, clicou: true };
}

/** Clica "Remover filtros" da lista (o filtro de ano pode esconder a NE). */
export function removerFiltros() {
  const b = Array.from(document.querySelectorAll('a, button')).find(x => /remover\s+filtros/i.test(x.textContent ?? '') && x.offsetParent !== null);
  if (!b) return { ok: false };
  const href = b.getAttribute('href') ?? '';
  if (href && !/^(#|javascript:)/i.test(href)) return { ok: true, href: b.href };
  b.click();
  return { ok: true, clicou: true };
}

/** Na lista "Alteração do empenho": endereço de "Adicionar Alteração do empenho". */
export function adicionarAlteracao() {
  const txt = s => String(s ?? '').replace(/\s+/g, ' ').trim();
  const titulo = txt(document.querySelector('.content-header h1, section.content-header, h1')?.textContent);
  const btn = Array.from(document.querySelectorAll('a, button')).find(b => /adicionar\s+altera/i.test(txt(b.textContent)));
  if (!btn) return { ok: false, error: `botão "Adicionar Alteração do empenho" não encontrado (tela: ${titulo || location.pathname})` };
  const href = btn.getAttribute('href') ?? '';
  if (btn.tagName === 'A' && href && !/^(#|javascript:)/i.test(href)) return { ok: true, href: btn.href };
  btn.click();
  return { ok: true, clicou: true };
}

/**
 * Tela Subelemento da alteração: Tipo Operação de cada item, valor (ou quantidade)
 * e Próxima Etapa. `a` = { operacao: 'ANULAÇÃO' | 'REFORÇO' | 'REFORÇO IRRISÓRIO' |
 * 'ANULAÇÃO SALDO IRRISÓRIO', valor, itens: [{ numeroItem, valor, quantidade }], irrisorio }.
 */
export async function alteracaoSubelementoRunner(a) {
  const dorme = ms => new Promise(r => setTimeout(r, ms));
  const norm = s => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim().toUpperCase();
  const num = s => {
    const t = String(s ?? '').trim().replace(/\s/g, '').replace(/^R\$/, '');
    if (!t) return NaN;
    return t.includes(',') ? parseFloat(t.replace(/\./g, '').replace(',', '.')) : parseFloat(t);
  };
  const brl = v => v.toFixed(2).replace('.', ',');
  const $ = window.jQuery || window.$;
  const alvo = norm(a.operacao);

  // Itens: linhas com o select de Tipo Operação
  const ehSelectOperacao = s => Array.from(s.options).some(o => /^(ANULACAO|REFORCO)/.test(norm(o.text)));
  let linhas = [];
  for (let t = 0; t < 15000; t += 500) {
    linhas = Array.from(document.querySelectorAll('table tbody tr')).filter(tr => Array.from(tr.querySelectorAll('select')).some(ehSelectOperacao));
    if (linhas.length) break;
    await dorme(500);
  }
  if (!linhas.length) return { ok: false, error: 'Não achei os itens com "Tipo Operação" na tela da alteração' };

  const coluna = (tr, re) => {
    const ths = Array.from(tr.closest('table')?.querySelectorAll('thead th') ?? []);
    const i = ths.findIndex(th => re.test((th.textContent ?? '').replace(/\s+/g, ' ').trim()));
    return i >= 0 ? tr.cells[i] : null;
  };
  const numeroDa = tr => parseInt((coluna(tr, /^N[úu]mero$|^N\.?\s*Item$/i)?.textContent ?? '').replace(/\D/g, ''), 10) ||
    parseInt(tr.querySelector('input[name="numero_item[]"]')?.value ?? '', 10) || NaN;

  // Que linha recebe que valor
  const itens = (a.itens ?? []).filter(it => num(it.valor) > 0 || num(it.quantidade) > 0);
  const pares = [];
  const semNumero = it => !String(it.numeroItem ?? '').replace(/\D/g, '');
  if (!itens.length || (itens.length === 1 && semNumero(itens[0]))) {
    const it = itens[0] ?? { valor: a.valor };
    if (linhas.length > 1 && !a.irrisorio) {
      return { ok: false, error: `A NE tem ${linhas.length} itens (${linhas.map(numeroDa).join(', ')}) e a solicitação não diz qual — informe o N.Item na revisão` };
    }
    pares.push([linhas[0], it]);
  } else {
    for (const it of itens) {
      const n = parseInt(String(it.numeroItem ?? '').replace(/\D/g, ''), 10);
      const tr = linhas.find(l => numeroDa(l) === n);
      if (!tr) return { ok: false, error: `Item ${it.numeroItem} não está na NE (itens dela: ${linhas.map(numeroDa).join(', ')})` };
      pares.push([tr, it]);
    }
  }

  const preencher = (input, valor) => {
    input.focus();
    if ($) $(input).val(valor).trigger('input').trigger('keyup').trigger('change');
    else {
      input.value = valor;
      for (const ev of ['input', 'keyup', 'change']) input.dispatchEvent(new Event(ev, { bubbles: true }));
    }
    input.blur();
  };

  const feitos = [];
  let digitado = 0;
  for (const [tr, it] of pares) {
    const rotulo = Number.isNaN(numeroDa(tr)) ? 'item' : `item ${String(numeroDa(tr)).padStart(5, '0')}`;
    // Linha recolhida (DataTables Responsive): os campos ficam na linha-filha
    const controle = tr.cells[0];
    const ehControle = controle && (controle.getAttribute('tabindex') === '0' || controle.classList.contains('dtr-control'));
    if (ehControle && !tr.classList.contains('parent') && !tr.nextElementSibling?.classList.contains('child')) {
      controle.click();
      await dorme(400);
    }

    // 1. Tipo Operação: opção exata ("ANULAÇÃO" ≠ "ANULAÇÃO SALDO IRRISÓRIO")
    const sel = Array.from(tr.querySelectorAll('select')).find(ehSelectOperacao);
    const op = Array.from(sel.options).find(o => norm(o.text) === alvo);
    if (!op) return { ok: false, error: `"${a.operacao}" não existe no Tipo Operação do ${rotulo} (opções: ${Array.from(sel.options).map(o => o.text.trim()).join(' | ')})` };
    if ($) $(sel).val(op.value).trigger('change');
    else { sel.value = op.value; sel.dispatchEvent(new Event('change', { bubbles: true })); }
    await dorme(700);
    if (sel.value !== op.value) return { ok: false, error: `Não consegui escolher "${a.operacao}" no ${rotulo}` };

    // 2. Campos da linha (e da linha-filha): "Valor da Alteração" e "Qtd"
    const filha = tr.nextElementSibling?.classList.contains('child') ? tr.nextElementSibling : null;
    const campoEm = (re, nomeRe) => {
      const cel = coluna(tr, re);
      const naCel = cel?.querySelector('input:not([type="hidden"])');
      if (naCel) return naCel;
      for (const li of filha?.querySelectorAll('li') ?? []) {
        if (re.test((li.querySelector('.dtr-title')?.textContent ?? '').trim())) {
          const i = li.querySelector('input:not([type="hidden"])');
          if (i) return i;
        }
      }
      return [tr, filha].filter(Boolean).flatMap(el => Array.from(el.querySelectorAll('input:not([type="hidden"])')))
        .find(i => nomeRe.test(`${i.name} ${i.id}`) && !i.closest('.select2-container')) ?? null;
    };
    const vrInput = campoEm(/^Valor\s+da\s+Altera/i, /valor_?altera|vr_?altera|vlr_?altera/i);
    const qtdInput = campoEm(/^Qtd\.?$/i, /^(qtd|quantidade)(\[\])?\s|qtd_?altera|qtditem/i);
    const aberto = i => i && !i.disabled && !i.readOnly;

    const valor = num(it.valor) > 0 ? num(it.valor) : num(a.valor);
    const unit = num(coluna(tr, /^Valor\s*Unit/i)?.textContent);
    if (aberto(vrInput) && valor > 0) {
      preencher(vrInput, brl(valor));
      await dorme(500);
    } else if (aberto(qtdInput)) {
      let qtd = num(it.quantidade);
      if (!(qtd > 0) && valor > 0 && unit > 0) qtd = Math.round((valor / unit) * 100000) / 100000;
      if (!(qtd > 0)) return { ok: false, error: `Sem quantidade para o ${rotulo} (só o campo Qtd está aberto)` };
      preencher(qtdInput, String(qtd).replace('.', ','));
      await dorme(500);
    } else {
      const campos = [tr, filha].filter(Boolean).flatMap(el => Array.from(el.querySelectorAll('input,select'))).map(e => `${e.name || e.id || e.type}${e.disabled ? '(desab.)' : ''}`).join(', ');
      return { ok: false, error: `Depois de escolher "${a.operacao}", nenhum campo de valor/quantidade abriu no ${rotulo} (campos: ${campos})` };
    }

    const vrTela = num(vrInput?.value), qtdTela = num(qtdInput?.value);
    if (!(vrTela > 0) && !(qtdTela > 0)) return { ok: false, error: `Valor/quantidade do ${rotulo} ficaram zerados depois de digitar` };
    digitado += vrTela > 0 ? vrTela : (qtdTela > 0 && unit > 0 ? qtdTela * unit : valor);
    feitos.push(`${rotulo}: ${a.operacao}${vrTela > 0 ? `, valor ${vrInput.value}` : ''}${qtdTela > 0 ? `, qtd ${qtdInput.value}` : ''}`);
  }

  await dorme(500);
  const btn = document.querySelector('button.submeter') ||
    Array.from(document.querySelectorAll('button, a.btn')).find(b => /pr[óo]xima/i.test(b.textContent ?? ''));
  if (!btn) return { ok: false, error: 'Botão "Próxima Etapa" não encontrado na tela da alteração' };
  btn.click();
  return { ok: true, feitos, digitado: Math.round(digitado * 100) / 100 };
}

/** Passivo Anterior: avança (se a tela já é a de emitir, nada a fazer). */
export function alteracaoPassivo() {
  const emitir = Array.from(document.querySelectorAll('button, a.btn, input[type="submit"]'))
    .some(b => /Emitir\s+Empenho/i.test(String(b.textContent || b.value || '')));
  if (emitir) return { ok: true, jaNoFinal: true };
  const btn = document.querySelector('button.submeter') ||
    Array.from(document.querySelectorAll('button, a.btn')).find(b => /pr[óo]xima/i.test(b.textContent ?? ''));
  if (!btn) return { ok: false, error: 'Botão "Próxima Etapa" não encontrado no Passivo Anterior da alteração' };
  btn.click();
  return { ok: true };
}
