-- Move numero_compra de atas_gap_mn → itens_ata_gap_mn
-- (campo vem da página /show junto com os itens)

ALTER TABLE itens_ata_gap_mn ADD COLUMN IF NOT EXISTS numero_compra text;

-- upsert precisa de UPDATE além de INSERT
GRANT UPDATE ON TABLE public.itens_ata_gap_mn TO anon;

-- Remove da tabela errada (adicionado na migration 20260524)
ALTER TABLE atas_gap_mn DROP COLUMN IF EXISTS numero_compra;

-- Bucket público para Termos de Referência
INSERT INTO storage.buckets (id, name, public)
VALUES ('atas-docs', 'atas-docs', true)
ON CONFLICT (id) DO NOTHING;
