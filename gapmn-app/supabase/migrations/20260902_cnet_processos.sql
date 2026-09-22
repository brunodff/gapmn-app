-- cnet_processos: process list synced from ComprasNet via Chrome Extension
CREATE TABLE IF NOT EXISTS cnet_processos (
  id               bigint PRIMARY KEY,
  identificacao    text,
  numero           text,
  ano              text,
  situacao         text,
  acao             text,
  acao_url         text,
  possui_pendencia boolean DEFAULT false,
  agrupamento      text,
  sincronizado_em  timestamptz DEFAULT now()
);

ALTER TABLE cnet_processos ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "cnet_processos_read_auth"  ON cnet_processos;
DROP POLICY IF EXISTS "cnet_processos_write_anon" ON cnet_processos;
DROP POLICY IF EXISTS "cnet_processos_read_anon"  ON cnet_processos;

-- authenticated users can read
CREATE POLICY "cnet_processos_read_auth" ON cnet_processos
  FOR SELECT TO authenticated USING (true);

-- anon can upsert (used by Chrome extension with anon key)
CREATE POLICY "cnet_processos_write_anon" ON cnet_processos
  FOR ALL TO anon USING (true) WITH CHECK (true);

-- anon can also read (for healthcheck / extension verification)
CREATE POLICY "cnet_processos_read_anon" ON cnet_processos
  FOR SELECT TO anon USING (true);
