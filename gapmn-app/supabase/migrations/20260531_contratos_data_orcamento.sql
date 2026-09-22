-- Adiciona data base do orçamento ao contrato (usada para calcular próximo reajuste)
ALTER TABLE contratos_scon
  ADD COLUMN IF NOT EXISTS data_orcamento date;
