import type { Translation } from '../../index.ts';

export default {
  title: 'Approbations',
  subtitle: 'Demandes d’approbation d’enregistrements et actions d’agents IA nécessitant une décision humaine.',
  tabs: {
    inbox: 'À traiter',
    submitted: 'Soumises par moi',
    all: 'Toutes les demandes',
    agent: 'Actions d’agents',
  },
  empty: {
    inbox: 'Aucune demande en attente de votre approbation',
    submitted: 'Vous n’avez rien soumis pour approbation',
    all: 'Aucune demande d’approbation pour le moment',
  },

  approve: 'Approuver',
  reject: 'Refuser',
  recall: 'Rappeler',

  requestStatus: {
    pending: 'en attente',
    approved: 'approuvée',
    rejected: 'refusée',
    recalled: 'rappelée',
  },
  request: {
    submittedBy: 'soumise par {name}, {time}',
    submittedByYou: 'soumise par vous, {time}',
    approver: 'approbateur : {name}',
    approverYou: 'approbateur : vous',
    approvedAt: 'Approuvée : {time}',
    rejectedAt: 'Refusée : {time}',
    recalledAt: 'Rappelée : {time}',
    quote: '« {text} »',
    recalled: 'Demande rappelée',
  },

  status: {
    pending: 'en attente',
    executing: 'en cours d’exécution',
    executed: 'exécutée',
    rejected: 'refusée',
    failed: 'échec',
  },
  action: {
    wantsToRun: '{agent} souhaite exécuter {tool}',
    viewRecord: 'Afficher l’enregistrement',
    arguments: 'Arguments',
    result: 'Résultat',
    failed: 'L’action a échoué : {error}',
    failedUnknown: 'L’action a échoué : erreur inconnue',
    rejected: 'Action refusée',
    executed: 'Action approuvée et exécutée',
  },
  agentActions: {
    intro: 'Les agents dont le niveau d’autonomie est « Approbation requise » s’arrêtent ici avant de modifier des données.',
    pending: 'En attente',
    emptyPending: 'Aucune action d’agent en attente',
    emptyAll: 'Aucune action d’agent pour le moment',
  },
} satisfies Translation['approvals'];
