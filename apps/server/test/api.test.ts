import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.ts';
import type { Services } from '../src/services.ts';
import { createTestServices } from './helpers.ts';

let s: Services;
let app: FastifyInstance;
let webDist: string;
let admin: string;
let maria: string;
let james: string;

const JSON_HEADERS = { 'content-type': 'application/json' };

async function login(email: string, target = app): Promise<string> {
  const res = await target.inject({ method: 'POST', url: '/api/auth/login', payload: { email, password: 'titoforce' } });
  expect(res.statusCode).toBe(200);
  return `tf_session=${res.cookies.find((c) => c.name === 'tf_session')!.value}`;
}

beforeAll(async () => {
  webDist = mkdtempSync(join(tmpdir(), 'tf-web-'));
  mkdirSync(join(webDist, 'assets'));
  writeFileSync(join(webDist, 'index.html'), '<!doctype html><title>titoForce</title>');
  writeFileSync(join(webDist, 'assets', 'app-1234.js'), 'console.log(1)');
  s = await createTestServices({ env: { TITO_WEB_DIST: webDist } });
  app = await buildApp(s);
  [admin, maria, james] = await Promise.all(['admin', 'maria', 'james'].map((k) => login(`${k}@titoforce.example`)));
});
afterAll(async () => {
  await app?.close();
  await s?.close();
  rmSync(webDist, { recursive: true, force: true });
});

describe('authentication', () => {
  it('requires a session for every API route except public ones', async () => {
    expect((await app.inject('/api/health')).statusCode).toBe(200);
    const res = await app.inject('/api/objects');
    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual({ error: { code: 'unauthenticated', message: 'Please sign in' } });
  });

  it('uses HttpOnly SameSite cookies, supports bearer tokens and revokes sessions on logout', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: 'priya@titoforce.example', password: 'titoforce', issueToken: true } });
    expect(res.cookies.find((c) => c.name === 'tf_session')).toMatchObject({ httpOnly: true, sameSite: 'Lax', path: '/' });
    const authorization = `Bearer ${res.json().token}`;
    expect((await app.inject({ url: '/api/auth/session', headers: { authorization } })).json().user.email).toBe('priya@titoforce.example');
    await app.inject({ method: 'POST', url: '/api/auth/logout', headers: { authorization, ...JSON_HEADERS }, payload: '{}' });
    expect((await app.inject({ url: '/api/auth/session', headers: { authorization } })).statusCode).toBe(401);
  });

  it('locks an account after repeated failed sign-ins without blocking other accounts', async () => {
    const fresh = await buildApp(s);
    try {
      const attempt = (email: string, password: string) => fresh.inject({ method: 'POST', url: '/api/auth/login', payload: { email, password } });
      for (let i = 0; i < 10; i++) expect((await attempt('liam@titoforce.example', 'wrong')).statusCode).toBe(401);
      const locked = await attempt('liam@titoforce.example', 'titoforce');
      expect(locked.statusCode).toBe(429);
      expect(locked.json().error.code).toBe('rate_limited');
      expect((await attempt('sofia@titoforce.example', 'titoforce')).statusCode).toBe(200);
    } finally {
      await fresh.close();
    }
  });

  it('restricts setup endpoints to administrators', async () => {
    expect((await app.inject({ url: '/api/roles', headers: { cookie: maria } })).statusCode).toBe(403);
    expect((await app.inject({ url: '/api/roles', headers: { cookie: admin } })).statusCode).toBe(200);
    const res = await app.inject({ method: 'POST', url: '/api/objects', headers: { cookie: maria, ...JSON_HEADERS }, payload: { label: 'Vehicle', pluralLabel: 'Vehicles' } });
    expect(res.statusCode).toBe(403);
  });
});

