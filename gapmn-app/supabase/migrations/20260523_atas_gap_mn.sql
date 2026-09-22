-- Tabela de ATAs do GAP-MN sincronizadas de contratos.sistema.gov.br/arp
-- Fonte: bookmarklet arp-bot.js rodando na página do Contratos.gov.br

CREATE TABLE IF NOT EXISTS atas_gap_mn (
  id               bigserial PRIMARY KEY,
  numero_ata       text UNIQUE NOT NULL,     -- "00164/2026"
  situacao         text,                      -- "Ativa" | "Cancelada" | "Encerrada"
  tipo_uasg        text,                      -- "Gerenciadora" | "Participante"
  vigencia_inicial date,
  vigencia_final   date,
  pdf_url          text,                      -- URL do PDF em contratos.sistema.gov.br
  registrado_em    timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_atas_mn_situacao  ON atas_gap_mn(situacao);
CREATE INDEX IF NOT EXISTS idx_atas_mn_vigencia  ON atas_gap_mn(vigencia_final);

ALTER TABLE atas_gap_mn ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "mn_select"  ON atas_gap_mn;
DROP POLICY IF EXISTS "mn_insert"  ON atas_gap_mn;
DROP POLICY IF EXISTS "mn_update"  ON atas_gap_mn;
DROP POLICY IF EXISTS "mn_delete"  ON atas_gap_mn;

-- SELECT: apenas usuários autenticados (app)
CREATE POLICY "mn_select" ON atas_gap_mn
  FOR SELECT USING (auth.role() = 'authenticated');

-- INSERT: anon permitido (bookmarklet roda fora do app, sem sessão)
CREATE POLICY "mn_insert" ON atas_gap_mn
  FOR INSERT WITH CHECK (true);

-- UPDATE: autenticados
CREATE POLICY "mn_update" ON atas_gap_mn
  FOR UPDATE USING (auth.role() = 'authenticated');

-- DELETE: apenas ADMIN / DEV
CREATE POLICY "mn_delete" ON atas_gap_mn
  FOR DELETE USING (
    (SELECT setor FROM profiles WHERE id = auth.uid()) IN ('ADMIN', 'DEV')
  );
