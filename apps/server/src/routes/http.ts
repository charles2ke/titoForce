import type { LocaleCode, RolePermissions, UserDTO } from '@titoforce/shared';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { z } from 'zod';
import type { Principal } from '../platform/principal.ts';
import { isSupportedLocale } from '../platform/translations.ts';
import type { TenantContext } from '../tenancy/context.ts';
import type { Tenant } from '../tenancy/control.ts';
import { AppError, badRequest } from '../util.ts';

export interface AuthContext {
  user: UserDTO;
  permissions: RolePermissions;
  principal: Principal;
  token: string;
}

declare module 'fastify' {
  interface FastifyRequest {
    auth: AuthContext | null;
    /** Organization handling an API request (set before any route runs). */
    tenant: Tenant | null;
    tenantContext: TenantContext | null;
    /** How the organization was chosen: `x-tito-org` header or `?org=`, subdomain, session token, or the default. */
    tenantSource: 'explicit' | 'host' | 'token' | 'default' | null;
  }
  interface FastifyContextConfig {
    /** Route is reachable without a session. */
    public?: boolean;
  }
}

export const SESSION_COOKIE = 'tf_session';

/** Each organization has its own session cookie, so one browser can stay signed in to several (e.g. a sandbox). */
export const sessionCookieName = (tenantId: string): string => (tenantId === 'default' ? SESSION_COOKIE : `${SESSION_COOKIE}_${tenantId}`);

export function auth(req: FastifyRequest): AuthContext {
  if (!req.auth) throw new AppError(401, 'unauthenticated', 'Please sign in');
  return req.auth;
}

export function tenantOf(req: FastifyRequest): Tenant {
  if (!req.tenant) throw new Error('No organization resolved for this request');
  return req.tenant;
}

export const principalOf = (req: FastifyRequest): Principal => auth(req).principal;

/** Language of metadata labels in responses: the UI's (`x-tito-locale`), else the user's preference, else English. `?raw=1` asks for English (Setup). */
export function localeOf(req: FastifyRequest): LocaleCode {
  if ((req.query as Record<string, unknown> | undefined)?.raw === '1') return 'en';
  const header = req.headers['x-tito-locale'];
  const requested = Array.isArray(header) ? header[0] : header;
  if (isSupportedLocale(requested)) return requested;
  const preferred = req.auth?.user.locale;
  return isSupportedLocale(preferred) ? preferred : 'en';
}

export function parse<T>(schema: z.ZodType<T>, data: unknown): T {
  const result = schema.safeParse(data ?? {});
  if (result.success) return result.data;
  const issue = result.error.issues[0];
  const path = issue?.path.map(String).join('.');
  throw badRequest(`${path ? `${path}: ` : ''}${issue?.message ?? 'Invalid request'}`, { issues: result.error.issues.slice(0, 5) });
}

/** Validates a partial update; only keys present in the request are returned (schema defaults are not applied). */
export function parsePatch<S extends z.ZodObject>(schema: S, data: unknown): Partial<z.output<S>> {
  const parsed = parse(schema.partial(), data) as Record<string, unknown>;
  const provided = new Set(data && typeof data === 'object' ? Object.keys(data) : []);
  return Object.fromEntries(Object.entries(parsed).filter(([k]) => provided.has(k))) as Partial<z.output<S>>;
}

export const params = (req: FastifyRequest) => req.params as Record<string, string>;
export const query = (req: FastifyRequest) => req.query as Record<string, string | undefined>;

export function intParam(value: string | undefined, fallback: number, min: number, max: number): number {
  const n = Number.parseInt(value ?? '', 10);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
}

/** Sends a downloadable file with a safe filename. */
export function sendDownload(reply: FastifyReply, filename: string, type: string, body: string): FastifyReply {
  const safe = filename.replace(/[^a-zA-Z0-9._-]+/g, '_');
  return reply.header('content-type', type).header('content-disposition', `attachment; filename="${safe}"`).send(body);
}
