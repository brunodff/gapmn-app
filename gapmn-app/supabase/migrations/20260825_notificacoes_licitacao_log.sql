create table if not exists public.notificacoes_licitacao_log (
  id           uuid primary key default gen_random_uuid(),
  processo_id  uuid references public.calendario_licitacoes(id) on delete set null,
  novo_status  text not null,
  email_destino text not null,
  sucesso      boolean not null default false,
  erro         text,
  created_at   timestamptz default now()
);

alter table public.notificacoes_licitacao_log enable row level security;

create policy "autenticados leem log licitacao"
  on public.notificacoes_licitacao_log for select
  to authenticated using (true);

create policy "service role insere log licitacao"
  on public.notificacoes_licitacao_log for insert
  to service_role with check (true);
