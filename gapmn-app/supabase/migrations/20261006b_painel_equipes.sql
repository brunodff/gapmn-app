-- Painel ComprasNet: anotações da equipe separadas por UASG, com "código da equipe".
--
-- Antes ficavam num projeto Supabase à parte, abertas a qualquer instalação da
-- extensão. Aqui as tabelas não têm política nenhuma (ninguém lê nem grava direto):
-- tudo passa pelas funções painel_ler / painel_gravar, que exigem o código de uma
-- equipe e só alcançam as UASGs dessa equipe. A UASG sai do número do processo
-- ("Pregão Eletrônico 120630 - 90001/2025" → 120630).

-- ── Equipes e UASGs ──────────────────────────────────────────────────────────
create table if not exists public.painel_equipes (
  id          uuid primary key default gen_random_uuid(),
  nome        text not null,
  codigo_hash text not null unique,          -- sha256 do código normalizado (nunca o código)
  criado_em   timestamptz not null default now()
);
create table if not exists public.painel_equipe_uasgs (
  uasg      text primary key,                -- cada UASG pertence a uma equipe só
  equipe_id uuid not null references public.painel_equipes(id) on delete cascade,
  desde     timestamptz not null default now()
);
alter table public.painel_equipes      enable row level security;
alter table public.painel_equipe_uasgs enable row level security;

create or replace function public.painel_uasg(p_identificacao text)
returns text language sql immutable as $$
  select substring(p_identificacao from '(\d{6})\s*-\s*\d+/\d{4}')
$$;

-- ── Tabelas das anotações (mesmas colunas do projeto antigo + uasg) ─────────
create table if not exists public.painel_processos (
  identificacao    text primary key,
  tipo_contratacao text,
  updated_at       timestamptz default now(),
  uasg text generated always as (public.painel_uasg(identificacao)) stored
);
create table if not exists public.painel_itens_obs (
  identificacao text not null,
  numero_item   integer not null,
  observacao    text,
  updated_at    timestamptz default now(),
  uasg text generated always as (public.painel_uasg(identificacao)) stored,
  primary key (identificacao, numero_item)
);
create table if not exists public.painel_itens_etapa (
  identificacao text not null,
  numero_item   integer not null,
  cnpj          text not null,
  etapa         text,
  updated_at    timestamptz default now(),
  uasg text generated always as (public.painel_uasg(identificacao)) stored,
  primary key (identificacao, numero_item, cnpj)
);
create table if not exists public.painel_itens_valor_negociado (
  identificacao text not null,
  numero_item   integer not null,
  cnpj          text not null,
  valor         numeric,
  updated_at    timestamptz default now(),
  uasg text generated always as (public.painel_uasg(identificacao)) stored,
  primary key (identificacao, numero_item, cnpj)
);
create table if not exists public.painel_itens_exequibilidade_comprovada (
  identificacao text not null,
  numero_item   integer not null,
  cnpj          text not null,
  comprovado    boolean,
  updated_at    timestamptz default now(),
  uasg text generated always as (public.painel_uasg(identificacao)) stored,
  primary key (identificacao, numero_item, cnpj)
);
create table if not exists public.painel_habilitacao (
  identificacao text not null,
  cnpj          text not null,
  prioridade boolean, habilitado boolean,
  doc_contrato_social boolean, doc_socio_cpf boolean, doc_sicaf boolean, doc_cadin boolean,
  doc_consolidada_tcu boolean, doc_cadicon boolean, doc_cei boolean, doc_fgts boolean,
  doc_cndt boolean, doc_cnj boolean, doc_decl_menor boolean, doc_falencia boolean,
  doc_balanco boolean, doc_liquidez_geral boolean, doc_solvencia_geral boolean,
  doc_liquidez_corrente boolean, doc_capacidade_tecnica boolean, doc_sustentabilidade boolean,
  obs           text,
  updated_at    timestamptz default now(),
  uasg text generated always as (public.painel_uasg(identificacao)) stored,
  primary key (identificacao, cnpj)
);
create table if not exists public.painel_amostras (
  identificacao text not null,
  numero_item   integer not null,
  cnpj          text not null,
  data_limite   date,
  recebida      boolean,
  observacao    text,
  updated_at    timestamptz default now(),
  uasg text generated always as (public.painel_uasg(identificacao)) stored,
  primary key (identificacao, numero_item, cnpj)
);
create table if not exists public.painel_ocorrencias (
  identificacao  text not null,
  numero_item    integer not null,
  cnpj           text not null,
  tipo           text not null,
  motivo         text,
  documento      text,
  item_documento text,
  created_at     timestamptz default now(),
  uasg text generated always as (public.painel_uasg(identificacao)) stored,
  primary key (identificacao, numero_item, cnpj, tipo)
);

