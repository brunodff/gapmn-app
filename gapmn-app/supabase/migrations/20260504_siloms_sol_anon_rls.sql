-- Permite que o bookmarklet "SE Leitor" (anon key, sem sessão) leia e insira SEs
-- O bookmarklet roda no SILOMS (intranet) — não tem acesso ao domínio do GAP-MN,
-- portanto não tem sessão authenticated. Anon key é a única opção.
-- Políticas de UPDATE/DELETE existentes (TO authenticated + setor SEO/ADMIN/DEV) são mantidas.

CREATE POLICY "sol_select_anon" ON siloms_solicitacoes
  FOR SELECT TO anon USING (true);

CREATE POLICY "sol_insert_anon" ON siloms_solicitacoes
  FOR INSERT TO anon WITH CHECK (true);
