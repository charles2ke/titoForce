import type { Translation } from '../../index.ts';

export default {
  title: 'Mes paramètres',

  profile: {
    title: 'Profil',
    jobTitle: 'Fonction',
    adminHint: 'Modifiez les noms, fonctions et rôles dans {link}.',
    usersLink: 'Configuration › Utilisateurs',
    askAdmin: 'Demandez à un administrateur de modifier votre nom, votre fonction ou votre rôle.',
  },

  password: {
    title: 'Modifier le mot de passe',
    current: 'Mot de passe actuel',
    new: 'Nouveau mot de passe',
    help: 'Au moins 8 caractères.',
    confirm: 'Confirmer le nouveau mot de passe',
    mismatch: 'Les mots de passe ne correspondent pas',
    submit: 'Mettre à jour le mot de passe',
    changed: 'Mot de passe modifié. Vos autres sessions ont été déconnectées.',
  },

  language: {
    title: 'Langue',
    help: 'La langue de titoForce sur tous les appareils où vous vous connectez. Les libellés que vos administrateurs n’ont pas traduits restent en anglais.',
    browserDefault: 'Langue du navigateur ({language})',
  },

  defaultApp: {
    title: 'Application par défaut',
    help: 'L’application affichée après la connexion. Changer d’application depuis le lanceur d’applications met aussi à jour ce paramètre (enregistré dans ce navigateur).',
    changed: '{app} est désormais votre application par défaut',
  },

  ai: {
    title: 'Fournisseur d’IA',
    connected: 'Connecté',
    offline: 'Mode hors ligne',
    openai: 'Compatible OpenAI',
    rulesEngine: 'Moteur de règles intégré',
    configuredBy: 'Le fournisseur est configuré par un administrateur au moyen de variables d’environnement du serveur.',
  },

  access: {
    title: 'Vos accès',
    capabilities: {
      setup: 'Administrer la configuration',
      manageAutomations: 'Gérer les automatisations, rapports et tableaux de bord',
      manageAgents: 'Gérer les agents IA',
      viewSensitive: 'Afficher les champs sensibles',
    },
    read: 'Lecture',
    create: 'Création',
    edit: 'Modification',
    delete: 'Suppression',
    all: 'Tous',
    own: 'Les miens',
    footnote: '« {own} » désigne les enregistrements dont vous êtes propriétaire. Les objets que vous ne pouvez pas lire sont masqués.',
  },
} satisfies Translation['settings'];
