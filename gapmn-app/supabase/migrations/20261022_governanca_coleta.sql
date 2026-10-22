-- Coleta mensal dos indicadores de desempenho (substitui a planilha de preenchimento das divisões).
-- O formulário abre por link, sem login, como um Google Forms: toda gravação passa por funções que
-- conferem o código do link da competência aberta. ADMIN e DEV leem tudo e abrem/fecham a competência.
-- O Painel de Governança passa a ler daqui (gov_bd), no mesmo formato da antiga aba BD da planilha.
-- Depende de 20261021_pta_minuta.sql (eh_admin_ou_dev).

-- ── 1. Catálogo de indicadores ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.gov_indicadores (
  id         text    PRIMARY KEY CHECK (id ~ '^[0-9]+(\.[0-9]+)?$'),
  divisao    text    NOT NULL,
  categoria  text    NOT NULL,
  indicador  text    NOT NULL,
  unidade    text    NOT NULL,
  formula    text    NOT NULL DEFAULT '',
  -- como o resultado sai das variáveis (espelho de src/lib/governanca/formulas.ts)
  calculo    text    NOT NULL CHECK (calculo IN ('razao', 'percentual', 'disponibilidade', 'variacao', 'taxa_ajustada', 'direto')),
  variaveis  jsonb   NOT NULL DEFAULT '[]'::jsonb,   -- nomes das variáveis, na ordem v1, v2, v3
  meta_txt   text,
  meta_num   numeric,
  direcao    text    NOT NULL CHECK (direcao IN ('Maior é melhor', 'Menor é melhor', 'Monitoramento')),
  planejado  boolean NOT NULL DEFAULT false,         -- além do Realizado, tem linha Planejado (PCA)
  ordem      integer NOT NULL,
  ativo      boolean NOT NULL DEFAULT true
);

-- ── 2. Competências (mês a que os dados se referem) ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.gov_competencias (
  codigo     text        PRIMARY KEY CHECK (codigo ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),  -- '2026-09'; JAN-JUN/26 = '2026-06' semestral
  rotulo     text        NOT NULL,                                                   -- 'SET/26', 'JAN-JUN/26'
  semestral  boolean     NOT NULL DEFAULT false,
  token      text        UNIQUE CHECK (token IS NULL OR char_length(token) >= 20),   -- código do link do formulário
  aberta     boolean     NOT NULL DEFAULT false,
  prazo      date,
  origem     text        NOT NULL DEFAULT 'formulario' CHECK (origem IN ('formulario', 'planilha')),
  aberta_por uuid        REFERENCES public.profiles(id),
  aberta_em  timestamptz,
  fechada_em timestamptz
);
-- uma competência aberta por vez
CREATE UNIQUE INDEX IF NOT EXISTS gov_competencias_uma_aberta ON public.gov_competencias (aberta) WHERE aberta;

-- ── 3. Lançamentos (um por indicador, competência e tipo) ───────────────────────────────────
CREATE TABLE IF NOT EXISTS public.gov_lancamentos (
  competencia  text        NOT NULL REFERENCES public.gov_competencias(codigo),
  indicador_id text        NOT NULL REFERENCES public.gov_indicadores(id),
  tipo         text        NOT NULL DEFAULT 'Realizado' CHECK (tipo IN ('Realizado', 'Planejado')),
  v1           numeric,
  v2           numeric,
  v3           numeric,
  valor        numeric,                                -- calculado no banco (gov_calcular), nunca pelo navegador
  comentario   text        CHECK (char_length(comentario) <= 2000),
  anexo        text        CHECK (anexo IS NULL OR anexo ~ '^[0-9]{4}-[0-9]{2}/[0-9a-f-]{36}\.(png|jpg|jpeg|webp|pdf)$'),
  anexo_nome   text        CHECK (char_length(anexo_nome) <= 200),
  posto        text        CHECK (char_length(posto) <= 30),
  nome_guerra  text        CHECK (char_length(nome_guerra) <= 40),
  divisao      text,
  atualizado_em timestamptz NOT NULL DEFAULT now(),
  versao       integer     NOT NULL DEFAULT 1,
  PRIMARY KEY (competencia, indicador_id, tipo)
);

