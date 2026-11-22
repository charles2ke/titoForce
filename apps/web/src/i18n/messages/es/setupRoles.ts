import type { Translation } from '../../index.ts';

export default {
  title: 'Roles y permisos',
  subtitle: 'Controle qué puede ver y hacer cada rol, objeto por objeto.',
  newRole: 'Nuevo rol',
  empty: 'Todavía no hay roles',
  listLabel: 'Roles',
  admin: 'Administrador',
  userCount: { one: '{count} usuario', other: '{count} usuarios' },
  roleName: 'Nombre del rol',

  levels: {
    none: 'Sin acceso',
    own: 'Registros propios',
    all: 'Todos los registros',
  },

  capabilities: {
    title: 'Capacidades',
    adminAlwaysOn: 'Siempre activado para el rol de administrador, para que nadie pierda el acceso.',
    setup: {
      label: 'Administrador (acceso a Configuración)',
      help: 'Gestionar objetos, campos, usuarios, roles y aplicaciones. También concede los permisos de automatizaciones y agentes de IA.',
    },
    viewSensitive: {
      label: 'Ver campos confidenciales',
      help: 'Ver y editar los campos marcados como confidenciales, como los salarios.',
    },
    manageAutomations: {
      label: 'Gestionar automatizaciones',
      help: 'Crear y editar automatizaciones, procesos de aprobación, informes y paneles, y ver el historial de ejecuciones de automatizaciones.',
    },
    manageAgents: {
      label: 'Gestionar agentes de IA',
      help: 'Crear y editar agentes de IA y ver todas las ejecuciones de agentes.',
    },
  },

  editor: {
    deleteRole: 'Eliminar rol',
    deleteTitle: '¿Eliminar {name}?',
    deleteMessage: 'El rol y sus permisos se eliminarán de forma permanente.',
    adminNotDeletable: 'El rol de administrador no se puede eliminar.',
    reassignUsers: {
      one: 'Primero, asigne otro rol al usuario que tiene este rol.',
      other: 'Primero, asigne otro rol a los {count} usuarios que tienen este rol.',
    },
    saved: 'Se ha guardado {name}',
    deleted: 'Se ha eliminado {name}',
    removeOwnSetupTitle: '¿Quitar su propio acceso a Configuración?',
    removeOwnSetupMessage: 'Usted tiene este rol, así que, después de guardar, ya no podrá abrir Configuración.',
    saveAnyway: 'Guardar de todos modos',
    unsavedChanges: 'Cambios sin guardar',
    discard: 'Descartar',
    save: 'Guardar rol',
  },

  objectPermissions: {
    title: 'Permisos de objetos',
    help: '“{own}” son los registros de los que el usuario es propietario. Los objetos sin ajustes propios usan la fila predeterminada.',
    helpSetup:
      '“{own}” son los registros de los que el usuario es propietario. Los objetos sin ajustes propios usan la fila predeterminada. El acceso a Configuración no anula estos ajustes.',
    defaultRow: 'Predeterminado para otros objetos',
    columns: {
      read: 'Leer',
      create: 'Crear',
      edit: 'Editar',
      delete: 'Eliminar',
    },
    controls: {
      read: '{object}: leer',
      create: '{object}: crear',
      edit: '{object}: editar',
      delete: '{object}: eliminar',
    },
    inherited: 'Predeterminado',
    unknownObject: 'Objeto desconocido',
    unknownObjectHelp:
      'Este objeto ya no existe o no tiene permiso para leerlo. Quite la fila si el objeto se ha eliminado; de lo contrario, no se podrá guardar.',
    removeRow: 'Quitar los permisos de {object}',
    useDefault: 'Usar el valor predeterminado para {object}',
  },

  createForm: {
    title: 'Nuevo rol',
    create: 'Crear rol',
    created: 'Se ha creado {name}',
    namePlaceholder: 'Éxito del cliente',
    roleId: 'ID del rol',
    roleIdHelp: 'Identificador permanente, p. ej., {example}.',
    idInvalid: 'Use entre 2 y 40 letras minúsculas, números y guiones bajos, empezando por una letra.',
    idExists: 'Ya existe un rol con este ID.',
    startFrom: 'Partir de',
    startFromHelp: 'Copie los permisos de un rol existente o empiece sin acceso.',
    noAccess: 'Sin acceso',
  },
} satisfies Translation['setupRoles'];
