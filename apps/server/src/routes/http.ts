import type { RolePermissions, UserDTO } from '@titoforce/shared';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { z } from 'zod';
import type { Principal } from '../platform/principal.ts';
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
  }
  interface FastifyContextConfig {
    /** Route is reachable without a session. */
    public?: boolean;
    /** Signed provider callback (e.g. Twilio) that may post form-encoded bodies; implies `public`. */
    webhook?: boolean;
  }
}

export const SESSION_COOKIE = 'tf_session';

export function auth(req: FastifyRequest): AuthContext {
  if (!req.auth) throw new AppError(401, 'unauthenticated', 'Please sign in');
  return req.auth;
}

export const principalOf = (req: FastifyRequest): Principal => auth(req).principal;

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
