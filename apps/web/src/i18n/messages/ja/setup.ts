import type { Translation } from '../../index.ts';

export default {
  title: '設定',
  nav: {
    groups: {
      dataModel: 'データモデル',
      usersAccess: 'ユーザーとアクセス',
      experience: 'エクスペリエンス',
      automation: '自動化',
      ai: 'AI',
      environments: '環境',
    },
    objects: 'オブジェクトと項目',
    users: 'ユーザー',
    roles: 'ロールと権限',
    apps: 'アプリ',
    translations: '翻訳',
    automations: '自動化',
    approvalProcesses: '承認プロセス',
    runs: '実行履歴',
    agents: 'エージェント',
    sandboxes: 'Sandbox',
  },
  noAccess: {
    title: 'この領域へのアクセス権がありません',
    message: '設定のこの部分を利用するには追加の権限が必要です。必要な場合は、ロールの更新を管理者に依頼してください。',
  },
} satisfies Translation['setup'];
