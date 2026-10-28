-- Envio automático do e-mail ao fiscal (solicitações de empenho) — out/2026.
-- Registro de cada leitura da função auto-solicitacoes-empenho (agendada ou pedida no painel),
-- para o painel mostrar a última verificação, o histórico e o que foi enviado em cada uma.
-- Gravação só pela função (service role); leitura para quem tem login.

create table if not exists public.solicitacoes_auto_execucoes (
  id            bigint generated always as identity primary key,
  executado_em  timestamptz not null default now(),
  origem        text not null default 'cron',          -- 'cron' | 'manual'
  usuario       uuid,                                  -- quem pediu, na verificação manual
  duracao_ms    integer,
  nes_lidas     integer not null default 0,
  novas         integer not null default 0,            -- solicitações criadas a partir de NE nova
  atualizadas   integer not null default 0,            -- só mudança de situação ou de NE
  enviados      integer not null default 0,
  sem_email     integer not null default 0,
  inativas      integer not null default 0,
  erros         integer not null default 0,
  itens         jsonb not null default '[]'::jsonb,    -- [{numero, ne, tipo, nova, email, resultado, motivo}]
  erro          text
);

create index if not exists solicitacoes_auto_execucoes_em on public.solicitacoes_auto_execucoes (executado_em desc);

alter table public.solicitacoes_auto_execucoes enable row level security;
drop policy if exists "sol_auto_exec_ler" on public.solicitacoes_auto_execucoes;
create policy "sol_auto_exec_ler" on public.solicitacoes_auto_execucoes
  for select to authenticated using (true);

-- o painel de envios lê o log por data
create index if not exists notificacoes_empenho_log_enviado_em on public.notificacoes_empenho_log (enviado_em desc);
