import { randomBytes } from 'node:crypto';
import type { SsoProviderList } from '@titoforce/shared';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { assertSetup } from '../platform/principal.ts';
import { SsoError } from '../platform/sso.ts';
import type { Services } from '../services.ts';
import { RateLimiter } from '../util.ts';
import { sessionCookieOptions } from './auth.ts';
import { params, parse, principalOf, query, SESSION_COOKIE } from './http.ts';
import * as schemas from './schemas.ts';

/** Ties a sign-in to the browser that started it. */
const FLOW_COOKIE = 'tf_sso';
const FLOW_COOKIE_PATH = '/api/auth/sso';

/** Public address of titoForce as seen by browsers and identity providers. */
export function publicBaseUrl(s: Services, req: FastifyRequest): string {
  return s.config.publicUrl ?? `${req.protocol}://${req.host}`;
}

/** Where to go after signing in: a path on this site only, so sign-in links cannot send users elsewhere. */
export function safeNext(raw: unknown): string {
  if (typeof raw !== 'string' || !raw.startsWith('/') || raw.length > 2000 || /[\u0000-\u001f\\]/.test(raw)) return '/';
  try {
    const url = new URL(raw, 'http://localhost');
    // Dot segments can normalize to "//host", which browsers read as another site.
    if (url.origin !== 'http://localhost' || url.pathname.startsWith('//') || url.pathname.startsWith('/api/')) return '/';
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return '/';
  }
}

export function ssoRoutes(app: FastifyInstance, s: Services): void {
  const starts = new RateLimiter(30, 60_000);

  function fail(req: FastifyRequest, reply: FastifyReply, err: unknown) {
    const reason = err instanceof SsoError ? err.reason : 'failed';
    req.log.warn({ provider: params(req).id, reason, err: err instanceof Error ? err.message : String(err) }, 'single sign-on failed');
    reply.clearCookie(FLOW_COOKIE, { path: FLOW_COOKIE_PATH });
    return reply.redirect(`/login?sso_error=${reason}`, 303);
  }

  async function signIn(reply: FastifyReply, result: { userId: string; next: string }) {
    reply.setCookie(SESSION_COOKIE, await s.users.createSession(result.userId), sessionCookieOptions(s.config));
    reply.clearCookie(FLOW_COOKIE, { path: FLOW_COOKIE_PATH });
    return reply.redirect(result.next, 303);
  }

  // The sign-in page links here; the browser is sent on to the identity provider.
  app.get('/api/auth/sso/:id/start', { config: { public: true } }, async (req, reply) => {
    try {
      if (!starts.hit(req.ip)) throw new SsoError('rate_limited');
      const cookie = randomBytes(32).toString('base64url');
      const url = await s.sso.start(params(req).id, publicBaseUrl(s, req), safeNext(query(req).next), cookie);
      reply.setCookie(FLOW_COOKIE, cookie, { path: FLOW_COOKIE_PATH, httpOnly: true, sameSite: 'lax', secure: s.config.secureCookies, maxAge: 600 });
      return reply.redirect(url, 302);
    } catch (err) {
      return fail(req, reply, err);
    }
  });

  // OpenID Connect redirect URI.
  app.get('/api/auth/sso/:id/callback', { config: { public: true } }, async (req, reply) => {
    try {
      return await signIn(reply, await s.sso.oidcCallback(params(req).id, query(req), req.cookies[FLOW_COOKIE]));
    } catch (err) {
      return fail(req, reply, err);
    }
  });

  // SAML assertion consumer service. Identity providers post a form from their own site, so this route takes form
  // bodies and skips the JSON-only CSRF check; the response is checked against the request this browser started.
  void app.register(async (scoped) => {
    scoped.addContentTypeParser('application/x-www-form-urlencoded', { parseAs: 'string', bodyLimit: 512 * 1024 }, (_req, body, done) => {
      const form = new URLSearchParams(String(body));
      done(null, { SAMLResponse: form.get('SAMLResponse') ?? '', RelayState: form.get('RelayState') ?? '' });
    });
    scoped.post('/api/auth/sso/:id/acs', { config: { public: true, formPost: true } }, async (req, reply) => {
      try {
        const body = (req.body && typeof req.body === 'object' ? req.body : {}) as Record<string, unknown>;
        const token = await s.sso.samlResponse(params(req).id, String(body.SAMLResponse ?? ''), String(body.RelayState ?? ''));
        // A top-level GET carries our SameSite=Lax cookie, so the sign-in finishes in the browser that started it.
        return reply.redirect(`/api/auth/sso/complete?token=${encodeURIComponent(token)}`, 303);
      } catch (err) {
        return fail(req, reply, err);
      }
    });
  });

  app.get('/api/auth/sso/complete', { config: { public: true } }, async (req, reply) => {
    try {
      return await signIn(reply, await s.sso.completeSaml(String(query(req).token ?? ''), req.cookies[FLOW_COOKIE]));
    } catch (err) {
      return fail(req, reply, err);
    }
  });

  app.get('/api/auth/sso/:id/metadata', { config: { public: true } }, async (req, reply) => {
    const xml = await s.sso.samlMetadata(params(req).id, publicBaseUrl(s, req));
    return reply.header('content-type', 'application/xml; charset=utf-8').send(xml);
  });

  // ---------- administration ----------

  app.get('/api/sso-providers', async (req): Promise<SsoProviderList> => {
    assertSetup(principalOf(req));
    const baseUrl = publicBaseUrl(s, req);
    return { providers: await s.sso.list(baseUrl), baseUrl };
  });

  app.post('/api/sso-providers', async (req, reply) => {
    assertSetup(principalOf(req));
    const body = parse(schemas.ssoProvider, req.body);
    reply.code(201);
    return s.sso.create(body.id, body, publicBaseUrl(s, req));
  });

  app.put('/api/sso-providers/:id', async (req) => {
    assertSetup(principalOf(req));
    const id = params(req).id;
    const body = parse(schemas.ssoProvider, { ...(req.body && typeof req.body === 'object' ? req.body : {}), id });
    return s.sso.update(id, body, publicBaseUrl(s, req));
  });

  app.delete('/api/sso-providers/:id', async (req) => {
    assertSetup(principalOf(req));
    await s.sso.remove(params(req).id);
    return { ok: true };
  });
}
