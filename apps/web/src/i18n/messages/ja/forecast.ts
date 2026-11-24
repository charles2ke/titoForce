import type { Translation } from '../../index.ts';

export default {
  title: '売上予測',
  subtitle: { other: '今月の初めから {count} か月以内に完了予定の{objects}です。' },
  opportunities: '商談',

  groupBy: 'グループ化',
  byMonth: '月別',
  byOwner: '所有者別',
  byCloseMonth: '完了予定月別',
  window: '期間',
  monthCount: { other: '{count} か月' },

  truncated: '部分的な売上予測：条件に一致する {total} 件の商談のうち {shown} 件を表示しています。以下の数値には、残りの商談は含まれていません。',

  measures: {
    closedWon: '成立',
    commit: '達成予測',
    bestCase: '最善達成予測',
    openPipeline: '進行中のパイプライン',
    weighted: '加重金額',
  },
  hints: {
    commit: '進行中で成立の見込みが高い',
    bestCase: '達成予測を含む',
    weighted: '加重金額 {amount}',
    opportunities: '進行中と完了済み',
  },

  chartByMonth: '完了予定月別の売上予測グラフ',
  chartByOwner: '所有者別の売上予測グラフ',
  empty: 'この期間に完了予定の商談はありません。',

  breakdown: '内訳',
  columns: {
    closeMonth: '完了予定月',
    count: '商談数',
  },

  footnote:
    '進行中のパイプラインには、進行中のすべての商談が含まれます。達成予測 = 売上予測分類が「達成予測」または確度が 75% 以上。最善達成予測 = 達成予測に加えて、売上予測分類が「最善達成予測」または確度が 50% 以上。加重金額 = 金額 × 確度。表示権限のある商談のみが含まれます。',
} satisfies Translation['forecast'];
