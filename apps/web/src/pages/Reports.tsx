import type { ChartType, DashboardDef, MetricFn, ObjectDef, ReportDef } from '@titoforce/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ChartBar, ChartColumn, ChartLine, ChartPie, Donut, Ellipsis, Funnel, Gauge, type LucideIcon, Pencil, Plus, Search, Table2, Trash2, X } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { api, errorMessage, qs } from '../api.ts';
import { useConfirm, useToast } from '../components/feedback.tsx';
import { Badge, Button, EmptyState, ErrorBanner, Loading, MenuItem, ObjectTile, PageHeader, Popover } from '../components/ui.tsx';
import { fieldDef, formatDateTime, plural, relativeTime } from '../lib/format.ts';
import { useApps, useObjects, usePermissions } from '../lib/hooks.ts';

const CHARTS: Record<ChartType, { label: string; icon: LucideIcon }> = {
  bar: { label: 'Bar', icon: ChartBar },
  column: { label: 'Column', icon: ChartColumn },
  line: { label: 'Line', icon: ChartLine },
  pie: { label: 'Pie', icon: ChartPie },
  donut: { label: 'Donut', icon: Donut },
  kpi: { label: 'KPI', icon: Gauge },
  table: { label: 'Table', icon: Table2 },
  funnel: { label: 'Funnel', icon: Funnel },
};

const FN_LABELS: Record<MetricFn, string> = { count: 'Count', sum: 'Sum', avg: 'Average', min: 'Min', max: 'Max' };
const SYSTEM_LABELS: Record<string, string> = { owner_id: 'Owner', created_at: 'Created Date', updated_at: 'Last Modified' };

const labelOf = (def: ObjectDef | undefined, field: string) => SYSTEM_LABELS[field] ?? (def && fieldDef(def, field)?.label) ?? field;

/** e.g. "Sum of Amount by Stage". */
function summary(r: ReportDef, def: ObjectDef | undefined): string {
  const metric = r.metric.fn === 'count' ? 'Record count' : `${FN_LABELS[r.metric.fn]} of ${labelOf(def, r.metric.field ?? '')}`;
  return r.groupBy ? `${metric} by ${labelOf(def, r.groupBy.field)}` : metric;
}

function RowMenu({ report, onDelete }: { report: ReportDef; onDelete: () => void }) {
  const navigate = useNavigate();
  return (
    <Popover
      align="right"
      className="w-40"
      trigger={({ toggle, open }) => (
        <button type="button" onClick={toggle} aria-expanded={open} aria-label={`Actions for ${report.name}`} className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700">
          <Ellipsis className="size-4" />
        </button>
      )}
    >
      {(close) => (
        <div className="py-1">
          <MenuItem
            icon={Pencil}
            onClick={() => {
              close();
              navigate(`/reports/${report.id}/edit`);
            }}
          >
            Edit
          </MenuItem>
          <MenuItem
            icon={Trash2}
            danger
            onClick={() => {
              close();
              onDelete();
            }}
          >
            Delete
          </MenuItem>
        </div>
      )}
    </Popover>
  );
}

