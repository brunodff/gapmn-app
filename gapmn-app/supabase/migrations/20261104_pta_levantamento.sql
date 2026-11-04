-- Levantamento dos projetos e atividades do PTA (substitui a planilha compartilhada com os setores).
-- O formulário abre por link, sem login, como a coleta mensal dos indicadores: cada pessoa cadastra um
-- projeto ou uma atividade por vez, até o fim, e pode voltar para editar ou excluir o que ela cadastrou.
-- Quem cadastrou é reconhecido por uma chave pessoal que fica no navegador (e no link pessoal que a tela
-- mostra); o banco guarda só o hash dela. ADMIN e DEV veem tudo no Painel de Execução e abrem/fecham o
-- levantamento. Depende de 20261021_pta_minuta.sql (eh_admin_ou_dev).

-- ── 1. Levantamento de cada ano (o link vale para o ano do PTA) ─────────────────────────────
CREATE TABLE IF NOT EXISTS public.pta_lev_campanhas (
  ano        integer     PRIMARY KEY CHECK (ano BETWEEN 2026 AND 2100),
  token      text        UNIQUE CHECK (token IS NULL OR char_length(token) >= 20),   -- código do link do formulário
  aberta     boolean     NOT NULL DEFAULT false,
  prazo      date,
  aberta_por uuid        REFERENCES public.profiles(id),
  aberta_em  timestamptz,
  fechada_em timestamptz
);

-- ── 2. Cadastros (um projeto ou uma atividade, com as etapas ou tarefas) ────────────────────
CREATE TABLE IF NOT EXISTS public.pta_lev_itens (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  ano           integer     NOT NULL REFERENCES public.pta_lev_campanhas(ano),
  tipo          text        NOT NULL CHECK (tipo IN ('projeto', 'atividade')),
  setor         text        NOT NULL,
  secao         text        CHECK (char_length(secao) <= 120),
  nome          text        NOT NULL CHECK (char_length(nome) BETWEEN 3 AND 200),
  posto         text        NOT NULL CHECK (char_length(posto) BETWEEN 1 AND 30),
  nome_guerra   text        NOT NULL CHECK (char_length(nome_guerra) BETWEEN 2 AND 40),
  -- campos do projeto ou da atividade (o formulário confere; aqui só forma e tamanho)
  dados         jsonb       NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(dados) = 'object'),
  -- projeto: etapas (tarefas e marcos); atividade: tarefas da rotina
  etapas        jsonb       NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(etapas) = 'array'),
  dono          text        NOT NULL CHECK (dono ~ '^[0-9a-f]{64}$'),                 -- sha256 da chave pessoal
  criado_em     timestamptz NOT NULL DEFAULT now(),
  atualizado_em timestamptz NOT NULL DEFAULT now(),
  versao        integer     NOT NULL DEFAULT 1,
  excluido_em   timestamptz                                                         -- exclusão pela própria pessoa
);
CREATE INDEX IF NOT EXISTS pta_lev_itens_dono ON public.pta_lev_itens (ano, dono) WHERE excluido_em IS NULL;

