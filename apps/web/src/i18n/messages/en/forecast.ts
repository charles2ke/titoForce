import { plural } from '../../plural.ts';

export default {
  title: 'Sales forecast',
  /** {objects}: the opportunity object's plural label (e.g. "Opportunities"), at the start of the sentence. */
  subtitle: plural({
    one: '{objects} closing in the next {count} month (from the start of this month).',
    other: '{objects} closing in the next {count} months (from the start of this month).',
  }),
  /** Plural noun: sales opportunities (KPI title, and fallback for the opportunity object's plural label). */
  opportunities: 'Opportunities',

  groupBy: 'Group by',
  byMonth: 'By month',
  byOwner: 'By owner',
  byCloseMonth: 'By close month',
  /** Label of the select that picks how many months the forecast covers. */
  window: 'Window',
  monthCount: plural({ one: '{count} month', other: '{count} months' }),

  truncated: 'Partial forecast: showing {shown} of {total} matching opportunities. All figures below exclude the remaining opportunities.',

  /** Forecast measures: KPI titles, chart legend and column headers. */
  measures: {
    /** Amount of opportunities closed as won. */
    closedWon: 'Closed won',
    /** Forecast category (noun): open deals the team commits to closing. */
    commit: 'Commit',
    /** Forecast category (noun): open deals that may close in the best case. */
    bestCase: 'Best case',
    openPipeline: 'Open pipeline',
    /** Pipeline amount weighted by probability. */
    weighted: 'Weighted',
  },
  hints: {
    commit: 'Open, likely to close',
    bestCase: 'Includes commit',
    /** {amount}: the probability-weighted pipeline amount, e.g. "$1.2M". */
    weighted: 'Weighted {amount}',
    /** Below the number of opportunities. */
    opportunities: 'Open and closed',
  },

  chartByMonth: 'Forecast chart by close month',
  chartByOwner: 'Forecast chart by owner',
  empty: 'No opportunities close in this window.',

  breakdown: 'Breakdown',
  columns: {
    closeMonth: 'Close month',
    /** Column header: number of opportunities (abbreviated). */
    count: '# Opps',
  },

  /** “Commit” and “Best Case” are values of the opportunity's Forecast Category picklist. */
  footnote:
    'Open pipeline counts every open opportunity. Commit = forecast category “Commit” or probability ≥ 75%. Best case = commit plus forecast category “Best Case” or probability ≥ 50%. Weighted = amount × probability. Only opportunities you can see are included.',
};
