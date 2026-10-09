-- Processos licitatórios do GAP-MN (UASG 120630)
--
-- Base automática: a função sync-processos lê o PNCP (situação, itens e vencedores na
-- hora) e a API de Dados Abertos do Compras.gov.br (descoberta dos processos e os
-- antigos, 2019–2023) duas vezes por dia, sem depender de ninguém logado.
-- Ao vivo: a extensão "GAP-MN — Processos ao Vivo" (pessoal da SLIC) manda o que só
-- existe com login no Compras.gov.br — fase da sessão, ação pendente, participantes e
-- propostas — para as tabelas cnet_*. As duas fontes se juntam por id_compra
-- (UASG + modalidade + número + ano, ex.: 12063005900352026).

-- ── 1. processos_licitatorios: campos da API pública ───────────────────────────
alter table public.processos_licitatorios
  add column if not exists id_compra             text,
  add column if not exists numero_controle_pncp  text,
  add column if not exists processo_nup          text,
  add column if not exists situacao              text,   -- situação calculada (itens + compra)
  add column if not exists amparo_legal          text,
  add column if not exists modo_disputa          text,
  add column if not exists link_pncp             text,
  add column if not exists qtd_itens             int,
  add column if not exists qtd_itens_homologados int,
  add column if not exists qtd_itens_andamento   int,
  add column if not exists qtd_itens_sem_sucesso int,    -- desertos, fracassados, cancelados
  add column if not exists data_atualizacao_pncp timestamptz,
  add column if not exists itens_sync_em         timestamptz;

create unique index if not exists processos_licitatorios_id_compra_uk
  on public.processos_licitatorios (id_compra);

-- ── 2. Itens e vencedores (API pública) ────────────────────────────────────────
create table if not exists public.processos_itens (
  id_compra                 text not null,
  numero_item               int  not null,
  numero_grupo              int,
  fonte                     text not null default 'PNCP',   -- PNCP | DADOS | LEGADO
  descricao                 text,
  material_servico          text,
  unidade                   text,
  quantidade                numeric,
  valor_unitario_estimado   numeric,
  valor_total_estimado      numeric,
  situacao                  text,
  criterio_julgamento       text,
  beneficio                 text,
  tem_resultado             boolean default false,
  fornecedor_ni             text,
  fornecedor_nome           text,
  fornecedor_porte          text,
  quantidade_homologada     numeric,
  valor_unitario_homologado numeric,
  valor_total_homologado    numeric,
  data_resultado            date,
  item_atualizado_pncp      timestamptz,
  atualizado_em             timestamptz not null default now(),
  primary key (id_compra, numero_item)
);
create index if not exists processos_itens_fornecedor_idx on public.processos_itens (fornecedor_ni);

alter table public.processos_itens enable row level security;
drop policy if exists "processos_itens_ler" on public.processos_itens;
create policy "processos_itens_ler" on public.processos_itens
  for select to authenticated using (true);
-- Gravação: só a função (service_role ignora RLS)

-- ── 3. Registro das sincronizações ─────────────────────────────────────────────
create table if not exists public.processos_sync_log (
  id        bigserial primary key,
  fonte     text not null,              -- 'publica' | 'cnet'
  origem    text,                       -- 'cron' | 'manual' | 'extensao'
  inicio    timestamptz not null default now(),
  fim       timestamptz,
  ok        boolean,
  resumo    jsonb,
  erro      text,
  usuario   uuid
);
create index if not exists processos_sync_log_inicio_idx on public.processos_sync_log (fonte, inicio desc);

alter table public.processos_sync_log enable row level security;
drop policy if exists "processos_sync_log_ler" on public.processos_sync_log;
create policy "processos_sync_log_ler" on public.processos_sync_log
  for select to authenticated using (true);

-- Quem pode mandar dados do ComprasNet (extensão) e pedir sincronização pelo app
create or replace function public.pode_sincronizar_processos()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from profiles
    where id = auth.uid()
      and (upper(coalesce(setor, '')) in ('SLIC', 'ADMIN', 'DEV') or role = 'admin')
  );
$$;

drop policy if exists "processos_sync_log_extensao" on public.processos_sync_log;
create policy "processos_sync_log_extensao" on public.processos_sync_log
  for insert to authenticated
  with check (fonte = 'cnet' and usuario = auth.uid() and public.pode_sincronizar_processos());

-- ── 4. ComprasNet ao vivo (cnet_*): id_compra e escrita só da SLIC ─────────────
-- "Pregão Eletrônico 120630 - 90020/2026" → 12063005900202026
create or replace function public.id_compra_cnet(ident text)
returns text language sql immutable as $$
  select case
    when m is null then null
    else m[2]
      || case
           when ident ilike 'preg%'                            then '05'
           when ident ilike 'dispensa%' or ident ilike 'cota%' then '06'
           when ident ilike 'concorr%'                         then '03'
           when ident ilike 'inexig%'                          then '07'
         end
      || lpad(m[3], 5, '0') || m[4]
  end
  from (select regexp_match(coalesce(ident, ''), '^(.*?)\s*(\d{6})\s*-\s*(\d+)/(\d{4})\s*$') as m) x;
