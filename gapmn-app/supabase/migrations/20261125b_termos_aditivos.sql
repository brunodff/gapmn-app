-- Termos Aditivos (pedido do Chefe da SCON, Ten Thiago, 24/11/2026). Como os Reajustes: qualquer usuário logado
-- prepara o aditivo (são os fiscais que geram os documentos); apagar, só quem criou ou SCON, ADMIN e DEV.

create table if not exists public.contratos_aditivos (
  id               uuid primary key default gen_random_uuid(),
  numero_contrato  text not null,
  numero_aditivo   integer,
  dados            jsonb not null default '{}',   -- o "dados.json" do kit da SCON
  estado           jsonb not null default '{}',   -- escolhas da tela e resultado das conferências (SICAF, regularidade)
  situacao         text not null default 'rascunho' check (situacao in ('rascunho', 'gerado')),
  versao           integer not null default 1,     -- quem salva confere a versão (não sobrescreve o trabalho de outro)
  criado_em        timestamptz not null default now(),
  criado_por       uuid default auth.uid(),
  criado_nome      text,
  atualizado_em    timestamptz not null default now(),
  atualizado_por   uuid,
  atualizado_nome  text
);
create index if not exists contratos_aditivos_contrato on public.contratos_aditivos (numero_contrato, criado_em desc);
alter table public.contratos_aditivos enable row level security;
drop policy if exists "aditivos leem" on public.contratos_aditivos;
create policy "aditivos leem" on public.contratos_aditivos for select to authenticated using (true);
drop policy if exists "aditivos criam" on public.contratos_aditivos;
create policy "aditivos criam" on public.contratos_aditivos for insert to authenticated with check (true);
drop policy if exists "aditivos editam" on public.contratos_aditivos;
create policy "aditivos editam" on public.contratos_aditivos for update to authenticated using (true) with check (true);
drop policy if exists "aditivos apagam" on public.contratos_aditivos;
create policy "aditivos apagam" on public.contratos_aditivos for delete to authenticated using (
  criado_por = auth.uid()
  or exists (select 1 from public.profiles where id = auth.uid() and upper(coalesce(setor, '')) in ('SCON', 'ADMIN', 'DEV'))
);

-- OM que assina o contrato: nome, UG e artigo ("do GAP-MN", "da BAMN") e, fora do CEFA, a autoridade do campo 19
-- da Ficha. Quem gera completa o que faltar e o site guarda para as próximas vezes (especificação, seção 3D).
create table if not exists public.aditivos_om (
  sigla                text primary key,
  nome                 text,
  ug                   text,
  artigo               text not null default 'do' check (artigo in ('do', 'da')),
  autoridade_superior  text,
  atualizado_em        timestamptz not null default now(),
  atualizado_nome      text
);
alter table public.aditivos_om enable row level security;
drop policy if exists "aditivos_om leem" on public.aditivos_om;
create policy "aditivos_om leem" on public.aditivos_om for select to authenticated using (true);
drop policy if exists "aditivos_om gravam" on public.aditivos_om;
create policy "aditivos_om gravam" on public.aditivos_om for insert to authenticated with check (true);
drop policy if exists "aditivos_om alteram" on public.aditivos_om;
create policy "aditivos_om alteram" on public.aditivos_om for update to authenticated using (true) with check (true);
insert into public.aditivos_om (sigla, nome, ug, artigo) values ('GAP-MN', 'Grupamento de Apoio de Manaus', '120630', 'do')
  on conflict (sigla) do nothing;

select (select count(*) from information_schema.tables where table_schema = 'public' and table_name in ('contratos_aditivos', 'aditivos_om')) as tabelas,
       (select ug from public.aditivos_om where sigla = 'GAP-MN') as ug_gapmn;
