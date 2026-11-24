-- Acompanhamento do PCA (pedido da SLIC, Ten Gabriela, nov/2026). Rodar inteiro no SQL Editor.
-- Toda alteração nas contratações passa pela função pca-automacao (chave de serviço), que grava o histórico:
-- o app só lê pca_contratacoes e pca_historico. Os cadastros (Elos, equipe, regras de MJR, configuração) a
-- SLIC, ADMIN e DEV editam direto. O histórico é imutável: nem a chave de serviço altera ou apaga.

-- quem edita: SLIC, ADMIN e DEV
create or replace function public.pca_pode_editar() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and upper(coalesce(setor, '')) in ('SLIC', 'ADMIN', 'DEV'));
$$;

-- ── Contratações do PCA (uma por contratação do PGC) ────────────────────────
create table if not exists public.pca_contratacoes (
  id                        uuid primary key default gen_random_uuid(),
  ano                       integer not null,
  chave_pgc                 text unique,                       -- título do projeto + início (Dados Abertos)
  id_contratacao_pgc        text unique,                       -- "120630-110/2027" (PNCP / TR item 2.2)
  numeros_dfd               text[] not null default '{}',
  itens_pca                 integer[] not null default '{}',
  numero_pag                text unique check (numero_pag is null or numero_pag ~ '^\d{5}\.\d{6}/\d{4}-\d{2}$'),
  numero_certame            text,
  id_compra                 text,
  objeto                    text not null default '',
  objeto_resumido           text,
  categoria                 text check (categoria is null or categoria in ('Aquisição','Serviço Comum','Serviço de Engenharia','Obra','TIC','Locação')),
  categoria_origem          text,
  sistema_srp               boolean,
  modalidade                text,
  modalidade_origem         text check (modalidade_origem is null or modalidade_origem in ('sugerida','manual','publicada')),
  modalidade_motivo         text,
  valor_estimado            numeric(16,2),
  valor_origem              text,
  om_apoiada                text,
  area_pgc                  text,
  data_estimada_chegada     date,
  data_estimada_conclusao   date,
  numero_dnr                text,
  data_chegada_dnr          date,
  responsavel_apoiada       text,
  responsavel_gapmn         text,
  pregoeiro_responsavel     text,
  documentacao_inicial_ok   boolean not null default false,
  subprocesso_fase_interna  jsonb,
  subprocesso_pos_cju       jsonb,
  enquadramento_juridico    text not null default 'Pendente de Triagem'
                            check (enquadramento_juridico in ('Pendente de Triagem','Parecer Referencial AGU','Análise CJU - Art. 53')),
  mjr_id                    bigint,
  enquadramento_motivo      text,
  data_envio_cju            date,
  data_retorno_cju          date,
  liberado_publicacao_em    date,
  pncp_publicado_em         date,
  link_pncp                 text,
  status_publicacao_dou     boolean not null default false,
  dou_data                  date,
  dou_link                  text,
  status_publicacao_ebc     boolean not null default false,
  ebc_data                  date,
  ebc_link                  text,
  subprocesso_fase_externa  text,
  data_homologacao          date,
  encaminhado_em            date,
  status_atual              text not null default 'Planejado no PCA',
  status_origem             text not null default 'automatico' check (status_origem in ('automatico','manual')),
  status_desde              timestamptz not null default now(),
  alertas_ativos            jsonb not null default '[]',
  pgc_ausente_desde         date,
  email_d30_em              timestamptz,
  observacao                text,
  criado_em                 timestamptz not null default now(),
  atualizado_em             timestamptz not null default now()
);
create index if not exists pca_contratacoes_ano on public.pca_contratacoes (ano, data_estimada_chegada);
alter table public.pca_contratacoes enable row level security;
drop policy if exists "pca le contratacoes" on public.pca_contratacoes;
create policy "pca le contratacoes" on public.pca_contratacoes for select to authenticated using (true);

