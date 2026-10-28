-- Liga o envio automático do e-mail ao fiscal: a função auto-solicitacoes-empenho roda a cada 15
-- minutos, das 07:00 às 21:45 de Manaus (11:00 às 01:45 UTC), todos os dias. Aplicar só depois de
-- publicar a função e da migração 20261028_solicitacoes_auto_execucoes.sql.
-- A chave é a mesma da sincronização de processos (Vault 'sync_processos_key' = secret SYNC_PROCESSOS_KEY).
-- Para desligar: select cron.unschedule('auto-solicitacoes-empenho');

do $$
begin
  if exists (select 1 from cron.job where jobname = 'auto-solicitacoes-empenho') then
    perform cron.unschedule('auto-solicitacoes-empenho');
  end if;
end $$;

select cron.schedule(
  'auto-solicitacoes-empenho',
  '*/15 0,1,11-23 * * *',
  $cron$
    select net.http_post(
      url     := 'https://fychrtyyqbzlfbzbvzqp.supabase.co/functions/v1/auto-solicitacoes-empenho',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-sync-key', (select decrypted_secret from vault.decrypted_secrets where name = 'sync_processos_key')
      ),
      body    := '{"origem":"cron"}'::jsonb,
      timeout_milliseconds := 150000
    );
  $cron$
);
