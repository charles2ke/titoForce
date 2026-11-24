import type { Translation } from '../../index.ts';

export default {
  title: 'Sandbox',
  subtitle:
    'Des copies de cette organisation pour concevoir et tester des modifications sans affecter personne. Déployez en production ce qui fonctionne.',
  newSandbox: 'Nouvelle sandbox',
  usage: '{count} sandbox sur {max}',
  limitReached: 'Cette organisation a atteint le nombre maximal de sandbox. Supprimez-en une pour en créer une autre.',
  unavailable: 'Les sandbox sont gérées depuis l’organisation de production.',
  empty: {
    title: 'Aucune sandbox pour le moment',
    message:
      'Créez une sandbox pour essayer de nouveaux champs, présentations de page, automatisations ou agents avant que vos utilisateurs ne les voient.',
  },
  signInHint:
    'Les sandbox s’ouvrent dans un nouvel onglet. Connectez-vous avec l’e-mail et le mot de passe que vous aviez en production lors de la copie de la sandbox.',

  columns: {
    sandbox: 'Sandbox',
    type: 'Copie',
    status: 'Statut',
    createdBy: 'Créée par',
    copied: 'Dernière copie',
  },

  types: {
    developer: {
      label: 'Développeur',
      help: 'Configuration et utilisateurs. Création rapide ; aucun enregistrement au départ.',
    },
    full: {
      label: 'Copie complète',
      help: 'Configuration, utilisateurs et tous les enregistrements. Prend plus de temps pour les grandes organisations.',
    },
  },

  status: {
    active: 'Prête',
    provisioning: 'Copie en cours…',
    refreshing: 'Actualisation en cours…',
    suspended: 'Suspendue',
    failed: 'Échec de la copie',
  },

  actions: {
    open: 'Ouvrir',
    deploy: 'Comparer et déployer',
    refresh: 'Actualiser',
    delete: 'Supprimer',
    more: 'Plus d’actions pour {name}',
  },

  create: {
    title: 'Nouvelle sandbox',
    name: 'Nom',
    nameHelp: 'Lettres, chiffres et traits d’union, par ex. « dev » ou « recette ». On y accède avec l’identifiant {slug}.',
    invalidName:
      'Utilisez jusqu’à 20 lettres, chiffres et traits d’union non consécutifs, en commençant et en terminant par une lettre ou un chiffre.',
    type: 'Contenu à copier',
    submit: 'Créer la sandbox',
    started: 'Copie de la production dans la sandbox {name}…',
  },

  ready: 'La sandbox {name} est prête',
  failed: 'Échec de la copie de la sandbox {name}',

  refresh: {
    title: 'Actualiser la sandbox {name} ?',
    message:
      'Tout le contenu de la sandbox est remplacé par une nouvelle copie de la production. Les modifications non déployées sont perdues et toutes les personnes connectées à la sandbox sont déconnectées.',
    confirm: 'Actualiser la sandbox',
    started: 'Actualisation de la sandbox {name}…',
  },

  delete: {
    title: 'Supprimer la sandbox {name} ?',
    message: 'La sandbox et tout son contenu sont supprimés. Les modifications non déployées sont perdues. Cette action est irréversible.',
    confirm: 'Supprimer la sandbox',
    done: 'Sandbox {name} supprimée',
  },

  deploy: {
    back: 'Sandbox',
    title: 'Déployer depuis {name}',
    subtitle:
      'Choisissez les modifications à copier en production. Les déploiements ajoutent et mettent à jour la configuration ; ils ne suppriment jamais rien en production.',
    notReady: 'La sandbox n’est pas encore prête. Réessayez une fois la copie terminée.',
    showUnchanged: 'Afficher les composants inchangés',
    selectAll: 'Sélectionner toutes les modifications',
    select: 'Sélectionner {name}',
    noChanges: {
      title: 'Rien à déployer',
      message: 'La sandbox a la même configuration que la production.',
    },
    columns: {
      component: 'Composant',
      type: 'Type',
      object: 'Objet',
      change: 'Modification',
    },
    types: {
      object: 'Objet',
      layout: 'Présentation de page',
      translation: 'Traductions',
      app: 'Application',
      automation: 'Automatisation',
      approval_process: 'Processus d’approbation',
      agent: 'Agent',
      report: 'Rapport',
      dashboard: 'Tableau de bord',
      role: 'Rôle',
    },
    statuses: {
      new: 'Nouveau',
      changed: 'Modifié',
      unchanged: 'Inchangé',
      production_only: 'Uniquement en production',
    },
    fields: {
      added: { one: '{count} nouveau champ', other: '{count} nouveaux champs' },
      changed: { one: '{count} champ modifié', other: '{count} champs modifiés' },
      productionOnly: { one: '{count} champ uniquement en production', other: '{count} champs uniquement en production' },
    },
    labels: {
      added: { one: '{count} nouveau libellé', other: '{count} nouveaux libellés' },
      changed: { one: '{count} libellé modifié', other: '{count} libellés modifiés' },
      productionOnly: { one: '{count} libellé uniquement en production', other: '{count} libellés uniquement en production' },
    },
    selected: { one: '{count} composant sélectionné', other: '{count} composants sélectionnés' },
    submit: 'Déployer en production',
    confirm: {
      title: 'Déployer en production ?',
      message: {
        one: '{count} composant sera copié en production et prendra effet immédiatement pour tous les utilisateurs. Un déploiement ne peut pas être annulé, mais vous pouvez déployer à nouveau.',
        other:
          '{count} composants seront copiés en production et prendront effet immédiatement pour tous les utilisateurs. Un déploiement ne peut pas être annulé, mais vous pouvez déployer à nouveau.',
      },
      confirm: 'Déployer',
    },
    done: { one: '{count} composant déployé en production', other: '{count} composants déployés en production' },
  },

  history: {
    title: 'Historique des déploiements',
    empty: 'Rien n’a encore été déployé dans cette organisation.',
    columns: {
      date: 'Date',
      from: 'Sandbox source',
      by: 'Déployé par',
      components: 'Composants',
      status: 'Résultat',
    },
    componentCount: { one: '{count} composant', other: '{count} composants' },
    succeeded: 'Déployé',
    failed: 'Échec',
  },
} satisfies Translation['setupSandboxes'];
