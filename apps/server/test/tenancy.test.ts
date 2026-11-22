import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.ts';
import { loadConfig } from '../src/config.ts';
import { seedIfNeeded } from '../src/seed/index.ts';
import { sandboxTables } from '../src/tenancy/copy.ts';
import { tenantsDirectory } from '../src/tenancy/locator.ts';
import { Platform } from '../src/tenancy/platform.ts';
import { createTestPlatform, createTestServices } from './helpers.ts';

const JSON_HEADERS = { 'content-type': 'application/json' };

let platform: Platform;
let app: FastifyInstance;
/** Session cookie of the default organization's administrator. */
let admin: string;

function cookieOf(res: LightMyRequestResponse): string {
  const c = res.cookies.find((x) => x.name.startsWith('tf_session'));
  if (!c) throw new Error(`No session cookie (status ${res.statusCode}: ${res.body})`);
  return `${c.name}=${c.value}`;
}

async function signIn(email: string, org?: string, password = 'titoforce'): Promise<{ cookie: string; token: string; res: LightMyRequestResponse }> {
  const res = await app.inject({
    method: 'POST',
    url: '/api/auth/login',
    headers: org ? { 'x-tito-org': org } : {},
    payload: { email, password, issueToken: true },
  });
  expect(res.statusCode, res.body).toBe(200);
  return { cookie: cookieOf(res), token: res.json().token, res };
}

const get = (url: string, headers: Record<string, string> = {}) => app.inject({ url, headers });
const send = (method: 'POST' | 'PATCH' | 'DELETE', url: string, headers: Record<string, string>, payload: unknown = {}) =>
  app.inject({ method, url, headers: { ...JSON_HEADERS, ...headers }, payload: JSON.stringify(payload) });

async function count(object: string, headers: Record<string, string>): Promise<number> {
  const res = await send('POST', `/api/records/${object}/query`, headers, { pageSize: 1 });
  expect(res.statusCode, res.body).toBe(200);
  return res.json().total;
}

beforeAll(async () => {
  platform = await createTestPlatform({ env: { TITO_ALLOW_SIGNUP: 'true', TITO_BASE_DOMAIN: 'crm.test', TITO_CORS_ORIGINS: 'capacitor://localhost, https://localhost' } });
  app = await buildApp(platform);
  admin = (await signIn('admin@titoforce.example')).cookie;
});
afterAll(async () => {
  await app?.close();
  await platform?.close();
});

