import type { Translation } from '../../index.ts';

export default {
  justNow: 'gerade eben',
  minutesAgo: { one: 'vor {count} Min.', other: 'vor {count} Min.' },
  hoursAgo: { one: 'vor {count} Std.', other: 'vor {count} Std.' },
  daysAgo: { one: 'vor {count} Tag', other: 'vor {count} Tagen' },
} satisfies Translation['format'];
