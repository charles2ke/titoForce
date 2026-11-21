import type { FieldDef, ObjectDef, RecordData } from '@titoforce/shared';
import { badRequest, parseCsv } from '../util.ts';
import type { MetadataService } from './metadata.ts';
import type { Principal } from './principal.ts';
import type { RecordService } from './records.ts';
import type { UserService } from './users.ts';

// Record ids are "<3-char key prefix>_<20 base36 chars>" (see newId).
const ID_RE = /^[a-z0-9]{3}_[a-z0-9]{20}$/;
const IGNORED_HEADERS = new Set(['id', 'created', 'updated', 'created_at', 'updated_at', 'created_by', 'updated_by']);
const SETTABLE = (f: FieldDef) => f.type !== 'formula' && f.type !== 'rollup';

export interface ImportColumn {
  header: string;
  field: string | null;
}

export interface PreparedImport {
  columns: ImportColumn[];
  rows: RecordData[];
}

/**
 * Turns CSV text (e.g. an export from titoForce or another CRM) into record inputs. Columns match
 * field API names or labels; lookup and user columns accept ids or exact names (or emails for users).
 */
export async function prepareCsvImport(
  deps: { metadata: MetadataService; records: RecordService; users: UserService },
  principal: Principal,
  object: string,
  csv: string,
): Promise<PreparedImport> {
  const def: ObjectDef = deps.metadata.require(object);
  const table = parseCsv(csv);
  if (table.length < 2) throw badRequest('The file needs a header row and at least one data row');
  if (table.length - 1 > 2000) throw badRequest('Import at most 2000 rows at a time');
  const norm = (s: string) => s.trim().toLowerCase();
  const columns: ImportColumn[] = table[0]!.map((header) => {
    const h = norm(header);
    if (h === 'owner' || h === 'owner_id') return { header, field: 'owner_id' };
    if (IGNORED_HEADERS.has(h)) return { header, field: null };
    const f = def.fields.find((x) => SETTABLE(x) && (x.apiName === h || norm(x.label) === h));
    return { header, field: f?.apiName ?? null };
  });
  if (!columns.some((c) => c.field && c.field !== 'owner_id')) throw badRequest(`No columns match fields of ${def.label}`);

  const users = await deps.users.listUsers(false);
  const userCache = new Map<string, string | null>();
  const resolveUser = (value: string): string | null => {
    const key = norm(value);
    if (!userCache.has(key)) userCache.set(key, users.find((u) => u.id === value || norm(u.email) === key || norm(u.name) === key)?.id ?? null);
    return userCache.get(key)!;
  };
  const lookupCache = new Map<string, string | null>();
  const resolveLookup = async (target: string, value: string): Promise<string | null> => {
    if (ID_RE.test(value)) return value;
    const key = `${target}:${norm(value)}`;
    if (!lookupCache.has(key)) {
      const res = await deps.records.query(principal, target, { filters: { match: 'all', rules: [{ field: 'name', op: 'eq', value }] }, pageSize: 2 });
      lookupCache.set(key, res.total === 1 ? res.records[0]!.id : null);
    }
    return lookupCache.get(key)!;
  };

  const rows: RecordData[] = [];
  for (const cells of table.slice(1)) {
    const row: RecordData = {};
    for (const [i, col] of columns.entries()) {
      const raw = (cells[i] ?? '').trim();
      if (!col.field || raw === '') continue;
      if (col.field === 'owner_id') {
        // Unknown owners are kept as-is so the row fails with a clear error instead of silently changing owner.
        row.owner_id = resolveUser(raw) ?? raw;
        continue;
      }
      const f = def.fields.find((x) => x.apiName === col.field)!;
      if (f.type === 'user') row[f.apiName] = resolveUser(raw) ?? raw;
      else if (f.type === 'lookup' && f.referenceTo && f.referenceTo !== '*') row[f.apiName] = (await resolveLookup(f.referenceTo, raw)) ?? raw;
      else if (f.type === 'multipicklist') row[f.apiName] = raw.split(/[;,]/);
      else row[f.apiName] = raw;
    }
    rows.push(row);
  }
  return { columns, rows };
}
