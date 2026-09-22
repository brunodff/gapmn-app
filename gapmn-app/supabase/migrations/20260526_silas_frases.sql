-- Armazena frases do Silas (Despachante SILOMS) por usuário.
-- user_key = nome de guerra (ex: "3S ANNE"), definido na primeira abertura do painel.
CREATE TABLE IF NOT EXISTS silas_frases (
  user_key   text PRIMARY KEY,
  frases     jsonb        NOT NULL DEFAULT '[]',
  updated_at timestamptz  NOT NULL DEFAULT now()
);

ALTER TABLE silas_frases ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "silas_select" ON silas_frases;
DROP POLICY IF EXISTS "silas_upsert" ON silas_frases;

-- Leitura pública (o bookmarklet usa chave anon)
CREATE POLICY "silas_select" ON silas_frases
  FOR SELECT USING (true);

-- Escrita: qualquer sessão autenticada ou anon pode upsert da própria chave
CREATE POLICY "silas_upsert" ON silas_frases
  FOR ALL USING (true) WITH CHECK (true);
