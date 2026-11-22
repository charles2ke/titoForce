import type { DeployComponent, DeploymentRecord, ObjectDef, PageLayoutDef, RoleDef } from '@titoforce/shared';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../src/app.ts';
import { parseJson } from '../src/db/database.ts';
import type { Services } from '../src/services.ts';
import { Platform } from '../src/tenancy/platform.ts';
import { createTestPlatform } from './helpers.ts';

let platform: Platform;
let app: FastifyInstance;
let production: Services;
let sandboxId: string;
const sessions: Record<string, Record<string, string>> = {};

type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
/** Calls the API as one of the signed-in users: "admin"/"maria" in production, "sandbox" for the sandbox's administrator. */
const call = (who: string, method: Method, url: string, payload?: unknown): Promise<LightMyRequestResponse> =>
  app.inject({
    method,
    url,
    headers: { ...sessions[who], ...(method === 'GET' ? {} : { 'content-type': 'application/json' }) },
    payload: method === 'GET' ? undefined : JSON.stringify(payload ?? {}),
  });

async function signIn(who: string, email: string, org?: string): Promise<void> {
  const res = await app.inject({ method: 'POST', url: '/api/auth/login', headers: org ? { 'x-tito-org': org } : {}, payload: { email, password: 'titoforce' } });
  expect(res.statusCode, res.body).toBe(200);
  const cookie = res.cookies.find((c) => c.name.startsWith('tf_session'))!;
  sessions[who] = { cookie: `${cookie.name}=${cookie.value}`, ...(org ? { 'x-tito-org': org } : {}) };
}

const compare = async (): Promise<DeployComponent[]> => (await call('admin', 'GET', `/api/sandboxes/${sandboxId}/compare`)).json();
const find = (list: DeployComponent[], type: DeployComponent['type'], id: string) => list.find((c) => c.type === type && c.id === id);
const deploy = (components: { type: DeployComponent['type']; id: string }[], who = 'admin') => call(who, 'POST', `/api/sandboxes/${sandboxId}/deploy`, { components });

let layoutId: string;
let sandboxAutomation: string;
let productionAutomation: string;

beforeAll(async () => {
  platform = await createTestPlatform();
  app = await buildApp(platform);
  production = await platform.servicesFor(platform.defaultTenant());
  await signIn('admin', 'admin@titoforce.example');
  await signIn('maria', 'maria@titoforce.example');
  await signIn('james', 'james@titoforce.example');
  const created = await call('admin', 'POST', '/api/sandboxes', { name: 'build', type: 'developer' });
  expect(created.statusCode, created.body).toBe(202);
  sandboxId = created.json().id;
  await platform.idle();
  await signIn('sandbox', 'admin@titoforce.example', 'default--build');

  // Configuration built in the sandbox.
  const ok = async (res: Promise<LightMyRequestResponse>) => {
    const r = await res;
    expect(r.statusCode, r.body).toBeLessThan(300);
    return r.json();
  };
  await ok(call('sandbox', 'POST', '/api/objects', { label: 'Site Visit', pluralLabel: 'Site Visits' }));
  await ok(call('sandbox', 'POST', '/api/objects/site_visit/fields', { label: 'Notes', type: 'text' }));
  await ok(call('sandbox', 'POST', '/api/objects/site_visit/fields', { label: 'Account', apiName: 'visit_account', type: 'lookup', referenceTo: 'account' }));
  await ok(call('sandbox', 'POST', '/api/objects/account/fields', { label: 'Region', type: 'picklist', options: [{ value: 'North' }, { value: 'South' }] }));
  const layout: PageLayoutDef = (await call('sandbox', 'GET', '/api/objects/account/layouts')).json().layouts[0];
  const saved: PageLayoutDef = await ok(
    call('sandbox', 'PUT', '/api/objects/account/layouts/default', {
      name: layout.name,
      isDefault: true,
      highlights: layout.highlights,
      sections: [
        { id: 'territory', title: 'Territory', columns: 1, fields: ['region'] },
        ...layout.sections.map((s) => ({ ...s, fields: s.fields.filter((f) => f !== 'region') })),
      ],
      relatedLists: layout.relatedLists,
      roleIds: [],
    }),
  );
  layoutId = saved.id;
  await ok(
    call('sandbox', 'PUT', '/api/translations/es', {
      entries: [
        { key: 'object.account.label', value: 'Empresa' },
        { key: 'field.account.region.label', value: 'Región' },
      ],
    }),
  );
  sandboxAutomation = (
    await ok(
      call('sandbox', 'POST', '/api/automations', {
        name: 'Note new visits',
        object: 'site_visit',
        trigger: { type: 'created' },
        conditions: null,
        actions: [{ type: 'update_record', fields: { notes: 'Scheduled' } }],
        active: true,
      }),
    )
  ).id;
  const rep: RoleDef = (await call('sandbox', 'GET', '/api/roles')).json().find((r: RoleDef) => r.id === 'sales_rep');
  await ok(
    call('sandbox', 'PUT', '/api/roles/sales_rep', {
      name: rep.name,
      description: rep.description,
      permissions: { ...rep.permissions, objects: { ...rep.permissions.objects, site_visit: { read: 'all', create: true, edit: 'own', delete: 'none' } } },
    }),
  );

  // Changed in production meanwhile.
  productionAutomation = (
    await ok(
      call('admin', 'POST', '/api/automations', {
        name: 'Production only',
        object: 'account',
        trigger: { type: 'created' },
        conditions: null,
        actions: [{ type: 'update_record', fields: { description: 'New' } }],
        active: false,
      }),
    )
  ).id;
  await ok(call('admin', 'POST', '/api/objects/account/fields', { label: 'Legacy Code', type: 'text' }));
});
afterAll(async () => {
  await app?.close();
  await platform?.close();
});

