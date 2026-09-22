-- Permite que todos os usuários autenticados leiam contratos (antes era restrito ao SCON)
-- INSERT/UPDATE/DELETE continuam restritos ao setor SCON, ADMIN e DEV

ALTER TABLE contratos_scon ENABLE ROW LEVEL SECURITY;

-- Remove qualquer policy SELECT restritiva existente
DROP POLICY IF EXISTS "scon_select"           ON contratos_scon;
DROP POLICY IF EXISTS "contratos_select_scon" ON contratos_scon;
DROP POLICY IF EXISTS "select_scon_only"      ON contratos_scon;
DROP POLICY IF EXISTS "authenticated_select"  ON contratos_scon;
DROP POLICY IF EXISTS "contratos_leitura"     ON contratos_scon;

-- Qualquer usuário autenticado pode visualizar
CREATE POLICY "contratos_todos_podem_ver"
  ON contratos_scon FOR SELECT
  TO authenticated
  USING (true);

-- Apenas SCON / ADMIN / DEV podem inserir
CREATE POLICY "contratos_escrita_scon"
  ON contratos_scon FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE id = auth.uid()
        AND setor IN ('SCON', 'ADMIN', 'DEV')
    )
  );

-- Apenas SCON / ADMIN / DEV podem atualizar
CREATE POLICY "contratos_update_scon"
  ON contratos_scon FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE id = auth.uid()
        AND setor IN ('SCON', 'ADMIN', 'DEV')
    )
  );

-- Apenas SCON / ADMIN / DEV podem deletar
CREATE POLICY "contratos_delete_scon"
  ON contratos_scon FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE id = auth.uid()
        AND setor IN ('SCON', 'ADMIN', 'DEV')
    )
  );
