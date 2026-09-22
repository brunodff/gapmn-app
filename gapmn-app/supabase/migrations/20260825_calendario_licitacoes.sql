-- Tabela: calendario_licitacoes
-- Substitui a planilha "CALENDÁRIO 2026" do Google Sheets
-- Permite controle de processos licitatórios por ano, com histórico e notificação por e-mail

create table if not exists public.calendario_licitacoes (
  id                         uuid primary key default gen_random_uuid(),
  ano                        integer not null default extract(year from now())::integer,
  num_ordem                  integer,
  num_contratacao            text,
  num_dfd                    text,
  data_limite_remessa        date,
  chegada_doc                date,
  modalidade                 text,
  descricao_objeto           text,
  apoiada                    text,
  previsao_finalizacao       date,
  num_pag                    text,
  situacao_detalhada         text,
  status                     text,
  cod                        text,
  responsavel                text,
  responsavel_email          text,
  valor_estimado             numeric(15,2),
  responsavel_apoiada        text,
  pam_s                      text,
  envio_pam_aci              date,
  data_abertura_pag          date,
  num_irp                    text,
  edital_autorizacao_anexos  text,
  parecer_referencial        text,
  envio_cju                  date,
  recebimento_analise_cju    date,
  envio_parecer_apoiada      date,
  recebimento_correcoes_cju  date,
  aprovacao_aci              date,
  envio_edital_assinatura    date,
  publicacao_comprasnet      date,
  publicacao_dou_pncp        date,
  publicacao_ebc             date,
  publicacao_portal_fab      date,
  autuacao_subprocesso_pub   text,
  pregoeiro_cpl              text,
  num_siasg                  text,
  abertura_sessao_publica    date,
  data_homologacao           date,
  tempo_licitacao            text,
  homologado                 boolean default false,
  cancelada                  boolean default false,
  subprocesso_fase_externa   text,
  anotacao_interna           text,
  observacao                 text,
  historico                  text,
  created_by                 uuid references auth.users(id),
  created_at                 timestamptz default now(),
  updated_at                 timestamptz default now()
);

alter table public.calendario_licitacoes enable row level security;

-- Todos autenticados podem ler
create policy "autenticados leem calendario_licitacoes"
  on public.calendario_licitacoes for select
  to authenticated using (true);

-- SLIC, ADMIN, DEV podem inserir
create policy "slic insere calendario_licitacoes"
  on public.calendario_licitacoes for insert
  to authenticated
  with check (
    exists (
      select 1 from public.profiles
      where id = auth.uid()
      and upper(setor) in ('SLIC', 'ADMIN', 'DEV')
    )
  );

-- SLIC, ADMIN, DEV podem atualizar
create policy "slic atualiza calendario_licitacoes"
  on public.calendario_licitacoes for update
  to authenticated
  using (
    exists (
      select 1 from public.profiles
      where id = auth.uid()
      and upper(setor) in ('SLIC', 'ADMIN', 'DEV')
    )
  );

-- Apenas ADMIN e DEV podem deletar
create policy "admin deleta calendario_licitacoes"
  on public.calendario_licitacoes for delete
  to authenticated
  using (
    exists (
      select 1 from public.profiles
      where id = auth.uid()
      and upper(setor) in ('ADMIN', 'DEV')
    )
  );

-- Trigger para manter updated_at atualizado
create or replace function public.set_calendario_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger calendario_licitacoes_updated_at
  before update on public.calendario_licitacoes
  for each row execute procedure public.set_calendario_updated_at();
