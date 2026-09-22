-- Add PDF-extracted fields to contratos_scon
ALTER TABLE contratos_scon
  ADD COLUMN IF NOT EXISTS receita_despesa   text,
  ADD COLUMN IF NOT EXISTS numero_compra     text,
  ADD COLUMN IF NOT EXISTS modalidade_compra text,
  ADD COLUMN IF NOT EXISTS amparo_legal      text,
  ADD COLUMN IF NOT EXISTS categoria         text,
  ADD COLUMN IF NOT EXISTS num_parcelas      int,
  ADD COLUMN IF NOT EXISTS valor_parcela     numeric,
  ADD COLUMN IF NOT EXISTS valor_acumulado   numeric;

-- Histórico de alterações do contrato
CREATE TABLE IF NOT EXISTS contratos_historico (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contrato_id     uuid NOT NULL REFERENCES contratos_scon(id) ON DELETE CASCADE,
  data_assinatura date,
  numero          text,
  tipo            text,
  observacao      text,
  created_at      timestamptz DEFAULT now()
);
ALTER TABLE contratos_historico ENABLE ROW LEVEL SECURITY;
CREATE POLICY "hist_select" ON contratos_historico FOR SELECT TO authenticated USING (true);
CREATE POLICY "hist_insert" ON contratos_historico FOR INSERT TO authenticated WITH CHECK (
  EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND setor IN ('SCON','ADMIN','DEV'))
);
CREATE POLICY "hist_delete" ON contratos_historico FOR DELETE TO authenticated USING (
  EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND setor IN ('SCON','ADMIN','DEV'))
);

-- Empenhos vinculados ao contrato
CREATE TABLE IF NOT EXISTS contratos_empenhos (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contrato_id      uuid NOT NULL REFERENCES contratos_scon(id) ON DELETE CASCADE,
  ug               text,
  numero_ne        text,
  pi               text,
  nd               text,
  valor_emp        numeric,
  valor_a_liquidar numeric,
  valor_liquidado  numeric,
  created_at       timestamptz DEFAULT now()
);
ALTER TABLE contratos_empenhos ENABLE ROW LEVEL SECURITY;
CREATE POLICY "cemp_select" ON contratos_empenhos FOR SELECT TO authenticated USING (true);
CREATE POLICY "cemp_insert" ON contratos_empenhos FOR INSERT TO authenticated WITH CHECK (
  EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND setor IN ('SCON','ADMIN','DEV'))
);
CREATE POLICY "cemp_delete" ON contratos_empenhos FOR DELETE TO authenticated USING (
  EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND setor IN ('SCON','ADMIN','DEV'))
);

-- Itens do contrato
CREATE TABLE IF NOT EXISTS contratos_itens (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contrato_id uuid NOT NULL REFERENCES contratos_scon(id) ON DELETE CASCADE,
  tipo        text,
  descricao   text,
  created_at  timestamptz DEFAULT now()
);
ALTER TABLE contratos_itens ENABLE ROW LEVEL SECURITY;
CREATE POLICY "cit_select" ON contratos_itens FOR SELECT TO authenticated USING (true);
CREATE POLICY "cit_insert" ON contratos_itens FOR INSERT TO authenticated WITH CHECK (
  EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND setor IN ('SCON','ADMIN','DEV'))
);
CREATE POLICY "cit_delete" ON contratos_itens FOR DELETE TO authenticated USING (
  EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND setor IN ('SCON','ADMIN','DEV'))
);
