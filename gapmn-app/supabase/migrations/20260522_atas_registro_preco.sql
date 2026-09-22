-- Tabela de Atas de Registro de Preço sincronizadas do PNCP
CREATE TABLE IF NOT EXISTS atas_registro_preco (
  id               bigserial PRIMARY KEY,
  pncp_id          text UNIQUE NOT NULL,       -- "{cnpjOrgao}/{anoAta}/{sequencialAta}"
  numero_ata       text,
  sequencial_ata   integer,
  ano_ata          integer,
  uasg             text,
  cnpj_orgao       text,
  objeto           text,
  valor_total      numeric(15,2),
  data_assinatura  date,
  vigencia_inicio  date,
  vigencia_fim     date,
  situacao         text,
  fornecedor_cnpj  text,
  fornecedor_nome  text,
  numero_processo  text,
  importado_em     timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_atas_uasg_ano   ON atas_registro_preco(uasg, ano_ata);
CREATE INDEX IF NOT EXISTS idx_atas_vigencia   ON atas_registro_preco(vigencia_fim);
CREATE INDEX IF NOT EXISTS idx_atas_situacao   ON atas_registro_preco(situacao);

ALTER TABLE atas_registro_preco ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "atas_select" ON atas_registro_preco;
DROP POLICY IF EXISTS "atas_insert" ON atas_registro_preco;
DROP POLICY IF EXISTS "atas_update" ON atas_registro_preco;
DROP POLICY IF EXISTS "atas_delete" ON atas_registro_preco;

CREATE POLICY "atas_select" ON atas_registro_preco
  FOR SELECT USING (auth.role() = 'authenticated');

CREATE POLICY "atas_insert" ON atas_registro_preco
  FOR INSERT WITH CHECK (
    (SELECT setor FROM profiles WHERE id = auth.uid()) IN ('ADMIN','DEV','SLIC')
  );

CREATE POLICY "atas_update" ON atas_registro_preco
  FOR UPDATE USING (
    (SELECT setor FROM profiles WHERE id = auth.uid()) IN ('ADMIN','DEV','SLIC')
  );

CREATE POLICY "atas_delete" ON atas_registro_preco
  FOR DELETE USING (
    (SELECT setor FROM profiles WHERE id = auth.uid()) IN ('ADMIN','DEV','SLIC')
  );
