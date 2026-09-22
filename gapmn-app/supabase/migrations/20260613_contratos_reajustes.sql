-- Histórico de reajustes e prorrogações por contrato
CREATE TABLE IF NOT EXISTS contratos_reajustes (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contrato_id      uuid NOT NULL REFERENCES contratos_scon(id) ON DELETE CASCADE,
  tipo_doc         text NOT NULL,      -- 'Termo Aditivo' | 'Apostilamento'
  tipo_alteracao   text NOT NULL,      -- 'valor' | 'prazo' | 'ambos'
  objeto_doc       text,               -- objeto/ementa extraído do PDF
  percentual       numeric,            -- ex: 25.00 (para 25%)
  valor_anterior   numeric,
  valor_novo       numeric,
  data_fim_anterior date,
  data_fim_nova    date,
  meses_acrescidos int,
  texto_pdf        text,               -- texto integral extraído
  created_by       uuid REFERENCES profiles(id),
  user_nome        text,
  created_at       timestamptz DEFAULT now()
);

ALTER TABLE contratos_reajustes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "reaj_select" ON contratos_reajustes;
DROP POLICY IF EXISTS "reaj_insert" ON contratos_reajustes;
DROP POLICY IF EXISTS "reaj_delete" ON contratos_reajustes;
CREATE POLICY "reaj_select" ON contratos_reajustes FOR SELECT TO authenticated USING (true);
CREATE POLICY "reaj_insert" ON contratos_reajustes FOR INSERT TO authenticated WITH CHECK (
  EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND setor IN ('SCON','ADMIN','DEV'))
);
CREATE POLICY "reaj_delete" ON contratos_reajustes FOR DELETE TO authenticated USING (
  created_by = auth.uid()
  OR EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND setor IN ('SCON','ADMIN','DEV'))
);
