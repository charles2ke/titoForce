import type { Translation } from '../../index.ts';

export default {
  title: 'Mi configuración',

  profile: {
    title: 'Perfil',
    jobTitle: 'Cargo',
    adminHint: 'Edite nombres, cargos y roles en {link}.',
    usersLink: 'Configuración › Usuarios',
    askAdmin: 'Pida a un administrador que cambie su nombre, cargo o rol.',
  },

  password: {
    title: 'Cambiar contraseña',
    current: 'Contraseña actual',
    new: 'Nueva contraseña',
    help: 'Al menos 8 caracteres.',
    confirm: 'Confirmar nueva contraseña',
    mismatch: 'Las contraseñas no coinciden',
    submit: 'Actualizar contraseña',
    changed: 'Contraseña cambiada. Se han cerrado sus otras sesiones.',
  },

  language: {
    title: 'Idioma',
    help: 'El idioma de titoForce en todos los dispositivos en los que inicie sesión. Las etiquetas que sus administradores no hayan traducido se muestran en inglés.',
    browserDefault: 'Idioma del navegador ({language})',
  },

  defaultApp: {
    title: 'Aplicación predeterminada',
    help: 'La aplicación que se abre al iniciar sesión. También se actualiza al cambiar de aplicación desde el selector de aplicaciones (se guarda en este navegador).',
    changed: '{app} es ahora su aplicación predeterminada',
  },

  ai: {
    title: 'Proveedor de IA',
    connected: 'Conectado',
    offline: 'Modo sin conexión',
    openai: 'Compatible con OpenAI',
    rulesEngine: 'Motor de reglas integrado',
    configuredBy: 'Un administrador configura el proveedor mediante variables de entorno del servidor.',
  },

  access: {
    title: 'Su acceso',
    capabilities: {
      setup: 'Administrar la configuración',
      manageAutomations: 'Gestionar automatizaciones, informes y paneles',
      manageAgents: 'Gestionar agentes de IA',
      viewSensitive: 'Ver campos confidenciales',
    },
    read: 'Leer',
    create: 'Crear',
    edit: 'Editar',
    delete: 'Eliminar',
    all: 'Todos',
    own: 'Propios',
    footnote: '“{own}” se refiere a los registros de los que usted es propietario. Los objetos que no puede leer están ocultos.',
  },
} satisfies Translation['settings'];
