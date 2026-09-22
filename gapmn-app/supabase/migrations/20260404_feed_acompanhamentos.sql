-- Feed de notícias (público leitura, agentes escrevem)
CREATE TABLE IF NOT EXISTS feed_items (
  id          uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  titulo      text NOT NULL,
  descricao   text,
  tipo        text NOT NULL DEFAULT 'geral',  -- contratos | processos | empenhos | indicadores | geral
  link_tab    text,          -- tab destino quando usuário clica logado
  created_at  timestamptz DEFAULT now(),
  created_by  uuid REFERENCES auth.users(id) ON DELETE SET NULL
);

ALTER TABLE feed_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "feed_read"         ON feed_items FOR SELECT USING (true);
CREATE POLICY "feed_insert"       ON feed_items FOR INSERT WITH CHECK (
  EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND setor IS NOT NULL)
);
CREATE POLICY "feed_delete_own"   ON feed_items FOR DELETE  USING (created_by = auth.uid());

-- Acompanhamentos por usuário
CREATE TABLE IF NOT EXISTS user_acompanhamentos (
  id         uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id    uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  tipo       text NOT NULL CHECK (tipo IN ('contrato','processo','empenho','indicador')),
  ref_id     text NOT NULL,
  ref_label  text,
  is_fiscal  boolean DEFAULT false,
  created_at timestamptz DEFAULT now(),
  UNIQUE (user_id, tipo, ref_id)
);

ALTER TABLE user_acompanhamentos ENABLE ROW LEVEL SECURITY;
CREATE POLICY "acomp_all" ON user_acompanhamentos FOR ALL USING (auth.uid() = user_id);
