-- Substitui os triggers de INSERT por versão statement-level (uma entrada por importação, não por linha)

DROP TRIGGER IF EXISTS tg_notify_indicador_insert ON indicadores_lotacao;
DROP TRIGGER IF EXISTS tg_notify_contrato_insert   ON contratos_scon;
DROP TRIGGER IF EXISTS tg_notify_processo_insert   ON processos_licitatorios;

-- ── Indicadores — statement level ────────────────────────────────────────────
CREATE OR REPLACE FUNCTION fn_notify_indicador_insert_batch()
RETURNS TRIGGER SECURITY DEFINER AS $$
DECLARE
  qtd int;
BEGIN
  GET DIAGNOSTICS qtd = ROW_COUNT;
  IF qtd IS NULL OR qtd = 0 THEN qtd := 1; END IF;

  INSERT INTO feed_items (titulo, tipo, link_tab)
  VALUES (
    '📊 ' || qtd || ' indicador(es) de lotação adicionado(s) ou atualizado(s)',
    'indicadores',
    'indicadores'
  );
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER tg_notify_indicador_insert
  AFTER INSERT ON indicadores_lotacao
  FOR EACH STATEMENT EXECUTE FUNCTION fn_notify_indicador_insert_batch();

-- ── Contratos — statement level ───────────────────────────────────────────────
CREATE OR REPLACE FUNCTION fn_notify_contrato_insert_batch()
RETURNS TRIGGER SECURITY DEFINER AS $$
DECLARE
  qtd int;
BEGIN
  GET DIAGNOSTICS qtd = ROW_COUNT;
  IF qtd IS NULL OR qtd = 0 THEN qtd := 1; END IF;

  INSERT INTO feed_items (titulo, tipo, link_tab)
  VALUES (
    '📋 ' || qtd || ' contrato(s) importado(s) ou cadastrado(s)',
    'contratos',
    'contratos'
  );
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER tg_notify_contrato_insert
  AFTER INSERT ON contratos_scon
  FOR EACH STATEMENT EXECUTE FUNCTION fn_notify_contrato_insert_batch();

-- ── Processos — statement level ───────────────────────────────────────────────
CREATE OR REPLACE FUNCTION fn_notify_processo_insert_batch()
RETURNS TRIGGER SECURITY DEFINER AS $$
DECLARE
  qtd int;
BEGIN
  GET DIAGNOSTICS qtd = ROW_COUNT;
  IF qtd IS NULL OR qtd = 0 THEN qtd := 1; END IF;

  INSERT INTO feed_items (titulo, tipo, link_tab)
  VALUES (
    '⚖️ ' || qtd || ' processo(s) sincronizado(s) da API',
    'processos',
    'processos'
  );
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER tg_notify_processo_insert
  AFTER INSERT ON processos_licitatorios
  FOR EACH STATEMENT EXECUTE FUNCTION fn_notify_processo_insert_batch();
