-- Reajuste por apostilamento (SCON): cadastro do reajuste de cada contrato e configuração do motor.
--
-- O motor da SCON (src/lib/apostilamento/motor, Python no navegador) recebe os dados do contrato e gera
-- a Memória de Cálculo, a Declaração de Disponibilidade Orçamentária, o Parecer Técnico e o Termo de
-- Apostilamento. Aqui ficam:
--   • contratos_apostilamento: os dados de cada contrato no formato do motor (itens, índice, reajustes,
--     termos aditivos, último empenho), pela chave numero_contrato (a mesma do contratos_previsao, que
--     sobrevive à reimportação do contratos_scon);
--   • apostilamento_config: Ordenador de Despesas, Agente de Controle Interno e textos fixos do
--     "I – CONTRATANTE" por OM. Esses dados não ficam no código (o repositório é público).
-- Leitura e escrita do cadastro: SCON, ADMIN e DEV. Configuração: leitura SCON/ADMIN/DEV, escrita ADMIN/DEV.

create or replace function public.eh_scon_admin_dev()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.profiles p
                 where p.id = auth.uid() and upper(coalesce(p.setor, '')) in ('SCON', 'ADMIN', 'DEV'));
$$;

create or replace function public.eh_admin_dev()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.profiles p
                 where p.id = auth.uid() and upper(coalesce(p.setor, '')) in ('ADMIN', 'DEV'));
$$;

create table if not exists public.contratos_apostilamento (
  numero_contrato     text primary key,
  dados               jsonb not null default '{}'::jsonb,
  reajustes_aplicados integer not null default 0 check (reajustes_aplicados >= 0),
  dedicacao_exclusiva boolean not null default false,
  versao              integer not null default 1,
  atualizado_por      uuid references auth.users (id) on delete set null,
  atualizado_nome     text,
  atualizado_em       timestamptz not null default now()
);

alter table public.contratos_apostilamento enable row level security;
drop policy if exists apost_ler on public.contratos_apostilamento;
drop policy if exists apost_incluir on public.contratos_apostilamento;
drop policy if exists apost_alterar on public.contratos_apostilamento;
drop policy if exists apost_apagar on public.contratos_apostilamento;
create policy apost_ler on public.contratos_apostilamento for select to authenticated using (public.eh_scon_admin_dev());
create policy apost_incluir on public.contratos_apostilamento for insert to authenticated with check (public.eh_scon_admin_dev());
create policy apost_alterar on public.contratos_apostilamento for update to authenticated
  using (public.eh_scon_admin_dev()) with check (public.eh_scon_admin_dev());
create policy apost_apagar on public.contratos_apostilamento for delete to authenticated using (public.eh_admin_dev());

create table if not exists public.apostilamento_config (
  id              text primary key default 'padrao' check (id = 'padrao'),
  ordenador       jsonb not null default '{}'::jsonb,
  aci             jsonb not null default '{}'::jsonb,
  cidade          text not null default 'Manaus',
  ug_apoio        jsonb not null default '{}'::jsonb,
  textos_fixos_om jsonb not null default '{}'::jsonb,
  dias_alerta     integer not null default 60 check (dias_alerta between 1 and 365),
  atualizado_por  uuid references auth.users (id) on delete set null,
  atualizado_nome text,
  atualizado_em   timestamptz not null default now()
);

alter table public.apostilamento_config enable row level security;
drop policy if exists apost_cfg_ler on public.apostilamento_config;
drop policy if exists apost_cfg_incluir on public.apostilamento_config;
drop policy if exists apost_cfg_alterar on public.apostilamento_config;
create policy apost_cfg_ler on public.apostilamento_config for select to authenticated using (public.eh_scon_admin_dev());
create policy apost_cfg_incluir on public.apostilamento_config for insert to authenticated with check (public.eh_admin_dev());
create policy apost_cfg_alterar on public.apostilamento_config for update to authenticated
  using (public.eh_admin_dev()) with check (public.eh_admin_dev());

insert into public.apostilamento_config (id) values ('padrao') on conflict (id) do nothing;

revoke all on public.contratos_apostilamento, public.apostilamento_config from anon;
grant select, insert, update, delete on public.contratos_apostilamento to authenticated;
grant select, insert, update on public.apostilamento_config to authenticated;
