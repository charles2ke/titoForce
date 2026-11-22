import type { AppDef, DeployComponent, DeployComponentStatus, DeployComponentType, DeploymentRecord, FieldDef, ObjectDef, RolePermissions } from '@titoforce/shared';
import type { AgentInput } from '../ai/runtime.ts';
import type { DashboardInput, ReportInput } from '../analytics/reports.ts';
import type { ApprovalProcessInput } from '../automation/approvals.ts';
import type { AutomationInput } from '../automation/engine.ts';
import { type Db, parseJson, type Row } from '../db/database.ts';
import type { LayoutRow } from '../platform/layouts.ts';
import { isComputedField, RECALC_FIELD_KEYS, RECALC_OBJECT_KEYS } from '../platform/metadata.ts';
import { checkRole } from '../platform/users.ts';
import { buildServices, type Services } from '../services.ts';
import { AppError, badRequest, conflict, nowIso } from '../util.ts';
import { toParam } from './copy.ts';

/** Display order; deployments apply objects first so everything else can be checked against them. */
const TYPES: DeployComponentType[] = ['object', 'layout', 'translation', 'app', 'automation', 'approval_process', 'agent', 'report', 'dashboard', 'role'];
const TYPE_NAMES: Record<DeployComponentType, string> = {
  object: 'Object',
  layout: 'Page layout',
  translation: 'Translations',
  app: 'App',
  automation: 'Automation',
  approval_process: 'Approval process',
  agent: 'Agent',
  report: 'Report',
  dashboard: 'Dashboard',
  role: 'Role',
};

/** A deployable component as stored in an organization's database. */
export interface DeployItem {
  type: DeployComponentType;
  id: string;
  label: string;
  object: string | null;
  /** Canonical JSON of the component's own settings. */
  content: string;
  /** Compared one by one (canonical JSON by name): an object's fields or a language's labels. */
  parts?: Map<string, string>;
  /** An object's fields in order. */
  order?: string[];
  row: Row;
  /** An object's field rows. */
  children?: Row[];
}

type Snapshot = Map<string, DeployItem>;

export interface DeploymentPlan {
  items: DeployItem[];
  /** The selection as listed in the deployment history. */
  components: DeploymentRecord['components'];
}

const keyOf = (type: DeployComponentType, id: string) => `${type}:${id}`;
const json = (v: unknown) => parseJson<Record<string, unknown>>(v, {});
const nameIn = (definition: unknown, fallback: string) => {
  const name = json(definition).name;
  return typeof name === 'string' && name ? name : fallback;
};
const describe = (item: DeployItem) => ({ type: item.type, id: item.id, label: item.label });

/** JSON with sorted keys, so equal settings compare equal whatever order they were written in. */
function canonical(value: unknown): string {
  return JSON.stringify(value, (_key, v: unknown) =>
    v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) : v,
  );
}

function objectBound(type: 'automation' | 'approval_process' | 'report', row: Row): DeployItem {
  const active = row.active === undefined ? undefined : !!Number(row.active);
  return {
    type,
    id: String(row.id),
    label: nameIn(row.definition, String(row.id)),
    object: String(row.object_api_name),
    content: canonical({ object: row.object_api_name, active, definition: json(row.definition) }),
    row,
  };
}

