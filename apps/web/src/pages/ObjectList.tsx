import type { FieldDef, FilterGroup, ListViewDef, ObjectDef, SortSpec, ViewType } from '@titoforce/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarDays, Check, ChartGantt, ChevronDown, Columns3, Download, Ellipsis, Kanban, ListFilter, Pencil, Plus, Save, Search, Table2, Trash, Upload, X } from 'lucide-react';
import { type FormEvent, useMemo, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router';
import { ApiError, api, errorMessage, qs } from '../api.ts';
import { completeFilter, describeFilter, FilterEditor } from '../components/FilterEditor.tsx';
import { useConfirm, useToast } from '../components/feedback.tsx';
import { RecordFormModal } from '../components/RecordForm.tsx';
import { Button, cx, EmptyState, ErrorBanner, FormField, Loading, MenuItem, Modal, ObjectTile, Popover, Toggle } from '../components/ui.tsx';
import { CalendarView } from '../components/views/CalendarView.tsx';
import { groupableFields, KanbanView } from '../components/views/KanbanView.tsx';
import { type BaseQuery, TableView } from '../components/views/TableView.tsx';
import { TimelineView } from '../components/views/TimelineView.tsx';
import { fieldDef, listColumns, plural } from '../lib/format.ts';
import { invalidateRecordData, useAuth, useDebounced, useObjectDef, usePermissions } from '../lib/hooks.ts';

const MAX_COLUMNS = 20;

const VIEW_TYPES: { id: ViewType; label: string; icon: typeof Table2 }[] = [
  { id: 'table', label: 'Table', icon: Table2 },
  { id: 'kanban', label: 'Kanban', icon: Kanban },
  { id: 'calendar', label: 'Calendar', icon: CalendarDays },
  { id: 'timeline', label: 'Timeline', icon: ChartGantt },
];

const dateFields = (def: ObjectDef): FieldDef[] => [...def.fields.filter((f) => f.type === 'date' || f.type === 'datetime'), fieldDef(def, 'created_at')!];

function availableTypes(def: ObjectDef): ViewType[] {
  const types: ViewType[] = ['table'];
  if (groupableFields(def).length) types.push('kanban');
  types.push('calendar');
  if (def.timeline) types.push('timeline');
  return types;
}

const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

function ViewPicker({ def, views, current, onPick }: { def: ObjectDef; views: ListViewDef[]; current: ListViewDef | null; onPick: (id: string | null) => void }) {
  const { user } = useAuth();
  const mine = views.filter((v) => !v.shared && v.ownerId === user.id);
  const shared = views.filter((v) => v.shared);
  const others = views.filter((v) => !v.shared && v.ownerId !== user.id);
  const item = (v: ListViewDef | null, close: () => void) => {
    const active = (v?.id ?? null) === (current?.id ?? null);
    return (
      <button
        key={v?.id ?? 'all'}
        type="button"
        role="menuitemradio"
        aria-checked={active}
        onClick={() => {
          close();
          onPick(v?.id ?? null);
        }}
        className={cx('flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm hover:bg-slate-50', active ? 'font-medium text-indigo-700' : 'text-slate-700')}
      >
        <Check className={cx('size-3.5 shrink-0', active ? 'opacity-100' : 'opacity-0')} aria-hidden />
        <span className="truncate">{v?.name ?? `All ${def.pluralLabel}`}</span>
        {v && v.viewType !== 'table' && <span className="ml-auto text-xs text-slate-400 capitalize">{v.viewType}</span>}
      </button>
    );
  };
  const section = (title: string, list: ListViewDef[], close: () => void) =>
    list.length > 0 && (
      <div className="border-t border-slate-100 py-1">
        <p className="px-3 pt-1 pb-0.5 text-[11px] font-semibold tracking-wide text-slate-400 uppercase">{title}</p>
        {list.map((v) => item(v, close))}
      </div>
    );
  return (
    <Popover
      className="w-72"
      trigger={({ toggle, open }) => (
        <button type="button" onClick={toggle} aria-expanded={open} aria-haspopup="menu" aria-label="Select list view" className="inline-flex max-w-xs items-center gap-1.5 rounded-lg px-2 py-1 text-left hover:bg-slate-100">
          <span className="truncate text-base font-semibold text-slate-900">{current?.name ?? `All ${def.pluralLabel}`}</span>
          <ChevronDown className="size-4 shrink-0 text-slate-500" aria-hidden />
        </button>
      )}
    >
      {(close) => (
        <div role="menu" aria-label="List views" className="max-h-96 overflow-y-auto py-1">
          {item(null, close)}
          {section('Shared views', shared, close)}
          {section('My views', mine, close)}
          {section("Other users' views", others, close)}
        </div>
      )}
    </Popover>
  );
}

function ColumnsMenu({ def, columns, onChange }: { def: ObjectDef; columns: string[]; onChange: (c: string[]) => void }) {
  const options = useMemo(() => {
    const all = ['name', ...def.fields.filter((f) => f.apiName !== 'name' && f.apiName !== def.nameField).map((f) => f.apiName), 'owner_id', 'created_at', 'updated_at', 'created_by'];
    return [...new Set(all)].map((c) => fieldDef(def, c)).filter((f): f is FieldDef => !!f);
  }, [def]);
  const isName = (c: string) => c === 'name' || c === def.nameField;
  const toggle = (c: string) => onChange(columns.includes(c) ? columns.filter((x) => x !== c) : [...columns, c]);
  return (
    <Popover
      align="right"
      className="w-64"
      trigger={({ toggle: t, open }) => (
        <Button size="sm" icon={Columns3} onClick={t} aria-expanded={open}>
          Columns
        </Button>
      )}
    >
      {() => (
        <div>
          <p className="border-b border-slate-100 px-3 py-2 text-xs text-slate-500">
            {columns.length} of {MAX_COLUMNS} columns shown
          </p>
          <div className="max-h-80 overflow-y-auto py-1">
            {options.map((f) => {
              const on = columns.includes(f.apiName);
              const locked = on && isName(f.apiName);
              return (
                <label key={f.apiName} className={cx('flex items-center gap-2 px-3 py-1.5 text-sm text-slate-700', locked ? 'opacity-60' : 'cursor-pointer hover:bg-slate-50')}>
                  <input type="checkbox" className="size-4 rounded border-slate-300 text-indigo-600" checked={on} disabled={locked || (!on && columns.length >= MAX_COLUMNS)} onChange={() => toggle(f.apiName)} />
                  <span className="truncate">{f.label}</span>
                </label>
              );
            })}
          </div>
          <div className="border-t border-slate-100 px-3 py-2">
            <Button size="sm" variant="ghost" onClick={() => onChange(listColumns(def))}>
              Reset to default
            </Button>
          </div>
        </div>
      )}
    </Popover>
  );
}

function SaveViewModal({ open, onClose, title, initialName, onSave, allowShare }: { open: boolean; onClose: () => void; title: string; initialName: string; onSave: (name: string, shared: boolean) => Promise<void>; allowShare: boolean }) {
  const [name, setName] = useState(initialName);
  const [shared, setShared] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const submit = async (e?: FormEvent) => {
    e?.preventDefault();
    if (!name.trim()) return setError('Give the view a name.');
    setBusy(true);
    setError(null);
    try {
      await onSave(name.trim(), shared);
      onClose();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      size="sm"
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={busy} onClick={() => void submit()}>
            Save
          </Button>
        </>
      }
    >
      <form onSubmit={submit} className="space-y-4">
        <ErrorBanner error={error} />
        <FormField label="View name" htmlFor="view-name" required>
          <input id="view-name" className="input" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} />
        </FormField>
        {allowShare && <Toggle checked={shared} onChange={setShared} label="Share with everyone" />}
      </form>
    </Modal>
  );
}

