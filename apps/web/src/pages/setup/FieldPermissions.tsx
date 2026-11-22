import { type FieldAccess, type FieldDef, fieldAccess, nameFieldNames, type ObjectDef, type RolePermissions } from '@titoforce/shared';
import { ChevronDown, ChevronRight, Database, Lock, RotateCcw, Search, SearchX } from 'lucide-react';
import { type Dispatch, type SetStateAction, useId, useRef } from 'react';
import { Badge, cx, EmptyState, IconButton, ObjectTile } from '../../components/ui.tsx';

/** What the field permissions list shows. Kept by the page, so it survives saving and switching roles. */
export interface FieldListView {
  filter: string;
  /** Objects expanded while not filtering. */
  expanded: ReadonlySet<string>;
  /** Objects expanded or collapsed by hand while filtering, relative to how the filter shows them. */
  toggled: ReadonlySet<string>;
}

type FieldPermissionMap = NonNullable<RolePermissions['fields']>;

const ACCESS_LABELS: Record<FieldAccess, string> = { edit: 'Edit', read: 'Read only', none: 'Hidden' };

const isCalculated = (f: FieldDef) => f.type === 'formula' || f.type === 'rollup';

/** Access without a setting of its own: sensitive fields are hidden from roles that can't view sensitive fields. */
const defaultAccess = (perms: RolePermissions, f: FieldDef): FieldAccess => (f.sensitive && !perms.viewSensitive ? 'none' : 'edit');

/** Calculated fields are never editable, so "Edit" means "Read only" for them. */
const shownAccess = (f: FieldDef, access: FieldAccess): FieldAccess => (access === 'edit' && isCalculated(f) ? 'read' : access);

/** Sets the access to one field. Settings that match the default are removed, so only real differences are stored. */
function withFieldAccess(perms: RolePermissions, object: string, f: FieldDef, access: FieldAccess): RolePermissions {
  const forObject = { ...perms.fields?.[object] };
  if (shownAccess(f, access) === shownAccess(f, defaultAccess(perms, f))) delete forObject[f.apiName];
  else forObject[f.apiName] = access;
  const fields: FieldPermissionMap = { ...perms.fields };
  if (Object.keys(forObject).length) fields[object] = forObject;
  else delete fields[object];
  return { ...perms, fields };
}

function withoutObject(perms: RolePermissions, object: string): RolePermissions {
  const fields: FieldPermissionMap = { ...perms.fields };
  delete fields[object];
  return { ...perms, fields };
}

function summary(perms: RolePermissions, def: ObjectDef): string {
  let hidden = 0;
  let readOnly = 0;
  for (const f of def.fields) {
    const access = fieldAccess(perms, def.apiName, f);
    if (access === 'none') hidden++;
    else if (access === 'read' && !isCalculated(f)) readOnly++;
  }
  const parts: string[] = [];
  if (hidden) parts.push(`${hidden} hidden`);
  if (readOnly) parts.push(`${readOnly} read only`);
  return parts.length ? parts.join(' · ') : 'All fields editable';
}

