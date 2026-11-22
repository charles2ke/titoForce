import type { Translation } from '../../index.ts';

export default {
  homeLink: 'titoForce ホーム',
  askAi: 'AI に質問',

  search: {
    label: 'すべてのレコードを検索',
    placeholder: '取引先、取引先責任者、商談、ケースなどを検索…',
    shortcut: 'Ctrl K',
    searching: '検索中…',
    failed: '検索に失敗しました',
    noMatches: '「{term}」に一致する結果はありません',
  },

  notifications: {
    title: '通知',
    labelUnread: { other: '通知（未読 {count} 件）' },
    markAllRead: 'すべて既読にする',
    empty: '未読の通知はありません。',
  },

  inbox: {
    label: '承認受信トレイ',
    labelPending: { other: '承認受信トレイ（承認待ち {count} 件）' },
  },

  changePassword: {
    title: 'パスワードの変更',
    submit: 'パスワードを変更',
    current: '現在のパスワード',
    new: '新しいパスワード',
    help: '8 文字以上で入力してください。',
    success: 'パスワードを変更しました',
  },

  userMenu: {
    label: 'ユーザーメニュー',
    settings: '個人設定',
    changePassword: 'パスワードの変更',
    signOut: 'ログアウト',
  },

  apps: {
    switch: 'アプリを切り替え',
    caption: 'アプリ',
    choose: 'アプリを選択',
    list: 'アプリ',
  },

  nav: {
    main: 'メイン',
    workspace: 'ワークスペース',
    agents: 'AI エージェント',
    approvals: '承認',
    reports: 'レポート',
    dashboards: 'ダッシュボード',
    setup: '設定',
  },

  ai: {
    status: 'AI：{provider}',
    offline: 'AI：オフラインのルールエンジン',
  },

  aiPanel: {
    label: 'AI アシスタント',
    agent: 'エージェント',
    newChat: '新しいチャット',
    close: 'アシスタントを閉じる',
    context: 'コンテキスト：{record}',
    loadingAgents: 'エージェントを読み込み中…',
    noAgents: '有効なエージェントはありません。',
  },

  mobile: {
    openNav: 'ナビゲーションを開く',
    closeNav: 'ナビゲーションを閉じる',
    nav: 'ナビゲーション',
  },
} satisfies Translation['shell'];
