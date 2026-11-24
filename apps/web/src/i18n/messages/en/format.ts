import { plural } from '../../plural.ts';

/** Shared value formatting: short relative times in lists, feeds and notifications (older dates show as a date). */
export default {
  /** A moment less than a minute ago. */
  justNow: 'just now',
  /** Short relative time; "m" abbreviates minutes, e.g. "5m ago". */
  minutesAgo: plural({ one: '{count}m ago', other: '{count}m ago' }),
  /** Short relative time; "h" abbreviates hours, e.g. "3h ago". */
  hoursAgo: plural({ one: '{count}h ago', other: '{count}h ago' }),
  /** Short relative time; "d" abbreviates days, e.g. "2d ago". */
  daysAgo: plural({ one: '{count}d ago', other: '{count}d ago' }),
};
