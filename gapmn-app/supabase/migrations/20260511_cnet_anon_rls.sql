-- Permissão de leitura/escrita para role anon (bookmarklet usa anon key)
DROP POLICY IF EXISTS "leitura_anon" ON cnet_grupos;
DROP POLICY IF EXISTS "escrita_anon" ON cnet_grupos;
DROP POLICY IF EXISTS "update_anon"  ON cnet_grupos;

DROP POLICY IF EXISTS "leitura_anon" ON cnet_propostas;
DROP POLICY IF EXISTS "escrita_anon" ON cnet_propostas;
DROP POLICY IF EXISTS "update_anon"  ON cnet_propostas;

CREATE POLICY "leitura_anon"  ON cnet_grupos    FOR SELECT TO anon USING (true);
CREATE POLICY "escrita_anon"  ON cnet_grupos    FOR INSERT TO anon WITH CHECK (true);
CREATE POLICY "update_anon"   ON cnet_grupos    FOR UPDATE TO anon USING (true);

CREATE POLICY "leitura_anon"  ON cnet_propostas FOR SELECT TO anon USING (true);
CREATE POLICY "escrita_anon"  ON cnet_propostas FOR INSERT TO anon WITH CHECK (true);
CREATE POLICY "update_anon"   ON cnet_propostas FOR UPDATE TO anon USING (true);
