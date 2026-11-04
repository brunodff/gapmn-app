-- O levantamento do PTA não inclui mais a Assessoria Religiosa (ARE): a pedido do Bruno, ela sai da lista de
-- divisões/assessorias que respondem. Ninguém tinha cadastrado nada com ARE (campanha de 2027 ainda fechada).
-- Depende de 20261104_pta_levantamento.sql.

CREATE OR REPLACE FUNCTION public.pta_lev_setor_valido(p text)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT p = ANY (ARRAY['DA', 'DRH', 'DIE', 'DOC', 'SEC', 'ACI', 'AJUR', 'APLG', 'ARC', 'ASESO'])
$$;
