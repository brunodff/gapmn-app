-- Tabela de log de atividades do usuário
CREATE TABLE IF NOT EXISTS activity_log (
  id          uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id     uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  setor       text,
  nome_guerra text,
  action      text        NOT NULL,  -- 'page_view' | 'tab_change' | 'search' | 'chatbot_query' | 'button_click'
  entity      text,                  -- view/tab/componente alvo
  value       text,                  -- termo de busca, query do chatbot, etc.
  created_at  timestamptz DEFAULT now()
);

ALTER TABLE activity_log ENABLE ROW LEVEL SECURITY;

-- Qualquer autenticado pode inserir seu próprio log
CREATE POLICY "activity_log_insert" ON activity_log
  FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

-- Qualquer autenticado pode ler (controle de quem vê fica no front-end via role)
CREATE POLICY "activity_log_read" ON activity_log
  FOR SELECT TO authenticated
  USING (true);

-- Índice para consultas por período e ação
CREATE INDEX IF NOT EXISTS activity_log_created_at_idx ON activity_log (created_at DESC);
CREATE INDEX IF NOT EXISTS activity_log_user_id_idx    ON activity_log (user_id);
CREATE INDEX IF NOT EXISTS activity_log_action_idx     ON activity_log (action);

-- Habilitar realtime (necessário para o PainelAnalytics ao vivo)
ALTER PUBLICATION supabase_realtime ADD TABLE activity_log;
