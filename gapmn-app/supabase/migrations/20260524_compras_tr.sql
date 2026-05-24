-- Tabela de Termos de Referência por número de compra
-- Um TR pertence a uma COMPRA (não a um item específico)
CREATE TABLE IF NOT EXISTS compras_tr_gap_mn (
  numero_compra  text PRIMARY KEY,
  pdf_url        text,
  data_orcamento date,
  indice_adotado text,
  registrado_em  timestamptz DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE ON TABLE public.compras_tr_gap_mn TO anon;
GRANT SELECT, INSERT, UPDATE ON TABLE public.compras_tr_gap_mn TO authenticated;