$$;

alter table public.cnet_processos
  add column if not exists id_compra text generated always as (public.id_compra_cnet(identificacao)) stored;
create index if not exists cnet_processos_id_compra_idx on public.cnet_processos (id_compra);
create unique index if not exists cnet_processos_identificacao_uk on public.cnet_processos (identificacao);

-- Antes qualquer um com a chave pública (anon) podia gravar e apagar estas tabelas.
do $$
declare t text; p record;
begin
  foreach t in array array['cnet_processos', 'cnet_itens', 'cnet_participantes'] loop
    for p in select policyname from pg_policies where schemaname = 'public' and tablename = t loop
      execute format('drop policy %I on public.%I', p.policyname, t);
    end loop;
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy %I on public.%I for select to authenticated using (true)', t || '_ler', t);
    execute format('create policy %I on public.%I for insert to authenticated with check (public.pode_sincronizar_processos())', t || '_incluir', t);
    execute format('create policy %I on public.%I for update to authenticated using (public.pode_sincronizar_processos()) with check (public.pode_sincronizar_processos())', t || '_alterar', t);
  end loop;
end $$;

-- ── 5. Avisos: situação calculada; processo antigo trazido agora não é "novo" ──
create or replace function public.fn_notify_processo_change()
returns trigger language plpgsql security definer as $function$
declare
  msgs      text[] := array[]::text[];
  msg_final text;
begin
  -- Situação calculada (a primeira vez que é preenchida não é mudança)
  if old.situacao is not null and old.situacao is distinct from new.situacao then
    msgs := array_append(msgs,
      '🔄 Situação alterada de "' || old.situacao || '" para "' || coalesce(new.situacao, '(removida)') || '"');
  end if;

  if old.valor_homologado is distinct from new.valor_homologado then
    msgs := array_append(msgs,
      '✅ Valor Homologado: ' || coalesce(to_char(old.valor_homologado, 'FM"R$"999G999G990D00'), '(sem valor)') ||
      ' → ' || coalesce(to_char(new.valor_homologado, 'FM"R$"999G999G990D00'), '(removido)'));
  end if;

  if old.homologado_manual is distinct from new.homologado_manual then
    msgs := array_append(msgs,
      case when new.homologado_manual then '✅ Marcado como homologado manualmente'
           else '↩️ Homologação manual removida' end);
  end if;

  if array_length(msgs, 1) is null then return new; end if;

  msg_final := '⚖️ Processo ' || coalesce(new.modalidade || ' ', '') || coalesce(new.numero_processo, '') || e'\n' ||
               array_to_string(msgs, e'\n');

  insert into feed_items (titulo, tipo, link_tab)
  values (msg_final, 'processos', 'processos');

  insert into user_notifications (user_id, tipo, ref_id, ref_label, mensagem)
  select ua.user_id, 'processo', ua.ref_id, ua.ref_label, msg_final
  from user_acompanhamentos ua
  where ua.tipo = 'processo' and ua.ref_id = new.id::text;

  return new;
end;
$function$;

create or replace function public.fn_notify_processo_insert_dedup()
returns trigger language plpgsql security definer as $function$
declare
  existing_id uuid;
  new_detail  text;
begin
  -- Processo antigo trazido pela sincronização (carga inicial): não é novidade
  if new.data_publicacao is not null and new.data_publicacao < current_date - 60 then
    return new;
  end if;

  new_detail := coalesce(new.modalidade, '') || ' ' || coalesce(new.numero_processo, '') ||
                coalesce(' — ' || left(new.objeto, 90), '');

  select id into existing_id
  from feed_items
  where tipo = 'processos' and created_at > now() - interval '2 minutes'
  order by created_at desc
  limit 1;

  if existing_id is not null then
    update feed_items set titulo = titulo || e'\n• ' || new_detail where id = existing_id;
  else
    insert into feed_items (titulo, tipo, link_tab)
    values ('⚖️ Novos processos publicados:' || e'\n• ' || new_detail, 'processos', 'processos');
  end if;
  return new;
end;
$function$;

-- ── 6. Agendamento: 07:00 e 13:00 de Manaus (11:00 e 17:00 UTC), dias úteis — antes
-- do relatório diário de WhatsApp (08:00). A chave fica no Vault (vault.create_secret,
-- fora do repositório) e é a mesma do secret SYNC_PROCESSOS_KEY da função.
do $$
begin
  if exists (select 1 from cron.job where jobname = 'sync-processos-publico') then
    perform cron.unschedule('sync-processos-publico');
  end if;
end $$;

select cron.schedule(
  'sync-processos-publico',
  '0 11,17 * * 1-5',
  $cron$
    select net.http_post(
      url     := 'https://fychrtyyqbzlfbzbvzqp.supabase.co/functions/v1/sync-processos',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-sync-key', (select decrypted_secret from vault.decrypted_secrets where name = 'sync_processos_key')
      ),
      body    := '{"origem":"cron"}'::jsonb,
      timeout_milliseconds := 150000
    );
  $cron$
);
