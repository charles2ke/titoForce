import type { Translation } from '../../index.ts';

export default {
  title: 'Processus d’approbation',
  subtitle: 'Acheminez les enregistrements vers un approbateur et exécutez des actions lorsqu’ils sont soumis, approuvés ou refusés.',
  new: 'Nouveau processus d’approbation',
  edit: 'Modifier {name}',
  list: {
    searchLabel: 'Rechercher des processus d’approbation',
    searchPlaceholder: 'Rechercher des processus…',
    filterByObject: 'Filtrer par objet',
    allObjects: 'Tous les objets',
    noMatch: 'Aucun processus d’approbation ne correspond',
    empty: 'Aucun processus d’approbation pour le moment',
    emptyText:
      'Les processus d’approbation permettent de soumettre des enregistrements, comme des remises ou des congés, à une validation.',
    createFirst: 'Créer votre premier processus d’approbation',
    entryConditions: 'Conditions d’entrée',
    approver: 'Approbateur',
    actions: 'Actions',
    actionsTitle: 'Actions à la soumission / à l’approbation / au refus',
    rowActions: 'Actions sur la ligne',
    conditionCount: { one: '{count} condition', other: '{count} conditions' },
    noConditions: 'Aucune condition',
    fallback: 'Secours : {name}',
    activeLabel: 'Processus {name} actif',
    delete: 'Supprimer {name}',
    deleteTitle: 'Supprimer le processus {name} ?',
    deleteMessage:
      'Les enregistrements ne pourront plus être soumis à ce processus. Les processus qui ont des demandes en attente ne peuvent pas être supprimés.',
    deleteConfirm: 'Supprimer le processus',
  },
  toasts: {
    created: 'Processus {name} créé',
    saved: 'Processus {name} enregistré',
    activated: 'Processus {name} activé',
    deactivated: 'Processus {name} désactivé',
    deleted: 'Processus {name} supprimé',
  },
  form: {
    create: 'Créer le processus',
    save: 'Enregistrer le processus',
    namePlaceholder: 'Approbation de remise',
    chooseObject: 'Choisir un objet…',
    objectFixed: 'L’objet d’un processus existant ne peut pas être modifié.',
    entryConditions: '1. Conditions d’entrée (facultatif)',
    entryConditionsHelp:
      'Seuls les enregistrements qui remplissent ces conditions peuvent être soumis. Si plusieurs processus actifs existent pour les {objects}, le premier processus correspondant est utilisé.',
    approver: '2. Approbateur',
    approverModes: {
      user: { title: 'Un utilisateur précis', text: 'Toutes les demandes sont envoyées à la même personne.' },
      field: {
        title: 'Selon l’enregistrement',
        text: 'Une personne liée à l’enregistrement, par ex. son propriétaire ou le responsable de l’employé.',
      },
    },
    approverUser: 'Utilisateur approbateur',
    chooseUser: 'Choisir un utilisateur…',
    approverField: 'Champ de l’approbateur',
    approverFieldHelp: 'L’utilisateur indiqué ici au moment de la soumission approuve la demande.',
    customPath: 'Chemin personnalisé…',
    fallbackApprover: 'Approbateur de secours',
    fallbackApproverHelp: 'Utilisé lorsque le champ est vide ou que l’utilisateur est inactif.',
    noFallback: 'Aucun — la soumission échoue',
    fieldPath: 'Chemin du champ',
    fieldPathHelp:
      'Noms d’API séparés par des points : les références à suivre, avec en dernier un champ utilisateur ou {ownerId} (5 éléments max.), par ex. {example}.',
    fieldPathError: 'Utilisez des noms d’API en minuscules séparés par des points.',
    actions: '3. Actions',
    actionsNote:
      'L’approbateur est toujours notifié. Les actions s’exécutent au nom du processus d’approbation : elles ne sont donc limitées par les autorisations de personne.',
    actionsEmpty: 'Aucune action.',
    changeObjectTitle: 'Changer d’objet ?',
    changeObjectMessage:
      'Les conditions d’entrée, le champ de l’approbateur et les actions font référence à l’objet actuel et seront effacés.',
    changeObjectConfirm: 'Changer d’objet',
    problems: {
      enterName: 'Saisissez un nom.',
      chooseObject: 'Choisissez un objet.',
      chooseApprover: 'Choisissez l’approbateur.',
      enterPath: 'Saisissez un chemin valide vers le champ de l’approbateur.',
      noSuchField: 'L’objet {object} n’a pas de champ « {field} ».',
    },
  },
  approverPaths: {
    recordOwner: 'Propriétaire de l’enregistrement',
    thisObject: 'Cet enregistrement ({object})',
  },
  stages: {
    onSubmit: {
      title: 'À la soumission',
      help: 'S’exécute juste après la soumission de l’enregistrement, par ex. pour définir le statut sur « En cours d’examen ».',
      item: 'Action à la soumission',
      add: 'Ajouter une action à la soumission',
    },
    onApprove: {
      title: 'À l’approbation',
      help: 'S’exécute après l’approbation par l’approbateur. Utilisez « {action} » pour enchaîner une autre étape d’approbation.',
      item: 'Action à l’approbation',
      add: 'Ajouter une action à l’approbation',
    },
    onReject: {
      title: 'Au refus',
      help: 'S’exécute après le refus de la demande par l’approbateur.',
      item: 'Action au refus',
      add: 'Ajouter une action au refus',
    },
  },
} satisfies Translation['setupApprovals'];
