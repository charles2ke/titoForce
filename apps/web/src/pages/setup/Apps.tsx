import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type AppDef, type AppNavItem, type AppPage, type DashboardDef, type ObjectDef, PALETTE, type PaletteColor, type ViewType } from '@titoforce/shared';
import { ArrowDown, ArrowUp, Database, FileText, LayoutGrid, Pencil, Plus, Trash, X } from 'lucide-react';
import { useId, useRef, useState } from 'react';
import { api, errorMessage } from '../../api.ts';
import { useConfirm, useToast } from '../../components/feedback.tsx';
import { ColorPicker, IconPicker } from '../../components/pickers.tsx';
import { Badge, Button, EmptyState, ErrorBanner, FormField, IconButton, Loading, Modal, ObjectTile, PageHeader } from '../../components/ui.tsx';
import { type MessageKey, t, tEn } from '../../i18n/index.ts';
import { Icon } from '../../lib/icons.tsx';
import { invalidateMetadata, useSetupApps, useSetupObjects } from '../../lib/hooks.ts';

const APP_ID_RE = /^[a-z][a-z0-9_]{1,39}$/;
const MAX_NAV = 30;

// Page labels are also the default labels of new navigation items, which are saved as data and stay English (tEn).
const PAGES: { id: AppPage; label: MessageKey; icon: string; help: MessageKey }[] = [
  { id: 'home', label: 'setupApps.pages.home.label', icon: 'house', help: 'setupApps.pages.home.help' },
  { id: 'forecast', label: 'setupApps.pages.forecast.label', icon: 'trending-up', help: 'setupApps.pages.forecast.help' },
  { id: 'org-chart', label: 'setupApps.pages.orgChart.label', icon: 'network', help: 'setupApps.pages.orgChart.help' },
  { id: 'reports', label: 'setupApps.pages.reports.label', icon: 'chart-column', help: 'setupApps.pages.reports.help' },
];

