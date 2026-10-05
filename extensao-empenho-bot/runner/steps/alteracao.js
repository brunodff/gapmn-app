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
 * Lista "Alteração do empenho" da NE: Mensagem SIAFI e Situação de cada alteração.
 * Depois de "Emitir Empenho SIAFI" o CNET volta para esta lista — a alteração nova
 * é a linha a mais com "EMPENHO EMITIDO" (a Mensagem SIAFI traz o número da NE).
 */
export async function lerListaAlteracoes() {
  const dorme = ms => new Promise(r => setTimeout(r, ms));
  const txt = s => String(s ?? '').replace(/\s+/g, ' ').trim();
  const titulo = txt(document.querySelector('.content-header h1, section.content-header, h1')?.textContent);
  const temAdicionar = Array.from(document.querySelectorAll('a, button')).some(b => /adicionar\s+altera/i.test(txt(b.textContent)));
  if (!/altera[çc][ãa]o\s+do\s+empenho/i.test(titulo) || !temAdicionar) return { naLista: false, titulo, url: location.href };

  // O DataTables pode carregar as linhas depois (AJAX)
  for (let t = 0; t < 6000; t += 300) {
    const processando = Array.from(document.querySelectorAll('.dataTables_processing'))
      .some(e => getComputedStyle(e).display !== 'none' && e.offsetParent !== null);
    if (!processando && document.querySelector('table tbody tr')) break;
    await dorme(300);
  }
  const linhas = [];
  for (const tabela of document.querySelectorAll('table')) {
    const ths = Array.from(tabela.querySelectorAll('thead th')).map(th => txt(th.textContent));
    const iMsg = ths.findIndex(t => /^mensagem\s+siafi$/i.test(t));
    const iSit = ths.findIndex(t => /^situa[çc][ãa]o$/i.test(t));
    if (iMsg < 0 || iSit < 0) continue;
    for (const tr of tabela.querySelectorAll('tbody tr')) {
      if (tr.classList.contains('child') || tr.cells.length <= Math.max(iMsg, iSit)) continue;
      linhas.push({ mensagem: txt(tr.cells[iMsg].textContent), situacao: txt(tr.cells[iSit].textContent) });
    }
  }
  return { naLista: true, linhas, url: location.href.split('#')[0] };
}

/**
 * Tela Subelemento da alteração: Tipo Operação de cada item, valor (ou quantidade)
 * e Próxima Etapa. `a` = { operacao: 'ANULAÇÃO' | 'REFORÇO' | 'REFORÇO IRRISÓRIO' |
 * 'ANULAÇÃO SALDO IRRISÓRIO', operacaoIrrisoria, valor, itens: [{ numeroItem, valor,
 * quantidade }], irrisorio }.
 *
 * Arredondamento: o SIAFI aceita a quantidade com 5 casas e recusa (ER0462) valor
 * diferente de quantidade × unitário. O robô já digita o valor "para menos" (quantidade
 * truncada em 5 casas × unitário) — não depende do modal do CNET — e devolve o que
 * faltou, para o irrisório logo depois da emissão. Menos de um "degrau" (o valor nem
 * chega a 0,00001 de quantidade): vai inteiro como irrisório.
 */
