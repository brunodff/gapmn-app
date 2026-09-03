-- Adiciona colunas de vencedor a cnet_itens
ALTER TABLE cnet_itens ADD COLUMN IF NOT EXISTS vencedor_cnpj          text;
ALTER TABLE cnet_itens ADD COLUMN IF NOT EXISTS vencedor_nome          text;
ALTER TABLE cnet_itens ADD COLUMN IF NOT EXISTS valor_vencedor_unitario numeric;
ALTER TABLE cnet_itens ADD COLUMN IF NOT EXISTS valor_vencedor_total    numeric;
