import type { DashboardDef } from '@titoforce/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { LayoutDashboard, Plus } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { api } from '../api.ts';
import { useToast } from '../components/feedback.tsx';
import { Badge, Button, cx, EmptyState, ErrorBanner, FormField, Loading, Modal, PageHeader } from '../components/ui.tsx';
import { formatDateTime, plural, relativeTime } from '../lib/format.ts';
import { useApps, usePermissions } from '../lib/hooks.ts';

// Literal class names so Tailwind generates them.
const SPAN: Record<1 | 2 | 3, string> = { 1: 'col-span-1', 2: 'col-span-2', 3: 'col-span-3' };

/** Miniature of the widget layout (sizes are column spans in a 3-column grid). */
function LayoutThumb({ widgets }: { widgets: DashboardDef['widgets'] }) {
  if (!widgets.length) {
    return <div className="flex h-14 items-center justify-center rounded-md border border-dashed border-slate-200 text-xs text-slate-400">No widgets yet</div>;
  }
  return (
    <div className="grid h-14 grid-cols-3 content-start gap-1 overflow-hidden" aria-hidden>
      {widgets.map((w, i) => (
        <div key={i} className={cx('h-4 rounded-sm bg-indigo-100', SPAN[w.size ?? 1] ?? SPAN[1])} />
      ))}
    </div>
  );
}

function NewDashboardModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const create = useMutation({
    mutationFn: () => api.post<DashboardDef>('/api/dashboards', { name: name.trim(), description: description.trim(), app: null, widgets: [] }),
    onSuccess: async (d) => {
      await qc.invalidateQueries({ queryKey: ['dashboards'] });
      toast.success(`Dashboard “${d.name}” created`);
      navigate(`/dashboards/${d.id}?edit=1`);
    },
  });
  const close = () => {
    if (create.isPending) return;
    setName('');
    setDescription('');
    create.reset();
    onClose();
  };

  return (
    <Modal
      open={open}
      onClose={close}
      title="New dashboard"
      size="sm"
      footer={
        <>
          <Button onClick={close} disabled={create.isPending}>
            Cancel
          </Button>
          <Button variant="primary" type="submit" form="new-dashboard-form" loading={create.isPending} disabled={!name.trim()}>
            Create
          </Button>
        </>
      }
    >
      <form
        id="new-dashboard-form"
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (name.trim() && !create.isPending) create.mutate();
        }}
      >
        <ErrorBanner error={create.error} />
        <FormField label="Name" htmlFor="new-dashboard-name" required>
          <input id="new-dashboard-name" className="input" value={name} maxLength={120} placeholder="e.g. Sales overview" onChange={(e) => setName(e.target.value)} />
        </FormField>
        <FormField label="Description" htmlFor="new-dashboard-description">
          <textarea id="new-dashboard-description" className="input" rows={3} maxLength={1000} value={description} onChange={(e) => setDescription(e.target.value)} />
        </FormField>
        <p className="text-xs text-slate-500">You can add reports to the dashboard next.</p>
      </form>
    </Modal>
  );
}

export default function Dashboards() {
  const perms = usePermissions();
  const analyst = perms.canManageAutomations;
  const apps = useApps();
  const [creating, setCreating] = useState(false);
  const q = useQuery({ queryKey: ['dashboards'], queryFn: () => api.get<DashboardDef[]>('/api/dashboards') });
  const appNames = new Map((apps.data ?? []).map((a) => [a.id, a.name]));
  const dashboards = [...(q.data ?? [])].sort((a, b) => a.name.localeCompare(b.name));

  const newButton = analyst ? (
    <Button variant="primary" icon={Plus} onClick={() => setCreating(true)}>
      New dashboard
    </Button>
  ) : null;

  return (
    <div className="mx-auto max-w-6xl p-6">
      <PageHeader icon="layout-grid" color="indigo" title="Dashboards" subtitle="Collections of report charts. Everyone sees results for the records they can access." actions={newButton} />

      {q.isLoading ? (
        <Loading />
      ) : q.error ? (
        <ErrorBanner error={q.error} />
      ) : dashboards.length === 0 ? (
        <div className="card">
          <EmptyState icon={LayoutDashboard} title="No dashboards yet" action={newButton}>
            {analyst ? 'Create a dashboard to put several report charts on one page.' : 'Dashboards created by your analysts and admins will appear here.'}
          </EmptyState>
        </div>
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {dashboards.map((d) => {
            const appName = d.app ? (appNames.get(d.app) ?? d.app) : null;
            return (
              <li key={d.id}>
                <Link
                  to={`/dashboards/${d.id}`}
                  className="card flex h-full flex-col gap-3 p-4 transition hover:border-indigo-300 hover:shadow-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-500"
                >
                  <div className="flex items-start gap-3">
                    <span className="inline-flex size-9 shrink-0 items-center justify-center rounded-lg bg-indigo-50 text-indigo-600">
                      <LayoutDashboard className="size-5" aria-hidden />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-semibold text-slate-900">{d.name}</p>
                      {appName && (
                        <Badge color="indigo" className="mt-1">
                          {appName}
                        </Badge>
                      )}
                    </div>
                  </div>
                  <p className={cx('line-clamp-2 min-h-10 text-sm', d.description ? 'text-slate-600' : 'text-slate-400 italic')}>{d.description || 'No description'}</p>
                  <LayoutThumb widgets={d.widgets} />
                  <div className="mt-auto flex items-center justify-between gap-2 text-xs text-slate-500">
                    <span>{plural(d.widgets.length, 'widget')}</span>
                    <span title={`Last modified ${formatDateTime(d.updatedAt)}`}>Updated {relativeTime(d.updatedAt)}</span>
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}

      {analyst && <NewDashboardModal open={creating} onClose={() => setCreating(false)} />}
    </div>
  );
}
