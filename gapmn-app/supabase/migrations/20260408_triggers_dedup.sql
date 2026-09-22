-- Remove triggers statement-level anteriores
DROP TRIGGER IF EXISTS tg_notify_indicador_insert ON indicadores_lotacao;
DROP TRIGGER IF EXISTS tg_notify_contrato_insert   ON contratos_scon;
DROP TRIGGER IF EXISTS tg_notify_processo_insert   ON processos_licitatorios;

-- ── Indicadores: row-level com deduplicação por janela de 2 min ───────────────
CREATE OR REPLACE FUNCTION fn_notify_indicador_insert_dedup()
RETURNS TRIGGER SECURITY DEFINER AS $$
DECLARE
  existing_id uuid;
  new_detail  text;
BEGIN
  new_detail := COALESCE(NEW.conta_corrente, '') ||
    CASE WHEN NEW.natureza IS NOT NULL THEN ' (PI: ' || NEW.natureza || ')' ELSE '' END;

  -- Procura item recente dos últimos 2 minutos
  SELECT id INTO existing_id
  FROM feed_items
  WHERE tipo = 'indicadores'
    AND created_at > now() - interval '2 minutes'
  ORDER BY created_at DESC
  LIMIT 1;

  IF existing_id IS NOT NULL THEN
    -- Extrai contagem e detalhe existentes, incrementa
    UPDATE feed_items
    SET titulo = titulo || E'\n• ' || new_detail
    WHERE id = existing_id;
  ELSE
    INSERT INTO feed_items (titulo, tipo, link_tab)
    VALUES (
      '📊 Novos indicadores de lotação adicionados:' || E'\n• ' || new_detail,
      'indicadores',
      'indicadores'
    );
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER tg_notify_indicador_insert
  AFTER INSERT ON indicadores_lotacao
  FOR EACH ROW EXECUTE FUNCTION fn_notify_indicador_insert_dedup();

-- ── Processos: row-level com deduplicação por janela de 2 min ────────────────
CREATE OR REPLACE FUNCTION fn_notify_processo_insert_dedup()
RETURNS TRIGGER SECURITY DEFINER AS $$
DECLARE
  existing_id uuid;
  new_detail  text;
BEGIN
  new_detail := COALESCE(NEW.modalidade, '') || ' ' || COALESCE(NEW.numero_processo, '');

  SELECT id INTO existing_id
  FROM feed_items
  WHERE tipo = 'processos'
    AND created_at > now() - interval '2 minutes'
  ORDER BY created_at DESC
  LIMIT 1;

  IF existing_id IS NOT NULL THEN
    UPDATE feed_items
    SET titulo = titulo || E'\n• ' || new_detail
    WHERE id = existing_id;
  ELSE
    INSERT INTO feed_items (titulo, tipo, link_tab)
    VALUES (
      '⚖️ Novos processos sincronizados da API:' || E'\n• ' || new_detail,
      'processos',
      'processos'
    );
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER tg_notify_processo_insert
  AFTER INSERT ON processos_licitatorios
  FOR EACH ROW EXECUTE FUNCTION fn_notify_processo_insert_dedup();

-- ── Contratos: row-level com deduplicação por janela de 2 min ────────────────
CREATE OR REPLACE FUNCTION fn_notify_contrato_insert_dedup()
RETURNS TRIGGER SECURITY DEFINER AS $$
DECLARE
  existing_id uuid;
  new_detail  text;
BEGIN
  new_detail := COALESCE(NEW.numero_contrato, '') ||
    CASE WHEN NEW.fornecedor IS NOT NULL THEN ' – ' || NEW.fornecedor ELSE '' END;

  SELECT id INTO existing_id
  FROM feed_items
  WHERE tipo = 'contratos'
    AND created_at > now() - interval '2 minutes'
  ORDER BY created_at DESC
  LIMIT 1;

  IF existing_id IS NOT NULL THEN
    UPDATE feed_items
    SET titulo = titulo || E'\n• ' || new_detail
    WHERE id = existing_id;
  ELSE
    INSERT INTO feed_items (titulo, tipo, link_tab)
    VALUES (
      '📋 Novos contratos importados:' || E'\n• ' || new_detail,
      'contratos',
      'contratos'
    );
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER tg_notify_contrato_insert
  AFTER INSERT ON contratos_scon
  FOR EACH ROW EXECUTE FUNCTION fn_notify_contrato_insert_dedup();