-- ── 4. Histórico de alterações (quem mudou o quê, inclusive antes de "ficar bom") ────────────
CREATE TABLE IF NOT EXISTS public.gov_historico (
  id           bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  competencia  text        NOT NULL,
  indicador_id text        NOT NULL,
  tipo         text        NOT NULL,
  antes        jsonb,
  depois       jsonb,
  posto        text,
  nome_guerra  text,
  quando       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS gov_historico_comp ON public.gov_historico (competencia, indicador_id, quando);

CREATE OR REPLACE FUNCTION public.gov_registra_historico()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  a jsonb := CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE jsonb_build_object('v1', OLD.v1, 'v2', OLD.v2, 'v3', OLD.v3, 'valor', OLD.valor, 'comentario', OLD.comentario, 'anexo_nome', OLD.anexo_nome) END;
  d jsonb := jsonb_build_object('v1', NEW.v1, 'v2', NEW.v2, 'v3', NEW.v3, 'valor', NEW.valor, 'comentario', NEW.comentario, 'anexo_nome', NEW.anexo_nome);
BEGIN
  -- a importação do histórico da planilha não entra como alteração
  IF current_setting('gov.importando', true) = 'sim' THEN RETURN NEW; END IF;
  IF a IS NOT DISTINCT FROM d THEN RETURN NEW; END IF;
  INSERT INTO public.gov_historico (competencia, indicador_id, tipo, antes, depois, posto, nome_guerra)
  VALUES (NEW.competencia, NEW.indicador_id, NEW.tipo, a, d, NEW.posto, NEW.nome_guerra);
  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.gov_registra_historico() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_gov_lancamentos_historico ON public.gov_lancamentos;
CREATE TRIGGER trg_gov_lancamentos_historico AFTER INSERT OR UPDATE ON public.gov_lancamentos
  FOR EACH ROW EXECUTE FUNCTION public.gov_registra_historico();

-- ── 5. Contratos e atas essenciais (checklist da DOC) ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.gov_contratos_padrao (
  ordem   integer PRIMARY KEY,
  servico text    NOT NULL
);
INSERT INTO public.gov_contratos_padrao (ordem, servico) VALUES
  (1, 'Aquisição de Hortifrutigranjeiros'),
  (2, 'Aquisição de Industrializados e Estocáveis'),
  (3, 'Aquisição de Carnes'),
  (4, 'Aquisição de Produtos de Padaria'),
  (5, 'Contratação de Serviço de Manutenção de Equipamentos de Rancho'),
  (6, 'Almoxarifado Virtual'),
  (7, 'Contratação de Serviço de Conservação e Limpeza'),
  (8, 'Contratação de Serviço de Lavagem de Roupas de Cama'),
  (9, 'Contratação de Serviço de Impressão e Cópias'),
  (10, 'Aquisição de Material de Limpeza'),
  (11, 'Contratação de Serviço de Manutenção de Bens Imóveis'),
  (12, 'Aquisição de Material Elétrico'),
  (13, 'Aquisição de Material Hidráulico'),
  (14, 'Aquisição de Material de Alvenaria'),
  (15, 'Contratação de Serviço de Manutenção de Condicionador de Ar'),
  (16, 'Contratação de Serviço de Manutenção de Viaturas'),
  (17, 'Aquisição de Material para Manutenção de Viaturas'),
  (18, 'Contratação de Serviço de Internet e Telefonia')
ON CONFLICT (ordem) DO UPDATE SET servico = EXCLUDED.servico;

CREATE TABLE IF NOT EXISTS public.gov_contratos (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  competencia   text        NOT NULL REFERENCES public.gov_competencias(codigo),
  ordem         integer     NOT NULL,
  servico       text        NOT NULL CHECK (char_length(servico) BETWEEN 1 AND 200),
  nup           text        CHECK (char_length(nup) <= 40),
  termino       date,
  status        text        CHECK (status IN ('Seguro', 'Atenção', 'Crítico')),
  providencias  text        CHECK (char_length(providencias) <= 2000),
  padrao        boolean     NOT NULL DEFAULT false,
  posto         text,
  nome_guerra   text,
  atualizado_em timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS gov_contratos_comp ON public.gov_contratos (competencia, ordem);

-- ── 6. Anexos: depósito privado; o envio sem login só vale para um caminho autorizado ───────
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('governanca-anexos', 'governanca-anexos', false, 10485760,
        ARRAY['image/png', 'image/jpeg', 'image/webp', 'application/pdf'])
ON CONFLICT (id) DO UPDATE SET public = false, file_size_limit = EXCLUDED.file_size_limit, allowed_mime_types = EXCLUDED.allowed_mime_types;

CREATE TABLE IF NOT EXISTS public.gov_anexos_autorizados (
  caminho     text        PRIMARY KEY,
  competencia text        NOT NULL REFERENCES public.gov_competencias(codigo),
  criado_em   timestamptz NOT NULL DEFAULT now(),
  expira      timestamptz NOT NULL
);

-- ── 7. Funções ──────────────────────────────────────────────────────────────────────────────
-- Resultado do indicador a partir das variáveis. Denominador zero ou variável faltando → NULL
-- (o painel lê "denominador zero" como "sem evento no mês").
CREATE OR REPLACE FUNCTION public.gov_calcular(p_calculo text, v1 numeric, v2 numeric, v3 numeric)
RETURNS numeric LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT CASE p_calculo
    WHEN 'direto'          THEN v1
    WHEN 'razao'           THEN CASE WHEN v1 IS NULL OR v2 IS NULL OR v2 = 0 THEN NULL ELSE v1 / v2 END
    WHEN 'percentual'      THEN CASE WHEN v1 IS NULL OR v2 IS NULL OR v2 = 0 THEN NULL ELSE v1 / v2 * 100 END
    WHEN 'disponibilidade' THEN CASE WHEN v1 IS NULL OR v2 IS NULL OR v1 = 0 THEN NULL ELSE (v1 - v2) / v1 * 100 END
    -- IDs 16 e 22: a planilha grava a variação em módulo; o sentido sai de v1 (atual) × v2 (anterior)
    WHEN 'variacao'        THEN CASE WHEN v1 IS NULL OR v2 IS NULL OR v2 = 0 THEN NULL ELSE abs((v1 - v2) / v2 * 100) END
    WHEN 'taxa_ajustada'   THEN CASE WHEN v1 IS NULL OR v2 IS NULL OR v3 IS NULL OR v2 - v3 = 0 THEN NULL ELSE v1 / (v2 - v3) * 100 END
  END
$$;

-- número vindo do formulário: null, ou finito dentro de ±1e12 (texto, NaN e infinito são recusados)
CREATE OR REPLACE FUNCTION public.gov_numero(p jsonb)
RETURNS numeric LANGUAGE plpgsql IMMUTABLE SET search_path = public AS $$
DECLARE n numeric;
BEGIN
  IF p IS NULL OR jsonb_typeof(p) = 'null' THEN RETURN NULL; END IF;
  IF jsonb_typeof(p) <> 'number' THEN RAISE EXCEPTION 'valor_invalido' USING ERRCODE = '22023'; END IF;
  n := (p #>> '{}')::numeric;
  IF abs(n) > 1e12 THEN RAISE EXCEPTION 'valor_invalido' USING ERRCODE = '22023'; END IF;
  RETURN n;
END;
$$;

CREATE OR REPLACE FUNCTION public.gov_competencia_do_link(p_token text, p_exige_aberta boolean)
RETURNS public.gov_competencias LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE c public.gov_competencias;
BEGIN
  IF p_token IS NULL OR char_length(p_token) < 20 THEN RAISE EXCEPTION 'link_invalido' USING ERRCODE = 'P0001'; END IF;
  SELECT * INTO c FROM public.gov_competencias WHERE token = p_token;
  IF NOT FOUND THEN RAISE EXCEPTION 'link_invalido' USING ERRCODE = 'P0001'; END IF;
  IF p_exige_aberta AND NOT c.aberta THEN RAISE EXCEPTION 'coleta_encerrada' USING ERRCODE = 'P0001'; END IF;
  RETURN c;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.gov_competencia_do_link(text, boolean) FROM PUBLIC, anon, authenticated;

-- Contratos essenciais da competência: os dela; se ainda não houver, os da última competência
-- que tiver (para a DOC só atualizar); se nunca houve, a lista padrão.
CREATE OR REPLACE FUNCTION public.gov_contratos_da(p_codigo text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE origem text; r jsonb;
BEGIN
  SELECT CASE WHEN EXISTS (SELECT 1 FROM public.gov_contratos WHERE competencia = p_codigo) THEN p_codigo
              ELSE (SELECT max(competencia) FROM public.gov_contratos WHERE competencia < p_codigo) END
    INTO origem;
  IF origem IS NULL THEN
    SELECT coalesce(jsonb_agg(jsonb_build_object('id', NULL, 'ordem', ordem, 'servico', servico, 'nup', NULL, 'termino', NULL,
             'status', NULL, 'providencias', NULL, 'padrao', true) ORDER BY ordem), '[]'::jsonb)
      INTO r FROM public.gov_contratos_padrao;
    RETURN jsonb_build_object('origem', 'padrao', 'itens', r);
  END IF;
  SELECT coalesce(jsonb_agg(jsonb_build_object('id', CASE WHEN origem = p_codigo THEN id END, 'ordem', ordem, 'servico', servico,
           'nup', nup, 'termino', termino, 'status', status, 'providencias', providencias, 'padrao', padrao,
           'posto', posto, 'nome_guerra', nome_guerra, 'atualizado_em', atualizado_em) ORDER BY ordem), '[]'::jsonb)
    INTO r FROM public.gov_contratos WHERE competencia = origem;
  RETURN jsonb_build_object('origem', CASE WHEN origem = p_codigo THEN 'competencia' ELSE 'anterior' END, 'de', origem, 'itens', r);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.gov_contratos_da(text) FROM PUBLIC, anon, authenticated;

-- O que o formulário precisa: competência, catálogo, o que já foi lançado e os contratos da DOC.
CREATE OR REPLACE FUNCTION public.gov_formulario(p_token text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE c public.gov_competencias;
BEGIN
  c := public.gov_competencia_do_link(p_token, false);
  RETURN jsonb_build_object(
    'competencia', jsonb_build_object('codigo', c.codigo, 'rotulo', c.rotulo, 'aberta', c.aberta, 'prazo', c.prazo),
    'indicadores', (SELECT coalesce(jsonb_agg(jsonb_build_object('id', i.id, 'divisao', i.divisao, 'categoria', i.categoria,
        'indicador', i.indicador, 'unidade', i.unidade, 'formula', i.formula, 'calculo', i.calculo, 'variaveis', i.variaveis,
        'meta_txt', i.meta_txt, 'meta_num', i.meta_num, 'direcao', i.direcao, 'planejado', i.planejado, 'ordem', i.ordem)
        ORDER BY i.ordem), '[]'::jsonb) FROM public.gov_indicadores i WHERE i.ativo),
    'lancamentos', (SELECT coalesce(jsonb_agg(jsonb_build_object('indicador_id', l.indicador_id, 'tipo', l.tipo,
        'v1', l.v1, 'v2', l.v2, 'v3', l.v3, 'valor', l.valor, 'comentario', l.comentario, 'anexo_nome', l.anexo_nome,
        'tem_anexo', l.anexo IS NOT NULL, 'posto', l.posto, 'nome_guerra', l.nome_guerra, 'atualizado_em', l.atualizado_em,
        'versao', l.versao)), '[]'::jsonb) FROM public.gov_lancamentos l WHERE l.competencia = c.codigo),
    -- último valor de cada indicador antes desta competência (referência no formulário)
    'anteriores', (SELECT coalesce(jsonb_agg(jsonb_build_object('indicador_id', x.indicador_id, 'tipo', x.tipo,
        'competencia', x.competencia, 'rotulo', (SELECT k.rotulo FROM public.gov_competencias k WHERE k.codigo = x.competencia),
        'valor', x.valor, 'v1', x.v1, 'v2', x.v2)), '[]'::jsonb)
      FROM (SELECT DISTINCT ON (indicador_id, tipo) indicador_id, tipo, competencia, valor, v1, v2
              FROM public.gov_lancamentos
             WHERE competencia < c.codigo AND (valor IS NOT NULL OR v1 IS NOT NULL OR v2 IS NOT NULL)
             ORDER BY indicador_id, tipo, competencia DESC) x),
    'contratos', public.gov_contratos_da(c.codigo)
  );
END;
$$;

-- Caminho autorizado para um anexo (vale 1 hora). Só com o link da competência aberta.
CREATE OR REPLACE FUNCTION public.gov_autorizar_anexo(p_token text, p_ext text)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE c public.gov_competencias; ext text := lower(coalesce(p_ext, '')); caminho text;
BEGIN
  c := public.gov_competencia_do_link(p_token, true);
  IF ext NOT IN ('png', 'jpg', 'jpeg', 'webp', 'pdf') THEN RAISE EXCEPTION 'tipo_de_arquivo' USING ERRCODE = '22023'; END IF;
  IF (SELECT count(*) FROM public.gov_anexos_autorizados WHERE competencia = c.codigo AND criado_em > now() - interval '1 hour') >= 300 THEN
    RAISE EXCEPTION 'muitos_anexos' USING ERRCODE = 'P0001';
  END IF;
  caminho := c.codigo || '/' || gen_random_uuid()::text || '.' || ext;
  INSERT INTO public.gov_anexos_autorizados (caminho, competencia, expira) VALUES (caminho, c.codigo, now() + interval '1 hour');
  RETURN caminho;
END;
$$;

-- Usada pela política do depósito: o arquivo só entra no caminho que foi autorizado e enquanto vale.
CREATE OR REPLACE FUNCTION public.gov_anexo_autorizado(p_caminho text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.gov_anexos_autorizados a JOIN public.gov_competencias c ON c.codigo = a.competencia
     WHERE a.caminho = p_caminho AND a.expira > now() AND c.aberta)
$$;

-- Grava os indicadores de uma divisão (e, para a DOC, os contratos essenciais).
-- p_itens: [{indicador_id, tipo, v1, v2, v3, comentario, anexo, anexo_nome}] — o valor é calculado aqui.
-- p_contratos: lista completa da competência (só a DOC), ou null para não mexer.
CREATE OR REPLACE FUNCTION public.gov_salvar(
  p_token text, p_posto text, p_nome text, p_divisao text, p_itens jsonb, p_contratos jsonb DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  c public.gov_competencias;
  ind public.gov_indicadores;
  it jsonb; ct jsonb;
  v_posto text := btrim(coalesce(p_posto, ''));
  v_nome text := upper(btrim(coalesce(p_nome, '')));
  v_tipo text; a1 numeric; a2 numeric; a3 numeric; v_anexo text; v_com text; n integer := 0; nc integer := 0; v_ordem integer := 0;
BEGIN
  c := public.gov_competencia_do_link(p_token, true);
  IF char_length(v_posto) NOT BETWEEN 1 AND 30 OR char_length(v_nome) NOT BETWEEN 2 AND 40 THEN
    RAISE EXCEPTION 'identificacao_incompleta' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.gov_indicadores WHERE divisao = p_divisao AND ativo) THEN
    RAISE EXCEPTION 'divisao_invalida' USING ERRCODE = '22023';
  END IF;
  IF jsonb_typeof(coalesce(p_itens, '[]'::jsonb)) <> 'array' OR jsonb_array_length(coalesce(p_itens, '[]'::jsonb)) > 100 THEN
    RAISE EXCEPTION 'itens_invalidos' USING ERRCODE = '22023';
  END IF;

  FOR it IN SELECT * FROM jsonb_array_elements(coalesce(p_itens, '[]'::jsonb)) LOOP
    SELECT * INTO ind FROM public.gov_indicadores WHERE id = it->>'indicador_id' AND ativo;
    IF NOT FOUND OR ind.divisao <> p_divisao THEN
      RAISE EXCEPTION 'indicador_de_outra_divisao: %', it->>'indicador_id' USING ERRCODE = '22023';
    END IF;
    v_tipo := coalesce(it->>'tipo', 'Realizado');
    IF v_tipo NOT IN ('Realizado', 'Planejado') OR (v_tipo = 'Planejado' AND NOT ind.planejado) THEN
      RAISE EXCEPTION 'tipo_invalido' USING ERRCODE = '22023';
    END IF;
    a1 := public.gov_numero(it->'v1'); a2 := public.gov_numero(it->'v2'); a3 := public.gov_numero(it->'v3');
    IF ind.calculo = 'direto' THEN a2 := NULL; a3 := NULL; END IF;
    IF ind.calculo <> 'taxa_ajustada' THEN a3 := NULL; END IF;
    v_anexo := nullif(it->>'anexo', '');
    IF v_anexo IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.gov_anexos_autorizados a WHERE a.caminho = v_anexo AND a.competencia = c.codigo) THEN
      RAISE EXCEPTION 'anexo_invalido' USING ERRCODE = '22023';
    END IF;
    v_com := nullif(btrim(coalesce(it->>'comentario', '')), '');
    INSERT INTO public.gov_lancamentos AS l (competencia, indicador_id, tipo, v1, v2, v3, valor, comentario, anexo, anexo_nome,
                                             posto, nome_guerra, divisao, atualizado_em, versao)
    VALUES (c.codigo, ind.id, v_tipo, a1, a2, a3, public.gov_calcular(ind.calculo, a1, a2, a3), left(v_com, 2000), v_anexo,
            CASE WHEN v_anexo IS NULL THEN NULL ELSE left(nullif(btrim(coalesce(it->>'anexo_nome', '')), ''), 200) END,
            v_posto, v_nome, p_divisao, now(), 1)
    ON CONFLICT (competencia, indicador_id, tipo) DO UPDATE SET
      v1 = EXCLUDED.v1, v2 = EXCLUDED.v2, v3 = EXCLUDED.v3, valor = EXCLUDED.valor, comentario = EXCLUDED.comentario,
      -- sem anexo novo, fica o que já estava
      anexo = coalesce(EXCLUDED.anexo, l.anexo), anexo_nome = CASE WHEN EXCLUDED.anexo IS NULL THEN l.anexo_nome ELSE EXCLUDED.anexo_nome END,
      posto = EXCLUDED.posto, nome_guerra = EXCLUDED.nome_guerra, divisao = EXCLUDED.divisao,
      atualizado_em = now(), versao = l.versao + 1
    WHERE (l.v1, l.v2, l.v3, l.comentario) IS DISTINCT FROM (EXCLUDED.v1, EXCLUDED.v2, EXCLUDED.v3, EXCLUDED.comentario)
       OR EXCLUDED.anexo IS NOT NULL;
    n := n + 1;
  END LOOP;

  IF p_contratos IS NOT NULL THEN
    IF p_divisao <> 'DOC' THEN RAISE EXCEPTION 'contratos_so_da_doc' USING ERRCODE = '22023'; END IF;
    IF jsonb_typeof(p_contratos) <> 'array' OR jsonb_array_length(p_contratos) > 80 THEN
      RAISE EXCEPTION 'contratos_invalidos' USING ERRCODE = '22023';
    END IF;
    DELETE FROM public.gov_contratos WHERE competencia = c.codigo;
    FOR ct IN SELECT * FROM jsonb_array_elements(p_contratos) LOOP
      v_ordem := v_ordem + 1;
      IF nullif(btrim(coalesce(ct->>'servico', '')), '') IS NULL THEN CONTINUE; END IF;
      IF ct->>'status' IS NOT NULL AND ct->>'status' NOT IN ('Seguro', 'Atenção', 'Crítico') THEN
        RAISE EXCEPTION 'status_invalido' USING ERRCODE = '22023';
      END IF;
      INSERT INTO public.gov_contratos (competencia, ordem, servico, nup, termino, status, providencias, padrao, posto, nome_guerra)
      VALUES (c.codigo, v_ordem, left(btrim(ct->>'servico'), 200), left(nullif(btrim(coalesce(ct->>'nup', '')), ''), 40),
              CASE WHEN coalesce(ct->>'termino', '') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN (ct->>'termino')::date END,
              nullif(ct->>'status', ''), left(nullif(btrim(coalesce(ct->>'providencias', '')), ''), 2000),
              coalesce((ct->>'padrao')::boolean, false), v_posto, v_nome);
      nc := nc + 1;
    END LOOP;
  END IF;

  RETURN jsonb_build_object('ok', true, 'competencia', c.rotulo, 'indicadores', n, 'contratos', nc);
END;
$$;

-- ── 8. Funções de quem administra (ADMIN e DEV) ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.gov_rotulo(p_codigo text, p_semestral boolean)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT CASE WHEN p_semestral THEN 'JAN-JUN/' ELSE
    (ARRAY['JAN','FEV','MAR','ABR','MAI','JUN','JUL','AGO','SET','OUT','NOV','DEZ'])[split_part(p_codigo, '-', 2)::int] || '/' END
    || right(split_part(p_codigo, '-', 1), 2)
$$;

-- Abre a coleta de uma competência (fecha a que estiver aberta) e devolve o código do link.
CREATE OR REPLACE FUNCTION public.gov_abrir(p_codigo text, p_prazo date DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE c public.gov_competencias;
BEGIN
  IF NOT public.eh_admin_ou_dev() THEN RAISE EXCEPTION 'sem_permissao' USING ERRCODE = '42501'; END IF;
  IF p_codigo !~ '^[0-9]{4}-(0[1-9]|1[0-2])$' THEN RAISE EXCEPTION 'competencia_invalida' USING ERRCODE = '22023'; END IF;
  UPDATE public.gov_competencias SET aberta = false, fechada_em = now() WHERE aberta AND codigo <> p_codigo;
  INSERT INTO public.gov_competencias (codigo, rotulo, token, aberta, prazo, aberta_por, aberta_em)
  VALUES (p_codigo, public.gov_rotulo(p_codigo, false),
          translate(encode(extensions.gen_random_bytes(18), 'base64'), '+/=', '-_'), true, p_prazo, auth.uid(), now())
  ON CONFLICT (codigo) DO UPDATE SET aberta = true, prazo = EXCLUDED.prazo, aberta_por = auth.uid(), aberta_em = now(), fechada_em = NULL,
    token = coalesce(public.gov_competencias.token, EXCLUDED.token)
  RETURNING * INTO c;
  RETURN to_jsonb(c);
END;
$$;

CREATE OR REPLACE FUNCTION public.gov_fechar(p_codigo text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE c public.gov_competencias;
BEGIN
  IF NOT public.eh_admin_ou_dev() THEN RAISE EXCEPTION 'sem_permissao' USING ERRCODE = '42501'; END IF;
  UPDATE public.gov_competencias SET aberta = false, fechada_em = now() WHERE codigo = p_codigo RETURNING * INTO c;
  RETURN to_jsonb(c);
END;
$$;

-- Troca o código do link (o link antigo para de funcionar).
CREATE OR REPLACE FUNCTION public.gov_novo_link(p_codigo text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE c public.gov_competencias;
BEGIN
  IF NOT public.eh_admin_ou_dev() THEN RAISE EXCEPTION 'sem_permissao' USING ERRCODE = '42501'; END IF;
  UPDATE public.gov_competencias SET token = translate(encode(extensions.gen_random_bytes(18), 'base64'), '+/=', '-_')
   WHERE codigo = p_codigo RETURNING * INTO c;
  RETURN to_jsonb(c);
END;
$$;

-- O Painel de Governança lê daqui, no formato da antiga aba BD: um registro por indicador,
-- competência e tipo (com ou sem valor), mais os contratos essenciais da DOC.
CREATE OR REPLACE FUNCTION public.gov_bd()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.eh_admin_ou_dev() THEN RAISE EXCEPTION 'sem_permissao' USING ERRCODE = '42501'; END IF;
  RETURN jsonb_build_object(
    'ok', true,
    'gerado_em', to_char(now() AT TIME ZONE 'America/Manaus', 'YYYY-MM-DD"T"HH24:MI:SS'),
    'timezone', 'America/Manaus',
    'planilha', 'gapmn.app',
    'bd', (SELECT coalesce(jsonb_agg(jsonb_build_object(
        'ID', i.id, 'DIVISAO', i.divisao, 'CATEGORIA', i.categoria, 'INDICADOR', i.indicador, 'UNIDADE', i.unidade,
        'FORMULA', i.formula, 'META_TXT', i.meta_txt, 'META_NUM', i.meta_num, 'DIRECAO', i.direcao, 'TIPO', t.tipo,
        'ANO', split_part(c.codigo, '-', 1)::int, 'MES_NUM', split_part(c.codigo, '-', 2)::int,
        'MES', split_part(c.rotulo, '/', 1), 'DATA', c.codigo || '-01',
        'VALOR', l.valor,
        'VAR1_NOME', i.variaveis->>0, 'VAR1_VALOR', CASE WHEN i.calculo = 'direto' THEN NULL ELSE l.v1 END,
        'VAR2_NOME', i.variaveis->>1, 'VAR2_VALOR', l.v2,
        'VAR3_NOME', i.variaveis->>2, 'VAR3_VALOR', l.v3,
        'COMENTARIO', l.comentario, 'TEM_ANEXO', l.anexo IS NOT NULL)
        ORDER BY c.codigo, i.ordem, t.tipo DESC), '[]'::jsonb)
      FROM public.gov_competencias c
      CROSS JOIN public.gov_indicadores i
      CROSS JOIN LATERAL (SELECT 'Realizado'::text AS tipo UNION ALL SELECT 'Planejado' WHERE i.planejado) t
      LEFT JOIN public.gov_lancamentos l ON l.competencia = c.codigo AND l.indicador_id = i.id AND l.tipo = t.tipo
      WHERE i.ativo),
    'bd_integridade', '[]'::jsonb,
    'catalogo', '{}'::jsonb,
    'contratos', (SELECT coalesce(jsonb_agg(jsonb_build_object('competencia', k.competencia, 'ordem', k.ordem, 'servico', k.servico,
        'nup', k.nup, 'termino', k.termino, 'status', k.status, 'providencias', k.providencias, 'atualizado_em', k.atualizado_em)
        ORDER BY k.competencia, k.ordem), '[]'::jsonb) FROM public.gov_contratos k)
  );
END;
$$;

-- quem pode chamar o quê
REVOKE EXECUTE ON FUNCTION public.gov_formulario(text), public.gov_autorizar_anexo(text, text), public.gov_anexo_autorizado(text),
  public.gov_salvar(text, text, text, text, jsonb, jsonb), public.gov_abrir(text, date), public.gov_fechar(text),
  public.gov_novo_link(text), public.gov_bd(), public.gov_numero(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.gov_formulario(text), public.gov_autorizar_anexo(text, text), public.gov_anexo_autorizado(text),
  public.gov_salvar(text, text, text, text, jsonb, jsonb) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.gov_abrir(text, date), public.gov_fechar(text), public.gov_novo_link(text), public.gov_bd() TO authenticated;
GRANT EXECUTE ON FUNCTION public.gov_numero(jsonb) TO anon, authenticated;
-- o Supabase dá EXECUTE ao anon em toda função nova: tira das de quem administra
REVOKE EXECUTE ON FUNCTION public.gov_abrir(text, date), public.gov_fechar(text), public.gov_novo_link(text), public.gov_bd() FROM anon;

-- ── 9. RLS: ninguém grava direto; ADMIN e DEV leem ──────────────────────────────────────────
ALTER TABLE public.gov_indicadores ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.gov_competencias ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.gov_lancamentos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.gov_historico ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.gov_contratos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.gov_contratos_padrao ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.gov_anexos_autorizados ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS gov_indicadores_ler ON public.gov_indicadores;
DROP POLICY IF EXISTS gov_competencias_ler ON public.gov_competencias;
DROP POLICY IF EXISTS gov_lancamentos_ler ON public.gov_lancamentos;
DROP POLICY IF EXISTS gov_historico_ler ON public.gov_historico;
DROP POLICY IF EXISTS gov_contratos_ler ON public.gov_contratos;
DROP POLICY IF EXISTS gov_contratos_padrao_ler ON public.gov_contratos_padrao;
CREATE POLICY gov_indicadores_ler ON public.gov_indicadores FOR SELECT TO authenticated USING (public.eh_admin_ou_dev());
CREATE POLICY gov_competencias_ler ON public.gov_competencias FOR SELECT TO authenticated USING (public.eh_admin_ou_dev());
CREATE POLICY gov_lancamentos_ler ON public.gov_lancamentos FOR SELECT TO authenticated USING (public.eh_admin_ou_dev());
CREATE POLICY gov_historico_ler ON public.gov_historico FOR SELECT TO authenticated USING (public.eh_admin_ou_dev());
CREATE POLICY gov_contratos_ler ON public.gov_contratos FOR SELECT TO authenticated USING (public.eh_admin_ou_dev());
CREATE POLICY gov_contratos_padrao_ler ON public.gov_contratos_padrao FOR SELECT TO authenticated USING (public.eh_admin_ou_dev());
REVOKE ALL ON public.gov_indicadores, public.gov_competencias, public.gov_lancamentos, public.gov_historico,
  public.gov_contratos, public.gov_contratos_padrao, public.gov_anexos_autorizados FROM anon;

-- depósito: envio sem login só no caminho autorizado; leitura só ADMIN e DEV; ninguém troca nem apaga
DROP POLICY IF EXISTS gov_anexos_enviar ON storage.objects;
DROP POLICY IF EXISTS gov_anexos_ler ON storage.objects;
CREATE POLICY gov_anexos_enviar ON storage.objects FOR INSERT TO anon, authenticated
  WITH CHECK (bucket_id = 'governanca-anexos' AND public.gov_anexo_autorizado(name));
CREATE POLICY gov_anexos_ler ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'governanca-anexos' AND public.eh_admin_ou_dev());
-- quem envia sem login só "vê" o próprio arquivo enquanto o caminho vale (o envio do Storage devolve o registro)
DROP POLICY IF EXISTS gov_anexos_ver_envio ON storage.objects;
CREATE POLICY gov_anexos_ver_envio ON storage.objects FOR SELECT TO anon
  USING (bucket_id = 'governanca-anexos' AND public.gov_anexo_autorizado(name));

-- ── 10. Catálogo inicial: os 65 indicadores da planilha (Catálogo v24JUL26) ─────────────────
INSERT INTO public.gov_indicadores (id, divisao, categoria, indicador, unidade, formula, calculo, variaveis, meta_txt, meta_num, direcao, planejado, ordem) VALUES
  ('1', 'DRH', '1. GESTÃO DE PESSOAL', 'Tempo Médio de Concessão de Direitos Financeiros', 'Dias úteis', 'TR = Σ T_pub ÷ N_atos', 'razao', '["T_pub = dias corridos da solicitação à publicação","N_atos = atos publicados no período"]'::jsonb, '10 dias úteis', 10, 'Menor é melhor', false, 1),
  ('2', 'DRH', '1. GESTÃO DE PESSOAL', 'Capacidade Operacional da Concessão de Direitos Financeiros', 'Militares / Auxiliar', 'E_op = M_atendidos ÷ A_setor', 'razao', '["M_atendidos = total de militares atendidos","A_setor = nº de auxiliares do setor de administração de pessoal"]'::jsonb, '500 militares atendidos / auxiliar', 500, 'Maior é melhor', false, 2),
  ('3', 'DRH', '1. GESTÃO DE PESSOAL', 'Indicador de Execução do Plano de Capacitação', 'Percentual (%)', 'IC = (C_r ÷ C_p) × 100', 'percentual', '["C_r = cursos realizados no período","C_p = cursos previstos no plano de capacitação"]'::jsonb, '1', 100, 'Maior é melhor', false, 3),
  ('4', 'DRH', '2. FINANÇAS E PAGAMENTO DE PESSOAL', 'Tempo Médio de Processamento de Itens Financeiros', 'Dias úteis', 'TR = Σ T_p ÷ N_direitos', 'razao', '["T_p = dias (data do lançamento em contracheque − data da publicação)","N_direitos = direitos pagos"]'::jsonb, '2 dias úteis', 2, 'Menor é melhor', false, 4),
  ('5', 'DRH', '2. FINANÇAS E PAGAMENTO DE PESSOAL', 'Capacidade Operacional do Processamento de Itens Financeiros', 'Militares / Auxiliar', 'E_op = M_total ÷ A_sacadores', 'razao', '["M_total = total de militares na folha","A_sacadores = nº de auxiliares/sacadores"]'::jsonb, '400 militares atendidos / auxiliar sacador', 400, 'Maior é melhor', false, 5),
  ('6', 'DRH', '3. VETERANOS E PENSIONISTAS', 'Tempo Médio de Concessão de Auxílio-Funeral', 'Horas', 'TR = Σ T_conc ÷ N_pedidos', 'razao', '["T_conc = horas da entrada do requerimento ao repasse/ressarcimento","N_pedidos = quantidade de pedidos"]'::jsonb, '≤ 48 horas', 48, 'Menor é melhor', false, 6),
  ('7', 'DRH', '3. VETERANOS E PENSIONISTAS', 'Tempo Médio de Processamento do Requerimento de Habilitação à Pensão', 'Dias úteis', 'TR = Σ T_proc ÷ N_pensoes', 'razao', '["T_proc = dias da entrada do requerimento de habilitação até o envio à SDVP/DIRAP","N_pensoes = nº de requerimentos de pensão recebidos"]'::jsonb, '5 dias úteis', 5, 'Menor é melhor', false, 7),
  ('8', 'DRH', '3. VETERANOS E PENSIONISTAS', 'Tempo Médio de Publicação da Ordem de INSPSAU para Isenção de IR', 'Dias úteis', 'TR = Σ T_ordem ÷ N_ordens', 'razao', '["T_ordem = dias do pedido à publicação","N_ordens = ordens geradas"]'::jsonb, '5 dias úteis', 5, 'Menor é melhor', false, 8),
  ('9', 'DRH', '3. VETERANOS E PENSIONISTAS', 'Tempo Médio de Implantação de Isenção do IR', 'Dias úteis', 'TR = Σ T_ata ÷ N_atas', 'razao', '["T_ata = dias do recebimento da Ata de Inspeção até o envio da solicitação à SDPP","N_atas = atas apresentadas"]'::jsonb, '5 dias úteis', 5, 'Menor é melhor', false, 9),
  ('10', 'DRH', '3. VETERANOS E PENSIONISTAS', 'Tempo Médio de Processamento do Título de Revisão de Reforma ou Aux. Invalidez', 'Dias úteis', 'TR = Σ T_tit ÷ N_atas', 'razao', '["T_tit = dias corridos entre a entrada do novo título no GAP e o lançamento dos acertos financeiros em contracheque","N_atas = atas apresentadas"]'::jsonb, '5 dias úteis', 5, 'Menor é melhor', false, 10),
  ('11', 'DIE', '4. APOIO DE TI', 'Tempo Médio de Resolução de Chamados', 'Horas', 'TR = Σ T_atend ÷ N_chamados', 'razao', '["T_atend = horas da abertura do chamado à resolução","N_chamados = total de chamados"]'::jsonb, '≤ 24 horas', 24, 'Menor é melhor', false, 11),
  ('12', 'DIE', '4. APOIO DE TI', 'Capacidade Operacional da Resolução de Chamados', 'Homem-Hora / Chamado', 'HR = Σ HH ÷ N_chamados', 'razao', '["Σ HH = horas trabalhadas pelos técnicos","N_chamados = chamados atendidos no período"]'::jsonb, '24 horas/chamado', 24, 'Menor é melhor', false, 12),
  ('13', 'DIE', '4. APOIO DE TI', 'Disponibilidade da Rede Internet/Intraer', 'Percentual (%)', 'Disp = ((T_t − T_f) ÷ T_t) × 100', 'disponibilidade', '["T_t = tempo total programado para o período (horas)","T_f = tempo de indisponibilidade (fora do ar)"]'::jsonb, '0.99', 99, 'Maior é melhor', false, 13),
  ('14', 'DIE', '4. APOIO DE TI', 'Disponibilidade dos Sistemas Corporativos', 'Percentual (%)', 'Disp = ((T_t − T_f) ÷ T_t) × 100', 'disponibilidade', '["T_t = tempo total programado no período","T_f = tempo de indisponibilidade"]'::jsonb, '0.99', 99, 'Maior é melhor', false, 14),
  ('15', 'DIE', '4. APOIO DE TI', 'Idade Média dos Ativos de TI', 'Anos', 'IM = Σ Idade_ativo ÷ N_ativos', 'razao', '["Idade_ativo = tempo de uso de cada equipamento (anos)","N_ativos = quantidade total de ativos avaliados"]'::jsonb, '≤ 5 anos', 5, 'Menor é melhor', false, 15),
  ('16', 'DA', '5. PROTOCOLO E ARQUIVO', 'Variação Mensal de Pendência Documental', 'Percentual (%)', 'ΔD = ((D_atual − D_anterior) ÷ D_anterior) × 100', 'variacao', '["D_atual = total de pendências da OM no período atual","D_anterior = total de pendências no período anterior"]'::jsonb, '≥ 10%', 10, 'Maior é melhor', false, 16),
  ('17.1', 'AJUR', '6. INVESTIGAÇÃO E JUSTIÇA', 'Tempo Médio de Conclusão de Processos Disciplinares — PATD', 'Dias corridos', 'TR = Σ T_resp ÷ N_processos', 'razao', '["T_resp = dias da instauração até a conclusão (PATD)","N_processos = PATD concluídos"]'::jsonb, '30 dias corridos', 30, 'Menor é melhor', false, 17),
  ('17.2', 'AJUR', '6. INVESTIGAÇÃO E JUSTIÇA', 'Tempo Médio de Conclusão de Processos Disciplinares — Sindicância', 'Dias úteis', 'TR = Σ T_resp ÷ N_processos', 'razao', '["T_resp = dias da instauração até a conclusão (Sindicância)","N_processos = sindicâncias concluídas"]'::jsonb, '20 dias úteis', 20, 'Menor é melhor', false, 18),
  ('17.3', 'AJUR', '6. INVESTIGAÇÃO E JUSTIÇA', 'Tempo Médio de Conclusão de Processos Disciplinares — IPM', 'Dias corridos', 'TR = Σ T_resp ÷ N_processos', 'razao', '["T_resp = dias da instauração até a conclusão (IPM)","N_processos = IPM concluídos"]'::jsonb, '40 dias corridos', 40, 'Menor é melhor', false, 19),
  ('18', 'AJUR', '6. INVESTIGAÇÃO E JUSTIÇA', 'Taxa de Conclusão de Procedimentos Disciplinares (No Prazo)', 'Percentual (%)', 'Taxa = (P_cp ÷ (P_t − P_av)) × 100', 'taxa_ajustada', '["P_cp = processos concluídos dentro do prazo","P_t = total de processos no período","P_av = processos a vencer (prazo em curso)"]'::jsonb, '0.8', 80, 'Maior é melhor', false, 20),
  ('19', 'ASESO', '7. SERVIÇO SOCIAL', 'Tempo Médio de Concessão de Benefícios Assistenciais', 'Dias úteis', 'TR = Σ T_parecer ÷ N_beneficios', 'razao', '["T_parecer = dias da recepção do requerimento à emissão do parecer de deferimento","N_beneficios = nº de benefícios deferidos"]'::jsonb, '15 dias corridos', 15, 'Menor é melhor', false, 21),
  ('20', 'DA', '8. ALMOXARIFADO', 'Taxa de Aquisição por AVN', 'Percentual (%)', 'TS-AVN = (V_AVN ÷ V_total) × 100', 'percentual', '["V_AVN = valor (R$) das aquisições liquidadas via AVN no período","V_total = valor (R$) de todo o material de expediente consumido (estoque próprio + AVN)"]'::jsonb, '≥ 80% de substituição do gasto total', 80, 'Maior é melhor', false, 22),
  ('21', 'DA', '8. ALMOXARIFADO', 'Índice de Requisições por Canal', 'Percentual (%)', 'IRC = (R_AVN ÷ R_total) × 100', 'percentual', '["R_AVN = qtd de requisições finalizadas via AVN","R_total = total de requisições atendidas (AVN + próprio)"]'::jsonb, '> 75% via AVN', 75, 'Maior é melhor', false, 23),
  ('22', 'DA', '8. ALMOXARIFADO', 'Variação Mensal do Saldo Contábil do Estoque Próprio', 'Percentual (%)', 'VME = ((S_atual − S_anterior) ÷ S_anterior) × 100', 'variacao', '["S_atual = saldo financeiro (R$) atual em estoque","S_anterior = saldo financeiro (R$) do mês anterior"]'::jsonb, 'Redução linear de 5% ao mês', 5, 'Maior é melhor', false, 24),
  ('23', 'DA', '8. ALMOXARIFADO', 'Tempo Estimado para Esgotamento do Estoque Próprio', 'Meses', 'T_esg = S_atual ÷ C_medio', 'razao', '["S_atual = saldo físico atual em estoque","C_medio = consumo médio mensal do período"]'::jsonb, '≤ 6 meses', 6, 'Menor é melhor', false, 25),
  ('24.1', 'DOC', '9. LICITAÇÕES E CONTRATOS', 'Tempo Médio do Planejamento das Contratações (Fase Interna) — Baixa complexidade', 'Dias', 'TR = Σ T_fase_interna ÷ N_editais', 'razao', '["T_fase_interna = tempo da oficialização da demanda ao edital (baixa complexidade)","N_editais = editais de baixa complexidade publicados"]'::jsonb, '70 dias', 70, 'Menor é melhor', false, 26),
  ('24.2', 'DOC', '9. LICITAÇÕES E CONTRATOS', 'Tempo Médio do Planejamento das Contratações (Fase Interna) — Média complexidade', 'Dias', 'TR = Σ T_fase_interna ÷ N_editais', 'razao', '["T_fase_interna = tempo da oficialização da demanda ao edital (média complexidade)","N_editais = editais de média complexidade publicados"]'::jsonb, '97 dias', 97, 'Menor é melhor', false, 27),
  ('24.3', 'DOC', '9. LICITAÇÕES E CONTRATOS', 'Tempo Médio do Planejamento das Contratações (Fase Interna) — Alta complexidade', 'Dias', 'TR = Σ T_fase_interna ÷ N_editais', 'razao', '["T_fase_interna = tempo da oficialização da demanda ao edital (alta complexidade)","N_editais = editais de alta complexidade publicados"]'::jsonb, '130 dias', 130, 'Menor é melhor', false, 28),
  ('25', 'DOC', '9. LICITAÇÕES E CONTRATOS', 'Indicador de Execução do Plano de Contratações Anual (PCA)', 'Percentual (%)', 'Exec = (L_conc ÷ L_prev) × 100', 'percentual', '["L_conc = licitações concluídas no período","L_prev = licitações previstas no PCA para o período"]'::jsonb, '1', 100, 'Maior é melhor', false, 29),
  ('26', 'DA', '9. LICITAÇÕES E CONTRATOS', 'Tempo Médio de Recebimento de Bens e Serviços', 'Dias úteis', 'TR = Σ T_rec ÷ N_entregas', 'razao', '["T_rec = dias entre a apresentação da NF/fatura e a emissão do TRD","N_entregas = total de entregas"]'::jsonb, 'Até 5 dias úteis', 5, 'Menor é melhor', false, 30),
  ('27', 'DA', '9. LICITAÇÕES E CONTRATOS', 'Tempo Médio de Liquidação de NF/Fatura', 'Horas', 'TR = Σ T_rec_liq ÷ N_faturas', 'razao', '["T_rec_liq = horas do atesto de recebimento à liquidação","N_faturas = faturas liquidadas"]'::jsonb, '72 horas', 72, 'Menor é melhor', false, 31),
  ('28', 'DOC', '9. LICITAÇÕES E CONTRATOS', 'Tempo Médio para Emissão de Empenho', 'Horas', 'TR = Σ T_emp ÷ N_empenhos', 'razao', '["T_emp = horas decorridas da solicitação à emissão","N_empenhos = total de empenhos emitidos"]'::jsonb, '72 horas', 72, 'Menor é melhor', false, 32),
  ('29', 'DOC', '9. LICITAÇÕES E CONTRATOS', 'Tempo Médio para Assinatura de Contrato', 'Dias corridos', 'TR = Σ T_ass ÷ N_contratos', 'razao', '["T_ass = dias decorridos do empenho à assinatura (incl. publicação da designação do gestor/fiscal)","N_contratos = total de contratos assinados"]'::jsonb, '15 dias corridos', 15, 'Menor é melhor', false, 33),
  ('30', 'DOC', '9. LICITAÇÕES E CONTRATOS', 'Tempo Médio de Publicação do Contrato', 'Dias úteis', 'TR = Σ T_pub ÷ N_contratos', 'razao', '["T_pub = dias úteis da assinatura à publicação","N_contratos = nº de contratos publicados"]'::jsonb, 'Até 10 dias úteis', 10, 'Menor é melhor', false, 34),
  ('31', 'DIE', '10. INFRAESTRUTURA E PATRIMÔNIO', 'Nível de Atendimento de Ordem de Serviço', 'Percentual (%)', 'Nível = (OS_atendidas ÷ OS_abertas) × 100', 'percentual', '["OS_atendidas = OS atendidas ou concluídas no período","OS_abertas = OS abertas no período"]'::jsonb, '> 70%', 70, 'Maior é melhor', false, 35),
  ('32', 'DIE', '10. INFRAESTRUTURA E PATRIMÔNIO', 'Capacidade Operacional da Manutenção Predial', 'Homem-Hora / OS', 'HR = Σ HH ÷ N_os', 'razao', '["HH = horas empregadas na manutenção","N_os = OS concluídas"]'::jsonb, '24 horas/OS', 24, 'Menor é melhor', false, 36),
  ('33', 'DIE', '10. INFRAESTRUTURA E PATRIMÔNIO', 'Taxa de Internalização de Serviços', 'Percentual (%)', 'Taxa_int = (OS_int ÷ OS_total) × 100', 'percentual', '["OS_int = OS executadas por equipe própria","OS_total = total de OS executadas"]'::jsonb, '> 60% internalização', 60, 'Maior é melhor', false, 37),
  ('34', 'DIE', '10. INFRAESTRUTURA E PATRIMÔNIO', 'Taxa de Giro do Estoque de Infraestrutura', 'Razão (Vezes)', 'Giro = C_materiais ÷ E_medio', 'razao', '["C_materiais = valor consumido no período","E_medio = valor do estoque médio"]'::jsonb, '≥ 2x (giro)', 2, 'Maior é melhor', false, 38),
  ('35', 'ASESO', '11. COMUNICAÇÃO SOCIAL', 'Eventos Promovidos para o Efetivo', 'Unidade (Número Absoluto)', 'E_total = Σ Eventos realizados', 'direto', '[]'::jsonb, 'Mín. 1 evento por mês', 1, 'Maior é melhor', false, 39),
  ('36', 'ACI', 'Pendências do e-Pessoal', 'Pagamento indevido de benefício previdenciário (art. 24, §2º, EC 103/2019)', 'Quantidade', 'Contagem direta (0 = não há)', 'direto', '[]'::jsonb, NULL, NULL, 'Monitoramento', false, 40),
  ('37', 'ACI', 'Pendências do e-Pessoal', 'Acumulação irregular de benefícios previdenciários (art. 24, §1º, EC 103/2019)', 'Quantidade', 'Contagem direta (0 = não há)', 'direto', '[]'::jsonb, NULL, NULL, 'Monitoramento', false, 41),
  ('38', 'ACI', 'Pendências do e-Pessoal', 'Pensionista filha maior solteira em união estável', 'Quantidade', 'Contagem direta (0 = não há)', 'direto', '[]'::jsonb, NULL, NULL, 'Monitoramento', false, 42),
  ('39', 'ACI', 'Pendências do e-Pessoal', 'Inobservância do teto constitucional para pensionistas que possuem outro vínculo público', 'Quantidade', 'Contagem direta (0 = não há)', 'direto', '[]'::jsonb, NULL, NULL, 'Monitoramento', false, 43),
  ('40', 'ACI', 'Pendências do e-Pessoal', 'Acumulação irregular de cargos', 'Quantidade', 'Contagem direta (0 = não há)', 'direto', '[]'::jsonb, NULL, NULL, 'Monitoramento', false, 44),
  ('41', 'ACI', 'Pendências do e-Pessoal', 'Reajuste incorreto de pensão pela média', 'Quantidade', 'Contagem direta (0 = não há)', 'direto', '[]'::jsonb, NULL, NULL, 'Monitoramento', false, 45),
  ('42', 'ACI', 'Pendências do e-Pessoal', 'Auxílio invalidez para beneficiário em atividade em outro vínculo', 'Quantidade', 'Contagem direta (0 = não há)', 'direto', '[]'::jsonb, NULL, NULL, 'Monitoramento', false, 46),
  ('43', 'ACI', 'Pendências do e-Pessoal', 'Pensionista falecido com remuneração', 'Quantidade', 'Contagem direta (0 = não há)', 'direto', '[]'::jsonb, NULL, NULL, 'Monitoramento', false, 47),
  ('44', 'ACI', 'Pendências do e-Pessoal', 'Servidores ou pensionistas com CPF/dados irregulares ou divergentes na Receita Federal', 'Quantidade', 'Contagem direta (0 = não há)', 'direto', '[]'::jsonb, NULL, NULL, 'Monitoramento', false, 48),
  ('45', 'ACI', 'Pendências do e-Pessoal', 'Auxílio alimentação pago em duplicidade', 'Quantidade', 'Contagem direta (0 = não há)', 'direto', '[]'::jsonb, NULL, NULL, 'Monitoramento', false, 49),
  ('46', 'ACI', 'Pendências do e-Pessoal', 'Posto/graduação de referência para reforma divergente do definido no ato de concessão após apreciação do TCU', 'Quantidade', 'Contagem direta (0 = não há)', 'direto', '[]'::jsonb, NULL, NULL, 'Monitoramento', false, 50),
  ('47', 'ACI', 'Pendências do e-Pessoal', 'Auxílio creche pago em duplicidade', 'Quantidade', 'Contagem direta (0 = não há)', 'direto', '[]'::jsonb, NULL, NULL, 'Monitoramento', false, 51),
  ('48', 'ACI', 'Pendências do e-Pessoal', 'Pensionista filha maior solteira ocupando cargo público', 'Quantidade', 'Contagem direta (0 = não há)', 'direto', '[]'::jsonb, NULL, NULL, 'Monitoramento', false, 52),
  ('49', 'ACI', 'Pendências do e-Pessoal', 'Posto/graduação de referência para pensão divergente do definido no ato de concessão após apreciação do TCU', 'Quantidade', 'Contagem direta (0 = não há)', 'direto', '[]'::jsonb, NULL, NULL, 'Monitoramento', false, 53),
  ('50', 'ACI', 'Pendências do e-Pessoal', 'Dedicação exclusiva desrespeitada', 'Quantidade', 'Contagem direta (0 = não há)', 'direto', '[]'::jsonb, NULL, NULL, 'Monitoramento', false, 54),
  ('51', 'ACI', 'Pendências do e-Pessoal', 'Pensionista militar temporário acima de 24 anos', 'Quantidade', 'Contagem direta (0 = não há)', 'direto', '[]'::jsonb, NULL, NULL, 'Monitoramento', false, 55),
  ('52', 'ACI', 'Pendências do e-Pessoal', 'Servidor ativo com mais de 75 anos', 'Quantidade', 'Contagem direta (0 = não há)', 'direto', '[]'::jsonb, NULL, NULL, 'Monitoramento', false, 56),
  ('53', 'ACI', 'Pendências do e-Pessoal', 'Servidor falecido recebendo remuneração', 'Quantidade', 'Contagem direta (0 = não há)', 'direto', '[]'::jsonb, NULL, NULL, 'Monitoramento', false, 57),
  ('54', 'DOC', 'Plano de Contratações Anual', 'Concluídas (Homologadas)', 'Quantidade', 'Contagem direta (0 = não há)', 'direto', '[]'::jsonb, NULL, NULL, 'Monitoramento', true, 58),
  ('55', 'DOC', 'Plano de Contratações Anual', 'Em andamento (Fase interna)', 'Quantidade', 'Contagem direta (0 = não há)', 'direto', '[]'::jsonb, NULL, NULL, 'Monitoramento', true, 59),
  ('56', 'DOC', 'Plano de Contratações Anual', 'Editais Publicados (Fase Ext.)', 'Quantidade', 'Contagem direta (0 = não há)', 'direto', '[]'::jsonb, NULL, NULL, 'Monitoramento', true, 60),
  ('57', 'DOC', 'Plano de Contratações Anual', 'Atas SRP Assinadas', 'Quantidade', 'Contagem direta (0 = não há)', 'direto', '[]'::jsonb, NULL, NULL, 'Monitoramento', true, 61),
  ('58', 'DOC', 'Plano de Contratações Anual', 'Suspensas / Revogadas', 'Quantidade', 'Contagem direta (0 = não há)', 'direto', '[]'::jsonb, NULL, NULL, 'Monitoramento', true, 62),
  ('59', 'AJUR', 'Ressarcimento ao Erário', 'Concluídos / Arquivados', 'Quantidade', 'Contagem direta (0 = não há)', 'direto', '[]'::jsonb, NULL, NULL, 'Monitoramento', false, 63),
  ('60', 'AJUR', 'Ressarcimento ao Erário', 'Em Apuração', 'Quantidade', 'Contagem direta (0 = não há)', 'direto', '[]'::jsonb, NULL, NULL, 'Monitoramento', false, 64),
  ('61', 'AJUR', 'Ressarcimento ao Erário', 'Em Cobrança Administrativa', 'Quantidade', 'Contagem direta (0 = não há)', 'direto', '[]'::jsonb, NULL, NULL, 'Monitoramento', false, 65)
ON CONFLICT (id) DO UPDATE SET divisao = EXCLUDED.divisao, categoria = EXCLUDED.categoria, indicador = EXCLUDED.indicador,
  unidade = EXCLUDED.unidade, formula = EXCLUDED.formula, calculo = EXCLUDED.calculo, variaveis = EXCLUDED.variaveis,
  meta_txt = EXCLUDED.meta_txt, meta_num = EXCLUDED.meta_num, direcao = EXCLUDED.direcao, planejado = EXCLUDED.planejado, ordem = EXCLUDED.ordem;
