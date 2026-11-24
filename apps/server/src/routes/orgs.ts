import type { DeployResult, DeploymentRecord, SandboxInfo, SandboxList } from '@titoforce/shared';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { assertSetup } from '../platform/principal.ts';
import type { Services } from '../services.ts';
import type { Tenant } from '../tenancy/control.ts';
import { applyDeployment, compareConfiguration, planDeployment } from '../tenancy/deploy.ts';
import { MAX_SANDBOXES, type Platform } from '../tenancy/platform.ts';
import { AppError, badRequest, newId, notFound, nowIso } from '../util.ts';
import { auth, params, parse, principalOf, tenantOf } from './http.ts';
import * as schemas from './schemas.ts';

/** Sandboxes: copies of the production organization for building and testing changes, then deploying them (Setup → Sandboxes). */
export function orgRoutes(app: FastifyInstance, s: Services, platform: Platform): void {
  /** Sandboxes are managed by the administrators of their production organization. */
  function production(req: FastifyRequest): Tenant {
    assertSetup(principalOf(req));
    const tenant = tenantOf(req);
    if (!platform.multiTenant) throw badRequest('Sandboxes are not available on this server');
    if (tenant.kind !== 'production') throw badRequest('Sandboxes are managed from the production organization');
    return tenant;
  }

  async function sandboxOf(req: FastifyRequest): Promise<Tenant> {
    const parent = production(req);
    const sandbox = await platform.tenantById(params(req).id!);
    if (!sandbox || sandbox.parentId !== parent.id) throw notFound('Sandbox not found');
    return sandbox;
  }

  /** Creators are users of the production organization, so their names come from its database. */
  async function describe(sandboxes: Tenant[]): Promise<SandboxInfo[]> {
    const names = new Map<string, string>();
    for (const id of new Set(sandboxes.map((t) => t.createdBy).filter((x): x is string => !!x))) {
      const user = await s.users.getUser(id);
      if (user) names.set(id, user.name);
    }
    return sandboxes.map((t) => platform.sandboxInfo(t, t.createdBy ? (names.get(t.createdBy) ?? null) : null));
  }

  app.get('/api/sandboxes', async (req): Promise<SandboxList> => {
    assertSetup(principalOf(req));
    const tenant = tenantOf(req);
    if (!platform.multiTenant || tenant.kind !== 'production') return { enabled: false, sandboxes: [], max: MAX_SANDBOXES };
    return { enabled: true, sandboxes: await describe(await platform.sandboxesOf(tenant)), max: MAX_SANDBOXES };
  });

  app.get('/api/sandboxes/:id', async (req) => (await describe([await sandboxOf(req)]))[0]);

  // Copying runs in the background: poll the sandbox until its status is "active".
  app.post('/api/sandboxes', async (req, reply) => {
    const parent = production(req);
    const body = parse(schemas.createSandbox, req.body);
    const sandbox = await platform.createSandbox(parent, body, auth(req).user.id);
    reply.code(202);
    return (await describe([sandbox]))[0];
  });

  app.post('/api/sandboxes/:id/refresh', async (req, reply) => {
    const sandbox = await platform.refreshSandbox(await sandboxOf(req));
    reply.code(202);
    return (await describe([sandbox]))[0];
  });

  app.delete('/api/sandboxes/:id', async (req) => {
    await platform.deleteOrganization(await sandboxOf(req));
    return { ok: true };
  });

  /** How the sandbox's configuration differs from production's. */
  app.get('/api/sandboxes/:id/compare', async (req) => {
    const sandbox = await sandboxOf(req);
    platform.assertAvailable(sandbox);
    return compareConfiguration(await platform.servicesFor(sandbox), s);
  });

  /** Copies the selected components from the sandbox into production, all or nothing. */
  app.post('/api/sandboxes/:id/deploy', async (req, reply): Promise<DeployResult> => {
    const sandbox = await sandboxOf(req);
    platform.assertAvailable(sandbox);
    const body = parse(schemas.deploy, req.body);
    const source = await platform.servicesFor(sandbox);
    const plan = await planDeployment(source, body.components);
    const user = auth(req).user;
    const base = { id: newId('dpl'), sourceId: sandbox.id, sourceName: sandbox.name, targetId: tenantOf(req).id, deployedBy: user.name, createdAt: nowIso() };
    let deployment: DeploymentRecord;
    try {
      deployment = { ...base, components: await applyDeployment(s, plan, user.id), status: 'succeeded', error: null };
    } catch (err) {
      if (!(err instanceof AppError && err.code === 'nothing_to_deploy')) {
        const error = (err instanceof Error ? err.message : String(err)).slice(0, 1000);
        await platform.recordDeployment({ ...base, components: plan.components, status: 'failed', error }).catch(() => {});
      }
      throw err;
    }
    await platform.recordDeployment(deployment);
    reply.code(201);
    return { deployment, components: await compareConfiguration(source, s) };
  });

  app.get('/api/deployments', async (req) => {
    assertSetup(principalOf(req));
    const tenant = tenantOf(req);
    if (!platform.multiTenant || tenant.kind !== 'production') return [];
    return platform.deploymentsTo(tenant);
  });
}
