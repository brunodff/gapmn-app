-- Permite que SLIC marque um processo como homologado manualmente
-- quando a API do PNCP ainda não atualizou o status

ALTER TABLE processos_licitatorios
  ADD COLUMN IF NOT EXISTS homologado_manual      boolean  DEFAULT false,
  ADD COLUMN IF NOT EXISTS valor_homologado_manual numeric  DEFAULT null;
