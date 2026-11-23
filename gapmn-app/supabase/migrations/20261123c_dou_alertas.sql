-- Alertas do Diário Oficial da União (função sync-dou, no jeito do Ro-dou do Ministério da Gestão): duas vezes por
-- dia o app busca no DOU cada termo cadastrado (busca exata, nas três seções, últimos 7 dias) e guarda o que achou.
--   • dou_termos: o que procurar. Qualquer usuário logado lê, cadastra e liga/desliga; apagar é ADMIN/DEV.
--   • dou_publicacoes: o que foi achado (dado público da Imprensa Nacional). Leitura: qualquer usuário logado;
--     escrita: só a função (service role).

create table if not exists public.dou_termos (
  id          bigint generated always as identity primary key,
  termo       text not null unique check (char_length(btrim(termo)) between 3 and 120),
  ativo       boolean not null default true,
  criado_nome text,
  criado_em   timestamptz not null default now()
);

create table if not exists public.dou_publicacoes (
  id            text primary key,                       -- classPK da Imprensa Nacional
  titulo        text not null default '',
  tipo          text,                                   -- Extrato de Contrato, Portaria, Aviso de Licitação…
  secao         text,                                   -- DO1, DO2, DO3 (E = edição extra)
  data          date,
  edicao        text,
  pagina        text,
  orgao         text,
  resumo        text not null default '',
  url           text,
  termos        text[] not null default '{}',
  primeira_vez  timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);
create index if not exists dou_publicacoes_data_idx on public.dou_publicacoes (data desc nulls last, primeira_vez desc);

alter table public.dou_termos enable row level security;
drop policy if exists dou_termos_ler on public.dou_termos;
drop policy if exists dou_termos_incluir on public.dou_termos;
drop policy if exists dou_termos_alterar on public.dou_termos;
drop policy if exists dou_termos_apagar on public.dou_termos;
create policy dou_termos_ler on public.dou_termos for select to authenticated using (true);
create policy dou_termos_incluir on public.dou_termos for insert to authenticated with check (true);
create policy dou_termos_alterar on public.dou_termos for update to authenticated using (true) with check (true);
create policy dou_termos_apagar on public.dou_termos for delete to authenticated using (public.eh_admin_dev());

alter table public.dou_publicacoes enable row level security;
drop policy if exists dou_publicacoes_ler on public.dou_publicacoes;
create policy dou_publicacoes_ler on public.dou_publicacoes for select to authenticated using (true);

revoke all on public.dou_termos, public.dou_publicacoes from anon;
grant select, insert, update, delete on public.dou_termos to authenticated;
grant select on public.dou_publicacoes to authenticated;

insert into public.dou_termos (termo, criado_nome) values
  ('Grupamento de Apoio de Manaus', 'gapmn.app'),
  ('UASG 120630', 'gapmn.app'),
  ('GAP-MN', 'gapmn.app')
on conflict (termo) do nothing;

-- Agendamento: 07:40 e 13:40 de Manaus (11:40 e 17:40 UTC), depois das edições da manhã e das extras.
-- Mesma chave do Vault da sync-processos (secret SYNC_PROCESSOS_KEY nas funções).
select cron.unschedule('sync-dou') where exists (select 1 from cron.job where jobname = 'sync-dou');
select cron.schedule('sync-dou', '40 11,17 * * *', $$
    select net.http_post(
      url     := 'https://fychrtyyqbzlfbzbvzqp.supabase.co/functions/v1/sync-dou',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-sync-key', (select decrypted_secret from vault.decrypted_secrets where name = 'sync_processos_key')
      ),
      body    := '{"origem":"cron"}'::jsonb,
      timeout_milliseconds := 120000
    );
  $$);
