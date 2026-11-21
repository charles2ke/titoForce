import type { ChartType, DateInterval, FieldDef, FilterGroup, MetricFn, ObjectDef, ReportDef, ReportResult } from '@titoforce/shared';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ChartBar, ChartColumn, ChartLine, ChartPie, Donut, Funnel, Gauge, Lock, type LucideIcon, Save, Table2, TriangleAlert } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { ApiError, api, errorMessage } from '../api.ts';
import { completeFilter, FilterEditor } from '../components/FilterEditor.tsx';
import { useConfirm, useToast } from '../components/feedback.tsx';
import { ReportChart } from '../components/ReportChart.tsx';
import { Button, Card, cx, EmptyState, ErrorBanner, FormField, Loading, PageHeader, Spinner } from '../components/ui.tsx';
import { formatNumber, plural } from '../lib/format.ts';
import { useApps, useDebounced, useObjects, usePermissions } from '../lib/hooks.ts';

type Sort = ReportDef['sort'];
type Spec = Pick<ReportDef, 'object' | 'filters' | 'groupBy' | 'metric' | 'sort' | 'limit'>;
type ReportInput = Omit<ReportDef, 'id' | 'createdAt' | 'updatedAt'>;

interface Draft {
  name: string;
  description: string;
  object: string;
  filters: FilterGroup | null;
  /** '' means not grouped. */
  groupField: string;
  interval: DateInterval;
  fn: MetricFn;
  metricField: string;
  chart: ChartType;
  sort: Sort;
  /** Raw input text; '' means no limit. */
  limit: string;
  /** '' means no app. */
  app: string;
}

const CHARTS: { id: ChartType; label: string; icon: LucideIcon }[] = [
  { id: 'bar', label: 'Bar', icon: ChartBar },
  { id: 'column', label: 'Column', icon: ChartColumn },
  { id: 'line', label: 'Line', icon: ChartLine },
  { id: 'pie', label: 'Pie', icon: ChartPie },
  { id: 'donut', label: 'Donut', icon: Donut },
  { id: 'kpi', label: 'KPI', icon: Gauge },
  { id: 'table', label: 'Table', icon: Table2 },
  { id: 'funnel', label: 'Funnel', icon: Funnel },
];

const FNS: { id: MetricFn; label: string }[] = [
  { id: 'count', label: 'Count of records' },
  { id: 'sum', label: 'Sum' },
  { id: 'avg', label: 'Average' },
  { id: 'min', label: 'Minimum' },
  { id: 'max', label: 'Maximum' },
];

const SORTS: { id: Sort; label: string }[] = [
  { id: 'natural', label: 'Natural order (picklist order, dates in order)' },
  { id: 'label', label: 'Label (A–Z)' },
  { id: 'value_desc', label: 'Value (highest first)' },
  { id: 'value_asc', label: 'Value (lowest first)' },
];

const INTERVALS: { id: DateInterval; label: string }[] = [
  { id: 'day', label: 'Day' },
  { id: 'month', label: 'Month' },
  { id: 'quarter', label: 'Quarter' },
  { id: 'year', label: 'Year' },
];

// System columns the server can group by, besides the object's own fields.
const SYSTEM_GROUPS: FieldDef[] = [
  { apiName: 'owner_id', label: 'Owner', type: 'user' },
  { apiName: 'created_at', label: 'Created Date', type: 'datetime' },
  { apiName: 'updated_at', label: 'Last Modified', type: 'datetime' },
];

const byLabel = (a: { label: string }, b: { label: string }) => a.label.localeCompare(b.label);

const isNumeric = (f: FieldDef) => ['number', 'currency', 'percent', 'rollup'].includes(f.type) || (f.type === 'formula' && ['number', 'currency', 'percent'].includes(f.formulaType ?? ''));
const isDateField = (f: FieldDef | undefined) => !!f && (f.type === 'date' || f.type === 'datetime' || (f.type === 'formula' && f.formulaType === 'date'));

const groupableFields = (def: ObjectDef) => def.fields.filter((f) => f.type !== 'multipicklist' && f.type !== 'longtext' && !SYSTEM_GROUPS.some((s) => s.apiName === f.apiName)).sort(byLabel);
const numericFields = (def: ObjectDef) => def.fields.filter(isNumeric).sort(byLabel);

/** Grouped data needs a chart that plots groups; a single value is best shown as a KPI. */
function fitChart(chart: ChartType, grouped: boolean): ChartType {
  if (grouped) return chart === 'kpi' ? 'column' : chart;
  return chart === 'kpi' || chart === 'table' ? chart : 'kpi';
}

