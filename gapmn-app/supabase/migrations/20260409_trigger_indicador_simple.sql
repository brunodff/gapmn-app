-- Substitui o trigger de INSERT nos indicadores por versão simplificada
-- Não tenta contar novos vs. existentes (impossível após DELETE+INSERT)
-- Gera apenas uma entrada por janela de 5 min para evitar spam

DROP TRIGGER IF EXISTS tg_notify_indicador_insert ON indicadores_lotacao;
DROP FUNCTION IF EXISTS fn_notify_indicador_insert_dedup();
DROP FUNCTION IF EXISTS fn_notify_indicador_insert_batch();

CREATE OR REPLACE FUNCTION fn_notify_indicador_insert_simple()
RETURNS TRIGGER SECURITY DEFINER AS $$
DECLARE
  existing_id uuid;
BEGIN
  -- Evita duplicar: se já existe entrada recente (5 min), ignora
  SELECT id INTO existing_id
  FROM feed_items
  WHERE tipo = 'indicadores'
    AND titulo LIKE '📊 Indicadores de Lotação%'
    AND created_at > now() - interval '5 minutes'
  ORDER BY created_at DESC
  LIMIT 1;

  IF existing_id IS NULL THEN
    INSERT INTO feed_items (titulo, tipo, link_tab)
    VALUES ('📊 Indicadores de Lotação atualizados', 'indicadores', 'indicadores');
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER tg_notify_indicador_insert
  AFTER INSERT ON indicadores_lotacao
  FOR EACH ROW EXECUTE FUNCTION fn_notify_indicador_insert_simple();
