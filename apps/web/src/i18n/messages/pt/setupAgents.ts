import type { Translation } from '../../index.ts';

export default {
  title: 'Agentes de IA',
  subtitle: 'Configure os assistentes com os quais as pessoas conversam e que as automações podem executar.',
  runHistory: 'Histórico de execuções',
  new: 'Novo agente',
  edit: 'Editar {name}',
  autonomy: {
    readOnly: {
      label: 'Somente leitura',
      text: 'Consulta e analisa dados, mas nunca altera nada. As ferramentas de escrita não são oferecidas ao agente.',
    },
    approvalRequired: {
      label: 'Aprovação obrigatória',
      text: 'As alterações propostas ficam na fila em Aprovações e só são executadas depois que o usuário solicitante (ou o proprietário do registro, em execuções de automações) as aprova.',
    },
    autonomous: {
      label: 'Autônomo',
      text: 'As alterações são executadas imediatamente, limitadas ao que o usuário solicitante — ou o usuário do agente de IA, em execuções de automações — tem permissão para fazer.',
    },
  },
  toolKinds: {
    read: {
      title: 'Ferramentas de leitura',
      text: 'Consultam informações',
      selectAll: 'Selecionar todas as ferramentas de leitura',
      clear: 'Limpar ferramentas de leitura',
    },
    write: {
      title: 'Ferramentas de escrita',
      text: 'Criam e alteram dados',
      selectAll: 'Selecionar todas as ferramentas de escrita',
      clear: 'Limpar ferramentas de escrita',
    },
  },
  toolNames: {
    aggregateRecords: 'Agregar registros',
    convertLead: 'Converter lead',
    createRecord: 'Criar registro',
    describeObject: 'Descrever objeto',
    getRecord: 'Obter registro',
    getRelatedRecords: 'Obter registros relacionados',
    getTimeline: 'Obter linha do tempo',
    listObjects: 'Listar objetos',
    listUsers: 'Listar usuários',
    logActivity: 'Registrar atividade',
    queryRecords: 'Consultar registros',
    scoreLead: 'Pontuar lead',
    searchKnowledge: 'Pesquisar na base de conhecimento',
    searchRecords: 'Pesquisar registros',
    sendNotification: 'Enviar notificação',
    submitForApproval: 'Enviar para aprovação',
    updateRecord: 'Atualizar registro',
  },
  providers: {
    offline: 'offline',
  },
  status: {
    title: 'Provedor de IA',
    connected: 'Conectado',
    offline: 'Mecanismo de regras offline',
    provider: 'Provedor',
    model: 'Modelo',
    offlineNote:
      'Os agentes também funcionam offline: o próprio mecanismo de regras planeja as chamadas de ferramentas (as instruções do agente não são usadas), com as mesmas ferramentas, permissões e regras de aprovação. Assim, você pode testar tudo sem uma chave de API.',
  },
  list: {
    searchLabel: 'Pesquisar agentes',
    searchPlaceholder: 'Pesquisar agentes…',
    noMatch: 'Nenhum agente encontrado',
    empty: 'Nenhum agente ainda',
    emptyText: 'Os agentes respondem a perguntas e executam ações no CRM usando as ferramentas que você permitir.',
    createFirst: 'Crie seu primeiro agente',
    builtIn: 'Integrado',
    toolCount: { one: '{count} ferramenta', other: '{count} ferramentas' },
    activeLabel: '{name}: ativo',
    noDescription: 'Sem descrição',
    chat: 'Conversar',
    chatWith: 'Conversar com {name}',
    activateToChat: 'Ative para conversar',
    runHistoryOf: 'Histórico de execuções de {name}',
    delete: 'Excluir {name}',
    deleteTitle: 'Excluir {name}?',
    deleteMessage: 'As pessoas não poderão mais conversar com este agente. Agentes usados por uma automação não podem ser excluídos.',
    deleteConfirm: 'Excluir agente',
  },
  toasts: {
    created: 'Agente “{name}” criado',
    saved: 'Agente “{name}” salvo',
    activated: 'Agente “{name}” ativado',
    deactivated: 'Agente “{name}” desativado',
    deleted: 'Agente “{name}” excluído',
  },
  form: {
    create: 'Criar agente',
    save: 'Salvar agente',
    builtInNote: 'Este é um agente integrado. Você pode alterá-lo, mas não excluí-lo — desative-o em vez disso.',
    namePlaceholder: 'Assistente de renovações',
    descriptionHelp: 'Exibida para as pessoas que escolhem um agente para conversar.',
    instructions: 'Instruções',
    instructionsHelp:
      'O objetivo, o tom, as etapas e os limites do agente — usados como prompt do sistema quando um provedor de LLM está configurado. {length}/8000 caracteres.',
    instructionsPlaceholder:
      'Você ajuda gerentes de contas a preparar renovações.\n1. Consulte a conta e as oportunidades abertas dela.\n2. Resuma os riscos e sugira os próximos passos.',
    autonomy: 'Autonomia',
    tools: 'Ferramentas',
    toolsHelp: {
      one: '{count} selecionada. Os agentes só podem usar as ferramentas que você ativar aqui, e cada chamada de ferramenta é verificada com base nas permissões do usuário em nome de quem o agente atua.',
      other:
        '{count} selecionadas. Os agentes só podem usar as ferramentas que você ativar aqui, e cada chamada de ferramenta é verificada com base nas permissões do usuário em nome de quem o agente atua.',
    },
    writeToolsIgnored: 'Este agente é somente leitura, então as ferramentas de escrita selecionadas são ignoradas.',
    problems: {
      enterName: 'Insira um nome.',
      chooseTool: 'Escolha pelo menos uma ferramenta.',
    },
  },
} satisfies Translation['setupAgents'];
