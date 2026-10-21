-- Minuta do PTA (Programa de Trabalho Anual) dentro do Painel de Execução, só para ADMIN e DEV,
-- com comentários. E trava em profiles: até aqui qualquer usuário podia mudar o próprio setor
-- (política "profiles: update own" sem restrição de coluna) e virar ADMIN.

-- ── 1. profiles: só ADMIN ou DEV mudam setor, papel e aprovação ─────────────────────────────
CREATE OR REPLACE FUNCTION public.profiles_protege_campos()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  quem uuid := auth.uid();
BEGIN
  -- cadastro pelo Auth (handle_new_user_profile) e chamadas de serviço não têm usuário
  IF quem IS NULL THEN
    RETURN NEW;
  END IF;
  IF EXISTS (SELECT 1 FROM public.profiles WHERE id = quem AND setor IN ('ADMIN', 'DEV')) THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'INSERT' THEN
    NEW.setor := NULL;
    NEW.role := 'user';
    NEW.approved := false;
    RETURN NEW;
  END IF;
  IF NEW.setor IS DISTINCT FROM OLD.setor
     OR NEW.role IS DISTINCT FROM OLD.role
     OR NEW.approved IS DISTINCT FROM OLD.approved THEN
    RAISE EXCEPTION 'Só ADMIN ou DEV podem alterar setor, papel ou aprovação de um usuário.'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_profiles_protege_campos ON public.profiles;
CREATE TRIGGER trg_profiles_protege_campos
  BEFORE INSERT OR UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.profiles_protege_campos();

-- ── 2. Quem pode ver e editar a minuta ──────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.eh_admin_ou_dev()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND setor IN ('ADMIN', 'DEV'))
$$;

CREATE OR REPLACE FUNCTION public.eh_dev()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND setor = 'DEV')
$$;

-- função nova nasce executável pelo anon: tira
REVOKE EXECUTE ON FUNCTION public.eh_admin_ou_dev() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.eh_dev() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.eh_admin_ou_dev() TO authenticated;
GRANT EXECUTE ON FUNCTION public.eh_dev() TO authenticated;
REVOKE EXECUTE ON FUNCTION public.profiles_protege_campos() FROM PUBLIC, anon, authenticated;

-- ── 3. Minuta: um registro por ano e seção (ex.: 2027, 'cap7') ──────────────────────────────
CREATE TABLE IF NOT EXISTS public.pta_minutas (
  ano             integer     NOT NULL CHECK (ano BETWEEN 2020 AND 2100),
  secao           text        NOT NULL CHECK (secao ~ '^[a-z0-9_-]{1,40}$'),
  conteudo        jsonb       NOT NULL,
  versao          integer     NOT NULL DEFAULT 1,
  atualizado_por  uuid        REFERENCES public.profiles(id) DEFAULT auth.uid(),
  atualizado_nome text,
  atualizado_em   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (ano, secao)
);

CREATE TABLE IF NOT EXISTS public.pta_comentarios (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  ano           integer     NOT NULL,
  secao         text        NOT NULL,
  alvo          text,                        -- id do artigo ou da tarefa; NULL = a seção inteira
  alvo_rotulo   text,                        -- o que mostrar (ex.: "27DIE001 – Adquirir material de limpeza")
  tipo          text        NOT NULL DEFAULT 'comentario' CHECK (tipo IN ('comentario', 'de_acordo')),
  texto         text        NOT NULL CHECK (char_length(texto) BETWEEN 1 AND 4000),
  autor_id      uuid        NOT NULL DEFAULT auth.uid() REFERENCES public.profiles(id),
  autor_nome    text,
  criado_em     timestamptz NOT NULL DEFAULT now(),
  resolvido     boolean     NOT NULL DEFAULT false,
  resolvido_por uuid        REFERENCES public.profiles(id),
  resolvido_em  timestamptz
);
CREATE INDEX IF NOT EXISTS pta_comentarios_ano_secao ON public.pta_comentarios (ano, secao, criado_em);