describe('deploying from a sandbox', () => {
  it('compares the sandbox configuration with production', async () => {
    const components = await compare();
    expect(find(components, 'object', 'site_visit')).toMatchObject({ status: 'new', label: 'Site Visit', items: { added: 3, changed: 0, productionOnly: 0 } });
    expect(find(components, 'object', 'account')).toMatchObject({ status: 'changed', items: { added: 1, changed: 0, productionOnly: 1 } });
    expect(find(components, 'object', 'contact')!.status).toBe('unchanged');
    expect(find(components, 'layout', layoutId)).toMatchObject({ status: 'new', object: 'account', objectLabel: 'Account' });
    expect(find(components, 'translation', 'es')).toMatchObject({ status: 'new', items: { added: 2, changed: 0, productionOnly: 0 } });
    expect(find(components, 'automation', sandboxAutomation)).toMatchObject({ status: 'new', object: 'site_visit', objectLabel: 'Site Visit' });
    expect(find(components, 'automation', productionAutomation)!.status).toBe('production_only');
    expect(find(components, 'role', 'sales_rep')!.status).toBe('changed');
    expect(find(components, 'role', 'admin')!.status).toBe('unchanged');
    expect(components.map((c) => c.type).indexOf('layout')).toBeGreaterThan(components.map((c) => c.type).lastIndexOf('object'));
  });

  it('rolls everything back when a deployed component depends on something left behind', async () => {
    const res = await deploy([
      { type: 'translation', id: 'es' },
      { type: 'layout', id: layoutId },
    ]);
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatchObject({
      code: 'deploy_failed',
      message: 'Page layout "Account Layout": Unknown field region',
      details: { component: { type: 'layout', id: layoutId } },
    });
    // Nothing was written: the layout, the translations and the default layout are as before.
    expect((await call('maria', 'GET', '/api/objects/account/layout')).json().id).toBe('default');
    expect(await production.db.all('SELECT * FROM translations')).toEqual([]);
    const history: DeploymentRecord[] = (await call('admin', 'GET', '/api/deployments')).json();
    expect(history[0]).toMatchObject({ status: 'failed', sourceName: 'build', deployedBy: 'Alex Morgan', components: [{ type: 'layout' }, { type: 'translation' }] });
    expect(history[0]!.error).toContain('Unknown field region');

    // Translations of labels production does not have are refused too.
    const labels = await deploy([{ type: 'translation', id: 'es' }]);
    expect(labels.json().error.message).toBe(
      'Translations "es": these labels are not in production: field.account.region.label. Deploy the components they belong to as well',
    );
  });

  it('deploys new and changed components together, keeping their ids and what only production has', async () => {
    const notify = vi.spyOn(production.realtime, 'metadataChanged');
    const res = await deploy([
      { type: 'object', id: 'site_visit' },
      { type: 'object', id: 'account' },
      { type: 'layout', id: layoutId },
      { type: 'translation', id: 'es' },
      { type: 'automation', id: sandboxAutomation },
      { type: 'role', id: 'sales_rep' },
    ]);
    expect(res.statusCode, res.body).toBe(201);
    const { deployment, components } = res.json() as { deployment: DeploymentRecord; components: DeployComponent[] };
    expect(deployment).toMatchObject({ status: 'succeeded', error: null, sourceId: sandboxId });
    expect(deployment.components.map((c) => c.type)).toEqual(['object', 'object', 'layout', 'translation', 'automation', 'role']);
    for (const [type, id] of [['object', 'site_visit'], ['object', 'account'], ['layout', layoutId], ['translation', 'es'], ['automation', sandboxAutomation], ['role', 'sales_rep']] as const) {
      expect(find(components, type, id)!.status, `${type} ${id}`).toBe('unchanged');
    }
    expect(find(components, 'object', 'account')!.items).toEqual({ added: 0, changed: 0, productionOnly: 1 });
    expect(find(components, 'automation', productionAutomation)!.status).toBe('production_only');
    expect(notify).toHaveBeenCalled();
    notify.mockRestore();

    const account: ObjectDef = (await call('admin', 'GET', '/api/objects/account')).json();
    expect(account.fields.map((f) => f.apiName)).toEqual(expect.arrayContaining(['region', 'legacy_code']));
    const layout: PageLayoutDef = (await call('maria', 'GET', '/api/objects/account/layout')).json();
    expect(layout.id).toBe(layoutId);
    // Production's own new field, unknown to the sandbox, is added to the first section like any field created after a layout was saved.
    expect(layout.sections[0]).toEqual({ id: 'territory', title: 'Territory', columns: 1, fields: ['region', 'legacy_code'] });
    expect(layout.sections.flatMap((s) => s.fields).filter((f) => f === 'region')).toHaveLength(1);
    const es: ObjectDef = (await app.inject({ url: '/api/objects/account', headers: { ...sessions.maria, 'x-tito-locale': 'es' } })).json();
    expect(es.label).toBe('Empresa');
    expect(es.fields.find((f) => f.apiName === 'region')!.label).toBe('Región');

    // The new object works in production for the roles granted access in the sandbox, automation included.
    expect((await call('maria', 'POST', '/api/records/site_visit', { fields: { name: 'Manager visit' } })).statusCode).toBe(403);
    const visit = await call('james', 'POST', '/api/records/site_visit', { fields: { name: 'First visit' } });
    expect(visit.statusCode, visit.body).toBe(201);
    await production.jobs.drain();
    expect((await call('james', 'GET', `/api/records/site_visit/${visit.json().record.id}`)).json().record.fields.notes).toBe('Scheduled');
    const rep = (await production.users.getRole('sales_rep'))!;
    expect(rep.permissions.objects.site_visit).toEqual({ read: 'all', create: true, edit: 'own', delete: 'none' });

    const history: DeploymentRecord[] = (await call('admin', 'GET', '/api/deployments')).json();
    expect(history.map((d) => d.status)).toEqual(['succeeded', 'failed', 'failed']);
  });

  it('deploys reports, dashboards and apps, which depend on each other', async () => {
    const ok = async (res: Promise<LightMyRequestResponse>) => {
      const r = await res;
      expect(r.statusCode, r.body).toBeLessThan(300);
      return r.json();
    };
    const report = await ok(
      call('sandbox', 'POST', '/api/reports', { name: 'Visits by account', object: 'opportunity', groupBy: { field: 'stage' }, metric: { fn: 'count' }, chart: 'bar' }),
    );
    const dashboard = await ok(call('sandbox', 'POST', '/api/dashboards', { name: 'Field team', widgets: [{ reportId: report.id }] }));
    const created = await ok(call('sandbox', 'POST', '/api/apps', { name: 'Field', nav: [{ type: 'object', object: 'site_visit' }], dashboardId: dashboard.id }));

    const missing = await deploy([
      { type: 'app', id: created.id },
      { type: 'dashboard', id: dashboard.id },
    ]);
    expect(missing.json().error.message).toBe(`Dashboard "Field team": Unknown report ${report.id}`);
    expect((await production.db.all('SELECT id FROM dashboards WHERE id = ?', [dashboard.id])).length).toBe(0);

    const res = await deploy([
      { type: 'app', id: created.id },
      { type: 'dashboard', id: dashboard.id },
      { type: 'report', id: report.id },
    ]);
    expect(res.statusCode, res.body).toBe(201);
    const rendered = (await call('maria', 'GET', `/api/dashboards/${dashboard.id}`)).json();
    expect(rendered.dashboard).toMatchObject({ name: 'Field team' });
    // Owned by the sandbox user who built it, who exists in production too (users are copied into sandboxes).
    const owner = await production.db.get<{ email: string }>('SELECT u.email FROM dashboards d JOIN users u ON u.id = d.created_by WHERE d.id = ?', [dashboard.id]);
    expect(owner?.email).toBe('admin@titoforce.example');
    const apps: { id: string; dashboardId: string | null }[] = (await call('maria', 'GET', '/api/apps')).json();
    expect(apps.find((a) => a.id === created.id)).toMatchObject({ dashboardId: dashboard.id });
  });

  it('refuses deployments that would change field types, select nothing new, or come from the wrong place', async () => {
    expect((await call('sandbox', 'DELETE', '/api/objects/account/fields/region')).statusCode).toBe(200);
    expect((await call('sandbox', 'POST', '/api/objects/account/fields', { label: 'Region', type: 'text' })).statusCode).toBe(201);
    const typeChange = await deploy([{ type: 'object', id: 'account' }]);
    expect(typeChange.json().error.message).toBe('Object "Account": Changing the type of Region is not supported; create a new field instead');

    const before = (await call('admin', 'GET', '/api/deployments')).json().length;
    const unchanged = await deploy([{ type: 'object', id: 'contact' }]);
    expect(unchanged.json().error).toMatchObject({ code: 'nothing_to_deploy' });
    expect((await call('admin', 'GET', '/api/deployments')).json()).toHaveLength(before);

    expect((await deploy([{ type: 'automation', id: productionAutomation }])).json().error.message).toMatch(/is not in the sandbox/);
    expect((await deploy([{ type: 'object', id: 'contact' }], 'maria')).statusCode).toBe(403);
    const fromSandbox = await deploy([{ type: 'object', id: 'contact' }], 'sandbox');
    expect(fromSandbox.json().error.message).toBe('Sandboxes are managed from the production organization');
  });

  it("recalculates production's records when a deployment changes their formulas", async () => {
    const opportunities = async () =>
      (await production.db.all<{ data: unknown }>("SELECT data FROM records WHERE object_api_name = 'opportunity'")).map((r) =>
        parseJson<{ amount?: number | null; double_amount?: number | null }>(r.data, {}),
      );
    const added = await call('sandbox', 'POST', '/api/objects/opportunity/fields', { label: 'Double Amount', type: 'formula', formula: 'BLANKVALUE(amount, 0) * 2', formulaType: 'currency' });
    expect(added.statusCode, added.body).toBe(201);
    expect((await deploy([{ type: 'object', id: 'opportunity' }])).statusCode).toBe(201);
    const deployed = await opportunities();
    expect(deployed.length).toBeGreaterThan(0);
    for (const o of deployed) expect(o.double_amount).toBeCloseTo((o.amount ?? 0) * 2, 2);

    const changed = await call('sandbox', 'PATCH', '/api/objects/opportunity/fields/double_amount', { formula: 'BLANKVALUE(amount, 0) * 3' });
    expect(changed.statusCode, changed.body).toBe(200);
    expect((await deploy([{ type: 'object', id: 'opportunity' }])).statusCode).toBe(201);
    for (const o of await opportunities()) expect(o.double_amount).toBeCloseTo((o.amount ?? 0) * 3, 2);
  });
});
