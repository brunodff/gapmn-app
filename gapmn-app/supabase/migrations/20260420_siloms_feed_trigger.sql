-- INSERT trigger: cria feed_item quando novas solicitações chegam (dedup 5 min)
CREATE OR REPLACE FUNCTION fn_siloms_feed_insert()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_id uuid;
BEGIN
  SELECT id INTO v_id FROM feed_items
  WHERE tipo = 'solicitacao' AND created_at > now() - interval '5 minutes'
  ORDER BY created_at DESC LIMIT 1;

  IF v_id IS NOT NULL THEN
    UPDATE feed_items
    SET titulo = titulo || E'\n• ' || NEW.solicitacao
             || COALESCE(' (' || NEW.empenho_siafi || ')', '')
    WHERE id = v_id;
  ELSE
    INSERT INTO feed_items (titulo, tipo, link_tab) VALUES (
      '📥 Novas solicitações SILOMS:' || E'\n• ' || NEW.solicitacao
        || COALESCE(' (' || NEW.empenho_siafi || ')', ''),
      'solicitacao',
      'empenhos'
    );
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_siloms_feed_insert ON siloms_solicitacoes_empenho;
CREATE TRIGGER trg_siloms_feed_insert
  AFTER INSERT ON siloms_solicitacoes_empenho
  FOR EACH ROW EXECUTE FUNCTION fn_siloms_feed_insert();

-- Redefine fn_notify_siloms_change para também inserir no feed geral
CREATE OR REPLACE FUNCTION fn_notify_siloms_change()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_msg text;
BEGIN
  IF (OLD.empenho_siafi  IS DISTINCT FROM NEW.empenho_siafi  OR
      OLD.oc_gerada      IS DISTINCT FROM NEW.oc_gerada      OR
      OLD.perfil_atual   IS DISTINCT FROM NEW.perfil_atual   OR
      OLD.status         IS DISTINCT FROM NEW.status         OR
      OLD.responsavel    IS DISTINCT FROM NEW.responsavel) THEN

    v_msg :=
      CASE
        WHEN OLD.empenho_siafi IS DISTINCT FROM NEW.empenho_siafi
          THEN '💰 NE SIAFI gerada: ' || COALESCE(NEW.empenho_siafi,'–')
        WHEN OLD.oc_gerada IS DISTINCT FROM NEW.oc_gerada
          THEN '✅ OC SILOMS: ' || COALESCE(NEW.oc_gerada,'–')
        WHEN OLD.perfil_atual IS DISTINCT FROM NEW.perfil_atual
          THEN '🔄 Perfil: ' || COALESCE(OLD.perfil_atual,'–') || ' → ' || COALESCE(NEW.perfil_atual,'–')
        WHEN OLD.status IS DISTINCT FROM NEW.status
          THEN '📋 Status: ' || COALESCE(OLD.status,'–') || ' → ' || COALESCE(NEW.status,'–')
        ELSE '📝 Responsável atualizado em ' || NEW.solicitacao
      END || E'\n' || NEW.solicitacao;

    -- Notificações pessoais (seguidores)
    INSERT INTO user_notifications (user_id, tipo, ref_id, ref_label, mensagem)
    SELECT ua.user_id, 'solicitacao', NEW.solicitacao, NEW.solicitacao, v_msg
    FROM   user_acompanhamentos ua
    WHERE  ua.tipo   = 'solicitacao'
    AND    ua.ref_id = NEW.solicitacao;

    -- Feed geral
    INSERT INTO feed_items (titulo, tipo, link_tab)
    VALUES (v_msg, 'solicitacao', 'empenhos');
  END IF;
  RETURN NEW;
END;
$$;
