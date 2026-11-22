import type { Translation } from '../../index.ts';

export default {
  greeting: {
    morning: 'Guten Morgen, {name}',
    afternoon: 'Guten Tag, {name}',
    evening: 'Guten Abend, {name}',
  },
  askAi: 'KI fragen',
  quickLinks: 'Schnelllinks',
  myWork: 'Meine Arbeit',
  appNotFound: {
    title: 'App nicht gefunden',
    message: 'Diese App existiert nicht oder wurde entfernt.',
    goHome: 'Zu Ihrer Startseite',
  },

  dashboard: {
    title: 'Dashboard',
    open: 'Dashboard öffnen',
    noneAssigned: 'Dieser App ist kein Dashboard zugewiesen.',
    browse: 'Dashboards anzeigen',
  },

  tasks: {
    title: 'Meine offenen Aufgaben',
    allActivities: 'Alle Aktivitäten',
    empty: 'Nichts offen – Sie sind auf dem neuesten Stand.',
    markComplete: 'Als erledigt markieren',
    markNamedComplete: '„{name}“ als erledigt markieren',
    completed: 'Aufgabe erledigt',
    overdue: 'Überfällig · {date}',
    dueToday: 'Heute · {date}',
    noDate: 'Kein Datum',
    more: { one: '+{count} weitere offene Aufgabe', other: '+{count} weitere offene Aufgaben' },
  },

  approvals: {
    title: 'Warten auf meine Genehmigung',
    inbox: 'Posteingang',
    empty: 'Keine Anfragen, die auf Sie warten.',
    details: '{process} · von {user} · {time}',
    viewAll: 'Alle {count} anzeigen',
  },

  runs: {
    title: 'Letzte KI-Aktivität',
    agents: 'Agenten',
    empty: 'Noch keine Agentenausführungen. Stellen Sie einem Agenten eine Frage, um loszulegen.',
    status: {
      running: 'läuft',
      completed: 'abgeschlossen',
      failed: 'fehlgeschlagen',
    },
    trigger: {
      automation: 'Automatisierung',
      recordAction: 'Datensatzaktion',
      api: 'API',
    },
  },
} satisfies Translation['home'];
