import type { Translation } from '../../index.ts';

export default {
  viewType: {
    table: 'Tableau',
    kanban: 'Kanban',
    calendar: 'Calendrier',
    timeline: 'Chronologie',
  },

  views: {
    all: 'Ensemble des {plural}',
    pickerLabel: 'Sélectionner une vue de liste',
    menuLabel: 'Vues de liste',
    shared: 'Vues partagées',
    mine: 'Mes vues',
    others: 'Vues des autres utilisateurs',
    actions: 'Actions de la vue',
    rename: 'Renommer',
    delete: 'Supprimer la vue',
    saveAs: 'Enregistrer comme vue',
    saveAsTitle: 'Enregistrer comme nouvelle vue',
    renameTitle: 'Renommer la vue',
    copyName: '{name} (copie)',
    nameLabel: 'Nom de la vue',
    nameRequired: 'Donnez un nom à la vue.',
    shareWithEveryone: 'Partager avec tout le monde',
    savedNew: 'Vue « {name} » enregistrée',
    saved: 'Vue enregistrée',
    deleteTitle: 'Supprimer la vue de liste ?',
    deleteMessage: 'La vue « {name} » sera supprimée.',
    deleteMessageShared: 'La vue « {name} » sera supprimée pour tout le monde.',
    deleted: 'Vue supprimée',
  },

  columns: {
    button: 'Colonnes',
    shown: '{shown} sur {max} colonnes affichées',
    reset: 'Rétablir les valeurs par défaut',
  },

  toolbar: {
    displayAs: 'Afficher sous forme de',
    groupBy: 'Regrouper par',
    dateField: 'Date',
    searchPlaceholder: 'Rechercher des {plural}…',
    searchLabel: 'Rechercher des {plural}',
    filters: 'Filtres',
    filtersCount: 'Filtres ({count})',
    clearFilters: 'Effacer les filtres',
    resetToView: 'Rétablir la vue',
    filteredBy: 'Filtré par :',
  },

  import: {
    title: 'Importer des {plural}',
    instructions:
      'La première ligne doit contenir des en-têtes de colonne correspondant aux libellés de champ ou aux noms d’API de l’objet {label}. Les champs de référence et les utilisateurs peuvent être indiqués par nom, ID ou (pour les utilisateurs) e-mail. Jusqu’à {max} lignes.',
    file: 'Fichier CSV',
    contentsOf: 'Contenu de {file}',
    paste: 'Ou coller du CSV',
    created: { one: 'Importation terminée : {count} {singular}.', other: 'Importation terminée : {count} {plural}.' },
    createdWithFailures: {
      one: 'Importation terminée : {count} {singular} ; {rows} en échec.',
      other: 'Importation terminée : {count} {plural} ; {rows} en échec.',
    },
    rows: { one: '{count} ligne', other: '{count} lignes' },
    rowError: 'Ligne {row} : {message}',
    columnMapping: 'Correspondance des colonnes',
    ignored: 'ignorée',
  },

  objectNotFound: {
    title: 'Objet introuvable',
    body: 'Il a peut-être été supprimé, ou vous n’y avez peut-être pas accès.',
  },
} satisfies Translation['list'];