function FieldRow({ def, field: f, perms, canCreate, inName, onChange }: { def: ObjectDef; field: FieldDef; perms: RolePermissions; canCreate: boolean; inName: boolean; onChange: (access: FieldAccess) => void }) {
  const noteId = useId();
  const calculated = isCalculated(f);
  const value = shownAccess(f, fieldAccess(perms, def.apiName, f));
  const fallback = shownAccess(f, defaultAccess(perms, f));
  // Mirrors the server, which checks explicit settings only (picking the default removes the setting):
  // a role that creates records must be able to fill in required fields without a default.
  const mustEdit = canCreate && !!f.required && !calculated && (f.defaultValue === undefined || f.defaultValue === null);
  const blocked: Partial<Record<FieldAccess, boolean>> = { read: mustEdit && fallback !== 'read', none: (mustEdit || inName) && fallback !== 'none' };
  const options: FieldAccess[] = calculated ? ['read', 'none'] : ['edit', 'read', 'none'];
  const locked = options.every((o) => o === value || blocked[o]);
  const plural = def.pluralLabel.toLowerCase();
  const note =
    blocked.read && blocked.none
      ? `${inName ? 'Part of the record name and required' : 'Required'} to create ${plural}, so it must stay editable.`
      : blocked.none
        ? 'Part of the record name, so it can’t be hidden.'
        : blocked.read
          ? `Required to create ${plural}, so it can’t be read only.`
          : null;

  return (
    <li className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1.5 py-2">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
          <span className="text-sm font-medium text-slate-800">{f.label}</span>
          <span className="font-mono text-xs text-slate-500">{f.apiName}</span>
          {f.sensitive && (
            <Badge color="yellow">
              <Lock className="size-3" aria-hidden />
              Sensitive
            </Badge>
          )}
          {calculated && <Badge color="gray">{f.type === 'formula' ? 'Formula' : 'Roll-up'}</Badge>}
        </div>
        {note && (
          <p id={noteId} className="mt-0.5 text-xs text-slate-500">
            {note}
          </p>
        )}
      </div>
      <select
        aria-label={`${f.label} access`}
        aria-describedby={note ? noteId : undefined}
        title={note ?? (calculated ? 'Calculated fields are never editable.' : undefined)}
        className={cx('input h-8 w-32 shrink-0 py-0 text-xs', value === fallback && 'text-slate-400')}
        value={value}
        disabled={locked}
        onChange={(e) => onChange(e.target.value as FieldAccess)}
      >
        {options.map((o) => (
          <option key={o} value={o} disabled={blocked[o]}>
            {ACCESS_LABELS[o]}
          </option>
        ))}
      </select>
    </li>
  );
}

function ObjectRow({
  def,
  fields,
  perms,
  open,
  onToggle,
  setPerms,
}: {
  def: ObjectDef;
  fields: FieldDef[];
  perms: RolePermissions;
  open: boolean;
  onToggle: () => void;
  setPerms: Dispatch<SetStateAction<RolePermissions>>;
}) {
  const ids = { label: useId(), summary: useId(), panel: useId() };
  const toggleRef = useRef<HTMLButtonElement>(null);
  const canCreate = (perms.objects[def.apiName] ?? perms.objects['*'])?.create ?? false;
  const names = nameFieldNames(def);
  const customized = Object.keys(perms.fields?.[def.apiName] ?? {}).length > 0;

  return (
    <li>
      <div className="flex items-center gap-2 pr-3 hover:bg-slate-50/70">
        <button
          ref={toggleRef}
          type="button"
          aria-expanded={open}
          aria-controls={open ? ids.panel : undefined}
          aria-labelledby={ids.label}
          aria-describedby={ids.summary}
          onClick={onToggle}
          className="flex min-w-0 flex-1 items-center gap-2.5 py-2.5 pl-4 text-left"
        >
          {open ? <ChevronDown className="size-4 shrink-0 text-slate-400" aria-hidden /> : <ChevronRight className="size-4 shrink-0 text-slate-400" aria-hidden />}
          <ObjectTile icon={def.icon} color={def.color} size="sm" soft />
          <span id={ids.label} className="min-w-0 truncate text-sm font-medium text-slate-800">
            {def.label}
          </span>
          <span id={ids.summary} className="ml-auto shrink-0 pl-2 text-xs text-slate-500">
            {summary(perms, def)}
          </span>
        </button>
        {customized ? (
          <IconButton
            icon={RotateCcw}
            label={`Reset field permissions for ${def.label}`}
            className="size-7"
            onClick={() => {
              setPerms((p) => withoutObject(p, def.apiName));
              // This button goes away once the object has no settings; keep keyboard focus on the row.
              toggleRef.current?.focus();
            }}
          />
        ) : (
          <span className="size-7 shrink-0" />
        )}
      </div>
      {open && (
        <div id={ids.panel} role="group" aria-label={def.label} className="border-t border-slate-100 bg-slate-50/60 px-4 sm:pl-[4.25rem]">
          {fields.length ? (
            <ul className="divide-y divide-slate-200/70">
              {fields.map((f) => (
                <FieldRow
                  key={f.apiName}
                  def={def}
                  field={f}
                  perms={perms}
                  canCreate={canCreate}
                  inName={names.includes(f.apiName)}
                  onChange={(access) => setPerms((p) => withFieldAccess(p, def.apiName, f, access))}
                />
              ))}
            </ul>
          ) : (
            <p className="py-2.5 text-xs text-slate-500">This object has no fields.</p>
          )}
          {fields.length < def.fields.length && (
            <p className="pb-2.5 text-xs text-slate-500">
              Showing {fields.length} of {def.fields.length} fields.
            </p>
          )}
        </div>
      )}
    </li>
  );
}

