-- Adiciona coluna subprocesso (Nr. Documento do SILOMS) à tabela de identificadores
-- NULL = ainda não pesquisado pelo bot
-- ''   = pesquisado, não encontrado
-- valor = subprocesso encontrado (ex: "2026/00123")
ALTER TABLE siloms_ne_identificadores ADD COLUMN IF NOT EXISTS subprocesso text;
