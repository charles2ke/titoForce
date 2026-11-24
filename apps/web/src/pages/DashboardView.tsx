import type { DashboardDef, DashboardWidget, ReportDef } from '@titoforce/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowDown, ArrowLeft, ArrowUp, Ellipsis, LayoutDashboard, Pencil, Plus, RefreshCw, Save, Trash2 } from 'lucide-react';
import { useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { ApiError, api, errorMessage } from '../api.ts';
import { DashboardGrid, type RenderedWidget, useDashboard } from '../components/DashboardGrid.tsx';
import { useConfirm, useToast } from '../components/feedback.tsx';
import { Badge, Button, Card, cx, EmptyState, ErrorBanner, FormField, IconButton, Loading, MenuItem, PageHeader, Popover } from '../components/ui.tsx';
import { intlLocale, type MessageKey, t } from '../i18n/index.ts';
import { useApps, useObjects, usePermissions } from '../lib/hooks.ts';

type Size = 1 | 2 | 3;
type DashboardInput = Pick<DashboardDef, 'name' | 'description' | 'app' | 'widgets'>;

interface EditWidget {
  key: number;
  reportId: string;
  title: string;
  size: Size;
}

const MAX_WIDGETS = 24;
const SIZES: { id: Size; label: MessageKey }[] = [
  { id: 1, label: 'dashboards.editor.sizes.small' },
  { id: 2, label: 'dashboards.editor.sizes.medium' },
  { id: 3, label: 'dashboards.editor.sizes.full' },
];
// Literal class names so Tailwind generates them.
const SPAN: Record<Size, string> = { 1: 'col-span-1', 2: 'col-span-2', 3: 'col-span-3' };

const snapshot = (name: string, description: string, app: string, widgets: EditWidget[]) =>
  JSON.stringify({ name, description, app, widgets: widgets.map(({ reportId, title, size }) => ({ reportId, title, size })) });

function DashboardEditor({ dashboard, rendered, onDone }: { dashboard: DashboardDef; rendered: RenderedWidget[]; onDone: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const confirm = useConfirm();
  const objects = useObjects();
  const apps = useApps();
  const reportsQ = useQuery({ queryKey: ['reports'], queryFn: () => api.get<ReportDef[]>('/api/reports') });

  const [name, setName] = useState(dashboard.name);
  const [description, setDescription] = useState(dashboard.description);
  const [app, setApp] = useState(dashboard.app ?? '');
  const [widgets, setWidgets] = useState<EditWidget[]>(() => dashboard.widgets.map((w, i) => ({ key: i, reportId: w.reportId, title: w.title ?? '', size: w.size ?? 1 })));
  const nextKey = useRef(dashboard.widgets.length);
  const [start] = useState(() => snapshot(name, description, app, widgets));
  const [attempted, setAttempted] = useState(false);

  const reportById = new Map<string, ReportDef>();
  for (const w of rendered) if (w.report) reportById.set(w.report.id, w.report);
  for (const r of reportsQ.data ?? []) reportById.set(r.id, r);
  // Widgets whose report was deleted would be rejected by the server, so they are dropped on save.
  const isDeleted = (reportId: string) => !reportById.has(reportId) && (reportsQ.isSuccess || rendered.some((w) => w.reportId === reportId && !w.report));
  const defs = new Map((objects.data ?? []).map((o) => [o.apiName, o]));
  const objectLabel = (object: string) => defs.get(object)?.pluralLabel ?? object;
  const reportGroups = new Map<string, ReportDef[]>();
  for (const r of [...(reportsQ.data ?? [])].sort((a, b) => a.name.localeCompare(b.name))) reportGroups.set(r.object, [...(reportGroups.get(r.object) ?? []), r]);
  const groups = [...reportGroups].sort((a, b) => objectLabel(a[0]).localeCompare(objectLabel(b[0])));
  const full = widgets.length >= MAX_WIDGETS;
  const removedCount = widgets.filter((w) => isDeleted(w.reportId)).length;

  const update = (key: number, patch: Partial<EditWidget>) => setWidgets((ws) => ws.map((w) => (w.key === key ? { ...w, ...patch } : w)));
  const move = (from: number, to: number) =>
    setWidgets((ws) => {
      if (to < 0 || to >= ws.length) return ws;
      const next = [...ws];
      const [item] = next.splice(from, 1);
      if (item) next.splice(to, 0, item);
      return next;
    });
  const add = (reportId: string) => {
    if (!reportId || full) return;
    const key = nextKey.current++;
    setWidgets((ws) => [...ws, { key, reportId, title: '', size: 1 }]);
  };

  const save = useMutation({
    mutationFn: (body: DashboardInput) => api.patch<DashboardDef>(`/api/dashboards/${encodeURIComponent(dashboard.id)}`, body),
    onSuccess: async (d) => {
      await Promise.all([qc.invalidateQueries({ queryKey: ['dashboard'] }), qc.invalidateQueries({ queryKey: ['dashboards'] })]);
      toast.success(t('dashboards.editor.saved', { name: d.name }));
      onDone();
    },
  });

  const submit = () => {
    setAttempted(true);
    if (!name.trim()) {
      toast.error(t('dashboards.editor.nameRequired'));
      return;
    }
    save.mutate({
      name: name.trim(),
      description: description.trim(),
      app: app || null,
      widgets: widgets
        .filter((w) => !isDeleted(w.reportId))
        .map((w): DashboardWidget => {
          const title = w.title.trim();
          return title ? { reportId: w.reportId, title, size: w.size } : { reportId: w.reportId, size: w.size };
        }),
    });
  };

  const cancel = async () => {
    const dirty = snapshot(name, description, app, widgets) !== start;
    if (dirty && !(await confirm({ title: t('dashboards.editor.discardTitle'), message: t('dashboards.editor.discardMessage'), confirmLabel: t('dashboards.editor.discard'), danger: true }))) return;
    onDone();
  };

  return (
    <div className="mx-auto max-w-5xl p-6">
      <PageHeader
        icon="layout-grid"
        color="indigo"
        title={t('dashboards.editor.title')}
        subtitle={dashboard.name}
        actions={
          <>
            <Button onClick={() => void cancel()} disabled={save.isPending}>
              {t('common.cancel')}
            </Button>
            <Button variant="primary" icon={Save} loading={save.isPending} onClick={submit}>
              {t('dashboards.editor.save')}
            </Button>
          </>
        }
      />
      <ErrorBanner error={save.error} className="mb-4" />

      <div className="space-y-6">
        <Card title={t('common.details')}>
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField label={t('common.name')} htmlFor="dashboard-name" required error={attempted && !name.trim() ? t('dashboards.editor.nameRequired') : null}>
              <input id="dashboard-name" className="input" value={name} maxLength={120} onChange={(e) => setName(e.target.value)} />
            </FormField>
            <FormField label={t('dashboards.editor.app')} htmlFor="dashboard-app" help={t('dashboards.editor.appHelp')}>
              <select id="dashboard-app" className="input" value={app} onChange={(e) => setApp(e.target.value)}>
                <option value="">{t('common.none')}</option>
                {app && !apps.data?.some((a) => a.id === app) && <option value={app}>{app}</option>}
                {apps.data?.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
            </FormField>
            <FormField label={t('common.description')} htmlFor="dashboard-description" className="sm:col-span-2">
              <textarea id="dashboard-description" className="input" rows={2} maxLength={1000} value={description} onChange={(e) => setDescription(e.target.value)} />
            </FormField>
          </div>
        </Card>

        <Card
          title={t('dashboards.editor.widgets')}
          actions={
            <span className="text-xs text-slate-500">
              {widgets.length} / {MAX_WIDGETS}
            </span>
          }
          bodyClassName=""
        >
          {widgets.length === 0 ? (
            <p className="px-4 py-8 text-center text-sm text-slate-500">{t('dashboards.editor.noWidgets')}</p>
          ) : (
            <ol className="divide-y divide-slate-100">
              {widgets.map((w, i) => {
                const report = reportById.get(w.reportId);
                const deleted = isDeleted(w.reportId);
                const n = i + 1;
                return (
                  <li key={w.key} className={cx('flex flex-wrap items-center gap-3 px-4 py-3', deleted && 'bg-rose-50/50')}>
                    <span className="w-5 shrink-0 text-center text-xs font-medium text-slate-400">{n}</span>
                    <div className="min-w-0 flex-1 basis-56">
                      {deleted ? (
                        <p className="text-sm font-medium text-rose-700">{t('dashboards.editor.deletedReport')}</p>
                      ) : (
                        <>
                          <input
                            aria-label={t('dashboards.editor.widgetTitle', { number: n })}
                            className="input"
                            placeholder={report?.name ?? t('dashboards.editor.report')}
                            value={w.title}
                            maxLength={120}
                            onChange={(e) => update(w.key, { title: e.target.value })}
                          />
                          <p className="mt-1 truncate text-xs text-slate-500">
                            {report ? `${report.name} · ${objectLabel(report.object)}` : t('dashboards.editor.loadingReport')}
                            {w.title.trim() ? '' : ` · ${t('dashboards.editor.usesReportName')}`}
                          </p>
                        </>
                      )}
                    </div>
                    <select
                      aria-label={t('dashboards.editor.widgetSize', { number: n })}
                      className="input w-auto"
                      value={w.size}
                      disabled={deleted}
                      onChange={(e) => update(w.key, { size: Number(e.target.value) as Size })}
                    >
                      {SIZES.map((s) => (
                        <option key={s.id} value={s.id}>
                          {t(s.label)}
                        </option>
                      ))}
                    </select>
                    <div className="flex items-center">
                      <IconButton
                        icon={ArrowUp}
                        label={t('dashboards.editor.moveUp', { number: n })}
                        disabled={i === 0}
                        onClick={() => move(i, i - 1)}
                        className="disabled:pointer-events-none disabled:opacity-30"
                      />
                      <IconButton
                        icon={ArrowDown}
                        label={t('dashboards.editor.moveDown', { number: n })}
                        disabled={i === widgets.length - 1}
                        onClick={() => move(i, i + 1)}
                        className="disabled:pointer-events-none disabled:opacity-30"
                      />
                      <IconButton icon={Trash2} label={t('dashboards.editor.remove', { number: n })} onClick={() => setWidgets((ws) => ws.filter((x) => x.key !== w.key))} />
                    </div>
                  </li>
                );
              })}
            </ol>
          )}
          <div className="flex flex-wrap items-center gap-2 border-t border-slate-100 px-4 py-3">
            <Plus className="size-4 shrink-0 text-slate-400" aria-hidden />
            <select aria-label={t('dashboards.editor.addReport')} className="input w-full sm:w-96" value="" disabled={full || !reportsQ.data?.length} onChange={(e) => add(e.target.value)}>
              <option value="">
                {full
                  ? t('dashboards.editor.maxWidgets', { max: MAX_WIDGETS })
                  : reportsQ.isLoading
                    ? t('dashboards.editor.loadingReports')
                    : reportsQ.data?.length
                      ? t('dashboards.editor.addReportOption')
                      : t('dashboards.editor.noReports')}
              </option>
              {groups.map(([object, list]) => (
                <optgroup key={object} label={objectLabel(object)}>
                  {list.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
            {removedCount > 0 && <span className="text-xs text-rose-600">{t('dashboards.editor.deletedReportsRemoved', { count: removedCount })}</span>}
          </div>
          {reportsQ.error ? <ErrorBanner error={reportsQ.error} className="mx-4 mb-3" /> : null}
        </Card>

        {widgets.length > 0 && (
          <Card title={t('dashboards.editor.layoutPreview')}>
            <div className="grid grid-cols-3 gap-2" aria-hidden>
              {widgets.map((w) => (
                <div
                  key={w.key}
                  className={cx(
                    'truncate rounded-md border border-dashed px-2 py-3 text-xs',
                    SPAN[w.size],
                    isDeleted(w.reportId) ? 'border-rose-200 bg-rose-50 text-rose-500 line-through' : 'border-indigo-200 bg-indigo-50/60 text-indigo-700',
                  )}
                >
                  {w.title.trim() || reportById.get(w.reportId)?.name || t('dashboards.editor.report')}
                </div>
              ))}
            </div>
            <p className="mt-3 text-xs text-slate-500">{t('dashboards.editor.smallScreens')}</p>
          </Card>
        )}
      </div>
    </div>
  );
}

export default function DashboardView() {
  const { id = '' } = useParams();
  const [params, setParams] = useSearchParams();
  const perms = usePermissions();
  const analyst = perms.canManageAutomations;
  const q = useDashboard(id);
  const apps = useApps();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const toast = useToast();
  const confirm = useConfirm();
  const editing = analyst && params.get('edit') === '1';

  const setEditing = (on: boolean) =>
    setParams(
      (p) => {
        if (on) p.set('edit', '1');
        else p.delete('edit');
        return p;
      },
      { replace: true },
    );

  if (q.isLoading) return <Loading />;
  if (q.error instanceof ApiError && q.error.status === 404) {
    return (
      <div className="p-6">
        <div className="card">
          <EmptyState
            icon={LayoutDashboard}
            title={t('dashboards.view.notFound')}
            action={
              <Link to="/dashboards" className="text-sm font-medium text-indigo-600 hover:underline">
                {t('dashboards.view.backToList')}
              </Link>
            }
          >
            {t('dashboards.view.notFoundMessage')}
          </EmptyState>
        </div>
      </div>
    );
  }
  if (!q.data) {
    return (
      <div className="p-6">
        <ErrorBanner error={q.error ?? t('dashboards.view.loadFailed')} />
      </div>
    );
  }

  const { dashboard, widgets } = q.data;
  if (editing) return <DashboardEditor key={dashboard.id} dashboard={dashboard} rendered={widgets} onDone={() => setEditing(false)} />;

  const appName = dashboard.app ? (apps.data?.find((a) => a.id === dashboard.app)?.name ?? dashboard.app) : null;
  const asOf = new Date(q.dataUpdatedAt).toLocaleTimeString(intlLocale(), { hour: 'numeric', minute: '2-digit' });

  const remove = async () => {
    const homes = (apps.data ?? []).filter((a) => a.dashboardId === dashboard.id);
    const ok = await confirm({
      title: t('dashboards.view.deleteTitle'),
      message: (
        <>
          <p>{t('dashboards.view.deleteMessage', { name: dashboard.name })}</p>
          {homes.length > 0 && <p className="mt-2">{t('dashboards.view.deleteHomeOf', { apps: homes.map((a) => a.name).join(', ') })}</p>}
        </>
      ),
      confirmLabel: t('common.delete'),
      danger: true,
    });
    if (!ok) return;
    try {
      await api.del(`/api/dashboards/${encodeURIComponent(dashboard.id)}`);
      navigate('/dashboards', { replace: true });
      qc.removeQueries({ queryKey: ['dashboard', dashboard.id] });
      await qc.invalidateQueries({ queryKey: ['dashboards'] });
      toast.success(t('dashboards.view.deleted', { name: dashboard.name }));
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  return (
    <div className="mx-auto max-w-7xl p-6">
      <Link to="/dashboards" className="mb-3 inline-flex items-center gap-1 text-xs font-medium text-slate-500 hover:text-indigo-600">
        <ArrowLeft className="size-3.5" aria-hidden />
        {t('dashboards.title')}
      </Link>
      <PageHeader
        icon="layout-grid"
        color="indigo"
        title={dashboard.name}
        subtitle={dashboard.description || undefined}
        actions={
          <>
            <Button icon={RefreshCw} loading={q.isFetching} onClick={() => void q.refetch()}>
              {t('common.refresh')}
            </Button>
            {analyst && (
              <>
                <Button icon={Pencil} onClick={() => setEditing(true)}>
                  {t('common.edit')}
                </Button>
                <Popover
                  align="right"
                  className="w-44"
                  trigger={({ open, toggle }) => (
                    <button
                      type="button"
                      onClick={toggle}
                      aria-expanded={open}
                      aria-label={t('common.moreActions')}
                      title={t('common.moreActions')}
                      className="inline-flex size-9 items-center justify-center rounded-lg border border-slate-300 bg-white text-slate-600 shadow-xs hover:bg-slate-50 hover:text-slate-900"
                    >
                      <Ellipsis className="size-4" aria-hidden />
                    </button>
                  )}
                >
                  {(close) => (
                    <div className="py-1">
                      <MenuItem
                        icon={Trash2}
                        danger
                        onClick={() => {
                          close();
                          void remove();
                        }}
                      >
                        {t('dashboards.view.deleteDashboard')}
                      </MenuItem>
                    </div>
                  )}
                </Popover>
              </>
            )}
          </>
        }
      >
        {appName && (
          <Badge color="indigo" className="mt-1.5">
            {appName}
          </Badge>
        )}
      </PageHeader>

      {q.error ? <ErrorBanner error={q.error} className="mb-4" /> : null}
      <DashboardGrid widgets={widgets} />
      {widgets.length > 0 && <p className="mt-4 text-xs text-slate-400">{t('dashboards.view.dataAsOf', { time: asOf })}</p>}
    </div>
  );
}
