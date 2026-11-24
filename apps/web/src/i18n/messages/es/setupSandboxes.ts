import type { Translation } from '../../index.ts';

export default {
  title: 'Sandboxes',
  subtitle: 'Copias de esta organización para crear y probar cambios sin afectar a nadie. Implemente en producción lo que funcione.',
  newSandbox: 'Nuevo sandbox',
  usage: '{count} de {max} sandboxes',
  limitReached: 'Esta organización ya tiene el número máximo de sandboxes. Elimine uno para crear otro.',
  unavailable: 'Los sandboxes se gestionan desde la organización de producción.',
  empty: {
    title: 'Todavía no hay sandboxes',
    message: 'Cree un sandbox para probar nuevos campos, formatos de página, automatizaciones o agentes antes de que los vean sus usuarios.',
  },
  signInHint:
    'Los sandboxes se abren en una pestaña nueva. Inicie sesión con el correo electrónico y la contraseña que tenía en producción cuando se copió el sandbox.',

  columns: {
    sandbox: 'Sandbox',
    type: 'Copia',
    status: 'Estado',
    createdBy: 'Creado por',
    copied: 'Última copia',
  },

  types: {
    developer: {
      label: 'Desarrollo',
      help: 'Configuración y usuarios. Se crea rápido y empieza sin registros.',
    },
    full: {
      label: 'Copia completa',
      help: 'Configuración, usuarios y todos los registros. Tarda más en las organizaciones grandes.',
    },
  },

  status: {
    active: 'Listo',
    provisioning: 'Copiando…',
    refreshing: 'Actualizando…',
    suspended: 'Suspendido',
    failed: 'Error en la copia',
  },

  actions: {
    open: 'Abrir',
    deploy: 'Comparar e implementar',
    refresh: 'Actualizar',
    delete: 'Eliminar',
    more: 'Más acciones de {name}',
  },

  create: {
    title: 'Nuevo sandbox',
    name: 'Nombre',
    nameHelp: 'Letras, números y guiones, p. ej., “dev” o “uat”. Los usuarios accederán con el ID {slug}.',
    invalidName: 'Use hasta 20 letras, números y guiones no consecutivos, empezando y terminando por una letra o un número.',
    type: 'Qué copiar',
    submit: 'Crear sandbox',
    started: 'Copiando producción en el sandbox {name}…',
  },

  ready: 'El sandbox {name} está listo',
  failed: 'Error al copiar el sandbox {name}',

  refresh: {
    title: '¿Actualizar el sandbox {name}?',
    message:
      'Todo el contenido del sandbox se sustituirá por una nueva copia de producción. Se perderán los cambios que no se hayan implementado y se cerrará la sesión de todos los usuarios conectados al sandbox.',
    confirm: 'Actualizar sandbox',
    started: 'Actualizando el sandbox {name}…',
  },

  delete: {
    title: '¿Eliminar el sandbox {name}?',
    message:
      'Se eliminarán el sandbox y todo su contenido. Se perderán los cambios que no se hayan implementado. Esta acción no se puede deshacer.',
    confirm: 'Eliminar sandbox',
    done: 'Se ha eliminado el sandbox {name}',
  },

  deploy: {
    back: 'Sandboxes',
    title: 'Implementar desde {name}',
    subtitle:
      'Elija los cambios que desea copiar en producción. Las implementaciones añaden y actualizan la configuración, pero nunca eliminan nada en producción.',
    notReady: 'El sandbox aún no está listo. Vuelva a intentarlo cuando termine de copiarse.',
    showUnchanged: 'Mostrar componentes sin cambios',
    selectAll: 'Seleccionar todos los cambios',
    select: 'Seleccionar {name}',
    noChanges: {
      title: 'No hay nada que implementar',
      message: 'El sandbox tiene la misma configuración que producción.',
    },
    columns: {
      component: 'Componente',
      type: 'Tipo',
      object: 'Objeto',
      change: 'Cambio',
    },
    types: {
      object: 'Objeto',
      layout: 'Formato de página',
      translation: 'Traducciones',
      app: 'Aplicación',
      automation: 'Automatización',
      approval_process: 'Proceso de aprobación',
      agent: 'Agente',
      report: 'Informe',
      dashboard: 'Panel',
      role: 'Rol',
    },
    statuses: {
      new: 'Nuevo',
      changed: 'Modificado',
      unchanged: 'Sin cambios',
      production_only: 'Solo en producción',
    },
    fields: {
      added: { one: '{count} campo nuevo', other: '{count} campos nuevos' },
      changed: { one: '{count} campo modificado', other: '{count} campos modificados' },
      productionOnly: { one: '{count} campo solo en producción', other: '{count} campos solo en producción' },
    },
    labels: {
      added: { one: '{count} etiqueta nueva', other: '{count} etiquetas nuevas' },
      changed: { one: '{count} etiqueta modificada', other: '{count} etiquetas modificadas' },
      productionOnly: { one: '{count} etiqueta solo en producción', other: '{count} etiquetas solo en producción' },
    },
    selected: { one: '{count} componente seleccionado', other: '{count} componentes seleccionados' },
    submit: 'Implementar en producción',
    confirm: {
      title: '¿Implementar en producción?',
      message: {
        one:
          'Se copiará {count} componente en producción y se aplicará a todos los usuarios de inmediato. Las implementaciones no se pueden deshacer, pero puede volver a implementar.',
        other:
          'Se copiarán {count} componentes en producción y se aplicarán a todos los usuarios de inmediato. Las implementaciones no se pueden deshacer, pero puede volver a implementar.',
      },
      confirm: 'Implementar',
    },
    done: { one: 'Se ha implementado {count} componente en producción', other: 'Se han implementado {count} componentes en producción' },
  },

  history: {
    title: 'Historial de implementaciones',
    empty: 'Todavía no se ha implementado nada en esta organización.',
    columns: {
      date: 'Fecha',
      from: 'Sandbox de origen',
      by: 'Implementado por',
      components: 'Componentes',
      status: 'Resultado',
    },
    componentCount: { one: '{count} componente', other: '{count} componentes' },
    succeeded: 'Implementada',
    failed: 'Fallida',
  },
} satisfies Translation['setupSandboxes'];
