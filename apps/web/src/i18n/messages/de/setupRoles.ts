import type { Translation } from '../../index.ts';

export default {
  title: 'Rollen & Berechtigungen',
  subtitle: 'Legen Sie Objekt für Objekt fest, was jede Rolle sehen und tun kann.',
  newRole: 'Neue Rolle',
  empty: 'Noch keine Rollen',
  listLabel: 'Rollen',
  admin: 'Admin',
  userCount: { one: '{count} Benutzer', other: '{count} Benutzer' },
  roleName: 'Rollenname',

  levels: {
    none: 'Keine',
    own: 'Eigene Datensätze',
    all: 'Alle Datensätze',
  },

  capabilities: {
    title: 'Systemberechtigungen',
    adminAlwaysOn: 'Für die Administratorrolle immer aktiv, damit sich niemand aussperrt.',
    setup: {
      label: 'Administrator (Setup-Zugriff)',
      help: 'Objekte, Felder, Benutzer, Rollen und Apps verwalten. Umfasst auch Automatisierungen und KI-Agenten.',
    },
    viewSensitive: {
      label: 'Vertrauliche Felder anzeigen',
      help: 'Als vertraulich markierte Felder wie Gehälter sehen und bearbeiten.',
    },
    manageAutomations: {
      label: 'Automatisierungen verwalten',
      help: 'Automatisierungen, Genehmigungsprozesse, Berichte und Dashboards erstellen und bearbeiten sowie den Ausführungsverlauf von Automatisierungen einsehen.',
    },
    manageAgents: {
      label: 'KI-Agenten verwalten',
      help: 'KI-Agenten erstellen und bearbeiten sowie jede Agentenausführung einsehen.',
    },
  },

  editor: {
    deleteRole: 'Rolle löschen',
    deleteTitle: '{name} löschen?',
    deleteMessage: 'Die Rolle und ihre Berechtigungen werden endgültig gelöscht.',
    adminNotDeletable: 'Die Administratorrolle kann nicht gelöscht werden.',
    reassignUsers: {
      one: 'Weisen Sie den Benutzer mit dieser Rolle zuerst einer anderen Rolle zu.',
      other: 'Weisen Sie die {count} Benutzer mit dieser Rolle zuerst einer anderen Rolle zu.',
    },
    saved: '{name} gespeichert',
    deleted: '{name} gelöscht',
    removeOwnSetupTitle: 'Eigenen Setup-Zugriff entfernen?',
    removeOwnSetupMessage: 'Sie haben diese Rolle. Nach dem Speichern können Sie das Setup nicht mehr öffnen.',
    saveAnyway: 'Trotzdem speichern',
    unsavedChanges: 'Nicht gespeicherte Änderungen',
    discard: 'Verwerfen',
    save: 'Rolle speichern',
  },

  objectPermissions: {
    title: 'Objektberechtigungen',
    help: '„{own}“ bezeichnet Datensätze, deren Inhaber der Benutzer ist. Objekte ohne eigene Einstellungen verwenden die Standardzeile.',
    helpSetup: '„{own}“ bezeichnet Datensätze, deren Inhaber der Benutzer ist. Objekte ohne eigene Einstellungen verwenden die Standardzeile. Setup-Zugriff setzt diese Einstellungen nicht außer Kraft.',
    defaultRow: 'Standard für andere Objekte',
    columns: {
      read: 'Lesen',
      create: 'Erstellen',
      edit: 'Bearbeiten',
      delete: 'Löschen',
    },
    controls: {
      read: '{object}: lesen',
      create: '{object}: erstellen',
      edit: '{object}: bearbeiten',
      delete: '{object}: löschen',
    },
    inherited: 'Standard',
    unknownObject: 'Unbekanntes Objekt',
    unknownObjectHelp: 'Dieses Objekt existiert nicht mehr oder Sie können es nicht lesen. Entfernen Sie die Zeile, falls das Objekt gelöscht wurde – andernfalls schlägt das Speichern fehl.',
    removeRow: 'Berechtigungen für {object} entfernen',
    useDefault: 'Standard für {object} verwenden',
  },

  createForm: {
    title: 'Neue Rolle',
    create: 'Rolle erstellen',
    created: '{name} erstellt',
    namePlaceholder: 'Kundenbetreuung',
    roleId: 'Rollen-ID',
    roleIdHelp: 'Dauerhafte Kennung, z. B. {example}.',
    idInvalid: 'Verwenden Sie 2–40 Kleinbuchstaben, Ziffern und Unterstriche, beginnend mit einem Buchstaben.',
    idExists: 'Es gibt bereits eine Rolle mit dieser ID.',
    startFrom: 'Basierend auf',
    startFromHelp: 'Kopieren Sie die Berechtigungen einer vorhandenen Rolle oder beginnen Sie ohne Zugriff.',
    noAccess: 'Kein Zugriff',
  },
} satisfies Translation['setupRoles'];
