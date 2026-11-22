import type { RealtimeClientMessage, RealtimeServerMessage } from '@titoforce/shared';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { WebSocket } from 'ws';
import { buildApp } from '../src/app.ts';
import type { Services } from '../src/services.ts';
import type { Platform } from '../src/tenancy/platform.ts';
import { createTestPlatform } from './helpers.ts';

type Message<T extends RealtimeServerMessage['type']> = Extract<RealtimeServerMessage, { type: T }>;

interface Client {
  messages: RealtimeServerMessage[];
  send(msg: RealtimeClientMessage | Record<string, unknown> | string): void;
  /** The first message of this type (and matching `match`) not returned before; waits up to 2 seconds. */
  next<T extends RealtimeServerMessage['type']>(type: T, match?: (m: Message<T>) => boolean): Promise<Message<T>>;
  /** Resolves once everything the server sent before has arrived. */
  sync(): Promise<void>;
  closed: Promise<{ code: number; reason: string }>;
  /** Drops the connection, like a closed tab or a lost network. */
  drop(): void;
}

let platform: Platform;
let app: FastifyInstance;
let s: Services;
const sessions: Record<string, { cookie: string; token: string; id: string }> = {};
const open: Client[] = [];

function cookieOf(res: LightMyRequestResponse): string {
  const c = res.cookies.find((x) => x.name.startsWith('tf_session'));
  if (!c) throw new Error(`No session cookie (status ${res.statusCode}: ${res.body})`);
  return `${c.name}=${c.value}`;
}

async function signIn(key: string): Promise<{ cookie: string; token: string; id: string }> {
  const res = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: `${key}@titoforce.example`, password: 'titoforce', issueToken: true } });
  expect(res.statusCode, res.body).toBe(200);
  return { cookie: cookieOf(res), token: res.json().token, id: res.json().user.id };
}

async function connect(headers: Record<string, string> = {}, url = '/api/realtime'): Promise<Client> {
  const messages: RealtimeServerMessage[] = [];
  const taken = new Set<number>();
  const waiters = new Set<() => void>();
  let socket!: WebSocket;
  let closedWith: (v: { code: number; reason: string }) => void = () => {};
  const closed = new Promise<{ code: number; reason: string }>((resolve) => (closedWith = resolve));
  await app.injectWS(url, { headers }, {
    onInit: (ws) => {
      socket = ws;
      ws.on('message', (data) => {
        messages.push(JSON.parse(String(data)) as RealtimeServerMessage);
        for (const w of [...waiters]) w();
      });
      ws.on('close', (code, reason) => closedWith({ code, reason: String(reason) }));
    },
  });
  const client: Client = {
    messages,
    closed,
    send: (msg) => socket.send(typeof msg === 'string' ? msg : JSON.stringify(msg)),
    drop: () => socket.terminate(),
    next: (type, match) =>
      new Promise((resolve, reject) => {
        const check = () => {
          const i = messages.findIndex((m, idx) => !taken.has(idx) && m.type === type && (!match || match(m as never)));
          if (i < 0) return;
          taken.add(i);
          waiters.delete(check);
          clearTimeout(timer);
          resolve(messages[i] as never);
        };
        const timer = setTimeout(() => {
          waiters.delete(check);
          reject(new Error(`No "${type}" message arrived; received ${JSON.stringify(messages)}`));
        }, 2000);
        waiters.add(check);
        check();
      }),
    sync: async () => {
      client.send({ type: 'ping' });
      await client.next('pong');
    },
  };
  open.push(client);
  return client;
}

/** Connected and authenticated (the session cookie) as a demo user. */
async function connectAs(key: string): Promise<Client> {
  const c = await connect({ cookie: sessions[key]!.cookie });
  await c.next('ready');
  return c;
}

const viewerIds = (m: Message<'presence'>) => m.viewers.map((v) => v.userId).sort();

beforeAll(async () => {
  platform = await createTestPlatform({ env: { TITO_ALLOW_SIGNUP: 'true', TITO_CORS_ORIGINS: 'capacitor://localhost' } });
  app = await buildApp(platform);
  await app.ready();
  s = await platform.servicesFor(platform.defaultTenant());
  for (const key of ['maria', 'james', 'noah', 'admin']) sessions[key] = await signIn(key);
});

