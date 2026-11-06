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

  // Linhas de item: as que têm o select de subelemento (não a linha-filha, que
  // pode ter campos da linha de cima)
  let linhas = [];
  for (let t = 0; t < 15000; t += 500) {
    linhas = Array.from(document.querySelectorAll('table tbody tr')).filter(tr => !tr.classList.contains('child') && tr.querySelector('select'));
    if (linhas.length) break;
    await dorme(500);
  }
  if (!linhas.length) return { ok: false, error: 'Nenhum item carregado na Etapa 5' };

  // Tela estreita (DataTables Responsive): as colunas escondidas e os campos delas
  // vão para a linha-filha, logo abaixo. Campo ou valor procurado só na linha some.
  const filhaDe = tr => (tr.nextElementSibling?.classList.contains('child') ? tr.nextElementSibling : null);
  const textoDe = el => (el?.textContent ?? '').replace(/\s+/g, ' ').trim();
  function colunaPorCabecalho(tr, re) {
    const ths = Array.from(tr.closest('table')?.querySelectorAll('thead th') ?? []);
    const i = ths.findIndex(th => re.test(textoDe(th)));
    const cel = i >= 0 ? tr.cells[i] : null;
    if (textoDe(cel)) return cel;
    const filha = filhaDe(tr);
    const li = filha && ((i >= 0 ? filha.querySelector(`li[data-dt-column="${i}"]`) : null) ??
      Array.from(filha.querySelectorAll('li')).find(l => re.test(textoDe(l.querySelector('.dtr-title')))));
    return li?.querySelector('.dtr-data') ?? li ?? cel;
  }

  // Trava: a Natureza da Despesa dos itens vem da linha de crédito da Etapa 4
  const ndAlvo = String(p.nd ?? '').replace(/\D/g, '');
  if (ndAlvo) {
    for (const tr of linhas) {
      const nd = (colunaPorCabecalho(tr, /^Natureza/i)?.textContent ?? '').replace(/\D/g, '');
      if (nd && !nd.startsWith(ndAlvo)) {
        return { ok: false, error: `A linha de crédito escolhida tem ND ${nd}, mas a solicitação pede ${ndAlvo}. Volte à Etapa 4 no CNET, marque a linha com ND ${ndAlvo}, clique em Próxima Etapa e use Retomar.` };
      }
    }
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
    // 0. Expande a linha (DataTables Responsive): o Valor Total calculado e, em tela
    // estreita, os campos do item ficam na linha-filha. O controle é a 1ª célula
    // ("Material", tabindex="0").
    const controle = tr.cells[0];
    const ehControle = controle && (controle.getAttribute('tabindex') === '0' || controle.classList.contains('dtr-control'));
    const expandida = tr.classList.contains('parent') || !!filhaDe(tr);
    if (ehControle && !expandida) {
      controle.click();
      await dorme(400);
    }

    const naLinha = sel => tr.querySelector(sel) ?? filhaDe(tr)?.querySelector(sel) ?? null;
    const cid = naLinha('input[name="contrato_item_id[]"]')?.value ?? '';
    const porId = prefixo => (cid ? document.getElementById(prefixo + cid) : null);

    // Nº do item: campo oculto (contrato) ou coluna "Número"/"N. Item" (compra)
    const numItem =
      parseInt(naLinha('input[name="numero_item[]"]')?.value ?? '', 10) ||
      parseInt((colunaPorCabecalho(tr, /^(N[úu]mero|N\.?\s*Item)$/i)?.textContent ?? '').replace(/\D/g, ''), 10) ||
      NaN;
    const rotulo = Number.isNaN(numItem) ? 'item' : `item ${String(numItem).padStart(5, '0')}`;
    const semNumero = it => !String(it.numeroItem ?? '').replace(/\D/g, '');
    // Item da solicitação sem nº (contrato): vale só se for o único dos dois lados
    const empItem = itensEmp.find(it => parseInt(String(it.numeroItem ?? '').replace(/\D/g, ''), 10) === numItem) ??
      (!compra && itensEmp.length === 1 && linhas.length === 1 && semNumero(itensEmp[0]) ? itensEmp[0] : undefined);

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

    // Preço unitário pela coluna "Valor Unit." (não pelo último número da linha,
    // que é o Valor Total do Item), na linha ou na linha-filha; senão um campo com o
    // unitário; senão Valor Total do Item ÷ Qtd. de Item
    const unit = (() => {
      const u = num(colunaPorCabecalho(tr, /^(Valor|Vlr\.?|Pre[çc]o)\s*Unit/i)?.textContent);
      if (u > 0) return u;
      const campo = num((porId('valor_unitario') ?? porId('vlr_unitario') ??
        naLinha('input[name*="unitario" i], input[id*="unitario" i], input[name*="vlr_unit" i]'))?.value);
      if (campo > 0) return campo;
      const totItem = num(colunaPorCabecalho(tr, /^Valor\s*Total\s*do\s*Item/i)?.textContent) || num(porId('valor_total_item')?.value);
      const qtdItem = num(colunaPorCabecalho(tr, /^Qtd\.?\s*d[eo]\s*Item/i)?.textContent);
      return totItem > 0 && qtdItem > 0 ? totItem / qtdItem : NaN;
    })();
    let valor = num(empItem?.valor);
    const fmt = v => v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 4 });
    const campos = () => [tr, filhaDe(tr)].filter(Boolean).flatMap(el => Array.from(el.querySelectorAll('input,select')))
      .map(e => e.name || e.id || e.type).join(', ');

    // 2a. COMPRA: trabalha com a QUANTIDADE do item (coluna QUANT do PDF); o
    // CNET calcula o valor. Digitada como no uso manual ("100"), sem chamar
    // funções da página — "100,00000" + calculaVrTotal() deixava o campo vazio.
    if (compra) {
      const qtdCampo = naLinha('input[name="qtd[]"]') ?? naLinha('input[name*="qtd" i]');
      if (!qtdCampo) {
        const campos = Array.from(tr.querySelectorAll('input,select')).map(e => e.name || e.id || e.type).join(', ');
        return { ok: false, error: `Campo Qtd não encontrado no ${rotulo} (campos da linha: ${campos})` };
      }
      let qtd = num(empItem?.quantidade);
      if (!(qtd > 0) && valor > 0 && unit > 0) qtd = Math.round((valor / unit) * 100000) / 100000;
      if (!(qtd > 0)) return { ok: false, error: `Sem quantidade para o ${rotulo} — preencha a Qtd na revisão.` };

      const qtdTexto = Number.isInteger(qtd) ? String(qtd) : String(qtd).replace('.', ',');
      qtdCampo.focus();
      if ($) $(qtdCampo).val(qtdTexto).trigger('input').trigger('keyup').trigger('change');
      else {
        qtdCampo.value = qtdTexto;
        for (const ev of ['input', 'keyup', 'change']) qtdCampo.dispatchEvent(new Event(ev, { bubbles: true }));
      }
      qtdCampo.blur();
      await dorme(600);

      if (!(num(qtdCampo.value) > 0)) {
        return { ok: false, error: `O CNET não aceitou a quantidade ${qtdTexto} no ${rotulo} (o campo ficou "${qtdCampo.value}")` };
      }
      // Confere o Valor Total que o CNET calculou (na linha ou na linha-filha expandida)
      const filha = tr.nextElementSibling?.classList.contains('child') ? tr.nextElementSibling : null;
      const totalTela = [tr, filha].filter(Boolean)
        .flatMap(el => Array.from(el.querySelectorAll('input[name="valor_total[]"]')))
        .map(i => num(i.value)).find(v => v > 0);
      if (valor > 0 && totalTela > 0 && Math.abs(totalTela - valor) > 0.01) {
        return {
          ok: false,
          error: `Qtd ${qtdTexto} × ${unit} deu R$ ${totalTela.toFixed(2)} no CNET, mas a solicitação é R$ ${valor.toFixed(2)} — confira Qtd e valor na revisão.`,
        };
      }
      feitos.push(`${rotulo}: sub ${subCod}, qtd ${qtdCampo.value}${totalTela > 0 ? `, total R$ ${totalTela.toFixed(2)}` : ''}`);
      continue;
    }

    // 2b. CONTRATO: valor a empenhar é o do item na revisão. Sem itens na
    // solicitação, vale o total dela, mas só com um único item marcado. Nunca o
    // "valor total do item" do contrato: é o saldo inteiro, não o que foi pedido.
    const vrInput  = porId('vrtotal') ?? naLinha('input[id^="vrtotal"]');
    // Só um campo de quantidade de verdade: "o último campo de texto da linha" já
    // pegou outro campo, e a quantidade ficava zerada ou com a do contrato inteiro
    const qtdInput = porId('qtditem') ?? naLinha('input[id^="qtditem"], input[name*="qtd" i], input[name*="quant" i]');
    if (Number.isNaN(valor)) {
      if (!itensEmp.length && linhas.length === 1) {
        valor = num(p.total);
      } else {
        return {
          ok: false,
          error: itensEmp.some(semNumero)
            ? `A solicitação não diz qual item do contrato empenhar e há ${linhas.length} itens marcados no CNET — informe o N.Item na revisão.`
            : itensEmp.length
            ? `O ${rotulo} está marcado no CNET mas não está na solicitação (N.Item na revisão: ${itensEmp.map(i => i.numeroItem).join(', ')}). Corrija o N.Item na revisão.`
            : `A solicitação não traz o valor de cada item e há ${linhas.length} itens marcados no CNET — informe N.Item e valor de cada item na revisão.`,
        };
      }
    }
    if (!(valor > 0)) return { ok: false, error: `Sem valor a empenhar para o ${rotulo} — preencha o valor na revisão.` };
    if (!vrInput && !qtdInput) return { ok: false, error: `Campos de quantidade e valor do ${rotulo} não encontrados (campos da linha: ${campos()})` };

    // Casas decimais e separador que o campo de quantidade usa ("0,00000" → 5 com
    // vírgula); o degrau dessas casas é a folga entre quantidade × unitário e o valor
    const qtdAntes = String(qtdInput?.value ?? '').trim();
    const ponto = /^\d+\.\d+$/.test(qtdAntes);
    const casas = (qtdAntes.split(ponto ? '.' : ',')[1] ?? '').length || 4;
    const folga = Math.max(0.01, (unit > 0 ? unit / 10 ** casas : 0) + 0.005);
    const totalPelaQtd = () => (qtdInput && unit > 0 ? num(qtdInput.value) * unit : NaN);

    if (vrInput) {
      preencher(vrInput, valor.toFixed(2).replace('.', ','));
      if (typeof window.calculaQuantidade === 'function') window.calculaQuantidade(vrInput);
      await dorme(400);
    }
    // Quantidade zerada ou que não dá o valor pedido (o CNET pode trazer a do contrato
    // inteiro): quantidade = valor ÷ unitário
    if (qtdInput && (!(num(qtdInput.value) > 0) || Math.abs(totalPelaQtd() - valor) > folga)) {
      if (!(unit > 0)) return { ok: false, error: `Não achei o Valor Unit. do ${rotulo} para calcular a quantidade (campos da linha: ${campos()})` };
      const q = (valor / unit).toFixed(casas);
      preencher(qtdInput, ponto ? q : q.replace('.', ','));
      if (typeof window.calculaVrTotal === 'function') window.calculaVrTotal(qtdInput);
      await dorme(300);
    }

    // Confere antes de avançar: o CNET recusa quantidade zero ("A quantidade
    // selecionada não pode ser zero") e quantidade × unitário tem de dar o valor pedido
    const qtdFinal = qtdInput ? num(qtdInput.value) : NaN;
    const vrFinal  = vrInput ? num(vrInput.value) : NaN;
    if (qtdInput ? !(qtdFinal > 0) : !(vrFinal > 0)) {
      return { ok: false, error: `Quantidade/valor do ${rotulo} ficaram zerados (campos da linha: ${campos()})` };
    }
    const pelaQtd = qtdFinal > 0 && unit > 0;
    const totalTela = pelaQtd ? qtdFinal * unit : vrFinal;
    if (totalTela > 0 && Math.abs(totalTela - valor) > folga) {
      return {
        ok: false,
        error: `O ${rotulo} ficou com ${pelaQtd ? `qtd ${qtdInput.value} × unit. R$ ${fmt(unit)} = ` : ''}R$ ${fmt(totalTela)} na tela, ` +
          `mas a solicitação pede R$ ${fmt(valor)} — confira o N.Item e o valor na revisão`,
      };
    }
    feitos.push(`${rotulo}: sub ${subCod}, qtd ${qtdInput?.value ?? '-'}${unit > 0 ? ` × R$ ${fmt(unit)}` : ''}${vrInput ? `, valor ${vrInput.value}` : ''}`);
  }

  await dorme(600);
  const btn =
    document.querySelector('button.submeter') ||
    Array.from(document.querySelectorAll('button')).find(b => b.textContent?.trim().includes('Próxima'));
  if (!btn) return { ok: false, error: 'Botão "Próxima Etapa" não encontrado na Etapa 5' };
  btn.click();
  return { ok: true, feitos };
}
