-- Coluna de situação ComprasNet no processo existente
ALTER TABLE processos_licitatorios
  ADD COLUMN IF NOT EXISTS situacao_cnet text;

-- Grupos/lotes por processo
CREATE TABLE IF NOT EXISTS cnet_grupos (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  numero_compra text NOT NULL,
  ano           int  NOT NULL,
  uasg          text NOT NULL DEFAULT '120630',
  grupo         int  NOT NULL,
  total_itens   int,
  situacao      text,        -- 'Homologado' | 'Deserto' | 'Cancelado'
  valor_estimado numeric,
  capturado_em  timestamptz DEFAULT now(),
  UNIQUE(numero_compra, ano, uasg, grupo)
);

-- Propostas de fornecedores por grupo
CREATE TABLE IF NOT EXISTS cnet_propostas (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  numero_compra  text NOT NULL,
  ano            int  NOT NULL,
  uasg           text NOT NULL DEFAULT '120630',
  grupo          int  NOT NULL,
  cnpj           text,
  razao_social   text,
  uf             text,
  status         text,        -- 'Adjudicada' | 'Desclassificada' | etc.
  me_epp         boolean DEFAULT false,
  valor_ofertado  numeric,
  valor_negociado numeric,
  capturado_em   timestamptz DEFAULT now(),
  UNIQUE(numero_compra, ano, uasg, grupo, cnpj)
);

ALTER TABLE cnet_grupos   ENABLE ROW LEVEL SECURITY;
ALTER TABLE cnet_propostas ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "leitura" ON cnet_grupos;
DROP POLICY IF EXISTS "escrita"  ON cnet_grupos;
DROP POLICY IF EXISTS "leitura" ON cnet_propostas;
DROP POLICY IF EXISTS "escrita"  ON cnet_propostas;

CREATE POLICY "leitura" ON cnet_grupos   FOR SELECT TO authenticated USING (true);
CREATE POLICY "escrita"  ON cnet_grupos   FOR ALL    TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "leitura" ON cnet_propostas FOR SELECT TO authenticated USING (true);
CREATE POLICY "escrita"  ON cnet_propostas FOR ALL    TO authenticated USING (true) WITH CHECK (true);
