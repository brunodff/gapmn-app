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
 */
export async function step4Runner(p) {
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
  // (0=Selecione, 1=Esfera, 2=PTRS, 3=Fonte, 4=ND, 5=UGR, 6=Plano Interno)
  const ths = Array.from(linhas[0]?.closest('table')?.querySelectorAll('thead th') ?? []).map(th => norm(th.textContent));
  const acha = (inclui, exatos = []) => ths.findIndex(h => inclui.some(n => h.includes(n)) || exatos.includes(h));
  const col = {
    ptres: acha(['PTRES', 'PTRS']),
    fonte: acha(['FONTE']),
    nd:    acha(['NATUREZA'], ['ND']),
    ugr:   acha(['UGR', 'UG RESP']),
    pi:    acha(['PLANO INTERNO'], ['PI']),
  };
  const fixo = { ptres: 2, fonte: 3, nd: 4, ugr: 5, pi: 6 };
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
  feitos.push(`Linha de crédito: ${descreve(valores(linha))}`);

  // Clica "Próxima Etapa" (ignora botões dentro do modal)
  const btn =
    document.querySelector('button.submeter') ||
    Array.from(document.querySelectorAll('button')).find(b =>
      !b.closest('#inserir_celular_orcamentaria') && b.textContent?.trim().includes('Próxima'));
  if (!btn) return { ok: false, error: 'Botão "Próxima Etapa" não encontrado na Etapa 4', feitos };
  btn.click();
  return { ok: true, feitos };
}
