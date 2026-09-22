-- Permite que o robô SILOMS (anon key, sem sessão) atualize subprocesso e perfil_atual
-- Padrão consistente com siloms_solicitacoes_empenho ("Escrita livre")
DROP POLICY IF EXISTS "upd_auth" ON siloms_ne_identificadores;
CREATE POLICY "upd_livre" ON siloms_ne_identificadores
  FOR UPDATE USING (true) WITH CHECK (true);
