-- Catálogo de Indicadores de Desempenho dos GAPs, versão GAP/CAE (out/2026), e os quadros do FAsGov-DIRAD
-- que ainda não eram coletados (acompanhamento dos indícios do e-Pessoal, montantes do ressarcimento ao
-- erário e Fala.BR). Depende de 20261022_governanca_coleta.sql.
--
-- O que muda:
-- - gov_indicadores ganha `orientacao` (como preencher, do FAQ do catálogo) e `desde` (primeira competência
--   em que o indicador é cobrado: os novos não aparecem como "falta informar" nos meses anteriores).
-- - Dois cálculos novos: 'reducao' (FAQ 14: percentual de redução; sem redução = 0, nunca negativo) para os
--   IDs 16 e 22, e 'soma' (FAQ 17: tempo de recebimento = média do item 5 + média do item 6 do MAC/SILOMS)
--   para o ID 26. Os IDs 27 e 28 passam a valor direto (FAQ 17: média tirada da tela, sem cálculo).
-- - gov_lancamentos ganha `calculo` (o cálculo vigente quando o lançamento foi salvo). O painel e a planilha
--   só mostram as variáveis de um mês com os nomes atuais quando o cálculo é o mesmo; nos meses antigos dos
--   IDs 26, 27 e 28 fica só o resultado, que não muda.

-- ── 1. Colunas novas e cálculos aceitos ─────────────────────────────────────────────────────
ALTER TABLE public.gov_indicadores ADD COLUMN IF NOT EXISTS orientacao text;
ALTER TABLE public.gov_indicadores ADD COLUMN IF NOT EXISTS desde text;
ALTER TABLE public.gov_indicadores DROP CONSTRAINT IF EXISTS gov_indicadores_desde_check;
ALTER TABLE public.gov_indicadores ADD CONSTRAINT gov_indicadores_desde_check
  CHECK (desde IS NULL OR desde ~ '^[0-9]{4}-(0[1-9]|1[0-2])$');
ALTER TABLE public.gov_indicadores DROP CONSTRAINT IF EXISTS gov_indicadores_calculo_check;
ALTER TABLE public.gov_indicadores ADD CONSTRAINT gov_indicadores_calculo_check
  CHECK (calculo IN ('razao', 'percentual', 'disponibilidade', 'variacao', 'reducao', 'soma', 'taxa_ajustada', 'direto'));

ALTER TABLE public.gov_lancamentos ADD COLUMN IF NOT EXISTS calculo text;
-- tudo o que já foi lançado ficou com o cálculo de hoje (antes das trocas abaixo)
UPDATE public.gov_lancamentos l SET calculo = i.calculo
  FROM public.gov_indicadores i WHERE i.id = l.indicador_id AND l.calculo IS NULL;

-- ── 2. Cálculo (espelho de src/lib/governanca/formulas.ts) ──────────────────────────────────
CREATE OR REPLACE FUNCTION public.gov_calcular(p_calculo text, v1 numeric, v2 numeric, v3 numeric)
RETURNS numeric LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT CASE p_calculo
    WHEN 'direto'          THEN v1
    WHEN 'razao'           THEN CASE WHEN v1 IS NULL OR v2 IS NULL OR v2 = 0 THEN NULL ELSE v1 / v2 END
    WHEN 'percentual'      THEN CASE WHEN v1 IS NULL OR v2 IS NULL OR v2 = 0 THEN NULL ELSE v1 / v2 * 100 END
    WHEN 'disponibilidade' THEN CASE WHEN v1 IS NULL OR v2 IS NULL OR v1 = 0 THEN NULL ELSE (v1 - v2) / v1 * 100 END
    -- legado (até OUT/26 nos IDs 16 e 22): variação em módulo
    WHEN 'variacao'        THEN CASE WHEN v1 IS NULL OR v2 IS NULL OR v2 = 0 THEN NULL ELSE abs((v1 - v2) / v2 * 100) END
    -- FAQ 14: v1 = atual, v2 = anterior; havendo redução, o percentual reduzido; sem redução, 0
    WHEN 'reducao'         THEN CASE WHEN v1 IS NULL OR v2 IS NULL OR v2 = 0 THEN NULL
                                     WHEN v1 >= v2 THEN 0 ELSE (v2 - v1) / v2 * 100 END
    -- FAQ 17 (ID 26): média do item 5 + média do item 6
    WHEN 'soma'            THEN CASE WHEN v1 IS NULL OR v2 IS NULL THEN NULL ELSE v1 + v2 END
    WHEN 'taxa_ajustada'   THEN CASE WHEN v1 IS NULL OR v2 IS NULL OR v3 IS NULL OR v2 - v3 = 0 THEN NULL ELSE v1 / (v2 - v3) * 100 END
  END