/** Reads every deployable component of an organization in one consistent snapshot. */
async function snapshot(db: Db): Promise<Snapshot> {
  return db.transaction(
    async (tx) => {
      const items: Snapshot = new Map();
      const add = (item: DeployItem) => items.set(keyOf(item.type, item.id), item);
      const fields = await tx.all<Row>('SELECT * FROM fields ORDER BY object_api_name, sort_order, api_name');
      for (const row of await tx.all<Row>('SELECT * FROM objects ORDER BY api_name')) {
        const api = String(row.api_name);
        // The key prefix stays production's: records already use it.
        const { apiName: _a, keyPrefix: _k, isCustom: _c, createdAt: _ca, updatedAt: _ua, ...settings } = json(row.definition);
        const own = fields.filter((f) => f.object_api_name === api);
        const parts = new Map(
          own.map((f) => {
            const { sortOrder: _s, ...def } = json(f.definition);
            return [String(f.api_name), canonical(def)];
          }),
        );
        add({ type: 'object', id: api, label: String(settings.label ?? api), object: null, content: canonical(settings), parts, order: own.map((f) => String(f.api_name)), row, children: own });
      }
      for (const row of await tx.all<Row>('SELECT * FROM page_layouts ORDER BY id')) {
        add({
          type: 'layout',
          id: String(row.id),
          label: String(row.name),
          object: String(row.object_api_name),
          content: canonical({ object: row.object_api_name, name: row.name, isDefault: !!Number(row.is_default), definition: json(row.definition) }),
          row,
        });
      }
      const translations = await tx.all<Row>('SELECT * FROM translations ORDER BY locale, key');
      for (const locale of new Set(translations.map((r) => String(r.locale)))) {
        const rows = translations.filter((r) => r.locale === locale);
        add({ type: 'translation', id: locale, label: locale, object: null, content: '', parts: new Map(rows.map((r) => [String(r.key), String(r.value)])), row: { locale } });
      }
      for (const row of await tx.all<Row>('SELECT * FROM apps ORDER BY id')) {
        add({ type: 'app', id: String(row.id), label: nameIn(row.definition, String(row.id)), object: null, content: canonical(json(row.definition)), row });
      }
      for (const row of await tx.all<Row>('SELECT * FROM automations ORDER BY id')) add(objectBound('automation', row));
      for (const row of await tx.all<Row>('SELECT * FROM approval_processes ORDER BY id')) add(objectBound('approval_process', row));
      for (const row of await tx.all<Row>('SELECT * FROM agents ORDER BY id')) {
        const content = canonical({ active: !!Number(row.active), definition: json(row.definition) });
        add({ type: 'agent', id: String(row.id), label: nameIn(row.definition, String(row.id)), object: null, content, row });
      }
      for (const row of await tx.all<Row>('SELECT * FROM reports ORDER BY id')) add(objectBound('report', row));
      for (const row of await tx.all<Row>('SELECT * FROM dashboards ORDER BY id')) {
        add({ type: 'dashboard', id: String(row.id), label: nameIn(row.definition, String(row.id)), object: null, content: canonical(json(row.definition)), row });
      }
      for (const row of await tx.all<Row>('SELECT * FROM roles ORDER BY id')) {
        const content = canonical({ name: row.name, description: row.description, permissions: json(row.permissions) });
        add({ type: 'role', id: String(row.id), label: String(row.name), object: null, content, row });
      }
      return items;
    },
    { snapshot: true },
  );
}

/** How a sandbox component differs from production's. Production-only fields and labels do not count: deployments keep them. */
function diff(item: DeployItem, prod: DeployItem | undefined): { status: DeployComponentStatus; items?: DeployComponent['items']; changedParts: string[] } {
  if (!prod) return { status: 'new', items: item.parts && { added: item.parts.size, changed: 0, productionOnly: 0 }, changedParts: [...(item.parts?.keys() ?? [])] };
  let changed = item.content !== prod.content;
  if (!item.parts || !prod.parts) return { status: changed ? 'changed' : 'unchanged', changedParts: [] };
  const items = { added: 0, changed: 0, productionOnly: 0 };
  const changedParts: string[] = [];
  for (const [name, value] of item.parts) {
    const other = prod.parts.get(name);
    if (other === value) continue;
    if (other === undefined) items.added++;
    else items.changed++;
    changedParts.push(name);
  }
  for (const name of prod.parts.keys()) if (!item.parts.has(name)) items.productionOnly++;
  if (item.order && prod.order) {
    const shared = (order: string[], other: Map<string, string>) => order.filter((n) => other.has(n)).join(',');
    if (shared(item.order, prod.parts) !== shared(prod.order, item.parts)) changed = true;
  }
  return { status: changed || changedParts.length ? 'changed' : 'unchanged', items, changedParts };
}

