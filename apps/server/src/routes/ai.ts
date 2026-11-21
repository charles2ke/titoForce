import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Services } from '../services.ts';
import { AppError, RateLimiter } from '../util.ts';
import { auth, intParam, params, parse, parsePatch, principalOf, query } from './http.ts';
import * as schemas from './schemas.ts';

const actionsQuery = z.object({
  status: z.enum(['pending', 'executed', 'rejected', 'failed', 'any']).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
});

export function aiRoutes(app: FastifyInstance, s: Services): void {
  // Bounds LLM spend per user.
  const chats = new RateLimiter(30, 60_000);

  app.get('/api/ai/status', async (req) => {
    principalOf(req);
    return s.agents.status();
  });

  app.get('/api/ai/tools', async (req) => {
    principalOf(req);
    return s.agents.tools();
  });

  // ---------- agents ----------

  app.get('/api/agents', async (req) => {
    principalOf(req);
    return s.agents.list();
  });

  app.get('/api/agents/:id', async (req) => {
    principalOf(req);
    return s.agents.get(params(req).id!);
  });

  app.post('/api/agents', async (req, reply) => {
    const created = await s.agents.create(principalOf(req), parse(schemas.agent, req.body));
    reply.code(201);
    return created;
  });

  app.patch('/api/agents/:id', async (req) => s.agents.update(principalOf(req), params(req).id!, parsePatch(schemas.agent, req.body)));

  app.delete('/api/agents/:id', async (req) => {
    await s.agents.delete(principalOf(req), params(req).id!);
    return { ok: true };
  });

  // Starts an asynchronous run; poll GET /api/agent-runs/:runId until its status is no longer "running".
  app.post('/api/agents/:id/chat', async (req, reply) => {
    const a = auth(req);
    const body = parse(schemas.chat, req.body);
    if (!chats.hit(a.user.id)) throw new AppError(429, 'rate_limited', 'You are sending messages too quickly. Please wait a minute.');
    const started = await s.agents.startChat(a.principal, { agentId: params(req).id!, ...body });
    reply.code(202);
    return started;
  });

  // ---------- runs, actions awaiting approval, conversations ----------

  app.get('/api/agent-runs', async (req) => {
    const q = query(req);
    return s.agents.listRuns(principalOf(req), { agentId: q.agentId || undefined, recordId: q.recordId || undefined, limit: intParam(q.limit, 30, 1, 100) });
  });

  app.get('/api/agent-runs/:id', async (req) => s.agents.getRun(principalOf(req), params(req).id!));

  app.get('/api/agent-actions', async (req) => s.agents.listActions(principalOf(req), parse(actionsQuery, query(req))));

  app.post('/api/agent-actions/:id/approve', async (req) => s.agents.decideAction(principalOf(req), params(req).id!, 'approve'));

  app.post('/api/agent-actions/:id/reject', async (req) => s.agents.decideAction(principalOf(req), params(req).id!, 'reject'));

  app.get('/api/conversations', async (req) => s.agents.listConversations(principalOf(req), query(req).agentId || undefined));

  app.get('/api/conversations/:id', async (req) => s.agents.getConversation(principalOf(req), params(req).id!));

  app.delete('/api/conversations/:id', async (req) => {
    await s.agents.deleteConversation(principalOf(req), params(req).id!);
    return { ok: true };
  });
}
