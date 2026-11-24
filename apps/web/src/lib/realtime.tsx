import { useQueryClient } from '@tanstack/react-query';
import type { PresenceViewer, RealtimeClientMessage, RealtimeServerMessage } from '@titoforce/shared';
import { createContext, type ReactNode, useContext, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { realtimeToken, realtimeUrl } from '../api.ts';
import { invalidateMetadata, invalidateRecordData } from './hooks.ts';

export type RecordsMessage = Extract<RealtimeServerMessage, { type: 'records' }>;

interface Handlers {
  onRecords: (msg: RecordsMessage) => void;
  onNotification: () => void;
  onMetadata: () => void;
  /** Connected again after an interruption: changes made meanwhile were missed. */
  onReconnected: () => void;
  onSessionEnded: () => void;
}

const PING_MS = 25_000;
const MAX_RETRY_MS = 30_000;

/**
 * One WebSocket per tab to `/api/realtime`: record changes, notifications and metadata changes refresh the affected
 * queries, and presence shows who else is on the record being viewed. Reconnects with backoff; the server is the
 * source of truth, so after a gap everything visible is simply refetched.
 */
export class RealtimeClient {
  private socket: WebSocket | null = null;
  private handlers: Handlers | null = null;
  private attempts = 0;
  private retryTimer: ReturnType<typeof setTimeout> | undefined;
  private pingTimer: ReturnType<typeof setInterval> | undefined;
  private everReady = false;
  private watching: string | null = null;
  private editingField: string | null = null;
  private editingClaims: { recordId: string; field: string }[] = [];
  private listeners = new Set<() => void>();
  private recordListeners = new Set<(msg: RecordsMessage) => void>();
  connected = false;
  presence: { recordId: string; viewers: PresenceViewer[] } | null = null;

  start(handlers: Handlers): void {
    this.handlers = handlers;
    document.addEventListener('visibilitychange', this.wake);
    window.addEventListener('online', this.wake);
    this.connect();
  }

  stop(): void {
    this.handlers = null;
    document.removeEventListener('visibilitychange', this.wake);
    window.removeEventListener('online', this.wake);
    clearTimeout(this.retryTimer);
    clearInterval(this.pingTimer);
    const socket = this.socket;
    this.socket = null;
    socket?.close(1000);
    this.everReady = false;
    this.setState(false, null);
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  onRecords(listener: (msg: RecordsMessage) => void): () => void {
    this.recordListeners.add(listener);
    return () => this.recordListeners.delete(listener);
  }

  /** The record this tab shows (null: none), for presence. */
  watch(recordId: string | null): void {
    if (this.watching === recordId) return;
    this.watching = recordId;
    // Watching resets the editing field on the server too.
    this.editingField = null;
    this.setState(this.connected, null);
    this.send({ type: 'watch', recordId });
    this.syncEditing();
  }

  /** Stops watching `recordId` unless another record is watched by now. */
  unwatch(recordId: string): void {
    if (this.watching === recordId) this.watch(null);
  }

  /**
   * Announces that `field` of `recordId` is being edited ('*': the whole form) until the returned function is called.
   * The server keeps one field per connection: the latest claim on the watched record.
   */
  claimEditing(recordId: string, field: string): () => void {
    const claim = { recordId, field };
    this.editingClaims.push(claim);
    this.syncEditing();
    return () => {
      const i = this.editingClaims.indexOf(claim);
      if (i >= 0) this.editingClaims.splice(i, 1);
      this.syncEditing();
    };
  }

  private syncEditing(): void {
    const field = this.editingClaims.findLast((c) => c.recordId === this.watching)?.field ?? null;
    if (!this.watching || this.editingField === field) return;
    this.editingField = field;
    this.send({ type: 'editing', recordId: this.watching, field });
  }

  private wake = (): void => {
    if (document.visibilityState === 'visible' && !this.socket && this.handlers) {
      clearTimeout(this.retryTimer);
      this.attempts = 0;
      this.connect();
    }
  };

  private connect(): void {
    if (!this.handlers || this.socket || typeof WebSocket === 'undefined') return;
    let socket: WebSocket;
    try {
      socket = new WebSocket(realtimeUrl());
    } catch {
      this.retry();
      return;
    }
    this.socket = socket;
    socket.onopen = () => {
      // The native app has no cookie for the server: it signs in with its token as the first message.
      const token = realtimeToken();
      if (token) socket.send(JSON.stringify({ type: 'auth', token } satisfies RealtimeClientMessage));
    };
    socket.onmessage = (e) => {
      if (this.socket === socket) this.receive(e.data);
    };
    socket.onclose = (e) => {
      if (this.socket !== socket) return;
      this.socket = null;
      clearInterval(this.pingTimer);
      this.setState(false, null);
      if (e.code === 4003) {
        console.warn('Live updates are off: the server does not allow this origin (TITO_CORS_ORIGINS).');
        return;
      }
      // 4001: the session ended (or never existed); checking it signs the user out if so.
      if (e.code === 4001) this.handlers?.onSessionEnded();
      this.retry();
    };
  }

  private retry(): void {
    if (!this.handlers) return;
    clearTimeout(this.retryTimer);
    const delay = Math.min(MAX_RETRY_MS, 1000 * 2 ** this.attempts++) * (0.5 + Math.random() / 2);
    this.retryTimer = setTimeout(() => {
      // Hidden tabs reconnect when shown again (see wake), so idle tabs do not hold connections.
      if (document.visibilityState === 'visible') this.connect();
    }, delay);
  }

  private receive(data: unknown): void {
    let msg: RealtimeServerMessage;
    try {
      msg = JSON.parse(String(data)) as RealtimeServerMessage;
    } catch {
      return;
    }
    switch (msg.type) {
      case 'ready': {
        const reconnected = this.everReady;
        this.everReady = true;
        this.attempts = 0;
        this.setState(true, null);
        if (this.watching) this.send({ type: 'watch', recordId: this.watching });
        if (this.watching && this.editingField) this.send({ type: 'editing', recordId: this.watching, field: this.editingField });
        clearInterval(this.pingTimer);
        this.pingTimer = setInterval(() => this.send({ type: 'ping' }), PING_MS);
        if (reconnected) this.handlers?.onReconnected();
        return;
      }
      case 'records':
        this.handlers?.onRecords(msg);
        for (const l of this.recordListeners) l(msg);
        return;
      case 'notification':
        this.handlers?.onNotification();
        return;
      case 'metadata':
        this.handlers?.onMetadata();
        return;
      case 'presence':
        if (msg.recordId === this.watching) this.setState(this.connected, { recordId: msg.recordId, viewers: msg.viewers });
        return;
      default:
        return;
    }
  }

  private send(msg: RealtimeClientMessage): void {
    if (this.connected && this.socket?.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify(msg));
  }

  private setState(connected: boolean, presence: RealtimeClient['presence']): void {
    if (this.connected === connected && this.presence === presence) return;
    this.connected = connected;
    this.presence = presence;
    for (const l of this.listeners) l();
  }
}

const RealtimeContext = createContext<RealtimeClient | null>(null);

/** Keeps the signed-in user's tab connected for live updates. */
export function RealtimeProvider({ userId, children }: { userId: string; children: ReactNode }) {
  const qc = useQueryClient();
  const [client] = useState(() => new RealtimeClient());
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    // Changes arrive in bursts (imports, automations): refresh once they settle.
    const refreshRecords = () => {
      clearTimeout(timer);
      timer = setTimeout(() => void invalidateRecordData(qc), 400);
    };
    client.start({
      onRecords: refreshRecords,
      onNotification: () => void qc.invalidateQueries({ queryKey: ['notifications'] }),
      onMetadata: () => void invalidateMetadata(qc),
      onReconnected: () => {
        refreshRecords();
        void qc.invalidateQueries({ queryKey: ['notifications'] });
      },
      onSessionEnded: () => void qc.invalidateQueries({ queryKey: ['session'] }),
    });
    return () => {
      clearTimeout(timer);
      client.stop();
    };
  }, [client, qc, userId]);
  return <RealtimeContext.Provider value={client}>{children}</RealtimeContext.Provider>;
}

