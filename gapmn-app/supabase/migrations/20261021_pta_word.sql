-- Minuta do PTA em Word (.docx) dentro do app, só para ADMIN e DEV: depósito privado de arquivos
-- e histórico de versões. Quem baixa edita no Word e envia a versão nova; nada é sobrescrito.
-- Depende de 20261021_pta_minuta.sql (funções eh_admin_ou_dev e eh_dev).

-- ── 1. Depósito privado (os outros do app são públicos; este não) ───────────────────────────
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('pta-docs', 'pta-docs', false, 20971520,
        ARRAY['application/vnd.openxmlformats-officedocument.wordprocessingml.document'])
ON CONFLICT (id) DO UPDATE
  SET public = false,
      file_size_limit = EXCLUDED.file_size_limit,
      allowed_mime_types = EXCLUDED.allowed_mime_types;

-- ADMIN e DEV baixam e enviam; ninguém troca nem apaga pelo app (cada envio é uma versão nova)
DROP POLICY IF EXISTS pta_docs_ler ON storage.objects;
DROP POLICY IF EXISTS pta_docs_enviar ON storage.objects;
CREATE POLICY pta_docs_ler ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'pta-docs' AND public.eh_admin_ou_dev());
CREATE POLICY pta_docs_enviar ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'pta-docs' AND public.eh_admin_ou_dev()
              AND name ~ '^[0-9]{4}/[0-9A-Za-z_.-]{1,120}\.docx$');

-- ── 2. Versões do documento ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.pta_arquivos (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  ano          integer     NOT NULL CHECK (ano BETWEEN 2020 AND 2100),
  caminho      text        NOT NULL UNIQUE CHECK (caminho ~ '^[0-9]{4}/[0-9A-Za-z_.-]{1,120}\.docx$'),
  nome         text        NOT NULL CHECK (char_length(nome) BETWEEN 1 AND 200),
  tamanho      integer     CHECK (tamanho >= 0),
  -- modelo = gerado do PTA anterior; enviado = editado no Word por alguém; cap7 = cap. VII levado da minuta do painel
  origem       text        NOT NULL DEFAULT 'enviado' CHECK (origem IN ('modelo', 'enviado', 'cap7')),
  observacao   text        CHECK (char_length(observacao) <= 1000),
  enviado_por  uuid        REFERENCES public.profiles(id) DEFAULT auth.uid(),
  enviado_nome text,
  enviado_em   timestamptz NOT NULL DEFAULT now(),
  CHECK (caminho LIKE ano::text || '/%')
);
CREATE INDEX IF NOT EXISTS pta_arquivos_ano_em ON public.pta_arquivos (ano, enviado_em DESC);

-- quem enviou vem do perfil, não do navegador (chamada de serviço, sem usuário, grava o que veio)
CREATE OR REPLACE FUNCTION public.pta_arquivos_autor()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NOT NULL THEN
    NEW.enviado_por := auth.uid();
    NEW.enviado_nome := (SELECT nome_guerra FROM public.profiles WHERE id = auth.uid());
    NEW.enviado_em := now();
  END IF;
  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.pta_arquivos_autor() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_pta_arquivos_autor ON public.pta_arquivos;
CREATE TRIGGER trg_pta_arquivos_autor BEFORE INSERT ON public.pta_arquivos
  FOR EACH ROW EXECUTE FUNCTION public.pta_arquivos_autor();

ALTER TABLE public.pta_arquivos ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS pta_arquivos_ler ON public.pta_arquivos;
DROP POLICY IF EXISTS pta_arquivos_enviar ON public.pta_arquivos;
CREATE POLICY pta_arquivos_ler ON public.pta_arquivos FOR SELECT TO authenticated
  USING (public.eh_admin_ou_dev());
-- ADMIN e DEV enviam versão editada; só o DEV gera a versão com o cap. VII da minuta
CREATE POLICY pta_arquivos_enviar ON public.pta_arquivos FOR INSERT TO authenticated
  WITH CHECK (public.eh_admin_ou_dev() AND (origem = 'enviado' OR (origem = 'cap7' AND public.eh_dev())));
REVOKE ALL ON public.pta_arquivos FROM anon;

-- ── 3. Minuta gravada por chamada de serviço (sem usuário) mantém o "atualizado por" que veio ──
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
  ELSIF auth.uid() IS NOT NULL THEN
    NEW.atualizado_por := auth.uid();
    NEW.atualizado_nome := (SELECT nome_guerra FROM public.profiles WHERE id = auth.uid());
    NEW.atualizado_em := now();
  END IF;
  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.pta_preenche_autor() FROM PUBLIC, anon, authenticated;
