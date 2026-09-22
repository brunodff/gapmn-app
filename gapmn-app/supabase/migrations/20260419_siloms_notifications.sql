-- 1. Permite tipo 'solicitacao' em user_acompanhamentos
ALTER TABLE user_acompanhamentos
  DROP CONSTRAINT IF EXISTS user_acompanhamentos_tipo_check;
ALTER TABLE user_acompanhamentos
  ADD CONSTRAINT user_acompanhamentos_tipo_check
  CHECK (tipo IN ('contrato','processo','empenho','indicador','solicitacao'));

-- 2. Permite tipo 'solicitacao' em user_notifications
ALTER TABLE user_notifications
  DROP CONSTRAINT IF EXISTS user_notifications_tipo_check;
ALTER TABLE user_notifications
  ADD CONSTRAINT user_notifications_tipo_check
  CHECK (tipo IN ('contrato','processo','empenho','indicador','solicitacao'));

-- 3. Função trigger: notifica acompanhadores quando siloms_solicitacoes_empenho muda
CREATE OR REPLACE FUNCTION fn_notify_siloms_change()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_msg text;
BEGIN
  -- Só dispara se houve mudança em campos relevantes
  IF (OLD.empenho_siafi  IS DISTINCT FROM NEW.empenho_siafi  OR
      OLD.oc_gerada      IS DISTINCT FROM NEW.oc_gerada      OR
      OLD.perfil_atual   IS DISTINCT FROM NEW.perfil_atual   OR
      OLD.status         IS DISTINCT FROM NEW.status         OR
      OLD.responsavel    IS DISTINCT FROM NEW.responsavel) THEN

    v_msg :=
      CASE
        WHEN OLD.empenho_siafi IS DISTINCT FROM NEW.empenho_siafi THEN
          '💰 NE SIAFI gerada: ' || COALESCE(NEW.empenho_siafi,'–')
        WHEN OLD.oc_gerada IS DISTINCT FROM NEW.oc_gerada THEN
          '✅ OC SILOMS: ' || COALESCE(NEW.oc_gerada,'–')
        WHEN OLD.perfil_atual IS DISTINCT FROM NEW.perfil_atual THEN
          '🔄 Perfil: ' || COALESCE(OLD.perfil_atual,'–') || ' → ' || COALESCE(NEW.perfil_atual,'–')
        WHEN OLD.status IS DISTINCT FROM NEW.status THEN
          '📋 Status: ' || COALESCE(OLD.status,'–') || ' → ' || COALESCE(NEW.status,'–')
        ELSE
          '📝 Responsável atualizado em ' || NEW.solicitacao
      END || E'\n' || NEW.solicitacao;

    INSERT INTO user_notifications (user_id, tipo, ref_id, ref_label, mensagem)
    SELECT ua.user_id, 'solicitacao', NEW.solicitacao, NEW.solicitacao, v_msg
    FROM   user_acompanhamentos ua
    WHERE  ua.tipo   = 'solicitacao'
    AND    ua.ref_id = NEW.solicitacao;
  END IF;
  RETURN NEW;
END;
$$;

-- 4. Cria o trigger (recria se já existir)
DROP TRIGGER IF EXISTS trg_siloms_notify ON siloms_solicitacoes_empenho;
CREATE TRIGGER trg_siloms_notify
  AFTER UPDATE ON siloms_solicitacoes_empenho
  FOR EACH ROW EXECUTE FUNCTION fn_notify_siloms_change();
