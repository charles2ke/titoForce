import type { Translation } from '../../index.ts';

export default {
  greeting: {
    morning: 'おはようございます、{name}さん',
    afternoon: 'こんにちは、{name}さん',
    evening: 'こんばんは、{name}さん',
  },
  askAi: 'AI に質問',
  quickLinks: 'クイックリンク',
  myWork: '自分の作業',
  appNotFound: {
    title: 'アプリが見つかりません',
    message: 'このアプリは存在しないか、削除されました。',
    goHome: 'ホームページへ移動',
  },

  dashboard: {
    title: 'ダッシュボード',
    open: 'ダッシュボードを開く',
    noneAssigned: 'このアプリにはダッシュボードが割り当てられていません。',
    browse: 'ダッシュボードを参照',
  },

  tasks: {
    title: '自分の未完了の ToDo',
    allActivities: 'すべての活動',
    empty: '未完了の ToDo はありません。すべて完了しています。',
    markComplete: '完了にする',
    markNamedComplete: '「{name}」を完了にする',
    completed: 'ToDo を完了しました',
    overdue: '期限超過 · {date}',
    dueToday: '今日 · {date}',
    noDate: '日付なし',
    more: { other: '他 {count} 件の未完了の ToDo' },
  },

  approvals: {
    title: '自分の承認待ち',
    inbox: '受信トレイ',
    empty: 'あなたの承認を待っている申請はありません。',
    details: '{process} · 申請者：{user} · {time}',
    viewAll: '{count} 件すべてを表示',
  },

  runs: {
    title: '最近の AI 実行履歴',
    agents: 'エージェント',
    empty: 'エージェントの実行履歴はまだありません。エージェントに質問して始めましょう。',
    status: {
      running: '実行中',
      completed: '完了',
      failed: '失敗',
    },
    trigger: {
      automation: '自動化',
      recordAction: 'レコードアクション',
      api: 'API',
    },
  },
} satisfies Translation['home'];