const VIEWS: { id: ViewType; label: MessageKey }[] = [
  { id: 'table', label: 'setupApps.views.table' },
  { id: 'kanban', label: 'setupApps.views.kanban' },
  { id: 'calendar', label: 'setupApps.views.calendar' },
  { id: 'timeline', label: 'setupApps.views.timeline' },
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
      {rows.length === 0 && <p className="rounded-lg border border-dashed border-slate-300 px-3 py-4 text-center text-sm text-slate-500">{t('setupApps.nav.empty')}</p>}
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
                    {t('common.object')}
                  </Badge>
                  <select aria-label={t('setupApps.nav.itemObject', { n })} className="input min-w-36 flex-1" value={r.object} onChange={(e) => replace(r.key, { ...r, object: e.target.value, view: undefined })}>
                    {!def && <option value={r.object}>{r.object || t('common.choose')}</option>}
                    {sorted.map((o) => (
                      <option key={o.apiName} value={o.apiName}>
                        {o.pluralLabel}
                      </option>
                    ))}
                  </select>
                  <input aria-label={t('setupApps.nav.itemLabel', { n })} className="input min-w-28 flex-1" value={r.label ?? ''} maxLength={60} placeholder={def?.pluralLabel ?? t('common.label')} onChange={(e) => replace(r.key, { ...r, label: e.target.value })} />
                  <select aria-label={t('setupApps.nav.itemView', { n })} className="input w-32 shrink-0" value={r.view ?? ''} onChange={(e) => replace(r.key, { ...r, view: (e.target.value || undefined) as ViewType | undefined })}>
                    <option value="">{t('setupApps.nav.defaultView')}</option>
                    {VIEWS.filter((v) => viewsFor(def).includes(v.id) || v.id === r.view).map((v) => (
                      <option key={v.id} value={v.id}>
                        {t(v.label)}
                      </option>
                    ))}
                  </select>
                </>
              ) : (
                <>
                  <Badge color="purple">
                    <FileText className="mr-1 inline size-3" aria-hidden />
                    {t('setupApps.nav.page')}
                  </Badge>
                  <select
                    aria-label={t('setupApps.nav.itemPage', { n })}
                    className="input min-w-32 flex-1"
                    value={r.page}
                    onChange={(e) => {
                      const page = PAGES.find((p) => p.id === e.target.value)!;
                      const prev = PAGES.find((p) => p.id === r.page);
                      replace(r.key, { ...r, page: page.id, label: !r.label || r.label === (prev && tEn(prev.label)) ? tEn(page.label) : r.label, icon: !r.icon || r.icon === prev?.icon ? page.icon : r.icon });
                    }}
                  >
                    {PAGES.map((p) => (
                      <option key={p.id} value={p.id}>
                        {t(p.label)}
                      </option>
                    ))}
                  </select>
                  <input aria-label={t('setupApps.nav.itemLabel', { n })} className="input min-w-28 flex-1" value={r.label} maxLength={60} placeholder={t('common.label')} onChange={(e) => replace(r.key, { ...r, label: e.target.value })} />
                  <div className="w-40 shrink-0">
                    <IconPicker id={`nav-icon-${r.key}`} value={r.icon} onChange={(icon) => replace(r.key, { ...r, icon })} />
                    <label htmlFor={`nav-icon-${r.key}`} className="sr-only">
                      {t('setupApps.nav.itemIcon', { n })}
                    </label>
                  </div>
                </>
              )}
              <div className="flex shrink-0 items-center">
                <IconButton icon={ArrowUp} label={t('setupApps.nav.moveUp', { n })} className="size-7 disabled:opacity-30" disabled={i === 0} onClick={() => move(i, i - 1)} />
                <IconButton icon={ArrowDown} label={t('setupApps.nav.moveDown', { n })} className="size-7 disabled:opacity-30" disabled={i === rows.length - 1} onClick={() => move(i, i + 1)} />
                <IconButton icon={X} label={t('setupApps.nav.remove', { n })} className="size-7" onClick={() => onChange(rows.filter((x) => x.key !== r.key))} />
              </div>
            </li>
          );
        })}
      </ol>
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" icon={Plus} disabled={full || !firstUnused} onClick={() => onChange([...rows, { key: seq.current++, type: 'object', object: firstUnused!.apiName }])}>
          {t('setupApps.nav.addObject')}
        </Button>
        <Button
          size="sm"
          icon={Plus}
          disabled={full}
          onClick={() => {
            const page = PAGES.find((p) => !rows.some((r) => r.type === 'page' && r.page === p.id)) ?? PAGES[0]!;
            onChange([...rows, { key: seq.current++, type: 'page', page: page.id, label: tEn(page.label), icon: page.icon }]);
          }}
        >
          {t('setupApps.nav.addPage')}
        </Button>
        <span className="text-xs text-slate-400">{t('setupApps.nav.count', { used: rows.length, max: MAX_NAV })}</span>
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
  const [nav, setNav] = useState<NavRow[]>(() => (app?.nav ?? [{ type: 'page', page: 'home', label: tEn('setupApps.pages.home.label'), icon: 'house' } as AppNavItem]).map((n, i) => ({ ...n, key: i })));

  const effectiveId = isNew ? (idTouched ? appId : appIdFrom(name)) : (app?.id ?? '');
  const idError =
    !isNew || !effectiveId
      ? null
      : !APP_ID_RE.test(effectiveId)
        ? t('setupApps.form.idInvalid')
        : apps.some((a) => a.id === effectiveId)
          ? t('setupApps.form.idTaken')
          : null;
  const order = Number(sortOrder);
  const problem = !name.trim()
    ? t('setupApps.form.problems.enterName')
    : isNew && (!effectiveId || idError)
      ? t('setupApps.form.problems.fixId')
      : !Number.isInteger(order) || order < 0 || order > 1000
        ? t('setupApps.form.problems.sortOrder')
        : nav.some((n) => n.type === 'page' && !n.label.trim())
          ? t('setupApps.form.problems.pageLabel')
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
      toast.success(isNew ? t('setupApps.toasts.created', { name: saved.name }) : t('setupApps.toasts.saved', { name: saved.name }));
      onClose();
      await invalidateMetadata(qc);
    },
  });

  const sortedDashboards = [...(dashboards.data ?? [])].sort((a, b) => a.name.localeCompare(b.name));

  return (
    <Modal
      open
      onClose={onClose}
      title={isNew ? t('setupApps.new') : t('setupApps.edit', { name: app?.name ?? '' })}
      size="xl"
      footer={
        <>
          {problem && <span className="mr-auto text-xs text-slate-500">{problem}</span>}
          <Button onClick={onClose}>{t('common.cancel')}</Button>
          <Button variant="primary" type="submit" form={formId} disabled={!!problem} loading={save.isPending}>
            {isNew ? t('setupApps.form.create') : t('setupApps.form.save')}
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
          <FormField label={t('setupApps.form.name')} required htmlFor={ids.name}>
            <input id={ids.name} className="input" value={name} maxLength={40} placeholder={t('setupApps.form.namePlaceholder')} onChange={(e) => setName(e.target.value)} />
          </FormField>
          {isNew ? (
            <FormField label={t('setupApps.form.id')} required htmlFor={ids.id} error={idError} help={t('setupApps.form.idHelp')}>
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
            <FormField label={t('setupApps.form.id')}>
              <div className="input bg-slate-50 font-mono text-slate-600">{app?.id}</div>
            </FormField>
          )}
          <FormField label={t('common.description')} htmlFor={ids.desc} className="sm:col-span-2">
            <input id={ids.desc} className="input" value={description} maxLength={500} onChange={(e) => setDescription(e.target.value)} />
          </FormField>
          <FormField label={t('common.icon')} htmlFor={ids.icon}>
            <IconPicker id={ids.icon} value={icon} onChange={setIcon} />
          </FormField>
          <div>
            <span className="label">{t('common.color')}</span>
            <ColorPicker value={color} onChange={setColor} />
          </div>
          <FormField label={t('setupApps.homeDashboard')} htmlFor={ids.dashboard} help={t('setupApps.form.homeDashboardHelp')}>
            <select id={ids.dashboard} className="input" value={dashboardId} onChange={(e) => setDashboardId(e.target.value)}>
              <option value="">{t('common.none')}</option>
              {dashboardId && !sortedDashboards.some((d) => d.id === dashboardId) && <option value={dashboardId}>{dashboards.isLoading ? t('common.loading') : dashboardId}</option>}
              {sortedDashboards.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
          </FormField>
          <FormField label={t('setupApps.form.sortOrder')} htmlFor={ids.order} help={t('setupApps.form.sortOrderHelp')}>
            <input id={ids.order} type="number" min={0} max={1000} step={1} className="input" value={sortOrder} onChange={(e) => setSortOrder(e.target.value)} />
          </FormField>
        </div>
        <fieldset>
          <legend className="label">{t('setupApps.navigation')}</legend>
          <p className="mb-2 text-xs text-slate-500">{t('setupApps.form.navigationHelp')}</p>
          <NavEditor rows={nav} onChange={setNav} objects={objects} />
        </fieldset>
      </form>
    </Modal>
  );
}

export default function Apps() {
  const apps = useSetupApps();
  const objects = useSetupObjects();
  const dashboards = useDashboards();
  const qc = useQueryClient();
  const toast = useToast();
  const confirm = useConfirm();
  const [editing, setEditing] = useState<AppDef | 'new' | null>(null);

  const remove = useMutation({
    mutationFn: (app: AppDef) => api.del(`/api/apps/${app.id}`),
    onSuccess: async (_r, app) => {
      toast.success(t('setupApps.toasts.deleted', { name: app.name }));
      await invalidateMetadata(qc);
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const list = [...(apps.data ?? [])].sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));
  const dashboardName = (id: string | null) => (id ? (dashboards.data?.find((d) => d.id === id)?.name ?? '—') : '—');

  return (
    <div className="mx-auto max-w-6xl p-6">
      <PageHeader
        title={t('setupApps.title')}
        subtitle={t('setupApps.subtitle')}
        actions={
          <Button variant="primary" icon={Plus} disabled={!apps.data || !objects.data} onClick={() => setEditing('new')}>
            {t('setupApps.new')}
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
          <EmptyState icon={LayoutGrid} title={t('setupApps.list.empty')} action={<Button icon={Plus} disabled={!objects.data} onClick={() => setEditing('new')}>{t('setupApps.list.createFirst')}</Button>} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50/70 text-left text-xs font-semibold text-slate-500 uppercase">
                <tr>
                  <th className="px-4 py-2.5">{t('setupApps.list.app')}</th>
                  <th className="px-4 py-2.5">{t('common.description')}</th>
                  <th className="px-4 py-2.5">{t('setupApps.navigation')}</th>
                  <th className="px-4 py-2.5">{t('setupApps.homeDashboard')}</th>
                  <th className="px-4 py-2.5 text-right">{t('setupApps.list.order')}</th>
                  <th className="px-4 py-2.5">
                    <span className="sr-only">{t('common.actions')}</span>
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
                        {a.nav.length > 6 && <span className="text-xs text-slate-400">{t('setupApps.list.more', { count: a.nav.length - 6 })}</span>}
                      </div>
                    </td>
                    <td className="px-4 py-2.5 text-slate-600">{dashboardName(a.dashboardId)}</td>
                    <td className="px-4 py-2.5 text-right text-slate-600 tabular-nums">{a.sortOrder}</td>
                    <td className="px-4 py-2.5">
                      <div className="flex justify-end gap-0.5">
                        <IconButton icon={Pencil} label={t('setupApps.edit', { name: a.name })} disabled={!objects.data} onClick={() => setEditing(a)} />
                        <IconButton
                          icon={Trash}
                          label={t('setupApps.list.delete', { name: a.name })}
                          className="hover:text-rose-600"
                          disabled={remove.isPending}
                          onClick={async () => {
                            const ok = await confirm({ title: t('setupApps.list.deleteTitle', { name: a.name }), message: t('setupApps.list.deleteMessage'), confirmLabel: t('setupApps.list.deleteConfirm'), danger: true });
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
