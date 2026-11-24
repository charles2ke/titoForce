import type { Translation } from '../../index.ts';

export default {
  tagline: '会社全体のためのエージェント型 CRM。',
  intro: '顧客、業務、人材を 1 つにまとめるメタデータ駆動型プラットフォーム。AI エージェントを標準搭載しています。',
  highlights: {
    sales: 'セールス：リード、取引先、パイプライン、見積、売上予測',
    service: 'サービス：ケース、ナレッジ、SLA',
    work: '業務：プロジェクト、ボード、カレンダー、タイムライン',
    people: '人事：従業員、休暇、評価、採用',
    ai: 'あなたと同じ権限で動作する AI エージェント',
  },
  license: 'オープンソース · AGPL-3.0',

  title: 'ログイン',
  subtitle: 'おかえりなさい。仕事用のメールアドレスとパスワードを入力してください。',
  submit: 'ログイン',

  demo: {
    signInAs: 'デモ会社：次のユーザーとしてログイン',
    password: 'デモ用パスワード：{password}',
  },
} satisfies Translation['login'];