do $$
declare t text;
begin
  foreach t in array array['painel_processos','painel_itens_obs','painel_itens_etapa','painel_itens_valor_negociado',
    'painel_itens_exequibilidade_comprovada','painel_habilitacao','painel_amostras','painel_ocorrencias'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create index if not exists %I on public.%I (uasg)', t || '_uasg_idx', t);
  end loop;
end $$;

-- ── Código da equipe ─────────────────────────────────────────────────────────
-- Código de 12 caracteres (sem 0/O/1/I), mostrado como XXXX-XXXX-XXXX. Guardado só o hash.
create or replace function public.painel_hash_codigo(p_codigo text)
returns text language sql immutable as $$
  select encode(extensions.digest(upper(regexp_replace(coalesce(p_codigo, ''), '[^A-Za-z0-9]', '', 'g')), 'sha256'), 'hex')
$$;

create or replace function public.painel_gerar_codigo()
returns text language plpgsql volatile set search_path = public, extensions as $$
declare
  alfa constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  b bytea := extensions.gen_random_bytes(12);
  c text := '';
begin
  for i in 0..11 loop
    c := c || substr(alfa, (get_byte(b, i) % 32) + 1, 1);
    if i in (3, 7) then c := c || '-'; end if;
  end loop;
  return c;
end $$;

create or replace function public.painel_equipe_do_codigo(p_codigo text)
returns uuid language sql stable security definer set search_path = public, extensions as $$
  select id from painel_equipes where codigo_hash = painel_hash_codigo(p_codigo)
$$;

-- Confere o código: { nome, uasgs } ou null
create or replace function public.painel_equipe(p_codigo text)
returns jsonb language plpgsql stable security definer set search_path = public, extensions as $$
declare v uuid := painel_equipe_do_codigo(p_codigo);
begin
  if v is null then return null; end if;
  return (select jsonb_build_object('nome', e.nome,
            'uasgs', coalesce((select jsonb_agg(u.uasg order by u.uasg) from painel_equipe_uasgs u where u.equipe_id = e.id), '[]'::jsonb))
          from painel_equipes e where e.id = v);
end $$;

-- Cria uma equipe e assume as UASGs informadas que ainda não têm dono.
-- Devolve o código (única vez em que ele aparece).
create or replace function public.painel_criar_equipe(p_nome text, p_uasgs text[])
returns jsonb language plpgsql volatile security definer set search_path = public, extensions as $$
declare
  v_codigo text := painel_gerar_codigo();
  v_id uuid;
  v_uasgs text[] := array(select distinct x from unnest(coalesce(p_uasgs, '{}')) x where x ~ '^\d{6}$');
  v_assumidas text[]; v_outras text[];
begin
  if length(trim(coalesce(p_nome, ''))) < 2 then raise exception 'informe o nome da equipe ou da OM'; end if;
  if cardinality(v_uasgs) = 0 then raise exception 'nenhuma UASG informada (sincronize os processos antes)'; end if;
  insert into painel_equipes (nome, codigo_hash) values (left(trim(p_nome), 60), painel_hash_codigo(v_codigo)) returning id into v_id;
  insert into painel_equipe_uasgs (uasg, equipe_id) select u, v_id from unnest(v_uasgs) u on conflict (uasg) do nothing;
  v_assumidas := array(select uasg from painel_equipe_uasgs where equipe_id = v_id order by 1);
  v_outras := array(select u from unnest(v_uasgs) u where u <> all(v_assumidas) order by 1);
  if cardinality(v_assumidas) = 0 then
    delete from painel_equipes where id = v_id;
    raise exception 'as UASGs % já têm equipe — peça o código a quem já usa o painel na sua unidade', array_to_string(v_outras, ', ');
  end if;
  return jsonb_build_object('codigo', v_codigo, 'nome', trim(p_nome), 'uasgs', to_jsonb(v_assumidas), 'de_outra_equipe', to_jsonb(v_outras));
end $$;

-- ── Leitura e gravação ───────────────────────────────────────────────────────
create or replace function public.painel_conflito(p_tabela text)
returns text language sql immutable as $$
  select case p_tabela
    when 'processos'                       then 'identificacao'
    when 'itens_obs'                       then 'identificacao,numero_item'
    when 'itens_etapa'                     then 'identificacao,numero_item,cnpj'
    when 'itens_valor_negociado'           then 'identificacao,numero_item,cnpj'
    when 'itens_exequibilidade_comprovada' then 'identificacao,numero_item,cnpj'
    when 'habilitacao'                     then 'identificacao,cnpj'
    when 'amostras'                        then 'identificacao,numero_item,cnpj'
    when 'ocorrencias'                     then 'identificacao,numero_item,cnpj,tipo'
  end
$$;

-- Linhas da tabela nas UASGs da equipe; filtros por igualdade (identificacao, numero_item, cnpj, tipo)
create or replace function public.painel_ler(p_codigo text, p_tabela text, p_filtros jsonb default '{}'::jsonb)
returns jsonb language plpgsql stable security definer set search_path = public, extensions as $$
declare
  v_equipe uuid := painel_equipe_do_codigo(p_codigo);
  v_where text := '';
  k text;
  r jsonb;
begin
  if v_equipe is null then raise exception 'código da equipe inválido'; end if;
  if painel_conflito(p_tabela) is null then raise exception 'tabela não permitida: %', p_tabela; end if;
  for k in select jsonb_object_keys(coalesce(p_filtros, '{}'::jsonb)) loop
    if k not in ('identificacao', 'numero_item', 'cnpj', 'tipo') then raise exception 'filtro não permitido: %', k; end if;
    v_where := v_where || format(' and t.%I::text = %L', k, p_filtros->>k);
  end loop;
  execute format(
    'select coalesce(jsonb_agg(to_jsonb(t) - ''uasg''), ''[]''::jsonb) from public.%I t
      where t.uasg in (select uasg from painel_equipe_uasgs where equipe_id = $1)%s',
    'painel_' || p_tabela, v_where) into r using v_equipe;
  return r;
end $$;

-- Upsert de uma linha ou de uma lista. Como o merge-duplicates do PostgREST: só as
-- colunas enviadas são atualizadas. UASG sem dono passa a ser da equipe que gravou.
create or replace function public.painel_gravar(p_codigo text, p_tabela text, p_dados jsonb)
returns void language plpgsql volatile security definer set search_path = public, extensions as $$
declare
  v_equipe uuid := painel_equipe_do_codigo(p_codigo);
  v_conf text := painel_conflito(p_tabela);
  v_tab text := 'painel_' || p_tabela;
  v_linha jsonb;
  v_uasg text;
  v_dono uuid;
  v_cols text[];
  v_lista text;
  v_set text;
begin
  if v_equipe is null then raise exception 'código da equipe inválido'; end if;
  if v_conf is null then raise exception 'tabela não permitida: %', p_tabela; end if;
  for v_linha in select x from jsonb_array_elements(case when jsonb_typeof(p_dados) = 'array' then p_dados else jsonb_build_array(p_dados) end) x loop
    v_uasg := painel_uasg(v_linha->>'identificacao');
    if v_uasg is null then raise exception 'processo sem UASG no número: %', v_linha->>'identificacao'; end if;
    insert into painel_equipe_uasgs (uasg, equipe_id) values (v_uasg, v_equipe) on conflict (uasg) do nothing;
    select equipe_id into v_dono from painel_equipe_uasgs where uasg = v_uasg;
    if v_dono <> v_equipe then raise exception 'a UASG % pertence a outra equipe', v_uasg; end if;

    v_cols := array(select k from jsonb_object_keys(v_linha) k
                    where k <> 'uasg' and exists (select 1 from information_schema.columns c
                      where c.table_schema = 'public' and c.table_name = v_tab and c.column_name = k));
    v_lista := (select string_agg(quote_ident(c), ',') from unnest(v_cols) c);
    v_set := (select string_agg(format('%1$I = excluded.%1$I', c), ',') from unnest(v_cols) c
              where c <> all(string_to_array(v_conf, ',')));
    execute format('insert into public.%I (%s) select %s from jsonb_populate_record(null::public.%I, $1) on conflict (%s) do %s',
      v_tab, v_lista, v_lista, v_tab, v_conf, coalesce('update set ' || v_set, 'nothing'))
      using v_linha;
  end loop;
end $$;

-- ── Para o DEV (página /uso-extensoes) ───────────────────────────────────────
create or replace function public.painel_equipes_resumo()
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not exists (select 1 from profiles where id = auth.uid() and setor = 'DEV') then raise exception 'acesso restrito ao DEV'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object(
      'id', e.id, 'nome', e.nome, 'criado_em', e.criado_em,
      'uasgs', coalesce((select jsonb_agg(u.uasg order by u.uasg) from painel_equipe_uasgs u where u.equipe_id = e.id), '[]'::jsonb),
      'anotacoes', (select count(*) from painel_habilitacao h where h.uasg in (select uasg from painel_equipe_uasgs where equipe_id = e.id))
                 + (select count(*) from painel_itens_etapa h where h.uasg in (select uasg from painel_equipe_uasgs where equipe_id = e.id))
                 + (select count(*) from painel_itens_obs h where h.uasg in (select uasg from painel_equipe_uasgs where equipe_id = e.id))
    ) order by e.nome) from painel_equipes e), '[]'::jsonb);
