-- Permite resolver manualmente SEs que referenciam NEs de outros anos (ex: 2025NE...)
-- que não constam na planilha principal (somente 2026NE).
ALTER TABLE siloms_solicitacoes ADD COLUMN IF NOT EXISTS ne_manual text;
