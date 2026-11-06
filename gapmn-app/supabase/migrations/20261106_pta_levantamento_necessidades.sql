-- Levantamento do PTA: "Lista de necessidades", terceira opção do formulário, ao lado de projeto e atividade.
-- É o material ou serviço que a seção precisa incluir no PTA e que não faz parte de nenhum projeto ou atividade.
-- Fica na mesma tabela: tipo = 'necessidade', uma linha por lista, com os itens em `etapas`. Aqui a seção é obrigatória.
-- Só acrescenta: o que já foi cadastrado não muda. Depende de 20261104_pta_levantamento.sql.

ALTER TABLE public.pta_lev_itens DROP CONSTRAINT IF EXISTS pta_lev_itens_tipo_check;
ALTER TABLE public.pta_lev_itens ADD CONSTRAINT pta_lev_itens_tipo_check CHECK (tipo IN ('projeto', 'atividade', 'necessidade'));

CREATE OR REPLACE FUNCTION public.pta_lev_salvar(p_token text, p_chave text, p_id uuid, p_item jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  c public.pta_lev_campanhas;
  v_dono text := public.pta_lev_dono(p_chave);
  v_tipo text := p_item->>'tipo';
  v_setor text := btrim(coalesce(p_item->>'setor', ''));
  v_secao text := nullif(btrim(coalesce(p_item->>'secao', '')), '');
  v_nome text := btrim(coalesce(p_item->>'nome', ''));
  v_posto text := btrim(coalesce(p_item->>'posto', ''));
  v_guerra text := upper(btrim(coalesce(p_item->>'nome_guerra', '')));
  v_dados jsonb := coalesce(p_item->'dados', '{}'::jsonb);
  v_etapas jsonb := coalesce(p_item->'etapas', '[]'::jsonb);
  r public.pta_lev_itens;
BEGIN
  c := public.pta_lev_campanha_do_link(p_token, true);
  IF jsonb_typeof(p_item) IS DISTINCT FROM 'object' OR v_tipo IS NULL OR v_tipo NOT IN ('projeto', 'atividade', 'necessidade') THEN
    RAISE EXCEPTION 'cadastro_invalido' USING ERRCODE = '22023';
  END IF;
  IF NOT public.pta_lev_setor_valido(v_setor) THEN RAISE EXCEPTION 'setor_invalido' USING ERRCODE = '22023'; END IF;
  IF v_tipo = 'necessidade' AND v_secao IS NULL THEN RAISE EXCEPTION 'secao_obrigatoria' USING ERRCODE = '22023'; END IF;
  IF char_length(v_nome) NOT BETWEEN 3 AND 200 THEN RAISE EXCEPTION 'nome_invalido' USING ERRCODE = '22023'; END IF;
  IF char_length(v_posto) NOT BETWEEN 1 AND 30 OR char_length(v_guerra) NOT BETWEEN 2 AND 40 THEN
    RAISE EXCEPTION 'identificacao_incompleta' USING ERRCODE = '22023';
  END IF;
  IF jsonb_typeof(v_dados) <> 'object' OR pg_column_size(v_dados) > 32768
     OR jsonb_typeof(v_etapas) <> 'array' OR jsonb_array_length(v_etapas) > 80 OR pg_column_size(v_etapas) > 65536 THEN
    RAISE EXCEPTION 'cadastro_grande_demais' USING ERRCODE = '22023';
  END IF;

  IF p_id IS NULL THEN
    IF (SELECT count(*) FROM public.pta_lev_itens WHERE ano = c.ano AND dono = v_dono AND excluido_em IS NULL) >= 60 THEN
      RAISE EXCEPTION 'muitos_cadastros' USING ERRCODE = 'P0001';
    END IF;
    INSERT INTO public.pta_lev_itens (ano, tipo, setor, secao, nome, posto, nome_guerra, dados, etapas, dono)
    VALUES (c.ano, v_tipo, v_setor, left(v_secao, 120), v_nome, v_posto, v_guerra, v_dados, v_etapas, v_dono)
    RETURNING * INTO r;
  ELSE
    UPDATE public.pta_lev_itens SET tipo = v_tipo, setor = v_setor, secao = left(v_secao, 120), nome = v_nome,
      posto = v_posto, nome_guerra = v_guerra, dados = v_dados, etapas = v_etapas, atualizado_em = now(), versao = versao + 1
     WHERE id = p_id AND ano = c.ano AND dono = v_dono AND excluido_em IS NULL
    RETURNING * INTO r;
    IF NOT FOUND THEN RAISE EXCEPTION 'cadastro_nao_encontrado' USING ERRCODE = 'P0001'; END IF;
  END IF;
  RETURN public.pta_lev_json(r);
END;
$$;
