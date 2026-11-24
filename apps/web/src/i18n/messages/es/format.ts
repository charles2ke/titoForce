import type { Translation } from '../../index.ts';

export default {
  justNow: 'ahora mismo',
  minutesAgo: { one: 'hace {count} min', other: 'hace {count} min' },
  hoursAgo: { one: 'hace {count} h', other: 'hace {count} h' },
  daysAgo: { one: 'hace {count} d', other: 'hace {count} d' },
} satisfies Translation['format'];
