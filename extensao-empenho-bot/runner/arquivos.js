/**
 * PDFs guardados para os subprocessos do SILOMS: a solicitação de empenho
 * arrastada para o painel e a declaração do SICAF (baixada na conferência ou
 * arrastada). IndexedDB da própria extensão — o painel grava, o background lê
 * quando o robô do SILOMS (content script) pede o arquivo para anexar.
 *
 * Chaves: "sol:<nº da solicitação>" e "sicaf:<CNPJ só dígitos>".
 */

const BANCO = 'gapmn-empenho-arquivos';
const LOJA = 'pdfs';
const VALIDADE_DIAS = 60;   // PDFs mais antigos que isso saem sozinhos

function abrir() {
  return new Promise((res, rej) => {
    const r = indexedDB.open(BANCO, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(LOJA, { keyPath: 'chave' });
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}

async function transacao(modo, fn) {
  const db = await abrir();
  try {
    return await new Promise((res, rej) => {
      const t = db.transaction(LOJA, modo);
      const resultado = fn(t.objectStore(LOJA));
      // get() sem registro dá result undefined: devolve isso, não o pedido
      t.oncomplete = () => res(resultado instanceof IDBRequest ? resultado.result : resultado);
      t.onerror = () => rej(t.error);
      t.onabort = () => rej(t.error);
    });
  } finally {
    db.close();
  }
}

export const chaveSolicitacao = numero => `sol:${String(numero ?? '').trim().toUpperCase()}`;
export const chaveSicaf = cnpj => `sicaf:${String(cnpj ?? '').replace(/\D/g, '')}`;

/** Guarda um PDF (ArrayBuffer ou Uint8Array). */
export async function guardarPdf(chave, nome, bytes) {
  const dados = bytes instanceof Uint8Array ? bytes.slice() : new Uint8Array(bytes.slice(0));
  await transacao('readwrite', loja => loja.put({ chave, nome, tamanho: dados.length, em: Date.now(), dados }));
  limparAntigos().catch(() => {});
}

/** { chave, nome, tamanho, em, dados: Uint8Array } ou null */
export async function lerPdf(chave) {
  return (await transacao('readonly', loja => loja.get(chave))) ?? null;
}

/** Quais das chaves têm PDF guardado: { chave: { nome, em } } */
export async function pdfsGuardados(chaves) {
  const out = {};
  for (const c of chaves) {
    const r = await lerPdf(c).catch(() => null);
    if (r) out[c] = { nome: r.nome, em: r.em, tamanho: r.tamanho };
  }
  return out;
}

async function limparAntigos() {
  const limite = Date.now() - VALIDADE_DIAS * 86400000;
  await transacao('readwrite', loja => {
    const cursor = loja.openCursor();
    cursor.onsuccess = () => {
      const c = cursor.result;
      if (!c) return;
      if ((c.value.em ?? 0) < limite) c.delete();
      c.continue();
    };
  });
}

/** Uint8Array → base64 (em pedaços: String.fromCharCode estoura com arquivo grande) */
export function paraBase64(bytes) {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}
