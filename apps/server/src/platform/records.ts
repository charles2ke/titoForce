import {
  type CrmRecord,
  evaluateExpression,
  type RecordAccess,
  type FieldDef,
  type FilterGroup,
  isBlank,
  type ObjectDef,
  type QueryResponse,
  type RecordData,
  type RecordQuery,
  type RefMap,
  renderTemplate,
  type SearchResultGroup,
  stringify,
  type TimelineItem,
  toDateOnlyString,
  truthy,
} from '@titoforce/shared';
import { type Db, jsonText, parseJson, type SqlParam } from '../db/database.ts';
import { AppError, badRequest, chunk, clamp, forbidden, newId, notFound, nowIso, placeholders, truncate } from '../util.ts';
import type { EventBus } from './events.ts';
import { isComputedField, type MetadataService } from './metadata.ts';
import { assertCanCreate, assertCanReadObject, canChangeOwner, canSeeField, fieldAccessOf, objectPermission, type Principal } from './principal.ts';
import { type BuildContext, fieldExpr, filterSql, searchTermsSql, sortSql } from './query-builder.ts';
import { type Predicate, type SharingService, sharedRecordsSql } from './sharing.ts';
import type { UserService } from './users.ts';

interface RecordRow {
  id: string;
  object_api_name: string;
  name: string;
  owner_id: string | null;
  data: unknown;
  created_at: string;
  updated_at: string;
  created_by: string | null;
  updated_by: string | null;
}

const COLUMNS =
  'records.id, records.object_api_name, records.name, records.owner_id, records.data, records.created_at, records.updated_at, records.created_by, records.updated_by';

export function rowToRecord(row: RecordRow): CrmRecord {
  return {
    id: row.id,
    object: row.object_api_name,
    name: row.name,
    ownerId: row.owner_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    createdBy: row.created_by,
    updatedBy: row.updated_by,
    fields: parseJson<RecordData>(row.data, {}),
  };
}

