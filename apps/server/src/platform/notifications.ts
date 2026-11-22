import type { NotificationDTO } from '@titoforce/shared';
import type { Db } from '../db/database.ts';
import { newId, nowIso, truncate } from '../util.ts';

export class NotificationService {
  private db: Db;
  /** Called after each notification is stored (realtime delivery). */
  onCreated: ((userId: string, notification: NotificationDTO) => void) | null = null;

  constructor(db: Db) {
    this.db = db;
  }

  async notify(userIds: (string | null | undefined)[], title: string, body?: string | null, link?: string | null): Promise<void> {
    const unique = [...new Set(userIds.filter((u): u is string => !!u))];
    for (const userId of unique) {
      const n: NotificationDTO = { id: newId('ntf'), title: truncate(title, 200), body: body ? truncate(body, 2000) : null, link: link ?? null, read: false, createdAt: nowIso() };
      await this.db.run('INSERT INTO notifications (id, user_id, title, body, link, read, created_at) VALUES (?, ?, ?, ?, ?, 0, ?)', [
        n.id,
        userId,
        n.title,
        n.body,
        n.link,
        n.createdAt,
      ]);
      this.onCreated?.(userId, n);
    }
  }

  async list(userId: string, limit = 30): Promise<{ items: NotificationDTO[]; unread: number }> {
    const rows = await this.db.all<{ id: string; title: string; body: string | null; link: string | null; read: number; created_at: string }>(
      'SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT ?',
      [userId, limit],
    );
    const unread = await this.db.get<{ c: number }>('SELECT COUNT(*) AS c FROM notifications WHERE user_id = ? AND read = 0', [userId]);
    return {
      items: rows.map((r) => ({ id: r.id, title: r.title, body: r.body, link: r.link, read: !!Number(r.read), createdAt: r.created_at })),
      unread: Number(unread?.c ?? 0),
    };
  }

  async markRead(userId: string, ids?: string[]): Promise<void> {
    if (ids?.length) {
      await this.db.run(`UPDATE notifications SET read = 1 WHERE user_id = ? AND id IN (${ids.map(() => '?').join(',')})`, [userId, ...ids]);
    } else {
      await this.db.run('UPDATE notifications SET read = 1 WHERE user_id = ?', [userId]);
    }
  }
}
