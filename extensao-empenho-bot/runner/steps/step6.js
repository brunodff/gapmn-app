/**
 * Etapa 6 — Dados do empenho.
 *
 * Executada no mundo MAIN da página via chrome.scripting — precisa ser
 * autocontida (a função é serializada).
 *
 * Tipo de empenho escolhido pelo texto da opção (Ordinário / Estimativo / Global),
 * conforme a revisão. Amparo Legal: na compra, a primeira opção com "14.133"
 * (no contrato o CNET já preenche). Se o usuário já escolheu um amparo e usou
 * Retomar, a escolha dele é mantida.
 */
export async function step6Runner(p) {
  const dorme = ms => new Promise(r => setTimeout(r, ms));
  const norm = s => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim().toUpperCase();
  const $ = window.jQuery || window.$;
  const feitos = [];

  function fillInput(name, value) {
    const el = document.querySelector(`[name="${name}"]`);
    if (!el || value == null || value === '') return;
    el.focus();
    el.value = String(value);
    el.dispatchEvent(new Event('input',  { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    el.dispatchEvent(new Event('blur',   { bubbles: true })); // onblur="maiuscula(this)"
  }

  function escolher(sel, valor) {
    if ($) $(sel).val(String(valor)).trigger('change');
    else { sel.value = String(valor); sel.dispatchEvent(new Event('change', { bubbles: true })); }
  }

  // <select> pelo rótulo do campo ("Amparo Legal *")
  function selectDoRotulo(rotulo) {
    const lab = Array.from(document.querySelectorAll('label')).find(l => norm(l.textContent).startsWith(norm(rotulo)));
    if (!lab) return null;
    const porFor = lab.htmlFor ? document.getElementById(lab.htmlFor) : null;
    if (porFor?.tagName === 'SELECT') return porFor;
    return lab.closest('.form-group, [class*="col-"]')?.querySelector('select') ?? null;
  }

  async function selecionarAmparo(busca) {
    const sel = document.querySelector('select[name*="amparo" i], select[id*="amparo" i]') || selectDoRotulo('Amparo Legal');
    if (!sel) return { ok: false, error: 'Campo "Amparo Legal" não encontrado na Etapa 6' };
    const texto = () => (sel.selectedOptions[0]?.textContent ?? '').trim();
    if (sel.value) return { ok: true, texto: `${texto()} (já estava escolhido)` };

    const alvo = norm(busca).replace(/\./g, '');
    const casa = t => norm(t).replace(/\./g, '').includes(alvo);

    // 1) Opções já carregadas no select
    const opt = Array.from(sel.options).find(o => o.value && casa(o.textContent));
    if (opt) { escolher(sel, opt.value); return { ok: true, texto: opt.textContent.trim() }; }

    // 2) select2 com busca no servidor: abre, digita e escolhe o primeiro resultado
    if (!$?.fn?.select2) return { ok: false, error: `Amparo Legal sem opção "${busca}" — escolha no CNET e use Retomar` };
    $(sel).select2('open');
    await dorme(300);
    const campo = document.querySelector('.select2-container--open .select2-search__field');
    if (!campo) { $(sel).select2('close'); return { ok: false, error: 'A busca do Amparo Legal não abriu — escolha no CNET e use Retomar' }; }
    campo.value = busca;
    campo.dispatchEvent(new Event('input', { bubbles: true }));
    campo.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true }));
    for (let t = 0; t < 225; t++) {  // até ~45 s pela resposta do servidor (CNET lento)
      await dorme(200);
      const res = Array.from(document.querySelectorAll('.select2-container--open .select2-results__option'))
        .find(o => !o.classList.contains('loading-results') && casa(o.textContent));
      if (!res) continue;
      // select2 4.0 escolhe no mouseup; versões mais novas, no click
      res.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
      await dorme(300);
      if (!sel.value) { res.dispatchEvent(new MouseEvent('click', { bubbles: true })); await dorme(300); }
      if (sel.value) return { ok: true, texto: texto() || res.textContent.trim() };
      break;
    }
    $(sel).select2('close');
    return { ok: false, error: `Não achei Amparo Legal com "${busca}" — escolha no CNET e use Retomar` };
  }

  // Data de emissão: hoje (data local; toISOString daria o dia seguinte depois das 20h em Manaus)
  const d = new Date();
  fillInput('data_emissao', `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`);

  // Tipo de empenho pelo texto da opção (padrão: Global)
  const tipo = p.tipoEmpenho || 'Global';
  const selTipo = document.getElementById('tipo_empenho_id');
  let optTipo = null;
  if (selTipo) {
    optTipo = Array.from(selTipo.options).find(o => o.value && norm(o.textContent).includes(norm(tipo)));
    if (!optTipo) return { ok: false, error: `Tipo de empenho "${tipo}" não está entre as opções do CNET` };
    escolher(selTipo, optTipo.value);
    feitos.push(`Tipo de empenho: ${optTipo.textContent.trim()}`);
    await dorme(300);
  }

  // Amparo Legal: na compra, Lei 14.133; no contrato o CNET preenche sozinho
  if (p.tipoOrigem === 'compra') {
    const r = await selecionarAmparo('14.133');
    if (!r.ok) return { ok: false, error: r.error, feitos };
    feitos.push(`Amparo legal: ${r.texto}`);
  }

  // Número Processo (PAG da solicitação, maxlength=20)
  if (p.pag) fillInput('processo', p.pag.slice(0, 20));

  // Local de Entrega
  if (p.localEntrega) fillInput('local_entrega', p.localEntrega);

  // Descrição / Observação (textarea)
  if (p.obs) fillInput('descricao', p.obs);

  await dorme(400);

  // O CNET pode voltar o tipo ao padrão do contrato depois dos outros campos: confere
  if (selTipo && optTipo && selTipo.value !== optTipo.value) {
    escolher(selTipo, optTipo.value);
    await dorme(400);
    if (selTipo.value !== optTipo.value) {
      return { ok: false, error: `O CNET voltou o tipo de empenho para "${selTipo.selectedOptions[0]?.textContent.trim() ?? '?'}" — escolha "${optTipo.textContent.trim()}" na tela e use Retomar`, feitos };
    }
  }

  const btn =
    document.querySelector('button.submeter') ||
    Array.from(document.querySelectorAll('button')).find(b => b.textContent?.trim().includes('Próxima'));
  if (!btn) return { ok: false, error: 'Botão "Próxima Etapa" não encontrado na Etapa 6', feitos };
  btn.click();
  return { ok: true, feitos };
}
