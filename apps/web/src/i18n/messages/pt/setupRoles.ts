import type { Translation } from '../../index.ts';

export default {
  title: 'Funções e permissões',
  subtitle: 'Controle o que cada função pode ver e fazer, objeto por objeto.',
  newRole: 'Nova função',
  empty: 'Nenhuma função ainda',
  listLabel: 'Funções',
  admin: 'Admin',
  userCount: { one: '{count} usuário', other: '{count} usuários' },
  roleName: 'Nome da função',

  levels: {
    none: 'Nenhum',
    own: 'Registros próprios',
    all: 'Todos os registros',
  },

  capabilities: {
    title: 'Permissões gerais',
    adminAlwaysOn: 'Sempre ativada para a função de administrador, para que ninguém perca o acesso.',
    setup: {
      label: 'Administrador (acesso à Configuração)',
      help: 'Gerenciar objetos, campos, usuários, funções e aplicativos. Também concede acesso a automações e agentes de IA.',
    },
    viewSensitive: {
      label: 'Ver campos confidenciais',
      help: 'Ver e editar campos marcados como confidenciais, como salários.',
    },
    manageAutomations: {
      label: 'Gerenciar automações',
      help: 'Criar e editar automações, processos de aprovação, relatórios e painéis, e ver o histórico de execuções de automações.',
    },
    manageAgents: {
      label: 'Gerenciar agentes de IA',
      help: 'Criar e editar agentes de IA e ver todas as execuções de agentes.',
    },
  },

  editor: {
    deleteRole: 'Excluir função',
    deleteTitle: 'Excluir {name}?',
    deleteMessage: 'A função e suas permissões serão excluídas permanentemente.',
    adminNotDeletable: 'A função de administrador não pode ser excluída.',
    reassignUsers: {
      one: '{count} usuário tem esta função. Primeiro, atribua-o a outra função.',
      other: '{count} usuários têm esta função. Primeiro, atribua-os a outra função.',
    },
    saved: 'Função “{name}” salva',
    deleted: 'Função “{name}” excluída',
    removeOwnSetupTitle: 'Remover seu próprio acesso à Configuração?',
    removeOwnSetupMessage: 'Você tem esta função; portanto, depois de salvar, não poderá mais abrir a Configuração.',
    saveAnyway: 'Salvar mesmo assim',
    unsavedChanges: 'Alterações não salvas',
    discard: 'Descartar',
    save: 'Salvar função',
  },

  objectPermissions: {
    title: 'Permissões de objeto',
    help: '“{own}” significa os registros dos quais o usuário é proprietário. Os objetos sem configurações próprias usam a linha padrão.',
    helpSetup:
      '“{own}” significa os registros dos quais o usuário é proprietário. Os objetos sem configurações próprias usam a linha padrão. O acesso à Configuração não ignora essas configurações.',
    defaultRow: 'Padrão para outros objetos',
    columns: {
      read: 'Ler',
      create: 'Criar',
      edit: 'Editar',
      delete: 'Excluir',
    },
    controls: {
      read: '{object}: ler',
      create: '{object}: criar',
      edit: '{object}: editar',
      delete: '{object}: excluir',
    },
    inherited: 'Padrão',
    unknownObject: 'Objeto desconhecido',
    unknownObjectHelp:
      'Este objeto não existe mais ou você não pode lê-lo. Remova a linha se o objeto foi excluído; caso contrário, não será possível salvar.',
    removeRow: 'Remover permissões de {object}',
    useDefault: 'Usar o padrão para {object}',
  },

  createForm: {
    title: 'Nova função',
    create: 'Criar função',
    created: 'Função “{name}” criada',
    namePlaceholder: 'Sucesso do cliente',
    roleId: 'ID da função',
    roleIdHelp: 'Identificador permanente, por exemplo, {example}.',
    idInvalid: 'Use de 2 a 40 letras minúsculas, números e sublinhados, começando com uma letra.',
    idExists: 'Já existe uma função com este ID.',
    startFrom: 'Começar a partir de',
    startFromHelp: 'Copie as permissões de uma função existente ou comece sem acesso.',
    noAccess: 'Sem acesso',
  },
} satisfies Translation['setupRoles'];