export async function alteracaoSubelementoRunner(a) {
  try {
    return await alteracaoSubelemento(a);
  } catch (e) {
    // Erro dentro da página (ex.: um script do CNET ao trocar o Tipo Operação):
    // devolve o motivo em vez de "Script não retornou"
    return { ok: false, error: `erro na tela da alteração: ${e?.message ?? e}` };
  }

  async function alteracaoSubelemento(a) {
    const dorme = ms => new Promise(r => setTimeout(r, ms));
    const norm = s => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim().toUpperCase();
    const num = s => {
      const t = String(s ?? '').trim().replace(/\s/g, '').replace(/^R\$/, '');
      if (!t) return NaN;
      return t.includes(',') ? parseFloat(t.replace(/\./g, '').replace(',', '.')) : parseFloat(t);
    };
    const cent = v => Math.round(v * 100) / 100;
    const cent5 = v => Math.round(v * 1e5) / 1e5;
    const brl = v => v.toFixed(2).replace('.', ',');
    const $ = window.jQuery || window.$;

    // Dispara o evento sem deixar um erro do script da página derrubar o robô
    const disparar = (el, eventos) => {
      for (const ev of eventos) {
        try { if ($) $(el).trigger(ev); else el.dispatchEvent(new Event(ev, { bubbles: true })); }
        catch (e) { try { el.dispatchEvent(new Event(ev, { bubbles: true })); } catch (e2) { /* segue */ } }
      }
    };
    const preencher = (input, valor) => {
      try { input.focus(); } catch (e) { /* segue */ }
      input.value = valor;
      disparar(input, ['input', 'keyup', 'change']);
      try { input.blur(); } catch (e) { /* segue */ }
    };

    // Tabela recolhida (DataTables Responsive, tela estreita): ao abrir a linha, as
    // células escondidas — Tipo Operação, Qtd, Valor da Alteração — MUDAM para a
    // linha-filha (tr.child). Tudo da linha é procurado nela e na filha.
    const filhaDe = tr => (tr.nextElementSibling?.classList.contains('child') ? tr.nextElementSibling : null);
    const naLinha = (tr, css) => [tr, filhaDe(tr)].filter(Boolean).flatMap(el => Array.from(el.querySelectorAll(css)));
    const tituloLi = li => (li.querySelector('.dtr-title')?.textContent ?? '').replace(/\s+/g, ' ').trim().replace(/:$/, '');

    // Itens: linhas com o select de Tipo Operação
    const ehSelectOperacao = s => Array.from(s.options).some(o => /^(ANULACAO|REFORCO)/.test(norm(o.text)));
    let linhas = [];
    for (let t = 0; t < 15000; t += 500) {
      linhas = Array.from(document.querySelectorAll('table tbody tr'))
        .filter(tr => !tr.classList.contains('child') && naLinha(tr, 'select').some(ehSelectOperacao));
      if (linhas.length) break;
      await dorme(500);
    }
    if (!linhas.length) {
      const titulo = (document.querySelector('.content-header h1, section.content-header, h1')?.textContent ?? '').replace(/\s+/g, ' ').trim();
      const selects = Array.from(document.querySelectorAll('select')).slice(0, 4)
        .map(s => `[${Array.from(s.options).slice(0, 5).map(o => o.text.trim()).join(' / ')}]`).join(' ');
      const aviso = (document.querySelector('.alert, .callout, .alert-danger, .alert-warning')?.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 140);
      return {
        ok: false, semOperacao: true,
        error: `o CNET não mostrou o "Tipo Operação" dos itens (tela: ${titulo || location.pathname}${aviso ? `; aviso: ${aviso}` : ''}${selects ? `; seletores: ${selects}` : ''})`,
      };
    }

    const coluna = (tr, re) => {
      const ths = Array.from(tr.closest('table')?.querySelectorAll('thead th') ?? []);
      const i = ths.findIndex(th => re.test((th.textContent ?? '').replace(/\s+/g, ' ').trim()));
      return i >= 0 ? tr.cells[i] : null;
    };
    // Texto da coluna: na célula ou, com a linha aberta, no item da linha-filha
    const textoColuna = (tr, re) => {
      const t = (coluna(tr, re)?.textContent ?? '').trim();
      if (t) return t;
      const li = Array.from(filhaDe(tr)?.querySelectorAll('li') ?? []).find(l => re.test(tituloLi(l)));
      return (li?.querySelector('.dtr-data')?.textContent ?? '').trim();
    };
    const numeroDa = tr => parseInt(textoColuna(tr, /^N[úu]mero$|^N\.?\s*Item$/i).replace(/\D/g, ''), 10) ||
      parseInt(naLinha(tr, 'input[name="numero_item[]"]')[0]?.value ?? '', 10) || NaN;

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

    const feitos = [], restos = [];
    let pedido = 0, feito = 0, degrau = 0, arredondou = false, irrisorioDireto = false;
    for (const [tr, it] of pares) {
      const rotulo = Number.isNaN(numeroDa(tr)) ? 'item' : `item ${String(numeroDa(tr)).padStart(5, '0')}`;
      const unit = num(textoColuna(tr, /^Valor\s*Unit/i));
      // Linha recolhida (DataTables Responsive): abre — os campos vão para a linha-filha
      const controle = tr.cells[0];
      const ehControle = controle && (controle.getAttribute('tabindex') === '0' || controle.classList.contains('dtr-control'));
      if (ehControle && !tr.classList.contains('parent') && !tr.nextElementSibling?.classList.contains('child')) {
        controle.click();
        await dorme(400);
      }

      // Plano do valor: o pedido, ou o "para menos" se a quantidade não fecha em 5 casas
      const valor = num(it.valor) > 0 ? num(it.valor) : num(a.valor);
      let digitar = valor, operacao = a.operacao, qtdPlano = NaN;
      if (!a.irrisorio && valor > 0 && unit > 0) {
        const q = valor / unit;
        const exato = Math.abs(q * 1e5 - Math.round(q * 1e5)) < 1e-6;
        const q5 = Math.floor(q * 1e5 + 1e-9) / 1e5;
        const menos = cent(q5 * unit), mais = cent((q5 + 0.00001) * unit);
        if (!exato && (Math.abs(menos - valor) < 0.005 || Math.abs(mais - valor) < 0.005)) {
          qtdPlano = Math.abs(menos - valor) < 0.005 ? q5 : cent5(q5 + 0.00001);   // fecha nos centavos
        } else if (!exato) {
          degrau += cent(mais - menos);
          if (menos > 0) { digitar = menos; qtdPlano = q5; arredondou = true; }
          else if (a.operacaoIrrisoria) { operacao = a.operacaoIrrisoria; irrisorioDireto = true; }   // nem um degrau: tudo irrisório
        } else {
          qtdPlano = Math.round(q * 1e5) / 1e5;
        }
      }
      pedido += valor > 0 ? valor : 0;

      // 1. Tipo Operação: opção exata ("ANULAÇÃO" ≠ "ANULAÇÃO SALDO IRRISÓRIO")
      const sel = naLinha(tr, 'select').find(ehSelectOperacao);
      if (!sel) {
        const campos = naLinha(tr, 'input,select').map(e => e.name || e.id || e.type).join(', ');
        return { ok: false, error: `o "Tipo Operação" do ${rotulo} sumiu da linha depois de abri-la (campos: ${campos || 'nenhum'})` };
      }
      const alvo = norm(operacao);
      const op = Array.from(sel.options).find(o => norm(o.text) === alvo);
      if (!op) return { ok: false, error: `"${operacao}" não existe no Tipo Operação do ${rotulo} (opções: ${Array.from(sel.options).map(o => o.text.trim()).join(' | ')})` };
      sel.value = op.value;
      disparar(sel, ['change']);
      await dorme(700);
      if (sel.value !== op.value) return { ok: false, error: `Não consegui escolher "${operacao}" no ${rotulo}` };

      // 2. Campos da linha (e da linha-filha): "Valor da Alteração" e "Qtd"
      const filha = filhaDe(tr);
      const campoEm = (re, nomeRe) => {
        const cel = coluna(tr, re);
        const naCel = cel?.querySelector('input:not([type="hidden"])');
        if (naCel) return naCel;
        for (const li of filha?.querySelectorAll('li') ?? []) {
          if (re.test(tituloLi(li))) {
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

      if (aberto(vrInput) && digitar > 0) {
        preencher(vrInput, brl(digitar));
        await dorme(500);
      } else if (aberto(qtdInput)) {
        // Só quantidade: a do PDF ou a do valor, truncada em 5 casas
        let qtd = num(it.quantidade);
        if (!(qtd > 0)) qtd = qtdPlano > 0 ? qtdPlano : (valor > 0 && unit > 0 ? Math.floor((valor / unit) * 1e5 + 1e-9) / 1e5 : NaN);
        if (!(qtd > 0)) return { ok: false, error: `Sem quantidade para o ${rotulo} (só o campo Qtd está aberto)` };
        preencher(qtdInput, String(qtd).replace('.', ','));
        if (unit > 0) { const v = cent(qtd * unit); if (Math.abs(v - valor) >= 0.01) arredondou = true; digitar = v; }
        await dorme(500);
      } else {
        const campos = [tr, filha].filter(Boolean).flatMap(el => Array.from(el.querySelectorAll('input,select'))).map(e => `${e.name || e.id || e.type}${e.disabled ? '(desab.)' : ''}`).join(', ');
        return { ok: false, error: `Depois de escolher "${operacao}", nenhum campo de valor/quantidade abriu no ${rotulo} (campos: ${campos})` };
      }

      const vrTela = num(vrInput?.value), qtdTela = num(qtdInput?.value);
      if (!(vrTela > 0) && !(qtdTela > 0)) return { ok: false, error: `Valor/quantidade do ${rotulo} ficaram zerados depois de digitar` };
      feito += vrTela > 0 ? vrTela : digitar;
      // O que este item deixou para o irrisório
      const resto = cent(valor - (vrTela > 0 ? vrTela : digitar));
      if (!a.irrisorio && resto >= 0.01) restos.push({ numeroItem: Number.isNaN(numeroDa(tr)) ? null : numeroDa(tr), valor: resto });
      feitos.push(`${rotulo}: ${operacao}${vrTela > 0 ? `, valor ${vrInput.value}` : ''}${qtdTela > 0 ? `, qtd ${qtdInput.value}` : ''}` +
        (digitar !== valor && !irrisorioDireto ? ` (pedido R$ ${brl(valor)}: "para menos", o resto vai de irrisório)` : '') +
        (operacao !== a.operacao ? ' (valor menor que o arredondamento: tudo como irrisório)' : ''));
    }

    await dorme(500);
    const btn = document.querySelector('button.submeter') ||
      Array.from(document.querySelectorAll('button, a.btn')).find(b => /pr[óo]xima/i.test(b.textContent ?? ''));
    if (!btn) return { ok: false, error: 'Botão "Próxima Etapa" não encontrado na tela da alteração' };
    btn.click();
    return { ok: true, feitos, pedido: cent(pedido), digitado: cent(feito), degrau: cent(degrau), arredondou, irrisorioDireto, restos };
  }
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
