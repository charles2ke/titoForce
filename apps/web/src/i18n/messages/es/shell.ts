import type { Translation } from '../../index.ts';

export default {
  homeLink: 'Inicio de titoForce',
  askAi: 'Preguntar a la IA',

  search: {
    label: 'Buscar en todos los registros',
    placeholder: 'Buscar cuentas, contactos, oportunidades, casos…',
    shortcut: 'Ctrl K',
    searching: 'Buscando…',
    failed: 'Error en la búsqueda',
    noMatches: 'No hay resultados para “{term}”',
  },

  notifications: {
    title: 'Notificaciones',
    labelUnread: { one: 'Notificaciones ({count} sin leer)', other: 'Notificaciones ({count} sin leer)' },
    markAllRead: 'Marcar todas como leídas',
    empty: 'Está todo al día.',
  },

  inbox: {
    label: 'Bandeja de aprobaciones',
    labelPending: { one: 'Bandeja de aprobaciones ({count} pendiente)', other: 'Bandeja de aprobaciones ({count} pendientes)' },
  },

  changePassword: {
    title: 'Cambiar contraseña',
    submit: 'Cambiar contraseña',
    current: 'Contraseña actual',
    new: 'Nueva contraseña',
    help: 'Al menos 8 caracteres.',
    success: 'Contraseña cambiada',
  },

  userMenu: {
    label: 'Menú de usuario',
    settings: 'Mi configuración',
    changePassword: 'Cambiar contraseña',
    signOut: 'Cerrar sesión',
  },

  apps: {
    switch: 'Cambiar de aplicación',
    caption: 'Aplicación',
    choose: 'Elegir una aplicación',
    list: 'Aplicaciones',
  },

  nav: {
    main: 'Principal',
    workspace: 'Espacio de trabajo',
    agents: 'Agentes de IA',
    approvals: 'Aprobaciones',
    reports: 'Informes',
    dashboards: 'Paneles',
    setup: 'Configuración',
  },

  ai: {
    status: 'IA: {provider}',
    offline: 'IA: motor de reglas sin conexión',
  },

  aiPanel: {
    label: 'Asistente de IA',
    agent: 'Agente',
    newChat: 'Nueva conversación',
    close: 'Cerrar asistente',
    context: 'Contexto: {record}',
    loadingAgents: 'Cargando agentes…',
    noAgents: 'No hay agentes activos.',
  },

  mobile: {
    openNav: 'Abrir navegación',
    closeNav: 'Cerrar navegación',
    nav: 'Navegación',
  },
} satisfies Translation['shell'];
