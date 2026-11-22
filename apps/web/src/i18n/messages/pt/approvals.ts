import type { Translation } from '../../index.ts';

export default {
  title: 'Aprovações',
  subtitle: 'Solicitações de aprovação de registros e ações de agentes de IA que precisam de uma decisão humana.',
  tabs: {
    inbox: 'Aguardando você',
    submitted: 'Enviadas por mim',
    all: 'Todas as solicitações',
    agent: 'Ações de agentes',
  },
  empty: {
    inbox: 'Nada está aguardando sua aprovação',
    submitted: 'Você ainda não enviou nada para aprovação',
    all: 'Nenhuma solicitação de aprovação ainda',
  },

  approve: 'Aprovar',
  reject: 'Rejeitar',
  recall: 'Recolher',

  requestStatus: {
    pending: 'pendente',
    approved: 'aprovada',
    rejected: 'rejeitada',
    recalled: 'recolhida',
  },
  request: {
    submittedBy: 'enviada por {name} {time}',
    submittedByYou: 'enviada por você {time}',
    approver: 'aprovador: {name}',
    approverYou: 'aprovador: você',
    approvedAt: 'Aprovada {time}',
    rejectedAt: 'Rejeitada {time}',
    recalledAt: 'Recolhida {time}',
    quote: '“{text}”',
    recalled: 'Solicitação recolhida',
  },

  status: {
    pending: 'pendente',
    executing: 'em execução',
    executed: 'executada',
    rejected: 'rejeitada',
    failed: 'falhou',
  },
  action: {
    wantsToRun: '{agent} quer executar {tool}',
    viewRecord: 'Exibir registro',
    arguments: 'Argumentos',
    result: 'Resultado',
    failed: 'A ação falhou: {error}',
    failedUnknown: 'A ação falhou: erro desconhecido',
    rejected: 'Ação rejeitada',
    executed: 'Ação aprovada e executada',
  },
  agentActions: {
    intro: 'Os agentes com o nível de autonomia “Aprovação obrigatória” fazem uma pausa aqui antes de alterar dados.',
    pending: 'Pendentes',
    emptyPending: 'Nenhuma ação de agente aguardando',
    emptyAll: 'Nenhuma ação de agente ainda',
  },
} satisfies Translation['approvals'];
