-- Adiciona coluna detailUrl à tabela de ATAs (usada pelo Robô ARP para navegação)
ALTER TABLE atas_gap_mn
  ADD COLUMN IF NOT EXISTS "detailUrl" text;