export default function Reports() {
  const perms = usePermissions();
  const analyst = perms.canManageAutomations;
  const qc = useQueryClient();
  const toast = useToast();
  const confirm = useConfirm();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const app = params.get('app') ?? '';
  const object = params.get('object') ?? '';
  const [text, setText] = useState('');
  const objects = useObjects();
  const apps = useApps();
  const reports = useQuery({
    queryKey: app ? ['reports', { app }] : ['reports'],
    queryFn: () => api.get<ReportDef[]>(`/api/reports${qs({ app })}`),
  });

  const setParam = (key: string, value: string) =>
    setParams(
      (p) => {
        if (value) p.set(key, value);
        else p.delete(key);
        return p;
      },
      { replace: true },
    );
  const clearFilters = () => {
    setText('');
    setParams({}, { replace: true });
  };

  const defs = new Map((objects.data ?? []).map((o) => [o.apiName, o]));
  const appNames = new Map((apps.data ?? []).map((a) => [a.id, a.name]));
  const objectLabel = (name: string) => defs.get(name)?.pluralLabel ?? name;
  const all = reports.data ?? [];
  const term = text.trim().toLowerCase();
  const matches = all.filter((r) => (!object || r.object === object) && (!term || [r.name, r.description, objectLabel(r.object)].some((s) => s.toLowerCase().includes(term))));

  const byObject = new Map<string, ReportDef[]>();
  for (const r of matches) byObject.set(r.object, [...(byObject.get(r.object) ?? []), r]);
  const sections = [...byObject]
    .map(([name, list]) => ({ name, def: defs.get(name), list: list.sort((a, b) => a.name.localeCompare(b.name)) }))
    .sort((a, b) => objectLabel(a.name).localeCompare(objectLabel(b.name)));

  const objectCounts = new Map<string, number>();
  for (const r of all) objectCounts.set(r.object, (objectCounts.get(r.object) ?? 0) + 1);
  if (object && !objectCounts.has(object)) objectCounts.set(object, 0);
  const objectOptions = [...objectCounts].sort((a, b) => objectLabel(a[0]).localeCompare(objectLabel(b[0])));
  const filtering = !!(term || object || app);

  const remove = async (report: ReportDef) => {
    let usedOn: DashboardDef[] = [];
    try {
      const dashboards = await qc.fetchQuery({ queryKey: ['dashboards'], queryFn: () => api.get<DashboardDef[]>('/api/dashboards') });
      usedOn = dashboards.filter((d) => d.widgets.some((w) => w.reportId === report.id));
    } catch {
      // Only used to warn about affected dashboards; deleting still works without it.
    }
    const ok = await confirm({
      title: 'Delete report?',
      message: (
        <>
          <p>“{report.name}” will be permanently deleted.</p>
          {usedOn.length > 0 && (
            <p className="mt-2">
              It is used on {plural(usedOn.length, 'dashboard')} ({usedOn.map((d) => d.name).join(', ')}), where it will show as deleted until it is removed.
            </p>
          )}
        </>
      ),
      confirmLabel: 'Delete',
      danger: true,
    });
    if (!ok) return;
    try {
      await api.del(`/api/reports/${encodeURIComponent(report.id)}`);
      await Promise.all(['reports', 'report', 'dashboard'].map((k) => qc.invalidateQueries({ queryKey: [k] })));
      toast.success(`Report “${report.name}” deleted`);
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  const newButton = analyst ? (
    <Button variant="primary" icon={Plus} onClick={() => navigate(`/reports/new${qs({ object, app })}`)}>
      New report
    </Button>
  ) : null;

  return (
    <div className="mx-auto max-w-6xl p-6">
      <PageHeader icon="chart-column" color="blue" title="Reports" subtitle="Charts and KPIs over your records. Everyone sees results for the records they can access." actions={newButton} />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="relative w-full sm:w-72">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-slate-400" aria-hidden />
          <input type="search" aria-label="Search reports" placeholder="Search reports…" className="input pl-8" value={text} onChange={(e) => setText(e.target.value)} />
        </div>
        <select aria-label="Filter by object" className="input w-auto" value={object} onChange={(e) => setParam('object', e.target.value)}>
          <option value="">All objects</option>
          {objectOptions.map(([name, count]) => (
            <option key={name} value={name}>
              {objectLabel(name)} ({count})
            </option>
          ))}
        </select>
        {(apps.data?.length ?? 0) > 0 && (
          <select aria-label="Filter by app" className="input w-auto" value={app} onChange={(e) => setParam('app', e.target.value)}>
            <option value="">All apps</option>
            {app && !appNames.has(app) && <option value={app}>{app}</option>}
            {apps.data?.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        )}
        {filtering && (
          <Button size="sm" variant="ghost" icon={X} onClick={clearFilters}>
            Clear
          </Button>
        )}
        {reports.data && <span className="ml-auto text-sm text-slate-500">{plural(matches.length, 'report')}</span>}
      </div>

      {reports.isLoading ? (
        <Loading />
      ) : reports.error ? (
        <ErrorBanner error={reports.error} />
      ) : matches.length === 0 ? (
        <div className="card">
          {all.length === 0 && !app ? (
            <EmptyState icon={ChartColumn} title="No reports yet" action={newButton}>
              {analyst ? 'Create a report to chart and summarize your records.' : 'Reports created by your analysts and admins will appear here.'}
            </EmptyState>
          ) : (
            <EmptyState
              icon={Search}
              title="No reports match"
              action={
                <Button size="sm" icon={X} onClick={clearFilters}>
                  Clear filters
                </Button>
              }
            >
              Try a different search, object or app.
            </EmptyState>
          )}
        </div>
      ) : (
        <div className="space-y-6">
          {sections.map(({ name, def, list }) => (
            <section key={name} aria-label={objectLabel(name)}>
              <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold text-slate-700">
                <ObjectTile icon={def?.icon ?? 'layout-grid'} color={def?.color ?? 'gray'} size="sm" />
                {objectLabel(name)}
                <span className="text-xs font-normal text-slate-400">{list.length}</span>
              </h2>
              <ul className="card divide-y divide-slate-100">
                {list.map((r) => {
                  const chart = CHARTS[r.chart] ?? CHARTS.table;
                  const appName = r.app ? (appNames.get(r.app) ?? r.app) : null;
                  return (
                    <li key={r.id} className="flex items-center gap-4 px-4 py-3 first:rounded-t-xl last:rounded-b-xl hover:bg-slate-50/70">
                      <div className="min-w-0 flex-1">
                        <Link to={`/reports/${r.id}`} className="font-medium text-slate-900 hover:text-indigo-700 hover:underline">
                          {r.name}
                        </Link>
                        <p className="truncate text-xs text-slate-500" title={r.description || summary(r, def)}>
                          {r.description || summary(r, def)}
                        </p>
                      </div>
                      <span className="hidden w-24 shrink-0 items-center gap-1.5 text-xs text-slate-600 sm:inline-flex" title={summary(r, def)}>
                        <chart.icon className="size-4 text-slate-400" aria-hidden />
                        {chart.label}
                      </span>
                      <span className="hidden w-28 shrink-0 md:block">{appName && <Badge color="indigo">{appName}</Badge>}</span>
                      <span className="hidden w-24 shrink-0 text-right text-xs text-slate-500 sm:block" title={`Last modified ${formatDateTime(r.updatedAt)}`}>
                        {relativeTime(r.updatedAt)}
                      </span>
                      {analyst && <RowMenu report={r} onDelete={() => void remove(r)} />}
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
