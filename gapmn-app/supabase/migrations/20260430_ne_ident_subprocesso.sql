-- Allow anon role to UPDATE subprocesso on siloms_ne_identificadores
-- Needed by the SILOMS bookmarklet, which runs on the intranet without Supabase auth.
-- Only the subprocesso column is patched; ne_siafi/identificador/solicitacao are protected
-- by the existing ins_auth / del_auth policies (INSERT/DELETE still require auth.uid).
DROP POLICY IF EXISTS "upd_anon_subprocesso" ON siloms_ne_identificadores;
CREATE POLICY "upd_anon_subprocesso"
  ON siloms_ne_identificadores
  FOR UPDATE
  USING (true)
  WITH CHECK (true);
