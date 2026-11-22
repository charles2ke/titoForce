import type { Translation } from '../../index.ts';

export default {
  signIn: {
    organization: '組織',
    organizationHelp: '管理者から伝えられた ID です（例：「acme」）。',
    to: 'ログイン先：{name}',
    notFound: '組織「{slug}」は存在しません。',
    noAccount: 'titoForce を初めてご利用ですか？',
    createOrganization: '組織を作成',
  },

  signUp: {
    title: '組織の作成',
    subtitle: '組織には専用のデータベースが用意され、あなたがその管理者になります。',
    organizationName: '組織名',
    organizationId: '組織 ID',
    organizationIdHelp: 'ログインに使用します。英小文字、数字、ハイフンを使用できます。',
    yourName: '氏名',
    passwordHelp: '8 文字以上で入力してください。',
    demo: 'サンプルレコードを追加して機能を試せるようにする',
    submit: '組織を作成',
    haveAccount: 'すでに組織をお持ちですか？',
    signIn: 'ログイン',
    disabled: 'このサーバーではサインアップが有効になっていません。アカウントについては、サーバーの管理者にお問い合わせください。',
  },

  switcher: {
    title: '組織を切り替え',
    help: '組織ごとにユーザーとデータが分かれているため、ログインは組織ごとに個別に行います。',
    organizationId: '組織 ID',
    recent: '最近使用した組織',
    current: 'ログイン中',
    open: '開く',
  },

  sandbox: {
    badge: 'Sandbox',
    banner: '{parent}の Sandbox「{name}」です。ここでの変更は本番組織には影響しません。',
    openProduction: '本番組織を開く',
  },

  problem: {
    title: 'この組織は利用できません',
    tryAgain: '再試行',
    otherOrganization: '別の組織にログイン',
  },

  native: {
    title: 'サーバーに接続',
    subtitle: '組織の titoForce サーバーのアドレスを入力してください。',
    server: 'サーバーのアドレス',
    serverPlaceholder: 'crm.example.com',
    connect: '接続',
    invalid: 'crm.example.com のような Web アドレスを入力してください。',
    unreachable:
      '{url} の titoForce サーバーに接続できませんでした。アドレスが正しいこと、およびサーバーがこのアプリからの接続を許可していることを確認してください。',
    connectedTo: 'サーバー：{url}',
    change: '変更',
  },
} satisfies Translation['orgs'];