$$;

-- ── 3. Catálogo: o que mudou nas fichas existentes ──────────────────────────────────────────
UPDATE public.gov_indicadores SET
  variaveis = '["T_pub = dias corridos da entrada do FEP à publicação","N_atos = atos publicados no período"]'::jsonb
WHERE id = '1';

-- o Auxílio-Funeral passou para Finanças e Pagamento de Pessoal
UPDATE public.gov_indicadores SET categoria = '2. FINANÇAS E PAGAMENTO DE PESSOAL' WHERE id = '6';

UPDATE public.gov_indicadores SET
  variaveis = '["T_ata = dias entre o recebimento da mensagem da Junta de Saúde e o cancelamento do desconto do IR","N_atas = atas apresentadas"]'::jsonb
WHERE id = '9';

UPDATE public.gov_indicadores SET
  indicador = 'Tempo Médio de Processamento do Título de Revisão de Reforma ou Aux. Invalidez',
  formula = 'TR = Σ T_título ÷ N_títulos',
  variaveis = '["T_título = dias da entrada do novo título emitido pela SDVP/DIRAP até o efetivo processamento do acerto financeiro","N_títulos = títulos apresentados"]'::jsonb
WHERE id = '10';

UPDATE public.gov_indicadores SET
  variaveis = '["Σ HH = horas líquidas dos técnicos no mês (ver orientação)","N_chamados = chamados atendidos no período"]'::jsonb,
  orientacao = 'Σ HH é a capacidade líquida do mês: nº de auxiliares que atuam no suporte × 8 h × 22 dias úteis, menos as horas de dispensas e licenças (RISAER), de serviços de escala ou comissões publicados e de meios-expedientes. Depois divida pelo nº de chamados atendidos no mês (FAQ 15 do catálogo).'
WHERE id = '12';

UPDATE public.gov_indicadores SET
  calculo = 'reducao',
  formula = 'Redução = ((D_anterior − D_atual) ÷ D_anterior) × 100; sem redução = 0',
  orientacao = 'Informe o total de pendências da OM agora e o do mês anterior; o app calcula a redução. Havendo redução, o resultado é o percentual reduzido; se as pendências não diminuíram, o resultado é 0 (nunca negativo) (FAQ 14 do catálogo).'
WHERE id = '16';

UPDATE public.gov_indicadores SET
  unidade = 'Dias corridos',
  variaveis = '["T_parecer = dias do agendamento à emissão do parecer de deferimento","N_beneficios = nº de benefícios deferidos"]'::jsonb,
  orientacao = 'Considere só os benefícios socioassistenciais do Capítulo VIII da ICA 163-5/2024 (FAQ 16 do catálogo).'
WHERE id = '19';

UPDATE public.gov_indicadores SET
  variaveis = '["V_AVN = valor (R$) das aquisições liquidadas via AVN no período","V_total = valor (R$) de todos os materiais consumidos no período (saída do estoque próprio + adquirido via AVN)"]'::jsonb
WHERE id = '20';

UPDATE public.gov_indicadores SET
  calculo = 'reducao',
  formula = 'Redução = ((S_anterior − S_atual) ÷ S_anterior) × 100; sem redução = 0',
  orientacao = 'Informe o saldo (R$) do estoque próprio agora e o do mês anterior; o app calcula a redução. Havendo redução, o resultado é o percentual reduzido; se o saldo não diminuiu, o resultado é 0 (nunca negativo) (FAQ 14 do catálogo).'
