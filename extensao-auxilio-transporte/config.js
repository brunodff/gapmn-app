// Endereços fixos da extensão. A chave "supabaseAnon" é a pública do banco, a mesma que vai em qualquer site;
// sozinha ela não lê nem grava nada do auxílio transporte. A chave de envio e o código do painel NÃO ficam no
// repositório (que é público): aqui vão marcadores, e o script que gera o pacote (.zip) põe os valores reais.
// Assim, quem instala o pacote não configura nada.
globalThis.CONFIG_AT = {
  versao: "1.3.0",
  supabaseUrl: "https://fychrtyyqbzlfbzbvzqp.supabase.co",
  supabaseAnon: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZ5Y2hydHl5cWJ6bGZiemJ2enFwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzA5Mzk5NzcsImV4cCI6MjA4NjUxNTk3N30.i27qaCYX9qZ6liL9iXaOtYgddWgKyiM5eoobIN1loFw",
  painelUrl: "https://auxilio-transporte.pages.dev/",
  gerencia: "/auxilio-transporte/gerencia.xhtml",
  fuso: "America/Sao_Paulo",
  chaveEnvio: "__CHAVE_DE_ENVIO__",
  codigoPainel: "__CODIGO_DO_PAINEL__",
};
