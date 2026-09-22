CREATE TABLE IF NOT EXISTS email_templates (
  id         uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  tipo       text UNIQUE NOT NULL,
  assunto    text NOT NULL,
  corpo      text NOT NULL,
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE email_templates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "autenticados_leem_templates" ON email_templates
  FOR SELECT USING (auth.role() = 'authenticated');

CREATE POLICY "seo_dev_admin_editam_templates" ON email_templates
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE id = auth.uid() AND setor IN ('SEO','DEV','ADMIN')
    )
  );

-- Template padrão para e-mail ao fornecedor
-- Placeholders: {{ne_siafi}}, {{responsavel}}, {{email_responsavel}},
--               {{telefone_responsavel}}, {{fornecedor}}, {{valor}},
--               {{nd}}, {{pag}}, {{subprocesso}}, {{numero}}
INSERT INTO email_templates (tipo, assunto, corpo) VALUES (
  'FORNECEDOR',
  '[GAP-MN] Convocação — Nota de Empenho {{ne_siafi}}',
  'A UNIÃO, por intermédio do GRUPAMENTO DE APOIO DE MANAUS - GAP-MN, está convocando V.Sa., por meio da Nota de Empenho nº {{ne_siafi}}, juntada em anexo. Solicito a esta Empresa que atentem para as seguintes informações:

1 - LEIA ATENTAMENTE AS INFORMAÇÕES CONTIDAS NO EMPENHO EM ANEXO, ESPECIFICAMENTE: SOBRE A ESPÉCIE DO EMPENHO, PODENDO SER * EMPENHO DE DESPESA = PARA FORNECER OU ANULAÇÃO = CANCELAMENTO DE OUTRO EMPENHO;

2 - SENDO EMPENHO DE DESPESA, A EMPRESA DEVE FORNECER E ATENTAR-SE PARA O PRAZO DE ENTREGA CONSTANTE NO TERMO DE REFERÊNCIA DO PREGÃO GERADOR DO EMPENHO PELO QUAL ESTEJA SENDO CONVOCADO; OU

3 - SENDO EMPENHO DE ANULAÇÃO, DESCONSIDERAR (SE HOUVER) CONVOCAÇÃO ANTERIOR PARA FORNECIMENTO DO OBJETO DO EMPENHO ANULADO;

4 - TRATANDO-SE DE EMPENHO PARA FORNECIMENTO, OS OBJETOS E/OU SERVIÇOS DEVEM SER ENTREGUES ACOMPANHADOS DA NOTA FISCAL NO ENDEREÇO SEGUINTE:

LOCAL: SERIPA VII - Sétimo Serviço Regional de Investigação e Prevenção de Acidentes Aeronáuticos
Endereço: Av. Santos Dumont, S/Nº - Tarumã — CEP: 69.041.000 - Manaus-AM — Tel: (92) 3652-5872


CONTATO DO MILITAR RESPONSÁVEL:

{{responsavel}} — {{email_responsavel}}
{{telefone_responsavel}}


5 - CASO A EMPRESA VENHA NECESSITAR DE ALGUMA DAS INFORMAÇÕES ABAIXO RELACIONADA, POR FAVOR CONTATAR OS SETORES RESPONSÁVEIS:

NOTA FISCAL — Seção de Almoxarifado: (92) 3652-5822 / 5824 / 5825 — e-mail: moraeslfm@fab.mil.br
LIQUIDAÇÃO — Seção de Liquidação: (92) 3614-1569 — e-mail: moraeslfm@fab.mil.br
PAGAMENTO — Seção de Finanças: (92) 3614-1526 — e-mail: HELTONHTS@fab.mil.br

Por fim, esta Administração salienta que, caso a Empresa não cumpra o prazo estabelecido no referido termo, esta estará sujeita a sanções conforme prevê no edital, bem como as normas legais aplicáveis ao processo licitatório, após processo administrativo que assegurem a ampla defesa e o contraditório.

* POR GENTILEZA ACUSAR RECEBIMENTO.

DIVISÃO ADMINISTRATIVA DO GAP-MN
TELEFONE: (92) 3614-1569'
) ON CONFLICT (tipo) DO NOTHING;
