import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type AppDef, type AppNavItem, type AppPage, type DashboardDef, type ObjectDef, PALETTE, type PaletteColor, type ViewType } from '@titoforce/shared';
import { ArrowDown, ArrowUp, Database, FileText, LayoutGrid, Pencil, Plus, Trash, X } from 'lucide-react';
import { useId, useRef, useState } from 'react';
import { api, errorMessage } from '../../api.ts';
import { useConfirm, useToast } from '../../components/feedback.tsx';
import { ColorPicker, IconPicker } from '../../components/pickers.tsx';
import { Badge, Button, EmptyState, ErrorBanner, FormField, IconButton, Loading, Modal, ObjectTile, PageHeader } from '../../components/ui.tsx';
import { Icon } from '../../lib/icons.tsx';
import { invalidateMetadata, useApps, useObjects } from '../../lib/hooks.ts';

const APP_ID_RE = /^[a-z][a-z0-9_]{1,39}$/;
const MAX_NAV = 30;

const PAGES: { id: AppPage; label: string; icon: string; help: string }[] = [
  { id: 'home', label: 'Home', icon: 'house', help: 'The app’s home dashboard and assistant.' },
  { id: 'forecast', label: 'Forecast', icon: 'trending-up', help: 'Sales forecast by owner and period.' },
  { id: 'org-chart', label: 'Org Chart', icon: 'network', help: 'Employee hierarchy.' },
  { id: 'reports', label: 'Reports', icon: 'chart-column', help: 'Reports and dashboards.' },
];

const VIEWS: { id: ViewType; label: string }[] = [
  { id: 'table', label: 'Table' },
  { id: 'kanban', label: 'Kanban' },
  { id: 'calendar', label: 'Calendar' },
  { id: 'timeline', label: 'Timeline' },
];

const appIdFrom = (name: string) =>
  name
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^[^a-z]+/, '')
    .replace(/_+$/, '')
    .slice(0, 40);

const isPalette = (c: string): c is PaletteColor => (PALETTE as readonly string[]).includes(c);

/** Views that make sense for an object (Kanban needs a picklist, Timeline a start/end date). */
function viewsFor(def: ObjectDef | undefined): ViewType[] {
  if (!def) return ['table'];
  const out: ViewType[] = ['table'];
  if (def.statusField || def.fields.some((f) => f.type === 'picklist')) out.push('kanban');
  out.push('calendar');
  if (def.timeline) out.push('timeline');
  return out;
}

type NavRow = { key: number } & AppNavItem;

function useDashboards() {
  return useQuery({ queryKey: ['dashboards'], queryFn: () => api.get<DashboardDef[]>('/api/dashboards') });
}

