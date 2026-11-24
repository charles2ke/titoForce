import type { Translation } from '../../index.ts';

export default {
  title: 'Agentes de IA',
  subtitle: 'Configure los asistentes con los que conversan los usuarios y que pueden ejecutar las automatizaciones.',
  runHistory: 'Historial de ejecuciones',
  new: 'Nuevo agente',
  edit: 'Editar {name}',
  autonomy: {
    readOnly: {
      label: 'Solo lectura',
      text: 'Consulta y analiza datos, pero nunca modifica nada. Al agente no se le ofrecen herramientas de escritura.',
    },
    approvalRequired: {
      label: 'Requiere aprobación',
      text: 'Los cambios propuestos se ponen en cola en Aprobaciones y solo se ejecutan cuando el usuario solicitante (o el propietario del registro, en las ejecuciones de automatizaciones) los aprueba.',
    },
    autonomous: {
      label: 'Autónomo',
      text: 'Los cambios se ejecutan de inmediato, limitados a lo que puede hacer el usuario solicitante (o el usuario del agente de IA, en las ejecuciones de automatizaciones).',
    },
  },
  toolKinds: {
    read: {
      title: 'Herramientas de lectura',
      text: 'Consultan información',
      selectAll: 'Seleccionar todas las herramientas de lectura',
      clear: 'Quitar las herramientas de lectura',
    },
    write: {
      title: 'Herramientas de escritura',
      text: 'Crean y modifican datos',
      selectAll: 'Seleccionar todas las herramientas de escritura',
      clear: 'Quitar las herramientas de escritura',
    },
  },
  toolNames: {
    aggregateRecords: 'Agregar registros',
    convertLead: 'Convertir prospecto',
    createRecord: 'Crear registro',
    describeObject: 'Describir objeto',
    getRecord: 'Obtener registro',
    getRelatedRecords: 'Obtener registros relacionados',
    getTimeline: 'Obtener cronología',
    listObjects: 'Listar objetos',
    listUsers: 'Listar usuarios',
    logActivity: 'Registrar actividad',
    queryRecords: 'Consultar registros',
    scoreLead: 'Puntuar prospecto',
    searchKnowledge: 'Buscar en la base de conocimientos',
    searchRecords: 'Buscar registros',
    sendNotification: 'Enviar notificación',
    submitForApproval: 'Enviar para aprobación',
    updateRecord: 'Actualizar registro',
  },
  providers: {
    offline: 'sin conexión',
  },
  status: {
    title: 'Proveedor de IA',
    connected: 'Conectado',
    offline: 'Motor de reglas sin conexión',
    provider: 'Proveedor',
    model: 'Modelo',
    offlineNote:
      'Los agentes también funcionan sin conexión: el motor de reglas planifica por sí mismo las llamadas a herramientas (no se usan las instrucciones del agente) con las mismas herramientas, permisos y reglas de aprobación, para que pueda probarlo todo sin una clave de API.',
  },
  list: {
    searchLabel: 'Buscar agentes',
    searchPlaceholder: 'Buscar agentes…',
    noMatch: 'Ningún agente coincide',
    empty: 'Todavía no hay agentes',
    emptyText: 'Los agentes responden preguntas y realizan acciones en el CRM con las herramientas que usted permita.',
    createFirst: 'Crear el primer agente',
    builtIn: 'Integrado',
    toolCount: { one: '{count} herramienta', other: '{count} herramientas' },
    activeLabel: '{name}: activo',
    noDescription: 'Sin descripción',
    chat: 'Conversar',
    chatWith: 'Conversar con {name}',
    activateToChat: 'Activar para conversar',
    runHistoryOf: 'Historial de ejecuciones de {name}',
    delete: 'Eliminar {name}',
    deleteTitle: '¿Eliminar {name}?',
    deleteMessage: 'Los usuarios ya no podrán conversar con este agente. Los agentes que usa una automatización no se pueden eliminar.',
    deleteConfirm: 'Eliminar agente',
  },
  toasts: {
    created: 'Se ha creado {name}',
    saved: 'Se ha guardado {name}',
    activated: 'Se ha activado {name}',
    deactivated: 'Se ha desactivado {name}',
    deleted: 'Se ha eliminado {name}',
  },
  form: {
    create: 'Crear agente',
    save: 'Guardar agente',
    builtInNote: 'Este es un agente integrado. Puede modificarlo, pero no eliminarlo; en su lugar, desactívelo.',
    namePlaceholder: 'Asistente de renovaciones',
    descriptionHelp: 'Se muestra a quienes eligen un agente con el que conversar.',
    instructions: 'Instrucciones',
    instructionsHelp:
      'El objetivo, el tono, los pasos y los límites del agente; se usan como prompt del sistema cuando hay un proveedor de LLM configurado. {length}/8000 caracteres.',
    instructionsPlaceholder:
      'Ayudas a los gestores de cuentas a preparar renovaciones.\n1. Busca la cuenta y sus oportunidades abiertas.\n2. Resume los riesgos y sugiere los próximos pasos.',
    autonomy: 'Autonomía',
    tools: 'Herramientas',
    toolsHelp: {
      one: '{count} seleccionada. Los agentes solo pueden usar las herramientas que habilite aquí, y cada llamada a una herramienta se comprueba con los permisos del usuario en cuyo nombre actúa el agente.',
      other:
        '{count} seleccionadas. Los agentes solo pueden usar las herramientas que habilite aquí, y cada llamada a una herramienta se comprueba con los permisos del usuario en cuyo nombre actúa el agente.',
    },
    writeToolsIgnored: 'Este agente es de solo lectura, por lo que se ignoran las herramientas de escritura seleccionadas.',
    problems: {
      enterName: 'Introduzca un nombre.',
      chooseTool: 'Elija al menos una herramienta.',
    },
  },
} satisfies Translation['setupAgents'];
