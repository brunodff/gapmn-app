-- Triggers de INSERT para feed_items quando novos registros são criados

-- ── Novo indicador de lotação ────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION fn_notify_indicador_insert()
RETURNS TRIGGER SECURITY DEFINER AS $$
BEGIN
  INSERT INTO feed_items (titulo, tipo, link_tab)
  VALUES (
    '📊 Novo indicador de lotação cadastrado: ' || COALESCE(NEW.conta_corrente, '') ||
    CASE WHEN NEW.descricao IS NOT NULL THEN ' – ' || NEW.descricao ELSE '' END,
    'indicadores',
    'indicadores'
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS tg_notify_indicador_insert ON indicadores_lotacao;
CREATE TRIGGER tg_notify_indicador_insert
  AFTER INSERT ON indicadores_lotacao
  FOR EACH ROW EXECUTE FUNCTION fn_notify_indicador_insert();

-- ── Novo contrato ────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION fn_notify_contrato_insert()
RETURNS TRIGGER SECURITY DEFINER AS $$
BEGIN
  INSERT INTO feed_items (titulo, tipo, link_tab)
  VALUES (
    '📋 Novo contrato cadastrado: ' || COALESCE(NEW.numero_contrato, '') ||
    CASE WHEN NEW.fornecedor IS NOT NULL THEN ' – ' || NEW.fornecedor ELSE '' END,
    'contratos',
    'contratos'
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS tg_notify_contrato_insert ON contratos_scon;
CREATE TRIGGER tg_notify_contrato_insert
  AFTER INSERT ON contratos_scon
  FOR EACH ROW EXECUTE FUNCTION fn_notify_contrato_insert();

-- ── Novo processo ────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION fn_notify_processo_insert()
RETURNS TRIGGER SECURITY DEFINER AS $$
BEGIN
  INSERT INTO feed_items (titulo, tipo, link_tab)
  VALUES (
    '⚖️ Novo processo publicado: ' || COALESCE(NEW.modalidade, '') || ' ' || COALESCE(NEW.numero_processo, '') ||
    CASE WHEN NEW.objeto IS NOT NULL THEN E'\n' || left(NEW.objeto, 120) ELSE '' END,
    'processos',
    'processos'
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS tg_notify_processo_insert ON processos_licitatorios;
CREATE TRIGGER tg_notify_processo_insert
  AFTER INSERT ON processos_licitatorios
  FOR EACH ROW EXECUTE FUNCTION fn_notify_processo_insert();
