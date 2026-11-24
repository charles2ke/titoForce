import type { Translation } from '../../index.ts';

export default {
  homeLink: 'Página inicial do titoForce',
  askAi: 'Perguntar à IA',

  search: {
    label: 'Pesquisar em todos os registros',
    placeholder: 'Pesquisar contas, contatos, negócios, casos…',
    shortcut: 'Ctrl K',
    searching: 'Pesquisando…',
    failed: 'Falha na pesquisa',
    noMatches: 'Nenhum resultado para “{term}”',
  },

  notifications: {
    title: 'Notificações',
    labelUnread: { one: 'Notificações ({count} não lida)', other: 'Notificações ({count} não lidas)' },
    markAllRead: 'Marcar todas como lidas',
    empty: 'Você está em dia.',
  },

  inbox: {
    label: 'Caixa de aprovações',
    labelPending: { one: 'Caixa de aprovações ({count} pendente)', other: 'Caixa de aprovações ({count} pendentes)' },
  },

  changePassword: {
    title: 'Alterar senha',
    submit: 'Alterar senha',
    current: 'Senha atual',
    new: 'Nova senha',
    help: 'Pelo menos 8 caracteres.',
    success: 'Senha alterada',
  },

  userMenu: {
    label: 'Menu do usuário',
    settings: 'Minhas configurações',
    changePassword: 'Alterar senha',
    signOut: 'Sair',
  },

  apps: {
    switch: 'Trocar de aplicativo',
    caption: 'Aplicativo',
    choose: 'Escolha um aplicativo',
    list: 'Aplicativos',
  },

  nav: {
    main: 'Principal',
    workspace: 'Espaço de trabalho',
    agents: 'Agentes de IA',
    approvals: 'Aprovações',
    reports: 'Relatórios',
    dashboards: 'Painéis',
    setup: 'Configuração',
  },

  ai: {
    status: 'IA: {provider}',
    offline: 'IA: mecanismo de regras offline',
  },

  aiPanel: {
    label: 'Assistente de IA',
    agent: 'Agente',
    newChat: 'Nova conversa',
    close: 'Fechar assistente',
    context: 'Contexto: {record}',
    loadingAgents: 'Carregando agentes…',
    noAgents: 'Nenhum agente ativo.',
  },

  mobile: {
    openNav: 'Abrir navegação',
    closeNav: 'Fechar navegação',
    nav: 'Navegação',
  },
} satisfies Translation['shell'];
