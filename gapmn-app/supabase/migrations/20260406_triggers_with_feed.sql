-- Reescreve os triggers para também inserir em feed_items (público)
-- e com mensagens descritivas do que foi alterado

-- ── Contrato ─────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION fn_notify_contrato_change()
RETURNS TRIGGER SECURITY DEFINER AS $$
DECLARE
  msgs      text[] := ARRAY[]::text[];
  msg_final text;
BEGIN
  IF OLD.fiscal        IS DISTINCT FROM NEW.fiscal        THEN
    msgs := array_append(msgs, 'Fiscal: ' || COALESCE(NEW.fiscal, '(removido)'));
  END IF;
  IF OLD.status        IS DISTINCT FROM NEW.status        THEN
    msgs := array_append(msgs, 'Status: ' || COALESCE(NEW.status, '(atualizado)'));
  END IF;
  IF OLD.data_final    IS DISTINCT FROM NEW.data_final    THEN
    msgs := array_append(msgs, 'Vigência alterada');
  END IF;
  IF OLD.saldo         IS DISTINCT FROM NEW.saldo         THEN
    msgs := array_append(msgs, 'A Liquidar atualizado');
  END IF;
  IF OLD.vl_a_empenhar IS DISTINCT FROM NEW.vl_a_empenhar THEN
    msgs := array_append(msgs, 'A Empenhar atualizado');
  END IF;

  IF array_length(msgs, 1) IS NULL THEN
    RETURN NEW;
  END IF;

  msg_final := 'Contrato ' || COALESCE(NEW.numero_contrato, '') || ' – ' || array_to_string(msgs, ' · ');

  -- Feed público
  INSERT INTO feed_items (titulo, tipo, link_tab)
  VALUES (msg_final, 'contratos', 'contratos');

  -- Notificações dos usuários que acompanham
  INSERT INTO user_notifications (user_id, tipo, ref_id, ref_label, mensagem)
  SELECT ua.user_id, 'contrato', ua.ref_id, ua.ref_label, msg_final
  FROM user_acompanhamentos ua
  WHERE ua.tipo = 'contrato' AND ua.ref_id = NEW.id::text;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS tg_notify_contrato ON contratos_scon;
CREATE TRIGGER tg_notify_contrato
  AFTER UPDATE ON contratos_scon
  FOR EACH ROW EXECUTE FUNCTION fn_notify_contrato_change();

-- ── Processo ──────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION fn_notify_processo_change()
RETURNS TRIGGER SECURITY DEFINER AS $$
DECLARE
  msgs      text[] := ARRAY[]::text[];
  msg_final text;
BEGIN
  IF OLD.situacao_api      IS DISTINCT FROM NEW.situacao_api      THEN
    msgs := array_append(msgs, 'Situação: ' || COALESCE(NEW.situacao_api, '(atualizada)'));
  END IF;
  IF OLD.valor_homologado  IS DISTINCT FROM NEW.valor_homologado  THEN
    msgs := array_append(msgs, 'Valor Homologado atualizado');
  END IF;
  IF OLD.homologado_manual IS DISTINCT FROM NEW.homologado_manual THEN
    msgs := array_append(msgs, 'Marcado como homologado manualmente');
  END IF;

  IF array_length(msgs, 1) IS NULL THEN
    RETURN NEW;
  END IF;

  msg_final := 'Processo ' || COALESCE(NEW.numero_processo, '') || ' – ' || array_to_string(msgs, ' · ');

  INSERT INTO feed_items (titulo, tipo, link_tab)
  VALUES (msg_final, 'processos', 'processos');

  INSERT INTO user_notifications (user_id, tipo, ref_id, ref_label, mensagem)
  SELECT ua.user_id, 'processo', ua.ref_id, ua.ref_label, msg_final
  FROM user_acompanhamentos ua
  WHERE ua.tipo = 'processo' AND ua.ref_id = NEW.id::text;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS tg_notify_processo ON processos_licitatorios;
CREATE TRIGGER tg_notify_processo
  AFTER UPDATE ON processos_licitatorios
  FOR EACH ROW EXECUTE FUNCTION fn_notify_processo_change();

-- ── Indicador ────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION fn_notify_indicador_change()
RETURNS TRIGGER SECURITY DEFINER AS $$
DECLARE
  msgs      text[] := ARRAY[]::text[];
  msg_final text;
BEGIN
  IF OLD.dotacao    IS DISTINCT FROM NEW.dotacao    THEN
    msgs := array_append(msgs, 'Dotação atualizada');
  END IF;
  IF OLD.utilizacao IS DISTINCT FROM NEW.utilizacao THEN
    msgs := array_append(msgs, 'Utilização atualizada');
  END IF;
  IF OLD.saldo      IS DISTINCT FROM NEW.saldo      THEN
    msgs := array_append(msgs, 'Saldo atualizado');
  END IF;

  IF array_length(msgs, 1) IS NULL THEN
    RETURN NEW;
  END IF;

  msg_final := 'Indicador ' || COALESCE(NEW.conta_corrente, '') || ' – ' || array_to_string(msgs, ' · ');

  INSERT INTO feed_items (titulo, tipo, link_tab)
  VALUES (msg_final, 'indicadores', 'indicadores');

  INSERT INTO user_notifications (user_id, tipo, ref_id, ref_label, mensagem)
  SELECT ua.user_id, 'indicador', ua.ref_id, ua.ref_label, msg_final
  FROM user_acompanhamentos ua
  WHERE ua.tipo = 'indicador' AND ua.ref_id = NEW.id::text;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS tg_notify_indicador ON indicadores_lotacao;
CREATE TRIGGER tg_notify_indicador
  AFTER UPDATE ON indicadores_lotacao
  FOR EACH ROW EXECUTE FUNCTION fn_notify_indicador_change();
