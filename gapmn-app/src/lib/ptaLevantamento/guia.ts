// Textos do guia do formulário (os mesmos da aba "Como preencher" da planilha, ajustados para a tela).

export type ItemGuia = { rotulo?: string; texto: string };
export type SecaoGuia = { titulo: string; itens: ItemGuia[] };

export const PARA_QUE_SERVE = (ano: number) =>
  `O PTA (Programa de Trabalho Anual) é o plano do GAP-MN para ${ano}. O que não estiver no PTA aprovado não pode ser executado como planejamento nem lançado no GPAer, o sistema da Aeronáutica onde a DIRAD acompanha o PTA (Of nº 37/CGOV/17513, item 4).`;

export const COMO_FUNCIONA = [
  "Cadastre um projeto, uma atividade ou uma lista de necessidades por vez, do começo ao fim. No final, você pode cadastrar outro.",
  "Escreva com as suas palavras. Ninguém precisa saber códigos, natureza de despesa ou PI: a APLG completa essa parte.",
  "Depois de enviar, você pode voltar por este mesmo link para editar ou excluir o que cadastrou.",
];

export const PROJETO_OU_ATIVIDADE: ItemGuia[] = [
  { rotulo: "Projeto", texto: "Tem data para acabar e entrega algo novo ou melhor no fim. Exemplos: reforma do hotel de trânsito, aquisição de ferramentas para a oficina, implantação de um sistema, mudança de layout de um setor, capacitação de uma turma." },
  { rotulo: "Atividade", texto: "É rotina: continua o ano todo e se repete. Exemplos: manutenção preventiva dos aparelhos de ar-condicionado, pagamento de fornecedores, atendimento a veteranos e pensionistas, controle do almoxarifado." },
  { rotulo: "Dica", texto: "Se tem data para terminar, é projeto. Se continua todo mês, é atividade. Na dúvida, escolha o que achar melhor e explique em \"Observações\"." },
];

export const LISTA_NECESSIDADES: ItemGuia = {
  rotulo: "Lista de necessidades",
  texto: "Material ou serviço de que a sua seção precisa e que não faz parte de nenhum projeto ou atividade. Exemplos: cadeiras para a sala de reuniões, manutenção do portão eletrônico.",
};

