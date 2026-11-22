import type { Translation } from '../../index.ts';

export default {
  spinner: 'Cargando',
  requiredSuffix: '(obligatorio)',
  tryAgain: 'Volver a intentarlo',
  unsaved: {
    title: '¿Descartar los cambios sin guardar?',
    message: 'No se han guardado los cambios de esta página.',
    discard: 'Descartar cambios',
  },

  pagination: {
    range: '{from}–{to} de {total}',
  },

  fieldValue: {
    restricted: 'Registro restringido',
  },

  lookup: {
    selected: 'Registro seleccionado',
    clear: 'Borrar selección',
    searchAny: 'Buscar cualquier registro…',
    searchObject: 'Buscar {objects}…',
    searchRecords: 'Buscar registros…',
    searching: 'Buscando…',
    typeToSearch: 'Escriba para buscar',
    noMatches: 'No hay resultados',
  },

  recordForm: {
    newTitle: 'Crear {object}',
    editTitle: 'Editar {name}',
    defaultSection: 'Información de {object}',
    fixFields: 'Corrija los campos resaltados.',
    saveAnyway: 'Guardar de todos modos',
    saved: 'Registro guardado: {object} “{name}”',
    created: 'Registro creado: {object} “{name}”',
  },

  iconPicker: {
    choose: 'Elegir un icono',
    label: 'Iconos',
  },

  icons: {
    bookOpen: 'libro abierto',
    bot: 'robot',
    briefcase: 'maletín',
    building: 'edificio',
    building2: 'edificio 2',
    calendarCheck: 'calendario con marca de verificación',
    calendarDays: 'calendario con días',
    chartColumn: 'gráfico de columnas',
    barChart3: 'gráfico de barras 3',
    clipboardList: 'portapapeles con lista',
    contact: 'tarjeta de contacto',
    fileText: 'archivo de texto',
    folderKanban: 'carpeta kanban',
    globe: 'globo terráqueo',
    handshake: 'apretón de manos',
    headphones: 'auriculares',
    heartHandshake: 'apretón de manos con corazón',
    home: 'inicio',
    house: 'casa',
    idCard: 'tarjeta de identificación',
    kanban: 'tablero kanban',
    layoutGrid: 'cuadrícula',
    lifeBuoy: 'salvavidas',
    list: 'lista',
    mail: 'correo',
    megaphone: 'megáfono',
    network: 'red',
    package: 'paquete',
    rocket: 'cohete',
    shieldCheck: 'escudo con marca de verificación',
    sparkles: 'destellos',
    squareCheckBig: 'casilla marcada grande',
    star: 'estrella',
    target: 'diana',
    trendingUp: 'tendencia al alza',
    trophy: 'trofeo',
    userCheck: 'usuario con marca de verificación',
    userPlus: 'usuario con signo más',
    users: 'usuarios',
    wand: 'varita mágica',
    workflow: 'flujo de trabajo',
    zap: 'rayo',
  },

  colors: {
    gray: 'gris',
    blue: 'azul',
    green: 'verde',
    yellow: 'amarillo',
    orange: 'naranja',
    red: 'rojo',
    purple: 'morado',
    pink: 'rosa',
    teal: 'verde azulado',
    indigo: 'índigo',
  },

  chart: {
    noData: 'Sin datos',
  },

  dashboard: {
    report: 'Informe',
    reportDeleted: 'Se ha eliminado el informe',
    loadFailed: 'No se ha podido cargar este informe.',
    emptyTitle: 'Este panel aún no tiene componentes',
    emptyBody: 'Añada informes al panel para ver aquí sus gráficos.',
  },

  notFound: {
    title: 'Página no encontrada',
    body: 'La página que busca no existe o no tiene acceso a ella.',
    home: 'Ir al inicio',
  },

  routeError: {
    newVersion: 'Hay una nueva versión disponible',
    reloadToContinue: 'Vuelva a cargar la página para continuar.',
    unknown: 'Error desconocido',
  },

  homeRedirect: {
    noApps: 'Todavía no hay aplicaciones',
    noAppsHelp: 'Pida a un administrador que cree una aplicación en Configuración.',
  },
} satisfies Translation['components'];
