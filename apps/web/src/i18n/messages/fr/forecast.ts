import type { Translation } from '../../index.ts';

export default {
  title: 'Prévisions des ventes',
  subtitle: {
    one: '{objects} dont la clôture est prévue sur {count} mois (à partir du début de ce mois).',
    other: '{objects} dont la clôture est prévue sur {count} mois (à partir du début de ce mois).',
  },
  opportunities: 'Opportunités',

  groupBy: 'Regrouper par',
  byMonth: 'Par mois',
  byOwner: 'Par propriétaire',
  byCloseMonth: 'Par mois de clôture',
  window: 'Période',
  monthCount: { one: '{count} mois', other: '{count} mois' },

  truncated:
    'Prévision partielle : affichage de {shown} opportunités correspondantes sur {total}. Les chiffres ci-dessous excluent les opportunités restantes.',

  measures: {
    closedWon: 'Fermées/Gagnées',
    commit: 'Engagement',
    bestCase: 'Meilleur cas',
    openPipeline: 'Pipeline ouvert',
    weighted: 'Pondéré',
  },
  hints: {
    commit: 'Ouvertes, clôture probable',
    bestCase: 'Inclut l’engagement',
    weighted: 'Pondéré : {amount}',
    opportunities: 'Ouvertes et fermées',
  },

  chartByMonth: 'Graphique des prévisions par mois de clôture',
  chartByOwner: 'Graphique des prévisions par propriétaire',
  empty: 'Aucune opportunité ne se clôture sur cette période.',

  breakdown: 'Détail',
  columns: {
    closeMonth: 'Mois de clôture',
    count: 'Nb d’opp.',
  },

  footnote:
    'Le pipeline ouvert comprend toutes les opportunités ouvertes. Engagement = catégorie de prévision « Engagement » ou probabilité ≥ 75 %. Meilleur cas = engagement plus catégorie de prévision « Meilleur cas » ou probabilité ≥ 50 %. Pondéré = montant × probabilité. Seules les opportunités que vous pouvez voir sont incluses.',
} satisfies Translation['forecast'];
