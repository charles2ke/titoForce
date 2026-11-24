import type { Translation } from '../../index.ts';

export default {
  greeting: {
    morning: 'Bonjour, {name}',
    afternoon: 'Bon après-midi, {name}',
    evening: 'Bonsoir, {name}',
  },
  askAi: 'Demander à l’IA',
  quickLinks: 'Liens rapides',
  myWork: 'Mon travail',
  appNotFound: {
    title: 'Application introuvable',
    message: 'Cette application n’existe pas ou a été supprimée.',
    goHome: 'Aller à votre page d’accueil',
  },

  dashboard: {
    title: 'Tableau de bord',
    open: 'Ouvrir le tableau de bord',
    noneAssigned: 'Aucun tableau de bord n’est attribué à cette application.',
    browse: 'Parcourir les tableaux de bord',
  },

  tasks: {
    title: 'Mes tâches à faire',
    allActivities: 'Toutes les activités',
    empty: 'Aucune tâche à faire — vous êtes à jour.',
    markComplete: 'Marquer comme terminée',
    markNamedComplete: 'Marquer « {name} » comme terminée',
    completed: 'Tâche terminée',
    overdue: 'En retard · {date}',
    dueToday: 'Aujourd’hui · {date}',
    noDate: 'Sans date',
    more: { one: '+{count} autre tâche à faire', other: '+{count} autres tâches à faire' },
  },

  approvals: {
    title: 'En attente de mon approbation',
    inbox: 'Boîte de réception',
    empty: 'Aucune demande en attente de votre réponse.',
    details: '{process} · par {user} · {time}',
    viewAll: 'Tout afficher ({count})',
  },

  runs: {
    title: 'Activité IA récente',
    agents: 'Agents',
    empty: 'Aucune exécution d’agent pour le moment. Posez une question à un agent pour commencer.',
    status: {
      running: 'en cours',
      completed: 'terminée',
      failed: 'échec',
    },
    trigger: {
      automation: 'automatisation',
      recordAction: 'action sur l’enregistrement',
      api: 'API',
    },
  },
} satisfies Translation['home'];
