-- cnet_itens: stores items per licitação process
CREATE TABLE IF NOT EXISTS cnet_itens (
  id               bigserial PRIMARY KEY,
  identificacao    text NOT NULL,
  numero_item      int  NOT NULL,
  descricao        text,
  descricao_detalhada text,
  unidade          text,
  quantidade       numeric,
  valor_estimado_unitario numeric,
  valor_estimado_total    numeric,
  situacao         text,
  homologado       boolean DEFAULT false,
  lote             text,
  sincronizado_em  timestamptz DEFAULT now(),
  UNIQUE(identificacao, numero_item)
);

ALTER TABLE cnet_itens ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "anon upsert cnet_itens" ON cnet_itens;
CREATE POLICY "anon upsert cnet_itens" ON cnet_itens FOR ALL TO anon WITH CHECK (true);
DROP POLICY IF EXISTS "auth read cnet_itens" ON cnet_itens;
CREATE POLICY "auth read cnet_itens" ON cnet_itens FOR SELECT TO authenticated USING (true);

-- cnet_participantes: stores participants/suppliers per process
CREATE TABLE IF NOT EXISTS cnet_participantes (
  id               bigserial PRIMARY KEY,
  identificacao    text NOT NULL,
  cnpj             text NOT NULL,
  nome             text,
  me_epp           boolean DEFAULT false,
  qtd_itens_selecao int,
  sincronizado_em  timestamptz DEFAULT now(),
  UNIQUE(identificacao, cnpj)
);

ALTER TABLE cnet_participantes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "anon upsert cnet_participantes" ON cnet_participantes;
CREATE POLICY "anon upsert cnet_participantes" ON cnet_participantes FOR ALL TO anon WITH CHECK (true);
DROP POLICY IF EXISTS "auth read cnet_participantes" ON cnet_participantes;
CREATE POLICY "auth read cnet_participantes" ON cnet_participantes FOR SELECT TO authenticated USING (true);
