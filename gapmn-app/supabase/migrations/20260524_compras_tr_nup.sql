-- Adiciona coluna NUP (Processo Administrativo) extraída do TR
ALTER TABLE compras_tr_gap_mn
  ADD COLUMN IF NOT EXISTS nup text;
