import type { Translation } from '../../index.ts';

export default {
  title: 'Rôles et autorisations',
  subtitle: 'Définissez ce que chaque rôle peut voir et faire, objet par objet.',
  newRole: 'Nouveau rôle',
  empty: 'Aucun rôle pour le moment',
  listLabel: 'Rôles',
  admin: 'Admin',
  userCount: { one: '{count} utilisateur', other: '{count} utilisateurs' },
  roleName: 'Nom du rôle',

  levels: {
    none: 'Aucun',
    own: 'Ses propres enregistrements',
    all: 'Tous les enregistrements',
  },

  capabilities: {
    title: 'Autorisations générales',
    adminAlwaysOn: 'Toujours activées pour le rôle administrateur, afin que personne ne se retrouve sans accès.',
    setup: {
      label: 'Administrateur (accès à la configuration)',
      help: 'Gérer les objets, les champs, les utilisateurs, les rôles et les applications. Donne aussi accès aux automatisations et aux agents IA.',
    },
    viewSensitive: {
      label: 'Afficher les champs sensibles',
      help: 'Voir et modifier les champs marqués comme sensibles, comme les salaires.',
    },
    manageAutomations: {
      label: 'Gérer les automatisations',
      help: 'Créer et modifier des automatisations, des processus d’approbation, des rapports et des tableaux de bord, et consulter l’historique d’exécution des automatisations.',
    },
    manageAgents: {
      label: 'Gérer les agents IA',
      help: 'Créer et modifier des agents IA et consulter toutes les exécutions d’agents.',
    },
  },

  editor: {
    deleteRole: 'Supprimer le rôle',
    deleteTitle: 'Supprimer le rôle {name} ?',
    deleteMessage: 'Le rôle et ses autorisations sont définitivement supprimés.',
    adminNotDeletable: 'Le rôle administrateur ne peut pas être supprimé.',
    reassignUsers: {
      one: '{count} utilisateur possède ce rôle : attribuez-lui d’abord un autre rôle.',
      other: '{count} utilisateurs possèdent ce rôle : attribuez-leur d’abord un autre rôle.',
    },
    saved: 'Rôle {name} enregistré',
    deleted: 'Rôle {name} supprimé',
    removeOwnSetupTitle: 'Retirer votre propre accès à la configuration ?',
    removeOwnSetupMessage: 'Vous avez ce rôle : après l’enregistrement, vous ne pourrez plus ouvrir la configuration.',
    saveAnyway: 'Enregistrer quand même',
    unsavedChanges: 'Modifications non enregistrées',
    discard: 'Abandonner',
    save: 'Enregistrer le rôle',
  },

  objectPermissions: {
    title: 'Autorisations sur les objets',
    help: '« {own} » désigne les enregistrements dont l’utilisateur est propriétaire. Les objets sans paramètres propres utilisent la ligne par défaut.',
    helpSetup:
      '« {own} » désigne les enregistrements dont l’utilisateur est propriétaire. Les objets sans paramètres propres utilisent la ligne par défaut. L’accès à la configuration ne contourne pas ces paramètres.',
    defaultRow: 'Par défaut pour les autres objets',
    columns: {
      read: 'Lecture',
      create: 'Création',
      edit: 'Modification',
      delete: 'Suppression',
    },
    controls: {
      read: '{object} : lecture',
      create: '{object} : création',
      edit: '{object} : modification',
      delete: '{object} : suppression',
    },
    inherited: 'Par défaut',
    unknownObject: 'Objet inconnu',
    unknownObjectHelp:
      'Cet objet n’existe plus ou vous n’avez pas le droit de le lire. Retirez la ligne si l’objet a été supprimé — sinon, l’enregistrement échouera.',
    removeRow: 'Retirer les autorisations pour l’objet {object}',
    useDefault: 'Utiliser les autorisations par défaut pour l’objet {object}',
  },

  createForm: {
    title: 'Nouveau rôle',
    create: 'Créer le rôle',
    created: 'Rôle {name} créé',
    namePlaceholder: 'Succès client',
    roleId: 'Identifiant du rôle',
    roleIdHelp: 'Identifiant permanent, par ex. {example}.',
    idInvalid: 'Utilisez de 2 à 40 lettres minuscules, chiffres et traits de soulignement, en commençant par une lettre.',
    idExists: 'Un rôle avec cet identifiant existe déjà.',
    startFrom: 'Partir de',
    startFromHelp: 'Copiez les autorisations d’un rôle existant ou commencez sans aucun accès.',
    noAccess: 'Aucun accès',
  },
} satisfies Translation['setupRoles'];
