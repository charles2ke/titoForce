import type { RealtimeClientMessage, RealtimeServerMessage, UserDTO } from '@titoforce/shared';
import type { FastifyInstance } from 'fastify';
import type { RawData } from 'ws';
import type { Principal } from '../platform/principal.ts';
import type { RealtimeConnection } from '../platform/realtime.ts';
import { tokenTenant } from '../platform/users.ts';
import type { Platform } from '../tenancy/platform.ts';

/** Clients without a session cookie must send `{type: 'auth', token}` within this time. */
const AUTH_TIMEOUT_MS = 10_000;
/** Connections that send nothing for this long are closed (clients ping every 25 seconds). */
const IDLE_TIMEOUT_MS = 70_000;
/** How often the session behind a connection is checked again (sign-out, deactivation, role changes). */
const REVALIDATE_MS = 60_000;
const RECORD_ID = /^[A-Za-z0-9_-]{1,64}$/;

function sameHost(origin: string, host: string): boolean {
  try {
    return new URL(origin).host.toLowerCase() === host.toLowerCase();
  } catch {
    return false;
  }
}

/**
 * `GET /api/realtime` (WebSocket): pushes record changes, notifications, metadata changes and presence to signed-in
 * users of the organization the connection was opened for (`?org=` or subdomain, like every API request).
 */
export function realtimeRoutes(app: FastifyInstance, platform: Platform): void {
  const corsOrigins = new Set(platform.config.corsOrigins);

  app.get('/api/realtime', { websocket: true, config: { public: true } }, (socket, req) => {
    // Browsers always send the page's origin: refuse other sites, which could otherwise ride on the session cookie.
    const origin = req.headers.origin;
    const crossOrigin = !!origin && !sameHost(origin, req.host);
    if (crossOrigin && !corsOrigins.has(origin)) return socket.close(4003, 'Origin not allowed');
    const ctx = req.tenantContext;
    if (!ctx) return socket.close(1011, 'No organization');
    const { tenant, services } = ctx;
    const hub = services.realtime;
    let conn: RealtimeConnection | null = null;
    let token = '';
    let checkedAt = 0;

    const send = (msg: RealtimeServerMessage) => {
      if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(msg));
    };
    const end = (code: number, reason: string) => {
      if (socket.readyState === socket.OPEN || socket.readyState === socket.CONNECTING) socket.close(code, reason);
    };
    let timer = setTimeout(() => end(4001, 'Sign-in required'), AUTH_TIMEOUT_MS);
    const touch = () => {
      clearTimeout(timer);
      timer = setTimeout(() => end(4000, 'Idle'), IDLE_TIMEOUT_MS);
    };

    const start = (session: { user: UserDTO; principal: Principal }, sessionToken: string) => {
      token = sessionToken;
      checkedAt = Date.now();
      conn = {
        userId: session.user.id,
        name: session.user.name,
        avatarColor: session.user.avatarColor,
        principal: session.principal,
        send,
        close: () => end(1012, 'Organization restarting'),
      };
      hub.connect(conn);
      touch();
      send({ type: 'ready', userId: session.user.id });
    };

    /** Ends connections whose session or organization is no longer valid; picks up role changes. */
    const revalidate = async (c: RealtimeConnection): Promise<boolean> => {
      if (Date.now() - checkedAt < REVALIDATE_MS) return true;
      const current = await platform.tenantById(tenant.id);
      const valid = !!current && current.status === 'active' && current.generation === tenant.generation;
      const session = valid ? await services.users.resolveSession(token) : null;
      if (!session) {
        end(4001, 'Session ended');
        return false;
      }
      c.principal = session.principal;
      checkedAt = Date.now();
      return true;
    };

    async function handle(raw: RawData): Promise<void> {
      let msg: RealtimeClientMessage;
      try {
        msg = JSON.parse(String(raw)) as RealtimeClientMessage;
      } catch {
        return send({ type: 'error', message: 'Messages must be JSON' });
      }
      if (!msg || typeof msg !== 'object') return send({ type: 'error', message: 'Messages must be JSON objects' });
      if (!conn) {
        if (msg.type !== 'auth' || typeof msg.token !== 'string') return end(4001, 'Sign-in required');
        const session = tokenTenant(msg.token) === tenant.id ? await services.users.resolveSession(msg.token) : null;
        if (!session) return end(4001, 'Sign-in required');
        if (socket.readyState === socket.OPEN) start(session, msg.token);
        return;
      }
      const c = conn;
      touch();
      if (!(await revalidate(c))) return;
      switch (msg.type) {
        case 'ping':
          return send({ type: 'pong' });
        case 'watch': {
          if (msg.recordId === null) return hub.watch(c, null);
          if (typeof msg.recordId !== 'string' || !RECORD_ID.test(msg.recordId)) return;
          // Only records the user can read: presence would otherwise reveal who works on what.
          const readable = await services.records.get(c.principal, null, msg.recordId).then(
            () => true,
            () => false,
          );
          return hub.watch(c, readable ? msg.recordId : null);
        }
        case 'editing':
          if (typeof msg.recordId !== 'string' || (msg.field !== null && (typeof msg.field !== 'string' || msg.field.length > 64))) return;
          return hub.editing(c, msg.recordId, msg.field);
        default:
          return;
      }
    }

    // Messages are handled one at a time, in order (a "watch" must finish before the "editing" that follows it).
    let queue = Promise.resolve();
    socket.on('message', (raw: RawData) => {
      queue = queue.then(() => handle(raw)).catch((err: unknown) => {
        req.log.warn({ err }, 'realtime message failed');
        send({ type: 'error', message: 'The message could not be handled' });
      });
    });
    socket.on('close', () => {
      clearTimeout(timer);
      if (conn) hub.disconnect(conn);
      conn = null;
    });
    socket.on('error', () => {});
    // Like the HTTP API, cookies only count on the server's own pages: the mobile app (TITO_CORS_ORIGINS) sends its token.
    if (req.auth && !crossOrigin) start(req.auth, req.auth.token);
  });
}
