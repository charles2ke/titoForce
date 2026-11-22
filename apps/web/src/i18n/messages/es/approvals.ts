import type { Translation } from '../../index.ts';

export default {
  title: 'Aprobaciones',
  subtitle: 'Solicitudes de aprobación de registros y acciones de agentes de IA que requieren una decisión humana.',
  tabs: {
    inbox: 'Pendientes de mí',
    submitted: 'Enviadas por mí',
    all: 'Todas las solicitudes',
    agent: 'Acciones de agentes',
  },
  empty: {
    inbox: 'No hay nada pendiente de su aprobación',
    submitted: 'No ha enviado nada para aprobación',
    all: 'Todavía no hay solicitudes de aprobación',
  },

  approve: 'Aprobar',
  reject: 'Rechazar',
  recall: 'Retirar',

  requestStatus: {
    pending: 'pendiente',
    approved: 'aprobada',
    rejected: 'rechazada',
    recalled: 'retirada',
  },
  request: {
    submittedBy: 'enviada por {name} {time}',
    submittedByYou: 'enviada por usted {time}',
    approver: 'aprobador: {name}',
    approverYou: 'aprobador: usted',
    approvedAt: 'Aprobada {time}',
    rejectedAt: 'Rechazada {time}',
    recalledAt: 'Retirada {time}',
    quote: '“{text}”',
    recalled: 'Solicitud retirada',
  },

  status: {
    pending: 'pendiente',
    executing: 'en ejecución',
    executed: 'ejecutada',
    rejected: 'rechazada',
    failed: 'fallida',
  },
  action: {
    wantsToRun: '{agent} quiere ejecutar {tool}',
    viewRecord: 'Ver registro',
    arguments: 'Argumentos',
    result: 'Resultado',
    failed: 'Error en la acción: {error}',
    failedUnknown: 'Error en la acción: error desconocido',
    rejected: 'Acción rechazada',
    executed: 'Acción aprobada y ejecutada',
  },
  agentActions: {
    intro: 'Los agentes con el nivel de autonomía “Requiere aprobación” se detienen aquí antes de modificar datos.',
    pending: 'Pendientes',
    emptyPending: 'No hay acciones de agentes pendientes',
    emptyAll: 'Todavía no hay acciones de agentes',
  },
} satisfies Translation['approvals'];
