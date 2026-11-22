import type { Translation } from '../../index.ts';

export default {
  signIn: {
    organization: 'Organisation',
    organizationHelp: 'Die ID, die Sie von Ihrem Administrator erhalten haben, z. B. „acme“.',
    to: 'Anmeldung bei {name}',
    notFound: 'Es gibt keine Organisation „{slug}“.',
    noAccount: 'Neu bei titoForce?',
    createOrganization: 'Organisation erstellen',
  },

  signUp: {
    title: 'Ihre Organisation erstellen',
    subtitle: 'Ihre Organisation erhält eine eigene Datenbank und Sie verwalten sie als Administrator.',
    organizationName: 'Name der Organisation',
    organizationId: 'Organisations-ID',
    organizationIdHelp: 'Wird für die Anmeldung verwendet: Kleinbuchstaben, Ziffern und Bindestriche.',
    yourName: 'Ihr Name',
    passwordHelp: 'Mindestens 8 Zeichen.',
    demo: 'Beispieldatensätze zum Ausprobieren hinzufügen',
    submit: 'Organisation erstellen',
    haveAccount: 'Haben Sie bereits eine Organisation?',
    signIn: 'Anmelden',
    disabled: 'Die Registrierung ist auf diesem Server nicht aktiviert. Bitten Sie den Serveradministrator um ein Konto.',
  },

  switcher: {
    title: 'Organisation wechseln',
    help: 'Jede Organisation hat eigene Benutzer und Daten. Deshalb melden Sie sich bei jeder Organisation separat an.',
    organizationId: 'Organisations-ID',
    recent: 'Zuletzt verwendet',
    current: 'Aktuell',
    open: 'Öffnen',
  },

  sandbox: {
    badge: 'Sandbox',
    banner: 'Sandbox {name} von {parent}. Änderungen hier wirken sich nicht auf die Produktion aus.',
    openProduction: 'Produktion öffnen',
  },

  problem: {
    title: 'Diese Organisation ist nicht verfügbar',
    tryAgain: 'Erneut versuchen',
    otherOrganization: 'Bei einer anderen Organisation anmelden',
  },

  native: {
    title: 'Mit Ihrem Server verbinden',
    subtitle: 'Geben Sie die Adresse des titoForce-Servers Ihrer Organisation ein.',
    server: 'Serveradresse',
    serverPlaceholder: 'crm.example.com',
    connect: 'Verbinden',
    invalid: 'Geben Sie eine Webadresse wie crm.example.com ein.',
    unreachable: 'Unter {url} ist kein titoForce-Server erreichbar. Prüfen Sie die Adresse und ob der Server diese App zulässt.',
    connectedTo: 'Server: {url}',
    change: 'Ändern',
  },
} satisfies Translation['orgs'];
