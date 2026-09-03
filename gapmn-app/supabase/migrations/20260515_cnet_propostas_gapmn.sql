-- Tabela para armazenar dados do robô CNET para o GAP-MN (UASG 120630)
CREATE TABLE IF NOT EXISTS cnet_propostas_gapmn (
  id               bigserial PRIMARY KEY,
  processo         text NOT NULL,
  ano              text,
  uasg             text,
  grupo            text,
  item             text,
  nome_item        text,
  cnpj             text,
  razao_social     text,
  uf               text,
  status           text,
  me_epp           text,
  valor_ofertado   text,
  valor_negociado  text,
  situacao_item    text,
  qtde_solicitada  text,
  descricao_item   text,
  criterio_julgamento text,
  sit_processo     text,
  valor_estimado   text,
  importado_em     timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_cnet_gapmn_processo ON cnet_propostas_gapmn(processo);
CREATE INDEX IF NOT EXISTS idx_cnet_gapmn_item     ON cnet_propostas_gapmn(processo, item);

ALTER TABLE cnet_propostas_gapmn ENABLE ROW LEVEL SECURITY;

-- Remove políticas anteriores antes de recriar
DROP POLICY IF EXISTS "cnet_gapmn_select" ON cnet_propostas_gapmn;
DROP POLICY IF EXISTS "cnet_gapmn_insert" ON cnet_propostas_gapmn;
DROP POLICY IF EXISTS "cnet_gapmn_delete" ON cnet_propostas_gapmn;

-- Leitura: pública (dados de licitação pública — sem restrição)
CREATE POLICY "cnet_gapmn_select" ON cnet_propostas_gapmn
  FOR SELECT USING (true);

-- Escrita: permite anon (robô bookmarklet usa chave anon) e autenticados
CREATE POLICY "cnet_gapmn_insert" ON cnet_propostas_gapmn
  FOR INSERT WITH CHECK (true);

-- Deleção: permite anon e autenticados (robô apaga antes de reinserir)
CREATE POLICY "cnet_gapmn_delete" ON cnet_propostas_gapmn
  FOR DELETE USING (true);
