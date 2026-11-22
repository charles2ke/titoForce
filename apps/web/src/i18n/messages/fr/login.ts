import type { Translation } from '../../index.ts';

export default {
  tagline: 'Le CRM agentique pour toute votre entreprise.',
  intro: 'Une plateforme unique pilotée par les métadonnées pour les clients, le travail et les collaborateurs, avec des agents IA intégrés.',
  highlights: {
    sales: 'Ventes : pistes, comptes, pipeline, devis et prévisions',
    service: 'Service : requêtes, base de connaissances et SLA',
    work: 'Travail : projets, tableaux, calendriers et chronologies',
    people: 'RH : employés, congés, évaluations et recrutement',
    ai: 'Des agents IA qui agissent avec les mêmes autorisations que vous',
  },
  license: 'Open source · AGPL-3.0',

  title: 'Connexion',
  subtitle: 'Bon retour parmi nous. Saisissez votre e-mail professionnel et votre mot de passe.',
  submit: 'Se connecter',

  demo: {
    signInAs: 'Entreprise de démonstration : se connecter en tant que',
    password: 'Mot de passe de démonstration : {password}',
  },
} satisfies Translation['login'];
