import type { ObjectDef, RecordData } from '@titoforce/shared';
import { type Db, parseJson } from '../db/database.ts';
import { AppError, chunk, placeholders } from '../util.ts';
import type { MetadataService } from './metadata.ts';
import type { Principal } from './principal.ts';
import type { RecordService } from './records.ts';

export type ContactKind = 'email' | 'phone';

/** Internal HR data is never matched against mail, meetings or calls. */
const EXCLUDED_OBJECTS = new Set(['employee']);
/** Preferred object when one address belongs to several records; other objects follow. */
const PRIORITY = ['contact', 'lead', 'account', 'candidate'];

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function normalizeEmail(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const v = value.trim().toLowerCase();
  return v.length <= 254 && EMAIL_RE.test(v) ? v : null;
}

/** Phone numbers are compared by their last 10 digits, so "+1 (415) 555-0100" matches "415.555.0100". Extensions are ignored. */
export function normalizePhone(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const digits = value.replace(/\s*(?:ext\.?|extension|x|#)\s*\d{1,6}\s*$/i, '').replace(/\D/g, '');
  return digits.length >= 7 && digits.length <= 15 ? digits.slice(-10) : null;
}

export const normalizeContact = (kind: ContactKind, value: unknown): string | null => (kind === 'email' ? normalizeEmail(value) : normalizePhone(value));

const contactFields = (def: ObjectDef) =>
  EXCLUDED_OBJECTS.has(def.apiName) ? [] : def.fields.filter((f): f is typeof f & { type: ContactKind } => f.type === 'email' || f.type === 'phone');

/** Whether a change to these fields requires re-indexing the record. */
export const touchesContactPoints = (def: ObjectDef, changed: Iterable<string>): boolean => {
  const names = new Set(contactFields(def).map((f) => f.apiName));
  for (const c of changed) if (names.has(c)) return true;
  return false;
};

/** Rewrites the email/phone index rows of one record (inside the record's write transaction). */
export async function indexContactPoints(tx: Db, def: ObjectDef, recordId: string, fields: RecordData, isNew = false): Promise<void> {
  const list = contactFields(def);
  if (!list.length) return;
  if (!isNew) await tx.run('DELETE FROM contact_points WHERE record_id = ?', [recordId]);
  for (const f of list) {
    const value = normalizeContact(f.type, fields[f.apiName]);
    if (value) {
      await tx.run('INSERT INTO contact_points (record_id, object_api_name, field, kind, value) VALUES (?, ?, ?, ?, ?)', [recordId, def.apiName, f.apiName, f.type, value]);
    }
  }
}

/** Indexes records created before the index existed. Runs once per database. */
export async function backfillContactPoints(db: Db, metadata: MetadataService): Promise<number> {
  const flag = 'contact_points_indexed';
  if (await db.get('SELECT 1 FROM settings WHERE key = ?', [flag])) return 0;
  let count = 0;
  for (const def of metadata.list()) {
    if (!contactFields(def).length) continue;
    const rows = await db.all<{ id: string; data: unknown }>('SELECT id, data FROM records WHERE object_api_name = ?', [def.apiName]);
    for (const part of chunk(rows, 200)) {
      await db.transaction(async (tx) => {
        for (const row of part) await indexContactPoints(tx, def, row.id, parseJson<RecordData>(row.data, {}));
      });
      count += part.length;
    }
  }
  await db.run('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO NOTHING', [flag, '1']);
  return count;
}

export interface ContactMatch {
  recordId: string;
  object: string;
  name: string;
  ownerId: string | null;
}

/**
 * Finds the best record for each email address or phone number (keys are normalized values): contacts first, then
 * leads, accounts, candidates and other objects; most recently updated wins within an object.
 */
export async function matchContacts(db: Db, kind: ContactKind, values: string[], access?: { principal: Principal; records: RecordService }): Promise<Map<string, ContactMatch>> {
  const wanted = [...new Set(values.map((v) => normalizeContact(kind, v)).filter((v): v is string => !!v))];
  const best = new Map<string, ContactMatch & { rank: number; updatedAt: string }>();
  for (const part of chunk(wanted, 200)) {
    const rows = await db.all<{ value: string; field: string; id: string; object_api_name: string; name: string; owner_id: string | null; updated_at: string }>(
      `SELECT cp.value, cp.field, r.id, r.object_api_name, r.name, r.owner_id, r.updated_at FROM contact_points cp JOIN records r ON r.id = cp.record_id
       WHERE cp.kind = ? AND cp.value IN (${placeholders(part.length)})`,
      [kind, ...part],
    );
    for (const r of rows) {
      if (access) {
        try {
          const record = await access.records.get(access.principal, r.object_api_name, r.id);
          if (!(r.field in record.fields)) continue;
        } catch (err) {
          if (err instanceof AppError && err.status === 404) continue;
          throw err;
        }
      }
      const rank = PRIORITY.includes(r.object_api_name) ? PRIORITY.indexOf(r.object_api_name) : PRIORITY.length;
      const current = best.get(r.value);
      if (!current || rank < current.rank || (rank === current.rank && r.updated_at > current.updatedAt)) {
        best.set(r.value, { recordId: r.id, object: r.object_api_name, name: r.name, ownerId: r.owner_id, rank, updatedAt: r.updated_at });
      }
    }
  }
  return new Map([...best].map(([k, { rank: _rank, updatedAt: _updatedAt, ...m }]) => [k, m]));
}

/** The match of the first value (in the order given) whose record the principal can read. */
export async function readableMatch(db: Db, records: RecordService, principal: Principal, kind: ContactKind, values: string[]): Promise<ContactMatch | null> {
  const matches = await matchContacts(db, kind, values, { principal, records });
  for (const v of values) {
    const m = matches.get(normalizeContact(kind, v) ?? '');
    if (m) return m;
  }
  return null;
}
