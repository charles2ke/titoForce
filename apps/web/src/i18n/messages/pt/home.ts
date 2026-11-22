import type { Translation } from '../../index.ts';

export default {
  greeting: {
    morning: 'Bom dia, {name}',
    afternoon: 'Boa tarde, {name}',
    evening: 'Boa noite, {name}',
  },
  askAi: 'Perguntar à IA',
  quickLinks: 'Links rápidos',
  myWork: 'Meu trabalho',
  appNotFound: {
    title: 'Aplicativo não encontrado',
    message: 'Este aplicativo não existe ou foi removido.',
    goHome: 'Ir para sua página inicial',
  },

  dashboard: {
    title: 'Painel',
    open: 'Abrir painel',
    noneAssigned: 'Nenhum painel está atribuído a este aplicativo.',
    browse: 'Ver painéis',
  },

  tasks: {
    title: 'Minhas tarefas em aberto',
    allActivities: 'Todas as atividades',
    empty: 'Nada em aberto — você está em dia.',
    markComplete: 'Marcar como concluída',
    markNamedComplete: 'Marcar “{name}” como concluída',
    completed: 'Tarefa concluída',
    overdue: 'Atrasada · {date}',
    dueToday: 'Hoje · {date}',
    noDate: 'Sem data',
    more: { one: '+{count} tarefa em aberto', other: '+{count} tarefas em aberto' },
  },

  approvals: {
    title: 'Aguardando minha aprovação',
    inbox: 'Caixa de entrada',
    empty: 'Nenhuma solicitação aguardando você.',
    details: '{process} · de {user} · {time}',
    viewAll: 'Exibir todas ({count})',
  },

  runs: {
    title: 'Atividade recente de IA',
    agents: 'Agentes',
    empty: 'Nenhuma execução de agente ainda. Pergunte algo a um agente para começar.',
    status: {
      running: 'em execução',
      completed: 'concluída',
      failed: 'falhou',
    },
    trigger: {
      automation: 'automação',
      recordAction: 'ação de registro',
      api: 'API',
    },
  },
} satisfies Translation['home'];
