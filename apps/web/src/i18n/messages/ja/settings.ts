import type { Translation } from '../../index.ts';

export default {
  title: '個人設定',

  profile: {
    title: 'プロフィール',
    jobTitle: '役職',
    adminHint: '名前、役職、ロールは{link}で編集できます。',
    usersLink: '設定 › ユーザー',
    askAdmin: '名前、役職、ロールの変更は管理者に依頼してください。',
  },

  password: {
    title: 'パスワードの変更',
    current: '現在のパスワード',
    new: '新しいパスワード',
    help: '8 文字以上で入力してください。',
    confirm: '新しいパスワードの確認',
    mismatch: 'パスワードが一致しません',
    submit: 'パスワードを更新',
    changed: 'パスワードを変更しました。他のセッションはログアウトされました。',
  },

  language: {
    title: '言語',
    help: 'ログインするすべてのデバイスで使用される titoForce の言語です。管理者が翻訳していない表示ラベルは英語のまま表示されます。',
    browserDefault: 'ブラウザーの言語（{language}）',
  },

  defaultApp: {
    title: 'デフォルトのアプリ',
    help: 'ログイン後に表示されるアプリです。アプリランチャーでアプリを切り替えた場合も更新されます（このブラウザーに保存されます）。',
    changed: '{app}がデフォルトのアプリになりました',
  },

  ai: {
    title: 'AI プロバイダー',
    connected: '接続済み',
    offline: 'オフラインモード',
    openai: 'OpenAI 互換',
    rulesEngine: '組み込みのルールエンジン',
    configuredBy: 'プロバイダーは、管理者がサーバーの環境変数で設定します。',
  },

  access: {
    title: 'あなたのアクセス権',
    capabilities: {
      setup: '設定の管理',
      manageAutomations: '自動化、レポート、ダッシュボードの管理',
      manageAgents: 'AI エージェントの管理',
      viewSensitive: '機密項目の表示',
    },
    read: '参照',
    create: '作成',
    edit: '編集',
    delete: '削除',
    all: 'すべて',
    own: '自分のみ',
    footnote: '「{own}」は自分が所有するレコードを意味します。参照できないオブジェクトは表示されません。',
  },
} satisfies Translation['settings'];