describe('organizations', () => {
  let acme: { cookie: string; token: string; id: string };

  beforeAll(async () => {
    const res = await send('POST', '/api/signup', {}, {
      organization: 'Acme',
      organizationName: 'Acme Inc',
      name: 'Ada Lovelace',
      email: 'ada@acme.test',
      password: 'correct-horse-battery',
      issueToken: true,
    });
    expect(res.statusCode, res.body).toBe(201);
    const body = res.json();
    expect(body.organization).toMatchObject({ slug: 'acme', name: 'Acme Inc', kind: 'production', status: 'active' });
    expect(body.user).toMatchObject({ email: 'ada@acme.test', name: 'Ada Lovelace', roleId: 'admin' });
    acme = { cookie: cookieOf(res), token: body.token, id: body.organization.id };
    expect(acme.cookie.startsWith(`tf_session_${acme.id}=`)).toBe(true);
  });

  it('gives a new organization its own empty database with the person signing up as administrator', async () => {
    const session = await get('/api/auth/session', { cookie: acme.cookie, 'x-tito-org': 'acme' });
    expect(session.statusCode).toBe(200);
    expect(session.json().organization.slug).toBe('acme');
    expect(await count('account', { cookie: acme.cookie, 'x-tito-org': 'acme' })).toBe(0);
    expect(await count('account', { cookie: admin })).toBeGreaterThan(0);
    const users = (await get('/api/users', { cookie: acme.cookie, 'x-tito-org': 'acme' })).json() as { email: string }[];
    expect(users.map((u) => u.email)).toContain('ada@acme.test');
    expect(users.map((u) => u.email)).not.toContain('maria@titoforce.example');
    const config = (await get('/api/config?org=acme')).json();
    expect(config).toMatchObject({ demo: false, demoLogins: [], organization: { slug: 'acme', name: 'Acme Inc' }, multiOrg: true, signup: true });
  });

  it('keeps each organization’s records apart', async () => {
    const created = await send('POST', '/api/records/account', { cookie: acme.cookie, 'x-tito-org': 'acme' }, { fields: { name: 'Acme Only Ltd' } });
    expect(created.statusCode, created.body).toBe(201);
    const id = created.json().record.id as string;
    const own = await get(`/api/records/account/${id}`, { cookie: acme.cookie, 'x-tito-org': 'acme' });
    expect(own.statusCode, own.body).toBe(200);
    expect((await get(`/api/records/account/${id}`, { cookie: admin })).statusCode).toBe(404);
    const search = await send('POST', '/api/records/account/query', { cookie: admin }, { q: 'Acme Only' });
    expect(search.json().total).toBe(0);
  });

  it('routes requests by header, query parameter, subdomain or session token', async () => {
    const bearer = { authorization: `Bearer ${acme.token}` };
    expect((await get('/api/auth/session', bearer)).json().organization.slug).toBe('acme');
    expect((await get('/api/auth/session?org=acme', { cookie: acme.cookie })).json().organization.slug).toBe('acme');
    expect((await get('/api/auth/session', { cookie: acme.cookie, host: 'acme.crm.test' })).json().organization.slug).toBe('acme');
    expect((await get('/api/config', { host: 'www.crm.test' })).json().organization.slug).toBe('default');

    const mismatch = await get('/api/auth/session', { ...bearer, host: 'acme.crm.test', 'x-tito-org': 'default' });
    expect(mismatch.statusCode).toBe(400);
    expect(mismatch.json().error.code).toBe('organization_mismatch');
    const unknown = await get('/api/config', { 'x-tito-org': 'nope' });
    expect(unknown.statusCode).toBe(404);
    expect(unknown.json().error.code).toBe('organization_not_found');
  });

  it('lets the mobile app call the API from its own origin with a token, never with cookies', async () => {
    const origin = 'capacitor://localhost';
    const preflight = await app.inject({
      method: 'OPTIONS',
      url: '/api/records/account/query',
      headers: { origin, 'access-control-request-method': 'POST', 'access-control-request-headers': 'authorization, content-type, x-tito-org' },
    });
    expect(preflight.statusCode).toBe(204);
    expect(preflight.headers['access-control-allow-origin']).toBe(origin);
    expect(preflight.headers['access-control-allow-headers']).toBe('authorization, content-type, x-tito-locale, x-tito-org');
    expect(preflight.headers['access-control-allow-credentials']).toBeUndefined();

    const res = await send('POST', '/api/records/account/query', { origin, authorization: `Bearer ${acme.token}` }, { pageSize: 1 });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.headers['access-control-allow-origin']).toBe(origin);
    // Errors are readable by the app too.
    const signedOut = await get('/api/auth/session', { origin: 'https://localhost' });
    expect(signedOut.statusCode).toBe(401);
    expect(signedOut.headers['access-control-allow-origin']).toBe('https://localhost');

    // Other sites get no CORS headers, so browsers stop them at the preflight.
    const evil = await app.inject({ method: 'OPTIONS', url: '/api/records/account/query', headers: { origin: 'https://evil.example', 'access-control-request-method': 'POST' } });
    expect(evil.statusCode).not.toBe(204);
    expect(evil.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('never accepts one organization’s session in another', async () => {
    // Acme's cookie is named after Acme, so the default organization does not even see it…
    expect((await get('/api/auth/session', { cookie: acme.cookie })).statusCode).toBe(401);
    // …and a token presented to the wrong organization is rejected.
    expect((await get('/api/auth/session', { authorization: `Bearer ${acme.token}`, 'x-tito-org': 'default' })).statusCode).toBe(401);
    const forged = admin.replace(/^tf_session=/, `tf_session_${acme.id}=`);
    expect((await get('/api/auth/session', { cookie: forged, 'x-tito-org': 'acme' })).statusCode).toBe(401);
    // Same email and password in another organization: no account there.
    const wrongOrg = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: 'ada@acme.test', password: 'correct-horse-battery' } });
    expect(wrongOrg.statusCode).toBe(401);
    const typed = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: 'ada@acme.test', password: 'correct-horse-battery', organization: 'ACME' } });
    expect(typed.statusCode, typed.body).toBe(200);
    expect(typed.json().organization.slug).toBe('acme');
  });

  it('validates organization IDs and rejects taken ones', async () => {
    const attempt = (organization: string) =>
      send('POST', '/api/signup', {}, { organization, organizationName: 'X', name: 'X', email: 'x@x.test', password: 'long-enough-1' });
    for (const bad of ['default', 'www', 'a--b', '-acme', 'acme_inc', 'x'.repeat(40)]) expect((await attempt(bad)).statusCode, bad).toBe(400);
    const taken = await attempt('acme');
    expect(taken.statusCode).toBe(409);
    expect(await platform.listTenants()).toHaveLength(2);
  });

  it('blocks suspended organizations until they are resumed', async () => {
    const tenant = (await platform.tenantBySlug('acme'))!;
    await platform.setSuspended(tenant, true);
    const res = await get('/api/auth/session', { cookie: acme.cookie, 'x-tito-org': 'acme' });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe('organization_suspended');
    await platform.setSuspended((await platform.tenantBySlug('acme'))!, false);
    expect((await get('/api/auth/session', { cookie: acme.cookie, 'x-tito-org': 'acme' })).statusCode).toBe(200);
  });

  it('does not offer sign-up or sandboxes when serving a single organization', async () => {
    const s = await createTestServices();
    const single = await buildApp(s);
    try {
      expect((await single.inject({ method: 'POST', url: '/api/signup', payload: {} })).statusCode).toBe(404);
      const config = (await single.inject('/api/config')).json();
      expect(config).toMatchObject({ multiOrg: false, signup: false, organization: { slug: 'default' } });
    } finally {
      await single.close();
      await s.close();
    }
  });
});

