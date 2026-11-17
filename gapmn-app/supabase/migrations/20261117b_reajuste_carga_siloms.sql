-- Carga de contratos do SILOMS na ferramenta de Reajustes (arquivo carga_contratos_AAAA-MM-DD.json da SCON).
-- O que o motor usa continua em contratos_apostilamento.dados (a importação junta a carga ao que já estava);
-- o resto do registro da carga (dados da tela do SILOMS, documentos assinados, último empenho) fica em
-- `carga`, para conferência na tela. situacao_cadastro/pendencias são recalculadas pelo app a cada
-- importação e a cada vez que o cadastro é salvo (regra do validar_registro da SCON).
alter table public.contratos_apostilamento
  add column if not exists carga             jsonb,
  add column if not exists carga_em          timestamptz,
  add column if not exists situacao_cadastro text check (situacao_cadastro in ('COMPLETO', 'PENDENTE', 'NAO_SE_APLICA')),
  add column if not exists pendencias        jsonb not null default '[]'::jsonb,
  -- última vez que alguém salvou o cadastro na tela (a importação não mexe): a carga só substitui o que
  -- foi digitado no app se a coleta for de um dia depois desta edição
  add column if not exists editado_no_app_em timestamptz;

comment on column public.contratos_apostilamento.carga is 'Registro da carga do SILOMS (siloms, documentos, ultimo_empenho…) sem os dados do motor';
comment on column public.contratos_apostilamento.situacao_cadastro is 'COMPLETO = pode gerar os documentos; PENDENTE = ver pendencias; NAO_SE_APLICA = dedicação exclusiva';
