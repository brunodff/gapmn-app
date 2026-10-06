/**
 * Confere na revisão se o contrato existe no CNET para o fornecedor, antes de
 * empenhar. Abre o formulário de nova minuta (/empenho/buscacompra) numa aba em
 * segundo plano — só abrir não cria minuta —, pesquisa o número no campo de
 * contrato (o mesmo select2 da Etapa 1, pela própria busca do campo) e fecha a aba.
 */

const CNET = 'https://contratos.comprasnet.gov.br';
const FORMULARIO = `${CNET}/empenho/buscacompra`;

/**
 * Escolhe o contrato na lista do CNET — as mesmas regras da Etapa 1
 * (runner/steps/step1.js, escolherContrato; lá a função roda dentro da página e
 * não pode importar esta): número + ano + CNPJ; número + ano sem ser de outro
 * fornecedor; sem ano, o único contrato do número desse fornecedor.
 * Devolve { indice } ou { erro, semNumero }.
 */
export function escolherContrato(textos, { contrato, cnpj }) {
  const numRaw = /^(\d+)/.exec(contrato ?? '')?.[1] ?? '';
  const n = parseInt(numRaw, 10);
  const ano = /\/(\d{4})$/.exec(contrato ?? '')?.[1] ?? '';
  const c = String(cnpj ?? '').replace(/\D/g, '');
  const fmt = x => x.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5');
  const info = textos.map((bruto, indice) => {
    const txt = String(bruto ?? '').replace(/\s+/g, ' ').trim();
    const m = new RegExp(String.raw`(?:^|[^\d])0*${n}\/(\d{4})(?!\d)`).exec(txt);
    const cnpjs = (txt.match(/\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}/g) ?? []).map(x => x.replace(/\D/g, '')).filter(x => x.length === 14);
    return {
      indice, txt, ano: m?.[1] ?? null,
      doFornecedor: c.length === 14 && txt.replace(/\D/g, '').includes(c),
      deOutro: cnpjs.length > 0 && !cnpjs.includes(c),
    };
  }).filter(x => x.ano);
  if (!info.length) return { erro: `nenhum contrato nº ${numRaw} no CNET`, semNumero: true };
  const vistos = info.map(x => x.txt.slice(0, 60)).join(' | ');
  const doFornecedor = info.filter(x => x.doFornecedor);
  let alvo = ano ? doFornecedor.find(x => x.ano === ano) : null;
  if (!alvo && ano) {
    const cands = info.filter(x => x.ano === ano && !x.deOutro);
    if (cands.length === 1) alvo = cands[0];
  }
  if (!alvo && !ano) {
    if (doFornecedor.length === 1) alvo = doFornecedor[0];
    else if (doFornecedor.length > 1) {
      return { erro: `há ${doFornecedor.length} contratos nº ${numRaw} deste fornecedor (${doFornecedor.map(x => x.ano).join(', ')}) — informe o ano do contrato` };
    } else if (info.length === 1 && !info[0].deOutro) alvo = info[0];
  }
  if (alvo) return { indice: alvo.indice };
  return {
    erro: `contrato ${ano ? `${numRaw}/${ano}` : `nº ${numRaw}`}${c.length === 14 ? ` do fornecedor ${fmt(c)}` : ''} não está no CNET (achei: ${vistos})`,
  };
}

