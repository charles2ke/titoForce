import type { Translation } from '../../index.ts';

export default {
  greeting: {
    morning: 'Buenos días, {name}',
    afternoon: 'Buenas tardes, {name}',
    evening: 'Buenas noches, {name}',
  },
  askAi: 'Preguntar a la IA',
  quickLinks: 'Accesos rápidos',
  myWork: 'Mi trabajo',
  appNotFound: {
    title: 'Aplicación no encontrada',
    message: 'Esta aplicación no existe o se ha eliminado.',
    goHome: 'Ir a su página de inicio',
  },

  dashboard: {
    title: 'Panel',
    open: 'Abrir panel',
    noneAssigned: 'No hay ningún panel asignado a esta aplicación.',
    browse: 'Ver paneles',
  },

  tasks: {
    title: 'Mis tareas pendientes',
    allActivities: 'Todas las actividades',
    empty: 'No hay nada pendiente: está todo al día.',
    markComplete: 'Marcar como completada',
    markNamedComplete: 'Marcar “{name}” como completada',
    completed: 'Tarea completada',
    overdue: 'Vencida · {date}',
    dueToday: 'Hoy · {date}',
    noDate: 'Sin fecha',
    more: { one: '+{count} tarea pendiente más', other: '+{count} tareas pendientes más' },
  },

  approvals: {
    title: 'Pendientes de mi aprobación',
    inbox: 'Bandeja de entrada',
    empty: 'No hay solicitudes pendientes de usted.',
    details: '{process} · de {user} · {time}',
    viewAll: 'Ver todas ({count})',
  },

  runs: {
    title: 'Actividad reciente de IA',
    agents: 'Agentes',
    empty: 'Todavía no hay ejecuciones de agentes. Pregunte algo a un agente para empezar.',
    status: {
      running: 'en ejecución',
      completed: 'completada',
      failed: 'error',
    },
    trigger: {
      automation: 'automatización',
      recordAction: 'acción de registro',
      api: 'API',
    },
  },
} satisfies Translation['home'];
