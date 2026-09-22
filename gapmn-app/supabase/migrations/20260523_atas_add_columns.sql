-- Adiciona colunas de contexto às ATAs de RP
ALTER TABLE atas_registro_preco
  ADD COLUMN IF NOT EXISTS unidade_nome   text,
  ADD COLUMN IF NOT EXISTS orgao_nome     text,
  ADD COLUMN IF NOT EXISTS cancelado      boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS permite_adesao boolean,
  ADD COLUMN IF NOT EXISTS is_issuer      boolean DEFAULT true;

COMMENT ON COLUMN atas_registro_preco.is_issuer IS
  'true = GAP-MN é a unidade compradora; false = outra unidade, GAP-MN é participante';
