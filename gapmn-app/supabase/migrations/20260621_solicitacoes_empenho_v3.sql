-- v3: campo para marcar solicitação como revisada/verificada pelo SEO
-- Quando revisado_em IS NOT NULL, o item some da view padrão da página
ALTER TABLE solicitacoes_empenho
  ADD COLUMN IF NOT EXISTS revisado_em timestamptz;
