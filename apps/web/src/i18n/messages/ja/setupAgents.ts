import type { Translation } from '../../index.ts';

export default {
  title: 'AI エージェント',
  subtitle: 'ユーザーがチャットし、自動化から実行できるアシスタントを設定します。',
  runHistory: '実行履歴',
  new: '新規エージェント',
  edit: '{name}の編集',
  autonomy: {
    readOnly: {
      label: '読み取り専用',
      text: 'データを参照・分析しますが、変更は一切行いません。書き込みツールはエージェントに提供されません。',
    },
    approvalRequired: {
      label: '承認が必要',
      text: '提案された変更は「承認」のキューに追加され、依頼したユーザー（自動化による実行の場合はレコードの所有者）が承認した後にのみ実行されます。',
    },
    autonomous: {
      label: '自律',
      text: '変更は即座に実行されます。実行できる操作は、依頼したユーザー（自動化による実行の場合は AI エージェントユーザー）に許可されている範囲に限られます。',
    },
  },
  toolKinds: {
    read: {
      title: '読み取りツール',
      text: '情報を参照',
      selectAll: 'すべての読み取りツールを選択',
      clear: '読み取りツールの選択を解除',
    },
    write: {
      title: '書き込みツール',
      text: 'データを作成・変更',
      selectAll: 'すべての書き込みツールを選択',
      clear: '書き込みツールの選択を解除',
    },
  },
  toolNames: {
    aggregateRecords: 'レコードを集計',
    convertLead: 'リードの取引を開始',
    createRecord: 'レコードを作成',
    describeObject: 'オブジェクトの詳細を取得',
    getRecord: 'レコードを取得',
    getRelatedRecords: '関連レコードを取得',
    getTimeline: 'タイムラインを取得',
    listObjects: 'オブジェクトを一覧表示',
    listUsers: 'ユーザーを一覧表示',
    logActivity: '活動を記録',
    queryRecords: 'レコードをクエリ',
    scoreLead: 'リードをスコアリング',
    searchKnowledge: 'ナレッジを検索',
    searchRecords: 'レコードを検索',
    sendNotification: '通知を送信',
    submitForApproval: '承認申請',
    updateRecord: 'レコードを更新',
  },
  providers: {
    offline: 'オフライン',
  },
  status: {
    title: 'AI プロバイダー',
    connected: '接続済み',
    offline: 'オフラインのルールエンジン',
    provider: 'プロバイダー',
    model: 'モデル',
    offlineNote:
      'エージェントはオフラインでも動作します。ルールエンジンが同じツール、権限、承認ルールを使ってツール呼び出しを自ら計画するため（エージェントの指示は使用されません）、API キーがなくてもすべての機能を試せます。',
  },
  list: {
    searchLabel: 'エージェントを検索',
    searchPlaceholder: 'エージェントを検索…',
    noMatch: '一致するエージェントはありません',
    empty: 'エージェントはまだありません',
    emptyText: 'エージェントは、許可されたツールを使って CRM 内で質問に答えたり、アクションを実行したりします。',
    createFirst: '最初のエージェントを作成',
    builtIn: '組み込み',
    toolCount: { other: '{count} 個のツール' },
    activeLabel: '{name}を有効化',
    noDescription: '説明なし',
    chat: 'チャット',
    chatWith: '{name}とチャット',
    activateToChat: 'チャットするには有効化してください',
    runHistoryOf: '{name}の実行履歴',
    delete: '{name}を削除',
    deleteTitle: '{name}を削除しますか？',
    deleteMessage: 'このエージェントとはチャットできなくなります。自動化で使用されているエージェントは削除できません。',
    deleteConfirm: 'エージェントを削除',
  },
  toasts: {
    created: '{name}を作成しました',
    saved: '{name}を保存しました',
    activated: '{name}を有効化しました',
    deactivated: '{name}を無効化しました',
    deleted: '{name}を削除しました',
  },
  form: {
    create: 'エージェントを作成',
    save: 'エージェントを保存',
    builtInNote: 'これは組み込みのエージェントです。変更はできますが、削除はできません。代わりに無効化してください。',
    namePlaceholder: '契約更新アシスタント',
    descriptionHelp: 'チャットするエージェントを選ぶユーザーに表示されます。',
    instructions: '指示',
    instructionsHelp:
      'エージェントの目的、口調、手順、制限。LLM プロバイダーが設定されている場合はシステムプロンプトとして使用されます。{length}/8000 文字。',
    instructionsPlaceholder:
      'あなたは営業担当者の契約更新の準備を支援します。\n1. 取引先とその進行中の商談を調べます。\n2. リスクを要約し、次のステップを提案します。',
    autonomy: '自律レベル',
    tools: 'ツール',
    toolsHelp: {
      other:
        '{count} 個を選択済み。エージェントはここで有効にしたツールのみを使用でき、すべてのツール呼び出しは、エージェントが代わりに操作するユーザーの権限に照らしてチェックされます。',
    },
    writeToolsIgnored: 'このエージェントは読み取り専用のため、選択された書き込みツールは無視されます。',
    problems: {
      enterName: '名前を入力してください。',
      chooseTool: 'ツールを 1 つ以上選択してください。',
    },
  },
} satisfies Translation['setupAgents'];
