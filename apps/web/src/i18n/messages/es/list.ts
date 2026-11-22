import type { Translation } from '../../index.ts';

export default {
  viewType: {
    table: 'Tabla',
    kanban: 'Kanban',
    calendar: 'Calendario',
    timeline: 'Cronograma',
  },

  views: {
    all: '{plural}: todos los registros',
    pickerLabel: 'Seleccionar vista de lista',
    menuLabel: 'Vistas de lista',
    shared: 'Vistas compartidas',
    mine: 'Mis vistas',
    others: 'Vistas de otros usuarios',
    actions: 'Acciones de la vista',
    rename: 'Cambiar nombre',
    delete: 'Eliminar vista',
    saveAs: 'Guardar como vista',
    saveAsTitle: 'Guardar como nueva vista',
    renameTitle: 'Cambiar nombre de la vista',
    copyName: '{name} (copia)',
    nameLabel: 'Nombre de la vista',
    nameRequired: 'Asigne un nombre a la vista.',
    shareWithEveryone: 'Compartir con todos',
    savedNew: 'Vista “{name}” guardada',
    saved: 'Vista guardada',
    deleteTitle: '¿Eliminar la vista de lista?',
    deleteMessage: 'Se eliminará “{name}”.',
    deleteMessageShared: 'Se eliminará “{name}” para todos los usuarios.',
    deleted: 'Vista eliminada',
  },

  columns: {
    button: 'Columnas',
    shown: 'Se muestran {shown} de {max} columnas',
    reset: 'Restablecer valores predeterminados',
  },

  toolbar: {
    displayAs: 'Mostrar como',
    groupBy: 'Agrupar por',
    dateField: 'Fecha',
    searchPlaceholder: 'Buscar {plural}…',
    searchLabel: 'Buscar {plural}',
    filters: 'Filtros',
    filtersCount: 'Filtros ({count})',
    clearFilters: 'Borrar filtros',
    resetToView: 'Restablecer la vista',
    filteredBy: 'Filtrado por:',
  },

  import: {
    title: 'Importar {plural}',
    instructions:
      'La primera fila debe contener encabezados de columna que coincidan con las etiquetas o los nombres de API de los campos de {label}. Los campos de búsqueda y de usuario pueden indicarse por nombre, ID o (en el caso de los usuarios) correo electrónico. Hasta {max} filas.',
    file: 'Archivo CSV',
    contentsOf: 'Contenido de {file}',
    paste: 'O pegue el CSV',
    created: { one: 'Se ha creado {count} {singular}.', other: 'Se han creado {count} {plural}.' },
    createdWithFailures: {
      one: 'Se ha creado {count} {singular}; {rows} con errores.',
      other: 'Se han creado {count} {plural}; {rows} con errores.',
    },
    rows: { one: '{count} fila', other: '{count} filas' },
    rowError: 'Fila {row}: {message}',
    columnMapping: 'Asignación de columnas',
    ignored: 'ignorada',
  },

  objectNotFound: {
    title: 'Objeto no encontrado',
    body: 'Es posible que se haya eliminado o que no tenga acceso a él.',
  },
} satisfies Translation['list'];
