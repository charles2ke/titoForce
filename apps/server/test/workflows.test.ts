import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Principal } from '../src/platform/principal.ts';
import type { Services } from '../src/services.ts';
import { AppError } from '../src/util.ts';
import { createTestServices, demoUser, principal } from './helpers.ts';

let s: Services;
let maria: Principal;

beforeAll(async () => {
  s = await createTestServices();
  maria = await principal(s, 'maria');
});
afterAll(() => s?.close());

describe('automations', () => {
  it('runs only when conditions match, renders templates and logs each run', async () => {
    const auto = await s.automations.create(
      {
        name: 'Flag enterprise accounts',
        description: '',
        object: 'account',
        trigger: { type: 'created' },
        conditions: { match: 'all', rules: [{ field: 'employees', op: 'gt', value: 1000 }] },
        actions: [{ type: 'update_record', fields: { description: 'Enterprise: {{record.employees}} employees' } }],
        active: true,
      },
      null,
    );
    const big = await s.records.create(maria, 'account', { name: 'Huge Co', employees: 5000 });
    const small = await s.records.create(maria, 'account', { name: 'Tiny Co', employees: 5 });
    expect(big.fields.description).toBe('Enterprise: 5000 employees');
    expect(small.fields.description).toBeUndefined();
    expect((await s.automations.runs({ automationId: auto.id })).map((r) => [r.recordId, r.status])).toEqual([[big.id, 'success']]);
  });

  it('stops runaway automation chains', async () => {
    // Each run edits the record again, which would retrigger itself forever without the depth limit.
    await s.automations.create(
      {
        name: 'Ping-pong',
        description: '',
        object: 'account',
        trigger: { type: 'saved', watchFields: ['employees'] },
        conditions: { match: 'all', rules: [{ field: 'name', op: 'starts_with', value: 'Loop' }] },
        actions: [{ type: 'update_record', fields: { employees: '{{BLANKVALUE(record.employees, 0) + 1}}' } }],
        active: true,
      },
      null,
    );
    const rec = await s.records.create(maria, 'account', { name: 'Loop Co', employees: 0 });
    expect(rec.fields.employees).toBeGreaterThan(0);
    expect(rec.fields.employees).toBeLessThanOrEqual(5);
  });
});

describe('approvals', () => {
  it('routes time off to the manager and deducts approved vacation from the PTO balance', async () => {
    const noahUser = await demoUser(s, 'noah');
    const noah = await principal(s, 'noah');
    const hannah = await principal(s, 'hannah');
    const emp = (await s.records.query(hannah, 'employee', { filters: { match: 'all', rules: [{ field: 'user', op: 'eq', value: noahUser.id }] } })).records[0]!;
    const balance = Number(emp.fields.pto_balance);

    const req = await s.records.create(noah, 'time_off_request', { employee: emp.id, type: 'Vacation', start_date: '2031-06-02', end_date: '2031-06-04' });
    expect(req.fields.days).toBe(3);
    const approval = await s.approvals.submit(noah, req.id, { comment: 'Family trip' });
    expect((await s.records.get(noah, 'time_off_request', req.id)).fields.status).toBe('Submitted');
    await expect(s.approvals.submit(noah, req.id)).rejects.toBeInstanceOf(AppError);

    const approver = await s.users.principalForUser(approval.approverId);
    expect(approval.approverId).not.toBe(noahUser.id);
    expect((await s.approvals.listRequests(approver, { scope: 'to_me', status: 'pending' })).map((r) => r.id)).toContain(approval.id);
    await expect(s.approvals.decide(noah, approval.id, 'approve')).rejects.toBeInstanceOf(AppError);

    await s.approvals.decide(approver, approval.id, 'approve', 'Enjoy!');
    expect((await s.records.get(noah, 'time_off_request', req.id)).fields.status).toBe('Approved');
    expect((await s.records.get(hannah, 'employee', emp.id)).fields.pto_balance).toBe(balance - 3);
    await expect(s.approvals.decide(approver, approval.id, 'approve')).rejects.toBeInstanceOf(AppError);
  });

  it('auto-submits big discounts and applies reject actions so the record can be resubmitted', async () => {
    const james = await principal(s, 'james');
    const quote = await s.records.create(james, 'quote', { name: 'Discounted quote', discount: 30 });
    // The "Auto-submit large discounts" automation submits it for approval on save.
    expect(quote.fields.status).toBe('In Review');
    const [pending] = await s.approvals.listRequests(james, { scope: 'mine', status: 'pending', recordId: quote.id });
    expect(pending?.processName).toBe('Quote discount approval');
    const approver = await s.users.principalForUser(pending!.approverId);
    await s.approvals.decide(approver, pending!.id, 'reject', 'Too steep');
    expect((await s.records.get(james, 'quote', quote.id)).fields.status).toBe('Rejected');
    expect((await s.approvals.submit(james, quote.id)).status).toBe('pending');
  });
});

describe('sales', () => {
  it('converts a lead into an account, contact and opportunity exactly once', async () => {
    const lead = await s.records.create(maria, 'lead', { first_name: 'Cora', last_name: 'Vert', company: 'Conversion Labs', email: 'cora@conversionlabs.example', status: 'Qualified' });
    const result = await s.sales.convertLead(maria, lead.id, { createOpportunity: true });
    expect(result.account.name).toBe('Conversion Labs');
    expect(result.contact).toMatchObject({ name: 'Cora Vert', fields: { account: result.account.id, email: 'cora@conversionlabs.example' } });
    expect(result.opportunity?.fields.account).toBe(result.account.id);
    expect((await s.records.get(maria, 'lead', lead.id)).fields).toMatchObject({ status: 'Converted', converted_account: result.account.id });
    await expect(s.sales.convertLead(maria, lead.id)).rejects.toMatchObject({ status: 409 });
  });
});

describe('dashboards', () => {
  it('unsets an app home dashboard when the dashboard is deleted', async () => {
    const admin = await principal(s, 'admin');
    const [report] = await s.analytics.listReports();
    const dashboard = await s.analytics.createDashboard({ name: 'Temp', description: '', app: null, widgets: [{ reportId: report!.id, title: 'One', size: 1 }] }, null);
    const { id: _id, ...sales } = await s.apps.get('sales');
    await s.apps.save(admin, { ...sales, id: 'sales', dashboardId: dashboard.id });
    expect((await s.apps.get('sales')).dashboardId).toBe(dashboard.id);

    await s.analytics.deleteDashboard(dashboard.id);
    expect((await s.apps.get('sales')).dashboardId).toBeNull();
  });
});