function NavEditor({ rows, onChange, objects }: { rows: NavRow[]; onChange: (rows: NavRow[]) => void; objects: ObjectDef[] }) {
  const seq = useRef(rows.length + 1);
  const sorted = [...objects].sort((a, b) => a.label.localeCompare(b.label));
  const replace = (key: number, next: NavRow) => onChange(rows.map((r) => (r.key === key ? next : r)));
  const move = (i: number, j: number) => {
    if (j < 0 || j >= rows.length) return;
    const next = [...rows];
    [next[i], next[j]] = [next[j]!, next[i]!];
    onChange(next);
  };
  const full = rows.length >= MAX_NAV;
  const firstUnused = sorted.find((o) => !rows.some((r) => r.type === 'object' && r.object === o.apiName)) ?? sorted[0];

  return (
    <div className="space-y-2">
      {rows.length === 0 && <p className="rounded-lg border border-dashed border-slate-300 px-3 py-4 text-center text-sm text-slate-500">No navigation items yet. Add objects and pages below.</p>}
      <ol className="space-y-2">
        {rows.map((r, i) => {
          const n = i + 1;
          const def = r.type === 'object' ? objects.find((o) => o.apiName === r.object) : undefined;
          return (
            <li key={r.key} className="flex flex-wrap items-center gap-2 rounded-lg border border-slate-200 bg-white p-2 sm:flex-nowrap">
              <span className="w-5 shrink-0 text-center text-xs text-slate-400 tabular-nums">{n}</span>
              {r.type === 'object' ? (
                <>
                  <Badge color="blue">
                    <Database className="mr-1 inline size-3" aria-hidden />
                    Object
                  </Badge>
                  <select aria-label={`Item ${n} object`} className="input min-w-36 flex-1" value={r.object} onChange={(e) => replace(r.key, { ...r, object: e.target.value, view: undefined })}>
                    {!def && <option value={r.object}>{r.object || 'Choose…'}</option>}
                    {sorted.map((o) => (
                      <option key={o.apiName} value={o.apiName}>
                        {o.pluralLabel}
                      </option>
                    ))}
                  </select>
                  <input aria-label={`Item ${n} label`} className="input min-w-28 flex-1" value={r.label ?? ''} maxLength={60} placeholder={def?.pluralLabel ?? 'Label'} onChange={(e) => replace(r.key, { ...r, label: e.target.value })} />
                  <select aria-label={`Item ${n} default view`} className="input w-32 shrink-0" value={r.view ?? ''} onChange={(e) => replace(r.key, { ...r, view: (e.target.value || undefined) as ViewType | undefined })}>
                    <option value="">Default view</option>
                    {VIEWS.filter((v) => viewsFor(def).includes(v.id) || v.id === r.view).map((v) => (
                      <option key={v.id} value={v.id}>
                        {v.label}
                      </option>
                    ))}
                  </select>
                </>
              ) : (
                <>
                  <Badge color="purple">
                    <FileText className="mr-1 inline size-3" aria-hidden />
                    Page
                  </Badge>
                  <select
                    aria-label={`Item ${n} page`}
                    className="input min-w-32 flex-1"
                    value={r.page}
                    onChange={(e) => {
                      const page = PAGES.find((p) => p.id === e.target.value)!;
                      const prev = PAGES.find((p) => p.id === r.page);
                      replace(r.key, { ...r, page: page.id, label: !r.label || r.label === prev?.label ? page.label : r.label, icon: !r.icon || r.icon === prev?.icon ? page.icon : r.icon });
                    }}
                  >
                    {PAGES.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.label}
                      </option>
                    ))}
                  </select>
                  <input aria-label={`Item ${n} label`} className="input min-w-28 flex-1" value={r.label} maxLength={60} placeholder="Label" onChange={(e) => replace(r.key, { ...r, label: e.target.value })} />
                  <div className="w-40 shrink-0">
                    <IconPicker id={`nav-icon-${r.key}`} value={r.icon} onChange={(icon) => replace(r.key, { ...r, icon })} />
                    <label htmlFor={`nav-icon-${r.key}`} className="sr-only">
                      Item {n} icon
                    </label>
                  </div>
                </>
              )}
              <div className="flex shrink-0 items-center">
                <IconButton icon={ArrowUp} label={`Move item ${n} up`} className="size-7 disabled:opacity-30" disabled={i === 0} onClick={() => move(i, i - 1)} />
                <IconButton icon={ArrowDown} label={`Move item ${n} down`} className="size-7 disabled:opacity-30" disabled={i === rows.length - 1} onClick={() => move(i, i + 1)} />
                <IconButton icon={X} label={`Remove item ${n}`} className="size-7" onClick={() => onChange(rows.filter((x) => x.key !== r.key))} />
              </div>
            </li>
          );
        })}
      </ol>
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" icon={Plus} disabled={full || !firstUnused} onClick={() => onChange([...rows, { key: seq.current++, type: 'object', object: firstUnused!.apiName }])}>
          Add object
        </Button>
        <Button
          size="sm"
          icon={Plus}
          disabled={full}
          onClick={() => {
            const page = PAGES.find((p) => !rows.some((r) => r.type === 'page' && r.page === p.id)) ?? PAGES[0]!;
            onChange([...rows, { key: seq.current++, type: 'page', page: page.id, label: page.label, icon: page.icon }]);
          }}
        >
          Add page
        </Button>
        <span className="text-xs text-slate-400">
          {rows.length}/{MAX_NAV} items
        </span>
      </div>
    </div>
  );
}

