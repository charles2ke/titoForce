import type { Translation } from '../../index.ts';

export default {
  justNow: 'たった今',
  minutesAgo: { other: '{count} 分前' },
  hoursAgo: { other: '{count} 時間前' },
  daysAgo: { other: '{count} 日前' },
} satisfies Translation['format'];
