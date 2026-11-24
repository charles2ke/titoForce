import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { AgentRun, ApprovalRequest, AppDef, QueryResponse } from '@titoforce/shared';
import { ArrowRight, Bot, CalendarClock, Circle, CircleCheck, Inbox, LayoutDashboard, Sparkles } from 'lucide-react';
import { Link, useParams } from 'react-router';
import { api, errorMessage } from '../api.ts';
import { DashboardGrid, useDashboard } from '../components/DashboardGrid.tsx';
import { useToast } from '../components/feedback.tsx';
import { Badge, Button, Card, cx, EmptyState, ErrorBanner, Loading, ObjectTile } from '../components/ui.tsx';
import { type MessageKey, t } from '../i18n/index.ts';
import { formatDate, relativeTime, todayIso } from '../lib/format.ts';
import { invalidateRecordData, useAiPanel, useApps, useAuth, useObjects, usePermissions } from '../lib/hooks.ts';

const greeting = (name: string) => {
  const h = new Date().getHours();
  return t(h < 12 ? 'home.greeting.morning' : h < 18 ? 'home.greeting.afternoon' : 'home.greeting.evening', { name });
};

function CardTitle({ icon: IconCmp, children }: { icon: typeof Inbox; children: string }) {
  return (
    <span className="flex items-center gap-2">
      <IconCmp className="size-4 text-slate-400" aria-hidden />
      {children}
    </span>
  );
}

function MyTasks() {
  const { user } = useAuth();
  const { canEdit } = usePermissions();
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({
    queryKey: ['home-tasks'],
    queryFn: () =>
      api.post<QueryResponse>('/api/records/activity/query', {
        filters: {
          match: 'all',
          rules: [
            { field: 'status', op: 'eq', value: 'Open' },
            { field: 'owner_id', op: 'eq', value: user.id },
          ],
        },
        sort: { field: 'due_date', dir: 'asc' },
        pageSize: 8,
      }),
  });
  const complete = useMutation({
    mutationFn: (id: string) => api.patch(`/api/records/activity/${id}`, { fields: { status: 'Completed' } }),
    onSuccess: () => {
      toast.success(t('home.tasks.completed'));
      return invalidateRecordData(qc);
    },
    onError: (err) => toast.error(errorMessage(err)),
  });
  const today = todayIso();
  const total = q.data?.total ?? 0;
  return (
    <Card
      title={<CardTitle icon={CalendarClock}>{t('home.tasks.title')}</CardTitle>}
      actions={
        total > 0 && (
          <Link to="/o/activity" className="text-xs font-medium text-indigo-600 hover:underline">
            {t('home.tasks.allActivities')}
          </Link>
        )
      }
      bodyClassName="p-0"
    >
      {q.isLoading ? (
        <Loading />
      ) : q.error ? (
        <ErrorBanner error={q.error} className="m-4" />
      ) : !q.data?.records.length ? (
        <p className="px-4 py-8 text-center text-sm text-slate-400">{t('home.tasks.empty')}</p>
      ) : (
        <ul className="divide-y divide-slate-100" aria-label={t('home.tasks.title')}>
          {q.data.records.map((r) => {
            const due = typeof r.fields.due_date === 'string' ? r.fields.due_date : null;
            const related = typeof r.fields.related_to === 'string' ? r.fields.related_to : null;
            const overdue = !!due && due < today;
            return (
              <li key={r.id} className="flex items-start gap-2.5 px-4 py-2.5">
                <button
                  type="button"
                  disabled={!canEdit('activity', r.ownerId) || complete.isPending}
                  onClick={() => complete.mutate(r.id)}
                  aria-label={t('home.tasks.markNamedComplete', { name: r.name })}
                  title={t('home.tasks.markComplete')}
                  className="group mt-0.5 shrink-0 text-slate-300 hover:text-emerald-600 disabled:cursor-not-allowed"
                >
                  <Circle className="size-4 group-hover:hidden" aria-hidden />
                  <CircleCheck className="hidden size-4 group-hover:block" aria-hidden />
                </button>
                <div className="min-w-0 flex-1">
                  <Link to={`/r/${r.id}`} className="block truncate text-sm font-medium text-slate-800 hover:text-indigo-700 hover:underline">
                    {r.name}
                  </Link>
                  <p className="flex flex-wrap items-center gap-x-1.5 text-xs text-slate-500">
                    {typeof r.fields.type === 'string' && <span>{r.fields.type}</span>}
                    {related && q.data.refs[related] && (
                      <>
                        <span aria-hidden>·</span>
                        <Link to={`/r/${related}`} className="truncate hover:text-indigo-700 hover:underline">
                          {q.data.refs[related].name}
                        </Link>
                      </>
                    )}
                  </p>
                </div>
                {due ? (
                  <span className={cx('shrink-0 text-xs tabular-nums', overdue ? 'font-medium text-rose-600' : due === today ? 'font-medium text-amber-600' : 'text-slate-500')}>
                    {overdue ? t('home.tasks.overdue', { date: formatDate(due) }) : due === today ? t('home.tasks.dueToday', { date: formatDate(due) }) : formatDate(due)}
                  </span>
                ) : (
                  <span className="shrink-0 text-xs text-slate-300">{t('home.tasks.noDate')}</span>
                )}
              </li>
            );
          })}
          {total > q.data.records.length && <li className="px-4 py-2 text-xs text-slate-400">{t('home.tasks.more', { count: total - q.data.records.length })}</li>}
        </ul>
      )}
    </Card>
  );
}

