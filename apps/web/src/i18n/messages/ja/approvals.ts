import type { Translation } from '../../index.ts';

export default {
  title: '承認',
  subtitle: '人による判断が必要な、レコードの承認申請と AI エージェントのアクションです。',
  tabs: {
    inbox: '自分の承認待ち',
    submitted: '自分の申請',
    all: 'すべての申請',
    agent: 'エージェントのアクション',
  },
  empty: {
    inbox: 'あなたの承認を待っているものはありません',
    submitted: 'まだ何も承認申請していません',
    all: '承認申請はまだありません',
  },

  approve: '承認',
  reject: '却下',
  recall: '取り消し',

  requestStatus: {
    pending: '承認待ち',
    approved: '承認済み',
    rejected: '却下済み',
    recalled: '取り消し済み',
  },
  request: {
    submittedBy: '申請者：{name}（{time}）',
    submittedByYou: '申請者：あなた（{time}）',
    approver: '承認者：{name}',
    approverYou: '承認者：あなた',
    approvedAt: '承認済み（{time}）',
    rejectedAt: '却下済み（{time}）',
    recalledAt: '取り消し済み（{time}）',
    quote: '「{text}」',
    recalled: '申請を取り消しました',
  },

  status: {
    pending: '承認待ち',
    executing: '実行中',
    executed: '実行済み',
    rejected: '却下済み',
    failed: '失敗',
  },
  action: {
    wantsToRun: '{agent}が {tool} の実行を要求しています',
    viewRecord: 'レコードを表示',
    arguments: '引数',
    result: '結果',
    failed: 'アクションに失敗しました：{error}',
    failedUnknown: 'アクションに失敗しました：不明なエラー',
    rejected: 'アクションを却下しました',
    executed: 'アクションを承認して実行しました',
  },
  agentActions: {
    intro: '自律レベルが「承認が必要」のエージェントは、データを変更する前にここで一時停止します。',
    pending: '承認待ち',
    emptyPending: '承認待ちのエージェントアクションはありません',
    emptyAll: 'エージェントのアクションはまだありません',
  },
} satisfies Translation['approvals'];
