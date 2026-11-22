import type { Translation } from '../../index.ts';

export default {
  tagline: 'Das agentische CRM für Ihr gesamtes Unternehmen.',
  intro: 'Eine metadatengesteuerte Plattform für Kunden, Arbeit und Personal – mit integrierten KI-Agenten.',
  highlights: {
    sales: 'Vertrieb: Leads, Accounts, Pipeline, Angebote und Prognosen',
    service: 'Service: Kundenvorgänge, Wissensdatenbank und SLAs',
    work: 'Arbeit: Projekte, Boards, Kalender und Zeitachsen',
    people: 'Personal: Mitarbeiter, Abwesenheiten, Beurteilungen und Recruiting',
    ai: 'KI-Agenten, die mit denselben Berechtigungen handeln wie Sie',
  },
  license: 'Open Source · AGPL-3.0',

  title: 'Anmelden',
  subtitle: 'Willkommen zurück. Geben Sie Ihre geschäftliche E-Mail-Adresse und Ihr Passwort ein.',
  submit: 'Anmelden',

  demo: {
    signInAs: 'Demo-Unternehmen: anmelden als',
    password: 'Demo-Passwort: {password}',
  },
} satisfies Translation['login'];
