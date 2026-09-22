-- Corrige políticas RLS de cnet_propostas_gapmn
-- O robô usa a anon key (sem sessão de usuário), então INSERT e DELETE
-- precisam permitir o role 'anon'. A segurança fica pelo anon key em si.

DROP POLICY IF EXISTS "cnet_gapmn_insert" ON cnet_propostas_gapmn;
DROP POLICY IF EXISTS "cnet_gapmn_delete" ON cnet_propostas_gapmn;

-- Qualquer portador do anon key pode inserir (robô interno)
CREATE POLICY "cnet_gapmn_insert" ON cnet_propostas_gapmn
  FOR INSERT WITH CHECK (true);

-- Qualquer portador do anon key pode deletar (limpeza antes de reinserir)
CREATE POLICY "cnet_gapmn_delete" ON cnet_propostas_gapmn
  FOR DELETE USING (true);
