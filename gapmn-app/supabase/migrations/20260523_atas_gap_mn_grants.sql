-- Concede permissão de INSERT ao role anon (necessário para o bookmarklet)
-- A policy RLS "WITH CHECK (true)" sozinha não basta — o GRANT no role é obrigatório.
GRANT INSERT ON TABLE public.atas_gap_mn TO anon;
GRANT USAGE, SELECT ON SEQUENCE public.atas_gap_mn_id_seq TO anon;

-- UPDATE também para o PATCH de pdf_url
GRANT UPDATE (pdf_url) ON TABLE public.atas_gap_mn TO anon;