end $$;

-- Código perdido: o DEV gera um novo (o antigo deixa de valer)
create or replace function public.painel_novo_codigo(p_equipe uuid)
returns text language plpgsql volatile security definer set search_path = public, extensions as $$
declare v_codigo text := painel_gerar_codigo();
begin
  if not exists (select 1 from profiles where id = auth.uid() and setor = 'DEV') then raise exception 'acesso restrito ao DEV'; end if;
  update painel_equipes set codigo_hash = painel_hash_codigo(v_codigo) where id = p_equipe;
  if not found then raise exception 'equipe não encontrada'; end if;
  return v_codigo;
end $$;

-- ── Versão publicada das extensões (aviso "nova versão" — leitura pública) ──
create table if not exists public.extensao_versoes (
  extensao     text primary key,
  versao       text not null,
  changelog    text,
  url_download text,
  obrigatoria  boolean default false,
  updated_at   timestamptz default now()
);
alter table public.extensao_versoes enable row level security;
drop policy if exists "leitura publica" on public.extensao_versoes;
create policy "leitura publica" on public.extensao_versoes for select to anon, authenticated using (true);

-- ── Permissões das funções ───────────────────────────────────────────────────
revoke all on function public.painel_equipe_do_codigo(text) from public, anon, authenticated;
revoke all on function public.painel_gerar_codigo() from public, anon, authenticated;
revoke all on function public.painel_equipe(text) from public;
revoke all on function public.painel_criar_equipe(text, text[]) from public;
revoke all on function public.painel_ler(text, text, jsonb) from public;
revoke all on function public.painel_gravar(text, text, jsonb) from public;
revoke all on function public.painel_equipes_resumo() from public;
revoke all on function public.painel_novo_codigo(uuid) from public;
grant execute on function public.painel_equipe(text) to anon, authenticated;
grant execute on function public.painel_criar_equipe(text, text[]) to anon, authenticated;
grant execute on function public.painel_ler(text, text, jsonb) to anon, authenticated;
grant execute on function public.painel_gravar(text, text, jsonb) to anon, authenticated;
grant execute on function public.painel_equipes_resumo() to authenticated;
grant execute on function public.painel_novo_codigo(uuid) to authenticated;
revoke all on function public.painel_equipes_resumo() from anon;
revoke all on function public.painel_novo_codigo(uuid) from anon;
