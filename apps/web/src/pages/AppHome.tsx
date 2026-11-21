import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { AgentRun, ApprovalRequest, AppDef, QueryResponse } from '@titoforce/shared';
import { ArrowRight, Bot, CalendarClock, Circle, CircleCheck, Inbox, LayoutDashboard, Sparkles } from 'lucide-react';
import { Link, useParams } from 'react-router';
import { api, errorMessage } from '../api.ts';
import { DashboardGrid, useDashboard } from '../components/DashboardGrid.tsx';
import { useToast } from '../components/feedback.tsx';
import { Badge, Button, Card, cx, EmptyState, ErrorBanner, Loading, ObjectTile } from '../components/ui.tsx';
import { formatDate, plural, relativeTime, todayIso } from '../lib/format.ts';
import { invalidateRecordData, useAiPanel, useApps, useAuth, useObjects, usePermissions } from '../lib/hooks.ts';

const greeting = () => {
  const h = new Date().getHours();
  return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
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
      toast.success('Task completed');
      return invalidateRecordData(qc);
    },
    onError: (err) => toast.error(errorMessage(err)),
  });
  const today = todayIso();
  const total = q.data?.total ?? 0;
  return (
    <Card
      title={<CardTitle icon={CalendarClock}>My open tasks</CardTitle>}
      actions={
        total > 0 && (
          <Link to="/o/activity" className="text-xs font-medium text-indigo-600 hover:underline">
            All activities
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
        <p className="px-4 py-8 text-center text-sm text-slate-400">Nothing open — you’re all caught up.</p>
      ) : (
        <ul className="divide-y divide-slate-100" aria-label="My open tasks">
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
                  aria-label={`Mark “${r.name}” complete`}
                  title="Mark complete"
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
                    {overdue ? 'Overdue · ' : due === today ? 'Today · ' : ''}
                    {formatDate(due)}
                  </span>
                ) : (
                  <span className="shrink-0 text-xs text-slate-300">No date</span>
                )}
              </li>
            );
          })}
          {total > q.data.records.length && <li className="px-4 py-2 text-xs text-slate-400">+{plural(total - q.data.records.length, 'more open task')}</li>}
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
      title={<CardTitle icon={Inbox}>Awaiting my approval</CardTitle>}
      actions={
        <Link to="/approvals" className="text-xs font-medium text-indigo-600 hover:underline">
          Inbox
        </Link>
      }
      bodyClassName="p-0"
    >
      {q.isLoading ? (
        <Loading />
      ) : q.error ? (
        <ErrorBanner error={q.error} className="m-4" />
      ) : !items.length ? (
        <p className="px-4 py-6 text-center text-sm text-slate-400">No requests waiting for you.</p>
      ) : (
        <ul className="divide-y divide-slate-100">
          {items.slice(0, 5).map((a) => (
            <li key={a.id} className="px-4 py-2.5">
              <Link to={`/r/${a.recordId}`} className="block truncate text-sm font-medium text-slate-800 hover:text-indigo-700 hover:underline">
                {a.recordName}
              </Link>
              <p className="truncate text-xs text-slate-500">
                {a.processName} · from {a.submittedByName} · {relativeTime(a.createdAt)}
              </p>
            </li>
          ))}
          {items.length > 5 && (
            <li className="px-4 py-2 text-xs">
              <Link to="/approvals" className="text-indigo-600 hover:underline">
                View all {items.length}
              </Link>
            </li>
          )}
        </ul>
      )}
    </Card>
  );
}

const RUN_COLOR: Record<AgentRun['status'], string> = { running: 'blue', completed: 'green', failed: 'red' };

function RecentRuns() {
  const q = useQuery({ queryKey: ['agent-runs', 'recent'], queryFn: () => api.get<AgentRun[]>('/api/agent-runs?limit=5') });
  return (
    <Card
      title={<CardTitle icon={Bot}>Recent AI activity</CardTitle>}
      actions={
        <Link to="/agents" className="text-xs font-medium text-indigo-600 hover:underline">
          Agents
        </Link>
      }
      bodyClassName="p-0"
    >
      {q.isLoading ? (
        <Loading />
      ) : q.error ? (
        <ErrorBanner error={q.error} className="m-4" />
      ) : !q.data?.length ? (
        <p className="px-4 py-6 text-center text-sm text-slate-400">No agent runs yet. Ask an agent something to get started.</p>
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
                  <Badge color={RUN_COLOR[r.status]}>{r.status}</Badge>
                </div>
                <p className="truncate text-xs text-slate-500" title={r.input}>
                  {r.trigger === 'chat' ? '' : `${r.trigger} · `}
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
          Open dashboard <ArrowRight className="size-3" aria-hidden />
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
    <nav aria-label="Quick links" className="grid grid-cols-2 gap-2 @lg:grid-cols-3 @5xl:grid-cols-6">
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
      <EmptyState icon={LayoutDashboard} title="App not found" action={<Link to="/" className="text-sm font-medium text-indigo-600 hover:underline">Go to your home page</Link>}>
        {apps.error ? errorMessage(apps.error) : 'This app does not exist or was removed.'}
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
              {greeting()}, {user.name.split(' ')[0]}
            </h1>
            <p className="truncate text-sm text-slate-500">
              {app.name}
              {app.description ? ` — ${app.description}` : ''}
            </p>
          </div>
        </div>
        <Button variant="ai" icon={Sparkles} onClick={() => ai.open()}>
          Ask AI
        </Button>
      </div>
      <QuickLinks app={app} />
      {/* Side by side only when the dashboard still gets room for three columns; otherwise "My work" goes below it. */}
      <div className="grid gap-5 @6xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="min-w-0">
          {app.dashboardId ? (
            <HomeDashboard dashboardId={app.dashboardId} />
          ) : (
            <Card title={<CardTitle icon={LayoutDashboard}>Dashboard</CardTitle>}>
              <p className="text-sm text-slate-500">
                No dashboard is assigned to this app.{' '}
                <Link to="/dashboards" className="text-indigo-600 hover:underline">
                  Browse dashboards
                </Link>
              </p>
            </Card>
          )}
        </div>
        <aside className="@container min-w-0" aria-label="My work">
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
