import type { Translation } from '../../index.ts';

export default {
  homeLink: 'Accueil titoForce',
  askAi: 'Demander à l’IA',

  search: {
    label: 'Rechercher dans tous les enregistrements',
    placeholder: 'Rechercher des comptes, contacts, opportunités, requêtes…',
    shortcut: 'Ctrl K',
    searching: 'Recherche en cours…',
    failed: 'Échec de la recherche',
    noMatches: 'Aucun résultat pour « {term} »',
  },

  notifications: {
    title: 'Notifications',
    labelUnread: { one: 'Notifications ({count} non lue)', other: 'Notifications ({count} non lues)' },
    markAllRead: 'Tout marquer comme lu',
    empty: 'Vous êtes à jour.',
  },

  inbox: {
    label: 'Boîte de réception des approbations',
    labelPending: {
      one: 'Boîte de réception des approbations ({count} en attente)',
      other: 'Boîte de réception des approbations ({count} en attente)',
    },
  },

  changePassword: {
    title: 'Modifier le mot de passe',
    submit: 'Modifier le mot de passe',
    current: 'Mot de passe actuel',
    new: 'Nouveau mot de passe',
    help: 'Au moins 8 caractères.',
    success: 'Mot de passe modifié',
  },

  userMenu: {
    label: 'Menu utilisateur',
    settings: 'Mes paramètres',
    changePassword: 'Modifier le mot de passe',
    signOut: 'Se déconnecter',
  },

  apps: {
    switch: 'Changer d’application',
    caption: 'Application',
    choose: 'Choisir une application',
    list: 'Applications',
  },

  nav: {
    main: 'Principale',
    workspace: 'Espace de travail',
    agents: 'Agents IA',
    approvals: 'Approbations',
    reports: 'Rapports',
    dashboards: 'Tableaux de bord',
    setup: 'Configuration',
  },

  ai: {
    status: 'IA : {provider}',
    offline: 'IA : moteur de règles hors ligne',
  },

  aiPanel: {
    label: 'Assistant IA',
    agent: 'Agent',
    newChat: 'Nouvelle conversation',
    close: 'Fermer l’assistant',
    context: 'Contexte : {record}',
    loadingAgents: 'Chargement des agents…',
    noAgents: 'Aucun agent actif.',
  },

  mobile: {
    openNav: 'Ouvrir la navigation',
    closeNav: 'Fermer la navigation',
    nav: 'Navigation',
  },
} satisfies Translation['shell'];
