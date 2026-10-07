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

    // "Pesquisando…", "Digite mais caracteres" e "Nenhum resultado" também são <li> da
    // lista — no select2 4.0 sem a classe --disabled. Antes contavam como resultado: com
    // o CNET lento, o robô clicava no "Pesquisando…" e a unidade ficava vazia.
    const opcaoReal = o => !o.matches('.loading-results, .select2-results__option--loading, .select2-results__message, ' +
      '.select2-results__option--disabled, [aria-disabled="true"], [role="alert"]');
    const opcoes = () => Array.from(document.querySelectorAll('.select2-results__option')).filter(opcaoReal);
    const carregando = () => !!document.querySelector('.select2-results__option.loading-results, .select2-results__option--loading');
    // match pode ser texto direto OU CNPJ (14 dígitos) — compara sem formatação
    const matchDigits = typeof match === 'string' ? match.replace(/\D/g, '') : '';
    const casaTexto = o => {
      const txt = o.textContent ?? '';
      return matchDigits.length >= 11 ? txt.replace(/\D/g, '').includes(matchDigits) : txt.includes(match);
    };

    // Limpa e digita o termo para disparar a busca AJAX
    si.value = '';
    si.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise(r => setTimeout(r, 200));
    si.value = term;
    si.dispatchEvent(new Event('input', { bubbles: true }));
    si.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true }));
    const digitou = Date.now();

    // Espera a resposta da busca (até 15 s). Com texto a procurar: até a opção certa
    // aparecer. Sem ele: até a lista parar de mudar — durante o "delay" do AJAX a lista
    // da busca anterior continua na tela.
    let opts = [], assinatura = '', estavel = 0;
    for (let w = 0; w < 15000; w += 300) {
      await new Promise(r => setTimeout(r, 300));
      opts = opcoes();
      if (carregando()) { estavel = 0; continue; }
      if (typeof match === 'string' && match) {
        if (opts.some(casaTexto)) break;
        continue;
      }
      const a = opts.map(o => o.textContent).join('|');
      estavel = a === assinatura ? estavel + 1 : 0;
      assinatura = a;
      const semResultado = !opts.length && !!document.querySelector('.select2-results__message');
      if (estavel >= 2 && Date.now() - digitou > (semResultado ? 2500 : 1200)) break;
    }
    if (!opts.length) { $el.select2('close'); return { ok: false, error: `sem resultados para "${term}"` }; }

    let target = null;
    // match função: ela escolhe (ou devolve { erro }); nunca cai na "primeira da lista"
    if (typeof match === 'function') {
      const r = match(opts);
      if (!r || r.erro) { $el.select2('close'); return { ok: false, error: r?.erro ?? 'nenhuma opção corresponde', semNumero: !!r?.semNumero }; }
      target = r;
    } else if (match) {
      // Texto a procurar que não veio: erro com o que a busca trouxe (nunca "a primeira")
      target = opts.find(casaTexto);
      if (!target) {
        $el.select2('close');
        const veio = opts.slice(0, 4).map(o => (o.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 50)).join(' | ');
        return { ok: false, error: `a busca por "${term}" não trouxe "${match}" (veio: ${veio})` };
      }
    } else {
      target = opts[0];
    }

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
    // então só avança se a unidade estiver de fato selecionada. Já selecionada (o CNET
    // lembra a última), não mexe; a busca pode demorar: até 3 tentativas.
    const unidadeSel = () => {
      const $u = (window.jQuery || window.$)?.('#select2_ajax_unidade_origem_id');
      let txt = '';
      try { txt = ($u?.select2?.('data') ?? []).map(d => d.text ?? '').join(' '); } catch (_) { /* sem select2 */ }
      return txt || $u?.find?.('option:selected')?.text?.() || '';
    };
    let ru = { ok: true }, tentativas = 0;
    while (!unidadeSel().includes(unidadeCompra) && tentativas < 3) {
      if (tentativas++) {
        try { (window.jQuery || window.$)('#select2_ajax_unidade_origem_id').select2('close'); } catch (_) { /* já fechado */ }
        await new Promise(r => setTimeout(r, 1500));
      }
      ru = await setSelect2Ajax('#select2_ajax_unidade_origem_id', unidadeCompra, unidadeCompra);
    }
    if (!unidadeSel().includes(unidadeCompra)) {
      const atual = unidadeSel().replace(/\s+/g, ' ').trim();
      return { ok: false, step: 1, error: `Unidade da compra ${unidadeCompra} não selecionada após ${tentativas} tentativa(s)` +
        `${ru.ok ? '' : ': ' + ru.error}${atual ? ` (ficou "${atual.slice(0, 60)}")` : ''}` };
    }
    await hd();
  } else if (contrato) {
    // Busca por "NNN/20" (número + prefixo do século), que traz o número de vários
    // anos e fornecedores; escolhe por número + ano + CNPJ. Pegar "a primeira da
    // lista" abria o 028/2016 de outro fornecedor no lugar do 028/2024.
    const numRaw = /^(\d+)/.exec(contrato ?? '')?.[1] ?? ''; // mantém zeros à esquerda: "034"
    // Credenciamento: no CNET o número é "2" + o número com 4 dígitos (004/2023 → 20004/2023)
    const num = credenciamento && numRaw ? 20000 + parseInt(numRaw, 10) : parseInt(numRaw, 10);
    const ano = /\/(\d{4})$/.exec(contrato ?? '')?.[1] ?? '';
    const tipo = credenciamento ? 'credenciamento' : 'contrato';
    const numTxt = credenciamento && !Number.isNaN(num) ? String(num) : numRaw;
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
      if (!info.length) return { erro: `nenhum ${tipo} nº ${numTxt} na lista do CNET`, semNumero: true };
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
          return { erro: `há ${doFornecedor.length} ${tipo}s nº ${numTxt} deste fornecedor (${doFornecedor.map(x => x.ano).join(', ')}) — informe o ano do ${tipo} na revisão` };
        } else if (info.length === 1 && !info[0].deOutro) alvo = info[0];
      }
      if (alvo) return alvo.o;
      return {
        erro: `${tipo} ${ano ? `${numTxt}/${ano}` : `nº ${numTxt}`}${cnpj.length === 14 ? ` do fornecedor ${fmtCnpj(cnpj)}` : ''} não está na lista do CNET (achei: ${vistos})`,
      };
    };
    // "028/20"; sem esse número na lista, tenta sem os zeros ("28/20"). Credenciamento:
    // "20004/2023" (ou "20004/2" sem o ano) traz os credenciamentos desse número — um por
    // credenciado — e o CNPJ do fornecedor escolhe o certo
    const termos = credenciamento && !Number.isNaN(num)
      ? [`${num}/${ano || '2'}`]
      : [...new Set([numRaw ? numRaw + '/20' : contrato, Number.isNaN(num) ? null : `${num}/20`].filter(Boolean))];
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
