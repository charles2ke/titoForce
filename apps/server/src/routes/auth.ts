import type { MfaStatus } from '@titoforce/shared';
import type { FastifyInstance, FastifyReply } from 'fastify';
import type { Config } from '../config.ts';
import { invalidCode } from '../platform/mfa.ts';
import type { LoginResult } from '../platform/users.ts';
import { DEMO_PASSWORD, demoLogins } from '../seed/index.ts';
import type { Services } from '../services.ts';
import { AppError, badRequest, forbidden } from '../util.ts';
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

/** Sets the session cookie for a new session and returns the session payload of sign-in responses. */
export async function startSession(s: Services, reply: FastifyReply, token: string, issueToken?: boolean, extra: Record<string, unknown> = {}) {
  const session = await s.users.resolveSession(token);
  if (!session) throw new AppError(401, 'invalid_credentials', 'Invalid email or password');
  reply.setCookie(SESSION_COOKIE, token, sessionCookieOptions(s.config));
  // API clients may ask for the token to use as "Authorization: Bearer <token>".
  return { user: session.user, permissions: session.permissions, ...extra, ...(issueToken ? { token } : {}) };
}

const challengeExpired = () => new AppError(401, 'challenge_expired', 'Your sign-in attempt expired. Please sign in again.');

export function authRoutes(app: FastifyInstance, s: Services): void {
  // Failed attempts are limited per account and, more loosely, per client IP (offices share addresses).
  const accountFailures = new AttemptLimiter(10, 15 * 60_000);
  const ipFailures = new AttemptLimiter(50, 15 * 60_000);
  const passwordFailures = new AttemptLimiter(10, 15 * 60_000);
  // Wrong second-factor codes (and passwords confirming MFA changes), per account.
  const mfaFailures = new AttemptLimiter(5, 15 * 60_000);
  const tooMany = () => new AppError(429, 'rate_limited', 'Too many failed attempts. Please wait 15 minutes and try again.');

  /** Runs a check that verifies a password or code, counting failures against the account. */
  async function guarded<T>(userId: string, fn: () => Promise<T>): Promise<T> {
    if (!mfaFailures.reserve(userId)) throw tooMany();
    try {
      const result = await fn();
      mfaFailures.finish(userId, false);
      return result;
    } catch (err) {
      mfaFailures.finish(userId, err instanceof AppError && ['invalid_code', 'invalid_password', 'challenge_expired'].includes(err.code));
      throw err;
    }
  }

  app.get('/api/health', { config: { public: true } }, async () => ({ status: 'ok' }));

  // Public bootstrap info for the sign-in page. Demo logins are only exposed for demo databases.
  app.get('/api/config', { config: { public: true } }, async () => {
    const logins = await demoLogins(s);
    return { demo: logins.length > 0, demoLogins: logins, demoPassword: logins.length ? DEMO_PASSWORD : null, sso: await s.sso.publicList() };
  });

  app.post('/api/auth/login', { config: { public: true } }, async (req, reply) => {
    const body = parse(schemas.login, req.body);
    const accountKey = body.email.trim().toLowerCase();
    if (!accountFailures.reserve(accountKey)) throw tooMany();
    if (!ipFailures.reserve(req.ip)) {
      accountFailures.finish(accountKey, false);
      throw tooMany();
    }
    let result: LoginResult;
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
    // Two-factor users continue at /api/auth/mfa/verify with the challenge.
    if ('challenge' in result) return result;
    return startSession(s, reply, result.token, body.issueToken);
  });

  // ---------- two-factor authentication ----------

  // Second sign-in step: an authenticator or recovery code, or the first code of a newly added authenticator.
  app.post('/api/auth/mfa/verify', { config: { public: true } }, async (req, reply) => {
    const body = parse(schemas.mfaVerify, req.body);
    const ch = await s.users.findMfaChallenge(body.challenge);
    if (!ch) throw challengeExpired();
    const result = await guarded(ch.userId, () => s.users.completeMfaChallenge(ch, body.code));
    return startSession(s, reply, result.token, body.issueToken, result.recoveryCodes ? { recoveryCodes: result.recoveryCodes } : {});
  });

  // Users whose role requires two-factor authentication add an authenticator while signing in.
  app.post('/api/auth/mfa/enroll', { config: { public: true } }, async (req) => {
    const body = parse(schemas.mfaChallenge, req.body);
    return s.users.beginChallengeEnrollment(body.challenge);
  });

  app.get('/api/auth/mfa', { config: { rateLimit: { max: 60, timeWindow: '1 minute' } } }, async (req): Promise<MfaStatus> => {
    const a = auth(req);
    const state = await s.mfa.state(a.user.id);
    return { ...state, required: !!a.permissions.requireMfa, hasPassword: await s.users.hasPassword(a.user.id) };
  });

  app.post('/api/auth/mfa/setup', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (req) => {
    const a = auth(req);
    if (!(await s.users.hasPassword(a.user.id))) throw badRequest('You sign in with single sign-on, so your identity provider handles two-factor authentication');
    return s.mfa.beginEnrollment(a.user.id, a.user.email);
  });

  // Confirms the new authenticator; other sessions are signed out because they did not use the second factor.
  app.post('/api/auth/mfa/enable', async (req) => {
    const a = auth(req);
    const body = parse(schemas.mfaConfirm, req.body);
    const recoveryCodes = await guarded(a.user.id, async () => {
      await s.users.checkPassword(a.user.id, body.password);
      return s.mfa.completeEnrollment(a.user.id, body.code);
    });
    await s.users.revokeOtherSessions(a.user.id, a.token);
    return { recoveryCodes };
  });

  app.post('/api/auth/mfa/disable', async (req) => {
    const a = auth(req);
    const body = parse(schemas.mfaConfirm, req.body);
    if (a.permissions.requireMfa) throw forbidden('Your role requires two-factor authentication');
    if (!(await s.mfa.isEnabled(a.user.id))) throw badRequest('Two-factor authentication is not turned on');
    await guarded(a.user.id, async () => {
      await s.users.checkPassword(a.user.id, body.password);
      if (!(await s.mfa.verify(a.user.id, body.code))) throw invalidCode();
    });
    await s.mfa.disable(a.user.id);
    return { ok: true };
  });

  app.post('/api/auth/mfa/recovery-codes', async (req) => {
    const a = auth(req);
    const body = parse(schemas.mfaConfirm, req.body);
    const recoveryCodes = await guarded(a.user.id, async () => {
      await s.users.checkPassword(a.user.id, body.password);
      if (!(await s.mfa.verify(a.user.id, body.code))) throw invalidCode();
      return s.mfa.regenerateRecoveryCodes(a.user.id);
    });
    return { recoveryCodes };
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