function MyApprovals() {
  const q = useQuery({ queryKey: ['approvals', 'to_me', 'pending'], queryFn: () => api.get<ApprovalRequest[]>('/api/approvals?scope=to_me&status=pending'), refetchInterval: 30_000 });
  const items = q.data ?? [];
  return (
    <Card
      title={<CardTitle icon={Inbox}>{t('home.approvals.title')}</CardTitle>}
      actions={
        <Link to="/approvals" className="text-xs font-medium text-indigo-600 hover:underline">
          {t('home.approvals.inbox')}
        </Link>
      }
      bodyClassName="p-0"
    >
      {q.isLoading ? (
        <Loading />
      ) : q.error ? (
        <ErrorBanner error={q.error} className="m-4" />
      ) : !items.length ? (
        <p className="px-4 py-6 text-center text-sm text-slate-400">{t('home.approvals.empty')}</p>
      ) : (
        <ul className="divide-y divide-slate-100">
          {items.slice(0, 5).map((a) => (
            <li key={a.id} className="px-4 py-2.5">
              <Link to={`/r/${a.recordId}`} className="block truncate text-sm font-medium text-slate-800 hover:text-indigo-700 hover:underline">
                {a.recordName}
              </Link>
              <p className="truncate text-xs text-slate-500">
                {t('home.approvals.details', { process: a.processName, user: a.submittedByName, time: relativeTime(a.createdAt) })}
              </p>
            </li>
          ))}
          {items.length > 5 && (
            <li className="px-4 py-2 text-xs">
              <Link to="/approvals" className="text-indigo-600 hover:underline">
                {t('home.approvals.viewAll', { count: items.length })}
              </Link>
            </li>
          )}
        </ul>
      )}
    </Card>
  );
}

const RUN_COLOR: Record<AgentRun['status'], string> = { running: 'blue', completed: 'green', failed: 'red' };
const RUN_TRIGGERS: Record<Exclude<AgentRun['trigger'], 'chat'>, MessageKey> = {
  automation: 'home.runs.trigger.automation',
  record_action: 'home.runs.trigger.recordAction',
  api: 'home.runs.trigger.api',
};
const triggerLabel = (trigger: Exclude<AgentRun['trigger'], 'chat'>) => (Object.hasOwn(RUN_TRIGGERS, trigger) ? t(RUN_TRIGGERS[trigger]) : trigger);

