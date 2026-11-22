import type { Translation } from '../../index.ts';

export default {
  title: 'Sandbox',
  subtitle: 'この組織のコピーで、誰にも影響を与えずに変更を作成・テストできます。動作を確認できた変更は本番組織にリリースします。',
  newSandbox: '新規 Sandbox',
  usage: '使用中の Sandbox：{count}/{max} 個',
  limitReached: 'この組織の Sandbox 数は上限に達しています。新しく作成するには、いずれかを削除してください。',
  unavailable: 'Sandbox は本番組織から管理します。',
  empty: {
    title: 'Sandbox はまだありません',
    message: 'Sandbox を作成すると、新しい項目、ページレイアウト、自動化、エージェントをユーザーに公開する前に試すことができます。',
  },
  signInHint: 'Sandbox は新しいタブで開きます。Sandbox がコピーされた時点の本番組織のメールアドレスとパスワードでログインしてください。',

  columns: {
    sandbox: 'Sandbox',
    type: 'コピーの種類',
    status: '状況',
    createdBy: '作成者',
    copied: 'コピー日時',
  },

  types: {
    developer: {
      label: '開発用',
      help: '設定とユーザー。短時間で作成でき、レコードは含まれません。',
    },
    full: {
      label: 'フルコピー',
      help: '設定、ユーザー、すべてのレコード。大規模な組織では時間がかかります。',
    },
  },

  status: {
    active: '準備完了',
    provisioning: 'コピー中…',
    refreshing: '更新中…',
    suspended: '停止中',
    failed: 'コピー失敗',
  },

  actions: {
    open: '開く',
    deploy: '比較してリリース',
    refresh: '更新',
    delete: '削除',
    more: '{name}のその他のアクション',
  },

  create: {
    title: '新規 Sandbox',
    name: '名前',
    nameHelp: '英字、数字、ハイフンを使用できます（例：「dev」、「uat」）。組織 ID は {slug} になります。',
    invalidName: '20 文字以内の英字、数字、ハイフンを使用してください。ハイフンは連続できず、先頭と末尾には英字または数字を使用します。',
    type: 'コピーする内容',
    submit: 'Sandbox を作成',
    started: '本番組織を Sandbox「{name}」にコピーしています…',
  },

  ready: 'Sandbox「{name}」の準備ができました',
  failed: 'Sandbox「{name}」のコピーに失敗しました',

  refresh: {
    title: 'Sandbox「{name}」を更新しますか？',
    message:
      'Sandbox の内容はすべて、本番組織の新しいコピーに置き換えられます。リリースされていない変更は失われ、Sandbox にログインしているユーザーは全員ログアウトされます。',
    confirm: 'Sandbox を更新',
    started: 'Sandbox「{name}」を更新しています…',
  },

  delete: {
    title: 'Sandbox「{name}」を削除しますか？',
    message: 'Sandbox とその内容がすべて削除されます。リリースされていない変更は失われます。この操作は元に戻せません。',
    confirm: 'Sandbox を削除',
    done: 'Sandbox「{name}」を削除しました',
  },

  deploy: {
    back: 'Sandbox',
    title: 'Sandbox「{name}」からリリース',
    subtitle: '本番組織にコピーする変更を選択してください。リリースでは設定の追加と更新のみが行われ、本番組織の内容が削除されることはありません。',
    notReady: 'Sandbox の準備がまだできていません。コピーが完了してから、もう一度お試しください。',
    showUnchanged: '変更のないコンポーネントを表示',
    selectAll: 'すべての変更を選択',
    select: '{name}を選択',
    noChanges: {
      title: 'リリースする変更はありません',
      message: 'Sandbox の設定は本番組織と同じです。',
    },
    columns: {
      component: 'コンポーネント',
      type: '種別',
      object: 'オブジェクト',
      change: '変更内容',
    },
    types: {
      object: 'オブジェクト',
      layout: 'ページレイアウト',
      translation: '翻訳',
      app: 'アプリ',
      automation: '自動化',
      approval_process: '承認プロセス',
      agent: 'エージェント',
      report: 'レポート',
      dashboard: 'ダッシュボード',
      role: 'ロール',
    },
    statuses: {
      new: '新規',
      changed: '変更あり',
      unchanged: '変更なし',
      production_only: '本番のみ',
    },
    fields: {
      added: { other: '新規項目 {count} 個' },
      changed: { other: '変更された項目 {count} 個' },
      productionOnly: { other: '本番のみの項目 {count} 個' },
    },
    labels: {
      added: { other: '新規表示ラベル {count} 個' },
      changed: { other: '変更された表示ラベル {count} 個' },
      productionOnly: { other: '本番のみの表示ラベル {count} 個' },
    },
    selected: { other: '{count} 個のコンポーネントを選択中' },
    submit: '本番組織にリリース',
    confirm: {
      title: '本番組織にリリースしますか？',
      message: {
        other:
          '{count} 個のコンポーネントが本番組織にコピーされ、すべてのユーザーに即座に反映されます。リリースは元に戻せませんが、再度リリースすることはできます。',
      },
      confirm: 'リリース',
    },
    done: { other: '{count} 個のコンポーネントを本番組織にリリースしました' },
  },

  history: {
    title: 'リリース履歴',
    empty: 'この組織にはまだ何もリリースされていません。',
    columns: {
      date: '日時',
      from: 'リリース元',
      by: 'リリース実行者',
      components: 'コンポーネント',
      status: '結果',
    },
    componentCount: { other: '{count} 個のコンポーネント' },
    succeeded: 'リリース済み',
    failed: '失敗',
  },
} satisfies Translation['setupSandboxes'];
