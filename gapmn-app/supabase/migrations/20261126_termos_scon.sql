-- Termos da SCON (revisão 7 do Chefe da SCON, 25/11/2026). O Termo de Apostilamento (Reajustes) e o Termo Aditivo
-- (Termos Aditivos) são documentos da Seção de Contratos: só usuários SCON os geram (ADMIN e DEV também, para
-- suporte). O site pede o registro ao banco ANTES de gerar: quem não é SCON recebe erro, então a regra vale no
-- servidor e não só no botão. O registro guarda de qual salvamento (versão) o termo saiu, para conferência.
-- Também: o bloco do Termo Aditivo no aditivo (nº do termo, MINUTA, garantia, complemento) só muda por SCON, e quem
-- salvou por último (id, nome, data) é gravado pelo banco a cada salvamento do aditivo.

create table if not exists public.termos_scon_gerados (
  id               bigserial primary key,
  tipo             text not null check (tipo in ('apostilamento', 'aditivo')),
  numero_contrato  text not null,
  referencia       text,            -- aditivo: id do registro; apostilamento: nº do instrumento
  versao           integer,         -- versão do registro salvo usada na geração
  salvo_em         timestamptz,     -- quando esse registro foi salvo
  gerado_por       uuid not null default auth.uid(),
  gerado_nome      text,
  gerado_em        timestamptz not null default now()
);
create index if not exists termos_scon_gerados_contrato on public.termos_scon_gerados (numero_contrato, gerado_em desc);
alter table public.termos_scon_gerados enable row level security;
drop policy if exists termos_scon_ler on public.termos_scon_gerados;
create policy termos_scon_ler on public.termos_scon_gerados for select to authenticated using (true);
-- sem política de inclusão/alteração/remoção: só a função abaixo grava

create or replace function public.registrar_termo_scon(
  p_tipo text, p_numero_contrato text, p_referencia text, p_versao integer, p_salvo_em timestamptz, p_nome text
) returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id bigint;
begin
  if not public.eh_scon_admin_dev() then
    raise exception 'Somente a Seção de Contratos gera o termo' using errcode = '42501';
  end if;
  insert into public.termos_scon_gerados (tipo, numero_contrato, referencia, versao, salvo_em, gerado_por, gerado_nome)
  values (p_tipo, p_numero_contrato, p_referencia, p_versao, p_salvo_em, auth.uid(), p_nome)
  returning id into v_id;
  return v_id;
end;
$$;
revoke all on function public.registrar_termo_scon(text, text, text, integer, timestamptz, text) from public, anon;
grant execute on function public.registrar_termo_scon(text, text, text, integer, timestamptz, text) to authenticated;

-- aditivo: bloco da SCON protegido e "salvo por" gravado pelo banco
create or replace function public.aditivo_ao_salvar()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'UPDATE'
     and coalesce(new.dados -> 'termo_aditivo', 'null'::jsonb) is distinct from coalesce(old.dados -> 'termo_aditivo', 'null'::jsonb)
     and not public.eh_scon_admin_dev() then
    raise exception 'Somente a Seção de Contratos altera os dados do Termo Aditivo (nº, MINUTA, garantia)' using errcode = '42501';
  end if;
  if tg_op = 'INSERT'
     and coalesce(new.dados -> 'termo_aditivo', 'null'::jsonb) not in ('null'::jsonb, '{}'::jsonb)
     and not public.eh_scon_admin_dev() then
    new.dados := new.dados - 'termo_aditivo';
  end if;
  if auth.uid() is not null then
    new.atualizado_por := auth.uid();
    if tg_op = 'INSERT' then new.criado_por := coalesce(new.criado_por, auth.uid()); end if;
  end if;
  new.atualizado_em := now();
  return new;
end;
$$;
drop trigger if exists aditivo_ao_salvar on public.contratos_aditivos;
create trigger aditivo_ao_salvar before insert or update on public.contratos_aditivos
  for each row execute function public.aditivo_ao_salvar();

notify pgrst, 'reload schema';