-- autor e "atualizado por" vêm do perfil, não do navegador
CREATE OR REPLACE FUNCTION public.pta_preenche_autor()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_TABLE_NAME = 'pta_comentarios' THEN
    IF TG_OP = 'INSERT' THEN
      NEW.autor_id := auth.uid();
      NEW.autor_nome := (SELECT nome_guerra FROM public.profiles WHERE id = auth.uid());
      NEW.criado_em := now();
      NEW.resolvido := false; NEW.resolvido_por := NULL; NEW.resolvido_em := NULL;
    ELSE
      -- na edição só muda a situação "resolvido"; texto, autor e alvo ficam como estavam
      NEW.id := OLD.id; NEW.ano := OLD.ano; NEW.secao := OLD.secao; NEW.alvo := OLD.alvo;
      NEW.alvo_rotulo := OLD.alvo_rotulo; NEW.tipo := OLD.tipo; NEW.texto := OLD.texto;
      NEW.autor_id := OLD.autor_id; NEW.autor_nome := OLD.autor_nome; NEW.criado_em := OLD.criado_em;
      IF NEW.resolvido IS DISTINCT FROM OLD.resolvido THEN
        NEW.resolvido_por := CASE WHEN NEW.resolvido THEN auth.uid() END;
        NEW.resolvido_em := CASE WHEN NEW.resolvido THEN now() END;
      ELSE
        NEW.resolvido_por := OLD.resolvido_por; NEW.resolvido_em := OLD.resolvido_em;
      END IF;
    END IF;
  ELSE
    NEW.atualizado_por := auth.uid();
    NEW.atualizado_nome := (SELECT nome_guerra FROM public.profiles WHERE id = auth.uid());
    NEW.atualizado_em := now();
  END IF;
  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.pta_preenche_autor() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_pta_minutas_autor ON public.pta_minutas;
CREATE TRIGGER trg_pta_minutas_autor BEFORE INSERT OR UPDATE ON public.pta_minutas
  FOR EACH ROW EXECUTE FUNCTION public.pta_preenche_autor();
DROP TRIGGER IF EXISTS trg_pta_comentarios_autor ON public.pta_comentarios;
CREATE TRIGGER trg_pta_comentarios_autor BEFORE INSERT OR UPDATE ON public.pta_comentarios
  FOR EACH ROW EXECUTE FUNCTION public.pta_preenche_autor();

ALTER TABLE public.pta_minutas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pta_comentarios ENABLE ROW LEVEL SECURITY;

-- minuta: ADMIN e DEV leem; só DEV grava
DROP POLICY IF EXISTS pta_minutas_ler ON public.pta_minutas;
DROP POLICY IF EXISTS pta_minutas_criar ON public.pta_minutas;
DROP POLICY IF EXISTS pta_minutas_editar ON public.pta_minutas;
CREATE POLICY pta_minutas_ler ON public.pta_minutas FOR SELECT TO authenticated USING (public.eh_admin_ou_dev());
CREATE POLICY pta_minutas_criar ON public.pta_minutas FOR INSERT TO authenticated WITH CHECK (public.eh_dev());
CREATE POLICY pta_minutas_editar ON public.pta_minutas FOR UPDATE TO authenticated USING (public.eh_dev()) WITH CHECK (public.eh_dev());

-- comentários: ADMIN e DEV leem e comentam; resolve quem escreveu ou o DEV; apaga quem escreveu
DROP POLICY IF EXISTS pta_coment_ler ON public.pta_comentarios;
DROP POLICY IF EXISTS pta_coment_criar ON public.pta_comentarios;
DROP POLICY IF EXISTS pta_coment_resolver ON public.pta_comentarios;
DROP POLICY IF EXISTS pta_coment_apagar ON public.pta_comentarios;
CREATE POLICY pta_coment_ler ON public.pta_comentarios FOR SELECT TO authenticated USING (public.eh_admin_ou_dev());
CREATE POLICY pta_coment_criar ON public.pta_comentarios FOR INSERT TO authenticated WITH CHECK (public.eh_admin_ou_dev());
CREATE POLICY pta_coment_resolver ON public.pta_comentarios FOR UPDATE TO authenticated
  USING (public.eh_admin_ou_dev() AND (autor_id = auth.uid() OR public.eh_dev()))
  WITH CHECK (public.eh_admin_ou_dev());
CREATE POLICY pta_coment_apagar ON public.pta_comentarios FOR DELETE TO authenticated USING (autor_id = auth.uid());

REVOKE ALL ON public.pta_minutas, public.pta_comentarios FROM anon;