function compareSnapshots(sandbox: Snapshot, production: Snapshot): DeployComponent[] {
  const component = (item: DeployItem, status: DeployComponentStatus, items: DeployComponent['items'], labels: Snapshot): DeployComponent => ({
    ...describe(item),
    object: item.object,
    objectLabel: item.object ? (labels.get(keyOf('object', item.object))?.label ?? item.object) : null,
    status,
    ...(items ? { items } : {}),
  });
  const out: DeployComponent[] = [];
  for (const [key, item] of sandbox) {
    const { status, items } = diff(item, production.get(key));
    out.push(component(item, status, items, sandbox));
  }
  for (const [key, item] of production) if (!sandbox.has(key)) out.push(component(item, 'production_only', undefined, production));
  return out.sort(
    (a, b) =>
      TYPES.indexOf(a.type) - TYPES.indexOf(b.type) || (a.objectLabel ?? '').localeCompare(b.objectLabel ?? '') || a.label.localeCompare(b.label) || a.id.localeCompare(b.id),
  );
}

/** Compares a sandbox's configuration with its production organization's. */
export async function compareConfiguration(sandbox: Services, production: Services): Promise<DeployComponent[]> {
  return compareSnapshots(await snapshot(sandbox.db), await snapshot(production.db));
}

/** Reads the selected components from the sandbox. */
export async function planDeployment(sandbox: Services, selection: { type: DeployComponentType; id: string }[]): Promise<DeploymentPlan> {
  const source = await snapshot(sandbox.db);
  const items = new Map<string, DeployItem>();
  for (const s of selection) {
    const item = source.get(keyOf(s.type, s.id));
    if (!item) throw badRequest(`${TYPE_NAMES[s.type]} "${s.id}" is not in the sandbox (deployments never delete anything in production)`);
    items.set(keyOf(s.type, s.id), item);
  }
  const sorted = [...items.values()].sort((a, b) => TYPES.indexOf(a.type) - TYPES.indexOf(b.type));
  return { items: sorted, components: sorted.map(describe) };
}

/** Runs `fn`, attributing a validation error to the component it is about. */
async function attempt<T>(item: Pick<DeployItem, 'type' | 'id' | 'label'>, fn: () => T | Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (!(err instanceof AppError) || err.status >= 500) throw err;
    throw new AppError(400, 'deploy_failed', `${TYPE_NAMES[item.type]} "${item.label}": ${err.message}`, { component: describe(item as DeployItem) });
  }
}

async function upsert(db: Db, table: string, row: Record<string, unknown>, keep: string[]): Promise<void> {
  const columns = Object.keys(row);
  const updates = columns.filter((c) => c !== 'id' && !keep.includes(c)).map((c) => `${c} = excluded.${c}`);
  await db.run(
    `INSERT INTO ${table} (${columns.join(', ')}) VALUES (${columns.map(() => '?').join(', ')}) ON CONFLICT (id) DO UPDATE SET ${updates.join(', ')}`,
    columns.map((c) => toParam(row[c])),
  );
}

/** Copies an object's settings and fields; fields only production has are kept (deleting them would delete data). */
async function deployObject(s: Services, item: DeployItem, inProduction: boolean): Promise<void> {
  const settings = json(item.row.definition) as unknown as ObjectDef;
  const fields = item.children!.map((f) => json(f.definition) as unknown as FieldDef);
  const ordered = (list: FieldDef[]) => list.map((f, i) => ({ ...f, sortOrder: i }));
  if (!inProduction) {
    const taken = s.metadata.list().some((o) => o.keyPrefix === settings.keyPrefix);
    const keyPrefix = taken ? s.metadata.uniqueKeyPrefix(item.id) : settings.keyPrefix;
    await s.metadata.saveObject({ ...settings, apiName: item.id, isCustom: !!Number(item.row.is_custom), keyPrefix, fields: ordered(fields) });
    return;
  }
  const current = s.metadata.require(item.id);
  for (const f of fields) {
    const existing = current.fields.find((x) => x.apiName === f.apiName);
    if (existing && existing.type !== f.type) throw badRequest(`Changing the type of ${existing.label} is not supported; create a new field instead`);
  }
  const names = new Set(fields.map((f) => f.apiName));
  await s.metadata.saveObject({
    ...settings,
    apiName: item.id,
    isCustom: current.isCustom,
    keyPrefix: current.keyPrefix,
    createdAt: current.createdAt,
    fields: ordered([...fields, ...current.fields.filter((f) => !names.has(f.apiName))]),
  });
}

