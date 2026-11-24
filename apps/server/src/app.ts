import { existsSync } from 'node:fs';
import { join, sep } from 'node:path';
import cookie from '@fastify/cookie';
import fastifyStatic from '@fastify/static';
import websocket from '@fastify/websocket';
import Fastify, { type FastifyError, type FastifyInstance, type FastifyRequest, type FastifyServerOptions, LogController } from 'fastify';
import { tokenTenant } from './platform/users.ts';
import { aiRoutes } from './routes/ai.ts';
import { analyticsRoutes } from './routes/analytics.ts';
import { authRoutes } from './routes/auth.ts';
import { automationRoutes } from './routes/automation.ts';
import { sessionCookieName } from './routes/http.ts';
import { orgRoutes } from './routes/orgs.ts';
import { layoutRoutes } from './routes/layouts.ts';
import { platformRoutes } from './routes/platform.ts';
import { publicRoutes } from './routes/public.ts';
import { realtimeRoutes } from './routes/realtime.ts';
import { translationRoutes } from './routes/translations.ts';
import { recordRoutes } from './routes/records.ts';
import type { Services } from './services.ts';
import { runInTenant, type TenantContext } from './tenancy/context.ts';
import type { Tenant } from './tenancy/control.ts';
import { Platform } from './tenancy/platform.ts';
import { AppError } from './util.ts';

