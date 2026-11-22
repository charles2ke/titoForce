import type { Translation } from '../../index.ts';

export default {
  spinner: 'Wird geladen',
  requiredSuffix: '(erforderlich)',
  tryAgain: 'Erneut versuchen',
  unsaved: {
    title: 'Nicht gespeicherte Änderungen verwerfen?',
    message: 'Ihre Änderungen auf dieser Seite wurden nicht gespeichert.',
    discard: 'Änderungen verwerfen',
  },

  pagination: {
    range: '{from}–{to} von {total}',
  },

  fieldValue: {
    restricted: 'Eingeschränkter Datensatz',
  },

  lookup: {
    selected: 'Ausgewählter Datensatz',
    clear: 'Auswahl aufheben',
    searchAny: 'Beliebigen Datensatz suchen…',
    searchObject: '{objects} suchen…',
    searchRecords: 'Datensätze suchen…',
    searching: 'Suche läuft…',
    typeToSearch: 'Suchbegriff eingeben',
    noMatches: 'Keine Treffer',
  },

  recordForm: {
    newTitle: '{object} erstellen',
    editTitle: '{name} bearbeiten',
    defaultSection: '{object}-Informationen',
    fixFields: 'Bitte korrigieren Sie die markierten Felder.',
    saveAnyway: 'Trotzdem speichern',
    saved: '{object} „{name}“ gespeichert',
    created: '{object} „{name}“ erstellt',
  },

  iconPicker: {
    choose: 'Symbol auswählen',
    label: 'Symbole',
  },

  icons: {
    bookOpen: 'aufgeschlagenes Buch',
    bot: 'Bot',
    briefcase: 'Aktentasche',
    building: 'Gebäude',
    building2: 'Gebäude 2',
    calendarCheck: 'Kalender mit Häkchen',
    calendarDays: 'Kalendertage',
    chartColumn: 'Säulendiagramm',
    barChart3: 'Balkendiagramm 3',
    clipboardList: 'Klemmbrett mit Liste',
    contact: 'Kontakt',
    fileText: 'Textdatei',
    folderKanban: 'Kanban-Ordner',
    globe: 'Globus',
    handshake: 'Handschlag',
    headphones: 'Kopfhörer',
    heartHandshake: 'Handschlag mit Herz',
    home: 'Zuhause',
    house: 'Haus',
    idCard: 'Ausweis',
    kanban: 'Kanban',
    layoutGrid: 'Rasterlayout',
    lifeBuoy: 'Rettungsring',
    list: 'Liste',
    mail: 'E-Mail',
    megaphone: 'Megafon',
    network: 'Netzwerk',
    package: 'Paket',
    rocket: 'Rakete',
    shieldCheck: 'Schild mit Häkchen',
    sparkles: 'Funkeln',
    squareCheckBig: 'Kästchen mit Häkchen',
    star: 'Stern',
    target: 'Zielscheibe',
    trendingUp: 'Aufwärtstrend',
    trophy: 'Pokal',
    userCheck: 'Benutzer mit Häkchen',
    userPlus: 'Benutzer mit Plus',
    users: 'Personen',
    wand: 'Zauberstab',
    workflow: 'Arbeitsablauf',
    zap: 'Blitz',
  },

  colors: {
    gray: 'Grau',
    blue: 'Blau',
    green: 'Grün',
    yellow: 'Gelb',
    orange: 'Orange',
    red: 'Rot',
    purple: 'Lila',
    pink: 'Rosa',
    teal: 'Petrol',
    indigo: 'Indigo',
  },

  chart: {
    noData: 'Keine Daten',
  },

  dashboard: {
    report: 'Bericht',
    reportDeleted: 'Bericht wurde gelöscht',
    loadFailed: 'Dieser Bericht konnte nicht geladen werden.',
    emptyTitle: 'Dieses Dashboard hat noch keine Widgets',
    emptyBody: 'Fügen Sie dem Dashboard Berichte hinzu, um hier deren Diagramme zu sehen.',
  },

  notFound: {
    title: 'Seite nicht gefunden',
    body: 'Die gesuchte Seite existiert nicht oder Sie haben keinen Zugriff darauf.',
    home: 'Zur Startseite',
  },

  routeError: {
    newVersion: 'Eine neue Version ist verfügbar',
    reloadToContinue: 'Laden Sie die Seite neu, um fortzufahren.',
    unknown: 'Unbekannter Fehler',
  },

  homeRedirect: {
    noApps: 'Noch keine Apps',
    noAppsHelp: 'Bitten Sie einen Administrator, im Setup eine App zu erstellen.',
  },
} satisfies Translation['components'];
