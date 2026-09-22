-- Campos adicionais do Excel SILOMS (v2)
ALTER TABLE solicitacoes_empenho
  ADD COLUMN IF NOT EXISTS subprocesso        text,
  ADD COLUMN IF NOT EXISTS ugexec             text,
  ADD COLUMN IF NOT EXISTS ugcred             text,
  ADD COLUMN IF NOT EXISTS indicador_lotacao  text,
  ADD COLUMN IF NOT EXISTS nd                 text,
  ADD COLUMN IF NOT EXISTS fornecedor         text,
  ADD COLUMN IF NOT EXISTS valor              numeric,
  ADD COLUMN IF NOT EXISTS pregao             text,
  ADD COLUMN IF NOT EXISTS status_siloms      text,
  ADD COLUMN IF NOT EXISTS sem_destinatario   boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS pdf_ne_url         text;   -- URL pública do PDF da NE assinada

-- Bucket para PDFs das Notas de Empenho
INSERT INTO storage.buckets (id, name, public)
VALUES ('empenhos-pdf', 'empenhos-pdf', true)
ON CONFLICT (id) DO NOTHING;

-- RLS do bucket: leitura pública, escrita apenas SEO/ADMIN/DEV
CREATE POLICY "pdf_ne_public_read" ON storage.objects
  FOR SELECT USING (bucket_id = 'empenhos-pdf');

CREATE POLICY "pdf_ne_seo_write" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'empenhos-pdf' AND
    EXISTS (
      SELECT 1 FROM profiles
      WHERE id = auth.uid() AND setor IN ('SEO','ADMIN','DEV')
    )
  );

CREATE POLICY "pdf_ne_seo_delete" ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'empenhos-pdf' AND
    EXISTS (
      SELECT 1 FROM profiles
      WHERE id = auth.uid() AND setor IN ('SEO','ADMIN','DEV')
    )
  );
