import type { Translation } from '../../index.ts';

export default {
  viewType: {
    table: 'Tabelle',
    kanban: 'Kanban',
    calendar: 'Kalender',
    timeline: 'Zeitachse',
  },

  views: {
    all: 'Alle {plural}',
    pickerLabel: 'Listenansicht auswählen',
    menuLabel: 'Listenansichten',
    shared: 'Freigegebene Ansichten',
    mine: 'Meine Ansichten',
    others: 'Ansichten anderer Benutzer',
    actions: 'Ansichtsaktionen',
    rename: 'Umbenennen',
    delete: 'Ansicht löschen',
    saveAs: 'Als Ansicht speichern',
    saveAsTitle: 'Als neue Ansicht speichern',
    renameTitle: 'Ansicht umbenennen',
    copyName: '{name} (Kopie)',
    nameLabel: 'Ansichtsname',
    nameRequired: 'Geben Sie der Ansicht einen Namen.',
    shareWithEveryone: 'Für alle freigeben',
    savedNew: 'Ansicht „{name}“ gespeichert',
    saved: 'Ansicht gespeichert',
    deleteTitle: 'Listenansicht löschen?',
    deleteMessage: '„{name}“ wird entfernt.',
    deleteMessageShared: '„{name}“ wird für alle entfernt.',
    deleted: 'Ansicht gelöscht',
  },

  columns: {
    button: 'Spalten',
    shown: '{shown} von {max} Spalten angezeigt',
    reset: 'Auf Standard zurücksetzen',
  },

  toolbar: {
    displayAs: 'Anzeigen als',
    groupBy: 'Gruppieren nach',
    dateField: 'Datum',
    searchPlaceholder: '{plural} durchsuchen…',
    searchLabel: '{plural} durchsuchen',
    filters: 'Filter',
    filtersCount: 'Filter ({count})',
    clearFilters: 'Filter löschen',
    resetToView: 'Auf Ansicht zurücksetzen',
    filteredBy: 'Gefiltert nach:',
  },

  import: {
    title: '{plural} importieren',
    instructions:
      'Die erste Zeile muss Spaltenüberschriften enthalten, die den Feldbezeichnungen oder API-Namen von {label} entsprechen. Lookups und Benutzer können per Name, ID oder (bei Benutzern) E-Mail-Adresse angegeben werden. Bis zu {max} Zeilen.',
    file: 'CSV-Datei',
    contentsOf: 'Inhalt von {file}',
    paste: 'Oder CSV einfügen',
    created: { one: '{count} {singular} erstellt.', other: '{count} {plural} erstellt.' },
    createdWithFailures: { one: '{count} {singular} erstellt; {rows} fehlgeschlagen.', other: '{count} {plural} erstellt; {rows} fehlgeschlagen.' },
    rows: { one: '{count} Zeile', other: '{count} Zeilen' },
    rowError: 'Zeile {row}: {message}',
    columnMapping: 'Spaltenzuordnung',
    ignored: 'ignoriert',
  },

  objectNotFound: {
    title: 'Objekt nicht gefunden',
    body: 'Es wurde möglicherweise gelöscht oder Sie haben keinen Zugriff darauf.',
  },
} satisfies Translation['list'];
