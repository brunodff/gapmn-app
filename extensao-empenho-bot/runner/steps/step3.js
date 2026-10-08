/**
 * Etapa 3 — Itens da compra/contrato.
 *
 * Executada no mundo MAIN da página via chrome.scripting (precisa ser autocontida,
 * sem imports nem referências externas — a função é serializada).
 */
export async function step3Runner(itens, tipoOrigem) {
  const dorme = ms => new Promise(r => setTimeout(r, ms));
  const soDigitos = s => parseInt(String(s ?? '').replace(/\D/g, ''), 10);

  // Checkboxes das linhas de item. O nome do campo muda entre contrato
  // (contrato_item_id) e compra, então não depende dele: pega os checkboxes do
  // corpo da tabela, preferindo os que tenham "item" no nome/id.
  function caixasDeItem() {
    const todas = Array.from(document.querySelectorAll('table tbody input[type="checkbox"]'))
      .filter(cb => cb.id !== 'selectAll' && cb.closest('tr'));
    const comItem = todas.filter(cb => /item/i.test(`${cb.name} ${cb.id}`));
    return comItem.length ? comItem : todas;
  }

  // Coluna "N. Item" pelo cabeçalho da tabela da própria linha.
  function numeroDoItem(tr) {
    const tabela = tr.closest('table');
    const ths = Array.from(tabela?.querySelectorAll('thead th') ?? []);
    const idx = ths.findIndex(th => /^\s*N\.?\s*Item/i.test(th.textContent ?? ''));
    const celulas = Array.from(tr.cells);
    const alvo = idx >= 0 && celulas[idx] ? celulas[idx] : celulas.find(c => /^\s*\d{3,6}\s*$/.test(c.textContent ?? ''));
    return alvo ? soDigitos(alvo.textContent) : NaN;
  }

  // Itens carregam via AJAX (DataTable) — aguarda até 20s
  let caixas = [];
  for (let t = 0; t < 20000; t += 500) {
    caixas = caixasDeItem();
    if (caixas.length) break;
    await dorme(500);
  }

  if (!caixas.length) {
    if (document.querySelector('.dataTables_empty')) {
      return { ok: false, error: 'Nenhum item disponível (sem saldo ou vigência expirada)' };
    }
    const vistos = Array.from(document.querySelectorAll('input[type="checkbox"]'))
      .map(c => c.name || c.id || '(sem nome)').slice(0, 6).join(', ') || 'nenhum';
    return { ok: false, error: `Itens não carregaram em 20s — verifique a página (checkboxes vistos: ${vistos})` };
  }

  // Ainda em mais de uma página (a tabela carregou depois do ajuste, ou o seletor não
  // tem "Todos"): pela API do DataTables mostra todas as linhas antes de procurar
  const paginada = () => !!document.querySelector('.dataTables_paginate .next:not(.disabled)');
  if (paginada()) {
    const $ = window.jQuery || window.$;
    try {
      for (const t of $.fn.dataTable.tables()) {
        const api = $(t).DataTable();
        if (api.page.info().pages > 1) api.page.len(-1).draw();
      }
    } catch (_) { /* sem a API */ }
    for (let t = 0; t < 10000 && paginada(); t += 500) await dorme(500);
    await dorme(600);
    caixas = caixasDeItem();
  }

  // Coluna pelo cabeçalho da tabela da linha (Descrição, Valor Unit.)
  function coluna(tr, re) {
    const ths = Array.from(tr.closest('table')?.querySelectorAll('thead th') ?? []);
    const i = ths.findIndex(th => re.test((th.textContent ?? '').replace(/\s+/g, ' ').trim()));
    return i >= 0 && tr.cells[i] ? (tr.cells[i].textContent ?? '').replace(/\s+/g, ' ').trim() : '';
  }
  // "1.234,56" / "1234,56" / "110.2000" → número
  const num = s => {
    const t = String(s ?? '').replace(/[^\d.,-]/g, '');
    if (!t) return NaN;
    return t.includes(',') ? parseFloat(t.replace(/\./g, '').replace(',', '.')) : parseFloat(t);
  };
  const palavras = s => new Set(String(s ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase()
    .split(/[^A-Z0-9]+/).filter(w => w.length >= 3 && !/^(COM|PARA|DOS|DAS|QUE|POR|TIPO|UNID|UNIDADE|SERVICO|SERVICOS|MATERIAL)$/.test(w)));
  // Quanto as descrições se parecem (0–1), pela menor: a do PDF costuma vir cortada
  const parecida = (a, b) => {
    const A = palavras(a), B = palavras(b);
    if (!A.size || !B.size) return 0;
    let comum = 0;
    A.forEach(w => { if (B.has(w)) comum++; });
    return comum / Math.min(A.size, B.size);
  };

  const linhas = caixas.map(cb => {
    const tr = cb.closest('tr');
    return { cb, num: numeroDoItem(tr), desc: coluna(tr, /^Descri/i), unit: num(coluna(tr, /^Valor\s*Unit/i)) };
  });
  const disponiveis = linhas.map(l => (Number.isNaN(l.num) ? '?' : String(l.num).padStart(5, '0')));
  const clicar = cb => { if (!cb.checked) cb.click(); };
  const selecionarTodos = () => {
    const all = document.getElementById('selectAll');
    if (all && !all.checked) all.click(); else caixas.forEach(clicar);
  };

  if (itens.length > 0) {
    const faltando = [];
    let marcados = 0;
    for (const it of itens) {
      const alvo = soDigitos(it.numeroItem);
      const linha = Number.isNaN(alvo) ? null : linhas.find(l => l.num === alvo);
      if (linha) { clicar(linha.cb); marcados++; } else faltando.push(String(it.numeroItem ?? '').trim() || '(vazio)');
    }
    if (tipoOrigem === 'compra' && faltando.length) {
      // Numa compra há itens de outros empenhos na mesma lista: marcar "todos"
      // como fallback empenharia itens que não são desta solicitação.
      const info = (document.querySelector('.dataTables_info')?.textContent ?? '').replace(/\s+/g, ' ').trim();
      return {
        ok: false,
        error: `Item ${faltando.join(', ')} não está na lista desta compra para este fornecedor` +
               (paginada() ? ' (a lista do CNET continua em mais de uma página)' : ' (sem saldo, de outro fornecedor ou N.Item errado)') +
               `. Itens disponíveis: ${disponiveis.join(', ')}${info ? ` — ${info}` : ''}. ` +
               `Aborte, corrija o "N.Item" na revisão e inicie de novo.`,
      };
    }
    // CONTRATO: item da solicitação sem N.Item (ou com um nº que o contrato não tem) →
    // acha o item do contrato pelo valor unitário e, sem ele, pela descrição. Marcar
    // todos deixava a Etapa 5 sem saber em qual item pôr o valor.
    const escolhas = [], duvidas = [];
    if (tipoOrigem !== 'compra') {
      const usados = new Set(linhas.filter(l => l.cb.checked));
      itens.forEach((it, i) => {
        const alvo = soDigitos(it.numeroItem);
        if (!Number.isNaN(alvo) && linhas.some(l => l.num === alvo)) return;     // já marcado pelo nº
        const livres = linhas.filter(l => !usados.has(l));
        const unitSol = num(it.valorUnit);
        let escolhida = null, motivo = '';
        const porUnit = unitSol > 0 ? livres.filter(l => Math.abs(l.unit - unitSol) < 0.005) : [];
        const melhorDesc = lista => {
          const r = lista.map(l => ({ l, s: parecida(it.descricao, l.desc) })).sort((a, b) => b.s - a.s);
          return r.length && r[0].s >= 0.6 && (r.length === 1 || r[0].s - r[1].s >= 0.2) ? r[0].l : null;
        };
        if (porUnit.length === 1) { escolhida = porUnit[0]; motivo = 'pelo valor unitário'; }
        else if (porUnit.length > 1) { escolhida = melhorDesc(porUnit); motivo = 'pelo valor unitário e pela descrição'; }
        else if (it.descricao) { escolhida = melhorDesc(livres); motivo = 'pela descrição'; }
        if (!escolhida && linhas.length === 1 && itens.length === 1) { escolhida = linhas[0]; motivo = 'é o único item do contrato'; }
        if (escolhida) {
          clicar(escolhida.cb);
          usados.add(escolhida);
          marcados++;
          escolhas.push({ indice: i, numero: String(escolhida.num).padStart(5, '0'), motivo, desc: escolhida.desc.slice(0, 60),
                          unit: escolhida.unit, pdf: String(it.numeroItem ?? '').trim() });
        } else {
          duvidas.push(it);
        }
      });
      if (duvidas.length) {
        const lista = linhas.map(l => `${Number.isNaN(l.num) ? '?' : String(l.num).padStart(5, '0')} — ${l.desc.slice(0, 45) || 'sem descrição'}` +
          (l.unit > 0 ? ` (unit. R$ ${l.unit.toLocaleString('pt-BR', { minimumFractionDigits: 2 })})` : '')).join('; ');
        return {
          ok: false,
          error: `Não consegui saber qual item do contrato empenhar para ${duvidas.map(d => `"${String(d.descricao || 'item sem descrição').slice(0, 40)}"` +
            (num(d.valorUnit) > 0 ? ` (unit. R$ ${d.valorUnit})` : '')).join(', ')}. Itens do contrato no CNET: ${lista}. Informe o N.Item na revisão.`,
        };
      }
    }
    if (!marcados) selecionarTodos();   // contrato sem itens na solicitação → todos
    if (escolhas.length) {
      await dorme(400);
      const btnE = document.querySelector('button.submeter') || document.querySelector('button.btn-success') ||
        Array.from(document.querySelectorAll('button')).find(b => b.textContent?.trim().includes('Próxima'));
      if (!btnE) return { ok: false, error: 'Botão "Próxima Etapa" não encontrado na Etapa 3' };
      btnE.click();
      return { ok: true, escolhas };
    }
  } else {
    selecionarTodos();
  }

  await dorme(400);

  const btn =
    document.querySelector('button.submeter') ||
    document.querySelector('button.btn-success') ||
    Array.from(document.querySelectorAll('button')).find(b => b.textContent?.trim().includes('Próxima'));
  if (!btn) return { ok: false, error: 'Botão "Próxima Etapa" não encontrado na Etapa 3' };
  btn.click();
  return { ok: true };
}
