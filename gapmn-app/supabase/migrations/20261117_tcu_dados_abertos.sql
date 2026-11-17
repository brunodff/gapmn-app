-- Dados Abertos do TCU no app (função sync-tcu, uma vez por dia):
--   • tcu_acordaos: acórdãos sobre licitações e contratos (a regra do que entra está em
--     supabase/functions/_shared/tcu.ts), com temas e destaque para Defesa e Manaus;
--   • tcu_informativos: enunciados do Informativo de Licitações e Contratos;
--   • tcu_sancoes: fornecedores do GAP-MN (contrato ou ata vigente) que aparecem na lista de
--     licitantes inidôneos ou no cadastro de contas julgadas irregulares (CADIRREG). Só pessoa
--     jurídica. O app só avisa: nada bloqueia contrato, ata ou empenho;
--   • tcu_cnpj_conferido: quando cada CNPJ passou pelo CADIRREG (rodízio de 7 dias);
--   • tcu_estado: ETag do CSV do informativo e marcas da sincronização.
-- Leitura: qualquer usuário logado (são dados públicos do TCU). Escrita: só a função (service role).

create table if not exists public.tcu_acordaos (
  key          text primary key,               -- "ACORDAO-COMPLETO-2783222"
  numero       integer,
  ano          integer,
  colegiado    text,
  data_sessao  date,
  relator      text,
  titulo       text,
  sumario      text,
  situacao     text,
  temas        text[] not null default '{}',
  destaque     boolean not null default false, -- cita Defesa, Forças Armadas ou Manaus
  url_acordao  text,
  url_pdf      text,
  criado_em    timestamptz not null default now()
);
create index if not exists tcu_acordaos_sessao_idx on public.tcu_acordaos (data_sessao desc, numero desc);

create table if not exists public.tcu_informativos (
  key        text primary key,                 -- "INFORMATIVO-LC-17265-0"
  numero     integer not null,
  ano        integer,
  titulo     text,
  colegiado  text,
  acordao    text,                             -- "Acórdão 2271/2026 Plenário, Representação, Relator …"
  enunciado  text not null,
  texto      text,
  temas      text[] not null default '{}',
  busca      tsvector generated always as (to_tsvector('portuguese', coalesce(enunciado, '') || ' ' || coalesce(acordao, ''))) stored,
  criado_em  timestamptz not null default now()
);
create index if not exists tcu_informativos_numero_idx on public.tcu_informativos (numero desc);
create index if not exists tcu_informativos_busca_idx on public.tcu_informativos using gin (busca);

create table if not exists public.tcu_sancoes (
  id                bigserial primary key,
  cnpj              text not null check (cnpj ~ '^\d{14}$'),
  lista             text not null check (lista in ('INIDONEO', 'CONTAS_IRREGULARES')),
  processo          text not null default '',
  nome              text,
  acordao           text,
  data_acordao      date,
  data_transito     date,
  data_final        date,                      -- fim da sanção (inidôneo)
  link_deliberacao  text,
  link_processo     text,
  vinculos          jsonb not null default '{}'::jsonb,  -- {"contratos": [...], "atas": [...]} na última conferência
  ativo             boolean not null default true,       -- false: saiu da lista ou deixou de ser fornecedor
  primeira_vez      timestamptz not null default now(),
  ultima_vez        timestamptz not null default now(),
  saiu_em           timestamptz,
  unique (cnpj, lista, processo)
);
create index if not exists tcu_sancoes_ativo_idx on public.tcu_sancoes (ativo, lista);

create table if not exists public.tcu_cnpj_conferido (
  cnpj         text primary key,
  cadirreg_em  timestamptz not null
);

create table if not exists public.tcu_estado (
  chave          text primary key,
  valor          text,
  atualizado_em  timestamptz not null default now()
);

do $$
declare t text;
begin
  foreach t in array array['tcu_acordaos', 'tcu_informativos', 'tcu_sancoes', 'tcu_cnpj_conferido', 'tcu_estado'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_ler', t);
    execute format('create policy %I on public.%I for select to authenticated using (true)', t || '_ler', t);
    execute format('revoke all on public.%I from anon', t);
    execute format('grant select on public.%I to authenticated', t);
  end loop;
end $$;

-- Agendamento: todo dia às 07:20 de Manaus (11:20 UTC), depois das atas.
-- Mesma chave do Vault da sync-processos (secret SYNC_PROCESSOS_KEY nas funções).
select cron.unschedule('sync-tcu-diario') where exists (select 1 from cron.job where jobname = 'sync-tcu-diario');
select cron.schedule('sync-tcu-diario', '20 11 * * *', $$
    select net.http_post(
      url     := 'https://fychrtyyqbzlfbzbvzqp.supabase.co/functions/v1/sync-tcu',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-sync-key', (select decrypted_secret from vault.decrypted_secrets where name = 'sync_processos_key')
      ),
      body    := '{"origem":"cron"}'::jsonb,
      timeout_milliseconds := 150000
    );
  $$);
