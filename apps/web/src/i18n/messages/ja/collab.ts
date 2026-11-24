import type { Translation } from '../../index.ts';

export default {
  others: { other: '他に {count} 人がこのレコードを開いています' },
  viewing: '{name}が閲覧中',
  editing: '{name}が編集中',
  editingField: '{name}が{field}を編集中',
  more: { other: '他 {count} 人' },
  someone: '他のユーザー',
  changed: '{name}がこのレコードを変更しました。あなたが編集していない項目への変更は、ここに反映されています。',
  changedEdited: 'あなたが編集した{fields}も変更されています。保存時に、残す値を選択します。',
  conflict: {
    title: '他のユーザーが同じ項目を変更しました',
    message: 'これらの項目は、あなたが編集を開始した後に変更されました。残す値を選択してください。',
    theirValue: '相手の値',
    yourValue: 'あなたの値',
    by: '{name}、{time}',
    useTheirs: '相手の値を使用',
    saveMine: 'このままあなたの値を保存',
    rebased: 'フォームに相手の値が反映されました。内容を確認して、もう一度保存してください。',
  },
  fieldConflict: '{name}がこの項目を変更しました（{time}）：',
  useTheirs: '相手の値を使用',
  saveMine: 'あなたの値を保存',
} satisfies Translation['collab'];
