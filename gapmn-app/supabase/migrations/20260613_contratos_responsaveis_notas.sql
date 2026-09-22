-- Responsáveis pelo contrato (podem editar posição de cards e adicionar notas)
CREATE TABLE IF NOT EXISTS contratos_responsaveis (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contrato_id uuid NOT NULL REFERENCES contratos_scon(id) ON DELETE CASCADE,
  user_id     uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  added_by    uuid REFERENCES profiles(id),
  created_at  timestamptz DEFAULT now(),
  UNIQUE (contrato_id, user_id)
);
ALTER TABLE contratos_responsaveis ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "cresp_select" ON contratos_responsaveis;
DROP POLICY IF EXISTS "cresp_insert" ON contratos_responsaveis;
DROP POLICY IF EXISTS "cresp_delete" ON contratos_responsaveis;
CREATE POLICY "cresp_select" ON contratos_responsaveis FOR SELECT TO authenticated USING (true);
CREATE POLICY "cresp_insert" ON contratos_responsaveis FOR INSERT TO authenticated WITH CHECK (
  EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND setor IN ('SCON','ADMIN','DEV'))
);
CREATE POLICY "cresp_delete" ON contratos_responsaveis FOR DELETE TO authenticated USING (
  EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND setor IN ('SCON','ADMIN','DEV'))
);

-- Notas por campo do contrato
CREATE TABLE IF NOT EXISTS contratos_notas (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contrato_id uuid NOT NULL REFERENCES contratos_scon(id) ON DELETE CASCADE,
  campo       text NOT NULL,
  texto       text NOT NULL,
  user_id     uuid NOT NULL REFERENCES profiles(id),
  user_nome   text,
  created_at  timestamptz DEFAULT now()
);
ALTER TABLE contratos_notas ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "cnota_select" ON contratos_notas;
DROP POLICY IF EXISTS "cnota_insert" ON contratos_notas;
DROP POLICY IF EXISTS "cnota_delete" ON contratos_notas;
CREATE POLICY "cnota_select" ON contratos_notas FOR SELECT TO authenticated USING (true);
CREATE POLICY "cnota_insert" ON contratos_notas FOR INSERT TO authenticated WITH CHECK (
  -- ADMIN/SCON/DEV podem sempre inserir
  EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND setor IN ('SCON','ADMIN','DEV'))
  OR
  -- responsáveis pelo contrato também podem inserir
  EXISTS (SELECT 1 FROM contratos_responsaveis WHERE contrato_id = contratos_notas.contrato_id AND user_id = auth.uid())
);
CREATE POLICY "cnota_delete" ON contratos_notas FOR DELETE TO authenticated USING (
  user_id = auth.uid()
  OR EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND setor IN ('SCON','ADMIN','DEV'))
);
