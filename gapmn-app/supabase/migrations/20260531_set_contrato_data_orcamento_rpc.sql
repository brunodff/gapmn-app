-- Função SECURITY DEFINER para salvar data_orcamento em qualquer contrato.
-- Qualquer usuário autenticado pode registrar a data base do orçamento
-- (usado pelo Termo de Apostilamento para calcular próximo reajuste).
CREATE OR REPLACE FUNCTION set_contrato_data_orcamento(p_id uuid, p_data_orcamento date)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  UPDATE contratos_scon SET data_orcamento = p_data_orcamento WHERE id = p_id;
END; $$;

GRANT EXECUTE ON FUNCTION set_contrato_data_orcamento(uuid, date) TO authenticated;