/** Content security policy of the web app; WebSocket URLs of the page's own host are allowed for realtime updates. */
function csp(host: string): string {
  const safeHost = /^[a-z0-9.:[\]-]+$/i.test(host) ? host : '';
  return [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "font-src 'self' data:",
    `connect-src 'self'${safeHost ? ` ws://${safeHost} wss://${safeHost}` : ''}`,
    "manifest-src 'self'",
    "worker-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join('; ');
}

const isJson = (contentType: string | undefined) => contentType?.split(';')[0]?.trim().toLowerCase() === 'application/json';
const BODY_METHODS = new Set(['POST', 'PUT', 'PATCH']);

export interface AppOptions {
  logger?: FastifyServerOptions['logger'];
  /** Serve the built web app; defaults to whether its index.html exists. */
  serveWeb?: boolean;
}

/**
 * Builds the HTTP API and web server. Pass a `Platform` to serve every organization, or a single organization's
 * `Services` (tests, embedding), which disables organizations and sandboxes.
 */
export async function buildApp(target: Platform | Services, opts: AppOptions = {}): Promise<FastifyInstance> {
  const platform = target instanceof Platform ? target : Platform.single(target);
  // Forwards to the services of the organization handling the current request.
  const s = platform.services;
  const config = platform.config;
  const app = Fastify({
    logger: opts.logger ?? false,
    trustProxy: config.trustProxy,
    bodyLimit: 1024 * 1024,
    // Per-request log lines only at debug/trace levels.
    logController: new LogController({ disableRequestLogging: !['debug', 'trace'].includes(config.logLevel) }),
  });
  await app.register(cookie);
  await app.register(websocket, { options: { maxPayload: 16 * 1024 } });
  app.decorateRequest('auth', null);
  app.decorateRequest('tenant', null);
  app.decorateRequest('tenantContext', null);
  app.decorateRequest('tenantSource', null);

  // JSON bodies: empty bodies are treated as {} and "__proto__" keys are dropped (prototype poisoning guard).
  app.removeContentTypeParser('application/json');
  app.addContentTypeParser('application/json', { parseAs: 'string' }, (_req, body, done) => {
    const text = String(body).trim();
    if (!text) return done(null, {});
    try {
      done(null, JSON.parse(text, (key, value: unknown) => (key === '__proto__' ? undefined : value)));
    } catch {
      done(new AppError(400, 'invalid_json', 'The request body is not valid JSON'), undefined);
    }
  });

  const corsOrigins = new Set(config.corsOrigins);
  app.addHook('onRequest', async (req, reply) => {
    if (!req.url.startsWith('/api/')) return;
    // The mobile app (TITO_CORS_ORIGINS) calls the API cross-origin with bearer tokens; cookies are never allowed cross-origin.
    const origin = req.headers.origin;
    if (origin && corsOrigins.has(origin)) {
      reply.header('access-control-allow-origin', origin);
      reply.header('vary', 'origin');
      if (req.method === 'OPTIONS') {
        reply.header('access-control-allow-methods', 'GET, POST, PUT, PATCH, DELETE');
        reply.header('access-control-allow-headers', 'authorization, content-type, x-tito-locale, x-tito-org');
        reply.header('access-control-max-age', '600');
        reply.code(204).send();
        return reply;
      }
    }
    // CSRF defence: browsers cannot send a cross-origin JSON request without a CORS preflight, which only TITO_CORS_ORIGINS pass.
    if (BODY_METHODS.has(req.method) && !isJson(req.headers['content-type'])) {
      throw new AppError(415, 'unsupported_media_type', 'Send requests with "Content-Type: application/json"');
    }
  });

  const bearerToken = (req: FastifyRequest): string | undefined => {
    const header = req.headers.authorization;
    return header?.toLowerCase().startsWith('bearer ') ? header.slice(7).trim() || undefined : undefined;
  };

  /** Organization addressed by the subdomain, when TITO_BASE_DOMAIN is set (`acme.crm.example.com` → "acme"). */
  const hostOrg = (req: FastifyRequest): string | null => {
    const base = config.baseDomain;
    const host = req.hostname.toLowerCase();
    if (!base || !host.endsWith(`.${base}`)) return null;
    const sub = host.slice(0, -(base.length + 1));
    return sub && !sub.includes('.') && sub !== 'www' ? sub : null;
  };

  async function resolveTenant(req: FastifyRequest): Promise<TenantContext> {
    const header = req.headers['x-tito-org'];
    const param = (req.query as Record<string, unknown> | undefined)?.org;
    const explicit = ((typeof header === 'string' && header) || (typeof param === 'string' && param) || '').trim().toLowerCase() || null;
    const host = hostOrg(req);
    if (explicit && host && explicit !== host) throw new AppError(400, 'organization_mismatch', 'This address belongs to another organization');
    const bearer = bearerToken(req);
    let tenant: Tenant | null = null;
    let source: FastifyRequest['tenantSource'] = 'default';
    if (explicit || host) {
      tenant = await platform.tenantBySlug((explicit ?? host)!);
      if (!tenant) throw new AppError(404, 'organization_not_found', `There is no organization "${explicit ?? host}"`);
      source = explicit ? 'explicit' : 'host';
    } else if (bearer) {
      tenant = await platform.tenantById(tokenTenant(bearer));
      source = 'token';
    }
    if (!tenant) {
      tenant = platform.defaultTenant();
      source = 'default';
    }
    req.tenant = tenant;
    req.tenantSource = source;
    platform.assertAvailable(tenant);
    const services = await platform.servicesFor(tenant);
    const token = bearer ?? req.cookies[sessionCookieName(tenant.id)];
    if (token && tokenTenant(token) === tenant.id) {
      const session = await services.users.resolveSession(token);
      if (session) req.auth = { user: session.user, permissions: session.permissions, principal: session.principal, token };
    }
    if (!req.auth && !req.routeOptions.config?.public) throw new AppError(401, 'unauthenticated', 'Please sign in');
    return { tenant, services };
  }

  // Every API request runs inside its organization's context (see tenancy/context.ts), so `s` reaches the right services.
  app.addHook('onRequest', (req, _reply, done) => {
    if (!req.url.startsWith('/api/') || req.routeOptions.url === '/api/health') return done();
    resolveTenant(req).then(
      (ctx) => {
        req.tenantContext = ctx;
        runInTenant(ctx, () => done());
      },
      (err: FastifyError) => done(err),
    );
  });
  // Request bodies are read outside that context, so re-enter it before validation and the handler.
  app.addHook('preValidation', (req, _reply, done) => {
    if (req.tenantContext) runInTenant(req.tenantContext, () => done());
    else done();
  });

  app.addHook('onSend', async (req, reply, payload) => {
    reply.header('x-content-type-options', 'nosniff');
    reply.header('referrer-policy', 'same-origin');
    reply.header('x-frame-options', 'DENY');
    if (req.url.startsWith('/api/')) reply.header('cache-control', 'no-store');
    else reply.header('content-security-policy', csp(req.host));
    return payload;
  });

  app.setErrorHandler((err: FastifyError | AppError, req, reply) => {
    if (err instanceof AppError) {
      if (err.status >= 500) req.log.error(err);
      return reply.code(err.status).send({ error: { code: err.code, message: err.message, ...(err.details === undefined ? {} : { details: err.details }) } });
    }
    const status = typeof err.statusCode === 'number' ? err.statusCode : 500;
    if (status >= 400 && status < 500) {
      const code = status === 413 ? 'payload_too_large' : status === 415 ? 'unsupported_media_type' : status === 404 ? 'not_found' : 'bad_request';
      return reply.code(status).send({ error: { code, message: err.message } });
    }
    req.log.error(err);
    return reply.code(500).send({ error: { code: 'internal_error', message: 'Something went wrong on our side. Please try again.' } });
  });

  const serveWeb = opts.serveWeb ?? existsSync(join(config.webDist, 'index.html'));
  if (serveWeb) {
    await app.register(fastifyStatic, {
      root: config.webDist,
      cacheControl: false,
      setHeaders(reply, path) {
        // Vite fingerprints everything under /assets; index.html and the service worker must always be revalidated.
        reply.header('cache-control', path.includes(`${sep}assets${sep}`) ? 'public, max-age=31536000, immutable' : 'no-cache');
      },
    });
  }

  app.setNotFoundHandler(async (req, reply) => {
    const path = req.url.split('?')[0]!;
    const lastSegment = path.slice(path.lastIndexOf('/') + 1);
    // Client-side routes of the single-page app fall back to index.html; missing files and API paths are 404s.
    if (serveWeb && req.method === 'GET' && !path.startsWith('/api/') && !lastSegment.includes('.')) {
      return reply.sendFile('index.html');
    }
    return reply.code(404).send({ error: { code: 'not_found', message: 'Not found' } });
  });

  authRoutes(app, s, platform);
  orgRoutes(app, s, platform);
  realtimeRoutes(app, platform);
  platformRoutes(app, s);
  layoutRoutes(app, s);
  translationRoutes(app, s);
  recordRoutes(app, s);
  automationRoutes(app, s);
  aiRoutes(app, s);
  analyticsRoutes(app, s);
  publicRoutes(app, s);
  return app;
}
