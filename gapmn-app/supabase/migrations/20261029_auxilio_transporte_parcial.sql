-- Painel do Auxílio Transporte: várias pessoas alimentam o mesmo painel (extensão sem configuração).
-- O SIGPES mostra a tabela conforme o perfil de quem está logado: um avaliador de OM não administrativa
-- vê só a própria unidade. Uma leitura assim é "parcial": atualiza o que veio e NÃO marca o resto como
-- fora da lista. Critério: a leitura trouxe menos de 90% das solicitações que estão na lista hoje.
-- Depende de 20261029_auxilio_transporte.sql.

ALTER TABLE public.at_execucoes ADD COLUMN IF NOT EXISTS parcial boolean NOT NULL DEFAULT false;

CREATE OR REPLACE FUNCTION public.at_concluir(p_chave text, p_execucao uuid, p_erro text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE e public.at_execucoes; v_sairam integer := 0; v_na_lista integer; v_parcial boolean := false;
BEGIN
  IF NOT public.at_chave_ok(p_chave, 'envio') THEN RAISE EXCEPTION 'chave_invalida' USING ERRCODE = '42501'; END IF;
  SELECT * INTO e FROM public.at_execucoes WHERE id = p_execucao AND status = 'em_andamento';
  IF NOT FOUND THEN RAISE EXCEPTION 'leitura_encerrada' USING ERRCODE = 'P0001'; END IF;

  IF p_erro IS NULL AND e.total_informado IS NOT NULL AND e.lidas < e.total_informado THEN
    p_erro := format('leitura incompleta: %s de %s', e.lidas, e.total_informado);
  END IF;
  IF p_erro IS NULL THEN
    SELECT count(*) INTO v_na_lista FROM public.at_solicitacoes WHERE NOT fora_da_lista;
    v_parcial := e.lidas < 0.9 * v_na_lista;
    IF NOT v_parcial THEN
      UPDATE public.at_solicitacoes SET fora_da_lista = true
       WHERE NOT fora_da_lista AND execucao IS DISTINCT FROM p_execucao;
      GET DIAGNOSTICS v_sairam = ROW_COUNT;
    END IF;
  END IF;
  UPDATE public.at_execucoes
     SET status = CASE WHEN p_erro IS NULL THEN 'ok' ELSE 'erro' END, concluida_em = now(),
         erro = left(p_erro, 500), parcial = v_parcial,
         sairam = CASE WHEN p_erro IS NULL AND NOT v_parcial THEN v_sairam END
   WHERE id = p_execucao RETURNING * INTO e;
  RETURN jsonb_build_object('status', e.status, 'lidas', e.lidas, 'novas', e.novas, 'alteradas', e.alteradas,
                            'sairam', e.sairam, 'parcial', e.parcial);
END;
$$;

CREATE OR REPLACE FUNCTION public.at_painel(p_codigo text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.at_chave_ok(p_codigo, 'painel') THEN RAISE EXCEPTION 'link_invalido' USING ERRCODE = '42501'; END IF;
  RETURN jsonb_build_object(
    'ok', true,
    'gerado_em', now(),
    'leituras', (SELECT coalesce(jsonb_agg(jsonb_build_object('iniciada_em', x.iniciada_em, 'concluida_em', x.concluida_em,
        'status', x.status, 'total', x.total_informado, 'lidas', x.lidas, 'novas', x.novas, 'alteradas', x.alteradas,
        'sairam', x.sairam, 'parcial', x.parcial, 'erro', x.erro) ORDER BY x.iniciada_em DESC), '[]'::jsonb)
      FROM (SELECT * FROM public.at_execucoes ORDER BY iniciada_em DESC LIMIT 30) x),
    'colunas', jsonb_build_array('id', 'solicitado', 'encaminhado', 'situacao', 'ordem', 'pg', 'om', 'nome', 'valor', 'trajetos',
                                 'tarifas', 'fora_da_lista', 'alterado_em', 'primeira_leitura', 'situacao_anterior'),
    'linhas', (SELECT coalesce(jsonb_agg(jsonb_build_array(s.id, s.solicitado, s.encaminhado, s.situacao, s.ordem, s.pg, s.om, s.nome,
        s.valor, s.trajetos, s.tarifas, s.fora_da_lista, s.alterado_em::date, s.primeira_leitura::date, s.situacao_anterior)
        ORDER BY s.solicitado DESC NULLS LAST, s.id DESC), '[]'::jsonb) FROM public.at_solicitacoes s)
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.at_concluir(text, uuid, text), public.at_painel(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.at_concluir(text, uuid, text), public.at_painel(text) TO anon, authenticated;
