/** Shared UI building blocks: form controls, field rendering, record form, pickers, charts, dashboards and error pages. */
export default {
  /** Accessible name of a loading spinner. */
  spinner: 'Loading',
  /** Screen-reader-only text read after the label of a required form field. */
  requiredSuffix: '(required)',
  tryAgain: 'Try again',
  /** Asked before leaving a page (or switching what it edits) while it has unsaved changes. */
  unsaved: {
    title: 'Discard unsaved changes?',
    message: 'Your changes on this page have not been saved.',
    /** Button: leave and lose the changes. */
    discard: 'Discard changes',
  },

  pagination: {
    /** Range of rows shown, e.g. "1–25 of 340". */
    range: '{from}–{to} of {total}',
  },

  fieldValue: {
    /** Shown instead of a linked record the user is not allowed to see. */
    restricted: 'Restricted record',
  },

  lookup: {
    /** Shown while the name of an already selected record has not been loaded. */
    selected: 'Selected record',
    clear: 'Clear selection',
    searchAny: 'Search any record…',
    /** {objects} is the plural name of the records to search, e.g. "Search accounts…". */
    searchObject: 'Search {objects}…',
    searchRecords: 'Search records…',
    searching: 'Searching…',
    typeToSearch: 'Type to search',
    noMatches: 'No matches',
  },

  recordForm: {
    /** Dialog title when creating a record; {object} is the object name, e.g. "New Account". */
    newTitle: 'New {object}',
    /** Dialog title when editing a record; {name} is the record's name. */
    editTitle: 'Edit {name}',
    /** Heading of the form section for fields without a section; {object} is the object name, e.g. "Account Information". */
    defaultSection: '{object} Information',
    fixFields: 'Please fix the highlighted fields.',
    saveAnyway: 'Save anyway',
    /** {object} is the object name and {name} the record's name, e.g. 'Account "Acme" saved'. */
    saved: '{object} "{name}" saved',
    created: '{object} "{name}" created',
  },

  iconPicker: {
    choose: 'Choose an icon',
    /** Accessible name of the grid of icons. */
    label: 'Icons',
  },

  /** Names of the icons in the icon picker (tooltips and accessible names): describe what the picture shows, in lower case. */
  icons: {
    bookOpen: 'book open',
    bot: 'bot',
    briefcase: 'briefcase',
    building: 'building',
    building2: 'building 2',
    calendarCheck: 'calendar check',
    calendarDays: 'calendar days',
    chartColumn: 'chart column',
    barChart3: 'bar chart 3',
    clipboardList: 'clipboard list',
    contact: 'contact',
    fileText: 'file text',
    folderKanban: 'folder kanban',
    globe: 'globe',
    handshake: 'handshake',
    headphones: 'headphones',
    heartHandshake: 'heart handshake',
    home: 'home',
    house: 'house',
    idCard: 'id card',
    kanban: 'kanban',
    layoutGrid: 'layout grid',
    lifeBuoy: 'life buoy',
    list: 'list',
    mail: 'mail',
    megaphone: 'megaphone',
    network: 'network',
    package: 'package',
    rocket: 'rocket',
    shieldCheck: 'shield check',
    sparkles: 'sparkles',
    squareCheckBig: 'square check big',
    star: 'star',
    target: 'target',
    trendingUp: 'trending up',
    trophy: 'trophy',
    userCheck: 'user check',
    userPlus: 'user plus',
    users: 'users',
    wand: 'wand',
    workflow: 'workflow',
    zap: 'zap',
  },

  /** Color names of the palette swatches (tooltips and accessible names), in lower case. */
  colors: {
    gray: 'gray',
    blue: 'blue',
    green: 'green',
    yellow: 'yellow',
    orange: 'orange',
    red: 'red',
    purple: 'purple',
    pink: 'pink',
    teal: 'teal',
    indigo: 'indigo',
  },

  chart: {
    noData: 'No data',
  },

  dashboard: {
    /** Fallback title of a dashboard widget whose report has no name. */
    report: 'Report',
    reportDeleted: 'Report was deleted',
    loadFailed: 'This report could not be loaded.',
    emptyTitle: 'This dashboard has no widgets yet',
    emptyBody: 'Add reports to the dashboard to see their charts here.',
  },

  notFound: {
    title: 'Page not found',
    body: "The page you're looking for doesn't exist or you don't have access to it.",
    home: 'Go to home',
  },

  routeError: {
    /** Title shown when the app was updated while open and a part of it could not be loaded. */
    newVersion: 'A new version is available',
    reloadToContinue: 'Reload the page to continue.',
    unknown: 'Unknown error',
  },

  homeRedirect: {
    noApps: 'No apps yet',
    noAppsHelp: 'Ask an administrator to create an app in Setup.',
  },
};
