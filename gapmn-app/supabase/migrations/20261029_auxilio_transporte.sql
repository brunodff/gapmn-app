-- Painel do Auxílio Transporte (solicitações lidas do SIGPES por uma extensão de navegador).
-- Dados pessoais de outra unidade: tabelas sem nenhum acesso direto (RLS sem política, sem GRANT).
-- A extensão grava só por at_iniciar / at_lote / at_concluir, com a chave de envio; o painel lê só por
-- at_painel, com o código que vai no link. As chaves ficam guardadas apenas como hash SHA-256 (at_chaves).

-- ── 1. Tabelas ──────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.at_chaves (
  hash      text        PRIMARY KEY CHECK (hash ~ '^[0-9a-f]{64}$'),
  tipo      text        NOT NULL CHECK (tipo IN ('envio', 'painel')),
  descricao text,
  criado_em timestamptz NOT NULL DEFAULT now(),
  ativo     boolean     NOT NULL DEFAULT true
);

CREATE TABLE IF NOT EXISTS public.at_execucoes (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  iniciada_em     timestamptz NOT NULL DEFAULT now(),
  concluida_em    timestamptz,
  status          text        NOT NULL DEFAULT 'em_andamento' CHECK (status IN ('em_andamento', 'ok', 'erro')),
  total_informado integer,
  lidas           integer     NOT NULL DEFAULT 0,
  novas           integer     NOT NULL DEFAULT 0,
  alteradas       integer     NOT NULL DEFAULT 0,
  sairam          integer,
  versao          text,
  erro            text
);

CREATE TABLE IF NOT EXISTS public.at_solicitacoes (
  id                bigint      PRIMARY KEY,           -- id da solicitação no SIGPES
  solicitado        date,
  encaminhado       date,
  situacao          text,
  ordem             text,                              -- Nº de ordem do militar
  pg                text,
  om                text,
  nome              text,                              -- nome de guerra
  valor             numeric(14, 2),
  trajetos          integer,
  tarifas           text,
  primeira_leitura  timestamptz NOT NULL DEFAULT now(),
  ultima_leitura    timestamptz NOT NULL DEFAULT now(),
  alterado_em       timestamptz,                       -- última vez que situação, valor, encaminhamento ou trajetos mudaram
  situacao_anterior text,
  execucao          uuid,
  fora_da_lista     boolean     NOT NULL DEFAULT false -- não veio na última leitura completa
);
CREATE INDEX IF NOT EXISTS at_solicitacoes_execucao ON public.at_solicitacoes (execucao);

ALTER TABLE public.at_chaves ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.at_execucoes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.at_solicitacoes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.at_chaves, public.at_execucoes, public.at_solicitacoes FROM PUBLIC, anon, authenticated;

