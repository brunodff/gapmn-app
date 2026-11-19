-- Pareceres referenciais da AGU no app (função sync-agu, uma vez por dia):
--   lista pública do buscador de Manifestações Jurídicas Referenciais da Consultoria-Geral da União
--   (https://cgu.agu.gov.br/referenciais/). A leitura e a classificação (grupo do órgão, licitações e
--   contratos) estão em supabase/functions/_shared/agu.ts.
-- Leitura: qualquer usuário logado (são dados públicos da AGU). Escrita: só a função (service role).

create table if not exists public.agu_referenciais (
  id             integer primary key,               -- id_referenciais do buscador da AGU
  orgao          text not null,                     -- COJAER, CONJUR-MD, SERVIÇOS (e-CJU)…
  grupo          text not null check (grupo in ('aeronautica', 'defesa', 'ecju', 'outros')),
  numero         integer,
  ano            integer,
  parecer        text not null default '',          -- "PARECER REFERENCIAL n. 00002/2025/COJAER/CGU/AGU"
  nup            text,
  data           date,
  assunto        text not null default '',
  observacao     text not null default '',          -- ementa
  url            text,                              -- PDF (SAPIENS ou cgu.agu.gov.br)
  validade       date,                              -- null: sem prazo informado
  licitacoes     boolean not null default false,    -- licitação, contratação direta, contrato ou ata
  na_lista       boolean not null default true,     -- false: saiu do buscador da AGU
  busca          tsvector generated always as (
                   to_tsvector('portuguese', coalesce(parecer, '') || ' ' || coalesce(assunto, '') || ' ' || coalesce(observacao, ''))
                 ) stored,
  primeira_vez   timestamptz not null default now(),
  atualizado_em  timestamptz not null default now()
);
create index if not exists agu_referenciais_data_idx on public.agu_referenciais (data desc nulls last, id desc);
create index if not exists agu_referenciais_busca_idx on public.agu_referenciais using gin (busca);

alter table public.agu_referenciais enable row level security;
drop policy if exists agu_referenciais_ler on public.agu_referenciais;
create policy agu_referenciais_ler on public.agu_referenciais for select to authenticated using (true);
revoke all on public.agu_referenciais from anon;
grant select on public.agu_referenciais to authenticated;

-- Agendamento: todo dia às 07:30 de Manaus (11:30 UTC), depois do TCU.
-- Mesma chave do Vault da sync-processos (secret SYNC_PROCESSOS_KEY nas funções).
select cron.unschedule('sync-agu-diario') where exists (select 1 from cron.job where jobname = 'sync-agu-diario');
select cron.schedule('sync-agu-diario', '30 11 * * *', $$
    select net.http_post(
      url     := 'https://fychrtyyqbzlfbzbvzqp.supabase.co/functions/v1/sync-agu',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-sync-key', (select decrypted_secret from vault.decrypted_secrets where name = 'sync_processos_key')
      ),
      body    := '{"origem":"cron"}'::jsonb,
      timeout_milliseconds := 90000
    );
  $$);
