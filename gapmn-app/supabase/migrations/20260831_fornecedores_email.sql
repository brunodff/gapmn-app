-- Adiciona CNPJ do fornecedor e timestamp de notificação ao fornecedor
ALTER TABLE solicitacoes_empenho
  ADD COLUMN IF NOT EXISTS cnpj_fornecedor       text,
  ADD COLUMN IF NOT EXISTS notificado_fornecedor_em timestamptz;

-- Tabela de mapeamento CNPJ → e-mail dos fornecedores
CREATE TABLE IF NOT EXISTS fornecedores_email (
  id           uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  cnpj         text UNIQUE NOT NULL,
  nome_empresa text,
  email        text NOT NULL,
  created_at   timestamptz DEFAULT now(),
  updated_at   timestamptz DEFAULT now()
);

ALTER TABLE fornecedores_email ENABLE ROW LEVEL SECURITY;

-- Leitura: qualquer autenticado
CREATE POLICY "autenticados_leem_fornecedores_email" ON fornecedores_email
  FOR SELECT USING (auth.role() = 'authenticated');

-- Escrita: SEO, DEV, ADMIN
CREATE POLICY "seo_dev_admin_gerenciam_fornecedores_email" ON fornecedores_email
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE id = auth.uid()
        AND setor IN ('SEO', 'DEV', 'ADMIN')
    )
  );
