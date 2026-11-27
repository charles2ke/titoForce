import { describe, expect, it } from 'vitest';
import type { Db } from '../src/db/database.ts';
import { matchContacts, readableMatch } from '../src/platform/contact-points.ts';
import type { Principal } from '../src/platform/principal.ts';
import type { RecordService } from '../src/platform/records.ts';
import { notFound } from '../src/util.ts';

describe('contact point matching', () => {
  it('ranks readable matches without changing unrestricted matching', async () => {
    const rows = [
      { value: 'shared@example.com', field: 'email', id: 'contact-1', object_api_name: 'contact', name: 'Private contact', owner_id: 'other', updated_at: '2026-01-02' },
      { value: 'shared@example.com', field: 'email', id: 'lead-1', object_api_name: 'lead', name: 'Readable lead', owner_id: 'user-1', updated_at: '2026-01-01' },
    ];
    const db = { all: async () => rows } as unknown as Db;
    const principal = {
      type: 'user',
      userId: 'user-1',
      name: 'User',
      permissions: {
        setup: false,
        viewSensitive: false,
        manageAutomations: false,
        manageAgents: false,
        objects: {
          contact: { read: 'none' },
          lead: { read: 'all' },
        },
      },
    } as unknown as Principal;

    const records = {
      get: async (_principal: Principal, _object: string, id: string) => {
        if (id === 'contact-1') throw notFound();
        return { fields: { email: 'shared@example.com' } };
      },
    } as unknown as RecordService;
    expect((await matchContacts(db, 'email', ['shared@example.com'])).get('shared@example.com')?.object).toBe('contact');
    expect(await readableMatch(db, records, principal, 'email', ['shared@example.com'])).toMatchObject({
      recordId: 'lead-1',
      object: 'lead',
      name: 'Readable lead',
    });
    const hidden = { get: async () => ({ fields: {} }) } as unknown as RecordService;
    expect(await readableMatch(db, hidden, principal, 'email', ['shared@example.com'])).toBeNull();
  });
});
