import type { Translation } from '../../index.ts';

export default {
  network: 'titoForce サーバーに接続できません。接続を確認してから、もう一度お試しください。',
  api: {
    unauthenticated: 'ログインしてください',
    invalid_credentials: 'メールアドレスまたはパスワードが正しくありません',
    rate_limited: 'リクエストが多すぎます。しばらく待ってから、もう一度お試しください。',
    invalid_password: '現在のパスワードが正しくありません',
    unsupported_media_type: '「Content-Type: application/json」でリクエストを送信してください',
    invalid_json: 'リクエスト本文が有効な JSON ではありません',
    forbidden: 'この操作を行う権限がありません。',
    not_found: '対象が見つからないか、アクセス権がありません。',
    edit_conflict: '編集中に他のユーザーがこのレコードを変更しました。',
    organization_not_found: 'この ID の組織は存在しません。',
    organization_mismatch: 'このアドレスは別の組織のものです。',
    organization_suspended: 'この組織は停止されています。サーバーの管理者にお問い合わせください。',
    organization_unavailable: 'この組織は準備中です。しばらくしてから、もう一度お試しください。',
    nothing_to_deploy: 'リリースする新規または変更済みのコンポーネントを 1 つ以上選択してください。',
    http_error: 'リクエストに失敗しました',
  },
} satisfies Translation['errors'];
