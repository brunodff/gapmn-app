-- Termos Aditivos, revisão 4 do pacote da SCON (Ten Thiago, 24/11/2026):
--   1. anexos guardados no aditivo (seção 3H): depósito privado aditivos-docs, um PDF por item da Lista, para o .zip
--      sair completo em outra sessão ou outro computador;
--   2. unidades apoiadas em Reajustes › Configurações (seção 6.2): cada OM que o GAP-MN apoia com o seu Ordenador, ACI,
--      unidade de apoio e texto fixo do "I – CONTRATANTE"; o site usa sozinho a da OM que assina o contrato.
-- Como os Reajustes e os Aditivos: qualquer usuário logado edita (a especificação pede), e fica quem mexeu por último.

-- ── 1. Anexos do aditivo ────────────────────────────────────────────────────────────────────────────────────
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('aditivos-docs', 'aditivos-docs', false, 26214400, array[
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/zip'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

-- caminho: <id do aditivo>/<chave do item da Lista>/<nome>
drop policy if exists aditivos_docs_ler on storage.objects;
drop policy if exists aditivos_docs_enviar on storage.objects;
drop policy if exists aditivos_docs_apagar on storage.objects;
create policy aditivos_docs_ler on storage.objects for select to authenticated using (bucket_id = 'aditivos-docs');
create policy aditivos_docs_enviar on storage.objects for insert to authenticated
  with check (bucket_id = 'aditivos-docs' and name ~ '^[0-9a-f-]{36}/[a-z0-9_]{1,40}/[0-9A-Za-z_. ()-]{1,160}$');
create policy aditivos_docs_apagar on storage.objects for delete to authenticated using (bucket_id = 'aditivos-docs');

-- ── 2. Unidades apoiadas ───────────────────────────────────────────────────────────────────────────────────
create table if not exists public.apostilamento_unidades (
  sigla                text primary key check (sigla = upper(btrim(sigla)) and sigla <> ''),
  grafias              text[] not null default '{}',          -- outras siglas/grafias (CINDACTA IV, DACTAIV…)
  nome                 text,                                  -- nome por extenso (cabeçalho dos documentos)
  ug                   text,                                  -- código da UG (Declaração orçamentária, Ficha)
  artigo               text not null default 'do' check (artigo in ('do', 'da')),
  cefa                 boolean not null default false,        -- do CEFA: autoridade do campo 19 = DIRAD
  autoridade_superior  text,                                  -- fora do CEFA: cargo do campo 19 da Ficha
  padrao               boolean not null default false,        -- a unidade padrão (GAP-MN) não pode ser removida
  rascunho             boolean not null default false,        -- criada pela migração só com o texto fixo: completar
  ordenador            jsonb not null default '{}'::jsonb,
  aci                  jsonb not null default '{}'::jsonb,
  ug_apoio             jsonb not null default '{}'::jsonb,
  cidade               text not null default 'Manaus',
  texto_fixo           text,                                  -- "I – CONTRATANTE" da unidade (**negrito**)
  dias_alerta          integer check (dias_alerta between 1 and 365),
  atualizado_em        timestamptz not null default now(),
  atualizado_por       uuid default auth.uid(),
  atualizado_nome      text
);
create unique index if not exists apostilamento_unidades_um_padrao on public.apostilamento_unidades (padrao) where padrao;
alter table public.apostilamento_unidades enable row level security;
drop policy if exists unidades_ler on public.apostilamento_unidades;
drop policy if exists unidades_incluir on public.apostilamento_unidades;
drop policy if exists unidades_alterar on public.apostilamento_unidades;
drop policy if exists unidades_remover on public.apostilamento_unidades;
create policy unidades_ler on public.apostilamento_unidades for select to authenticated using (true);
create policy unidades_incluir on public.apostilamento_unidades for insert to authenticated with check (true);
create policy unidades_alterar on public.apostilamento_unidades for update to authenticated using (true) with check (true);
create policy unidades_remover on public.apostilamento_unidades for delete to authenticated using (not padrao);

-- migração: a configuração atual vira o cadastro GAP-MN (padrão), com a UG da tabela dos aditivos
insert into public.apostilamento_unidades (sigla, nome, ug, artigo, cefa, padrao, ordenador, aci, ug_apoio, cidade, texto_fixo, dias_alerta, atualizado_nome)
select 'GAP-MN', coalesce(nullif(o.nome, ''), 'Grupamento de Apoio de Manaus'), coalesce(nullif(o.ug, ''), '120630'), 'do', true, true,
       c.ordenador, c.aci, c.ug_apoio, c.cidade, nullif(c.textos_fixos_om ->> 'GAP-MN', ''), c.dias_alerta, 'migração 20261125c'
from public.apostilamento_config c
left join public.aditivos_om o on o.sigla = 'GAP-MN'
where c.id = 'padrao'
on conflict (sigla) do nothing;

-- cada texto fixo de outra OM vira um rascunho da unidade de mesma sigla, só com o texto fixo, para completar
insert into public.apostilamento_unidades (sigla, rascunho, texto_fixo, atualizado_nome)
select upper(btrim(t.k)), true, t.v, 'migração 20261125c'
from public.apostilamento_config c, jsonb_each_text(c.textos_fixos_om) as t(k, v)
where c.id = 'padrao' and upper(btrim(t.k)) <> 'GAP-MN' and coalesce(t.v, '') <> ''
on conflict (sigla) do nothing;

-- e cada OM que os aditivos já guardaram (nome, UG, artigo, autoridade) entra ou completa o cadastro
insert into public.apostilamento_unidades (sigla, nome, ug, artigo, autoridade_superior, rascunho, atualizado_nome)
select upper(btrim(o.sigla)), o.nome, o.ug, o.artigo, o.autoridade_superior, true, 'migração 20261125c'
from public.aditivos_om o
where upper(btrim(o.sigla)) <> 'GAP-MN'
on conflict (sigla) do update set
  nome = coalesce(apostilamento_unidades.nome, excluded.nome),
  ug = coalesce(apostilamento_unidades.ug, excluded.ug),
  autoridade_superior = coalesce(apostilamento_unidades.autoridade_superior, excluded.autoridade_superior);

select (select count(*) from public.apostilamento_unidades) as unidades,
       (select sigla from public.apostilamento_unidades where padrao) as padrao,
       (select coalesce(ordenador ->> 'nome', '') <> '' from public.apostilamento_unidades where padrao) as padrao_tem_ordenador,
       (select count(*) from storage.buckets where id = 'aditivos-docs') as bucket;
