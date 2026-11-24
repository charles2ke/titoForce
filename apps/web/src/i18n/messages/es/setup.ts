import type { Translation } from '../../index.ts';

export default {
  title: 'Configuración',
  nav: {
    groups: {
      dataModel: 'Modelo de datos',
      usersAccess: 'Usuarios y acceso',
      experience: 'Experiencia',
      automation: 'Automatización',
      ai: 'IA',
      environments: 'Entornos',
    },
    objects: 'Objetos y campos',
    users: 'Usuarios',
    roles: 'Roles y permisos',
    apps: 'Aplicaciones',
    translations: 'Traducciones',
    automations: 'Automatizaciones',
    approvalProcesses: 'Procesos de aprobación',
    runs: 'Historial de ejecuciones',
    agents: 'Agentes',
    sandboxes: 'Sandboxes',
  },
  noAccess: {
    title: 'No tiene acceso a esta área',
    message: 'Esta parte de Configuración requiere permisos adicionales. Si los necesita, pida a un administrador que actualice su rol.',
  },
} satisfies Translation['setup'];
