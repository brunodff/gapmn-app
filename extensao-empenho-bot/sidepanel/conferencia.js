/**
 * Conferência da solicitação na revisão: o que já dá para saber, antes de
 * iniciar, que vai travar o robô no CNET (nível 'erro') ou merece atenção
 * ('aviso'). Só regras sobre os dados lidos — sem acesso a páginas.
 *
 * Cada regra espelha o que a etapa correspondente do robô exige:
 *   Etapa 1 — compra (nº, modalidade, UASG) ou contrato (nº e, de preferência, ano)
 *   Etapa 2 — CNPJ do fornecedor
 *   Etapas 3 e 5 — N.Item, quantidade e valor de cada item
 *   Etapa 4 — linha de crédito: PTRES, Fonte e ND (sem eles pega a linha errada)
 */

const dig = s => String(s ?? '').replace(/\D/g, '');
// "1.234,56" / "1234,56" (BR) ou "1234.5600" (ponto decimal, como vem dos itens)
const num = s => {
  const t = String(s ?? '').trim().replace(/\s/g, '');
  if (!t) return NaN;
  return t.includes(',') ? parseFloat(t.replace(/\./g, '').replace(',', '.')) : parseFloat(t);
};
const fmtV = v => v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function cnpjValido(c) {
  if (!/^\d{14}$/.test(c) || /^(\d)\1{13}$/.test(c)) return false;
  const dv = n => {
    let s = 0, p = n - 7;
    for (let i = 0; i < n; i++) { s += +c[i] * p--; if (p < 2) p = 9; }
    return s % 11 < 2 ? 0 : 11 - (s % 11);
  };
  return dv(12) === +c[12] && dv(13) === +c[13];
}

