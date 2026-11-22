import type { PublicConfig, SessionInfo } from '@titoforce/shared';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { Config } from '../config.ts';
import { DEMO_PASSWORD, demoLogins } from '../seed/index.ts';
import type { Services } from '../services.ts';
import type { Tenant } from '../tenancy/control.ts';
import type { Platform } from '../tenancy/platform.ts';
import { AppError } from '../util.ts';
import { auth, parse, sessionCookieName, tenantOf } from './http.ts';
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

export function authRoutes(app: FastifyInstance, s: Services, platform: Platform): void {
  const config = platform.config;
  // Failed attempts are limited per account and, more loosely, per client IP (offices share addresses).
  const accountFailures = new AttemptLimiter(10, 15 * 60_000);
  const ipFailures = new AttemptLimiter(50, 15 * 60_000);
  const passwordFailures = new AttemptLimiter(10, 15 * 60_000);
  // Every sign-up attempt counts: each one creates a database.
  const signups = new AttemptLimiter(10, 60 * 60_000);
  const tooMany = () => new AppError(429, 'rate_limited', 'Too many failed attempts. Please wait 15 minutes and try again.');

  /** The organization a sign-in is for: the one the request is addressed to, or the one typed on the sign-in page. */
  async function loginTenant(req: FastifyRequest, slug: string | undefined): Promise<Tenant> {
    const current = tenantOf(req);
    const wanted = slug?.trim().toLowerCase();
    if (!wanted || wanted === current.slug) return current;
    if (req.tenantSource === 'explicit' || req.tenantSource === 'host') {
      throw new AppError(400, 'organization_mismatch', 'This address belongs to another organization');
    }
    const tenant = await platform.tenantBySlug(wanted);
    if (!tenant) throw new AppError(404, 'organization_not_found', `There is no organization "${wanted}"`);
    platform.assertAvailable(tenant);
    return tenant;
  }

  app.get('/api/health', { config: { public: true } }, async () => ({ status: 'ok' }));

  // Public bootstrap info for the sign-in page. Demo logins are only exposed for demo databases.
  app.get('/api/config', { config: { public: true } }, async (req): Promise<PublicConfig> => {
    const logins = await demoLogins(s);
    const org = platform.info(tenantOf(req));
    const tenants = platform.multiTenant ? await platform.listTenants() : [];
    const signup = platform.multiTenant && config.allowSignup;
    return {
      demo: logins.length > 0,
      demoLogins: logins,
      demoPassword: logins.length ? DEMO_PASSWORD : null,
      organization: { slug: org.slug, name: org.name, kind: org.kind, parentName: org.parentName },
      multiOrg: signup || tenants.length > 1,
      baseDomain: config.baseDomain,
      signup,
    };
  });

  app.post('/api/auth/login', { config: { public: true } }, async (req, reply) => {
    const body = parse(schemas.login, req.body);
    const tenant = await loginTenant(req, body.organization);
    const services = await platform.servicesFor(tenant);
    const accountKey = `${tenant.id}:${body.email.trim().toLowerCase()}`;
    if (!accountFailures.reserve(accountKey)) throw tooMany();
    if (!ipFailures.reserve(req.ip)) {
      accountFailures.finish(accountKey, false);
      throw tooMany();
    }
    let result: Awaited<ReturnType<Services['users']['login']>>;
    try {
      result = await services.users.login(body.email, body.password);
    } catch (err) {
      const failed = err instanceof AppError && err.code === 'invalid_credentials';
      accountFailures.finish(accountKey, failed);
      ipFailures.finish(req.ip, failed);
      throw err;
    }
    accountFailures.finish(accountKey, false, true);
    ipFailures.finish(req.ip, false);
    const session = await services.users.resolveSession(result.token);
    if (!session) throw new AppError(401, 'invalid_credentials', 'Invalid email or password');
    reply.setCookie(sessionCookieName(tenant.id), result.token, sessionCookieOptions(config));
    // API clients may ask for the token to use as "Authorization: Bearer <token>".
    const info: SessionInfo = { user: session.user, permissions: session.permissions, organization: platform.info(tenant) };
    return { ...info, ...(body.issueToken ? { token: result.token } : {}) };
  });

  // Creates a new organization with its own database; the person signing up becomes its administrator.
  app.post('/api/signup', { config: { public: true } }, async (req, reply) => {
    if (!platform.multiTenant || !config.allowSignup) throw new AppError(404, 'not_found', 'Sign-up is not enabled on this server');
    const body = parse(schemas.signup, req.body);
    if (!signups.reserve(req.ip)) throw new AppError(429, 'rate_limited', 'Too many sign-ups from your network. Please try again later.');
    let created: Awaited<ReturnType<Platform['createOrganization']>>;
    try {
      created = await platform.createOrganization(
        {
          slug: body.organization,
          name: body.organizationName,
          admin: { email: body.email, password: body.password, name: body.name },
          demo: !!body.demo,
          sampleLogins: false,
        },
        (msg) => req.log.info(msg),
      );
    } finally {
      signups.finish(req.ip, true);
    }
    const { tenant, services } = created;
    const result = await services.users.login(body.email, body.password);
    const session = (await services.users.resolveSession(result.token))!;
    reply.setCookie(sessionCookieName(tenant.id), result.token, sessionCookieOptions(config));
    reply.code(201);
    const info: SessionInfo = { user: session.user, permissions: session.permissions, organization: platform.info(tenant) };
    return { ...info, ...(body.issueToken ? { token: result.token } : {}) };
  });

  app.post('/api/auth/logout', { config: { public: true } }, async (req, reply) => {
    if (req.auth) await s.users.logout(req.auth.token);
    reply.clearCookie(sessionCookieName(tenantOf(req).id), { path: '/' });
    return { ok: true };
  });

  app.get('/api/auth/session', async (req): Promise<SessionInfo> => {
    const a = auth(req);
    return { user: a.user, permissions: a.permissions, organization: platform.info(tenantOf(req)) };
  });

  app.post('/api/auth/password', async (req) => {
    const a = auth(req);
    const body = parse(schemas.changePassword, req.body);
    const key = `${tenantOf(req).id}:${a.user.id}`;
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

  // The signed-in user's language (null: follow the browser).
  app.put('/api/auth/locale', async (req) => {
    const a = auth(req);
    const body = parse(schemas.userLocale, req.body);
    await s.users.setLocale(a.user.id, body.locale);
    return { locale: body.locale };
  });
}
