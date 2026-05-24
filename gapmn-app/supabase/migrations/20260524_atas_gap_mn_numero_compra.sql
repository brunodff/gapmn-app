-- Adiciona número da compra de origem à tabela de ATAs
ALTER TABLE atas_gap_mn ADD COLUMN IF NOT EXISTS numero_compra text;

-- Autoriza o anon (bookmarklet) a atualizar o novo campo
GRANT UPDATE (numero_compra) ON TABLE public.atas_gap_mn TO anon;
