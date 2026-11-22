import type { Translation } from '../../index.ts';

export default {
  title: 'Configuration',
  nav: {
    groups: {
      dataModel: 'Modèle de données',
      usersAccess: 'Utilisateurs et accès',
      experience: 'Expérience',
      automation: 'Automatisation',
      ai: 'IA',
      environments: 'Environnements',
    },
    objects: 'Objets et champs',
    users: 'Utilisateurs',
    roles: 'Rôles et autorisations',
    apps: 'Applications',
    translations: 'Traductions',
    automations: 'Automatisations',
    approvalProcesses: 'Processus d’approbation',
    runs: 'Historique des exécutions',
    agents: 'Agents',
    sandboxes: 'Sandbox',
  },
  noAccess: {
    title: 'Vous n’avez pas accès à cette zone',
    message:
      'Cette partie de la configuration nécessite des autorisations supplémentaires. Si vous en avez besoin, demandez à un administrateur de mettre à jour votre rôle.',
  },
} satisfies Translation['setup'];