-- ── 3. Histórico (toda edição e exclusão guarda como estava antes) ──────────────────────────
CREATE TABLE IF NOT EXISTS public.pta_lev_historico (
  id      bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  item_id uuid        NOT NULL,
  acao    text        NOT NULL CHECK (acao IN ('edicao', 'exclusao')),
  antes   jsonb       NOT NULL,
  quando  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS pta_lev_historico_item ON public.pta_lev_historico (item_id, quando);

CREATE OR REPLACE FUNCTION public.pta_lev_registra_historico()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.pta_lev_historico (item_id, acao, antes)
  VALUES (OLD.id, CASE WHEN NEW.excluido_em IS NOT NULL AND OLD.excluido_em IS NULL THEN 'exclusao' ELSE 'edicao' END,
          to_jsonb(OLD) - 'dono');
  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.pta_lev_registra_historico() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_pta_lev_itens_historico ON public.pta_lev_itens;
CREATE TRIGGER trg_pta_lev_itens_historico AFTER UPDATE ON public.pta_lev_itens
  FOR EACH ROW EXECUTE FUNCTION public.pta_lev_registra_historico();

-- ── 4. Funções internas ─────────────────────────────────────────────────────────────────────
-- Divisões e assessorias que respondem (as mesmas da planilha; espelho de src/lib/ptaLevantamento/cadastro.ts)
CREATE OR REPLACE FUNCTION public.pta_lev_setor_valido(p text)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT p = ANY (ARRAY['DA', 'DRH', 'DIE', 'DOC', 'SEC', 'ACI', 'AJUR', 'APLG', 'ARC', 'ASESO', 'ARE'])
$$;

CREATE OR REPLACE FUNCTION public.pta_lev_campanha_do_link(p_token text, p_exige_aberta boolean)
RETURNS public.pta_lev_campanhas LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE c public.pta_lev_campanhas;
BEGIN
  IF p_token IS NULL OR char_length(p_token) < 20 THEN RAISE EXCEPTION 'link_invalido' USING ERRCODE = 'P0001'; END IF;
  SELECT * INTO c FROM public.pta_lev_campanhas WHERE token = p_token;
  IF NOT FOUND THEN RAISE EXCEPTION 'link_invalido' USING ERRCODE = 'P0001'; END IF;
  IF p_exige_aberta AND NOT c.aberta THEN RAISE EXCEPTION 'levantamento_encerrado' USING ERRCODE = 'P0001'; END IF;
  RETURN c;
END;
$$;

-- hash da chave pessoal (a chave nunca é gravada)
CREATE OR REPLACE FUNCTION public.pta_lev_dono(p_chave text)
RETURNS text LANGUAGE plpgsql IMMUTABLE SET search_path = public AS $$
BEGIN
  IF p_chave IS NULL OR char_length(p_chave) NOT BETWEEN 20 AND 200 THEN RAISE EXCEPTION 'chave_invalida' USING ERRCODE = '22023'; END IF;
  RETURN encode(extensions.digest(convert_to(p_chave, 'UTF8'), 'sha256'), 'hex');
END;
$$;

CREATE OR REPLACE FUNCTION public.pta_lev_json(i public.pta_lev_itens)
RETURNS jsonb LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT jsonb_build_object('id', i.id, 'ano', i.ano, 'tipo', i.tipo, 'setor', i.setor, 'secao', i.secao, 'nome', i.nome,
    'posto', i.posto, 'nome_guerra', i.nome_guerra, 'dados', i.dados, 'etapas', i.etapas,
    'criado_em', i.criado_em, 'atualizado_em', i.atualizado_em, 'versao', i.versao, 'excluido_em', i.excluido_em)
$$;
REVOKE EXECUTE ON FUNCTION public.pta_lev_campanha_do_link(text, boolean), public.pta_lev_dono(text),
  public.pta_lev_json(public.pta_lev_itens) FROM PUBLIC, anon, authenticated;

-- ── 5. Formulário (sem login, com o código do link) ─────────────────────────────────────────
-- O que o formulário precisa: o levantamento e o que esta pessoa já cadastrou.
CREATE OR REPLACE FUNCTION public.pta_lev_formulario(p_token text, p_chave text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE c public.pta_lev_campanhas; v_dono text;
BEGIN
  c := public.pta_lev_campanha_do_link(p_token, false);
  IF p_chave IS NOT NULL THEN v_dono := public.pta_lev_dono(p_chave); END IF;
  RETURN jsonb_build_object(
    'levantamento', jsonb_build_object('ano', c.ano, 'aberta', c.aberta, 'prazo', c.prazo),
    'meus', (SELECT coalesce(jsonb_agg(public.pta_lev_json(i) ORDER BY i.criado_em), '[]'::jsonb)
               FROM public.pta_lev_itens i WHERE i.ano = c.ano AND i.dono = v_dono AND i.excluido_em IS NULL)
  );
END;
$$;

-- Grava um cadastro novo (p_id nulo) ou a edição de um cadastro da mesma pessoa.
-- p_item: {tipo, setor, secao, nome, posto, nome_guerra, dados, etapas}
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
  IF jsonb_typeof(p_item) IS DISTINCT FROM 'object' OR v_tipo IS NULL OR v_tipo NOT IN ('projeto', 'atividade') THEN
    RAISE EXCEPTION 'cadastro_invalido' USING ERRCODE = '22023';
  END IF;
  IF NOT public.pta_lev_setor_valido(v_setor) THEN RAISE EXCEPTION 'setor_invalido' USING ERRCODE = '22023'; END IF;
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

-- Exclui um cadastro da mesma pessoa (fica no histórico; some do formulário e do painel).
CREATE OR REPLACE FUNCTION public.pta_lev_excluir(p_token text, p_chave text, p_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE c public.pta_lev_campanhas; v_dono text := public.pta_lev_dono(p_chave); r public.pta_lev_itens;
BEGIN
  c := public.pta_lev_campanha_do_link(p_token, true);
  UPDATE public.pta_lev_itens SET excluido_em = now()
   WHERE id = p_id AND ano = c.ano AND dono = v_dono AND excluido_em IS NULL
  RETURNING * INTO r;
  IF NOT FOUND THEN RAISE EXCEPTION 'cadastro_nao_encontrado' USING ERRCODE = 'P0001'; END IF;
  RETURN jsonb_build_object('ok', true, 'id', r.id);
END;
$$;

-- ── 6. Quem administra (ADMIN e DEV) ────────────────────────────────────────────────────────
-- Tudo do levantamento do ano, para o painel e para atualizar a minuta (os excluídos vêm marcados).
CREATE OR REPLACE FUNCTION public.pta_lev_painel(p_ano integer)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.eh_admin_ou_dev() THEN RAISE EXCEPTION 'sem_permissao' USING ERRCODE = '42501'; END IF;
  RETURN jsonb_build_object(
    'levantamento', (SELECT to_jsonb(c) FROM public.pta_lev_campanhas c WHERE c.ano = p_ano),
    'itens', (SELECT coalesce(jsonb_agg(public.pta_lev_json(i) ORDER BY i.setor, i.tipo, i.criado_em), '[]'::jsonb)
                FROM public.pta_lev_itens i WHERE i.ano = p_ano),
    'gerado_em', now()
  );
END;
$$;

-- Abre o levantamento do ano e devolve o código do link (cria o código na primeira vez).
CREATE OR REPLACE FUNCTION public.pta_lev_abrir(p_ano integer, p_prazo date DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE c public.pta_lev_campanhas;
BEGIN
  IF NOT public.eh_admin_ou_dev() THEN RAISE EXCEPTION 'sem_permissao' USING ERRCODE = '42501'; END IF;
  INSERT INTO public.pta_lev_campanhas (ano, token, aberta, prazo, aberta_por, aberta_em)
  VALUES (p_ano, translate(encode(extensions.gen_random_bytes(18), 'base64'), '+/=', '-_'), true, p_prazo, auth.uid(), now())
  ON CONFLICT (ano) DO UPDATE SET aberta = true, prazo = EXCLUDED.prazo, aberta_por = auth.uid(), aberta_em = now(), fechada_em = NULL,
    token = coalesce(public.pta_lev_campanhas.token, EXCLUDED.token)
  RETURNING * INTO c;
  RETURN to_jsonb(c);
END;
$$;

CREATE OR REPLACE FUNCTION public.pta_lev_fechar(p_ano integer)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE c public.pta_lev_campanhas;
BEGIN
  IF NOT public.eh_admin_ou_dev() THEN RAISE EXCEPTION 'sem_permissao' USING ERRCODE = '42501'; END IF;
  UPDATE public.pta_lev_campanhas SET aberta = false, fechada_em = now() WHERE ano = p_ano RETURNING * INTO c;
  RETURN to_jsonb(c);
END;
$$;

-- Troca o código do link (o link antigo para de funcionar; os cadastros continuam).
CREATE OR REPLACE FUNCTION public.pta_lev_novo_link(p_ano integer)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE c public.pta_lev_campanhas;
BEGIN
  IF NOT public.eh_admin_ou_dev() THEN RAISE EXCEPTION 'sem_permissao' USING ERRCODE = '42501'; END IF;
  UPDATE public.pta_lev_campanhas SET token = translate(encode(extensions.gen_random_bytes(18), 'base64'), '+/=', '-_')
   WHERE ano = p_ano RETURNING * INTO c;
  RETURN to_jsonb(c);
END;
$$;

-- quem pode chamar o quê
REVOKE EXECUTE ON FUNCTION public.pta_lev_formulario(text, text), public.pta_lev_salvar(text, text, uuid, jsonb),
  public.pta_lev_excluir(text, text, uuid), public.pta_lev_painel(integer), public.pta_lev_abrir(integer, date),
  public.pta_lev_fechar(integer), public.pta_lev_novo_link(integer), public.pta_lev_setor_valido(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.pta_lev_formulario(text, text), public.pta_lev_salvar(text, text, uuid, jsonb),
  public.pta_lev_excluir(text, text, uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pta_lev_painel(integer), public.pta_lev_abrir(integer, date), public.pta_lev_fechar(integer),
  public.pta_lev_novo_link(integer) TO authenticated;
-- o Supabase dá EXECUTE ao anon em toda função nova: tira das de quem administra
REVOKE EXECUTE ON FUNCTION public.pta_lev_painel(integer), public.pta_lev_abrir(integer, date), public.pta_lev_fechar(integer),
  public.pta_lev_novo_link(integer), public.pta_lev_setor_valido(text) FROM anon;

-- ── 7. RLS: ninguém grava direto; ADMIN e DEV leem ──────────────────────────────────────────
ALTER TABLE public.pta_lev_campanhas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pta_lev_itens ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pta_lev_historico ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS pta_lev_campanhas_ler ON public.pta_lev_campanhas;
DROP POLICY IF EXISTS pta_lev_itens_ler ON public.pta_lev_itens;
DROP POLICY IF EXISTS pta_lev_historico_ler ON public.pta_lev_historico;
CREATE POLICY pta_lev_campanhas_ler ON public.pta_lev_campanhas FOR SELECT TO authenticated USING (public.eh_admin_ou_dev());
CREATE POLICY pta_lev_itens_ler ON public.pta_lev_itens FOR SELECT TO authenticated USING (public.eh_admin_ou_dev());
CREATE POLICY pta_lev_historico_ler ON public.pta_lev_historico FOR SELECT TO authenticated USING (public.eh_admin_ou_dev());
REVOKE ALL ON public.pta_lev_campanhas, public.pta_lev_itens, public.pta_lev_historico FROM anon;
