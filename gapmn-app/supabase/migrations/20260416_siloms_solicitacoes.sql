-- Tabela: solicitações de empenho recebidas (exportadas do SILOMS)
create table if not exists siloms_solicitacoes_empenho (
  solicitacao      text primary key,          -- ex: 26S0001
  ug_exec          text,
  ug_cred          text,
  ug_local         text,
  indicador_lotacao text,                     -- I/Lotação
  nd               text,                      -- Natureza de Despesa
  sb               text,                      -- Subelemento
  status           text,                      -- Cancelada, Encerrada, etc.
  codemp           text,
  fornecedor       text,
  pag              text,                      -- Processo Aquisição
  licit_siasg      text,
  validade_rp      text,
  dt_solicitacao   text,
  valor            numeric(15,4),
  historico        text,
  ano              integer,
  importado_em     timestamptz default now(),
  updated_at       timestamptz default now()
);

-- RLS
alter table siloms_solicitacoes_empenho enable row level security;

-- Leitura: apenas usuários autenticados (web app)
create policy "Leitura autenticados" on siloms_solicitacoes_empenho
  for select using (auth.role() = 'authenticated');

-- Escrita: qualquer role (anon ou authenticated) — o bot usa chave anon sem sessão de usuário
create policy "Escrita livre" on siloms_solicitacoes_empenho
  for all using (true) with check (true);
