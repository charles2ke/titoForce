import type { Translation } from '../../index.ts';

export default {
  title: 'Configuração',
  nav: {
    groups: {
      dataModel: 'Modelo de dados',
      usersAccess: 'Usuários e acesso',
      experience: 'Experiência',
      automation: 'Automação',
      ai: 'IA',
      environments: 'Ambientes',
    },
    objects: 'Objetos e campos',
    users: 'Usuários',
    roles: 'Funções e permissões',
    apps: 'Aplicativos',
    translations: 'Traduções',
    automations: 'Automações',
    approvalProcesses: 'Processos de aprovação',
    runs: 'Histórico de execuções',
    agents: 'Agentes',
    sandboxes: 'Sandboxes',
  },
  noAccess: {
    title: 'Você não tem acesso a esta área',
    message: 'Esta parte da Configuração exige permissões adicionais. Se precisar, peça a um administrador para atualizar sua função.',
  },
} satisfies Translation['setup'];
