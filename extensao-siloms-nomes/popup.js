'use strict';
// Painel da extensão: versão e os últimos eventos (cliques, arquivos, downloads)
var api = typeof browser !== 'undefined' ? browser : chrome;

document.getElementById('versao').textContent = 'versão ' + api.runtime.getManifest().version;

function hora(t) { return new Date(t).toLocaleTimeString('pt-BR'); }

async function mostrar() {
  var d = await api.storage.session.get('eventos');
  var lista = (d.eventos || []).slice().reverse();
  var ul = document.getElementById('eventos');
  ul.textContent = '';
  if (!lista.length) {
    var vazio = document.createElement('li');
    vazio.className = 'vazio';
    vazio.textContent = 'Nada ainda — clique em um documento no SILOMS.';
    ul.appendChild(vazio);
    return;
  }
  lista.forEach(function (ev) {
    var li = document.createElement('li');
    li.className = ev.tipo;
    var t = document.createElement('time');
    t.textContent = hora(ev.t);
    li.appendChild(t);
    li.appendChild(document.createTextNode(ev.texto));
    ul.appendChild(li);
  });
}

document.getElementById('limpar').addEventListener('click', async function () {
  await api.storage.session.set({ eventos: [] });
  mostrar();
});
mostrar();
