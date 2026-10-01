/**
 * Mapa central de seletores DOM do Contratos.gov.br.
 * Atualizar aqui quando o site mudar — não usar seletores hardcoded em outro lugar.
 *
 * FONTE: HTML real capturado do site (F12 → Elements → Copy outerHTML)
 * Versão do layout: AdminLTE + Bootstrap 3 + jQuery 3.3.1 + select2
 */

export const STEPPER = {
  // Container dos botões de etapa
  container: '#rowCabecalho',
  // Cada etapa: .btn.btn-app dentro do container
  stepButtons: '#rowCabecalho .btn-app',
  // Círculo com número: .circulo dentro de cada .btn-app
  stepCircle: '.circulo',
};

export const STEP1 = {
  // Tipo de empenho (radio buttons)
  radioContrato:     '#opc_contrato',      // value="1"
  radioCompra:       '#opc_compra',        // value="2"
  radioSuprimento:   '#opc_suprimento',    // value="3"
  radioMercadoGov:   '#opc_mercado_gov',   // value="4"

  // select2 AJAX — Contrato (habilitado apenas quando radio=Contrato)
  selectContrato:    '#select2_ajax_id',
  selectContratoId:  'select2_ajax_id',     // ID sem #

  // select2 array — Modalidade de compra
  selectModalidade:  '#modalidade_id',
  // Valores das opções de modalidade:
  // "76" = 05 - Pregão  (padrão para 90XXX)
  // "74" = 06 - Dispensa
  // "75" = 07 - Inexigibilidade
  // "73" = 01 - Convite
  // "77" = 02 - Tomada de Preços
  // "71" = 03 - Concorrência

  // Input texto — Número/Ano da compra (ex: "90007/2025")
  inputNumeroAno:    '#numero_ano',

  // select2 AJAX — Unidade Compradora (ex: "120630 - GAP-MN")
  selectUnidadeCompra: '#select2_ajax_unidade_origem_id',

  // select2 AJAX — Unidade Beneficiária (opcional)
  selectUasgBenef:   '#select2_ajax_uasg_beneficiaria_id',

  // Botão "Próxima Etapa" — type=button com handler jQuery
  btnProxima:        'button.submeter',
};

// Etapas 2–8: seletores serão adicionados aqui conforme HTMLs reais forem fornecidos
export const STEP2 = {
  // TODO: adicionar após receber HTML da Etapa 2 (Fornecedor)
  // Esperados: DataTable de fornecedores, campo de pesquisa, checkbox de seleção
  tableSearch:       '[id*="DataTables_Table"] ~ * input[type="search"], .dataTables_filter input',
  tablePageSize:     'select[name*="_length"]',
  checkBtn:          null, // preencher com seletor real após ver HTML
  btnProxima:        'button.submeter',
};

export const STEP3 = {
  // TODO: Etapa 3 — Itens
  tableSearch:       '.dataTables_filter input',
  tablePageSize:     'select[name*="_length"]',
  itemCheckbox:      null, // preencher
  btnProxima:        'button.submeter',
};

export const STEP4 = {
  // TODO: Etapa 4 — Crédito disponível
  tableSearch:       '.dataTables_filter input',
  tablePageSize:     'select[name*="_length"]',
  creditoRow:        null, // preencher
  btnProxima:        'button.submeter',
};

export const STEP5 = {
  // TODO: Etapa 5 — Subelemento
  tablePageSize:     'select[name*="_length"]',
  subelementoSelect: null, // preencher — provavelmente select por linha
  qtdInput:          null, // preencher — input de quantidade por linha
  btnProxima:        'button.submeter',
};

export const STEP6 = {
  // TODO: Etapa 6 — Dados Empenho
  inputDataEmissao:  null, // date input
  selectTipoEmpenho: '#tipo_empenho_id', // select2 (Ordinário/Estimativo/Global) — escolhido pelo texto em steps/step6.js
  inputNumProcesso:  null,
  selectAmparoLegal: null, // select2 (busca por "14.133")
  inputLocalEntrega: null,
  textareaObs:       null,
  btnProxima:        'button.submeter',
};

export const STEP7 = {
  // TODO: Etapa 7 — Passivo Anterior (normalmente só avançar)
  btnProxima:        'button.submeter',
};

export const STEP8 = {
  // TODO: Etapa 8 — Finalizar (CHECKPOINT HUMANO — robô PARA aqui)
  btnEmitir:         null, // NÃO clicar sem confirmação humana explícita
  resumoContainer:   null, // ler resumo para diff
};
