-- Overrides manuais para processos em elaboração (status, observação, ocultar)
CREATE TABLE IF NOT EXISTS elaboracao_overrides (
  n_contratacao  text        PRIMARY KEY,
  status_override text,
  observacao     text,
  oculto         boolean     NOT NULL DEFAULT false,
  updated_at     timestamptz DEFAULT now(),
  updated_by     uuid
);

ALTER TABLE elaboracao_overrides ENABLE ROW LEVEL SECURITY;

-- Todos os autenticados podem ler
CREATE POLICY "elab_overrides_select"
  ON elaboracao_overrides FOR SELECT
  TO authenticated
  USING (true);

-- Somente SLIC e ADMIN podem escrever
CREATE POLICY "elab_overrides_write"
  ON elaboracao_overrides FOR ALL
  TO authenticated
  USING (
    (SELECT setor FROM profiles WHERE id = auth.uid()) IN ('SLIC', 'ADMIN')
  )
  WITH CHECK (
    (SELECT setor FROM profiles WHERE id = auth.uid()) IN ('SLIC', 'ADMIN')
  );