const noSubscribe = () => () => {};
const NO_VIEWERS: PresenceViewer[] = [];

/** Whether live updates are connected. */
export function useRealtimeConnected(): boolean {
  const client = useContext(RealtimeContext);
  return useSyncExternalStore(client?.subscribe ?? noSubscribe, () => client?.connected ?? false);
}

/** Other people viewing (or editing) the record; announces that this user views it too. */
export function usePresence(recordId: string | undefined, selfId: string): PresenceViewer[] {
  const client = useContext(RealtimeContext);
  useEffect(() => {
    if (!client || !recordId) return;
    client.watch(recordId);
    return () => client.unwatch(recordId);
  }, [client, recordId]);
  const presence = useSyncExternalStore(client?.subscribe ?? noSubscribe, () => client?.presence ?? null);
  return useMemo(() => (presence && presence.recordId === recordId ? presence.viewers.filter((v) => v.userId !== selfId) : NO_VIEWERS), [presence, recordId, selfId]);
}

/** Tells others which field of the record this user is editing ('*': the whole record) while `active`. */
export function useEditingPresence(recordId: string | undefined, field: string, active: boolean): void {
  const client = useContext(RealtimeContext);
  useEffect(() => {
    if (!client || !recordId || !active) return;
    return client.claimEditing(recordId, field);
  }, [client, recordId, field, active]);
}

/** Calls `handler` for every batch of record changes pushed by the server. */
export function useRecordEvents(handler: (msg: RecordsMessage) => void): void {
  const client = useContext(RealtimeContext);
  useEffect(() => client?.onRecords(handler), [client, handler]);
}
