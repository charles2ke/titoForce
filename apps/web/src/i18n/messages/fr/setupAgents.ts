import type { Translation } from '../../index.ts';

export default {
  title: 'Agents IA',
  subtitle: 'Configurez les assistants avec lesquels les utilisateurs discutent et que les automatisations peuvent exécuter.',
  runHistory: 'Historique des exécutions',
  new: 'Nouvel agent',
  edit: 'Modifier {name}',
  autonomy: {
    readOnly: {
      label: 'Lecture seule',
      text: 'Consulte et analyse les données sans jamais rien modifier. Les outils d’écriture ne sont pas proposés à l’agent.',
    },
    approvalRequired: {
      label: 'Approbation requise',
      text: 'Les modifications proposées sont mises en attente dans Approbations et ne s’exécutent qu’une fois approuvées par l’utilisateur à l’origine de la demande (ou par le propriétaire de l’enregistrement, pour les exécutions d’automatisations).',
    },
    autonomous: {
      label: 'Autonome',
      text: 'Les modifications s’exécutent immédiatement, dans la limite de ce que l’utilisateur à l’origine de la demande — ou l’utilisateur Agent IA, pour les exécutions d’automatisations — est autorisé à faire.',
    },
  },
  toolKinds: {
    read: {
      title: 'Outils de lecture',
      text: 'Consulter des données',
      selectAll: 'Sélectionner tous les outils de lecture',
      clear: 'Désélectionner les outils de lecture',
    },
    write: {
      title: 'Outils d’écriture',
      text: 'Créer et modifier des données',
      selectAll: 'Sélectionner tous les outils d’écriture',
      clear: 'Désélectionner les outils d’écriture',
    },
  },
  toolNames: {
    aggregateRecords: 'Agréger des enregistrements',
    convertLead: 'Convertir une piste',
    createRecord: 'Créer un enregistrement',
    describeObject: 'Décrire un objet',
    getRecord: 'Obtenir un enregistrement',
    getRelatedRecords: 'Obtenir les enregistrements associés',
    getTimeline: 'Obtenir la chronologie',
    listObjects: 'Lister les objets',
    listUsers: 'Lister les utilisateurs',
    logActivity: 'Consigner une activité',
    queryRecords: 'Interroger des enregistrements',
    scoreLead: 'Noter une piste',
    searchKnowledge: 'Rechercher dans la base de connaissances',
    searchRecords: 'Rechercher des enregistrements',
    sendNotification: 'Envoyer une notification',
    submitForApproval: 'Soumettre pour approbation',
    updateRecord: 'Mettre à jour un enregistrement',
  },
  providers: {
    offline: 'hors ligne',
  },
  status: {
    title: 'Fournisseur d’IA',
    connected: 'Connecté',
    offline: 'Moteur de règles hors ligne',
    provider: 'Fournisseur',
    model: 'Modèle',
    offlineNote:
      'Les agents fonctionnent aussi hors ligne : le moteur de règles planifie lui-même les appels d’outils (les instructions des agents ne sont pas utilisées), avec les mêmes outils, autorisations et règles d’approbation. Vous pouvez donc tout essayer sans clé d’API.',
  },
  list: {
    searchLabel: 'Rechercher des agents',
    searchPlaceholder: 'Rechercher des agents…',
    noMatch: 'Aucun agent ne correspond',
    empty: 'Aucun agent pour le moment',
    emptyText: 'Les agents répondent aux questions et effectuent des actions dans le CRM à l’aide des outils que vous autorisez.',
    createFirst: 'Créer votre premier agent',
    builtIn: 'Intégré',
    toolCount: { one: '{count} outil', other: '{count} outils' },
    activeLabel: 'Agent {name} actif',
    noDescription: 'Aucune description',
    chat: 'Discuter',
    chatWith: 'Discuter avec {name}',
    activateToChat: 'Activer pour discuter',
    runHistoryOf: 'Historique des exécutions de {name}',
    delete: 'Supprimer {name}',
    deleteTitle: 'Supprimer l’agent {name} ?',
    deleteMessage:
      'Les utilisateurs ne pourront plus discuter avec cet agent. Les agents utilisés par une automatisation ne peuvent pas être supprimés.',
    deleteConfirm: 'Supprimer l’agent',
  },
  toasts: {
    created: 'Agent {name} créé',
    saved: 'Agent {name} enregistré',
    activated: 'Agent {name} activé',
    deactivated: 'Agent {name} désactivé',
    deleted: 'Agent {name} supprimé',
  },
  form: {
    create: 'Créer l’agent',
    save: 'Enregistrer l’agent',
    builtInNote: 'Il s’agit d’un agent intégré. Vous pouvez le modifier, mais pas le supprimer — désactivez-le plutôt.',
    namePlaceholder: 'Assistant de renouvellement',
    descriptionHelp: 'Affichée aux utilisateurs qui choisissent un agent avec lequel discuter.',
    instructions: 'Instructions',
    instructionsHelp:
      'Objectif, ton, étapes et limites de l’agent — utilisés comme prompt système lorsqu’un fournisseur de LLM est configuré. {length}/8000 caractères.',
    instructionsPlaceholder:
      'Vous aidez les responsables de comptes à préparer les renouvellements.\n1. Recherchez le compte et ses opportunités ouvertes.\n2. Résumez les risques et suggérez les prochaines étapes.',
    autonomy: 'Autonomie',
    tools: 'Outils',
    toolsHelp: {
      one: '{count} sélectionné. Les agents ne peuvent utiliser que les outils que vous activez ici, et chaque appel d’outil est vérifié par rapport aux autorisations de l’utilisateur pour le compte duquel l’agent agit.',
      other:
        '{count} sélectionnés. Les agents ne peuvent utiliser que les outils que vous activez ici, et chaque appel d’outil est vérifié par rapport aux autorisations de l’utilisateur pour le compte duquel l’agent agit.',
    },
    writeToolsIgnored: 'Cet agent est en lecture seule : les outils d’écriture sélectionnés sont donc ignorés.',
    problems: {
      enterName: 'Saisissez un nom.',
      chooseTool: 'Choisissez au moins un outil.',
    },
  },
} satisfies Translation['setupAgents'];
