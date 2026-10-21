// Classificação dos objetos empenhados em categorias (engenharia, informática, saúde...).
// A planilha não traz categoria: ela vem da natureza de despesa e de palavras do item
// (a descrição segue o catálogo do Compras.gov.br, com o nome do item antes da primeira vírgula).
// As regras foram calibradas com os empenhos de 2026 do GAP-MN: menos de 1% do valor fica em "Outros".

export type CategoriaId =
  | "engenharia" | "saude" | "alimentacao" | "utilidades" | "limpeza" | "vigilancia"
  | "tic" | "veiculos" | "deslocamento" | "pessoal" | "equipamentos" | "expediente"
  | "capacitacao" | "tributos" | "exercicios-anteriores" | "outros";

export type Categoria = { id: CategoriaId; nome: string; cor: string; descricao: string };

export const CATEGORIAS: readonly Categoria[] = [
  { id: "engenharia",   nome: "Engenharia e manutenção predial",   cor: "#f59e0b", descricao: "Obras, reformas, manutenção predial, redes de água e esgoto, climatização e materiais de construção" },
  { id: "saude",        nome: "Saúde",                             cor: "#f472b6", descricao: "Assistência médica, exames, reagentes, medicamentos, oxigênio e material hospitalar, odontológico ou veterinário" },
  { id: "alimentacao",  nome: "Alimentação",                       cor: "#4ade80", descricao: "Gêneros alimentícios, refeições e descartáveis de cozinha" },
  { id: "utilidades",   nome: "Energia, água e correios",          cor: "#22d3ee", descricao: "Energia elétrica, água e esgoto, correios e gás de cozinha" },
  { id: "limpeza",      nome: "Limpeza, conservação e resíduos",   cor: "#2dd4bf", descricao: "Limpeza e conservação, roçada, lavanderia, dedetização, controle de fauna e tratamento de resíduos" },
  { id: "vigilancia",   nome: "Vigilância e segurança",            cor: "#94a3b8", descricao: "Vigilância, segurança patrimonial, combate a incêndio, sinalização e EPI" },
  { id: "tic",          nome: "Informática e telecomunicações",    cor: "#a78bfa", descricao: "Serviços de TI, impressão, telefonia, computadores, suprimentos e software" },
  { id: "veiculos",     nome: "Veículos e combustíveis",           cor: "#fb923c", descricao: "Abastecimento, combustíveis, lubrificantes, peças e manutenção de viaturas" },
  { id: "deslocamento", nome: "Diárias, passagens e transporte",   cor: "#60a5fa", descricao: "Diárias, passagens, transporte de pessoal e mudanças" },
  { id: "pessoal",      nome: "Pessoal e benefícios",              cor: "#c084fc", descricao: "Folha, auxílios e indenizações a militares e servidores" },
  { id: "equipamentos", nome: "Equipamentos, mobiliário e fardamento", cor: "#facc15", descricao: "Eletrodomésticos, mobiliário, contêineres, fardamento e material individual" },
  { id: "expediente",   nome: "Expediente e apoio administrativo", cor: "#cbd5e1", descricao: "Material de expediente, gráfica, publicações, almoxarifado e serviços administrativos" },
  { id: "capacitacao",  nome: "Capacitação",                       cor: "#34d399", descricao: "Cursos, treinamentos e inscrições" },
  { id: "tributos",     nome: "Tributos e taxas",                  cor: "#f87171", descricao: "Obrigações tributárias, taxas e licenciamentos" },
  { id: "exercicios-anteriores", nome: "Despesas de exercícios anteriores", cor: "#fda4af", descricao: "Natureza 339092" },
  { id: "outros",       nome: "Outros",                            cor: "#64748b", descricao: "Objetos que nenhuma regra reconheceu" },
];

const POR_ID = new Map(CATEGORIAS.map((c) => [c.id, c]));
export const categoria = (id: CategoriaId): Categoria => POR_ID.get(id) ?? POR_ID.get("outros")!;

/** Texto em maiúsculas, sem acento e com espaços simples, para as regras. */
export function normalizar(s: string): string {
  return s.normalize("NFD").replace(/\p{M}/gu, "").toUpperCase().replace(/\s+/g, " ").trim();
}