afterEach(() => {
  vi.restoreAllMocks();
  for (const c of open.splice(0)) c.drop();
});

afterAll(async () => {
  await app?.close();
  await platform?.close();
});

describe('realtime connections', () => {
  it('require a signed-in user', async () => {
    const anonymous = await connect();
    anonymous.send({ type: 'ping' });
    expect(await anonymous.closed).toEqual({ code: 4001, reason: 'Sign-in required' });

    const forged = await connect();
    forged.send({ type: 'auth', token: 'not-a-session' });
    expect((await forged.closed).code).toBe(4001);
  });

  it('accept a session token as the first message (apps without cookies)', async () => {
    const c = await connect();
    c.send({ type: 'auth', token: sessions.maria!.token });
    expect(await c.next('ready')).toEqual({ type: 'ready', userId: sessions.maria!.id });
    await c.sync();
  });

  it('only accept tokens of the organization they were opened for', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/signup',
      payload: { organization: 'globex', organizationName: 'Globex', name: 'Hank Scorpio', email: 'hank@globex.test', password: 'correct-horse-battery', issueToken: true },
    });
    expect(res.statusCode, res.body).toBe(201);
    const token = res.json().token as string;

    const wrongOrg = await connect();
    wrongOrg.send({ type: 'auth', token });
    expect((await wrongOrg.closed).code).toBe(4001);

    const globex = await connect({}, '/api/realtime?org=globex');
    globex.send({ type: 'auth', token });
    expect((await globex.next('ready')).userId).toBe(res.json().user.id);
  });

  it('refuse pages of other sites, which could otherwise use the session cookie', async () => {
    const evil = await connect({ cookie: sessions.maria!.cookie, host: 'crm.example', origin: 'https://evil.example' });
    expect(await evil.closed).toEqual({ code: 4003, reason: 'Origin not allowed' });

    const sameSite = await connect({ cookie: sessions.maria!.cookie, host: 'crm.example', origin: 'https://crm.example' });
    await sameSite.next('ready');
    // The mobile app's origin is allowed by TITO_CORS_ORIGINS, but signs in with its token: cookies only count on the server's own pages.
    const withCookie = await connect({ cookie: sessions.maria!.cookie, host: 'crm.example', origin: 'capacitor://localhost' });
    withCookie.send({ type: 'ping' });
    expect(await withCookie.closed).toEqual({ code: 4001, reason: 'Sign-in required' });
    const mobile = await connect({ host: 'crm.example', origin: 'capacitor://localhost' });
    mobile.send({ type: 'auth', token: sessions.maria!.token });
    expect((await mobile.next('ready')).userId).toBe(sessions.maria!.id);
  });

  it('end when the session ends', async () => {
    const session = await signIn('maria');
    const c = await connect({ cookie: session.cookie });
    await c.next('ready');
    const out = await app.inject({ method: 'POST', url: '/api/auth/logout', headers: { cookie: session.cookie, 'content-type': 'application/json' }, payload: '{}' });
    expect(out.statusCode).toBe(200);
    // Sessions are checked again once a minute.
    const now = Date.now();
    vi.spyOn(Date, 'now').mockReturnValue(now + 61_000);
    c.send({ type: 'ping' });
    expect(await c.closed).toEqual({ code: 4001, reason: 'Session ended' });
  });
});

