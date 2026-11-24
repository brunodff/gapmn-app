-- Uso da IA gratuita (Groq) pelo chat do app e pela Pesquisa de Preços (24/11/2026).
-- Cada chamada grava os tokens gastos, para o chat mostrar quanto ainda resta da cota do dia: o Groq não informa
-- o uso do dia, só avisa quando acaba (supabase/functions/_shared/assistente/cota.ts).
-- Só as funções do Supabase (chave de serviço) leem e gravam: RLS ligado, sem políticas, sem acesso do app.
create table if not exists public.assistente_uso (
  id            bigint generated always as identity primary key,
  em            timestamptz not null default now(),
  usuario       uuid,                                  -- quem perguntou (null: Pesquisa de Preços, teste)
  origem        text not null default 'assistente',    -- 'assistente' | 'pesquisa-precos'
  modelo        text not null,
  tokens        integer not null default 0,
  resposta      boolean not null default false,        -- a chamada que deu a resposta (conta uma pergunta)
  esgotado_ate  timestamptz,                           -- aviso do Groq: modelo sem cota até esse horário
  limite_dia    integer,                               -- tokens por dia informados no aviso
  usado_dia     integer                                -- tokens já usados informados no aviso
);

create index if not exists assistente_uso_em on public.assistente_uso (em desc);

alter table public.assistente_uso enable row level security;
revoke all on public.assistente_uso from anon, authenticated;

-- conferência: deve voltar 0 linhas e rls = true
select count(*) as linhas, (select relrowsecurity from pg_class where oid = 'public.assistente_uso'::regclass) as rls
from public.assistente_uso;
