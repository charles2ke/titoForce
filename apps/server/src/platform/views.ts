import { type AppDef, type AppNavItem, type AppPage, type ListViewDef, SYSTEM_FIELDS, type ViewType } from '@titoforce/shared';
import { validateFilter } from '../automation/engine.ts';
import { type Db, parseJson } from '../db/database.ts';
import { badRequest, forbidden, newId, notFound, nowIso } from '../util.ts';
import type { MetadataService } from './metadata.ts';
import { assertCanReadObject, assertSetup, objectPermission, type Principal } from './principal.ts';

export type ListViewInput = Omit<ListViewDef, 'id' | 'ownerId'>;

const VIEW_TYPES: ViewType[] = ['table', 'kanban', 'calendar', 'timeline'];
const PAGES: AppPage[] = ['home', 'forecast', 'org-chart', 'reports'];
const isAdmin = (p: Principal) => !p.permissions || p.permissions.setup;

interface ViewRow {
  id: string;
  object_api_name: string;
  name: string;
  owner_id: string | null;
  shared: number;
  definition: unknown;
}

/** Saved list views (filters, columns, sort, and table/kanban/calendar/timeline layouts). */
export class ListViewService {
  private db: Db;
  private metadata: MetadataService;

  constructor(db: Db, metadata: MetadataService) {
    this.db = db;
    this.metadata = metadata;
  }

  private toView(r: ViewRow): ListViewDef {
    const d = parseJson<Partial<ListViewDef>>(r.definition, {});
    return {
      id: r.id,
      object: r.object_api_name,
      name: r.name,
      ownerId: r.owner_id,
      shared: !!Number(r.shared),
      filters: d.filters ?? null,
      sort: d.sort ?? null,
      columns: d.columns ?? null,
      viewType: d.viewType ?? 'table',
      groupBy: d.groupBy ?? null,
    };
  }

  async list(principal: Principal, object: string): Promise<ListViewDef[]> {
    this.metadata.require(object);
    assertCanReadObject(principal, object);
    const rows = await this.db.all<ViewRow>('SELECT * FROM list_views WHERE object_api_name = ? AND (shared = 1 OR owner_id = ?) ORDER BY shared DESC, created_at, id', [
      object,
      principal.userId ?? '-',
    ]);
    return rows.map((r) => this.toView(r));
  }

  async get(principal: Principal, id: string): Promise<ListViewDef> {
    const row = await this.db.get<ViewRow>('SELECT * FROM list_views WHERE id = ?', [id]);
    if (!row || (!Number(row.shared) && row.owner_id !== principal.userId && !isAdmin(principal))) throw notFound('List view not found');
    assertCanReadObject(principal, row.object_api_name);
    return this.toView(row);
  }

  private validate(principal: Principal, input: ListViewInput): ListViewInput {
    const def = this.metadata.require(input.object);
    assertCanReadObject(principal, def.apiName);
    const name = String(input.name ?? '').trim();
    if (!name || name.length > 80) throw badRequest('View name is required (max 80 characters)');
    const viewType = input.viewType ?? 'table';
    if (!VIEW_TYPES.includes(viewType)) throw badRequest('Invalid view type');
    const fieldOf = (n: string) => def.fields.find((f) => f.apiName === n);
    const known = (n: string) => !!fieldOf(n) || (SYSTEM_FIELDS as readonly string[]).includes(n);
    const columns = input.columns?.length ? [...new Set(input.columns)] : null;
    if (columns && columns.length > 20) throw badRequest('Views can show at most 20 columns');
    for (const c of columns ?? []) if (!known(c)) throw badRequest(`Unknown column ${c}`);
    if (input.sort && (!known(input.sort.field) || !['asc', 'desc'].includes(input.sort.dir))) throw badRequest('Invalid sort');
    validateFilter(this.metadata, def.apiName, input.filters);
    let groupBy = input.groupBy || null;
    if (viewType === 'kanban') {
      groupBy ??= def.statusField ?? null;
      const f = groupBy ? fieldOf(groupBy) : undefined;
      if (!f || f.type !== 'picklist') throw badRequest('Kanban views group by a picklist field');
    } else if (viewType === 'calendar') {
      groupBy ??= def.dateField ?? null;
      const type = groupBy === 'created_at' ? 'datetime' : groupBy ? fieldOf(groupBy)?.type : undefined;
      if (type !== 'date' && type !== 'datetime') throw badRequest('Calendar views need a date field');
    } else if (viewType === 'timeline') {
      if (!def.timeline) throw badRequest(`${def.label} has no start and end dates for a timeline`);
      groupBy = null;
    } else {
      groupBy = null;
    }
    return {
      object: def.apiName,
      name,
      shared: !!input.shared,
      filters: input.filters?.rules?.length ? input.filters : null,
      sort: input.sort ?? null,
      columns,
      viewType,
      groupBy,
    };
  }

