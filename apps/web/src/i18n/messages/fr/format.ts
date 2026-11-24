import type { Translation } from '../../index.ts';

export default {
  justNow: 'à l’instant',
  minutesAgo: { one: 'il y a {count} min', other: 'il y a {count} min' },
  hoursAgo: { one: 'il y a {count} h', other: 'il y a {count} h' },
  daysAgo: { one: 'il y a {count} j', other: 'il y a {count} j' },
} satisfies Translation['format'];
