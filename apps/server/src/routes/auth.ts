import type { FastifyInstance } from 'fastify';
import type { Config } from '../config.ts';
import { DEMO_PASSWORD, demoLogins } from '../seed/index.ts';
import type { Services } from '../services.ts';
import { AppError } from '../util.ts';
import { auth, parse, SESSION_COOKIE } from './http.ts';
import * as schemas from './schemas.ts';

export const SESSION_MAX_AGE_S = 7 * 24 * 3600;

class AttemptLimiter {
  private entries = new Map<string, { failures: number[]; pending: number }>();
  private limit: number;
  private windowMs: number;

  constructor(limit: number, windowMs: number) {
    this.limit = limit;
    this.windowMs = windowMs;
  }

  reserve(key: string): boolean {
    const now = Date.now();
    if (this.entries.size > 10_000) {
      for (const [k, entry] of this.entries) {
        entry.failures = entry.failures.filter((time) => now - time < this.windowMs);
        if (!entry.pending && !entry.failures.length) this.entries.delete(k);
      }
    }
    const entry = this.entries.get(key) ?? { failures: [], pending: 0 };
    entry.failures = entry.failures.filter((time) => now - time < this.windowMs);
    if (entry.failures.length + entry.pending >= this.limit) return false;
    entry.pending++;
    this.entries.set(key, entry);
    return true;
  }

  finish(key: string, failed: boolean, resetFailures = false): void {
    const entry = this.entries.get(key)!;
    entry.pending--;
    if (resetFailures) entry.failures = [];
    if (failed) entry.failures.push(Date.now());
    if (!entry.pending && !entry.failures.length) this.entries.delete(key);
  }
}

export function sessionCookieOptions(config: Config) {
  return { path: '/', httpOnly: true, sameSite: 'lax' as const, secure: config.secureCookies, maxAge: SESSION_MAX_AGE_S };
}

export function authRoutes(app: FastifyInstance, s: Services): void {
  // Failed attempts are limited per account and, more loosely, per client IP (offices share addresses).
  const accountFailures = new AttemptLimiter(10, 15 * 60_000);
  const ipFailures = new AttemptLimiter(50, 15 * 60_000);
  const passwordFailures = new AttemptLimiter(10, 15 * 60_000);
  const tooMany = () => new AppError(429, 'rate_limited', 'Too many failed attempts. Please wait 15 minutes and try again.');

  app.get('/api/health', { config: { public: true } }, async () => ({ status: 'ok' }));

  // Public bootstrap info for the sign-in page. Demo logins are only exposed for demo databases.
  app.get('/api/config', { config: { public: true } }, async () => {
    const logins = await demoLogins(s);
    return { demo: logins.length > 0, demoLogins: logins, demoPassword: logins.length ? DEMO_PASSWORD : null };
  });

  app.post('/api/auth/login', { config: { public: true } }, async (req, reply) => {
    const body = parse(schemas.login, req.body);
    const accountKey = body.email.trim().toLowerCase();
    if (!accountFailures.reserve(accountKey)) throw tooMany();
    if (!ipFailures.reserve(req.ip)) {
      accountFailures.finish(accountKey, false);
      throw tooMany();
    }
    let result: Awaited<ReturnType<typeof s.users.login>>;
    try {
      result = await s.users.login(body.email, body.password);
    } catch (err) {
      const failed = err instanceof AppError && err.code === 'invalid_credentials';
      accountFailures.finish(accountKey, failed);
      ipFailures.finish(req.ip, failed);
      throw err;
    }
    accountFailures.finish(accountKey, false, true);
    ipFailures.finish(req.ip, false);
    const session = await s.users.resolveSession(result.token);
    if (!session) throw new AppError(401, 'invalid_credentials', 'Invalid email or password');
    reply.setCookie(SESSION_COOKIE, result.token, sessionCookieOptions(s.config));
    // API clients may ask for the token to use as "Authorization: Bearer <token>".
    return { user: session.user, permissions: session.permissions, ...(body.issueToken ? { token: result.token } : {}) };
  });

  app.post('/api/auth/logout', { config: { public: true } }, async (req, reply) => {
    if (req.auth) await s.users.logout(req.auth.token);
    reply.clearCookie(SESSION_COOKIE, { path: '/' });
    return { ok: true };
  });

  app.get('/api/auth/session', async (req) => {
    const a = auth(req);
    return { user: a.user, permissions: a.permissions };
  });

  app.post('/api/auth/password', async (req) => {
    const a = auth(req);
    const body = parse(schemas.changePassword, req.body);
    const key = a.user.id;
    if (!passwordFailures.reserve(key)) throw tooMany();
    try {
      await s.users.changePassword(a.user.id, body.current, body.next, a.token);
    } catch (err) {
      passwordFailures.finish(key, err instanceof AppError && err.code === 'invalid_password');
      throw err;
    }
    passwordFailures.finish(key, false);
    return { ok: true };
  });
}
