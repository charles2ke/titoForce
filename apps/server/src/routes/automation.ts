import type { ApprovalProcessDef, AutomationDef } from '@titoforce/shared';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { ApprovalProcessInput } from '../automation/approvals.ts';
import type { AutomationInput } from '../automation/engine.ts';
import { assertManageAutomations, type Principal } from '../platform/principal.ts';
import type { Services } from '../services.ts';
import { intParam, params, parse, parsePatch, principalOf, query } from './http.ts';
import * as schemas from './schemas.ts';

const approvalsQuery = z.object({
  scope: z.enum(['to_me', 'mine', 'all']).optional(),
  status: z.enum(['pending', 'approved', 'rejected', 'recalled', 'any']).optional(),
  recordId: z.string().min(1).max(64).optional(),
});

export function automationRoutes(app: FastifyInstance, s: Services): void {
  const manager = (req: FastifyRequest): Principal => {
    const p = principalOf(req);
    assertManageAutomations(p);
    return p;
  };

  // ---------- record-triggered automations ----------

  app.get('/api/automations', async (req) => {
    manager(req);
    return s.automations.list(query(req).object || undefined);
  });

  app.get('/api/automations/:id', async (req) => {
    manager(req);
    return s.automations.get(params(req).id!);
  });

  app.post('/api/automations', async (req, reply) => {
    const p = manager(req);
    const created = await s.automations.create(parse(schemas.automation, req.body) as AutomationInput, p.userId);
    reply.code(201);
    return created;
  });

  app.patch('/api/automations/:id', async (req) => {
    manager(req);
    return s.automations.update(params(req).id!, parsePatch(schemas.automation, req.body) as Partial<AutomationDef>);
  });

  app.delete('/api/automations/:id', async (req) => {
    manager(req);
    await s.automations.delete(params(req).id!);
    return { ok: true };
  });

  app.get('/api/automation-runs', async (req) => {
    manager(req);
    const q = query(req);
    return s.automations.runs({ automationId: q.automationId || undefined, recordId: q.recordId || undefined, limit: intParam(q.limit, 50, 1, 200) });
  });

  // ---------- approval processes ----------

  // Readable by everyone so record pages can offer "Submit for approval".
  app.get('/api/approval-processes', async (req) => {
    principalOf(req);
    return s.approvals.listProcesses(query(req).object || undefined);
  });

  app.get('/api/approval-processes/:id', async (req) => {
    principalOf(req);
    return s.approvals.getProcess(params(req).id!);
  });

  app.post('/api/approval-processes', async (req, reply) => {
    manager(req);
    const created = await s.approvals.createProcess(parse(schemas.approvalProcess, req.body) as ApprovalProcessInput);
    reply.code(201);
    return created;
  });

  app.patch('/api/approval-processes/:id', async (req) => {
    manager(req);
    return s.approvals.updateProcess(params(req).id!, parsePatch(schemas.approvalProcess, req.body) as Partial<ApprovalProcessDef>);
  });

  app.delete('/api/approval-processes/:id', async (req) => {
    manager(req);
    await s.approvals.deleteProcess(params(req).id!);
    return { ok: true };
  });

  // ---------- approval requests ----------

  app.get('/api/approvals', async (req) => s.approvals.listRequests(principalOf(req), parse(approvalsQuery, query(req))));

  app.post('/api/approvals/submit', async (req, reply) => {
    const body = parse(schemas.submitApproval, req.body);
    const request = await s.approvals.submit(principalOf(req), body.recordId, { processId: body.processId, comment: body.comment });
    reply.code(201);
    return request;
  });

  app.post('/api/approvals/:id/approve', async (req) => s.approvals.decide(principalOf(req), params(req).id!, 'approve', parse(schemas.decision, req.body).comment));

  app.post('/api/approvals/:id/reject', async (req) => s.approvals.decide(principalOf(req), params(req).id!, 'reject', parse(schemas.decision, req.body).comment));

  app.post('/api/approvals/:id/recall', async (req) => s.approvals.recall(principalOf(req), params(req).id!));
}
