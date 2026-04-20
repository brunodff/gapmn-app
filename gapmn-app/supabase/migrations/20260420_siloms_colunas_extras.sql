-- Adiciona colunas usadas pelo bot (idempotente)
ALTER TABLE siloms_solicitacoes_empenho
  ADD COLUMN IF NOT EXISTS empenho_siafi  text,
  ADD COLUMN IF NOT EXISTS subprocesso    text,
  ADD COLUMN IF NOT EXISTS perfil_atual   text,
  ADD COLUMN IF NOT EXISTS oc_gerada      text,
  ADD COLUMN IF NOT EXISTS responsavel    text;

-- Índice para busca por NE SIAFI
CREATE INDEX IF NOT EXISTS idx_siloms_empenho_siafi
  ON siloms_solicitacoes_empenho (empenho_siafi);