function RecentRuns() {
  const q = useQuery({ queryKey: ['agent-runs', 'recent'], queryFn: () => api.get<AgentRun[]>('/api/agent-runs?limit=5') });
  return (
    <Card
      title={<CardTitle icon={Bot}>{t('home.runs.title')}</CardTitle>}
      actions={
        <Link to="/agents" className="text-xs font-medium text-indigo-600 hover:underline">
          {t('home.runs.agents')}
        </Link>
      }
      bodyClassName="p-0"
    >
      {q.isLoading ? (
        <Loading />
      ) : q.error ? (
        <ErrorBanner error={q.error} className="m-4" />
      ) : !q.data?.length ? (
        <p className="px-4 py-6 text-center text-sm text-slate-400">{t('home.runs.empty')}</p>
      ) : (
        <ul className="divide-y divide-slate-100">
          {q.data.map((r) => {
            const to = r.conversationId ? `/agents/${r.agentId}?c=${r.conversationId}` : r.recordId ? `/r/${r.recordId}` : `/agents/${r.agentId}`;
            return (
              <li key={r.id} className="px-4 py-2.5">
                <div className="flex items-center gap-2">
                  <Link to={to} className="min-w-0 flex-1 truncate text-sm font-medium text-slate-800 hover:text-indigo-700 hover:underline">
                    {r.agentName}
                  </Link>
                  <Badge color={RUN_COLOR[r.status]}>{t(`home.runs.status.${r.status}`)}</Badge>
                </div>
                <p className="truncate text-xs text-slate-500" title={r.input}>
                  {r.trigger === 'chat' ? '' : `${triggerLabel(r.trigger)} · `}
                  {r.input || '—'}
                </p>
                <p className="text-[11px] text-slate-400">{relativeTime(r.createdAt)}</p>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

function HomeDashboard({ dashboardId }: { dashboardId: string }) {
  const q = useDashboard(dashboardId);
  if (q.isLoading) return <Loading />;
  if (q.error) return <ErrorBanner error={q.error} />;
  if (!q.data) return null;
  return (
    <section aria-label={q.data.dashboard.name} className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-800">
          <LayoutDashboard className="size-4 text-slate-400" aria-hidden />
          {q.data.dashboard.name}
        </h2>
        <Link to={`/dashboards/${dashboardId}`} className="inline-flex items-center gap-1 text-xs font-medium text-indigo-600 hover:underline">
          {t('home.dashboard.open')} <ArrowRight className="size-3" aria-hidden />
        </Link>
      </div>
      <DashboardGrid widgets={q.data.widgets} />
    </section>
  );
}

function QuickLinks({ app }: { app: AppDef }) {
  const objects = useObjects();
  const byApi = new Map((objects.data ?? []).map((o) => [o.apiName, o]));
  const items = app.nav.flatMap((n) => {
    if (n.type !== 'object') return [];
    const def = byApi.get(n.object);
    return def ? [{ def, label: n.label || def.pluralLabel, view: n.view }] : [];
  });
  if (!items.length) return null;
  return (
    <nav aria-label={t('home.quickLinks')} className="grid grid-cols-2 gap-2 @lg:grid-cols-3 @5xl:grid-cols-6">
      {items.map(({ def, label, view }) => (
        <Link
          key={def.apiName}
          to={`/o/${def.apiName}${view && view !== 'table' ? `?vt=${view}` : ''}`}
          className="flex min-w-0 items-center gap-2.5 rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm font-medium text-slate-700 shadow-xs hover:border-indigo-200 hover:text-indigo-700"
        >
          <ObjectTile icon={def.icon} color={def.color} size="sm" />
          <span className="truncate">{label}</span>
        </Link>
      ))}
    </nav>
  );
}

export default function AppHome() {
  const { appId } = useParams();
  const apps = useApps();
  const { user } = useAuth();
  const ai = useAiPanel();
  if (apps.isLoading) return <Loading />;
  const app = apps.data?.find((a) => a.id === appId);
  if (!app) {
    return (
      <EmptyState
        icon={LayoutDashboard}
        title={t('home.appNotFound.title')}
        action={
          <Link to="/" className="text-sm font-medium text-indigo-600 hover:underline">
            {t('home.appNotFound.goHome')}
          </Link>
        }
      >
        {apps.error ? errorMessage(apps.error) : t('home.appNotFound.message')}
      </EmptyState>
    );
  }
  return (
    <div className="mx-auto max-w-7xl space-y-5 p-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex min-w-0 items-center gap-3">
          <ObjectTile icon={app.icon} color={app.color} size="lg" />
          <div className="min-w-0">
            <h1 className="truncate text-xl font-semibold text-slate-900">
              {greeting(user.name.split(' ')[0])}
            </h1>
            <p className="truncate text-sm text-slate-500">
              {app.name}
              {app.description ? ` — ${app.description}` : ''}
            </p>
          </div>
        </div>
        <Button variant="ai" icon={Sparkles} onClick={() => ai.open()}>
          {t('home.askAi')}
        </Button>
      </div>
      <QuickLinks app={app} />
      {/* Side by side only when the dashboard still gets room for three columns; otherwise "My work" goes below it. */}
      <div className="grid gap-5 @6xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="min-w-0">
          {app.dashboardId ? (
            <HomeDashboard dashboardId={app.dashboardId} />
          ) : (
            <Card title={<CardTitle icon={LayoutDashboard}>{t('home.dashboard.title')}</CardTitle>}>
              <p className="text-sm text-slate-500">
                {t('home.dashboard.noneAssigned')}{' '}
                <Link to="/dashboards" className="text-indigo-600 hover:underline">
                  {t('home.dashboard.browse')}
                </Link>
              </p>
            </Card>
          )}
        </div>
        <aside className="@container min-w-0" aria-label={t('home.myWork')}>
          <div className="grid gap-5 @lg:grid-cols-2 @2xl:grid-cols-3">
            <MyTasks />
            <MyApprovals />
            <RecentRuns />
          </div>
        </aside>
      </div>
    </div>
  );
}
