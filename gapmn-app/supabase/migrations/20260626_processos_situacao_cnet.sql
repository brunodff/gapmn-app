-- Adiciona campos de situação verificada no ComprasNet (site público)
-- Preenchidos pelo cnet-status-bot.js (siloms-bot/cnet-status-bot.js)
ALTER TABLE processos_licitatorios
  ADD COLUMN IF NOT EXISTS situacao_cnet    text,
  ADD COLUMN IF NOT EXISTS situacao_cnet_em timestamptz;
