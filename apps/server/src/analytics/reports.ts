import {
  numberFormat,
  type ChartType,
  type DashboardDef,
  type DashboardWidget,
  type DateInterval,
  type FieldDef,
  type FilterGroup,
  type MetricFn,
  type ObjectDef,
  type ReportDef,
  type ReportResult,
  type ReportRow,
} from '@titoforce/shared';
import { type Db, parseJson } from '../db/database.ts';
import type { MetadataService } from '../platform/metadata.ts';
import { isNumericField } from '../platform/metadata.ts';
import { canViewSensitive, type Principal } from '../platform/principal.ts';
import { fieldExpr } from '../platform/query-builder.ts';
import type { RecordService } from '../platform/records.ts';
import { AppError, badRequest, forbidden, newId, notFound, nowIso } from '../util.ts';

export interface AggregateSpec {
  filters?: FilterGroup | null;
  groupBy?: { field: string; interval?: DateInterval } | null;
  metric: { fn: MetricFn; field?: string };
  sort?: ReportDef['sort'];
  limit?: number | null;
}

const CHARTS: ChartType[] = ['bar', 'column', 'line', 'pie', 'donut', 'kpi', 'table', 'funnel'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const SYSTEM_GROUPS: Record<string, FieldDef> = {
  owner_id: { apiName: 'owner_id', label: 'Owner', type: 'user' },
  created_at: { apiName: 'created_at', label: 'Created Date', type: 'datetime' },
  updated_at: { apiName: 'updated_at', label: 'Last Modified', type: 'datetime' },
};

export type ReportInput = Omit<ReportDef, 'id' | 'createdAt' | 'updatedAt'>;
export type DashboardInput = Omit<DashboardDef, 'id' | 'createdAt' | 'updatedAt'>;

export interface RenderedWidget extends DashboardWidget {
  report: ReportDef | null;
  result: ReportResult | null;
  error: string | null;
}

export class AnalyticsService {
  private db: Db;
  private metadata: MetadataService;
  private records: RecordService;

  constructor(db: Db, metadata: MetadataService, records: RecordService) {
    this.db = db;
    this.metadata = metadata;
    this.records = records;
  }

  private field(def: ObjectDef, name: string): FieldDef {
    const f = SYSTEM_GROUPS[name] ?? def.fields.find((x) => x.apiName === name);
    if (!f) throw badRequest(`Unknown field ${name} on ${def.label}`);
    return f;
  }

  private assertVisible(principal: Principal, f: FieldDef): void {
    if (f.sensitive && !canViewSensitive(principal)) throw forbidden(`You do not have access to ${f.label}`);
  }

  validateSpec(object: string, spec: AggregateSpec): void {
    const def = this.metadata.require(object);
    if (!['count', 'sum', 'avg', 'min', 'max'].includes(spec.metric?.fn)) throw badRequest('Invalid metric');
    if (spec.metric.fn !== 'count') {
      const f = this.field(def, spec.metric.field ?? '');
      if (!isNumericField(f)) throw badRequest(`${f.label} is not numeric`);
    }
    if (spec.groupBy) {
      const f = this.field(def, spec.groupBy.field);
      if (f.type === 'multipicklist' || f.type === 'longtext') throw badRequest(`Cannot group by ${f.label}`);
      if (spec.groupBy.interval && !['day', 'month', 'quarter', 'year'].includes(spec.groupBy.interval)) throw badRequest('Invalid date interval');
    }
  }

  async aggregate(principal: Principal, object: string, spec: AggregateSpec): Promise<ReportResult> {
    const def = this.metadata.require(object);
    this.validateSpec(object, spec);
    const where = this.records.buildWhere(principal, def, spec.filters ?? null);
    const metricField = spec.metric.fn === 'count' ? null : this.field(def, spec.metric.field!);
    if (metricField) this.assertVisible(principal, metricField);
    const metricSql = metricField ? `${spec.metric.fn.toUpperCase()}(${fieldExpr(this.db, def, metricField.apiName).expr})` : 'COUNT(*)';
    const format: ReportResult['format'] = metricField && spec.metric.fn !== 'count' ? (numberFormat(metricField) ?? 'number') : 'number';
    const metricLabel = metricField ? `${{ sum: 'Sum', avg: 'Average', min: 'Min', max: 'Max', count: 'Count' }[spec.metric.fn]} of ${metricField.label}` : 'Record count';

    const totalRow = await this.db.get<{ v: number | null }>(`SELECT ${metricSql} AS v FROM records WHERE ${where.sql}`, where.params);
    const total = Math.round(Number(totalRow?.v ?? 0) * 100) / 100;
    if (!spec.groupBy) return { rows: [{ key: null, label: metricLabel, value: total }], total, metricLabel, format };

    const gf = this.field(def, spec.groupBy.field);
    this.assertVisible(principal, gf);
    const fe = fieldExpr(this.db, def, gf.apiName);
    const isDate = fe.kind === 'date';
    const interval = isDate ? (spec.groupBy.interval ?? 'month') : undefined;
    const e = fe.expr;
    const groupSql = !isDate
      ? e
      : interval === 'day'
        ? `substr(${e}, 1, 10)`
        : interval === 'year'
          ? `substr(${e}, 1, 4)`
          : interval === 'quarter'
            ? `(substr(${e}, 1, 4) || '-Q' || CAST(((CAST(substr(${e}, 6, 2) AS INTEGER) + 2) / 3) AS TEXT))`
            : `substr(${e}, 1, 7)`;
    const rows = await this.db.all<{ k: unknown; v: number | null }>(
      `SELECT ${groupSql} AS k, ${metricSql} AS v FROM records WHERE ${where.sql} GROUP BY 1`,
      where.params,
    );

    const keys = rows.map((r) => (r.k === null || r.k === undefined || r.k === '' ? null : String(r.k)));
    const names = gf.type === 'lookup' || gf.type === 'user' ? await this.records.resolveIds(principal, keys.filter((k): k is string => !!k)) : {};
    let out: ReportRow[] = rows.map((r, i) => {
      const key = keys[i] ?? null;
      const value = Math.round(Number(r.v ?? 0) * 100) / 100;
      let label = key ?? '(blank)';
      let color: ReportRow['color'];
      if (key !== null) {
        if (gf.type === 'picklist') color = gf.options?.find((o) => o.value === key)?.color;
        else if (gf.type === 'checkbox' || (gf.type === 'formula' && gf.formulaType === 'checkbox')) label = key === '1' || key === 'true' ? 'Yes' : 'No';
        else if (gf.type === 'lookup' || gf.type === 'user') label = names[key]?.name ?? key;
        else if (isDate && interval === 'month') label = `${MONTHS[Number(key.slice(5, 7)) - 1] ?? '?'} ${key.slice(0, 4)}`;
        else if (isDate && interval === 'quarter') label = `${key.slice(5)} ${key.slice(0, 4)}`;
      }
      return { key, label, value, color };
    });

    const sort = spec.sort ?? 'natural';
    if (sort === 'label') out.sort((a, b) => a.label.localeCompare(b.label));
    else if (sort === 'value_desc') out.sort((a, b) => b.value - a.value);
    else if (sort === 'value_asc') out.sort((a, b) => a.value - b.value);
    else if (gf.type === 'picklist') {
      const order = new Map(gf.options?.map((o, i) => [o.value, i]) ?? []);
      out.sort((a, b) => (order.get(a.key ?? '') ?? 999) - (order.get(b.key ?? '') ?? 999));
    } else if (isDate) out.sort((a, b) => (a.key ?? '').localeCompare(b.key ?? ''));
    else out.sort((a, b) => b.value - a.value);
    if (spec.limit && spec.limit > 0) out = out.slice(0, spec.limit);
    return { rows: out, total, metricLabel, format };
  }

  // ---------- reports ----------

  private toReport(r: { id: string; object_api_name: string; definition: unknown; created_at: string; updated_at: string }): ReportDef {
    return { ...parseJson<ReportInput>(r.definition, {} as ReportInput), id: r.id, object: r.object_api_name, createdAt: r.created_at, updatedAt: r.updated_at };
  }

  async listReports(app?: string | null): Promise<ReportDef[]> {
    const rows = await this.db.all<{ id: string; object_api_name: string; definition: unknown; created_at: string; updated_at: string }>('SELECT * FROM reports ORDER BY created_at');
    return rows.map((r) => this.toReport(r)).filter((r) => !app || r.app === app);
  }

  async getReport(id: string): Promise<ReportDef> {
    const row = await this.db.get<{ id: string; object_api_name: string; definition: unknown; created_at: string; updated_at: string }>('SELECT * FROM reports WHERE id = ?', [id]);
    if (!row) throw notFound('Report not found');
    return this.toReport(row);
  }

  private validateReport(input: ReportInput): ReportInput {
    if (!input.name?.trim()) throw badRequest('Report name is required');
    if (!CHARTS.includes(input.chart)) throw badRequest('Invalid chart type');
    this.validateSpec(input.object, input);
    return {
      name: input.name.trim(),
      description: input.description ?? '',
      object: input.object,
      filters: input.filters?.rules?.length ? input.filters : null,
      groupBy: input.groupBy?.field ? input.groupBy : null,
      metric: input.metric,
      chart: input.chart,
      sort: input.sort ?? 'natural',
      limit: input.limit ?? null,
      app: input.app ?? null,
    };
  }

  async createReport(input: ReportInput, createdBy: string | null): Promise<ReportDef> {
    const r = this.validateReport(input);
    const id = newId('rpt');
    const now = nowIso();
    await this.db.run('INSERT INTO reports (id, object_api_name, definition, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)', [
      id,
      r.object,
      JSON.stringify(r),
      createdBy,
      now,
      now,
    ]);
    return this.getReport(id);
  }

  async updateReport(id: string, input: Partial<ReportInput>): Promise<ReportDef> {
    const { id: _id, createdAt: _c, updatedAt: _u, ...current } = await this.getReport(id);
    const r = this.validateReport({ ...current, ...input });
    await this.db.run('UPDATE reports SET object_api_name = ?, definition = ?, updated_at = ? WHERE id = ?', [r.object, JSON.stringify(r), nowIso(), id]);
    return this.getReport(id);
  }

  async deleteReport(id: string): Promise<void> {
    await this.getReport(id);
    await this.db.run('DELETE FROM reports WHERE id = ?', [id]);
  }

  async runReport(principal: Principal, idOrDef: string | ReportDef): Promise<{ report: ReportDef; result: ReportResult }> {
    const report = typeof idOrDef === 'string' ? await this.getReport(idOrDef) : idOrDef;
    return { report, result: await this.aggregate(principal, report.object, report) };
  }

  // ---------- dashboards ----------

  private toDashboard(r: { id: string; definition: unknown; created_at: string; updated_at: string }): DashboardDef {
    return { ...parseJson<DashboardInput>(r.definition, {} as DashboardInput), id: r.id, createdAt: r.created_at, updatedAt: r.updated_at };
  }

  async listDashboards(): Promise<DashboardDef[]> {
    const rows = await this.db.all<{ id: string; definition: unknown; created_at: string; updated_at: string }>('SELECT * FROM dashboards ORDER BY created_at');
    return rows.map((r) => this.toDashboard(r));
  }

  async getDashboard(id: string): Promise<DashboardDef> {
    const row = await this.db.get<{ id: string; definition: unknown; created_at: string; updated_at: string }>('SELECT * FROM dashboards WHERE id = ?', [id]);
    if (!row) throw notFound('Dashboard not found');
    return this.toDashboard(row);
  }

  private async validateDashboard(input: DashboardInput): Promise<DashboardInput> {
    if (!input.name?.trim()) throw badRequest('Dashboard name is required');
    if (!Array.isArray(input.widgets) || input.widgets.length > 24) throw badRequest('Dashboards have up to 24 widgets');
    const ids = new Set((await this.listReports()).map((r) => r.id));
    for (const w of input.widgets) if (!ids.has(w.reportId)) throw badRequest(`Unknown report ${w.reportId}`);
    return {
      name: input.name.trim(),
      description: input.description ?? '',
      app: input.app ?? null,
      widgets: input.widgets.map((w) => ({ reportId: w.reportId, title: w.title, size: w.size && [1, 2, 3].includes(w.size) ? w.size : 1 })),
    };
  }

  async createDashboard(input: DashboardInput, createdBy: string | null): Promise<DashboardDef> {
    const d = await this.validateDashboard(input);
    const id = newId('dsh');
    const now = nowIso();
    await this.db.run('INSERT INTO dashboards (id, definition, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?)', [id, JSON.stringify(d), createdBy, now, now]);
    return this.getDashboard(id);
  }

  async updateDashboard(id: string, input: Partial<DashboardInput>): Promise<DashboardDef> {
    const { id: _id, createdAt: _c, updatedAt: _u, ...current } = await this.getDashboard(id);
    const d = await this.validateDashboard({ ...current, ...input });
    await this.db.run('UPDATE dashboards SET definition = ?, updated_at = ? WHERE id = ?', [JSON.stringify(d), nowIso(), id]);
    return this.getDashboard(id);
  }

  /** Deletes a dashboard and unsets it as the home dashboard of any app that used it. */
  async deleteDashboard(id: string): Promise<void> {
    await this.getDashboard(id);
    await this.db.transaction(async (tx) => {
      await tx.run('DELETE FROM dashboards WHERE id = ?', [id]);
      const apps = await tx.all<{ id: string; definition: unknown }>('SELECT id, definition FROM apps');
      for (const app of apps) {
        const def = parseJson<{ dashboardId?: string | null }>(app.definition, {});
        if (def.dashboardId === id) await tx.run('UPDATE apps SET definition = ? WHERE id = ?', [JSON.stringify({ ...def, dashboardId: null }), app.id]);
      }
    });
  }

  /** Runs every widget's report; widgets the user cannot access report an error instead of failing the dashboard. */
  async renderDashboard(principal: Principal, id: string): Promise<{ dashboard: DashboardDef; widgets: RenderedWidget[] }> {
    const dashboard = await this.getDashboard(id);
    const reports = new Map((await this.listReports()).map((r) => [r.id, r]));
    const widgets: RenderedWidget[] = [];
    for (const w of dashboard.widgets) {
      const report = reports.get(w.reportId) ?? null;
      if (!report) {
        widgets.push({ ...w, report: null, result: null, error: 'Report was deleted' });
        continue;
      }
      try {
        widgets.push({ ...w, report, result: await this.aggregate(principal, report.object, report), error: null });
      } catch (err) {
        if (!(err instanceof AppError)) throw err;
        widgets.push({ ...w, report, result: null, error: err.message });
      }
    }
    return { dashboard, widgets };
  }
}
