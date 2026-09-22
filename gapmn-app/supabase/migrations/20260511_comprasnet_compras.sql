CREATE TABLE IF NOT EXISTS comprasnet_compras (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  numero_compra text        NOT NULL,
  ano           int         NOT NULL,
  uasg          text        NOT NULL DEFAULT '120630',
  objeto        text,
  modalidade    text,
  situacao      text,        -- 'Em andamento' | 'Finalizadas'
  etapa         text,        -- 'Homologada' | 'Deserta' | etc.
  valor_estimado numeric,
  data_abertura text,
  fornecedor    text,
  dados         jsonb,       -- resposta completa da API
  capturado_em  timestamptz DEFAULT now(),
  UNIQUE(numero_compra, ano, uasg)
);

ALTER TABLE comprasnet_compras ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "leitura autenticados"    ON comprasnet_compras;
DROP POLICY IF EXISTS "escrita autenticados"    ON comprasnet_compras;
DROP POLICY IF EXISTS "atualizacao autenticados" ON comprasnet_compras;

CREATE POLICY "leitura autenticados"
  ON comprasnet_compras FOR SELECT
  TO authenticated USING (true);

CREATE POLICY "escrita autenticados"
  ON comprasnet_compras FOR INSERT
  TO authenticated WITH CHECK (true);

CREATE POLICY "atualizacao autenticados"
  ON comprasnet_compras FOR UPDATE
  TO authenticated USING (true);