describe('request hardening', () => {
  it('rejects state-changing requests that are not JSON, which blocks cross-site form posts', async () => {
    for (const type of ['application/x-www-form-urlencoded', 'text/plain', 'multipart/form-data; boundary=x']) {
      const res = await app.inject({ method: 'POST', url: '/api/records/account', headers: { cookie: admin, 'content-type': type }, payload: 'name=x' });
      expect(res.statusCode).toBe(415);
    }
    expect((await app.inject({ method: 'POST', url: '/api/auth/logout', headers: { cookie: admin } })).statusCode).toBe(415);
  });

  it('rejects malformed JSON and drops __proto__ keys', async () => {
    const bad = await app.inject({ method: 'POST', url: '/api/records/account', headers: { cookie: admin, ...JSON_HEADERS }, payload: '{"fields":' });
    expect(bad.statusCode).toBe(400);
    expect(bad.json().error.code).toBe('invalid_json');
    const res = await app.inject({
      method: 'POST',
      url: '/api/records/account',
      headers: { cookie: admin, ...JSON_HEADERS },
      payload: '{"fields":{"name":"Proto Co","__proto__":{"polluted":true}}}',
    });
    expect(res.statusCode).toBe(201);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it('marks API responses as uncacheable and not sniffable', async () => {
    const res = await app.inject({ url: '/api/auth/session', headers: { cookie: maria } });
    expect(res.headers).toMatchObject({ 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'x-frame-options': 'DENY' });
  });
});

describe('records API', () => {
  it("applies a list view's filters and refuses views of other objects", async () => {
    const views = (await app.inject({ url: '/api/objects/opportunity/views', headers: { cookie: maria } })).json() as { id: string; name: string }[];
    const mine = views.find((v) => v.name === 'My Open Deals')!;
    const res = await app.inject({ method: 'POST', url: '/api/records/opportunity/query', headers: { cookie: maria, ...JSON_HEADERS }, payload: { viewId: mine.id } });
    const owners = new Set((res.json().records as { ownerId: string }[]).map((r) => r.ownerId));
    const session = (await app.inject({ url: '/api/auth/session', headers: { cookie: maria } })).json();
    expect([...owners]).toEqual([session.user.id]);
    const wrong = await app.inject({ method: 'POST', url: '/api/records/account/query', headers: { cookie: maria, ...JSON_HEADERS }, payload: { viewId: mine.id } });
    expect(wrong.statusCode).toBe(400);
  });

  it('exports CSV as a download', async () => {
    const res = await app.inject({ url: '/api/records/account/export.csv', headers: { cookie: maria } });
    expect(res.headers['content-type']).toBe('text/csv; charset=utf-8');
    expect(res.headers['content-disposition']).toMatch(/^attachment; filename="account-\d{4}-\d{2}-\d{2}\.csv"$/);
    expect(res.body.startsWith('Id,Account Name,')).toBe(true);
  });

  it('exports only the rows matching ad-hoc filters', async () => {
    const filters = encodeURIComponent(JSON.stringify({ match: 'all', rules: [{ field: 'name', op: 'eq', value: 'Maria Export Only Co' }] }));
    await app.inject({ method: 'POST', url: '/api/records/account', headers: { cookie: maria, ...JSON_HEADERS }, payload: { fields: { name: 'Maria Export Only Co' } } });
    const res = await app.inject({ url: `/api/records/account/export.csv?filters=${filters}`, headers: { cookie: maria } });
    const lines = res.body.trim().split(/\r?\n/);
    expect(lines).toHaveLength(2);
    expect(lines[1]).toContain('Maria Export Only Co');
    const bad = await app.inject({ url: '/api/records/account/export.csv?filters=%7Bnot-json', headers: { cookie: maria } });
    expect(bad.statusCode).toBe(400);
  });

  it('bulk updates what the user may edit and reports the rest', async () => {
    const create = async (cookie: string, name: string) =>
      (await app.inject({ method: 'POST', url: '/api/records/account', headers: { cookie, ...JSON_HEADERS }, payload: { fields: { name } } })).json().record.id as string;
    const own = await create(james, 'James Bulk Co');
    const other = await create(maria, 'Maria Bulk Co');
    const res = await app.inject({
      method: 'POST',
      url: '/api/records/account/bulk',
      headers: { cookie: james, ...JSON_HEADERS },
      payload: { action: 'update', ids: [own, other], fields: { type: 'Customer' } },
    });
    expect(res.json()).toMatchObject({ done: 1, errors: [{ id: other }] });
  });

  it('refuses edits that would overwrite changes saved since the record was opened, and merges the rest', async () => {
    const created = await app.inject({ method: 'POST', url: '/api/records/account', headers: { cookie: james, ...JSON_HEADERS }, payload: { fields: { name: 'Conflict Co', industry: 'Technology' } } });
    const opened = created.json().record as { id: string; updatedAt: string };
    const save = (cookie: string, fields: Record<string, unknown>, expectedUpdatedAt: string | null = opened.updatedAt) =>
      app.inject({
        method: 'PATCH',
        url: `/api/records/account/${opened.id}`,
        headers: { cookie, ...JSON_HEADERS },
        payload: { fields, ...(expectedUpdatedAt ? { expectedUpdatedAt } : {}) },
      });

    expect((await save(maria, { industry: 'Retail' })).statusCode).toBe(200);
    const conflict = await save(james, { industry: 'Healthcare', phone: '555-0100' });
    expect(conflict.statusCode).toBe(409);
    const { error } = conflict.json();
    expect(error).toMatchObject({ code: 'edit_conflict', details: { fields: [{ apiName: 'industry', label: 'Industry', value: 'Retail', by: 'Maria Garcia' }] } });
    expect(error.details.fields).toHaveLength(1);

    // Fields nobody else changed are saved without a conflict, keeping Maria's change.
    const merged = await save(james, { phone: '555-0100' });
    expect(merged.statusCode, merged.body).toBe(200);
    expect(merged.json().record.fields).toMatchObject({ industry: 'Retail', phone: '555-0100' });
    // After reviewing, James saves on top of the version the conflict reported.
    const retried = await save(james, { industry: 'Healthcare' }, error.details.updatedAt);
    expect(retried.statusCode, retried.body).toBe(200);
    expect(retried.json().record.fields.industry).toBe('Healthcare');
    // Without expectedUpdatedAt the last save wins, as before.
    expect((await save(maria, { industry: 'Retail' }, null)).statusCode).toBe(200);
  });
});

describe('web app hosting', () => {
  it('serves index.html for client-side routes with a strict CSP', async () => {
    const res = await app.inject('/r/opp_123');
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('<title>titoForce</title>');
    expect(res.headers['content-security-policy']).toContain("script-src 'self'");
    expect(res.headers['cache-control']).toBe('no-cache');
  });

  it('caches fingerprinted assets and returns 404 for missing files and API routes', async () => {
    expect((await app.inject('/assets/app-1234.js')).headers['cache-control']).toBe('public, max-age=31536000, immutable');
    expect((await app.inject('/assets/missing.js')).statusCode).toBe(404);
    const api = await app.inject({ url: '/api/nope', headers: { cookie: maria } });
    expect(api.statusCode).toBe(404);
    expect(api.json().error.code).toBe('not_found');
  });
});
