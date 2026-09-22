-- Adiciona coluna srp (Sistema de Registro de Preços) na tabela de processos
ALTER TABLE processos_licitatorios
  ADD COLUMN IF NOT EXISTS srp boolean;