/** Checks a deployed component with production's own validation, against production as it is after the deployment. */
async function check(s: Services, item: DeployItem, labels: () => Promise<Set<string>>, changedParts: string[]): Promise<void> {
  const def = json(item.row.definition);
  const active = !!Number(item.row.active);
  switch (item.type) {
    case 'object':
      s.metadata.validateAll([s.metadata.require(item.id)]);
      return;
    case 'layout':
      await s.layouts.validateStored(item.object!, item.id);
      return;
    case 'translation': {
      const known = await labels();
      const unknown = changedParts.filter((key) => !known.has(key));
      if (unknown.length) {
        const more = unknown.length > 5 ? ` and ${unknown.length - 5} more` : '';
        throw badRequest(`these labels are not in production: ${unknown.slice(0, 5).join(', ')}${more}. Deploy the components they belong to as well`);
      }
      return;
    }
    case 'app':
      await s.apps.validate({ ...(def as unknown as AppDef), id: item.id });
      return;
    case 'automation':
      await s.automations.validate({ ...(def as unknown as AutomationInput), object: item.object!, active });
      return;
    case 'approval_process':
      await s.approvals.validateProcess({ ...(def as unknown as ApprovalProcessInput), object: item.object!, active });
      return;
    case 'agent':
      s.agents.validate({ ...(def as unknown as AgentInput), active });
      return;
    case 'report':
      s.analytics.validateReport({ ...(def as unknown as ReportInput), object: item.object! });
      return;
    case 'dashboard':
      await s.analytics.validateDashboard(def as unknown as DashboardInput);
      return;
    case 'role': {
      const permissions = json(item.row.permissions) as unknown as RolePermissions;
      checkRole(s.metadata, { id: item.id, name: String(item.row.name), description: String(item.row.description ?? ''), permissions });
      return;
    }
  }
}

const deploying = new WeakSet<Db>();

const differs = <T extends object>(a: T, b: T, keys: readonly (keyof T)[]) => keys.some((k) => canonical(a[k]) !== canonical(b[k]));

/** Whether production's records must be recalculated, as Setup does when the same settings change. */
function needsRecalculation(before: ObjectDef, after: ObjectDef): boolean {
  if (differs(before, after, RECALC_OBJECT_KEYS)) return true;
  return after.fields.some((f) => {
    const old = before.fields.find((x) => x.apiName === f.apiName);
    return old ? differs(old, f, RECALC_FIELD_KEYS) : isComputedField(f);
  });
}

/**
 * Recomputes the names, formulas and roll-ups of production's records where the deployment changed how they are
 * computed. Objects with roll-ups go last, so they add up recalculated values.
 */
async function recalculate(production: Services, deployed: DeploymentRecord['components'], before: Map<string, ObjectDef>): Promise<void> {
  const objects = deployed.flatMap((c) => {
    const [old, def] = [before.get(c.id), production.metadata.get(c.id)];
    return c.type === 'object' && old && def && needsRecalculation(old, def) ? [def] : [];
  });
  const hasRollups = (def: ObjectDef) => Number(def.fields.some((f) => f.type === 'rollup'));
  for (const def of objects.sort((a, b) => hasRollups(a) - hasRollups(b))) {
    try {
      await production.records.recalculateObject(def.apiName);
    } catch (err) {
      // The deployment is committed: report it as it is, and the failure in the server log.
      console.error(`[deploy] recalculating ${def.apiName} records failed`, err);
    }
  }
}

/**
 * Copies the planned components into production in one transaction, keeping their ids. Everything deployed is then
 * checked with production's own validation against production as it will be after the deployment, and any error
 * rolls the whole deployment back. Deployments never delete components, fields or translations from production.
 */
