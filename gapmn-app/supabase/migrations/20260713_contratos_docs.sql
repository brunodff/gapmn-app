-- Tabela de documentos vinculados a contratos
-- Keyed by numero_contrato (não por id) para sobreviver a exclusão/reimportação
CREATE TABLE IF NOT EXISTS contratos_docs (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  numero_contrato  TEXT        NOT NULL,
  tipo             TEXT        NOT NULL CHECK (tipo IN ('contrato','tr','aditivo','apostilamento')),
  nome             TEXT        NOT NULL,
  url              TEXT,
  user_nome        TEXT,
  user_id          UUID        REFERENCES auth.users(id),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at       TIMESTAMPTZ,
  deleted_by_nome  TEXT,
  deleted_by_id    UUID        REFERENCES auth.users(id)
);

CREATE INDEX IF NOT EXISTS idx_contratos_docs_numero ON contratos_docs(numero_contrato);

ALTER TABLE contratos_docs ENABLE ROW LEVEL SECURITY;

-- Usuários autenticados podem ler/inserir/atualizar (soft-delete via update)
CREATE POLICY "contratos_docs_select" ON contratos_docs
  FOR SELECT USING (auth.uid() IS NOT NULL);

CREATE POLICY "contratos_docs_insert" ON contratos_docs
  FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "contratos_docs_update" ON contratos_docs
  FOR UPDATE USING (auth.uid() IS NOT NULL);
