import { createHash, randomBytes } from 'node:crypto';
import { type Db, parseJson } from '../db/database.ts';

export const hashToken = (token: string): string => createHash('sha256').update(token).digest('hex');

export interface Challenge<T = Record<string, unknown>> {
  id: string;
  kind: string;
  userId: string | null;
  data: T;
  attempts: number;
}

interface ChallengeRow {
  id: string;
  kind: string;
  user_id: string | null;
  data: unknown;
  attempts: number;
}

/**
 * Short-lived sign-in state kept in the database so it works across restarts and instances: second-factor steps,
 * single sign-on requests and replay markers. Only SHA-256 hashes of the tokens handed to clients are stored.
 */
export class ChallengeStore {
  private db: Db;
  private lastPurge = 0;

  constructor(db: Db) {
    this.db = db;
  }

  /** Stores a challenge and returns its token. */
  async create(kind: string, userId: string | null, data: Record<string, unknown>, ttlMs: number): Promise<string> {
    await this.purge();
    const token = randomBytes(32).toString('base64url');
    const now = Date.now();
    await this.db.run('INSERT INTO auth_challenges (id, kind, user_id, data, attempts, expires_at, created_at) VALUES (?, ?, ?, ?, 0, ?, ?)', [
      hashToken(token),
      kind,
      userId,
      JSON.stringify(data),
      new Date(now + ttlMs).toISOString(),
      new Date(now).toISOString(),
    ]);
    return token;
  }

  /** A live challenge of the given kind, or null. */
  async find<T = Record<string, unknown>>(token: string, kind: string): Promise<Challenge<T> | null> {
    if (!token) return null;
    const row = await this.db.get<ChallengeRow>('SELECT id, kind, user_id, data, attempts FROM auth_challenges WHERE id = ? AND kind = ? AND expires_at > ?', [
      hashToken(token),
      kind,
      new Date().toISOString(),
    ]);
    return row ? { id: row.id, kind: row.kind, userId: row.user_id, data: parseJson<T>(row.data, {} as T), attempts: Number(row.attempts) } : null;
  }

  async setData(id: string, data: Record<string, unknown>): Promise<void> {
    await this.db.run('UPDATE auth_challenges SET data = ? WHERE id = ?', [JSON.stringify(data), id]);
  }

  /** Records a failed attempt. Returns false, and removes the challenge, once `max` attempts have failed. */
  async fail(id: string, max: number): Promise<boolean> {
    await this.db.run('UPDATE auth_challenges SET attempts = attempts + 1 WHERE id = ?', [id]);
    const row = await this.db.get<{ attempts: number }>('SELECT attempts FROM auth_challenges WHERE id = ?', [id]);
    if (row && Number(row.attempts) < max) return true;
    await this.db.run('DELETE FROM auth_challenges WHERE id = ?', [id]);
    return false;
  }

  /** Removes a challenge. Returns false when another request already used it. */
  async consume(id: string): Promise<boolean> {
    const { changes } = await this.db.run('DELETE FROM auth_challenges WHERE id = ?', [id]);
    return changes > 0;
  }

  /** Ends every pending challenge of a user, e.g. a sign-in that started with a password that has since changed. */
  async revokeForUser(userId: string): Promise<void> {
    await this.db.run('DELETE FROM auth_challenges WHERE user_id = ?', [userId]);
  }

  /** Records `key` as used until it expires. Returns false when it was already recorded (a replay). */
  async claim(kind: string, key: string, expiresAt: Date): Promise<boolean> {
    await this.purge();
    const { changes } = await this.db.run(
      'INSERT INTO auth_challenges (id, kind, user_id, data, attempts, expires_at, created_at) VALUES (?, ?, NULL, ?, 0, ?, ?) ON CONFLICT (id) DO NOTHING',
      [hashToken(`${kind}:${key}`), kind, '{}', expiresAt.toISOString(), new Date().toISOString()],
    );
    return changes > 0;
  }

  private async purge(): Promise<void> {
    const now = Date.now();
    if (now - this.lastPurge < 60_000) return;
    this.lastPurge = now;
    await this.db.run('DELETE FROM auth_challenges WHERE expires_at < ?', [new Date(now).toISOString()]);
  }
}