WHERE id = '22';

UPDATE public.gov_indicadores SET
  calculo = 'soma',
  formula = 'TR = média do item 5 (Preparação p/ Recebimento) + média do item 6 (Recebimento)',
  variaveis = '["Média do item 5 — Preparação p/ Recebimento","Média do item 6 — Recebimento"]'::jsonb,
  orientacao = 'Tire as duas médias da tela "Indicadores Gerenciais" do MAC/SILOMS: item 5 (Preparação p/ Recebimento) e item 6 (Recebimento), em dias úteis. O resultado é a soma das duas (FAQ 17 do catálogo).'
WHERE id = '26';

UPDATE public.gov_indicadores SET
  calculo = 'direto', formula = 'Tempo médio de liquidação da tela "Indicadores Gerenciais" do MAC/SILOMS', variaveis = '[]'::jsonb,
  orientacao = 'Informe o tempo médio de liquidação como aparece na tela "Indicadores Gerenciais" do MAC/SILOMS, sem cálculo adicional, em horas (a unidade da meta) (FAQ 17 do catálogo).'
WHERE id = '27';

UPDATE public.gov_indicadores SET
  calculo = 'direto', formula = 'Tempo médio de emissão de empenho da tela "Indicadores Gerenciais" do MAC/SILOMS', variaveis = '[]'::jsonb,
  orientacao = 'Informe o tempo médio de emissão de empenho como aparece na tela "Indicadores Gerenciais" do MAC/SILOMS, sem cálculo adicional, em horas (a unidade da meta) (FAQ 17 do catálogo).'
WHERE id = '28';

UPDATE public.gov_indicadores SET
  variaveis = '["HH = horas líquidas da equipe de manutenção no mês (ver orientação)","N_os = OS concluídas"]'::jsonb,
  orientacao = 'HH é a capacidade líquida do mês: nº de auxiliares que executam a manutenção × 8 h × 22 dias úteis, menos as horas de dispensas e licenças (RISAER), de serviços de escala ou comissões publicados e de meios-expedientes. Depois divida pelo nº de OS concluídas no mês (FAQ 15 do catálogo).'
WHERE id = '32';

