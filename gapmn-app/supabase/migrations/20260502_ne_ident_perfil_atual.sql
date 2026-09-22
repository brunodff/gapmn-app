-- Adiciona perfil_atual (Perfil Unidade Atual do SILOMS) à tabela de identificadores
ALTER TABLE siloms_ne_identificadores ADD COLUMN IF NOT EXISTS perfil_atual text;
