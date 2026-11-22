import type { Translation } from '../../index.ts';

export default {
  title: 'Genehmigungen',
  subtitle: 'Genehmigungsanfragen für Datensätze und Aktionen von KI-Agenten, die eine menschliche Entscheidung erfordern.',
  tabs: {
    inbox: 'Warten auf mich',
    submitted: 'Von mir eingereicht',
    all: 'Alle Anfragen',
    agent: 'Agentenaktionen',
  },
  empty: {
    inbox: 'Nichts wartet auf Ihre Genehmigung',
    submitted: 'Sie haben noch nichts zur Genehmigung eingereicht',
    all: 'Noch keine Genehmigungsanfragen',
  },

  approve: 'Genehmigen',
  reject: 'Ablehnen',
  recall: 'Zurückziehen',

  requestStatus: {
    pending: 'ausstehend',
    approved: 'genehmigt',
    rejected: 'abgelehnt',
    recalled: 'zurückgezogen',
  },
  request: {
    submittedBy: 'eingereicht von {name} {time}',
    submittedByYou: 'von Ihnen eingereicht {time}',
    approver: 'Genehmiger: {name}',
    approverYou: 'Genehmiger: Sie',
    approvedAt: 'Genehmigt {time}',
    rejectedAt: 'Abgelehnt {time}',
    recalledAt: 'Zurückgezogen {time}',
    quote: '„{text}“',
    recalled: 'Anfrage zurückgezogen',
  },

  status: {
    pending: 'ausstehend',
    executing: 'wird ausgeführt',
    executed: 'ausgeführt',
    rejected: 'abgelehnt',
    failed: 'fehlgeschlagen',
  },
  action: {
    wantsToRun: '{agent} möchte {tool} ausführen',
    viewRecord: 'Datensatz anzeigen',
    arguments: 'Argumente',
    result: 'Ergebnis',
    failed: 'Die Aktion ist fehlgeschlagen: {error}',
    failedUnknown: 'Die Aktion ist fehlgeschlagen: unbekannter Fehler',
    rejected: 'Aktion abgelehnt',
    executed: 'Aktion genehmigt und ausgeführt',
  },
  agentActions: {
    intro: 'Agenten mit der Autonomiestufe „Genehmigung erforderlich“ halten hier an, bevor sie Daten ändern.',
    pending: 'Ausstehend',
    emptyPending: 'Keine wartenden Agentenaktionen',
    emptyAll: 'Noch keine Agentenaktionen',
  },
} satisfies Translation['approvals'];
