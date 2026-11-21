import { existsSync } from 'node:fs';
import { join, sep } from 'node:path';
import cookie from '@fastify/cookie';
import fastifyStatic from '@fastify/static';
import Fastify, { type FastifyError, type FastifyInstance, type FastifyServerOptions, LogController } from 'fastify';
import { aiRoutes } from './routes/ai.ts';
import { analyticsRoutes } from './routes/analytics.ts';
import { authRoutes } from './routes/auth.ts';
import { automationRoutes } from './routes/automation.ts';
import { SESSION_COOKIE } from './routes/http.ts';
import { platformRoutes } from './routes/platform.ts';
import { publicRoutes } from './routes/public.ts';
import { recordRoutes } from './routes/records.ts';
import type { Services } from './services.ts';
import { AppError } from './util.ts';

const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ');

const isJson = (contentType: string | undefined) => contentType?.split(';')[0]?.trim().toLowerCase() === 'application/json';
const BODY_METHODS = new Set(['POST', 'PUT', 'PATCH']);

export interface AppOptions {
  logger?: FastifyServerOptions['logger'];
  /** Serve the built web app; defaults to whether its index.html exists. */
  serveWeb?: boolean;
}

export async function buildApp(s: Services, opts: AppOptions = {}): Promise<FastifyInstance> {
  const app = Fastify({
    logger: opts.logger ?? false,
    trustProxy: s.config.trustProxy,
    bodyLimit: 1024 * 1024,
    // Per-request log lines only at debug/trace levels.
    logController: new LogController({ disableRequestLogging: !['debug', 'trace'].includes(s.config.logLevel) }),
  });
  await app.register(cookie);
  app.decorateRequest('auth', null);

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

  app.addHook('onRequest', async (req) => {
    if (!req.url.startsWith('/api/')) return;
    // CSRF defence: browsers cannot send a cross-origin JSON request without a CORS preflight, which we never allow.
    if (BODY_METHODS.has(req.method) && !isJson(req.headers['content-type'])) {
      throw new AppError(415, 'unsupported_media_type', 'Send requests with "Content-Type: application/json"');
    }
    const header = req.headers.authorization;
    const token = header?.toLowerCase().startsWith('bearer ') ? header.slice(7).trim() : req.cookies[SESSION_COOKIE];
    if (token) {
      const session = await s.users.resolveSession(token);
      if (session) req.auth = { user: session.user, permissions: session.permissions, principal: session.principal, token };
    }
    if (!req.auth && !req.routeOptions.config?.public) throw new AppError(401, 'unauthenticated', 'Please sign in');
  });

  app.addHook('onSend', async (req, reply, payload) => {
    reply.header('x-content-type-options', 'nosniff');
    reply.header('referrer-policy', 'same-origin');
    reply.header('x-frame-options', 'DENY');
    if (req.url.startsWith('/api/')) reply.header('cache-control', 'no-store');
    else reply.header('content-security-policy', CSP);
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

  const serveWeb = opts.serveWeb ?? existsSync(join(s.config.webDist, 'index.html'));
  if (serveWeb) {
    await app.register(fastifyStatic, {
      root: s.config.webDist,
      cacheControl: false,
      setHeaders(reply, path) {
        // Vite fingerprints everything under /assets; index.html must always be revalidated.
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

  authRoutes(app, s);
  platformRoutes(app, s);
  recordRoutes(app, s);
  automationRoutes(app, s);
  aiRoutes(app, s);
  analyticsRoutes(app, s);
  publicRoutes(app, s);
  return app;
}
