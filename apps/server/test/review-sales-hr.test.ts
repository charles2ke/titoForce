import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { CrmRecord, QueryResponse } from '@titoforce/shared';
import { loadConfig } from '../src/config.ts';
import type { Principal } from '../src/platform/principal.ts';
import type { Services } from '../src/services.ts';
import { createTestServices, principal } from './helpers.ts';

let s: Services;
let maria: Principal;

beforeAll(async () => {
  s = await createTestServices();
  maria = await principal(s, 'maria');
});
afterAll(() => s?.close());

describe('review regressions', () => {
  it('resolves web dist overrides from the repository root and preserves absolute paths', () => {
    const root = new URL('../../../', import.meta.url).pathname;
    expect(loadConfig({ TITO_WEB_DIST: 'apps/web/dist' }).webDist).toBe(`${root}apps/web/dist`);
    expect(loadConfig({ TITO_WEB_DIST: '/tmp/other-dist' }).webDist).toBe('/tmp/other-dist');
    expect(loadConfig({}).webDist).toBe(`${root}apps/web/dist`);
  });

  it('preserves the lead owner on newly created conversion records', async () => {
    const james = await principal(s, 'james');
    const lead = await s.records.create(james, 'lead', { first_name: 'Owned', last_name: 'Lead', company: 'Ownership Labs', status: 'Qualified' });
    const result = await s.sales.convertLead(maria, lead.id);
    for (const record of [result.account, result.contact, result.opportunity!]) {
      expect(record.ownerId).toBe(james.userId);
      await expect(s.records.update(james, record.object, record.id, {})).resolves.toBeDefined();
    }
  });

  it('indicates when forecast totals exclude matching opportunities', async () => {
    const record = {
      id: 'opp-test', object: 'opportunity', name: 'Test', ownerId: maria.userId,
      createdAt: '', updatedAt: '', createdBy: null, updatedBy: null,
      fields: { amount: 1, stage: 'Prospecting', probability: 10, close_date: new Date().toISOString().slice(0, 10) },
    } as CrmRecord;
    let total = 10_000;
    const spy = vi.spyOn(s.records, 'query').mockImplementation(async (_principal, _object, query) => ({
      records: Array(500).fill(record), total, page: query?.page ?? 1, pageSize: 500, refs: {},
    } as QueryResponse));
    try {
      expect(await s.sales.forecast(maria)).toMatchObject({ totals: { count: 10_000 }, matchingCount: 10_000, truncated: false });
      total = 10_001;
      expect(await s.sales.forecast(maria)).toMatchObject({ totals: { count: 10_000 }, matchingCount: 10_001, truncated: true });
    } finally {
      spy.mockRestore();
    }
  });

  it('includes employees beyond the first 5,000 and their reporting links', async () => {
    const spy = vi.spyOn(s.records, 'query').mockImplementation(async (_principal, _object, query) => {
      const page = query?.page ?? 1;
      const records = Array.from({ length: page <= 10 ? 500 : 1 }, (_, i) => ({
        id: `emp-${(page - 1) * 500 + i}`, object: 'employee', name: `Employee ${(page - 1) * 500 + i}`,
        fields: page === 11 ? { manager: 'emp-0' } : {},
      } as CrmRecord));
      return { records, total: 5001, page, pageSize: 500, refs: {} };
    });
    try {
      const nodes = await s.hr.orgChart(maria);
      expect(nodes).toHaveLength(5001);
      expect(nodes[5000]?.managerId).toBe('emp-0');
      expect(nodes[0]?.directReports).toBe(1);
    } finally {
      spy.mockRestore();
    }
  });
});
