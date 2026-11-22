import type { Translation } from '../../index.ts';

export default {
  justNow: 'agora mesmo',
  minutesAgo: { one: 'há {count} min', other: 'há {count} min' },
  hoursAgo: { one: 'há {count} h', other: 'há {count} h' },
  daysAgo: { one: 'há {count} dia', other: 'há {count} dias' },
} satisfies Translation['format'];