function objectDefaults(def: ObjectDef): { groupField: string; metricField: string } {
  const groupField = def.statusField && groupableFields(def).some((f) => f.apiName === def.statusField) ? def.statusField : '';
  return { groupField, metricField: numericFields(def)[0]?.apiName ?? '' };
}

function newDraft(objects: ObjectDef[], object: string | null, app: string | null): Draft {
  const def = objects.find((o) => o.apiName === object) ?? [...objects].sort(byLabel)[0];
  const { groupField, metricField } = def ? objectDefaults(def) : { groupField: '', metricField: '' };
  return {
    name: '',
    description: '',
    object: def?.apiName ?? '',
    filters: null,
    groupField,
    interval: 'month',
    fn: 'count',
    metricField,
    chart: groupField ? 'column' : 'kpi',
    sort: 'natural',
    limit: '',
    app: app ?? '',
  };
}

function draftFrom(r: ReportDef): Draft {
  return {
    name: r.name,
    description: r.description,
    object: r.object,
    filters: r.filters,
    groupField: r.groupBy?.field ?? '',
    interval: r.groupBy?.interval ?? 'month',
    fn: r.metric.fn,
    metricField: r.metric.field ?? '',
    chart: r.chart,
    sort: r.sort,
    limit: r.limit == null ? '' : String(r.limit),
    app: r.app ?? '',
  };
}

function parseLimit(raw: string): { value: number | null; error: string | null } {
  const s = raw.trim();
  if (!s) return { value: null, error: null };
  const n = Number(s);
  return Number.isInteger(n) && n >= 1 && n <= 100 ? { value: n, error: null } : { value: null, error: 'Enter a whole number from 1 to 100, or leave it empty' };
}

