import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { DashboardInput, ReportInput } from '../analytics/reports.ts';
import { objectPermission, type Principal } from '../platform/principal.ts';
import type { Services } from '../services.ts';
import { forbidden } from '../util.ts';
import { intParam, params, parse, parsePatch, principalOf, query } from './http.ts';
import * as schemas from './schemas.ts';

export function analyticsRoutes(app: FastifyInstance, s: Services): void {
  // Reports and dashboards are shared org-wide, so changing them needs setup or automation rights.
  const analyst = (req: FastifyRequest): Principal => {
    const p = principalOf(req);
    if (p.permissions && !p.permissions.setup && !p.permissions.manageAutomations) throw forbidden('You cannot manage reports and dashboards');
    return p;
  };

  // ---------- reports ----------

  app.get('/api/reports', async (req) => {
    const p = principalOf(req);
    const reports = await s.analytics.listReports(query(req).app || undefined);
    return reports.filter((r) => s.metadata.get(r.object) && objectPermission(p, r.object).read !== 'none');
  });

  /** Runs a saved report with the caller's record access. */
  app.get('/api/reports/:id', async (req) => s.analytics.runReport(principalOf(req), params(req).id!, query(req).deferLabelLimit === '1'));

  /** Runs an unsaved report definition (report builder preview). */
  app.post('/api/reports/preview', async (req) => {
    const spec = parse(schemas.reportPreview, req.body);
    return s.analytics.aggregate(principalOf(req), spec.object, spec, query(req).deferLabelLimit === '1');
  });

  app.post('/api/reports', async (req, reply) => {
    const p = analyst(req);
    const created = await s.analytics.createReport(parse(schemas.report, req.body) as ReportInput, p.userId);
    reply.code(201);
    return created;
  });

  app.patch('/api/reports/:id', async (req) => {
    analyst(req);
    return s.analytics.updateReport(params(req).id!, parsePatch(schemas.report, req.body) as Partial<ReportInput>);
  });

  app.delete('/api/reports/:id', async (req) => {
    analyst(req);
    await s.analytics.deleteReport(params(req).id!);
    return { ok: true };
  });

  // ---------- dashboards ----------

  app.get('/api/dashboards', async (req) => {
    principalOf(req);
    return s.analytics.listDashboards();
  });

  /** Dashboard with every widget's report evaluated for the caller (widgets fail individually). */
  app.get('/api/dashboards/:id', async (req) => s.analytics.renderDashboard(principalOf(req), params(req).id!, query(req).deferLabelLimit === '1'));

  app.post('/api/dashboards', async (req, reply) => {
    const p = analyst(req);
    const created = await s.analytics.createDashboard(parse(schemas.dashboard, req.body) as DashboardInput, p.userId);
    reply.code(201);
    return created;
  });

  app.patch('/api/dashboards/:id', async (req) => {
    analyst(req);
    return s.analytics.updateDashboard(params(req).id!, parsePatch(schemas.dashboard, req.body) as Partial<DashboardInput>);
  });

  app.delete('/api/dashboards/:id', async (req) => {
    analyst(req);
    await s.analytics.deleteDashboard(params(req).id!);
    return { ok: true };
  });

  // ---------- module pages ----------

  app.get('/api/forecast', async (req) => {
    const q = query(req);
    return s.sales.forecast(principalOf(req), { groupBy: q.groupBy === 'owner' ? 'owner' : 'month', months: intParam(q.months, 6, 1, 24) });
  });

  app.get('/api/org-chart', async (req) => s.hr.orgChart(principalOf(req)));
}
