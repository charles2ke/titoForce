import type { Translation } from '../../index.ts';

export default {
  spinner: '読み込み中',
  requiredSuffix: '（必須）',
  tryAgain: '再試行',
  unsaved: {
    title: '未保存の変更を破棄しますか？',
    message: 'このページでの変更は保存されていません。',
    discard: '変更を破棄',
  },

  pagination: {
    range: '{total} 件中 {from}～{to} 件',
  },

  fieldValue: {
    restricted: 'アクセスが制限されたレコード',
  },

  lookup: {
    selected: '選択済みのレコード',
    clear: '選択をクリア',
    searchAny: 'すべてのレコードを検索…',
    searchObject: '{objects}を検索…',
    searchRecords: 'レコードを検索…',
    searching: '検索中…',
    typeToSearch: '入力して検索',
    noMatches: '一致する結果はありません',
  },

  recordForm: {
    newTitle: '新規{object}',
    editTitle: '{name}の編集',
    defaultSection: '{object}情報',
    fixFields: '強調表示された項目を修正してください。',
    saveAnyway: 'このまま保存',
    saved: '{object}「{name}」を保存しました',
    created: '{object}「{name}」を作成しました',
  },

  iconPicker: {
    choose: 'アイコンを選択',
    label: 'アイコン',
  },

  icons: {
    bookOpen: '開いた本',
    bot: 'ボット',
    briefcase: 'ブリーフケース',
    building: 'ビル',
    building2: 'ビル 2',
    calendarCheck: 'カレンダー（チェック）',
    calendarDays: 'カレンダー（日付）',
    chartColumn: '縦棒グラフ',
    barChart3: '棒グラフ 3',
    clipboardList: 'クリップボード（リスト）',
    contact: '連絡先カード',
    fileText: 'テキストファイル',
    folderKanban: 'フォルダー（カンバン）',
    globe: '地球儀',
    handshake: '握手',
    headphones: 'ヘッドホン',
    heartHandshake: 'ハートと握手',
    home: 'ホーム',
    house: '家',
    idCard: 'ID カード',
    kanban: 'カンバン',
    layoutGrid: 'グリッドレイアウト',
    lifeBuoy: '浮き輪',
    list: 'リスト',
    mail: 'メール',
    megaphone: 'メガホン',
    network: 'ネットワーク',
    package: '荷物',
    rocket: 'ロケット',
    shieldCheck: '盾（チェック）',
    sparkles: 'きらめき',
    squareCheckBig: 'チェックボックス（大）',
    star: '星',
    target: '標的',
    trendingUp: '上昇トレンド',
    trophy: 'トロフィー',
    userCheck: 'ユーザー（チェック）',
    userPlus: 'ユーザー（追加）',
    users: 'ユーザー（複数）',
    wand: '魔法の杖',
    workflow: 'ワークフロー',
    zap: '稲妻',
  },

  colors: {
    gray: 'グレー',
    blue: '青',
    green: '緑',
    yellow: '黄',
    orange: 'オレンジ',
    red: '赤',
    purple: '紫',
    pink: 'ピンク',
    teal: '青緑',
    indigo: '藍',
  },

  chart: {
    noData: 'データがありません',
  },

  dashboard: {
    report: 'レポート',
    reportDeleted: 'レポートは削除されました',
    loadFailed: 'このレポートを読み込めませんでした。',
    emptyTitle: 'このダッシュボードにはまだウィジェットがありません',
    emptyBody: 'ダッシュボードにレポートを追加すると、ここにグラフが表示されます。',
  },

  notFound: {
    title: 'ページが見つかりません',
    body: 'お探しのページは存在しないか、アクセス権がありません。',
    home: 'ホームへ移動',
  },

  routeError: {
    newVersion: '新しいバージョンが利用可能です',
    reloadToContinue: '続行するにはページを再読み込みしてください。',
    unknown: '不明なエラー',
  },

  homeRedirect: {
    noApps: 'アプリがまだありません',
    noAppsHelp: '設定でアプリを作成するよう管理者に依頼してください。',
  },
} satisfies Translation['components'];
