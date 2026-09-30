/**
 * Coloca todas as tabelas (DataTables) da página no maior tamanho de página
 * disponível, para que fornecedores, itens, créditos e subelementos da
 * página 2 em diante também fiquem visíveis ao robô.
 *
 * Executada no mundo MAIN da página via chrome.scripting — precisa ser
 * autocontida (a função é serializada).
 */
export async function maximizarTabelasRunner() {
  const dorme = ms => new Promise(r => setTimeout(r, ms));

  // O seletor "N resultados por página" só existe depois que o DataTables inicializa
  let seletores = [];
  for (let t = 0; t < 8000; t += 300) {
    seletores = Array.from(document.querySelectorAll('select[name$="_length"]'));
    if (seletores.length) break;
    await dorme(300);
  }

  const ajustes = [];
  for (const sel of seletores) {
    const valores = Array.from(sel.options).map(o => Number(o.value)).filter(n => !Number.isNaN(n));
    if (!valores.length) continue;
    const maior = valores.includes(-1) ? -1 : Math.max(...valores); // -1 = "Todos"
    if (Number(sel.value) === maior) continue;
    // O DataTables escuta o change via jQuery; sem jQuery, evento nativo
    const $ = window.jQuery || window.$;
    if ($) $(sel).val(String(maior)).trigger('change');
    else { sel.value = String(maior); sel.dispatchEvent(new Event('change', { bubbles: true })); }
    ajustes.push(`${sel.name}=${maior === -1 ? 'todos' : maior}`);
  }
  if (!ajustes.length) return { ok: true, ajustes };

  // Espera o redesenho (pode ser AJAX): sem "processando" e contagem de linhas estável
  let anterior = -1, estavel = 0;
  for (let t = 0; t < 10000 && estavel < 3; t += 300) {
    await dorme(300);
    const processando = Array.from(document.querySelectorAll('.dataTables_processing'))
      .some(e => e.style.display !== 'none' && getComputedStyle(e).display !== 'none');
    const linhas = document.querySelectorAll('table tbody tr').length;
    estavel = !processando && linhas === anterior ? estavel + 1 : 0;
    anterior = linhas;
  }
  return { ok: true, ajustes };
}