function AppForm({ app, apps, objects, onClose }: { app: AppDef | null; apps: AppDef[]; objects: ObjectDef[]; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const dashboards = useDashboards();
  const isNew = !app;
  const formId = useId();
  const ids = { name: useId(), id: useId(), desc: useId(), icon: useId(), dashboard: useId(), order: useId() };
  const [name, setName] = useState(app?.name ?? '');
  const [appId, setAppId] = useState('');
  const [idTouched, setIdTouched] = useState(false);
  const [description, setDescription] = useState(app?.description ?? '');
  const [icon, setIcon] = useState(app?.icon ?? 'layout-grid');
  const [color, setColor] = useState<PaletteColor>(app && isPalette(app.color) ? app.color : 'indigo');
  const [dashboardId, setDashboardId] = useState(app?.dashboardId ?? '');
  const [sortOrder, setSortOrder] = useState(String(app?.sortOrder ?? Math.min(1000, Math.max(0, ...apps.map((a) => a.sortOrder)) + 1)));
  const [nav, setNav] = useState<NavRow[]>(() => (app?.nav ?? [{ type: 'page', page: 'home', label: 'Home', icon: 'house' } as AppNavItem]).map((n, i) => ({ ...n, key: i })));

  const effectiveId = isNew ? (idTouched ? appId : appIdFrom(name)) : (app?.id ?? '');
  const idError =
    !isNew || !effectiveId
      ? null
      : !APP_ID_RE.test(effectiveId)
        ? 'Use 2–40 lowercase letters, numbers and underscores, starting with a letter.'
        : apps.some((a) => a.id === effectiveId)
          ? 'An app with this id already exists.'
          : null;
  const order = Number(sortOrder);
  const problem = !name.trim()
    ? 'Enter a name.'
    : isNew && (!effectiveId || idError)
      ? 'Fix the app id.'
      : !Number.isInteger(order) || order < 0 || order > 1000
        ? 'Sort order must be a whole number from 0 to 1000.'
        : nav.some((n) => n.type === 'page' && !n.label.trim())
          ? 'Every page needs a label.'
          : null;

  const save = useMutation({
    mutationFn: () => {
      const body = {
        name: name.trim(),
        description: description.trim(),
        icon,
        color,
        dashboardId: dashboardId || null,
        sortOrder: order,
        nav: nav.map(({ key: _key, ...n }): AppNavItem => (n.type === 'object' ? { type: 'object', object: n.object, ...(n.label?.trim() ? { label: n.label.trim() } : {}), ...(n.view ? { view: n.view } : {}) } : { type: 'page', page: n.page, label: n.label.trim(), icon: n.icon })),
      };
      return isNew ? api.post<AppDef>('/api/apps', { ...body, id: effectiveId }) : api.put<AppDef>(`/api/apps/${app!.id}`, body);
    },
    onSuccess: async (saved) => {
      toast.success(isNew ? `${saved.name} app created` : `${saved.name} saved`);
      onClose();
      await invalidateMetadata(qc);
    },
  });

  const sortedDashboards = [...(dashboards.data ?? [])].sort((a, b) => a.name.localeCompare(b.name));

  return (
    <Modal
      open
      onClose={onClose}
      title={isNew ? 'New app' : `Edit ${app?.name}`}
      size="xl"
      footer={
        <>
          {problem && <span className="mr-auto text-xs text-slate-500">{problem}</span>}
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" type="submit" form={formId} disabled={!!problem} loading={save.isPending}>
            {isNew ? 'Create app' : 'Save app'}
          </Button>
        </>
      }
    >
      <form
        id={formId}
        className="space-y-5"
        onSubmit={(e) => {
          e.preventDefault();
          if (!problem) save.mutate();
        }}
      >
        <ErrorBanner error={save.error} />
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField label="App name" required htmlFor={ids.name}>
            <input id={ids.name} className="input" value={name} maxLength={40} placeholder="Customer Success" onChange={(e) => setName(e.target.value)} />
          </FormField>
          {isNew ? (
            <FormField label="App id" required htmlFor={ids.id} error={idError} help="Permanent identifier used in links.">
              <input
                id={ids.id}
                className="input font-mono"
                value={effectiveId}
                maxLength={40}
                onChange={(e) => {
                  setIdTouched(true);
                  setAppId(e.target.value);
                }}
              />
            </FormField>
          ) : (
            <FormField label="App id">
              <div className="input bg-slate-50 font-mono text-slate-600">{app?.id}</div>
            </FormField>
          )}
          <FormField label="Description" htmlFor={ids.desc} className="sm:col-span-2">
            <input id={ids.desc} className="input" value={description} maxLength={500} onChange={(e) => setDescription(e.target.value)} />
          </FormField>
          <FormField label="Icon" htmlFor={ids.icon}>
            <IconPicker id={ids.icon} value={icon} onChange={setIcon} />
          </FormField>
          <div>
            <span className="label">Color</span>
            <ColorPicker value={color} onChange={setColor} />
          </div>
          <FormField label="Home dashboard" htmlFor={ids.dashboard} help="Shown on the app’s Home page.">
            <select id={ids.dashboard} className="input" value={dashboardId} onChange={(e) => setDashboardId(e.target.value)}>
              <option value="">None</option>
              {dashboardId && !sortedDashboards.some((d) => d.id === dashboardId) && <option value={dashboardId}>{dashboards.isLoading ? 'Loading…' : dashboardId}</option>}
              {sortedDashboards.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
          </FormField>
          <FormField label="Sort order" htmlFor={ids.order} help="Lower numbers come first in the app switcher.">
            <input id={ids.order} type="number" min={0} max={1000} step={1} className="input" value={sortOrder} onChange={(e) => setSortOrder(e.target.value)} />
          </FormField>
        </div>
        <fieldset>
          <legend className="label">Navigation</legend>
          <p className="mb-2 text-xs text-slate-500">Tabs shown in the app’s sidebar, in order. Leave an object’s label empty to use its plural name.</p>
          <NavEditor rows={nav} onChange={setNav} objects={objects} />
        </fieldset>
      </form>
    </Modal>
  );
}

export default function Apps() {
  const apps = useApps();
  const objects = useObjects();
  const dashboards = useDashboards();
  const qc = useQueryClient();
  const toast = useToast();
  const confirm = useConfirm();
  const [editing, setEditing] = useState<AppDef | 'new' | null>(null);

  const remove = useMutation({
    mutationFn: (app: AppDef) => api.del(`/api/apps/${app.id}`),
    onSuccess: async (_r, app) => {
      toast.success(`${app.name} deleted`);
      await invalidateMetadata(qc);
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const list = [...(apps.data ?? [])].sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));
  const dashboardName = (id: string | null) => (id ? (dashboards.data?.find((d) => d.id === id)?.name ?? '—') : '—');

  return (
    <div className="mx-auto max-w-6xl p-6">
      <PageHeader
        title="Apps"
        subtitle="Bundle objects and pages into apps for each team. Users switch between apps from the app launcher."
        actions={
          <Button variant="primary" icon={Plus} disabled={!apps.data || !objects.data} onClick={() => setEditing('new')}>
            New app
          </Button>
        }
      />
      <div className="card overflow-hidden">
        {apps.isLoading ? (
          <Loading />
        ) : apps.error ? (
          <div className="p-4">
            <ErrorBanner error={apps.error} />
          </div>
        ) : list.length === 0 ? (
          <EmptyState icon={LayoutGrid} title="No apps yet" action={<Button icon={Plus} disabled={!objects.data} onClick={() => setEditing('new')}>Create your first app</Button>} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50/70 text-left text-xs font-semibold text-slate-500 uppercase">
                <tr>
                  <th className="px-4 py-2.5">App</th>
                  <th className="px-4 py-2.5">Description</th>
                  <th className="px-4 py-2.5">Navigation</th>
                  <th className="px-4 py-2.5">Home dashboard</th>
                  <th className="px-4 py-2.5 text-right">Order</th>
                  <th className="px-4 py-2.5">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {list.map((a) => (
                  <tr key={a.id} className="hover:bg-slate-50/70">
                    <td className="px-4 py-2.5">
                      <button type="button" className="flex items-center gap-3 text-left" onClick={() => setEditing(a)}>
                        <ObjectTile icon={a.icon} color={a.color} size="sm" />
                        <span>
                          <span className="block font-medium text-slate-900 hover:text-indigo-700">{a.name}</span>
                          <span className="block font-mono text-xs text-slate-500">{a.id}</span>
                        </span>
                      </button>
                    </td>
                    <td className="max-w-sm px-4 py-2.5 text-slate-600">{a.description}</td>
                    <td className="px-4 py-2.5">
                      <div className="flex max-w-xs flex-wrap items-center gap-1">
                        {a.nav.slice(0, 6).map((n, i) =>
                          n.type === 'object' ? (
                            <span key={i} className="rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-600">
                              {n.label || objects.data?.find((o) => o.apiName === n.object)?.pluralLabel || n.object}
                            </span>
                          ) : (
                            <span key={i} className="inline-flex items-center gap-1 rounded bg-violet-50 px-1.5 py-0.5 text-xs text-violet-700">
                              <Icon name={n.icon} className="size-3" />
                              {n.label}
                            </span>
                          ),
                        )}
                        {a.nav.length > 6 && <span className="text-xs text-slate-400">+{a.nav.length - 6} more</span>}
                      </div>
                    </td>
                    <td className="px-4 py-2.5 text-slate-600">{dashboardName(a.dashboardId)}</td>
                    <td className="px-4 py-2.5 text-right text-slate-600 tabular-nums">{a.sortOrder}</td>
                    <td className="px-4 py-2.5">
                      <div className="flex justify-end gap-0.5">
                        <IconButton icon={Pencil} label={`Edit ${a.name}`} disabled={!objects.data} onClick={() => setEditing(a)} />
                        <IconButton
                          icon={Trash}
                          label={`Delete ${a.name}`}
                          className="hover:text-rose-600"
                          disabled={remove.isPending}
                          onClick={async () => {
                            const ok = await confirm({ title: `Delete the ${a.name} app?`, message: 'Only the app is removed. Its objects, records, reports and dashboards are kept.', confirmLabel: 'Delete app', danger: true });
                            if (ok) remove.mutate(a);
                          }}
                        />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      {editing && objects.data && (
        <AppForm key={editing === 'new' ? '__new' : editing.id} app={editing === 'new' ? null : editing} apps={apps.data ?? []} objects={objects.data} onClose={() => setEditing(null)} />
      )}
    </div>
  );
}
