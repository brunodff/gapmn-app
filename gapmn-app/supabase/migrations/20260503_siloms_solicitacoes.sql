-- Tabela de Solicitações de Empenho recebidas pelo SEO (de Gerenciamento de Sol. Empenho RECEBIDAS)
-- Armazena: SE, UG Cred, Data de chegada, responsável SEO, flag de exclusão da média

CREATE TABLE IF NOT EXISTS siloms_solicitacoes (
  solicitacao            text PRIMARY KEY,
  ug_cred                text,
  dt_solicitacao         date,
  responsavel            text CHECK (responsavel IN ('3S ANNE', '3S ELAINE', '2T BRUNO')),
  excluir_media          boolean DEFAULT false NOT NULL,
  justificativa_exclusao text,
  created_at             timestamptz DEFAULT now()
);

ALTER TABLE siloms_solicitacoes ENABLE ROW LEVEL SECURITY;

-- Todos os autenticados podem ler
CREATE POLICY "sol_select_all" ON siloms_solicitacoes
  FOR SELECT TO authenticated USING (true);

-- SEO / ADMIN / DEV podem inserir
CREATE POLICY "sol_insert_seo" ON siloms_solicitacoes
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND setor IN ('SEO','ADMIN','DEV'))
  );

-- SEO / ADMIN / DEV podem atualizar
CREATE POLICY "sol_update_seo" ON siloms_solicitacoes
  FOR UPDATE TO authenticated
  USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND setor IN ('SEO','ADMIN','DEV'))
  );

-- SEO / ADMIN / DEV podem deletar
CREATE POLICY "sol_delete_seo" ON siloms_solicitacoes
  FOR DELETE TO authenticated
  USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND setor IN ('SEO','ADMIN','DEV'))
  );
