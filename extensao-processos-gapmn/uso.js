// Contagem anônima de uso das extensões do GAP-MN (página /uso-extensoes do gapmn.app): um código
// aleatório da instalação, a versão, o navegador e a UASG, se houver. Conta cada abertura da extensão.
// Qualquer falha é ignorada: a contagem nunca atrapalha o uso. No Firefox, só conta com a permissão
// "dados técnicos e de interação", que o usuário decide.
(() => {
  const URL_USO = 'https://fychrtyyqbzlfbzbvzqp.supabase.co/rest/v1/rpc/registrar_uso_extensao';
  const CHAVE = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZ5Y2hydHl5cWJ6bGZiemJ2enFwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzA5Mzk5NzcsImV4cCI6MjA4NjUxNTk3N30.i27qaCYX9qZ6liL9iXaOtYgddWgKyiM5eoobIN1loFw';
  const ua = navigator.userAgent;
  // O Edge também tem o objeto `browser`: o Firefox se reconhece pelo userAgent, não por ele.
  const navegador = /firefox/i.test(ua) ? 'firefox' : /\bEdg\//.test(ua) ? 'edge' : 'chrome';
  const api = globalThis.browser ?? globalThis.chrome;

  async function podeContar() {
    if (navegador !== 'firefox') return true;
    const p = await api.permissions.getAll();
    return Array.isArray(p.data_collection) && p.data_collection.includes('technicalAndInteraction');
  }

  globalThis.registrarUsoExtensao = async (extensao, uasg = null) => {
    try {
      if (!(await podeContar())) return;
      let { gapmn_install_id: id } = await api.storage.local.get('gapmn_install_id');
      if (!id) { id = crypto.randomUUID(); await api.storage.local.set({ gapmn_install_id: id }); }
      await fetch(URL_USO, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', apikey: CHAVE, Authorization: 'Bearer ' + CHAVE },
        body: JSON.stringify({
          p_install: id, p_extensao: extensao, p_versao: api.runtime.getManifest().version,
          p_navegador: navegador, p_uasg: uasg,
        }),
      });
    } catch {}
  };

  // <script src="uso.js" data-extensao="nome"> já conta ao abrir a página
  const nome = document.currentScript?.dataset?.extensao;
  if (nome) globalThis.registrarUsoExtensao(nome);
})();