/** Naturezas que definem a categoria sozinhas, qualquer que seja o item. */
const POR_NATUREZA: Record<string, CategoriaId> = {
  "319011": "pessoal", "319012": "pessoal", "319013": "pessoal", "319016": "pessoal",
  "339008": "pessoal", "339046": "pessoal", "339049": "pessoal", "339093": "pessoal",
  "339014": "deslocamento", "339015": "deslocamento", "339033": "deslocamento",
  "339040": "tic", "449040": "tic",
  "339047": "tributos",
  "339092": "exercicios-anteriores",
  "449051": "engenharia", "339051": "engenharia",
};

/**
 * Regras por palavra, em ordem: a primeira que casar define a categoria.
 * Os padrões olham primeiro o nome do item (antes da primeira vírgula) e, se nada casar, a descrição inteira.
 */
const REGRAS: readonly (readonly [CategoriaId, RegExp])[] = [
  // serviços públicos antes de "manutenção", porque "energia elétrica" também aparece em obras
  ["utilidades", /\bENERGIA ELETRICA\b|FORNECIMENTO (ANUAL )?DE ENERGIA|AGUA E ESGOTO - FORNECIMENTO|FORNECIMENTO DE AGUA|SANEAMENTO|SERVICOS? POSTA|CORREIOS?\b|GAS (DE COZINHA|LIQUEFEITO)|\bGLP\b|ENTREGA DE CONTA|CONTA - LUZ/],
  ["saude", /ASSISTENCIA MEDIC|HOSPITAL|MEDIC(O|A|AMENTO|INAL)|ODONTO|DENTAL|REAGENTE|DIAGNOSTIC|LABORATORI|EXAME|GINECOLOG|OBSTETRIC|PEDIATR|CARDIOLOG|ORTOPED|FISIOTERAP|PSICOLOG|OXIGENIO|SERINGA|AGULHA|CATETER|LUVA (CIRURG|PROCED|EXAME)|CURATIVO|GAZE|ATADURA|SONDA|ESTERIL|CIRURGIC|ANESTES|VACINA|SORO\b|FARMAC|AMPOLA|COMPRIMIDO|CAPSULA|POMADA|HEMATOLOG|BIOQUIMIC|ACIDO SALICILICO|PROTESE|IMPLANTE|RADIOLOG|ULTRASSOM|TOMOGRAF|RESSONANCIA|MAMOGRAF|ENFERMAGEM|HOME CARE|AMBULATOR|AMOSTRA|BIOLOGIC|DOSIMETR|VETERIN|FLURALANER|ANTIPARASIT/],
  ["alimentacao", /\bCARNE|PEIXE|\bAVE\b|FRANGO|EMBUTIDO|LINGUICA|SALSICHA|PRESUNTO|MORTADELA|FRIOS|QUEIJO|LEITE|IOGURTE|MANTEIGA|MARGARINA|REQUEIJAO|\bOVO|FRUTA|POLPA|LEGUME|VERDURA|LEGUMINOSA|FEIJAO|ARROZ|MACARRAO|FARINHA|ACUCAR|ADOCANTE|\bCAFE\b|\bCHA\b|ACHOCOLATADO|SUCO|REFRIGERANTE|AGUA MINERAL|\bPAO\b|BISCOITO|BOLACHA|\bBOLO|\bDOCE|SORVETE|CONDIMENTO|TEMPERO|MOLHO|OLEO (DE SOJA|COMESTIVEL|VEGETAL)|AZEITE|VINAGRE|SAL (REFINADO|GROSSO)|CEREAL|AVEIA|GRANOLA|MILHO|ALIMENT|REFEICAO|MARMITA|LANCHE|COFFEE|BUFFET|GENERO ALIMENTICIO|RANCHO|COZINHA|DESCARTAVEL|FILME (PVC|EMBALAGEM)|PAPEL ALUMINIO|GUARDANAPO|\bPRATO\b|\bGELO\b/],
  ["vigilancia", /VIGILANCIA|SEGURANCA (PATRIMONIAL|ARMADA|ELETRONICA)|PORTARIA|CONTROLE DE ACESSO|MONITORAMENTO ELETRONICO|EXTINTOR|COMBATE A INCENDIO|BRIGADA|EQUIPAMENTO SEGURANCA|\bEPI\b|CAPACETE|COLETE|\bCONE\b|SINALIZACAO|BOTA SEGURANCA|BOTINA|LUVA (DE )?(PROTECAO|SEGURANCA)|TALABARTE|MOSQUETAO/],
  ["limpeza", /LIMPEZA|CONSERVACAO|ROCADA|JARDINAGEM|PAISAGISMO|LAVANDERIA|DEDETIZ|DESINSET|DESRATIZ|CONTROLE DE PRAGAS|CAPTURA .*ANIMAL|RESIDUO|INCINERACAO|COLETA DE LIXO|DETERGENTE|DESINFETANTE|SABAO|SABONETE|ALCOOL (ETILICO|GEL|70)|AGUA SANITARIA|HIPOCLORITO|PAPEL (HIGIENICO|TOALHA)|TOALHA DE PAPEL|\bSACO\b|VASSOURA|\bRODO\b|ESPONJA|PANO DE CHAO|LIXEIRA|\bCERA\b|LUSTRA|ESPANTAMENTO|\bAVES\b|FAUNA|DESODORIZ|LUVA (DE )?BORRACHA|FLANELA|\bBALDE\b/],
  ["veiculos", /VEICUL|VIATURA|AUTOMOTIV|ABASTECIMENTO|COMBUSTIVEL|GASOLINA|DIESEL|ETANOL|LUBRIFICANTE|OLEO (MOTOR|LUBRIF|HIDRAULICO)|PNEU|CAMARA DE AR|BATERIA (AUTOMOTIVA|VEICULAR)|FILTRO (DE )?(OLEO|AR|COMBUSTIVEL)|PASTILHA DE FREIO|EMBREAGEM|AMORTECEDOR|GUINCHO|REBOQUE|LAVAGEM (DE )?VEICULO/],
  ["tic", /INFORMATICA|COMPUTADOR|NOTEBOOK|DESKTOP|MONITOR (DE VIDEO|LED|LCD)|IMPRESSORA|IMPRESSAO|OUTSOURCING|TONER|CARTUCHO|SOFTWARE|LICENCA (DE )?(USO|SOFTWARE)|\bREDE (LOGICA|DE DADOS)|SWITCH|ROTEADOR|ACCESS POINT|NOBREAK|\bHD\b|\bSSD\b|PEN ?DRIVE|MOUSE|TECLADO|WEBCAM|TELEFONIA|TELEFONE|INTERNET|LINK DE DADOS|FIBRA OPTICA|CABO DE REDE|SERVIDOR DE REDE|DATACENTER|PROJETOR|TABLET|SCANNER|CERTIFICADO DIGITAL|TECNOLOGIA DA INFORMACAO|ENTRONCAMENTO|\bDDR\b|CARTAO PRE-?PAGO|COMUNICACAO (DE DADOS|MOVEL)/],
  // equipamentos antes de engenharia: "REFRIGERADOR" e "MÓVEL DE MADEIRA" não são obra
  ["equipamentos", /MOBILIARIO|\bMOVE(L|IS)\b|UTENSILIOS DE ESCRITORIO|\bMESA\b|CADEIRA|ARMARIO|ESTANTE|ARQUIVO DE ACO|GAVETEIRO|\bSOFA\b|POLTRONA|\bCAMA\b|BELICHE|COLCHAO|TELEVISOR|TELEVISAO|GELADEIRA|REFRIGERADOR|FREEZER|FOGAO|\bFORNO\b|MICRO-?ONDAS|BEBEDOURO|PURIFICADOR|VENTILADOR|APARELHO AR CONDICIONADO|AR CONDICIONADO SPLIT|CONTAINER|CONTEINER|LAVADORA|SECADORA|LIQUIDIFICADOR|BATEDEIRA|CAFETEIRA|ROUPA DE CAMA|LENCOL|FRONHA|TRAVESSEIRO|COBERTOR|CORTINA|PERSIANA|TAPETE|BARRACA|MOCHILA|FARDAMENTO|UNIFORME|VESTUARIO|COTURNO|SAPATO|CAMISA|PALETO|AVENTAL|COLDRE|PERNEIRA|BANDOLEIRA|\bCINTO\b|\bBONE\b|TOUCA|TECIDO|\bBOLSA\b/],
  ["engenharia", /REFORMA|PREDIAL|ENGENHARIA|\bOBRA|CONSTRUCAO|EDIFICA|ALVENARIA|PINTURA|IMPERMEABILIZ|REDES? - AGUA|REDES? DE AGUA|ESGOTO|HIDRAULIC|ELETRIC|AR CONDICIONADO - MANUTENCAO|MANUTENCAO DE APARELHOS DE AR|CLIMATIZ|REFRIGERACAO|COMPRESSOR|ELEVADOR|SUBESTACAO|\bGERADOR|TRANSFORMADOR|CAMARA FRIA|PELICULA|AZULEJO|\bPISO\b|REVESTIMENTO|VASO SANITARIO|ASFALT|FOSSA|DRENAGEM|\bLONA\b|POCO ARTESIANO|CIMENTO|ARGAMASSA|\bAREIA\b|\bBRITA\b|TIJOLO|BLOCO DE CONCRETO|TELHA|TINTA|MASSA (CORRIDA|ACRILICA)|SOLVENTE|THINNER|VERNIZ|\bTUBO|CONEXAO|JOELHO|LUVA (PVC|SOLDAVEL)|REGISTRO|TORNEIRA|VALVULA|ABRACADEIRA|PARAFUSO|\bPREGO|\bBUCHA|DISJUNTOR|LAMPADA|LUMINARIA|\bREATOR|CABO ELETRICO|FIO ELETRICO|TOMADA|INTERRUPTOR|ADAPTADOR|ELETRODUTO|QUADRO DE DISTRIBUICAO|FECHADURA|DOBRADICA|MADEIRA|COMPENSADO|\bVIDRO|FERRAMENTA|\bSERRA\b|\bBROCA|ESCADA|ADESIVO CONEXAO|TELA (SOLDADA|ALAMBRADO)|\bARAME|PORTAO|CAIXA D.?AGUA|BOMBA (D.?AGUA|SUBMERSA|CENTRIFUGA)|DESCARGA|DUCHA|SOLDA|CAPACITOR|SURTO DE TENSAO|\bLIXA\b|BARRA METAL|LINHA VIVA/],
  ["capacitacao", /TREINAMENTO|CAPACITACAO|\bCURSO|INSCRICAO|SEMINARIO|CONGRESSO|PALESTRA|INSTRUTOR/],
  ["expediente", /EXPEDIENTE|PAPEL (A4|SULFITE|OFICIO)|CANETA|LAPIS|BORRACHA (ESCOLAR|APAGADORA)|GRAMPEADOR|GRAMPO (PARA )?GRAMPEADOR|\bCLIPE|PASTA (SUSPENSA|CATALOGO|AZ)|ENVELOPE|ETIQUETA|CARIMBO|AGENDA|\bLIVRO|ENCADERNACAO|GRAFIC|IMPRESSOS|PLACA DE IDENTIFICACAO|ALMOXARIFADO|APOIO ADMINISTRATIVO|RECEPCAO|SECRETARIADO|DIGITALIZACAO|ARQUIVO|BANDEIRA|FLAMULA|MEDALHA|TROFEU|DIPLOMA|EVENTO|CERIMONIAL|LOCACAO DE (IMOVEL|SALA|ESPACO)|PUBLICAC|CARTAO MAGNETICO/],
];

/** Nome do item: "Item compra: 00027 - BISCOITO, TIPO..." → "BISCOITO". Sem item de compra, a descrição da NE. */
export function nomeDoItem(descricao: string): string {
  const texto = (descricao ?? "").replace(/\s+/g, " ").trim();
  if (!/^item\s*compra/i.test(texto)) return texto;
  const semPrefixo = texto.replace(/^item\s*compra\s*:\s*\d+\s*-\s*/i, "");
  return (semPrefixo.split(",")[0] ?? semPrefixo).trim();
}

/** Categoria de um item pela natureza de despesa e pelo texto do item (e da NE, como reforço). */
export function classificar(natureza: string, descricaoItem: string, descricaoNE = ""): CategoriaId {
  const nd = (natureza ?? "").replace(/\D/g, "").slice(0, 6);
  const fixa = POR_NATUREZA[nd];
  if (fixa) return fixa;

  const nome = normalizar(nomeDoItem(descricaoItem));
  const completo = normalizar(`${descricaoItem} ${descricaoNE}`);
  for (const [id, re] of REGRAS) if (re.test(nome)) return id;
  for (const [id, re] of REGRAS) if (re.test(completo)) return id;

  if (nd === "449052") return "equipamentos";
  return "outros";
}