export const GUIA: SecaoGuia[] = [
  {
    titulo: "Antes de começar: veja o que já está previsto",
    itens: [
      { texto: "A lista \"Já previsto pela DIRAD\" mostra as rotinas que a DIRAD já colocou no PTA de todos os Grupamentos de Apoio (Matriz de Atividades e Tarefas Comuns, versão de novembro de 2026). Essas rotinas já entram no PTA: não precisa cadastrá-las." },
      { texto: "Se quiser acrescentar uma tarefa a uma rotina que já está lá, ou mudar algo nela, cadastre uma atividade e responda \"Sim\" em \"Já existe na Matriz da DIRAD?\"." },
    ],
  },
  {
    titulo: "Projetos",
    itens: [
      { rotulo: "Nome do projeto", texto: "Comece com um substantivo: \"Reforma…\", \"Aquisição…\", \"Implantação…\". Evite siglas que só o seu setor conhece." },
      { rotulo: "O que vai ficar pronto", texto: "O que vai existir quando o projeto terminar. Ex.: \"12 apartamentos reformados\", \"ferramentas entregues à oficina\"." },
      { rotulo: "Por que é necessário", texto: "O problema que o projeto resolve e o que acontece se ele não for feito. Isso ajuda a Chefe a priorizar." },
      { rotulo: "Responsável", texto: "Quem vai acompanhar o projeto durante o ano (posto ou graduação e nome de guerra) e o ramal. A DIRAD exige um responsável em cada linha do PTA (Of nº 37/CGOV/17513, item 3)." },
      { rotulo: "Dinheiro", texto: "Se for preciso comprar ou contratar, diga o valor estimado e o que será comprado. Uma estimativa aproximada já serve." },
    ],
  },
  {
    titulo: "Etapas do projeto",
    itens: [
      { rotulo: "Tarefa", texto: "Os passos que alguém executa. Comece com um verbo: \"Elaborar o projeto básico\", \"Contratar a empresa\", \"Receber as ferramentas\". Informe o mês de início e o de término." },
      { rotulo: "Marco", texto: "Um momento de entrega, como \"Projeto básico aprovado\" ou \"Obra recebida\". O marco não tem duração: informe só o mês em que ele acontece. Todo projeto precisa de pelo menos um marco (Instruções para Lançamento no GPAer)." },
      { rotulo: "Distribuição no ano", texto: "Espalhe as entregas pelo ano: a DIRAD pede entregas nos quatro trimestres (Of nº 37/CGOV/17513, item 3). O formulário mostra em que trimestre cada etapa termina." },
    ],
  },
  {
    titulo: "Atividades",
    itens: [
      { rotulo: "Nome da atividade", texto: "Comece com um substantivo: \"Manutenção…\", \"Controle…\", \"Atendimento…\"." },
      { rotulo: "Item de controle", texto: "O resultado da rotina que vamos acompanhar. Ex.: \"aparelhos de ar-condicionado com manutenção preventiva em dia\"." },
      { rotulo: "Indicador", texto: "O número que mostra se a rotina vai bem: nome, como calcular, unidade, meta e de quanto em quanto tempo será medido. Todo item de controle precisa de um indicador (Instruções para Lançamento no GPAer)." },
      { rotulo: "Tarefas", texto: "O que é feito na rotina, começando com verbo, com a frequência, o prazo (\"até o 5º dia útil\"), o responsável e como comprovar que foi feito (relatório, ordem de serviço, publicação em boletim)." },
    ],
  },
  {
    titulo: "Lista de necessidades",
    itens: [
      { texto: "Use só para o material ou serviço que não faz parte de um projeto ou atividade. O que já está num projeto ou numa atividade fica no cadastro deles: não repita na lista." },
      { rotulo: "Cada necessidade", texto: "Diga se é material ou serviço, o que é e a quantidade. O valor estimado e o motivo são opcionais, mas ajudam a APLG a incluir no PTA." },
      { rotulo: "Sem marca", texto: "Descreva o que precisa sem citar marca de produto nem nome de empresa." },
    ],
  },
  {
    titulo: "Regras de escrita do PTA (DCA 11-1, Anexo G, item IV)",
    itens: [
      { texto: "Projetos e atividades: com substantivo (\"Reforma do…\", \"Controle de…\")." },
      { texto: "Tarefas com verbo no infinitivo (\"Elaborar\", \"Contratar\"); marco descrevendo a entrega (\"Contrato assinado\")." },
      { texto: "Sem marca de produto ou nome de empresa. Sem informação sigilosa: o PTA é um documento ostensivo." },
    ],
  },
  {
    titulo: "Palavras que aparecem no formulário",
    itens: [
      { rotulo: "Projeto", texto: "Esforço com começo e fim que entrega algo novo ou melhor." },
      { rotulo: "Atividade", texto: "Rotina permanente do setor." },
      { rotulo: "Tarefa", texto: "Um passo concreto, com responsável e prazo." },
      { rotulo: "Marco", texto: "Ponto de entrega de um projeto. Não tem duração." },
      { rotulo: "Item de controle", texto: "O resultado de uma atividade que vamos acompanhar." },
      { rotulo: "Indicador e meta", texto: "O número que mede o item de controle e o valor que queremos alcançar." },
      { rotulo: "Trimestre", texto: "1º = jan a mar; 2º = abr a jun; 3º = jul a set; 4º = out a dez." },
      { rotulo: "GPAer", texto: "Sistema da Aeronáutica onde o PTA aprovado é lançado e acompanhado." },
      { rotulo: "PCA", texto: "Plano de Contratações Anual: as compras e contratações previstas para o ano." },
    ],
  },
];

export const FONTES = "Fontes: Of nº 37/CGOV/17513, da DIRAD, de 03/11/2026 (diretrizes complementares do PTA 2027); Instruções para Lançamento no GPAer — PTA 2027 (Anexo C do ofício); Matriz de Atividades e Tarefas Comuns — PTA 2027 (Anexo D); DCA 11-1/2020, Anexo G.";