/** Roda na aba do CNET (mundo MAIN; autocontida): pesquisa no campo de contrato. */
async function cnetBuscarContratos(termo) {
  const dorme = ms => new Promise(r => setTimeout(r, ms));
  const $ = window.jQuery || window.$;
  if (!$) return { ok: false, erro: 'o formulário do CNET não carregou' };
  let s2 = $('#select2_ajax_id').data('select2');
  if (!s2) {   // o campo pode só existir depois de marcar "Contrato"
    document.getElementById('opc_contrato')?.click();
    await dorme(1000);
    s2 = $('#select2_ajax_id').data('select2');
  }
  if (!s2?.dataAdapter?.query) return { ok: false, erro: 'campo de contrato não encontrado no formulário do CNET' };
  return new Promise(res => {
    const t = setTimeout(() => res({ ok: false, erro: 'o CNET não respondeu à pesquisa do contrato' }), 15000);
    s2.dataAdapter.query({ term: termo, _type: 'query', page: 1 }, data => {
      clearTimeout(t);
      const textos = [];
      const junta = lista => (lista ?? []).forEach(r => {
        if (r.children) junta(r.children);
        else if (r.text != null && !r.loading) textos.push(String(r.text));
      });
      junta(data?.results);
      res({ ok: true, textos });
    });
  });
}

const dorme = ms => new Promise(r => setTimeout(r, ms));

async function esperarAba(tabId, ms = 25000) {
  await dorme(400);
  for (let t = 0; t < ms; t += 300) {
    const aba = await chrome.tabs.get(tabId);
    if (aba.status === 'complete' && aba.url && !aba.url.startsWith('about:')) return aba;
    await dorme(300);
  }
  throw new Error('o CNET demorou demais para abrir');
}

const comPrazo = (p, ms, msg) => {
  let t;
  return Promise.race([p, new Promise((_, rej) => { t = setTimeout(() => rej(new Error(msg)), ms); })]).finally(() => clearTimeout(t));
};

/**
 * pedidos: [{ chave, contrato, cnpj }]. Devolve
 *   { estado: 'sem-aba' | 'sem-login' | 'erro', detalhe? } ou
 *   { estado: 'ok', resultados: Map(chave → { estado: 'ok' | 'erro' | 'nao-conferido', texto }) }
 */
export async function conferirContratosNoCnet(pedidos) {
  const abertas = await chrome.tabs.query({ url: `${CNET}/*` });
  if (!abertas.length) return { estado: 'sem-aba' };
  const aba = await chrome.tabs.create({ url: FORMULARIO, active: false });
  try {
    const carregada = await esperarAba(aba.id);
    if (!/\/empenho\//.test(carregada.url ?? '')) return { estado: 'sem-login' };
    const exec = (func, args) => comPrazo(
      chrome.scripting.executeScript({ target: { tabId: aba.id }, world: 'MAIN', func, args }).then(r => r?.[0]?.result),
      20000, 'o CNET não respondeu');
    const buscas = new Map();   // termo → resposta (cada número pesquisado uma vez)
    const buscar = async termo => {
      if (!buscas.has(termo)) buscas.set(termo, await exec(cnetBuscarContratos, [termo]).catch(e => ({ ok: false, erro: e.message })));
      return buscas.get(termo);
    };
    const resultados = new Map();
    for (const p of pedidos) {
      const numRaw = /^(\d+)/.exec(p.contrato ?? '')?.[1];
      if (!numRaw) continue;
      // "028/20"; sem esse número na lista, "28/20"; credenciamento: "00019/2" (como a Etapa 1)
      const n = parseInt(numRaw, 10);
      const termos = [...new Set([p.credenciamento ? `${String(n).padStart(5, '0')}/2` : null, `${numRaw}/20`, `${n}/20`].filter(Boolean))];
      for (const [i, termo] of termos.entries()) {
        const r = await buscar(termo);
        if (!r?.ok) { resultados.set(p.chave, { estado: 'nao-conferido', texto: r?.erro ?? 'sem resposta do CNET' }); break; }
        const e = escolherContrato(r.textos, p);
        if (e.semNumero && i < termos.length - 1) continue;
        resultados.set(p.chave, e.erro ? { estado: 'erro', texto: e.erro } : { estado: 'ok', texto: r.textos[e.indice] });
        break;
      }
    }
    return { estado: 'ok', resultados };
  } catch (e) {
    return { estado: 'erro', detalhe: e.message };
  } finally {
    chrome.tabs.remove(aba.id).catch(() => {});
  }
}