describe('realtime messages', () => {
  it('announce record changes to the users who can read the record', async () => {
    const maria = await connectAs('maria');
    const noah = await connectAs('noah'); // employees cannot see accounts
    const created = await app.inject({
      method: 'POST',
      url: '/api/records/account',
      headers: { cookie: sessions.james!.cookie, 'content-type': 'application/json' },
      payload: JSON.stringify({ fields: { name: 'Realtime Inc' } }),
    });
    expect(created.statusCode, created.body).toBe(201);
    const id = created.json().record.id as string;
    expect(await maria.next('records')).toEqual({ type: 'records', object: 'account', ids: [id], action: 'created', by: sessions.james!.id });

    const updated = await app.inject({
      method: 'PATCH',
      url: `/api/records/account/${id}`,
      headers: { cookie: sessions.james!.cookie, 'content-type': 'application/json' },
      payload: JSON.stringify({ fields: { name: 'Realtime Incorporated' } }),
    });
    expect(updated.statusCode, updated.body).toBe(200);
    expect(await maria.next('records', (m) => m.action === 'updated')).toMatchObject({ object: 'account', ids: [id] });

    s.realtime.flush();
    await noah.sync();
    expect(noah.messages.filter((m) => m.type === 'records')).toEqual([]);
  });

  it('show who is viewing and editing a record, to people who can read it', async () => {
    const accountId = (await s.db.get<{ id: string }>("SELECT id FROM records WHERE object_api_name = 'account' ORDER BY id LIMIT 1"))!.id;
    const maria = await connectAs('maria');
    const james = await connectAs('james');

    maria.send({ type: 'watch', recordId: accountId });
    expect(viewerIds(await maria.next('presence'))).toEqual([sessions.maria!.id]);
    james.send({ type: 'watch', recordId: accountId });
    const both = [sessions.maria!.id, sessions.james!.id].sort();
    expect(viewerIds(await maria.next('presence', (m) => m.viewers.length === 2))).toEqual(both);
    expect(viewerIds(await james.next('presence'))).toEqual(both);

    james.send({ type: 'editing', recordId: accountId, field: 'industry' });
    const editing = await maria.next('presence', (m) => m.viewers.some((v) => v.editing));
    expect(editing.viewers.find((v) => v.userId === sessions.james!.id)).toMatchObject({ name: 'James Chen', editing: 'industry' });

    // Noah cannot read the account, so he neither appears nor learns who is there.
    const noah = await connectAs('noah');
    noah.send({ type: 'watch', recordId: accountId });
    await noah.sync();
    expect(noah.messages.filter((m) => m.type === 'presence')).toEqual([]);
    expect(s.realtime.presence(accountId).map((v) => v.userId).sort()).toEqual(both);

    james.drop();
    expect(viewerIds(await maria.next('presence', (m) => m.viewers.length === 1))).toEqual([sessions.maria!.id]);
  });

  it('deliver new notifications to their recipient only', async () => {
    const maria = await connectAs('maria');
    const james = await connectAs('james');
    await s.notifications.notify([sessions.maria!.id], 'Quarterly review', 'Starts at 10', '/app/sales');
    expect((await maria.next('notification')).notification).toMatchObject({ title: 'Quarterly review', body: 'Starts at 10', link: '/app/sales', read: false });
    await james.sync();
    expect(james.messages.filter((m) => m.type === 'notification')).toEqual([]);
  });

  it('tell everyone to reload metadata after a setup change', async () => {
    const maria = await connectAs('maria');
    const res = await app.inject({
      method: 'POST',
      url: '/api/objects/account/fields',
      headers: { cookie: sessions.admin!.cookie, 'content-type': 'application/json' },
      payload: JSON.stringify({ apiName: 'realtime_score', label: 'Realtime Score', type: 'number' }),
    });
    expect(res.statusCode, res.body).toBe(201);
    expect(await maria.next('metadata')).toEqual({ type: 'metadata' });
  });

  it('report malformed messages and ignore invalid record IDs', async () => {
    const c = await connectAs('maria');
    c.send('not json');
    expect(await c.next('error')).toEqual({ type: 'error', message: 'Messages must be JSON' });
    c.send({ type: 'watch', recordId: '../../etc/passwd' });
    await c.sync();
    expect(c.messages.filter((m) => m.type === 'presence')).toEqual([]);
  });
});

describe('realtime hub', () => {
  it('closes every connection when the organization shuts down', async () => {
    const maria = await connectAs('maria');
    expect(s.realtime.connectionCount).toBeGreaterThan(0);
    s.realtime.close();
    expect((await maria.closed).code).toBe(1012);
    expect(s.realtime.connectionCount).toBe(0);
  });
});
