import { type AutomationDef, type AutomationRun, type CrmRecord, type FieldType, type FilterGroup, matchesFilter } from '@titoforce/shared';
import { type Db, parseJson } from '../db/database.ts';
import type { EventBus, RecordChangeEvent } from '../platform/events.ts';
import type { MetadataService } from '../platform/metadata.ts';
import type { Principal } from '../platform/principal.ts';
import { toFlat } from '../platform/records.ts';
import { badRequest, newId, notFound, nowIso, truncate } from '../util.ts';
import type { ActionExecutor } from './actions.ts';

export const MAX_AUTOMATION_DEPTH = 4;
const TRIGGERS = ['created', 'updated', 'saved', 'deleted'] as const;

export type AutomationInput = Omit<AutomationDef, 'id' | 'createdAt' | 'updatedAt' | 'stats'>;

export function fieldTypes(metadata: MetadataService, object: string): Record<string, FieldType> {
  const types: Record<string, FieldType> = { created_at: 'datetime', updated_at: 'datetime' };
  for (const f of metadata.get(object)?.fields ?? []) types[f.apiName] = f.type === 'formula' && f.formulaType === 'date' ? 'date' : f.type;
  return types;
}

export function validateFilter(metadata: MetadataService, object: string, filter: FilterGroup | null | undefined): void {
  if (!filter) return;
  if (!['all', 'any'].includes(filter.match) || !Array.isArray(filter.rules)) throw badRequest('Invalid conditions');
  const def = metadata.require(object);
  for (const r of filter.rules) {
    if (!['id', 'name', 'owner_id', 'created_at', 'updated_at', 'created_by', 'updated_by'].includes(r.field) && !def.fields.some((f) => f.apiName === r.field)) {
      throw badRequest(`Unknown field ${r.field} in conditions`);
    }
  }
}

export class AutomationService {
  private db: Db;
  private metadata: MetadataService;
  private executor: ActionExecutor;
  private cache: AutomationDef[] | null = null;
  agentIds: () => Promise<Set<string>> = async () => new Set();

  constructor(db: Db, metadata: MetadataService, executor: ActionExecutor, events: EventBus) {
    this.db = db;
    this.metadata = metadata;
    this.executor = executor;
    events.on((e) => this.handle(e));
  }

  private async all(): Promise<AutomationDef[]> {
    if (!this.cache) {
      const rows = await this.db.all<{ id: string; object_api_name: string; active: number; definition: unknown; created_at: string; updated_at: string }>(
        'SELECT * FROM automations ORDER BY created_at',
      );
      this.cache = rows.map((r) => ({
        ...parseJson<AutomationInput>(r.definition, {} as AutomationInput),
        id: r.id,
        object: r.object_api_name,
        active: !!Number(r.active),
        createdAt: r.created_at,
        updatedAt: r.updated_at,
      }));
    }
    return this.cache;
  }

  async list(object?: string): Promise<AutomationDef[]> {
    const list = (await this.all()).filter((a) => !object || a.object === object);
    const stats = await this.db.all<{ automation_id: string; runs: number; failures: number; last: string | null }>(
      `SELECT automation_id, COUNT(*) AS runs, SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failures, MAX(created_at) AS last
       FROM automation_runs GROUP BY automation_id`,
    );
    const byId = new Map(stats.map((s) => [s.automation_id, s]));
    return list.map((a) => {
      const s = byId.get(a.id);
      return { ...a, stats: { runs: Number(s?.runs ?? 0), failures: Number(s?.failures ?? 0), lastRunAt: s?.last ?? null } };
    });
  }

  async get(id: string): Promise<AutomationDef> {
    const a = (await this.list()).find((x) => x.id === id);
    if (!a) throw notFound('Automation not found');
    return a;
  }

  private async validate(input: AutomationInput): Promise<AutomationInput> {
    if (!input.name?.trim()) throw badRequest('Name is required');
    this.metadata.require(input.object);
    if (!input.trigger || !TRIGGERS.includes(input.trigger.type)) throw badRequest('Choose a trigger');
    const def = this.metadata.require(input.object);
    for (const w of input.trigger.watchFields ?? []) {
      if (w !== 'owner_id' && !def.fields.some((f) => f.apiName === w)) throw badRequest(`Unknown watched field ${w}`);
    }
    validateFilter(this.metadata, input.object, input.conditions);
    if (!input.actions?.length) throw badRequest('Add at least one action');
    this.executor.validate(input.object, input.actions, await this.agentIds());
    return {
      name: input.name.trim(),
      description: input.description ?? '',
      object: input.object,
      trigger: { type: input.trigger.type, watchFields: input.trigger.watchFields?.length ? input.trigger.watchFields : undefined },
      conditions: input.conditions?.rules?.length ? input.conditions : null,
      actions: input.actions,
      active: input.active !== false,
    };
  }

