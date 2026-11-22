import cookie from '@fastify/cookie';
import Fastify from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { authRoutes } from '../src/routes/auth.ts';
import type { Services } from '../src/services.ts';
import { Platform } from '../src/tenancy/platform.ts';
import { AppError } from '../src/util.ts';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

function controlled() {
  const calls: ReturnType<typeof deferred<void>>[] = [];
  let changed = deferred<void>();
  const verify = vi.fn(() => {
    const call = deferred<void>();
    calls.push(call);
    changed.resolve();
    changed = deferred<void>();
    return call.promise;
  });
  async function waitFor(count: number) {
    while (calls.length < count) await changed.promise;
  }
  return { calls, verify, waitFor };
}

const invalidCredentials = () => new AppError(401, 'invalid_credentials', 'Invalid credentials');
const invalidPassword = () => new AppError(401, 'invalid_password', 'Invalid password');

async function setup() {
  const login = controlled();
  const password = controlled();
  const session = { user: { id: 'user-1' }, permissions: {}, principal: {} };
  const services = {
    config: { secureCookies: false },
    users: {
      login: async () => { await login.verify(); return { token: 'token' }; },
      changePassword: password.verify,
      resolveSession: async () => session,
    },
  } as unknown as Services;
  const platform = Platform.single(services);
  const app = Fastify();
  await app.register(cookie);
  app.decorateRequest('auth', null);
  app.decorateRequest('tenant', null);
  app.addHook('onRequest', async (req) => {
    req.tenant = platform.defaultTenant();
    if (req.url === '/api/auth/password') req.auth = { ...session, token: 'token' } as typeof req.auth;
  });
  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof AppError) return reply.code(err.status).send({ error: { code: err.code } });
    return reply.code(500).send({ error: { code: 'internal_error' } });
  });
  authRoutes(app, services, platform);
  const signIn = (email = 'user@example.com') => app.inject({
    method: 'POST', url: '/api/auth/login', payload: { email, password: 'password' },
  }).then((res) => res);
  const change = () => app.inject({
    method: 'POST', url: '/api/auth/password', payload: { current: 'old', next: 'new-password' },
  }).then((res) => res);
  return { app, login, password, signIn, change };
}