/** Flattens a record into a single map: fields plus system values (used by formulas, conditions and templates). */
export function toFlat(record: CrmRecord): Record<string, unknown> {
  return {
    ...record.fields,
    id: record.id,
    name: record.name,
    owner_id: record.ownerId,
    created_at: record.createdAt,
    updated_at: record.updatedAt,
    created_by: record.createdBy,
    updated_by: record.updatedBy,
  };
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const REF_RE = /^[a-z0-9_]{1,64}$/i;
const SEARCHABLE = new Set(['text', 'email', 'phone', 'url', 'picklist', 'multipicklist', 'longtext']);

const round = (n: number, places: number): number => Math.round(n * 10 ** places) / 10 ** places;

const ALL: Predicate = { sql: '1 = 1', params: [] };
const NONE: Predicate = { sql: '1 = 0', params: [] };

/** Records of one object that a principal may read, edit and delete, as SQL conditions on the `records` table. */
export interface AccessScope {
  read: Predicate;
  edit: Predicate;
  delete: Predicate;
}

/** Validates and normalizes a raw input value for a field. Blank values become null. */
export function coerceValue(field: FieldDef, raw: unknown): unknown {
  if (raw === undefined || raw === null || raw === '' || (Array.isArray(raw) && raw.length === 0)) return null;
  const fail = (msg: string) => badRequest(`${field.label}: ${msg}`, { field: field.apiName });
  switch (field.type) {
    case 'text':
    case 'phone': {
      if (typeof raw !== 'string' && typeof raw !== 'number') throw fail('expected text');
      const s = String(raw).trim();
      const max = field.type === 'phone' ? 40 : 255;
      if (s.length > max) throw fail(`must be at most ${max} characters`);
      return s || null;
    }
    case 'longtext': {
      if (typeof raw !== 'string') throw fail('expected text');
      if (raw.length > 32_000) throw fail('must be at most 32000 characters');
      return raw.trim() ? raw : null;
    }
    case 'email': {
      const s = String(raw).trim().toLowerCase();
      if (!EMAIL_RE.test(s) || s.length > 254) throw fail('invalid email address');
      return s;
    }
    case 'url': {
      let s = String(raw).trim();
      if (!/^[a-z][a-z0-9+.-]*:/i.test(s)) s = `https://${s}`;
      let u: URL;
      try {
        u = new URL(s);
      } catch {
        throw fail('invalid URL');
      }
      if (u.protocol !== 'http:' && u.protocol !== 'https:') throw fail('only http and https URLs are allowed');
      if (s.length > 1000) throw fail('URL is too long');
      return s;
    }
    case 'number':
    case 'currency':
    case 'percent': {
      const n = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number(raw.replace(/[,\s$€£%]/g, '')) : Number.NaN;
      if (!Number.isFinite(n)) throw fail('expected a number');
      const places = field.precision ?? (field.type === 'currency' ? 2 : undefined);
      return places === undefined ? n : round(n, places);
    }
    case 'date': {
      const s = String(raw).trim();
      const d = DATE_RE.test(s) ? new Date(`${s}T00:00:00.000Z`) : new Date(s);
      if (Number.isNaN(d.getTime()) || (DATE_RE.test(s) && toDateOnlyString(d) !== s)) throw fail('invalid date');
      return toDateOnlyString(d);
    }
    case 'datetime': {
      const d = new Date(String(raw));
      if (Number.isNaN(d.getTime())) throw fail('invalid date/time');
      return d.toISOString();
    }
    case 'checkbox': {
      if (typeof raw === 'boolean') return raw;
      const s = String(raw).trim().toLowerCase();
      if (['true', '1', 'yes', 'y', 'on'].includes(s)) return true;
      if (['false', '0', 'no', 'n', 'off'].includes(s)) return false;
      throw fail('expected true or false');
    }
    case 'picklist': {
      const s = String(raw).trim();
      const opt = field.options?.find((o) => o.value.toLowerCase() === s.toLowerCase());
      if (!opt) throw fail(`"${s}" is not a valid value`);
      return opt.value;
    }
    case 'multipicklist': {
      const list = Array.isArray(raw) ? raw : String(raw).split(/[;,]/);
      const out: string[] = [];
      for (const item of list) {
        const s = String(item).trim();
        if (!s) continue;
        const opt = field.options?.find((o) => o.value.toLowerCase() === s.toLowerCase());
        if (!opt) throw fail(`"${s}" is not a valid value`);
        if (!out.includes(opt.value)) out.push(opt.value);
      }
      return out.length ? out : null;
    }
    case 'lookup':
    case 'user':
      if (typeof raw !== 'string' || !REF_RE.test(raw)) throw fail('invalid reference');
      return raw;
    default:
      throw fail('this field cannot be set');
  }
}

function coerceFormula(f: FieldDef, v: unknown): unknown {
  if (isBlank(v)) return f.formulaType === 'checkbox' ? false : null;
  switch (f.formulaType) {
    case 'text':
      return truncate(stringify(v), 1000);
    case 'checkbox':
      return truthy(v);
    case 'date': {
      const d = typeof v === 'string' && DATE_RE.test(v) ? new Date(`${v}T00:00:00.000Z`) : new Date(String(v));
      return Number.isNaN(d.getTime()) ? null : toDateOnlyString(d);
    }
    default: {
      const n = typeof v === 'number' ? v : typeof v === 'boolean' ? Number(v) : Number(v);
      return Number.isFinite(n) ? round(n, f.precision ?? 2) : null;
    }
  }
}

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

export interface WriteOptions {
  /** Skip events (and therefore automations), e.g. for seeding. */
  silent?: boolean;
  /** Save even when duplicate rules match. */
  allowDuplicates?: boolean;
  /** Backdated created/updated timestamp (seeding only). */
  timestamp?: string;
}

export interface RelatedList {
  object: string;
  field: string;
  label: string;
  total: number;
  records: CrmRecord[];
}

export interface FieldChange {
  field: string;
  from: unknown;
  to: unknown;
}

export class RecordService {
  private db: Db;
  private metadata: MetadataService;
  private users: UserService;
  private sharing: SharingService;
  private events: EventBus;

  constructor(db: Db, metadata: MetadataService, users: UserService, sharing: SharingService, events: EventBus) {
    this.db = db;
    this.metadata = metadata;
    this.users = users;
    this.sharing = sharing;
    this.events = events;
  }

  // ---------- access ----------

  /**
   * Which records of an object the principal may read, edit and delete. `own` access covers the principal's records
   * plus those shared with their role by sharing rules; `edit` rules also allow editing. Sharing never grants delete.
   */
  async accessScope(principal: Principal, def: ObjectDef, db: Db = this.db): Promise<AccessScope> {
    const perm = objectPermission(principal, def.apiName);
    if (perm.read === 'none') return { read: NONE, edit: NONE, delete: NONE };
    const readAll = perm.read === 'all';
    const rules = !readAll || perm.edit === 'own' ? await this.sharing.rulesFor(principal, def.apiName, db) : [];
    const ctx = this.ctx(principal, def, db);
    return {
      read: readAll ? ALL : sharedRecordsSql(ctx, principal.userId, rules),
      edit:
        perm.edit === 'none' ? NONE : readAll && perm.edit === 'all' ? ALL : sharedRecordsSql(ctx, principal.userId, rules.filter((r) => r.access === 'edit')),
      delete: perm.delete === 'none' ? NONE : readAll && perm.delete === 'all' ? ALL : sharedRecordsSql(ctx, principal.userId, []),
    };
  }

  /** The principal's access to one record of the object (all false when it does not exist). */
  async recordAccess(principal: Principal, def: ObjectDef, id: string, db: Db = this.db): Promise<RecordAccess & { read: boolean }> {
    const scope = await this.accessScope(principal, def, db);
    const row = await db.get<{ r: number; e: number; d: number }>(
      `SELECT CASE WHEN ${scope.read.sql} THEN 1 ELSE 0 END AS r, CASE WHEN ${scope.edit.sql} THEN 1 ELSE 0 END AS e,
       CASE WHEN ${scope.delete.sql} THEN 1 ELSE 0 END AS d FROM records WHERE records.id = ? AND records.object_api_name = ?`,
      [...scope.read.params, ...scope.edit.params, ...scope.delete.params, id, def.apiName],
    );
    const read = !!Number(row?.r ?? 0);
    return { read, edit: read && !!Number(row?.e ?? 0), delete: read && !!Number(row?.d ?? 0) };
  }

  /** The ids among `ids` (records of one object) that the principal can read. */
  private async readableIds(principal: Principal, object: string, ids: string[]): Promise<Set<string>> {
    const def = this.metadata.get(object);
    if (!def || !ids.length) return new Set();
    const { read } = await this.accessScope(principal, def);
    if (read === ALL) return new Set(ids);
    if (read === NONE) return new Set();
    const out = new Set<string>();
    for (const part of chunk(ids, 300)) {
      const rows = await this.db.all<{ id: string }>(`SELECT records.id FROM records WHERE records.id IN (${placeholders(part.length)}) AND ${read.sql}`, [
        ...part,
        ...read.params,
      ]);
      for (const r of rows) out.add(r.id);
    }
    return out;
  }

  /** A record as the principal sees it: hidden fields removed, plus what they may do with it. */
  private present(principal: Principal, rec: CrmRecord, access: RecordAccess): CrmRecord {
    return { ...this.redact(principal, rec), access: { edit: access.edit, delete: access.delete } };
  }

  // ---------- reads ----------

  /** Loads a record without permission checks (internal use). */
  async getRaw(id: string, db: Db = this.db): Promise<CrmRecord | undefined> {
    const row = await db.get<RecordRow>(`SELECT ${COLUMNS} FROM records WHERE id = ?`, [id]);
    return row ? rowToRecord(row) : undefined;
  }

  /** Loads a readable record of the expected object (or any object when omitted). Unreadable records are reported as not found. */
  async get(principal: Principal, object: string | null, id: string): Promise<CrmRecord> {
    const rec = await this.getRaw(id);
    const def = rec && (!object || rec.object === object) ? this.metadata.get(rec.object) : undefined;
    if (!rec || !def) throw notFound('Record not found');
    const access = await this.recordAccess(principal, def, rec.id);
    if (!access.read) throw notFound('Record not found');
    return this.present(principal, rec, access);
  }

  /** Removes the fields the principal may not see (field-level security). */
  redact(principal: Principal, rec: CrmRecord): CrmRecord {
    if (!principal.permissions) return rec;
    const def = this.metadata.get(rec.object);
    const hidden = def?.fields.filter((f) => !canSeeField(principal, def.apiName, f)).map((f) => f.apiName) ?? [];
    if (!hidden.some((h) => h in rec.fields)) return rec;
    const fields = { ...rec.fields };
    for (const h of hidden) delete fields[h];
    return { ...rec, fields };
  }

  private assertFieldsVisible(principal: Principal, def: ObjectDef, names: string[]): void {
    if (!principal.permissions) return;
    for (const n of names) {
      const f = def.fields.find((x) => x.apiName === n);
      if (f && !canSeeField(principal, def.apiName, f)) throw forbidden(`You do not have access to ${f.label}`);
    }
  }

  /** WHERE clause for the readable records of an object (sharing + filters + free text), and the principal's access scope. */
  async buildWhere(
    principal: Principal,
    def: ObjectDef,
    filters?: FilterGroup | null | (FilterGroup | null | undefined)[],
    q?: string | null,
    db: Db = this.db,
  ): Promise<{ sql: string; params: SqlParam[]; scope: AccessScope }> {
    assertCanReadObject(principal, def.apiName);
    // Several groups are ANDed together (e.g. a list view's filters plus ad-hoc filters).
    const groups = (Array.isArray(filters) ? filters : [filters]).filter((g): g is FilterGroup => !!g?.rules?.length);
    const parts = ['records.object_api_name = ?'];
    const params: SqlParam[] = [def.apiName];
    for (const group of groups) {
      this.assertFieldsVisible(principal, def, group.rules.map((r) => r.field));
      const f = filterSql(this.ctx(principal, def, db), group);
      parts.push(f.sql);
      params.push(...f.params);
    }
    const scope = await this.accessScope(principal, def, db);
    if (scope.read !== ALL) {
      parts.push(scope.read.sql);
      params.push(...scope.read.params);
    }
    if (q?.trim()) {
      const s = searchTermsSql(q);
      parts.push(s.sql);
      params.push(...s.params);
    }
    return { sql: parts.join(' AND '), params, scope };
  }

  ctx(principal: Principal | null, def: ObjectDef, db: Db = this.db): BuildContext {
    return { db, def, currentUserId: principal?.userId ?? null, now: new Date() };
  }

  async query(principal: Principal, object: string, query: RecordQuery = {}): Promise<QueryResponse> {
    const def = this.metadata.require(object);
    const where = await this.buildWhere(principal, def, [query.filters, ...(query.andFilters ?? [])], query.q);
    const pageSize = clamp(Math.floor(query.pageSize ?? 50), 1, 500);
    const page = Math.max(1, Math.floor(query.page ?? 1));
    const sort = query.sort?.field ? query.sort : { field: 'updated_at', dir: 'desc' as const };
    this.assertFieldsVisible(principal, def, [sort.field]);
    const order = sortSql(this.ctx(principal, def), sort);
    const { edit, delete: del } = where.scope;
    const total = await this.db.get<{ c: number }>(`SELECT COUNT(*) AS c FROM records WHERE ${where.sql}`, where.params);
    const rows = await this.db.all<RecordRow & { can_edit: number; can_delete: number }>(
      `SELECT ${COLUMNS}, CASE WHEN ${edit.sql} THEN 1 ELSE 0 END AS can_edit, CASE WHEN ${del.sql} THEN 1 ELSE 0 END AS can_delete
       FROM records WHERE ${where.sql} ORDER BY ${order} LIMIT ? OFFSET ?`,
      [...edit.params, ...del.params, ...where.params, pageSize, (page - 1) * pageSize],
    );
    const records = rows.map((r) => this.present(principal, rowToRecord(r), { edit: !!Number(r.can_edit), delete: !!Number(r.can_delete) }));
    return { records, total: Number(total?.c ?? 0), page, pageSize, refs: await this.resolveRefs(principal, records) };
  }

  /** Global search across every object the principal can read. */
  async search(principal: Principal, text: string, opts: { objects?: string[]; limit?: number } = {}): Promise<SearchResultGroup[]> {
    if (!text.trim()) return [];
    const limit = clamp(opts.limit ?? 5, 1, 50);
    const out: SearchResultGroup[] = [];
    for (const def of this.metadata.list()) {
      if (opts.objects && !opts.objects.includes(def.apiName)) continue;
      if (objectPermission(principal, def.apiName).read === 'none') continue;
      const where = await this.buildWhere(principal, def, null, text);
      const rows = await this.db.all<RecordRow>(
        `SELECT ${COLUMNS} FROM records WHERE ${where.sql} ORDER BY CASE WHEN LOWER(records.name) LIKE ? ESCAPE '\\' THEN 0 ELSE 1 END, records.updated_at DESC LIMIT ?`,
        [...where.params, `%${text.trim().toLowerCase().replace(/[\\%_]/g, (m) => `\\${m}`)}%`, limit],
      );
      if (rows.length) {
        out.push({
          object: def.apiName,
          label: def.pluralLabel,
          records: rows.map((r) => {
            const rec = this.redact(principal, rowToRecord(r));
            return { id: rec.id, name: rec.name, subtitle: this.subtitle(def, rec) };
          }),
        });
      }
    }
    return out;
  }

  private subtitle(def: ObjectDef, rec: CrmRecord): string | undefined {
    for (const name of def.highlightFields ?? []) {
      const f = def.fields.find((x) => x.apiName === name);
      if (!f || f.type === 'lookup' || f.type === 'user' || f.sensitive) continue;
      const v = rec.fields[name];
      if (!isBlank(v)) return stringify(v);
    }
    return undefined;
  }

  /** Child records that reference this record (related lists). */
  async related(principal: Principal, object: string, id: string): Promise<{ lists: RelatedList[]; refs: RefMap }> {
    const def = this.metadata.require(object);
    await this.get(principal, object, id);
    const lists: RelatedList[] = [];
    const refs: RefMap = {};
    const refsFrom = this.metadata.referencingFields(object);
    for (const { object: child, field } of refsFrom) {
      if (child.apiName === 'activity' && field.apiName === 'related_to') continue; // shown on the timeline
      if (objectPermission(principal, child.apiName).read === 'none') continue;
      if (!canSeeField(principal, child.apiName, field)) continue;
      const res = await this.query(principal, child.apiName, {
        filters: { match: 'all', rules: [{ field: field.apiName, op: 'eq', value: id }] },
        pageSize: 10,
      });
      if (field.referenceTo === '*' && res.total === 0) continue;
      const ambiguous = refsFrom.filter((r) => r.object.apiName === child.apiName).length > 1 || child.apiName === def.apiName;
      lists.push({
        object: child.apiName,
        field: field.apiName,
        label: ambiguous ? `${child.pluralLabel} (${field.label})` : child.pluralLabel,
        total: res.total,
        records: res.records,
      });
      Object.assign(refs, res.refs);
    }
    return { lists, refs };
  }

  /** Activities, field history and agent runs for a record, newest first. */
  async timeline(principal: Principal, object: string, id: string): Promise<{ items: TimelineItem[]; refs: RefMap }> {
    const def = this.metadata.require(object);
    await this.get(principal, object, id);
    const items: TimelineItem[] = [];
    let refs: RefMap = {};
    const activity = this.metadata.get('activity');
    const relatedTo = activity?.fields.find((f) => f.apiName === 'related_to');
    if (relatedTo && objectPermission(principal, 'activity').read !== 'none' && canSeeField(principal, 'activity', relatedTo)) {
      const res = await this.query(principal, 'activity', {
        filters: { match: 'all', rules: [{ field: 'related_to', op: 'eq', value: id }] },
        pageSize: 200,
        sort: { field: 'created_at', dir: 'desc' },
      });
      refs = res.refs;
      for (const a of res.records) {
        items.push({
          id: a.id,
          kind: 'activity',
          at: a.createdAt,
          title: a.name,
          body: (a.fields.description as string | undefined) ?? null,
          actorName: a.ownerId ? (res.refs[a.ownerId]?.name ?? null) : null,
          actorType: 'user',
          recordId: a.id,
          activityType: (a.fields.type as string | undefined) ?? 'Task',
          status: a.fields.status as string | undefined,
          dueDate: (a.fields.due_date as string | undefined) ?? null,
        });
      }
    }

    const history = await this.db.all<{ id: string; event: string; changes: unknown; actor_type: string; actor_name: string | null; created_at: string }>(
      'SELECT id, event, changes, actor_type, actor_name, created_at FROM record_history WHERE record_id = ? ORDER BY created_at DESC LIMIT 200',
      [id],
    );
    const hidden = new Set(def.fields.filter((f) => !canSeeField(principal, def.apiName, f)).map((f) => f.apiName));
    const lookupIds = new Set<string>();
    const parsed = history.map((h) => ({ ...h, list: parseJson<FieldChange[]>(h.changes, []) }));
    for (const h of parsed) {
      for (const c of h.list) {
        const f = def.fields.find((x) => x.apiName === c.field);
        if (hidden.has(c.field)) continue;
        if (f?.type === 'lookup' || f?.type === 'user' || c.field === 'owner_id') {
          for (const v of [c.from, c.to]) if (typeof v === 'string') lookupIds.add(v);
        }
      }
    }
    const names = await this.resolveIds(principal, [...lookupIds]);
    for (const h of parsed) {
      const changes = h.list
        .map((c) => {
          const f = def.fields.find((x) => x.apiName === c.field);
          if (f && hidden.has(f.apiName)) return { field: c.field, label: f.label, from: '•••', to: '•••' };
          const display = (v: unknown) => (typeof v === 'string' && names[v] ? names[v].name : v);
          return { field: c.field, label: c.field === 'owner_id' ? 'Owner' : (f?.label ?? c.field), from: display(c.from), to: display(c.to) };
        })
        .filter((c) => def.fields.some((f) => f.apiName === c.field) || c.field === 'owner_id');
      if (h.event === 'updated' && !changes.length) continue;
      items.push({
        id: h.id,
        kind: 'history',
        at: h.created_at,
        title: h.event === 'created' ? `${def.label} created` : h.event === 'updated' ? 'Fields updated' : h.event,
        actorName: h.actor_name,
        actorType: (['user', 'agent', 'automation', 'approval'].includes(h.actor_type) ? h.actor_type : 'system') as TimelineItem['actorType'],
        changes,
      });
    }

    const runs = await this.db.all<{ id: string; agent_id: string; status: string; input: string; output: string | null; created_at: string; definition: unknown }>(
      `SELECT r.id, r.agent_id, r.status, r.input, r.output, r.created_at, a.definition FROM agent_runs r
       LEFT JOIN agents a ON a.id = r.agent_id WHERE r.record_id = ? ORDER BY r.created_at DESC LIMIT 20`,
      [id],
    );
    for (const r of runs) {
      const agentName = parseJson<{ name?: string }>(r.definition, {}).name ?? 'Agent';
      items.push({
        id: r.id,
        kind: 'agent',
        at: r.created_at,
        title: `${agentName}: ${truncate(r.input, 120)}`,
        body: r.output,
        actorName: agentName,
        actorType: 'agent',
        status: r.status,
      });
    }
    items.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
    return { items, refs };
  }

  /** Display names for record and user ids, respecting read access. */
  async resolveIds(principal: Principal, ids: string[]): Promise<RefMap> {
    const refs: RefMap = {};
    const unique = [...new Set(ids.filter((x) => typeof x === 'string' && REF_RE.test(x)))];
    for (const part of chunk(unique, 300)) {
      const rows = await this.db.all<{ id: string; name: string; object_api_name: string }>(
        `SELECT id, name, object_api_name FROM records WHERE id IN (${placeholders(part.length)})`,
        part,
      );
      const readable = new Set<string>();
      for (const object of new Set(rows.map((r) => r.object_api_name))) {
        const ids = rows.filter((r) => r.object_api_name === object).map((r) => r.id);
        for (const id of await this.readableIds(principal, object, ids)) readable.add(id);
      }
      for (const r of rows) {
        refs[r.id] = readable.has(r.id) ? { name: r.name, object: r.object_api_name } : { name: '(restricted)', object: r.object_api_name };
      }
      const missing = part.filter((x) => !refs[x]);
      if (missing.length) {
        const users = await this.db.all<{ id: string; name: string }>(`SELECT id, name FROM users WHERE id IN (${placeholders(missing.length)})`, missing);
        for (const u of users) refs[u.id] = { name: u.name, object: 'user' };
      }
    }
    return refs;
  }

  async resolveRefs(principal: Principal, records: CrmRecord[]): Promise<RefMap> {
    const ids: string[] = [];
    for (const r of records) {
      for (const v of [r.ownerId, r.createdBy, r.updatedBy]) if (v) ids.push(v);
      for (const f of this.metadata.get(r.object)?.fields ?? []) {
        const v = r.fields[f.apiName];
        if ((f.type === 'lookup' || f.type === 'user') && typeof v === 'string') ids.push(v);
      }
    }
    return this.resolveIds(principal, ids);
  }

  // ---------- writes ----------

  /** Validates input values. On updates, `current` lets clients send back unchanged values of read-only fields. */
  private coerceInput(principal: Principal, def: ObjectDef, input: RecordData, current?: CrmRecord): { values: RecordData; ownerId: string | null | undefined } {
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw badRequest('Record fields must be an object');
    const values: RecordData = {};
    let ownerId: string | null | undefined;
    for (const [key, raw] of Object.entries(input)) {
      if (key === 'owner_id' || key === 'ownerId') {
        ownerId = raw === null || raw === undefined || raw === '' ? null : String(raw);
        continue;
      }
      const f = def.fields.find((x) => x.apiName === key);
      if (!f) {
        if (['id', 'name', 'created_at', 'updated_at', 'created_by', 'updated_by'].includes(key)) continue;
        throw badRequest(`Unknown field "${key}" on ${def.label}`, { field: key });
      }
      if (isComputedField(f)) throw badRequest(`${f.label} is calculated automatically and cannot be set`, { field: key });
      const access = fieldAccessOf(principal, def.apiName, f);
      if (access !== 'edit') {
        // Never compare hidden values: the outcome would reveal them.
        if (access === 'read' && current && same(current.fields[key], coerceValue(f, raw))) continue;
        throw forbidden(`You cannot set ${f.label}`);
      }
      values[key] = coerceValue(f, raw);
    }
    return { values, ownerId };
  }

  private computeName(def: ObjectDef, fields: RecordData): string {
    const name = def.nameTemplate
      ? def.nameTemplate.replace(/\{([a-z][a-z0-9_]*)\}/g, (_m, k: string) => stringify(fields[k])).replace(/\s+/g, ' ')
      : stringify(fields[def.nameField]);
    return truncate(name.trim() || `Untitled ${def.label}`, 255);
  }

  /** Recomputes formula fields and the record name. */
  private finalize(def: ObjectDef, values: RecordData, sys: { id: string; ownerId: string | null; createdAt: string; updatedAt: string }): { fields: RecordData; name: string } {
    const fields: RecordData = {};
    for (const [k, v] of Object.entries(values)) if (v !== null && v !== undefined) fields[k] = v;
    let name = this.computeName(def, fields);
    const formulas = def.fields.filter((f) => f.type === 'formula' && f.formula);
    for (let pass = 0; pass < 3 && formulas.length; pass++) {
      let changed = false;
      const ctx: Record<string, unknown> = { ...fields, id: sys.id, name, owner_id: sys.ownerId, created_at: sys.createdAt, updated_at: sys.updatedAt };
      for (const f of formulas) {
        let v: unknown;
        try {
          v = coerceFormula(f, evaluateExpression(f.formula!, ctx));
        } catch {
          v = null;
        }
        if (!same(fields[f.apiName], v)) {
          changed = true;
          if (v === null) delete fields[f.apiName];
          else fields[f.apiName] = v;
          ctx[f.apiName] = v;
        }
      }
      name = this.computeName(def, fields);
      if (!changed) break;
    }
    return { fields, name };
  }

  /** Lower-cased text for free-text search. Sensitive fields and fields hidden from any role are left out. */
  private searchText(def: ObjectDef, name: string, fields: RecordData): string {
    const hidden = this.users.fieldsHiddenFromSomeRole(def.apiName);
    const parts = [name];
    for (const f of def.fields) {
      if (f.sensitive || hidden.has(f.apiName)) continue;
      if (!SEARCHABLE.has(f.type) && !(f.type === 'formula' && f.formulaType === 'text')) continue;
      const v = fields[f.apiName];
      if (isBlank(v)) continue;
      parts.push(f.type === 'longtext' ? String(v).slice(0, 500) : stringify(v));
    }
    return parts.join(' ').toLowerCase().slice(0, 4000);
  }

  private checkValidationRules(def: ObjectDef, flat: Record<string, unknown>): void {
    for (const rule of def.validationRules ?? []) {
      if (rule.active === false) continue;
      let failed = false;
      try {
        failed = truthy(evaluateExpression(rule.condition, flat));
      } catch {
        failed = false;
      }
      if (failed) throw new AppError(400, 'validation_rule', rule.message, { rule: rule.name });
    }
  }

  private async checkDuplicates(principal: Principal, def: ObjectDef, fields: RecordData, selfId: string | null, changedOnly?: Set<string>): Promise<void> {
    for (const name of def.duplicateFields ?? []) {
      const v = fields[name];
      if (isBlank(v) || (changedOnly && !changedOnly.has(name))) continue;
      const rows = await this.db.all<{ id: string; name: string; owner_id: string | null }>(
        `SELECT id, name, owner_id FROM records WHERE object_api_name = ? AND LOWER(${jsonText(this.db, name, 'records.data')}) = ? AND id <> ? LIMIT 3`,
        [def.apiName, String(v).toLowerCase(), selfId ?? ''],
      );
      if (rows.length) {
        const label = def.fields.find((f) => f.apiName === name)?.label ?? name;
        const readable = await this.readableIds(principal, def.apiName, rows.map((r) => r.id));
        const visible = rows.filter((r) => readable.has(r.id));
        throw new AppError(409, 'duplicate', `Possible duplicate ${def.label.toLowerCase()}${visible[0] ? ` "${visible[0].name}"` : ''} with the same ${label}`, {
          field: name,
          duplicates: visible.map((r) => ({ id: r.id, name: r.name })),
        });
      }
    }
  }

  private async validateReferences(def: ObjectDef, values: RecordData, selfId: string | null): Promise<void> {
    const lookups: { f: FieldDef; id: string }[] = [];
    const users: { f: FieldDef; id: string }[] = [];
    for (const f of def.fields) {
      const v = values[f.apiName];
      if (typeof v !== 'string') continue;
      if (f.type === 'lookup') lookups.push({ f, id: v });
      else if (f.type === 'user') users.push({ f, id: v });
    }
    if (lookups.length) {
      const ids = [...new Set(lookups.map((l) => l.id))];
      const rows = await this.db.all<{ id: string; object_api_name: string }>(`SELECT id, object_api_name FROM records WHERE id IN (${placeholders(ids.length)})`, ids);
      const found = new Map(rows.map((r) => [r.id, r.object_api_name]));
      for (const { f, id } of lookups) {
        const obj = found.get(id);
        if (!obj) throw badRequest(`${f.label}: the referenced record does not exist`, { field: f.apiName });
        if (f.referenceTo !== '*' && obj !== f.referenceTo) throw badRequest(`${f.label} must reference a ${this.metadata.get(f.referenceTo!)?.label ?? f.referenceTo} record`, { field: f.apiName });
        if (selfId && id === selfId) throw badRequest(`${f.label} cannot reference the record itself`, { field: f.apiName });
        if (selfId && f.referenceTo === def.apiName) await this.assertNoCycle(f, selfId, id);
      }
    }
    if (users.length) {
      const ids = [...new Set(users.map((u) => u.id))];
      const rows = await this.db.all<{ id: string }>(`SELECT id FROM users WHERE id IN (${placeholders(ids.length)})`, ids);
      const found = new Set(rows.map((r) => r.id));
      for (const { f, id } of users) if (!found.has(id)) throw badRequest(`${f.label}: unknown user`, { field: f.apiName });
    }
  }

  /** Prevents hierarchy loops such as an employee managing their own manager. */
  private async assertNoCycle(f: FieldDef, selfId: string, parentId: string): Promise<void> {
    let current: string | undefined = parentId;
    for (let i = 0; i < 50 && current; i++) {
      if (current === selfId) throw badRequest(`${f.label} would create a circular hierarchy`, { field: f.apiName });
      const next: CrmRecord | undefined = await this.getRaw(current);
      const v = next?.fields[f.apiName];
      current = typeof v === 'string' ? v : undefined;
    }
  }

  private async assertOwner(ownerId: string): Promise<void> {
    const row = await this.db.get<{ active: number }>('SELECT active FROM users WHERE id = ?', [ownerId]);
    if (!row || !Number(row.active)) throw badRequest('Owner must be an active user', { field: 'owner_id' });
  }

  private async writeHistory(tx: Db, rec: CrmRecord, event: 'created' | 'updated' | 'deleted', changes: FieldChange[] | null, principal: Principal): Promise<void> {
    await tx.run(
      'INSERT INTO record_history (id, record_id, object_api_name, event, changes, actor_type, actor_id, actor_name, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [
        newId('hst'),
        rec.id,
        rec.object,
        event,
        changes ? JSON.stringify(changes) : null,
        principal.type === 'public' ? 'system' : principal.type,
        principal.agentId ?? principal.userId,
        principal.name,
        event === 'created' ? rec.createdAt : nowIso(),
      ],
    );
  }

  async create(principal: Principal, object: string, input: RecordData, opts: WriteOptions = {}): Promise<CrmRecord> {
    const def = this.metadata.require(object);
    assertCanCreate(principal, object);
    const { values, ownerId } = this.coerceInput(principal, def, input);
    const templateCtx = { user: { id: principal.userId, name: principal.name } };
    for (const f of def.fields) {
      if (isComputedField(f) || f.defaultValue === undefined || f.defaultValue === null || f.apiName in values) continue;
      try {
        const v = coerceValue(f, renderTemplate(f.defaultValue, templateCtx));
        if (v !== null) values[f.apiName] = v;
      } catch {
        // invalid defaults are ignored
      }
    }
    for (const f of def.fields) {
      if (f.required && !isComputedField(f) && isBlank(values[f.apiName])) throw badRequest(`${f.label} is required`, { field: f.apiName });
    }
    await this.validateReferences(def, values, null);
    if (ownerId) await this.assertOwner(ownerId);
    const owner = ownerId ?? principal.userId ?? (await this.users.defaultOwnerId());
    const now = opts.timestamp ?? nowIso();
    const id = newId(def.keyPrefix);
    const { fields, name } = this.finalize(def, values, { id, ownerId: owner, createdAt: now, updatedAt: now });
    const record: CrmRecord = { id, object, name, ownerId: owner, createdAt: now, updatedAt: now, createdBy: principal.userId, updatedBy: principal.userId, fields };
    this.checkValidationRules(def, toFlat(record));
    if (!opts.allowDuplicates) await this.checkDuplicates(principal, def, fields, null);

    await this.db.transaction(async (tx) => {
      await tx.run(
        `INSERT INTO records (id, object_api_name, name, owner_id, data, search_text, created_at, updated_at, created_by, updated_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [id, object, name, owner, JSON.stringify(fields), this.searchText(def, name, fields), now, now, principal.userId, principal.userId],
      );
      await this.writeHistory(tx, record, 'created', null, principal);
      await this.refreshRollups(tx, object, [fields]);
    });

    if (!opts.silent) {
      await this.events.emit({ type: 'created', object, record, previous: null, changed: [...Object.keys(fields), 'owner_id'], principal });
    }
    return this.presentCurrent(principal, def, (await this.getRaw(id)) ?? record);
  }

  /** Re-checks access after a write: automations may have changed the owner or fields that sharing rules match. */
  private async presentCurrent(principal: Principal, def: ObjectDef, rec: CrmRecord): Promise<CrmRecord> {
    return this.present(principal, rec, await this.recordAccess(principal, def, rec.id));
  }

  async update(principal: Principal, object: string, id: string, input: RecordData, opts: WriteOptions = {}): Promise<CrmRecord> {
    return this.updateWithRetry(principal, object, id, input, opts);
  }

  /** Increment from the latest persisted form, retaining normal silent-update history and validation. */
  async incrementFormSubmissions(principal: Principal, id: string): Promise<CrmRecord> {
    return this.updateWithRetry(principal, 'web_form', id, {}, { silent: true }, true);
  }

  private async updateWithRetry(
    principal: Principal, object: string, id: string, input: RecordData, opts: WriteOptions, incrementSubmissions = false,
  ): Promise<CrmRecord> {
    for (;;) {
      const result = await this.updateAttempt(principal, object, id, input, opts, incrementSubmissions);
      if (result) return result;
    }
  }

  private async updateAttempt(
    principal: Principal, object: string, id: string, input: RecordData, opts: WriteOptions, incrementSubmissions: boolean,
  ): Promise<CrmRecord | undefined> {
    const def = this.metadata.require(object);
    // Form edits and counter increments must both compare their complete snapshot:
    // otherwise a stale full-record write could undo either kind of update.
    const snapshot = object === 'web_form'
      ? await this.db.get<RecordRow>(`SELECT ${COLUMNS} FROM records WHERE id = ?`, [id])
      : undefined;
    const current = object === 'web_form' ? (snapshot ? rowToRecord(snapshot) : undefined) : await this.getRaw(id);
    if (!current || current.object !== object) throw notFound(`${def.label} not found`);
    const access = await this.recordAccess(principal, def, id);
    if (!access.read) throw notFound(`${def.label} not found`);
    if (!access.edit) throw forbidden(`You cannot edit this ${object} record`);
    const effectiveInput = incrementSubmissions ? { ...input, submissions: Number(current.fields.submissions ?? 0) + 1 } : input;
    const { values, ownerId } = this.coerceInput(principal, def, effectiveInput, current);
    for (const [k, v] of Object.entries(values)) {
      const f = def.fields.find((x) => x.apiName === k)!;
      if (f.required && isBlank(v)) throw badRequest(`${f.label} is required`, { field: k });
    }
    const changedInputs: RecordData = {};
    for (const [k, v] of Object.entries(values)) if (!same(current.fields[k], v)) changedInputs[k] = v;
    await this.validateReferences(def, changedInputs, id);

    let newOwner = current.ownerId;
    if (ownerId !== undefined && ownerId !== current.ownerId) {
      if (!ownerId) throw badRequest('Owner is required', { field: 'owner_id' });
      if (!canChangeOwner(principal, def.apiName, current.ownerId)) throw forbidden(`You can only change the owner of ${def.pluralLabel.toLowerCase()} you own`);
      await this.assertOwner(ownerId);
      newOwner = ownerId;
    }
    const merged: RecordData = { ...current.fields, ...values };
    const now = opts.timestamp ?? nowIso();
    const { fields, name } = this.finalize(def, merged, { id, ownerId: newOwner, createdAt: current.createdAt, updatedAt: now });

    const changed = new Set<string>();
    for (const k of new Set([...Object.keys(current.fields), ...Object.keys(fields)])) if (!same(current.fields[k], fields[k])) changed.add(k);
    if (newOwner !== current.ownerId) changed.add('owner_id');
    if (!changed.size) return this.present(principal, current, access);

    const record: CrmRecord = { ...current, name, ownerId: newOwner, fields, updatedAt: now, updatedBy: principal.userId };
    this.checkValidationRules(def, toFlat(record));
    if (!opts.allowDuplicates) await this.checkDuplicates(principal, def, fields, id, changed);

    const history: FieldChange[] = [];
    for (const k of changed) {
      if (k === 'owner_id') history.push({ field: k, from: current.ownerId, to: newOwner });
      else {
        const f = def.fields.find((x) => x.apiName === k);
        if (f && !isComputedField(f)) history.push({ field: k, from: current.fields[k] ?? null, to: fields[k] ?? null });
      }
    }

    const written = await this.db.transaction(async (tx) => {
      const comparison = snapshot
        ? ` AND object_api_name = ? AND name = ? AND owner_id ${tx.dialect === 'sqlite' ? 'IS' : 'IS NOT DISTINCT FROM'} ? AND data = ? AND updated_at = ? AND updated_by ${tx.dialect === 'sqlite' ? 'IS' : 'IS NOT DISTINCT FROM'} ?`
        : '';
      const result = await tx.run(`UPDATE records SET name = ?, owner_id = ?, data = ?, search_text = ?, updated_at = ?, updated_by = ? WHERE id = ?${comparison}`, [
        name,
        newOwner,
        JSON.stringify(fields),
        this.searchText(def, name, fields),
        now,
        principal.userId,
        id,
        ...(snapshot ? [snapshot.object_api_name, snapshot.name, snapshot.owner_id, typeof snapshot.data === 'string' ? snapshot.data : JSON.stringify(snapshot.data), snapshot.updated_at, snapshot.updated_by] : []),
      ]);
      if (!result.changes) return false;
      if (history.length) await this.writeHistory(tx, record, 'updated', history, principal);
      await this.refreshRollups(tx, object, [current.fields, fields]);
      return true;
    });

    if (!written) {
      if (snapshot) return undefined;
      throw notFound(`${def.label} not found`);
    }
    if (!opts.silent) await this.events.emit({ type: 'updated', object, record, previous: current, changed: [...changed], principal });
    return this.presentCurrent(principal, def, (await this.getRaw(id)) ?? record);
  }

  async delete(principal: Principal, object: string, id: string, opts: WriteOptions = {}): Promise<{ deleted: number }> {
    const def = this.metadata.require(object);
    const root = await this.getRaw(id);
    if (!root || root.object !== object) throw notFound(`${def.label} not found`);
    const access = await this.recordAccess(principal, def, id);
    if (!access.read) throw notFound(`${def.label} not found`);
    if (!access.delete) throw forbidden(`You cannot delete this ${object} record`);
    const deleted: CrmRecord[] = [];

    await this.db.transaction(async (tx) => {
      const seen = new Set([id]);
      const queue = [root];
      while (queue.length) {
        const rec = queue.shift()!;
        deleted.push(rec);
        if (deleted.length > 5000) throw badRequest('Too many dependent records to delete at once');
        for (const { object: child, field } of this.metadata.referencingFields(rec.object)) {
          if (!field.cascadeDelete) continue;
          const rows = await tx.all<RecordRow>(`SELECT ${COLUMNS} FROM records WHERE object_api_name = ? AND ${jsonText(tx, field.apiName, 'records.data')} = ?`, [
            child.apiName,
            rec.id,
          ]);
          for (const r of rows) {
            if (seen.has(r.id)) continue;
            seen.add(r.id);
            queue.push(rowToRecord(r));
          }
        }
      }
      const ids = deleted.map((r) => r.id);
      for (const part of chunk(ids, 200)) await tx.run(`DELETE FROM records WHERE id IN (${placeholders(part.length)})`, part);
      await this.writeHistory(tx, root, 'deleted', null, principal);

      // Clear remaining lookups that pointed at deleted records.
      const deletedObjects = [...new Set(deleted.map((r) => r.object))];
      const referencing = new Map<string, { object: ObjectDef; field: FieldDef }>();
      for (const o of deletedObjects) for (const r of this.metadata.referencingFields(o)) if (!r.field.cascadeDelete) referencing.set(`${r.object.apiName}.${r.field.apiName}`, r);
      for (const { object: refObj, field } of referencing.values()) {
        for (const part of chunk(ids, 200)) {
          const rows = await tx.all<RecordRow>(
            `SELECT ${COLUMNS} FROM records WHERE object_api_name = ? AND ${jsonText(tx, field.apiName, 'records.data')} IN (${placeholders(part.length)})`,
            [refObj.apiName, ...part],
          );
          for (const row of rows) {
            const rec = rowToRecord(row);
            const { fields, name } = this.finalize(refObj, { ...rec.fields, [field.apiName]: null }, { id: rec.id, ownerId: rec.ownerId, createdAt: rec.createdAt, updatedAt: rec.updatedAt });
            await tx.run('UPDATE records SET name = ?, data = ?, search_text = ? WHERE id = ?', [name, JSON.stringify(fields), this.searchText(refObj, name, fields), rec.id]);
            await this.writeHistory(tx, rec, 'updated', [{ field: field.apiName, from: rec.fields[field.apiName], to: null }], principal);
          }
        }
      }
      for (const o of deletedObjects) await this.refreshRollups(tx, o, deleted.filter((r) => r.object === o).map((r) => r.fields), 0, new Set(ids));
    });

    if (!opts.silent) {
      for (const rec of deleted) await this.events.emit({ type: 'deleted', object: rec.object, record: rec, previous: rec, changed: [], principal });
    }
    return { deleted: deleted.length };
  }

  /** Recalculates roll-up summary fields on parents of the given child values (bounded chain depth). */
  private async refreshRollups(tx: Db, childObject: string, childValues: RecordData[], depth = 0, skip?: Set<string>): Promise<void> {
    if (depth > 3) return;
    const targets = new Map<string, Set<string>>();
    for (const { parent, field } of this.metadata.rollupsFromChild(childObject)) {
      for (const values of childValues) {
        const pid = values[field.rollup!.relationshipField];
        if (typeof pid !== 'string' || skip?.has(pid)) continue;
        if (!targets.has(parent.apiName)) targets.set(parent.apiName, new Set());
        targets.get(parent.apiName)!.add(pid);
      }
    }
    for (const [parentObject, ids] of targets) for (const pid of ids) await this.recomputeParent(tx, parentObject, pid, depth);
  }

  private async recomputeParent(tx: Db, parentObject: string, parentId: string, depth: number): Promise<void> {
    const def = this.metadata.get(parentObject);
    const parent = await this.getRaw(parentId, tx);
    if (!def || !parent || parent.object !== parentObject) return;
    const values: RecordData = { ...parent.fields };
    for (const f of def.fields) {
      if (f.type !== 'rollup' || !f.rollup) continue;
      const r = f.rollup;
      const childDef = this.metadata.get(r.childObject);
      if (!childDef) continue;
      const where = filterSql(this.ctx(null, childDef, tx), r.filter);
      const agg = r.fn === 'count' ? 'COUNT(*)' : `${r.fn.toUpperCase()}(${fieldExpr(tx, childDef, r.field!).expr})`;
      const row = await tx.get<{ v: number | string | null }>(
        `SELECT ${agg} AS v FROM records WHERE object_api_name = ? AND ${jsonText(tx, r.relationshipField, 'records.data')} = ? AND ${where.sql}`,
        [r.childObject, parentId, ...where.params],
      );
      const raw = row?.v === null || row?.v === undefined ? (r.fn === 'count' || r.fn === 'sum' ? 0 : null) : Number(row.v);
      values[f.apiName] = raw === null ? null : round(raw, f.precision ?? 2);
    }
    const { fields, name } = this.finalize(def, values, { id: parent.id, ownerId: parent.ownerId, createdAt: parent.createdAt, updatedAt: parent.updatedAt });
    if (same(fields, parent.fields) && name === parent.name) return;
    await tx.run('UPDATE records SET name = ?, data = ?, search_text = ? WHERE id = ?', [name, JSON.stringify(fields), this.searchText(def, name, fields), parent.id]);
    await this.refreshRollups(tx, parentObject, [parent.fields, fields], depth + 1);
  }

  /** Removes a deleted field's stored values, then refreshes names and search text. */
  async purgeField(object: string, field: string): Promise<void> {
    if (!/^[a-z][a-z0-9_]{0,39}$/.test(field)) throw badRequest(`Invalid field ${field}`);
    const expr = this.db.dialect === 'sqlite' ? `json_remove(data, '$.${field}')` : `data - '${field}'`;
    await this.db.run(`UPDATE records SET data = ${expr} WHERE object_api_name = ?`, [object]);
    await this.recalculateObject(object, { force: true });
  }

  /** Rewrites the search text of an object's records, e.g. after field permissions changed which fields are searchable. */
  async reindexSearch(object: string): Promise<void> {
    const def = this.metadata.get(object);
    if (!def) return;
    const rows = await this.db.all<{ id: string; name: string; data: unknown }>('SELECT id, name, data FROM records WHERE object_api_name = ?', [object]);
    for (const part of chunk(rows, 200)) {
      await this.db.transaction(async (tx) => {
        for (const r of part) await tx.run('UPDATE records SET search_text = ? WHERE id = ?', [this.searchText(def, r.name, parseJson<RecordData>(r.data, {})), r.id]);
      });
    }
  }

  /** Recomputes names, formulas and roll-ups of every record (after metadata changes). `force` also rewrites unchanged rows' search text. */
  async recalculateObject(object: string, opts: { force?: boolean } = {}): Promise<number> {
    const def = this.metadata.require(object);
    const rows = await this.db.all<RecordRow>(`SELECT ${COLUMNS} FROM records WHERE object_api_name = ?`, [object]);
    const hasRollups = def.fields.some((f) => f.type === 'rollup');
    let count = 0;
    for (const part of chunk(rows, 200)) {
      await this.db.transaction(async (tx) => {
        for (const row of part) {
          let rec = rowToRecord(row);
          if (hasRollups) {
            await this.recomputeParent(tx, object, rec.id, 3);
            if (!opts.force) continue;
            rec = (await this.getRaw(rec.id, tx)) ?? rec;
          }
          const { fields, name } = this.finalize(def, rec.fields, { id: rec.id, ownerId: rec.ownerId, createdAt: rec.createdAt, updatedAt: rec.updatedAt });
          if (!opts.force && same(fields, rec.fields) && name === rec.name) continue;
          await tx.run('UPDATE records SET name = ?, data = ?, search_text = ? WHERE id = ?', [name, JSON.stringify(fields), this.searchText(def, name, fields), rec.id]);
          count++;
        }
      });
    }
    return count;
  }

  /** Creates many records, collecting per-row errors (data import). */
  async importRecords(principal: Principal, object: string, rows: RecordData[], opts: WriteOptions = {}): Promise<{ created: number; errors: { row: number; message: string }[] }> {
    if (!Array.isArray(rows) || rows.length > 2000) throw badRequest('Provide between 1 and 2000 rows');
    let created = 0;
    const errors: { row: number; message: string }[] = [];
    for (const [i, row] of rows.entries()) {
      try {
        await this.create(principal, object, row, opts);
        created++;
      } catch (err) {
        if (!(err instanceof AppError)) throw err;
        errors.push({ row: i + 1, message: err.message });
      }
    }
    return { created, errors };
  }

  /** CSV export of the readable records matching a query (max 10k rows). */
  async exportCsv(principal: Principal, object: string, query: RecordQuery = {}): Promise<string> {
    const def = this.metadata.require(object);
    const visible = def.fields.filter((f) => canSeeField(principal, def.apiName, f));
    const lines: string[] = [];
    const esc = (v: unknown): string => {
      let s = stringify(v);
      if (typeof v !== 'number' && /^[=+\-@\t\r]/.test(s)) s = `'${s}`; // neutralize spreadsheet formula injection
      return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    lines.push(['Id', ...visible.map((f) => f.label), 'Owner', 'Created', 'Updated'].map(esc).join(','));
    for (let page = 1; page <= 20; page++) {
      const res = await this.query(principal, object, { ...query, page, pageSize: 500 });
      for (const r of res.records) {
        const cells = visible.map((f) => {
          const v = r.fields[f.apiName];
          return (f.type === 'lookup' || f.type === 'user') && typeof v === 'string' ? (res.refs[v]?.name ?? v) : v;
        });
        lines.push([r.id, ...cells, r.ownerId ? (res.refs[r.ownerId]?.name ?? r.ownerId) : '', r.createdAt, r.updatedAt].map(esc).join(','));
      }
      if (page * 500 >= res.total) break;
    }
    return `${lines.join('\r\n')}\r\n`;
  }
}