export async function applyDeployment(production: Services, plan: DeploymentPlan, deployerId: string): Promise<DeploymentRecord['components']> {
  const db = production.db;
  if (deploying.has(db)) throw conflict('Another deployment to this organization is running; try again when it is done');
  deploying.add(db);
  try {
    const before = new Map(production.metadata.list().map((o) => [o.apiName, o]));
    const deployed = await db.transaction(async (tx) => {
      const target = await snapshot(tx);
      const changes = plan.items.map((item) => ({ item, diff: diff(item, target.get(keyOf(item.type, item.id))) })).filter((c) => c.diff.status !== 'unchanged');
      if (!changes.length) throw new AppError(400, 'nothing_to_deploy', 'The selected components are already the same in production');
      const staged = await buildServices(production.config, tx, { tenantId: production.tenantId });
      const now = nowIso();
      const users = new Set((await tx.all<{ id: string }>('SELECT id FROM users')).map((r) => r.id));
      const createdBy = (row: Row) => (typeof row.created_by === 'string' && users.has(row.created_by) ? row.created_by : deployerId);
      const ofType = (type: DeployComponentType) => changes.filter((c) => c.item.type === type);

      for (const { item, diff: d } of ofType('object')) await attempt(item, () => deployObject(staged, item, d.status !== 'new'));
      const layouts = ofType('layout').map((c) => c.item);
      for (const object of new Set(layouts.map((l) => l.object!))) {
        const group = layouts.filter((l) => l.object === object);
        await attempt(group[0]!, () => staged.layouts.deploy(object, group.map((l) => l.row as unknown as LayoutRow)));
      }
      for (const { item, diff: d } of ofType('translation')) {
        for (const key of d.changedParts) {
          await tx.run(
            `INSERT INTO translations (locale, key, value, updated_at) VALUES (?, ?, ?, ?)
             ON CONFLICT (locale, key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
            [item.id, key, item.parts!.get(key)!, now],
          );
        }
      }
      for (const { item } of ofType('app')) await upsert(tx, 'apps', { id: item.id, definition: item.row.definition, sort_order: item.row.sort_order }, ['sort_order']);
      for (const { item: { id, row } } of ofType('automation')) {
        const values = { id, object_api_name: row.object_api_name, active: row.active, definition: row.definition, created_by: createdBy(row), created_at: now, updated_at: now };
        await upsert(tx, 'automations', values, ['created_by', 'created_at']);
      }
      for (const { item: { id, row } } of ofType('approval_process')) {
        const values = { id, object_api_name: row.object_api_name, active: row.active, definition: row.definition, created_at: now, updated_at: now };
        await upsert(tx, 'approval_processes', values, ['created_at']);
      }
      for (const { item: { id, row } } of ofType('agent')) {
        await upsert(tx, 'agents', { id, active: row.active, definition: row.definition, created_at: now, updated_at: now }, ['created_at']);
      }
      for (const { item: { id, row } } of ofType('report')) {
        const values = { id, object_api_name: row.object_api_name, definition: row.definition, created_by: createdBy(row), created_at: now, updated_at: now };
        await upsert(tx, 'reports', values, ['created_by', 'created_at']);
      }
      for (const { item: { id, row } } of ofType('dashboard')) {
        await upsert(tx, 'dashboards', { id, definition: row.definition, created_by: createdBy(row), created_at: now, updated_at: now }, ['created_by', 'created_at']);
      }
      for (const { item: { id, row } } of ofType('role')) {
        await upsert(tx, 'roles', { id, name: row.name, description: row.description ?? '', permissions: row.permissions }, []);
      }

      await staged.metadata.load();
      let labels: Promise<Set<string>> | null = null;
      const knownLabels = () => (labels ??= staged.translations.texts().then((texts) => new Set(texts.map((t) => t.key))));
      for (const { item, diff: d } of changes) await attempt(item, () => check(staged, item, knownLabels, d.changedParts));
      // Objects that look up or roll up deployed objects must still be valid.
      const objects = new Set(ofType('object').map((c) => c.item.id));
      for (const def of staged.metadata.list()) {
        if (objects.has(def.apiName)) continue;
        const dependent = def.fields.some((f) => (f.type === 'lookup' && objects.has(f.referenceTo ?? '')) || (f.type === 'rollup' && objects.has(f.rollup?.childObject ?? '')));
        if (dependent) await attempt({ type: 'object', id: def.apiName, label: def.label }, () => staged.metadata.validateAll([def]));
      }
      return changes.map((c) => describe(c.item));
    });
    await production.metadata.load();
    production.automations.invalidate();
    production.translations.invalidate();
    // Outside the deployment's transaction: recalculating uses transactions of its own.
    await recalculate(production, deployed, before);
    return deployed;
  } finally {
    deploying.delete(db);
  }
}
