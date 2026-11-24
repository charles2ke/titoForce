import type { Translation } from '../../index.ts';

export default {
  homeLink: 'titoForce-Startseite',
  askAi: 'KI fragen',

  search: {
    label: 'Alle Datensätze durchsuchen',
    placeholder: 'Accounts, Kontakte, Opportunities, Kundenvorgänge suchen…',
    shortcut: 'Strg K',
    searching: 'Suche läuft…',
    failed: 'Suche fehlgeschlagen',
    noMatches: 'Keine Treffer für „{term}“',
  },

  notifications: {
    title: 'Benachrichtigungen',
    labelUnread: { one: 'Benachrichtigungen ({count} ungelesen)', other: 'Benachrichtigungen ({count} ungelesen)' },
    markAllRead: 'Alle als gelesen markieren',
    empty: 'Sie sind auf dem neuesten Stand.',
  },

  inbox: {
    label: 'Posteingang für Genehmigungen',
    labelPending: { one: 'Posteingang für Genehmigungen ({count} ausstehend)', other: 'Posteingang für Genehmigungen ({count} ausstehend)' },
  },

  changePassword: {
    title: 'Passwort ändern',
    submit: 'Passwort ändern',
    current: 'Aktuelles Passwort',
    new: 'Neues Passwort',
    help: 'Mindestens 8 Zeichen.',
    success: 'Passwort geändert',
  },

  userMenu: {
    label: 'Benutzermenü',
    settings: 'Meine Einstellungen',
    changePassword: 'Passwort ändern',
    signOut: 'Abmelden',
  },

  apps: {
    switch: 'App wechseln',
    caption: 'App',
    choose: 'App auswählen',
    list: 'Apps',
  },

  nav: {
    main: 'Hauptnavigation',
    workspace: 'Arbeitsbereich',
    agents: 'KI-Agenten',
    approvals: 'Genehmigungen',
    reports: 'Berichte',
    dashboards: 'Dashboards',
    setup: 'Setup',
  },

  ai: {
    status: 'KI: {provider}',
    offline: 'KI: Offline-Regel-Engine',
  },

  aiPanel: {
    label: 'KI-Assistent',
    agent: 'Agent',
    newChat: 'Neuer Chat',
    close: 'Assistent schließen',
    context: 'Kontext: {record}',
    loadingAgents: 'Agenten werden geladen…',
    noAgents: 'Keine aktiven Agenten.',
  },

  mobile: {
    openNav: 'Navigation öffnen',
    closeNav: 'Navigation schließen',
    nav: 'Navigation',
  },
} satisfies Translation['shell'];
