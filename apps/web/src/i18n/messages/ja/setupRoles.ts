import type { Translation } from '../../index.ts';

export default {
  title: 'ロールと権限',
  subtitle: '各ロールが参照・操作できる範囲を、オブジェクトごとに制御します。',
  newRole: '新規ロール',
  empty: 'ロールはまだありません',
  listLabel: 'ロール',
  admin: '管理者',
  userCount: { other: 'ユーザー {count} 人' },
  roleName: 'ロール名',

  levels: {
    none: 'なし',
    own: '自分のレコード',
    all: 'すべてのレコード',
  },

  capabilities: {
    title: 'システム権限',
    adminAlwaysOn: '誰もロックアウトされないよう、管理者ロールでは常に有効です。',
    setup: {
      label: '管理者（設定へのアクセス）',
      help: 'オブジェクト、項目、ユーザー、ロール、アプリを管理します。自動化と AI エージェントの管理権限も付与されます。',
    },
    viewSensitive: {
      label: '機密項目の表示',
      help: '給与など、機密としてマークされた項目を参照・編集できます。',
    },
    manageAutomations: {
      label: '自動化の管理',
      help: '自動化、承認プロセス、レポート、ダッシュボードを作成・編集し、自動化の実行履歴を参照できます。',
    },
    manageAgents: {
      label: 'AI エージェントの管理',
      help: 'AI エージェントを作成・編集し、すべてのエージェントの実行を参照できます。',
    },
  },

  editor: {
    deleteRole: 'ロールを削除',
    deleteTitle: '{name}を削除しますか？',
    deleteMessage: 'ロールとその権限は完全に削除されます。',
    adminNotDeletable: '管理者ロールは削除できません。',
    reassignUsers: {
      other: '先に、このロールを持つ {count} 人のユーザーを別のロールに割り当ててください。',
    },
    saved: '{name}を保存しました',
    deleted: '{name}を削除しました',
    removeOwnSetupTitle: '自分の設定へのアクセス権を削除しますか？',
    removeOwnSetupMessage: 'あなたはこのロールを持っているため、保存すると設定を開けなくなります。',
    saveAnyway: 'このまま保存',
    unsavedChanges: '未保存の変更',
    discard: '破棄',
    save: 'ロールを保存',
  },

  objectPermissions: {
    title: 'オブジェクト権限',
    help: '「{own}」はユーザーが所有するレコードを意味します。個別の設定がないオブジェクトには、デフォルトの行が適用されます。',
    helpSetup:
      '「{own}」はユーザーが所有するレコードを意味します。個別の設定がないオブジェクトには、デフォルトの行が適用されます。設定へのアクセス権があっても、これらの設定は回避されません。',
    defaultRow: 'その他のオブジェクトのデフォルト',
    columns: {
      read: '参照',
      create: '作成',
      edit: '編集',
      delete: '削除',
    },
    controls: {
      read: '{object}：参照',
      create: '{object}：作成',
      edit: '{object}：編集',
      delete: '{object}：削除',
    },
    inherited: 'デフォルト',
    unknownObject: '不明なオブジェクト',
    unknownObjectHelp:
      'このオブジェクトは存在しないか、参照する権限がありません。オブジェクトが削除された場合は、この行を削除してください。削除しないと保存に失敗します。',
    removeRow: '{object}の権限を削除',
    useDefault: '{object}にデフォルトを使用',
  },

  createForm: {
    title: '新規ロール',
    create: 'ロールを作成',
    created: '{name}を作成しました',
    namePlaceholder: 'カスタマーサクセス',
    roleId: 'ロール ID',
    roleIdHelp: '変更できない識別子です（例：{example}）。',
    idInvalid: '英小文字で始まる 2～40 文字の英小文字、数字、アンダースコアを使用してください。',
    idExists: 'この ID のロールはすでに存在します。',
    startFrom: '開始時の権限',
    startFromHelp: '既存のロールの権限をコピーするか、アクセス権なしで開始します。',
    noAccess: 'アクセス権なし',
  },
} satisfies Translation['setupRoles'];
