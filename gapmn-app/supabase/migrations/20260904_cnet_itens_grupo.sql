-- Liga sub-itens ao seu grupo pai
ALTER TABLE cnet_itens ADD COLUMN IF NOT EXISTS grupo_numero integer;
