import type { Translation } from '../../index.ts';

export default {
  title: 'Sandboxes',
  subtitle: 'Cópias desta organização para criar e testar alterações sem afetar ninguém. Implante na produção o que funcionar.',
  newSandbox: 'Novo sandbox',
  usage: '{count} de {max} sandboxes',
  limitReached: 'Esta organização atingiu o número máximo de sandboxes. Exclua um para criar outro.',
  unavailable: 'Os sandboxes são gerenciados na organização de produção.',
  empty: {
    title: 'Nenhum sandbox ainda',
    message: 'Crie um sandbox para testar novos campos, layouts de página, automações ou agentes antes que seus usuários os vejam.',
  },
  signInHint: 'Os sandboxes são abertos em uma nova guia. Faça login com o email e a senha que você tinha na produção quando o sandbox foi copiado.',

  columns: {
    sandbox: 'Sandbox',
    type: 'Cópia',
    status: 'Status',
    createdBy: 'Criado por',
    copied: 'Copiado em',
  },

  types: {
    developer: {
      label: 'Desenvolvedor',
      help: 'Configuração e usuários. Criação rápida; começa sem registros.',
    },
    full: {
      label: 'Cópia completa',
      help: 'Configuração, usuários e todos os registros. Demora mais em organizações grandes.',
    },
  },

  status: {
    active: 'Pronto',
    provisioning: 'Copiando…',
    refreshing: 'Atualizando…',
    suspended: 'Suspenso',
    failed: 'Falha na cópia',
  },

  actions: {
    open: 'Abrir',
    deploy: 'Comparar e implantar',
    refresh: 'Atualizar',
    delete: 'Excluir',
    more: 'Mais ações para {name}',
  },

  create: {
    title: 'Novo sandbox',
    name: 'Nome',
    nameHelp: 'Letras, números e hifens, como “dev” ou “uat”. As pessoas o acessam como {slug}.',
    invalidName: 'Use até 20 letras, números e hifens (não consecutivos), começando e terminando com uma letra ou um número.',
    type: 'O que copiar',
    submit: 'Criar sandbox',
    started: 'Copiando a produção para o sandbox {name}…',
  },

  ready: 'O sandbox {name} está pronto',
  failed: 'Falha ao copiar o sandbox {name}',

  refresh: {
    title: 'Atualizar o sandbox {name}?',
    message:
      'Todo o conteúdo do sandbox será substituído por uma nova cópia da produção. As alterações que não foram implantadas serão perdidas, e as sessões de todos que estiverem conectados ao sandbox serão encerradas.',
    confirm: 'Atualizar sandbox',
    started: 'Atualizando o sandbox {name}…',
  },

  delete: {
    title: 'Excluir o sandbox {name}?',
    message: 'O sandbox e todo o seu conteúdo serão excluídos. As alterações que não foram implantadas serão perdidas. Esta ação não pode ser desfeita.',
    confirm: 'Excluir sandbox',
    done: 'Sandbox {name} excluído',
  },

  deploy: {
    back: 'Sandboxes',
    title: 'Implantar a partir de {name}',
    subtitle:
      'Escolha as alterações que serão copiadas para a produção. As implantações adicionam e atualizam a configuração; elas nunca excluem nada na produção.',
    notReady: 'O sandbox ainda não está pronto. Tente novamente quando a cópia terminar.',
    showUnchanged: 'Mostrar inalterados',
    selectAll: 'Selecionar todas as alterações',
    select: 'Selecionar {name}',
    noChanges: {
      title: 'Nada para implantar',
      message: 'O sandbox tem a mesma configuração que a produção.',
    },
    columns: {
      component: 'Componente',
      type: 'Tipo',
      object: 'Objeto',
      change: 'Alteração',
    },
    types: {
      object: 'Objeto',
      layout: 'Layout de página',
      translation: 'Traduções',
      app: 'Aplicativo',
      automation: 'Automação',
      approval_process: 'Processo de aprovação',
      agent: 'Agente',
      report: 'Relatório',
      dashboard: 'Painel',
      role: 'Função',
    },
    statuses: {
      new: 'Novo',
      changed: 'Alterado',
      unchanged: 'Inalterado',
      production_only: 'Somente na produção',
    },
    fields: {
      added: { one: '{count} campo novo', other: '{count} campos novos' },
      changed: { one: '{count} campo alterado', other: '{count} campos alterados' },
      productionOnly: { one: '{count} campo somente na produção', other: '{count} campos somente na produção' },
    },
    labels: {
      added: { one: '{count} rótulo novo', other: '{count} rótulos novos' },
      changed: { one: '{count} rótulo alterado', other: '{count} rótulos alterados' },
      productionOnly: { one: '{count} rótulo somente na produção', other: '{count} rótulos somente na produção' },
    },
    selected: { one: '{count} componente selecionado', other: '{count} componentes selecionados' },
    submit: 'Implantar na produção',
    confirm: {
      title: 'Implantar na produção?',
      message: {
        one: '{count} componente será copiado para a produção e entrará em vigor para todos imediatamente. Não é possível desfazer implantações, mas você pode implantar novamente.',
        other:
          '{count} componentes serão copiados para a produção e entrarão em vigor para todos imediatamente. Não é possível desfazer implantações, mas você pode implantar novamente.',
      },
      confirm: 'Implantar',
    },
    done: { one: '{count} componente implantado na produção', other: '{count} componentes implantados na produção' },
  },

  history: {
    title: 'Histórico de implantações',
    empty: 'Nada foi implantado nesta organização ainda.',
    columns: {
      date: 'Data',
      from: 'Sandbox de origem',
      by: 'Implantado por',
      components: 'Componentes',
      status: 'Resultado',
    },
    componentCount: { one: '{count} componente', other: '{count} componentes' },
    succeeded: 'Implantada',
    failed: 'Falhou',
  },
} satisfies Translation['setupSandboxes'];
