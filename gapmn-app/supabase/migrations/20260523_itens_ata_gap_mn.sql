-- Itens de cada ATA do GAP-MN (scraped de contratos.sistema.gov.br/arp)
CREATE TABLE IF NOT EXISTS itens_ata_gap_mn (
  id                   bigserial PRIMARY KEY,
  numero_ata           text NOT NULL,
  numero_item          text,
  descricao            text,
  cnpj_fornecedor      text,
  fornecedor_nome      text,
  quantidade_registrada numeric(15,5),
  valor_unitario       numeric(15,4),
  valor_total          numeric(15,4),
  qtd_limite_adesao    integer,
  aceita_adesao        text,
  UNIQUE (numero_ata, numero_item, cnpj_fornecedor)
);

CREATE INDEX IF NOT EXISTS idx_itens_ata ON itens_ata_gap_mn(numero_ata);

ALTER TABLE itens_ata_gap_mn DISABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT ON TABLE public.itens_ata_gap_mn TO anon;
GRANT ALL ON TABLE public.itens_ata_gap_mn TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE public.itens_ata_gap_mn_id_seq TO anon, authenticated;