-- ── Histórico imutável (auditoria) ──────────────────────────────────────────
create table if not exists public.pca_historico (
  id              bigserial primary key,
  contratacao_id  uuid not null references public.pca_contratacoes(id) on delete restrict,
  em              timestamptz not null default now(),
  origem          text not null,          -- manual | pgc | pncp | dou | email | siloms | sistema
  campo           text not null,
  de              jsonb,
  para            jsonb,
  justificativa   text,
  usuario_id      uuid,
  usuario_nome    text
);
create index if not exists pca_historico_contratacao on public.pca_historico (contratacao_id, em desc);
alter table public.pca_historico enable row level security;
drop policy if exists "pca le historico" on public.pca_historico;
create policy "pca le historico" on public.pca_historico for select to authenticated using (true);
create or replace function public.pca_historico_imutavel() returns trigger language plpgsql as $$
begin
  raise exception 'O histórico do Acompanhamento do PCA é imutável (% não permitido).', tg_op;
end $$;
drop trigger if exists pca_historico_imutavel on public.pca_historico;
create trigger pca_historico_imutavel before update or delete on public.pca_historico
  for each row execute function public.pca_historico_imutavel();

-- ── Cadastros (Painel Administrativo) ───────────────────────────────────────
create table if not exists public.pca_elos (
  id          bigserial primary key,
  om          text not null unique,          -- sigla da OM apoiada ou do setor do GAP-MN
  nome_om     text,
  elo_nome    text,
  elo_email   text,
  areas_pgc   text[] not null default '{}',  -- códigos de área do DFD no PGC que são desta OM/setor
  interno     boolean not null default false,
  ativo       boolean not null default true
);
create table if not exists public.pca_equipe (
  id      bigserial primary key,
  nome    text not null unique,
  email   text,
  funcao  text not null default 'AUX SLIC',   -- AUX SLIC | Pregoeiro | Agente de Contratação | AUX SLIC (Atas) | Chefe da SLIC
  ativo   boolean not null default true
);
create table if not exists public.pca_mjr (
  id            bigserial primary key,
  titulo        text not null,
  agu_id        integer,                      -- agu_referenciais.id
  categorias    text[] not null default '{}',
  modalidades   text[] not null default '{}',
  valor_maximo  numeric(16,2),
  palavras      text[] not null default '{}',
  srp           boolean,
  vigencia_fim  date,
  ativo         boolean not null default true
);
create table if not exists public.pca_config (
  id                          integer primary key default 1 check (id = 1),
  ano                         integer not null default 2027,
  envio_automatico            boolean not null default false,
  email_slic                  text,
  email_atas                  text not null default 'atas.guarnaemn@gmail.com',
  email_scon                  text not null default 'dctr.gapmn@gmail.com',
  link_listas                 text not null default 'https://www.gapmn.intraer/index.php/setores/divisao-de-obtencao-e-contratos#listas-de-verificacao',
  sla_cju_dias                integer not null default 15,
  dias_alerta_chegada         integer not null default 30,
  limite_dispensa_engenharia  numeric(16,2) not null default 130984.20,   -- art. 75, I (Decreto nº 12.807/2025, 2026)
  limite_dispensa_demais      numeric(16,2) not null default 65492.11,    -- art. 75, II
  atualizado_em               timestamptz not null default now()
);
insert into public.pca_config (id) values (1) on conflict (id) do nothing;

