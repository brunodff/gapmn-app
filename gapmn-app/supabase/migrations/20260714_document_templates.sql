-- Modelos de documento por usuário (aditivo, apostilamento, apostilamento_ata)
CREATE TABLE IF NOT EXISTS document_templates (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID        NOT NULL REFERENCES auth.users(id),
  tipo         TEXT        NOT NULL,
  html_content TEXT,
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_document_templates_user_tipo
  ON document_templates(user_id, tipo);

ALTER TABLE document_templates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "dt_select" ON document_templates
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "dt_insert" ON document_templates
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "dt_update" ON document_templates
  FOR UPDATE USING (auth.uid() = user_id);
