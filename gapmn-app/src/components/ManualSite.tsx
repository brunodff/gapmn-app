import { useRef } from "react";

interface Props {
  onClose: () => void;
}

export default function ManualSite({ onClose }: Props) {
  const printRef = useRef<HTMLDivElement>(null);

  function handlePrint() {
    const conteudo = printRef.current?.innerHTML ?? "";
    const janela = window.open("", "_blank", "width=900,height=700");
    if (!janela) return;
    janela.document.write(`
      <!DOCTYPE html>
      <html lang="pt-BR">
      <head>
        <meta charset="UTF-8" />
        <title>Manual GAP-MN</title>
        <style>
          * { box-sizing: border-box; margin: 0; padding: 0; }
          body { font-family: 'Segoe UI', Arial, sans-serif; font-size: 11pt; color: #1e293b; background: white; padding: 20mm 18mm; }
          h1 { font-size: 18pt; color: #0f766e; border-bottom: 2px solid #0f766e; padding-bottom: 6px; margin-bottom: 16px; }
          h2 { font-size: 13pt; color: #0f766e; margin-top: 22px; margin-bottom: 6px; border-left: 4px solid #0f766e; padding-left: 8px; }
          h3 { font-size: 11pt; color: #334155; margin-top: 14px; margin-bottom: 4px; }
          p, li { font-size: 10pt; color: #334155; line-height: 1.55; margin-bottom: 4px; }
          ul, ol { padding-left: 18px; margin-bottom: 8px; }
          table { width: 100%; border-collapse: collapse; margin: 10px 0; font-size: 9.5pt; }
          th { background: #0f766e; color: white; padding: 6px 8px; text-align: left; }
          td { padding: 5px 8px; border-bottom: 1px solid #e2e8f0; vertical-align: top; }
          tr:nth-child(even) td { background: #f8fafc; }
          .badge { display: inline-block; padding: 2px 7px; border-radius: 9px; font-size: 8.5pt; font-weight: 600; }
          .seo { background: #dcfce7; color: #166534; }
          .scon { background: #dbeafe; color: #1e40af; }
          .slic { background: #fef9c3; color: #854d0e; }
          .admin { background: #ede9fe; color: #6b21a8; }
          .section-box { border: 1px solid #e2e8f0; border-radius: 8px; padding: 12px 14px; margin-bottom: 10px; }
          .tip { background: #f0fdf4; border-left: 3px solid #16a34a; padding: 6px 10px; margin: 8px 0; font-size: 9.5pt; }
          @media print {
            body { padding: 12mm; }
            h2 { page-break-before: auto; }
          }
        </style>
      </head>
      <body>${conteudo}</body>
      </html>
    `);
    janela.document.close();
    janela.focus();
    setTimeout(() => { janela.print(); }, 500);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/50 overflow-y-auto py-6 px-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-4xl">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b sticky top-0 bg-white rounded-t-2xl z-10">
          <div>
            <h1 className="text-lg font-bold text-slate-900">Manual do Sistema GAP-MN</h1>
            <p className="text-xs text-slate-500">Guia completo de uso e funcionalidades</p>
          </div>
          <div className="flex gap-2">
            <button onClick={handlePrint}
              className="rounded-xl bg-emerald-600 px-4 py-2 text-sm text-white hover:bg-emerald-700 font-medium">
              Imprimir / Salvar PDF
            </button>
            <button onClick={onClose}
              className="rounded-xl border border-slate-200 px-4 py-2 text-sm text-slate-600 hover:bg-slate-50">
              Fechar
            </button>
          </div>
        </div>

        {/* Content */}
        <div ref={printRef} className="px-6 py-6 space-y-6 text-sm text-slate-700">

          {/* Capa */}
          <div className="text-center border-b pb-6">
            <h1 className="text-2xl font-bold text-emerald-700 mb-1">MANUAL DO SISTEMA GAP-MN</h1>
            <p className="text-slate-500 text-xs">Aplicativo de Gestão Administrativa e de Processos — 1ª Edição · 2026</p>
          </div>

          {/* 1. Visão Geral */}
          <section>
            <h2 className="text-base font-bold text-emerald-700 border-l-4 border-emerald-600 pl-3 py-0.5 mb-3">
              1. Visão Geral do Sistema
            </h2>
            <p className="mb-2">
              O <strong>GAP-MN</strong> é um aplicativo web desenvolvido para apoiar a gestão administrativa da unidade, permitindo o acompanhamento de contratos, processos licitatórios, indicadores de lotação orçamentária e empenhos em um único ambiente integrado.
            </p>
            <p>
              O sistema conta ainda com um <strong>assistente virtual (chatbot)</strong> que responde perguntas sobre os dados cadastrados, facilitando consultas rápidas sem necessidade de navegar pelas abas.
            </p>
          </section>

          {/* 2. Perfis de Acesso */}
          <section>
            <h2 className="text-base font-bold text-emerald-700 border-l-4 border-emerald-600 pl-3 py-0.5 mb-3">
              2. Perfis de Acesso e Permissões
            </h2>
            <p className="mb-3">Cada usuário possui um setor e um nível de acesso que define o que pode visualizar e modificar.</p>
            <table>
              <thead>
                <tr>
                  <th>Perfil</th>
                  <th>Caixa de Mensagens</th>
                  <th>Indicadores de Lotação</th>
                  <th>Contratos (SCON)</th>
                  <th>Processos (SLIC)</th>
                  <th>Pode Importar</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td><span className="inline-block px-2 py-0.5 rounded-full text-xs font-semibold bg-green-100 text-green-800">SEO</span></td>
                  <td>Somente SEO</td>
                  <td>Ver + Importar</td>
                  <td>Somente visualizar</td>
                  <td>Somente visualizar</td>
                  <td>Indicadores e Empenhos</td>
                </tr>
                <tr>
                  <td><span className="inline-block px-2 py-0.5 rounded-full text-xs font-semibold bg-blue-100 text-blue-800">SCON</span></td>
                  <td>Somente SCON</td>
                  <td>Somente visualizar</td>
                  <td>Ver + Importar</td>
                  <td>Somente visualizar</td>
                  <td>Contratos</td>
                </tr>
                <tr>
                  <td><span className="inline-block px-2 py-0.5 rounded-full text-xs font-semibold bg-yellow-100 text-yellow-800">SLIC</span></td>
                  <td>Somente SLIC</td>
                  <td>Somente visualizar</td>
                  <td>Somente visualizar</td>
                  <td>Ver + Sincronizar</td>
                  <td>Processos</td>
                </tr>
                <tr>
                  <td><span className="inline-block px-2 py-0.5 rounded-full text-xs font-semibold bg-purple-100 text-purple-800">ADMIN</span></td>
                  <td>Todas as caixas</td>
                  <td>Ver + Importar</td>
                  <td>Ver + Importar</td>
                  <td>Ver + Sincronizar</td>
                  <td>Tudo</td>
                </tr>
              </tbody>
            </table>
          </section>

          {/* 3. Caixa do Setor */}
          <section>
            <h2 className="text-base font-bold text-emerald-700 border-l-4 border-emerald-600 pl-3 py-0.5 mb-3">
              3. Caixa do Setor
            </h2>
            <p className="mb-2">
              Exibe as mensagens e solicitações enviadas pelos militares/servidores por meio do formulário público de contato. Cada setor (SEO, SCON, SLIC) vê apenas as mensagens direcionadas a ele. O ADMIN vê todas.
            </p>
            <h3 className="font-semibold text-slate-800 mb-1">Como responder uma mensagem:</h3>
            <ol className="list-decimal pl-5 space-y-1 mb-2">
              <li>Clique na mensagem na lista para selecioná-la</li>
              <li>Digite a resposta no campo de texto</li>
              <li>Clique em <strong>Responder</strong></li>
            </ol>
            <p className="text-xs text-slate-500 italic">Status: <strong>Aberto</strong> = aguardando resposta · <strong>Respondido</strong> = resposta enviada · <strong>Encerrado</strong> = atendimento concluído</p>
          </section>

          {/* 4. Indicadores de Lotação */}
          <section>
            <h2 className="text-base font-bold text-emerald-700 border-l-4 border-emerald-600 pl-3 py-0.5 mb-3">
              4. Indicadores de Lotação
            </h2>
            <p className="mb-2">
              Os <strong>Indicadores de Lotação</strong> representam as contas correntes orçamentárias da unidade, obtidas diretamente do SILOMS. Cada indicador agrupa uma ou mais <strong>Notas de Crédito</strong> que autorizam gastos sob aquele código.
            </p>

            <h3 className="font-semibold text-slate-800 mb-1">Como importar a planilha:</h3>
            <ol className="list-decimal pl-5 space-y-1 mb-3">
              <li>Acesse o <strong>SILOMS</strong></li>
              <li>Vá em: <strong>Indicador de Lotação → Gerenciamento de Indicador de Lotação</strong></li>
              <li>Clique em <strong>Pesquisar</strong></li>
              <li>Clique no botão verde <strong>Importar em Excel</strong></li>
              <li>No sistema GAP-MN, clique em <strong>Importar Excel</strong> na aba "Indicadores de Lotação"</li>
            </ol>
            <div className="bg-green-50 border-l-4 border-green-500 p-3 rounded mb-3 text-xs">
              <strong>Importação diária:</strong> O sistema identifica automaticamente linhas duplicadas (mesmo Indicador + mesma Nota de Crédito) e as ignora, importando apenas registros novos.
            </div>

            <h3 className="font-semibold text-slate-800 mb-1">Colunas exibidas:</h3>
            <table>
              <thead><tr><th>Coluna</th><th>Significado</th></tr></thead>
              <tbody>
                <tr><td><strong>Indicador (Conta Corrente)</strong></td><td>Código único do indicador orçamentário (ex: C26001)</td></tr>
                <tr><td><strong>Descrição</strong></td><td>Nome/objeto do indicador</td></tr>
                <tr><td><strong>UG CRED</strong></td><td>Unidade Gestora Credora — de onde saem os recursos</td></tr>
                <tr><td><strong>Natureza</strong></td><td>Natureza da despesa (ex: 339030 = material de consumo)</td></tr>
                <tr><td><strong>PTRES</strong></td><td>Programa de Trabalho Resumido — classifica o programa orçamentário</td></tr>
                <tr><td><strong>PI (Plano Interno)</strong></td><td>Código interno que detalha a aplicação dos recursos</td></tr>
                <tr><td><strong>Ação</strong></td><td>Código da ação orçamentária vinculada</td></tr>
                <tr><td><strong>Dotação</strong></td><td>Valor total aprovado (orçado)</td></tr>
                <tr><td><strong>Utilizado</strong></td><td>Valor já empenhado/executado</td></tr>
                <tr><td><strong>Saldo</strong></td><td>Diferença entre Dotação e Utilizado — valor disponível para empenho</td></tr>
                <tr><td><strong>NC (Notas de Crédito)</strong></td><td>Quantidade de notas de crédito vinculadas ao indicador. Clique para expandir.</td></tr>
              </tbody>
            </table>

            <h3 className="font-semibold text-slate-800 mt-3 mb-1">Filtros disponíveis:</h3>
            <ul className="list-disc pl-5 space-y-0.5">
              <li><strong>Apenas com saldo</strong> — oculta indicadores zerados ou negativos</li>
              <li><strong>UG CRED / Natureza / PI</strong> — filtra por campo específico</li>
              <li><strong>Campo de busca</strong> — pesquisa por código, descrição ou nota de crédito</li>
            </ul>
          </section>

          {/* 5. Empenhos */}
          <section>
            <h2 className="text-base font-bold text-emerald-700 border-l-4 border-emerald-600 pl-3 py-0.5 mb-3">
              5. Empenhos (SEO)
            </h2>
            <p className="mb-2">
              Registra as <strong>Notas de Empenho</strong> emitidas, com o vínculo direto ao Indicador de Lotação utilizado e ao contrato/licitação correspondente. Esta planilha é fundamental para a aba "Gerenciamento dos Contratos".
            </p>
            <h3 className="font-semibold text-slate-800 mb-1">Colunas esperadas na planilha:</h3>
            <table>
              <thead><tr><th>Coluna</th><th>Significado</th></tr></thead>
              <tbody>
                <tr><td><strong>Empenho</strong></td><td>Número da Nota de Empenho (ex: 2026NE000123)</td></tr>
                <tr><td><strong>Valor</strong></td><td>Valor total empenhado</td></tr>
                <tr><td><strong>Liquidado</strong></td><td>Valor já liquidado (serviço prestado/bem entregue)</td></tr>
                <tr><td><strong>Saldo</strong></td><td>Valor empenhado ainda não liquidado</td></tr>
                <tr><td><strong>Indicador de Lotação</strong></td><td>Conta corrente usada no empenho — vincula ao indicador orçamentário</td></tr>
                <tr><td><strong>Licitação SIASG ou Contrato</strong></td><td>Número do contrato ou da licitação associada ao empenho</td></tr>
              </tbody>
            </table>
          </section>

          {/* 6. Gerenciamento dos Contratos */}
          <section>
            <h2 className="text-base font-bold text-emerald-700 border-l-4 border-emerald-600 pl-3 py-0.5 mb-3">
              6. Gerenciamento dos Contratos
            </h2>
            <p className="mb-2">
              Tela principal de acompanhamento financeiro dos contratos. Cruza três fontes de dados: <strong>Contratos SCON</strong>, <strong>Empenhos</strong> e <strong>Indicadores de Lotação</strong>.
            </p>

            <h3 className="font-semibold text-slate-800 mb-1">O que aparece para cada contrato expandido:</h3>
            <div className="space-y-2">
              <div className="border rounded-lg p-3">
                <p className="font-semibold text-slate-800 mb-1">📋 Detalhes do Contrato</p>
                <p>Número, fornecedor, UGE, ação orçamentária, vencimento, valor contratual e saldo disponível.</p>
              </div>
              <div className="border rounded-lg p-3">
                <p className="font-semibold text-slate-800 mb-1">📄 Notas de Empenho</p>
                <p>Lista dos empenhos emitidos para este contrato no exercício. Para cada NE: número, indicador de lotação utilizado, valor, liquidado e saldo do empenho.</p>
              </div>
              <div className="border rounded-lg p-3 border-emerald-200 bg-emerald-50/30">
                <p className="font-semibold text-emerald-800 mb-1">📊 Indicadores de Lotação Vinculados</p>
                <p>Indicadores identificados <strong>pelos próprios empenhos</strong> — ou seja, são as contas correntes que estão sendo usadas para pagar este contrato. Clique no indicador para ver as Notas de Crédito individuais.</p>
              </div>
              <div className="border rounded-lg p-3 border-amber-200 bg-amber-50/30">
                <p className="font-semibold text-amber-800 mb-1">💡 Indicadores Sugeridos (fundo amarelo)</p>
                <p>Aparece <strong>somente quando não há empenhos registrados</strong> no exercício para aquele contrato. O sistema sugere indicadores compatíveis com base na <strong>Ação orçamentária</strong> e na <strong>UGE</strong> do contrato — são candidatos para futuros empenhos.</p>
              </div>
            </div>

            <div className="mt-3 bg-blue-50 border-l-4 border-blue-400 p-3 rounded text-xs">
              <strong>Como o sistema vincula empenho ao indicador?</strong> A planilha de empenhos possui o campo "Indicador de Lotação" que registra exatamente qual conta corrente foi utilizada no empenho. Esse campo é a chave da ligação.
            </div>
          </section>

          {/* 7. Gerenciamento de Contratos SCON */}
          <section>
            <h2 className="text-base font-bold text-emerald-700 border-l-4 border-emerald-600 pl-3 py-0.5 mb-3">
              7. Gerenciamento de Contratos (SCON)
            </h2>
            <p className="mb-2">
              Permite ao SCON importar a planilha de contratos vigentes, cadastrar contratos manualmente e acompanhar saldos e vencimentos.
            </p>
            <h3 className="font-semibold text-slate-800 mb-1">Funções disponíveis:</h3>
            <ul className="list-disc pl-5 space-y-0.5">
              <li><strong>Importar Excel</strong> — importa planilha de contratos do sistema de gestão</li>
              <li><strong>+ Cadastrar</strong> — cadastro manual de contratos não constantes na planilha</li>
              <li><strong>Limpar Importados</strong> — remove os contratos importados via Excel para reimportação corrigida</li>
            </ul>
            <h3 className="font-semibold text-slate-800 mt-2 mb-1">Campos de destaque:</h3>
            <table>
              <thead><tr><th>Campo</th><th>Significado</th></tr></thead>
              <tbody>
                <tr><td><strong>Status</strong></td><td>Situação atual (Vigente, Vencido, Suspenso)</td></tr>
                <tr><td><strong>Vl. Contratual</strong></td><td>Valor total assinado no contrato</td></tr>
                <tr><td><strong>Saldo</strong></td><td>Valor disponível para empenho</td></tr>
                <tr><td><strong>Data Final</strong></td><td>Vencimento — contratos próximos do vencimento são destacados</td></tr>
              </tbody>
            </table>
          </section>

          {/* 8. Gerenciamento de Processos SLIC */}
          <section>
            <h2 className="text-base font-bold text-emerald-700 border-l-4 border-emerald-600 pl-3 py-0.5 mb-3">
              8. Gerenciamento de Processos Licitatórios (SLIC)
            </h2>
            <p className="mb-2">
              Acompanha os processos licitatórios em andamento e concluídos. Os dados são sincronizados com o <strong>Portal de Compras Governamentais (ComprasGov)</strong> via UASG 120630.
            </p>
            <h3 className="font-semibold text-slate-800 mb-1">Status dos processos:</h3>
            <table>
              <thead><tr><th>Status</th><th>Significado</th></tr></thead>
              <tbody>
                <tr><td><strong>Em Andamento</strong></td><td>Processo ativo sem resultado homologado</td></tr>
                <tr><td><strong>Homologada</strong></td><td>Licitação concluída com vencedor definido</td></tr>
                <tr><td><strong>Suspensa</strong></td><td>Processo temporariamente suspenso</td></tr>
                <tr><td><strong>Revogada</strong></td><td>Processo cancelado</td></tr>
              </tbody>
            </table>
            <h3 className="font-semibold text-slate-800 mt-2 mb-1">Campo Status Livre:</h3>
            <p>Permite registrar etapas internas do processo (ex: "Aguardando DNR", "Abertura de PAG"). Visível somente internamente.</p>
          </section>

          {/* 9. Chatbot */}
          <section>
            <h2 className="text-base font-bold text-emerald-700 border-l-4 border-emerald-600 pl-3 py-0.5 mb-3">
              9. Assistente Virtual (Chatbot)
            </h2>
            <p className="mb-2">
              O assistente responde perguntas em linguagem natural sobre os dados cadastrados no sistema. Acessível pelo botão <strong>Chat</strong> no canto superior da tela.
            </p>
            <h3 className="font-semibold text-slate-800 mb-1">Exemplos de perguntas:</h3>
            <table>
              <thead><tr><th>Pergunta de exemplo</th><th>O que o chatbot retorna</th></tr></thead>
              <tbody>
                <tr><td>"Qual o saldo do contrato 2024/001?"</td><td>Saldo, fornecedor e vencimento do contrato</td></tr>
                <tr><td>"Contratos vencendo em 30 dias"</td><td>Lista de contratos próximos do vencimento</td></tr>
                <tr><td>"Saldo total de contratos"</td><td>Soma de todos os saldos disponíveis</td></tr>
                <tr><td>"Indicadores com saldo"</td><td>Resumo dos indicadores de lotação disponíveis</td></tr>
                <tr><td>"C26001"</td><td>Detalhes do indicador C26001 (dotação, utilizado, saldo, NCs)</td></tr>
                <tr><td>"Empenhos do contrato X"</td><td>Notas de empenho vinculadas ao contrato</td></tr>
                <tr><td>"Processos em andamento"</td><td>Lista de licitações ativas</td></tr>
                <tr><td>"Ajuda"</td><td>Lista completa de perguntas suportadas</td></tr>
              </tbody>
            </table>
          </section>

          {/* Rodapé */}
          <div className="border-t pt-4 text-center text-xs text-slate-400">
            GAP-MN · Sistema de Gestão Administrativa · Desenvolvido por 2T Bruno · 2026
          </div>
        </div>
      </div>
    </div>
  );
}