describe('sandboxes', () => {
  async function createSandbox(name: string, type: 'developer' | 'full') {
    const res = await send('POST', '/api/sandboxes', { cookie: admin }, { name, type });
    expect(res.statusCode, res.body).toBe(202);
    expect(res.json()).toMatchObject({ slug: `default--${name}`, kind: 'sandbox', sandboxType: type, status: 'provisioning', createdByName: 'Alex Morgan' });
    await platform.idle();
    const ready = await get(`/api/sandboxes/${res.json().id}`, { cookie: admin });
    expect(ready.json().status).toBe('active');
    return ready.json() as { id: string; slug: string };
  }

  it('copies configuration and users, but no records, into a developer sandbox', async () => {
    const sb = await createSandbox('dev', 'developer');
    const maria = await signIn('maria@titoforce.example', sb.slug);
    expect(maria.res.json().organization).toMatchObject({ kind: 'sandbox', parentSlug: 'default', parentName: 'Default organization' });
    expect(await count('account', { cookie: maria.cookie, 'x-tito-org': sb.slug })).toBe(0);
    const sbAdmin = await signIn('admin@titoforce.example', sb.slug);
    const objects = (await get('/api/objects', { cookie: sbAdmin.cookie, 'x-tito-org': sb.slug })).json() as { apiName: string }[];
    const production = (await get('/api/objects', { cookie: admin })).json() as { apiName: string }[];
    expect(objects.map((o) => o.apiName).sort()).toEqual(production.map((o) => o.apiName).sort());

    // Changes made in the sandbox stay there.
    const created = await send('POST', '/api/objects', { cookie: sbAdmin.cookie, 'x-tito-org': sb.slug }, { label: 'Vehicle', pluralLabel: 'Vehicles' });
    expect(created.statusCode, created.body).toBe(201);
    expect((await get('/api/objects/vehicle', { cookie: admin })).statusCode).toBe(404);
  });

  it('copies every record into a full sandbox, table by table', async () => {
    const sb = await createSandbox('full', 'full');
    const production = await platform.servicesFor(platform.defaultTenant());
    const sandbox = await platform.servicesFor((await platform.tenantById(sb.id))!);
    for (const table of sandboxTables('full')) {
      const n = async (db: typeof production.db) => Number((await db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM ${table}`))!.n);
      expect(await n(sandbox.db), table).toBe(await n(production.db));
    }
    expect((await sandbox.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM sessions'))!.n).toBe(0);
    const maria = await signIn('maria@titoforce.example', sb.slug);
    expect(await count('opportunity', { cookie: maria.cookie, 'x-tito-org': sb.slug })).toBe(await count('opportunity', { cookie: admin }));
  });

  it('refreshes a sandbox from production and signs everyone out', async () => {
    const sb = (await platform.tenantBySlug('default--dev'))!;
    const user = await signIn('admin@titoforce.example', sb.slug);
    const headers = { cookie: user.cookie, 'x-tito-org': sb.slug };
    expect((await send('POST', '/api/records/account', headers, { fields: { name: 'Sandbox Only' } })).statusCode).toBe(201);
    expect(await count('account', headers)).toBe(1);

    const res = await send('POST', `/api/sandboxes/${sb.id}/refresh`, { cookie: admin });
    expect(res.statusCode, res.body).toBe(202);
    expect(res.json().status).toBe('refreshing');
    const during = await get('/api/config', { 'x-tito-org': sb.slug });
    expect([200, 503]).toContain(during.statusCode);
    await platform.idle();
    const after = (await platform.tenantById(sb.id))!;
    expect(after).toMatchObject({ status: 'active', generation: sb.generation + 1, error: null });
    expect(after.refreshedAt).not.toBeNull();

    expect((await get('/api/auth/session', headers)).statusCode).toBe(401);
    const again = await signIn('admin@titoforce.example', sb.slug);
    expect(await count('account', { cookie: again.cookie, 'x-tito-org': sb.slug })).toBe(0);
    expect((await get('/api/objects/vehicle', { cookie: again.cookie, 'x-tito-org': sb.slug })).statusCode).toBe(404);
  });

  it('lets only administrators of the production organization manage sandboxes', async () => {
    const maria = await signIn('maria@titoforce.example');
    expect((await get('/api/sandboxes', { cookie: maria.cookie })).statusCode).toBe(403);
    expect((await send('POST', '/api/sandboxes', { cookie: maria.cookie }, { name: 'mine', type: 'developer' })).statusCode).toBe(403);

    const inSandbox = await signIn('admin@titoforce.example', 'default--dev');
    const headers = { cookie: inSandbox.cookie, 'x-tito-org': 'default--dev' };
    expect((await get('/api/sandboxes', headers)).json()).toMatchObject({ enabled: false, sandboxes: [] });
    expect((await send('POST', '/api/sandboxes', headers, { name: 'nested', type: 'developer' })).statusCode).toBe(400);

    const list = (await get('/api/sandboxes', { cookie: admin })).json();
    expect(list.enabled).toBe(true);
    expect(list.sandboxes.map((s: { slug: string }) => s.slug).sort()).toEqual(['default--dev', 'default--full']);
  });

  it('validates sandbox names', async () => {
    for (const name of ['Bad Name', 'a--b', '-x', 'x'.repeat(21)]) {
      expect((await send('POST', '/api/sandboxes', { cookie: admin }, { name, type: 'developer' })).statusCode, name).toBe(400);
    }
    expect((await send('POST', '/api/sandboxes', { cookie: admin }, { name: 'DEV', type: 'developer' })).statusCode).toBe(409);
  });

  it('deletes a sandbox together with its database', async () => {
    const sb = (await platform.tenantBySlug('default--full'))!;
    expect((await send('DELETE', `/api/sandboxes/${sb.id}`, { cookie: admin })).statusCode).toBe(200);
    expect(await platform.tenantById(sb.id)).toBeNull();
    expect((await get(`/api/sandboxes/${sb.id}`, { cookie: admin })).statusCode).toBe(404);
    expect((await get('/api/config', { 'x-tito-org': 'default--full' })).statusCode).toBe(404);
  });
});

describe('organization databases on disk', () => {
  it('stores each organization in its own SQLite file, closes idle ones and reopens them on demand', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'tf-orgs-'));
    const config = loadConfig({ TITO_DATABASE_URL: `sqlite:${join(dir, 'tito.db')}`, TITO_SEED_DEMO: 'false', TITO_ADMIN_PASSWORD: 'admin-password-1' });
    const p = await Platform.open(config);
    try {
      await seedIfNeeded(await p.servicesFor(p.defaultTenant()));
      const { tenant, services } = await p.createOrganization({ slug: 'globex', name: 'Globex', admin: { email: 'hank@globex.test', password: 'globex-pass-1', name: 'Hank' } });
      const file = join(tenantsDirectory(config)!, `${tenant.id}-g1.db`);
      expect(file).toBe(join(dir, 'tito-orgs', `${tenant.id}-g1.db`));
      expect(existsSync(file)).toBe(true);
      await services.records.create(await services.users.principalForUser((await services.users.listUsers(false))[0]!.id), 'account', { name: 'Globex Corp' });

      expect(await p.sweep(Date.now())).toBe(0);
      expect(await p.sweep(Date.now() + 11 * 60_000)).toBe(1);
      const reopened = await p.servicesFor(tenant);
      expect(reopened).not.toBe(services);
      expect((await reopened.db.get<{ n: number }>("SELECT COUNT(*) AS n FROM records WHERE object_api_name = 'account'"))!.n).toBe(1);

      await p.deleteOrganization(tenant);
      expect(existsSync(file)).toBe(false);
      expect(await p.tenantBySlug('globex')).toBeNull();
    } finally {
      await p.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
