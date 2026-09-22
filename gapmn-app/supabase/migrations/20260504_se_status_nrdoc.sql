-- Status da SE no SILOMS (ex: "Assinada OD UGCred") e Nr. Documento (subprocesso) da SE
ALTER TABLE siloms_solicitacoes
  ADD COLUMN IF NOT EXISTS status       text,
  ADD COLUMN IF NOT EXISTS nr_documento text;
