-- Marca que o empenho foi realizado (NE gerada no SIAFI) mas ainda não apareceu no relatório do dia
ALTER TABLE siloms_solicitacoes
  ADD COLUMN IF NOT EXISTS empenho_realizado boolean DEFAULT false NOT NULL;
