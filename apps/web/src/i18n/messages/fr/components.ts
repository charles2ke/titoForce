import type { Translation } from '../../index.ts';

export default {
  spinner: 'Chargement',
  requiredSuffix: '(obligatoire)',
  tryAgain: 'Réessayer',
  unsaved: {
    title: 'Abandonner les modifications non enregistrées ?',
    message: 'Vos modifications sur cette page n’ont pas été enregistrées.',
    discard: 'Abandonner les modifications',
  },

  pagination: {
    range: '{from}–{to} sur {total}',
  },

  fieldValue: {
    restricted: 'Enregistrement restreint',
  },

  lookup: {
    selected: 'Enregistrement sélectionné',
    clear: 'Effacer la sélection',
    searchAny: 'Rechercher un enregistrement…',
    searchObject: 'Rechercher des {objects}…',
    searchRecords: 'Rechercher des enregistrements…',
    searching: 'Recherche en cours…',
    typeToSearch: 'Tapez pour rechercher',
    noMatches: 'Aucun résultat',
  },

  recordForm: {
    newTitle: 'Créer : {object}',
    editTitle: 'Modifier {name}',
    defaultSection: 'Informations : {object}',
    fixFields: 'Veuillez corriger les champs en surbrillance.',
    saveAnyway: 'Enregistrer quand même',
    saved: 'Modifications enregistrées : {object} « {name} »',
    created: 'Enregistrement créé : {object} « {name} »',
  },

  iconPicker: {
    choose: 'Choisir une icône',
    label: 'Icônes',
  },

  icons: {
    bookOpen: 'livre ouvert',
    bot: 'robot',
    briefcase: 'porte-documents',
    building: 'immeuble',
    building2: 'immeuble 2',
    calendarCheck: 'calendrier coché',
    calendarDays: 'jours du calendrier',
    chartColumn: 'graphique à colonnes',
    barChart3: 'graphique à barres 3',
    clipboardList: 'porte-bloc avec liste',
    contact: 'contact',
    fileText: 'fichier texte',
    folderKanban: 'dossier kanban',
    globe: 'globe',
    handshake: 'poignée de main',
    headphones: 'casque audio',
    heartHandshake: 'cœur et poignée de main',
    home: 'accueil',
    house: 'maison',
    idCard: 'carte d’identité',
    kanban: 'kanban',
    layoutGrid: 'grille de mise en page',
    lifeBuoy: 'bouée de sauvetage',
    list: 'liste',
    mail: 'courrier',
    megaphone: 'mégaphone',
    network: 'réseau',
    package: 'colis',
    rocket: 'fusée',
    shieldCheck: 'bouclier coché',
    sparkles: 'étincelles',
    squareCheckBig: 'grande case cochée',
    star: 'étoile',
    target: 'cible',
    trendingUp: 'tendance à la hausse',
    trophy: 'trophée',
    userCheck: 'utilisateur coché',
    userPlus: 'ajout d’utilisateur',
    users: 'utilisateurs',
    wand: 'baguette magique',
    workflow: 'flux de travail',
    zap: 'éclair',
  },

  colors: {
    gray: 'gris',
    blue: 'bleu',
    green: 'vert',
    yellow: 'jaune',
    orange: 'orange',
    red: 'rouge',
    purple: 'violet',
    pink: 'rose',
    teal: 'bleu canard',
    indigo: 'indigo',
  },

  chart: {
    noData: 'Aucune donnée',
  },

  dashboard: {
    report: 'Rapport',
    reportDeleted: 'Le rapport a été supprimé',
    loadFailed: 'Impossible de charger ce rapport.',
    emptyTitle: 'Ce tableau de bord ne contient encore aucun composant',
    emptyBody: 'Ajoutez des rapports au tableau de bord pour afficher leurs graphiques ici.',
  },

  notFound: {
    title: 'Page introuvable',
    body: 'La page que vous recherchez n’existe pas ou vous n’y avez pas accès.',
    home: 'Retour à l’accueil',
  },

  routeError: {
    newVersion: 'Une nouvelle version est disponible',
    reloadToContinue: 'Rechargez la page pour continuer.',
    unknown: 'Erreur inconnue',
  },

  homeRedirect: {
    noApps: 'Aucune application pour le moment',
    noAppsHelp: 'Demandez à un administrateur de créer une application dans Configuration.',
  },
} satisfies Translation['components'];
