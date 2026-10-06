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
    // match função: ela escolhe (ou devolve { erro }); nunca cai na "primeira da lista"
    if (typeof match === 'function') {
      const r = match(Array.from(opts));
      if (!r || r.erro) { $el.select2('close'); return { ok: false, error: r?.erro ?? 'nenhuma opção corresponde', semNumero: !!r?.semNumero }; }
      target = r;
    } else if (match) {
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

  const { tipoOrigem, modalidade, numeroCompra, contrato, unidadeCompra = '120630', fornecedorCnpj = '', credenciamento = false } = payload;

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
    // Busca por "NNN/20" (número + prefixo do século), que traz o número de vários
    // anos e fornecedores; escolhe por número + ano + CNPJ. Pegar "a primeira da
    // lista" abria o 028/2016 de outro fornecedor no lugar do 028/2024.
    const numRaw = /^(\d+)/.exec(contrato ?? '')?.[1] ?? ''; // mantém zeros à esquerda: "034"
    const num = parseInt(numRaw, 10);
    const ano = /\/(\d{4})$/.exec(contrato ?? '')?.[1] ?? '';
    const cnpj = String(fornecedorCnpj ?? '').replace(/\D/g, '');
    const fmtCnpj = c => c.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5');
    const escolherContrato = opts => {
      const info = opts.map(o => {
        const txt = (o.textContent ?? '').replace(/\s+/g, ' ').trim();
        const m = new RegExp(String.raw`(?:^|[^\d])0*${num}\/(\d{4})(?!\d)`).exec(txt);
        const cnpjs = (txt.match(/\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}/g) ?? []).map(c => c.replace(/\D/g, '')).filter(c => c.length === 14);
        return {
          o, txt, ano: m?.[1] ?? null,
          doFornecedor: cnpj.length === 14 && txt.replace(/\D/g, '').includes(cnpj),
          deOutro: cnpjs.length > 0 && !cnpjs.includes(cnpj),
        };
      }).filter(x => x.ano);
      const vistos = info.map(x => x.txt.slice(0, 60)).join(' | ') || 'nenhum com esse número';
      if (!info.length) return { erro: `nenhum contrato nº ${numRaw} na lista do CNET`, semNumero: true };
      const doFornecedor = info.filter(x => x.doFornecedor);
      // 1) número + ano + fornecedor
      let alvo = ano ? doFornecedor.find(x => x.ano === ano) : null;
      // 2) número + ano, sem ser de outro fornecedor
      if (!alvo && ano) {
        const c = info.filter(x => x.ano === ano && !x.deOutro);
        if (c.length === 1) alvo = c[0];
      }
      // 3) sem o ano no PDF: o único contrato desse número do fornecedor
      if (!alvo && !ano) {
        if (doFornecedor.length === 1) alvo = doFornecedor[0];
        else if (doFornecedor.length > 1) {
          return { erro: `há ${doFornecedor.length} contratos nº ${numRaw} deste fornecedor (${doFornecedor.map(x => x.ano).join(', ')}) — informe o ano do contrato na revisão` };
        } else if (info.length === 1 && !info[0].deOutro) alvo = info[0];
      }
      if (alvo) return alvo.o;
      return {
        erro: `contrato ${ano ? `${numRaw}/${ano}` : `nº ${numRaw}`}${cnpj.length === 14 ? ` do fornecedor ${fmtCnpj(cnpj)}` : ''} não está na lista do CNET (achei: ${vistos})`,
      };
    };
    // "028/20"; sem esse número na lista, tenta sem os zeros ("28/20"). Credenciamento:
    // no CNET o número tem 5 dígitos — "00019/2" traz os credenciamentos desse número
    // (um por credenciado) e o CNPJ do fornecedor escolhe o certo
    const termos = [...new Set([
      credenciamento && !Number.isNaN(num) ? `${String(num).padStart(5, '0')}/2` : null,
      numRaw ? numRaw + '/20' : contrato,
      Number.isNaN(num) ? null : `${num}/20`,
    ].filter(Boolean))];
    let rc = null;
    for (const termo of termos) {
      rc = await setSelect2Ajax('#select2_ajax_id', termo, numRaw ? escolherContrato : (fornecedorCnpj || null));
      if (rc.ok || !(rc.semNumero || /sem resultados/.test(rc.error ?? ''))) break;
    }
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