describe('concurrent authentication rate limits', () => {
  let app: Awaited<ReturnType<typeof setup>>['app'] | undefined;
  afterEach(async () => { await app?.close(); app = undefined; vi.restoreAllMocks(); });

  it('reserves account slots, preserves other pending attempts on success, and records subsequent failures', async () => {
    const t = await setup(); app = t.app;
    const pending = Array.from({ length: 10 }, (_, i) => t.signIn(i % 2 ? ' USER@example.com ' : 'user@example.com'));
    await t.login.waitFor(10);
    expect((await t.signIn()).statusCode).toBe(429);
    t.login.calls[0]!.resolve();
    expect((await pending[0]!).statusCode).toBe(200);
    const replacement = t.signIn();
    await t.login.waitFor(11);
    expect((await t.signIn()).statusCode).toBe(429);
    for (const call of t.login.calls.slice(1)) call.reject(invalidCredentials());
    expect((await Promise.all([...pending.slice(1), replacement])).every((res) => res.statusCode === 401)).toBe(true);
    expect((await t.signIn()).statusCode).toBe(429);
  });

  it('limits concurrent attempts per IP across accounts and rolls back an account reservation when the IP is full', async () => {
    const t = await setup(); app = t.app;
    const pending = Array.from({ length: 50 }, (_, i) => t.signIn(`user${i}@example.com`));
    await t.login.waitFor(50);
    for (let i = 0; i < 11; i++) expect((await t.signIn('extra@example.com')).statusCode).toBe(429);
    t.login.calls[0]!.resolve();
    expect((await pending[0]!).statusCode).toBe(200);
    const extra = t.signIn('extra@example.com');
    await t.login.waitFor(51);
    t.login.calls[50]!.resolve();
    expect((await extra).statusCode).toBe(200);
    for (const call of t.login.calls.slice(1, 50)) call.reject(invalidCredentials());
    expect((await Promise.all(pending.slice(1))).every((res) => res.statusCode === 401)).toBe(true);
    const final = t.signIn('final@example.com');
    await t.login.waitFor(52);
    t.login.calls[51]!.reject(invalidCredentials());
    expect((await final).statusCode).toBe(401);
    expect((await t.signIn('other@example.com')).statusCode).toBe(429);
  });

  it('does not clear IP failures on successful login', async () => {
    const t = await setup(); app = t.app;
    const failures = Array.from({ length: 49 }, (_, i) => t.signIn(`user${i}@example.com`));
    await t.login.waitFor(49);
    for (const call of t.login.calls) call.reject(invalidCredentials());
    expect((await Promise.all(failures)).every((res) => res.statusCode === 401)).toBe(true);
    const success = t.signIn('success@example.com');
    await t.login.waitFor(50);
    t.login.calls[49]!.resolve();
    expect((await success).statusCode).toBe(200);
    const last = t.signIn('last@example.com');
    await t.login.waitFor(51);
    t.login.calls[50]!.reject(invalidCredentials());
    expect((await last).statusCode).toBe(401);
    expect((await t.signIn('other@example.com')).statusCode).toBe(429);
  });

  it('releases login reservations on unrelated errors and expires recorded failures', async () => {
    const t = await setup(); app = t.app;
    for (let i = 0; i < 51; i++) {
      const request = t.signIn(i < 11 ? 'same@example.com' : `error${i}@example.com`);
      await t.login.waitFor(i + 1);
      t.login.calls[i]!.reject(new Error('unavailable'));
      expect((await request).statusCode).toBe(500);
    }
    const now = Date.now();
    vi.spyOn(Date, 'now').mockReturnValue(now);
    const failures = Array.from({ length: 10 }, () => t.signIn());
    await t.login.waitFor(61);
    for (const call of t.login.calls.slice(51)) call.reject(invalidCredentials());
    expect((await Promise.all(failures)).every((res) => res.statusCode === 401)).toBe(true);
    expect((await t.signIn()).statusCode).toBe(429);
    vi.mocked(Date.now).mockReturnValue(now + 15 * 60_000);
    const retried = t.signIn();
    await t.login.waitFor(62);
    t.login.calls[61]!.resolve();
    expect((await retried).statusCode).toBe(200);
  });

  it('clears only completed account failures on login success, even after pending attempts age out', async () => {
    const t = await setup(); app = t.app;
    const now = Date.now();
    vi.spyOn(Date, 'now').mockReturnValue(now);
    const failed = t.signIn();
    await t.login.waitFor(1);
    t.login.calls[0]!.reject(invalidCredentials());
    expect((await failed).statusCode).toBe(401);
    const pending = Array.from({ length: 9 }, () => t.signIn());
    await t.login.waitFor(10);
    expect((await t.signIn()).statusCode).toBe(429);
    t.login.calls[1]!.resolve();
    expect((await pending[0]!).statusCode).toBe(200);
    vi.mocked(Date.now).mockReturnValue(now + 15 * 60_000);
    const added = [t.signIn(), t.signIn()];
    await t.login.waitFor(12);
    expect((await t.signIn()).statusCode).toBe(429);
    for (const call of t.login.calls.slice(2)) call.reject(invalidCredentials());
    expect((await Promise.all([...pending.slice(1), ...added])).every((res) => res.statusCode === 401)).toBe(true);
    expect((await t.signIn()).statusCode).toBe(429);
  });

  it('does not reset earlier password-change failures on success', async () => {
    const t = await setup(); app = t.app;
    const failed = t.change();
    await t.password.waitFor(1);
    t.password.calls[0]!.reject(invalidPassword());
    expect((await failed).statusCode).toBe(401);
    const succeeded = t.change();
    await t.password.waitFor(2);
    t.password.calls[1]!.resolve();
    expect((await succeeded).statusCode).toBe(200);
    const pending = Array.from({ length: 9 }, () => t.change());
    await t.password.waitFor(11);
    expect((await t.change()).statusCode).toBe(429);
    for (const call of t.password.calls.slice(2)) call.reject(invalidPassword());
    expect((await Promise.all(pending)).every((res) => res.statusCode === 401)).toBe(true);
    expect((await t.change()).statusCode).toBe(429);
  });

  it('reserves password-change slots, releases successes and other errors, and retains failures', async () => {
    const t = await setup(); app = t.app;
    const pending = Array.from({ length: 10 }, () => t.change());
    await t.password.waitFor(10);
    expect((await t.change()).statusCode).toBe(429);
    t.password.calls[0]!.resolve();
    expect((await pending[0]!).statusCode).toBe(200);
    const replacement = t.change();
    await t.password.waitFor(11);
    expect((await t.change()).statusCode).toBe(429);
    t.password.calls[1]!.reject(new Error('unavailable'));
    expect((await pending[1]!).statusCode).toBe(500);
    const retry = t.change();
    await t.password.waitFor(12);
    for (const call of t.password.calls.slice(2)) call.reject(invalidPassword());
    expect((await Promise.all([...pending.slice(2), replacement, retry])).every((res) => res.statusCode === 401)).toBe(true);
    expect((await t.change()).statusCode).toBe(429);
  });
});