do $$
declare t text;
begin
  foreach t in array array['pca_elos','pca_equipe','pca_mjr','pca_config'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists "pca le %s" on public.%I', t, t);
    execute format('create policy "pca le %s" on public.%I for select to authenticated using (true)', t, t);
    execute format('drop policy if exists "pca edita %s" on public.%I', t, t);
    execute format('create policy "pca edita %s" on public.%I for all to authenticated using (public.pca_pode_editar()) with check (public.pca_pode_editar())', t, t);
  end loop;
end $$;

-- ── DNRs recebidas, fila de irregularidades, eventos (e-mail/SILOMS) e e-mails ─
create table if not exists public.pca_dnr (
  id                  uuid primary key default gen_random_uuid(),
  criado_em           timestamptz not null default now(),
  criado_por          text,
  fonte               text not null,          -- upload | planilha | siloms | manual
  numero_dnr          text,
  data_chegada        date,
  pag_oficio          text,
  pag_tr              text,
  numero_contratacao  text,
  itens_pca           integer[] not null default '{}',
  objeto              text,
  assinante_tr        text,
  om_apoiada          text,
  arquivos            text[] not null default '{}',
  contratacao_id      uuid references public.pca_contratacoes(id),
  situacao            text not null default 'pendente'   -- vinculada | irregular | descartada
);
create table if not exists public.pca_irregularidades (
  id              uuid primary key default gen_random_uuid(),
  criado_em       timestamptz not null default now(),
  contratacao_id  uuid references public.pca_contratacoes(id),
  dnr_id          uuid references public.pca_dnr(id),
  tipo            text not null,
  descricao       text not null,
  detalhe         jsonb,
  resolvido_em    timestamptz,
  resolvido_por   text,
  decisao         text
);
create index if not exists pca_irregularidades_abertas on public.pca_irregularidades (resolvido_em) where resolvido_em is null;
create table if not exists public.pca_eventos (
  id              uuid primary key default gen_random_uuid(),
  recebido_em     timestamptz not null default now(),
  origem          text not null,              -- gmail | siloms
  tipo            text not null,
  chave           text unique,                -- id da mensagem do Gmail / do robô: não processa duas vezes
  pag             text,
  assunto         text,
  remetente       text,
  data            timestamptz,
  dados           jsonb,
  contratacao_id  uuid references public.pca_contratacoes(id),
  ciente_em       timestamptz,                -- impugnação/esclarecimento: a SLIC deu ciência (o alerta some)
  ciente_por      text
);
create table if not exists public.pca_emails (
  id              uuid primary key default gen_random_uuid(),
  criado_em       timestamptz not null default now(),
  contratacao_id  uuid references public.pca_contratacoes(id),
  tipo            text not null,
  para            text[] not null,
  assunto         text not null,
  html            text not null,
  texto           text,
  chave           text not null unique,       -- não manda o mesmo aviso duas vezes
  situacao        text not null default 'pendente',   -- pendente | enviado | erro | descartado
  enviado_em      timestamptz,
  erro            text,
  enviado_por     text
);
do $$
declare t text;
begin
  foreach t in array array['pca_dnr','pca_irregularidades','pca_eventos','pca_emails'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists "pca le %s" on public.%I', t, t);
    execute format('create policy "pca le %s" on public.%I for select to authenticated using (public.pca_pode_editar())', t, t);
  end loop;
end $$;

-- ── Rotina diária: PGC, publicação, DOU, D-30, prazo da CJU e e-mails ────────
-- 07:50 e 13:50 de Manaus (depois da sync-processos e da sync-dou), todos os dias. Mesma chave da sync-processos.
do $$
begin
  if exists (select 1 from cron.job where jobname = 'pca-automacao') then perform cron.unschedule('pca-automacao'); end if;
end $$;
select cron.schedule('pca-automacao', '50 11,17 * * *', $cron$
  select net.http_post(
    url     := 'https://fychrtyyqbzlfbzbvzqp.supabase.co/functions/v1/pca-automacao',
    headers := jsonb_build_object('Content-Type', 'application/json',
                 'x-sync-key', (select decrypted_secret from vault.decrypted_secrets where name = 'sync_processos_key')),
    body    := '{"acao":"sincronizar","origem":"cron"}'::jsonb,
    timeout_milliseconds := 150000
  );
$cron$);

-- conferência: 10 tabelas, configuração criada e a rotina agendada
select (select count(*) from information_schema.tables where table_schema = 'public' and table_name like 'pca\_%') as tabelas,
       (select envio_automatico from public.pca_config where id = 1) as envio_automatico,
       (select count(*) from cron.job where jobname = 'pca-automacao') as rotina;
