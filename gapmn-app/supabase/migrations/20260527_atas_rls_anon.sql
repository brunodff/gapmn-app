-- RLS para atas_gap_mn e itens_ata_gap_mn
-- Qualquer pessoa pode executar o robô ARP e inserir ATAs novas.
-- Leitura liberada para todos (necessário para o bot verificar o que já existe).
-- UPDATE e DELETE apenas para usuários autenticados (não expostos ao bookmarklet).

-- ── atas_gap_mn ─────────────────────────────────────────────────────────────
ALTER TABLE atas_gap_mn ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "atas_select"        ON atas_gap_mn;
DROP POLICY IF EXISTS "atas_insert_anon"   ON atas_gap_mn;
DROP POLICY IF EXISTS "atas_update_auth"   ON atas_gap_mn;
DROP POLICY IF EXISTS "atas_delete_auth"   ON atas_gap_mn;

-- SELECT: qualquer pessoa (robô + app)
CREATE POLICY "atas_select"
  ON atas_gap_mn FOR SELECT USING (true);

-- INSERT: qualquer pessoa (robô com anon key)
CREATE POLICY "atas_insert_anon"
  ON atas_gap_mn FOR INSERT WITH CHECK (true);

-- UPDATE: apenas autenticados
CREATE POLICY "atas_update_auth"
  ON atas_gap_mn FOR UPDATE USING (auth.role() = 'authenticated');

-- DELETE: apenas autenticados
CREATE POLICY "atas_delete_auth"
  ON atas_gap_mn FOR DELETE USING (auth.role() = 'authenticated');

-- ── itens_ata_gap_mn ─────────────────────────────────────────────────────────
ALTER TABLE itens_ata_gap_mn ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "itens_ata_select"      ON itens_ata_gap_mn;
DROP POLICY IF EXISTS "itens_ata_insert_anon" ON itens_ata_gap_mn;
DROP POLICY IF EXISTS "itens_ata_update_auth" ON itens_ata_gap_mn;
DROP POLICY IF EXISTS "itens_ata_delete_auth" ON itens_ata_gap_mn;

CREATE POLICY "itens_ata_select"
  ON itens_ata_gap_mn FOR SELECT USING (true);

CREATE POLICY "itens_ata_insert_anon"
  ON itens_ata_gap_mn FOR INSERT WITH CHECK (true);

CREATE POLICY "itens_ata_update_auth"
  ON itens_ata_gap_mn FOR UPDATE USING (auth.role() = 'authenticated');

CREATE POLICY "itens_ata_delete_auth"
  ON itens_ata_gap_mn FOR DELETE USING (auth.role() = 'authenticated');

-- Garante constraint UNIQUE em numero_ata para o ON CONFLICT DO NOTHING funcionar
ALTER TABLE atas_gap_mn
  ADD CONSTRAINT IF NOT EXISTS atas_gap_mn_numero_ata_key UNIQUE (numero_ata);
