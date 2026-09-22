-- Trigger que gera entradas no feed_items quando:
--   • Uma NE SIAFI nova é inserida em siloms_ne_identificadores
--   • O perfil_atual de uma NE muda de um valor para outro

-- ── INSERT: nova NE ────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION fn_ne_ident_feed_insert()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  INSERT INTO feed_items (titulo, tipo, link_tab)
  VALUES (
    '💰 Nova NE SIAFI registrada: ' || NEW.ne_siafi
      || CASE WHEN NEW.solicitacao IS NOT NULL THEN ' (' || NEW.solicitacao || ')' ELSE '' END,
    'empenhos',
    'empenhos'
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tg_ne_ident_insert ON siloms_ne_identificadores;
CREATE TRIGGER tg_ne_ident_insert
  AFTER INSERT ON siloms_ne_identificadores
  FOR EACH ROW EXECUTE FUNCTION fn_ne_ident_feed_insert();

-- ── UPDATE: mudança de perfil_atual ───────────────────────────────────────────
CREATE OR REPLACE FUNCTION fn_ne_ident_feed_update()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  -- Só dispara quando perfil_atual muda E ambos os valores são não-nulos
  -- (evita ruído quando o perfil é preenchido pela primeira vez a partir de NULL)
  IF OLD.perfil_atual IS DISTINCT FROM NEW.perfil_atual
     AND OLD.perfil_atual IS NOT NULL
     AND NEW.perfil_atual IS NOT NULL
  THEN
    INSERT INTO feed_items (titulo, tipo, link_tab)
    VALUES (
      '🔄 NE ' || NEW.ne_siafi
        || CASE WHEN NEW.solicitacao IS NOT NULL THEN ' (' || NEW.solicitacao || ')' ELSE '' END
        || ': perfil ' || OLD.perfil_atual || ' → ' || NEW.perfil_atual,
      'empenhos',
      'empenhos'
    );
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tg_ne_ident_update ON siloms_ne_identificadores;
CREATE TRIGGER tg_ne_ident_update
  AFTER UPDATE ON siloms_ne_identificadores
  FOR EACH ROW EXECUTE FUNCTION fn_ne_ident_feed_update();
