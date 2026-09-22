-- Tabela de notificações por usuário
CREATE TABLE IF NOT EXISTS user_notifications (
  id         uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id    uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  tipo       text NOT NULL,
  ref_id     text NOT NULL,
  ref_label  text,
  mensagem   text NOT NULL,
  lida       boolean DEFAULT false,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE user_notifications ENABLE ROW LEVEL SECURITY;
CREATE POLICY "user_notif_all" ON user_notifications FOR ALL USING (auth.uid() = user_id);

-- ── Trigger: contratos_scon ──────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION fn_notify_contrato_change()
RETURNS TRIGGER SECURITY DEFINER AS $$
BEGIN
  IF OLD.fiscal        IS DISTINCT FROM NEW.fiscal        OR
     OLD.status        IS DISTINCT FROM NEW.status        OR
     OLD.data_final    IS DISTINCT FROM NEW.data_final    OR
     OLD.saldo         IS DISTINCT FROM NEW.saldo         OR
     OLD.vl_a_empenhar IS DISTINCT FROM NEW.vl_a_empenhar THEN

    INSERT INTO user_notifications (user_id, tipo, ref_id, ref_label, mensagem)
    SELECT
      ua.user_id,
      'contrato',
      ua.ref_id,
      ua.ref_label,
      'Contrato ' || COALESCE(NEW.numero_contrato, ua.ref_label, '') || ' foi atualizado'
    FROM user_acompanhamentos ua
    WHERE ua.tipo = 'contrato' AND ua.ref_id = NEW.id::text;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS tg_notify_contrato ON contratos_scon;
CREATE TRIGGER tg_notify_contrato
  AFTER UPDATE ON contratos_scon
  FOR EACH ROW EXECUTE FUNCTION fn_notify_contrato_change();

-- ── Trigger: processos_licitatorios ─────────────────────────────────────────
CREATE OR REPLACE FUNCTION fn_notify_processo_change()
RETURNS TRIGGER SECURITY DEFINER AS $$
BEGIN
  IF OLD.situacao_api       IS DISTINCT FROM NEW.situacao_api       OR
     OLD.valor_homologado   IS DISTINCT FROM NEW.valor_homologado   OR
     OLD.homologado_manual  IS DISTINCT FROM NEW.homologado_manual  THEN

    INSERT INTO user_notifications (user_id, tipo, ref_id, ref_label, mensagem)
    SELECT
      ua.user_id,
      'processo',
      ua.ref_id,
      ua.ref_label,
      'Processo ' || COALESCE(NEW.numero_processo, ua.ref_label, '') || ' foi atualizado'
    FROM user_acompanhamentos ua
    WHERE ua.tipo = 'processo' AND ua.ref_id = NEW.id::text;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS tg_notify_processo ON processos_licitatorios;
CREATE TRIGGER tg_notify_processo
  AFTER UPDATE ON processos_licitatorios
  FOR EACH ROW EXECUTE FUNCTION fn_notify_processo_change();

-- ── Trigger: indicadores_lotacao ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION fn_notify_indicador_change()
RETURNS TRIGGER SECURITY DEFINER AS $$
BEGIN
  IF OLD.dotacao    IS DISTINCT FROM NEW.dotacao    OR
     OLD.utilizacao IS DISTINCT FROM NEW.utilizacao OR
     OLD.saldo      IS DISTINCT FROM NEW.saldo      THEN

    INSERT INTO user_notifications (user_id, tipo, ref_id, ref_label, mensagem)
    SELECT
      ua.user_id,
      'indicador',
      ua.ref_id,
      ua.ref_label,
      'Indicador ' || COALESCE(NEW.conta_corrente, ua.ref_label, '') || ' foi atualizado'
    FROM user_acompanhamentos ua
    WHERE ua.tipo = 'indicador' AND ua.ref_id = NEW.id::text;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS tg_notify_indicador ON indicadores_lotacao;
CREATE TRIGGER tg_notify_indicador
  AFTER UPDATE ON indicadores_lotacao
  FOR EACH ROW EXECUTE FUNCTION fn_notify_indicador_change();
