/**
 * Etapa 5 — Subelemento e quantidade/valor de cada item.
 *
 * Executada no mundo MAIN da página via chrome.scripting — precisa ser
 * autocontida (a função é serializada).
 *
 * No contrato cada linha tem um id oculto (contrato_item_id[]) usado para achar
 * os campos por id (subitem-<id>, vrtotal<id>, qtditem<id>). Na compra esse id
 * não existe; os campos são procurados dentro da própria linha.
 */
export async function step5Runner(p) {
  const dorme = ms => new Promise(r => setTimeout(r, ms));
  const num = s => {
    const t = String(s ?? '').trim().replace(/\s/g, '');
    if (!t) return NaN;
    // "1.234,56" / "1234,56" (BR) ou "110.2000" (ponto decimal)
    return t.includes(',') ? parseFloat(t.replace(/\./g, '').replace(',', '.')) : parseFloat(t);
  };
  const $ = window.jQuery || window.$;
  const compra = p.tipoOrigem === 'compra';
  const itensEmp = p.itensEmpenho ?? [];

  // Linhas de item: as que têm o select de subelemento
  let linhas = [];
  for (let t = 0; t < 15000; t += 500) {
    linhas = Array.from(document.querySelectorAll('table tbody tr')).filter(tr => tr.querySelector('select'));
    if (linhas.length) break;
    await dorme(500);
  }
  if (!linhas.length) return { ok: false, error: 'Nenhum item carregado na Etapa 5' };

  function colunaPorCabecalho(tr, re) {
    const ths = Array.from(tr.closest('table')?.querySelectorAll('thead th') ?? []);
    const i = ths.findIndex(th => re.test((th.textContent ?? '').replace(/\s+/g, ' ').trim()));
    return i >= 0 ? tr.cells[i] : null;
  }

  function preencher(input, valor) {
    input.focus();
    input.value = valor;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    input.blur();
  }

  const feitos = [];
  for (const tr of linhas) {
    const cid = tr.querySelector('input[name="contrato_item_id[]"]')?.value ?? '';
    const porId = prefixo => (cid ? document.getElementById(prefixo + cid) : null);
    const naLinha = sel => tr.querySelector(sel);

    // Nº do item: campo oculto (contrato) ou coluna "Número"/"N. Item" (compra)
    const numItem =
      parseInt(naLinha('input[name="numero_item[]"]')?.value ?? '', 10) ||
      parseInt((colunaPorCabecalho(tr, /^(N[úu]mero|N\.?\s*Item)$/i)?.textContent ?? '').replace(/\D/g, ''), 10) ||
      NaN;
    const rotulo = Number.isNaN(numItem) ? 'item' : `item ${String(numItem).padStart(5, '0')}`;
    const empItem = itensEmp.find(it => parseInt(String(it.numeroItem ?? '').replace(/\D/g, ''), 10) === numItem);

    if (compra && itensEmp.length && !empItem) {
      return { ok: false, error: `O ${rotulo} está na tela mas não na solicitação (N.Item na revisão: ${itensEmp.map(i => i.numeroItem).join(', ')}).` };
    }

    // 1. Subelemento (select2) — o do item, senão o da solicitação; "00" = manter o padrão
    const subCod = String(empItem?.subelemento || p.subelemento || '').replace(/\D/g, '').padStart(2, '0');
    const sel = porId('subitem-') ?? naLinha('select');
    if (subCod && subCod !== '00' && sel) {
      const op = Array.from(sel.options).find(o => new RegExp(`^\\s*${subCod}\\s*-`).test(o.text));
      if (!op) {
        const disp = Array.from(sel.options).map(o => o.text.trim().slice(0, 30)).join(' | ');
        return { ok: false, error: `Subelemento ${subCod} não existe para o ${rotulo}. Opções: ${disp}` };
      }
      if ($) $(sel).val(op.value).trigger('change');
      else { sel.value = op.value; sel.dispatchEvent(new Event('change', { bubbles: true })); }
      await dorme(300);
      if (sel.value !== op.value) return { ok: false, error: `Não consegui selecionar o subelemento ${subCod} no ${rotulo}` };
    }

    // 2. Valor a empenhar: o do item na revisão; no contrato, sem ele, o valor total do item
    const vrInput  = porId('vrtotal') ?? naLinha('input[id^="vrtotal"]');
    const qtdInput = porId('qtditem') ?? naLinha('input[id^="qtditem"], input[name*="qtd" i], input[name*="quant" i]')
      ?? Array.from(tr.querySelectorAll('input[type="text"], input:not([type])')).filter(i => i !== vrInput).pop();
    let valor = num(empItem?.valor);
    if (Number.isNaN(valor) && !compra) valor = num((porId('valor_total_item') ?? naLinha('input[id^="valor_total_item"]'))?.value);
    if (!(valor > 0)) return { ok: false, error: `Sem valor a empenhar para o ${rotulo} — preencha o valor na revisão.` };

    // Preço unitário pela coluna "Valor Unit." (não pelo último número da linha,
    // que é o Valor Total do Item)
    const unit = num(colunaPorCabecalho(tr, /^Valor\s*Unit/i)?.textContent);

    if (vrInput) {
      preencher(vrInput, valor.toFixed(2).replace('.', ','));
      if (typeof window.calculaQuantidade === 'function') window.calculaQuantidade(vrInput);
      await dorme(400);
    }
    if (qtdInput && !(num(qtdInput.value) > 0)) {
      if (!(unit > 0)) return { ok: false, error: `Não achei o Valor Unit. do ${rotulo} para calcular a quantidade` };
      // Mantém o nº de casas decimais que o campo usa ("0,00000" → 5)
      const casas = (String(qtdInput.value).split(',')[1] ?? '').length || 4;
      preencher(qtdInput, (valor / unit).toFixed(casas).replace('.', ','));
      if (typeof window.calculaVrTotal === 'function') window.calculaVrTotal(qtdInput);
      await dorme(300);
    }

    // Confere: não avança com quantidade/valor zerados
    const qtdFinal = qtdInput ? num(qtdInput.value) : NaN;
    const vrFinal  = vrInput ? num(vrInput.value) : NaN;
    if (!(qtdFinal > 0) && !(vrFinal > 0)) {
      const campos = Array.from(tr.querySelectorAll('input,select')).map(e => e.name || e.id || e.type).join(', ');
      return { ok: false, error: `Quantidade/valor do ${rotulo} ficaram zerados (campos da linha: ${campos})` };
    }
    feitos.push(`${rotulo}: sub ${subCod}, qtd ${qtdInput?.value ?? '-'}${vrInput ? `, valor ${vrInput.value}` : ''}`);
  }

  await dorme(600);
  const btn =
    document.querySelector('button.submeter') ||
    Array.from(document.querySelectorAll('button')).find(b => b.textContent?.trim().includes('Próxima'));
  if (!btn) return { ok: false, error: 'Botão "Próxima Etapa" não encontrado na Etapa 5' };
  btn.click();
  return { ok: true, feitos };
}
