-- Ajustes manuais da previsão orçamentária por contrato.
-- Chave = número do contrato (não o id): "Limpar Importados" apaga e recria os
-- contratos importados do Excel, e os ajustes precisam sobreviver a isso.
CREATE TABLE IF NOT EXISTS contratos_previsao (
  numero_contrato text PRIMARY KEY,
  regime          text CHECK (regime IN ('fixo', 'estimativo', 'saldo', 'nao_prever')),  -- NULL = automático
  valor_mensal    numeric CHECK (valor_mensal IS NULL OR valor_mensal >= 0),            -- NULL = calculado
  observacao      text,
  updated_by      uuid REFERENCES profiles(id),
  updated_nome    text,
  updated_at      timestamptz DEFAULT now()
);

ALTER TABLE contratos_previsao ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "prev_select" ON contratos_previsao;
DROP POLICY IF EXISTS "prev_insert" ON contratos_previsao;
DROP POLICY IF EXISTS "prev_update" ON contratos_previsao;
DROP POLICY IF EXISTS "prev_delete" ON contratos_previsao;

CREATE POLICY "prev_select" ON contratos_previsao FOR SELECT TO authenticated USING (true);
CREATE POLICY "prev_insert" ON contratos_previsao FOR INSERT TO authenticated WITH CHECK (
  EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND setor IN ('SCON', 'ADMIN', 'DEV'))
);
CREATE POLICY "prev_update" ON contratos_previsao FOR UPDATE TO authenticated USING (
  EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND setor IN ('SCON', 'ADMIN', 'DEV'))
);
CREATE POLICY "prev_delete" ON contratos_previsao FOR DELETE TO authenticated USING (
  EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND setor IN ('SCON', 'ADMIN', 'DEV'))
);
