import type { Translation } from '../../index.ts';

export default {
  title: 'Procesos de aprobación',
  subtitle:
    'Dirija los registros a un aprobador y ejecute acciones cuando se envían, se aprueban o se rechazan.',
  new: 'Nuevo proceso de aprobación',
  edit: 'Editar {name}',
  list: {
    searchLabel: 'Buscar procesos de aprobación',
    searchPlaceholder: 'Buscar procesos…',
    filterByObject: 'Filtrar por objeto',
    allObjects: 'Todos los objetos',
    noMatch: 'Ningún proceso de aprobación coincide',
    empty: 'Todavía no hay procesos de aprobación',
    emptyText:
      'Los procesos de aprobación permiten enviar registros, como descuentos o ausencias, para que se aprueben.',
    createFirst: 'Cree su primer proceso de aprobación',
    entryConditions: 'Condiciones de entrada',
    approver: 'Aprobador',
    actions: 'Acciones',
    actionsTitle: 'Acciones al enviar / aprobar / rechazar',
    rowActions: 'Acciones de la fila',
    conditionCount: { one: '{count} condición', other: '{count} condiciones' },
    noConditions: 'Sin condiciones',
    fallback: 'Suplente: {name}',
    activeLabel: '{name}: activo',
    delete: 'Eliminar {name}',
    deleteTitle: '¿Eliminar {name}?',
    deleteMessage:
      'Ya no se podrán enviar registros a este proceso. Los procesos con solicitudes pendientes no se pueden eliminar.',
    deleteConfirm: 'Eliminar proceso',
  },
  toasts: {
    created: 'Se ha creado el proceso de aprobación “{name}”',
    saved: 'Se ha guardado el proceso de aprobación “{name}”',
    activated: 'Se ha activado el proceso de aprobación “{name}”',
    deactivated: 'Se ha desactivado el proceso de aprobación “{name}”',
    deleted: 'Se ha eliminado el proceso de aprobación “{name}”',
  },
  form: {
    create: 'Crear proceso',
    save: 'Guardar proceso',
    namePlaceholder: 'Aprobación de descuentos',
    chooseObject: 'Elegir un objeto…',
    objectFixed: 'El objeto de un proceso existente no se puede cambiar.',
    entryConditions: '1. Condiciones de entrada (opcional)',
    entryConditionsHelp:
      'Solo se pueden enviar los registros que cumplan estas condiciones. Si hay varios procesos activos para {objects}, se usa el primero que coincida.',
    approver: '2. Aprobador',
    approverModes: {
      user: { title: 'Un usuario concreto', text: 'Todas las solicitudes van a la misma persona.' },
      field: {
        title: 'Según el registro',
        text: 'Alguien relacionado con el registro, p. ej., su propietario o el responsable del empleado.',
      },
    },
    approverUser: 'Usuario aprobador',
    chooseUser: 'Elegir un usuario…',
    approverField: 'Campo del aprobador',
    approverFieldHelp: 'El usuario que figure aquí en el momento del envío aprueba la solicitud.',
    customPath: 'Ruta personalizada…',
    fallbackApprover: 'Aprobador suplente',
    fallbackApproverHelp: 'Se usa cuando el campo está vacío o el usuario está inactivo.',
    noFallback: 'Ninguno: el envío falla',
    fieldPath: 'Ruta del campo',
    fieldPathHelp:
      'Nombres de API separados por puntos: las búsquedas que se van a seguir, terminando en un campo de usuario o en {ownerId} (hasta 5 partes), p. ej., {example}.',
    fieldPathError: 'Use nombres de API en minúsculas separados por puntos.',
    actions: '3. Acciones',
    actionsNote:
      'Siempre se notifica al aprobador. Las acciones se ejecutan en nombre del proceso de aprobación, así que no las limitan los permisos de ningún usuario.',
    actionsEmpty: 'No hay acciones.',
    changeObjectTitle: '¿Cambiar el objeto?',
    changeObjectMessage:
      'Las condiciones de entrada, el campo del aprobador y las acciones hacen referencia al objeto actual y se borrarán.',
    changeObjectConfirm: 'Cambiar objeto',
    problems: {
      enterName: 'Introduzca un nombre.',
      chooseObject: 'Elija un objeto.',
      chooseApprover: 'Elija el aprobador.',
      enterPath: 'Introduzca una ruta válida al campo del aprobador.',
      noSuchField: 'El objeto {object} no tiene ningún campo “{field}”.',
    },
  },
  approverPaths: {
    recordOwner: 'Propietario del registro',
    thisObject: 'Este registro de {object}',
  },
  stages: {
    onSubmit: {
      title: 'Cuando se envía',
      help: 'Se ejecuta justo después de enviar el registro, p. ej., para establecer el estado en “En revisión”.',
      item: 'Acción de envío',
      add: 'Añadir acción de envío',
    },
    onApprove: {
      title: 'Cuando se aprueba',
      help: 'Se ejecuta después de que el aprobador apruebe la solicitud. Use “{action}” para encadenar otro paso de aprobación.',
      item: 'Acción de aprobación',
      add: 'Añadir acción de aprobación',
    },
    onReject: {
      title: 'Cuando se rechaza',
      help: 'Se ejecuta después de que el aprobador rechace la solicitud.',
      item: 'Acción de rechazo',
      add: 'Añadir acción de rechazo',
    },
  },
} satisfies Translation['setupApprovals'];
