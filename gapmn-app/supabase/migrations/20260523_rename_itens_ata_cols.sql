-- Renomeia colunas de itens_ata_gap_mn para refletir o significado correto:
--   ata_numero = referência da ATA-mãe (ex: "00164/2026")  [era numero_ata]
--   numero_ata = número do item dentro da ATA (ex: "00016") [era numero_item]

-- 1. Renomeia
ALTER TABLE itens_ata_gap_mn RENAME COLUMN numero_ata  TO ata_numero;
ALTER TABLE itens_ata_gap_mn RENAME COLUMN numero_item TO numero_ata;

-- 2. Remove constraint com nome antigo (gerado pelo Postgres) e recria
ALTER TABLE itens_ata_gap_mn
  DROP CONSTRAINT IF EXISTS itens_ata_gap_mn_numero_ata_numero_item_cnpj_fornecedor_key;
ALTER TABLE itens_ata_gap_mn
  DROP CONSTRAINT IF EXISTS itens_ata_gap_mn_unique;
ALTER TABLE itens_ata_gap_mn
  ADD CONSTRAINT itens_ata_gap_mn_unique
  UNIQUE (ata_numero, numero_ata, cnpj_fornecedor);

-- 3. Recria index principal
DROP INDEX IF EXISTS idx_itens_ata;
CREATE INDEX IF NOT EXISTS idx_itens_ata ON itens_ata_gap_mn(ata_numero);
