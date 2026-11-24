/**
 * Monitor da caixa licita.guarnaemn@gmail.com para o Acompanhamento do PCA (gapmn.app).
 *
 * Procura, nos últimos 3 dias:
 *   - Enviados: "SOLICITAÇÃO DE ANÁLISE JURÍDICA - PAG:XXXXX.XXXXXX/XXXX-XX"  → Em Análise Jurídica (CJU)
 *   - Entrada:  "DEVOLUÇÃO DA ANÁLISE DO PROCESSO Nº XXXXX.XXXXXX/XXXX-XX"     → Retornado da CJU
 *   - Entrada:  IMPUGNAÇÃO / ESCLARECIMENTO no assunto                          → alerta ao pregoeiro e à SLIC
 * e manda ao app só assunto, remetente, data e o começo do texto (para achar o PAG ou o nº do pregão).
 * O app não processa a mesma mensagem duas vezes (usa o ID da mensagem do Gmail).
 *
 * Instalação (na conta licita.guarnaemn@gmail.com):
 *   1. script.google.com → Novo projeto → colar este arquivo inteiro.
 *   2. Configurações do projeto → Propriedades do script → adicionar PCA_CHAVE = (o mesmo valor do secret
 *      PCA_WEBHOOK_KEY da função pca-automacao no Supabase).
 *   3. Selecionar a função "instalar" e clicar em Executar: autorizar o acesso ao Gmail. Cria o gatilho de
 *      10 em 10 minutos e já faz a primeira verificação.
 */
const URL_PCA = 'https://fychrtyyqbzlfbzbvzqp.supabase.co/functions/v1/pca-automacao';
const BUSCAS = [
  { caixa: 'enviados', q: 'in:sent subject:("SOLICITAÇÃO DE ANÁLISE JURÍDICA" OR "SOLICITACAO DE ANALISE JURIDICA") newer_than:3d' },
  { caixa: 'entrada', q: 'in:inbox subject:("DEVOLUÇÃO DA ANÁLISE DO PROCESSO" OR "DEVOLUCAO DA ANALISE DO PROCESSO") newer_than:3d' },
  { caixa: 'entrada', q: 'in:inbox (subject:impugnação OR subject:impugnacao OR subject:esclarecimento OR subject:esclarecimentos) newer_than:3d' },
];

function verificar() {
  const chave = PropertiesService.getScriptProperties().getProperty('PCA_CHAVE');
  if (!chave) throw new Error('Falta a propriedade do script PCA_CHAVE.');
  const eu = Session.getActiveUser().getEmail().toLowerCase();
  const limite = Date.now() - 3 * 24 * 3600 * 1000;
  const eventos = [];
  BUSCAS.forEach(function (b) {
    GmailApp.search(b.q, 0, 50).forEach(function (t) {
      t.getMessages().forEach(function (m) {
        if (m.getDate().getTime() < limite) return;
        const deMim = m.getFrom().toLowerCase().indexOf(eu) >= 0;
        if ((b.caixa === 'enviados') !== deMim) return; // enviados: só o que a SLIC mandou; entrada: só o que chegou
        eventos.push({
          origem: 'gmail', caixa: b.caixa, chave: m.getId(), assunto: m.getSubject(), remetente: m.getFrom(),
          data: m.getDate().toISOString(), texto: m.getPlainBody().slice(0, 3000),
        });
      });
    });
  });
  for (let i = 0; i < eventos.length; i += 50) {
    const r = UrlFetchApp.fetch(URL_PCA, {
      method: 'post', contentType: 'application/json', headers: { 'x-pca-key': chave }, muteHttpExceptions: true,
      payload: JSON.stringify({ acao: 'evento', eventos: eventos.slice(i, i + 50) }),
    });
    if (r.getResponseCode() >= 300) console.error('gapmn.app respondeu ' + r.getResponseCode() + ': ' + r.getContentText().slice(0, 300));
  }
  console.log(eventos.length + ' mensagem(ns) conferida(s).');
}

function instalar() {
  ScriptApp.getProjectTriggers().forEach(function (t) { ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('verificar').timeBased().everyMinutes(10).create();
  verificar();
}