-- ── 4. Indicadores novos (cobrados a partir de OUT/26) ─────────────────────────────────────
INSERT INTO public.gov_indicadores (id, divisao, categoria, indicador, unidade, formula, calculo, variaveis, meta_txt, meta_num, direcao, planejado, ordem, desde, orientacao) VALUES
  -- catálogo GAP/CAE: Serviço Social
  ('62', 'ASESO', '7. SERVIÇO SOCIAL', 'Indicador de Efetividade da Concessão de Benefícios Socioassistenciais (Físico)', 'Percentual (%)',
   'E_fis = (Q_pagos ÷ Q_concedidos) × 100', 'percentual',
   '["Q_pagos = quantidade total de benefícios pagos no período","Q_concedidos = quantidade total de benefícios concedidos no período"]'::jsonb,
   '100%', 100, 'Maior é melhor', false, 22, '2026-10', NULL),
  ('63', 'ASESO', '7. SERVIÇO SOCIAL', 'Indicador de Efetividade da Concessão de Benefícios Socioassistenciais (Financeiro)', 'Percentual (%)',
   'E_fin = (V_pagos ÷ V_concedidos) × 100', 'percentual',
   '["V_pagos = valor total (R$) dos benefícios pagos","V_concedidos = valor total (R$) dos benefícios concedidos"]'::jsonb,
   '100%', 100, 'Maior é melhor', false, 23, '2026-10', NULL),
  -- FAsGov-DIRAD: acompanhamento dos indícios do e-Pessoal (fora da soma das pendências por tipo)
  ('64', 'ACI', 'Acompanhamento dos indícios do e-Pessoal', 'Indícios com mais de 24 meses', 'Quantidade',
   'Contagem direta (0 = não há)', 'direto', '[]'::jsonb, NULL, NULL, 'Monitoramento', false, 60, '2026-10',
   'Indícios do e-Pessoal ainda em aberto há mais de 24 meses.'),
  ('65', 'ACI', 'Acompanhamento dos indícios do e-Pessoal', 'Indícios comunicados no ano (acumulado)', 'Quantidade',
   'Contagem direta (0 = não há)', 'direto', '[]'::jsonb, NULL, NULL, 'Monitoramento', false, 61, '2026-10',
   'Total do ano até o mês de referência (no FAsGov-DIRAD: "Indícios comunicados em 2026").'),
  ('66', 'ACI', 'Acompanhamento dos indícios do e-Pessoal', 'Indícios esclarecidos no ano (acumulado)', 'Quantidade',
   'Contagem direta (0 = não há)', 'direto', '[]'::jsonb, NULL, NULL, 'Monitoramento', false, 62, '2026-10',
   'Total do ano até o mês de referência (no FAsGov-DIRAD: "Indícios esclarecidos de 2026").'),
  -- FAsGov-DIRAD: montantes do ressarcimento ao erário (em reais, fora da soma dos processos)
  ('67', 'AJUR', 'Ressarcimento ao Erário', 'Montante total apurado (R$)', 'R$',
   'Valor informado', 'direto', '[]'::jsonb, NULL, NULL, 'Monitoramento', false, 71, '2026-10',
   'Valor total em reais, como no quadro "Ressarcimento ao Erário" do FAsGov-DIRAD.'),
  ('68', 'AJUR', 'Ressarcimento ao Erário', 'Montante total em recuperação (R$)', 'R$',
   'Valor informado', 'direto', '[]'::jsonb, NULL, NULL, 'Monitoramento', false, 72, '2026-10',
   'Valor total em reais, como no quadro "Ressarcimento ao Erário" do FAsGov-DIRAD.'),
  ('69', 'AJUR', 'Ressarcimento ao Erário', 'Montante total recuperado (R$)', 'R$',
   'Valor informado', 'direto', '[]'::jsonb, NULL, NULL, 'Monitoramento', false, 73, '2026-10',
   'Valor total em reais, como no quadro "Ressarcimento ao Erário" do FAsGov-DIRAD.'),
  -- FAsGov-DIRAD: Fala.BR. Recebidas na linha Planejado, resolvidas/respondidas na linha Realizado:
  -- o painel mostra "resolvidas ou respondidas / recebidas · % atingido", como o quadro do FAsGov.
  ('70', 'SEC', 'Fala.BR (Ouvidoria e LAI)', 'Ouvidoria — manifestações', 'Quantidade',
   'Contagem direta (0 = não há)', 'direto', '["Resolvidas ou respondidas","Recebidas"]'::jsonb, NULL, NULL, 'Monitoramento', true, 74, '2026-10',
   'Manifestações da Ouvidoria (Fala.BR / e-OUV) recebidas no mês e quantas foram resolvidas. O % atingido é calculado aqui.'),
  ('71', 'SEC', 'Fala.BR (Ouvidoria e LAI)', 'LAI — pedidos de acesso à informação', 'Quantidade',
   'Contagem direta (0 = não há)', 'direto', '["Resolvidas ou respondidas","Recebidas"]'::jsonb, NULL, NULL, 'Monitoramento', true, 75, '2026-10',
   'Pedidos de acesso à informação (SIC / Fala.BR) recebidos no mês e quantos foram respondidos. O % atingido é calculado aqui.')
ON CONFLICT (id) DO UPDATE SET divisao = EXCLUDED.divisao, categoria = EXCLUDED.categoria, indicador = EXCLUDED.indicador,
  unidade = EXCLUDED.unidade, formula = EXCLUDED.formula, calculo = EXCLUDED.calculo, variaveis = EXCLUDED.variaveis,
  meta_txt = EXCLUDED.meta_txt, meta_num = EXCLUDED.meta_num, direcao = EXCLUDED.direcao, planejado = EXCLUDED.planejado,
  ordem = EXCLUDED.ordem, desde = EXCLUDED.desde, orientacao = EXCLUDED.orientacao, ativo = true;

