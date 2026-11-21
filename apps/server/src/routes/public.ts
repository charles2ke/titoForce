import type { FastifyInstance } from 'fastify';
import type { Services } from '../services.ts';
import { params } from './http.ts';

/** Hosted web-to-lead / web-to-case forms (no session required; submissions are rate limited per IP). */
export function publicRoutes(app: FastifyInstance, s: Services): void {
  app.get('/api/public/forms/:id', { config: { public: true } }, async (req) => s.forms.describe(params(req).id!));

  app.post('/api/public/forms/:id/submit', { config: { public: true }, bodyLimit: 64 * 1024 }, async (req) => {
    const body = req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? (req.body as Record<string, unknown>) : {};
    return s.forms.submit(params(req).id!, body, req.ip);
  });
}
