-- Justificativa para SEs sem NE SIAFI há mais de 7 dias (exibida no Painel Gerencial)
ALTER TABLE siloms_solicitacoes
  ADD COLUMN IF NOT EXISTS justificativa_atraso text;
