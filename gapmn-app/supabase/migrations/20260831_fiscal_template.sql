-- Template padrão para e-mail ao fiscal quando NE é assinada
-- Placeholders: {{ne_siafi}}, {{responsavel}}, {{fornecedor}}, {{valor}},
--               {{nd}}, {{pag}}, {{numero}}
INSERT INTO email_templates (tipo, assunto, corpo) VALUES (
  'FISCAL',
  '[GAP-MN] NE Assinada — {{ne_siafi}} | Solicitação {{numero}}',
  'Prezado(a) {{responsavel}},

Informamos que a Nota de Empenho nº {{ne_siafi}} referente à Solicitação {{numero}} foi ASSINADA e está disponível para acompanhamento.

DADOS DO EMPENHO:

  • Fornecedor : {{fornecedor}}
  • Valor       : {{valor}}
  • Natureza   : {{nd}}
  • PAG         : {{pag}}

Por gentileza, acompanhe o fornecimento conforme o prazo estabelecido no Termo de Referência e registre o recebimento do objeto/serviço junto à Seção de Almoxarifado.

Em caso de dúvidas, entre em contato com a Divisão Administrativa do GAP-MN.

DIVISÃO ADMINISTRATIVA DO GAP-MN
TELEFONE: (92) 3614-1569'
) ON CONFLICT (tipo) DO NOTHING;
