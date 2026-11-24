import type { Translation } from '../../index.ts';

export default {
  viewType: {
    table: 'テーブル',
    kanban: 'カンバン',
    calendar: 'カレンダー',
    timeline: 'タイムライン',
  },

  views: {
    all: 'すべての{plural}',
    pickerLabel: 'リストビューを選択',
    menuLabel: 'リストビュー',
    shared: '共有ビュー',
    mine: '自分のビュー',
    others: '他のユーザーのビュー',
    actions: 'ビューのアクション',
    rename: '名前を変更',
    delete: 'ビューを削除',
    saveAs: 'ビューとして保存',
    saveAsTitle: '新しいビューとして保存',
    renameTitle: 'ビューの名前を変更',
    copyName: '{name}（コピー）',
    nameLabel: 'ビュー名',
    nameRequired: 'ビューの名前を入力してください。',
    shareWithEveryone: '全員と共有',
    savedNew: 'ビュー「{name}」を保存しました',
    saved: 'ビューを保存しました',
    deleteTitle: 'リストビューを削除しますか？',
    deleteMessage: '「{name}」が削除されます。',
    deleteMessageShared: '「{name}」は全員のリストから削除されます。',
    deleted: 'ビューを削除しました',
  },

  columns: {
    button: '列',
    shown: '{max} 列中 {shown} 列を表示',
    reset: 'デフォルトに戻す',
  },

  toolbar: {
    displayAs: '表示形式',
    groupBy: 'グループ化',
    dateField: '日付',
    searchPlaceholder: '{plural}を検索…',
    searchLabel: '{plural}を検索',
    filters: 'フィルター',
    filtersCount: 'フィルター（{count}）',
    clearFilters: 'フィルターをクリア',
    resetToView: 'ビューの設定に戻す',
    filteredBy: 'フィルター条件：',
  },

  import: {
    title: '{plural}をインポート',
    instructions:
      '1 行目には、{label}の項目の表示ラベルまたは API 参照名と一致する列見出しが必要です。参照先のレコードとユーザーは名前または ID で指定できます（ユーザーはメールアドレスでも指定できます）。最大 {max} 行までインポートできます。',
    file: 'CSV ファイル',
    contentsOf: '{file}の内容',
    paste: 'または CSV を貼り付け',
    created: { one: '{count} 件の{singular}を作成しました。', other: '{count} 件の{plural}を作成しました。' },
    createdWithFailures: {
      one: '{count} 件の{singular}を作成しました。{rows}でエラーが発生しました。',
      other: '{count} 件の{plural}を作成しました。{rows}でエラーが発生しました。',
    },
    rows: { other: '{count} 行' },
    rowError: '{row} 行目：{message}',
    columnMapping: '列の対応付け',
    ignored: '無視',
  },

  objectNotFound: {
    title: 'オブジェクトが見つかりません',
    body: '削除されたか、アクセス権がない可能性があります。',
  },
} satisfies Translation['list'];
