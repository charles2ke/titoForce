import type { Translation } from '../../index.ts';

export default {
  title: 'Meine Einstellungen',

  profile: {
    title: 'Profil',
    jobTitle: 'Position',
    adminHint: 'Namen, Positionen und Rollen bearbeiten Sie unter {link}.',
    usersLink: 'Setup › Benutzer',
    askAdmin: 'Bitten Sie einen Administrator, Ihren Namen, Ihre Position oder Ihre Rolle zu ändern.',
  },

  password: {
    title: 'Passwort ändern',
    current: 'Aktuelles Passwort',
    new: 'Neues Passwort',
    help: 'Mindestens 8 Zeichen.',
    confirm: 'Neues Passwort bestätigen',
    mismatch: 'Die Passwörter stimmen nicht überein',
    submit: 'Passwort aktualisieren',
    changed: 'Passwort geändert. Ihre anderen Sitzungen wurden abgemeldet.',
  },

  language: {
    title: 'Sprache',
    help: 'Die Sprache von titoForce auf allen Geräten, auf denen Sie sich anmelden. Bezeichnungen, die Ihre Administratoren nicht übersetzt haben, bleiben auf Englisch.',
    browserDefault: 'Browsersprache ({language})',
  },

  defaultApp: {
    title: 'Standard-App',
    help: 'Hier landen Sie nach der Anmeldung. Ein App-Wechsel über den App-Launcher aktualisiert diese Einstellung ebenfalls (in diesem Browser gespeichert).',
    changed: '{app} ist jetzt Ihre Standard-App',
  },

  ai: {
    title: 'KI-Anbieter',
    connected: 'Verbunden',
    offline: 'Offlinemodus',
    openai: 'OpenAI-kompatibel',
    rulesEngine: 'Integrierte Regel-Engine',
    configuredBy: 'Der Anbieter wird von einem Administrator über Umgebungsvariablen des Servers konfiguriert.',
  },

  access: {
    title: 'Ihr Zugriff',
    capabilities: {
      setup: 'Setup verwalten',
      manageAutomations: 'Automatisierungen, Berichte & Dashboards verwalten',
      manageAgents: 'KI-Agenten verwalten',
      viewSensitive: 'Vertrauliche Felder anzeigen',
    },
    read: 'Lesen',
    create: 'Erstellen',
    edit: 'Bearbeiten',
    delete: 'Löschen',
    all: 'Alle',
    own: 'Eigene',
    footnote: '„{own}“ bezeichnet Datensätze, deren Inhaber Sie sind. Objekte, die Sie nicht lesen können, werden ausgeblendet.',
  },
} satisfies Translation['settings'];