function Builder({ id, initial, loadError }: { id: string | undefined; initial: Draft; loadError: unknown }) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const toast = useToast();
  const confirm = useConfirm();
  const objects = useObjects();
  const apps = useApps();
  const [start] = useState(initial);
  const [draft, setDraft] = useState(initial);
  const [attempted, setAttempted] = useState(false);
  const set = (patch: Partial<Draft>) => setDraft((d) => ({ ...d, ...patch }));

  const objectList = [...(objects.data ?? [])].sort(byLabel);
  const def = objectList.find((o) => o.apiName === draft.object);
  const groupFields = def ? groupableFields(def) : [];
  const systemGroups = def ? SYSTEM_GROUPS : [];
  const groupDef = [...groupFields, ...systemGroups].find((f) => f.apiName === draft.groupField);
  const grouped = !!draft.groupField;
  const dateGroup = isDateField(groupDef);
  const numFields = def ? numericFields(def) : [];
  const metricDef = numFields.find((f) => f.apiName === draft.metricField);
  const limit = parseLimit(draft.limit);

  const nameError = draft.name.trim() ? null : 'Name is required';
  const objectError = def ? null : 'Choose an object';
  const groupError = grouped && !groupDef ? 'This field is no longer available. Choose another one.' : null;
  const metricError = draft.fn !== 'count' && !metricDef ? 'Choose a numeric field' : null;
  const limitError = grouped ? limit.error : null;
  const specValid = !objectError && !groupError && !metricError;

  const spec: Spec = {
    object: draft.object,
    filters: completeFilter(draft.filters),
    groupBy: grouped ? (dateGroup ? { field: draft.groupField, interval: draft.interval } : { field: draft.groupField }) : null,
    metric: draft.fn === 'count' ? { fn: 'count' } : { fn: draft.fn, field: draft.metricField },
    sort: grouped ? draft.sort : 'natural',
    limit: grouped ? limit.value : null,
  };
  // Debounce the serialized spec (a fresh object every render would never settle).
  const specJson = JSON.stringify(spec);
  const debounced = useDebounced(specJson, 400);
  const preview = useQuery({
    queryKey: ['report-preview', debounced],
    queryFn: () => api.post<ReportResult>('/api/reports/preview', JSON.parse(debounced) as Spec),
    placeholderData: keepPreviousData,
    enabled: specValid,
  });
  const previewFn = (JSON.parse(debounced) as Spec).metric.fn;
  const updating = specValid && (preview.isFetching || specJson !== debounced);

  const save = useMutation({
    mutationFn: (body: ReportInput) => (id ? api.patch<ReportDef>(`/api/reports/${encodeURIComponent(id)}`, body) : api.post<ReportDef>('/api/reports', body)),
    onSuccess: async (saved) => {
      await Promise.all(['reports', 'report', 'dashboard'].map((k) => qc.invalidateQueries({ queryKey: [k] })));
      toast.success(id ? `Report “${saved.name}” saved` : `Report “${saved.name}” created`);
      navigate(`/reports/${saved.id}`);
    },
  });

  const submit = () => {
    setAttempted(true);
    const problem = nameError ?? objectError ?? groupError ?? metricError ?? limitError;
    if (problem) {
      toast.error(problem);
      return;
    }
    save.mutate({ ...spec, name: draft.name.trim(), description: draft.description.trim(), chart: draft.chart, app: draft.app || null });
  };

  const cancel = async () => {
    const dirty = JSON.stringify(draft) !== JSON.stringify(start);
    if (dirty && !(await confirm({ title: 'Discard changes?', message: 'Your changes to this report have not been saved.', confirmLabel: 'Discard', danger: true }))) return;
    navigate(id ? `/reports/${id}` : '/reports');
  };

  const changeObject = (object: string) => {
    const next = objectList.find((o) => o.apiName === object);
    if (!next) return;
    const { groupField, metricField } = objectDefaults(next);
    setDraft((d) => ({ ...d, object, filters: null, groupField, metricField, fn: metricField ? d.fn : 'count', chart: fitChart(d.chart, !!groupField) }));
  };
  const changeGroup = (groupField: string) => setDraft((d) => ({ ...d, groupField, chart: fitChart(d.chart, !!groupField) }));
  const changeFn = (fn: MetricFn) =>
    setDraft((d) => ({ ...d, fn, metricField: fn === 'count' || numFields.some((f) => f.apiName === d.metricField) ? d.metricField : (numFields[0]?.apiName ?? '') }));

  return (
    <div className="mx-auto max-w-7xl p-6">
      <PageHeader
        icon="chart-column"
        color="blue"
        title={id ? 'Edit report' : 'New report'}
        subtitle={id ? start.name : 'Choose the records, what to measure and how to group it, then pick a chart.'}
        actions={
          <>
            <Button onClick={() => void cancel()}>Cancel</Button>
            <Button variant="primary" icon={Save} loading={save.isPending} onClick={submit}>
              {id ? 'Save report' : 'Create report'}
            </Button>
          </>
        }
      />

      {loadError ? (
        <div role="status" className="mb-4 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
          <span>This report cannot run as saved ({errorMessage(loadError)}). Fix it below and save.</span>
        </div>
      ) : null}
      <ErrorBanner error={save.error} className="mb-4" />

      <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <div className="min-w-0 space-y-6">
          <Card title="Details">
            <div className="grid gap-4 sm:grid-cols-2">
              <FormField label="Name" htmlFor="report-name" required error={attempted ? nameError : null} className="sm:col-span-2">
                <input id="report-name" className="input" value={draft.name} maxLength={120} placeholder="e.g. Open pipeline by stage" onChange={(e) => set({ name: e.target.value })} />
              </FormField>
              <FormField label="Description" htmlFor="report-description" className="sm:col-span-2">
                <textarea id="report-description" className="input" rows={2} maxLength={1000} value={draft.description} onChange={(e) => set({ description: e.target.value })} />
              </FormField>
              <FormField label="Object" htmlFor="report-object" required error={objectError} help="Changing the object resets the filters, grouping and measured field.">
                <select id="report-object" className="input" value={draft.object} onChange={(e) => changeObject(e.target.value)}>
                  {!def && <option value={draft.object}>{draft.object ? `${draft.object} (unavailable)` : 'Choose an object…'}</option>}
                  {objectList.map((o) => (
                    <option key={o.apiName} value={o.apiName}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </FormField>
              <FormField label="App" htmlFor="report-app" help="Lists the report under an app.">
                <select id="report-app" className="input" value={draft.app} onChange={(e) => set({ app: e.target.value })}>
                  <option value="">None</option>
                  {draft.app && !apps.data?.some((a) => a.id === draft.app) && <option value={draft.app}>{draft.app}</option>}
                  {apps.data?.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
                </select>
              </FormField>
            </div>
          </Card>

          <Card title="Filters">
            {def ? (
              <>
                <FilterEditor def={def} value={draft.filters} onChange={(filters) => set({ filters })} />
                <p className="mt-3 text-xs text-slate-500">Conditions without a value are ignored. Each viewer only counts the records they have access to.</p>
              </>
            ) : (
              <p className="text-sm text-slate-500">Choose an object to add filters.</p>
            )}
          </Card>

          <Card title="Group & measure">
            <div className="grid gap-4 sm:grid-cols-2">
              <FormField label="Group by" htmlFor="report-group" error={groupError}>
                <select id="report-group" className="input" value={draft.groupField} onChange={(e) => changeGroup(e.target.value)}>
                  <option value="">None (single value)</option>
                  {grouped && !groupDef && <option value={draft.groupField}>{draft.groupField} (unavailable)</option>}
                  {groupFields.length > 0 && (
                    <optgroup label="Fields">
                      {groupFields.map((f) => (
                        <option key={f.apiName} value={f.apiName}>
                          {f.label}
                        </option>
                      ))}
                    </optgroup>
                  )}
                  {systemGroups.length > 0 && (
                    <optgroup label="System">
                      {systemGroups.map((f) => (
                        <option key={f.apiName} value={f.apiName}>
                          {f.label}
                        </option>
                      ))}
                    </optgroup>
                  )}
                </select>
              </FormField>
              {dateGroup && (
                <FormField label="Date interval" htmlFor="report-interval">
                  <select id="report-interval" className="input" value={draft.interval} onChange={(e) => set({ interval: e.target.value as DateInterval })}>
                    {INTERVALS.map((i) => (
                      <option key={i.id} value={i.id}>
                        {i.label}
                      </option>
                    ))}
                  </select>
                </FormField>
              )}
              <FormField
                label="Measure"
                htmlFor="report-fn"
                className="sm:col-start-1"
                help={def && numFields.length === 0 ? `${def.label} has no numeric fields, so only record counts are available.` : undefined}
              >
                <select id="report-fn" className="input" value={draft.fn} onChange={(e) => changeFn(e.target.value as MetricFn)}>
                  {FNS.map((f) => (
                    <option key={f.id} value={f.id} disabled={f.id !== 'count' && numFields.length === 0 && draft.fn !== f.id}>
                      {f.label}
                    </option>
                  ))}
                </select>
              </FormField>
              {draft.fn !== 'count' && (
                <FormField label="Of field" htmlFor="report-metric-field" required error={metricError}>
                  <select id="report-metric-field" className="input" value={draft.metricField} onChange={(e) => set({ metricField: e.target.value })}>
                    {!metricDef && <option value={draft.metricField}>{draft.metricField ? `${draft.metricField} (not available)` : 'Choose a field…'}</option>}
                    {numFields.map((f) => (
                      <option key={f.apiName} value={f.apiName}>
                        {f.label}
                      </option>
                    ))}
                  </select>
                </FormField>
              )}
              {grouped && (
                <>
                  <FormField label="Sort groups by" htmlFor="report-sort" className="sm:col-start-1">
                    <select id="report-sort" className="input" value={draft.sort} onChange={(e) => set({ sort: e.target.value as Sort })}>
                      {SORTS.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.label}
                        </option>
                      ))}
                    </select>
                  </FormField>
                  <FormField label="Show at most" htmlFor="report-limit" error={limitError} help="Number of groups (1–100). Leave empty to show all.">
                    <input
                      id="report-limit"
                      type="number"
                      inputMode="numeric"
                      min={1}
                      max={100}
                      step={1}
                      className="input"
                      placeholder="All groups"
                      value={draft.limit}
                      onChange={(e) => set({ limit: e.target.value })}
                    />
                  </FormField>
                </>
              )}
            </div>
          </Card>

          <Card title="Chart">
            <fieldset>
              <legend className="sr-only">Chart type</legend>
              <div className="grid grid-cols-4 gap-2">
                {CHARTS.map((c) => {
                  const active = draft.chart === c.id;
                  return (
                    <label
                      key={c.id}
                      className={cx(
                        // `relative` keeps the visually hidden radio inside the scroll container (no page jump on focus).
                        'relative flex cursor-pointer flex-col items-center gap-1.5 rounded-lg border px-2 py-3 text-xs font-medium transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-indigo-500/50',
                        active ? 'border-indigo-500 bg-indigo-50 text-indigo-700' : 'border-slate-200 text-slate-600 hover:border-slate-300 hover:bg-slate-50',
                      )}
                    >
                      <input type="radio" name="report-chart" value={c.id} checked={active} onChange={() => set({ chart: c.id })} className="sr-only" />
                      <c.icon className="size-5" aria-hidden />
                      {c.label}
                    </label>
                  );
                })}
              </div>
            </fieldset>
            {draft.chart === 'kpi' && grouped && <p className="mt-3 text-xs text-slate-500">A KPI shows only the overall value. The grouped breakdown is still listed in the report’s data table.</p>}
            {!grouped && draft.chart !== 'kpi' && <p className="mt-3 text-xs text-slate-500">Without grouping the report has a single value, so a KPI usually works best.</p>}
          </Card>
        </div>

        <div className="min-w-0 xl:sticky xl:top-6">
          <Card title="Preview" actions={updating ? <Spinner className="size-4" /> : null}>
            {!specValid ? (
              <p className="py-12 text-center text-sm text-slate-400">{objectError ?? groupError ?? metricError}</p>
            ) : preview.error ? (
              <ErrorBanner error={preview.error} />
            ) : preview.data ? (
              <div className={cx('transition-opacity', preview.isPlaceholderData && 'opacity-60')}>
                <ReportChart chart={draft.chart} result={preview.data} height={300} />
                <p className="mt-3 border-t border-slate-100 pt-3 text-xs text-slate-500">
                  {plural(preview.data.rows.length, 'row')} · {previewFn === 'count' || previewFn === 'sum' ? 'total' : 'overall'}{' '}
                  <span className="font-medium text-slate-700 tabular-nums">{formatNumber(preview.data.total, preview.data.format)}</span>
                </p>
              </div>
            ) : (
              <Loading label="Running preview…" />
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}

export default function ReportBuilder() {
  const { id } = useParams();
  const [params] = useSearchParams();
  const perms = usePermissions();
  const analyst = perms.canManageAutomations;
  const objects = useObjects();
  const reportQ = useQuery({
    queryKey: ['report', id],
    queryFn: () => api.get<{ report: ReportDef; result: ReportResult }>(`/api/reports/${encodeURIComponent(id ?? '')}`),
    enabled: analyst && !!id,
  });
  // A saved report that no longer runs (e.g. it uses a deleted field) is loaded from the list instead, so it can be fixed.
  const unrunnable = reportQ.error instanceof ApiError && (reportQ.error.status === 400 || reportQ.error.status === 403);
  const listQ = useQuery({ queryKey: ['reports'], queryFn: () => api.get<ReportDef[]>('/api/reports'), enabled: unrunnable });
  const back = id ? `/reports/${id}` : '/reports';
  const backLink = (
    <Link to={back} className="text-sm font-medium text-indigo-600 hover:underline">
      {id ? 'Back to report' : 'Back to reports'}
    </Link>
  );

  if (!analyst) {
    return (
      <div className="p-6">
        <div className="card">
          <EmptyState icon={Lock} title="You don’t have permission to edit reports" action={backLink}>
            Creating and editing reports requires the Setup or Manage Automations permission. You can still view and run existing reports.
          </EmptyState>
        </div>
      </div>
    );
  }
  if (objects.isLoading || reportQ.isLoading || (unrunnable && listQ.isLoading)) return <Loading />;
  if (objects.error) {
    return (
      <div className="p-6">
        <ErrorBanner error={objects.error} />
      </div>
    );
  }

  const report = reportQ.data?.report ?? (unrunnable ? listQ.data?.find((r) => r.id === id) : undefined);
  if (id && !report) {
    const notFound = reportQ.error instanceof ApiError && reportQ.error.status === 404;
    return (
      <div className="p-6">
        {notFound ? (
          <div className="card">
            <EmptyState
              icon={ChartColumn}
              title="Report not found"
              action={
                <Link to="/reports" className="text-sm font-medium text-indigo-600 hover:underline">
                  Back to reports
                </Link>
              }
            >
              It may have been deleted.
            </EmptyState>
          </div>
        ) : (
          <ErrorBanner error={reportQ.error ?? listQ.error ?? 'This report could not be loaded.'} />
        )}
      </div>
    );
  }
  if (!report && !objects.data?.length) {
    return (
      <div className="p-6">
        <div className="card">
          <EmptyState icon={ChartColumn} title="No objects to report on" action={backLink}>
            You need read access to at least one object to build a report.
          </EmptyState>
        </div>
      </div>
    );
  }

  const initial = report ? draftFrom(report) : newDraft(objects.data ?? [], params.get('object'), params.get('app'));
  return <Builder key={id ?? 'new'} id={id} initial={initial} loadError={report && unrunnable ? reportQ.error : null} />;
}
