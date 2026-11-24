import type { NotificationDTO, PresenceViewer, RealtimeServerMessage } from '@titoforce/shared';
import type { RecordChangeEvent } from './events.ts';
import { canRead, type Principal } from './principal.ts';

/** One signed-in browser tab (or app) connected to `/api/realtime`. */
export interface RealtimeConnection {
  readonly userId: string;
  readonly name: string;
  readonly avatarColor: string;
  /** Updated when the session is re-validated (e.g. after a role change). */
  principal: Principal;
  send(msg: RealtimeServerMessage): void;
  /** Ends the connection (the organization is closing); clients reconnect. */
  close(): void;
}

interface ClientState {
  watching: string | null;
  editing: string | null;
}

/** Record changes are batched briefly so bulk edits and imports become a few messages. */
const FLUSH_MS = 40;

/**
 * Pushes changes to connected users of one organization: record changes (ids only, filtered by read access; clients
 * refetch through the normal API), new notifications, metadata changes and who is viewing or editing a record.
 * State is in-process, so all users of an organization must be served by the same server process.
 */
export class RealtimeHub {
  private clients = new Map<RealtimeConnection, ClientState>();
  private pending: RecordChangeEvent[] = [];
  private timer: NodeJS.Timeout | null = null;

  get connectionCount(): number {
    return this.clients.size;
  }

  connect(conn: RealtimeConnection): void {
    this.clients.set(conn, { watching: null, editing: null });
  }

  disconnect(conn: RealtimeConnection): void {
    const st = this.clients.get(conn);
    if (!st) return;
    this.clients.delete(conn);
    if (st.watching) this.broadcastPresence(st.watching);
  }

  /** The record a connection is looking at (null: none). */
  watch(conn: RealtimeConnection, recordId: string | null): void {
    const st = this.clients.get(conn);
    if (!st) return;
    const previous = st.watching;
    st.watching = recordId;
    st.editing = null;
    if (previous && previous !== recordId) this.broadcastPresence(previous);
    if (recordId) this.broadcastPresence(recordId);
  }

  /** The field being edited on the watched record ('*' for the whole form, null when done). */
  editing(conn: RealtimeConnection, recordId: string, field: string | null): void {
    const st = this.clients.get(conn);
    if (!st || st.watching !== recordId || st.editing === field) return;
    st.editing = field;
    this.broadcastPresence(recordId);
  }

  /** Everyone viewing a record, one entry per user (several tabs merge). */
  presence(recordId: string): PresenceViewer[] {
    const byUser = new Map<string, PresenceViewer>();
    for (const [conn, st] of this.clients) {
      if (st.watching !== recordId) continue;
      const existing = byUser.get(conn.userId);
      if (existing) existing.editing ??= st.editing;
      else byUser.set(conn.userId, { userId: conn.userId, name: conn.name, avatarColor: conn.avatarColor, editing: st.editing });
    }
    return [...byUser.values()];
  }

  private broadcastPresence(recordId: string): void {
    const viewers = this.presence(recordId);
    for (const [conn, st] of this.clients) if (st.watching === recordId) this.send(conn, { type: 'presence', recordId, viewers });
  }

  recordChanged(event: RecordChangeEvent): void {
    if (!this.clients.size) return;
    this.pending.push(event);
    if (!this.timer) {
      this.timer = setTimeout(() => this.flush(), FLUSH_MS);
      this.timer.unref();
    }
  }

  /** Sends batched record changes now. */
  flush(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    const events = this.pending.splice(0);
    if (!events.length) return;
    for (const conn of this.clients.keys()) {
      const groups = new Map<string, Extract<RealtimeServerMessage, { type: 'records' }>>();
      for (const e of events) {
        const visible = canRead(conn.principal, e.object, e.record.ownerId) || (!!e.previous && canRead(conn.principal, e.object, e.previous.ownerId));
        if (!visible) continue;
        const by = e.principal.userId ?? null;
        const key = `${e.object}\u0000${e.type}\u0000${by}`;
        const group = groups.get(key);
        if (group) {
          if (!group.ids.includes(e.record.id)) group.ids.push(e.record.id);
        } else {
          groups.set(key, { type: 'records', object: e.object, ids: [e.record.id], action: e.type, by });
        }
      }
      for (const msg of groups.values()) this.send(conn, msg);
    }
  }

  notify(userId: string, notification: NotificationDTO): void {
    for (const conn of this.clients.keys()) if (conn.userId === userId) this.send(conn, { type: 'notification', notification });
  }

  /** Objects, fields, layouts, translations or apps changed: clients reload their metadata. */
  metadataChanged(): void {
    for (const conn of this.clients.keys()) this.send(conn, { type: 'metadata' });
  }

  private send(conn: RealtimeConnection, msg: RealtimeServerMessage): void {
    try {
      conn.send(msg);
    } catch {
      // A closing socket; its close handler disconnects it.
    }
  }

  close(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.pending = [];
    const conns = [...this.clients.keys()];
    this.clients.clear();
    for (const conn of conns) {
      try {
        conn.close();
      } catch {
        // Already closed.
      }
    }
  }
}
