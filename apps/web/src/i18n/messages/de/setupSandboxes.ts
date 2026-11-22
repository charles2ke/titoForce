import type { Translation } from '../../index.ts';

export default {
  title: 'Sandboxes',
  subtitle: 'Kopien dieser Organisation, in denen Sie Änderungen entwickeln und testen, ohne andere zu beeinträchtigen. Was funktioniert, stellen Sie in der Produktion bereit.',
  newSandbox: 'Neue Sandbox',
  usage: '{count} von {max} Sandboxes',
  limitReached: 'Diese Organisation hat die maximale Anzahl an Sandboxes erreicht. Löschen Sie eine, um eine neue zu erstellen.',
  unavailable: 'Sandboxes werden in der Produktionsorganisation verwaltet.',
  empty: {
    title: 'Noch keine Sandboxes',
    message: 'Erstellen Sie eine Sandbox, um neue Felder, Seitenlayouts, Automatisierungen oder Agenten auszuprobieren, bevor Ihre Benutzer sie sehen.',
  },
  signInHint: 'Sandboxes werden in einem neuen Tab geöffnet. Melden Sie sich mit der E-Mail-Adresse und dem Passwort an, die Sie zum Zeitpunkt der Kopie in der Produktion hatten.',

  columns: {
    sandbox: 'Sandbox',
    type: 'Kopie',
    status: 'Status',
    createdBy: 'Erstellt von',
    copied: 'Kopiert',
  },

  types: {
    developer: {
      label: 'Developer',
      help: 'Konfiguration und Benutzer. Schnell erstellt; enthält anfangs keine Datensätze.',
    },
    full: {
      label: 'Vollständige Kopie',
      help: 'Konfiguration, Benutzer und alle Datensätze. Dauert bei großen Organisationen länger.',
    },
  },

  status: {
    active: 'Bereit',
    provisioning: 'Wird kopiert…',
    refreshing: 'Wird aktualisiert…',
    suspended: 'Gesperrt',
    failed: 'Kopieren fehlgeschlagen',
  },

  actions: {
    open: 'Öffnen',
    deploy: 'Vergleichen und bereitstellen',
    refresh: 'Aktualisieren',
    delete: 'Löschen',
    more: 'Weitere Aktionen für {name}',
  },

  create: {
    title: 'Neue Sandbox',
    name: 'Name',
    nameHelp: 'Buchstaben, Ziffern und Bindestriche, z. B. „dev“ oder „uat“. Die Sandbox ist dann unter {slug} erreichbar.',
    invalidName: 'Verwenden Sie bis zu 20 Buchstaben, Ziffern und einzelne Bindestriche; Anfang und Ende müssen ein Buchstabe oder eine Ziffer sein.',
    type: 'Umfang der Kopie',
    submit: 'Sandbox erstellen',
    started: 'Die Produktion wird in die Sandbox {name} kopiert…',
  },

  ready: 'Sandbox {name} ist bereit',
  failed: 'Kopieren der Sandbox {name} fehlgeschlagen',

  refresh: {
    title: 'Sandbox {name} aktualisieren?',
    message: 'Der gesamte Inhalt der Sandbox wird durch eine neue Kopie der Produktion ersetzt. Nicht bereitgestellte Änderungen gehen verloren, und alle in der Sandbox angemeldeten Benutzer werden abgemeldet.',
    confirm: 'Sandbox aktualisieren',
    started: 'Sandbox {name} wird aktualisiert…',
  },

  delete: {
    title: 'Sandbox {name} löschen?',
    message: 'Die Sandbox und ihr gesamter Inhalt werden gelöscht. Nicht bereitgestellte Änderungen gehen verloren. Dies kann nicht rückgängig gemacht werden.',
    confirm: 'Sandbox löschen',
    done: 'Sandbox {name} gelöscht',
  },

  deploy: {
    back: 'Sandboxes',
    title: 'Aus {name} bereitstellen',
    subtitle: 'Wählen Sie die Änderungen aus, die in die Produktion kopiert werden sollen. Bereitstellungen fügen Konfiguration hinzu und aktualisieren sie, löschen aber nie etwas in der Produktion.',
    notReady: 'Die Sandbox ist noch nicht bereit. Versuchen Sie es erneut, wenn der Kopiervorgang abgeschlossen ist.',
    showUnchanged: 'Unveränderte anzeigen',
    selectAll: 'Alle Änderungen auswählen',
    select: '{name} auswählen',
    noChanges: {
      title: 'Nichts bereitzustellen',
      message: 'Die Sandbox hat dieselbe Konfiguration wie die Produktion.',
    },
    columns: {
      component: 'Komponente',
      type: 'Typ',
      object: 'Objekt',
      change: 'Änderung',
    },
    types: {
      object: 'Objekt',
      layout: 'Seitenlayout',
      translation: 'Übersetzungen',
      app: 'App',
      automation: 'Automatisierung',
      approval_process: 'Genehmigungsprozess',
      agent: 'Agent',
      report: 'Bericht',
      dashboard: 'Dashboard',
      role: 'Rolle',
    },
    statuses: {
      new: 'Neu',
      changed: 'Geändert',
      unchanged: 'Unverändert',
      production_only: 'Nur in der Produktion',
    },
    fields: {
      added: { one: '{count} neues Feld', other: '{count} neue Felder' },
      changed: { one: '{count} geändertes Feld', other: '{count} geänderte Felder' },
      productionOnly: { one: '{count} Feld nur in der Produktion', other: '{count} Felder nur in der Produktion' },
    },
    labels: {
      added: { one: '{count} neue Bezeichnung', other: '{count} neue Bezeichnungen' },
      changed: { one: '{count} geänderte Bezeichnung', other: '{count} geänderte Bezeichnungen' },
      productionOnly: { one: '{count} Bezeichnung nur in der Produktion', other: '{count} Bezeichnungen nur in der Produktion' },
    },
    selected: { one: '{count} Komponente ausgewählt', other: '{count} Komponenten ausgewählt' },
    submit: 'In Produktion bereitstellen',
    confirm: {
      title: 'In Produktion bereitstellen?',
      message: {
        one: '{count} Komponente wird in die Produktion kopiert und gilt sofort für alle. Bereitstellungen können nicht rückgängig gemacht werden, Sie können aber erneut bereitstellen.',
        other: '{count} Komponenten werden in die Produktion kopiert und gelten sofort für alle. Bereitstellungen können nicht rückgängig gemacht werden, Sie können aber erneut bereitstellen.',
      },
      confirm: 'Bereitstellen',
    },
    done: { one: '{count} Komponente in Produktion bereitgestellt', other: '{count} Komponenten in Produktion bereitgestellt' },
  },

  history: {
    title: 'Bereitstellungsverlauf',
    empty: 'In dieser Organisation wurde noch nichts bereitgestellt.',
    columns: {
      date: 'Datum',
      from: 'Aus Sandbox',
      by: 'Bereitgestellt von',
      components: 'Komponenten',
      status: 'Ergebnis',
    },
    componentCount: { one: '{count} Komponente', other: '{count} Komponenten' },
    succeeded: 'Bereitgestellt',
    failed: 'Fehlgeschlagen',
  },
} satisfies Translation['setupSandboxes'];
