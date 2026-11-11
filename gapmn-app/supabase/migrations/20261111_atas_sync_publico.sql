-- Atas de Registro de Preço atualizadas sozinhas pelas APIs públicas (função sync-atas):
-- PNCP (atas novas, vigência/prorrogação, cancelamento) e Dados Abertos do Compras.gov.br
-- (itens das atas que ainda não têm). O bookmarklet arp-bot.js continua valendo para completar
-- os itens de ata recém-assinada antes da base pública.

alter table public.atas_gap_mn
  add column if not exists link_pncp text,
  add column if not exists numero_controle_pncp text,
  add column if not exists objeto text,
  add column if not exists sync_em timestamptz;

comment on column public.atas_gap_mn.link_pncp is 'Página da ata no PNCP (sync-atas)';
comment on column public.atas_gap_mn.sync_em is 'Última vez que a sync-atas mudou a linha';

-- Agendamento: 07:10 e 13:10 de Manaus (11:10 e 17:10 UTC), dias úteis, logo depois dos processos.
-- Mesma chave do Vault da sync-processos (secret SYNC_PROCESSOS_KEY nas funções).
select cron.unschedule('sync-atas-publico') where exists (select 1 from cron.job where jobname = 'sync-atas-publico');
select cron.schedule('sync-atas-publico', '10 11,17 * * 1-5', $$
    select net.http_post(
      url     := 'https://fychrtyyqbzlfbzbvzqp.supabase.co/functions/v1/sync-atas',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-sync-key', (select decrypted_secret from vault.decrypted_secrets where name = 'sync_processos_key')
      ),
      body    := '{"origem":"cron"}'::jsonb,
      timeout_milliseconds := 150000
    );
  $$);