/** Lista de { nivel: 'erro' | 'aviso', texto } da solicitação. */
export function problemasDaSolicitacao(sol) {
  const p = [];
  if (!sol?.ok) return p;
  const erro = texto => p.push({ nivel: 'erro', texto });
  const aviso = texto => p.push({ nivel: 'aviso', texto });
  const compra = sol.tipoOrigem === 'compra';
  const itens = sol.itensEmpenho ?? [];

  // ── Fornecedor (Etapa 2 escolhe pelo CNPJ) ──
  const cnpj = dig(sol.fornecedorCnpj);
  if (!cnpj) erro('CNPJ do fornecedor não lido no PDF — informe em "Ver / editar campos"');
  else if (!cnpjValido(cnpj)) erro(`CNPJ do fornecedor inválido (${sol.fornecedorCnpj}) — confira`);
  else if (cnpj.startsWith('00394429')) erro('O CNPJ é do Comando da Aeronáutica (o comprador), não do fornecedor — corrija');

  // ── Contrato ou compra (Etapa 1) ──
  if (compra) {
    if (!/^\d{4,6}\/\d{4}$/.test(String(sol.numeroCompra ?? '').trim())) erro('Número da compra não encontrado no PDF (ex: 90063/2025)');
    if (!sol.modalidade) erro('Modalidade da compra não informada');
    else if (sol._deduzidos?.modalidade) aviso(`Modalidade deduzida pelo número da compra (${sol.modalidade}) — confira`);
    if (!String(sol.unidadeCompra ?? '').trim()) erro('Unidade (UASG) da compra não informada');
  } else {
    const c = String(sol.contrato ?? '').trim();
    const n = /^\d+/.exec(c)?.[0];
    if (!n) erro('Número do contrato não encontrado no PDF — informe em Contrato (ex: 028/2024) ou mude o Tipo para Compra');
    else if (!/^\d+\/\d{4}$/.test(c)) {
      aviso(`Ano do contrato não encontrado no PDF (lido: ${c}) — o robô escolhe pelo CNPJ do fornecedor; se ele tiver mais de um contrato nº ${n}, informe o ano (ex: ${n}/2024)`);
    }
    const k = sol._cnetContrato;
    if (k?.estado === 'erro') erro(`CNET: ${k.texto}`);
  }

  // ── Itens (Etapas 3 e 5) ──
  if (!itens.length) {
    if (compra) erro('Itens não identificados no PDF — informe N.Item, Qtd e valor de cada item');
    else aviso('Itens não identificados no PDF — com um único item no contrato o robô usa o TOTAL; com mais de um, ele para. Informe N.Item e valor');
  } else {
    itens.forEach((it, i) => {
      const rot = dig(it.numeroItem) ? `Item ${it.numeroItem}` : `${i + 1}º item`;
      if (compra) {
        if (!dig(it.numeroItem)) erro(`${rot}: sem N.Item (nº da coluna ITEM do PDF) — numa compra o robô não sabe qual marcar`);
        if (!(num(it.quantidade) > 0) && !(num(it.valor) > 0)) erro(`${rot}: sem quantidade nem valor`);
      } else if (!(num(it.valor) > 0)) {
        erro(`${rot}: sem valor a empenhar`);
      }
    });
    if (!compra && itens.length > 1 && itens.some(it => !dig(it.numeroItem))) erro('Contrato com mais de um item: informe o N.Item de cada um');
    const nums = itens.map(it => parseInt(dig(it.numeroItem), 10)).filter(x => !Number.isNaN(x));
    if (new Set(nums).size < nums.length) aviso('N.Item repetido entre os itens — confira');
    const total = num(sol.total);
    const soma = itens.reduce((s, it) => s + (num(it.valor) || 0), 0);
    if (total > 0 && soma > 0 && Math.abs(soma - total) > 0.01) {
      aviso(`Soma dos itens (R$ ${fmtV(soma)}) diferente do TOTAL (R$ ${fmtV(total)}) — confira os itens`);
    }
  }

  // ── Valor ──
  if (!(num(sol.total) > 0) && !itens.some(it => num(it.valor) > 0)) erro('Valor total não encontrado no PDF');
  else if (sol._deduzidos?.total) aviso('TOTAL não legível no PDF; usei a soma dos itens — confira');

  // ── Linha de crédito (Etapa 4) ──
  const faltam = [['PTRES', sol.ptres], ['Fonte', sol.fonte], ['ND', sol.nd]].filter(([, v]) => !dig(v)).map(([nome]) => nome);
  if (faltam.length) erro(`Linha de crédito incompleta: falta ${faltam.join(', ')} — sem isso o robô pode marcar a linha errada`);
  else if (dig(sol.nd).length !== 6) erro(`ND "${sol.nd}" inválida — precisa de 6 dígitos (ex: 339039)`);
  const semOpcionais = [['PI', sol.pi], ['UG Cred', sol.ugCred]].filter(([, v]) => !String(v ?? '').trim()).map(([nome]) => nome);
  if (semOpcionais.length) aviso(`${semOpcionais.join(' e ')} não lido(s) — a linha de crédito será escolhida sem ${semOpcionais.length > 1 ? 'eles' : 'ele'}; confira`);
  if (sol._deduzidos?.ugCred) aviso(`UG Cred ${sol.ugCred} deduzida (estava longe do rótulo no PDF) — confira`);
  if (sol._deduzidos?.credito) {
    aviso(`Crédito lido de valores separados dos rótulos no PDF (ND ${sol.nd || '—'}, PTRES ${sol.ptres || '—'}, Fonte ${sol.fonte || '—'}, PI ${sol.pi || '—'}) — confira`);
  }

  // ── Demais ──
  if (!dig(sol.subelemento) && !itens.some(it => dig(it.subelemento))) aviso('Subelemento não lido — o CNET fica com o padrão do item');
  if (!sol.solicitacao) aviso('Número da solicitação não lido — a descrição do empenho fica sem a referência');
  if (!sol.pag) aviso('Número do processo (PAG) não lido');
  // Vai para o campo "Local de Entrega" da Etapa 6
  const local = String(sol.localEntrega ?? '').trim();
  if (!local || local.includes(':') || /\d{3,}/.test(local)) aviso(`Local de entrega não identificado no PDF${local ? ` (lido: "${local.slice(0, 40)}")` : ''} — confira`);

  return p;
}

export const temErro = sol => problemasDaSolicitacao(sol).some(p => p.nivel === 'erro');
