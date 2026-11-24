import type { Translation } from '../../index.ts';

export default {
  title: 'Umsatzprognose',
  subtitle: {
    one: '{objects} mit Abschluss im nächsten {count} Monat (ab Beginn dieses Monats).',
    other: '{objects} mit Abschluss in den nächsten {count} Monaten (ab Beginn dieses Monats).',
  },
  opportunities: 'Opportunities',

  groupBy: 'Gruppieren nach',
  byMonth: 'Nach Monat',
  byOwner: 'Nach Inhaber',
  byCloseMonth: 'Nach Abschlussmonat',
  window: 'Zeitraum',
  monthCount: { one: '{count} Monat', other: '{count} Monate' },

  truncated: 'Unvollständige Prognose: {shown} von {total} passenden Opportunities werden angezeigt. Alle Zahlen unten schließen die übrigen Opportunities aus.',

  measures: {
    closedWon: 'Gewonnen',
    commit: 'Commit',
    bestCase: 'Bester Fall',
    openPipeline: 'Offene Pipeline',
    weighted: 'Gewichtet',
  },
  hints: {
    commit: 'Offen, Abschluss wahrscheinlich',
    bestCase: 'Inklusive Commit',
    weighted: 'Gewichtet {amount}',
    opportunities: 'Offen und abgeschlossen',
  },

  chartByMonth: 'Prognosediagramm nach Abschlussmonat',
  chartByOwner: 'Prognosediagramm nach Inhaber',
  empty: 'In diesem Zeitraum werden keine Opportunities abgeschlossen.',

  breakdown: 'Aufschlüsselung',
  columns: {
    closeMonth: 'Abschlussmonat',
    count: 'Anz. Opps',
  },

  footnote:
    'Die offene Pipeline umfasst jede offene Opportunity. Commit = Prognosekategorie „Commit“ oder Wahrscheinlichkeit ≥ 75 %. Bester Fall = Commit plus Prognosekategorie „Bester Fall“ oder Wahrscheinlichkeit ≥ 50 %. Gewichtet = Betrag × Wahrscheinlichkeit. Berücksichtigt werden nur Opportunities, die Sie sehen können.',
} satisfies Translation['forecast'];