  async create(principal: Principal, input: ListViewInput): Promise<ListViewDef> {
    const v = this.validate(principal, input);
    if (v.shared && !isAdmin(principal)) throw forbidden('Only administrators can create shared views');
    const id = newId('lvw');
    const now = nowIso();
    const { object, name, shared, ...definition } = v;
    await this.db.run('INSERT INTO list_views (id, object_api_name, name, owner_id, shared, definition, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', [
      id,
      object,
      name,
      principal.userId,
      shared ? 1 : 0,
      JSON.stringify(definition),
      now,
      now,
    ]);
    return this.get(principal, id);
  }

  private async assertCanChange(principal: Principal, view: ListViewDef): Promise<void> {
    if (isAdmin(principal)) return;
    if (view.shared || view.ownerId !== principal.userId) throw forbidden('You can only change your own views');
  }

  async update(principal: Principal, id: string, patch: Partial<ListViewInput>): Promise<ListViewDef> {
    const current = await this.get(principal, id);
    await this.assertCanChange(principal, current);
    const v = this.validate(principal, { ...current, ...patch, object: current.object });
    if (v.shared && !isAdmin(principal)) throw forbidden('Only administrators can share views');
    const { object: _o, name, shared, ...definition } = v;
    await this.db.run('UPDATE list_views SET name = ?, shared = ?, definition = ?, updated_at = ? WHERE id = ?', [name, shared ? 1 : 0, JSON.stringify(definition), nowIso(), id]);
    return this.get(principal, id);
  }

  async delete(principal: Principal, id: string): Promise<void> {
    const current = await this.get(principal, id);
    await this.assertCanChange(principal, current);
    await this.db.run('DELETE FROM list_views WHERE id = ?', [id]);
  }
}

/** Apps group objects and pages into a navigation bar (Sales, Service, Marketing, Work, People...). */
export class AppService {
  private db: Db;
  private metadata: MetadataService;

  constructor(db: Db, metadata: MetadataService) {
    this.db = db;
    this.metadata = metadata;
  }

  async list(principal?: Principal): Promise<AppDef[]> {
    const rows = await this.db.all<{ id: string; definition: unknown; sort_order: number }>('SELECT * FROM apps ORDER BY sort_order, id');
    const apps = rows.map((r) => ({ ...parseJson<Omit<AppDef, 'id' | 'sortOrder'>>(r.definition, {} as AppDef), id: r.id, sortOrder: Number(r.sort_order) }));
    if (!principal) return apps;
    // Hide navigation to objects the user cannot read, and apps where nothing readable is left.
    return apps
      .map((a) => ({
        app: a,
        nav: a.nav.filter((n) => n.type !== 'object' || (this.metadata.get(n.object) && objectPermission(principal, n.object).read !== 'none')),
      }))
      .filter(({ app, nav }) => nav.some((n) => n.type === 'object') || !app.nav.some((n) => n.type === 'object'))
      .map(({ app, nav }) => ({ ...app, nav }));
  }

  async get(id: string): Promise<AppDef> {
    const app = (await this.list()).find((a) => a.id === id);
    if (!app) throw notFound('App not found');
    return app;
  }

  private validate(app: Omit<AppDef, 'id'> & { id?: string }): Omit<AppDef, 'id'> {
    const name = String(app.name ?? '').trim();
    if (!name || name.length > 40) throw badRequest('App name is required (max 40 characters)');
    if (!Array.isArray(app.nav) || app.nav.length > 30) throw badRequest('Apps have up to 30 navigation items');
    const nav: AppNavItem[] = app.nav.map((n) => {
      if (n.type === 'object') {
        if (!this.metadata.get(n.object)) throw badRequest(`Unknown object ${n.object}`);
        return { type: 'object', object: n.object, label: n.label?.trim() || undefined, view: n.view };
      }
      if (n.type === 'page' && PAGES.includes(n.page)) return { type: 'page', page: n.page, label: n.label?.trim() || n.page, icon: n.icon || 'layout-dashboard' };
      throw badRequest('Invalid navigation item');
    });
    return {
      name,
      description: String(app.description ?? '').trim(),
      icon: app.icon || 'layout-grid',
      color: app.color || 'blue',
      nav,
      dashboardId: app.dashboardId ?? null,
      sortOrder: Number(app.sortOrder) || 0,
    };
  }

  async save(principal: Principal, app: Omit<AppDef, 'id'> & { id?: string }): Promise<AppDef> {
    assertSetup(principal);
    const v = this.validate(app);
    if (v.dashboardId && !(await this.db.get('SELECT id FROM dashboards WHERE id = ?', [v.dashboardId]))) throw badRequest('Unknown dashboard');
    const id = app.id && /^[a-z][a-z0-9_]{1,39}$/.test(app.id) ? app.id : newId('app');
    const { sortOrder, ...definition } = v;
    await this.db.run(
      `INSERT INTO apps (id, definition, sort_order) VALUES (?, ?, ?)
       ON CONFLICT (id) DO UPDATE SET definition = excluded.definition, sort_order = excluded.sort_order`,
      [id, JSON.stringify(definition), sortOrder],
    );
    return this.get(id);
  }

  async delete(principal: Principal, id: string): Promise<void> {
    assertSetup(principal);
    await this.get(id);
    await this.db.run('DELETE FROM apps WHERE id = ?', [id]);
  }
}