-- ordem do catálogo novo (os do Serviço Social entram depois do 19) e dos grupos à parte
UPDATE public.gov_indicadores i SET ordem = o.n FROM (VALUES
  ('1',1),('2',2),('3',3),('4',4),('5',5),('6',6),('7',7),('8',8),('9',9),('10',10),('11',11),('12',12),('13',13),('14',14),
  ('15',15),('16',16),('17.1',17),('17.2',18),('17.3',19),('18',20),('19',21),('62',22),('63',23),('20',24),('21',25),('22',26),
  ('23',27),('24.1',28),('24.2',29),('24.3',30),('25',31),('26',32),('27',33),('28',34),('29',35),('30',36),('31',37),('32',38),
  ('33',39),('34',40),('35',41),
  ('36',42),('37',43),('38',44),('39',45),('40',46),('41',47),('42',48),('43',49),('44',50),('45',51),('46',52),('47',53),
  ('48',54),('49',55),('50',56),('51',57),('52',58),('53',59),('64',60),('65',61),('66',62),
  ('54',63),('55',64),('56',65),('57',66),('58',67),('59',68),('60',69),('61',70),('67',71),('68',72),('69',73),('70',74),('71',75)
) AS o(id, n) WHERE i.id = o.id;

-- ── 5. Lançamentos já gravados ──────────────────────────────────────────────────────────────
DO $$
BEGIN
  -- recálculo por regra nova não é alteração de quem preencheu: fica fora do histórico
  PERFORM set_config('gov.importando', 'sim', true);
  -- IDs 16 e 22 pela regra da redução (FAQ 14); as variáveis continuam as mesmas (atual e anterior)
  UPDATE public.gov_lancamentos
     SET valor = public.gov_calcular('reducao', v1, v2, v3), calculo = 'reducao'
   WHERE indicador_id IN ('16', '22') AND v1 IS NOT NULL AND v2 IS NOT NULL;
  UPDATE public.gov_lancamentos SET calculo = 'reducao'
   WHERE indicador_id IN ('16', '22') AND (v1 IS NULL OR v2 IS NULL);
  -- IDs 27 e 28 na coleta aberta: o resultado já gravado vira o valor informado (mesmo número)
  UPDATE public.gov_lancamentos l
     SET v1 = l.valor, v2 = NULL, v3 = NULL, calculo = 'direto'
    FROM public.gov_competencias c
   WHERE c.codigo = l.competencia AND c.aberta AND l.indicador_id IN ('27', '28') AND l.calculo <> 'direto';
  PERFORM set_config('gov.importando', '', true);
END $$;

