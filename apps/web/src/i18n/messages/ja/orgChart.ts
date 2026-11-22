import type { Translation } from '../../index.ts';

export default {
  title: '組織図',
  objectCount: { one: '{label} {count} 人', other: '{pluralLabel} {count} 人' },
  employeeCount: { other: '従業員 {count} 人' },
  departmentCount: { other: '{count} 部署' },
  managerCount: { other: 'マネージャー {count} 人' },

  searchPlaceholder: '人物を検索…',
  searchLabel: '人物を検索',
  department: '部署',
  allDepartments: 'すべての部署',
  expandAll: 'すべて展開',
  collapseAll: 'すべて折りたたむ',

  reportingLines: 'レポートライン',
  expandTeam: '{name}のチームを展開（{count}）',
  collapseTeam: '{name}のチームを折りたたむ（{count}）',
  directReports: { other: '直属の部下 {count} 人' },

  empty: {
    title: '従業員はまだいません',
    body: 'マネージャーが設定された従業員を追加すると、組織図が作成されます。',
    bodyFor: 'マネージャーが設定された{objects}を追加すると、組織図が作成されます。',
  },

  matchingPeople: '一致する人物',
  truncated: '一致する {total} 件のうち、最初の {limit} 件を表示しています。',
  noMatches: '一致する人物はいません。',
} satisfies Translation['orgChart'];
