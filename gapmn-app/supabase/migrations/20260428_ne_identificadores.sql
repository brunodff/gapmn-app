-- Mapeamento NE SIAFI ↔ Identificador SILOMS (coluna A) + Solicitação (coluna P)
-- Importado via planilha Excel de controle de empenhos
CREATE TABLE IF NOT EXISTS siloms_ne_identificadores (
  ne_siafi      text NOT NULL,
  identificador text NOT NULL DEFAULT '',
  solicitacao   text,
  PRIMARY KEY (ne_siafi, identificador)
);

ALTER TABLE siloms_ne_identificadores ENABLE ROW LEVEL SECURITY;

CREATE POLICY "sel_pub"  ON siloms_ne_identificadores FOR SELECT USING (true);
CREATE POLICY "ins_auth" ON siloms_ne_identificadores FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "upd_auth" ON siloms_ne_identificadores FOR UPDATE USING (auth.uid() IS NOT NULL);
CREATE POLICY "del_auth" ON siloms_ne_identificadores FOR DELETE USING (auth.uid() IS NOT NULL);
