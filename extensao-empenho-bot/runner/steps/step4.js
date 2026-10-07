/**
 * Etapa 4 — Crédito disponível: escolhe a célula orçamentária da solicitação.
 *
 * Executada no mundo MAIN da página via chrome.scripting — precisa ser
 * autocontida (a função é serializada).
 *
 * A linha só serve se bater em todos os campos que a solicitação traz: PTRES,
 * Fonte, Natureza da Despesa, UGR e PI. Antes bastava o PI, e o mesmo PI com
 * ND 339033 (passagens) era escolhido no lugar do 339030. Sem linha compatível,
 * cadastra a célula no modal "Inserir Célula Orçamentária" e escolhe a linha nova
 * pelo mesmo critério (nunca "a última linha").
 *
 * modo 'atualizar' (chamado antes): acha a mesma linha e clica o botão de atualizar
 * (⟳, coluna Ações), que consulta o crédito no SIAFI. O "Valor" guardado no CNET
 * pode estar velho, para mais ou para menos, e barrar um empenho que cabe no crédito.
 */
export async function step4Runner(p, modo = 'selecionar', valorSolicitado = 0) {
  const dorme = ms => new Promise(r => setTimeout(r, ms));
  const norm = s => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim().toUpperCase();
  // Código do início da célula: "33.90.30 - MATERIAL DE CONSUMO" → "339030"
  const codigo = s => (String(s ?? '').replace(/[.\-\s/]/g, '').match(/\d+/) ?? [''])[0];
  const piDe = s => norm(s).split(/[\s\-–]+/)[0];
  const feitos = [];

  const alvo = { ptres: codigo(p.ptres), fonte: codigo(p.fonte), nd: codigo(p.nd), ugr: codigo(p.ugCred), pi: piDe(p.pi) };
  const descreve = v => [
    v.ptres && `PTRES ${v.ptres}`, v.fonte && `Fonte ${v.fonte}`, v.nd && `ND ${v.nd}`,
    v.ugr && `UGR ${v.ugr}`, v.pi && `PI ${v.pi}`,
  ].filter(Boolean).join(' · ');

  const linhasDaTabela = () => Array.from(document.querySelectorAll('table tbody tr[role="row"]'))
    .filter(tr => !tr.closest('#inserir_celular_orcamentaria') && tr.querySelector('input[type="radio"]'));

  // Aguarda o DataTable carregar (AJAX — até 15 s)
  let linhas = [];
  for (let t = 0; t < 15000; t += 500) {
    linhas = linhasDaTabela();
    if (linhas.length) break;
    await dorme(500);
  }

  // Colunas pelo cabeçalho; sem cabeçalho, a ordem conhecida do CNET
  // (0=Selecione, 1=Esfera, 2=PTRS, 3=Fonte, 4=ND, 5=UGR, 6=Plano Interno, 7=Valor, 8=Ações)
  const ths = Array.from(linhas[0]?.closest('table')?.querySelectorAll('thead th') ?? []).map(th => norm(th.textContent));
  const acha = (inclui, exatos = []) => ths.findIndex(h => inclui.some(n => h.includes(n)) || exatos.includes(h));
  const col = {
    ptres: acha(['PTRES', 'PTRS']),
    fonte: acha(['FONTE']),
    nd:    acha(['NATUREZA'], ['ND']),
    ugr:   acha(['UGR', 'UG RESP']),
    pi:    acha(['PLANO INTERNO'], ['PI']),
    valor: acha(['VALOR', 'SALDO']),
    acoes: acha(['ACOES', 'ACAO']),
  };
  const fixo = { ptres: 2, fonte: 3, nd: 4, ugr: 5, pi: 6, valor: 7, acoes: 8 };
  for (const k of Object.keys(col)) if (col[k] < 0) col[k] = fixo[k];

  const valores = tr => {
    const td = Array.from(tr.querySelectorAll('td'));
    const t = k => td[col[k]]?.textContent ?? '';
    return { ptres: codigo(t('ptres')), fonte: codigo(t('fonte')), nd: codigo(t('nd')), ugr: codigo(t('ugr')), pi: piDe(t('pi')) };
  };
  // Todos os campos informados precisam bater. A Fonte pode vir noutro tamanho
  // ("1052000140" x "052000140"): na 2ª passada aceita uma conter a outra.
  const confere = (tr, fonteFlexivel) => {
    const v = valores(tr);
    const fonteOk = !alvo.fonte || v.fonte === alvo.fonte ||
      (fonteFlexivel && v.fonte.length >= 4 && (v.fonte.endsWith(alvo.fonte) || alvo.fonte.endsWith(v.fonte)));
    return (!alvo.ptres || v.ptres === alvo.ptres) && fonteOk &&
      (!alvo.nd || v.nd.startsWith(alvo.nd)) && (!alvo.ugr || v.ugr === alvo.ugr) && (!alvo.pi || v.pi === alvo.pi);
  };
  const procura = () => {
    const l = linhasDaTabela();
    return l.find(tr => confere(tr, false)) ?? l.find(tr => confere(tr, true)) ?? null;
  };

  // Valor e Ações ficam escondidos em tela estreita (DataTables Responsive): a célula
  // continua na linha, mas com a linha aberta o conteúdo vai para a linha-filha
  const filhaDe = tr => tr.nextElementSibling?.classList.contains('child') ? tr.nextElementSibling : null;
  const numBR = s => {
    const m = String(s ?? '').match(/-?\d[\d.]*,\d{2}/);
    return m ? Number(m[0].replace(/\./g, '').replace(',', '.')) : null;
  };
  const valorDe = tr => {
    const v = numBR(tr.querySelectorAll('td')[col.valor]?.textContent);
    if (v !== null) return v;
    const li = Array.from(filhaDe(tr)?.querySelectorAll('li') ?? [])
      .find(l => /^(VALOR|SALDO)/.test(norm(l.querySelector('.dtr-title')?.textContent)));
    return numBR(li?.querySelector('.dtr-data')?.textContent);
  };
  const brl = v => v === null || v === undefined ? '—'
    : 'R$ ' + v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  // Botão ⟳ da linha: o da coluna Ações com ícone de atualizar; sem ícone conhecido,
  // o único botão da linha
  const botaoAtualizar = tr => {
    const tds = Array.from(tr.querySelectorAll('td'));
    const lugares = [tds[col.acoes], ...tds, filhaDe(tr)].filter(Boolean);
    const cands = [...new Set(lugares.flatMap(el => Array.from(el.querySelectorAll('button, a, [role="button"]'))))];
    const rx = /refresh|sync|rotate|redo|repeat|reload|atualiz|recarreg/i;
    const pistas = b => [b.className, b.id, b.title, b.getAttribute('aria-label'), b.getAttribute('data-original-title'),
      b.getAttribute('onclick'), b.getAttribute('href'), b.innerHTML].join(' ');
    return cands.find(b => rx.test(pistas(b))) ?? (cands.length === 1 ? cands[0] : null);
  };

  // Clica o ⟳ e espera o CNET terminar: pedidos de rede encerrados e tabela parada.
  // Avisos (SweetAlert, alert, toast) são lidos e fechados. Se o botão recarregar a
  // página, este script morre junto e o runStep4 espera a navegação.
  const atualizarCredito = async tr => {
    const desc = descreve(valores(tr));
    const btn = botaoAtualizar(tr);
    const antes = valorDe(tr);
    if (!btn) {
      return { ok: true, msgs: [{ level: 'warn',
        msg: `A linha de crédito (${desc}) não tem o botão de atualizar — seguindo com o valor da tela (${brl(antes)})` }] };
    }
    const id = tr.querySelector('input[type="radio"]')?.value;
    const visivel = e => !!e && e.getClientRects().length > 0 && getComputedStyle(e).visibility !== 'hidden';
    const SEL_AVISO = '.noty_body, .ui-pnotify-text, .toast-message, .alert-danger, .alert-warning, .alert-success, .alert-info';
    const textos = () => Array.from(document.querySelectorAll(SEL_AVISO)).filter(visivel)
      .map(e => e.textContent.replace(/\s+/g, ' ').trim()).filter(Boolean);
    const avisosAntes = new Set(textos());
    const avisos = [];
    const rede = { pend: 0, total: 0 };
    let mexeu = Date.now(), saiu = false;

    const xhrSend = XMLHttpRequest.prototype.send, fetchO = window.fetch, alertO = window.alert, confirmO = window.confirm;
    XMLHttpRequest.prototype.send = function (...a) {
      rede.pend++; rede.total++;
      this.addEventListener('loadend', () => { rede.pend--; mexeu = Date.now(); }, { once: true });
      return xhrSend.apply(this, a);
    };
    if (fetchO) {
      window.fetch = function (...a) {
        rede.pend++; rede.total++;
        return fetchO.apply(this, a).finally(() => { rede.pend--; mexeu = Date.now(); });
      };
    }
    window.alert = m => { avisos.push(String(m ?? '')); };
    window.confirm = m => { avisos.push(String(m ?? '')); return true; };
    const aoSair = () => { saiu = true; };
    window.addEventListener('beforeunload', aoSair);
    const obs = new MutationObserver(() => { mexeu = Date.now(); });
    obs.observe(tr.closest('table')?.parentElement ?? document.body, { childList: true, subtree: true, characterData: true });

    try {
      btn.click();
      let swals = 0;
      for (const ini = Date.now(); Date.now() - ini < 25000;) {
        await dorme(300);
        if (saiu) return { ok: true, navegando: true, antes };
        // "Deseja atualizar?" / "Saldo atualizado": lê e confirma (até 4 avisos)
        const swal = Array.from(document.querySelectorAll('.swal2-popup:not(.swal2-hide), .sweet-alert.visible')).find(visivel);
        if (swal && swals < 4) {
          swals++;
          const t = [swal.querySelector('.swal2-title, h2'), swal.querySelector('.swal2-html-container, .swal2-content, p')]
            .map(e => e?.textContent?.replace(/\s+/g, ' ').trim()).filter(Boolean).join(' — ');
          if (t) avisos.push(t);
          swal.querySelector('.swal2-confirm, button.confirm')?.click();
          for (let k = 0; k < 10 && visivel(swal) && !swal.classList.contains('swal2-hide'); k++) await dorme(150);
          mexeu = Date.now();
          continue;
        }
        const processando = Array.from(document.querySelectorAll('.dataTables_processing'))
          .some(e => visivel(e) && getComputedStyle(e).display !== 'none');
        const parado = Date.now() - mexeu > 900;
        if (!processando && parado && rede.pend === 0 && (rede.total > 0 || Date.now() - ini > 4000)) break;
      }
    } finally {
      XMLHttpRequest.prototype.send = xhrSend;
      if (fetchO) window.fetch = fetchO;
      window.alert = alertO;
      window.confirm = confirmO;
      window.removeEventListener('beforeunload', aoSair);
      obs.disconnect();
    }

    // A tabela pode ter sido redesenhada: relê a mesma linha (pelo radio) ou a procura
    const nova = (id && linhasDaTabela().find(t => t.querySelector('input[type="radio"]')?.value === id)) || procura() || tr;
    const depois = valorDe(nova);
    const todos = [...new Set([...avisos, ...textos().filter(t => !avisosAntes.has(t))])].filter(Boolean);
    const erro = todos.find(t => /ERRO|FALH|NAO FOI POSS|INDISPON|INVALID|TENTE NOVAMENTE|TIMEOUT/.test(norm(t)));
    const credito = depois ?? antes;
    const msgs = [];
    if (erro) {
      msgs.push({ level: 'warn', msg: `Tentei atualizar o crédito da linha (${desc}), mas o CNET avisou: "${erro.slice(0, 200)}" — seguindo com o valor da tela (${brl(credito)})` });
    } else if (!rede.total && !todos.length && depois === antes) {
      msgs.push({ level: 'warn', msg: `Cliquei em atualizar o crédito da linha (${desc}), mas o CNET não respondeu — seguindo com o valor da tela (${brl(credito)})` });
    } else if (antes !== null && depois !== null && antes !== depois) {
      msgs.push({ level: 'info', msg: `Crédito da linha atualizado: ${brl(antes)} → ${brl(depois)}` });
    } else {
      msgs.push({ level: 'info', msg: `Crédito da linha atualizado (${brl(credito)}${antes !== null && antes === depois ? ', sem mudança' : ''})` });
    }
    if (credito !== null && valorSolicitado > 0 && credito + 0.005 < valorSolicitado) {
      msgs.push({ level: 'warn', msg: `O crédito da linha (${brl(credito)}) é menor que o valor da solicitação (${brl(valorSolicitado)}) — o CNET pode recusar o empenho` });
    }
    return { ok: true, antes, depois, msgs };
  };

  if (modo === 'atualizar') {
    const l = procura();
    // Sem a linha, a etapa normal cadastra a célula (e o CNET já traz o crédito do SIAFI)
    return l ? atualizarCredito(l) : { ok: true, semLinha: true };
  }

  let linha = procura();
  if (!linha) {
    // Não há a célula → cadastra pelo modal "Inserir Célula Orçamentária"
    const btnModal = document.querySelector('button[data-target="#inserir_celular_orcamentaria"]');
    if (!btnModal) return { ok: false, error: `Nenhuma linha de crédito com ${descreve(alvo)} e botão "Inserir Célula Orçamentária" não encontrado` };
    btnModal.click();
    await dorme(700);

    const fillF = (id, val) => {
      const el = document.getElementById(id);
      if (!el || val == null || val === '') return;
      el.focus();
      el.value = String(val);
      el.dispatchEvent(new Event('input',  { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    };
    // Esfera: a da primeira linha existente; sem linhas, 1 (fiscal)
    const esfera = linhas[0]?.querySelectorAll('td')[1]?.textContent?.trim() || '1';
    fillF('esfera',           esfera);
    fillF('ptrs',             p.ptres);
    fillF('fonte',            p.fonte);
    fillF('natureza_despesa', p.nd);
    fillF('urg',              p.ugCred); // id no CNET é "urg" (typo; name="ugr")
    fillF('plano_interno',    p.pi);
    await dorme(400);

    const btnSalvar = document.getElementById('btn_inserir');
    if (!btnSalvar) return { ok: false, error: 'Botão "Salvar" do modal não encontrado' };
    btnSalvar.click();

    // Aguarda o modal fechar e a linha nova aparecer (AJAX — até 12 s)
    for (let t = 0; t < 12000 && !linha; t += 500) {
      await dorme(500);
      linha = procura();
    }
    if (!linha) {
      return { ok: false, error: `Cadastrei a célula orçamentária, mas a linha (${descreve(alvo)}) não apareceu na tabela — escolha a linha certa no CNET e use Retomar` };
    }
    feitos.push(`Célula orçamentária cadastrada (${descreve(alvo)})`);
  }

  const radio = linha.querySelector('input[type="radio"]');
  radio.click();
  await dorme(300);
  if (!radio.checked) return { ok: false, error: `Não consegui marcar a linha de crédito (${descreve(alvo)})`, feitos };
  const credito = valorDe(linha);
  feitos.push(`Linha de crédito: ${descreve(valores(linha))}${credito !== null ? ` · crédito ${brl(credito)}` : ''}`);

  // Clica "Próxima Etapa" (ignora botões dentro do modal)
  const btn =
    document.querySelector('button.submeter') ||
    Array.from(document.querySelectorAll('button')).find(b =>
      !b.closest('#inserir_celular_orcamentaria') && b.textContent?.trim().includes('Próxima'));
  if (!btn) return { ok: false, error: 'Botão "Próxima Etapa" não encontrado na Etapa 4', feitos };
  btn.click();
  return { ok: true, feitos };
}
