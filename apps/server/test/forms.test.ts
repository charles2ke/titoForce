import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { SqlParam } from '../src/db/database.ts';
import { systemPrincipal } from '../src/platform/principal.ts';
import type { Services } from '../src/services.ts';
import { createTestServices } from './helpers.ts';

let s: Services;
const actor = systemPrincipal();

beforeAll(async () => { s = await createTestServices(); });
afterAll(async () => { await s?.close(); });

async function form(name: string, submissions: number | null = 0) {
  const record = await s.records.create(actor, 'web_form', {
    name, target_object: 'lead', form_fields: 'last_name,email', submissions,
    description: 'Original description', success_message: 'Thank you',
  });
  return record;
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => { resolve = r; });
  return { promise, resolve };
}

describe('web form submissions', () => {
  it('counts simultaneous submissions loaded from the same snapshot, without counting bots or invalid submissions', async () => {
    const first = await form('Concurrent form', 4);
    const second = await form('Other form');
    const ready = deferred();
    const release = deferred();
    const original = s.records.getRaw.bind(s.records);
    let loaded = 0;
    const spy = vi.spyOn(s.records, 'getRaw').mockImplementation(async (id, db) => {
      const record = await original(id, db);
      if (id === first.id && loaded < 6) {
        loaded++;
        if (loaded === 6) ready.resolve();
        await release.promise;
      }
      return record;
    });
    const results = Array.from({ length: 6 }, (_, i) =>
      s.forms.submit(first.id, { last_name: `Concurrent ${i}`, email: 'duplicate@example.com' }, `client-${i}`));
    try {
      await ready.promise;
      release.resolve();
      expect(await Promise.all(results)).toEqual(Array(6).fill({ message: 'Thank you' }));
    } finally {
      release.resolve();
      spy.mockRestore();
    }

    await s.forms.submit(first.id, { website_hp: 'bot' }, 'bot');
    await expect(s.forms.submit(first.id, { email: 'invalid' }, 'invalid')).rejects.toThrow();
    await s.forms.submit(second.id, { last_name: 'Other' }, 'other');
    const updated = await s.records.getRaw(first.id);
    expect(updated?.fields).toMatchObject({ submissions: 10, description: 'Original description', success_message: 'Thank you' });
    expect((await s.records.getRaw(second.id))?.fields.submissions).toBe(1);
    const leads = await s.db.get<{ n: number }>("SELECT COUNT(*) AS n FROM records WHERE object_api_name = 'lead' AND name LIKE 'Concurrent %'");
    expect(Number(leads?.n)).toBe(6);
    const history = await s.db.all<{ changes: string }>("SELECT changes FROM record_history WHERE record_id = ? AND event = 'updated'", [first.id]);
    expect(history.map((h) => JSON.parse(h.changes)[0]).sort((a, b) => a.from - b.from)).toEqual(
      Array.from({ length: 6 }, (_, i) => ({ field: 'submissions', from: i + 4, to: i + 5 })),
    );
    expect(updated?.updatedBy).toBeNull();
  });

  it('retries competing counter writes that read the same persisted value', async () => {
    const rec = await form('Counter race', 7);
    const ready = deferred();
    const release = deferred();
    const original = s.db.get.bind(s.db);
    let reads = 0;
    const spy = vi.spyOn(s.db, 'get').mockImplementation(async <T>(sql: string, params?: SqlParam[]) => {
      const result = await original<T>(sql, params);
      if (sql.startsWith('SELECT records.id,') && params?.[0] === rec.id && reads < 2) {
        reads++;
        if (reads === 2) ready.resolve();
        await release.promise;
      }
      return result;
    });
    const increments = [s.records.incrementFormSubmissions(actor, rec.id), s.records.incrementFormSubmissions(actor, rec.id)];
    try {
      await ready.promise;
      release.resolve();
      await Promise.all(increments);
    } finally {
      release.resolve();
      spy.mockRestore();
    }
    expect((await s.records.getRaw(rec.id))?.fields.submissions).toBe(9);
    const history = await s.db.all<{ changes: string }>("SELECT changes FROM record_history WHERE record_id = ? AND event = 'updated'", [rec.id]);
    expect(history.map((h) => JSON.parse(h.changes)[0]).sort((a, b) => a.from - b.from)).toEqual([
      { field: 'submissions', from: 7, to: 8 },
      { field: 'submissions', from: 8, to: 9 },
    ]);
  });

  it('starts a missing counter at zero and keeps the increment silent', async () => {
    const rec = await form('Missing counter');
    const expression = s.db.dialect === 'sqlite' ? "json_remove(data, '$.submissions')" : "data - 'submissions'";
    await s.db.run(`UPDATE records SET data = ${expression} WHERE id = ?`, [rec.id]);
    const emit = vi.spyOn(s.events, 'emit');
    try {
      await s.forms.submit(rec.id, { last_name: 'Missing counter lead' }, 'missing');
      expect(emit.mock.calls.filter(([event]) => event.object === 'web_form')).toHaveLength(0);
    } finally {
      emit.mockRestore();
    }
    const updated = await s.records.getRaw(rec.id);
    expect(updated?.fields).toMatchObject({ submissions: 1, description: 'Original description' });
    expect(updated?.ownerId).toBe(rec.ownerId);
    expect(updated!.updatedAt >= rec.updatedAt).toBe(true);
    const history = await s.db.get<{ changes: string }>("SELECT changes FROM record_history WHERE record_id = ? AND event = 'updated'", [rec.id]);
    expect(JSON.parse(history!.changes)).toContainEqual({ field: 'submissions', from: null, to: 1 });
  });

  it.each(['edit', 'increment'] as const)('retries a stale %s after the other write commits', async (stale) => {
    const rec = await form(`Metadata race ${stale}`, null);
    const ready = deferred();
    const release = deferred();
    const original = s.db.get.bind(s.db);
    let paused = false;
    const spy = vi.spyOn(s.db, 'get').mockImplementation(async <T>(sql: string, params?: SqlParam[]) => {
      const result = await original<T>(sql, params);
      if (!paused && sql.startsWith('SELECT records.id,') && params?.[0] === rec.id) {
        paused = true;
        ready.resolve();
        await release.promise;
      }
      return result;
    });
    const edit = () => s.records.update(actor, 'web_form', rec.id, { description: 'Changed description', name: 'Renamed form' });
    const increment = () => s.records.incrementFormSubmissions(actor, rec.id);
    const waiting = (stale === 'edit' ? edit : increment)();
    try {
      await ready.promise;
      await (stale === 'edit' ? increment : edit)();
      release.resolve();
      await waiting;
    } finally {
      release.resolve();
      spy.mockRestore();
    }
    const updated = await s.records.getRaw(rec.id);
    expect(updated?.name).toBe('Renamed form');
    expect(updated?.fields).toMatchObject({ submissions: 1, description: 'Changed description' });
    const history = await s.db.all<{ changes: string }>("SELECT changes FROM record_history WHERE record_id = ? AND event = 'updated'", [rec.id]);
    expect(history).toHaveLength(2);
    expect(history.flatMap((h) => JSON.parse(h.changes))).toContainEqual({ field: 'submissions', from: null, to: 1 });
  });

  it('compares PostgreSQL JSONB snapshots by value even if their serialized key order differs', async () => {
    const rec = await form('JSON snapshot');
    const ready = deferred();
    const release = deferred();
    const original = s.db.get.bind(s.db);
    let reads = 0;
    const spy = vi.spyOn(s.db, 'get').mockImplementation(async <T>(sql: string, params?: SqlParam[]) => {
      const result = await original<T>(sql, params);
      if (sql.startsWith('SELECT records.id,') && params?.[0] === rec.id) {
        reads++;
        if (reads === 1) {
          ready.resolve();
          await release.promise;
        }
      }
      return result;
    });
    const pending = s.records.incrementFormSubmissions(actor, rec.id);
    try {
      await ready.promise;
      const reordered = Object.fromEntries(Object.entries(rec.fields).reverse());
      await s.db.run('UPDATE records SET data = ? WHERE id = ?', [JSON.stringify(reordered, null, 2), rec.id]);
      release.resolve();
      await pending;
      // The final read returns the updated record; SQLite also retries its text comparison.
      expect(reads).toBe(s.db.dialect === 'postgres' ? 2 : 3);
    } finally {
      release.resolve();
      spy.mockRestore();
    }
    expect((await s.records.getRaw(rec.id))?.fields.submissions).toBe(1);
  });

  it.each(['web_form', 'account'] as const)('reports a concurrent %s deletion without phantom history', async (object) => {
    const rec = object === 'web_form'
      ? await form('Deleted during edit')
      : await s.records.create(actor, object, { name: 'Deleted during edit' });
    const ready = deferred();
    const release = deferred();
    const original = s.db.get.bind(s.db);
    let paused = false;
    const spy = vi.spyOn(s.db, 'get').mockImplementation(async <T>(sql: string, params?: SqlParam[]) => {
      const result = await original<T>(sql, params);
      if (!paused && sql.startsWith('SELECT records.id,') && params?.[0] === rec.id) {
        paused = true;
        ready.resolve();
        await release.promise;
      }
      return result;
    });
    const pending = s.records.update(actor, object, rec.id, { description: 'Should not be saved' });
    // Attach the rejection handler before releasing the blocked update.
    const outcome = pending.then(() => null, (err: unknown) => err);
    try {
      await ready.promise;
      await s.records.delete(actor, object, rec.id);
      release.resolve();
      expect(await outcome).toMatchObject({ status: 404 });
    } finally {
      release.resolve();
      spy.mockRestore();
    }
    const history = await s.db.all<{ event: string }>('SELECT event FROM record_history WHERE record_id = ?', [rec.id]);
    expect(history.map((h) => h.event).sort()).toEqual(['created', 'deleted']);
  });
});