/** Field-level security of a role: per object, which fields the role can edit, only read, or not see at all. */
export function FieldPermissions({
  perms,
  setPerms,
  objects,
  view,
  onViewChange,
}: {
  perms: RolePermissions;
  setPerms: Dispatch<SetStateAction<RolePermissions>>;
  objects: ObjectDef[];
  view: FieldListView;
  onViewChange: Dispatch<SetStateAction<FieldListView>>;
}) {
  const headingId = useId();
  const term = view.filter.trim().toLowerCase();
  const matches = (...values: string[]) => values.some((s) => s.toLowerCase().includes(term));

  const readable = objects.filter((o) => ((perms.objects[o.apiName] ?? perms.objects['*'])?.read ?? 'none') !== 'none').sort((a, b) => a.label.localeCompare(b.label));
  // An object matching the filter shows all its fields; otherwise only its matching fields, expanded right away.
  const rows = readable.flatMap((def) => {
    if (!term || matches(def.label, def.pluralLabel, def.apiName)) return [{ def, fields: def.fields, auto: false }];
    const fields = def.fields.filter((f) => matches(f.label, f.apiName));
    return fields.length ? [{ def, fields, auto: true }] : [];
  });
  const isOpen = (api: string, auto: boolean) => (term ? (auto || view.expanded.has(api)) !== view.toggled.has(api) : view.expanded.has(api));
  const toggle = (api: string) =>
    onViewChange((v) => {
      const flip = (s: ReadonlySet<string>) => {
        const next = new Set(s);
        if (!next.delete(api)) next.add(api);
        return next;
      };
      return v.filter.trim() ? { ...v, toggled: flip(v.toggled) } : { ...v, expanded: flip(v.expanded) };
    });

  return (
    <section aria-labelledby={headingId} className="card overflow-hidden">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 px-4 py-3">
        <div className="min-w-0 flex-1">
          <h3 id={headingId} className="text-sm font-semibold text-slate-800">
            Field permissions
          </h3>
          {!perms.setup && (
            <p className="text-xs text-slate-500">Fields are editable unless you limit them here; sensitive fields are hidden unless the role can view them. Only objects the role can read are listed.</p>
          )}
        </div>
        {!perms.setup && (
          <div className="relative w-full sm:w-64">
            <Search className="pointer-events-none absolute top-2.5 left-2.5 size-4 text-slate-400" aria-hidden />
            <input
              type="search"
              aria-label="Filter objects and fields"
              placeholder="Filter objects and fields…"
              className="input pl-8"
              value={view.filter}
              onChange={(e) => {
                const filter = e.target.value;
                onViewChange((v) => ({ ...v, filter, toggled: new Set() }));
              }}
              // Enter would submit the role form.
              onKeyDown={(e) => e.key === 'Enter' && e.preventDefault()}
            />
          </div>
        )}
      </div>
      {perms.setup ? (
        <p className="px-4 py-3 text-sm text-slate-600">Roles with Setup access can see and edit every field.</p>
      ) : rows.length === 0 ? (
        term ? (
          <EmptyState icon={SearchX} title="No objects or fields match your filter" />
        ) : (
          <EmptyState icon={Database} title="No objects to show">
            Give the role read access to an object first.
          </EmptyState>
        )
      ) : (
        <ul className="divide-y divide-slate-100">
          {rows.map((r) => (
            <ObjectRow key={r.def.apiName} def={r.def} fields={r.fields} perms={perms} open={isOpen(r.def.apiName, r.auto)} onToggle={() => toggle(r.def.apiName)} setPerms={setPerms} />
          ))}
        </ul>
      )}
    </section>
  );
}
