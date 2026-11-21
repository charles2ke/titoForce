import { describe, expect, it } from 'vitest';
import { matchesFilter, resolveDateLiteral, toApiName } from '../src/filters.ts';

const now = new Date('2026-05-20T12:00:00.000Z'); // a Wednesday

describe('date literals', () => {
  it('resolves relative ranges in UTC', () => {
    expect(resolveDateLiteral('TODAY', now)).toEqual({ start: '2026-05-20', end: '2026-05-20' });
    expect(resolveDateLiteral('THIS_WEEK', now)).toEqual({ start: '2026-05-18', end: '2026-05-24' });
    expect(resolveDateLiteral('THIS_MONTH', now)).toEqual({ start: '2026-05-01', end: '2026-05-31' });
    expect(resolveDateLiteral('LAST_QUARTER', now)).toEqual({ start: '2026-01-01', end: '2026-03-31' });
    expect(resolveDateLiteral('NEXT_N_DAYS:10', now)).toEqual({ start: '2026-05-20', end: '2026-05-30' });
    expect(resolveDateLiteral('2026-01-01', now)).toBeNull();
  });
});

describe('matchesFilter', () => {
  const rec = { stage: 'Negotiation', amount: 75000, close_date: '2026-05-28', tags: ['VIP', 'EMEA'], owner_id: 'u1', email: '' };

  it('applies all/any semantics with typed comparisons', () => {
    expect(matchesFilter({ match: 'all', rules: [{ field: 'stage', op: 'eq', value: 'negotiation' }, { field: 'amount', op: 'gte', value: '50000' }] }, rec)).toBe(true);
    expect(matchesFilter({ match: 'all', rules: [{ field: 'stage', op: 'in', value: ['Closed Won', 'Closed Lost'] }] }, rec)).toBe(false);
    expect(matchesFilter({ match: 'any', rules: [{ field: 'amount', op: 'lt', value: 10 }, { field: 'email', op: 'is_empty' }] }, rec)).toBe(true);
    expect(matchesFilter(null, rec)).toBe(true);
  });

  it('supports date literals, multipicklists and CURRENT_USER', () => {
    const opts = { now, currentUserId: 'u1', types: { close_date: 'date', tags: 'multipicklist' } as const };
    expect(matchesFilter({ match: 'all', rules: [{ field: 'close_date', op: 'eq', value: 'THIS_MONTH' }] }, rec, opts)).toBe(true);
    expect(matchesFilter({ match: 'all', rules: [{ field: 'close_date', op: 'lt', value: 'TODAY' }] }, rec, opts)).toBe(false);
    expect(matchesFilter({ match: 'all', rules: [{ field: 'tags', op: 'contains', value: 'vip' }] }, rec, opts)).toBe(true);
    expect(matchesFilter({ match: 'all', rules: [{ field: 'owner_id', op: 'eq', value: 'CURRENT_USER' }] }, rec, opts)).toBe(true);
  });
});

describe('toApiName', () => {
  it('produces safe snake_case identifiers', () => {
    expect(toApiName('Annual Revenue ($)')).toBe('annual_revenue');
    expect(toApiName('2nd Contact')).toBe('f_2nd_contact');
    expect(toApiName('Société Générale')).toBe('societe_generale');
  });
});
