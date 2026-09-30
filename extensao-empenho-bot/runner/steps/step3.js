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

  const linhas = caixas.map(cb => ({ cb, num: numeroDoItem(cb.closest('tr')) }));
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
      return {
        ok: false,
        error: `Item ${faltando.join(', ')} não está na lista desta compra. Itens disponíveis: ${disponiveis.join(', ')}. ` +
               `Aborte, corrija o "N.Item" na revisão e inicie de novo.`,
      };
    }
    if (!marcados) selecionarTodos();   // contrato: numeração não bateu → todos
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