-- ── 2. Funções ──────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.at_chave_ok(p_chave text, p_tipo text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, extensions AS $$
  SELECT p_chave IS NOT NULL AND char_length(p_chave) BETWEEN 20 AND 200 AND EXISTS (
    SELECT 1 FROM public.at_chaves
     WHERE tipo = p_tipo AND ativo AND hash = encode(extensions.digest(p_chave, 'sha256'), 'hex'))
$$;

-- Abre uma leitura. Uma leitura largada no meio há mais de uma hora vira erro.
CREATE OR REPLACE FUNCTION public.at_iniciar(p_chave text, p_total integer, p_versao text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id uuid;
BEGIN
  IF NOT public.at_chave_ok(p_chave, 'envio') THEN RAISE EXCEPTION 'chave_invalida' USING ERRCODE = '42501'; END IF;
  IF p_total IS NOT NULL AND (p_total < 0 OR p_total > 500000) THEN RAISE EXCEPTION 'total_invalido' USING ERRCODE = '22023'; END IF;
  UPDATE public.at_execucoes SET status = 'erro', concluida_em = now(), erro = 'leitura interrompida'
   WHERE status = 'em_andamento' AND iniciada_em < now() - interval '1 hour';
  INSERT INTO public.at_execucoes (total_informado, versao) VALUES (p_total, left(p_versao, 40)) RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

-- Grava um lote: [[id, solicitado, encaminhado, situacao, ordem, pg, om, nome, valor, trajetos, tarifas], ...]
CREATE OR REPLACE FUNCTION public.at_lote(p_chave text, p_execucao uuid, p_linhas jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_novas integer := 0; v_alteradas integer := 0; v_total integer := 0;
BEGIN
  IF NOT public.at_chave_ok(p_chave, 'envio') THEN RAISE EXCEPTION 'chave_invalida' USING ERRCODE = '42501'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.at_execucoes WHERE id = p_execucao AND status = 'em_andamento') THEN
    RAISE EXCEPTION 'leitura_encerrada' USING ERRCODE = 'P0001';
  END IF;
  IF jsonb_typeof(p_linhas) <> 'array' OR jsonb_array_length(p_linhas) > 2000 THEN
    RAISE EXCEPTION 'lote_invalido' USING ERRCODE = '22023';
  END IF;

  WITH entrada AS (
    SELECT (e->>0)::bigint AS id,
           CASE WHEN e->>1 ~ '^\d{4}-\d{2}-\d{2}$' THEN (e->>1)::date END AS solicitado,
           CASE WHEN e->>2 ~ '^\d{4}-\d{2}-\d{2}$' THEN (e->>2)::date END AS encaminhado,
           left(nullif(btrim(e->>3), ''), 60) AS situacao,
           left(nullif(btrim(e->>4), ''), 30) AS ordem,
           left(nullif(btrim(e->>5), ''), 20) AS pg,
           left(nullif(btrim(e->>6), ''), 80) AS om,
           left(nullif(btrim(e->>7), ''), 80) AS nome,
           CASE WHEN e->>8 ~ '^-?\d{1,12}(\.\d+)?$' THEN round((e->>8)::numeric, 2) END AS valor,
           CASE WHEN e->>9 ~ '^\d{1,6}$' THEN (e->>9)::integer END AS trajetos,
           left(nullif(btrim(e->>10), ''), 200) AS tarifas
      FROM jsonb_array_elements(p_linhas) e
     WHERE jsonb_typeof(e) = 'array' AND e->>0 ~ '^\d{1,15}$'
  ), gravado AS (
    INSERT INTO public.at_solicitacoes AS s (id, solicitado, encaminhado, situacao, ordem, pg, om, nome, valor, trajetos, tarifas,
                                            execucao, ultima_leitura, fora_da_lista)
    SELECT DISTINCT ON (id) id, solicitado, encaminhado, situacao, ordem, pg, om, nome, valor, trajetos, tarifas, p_execucao, now(), false
      FROM entrada ORDER BY id
    ON CONFLICT (id) DO UPDATE SET
      alterado_em = CASE WHEN (s.situacao, s.valor, s.encaminhado, s.trajetos)
                              IS DISTINCT FROM (EXCLUDED.situacao, EXCLUDED.valor, EXCLUDED.encaminhado, EXCLUDED.trajetos)
                         THEN now() ELSE s.alterado_em END,
      situacao_anterior = CASE WHEN s.situacao IS DISTINCT FROM EXCLUDED.situacao THEN s.situacao ELSE s.situacao_anterior END,
      solicitado = EXCLUDED.solicitado, encaminhado = EXCLUDED.encaminhado, situacao = EXCLUDED.situacao,
      ordem = EXCLUDED.ordem, pg = EXCLUDED.pg, om = EXCLUDED.om, nome = EXCLUDED.nome, valor = EXCLUDED.valor,
      trajetos = EXCLUDED.trajetos, tarifas = EXCLUDED.tarifas,
      execucao = EXCLUDED.execucao, ultima_leitura = now(), fora_da_lista = false
    -- now() é o mesmo em toda a transação: alterado_em = now() quer dizer "mudou neste lote"
    RETURNING (xmax = 0) AS nova, (alterado_em IS NOT NULL AND alterado_em = now()) AS alterada
  )
  SELECT count(*) FILTER (WHERE nova), count(*) FILTER (WHERE NOT nova AND alterada), count(*)
    INTO v_novas, v_alteradas, v_total FROM gravado;

  UPDATE public.at_execucoes SET lidas = lidas + v_total, novas = novas + v_novas, alteradas = alteradas + v_alteradas
   WHERE id = p_execucao;
  RETURN jsonb_build_object('gravadas', v_total, 'novas', v_novas, 'alteradas', v_alteradas);
END;
$$;

-- Fecha a leitura. Completa (sem erro): o que não veio desta vez fica marcado "fora da lista".
CREATE OR REPLACE FUNCTION public.at_concluir(p_chave text, p_execucao uuid, p_erro text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE e public.at_execucoes; v_sairam integer := 0;
BEGIN
  IF NOT public.at_chave_ok(p_chave, 'envio') THEN RAISE EXCEPTION 'chave_invalida' USING ERRCODE = '42501'; END IF;
  SELECT * INTO e FROM public.at_execucoes WHERE id = p_execucao AND status = 'em_andamento';
  IF NOT FOUND THEN RAISE EXCEPTION 'leitura_encerrada' USING ERRCODE = 'P0001'; END IF;

  IF p_erro IS NULL AND e.total_informado IS NOT NULL AND e.lidas < e.total_informado THEN
    p_erro := format('leitura incompleta: %s de %s', e.lidas, e.total_informado);
  END IF;
  IF p_erro IS NULL THEN
    UPDATE public.at_solicitacoes SET fora_da_lista = true
     WHERE NOT fora_da_lista AND execucao IS DISTINCT FROM p_execucao;
    GET DIAGNOSTICS v_sairam = ROW_COUNT;
  END IF;
  UPDATE public.at_execucoes
     SET status = CASE WHEN p_erro IS NULL THEN 'ok' ELSE 'erro' END, concluida_em = now(),
         erro = left(p_erro, 500), sairam = CASE WHEN p_erro IS NULL THEN v_sairam END
   WHERE id = p_execucao RETURNING * INTO e;
  RETURN jsonb_build_object('status', e.status, 'lidas', e.lidas, 'novas', e.novas, 'alteradas', e.alteradas, 'sairam', e.sairam);
END;
$$;

-- O painel: as solicitações (em listas, para o JSON sair menor) e o histórico das leituras.
CREATE OR REPLACE FUNCTION public.at_painel(p_codigo text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.at_chave_ok(p_codigo, 'painel') THEN RAISE EXCEPTION 'link_invalido' USING ERRCODE = '42501'; END IF;
  RETURN jsonb_build_object(
    'ok', true,
    'gerado_em', now(),
    'leituras', (SELECT coalesce(jsonb_agg(jsonb_build_object('iniciada_em', x.iniciada_em, 'concluida_em', x.concluida_em,
        'status', x.status, 'total', x.total_informado, 'lidas', x.lidas, 'novas', x.novas, 'alteradas', x.alteradas,
        'sairam', x.sairam, 'erro', x.erro) ORDER BY x.iniciada_em DESC), '[]'::jsonb)
      FROM (SELECT * FROM public.at_execucoes ORDER BY iniciada_em DESC LIMIT 30) x),
    'colunas', jsonb_build_array('id', 'solicitado', 'encaminhado', 'situacao', 'ordem', 'pg', 'om', 'nome', 'valor', 'trajetos',
                                 'tarifas', 'fora_da_lista', 'alterado_em', 'primeira_leitura', 'situacao_anterior'),
    'linhas', (SELECT coalesce(jsonb_agg(jsonb_build_array(s.id, s.solicitado, s.encaminhado, s.situacao, s.ordem, s.pg, s.om, s.nome,
        s.valor, s.trajetos, s.tarifas, s.fora_da_lista, s.alterado_em::date, s.primeira_leitura::date, s.situacao_anterior)
        ORDER BY s.solicitado DESC NULLS LAST, s.id DESC), '[]'::jsonb) FROM public.at_solicitacoes s)
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.at_chave_ok(text, text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.at_iniciar(text, integer, text), public.at_lote(text, uuid, jsonb),
  public.at_concluir(text, uuid, text), public.at_painel(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.at_iniciar(text, integer, text), public.at_lote(text, uuid, jsonb),
  public.at_concluir(text, uuid, text), public.at_painel(text) TO anon, authenticated;

-- As chaves (envio e painel) não ficam neste arquivo: o repositório é público. Inserir só o hash:
--   INSERT INTO public.at_chaves (hash, tipo, descricao) VALUES (encode(extensions.digest('<chave>', 'sha256'), 'hex'), 'envio', '...');
