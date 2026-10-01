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
export async function step1Runner(payload) {

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

  // Campo com máscara ("_____/____"): valor direto; se a máscara descartar, API da
  // máscara; por fim, tecla a tecla. A página pode redesenhar o campo: tenta 3 vezes.
  async function preencherMascara(sel, val) {
    const $ = window.jQuery || window.$;
    const alvo = String(val).replace(/\D/g, '');
    const dorme = ms => new Promise(r => setTimeout(r, ms));
    const ok = () => (document.querySelector(sel)?.value ?? '').replace(/\D/g, '') === alvo;
    for (let tentativa = 0; tentativa < 3; tentativa++) {
      const el = document.querySelector(sel);
      if (!el) return false;
      el.focus();
      el.value = val;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      await dorme(300);
      if (ok()) return true;

      if (el.inputmask?.setValue) el.inputmask.setValue(val);
      else if ($) $(el).val(val).trigger('input').trigger('change');
      await dorme(300);
      if (ok()) return true;

      if ($) {
        $(el).val('').trigger('focus');
        for (const ch of alvo) {
          const code = ch.charCodeAt(0);
          $(el).trigger($.Event('keydown', { which: code, keyCode: code }));
          $(el).trigger($.Event('keypress', { which: code, keyCode: code, charCode: code }));
          $(el).trigger($.Event('keyup', { which: code, keyCode: code }));
        }
        await dorme(300);
        if (ok()) return true;
      }
      await dorme(800);
    }
    return ok();
  }

  const { tipoOrigem, modalidade, numeroCompra, contrato, unidadeCompra = '120630', fornecedorCnpj = '' } = payload;

  const radioEl = tipoOrigem === 'contrato'
    ? document.getElementById('opc_contrato')
    : document.getElementById('opc_compra');
  if (!radioEl) return { ok: false, step: 1, error: 'Radio tipo não encontrado — confirme que está na Etapa 1' };

  const numeroLivre = () => { const n = document.querySelector('#numero_ano'); return !!n && !n.disabled && !n.readOnly; };
  async function esperaNumeroLivre(ms) {
    for (let w = 0; w < ms; w += 150) {
      if (numeroLivre()) return true;
      await new Promise(r => setTimeout(r, 150));
    }
    return numeroLivre();
  }

  // Já marcado (o CNET pode lembrar a última escolha): clicar de novo pode alternar os campos
  if (!(radioEl.checked && (tipoOrigem === 'contrato' || numeroLivre()))) {
    radioEl.click(); await hd();
  }

  if (tipoOrigem !== 'contrato') {
    // Os campos da compra só habilitam depois do clique no radio
    if (!await esperaNumeroLivre(3000)) {
      radioEl.click();
      if (!await esperaNumeroLivre(3000)) {
        return { ok: false, step: 1, error: 'O campo Número/Ano da compra está bloqueado — a minuta anterior pode ter ficado aberta. No CNET, finalize a minuta anterior ou clique em "Adicionar Minuta de Empenho", e use Retomar.' };
      }
    }

    // Modalidade: localiza a opção pelo código visível ("05 - Pregão"), não pelo
    // value interno do <option>, que é um id do sistema e pode mudar.
    const cod = /^\s*(\d{1,2})/.exec(modalidade ?? '')?.[1]?.padStart(2, '0');
    if (!cod) return { ok: false, step: 1, error: 'Modalidade não definida', needsInput: 'modalidade' };
    const selMod = document.querySelector('#modalidade_id');
    if (!selMod) return { ok: false, step: 1, error: 'Campo Modalidade (#modalidade_id) não encontrado' };
    const opMod = Array.from(selMod.options).find(o => new RegExp(`^${cod}\\s*-`).test(o.textContent.trim()));
    if (!opMod) {
      const disp = Array.from(selMod.options).map(o => o.textContent.trim()).filter(Boolean).join(' | ');
      return { ok: false, step: 1, error: `Modalidade "${modalidade}" não existe no formulário. Opções: ${disp}` };
    }
    if (!setSelect2Array('#modalidade_id', opMod.value)) {
      selMod.value = opMod.value;
      selMod.dispatchEvent(new Event('change', { bubbles: true }));
    }
    await hd();
    if (selMod.value !== opMod.value) {
      return { ok: false, step: 1, error: `Não foi possível selecionar a modalidade "${opMod.textContent.trim()}"` };
    }

    if (!numeroCompra) return { ok: false, step: 1, error: 'Número compra ausente', needsInput: 'numeroCompra' };
    if (!document.querySelector('#numero_ano')) {
      return { ok: false, step: 1, error: 'Campo Número/Ano (#numero_ano) não encontrado' };
    }
    await preencherMascara('#numero_ano', numeroCompra);
    await hd();
    // Máscaras do campo podem reformatar; compara só os dígitos
    const numDigitos = (document.querySelector('#numero_ano')?.value ?? '').replace(/\D/g, '');
    if (numDigitos !== numeroCompra.replace(/\D/g, '')) {
      return { ok: false, step: 1, error: `Número da compra ficou "${document.querySelector('#numero_ano')?.value}" em vez de "${numeroCompra}"` };
    }

    // Unidade da compra: seguir com a unidade errada empenharia na UASG errada,
    // então só avança se a unidade estiver de fato selecionada.
    const ru = await setSelect2Ajax('#select2_ajax_unidade_origem_id', unidadeCompra, unidadeCompra);
    const $u = (window.jQuery || window.$)?.('#select2_ajax_unidade_origem_id');
    const unidadeSel = ($u?.select2?.('data') ?? []).map(d => d.text ?? '').join(' ')
      || $u?.find?.('option:selected')?.text?.() || '';
    if (!unidadeSel.includes(unidadeCompra)) {
      return { ok: false, step: 1, error: `Unidade da compra ${unidadeCompra} não selecionada${ru.ok ? '' : ': ' + ru.error}` };
    }
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
