-- Painéis gerenciais externos (uso externo — usuários fora do GAP-MN)
create table if not exists user_paineis_externos (
  id         uuid        primary key default gen_random_uuid(),
  user_id    uuid        not null references auth.users(id) on delete cascade,
  nome       text        not null,
  tipo       text        not null check (tipo in ('empenhos', 'rp')),
  sheets_url text        not null,
  unidade    text,
  criado_em  timestamptz not null default now()
);

alter table user_paineis_externos enable row level security;

create policy "user_paineis_externos_all"
  on user_paineis_externos for all
  using  (auth.uid() = user_id)
  with check (auth.uid() = user_id);