-- ── 6. Funções: formulário, gravação e leitura do painel ────────────────────────────────────
CREATE OR REPLACE FUNCTION public.gov_formulario(p_token text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE c public.gov_competencias;
BEGIN
  c := public.gov_competencia_do_link(p_token, false);
  RETURN jsonb_build_object(
    'competencia', jsonb_build_object('codigo', c.codigo, 'rotulo', c.rotulo, 'aberta', c.aberta, 'prazo', c.prazo),
    'indicadores', (SELECT coalesce(jsonb_agg(jsonb_build_object('id', i.id, 'divisao', i.divisao, 'categoria', i.categoria,
        'indicador', i.indicador, 'unidade', i.unidade, 'formula', i.formula, 'calculo', i.calculo, 'variaveis', i.variaveis,
        'meta_txt', i.meta_txt, 'meta_num', i.meta_num, 'direcao', i.direcao, 'planejado', i.planejado, 'ordem', i.ordem,
        'orientacao', i.orientacao, 'desde', i.desde)
        ORDER BY i.ordem), '[]'::jsonb)
      FROM public.gov_indicadores i WHERE i.ativo AND (i.desde IS NULL OR i.desde <= c.codigo)),
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
    IF NOT FOUND OR ind.divisao <> p_divisao OR (ind.desde IS NOT NULL AND ind.desde > c.codigo) THEN
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
    INSERT INTO public.gov_lancamentos AS l (competencia, indicador_id, tipo, v1, v2, v3, valor, calculo, comentario, anexo, anexo_nome,
                                             posto, nome_guerra, divisao, atualizado_em, versao)
    VALUES (c.codigo, ind.id, v_tipo, a1, a2, a3, public.gov_calcular(ind.calculo, a1, a2, a3), ind.calculo, left(v_com, 2000), v_anexo,
            CASE WHEN v_anexo IS NULL THEN NULL ELSE left(nullif(btrim(coalesce(it->>'anexo_nome', '')), ''), 200) END,
            v_posto, v_nome, p_divisao, now(), 1)
    ON CONFLICT (competencia, indicador_id, tipo) DO UPDATE SET
      v1 = EXCLUDED.v1, v2 = EXCLUDED.v2, v3 = EXCLUDED.v3, valor = EXCLUDED.valor, calculo = EXCLUDED.calculo, comentario = EXCLUDED.comentario,
      -- sem anexo novo, fica o que já estava
      anexo = coalesce(EXCLUDED.anexo, l.anexo), anexo_nome = CASE WHEN EXCLUDED.anexo IS NULL THEN l.anexo_nome ELSE EXCLUDED.anexo_nome END,
      posto = EXCLUDED.posto, nome_guerra = EXCLUDED.nome_guerra, divisao = EXCLUDED.divisao,
      atualizado_em = now(), versao = l.versao + 1
    WHERE (l.v1, l.v2, l.v3, l.comentario, l.calculo) IS DISTINCT FROM (EXCLUDED.v1, EXCLUDED.v2, EXCLUDED.v3, EXCLUDED.comentario, EXCLUDED.calculo)
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

-- O painel lê daqui. Cada indicador só a partir da competência em que passou a ser cobrado; as variáveis
-- de um mês só saem com os nomes atuais quando foram lançadas com o mesmo cálculo de hoje.
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
        'VAR1_NOME', i.variaveis->>0,
        'VAR1_VALOR', CASE WHEN i.calculo = 'direto' OR l.calculo IS DISTINCT FROM i.calculo THEN NULL ELSE l.v1 END,
        'VAR2_NOME', i.variaveis->>1, 'VAR2_VALOR', CASE WHEN l.calculo IS DISTINCT FROM i.calculo THEN NULL ELSE l.v2 END,
        'VAR3_NOME', i.variaveis->>2, 'VAR3_VALOR', CASE WHEN l.calculo IS DISTINCT FROM i.calculo THEN NULL ELSE l.v3 END,
        'ORIENTACAO', i.orientacao,
        'COMENTARIO', l.comentario, 'TEM_ANEXO', l.anexo IS NOT NULL)
        ORDER BY c.codigo, i.ordem, t.tipo DESC), '[]'::jsonb)
      FROM public.gov_competencias c
      CROSS JOIN public.gov_indicadores i
      CROSS JOIN LATERAL (SELECT 'Realizado'::text AS tipo UNION ALL SELECT 'Planejado' WHERE i.planejado) t
      LEFT JOIN public.gov_lancamentos l ON l.competencia = c.codigo AND l.indicador_id = i.id AND l.tipo = t.tipo
      WHERE i.ativo AND (i.desde IS NULL OR c.codigo >= i.desde)),
    'bd_integridade', '[]'::jsonb,
    'catalogo', '{}'::jsonb,
    'contratos', (SELECT coalesce(jsonb_agg(jsonb_build_object('competencia', k.competencia, 'ordem', k.ordem, 'servico', k.servico,
        'nup', k.nup, 'termino', k.termino, 'status', k.status, 'providencias', k.providencias, 'atualizado_em', k.atualizado_em)
        ORDER BY k.competencia, k.ordem), '[]'::jsonb) FROM public.gov_contratos k)
  );
END;
$$;

-- mesmas permissões da migração de 22/10 (CREATE OR REPLACE mantém, mas o Supabase dá EXECUTE ao anon em toda função)
REVOKE EXECUTE ON FUNCTION public.gov_bd() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.gov_bd() TO authenticated;
GRANT EXECUTE ON FUNCTION public.gov_formulario(text), public.gov_salvar(text, text, text, text, jsonb, jsonb) TO anon, authenticated;
