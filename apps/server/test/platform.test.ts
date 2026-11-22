import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { TABLES } from '../src/db/schema.ts';
import { prepareCsvImport } from '../src/platform/csv-import.ts';
import type { Principal } from '../src/platform/principal.ts';
import { seedIfNeeded } from '../src/seed/index.ts';
import type { Services } from '../src/services.ts';
import { AppError, parseCsv, RateLimiter } from '../src/util.ts';
import { createTestServices, demoUser, principal } from './helpers.ts';

let s: Services;
let admin: Principal;
let maria: Principal;
let james: Principal;
let noah: Principal;
let hannah: Principal;

beforeAll(async () => {
  s = await createTestServices();
  [admin, maria, james, noah, hannah] = await Promise.all(['admin', 'maria', 'james', 'noah', 'hannah'].map((k) => principal(s, k)));
});
afterAll(() => s?.close());

async function rejects(promise: Promise<unknown>, status: number, code?: string): Promise<AppError> {
  const err = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(AppError);
  expect((err as AppError).status).toBe(status);
  if (code) expect((err as AppError).code).toBe(code);
  return err as AppError;
}

describe('database', () => {
  it('TABLES lists exactly the tables the migrations create', async () => {
    const sql =
      s.db.dialect === 'postgres'
        ? "SELECT table_name AS name FROM information_schema.tables WHERE table_schema = current_schema() AND table_type = 'BASE TABLE'"
        : "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'";
    const rows = await s.db.all<{ name: string }>(sql);
    expect(rows.map((r) => r.name).sort()).toEqual([...TABLES].sort());
  });

  it('does not seed twice', async () => {
    const count = async () => Number((await s.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM records'))!.n);
    const before = await count();
    expect((await seedIfNeeded(s)).seeded).toBe(false);
    expect(await count()).toBe(before);
  });
});

describe('records', () => {
  const opp = (fields: Record<string, unknown>) => ({ name: 'Test deal', amount: 1000, stage: 'Prospecting', close_date: '2031-01-31', ...fields });

  it('enforces required fields, picklist values and validation rules', async () => {
    expect((await rejects(s.records.create(maria, 'opportunity', { name: 'No date' }), 400)).message).toBe('Close Date is required');
    await rejects(s.records.create(maria, 'opportunity', opp({ stage: 'Bogus' })), 400);
    const err = await rejects(s.records.create(maria, 'opportunity', opp({ stage: 'Closed Lost' })), 400);
    expect(err.message).toContain('loss reason');
    await rejects(s.records.create(maria, 'opportunity', opp({ expected_revenue: 5 })), 400);
  });

  it('keeps formulas, rollups and automation updates in sync', async () => {
    const account = await s.records.create(maria, 'account', { name: 'Rollup Test Co' });
    const deal = await s.records.create(maria, 'opportunity', opp({ account: account.id, stage: 'Proposal' }));
    // "Opportunity stage defaults" automation sets probability; expected_revenue is a formula on top of it.
    expect(deal.fields.probability).toBe(60);
    expect(deal.fields.expected_revenue).toBe(600);
    expect((await s.records.get(maria, 'account', account.id)).fields.open_pipeline).toBe(1000);

    await s.records.update(maria, 'opportunity', deal.id, { stage: 'Closed Won' });
    const after = await s.records.get(maria, 'account', account.id);
    expect(after.fields.open_pipeline).toBe(0);
    expect(after.fields.won_revenue).toBe(1000);

    await s.records.delete(maria, 'opportunity', deal.id);
    expect((await s.records.get(maria, 'account', account.id)).fields.won_revenue).toBe(0);
  });

  it('applies role-based object, ownership and field-level security', async () => {
    const mine = await s.records.create(maria, 'account', { name: 'Owned by Maria' });
    // Sales reps read all sales records but only edit their own.
    expect((await s.records.get(james, 'account', mine.id)).name).toBe('Owned by Maria');
    await rejects(s.records.update(james, 'account', mine.id, { name: 'Hijacked' }), 403);
    // Employees cannot see sales data at all.
    await rejects(s.records.query(noah, 'opportunity'), 403);
    // Salary is sensitive: HR sees it, other roles get it redacted and cannot set it.
    const emp = (await s.records.query(hannah, 'employee', { pageSize: 1 })).records[0]!;
    const salary = emp.fields.salary;
    expect(salary).toEqual(expect.any(Number));
    expect((await s.records.get(maria, 'employee', emp.id)).fields).not.toHaveProperty('salary');
    await s.users.upsertRole({
      id: 'hr_coordinator',
      name: 'HR Coordinator',
      description: 'Edits worker records without access to compensation.',
      permissions: { setup: false, viewSensitive: false, manageAutomations: false, manageAgents: false, objects: { employee: { read: 'all', create: true, edit: 'all', delete: 'none' } } },
    });
    const coordinator = await s.users.principalForUser((await s.users.createUser({ email: 'coord@example.com', name: 'Coordinator', roleId: 'hr_coordinator', password: 'password123' })).id);
    await rejects(s.records.update(coordinator, 'employee', emp.id, { salary: 1 }), 403);
    // Saving other fields must not wipe the value the editor cannot see.
    await s.records.update(coordinator, 'employee', emp.id, { location: 'Remote' });
    expect((await s.records.get(hannah, 'employee', emp.id)).fields).toMatchObject({ location: 'Remote', salary });
  });

  it('hides fields and makes them read-only per role, and keeps hidden values out of search', async () => {
    const rep = (await s.users.getRole('sales_rep'))!;
    await s.users.upsertRole({ ...rep, permissions: { ...rep.permissions, fields: { account: { description: 'none', industry: 'read' } } } });
    try {
      const jamesNow = await principal(s, 'james');
      const acct = await s.records.create(maria, 'account', { name: 'Field Security Co', industry: 'Energy', description: 'zebra-crossing-secret', owner_id: james.userId });
      const seen = await s.records.get(jamesNow, 'account', acct.id);
      expect(seen.fields).not.toHaveProperty('description');
      expect(seen.fields.industry).toBe('Energy');
      await rejects(s.records.update(jamesNow, 'account', acct.id, { industry: 'Retail' }), 403);
      await rejects(s.records.update(jamesNow, 'account', acct.id, { description: 'guess' }), 403);
      // Forms send read-only values back unchanged; that is allowed.
      expect((await s.records.update(jamesNow, 'account', acct.id, { industry: 'Energy', phone: '555-0100' })).fields.phone).toBe('555-0100');
      await rejects(s.records.query(jamesNow, 'account', { filters: { match: 'all', rules: [{ field: 'description', op: 'contains', value: 'zebra' }] } }), 403);
      // Other roles still see the field, but it is not searchable while any role cannot see it.
      expect((await s.records.get(maria, 'account', acct.id)).fields.description).toBe('zebra-crossing-secret');
      const found = async () => (await s.records.search(maria, 'zebra-crossing-secret')).flatMap((g) => g.records.map((r) => r.id));
      expect(await found()).not.toContain(acct.id);
      await s.users.upsertRole(rep);
      expect(await found()).toContain(acct.id);
    } finally {
      await s.users.upsertRole(rep);
    }
  });

  it('opens records to roles with own-record access through sharing rules, never granting delete', async () => {
    await s.users.upsertRole({
      id: 'territory_rep',
      name: 'Territory Rep',
      description: 'Sees only their own accounts.',
      permissions: { setup: false, viewSensitive: false, manageAutomations: false, manageAgents: false, objects: { account: { read: 'own', create: true, edit: 'own', delete: 'own' } } },
    });
    const rep = await s.users.principalForUser((await s.users.createUser({ email: 'territory@example.com', name: 'Territory Rep', roleId: 'territory_rep', password: 'password123' })).id);
    const managers = await s.records.create(maria, 'account', { name: 'Managed by Maria' });
    const energy = await s.records.create(maria, 'account', { name: 'Energy Shared Co', industry: 'Energy', owner_id: james.userId });
    const ids = async () => (await s.records.query(rep, 'account', { pageSize: 200 })).records.map((r) => r.id);
    await rejects(s.records.get(rep, 'account', managers.id), 404);
    expect(await ids()).not.toContain(managers.id);

    const byOwner = await s.sharing.create({ object: 'account', name: 'Manager accounts', description: '', type: 'owner', ownerRoles: ['sales_manager'], criteria: null, shareWith: ['territory_rep'], access: 'read', active: true });
    expect((await s.records.get(rep, 'account', managers.id)).access).toEqual({ edit: false, delete: false });
    expect(await ids()).toContain(managers.id);
    await rejects(s.records.update(rep, 'account', managers.id, { phone: '1' }), 403);

    const byCriteria = await s.sharing.create({
      object: 'account',
      name: 'Energy accounts',
      description: '',
      type: 'criteria',
      ownerRoles: [],
      criteria: { match: 'all', rules: [{ field: 'industry', op: 'eq', value: 'Energy' }] },
      shareWith: ['territory_rep'],
      access: 'edit',
      active: true,
    });
    expect((await s.records.get(rep, 'account', energy.id)).access).toEqual({ edit: true, delete: false });
    await s.records.update(rep, 'account', energy.id, { phone: '555-0101' });
    await rejects(s.records.delete(rep, 'account', energy.id), 403);
    // Taking ownership would turn shared edit access into delete access.
    await rejects(s.records.update(rep, 'account', energy.id, { owner_id: rep.userId }), 403);
    const mine = await s.records.create(rep, 'account', { name: 'Territory Own Co' });
    expect((await s.records.update(rep, 'account', mine.id, { owner_id: james.userId })).ownerId).toBe(james.userId);

    // Rules in use block deleting the roles and fields they refer to; inactive rules share nothing.
    await s.users.upsertRole({ id: 'unused_role', name: 'Unused', description: '', permissions: { ...rep.permissions!, objects: {} } });
    await s.sharing.update(byCriteria.id, { ...byCriteria, shareWith: ['territory_rep', 'unused_role'] });
    expect((await rejects(s.users.deleteRole('unused_role'), 409)).message).toContain('Energy accounts');
    await rejects(s.sharing.assertFieldUnused('account', 'industry'), 409);
    await s.sharing.update(byOwner.id, { ...byOwner, active: false });
    await rejects(s.records.get(rep, 'account', managers.id), 404);
    await s.sharing.delete(byOwner.id);
    await s.sharing.delete(byCriteria.id);
  });

  it('blocks likely duplicates unless explicitly allowed', async () => {
    await s.records.create(maria, 'contact', { first_name: 'Dee', last_name: 'Upe', email: 'dee.upe@example.com' });
    await rejects(s.records.create(maria, 'contact', { last_name: 'Upe', email: 'DEE.UPE@example.com' }), 409, 'duplicate');
    const dup = await s.records.create(maria, 'contact', { last_name: 'Upe', email: 'dee.upe@example.com' }, { allowDuplicates: true });
    expect(dup.name).toBe('Upe');
  });
});

describe('CSV', () => {
  it('parses quoted fields, escaped quotes, embedded newlines, CRLF and a BOM', () => {
    expect(parseCsv('\uFEFFa,b,c\r\n"x, y","say ""hi""","line1\nline2"\r\n\r\n,,\n1,2,3')).toEqual([
      ['a', 'b', 'c'],
      ['x, y', 'say "hi"', 'line1\nline2'],
      ['1', '2', '3'],
    ]);
  });

  it('maps import columns by label or API name and resolves users and lookups', async () => {
    const james = await demoUser(s, 'james');
    const account = await s.records.create(maria, 'account', { name: 'Import Target Inc' });
    const csv = 'Opportunity Name,account,Amount,Stage,Close Date,Owner,Id,Mystery\nImported deal,Import Target Inc,2500,Proposal,2031-03-01,james@titoforce.example,opp_x,?\n';
    const prepared = await prepareCsvImport(s, maria, 'opportunity', csv);
    expect(prepared.columns.map((c) => c.field)).toEqual(['name', 'account', 'amount', 'stage', 'close_date', 'owner_id', null, null]);
    expect(prepared.rows[0]).toMatchObject({ name: 'Imported deal', account: account.id, stage: 'Proposal', owner_id: james.id });
    const result = await s.records.importRecords(maria, 'opportunity', prepared.rows);
    expect(result).toMatchObject({ created: 1, errors: [] });
  });

  it('neutralizes spreadsheet formulas on export but keeps negative numbers', async () => {
    await s.records.create(admin, 'account', { name: '=HYPERLINK("http://evil")', annual_revenue: -5 });
    const csv = await s.records.exportCsv(admin, 'account', { q: 'HYPERLINK' });
    const row = csv.split('\r\n')[1]!;
    expect(row).toContain(`"'=HYPERLINK(""http://evil"")"`);
    expect(row).toContain(',-5,');
  });
});

describe('RateLimiter', () => {
  it('blocks a key after the limit until reset, without affecting other keys', () => {
    const limiter = new RateLimiter(2, 60_000);
    expect([limiter.hit('a'), limiter.hit('a'), limiter.hit('a')]).toEqual([true, true, false]);
    expect(limiter.allowed('a')).toBe(false);
    expect(limiter.hit('b')).toBe(true);
    limiter.reset('a');
    expect(limiter.hit('a')).toBe(true);
  });
});