  async create(input: AutomationInput, createdBy: string | null): Promise<AutomationDef> {
    const a = await this.validate(input);
    const id = newId('aut');
    const now = nowIso();
    await this.db.run('INSERT INTO automations (id, object_api_name, active, definition, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)', [
      id,
      a.object,
      a.active ? 1 : 0,
      JSON.stringify(a),
      createdBy,
      now,
      now,
    ]);
    this.cache = null;
    return this.get(id);
  }

  async update(id: string, input: Partial<AutomationInput>): Promise<AutomationDef> {
    const current = await this.get(id);
    const { stats: _stats, id: _id, createdAt: _c, updatedAt: _u, ...base } = current;
    const a = await this.validate({ ...base, ...input, object: current.object });
    await this.db.run('UPDATE automations SET active = ?, definition = ?, updated_at = ? WHERE id = ?', [a.active ? 1 : 0, JSON.stringify(a), nowIso(), id]);
    this.cache = null;
    return this.get(id);
  }

  async delete(id: string): Promise<void> {
    await this.get(id);
    await this.db.run('DELETE FROM automations WHERE id = ?', [id]);
    await this.db.run('DELETE FROM automation_runs WHERE automation_id = ?', [id]);
    this.cache = null;
  }

  async runs(filter: { automationId?: string; recordId?: string; limit?: number } = {}): Promise<AutomationRun[]> {
    const where: string[] = [];
    const params: (string | number)[] = [];
    if (filter.automationId) {
      where.push('automation_id = ?');
      params.push(filter.automationId);
    }
    if (filter.recordId) {
      where.push('record_id = ?');
      params.push(filter.recordId);
    }
    const rows = await this.db.all<{ id: string; automation_id: string; record_id: string | null; status: AutomationRun['status']; detail: unknown; error: string | null; created_at: string }>(
      `SELECT * FROM automation_runs ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY created_at DESC LIMIT ?`,
      [...params, Math.min(filter.limit ?? 50, 200)],
    );
    const names = new Map((await this.all()).map((a) => [a.id, a.name]));
    return rows.map((r) => ({
      id: r.id,
      automationId: r.automation_id,
      automationName: names.get(r.automation_id) ?? '(deleted)',
      recordId: r.record_id,
      status: r.status,
      detail: parseJson(r.detail, null),
      error: r.error,
      createdAt: r.created_at,
    }));
  }

  private matchesTrigger(a: AutomationDef, e: RecordChangeEvent): boolean {
    const t = a.trigger.type;
    const ok = t === e.type || (t === 'saved' && (e.type === 'created' || e.type === 'updated'));
    if (!ok) return false;
    if (e.type === 'updated' && a.trigger.watchFields?.length) return a.trigger.watchFields.some((w) => e.changed.includes(w));
    return true;
  }

  async handle(e: RecordChangeEvent): Promise<void> {
    const depth = e.principal.depth ?? 0;
    if (depth >= MAX_AUTOMATION_DEPTH) return;
    const candidates = (await this.all()).filter((a) => a.active && a.object === e.object && this.matchesTrigger(a, e));
    if (!candidates.length) return;
    const types = fieldTypes(this.metadata, e.object);
    let record: CrmRecord = e.record;
    for (const [i, a] of candidates.entries()) {
      // Later automations see changes made by earlier ones.
      if (i > 0 && e.type !== 'deleted') record = (await this.executor.reload(record.id)) ?? record;
      if (!matchesFilter(a.conditions, toFlat(record), { types, currentUserId: e.principal.userId })) continue;
      const actor: Principal = { type: 'automation', userId: null, name: `Automation: ${a.name}`, permissions: null, depth: depth + 1 };
      try {
        const detail = await this.executor.execute(a.actions, {
          record,
          previous: e.previous,
          actor,
          triggeredBy: e.principal,
          source: { type: 'automation', id: a.id, name: a.name },
          deleted: e.type === 'deleted',
        });
        await this.logRun(a.id, record.id, 'success', detail, null);
      } catch (err) {
        await this.logRun(a.id, record.id, 'failed', null, truncate((err as Error).message ?? String(err), 1000));
      }
    }
  }

  private async logRun(automationId: string, recordId: string | null, status: AutomationRun['status'], detail: unknown, error: string | null): Promise<void> {
    await this.db.run('INSERT INTO automation_runs (id, automation_id, record_id, status, detail, error, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)', [
      newId('arn'),
      automationId,
      recordId,
      status,
      detail ? JSON.stringify(detail) : null,
      error,
      nowIso(),
    ]);
  }
}

