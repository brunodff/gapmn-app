-- Contagem anônima de uso das extensões (Painel ComprasNet e, depois, as outras).
-- Uma linha por instalação, extensão e dia. Sem nome, CPF ou e-mail: só um código
-- aleatório da instalação, versão, navegador e UASG (tirada dos números dos processos).
-- Escrita: só pela função registrar_uso_extensao (anon). Leitura: só DEV, pela
-- função resumo_uso_extensoes.

create table if not exists public.uso_extensoes (
  install_id  uuid        not null,
  extensao    text        not null,
  dia         date        not null default (now() at time zone 'America/Manaus')::date,
  versao      text,
  navegador   text,
  uasg        text,
  aberturas   integer     not null default 1,
  primeiro_em timestamptz not null default now(),
  ultimo_em   timestamptz not null default now(),
  primary key (install_id, extensao, dia)
);
create index if not exists uso_extensoes_dia_idx on public.uso_extensoes (extensao, dia);

alter table public.uso_extensoes enable row level security;
-- (sem políticas: anon e authenticated não leem nem escrevem direto)

create or replace function public.registrar_uso_extensao(
  p_install uuid, p_extensao text, p_versao text, p_navegador text, p_uasg text
) returns void
language plpgsql security definer set search_path = public as $$
begin
  if p_install is null or coalesce(p_extensao, '') !~ '^[a-z0-9-]{2,40}$' then return; end if;
  insert into uso_extensoes (install_id, extensao, versao, navegador, uasg)
  values (p_install, p_extensao, left(p_versao, 20), left(p_navegador, 20),
          nullif(left(regexp_replace(coalesce(p_uasg, ''), '\D', '', 'g'), 6), ''))
  on conflict (install_id, extensao, dia) do update set
    aberturas = uso_extensoes.aberturas + 1,
    versao    = excluded.versao,
    navegador = excluded.navegador,
    uasg      = coalesce(excluded.uasg, uso_extensoes.uasg),
    ultimo_em = now();
end $$;

revoke all on function public.registrar_uso_extensao(uuid, text, text, text, text) from public;
grant execute on function public.registrar_uso_extensao(uuid, text, text, text, text) to anon, authenticated;

-- Resumo para o painel do app (só perfil DEV)
create or replace function public.resumo_uso_extensoes()
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  hoje date := (now() at time zone 'America/Manaus')::date;
  r jsonb;
begin
  if not exists (select 1 from profiles where id = auth.uid() and setor = 'DEV') then
    raise exception 'acesso restrito ao DEV';
  end if;
  with ult as (   -- último registro de cada instalação nos últimos 30 dias
    select distinct on (install_id, extensao) install_id, extensao, versao, navegador, uasg
    from uso_extensoes where dia > hoje - 30
    order by install_id, extensao, dia desc
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'extensao',    t.extensao,
    'hoje',        (select count(distinct install_id) from uso_extensoes u where u.extensao = t.extensao and u.dia = hoje),
    'semana',      (select count(distinct install_id) from uso_extensoes u where u.extensao = t.extensao and u.dia > hoje - 7),
    'mes',         (select count(distinct install_id) from uso_extensoes u where u.extensao = t.extensao and u.dia > hoje - 30),
    'total',       (select count(distinct install_id) from uso_extensoes u where u.extensao = t.extensao),
    'aberturas_mes', (select coalesce(sum(aberturas), 0) from uso_extensoes u where u.extensao = t.extensao and u.dia > hoje - 30),
    'versoes',     (select jsonb_object_agg(coalesce(versao, '?'), n) from (select versao, count(*) n from ult where ult.extensao = t.extensao group by versao) v),
    'uasgs',       (select jsonb_object_agg(coalesce(uasg, '?'), n) from (select uasg, count(*) n from ult where ult.extensao = t.extensao group by uasg) v),
    'navegadores', (select jsonb_object_agg(coalesce(navegador, '?'), n) from (select navegador, count(*) n from ult where ult.extensao = t.extensao group by navegador) v),
    'por_dia',     (select jsonb_object_agg(dia, n) from (select dia, count(distinct install_id) n from uso_extensoes u where u.extensao = t.extensao and u.dia > hoje - 30 group by dia) v)
  ) order by t.extensao), '[]'::jsonb)
  into r
  from (select distinct extensao from uso_extensoes) t;
  return r;
end $$;

revoke all on function public.resumo_uso_extensoes() from public;
grant execute on function public.resumo_uso_extensoes() to authenticated;