interface ImportResult {
  created: number;
  errors: { row: number; message: string }[];
  columns: { header: string; field: string | null }[];
}

function ImportModal({ def, open, onClose }: { def: ObjectDef; open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const [csv, setCsv] = useState('');
  const [fileName, setFileName] = useState<string | null>(null);
  const run = useMutation({
    mutationFn: () => api.post<ImportResult>(`/api/records/${def.apiName}/import`, { csv }),
    onSuccess: () => invalidateRecordData(qc),
  });
  const result = run.data;
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Import ${def.pluralLabel.toLowerCase()}`}
      size="lg"
      footer={
        result ? (
          <Button variant="primary" onClick={onClose}>
            Done
          </Button>
        ) : (
          <>
            <Button onClick={onClose}>Cancel</Button>
            <Button variant="primary" icon={Upload} loading={run.isPending} disabled={!csv.trim()} onClick={() => run.mutate()}>
              Import
            </Button>
          </>
        )
      }
    >
      {result ? (
        <div className="space-y-4 text-sm">
          <p className="font-medium text-slate-800">
            Created {plural(result.created, def.label.toLowerCase(), def.pluralLabel.toLowerCase())}
            {result.errors.length > 0 && `; ${plural(result.errors.length, 'row')} failed`}.
          </p>
          {result.errors.length > 0 && (
            <ul className="max-h-40 space-y-1 overflow-y-auto rounded-lg border border-rose-100 bg-rose-50 p-3 text-xs text-rose-700">
              {result.errors.slice(0, 50).map((e) => (
                <li key={e.row}>
                  Row {e.row}: {e.message}
                </li>
              ))}
            </ul>
          )}
          <div>
            <p className="mb-1 text-xs font-semibold text-slate-500 uppercase">Column mapping</p>
            <ul className="grid grid-cols-2 gap-x-6 gap-y-1 text-xs">
              {result.columns.map((c) => (
                <li key={c.header} className="flex justify-between gap-2">
                  <span className="truncate text-slate-700">{c.header}</span>
                  <span className={c.field ? 'text-emerald-700' : 'text-slate-400'}>{c.field ? (fieldDef(def, c.field)?.label ?? c.field) : 'ignored'}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          <ErrorBanner error={run.error} />
          <p className="text-sm text-slate-600">
            The first row must contain column headers matching {def.label.toLowerCase()} field labels or API names. Lookups and users can be given by name, id or (for users) email. Up to 2,000 rows.
          </p>
          <FormField label="CSV file" htmlFor="import-file">
            <input
              id="import-file"
              type="file"
              accept=".csv,text/csv"
              className="block w-full text-sm text-slate-600 file:mr-3 file:rounded-lg file:border-0 file:bg-indigo-50 file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-indigo-700 hover:file:bg-indigo-100"
              onChange={async (e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                setFileName(file.name);
                setCsv(await file.text());
              }}
            />
          </FormField>
          <FormField label={fileName ? `Contents of ${fileName}` : 'Or paste CSV'} htmlFor="import-csv">
            <textarea id="import-csv" className="input h-40 font-mono text-xs" value={csv} onChange={(e) => setCsv(e.target.value)} placeholder={'Name,Email\nAda Lovelace,ada@example.com'} />
          </FormField>
        </div>
      )}
    </Modal>
  );
}

function ListBody({ def, view, views }: { def: ObjectDef; view: ListViewDef | null; views: ListViewDef[] }) {
  const { user } = useAuth();
  const perms = usePermissions();
  const qc = useQueryClient();
  const toast = useToast();
  const confirm = useConfirm();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const types = availableTypes(def);
  const requested = params.get('vt') as ViewType | null;
  const requestedType = requested && types.includes(requested) ? requested : null;
  // For the built-in "All" list the type picked in the URL is the baseline, so switching type alone isn't an unsaved change.
  const savedType: ViewType = view ? (types.includes(view.viewType) ? view.viewType : 'table') : (requestedType ?? 'table');
  const vt: ViewType = requestedType ?? savedType;
  const groupDefault = (t: ViewType): string | null =>
    t === 'kanban' ? (def.statusField ?? groupableFields(def)[0]?.apiName ?? null) : t === 'calendar' ? (def.dateField ?? dateFields(def)[0]!.apiName) : null;
  const savedGroupFor = (t: ViewType): string | null => (view?.viewType === t && view.groupBy) || groupDefault(t);

  const [draft, setDraft] = useState<FilterGroup | null>(() => {
    // `rf=field:id` comes from "View all" on a record's related list.
    const rf = /^([a-z][a-z0-9_]*):(.+)$/.exec(params.get('rf') ?? '');
    if (!view && rf) return { match: 'all', rules: [{ field: rf[1]!, op: 'eq', value: rf[2]! }] };
    return view?.filters ?? null;
  });
  const [sort, setSort] = useState<SortSpec | null>(view?.sort ?? null);
  const [columns, setColumns] = useState<string[]>(() => listColumns(def, view?.columns));
  const [groupBy, setGroupBy] = useState(() => savedGroupFor('kanban') ?? '');
  const [dateField, setDateField] = useState(() => savedGroupFor('calendar') ?? 'created_at');
  const [text, setText] = useState(params.get('q') ?? '');
  const [showFilters, setShowFilters] = useState(false);
  const [creating, setCreating] = useState(false);
  const [importing, setImporting] = useState(false);
  const [saving, setSaving] = useState<null | 'new' | 'rename'>(null);

  const q = useDebounced(text.trim(), 300);
  const activeFilter = completeFilter(useDebounced(draft, 400));
  const base: BaseQuery = { filters: activeFilter, q, sort };
  const baseKey = JSON.stringify(base);
  const [paging, setPaging] = useState({ key: baseKey, page: 1 });
  const page = paging.key === baseKey ? paging.page : 1;

  const viewGroup = vt === 'kanban' ? groupBy : vt === 'calendar' ? dateField : null;
  const dirty =
    !same(completeFilter(draft), view?.filters) ||
    !same(sort, view?.sort) ||
    !same(columns, listColumns(def, view?.columns)) ||
    vt !== savedType ||
    viewGroup !== savedGroupFor(vt);
  const canChange = !!view && (perms.isAdmin || (!view.shared && view.ownerId === user.id));
  const filterCount = completeFilter(draft)?.rules.length ?? 0;

  const definition = () => ({ filters: completeFilter(draft), sort, columns, viewType: vt, groupBy: viewGroup });
  const dropVt = () =>
    setParams(
      (p) => {
        p.delete('vt');
        return p;
      },
      { replace: true },
    );
  const pickView = (id: string | null) => navigate(id ? `?view=${encodeURIComponent(id)}` : '?');

  const saveNew = async (name: string, shared: boolean) => {
    const created = await api.post<ListViewDef>('/api/views', { object: def.apiName, name, shared, ...definition() });
    await qc.invalidateQueries({ queryKey: ['views', def.apiName] });
    toast.success(`Saved view “${created.name}”`);
    pickView(created.id);
  };
  const saveChanges = useMutation({
    mutationFn: () => api.patch<ListViewDef>(`/api/views/${view!.id}`, definition()),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['views', def.apiName] });
      dropVt();
      toast.success('View saved');
    },
    onError: (err) => toast.error(errorMessage(err)),
  });
  const rename = async (name: string) => {
    await api.patch(`/api/views/${view!.id}`, { name });
    await qc.invalidateQueries({ queryKey: ['views', def.apiName] });
  };
  const remove = async () => {
    if (!view || !(await confirm({ title: 'Delete list view?', message: `“${view.name}” will be removed${view.shared ? ' for everyone' : ''}.`, confirmLabel: 'Delete', danger: true }))) return;
    try {
      await api.del(`/api/views/${view.id}`);
      await qc.invalidateQueries({ queryKey: ['views', def.apiName] });
      toast.success('View deleted');
      pickView(null);
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  const exportHref = `/api/records/${def.apiName}/export.csv${qs({ q, filters: activeFilter ? JSON.stringify(activeFilter) : null, sort: sort ? JSON.stringify(sort) : null })}`;
  const setMonth = (m: string) =>
    setParams(
      (p) => {
        p.set('m', m);
        return p;
      },
      { replace: true },
    );
  const canCreate = perms.canCreate(def.apiName);
  const newButton = canCreate ? (
    <Button variant="primary" icon={Plus} onClick={() => setCreating(true)}>
      New
    </Button>
  ) : null;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex flex-wrap items-center gap-3 border-b border-slate-200 bg-white px-6 py-3">
        <ObjectTile icon={def.icon} color={def.color} />
        <div className="min-w-0">
          <p className="text-xs font-medium text-slate-500">{def.pluralLabel}</p>
          <div className="-ml-2 flex items-center gap-1">
            <ViewPicker def={def} views={views} current={view} onPick={pickView} />
            {canChange && (
              <Popover
                className="w-44"
                trigger={({ toggle, open }) => (
                  <button type="button" onClick={toggle} aria-expanded={open} aria-label="View actions" className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700">
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
                        setSaving('rename');
                      }}
                    >
                      Rename
                    </MenuItem>
                    <MenuItem
                      icon={Trash}
                      danger
                      onClick={() => {
                        close();
                        void remove();
                      }}
                    >
                      Delete view
                    </MenuItem>
                  </div>
                )}
              </Popover>
            )}
          </div>
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          {canCreate && (
            <Button icon={Upload} onClick={() => setImporting(true)}>
              Import
            </Button>
          )}
          <a href={exportHref} download className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3.5 text-sm font-medium text-slate-700 shadow-xs hover:bg-slate-50">
            <Download className="size-4" aria-hidden /> Export
          </a>
          {newButton}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 bg-white px-6 py-2">
        <div role="radiogroup" aria-label="Display as" className="inline-flex rounded-lg border border-slate-200 bg-slate-50 p-0.5">
          {VIEW_TYPES.filter((t) => types.includes(t.id)).map((t) => (
            <button
              key={t.id}
              type="button"
              role="radio"
              aria-checked={vt === t.id}
              title={t.label}
              onClick={() =>
                setParams((p) => {
                  p.set('vt', t.id);
                  return p;
                })
              }
              className={cx('inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium', vt === t.id ? 'bg-white text-indigo-700 shadow-xs' : 'text-slate-500 hover:text-slate-800')}
            >
              <t.icon className="size-3.5" aria-hidden />
              {t.label}
            </button>
          ))}
        </div>
        {vt === 'kanban' && groupableFields(def).length > 1 && (
          <label className="flex items-center gap-1.5 text-xs text-slate-500">
            Group by
            <select className="input h-7 w-auto py-0 text-xs" value={groupBy} onChange={(e) => setGroupBy(e.target.value)}>
              {groupableFields(def).map((f) => (
                <option key={f.apiName} value={f.apiName}>
                  {f.label}
                </option>
              ))}
            </select>
          </label>
        )}
        {vt === 'calendar' && (
          <label className="flex items-center gap-1.5 text-xs text-slate-500">
            Date
            <select className="input h-7 w-auto py-0 text-xs" value={dateField} onChange={(e) => setDateField(e.target.value)}>
              {dateFields(def).map((f) => (
                <option key={f.apiName} value={f.apiName}>
                  {f.label}
                </option>
              ))}
            </select>
          </label>
        )}
        <div className="relative ml-auto w-full sm:w-64">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-slate-400" aria-hidden />
          <input type="search" className="input h-8 pl-8 text-sm" placeholder={`Search ${def.pluralLabel.toLowerCase()}…`} aria-label={`Search ${def.pluralLabel.toLowerCase()}`} value={text} onChange={(e) => setText(e.target.value)} />
        </div>
        <Button size="sm" icon={ListFilter} onClick={() => setShowFilters((s) => !s)} aria-expanded={showFilters} className={filterCount ? 'border-indigo-300 bg-indigo-50 text-indigo-700' : undefined}>
          Filters{filterCount > 0 && ` (${filterCount})`}
        </Button>
        {vt === 'table' && <ColumnsMenu def={def} columns={columns} onChange={setColumns} />}
        {dirty && (
          <>
            {canChange && (
              <Button size="sm" variant="primary" icon={Save} loading={saveChanges.isPending} onClick={() => saveChanges.mutate()}>
                Save
              </Button>
            )}
            <Button size="sm" variant={canChange ? 'secondary' : 'primary'} icon={Save} onClick={() => setSaving('new')}>
              Save as view
            </Button>
          </>
        )}
      </div>

      {showFilters && (
        <div className="border-b border-slate-200 bg-slate-50 px-6 py-3">
          <div className="max-w-4xl">
            <FilterEditor def={def} value={draft} onChange={setDraft} />
          </div>
          <div className="mt-2 flex gap-2">
            {filterCount > 0 && (
              <Button size="sm" variant="ghost" icon={X} onClick={() => setDraft(null)}>
                Clear filters
              </Button>
            )}
            {view && !same(completeFilter(draft), view.filters) && (
              <Button size="sm" variant="ghost" onClick={() => setDraft(view.filters)}>
                Reset to view
              </Button>
            )}
            <Button size="sm" className="ml-auto" onClick={() => setShowFilters(false)}>
              Done
            </Button>
          </div>
        </div>
      )}
      {!showFilters && activeFilter && (
        <p className="truncate border-b border-slate-100 bg-white px-6 py-1.5 text-xs text-slate-500" title={describeFilter(def, activeFilter)}>
          <span className="font-medium text-slate-600">Filtered by:</span> {describeFilter(def, activeFilter)}
        </p>
      )}

      <div className="flex min-h-0 flex-1 flex-col overflow-auto bg-white">
        {vt === 'table' && <TableView def={def} base={base} columns={columns} page={page} onPage={(p) => setPaging({ key: baseKey, page: p })} onSort={setSort} emptyAction={newButton} />}
        {vt === 'kanban' && <KanbanView def={def} base={base} groupBy={groupBy} columns={columns} />}
        {vt === 'calendar' && <CalendarView def={def} base={base} dateField={dateField} month={params.get('m')} onMonth={setMonth} />}
        {vt === 'timeline' && <TimelineView def={def} base={base} month={params.get('m')} onMonth={setMonth} />}
      </div>

      <RecordFormModal object={def.apiName} open={creating} onClose={() => setCreating(false)} onSaved={(r) => navigate(`/r/${r.id}`)} />
      {importing && <ImportModal def={def} open onClose={() => setImporting(false)} />}
      {saving === 'new' && <SaveViewModal open title="Save as new view" initialName={view ? `${view.name} (copy)` : ''} allowShare={perms.isAdmin} onSave={saveNew} onClose={() => setSaving(null)} />}
      {saving === 'rename' && view && <SaveViewModal open title="Rename view" initialName={view.name} allowShare={false} onSave={(name) => rename(name)} onClose={() => setSaving(null)} />}
    </div>
  );
}

export default function ObjectList() {
  const { object } = useParams();
  const [params] = useSearchParams();
  const { def, isLoading, error } = useObjectDef(object);
  const views = useQuery({ queryKey: ['views', object], queryFn: () => api.get<ListViewDef[]>(`/api/objects/${object}/views`), enabled: !!def });
  if (isLoading || (def && views.isLoading)) return <Loading />;
  if (error) return <ErrorBanner error={error} className="m-6" />;
  if (!def) return <EmptyState title="Object not found">It may have been deleted, or you may not have access to it.</EmptyState>;
  if (views.error && !(views.error instanceof ApiError && views.error.status === 404)) return <ErrorBanner error={views.error} className="m-6" />;
  const list = views.data ?? [];
  const viewId = params.get('view');
  const view = list.find((v) => v.id === viewId) ?? null;
  return <ListBody key={`${def.apiName}:${view?.id ?? 'all'}`} def={def} view={view} views={list} />;
}
