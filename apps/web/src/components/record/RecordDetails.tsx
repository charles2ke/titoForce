import type { CrmRecord, FieldDef, ObjectDef, RecordResponse, RefMap } from '@titoforce/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Check, Pencil } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { api, errorMessage } from '../../api.ts';
import { hex } from '../../lib/colors.ts';
import { formatDateTime, relativeTime } from '../../lib/format.ts';
import { invalidateRecordData, usePermissions } from '../../lib/hooks.ts';
import { useToast } from '../feedback.tsx';
import { FieldInput, UserSelect } from '../FieldInput.tsx';
import { FieldValue, UserChip } from '../FieldValue.tsx';
import { Button, Card, cx } from '../ui.tsx';

/** PATCHes one or more fields and refreshes everything that shows the record. */
export function useRecordUpdate(def: ObjectDef, record: CrmRecord) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (fields: Record<string, unknown>) => api.patch<RecordResponse>(`/api/records/${def.apiName}/${record.id}`, { fields }),
    onSuccess: async (res) => {
      qc.setQueryData(['record', record.id], res);
      await invalidateRecordData(qc);
    },
  });
}

/** Salesforce-style path: the status picklist as clickable stages. */
export function PathBar({ def, record }: { def: ObjectDef; record: CrmRecord }) {
  const perms = usePermissions();
  const toast = useToast();
  const update = useRecordUpdate(def, record);
  const field = def.fields.find((f) => f.apiName === def.statusField && f.type === 'picklist');
  const options = field?.options ?? [];
  if (!field || options.length < 2) return null;
  const current = record.fields[field.apiName];
  const index = options.findIndex((o) => o.value === current);
  const canEdit = perms.canEdit(record) && perms.canEditField(def, field);
  const pick = (value: string) =>
    update.mutate(
      { [field.apiName]: value },
      {
        onSuccess: () => toast.success(`${field.label} set to ${value}`),
        onError: (err) => toast.error(errorMessage(err)),
      },
    );
  return (
    <nav aria-label={field.label} className="overflow-x-auto">
      <ol className="flex min-w-max gap-1">
        {options.map((o, i) => {
          const done = index >= 0 && i < index;
          const active = i === index;
          const clip =
            i === 0
              ? 'polygon(0 0, calc(100% - 10px) 0, 100% 50%, calc(100% - 10px) 100%, 0 100%)'
              : 'polygon(0 0, calc(100% - 10px) 0, 100% 50%, calc(100% - 10px) 100%, 0 100%, 10px 50%)';
          return (
            <li key={o.value} className="min-w-28 flex-1">
              <button
                type="button"
                disabled={!canEdit || active || update.isPending}
                onClick={() => pick(o.value)}
                aria-current={active ? 'step' : undefined}
                title={canEdit && !active ? `Mark ${field.label.toLowerCase()} as ${o.value}` : o.value}
                style={{ clipPath: clip, ...(active ? { background: hex(o.color ?? 'indigo') } : {}) }}
                className={cx(
                  'flex h-8 w-full items-center justify-center gap-1 px-5 text-xs font-medium whitespace-nowrap transition-colors disabled:cursor-default',
                  active ? 'text-white' : done ? 'bg-emerald-100 text-emerald-800 enabled:hover:bg-emerald-200' : 'bg-slate-100 text-slate-600 enabled:hover:bg-slate-200',
                )}
              >
                {done && <Check className="size-3.5" aria-hidden />}
                {o.value}
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

function InlineField({ def, record, refs, field, editable, wide }: { def: ObjectDef; record: CrmRecord; refs: RefMap; field: FieldDef; editable: boolean; wide?: boolean }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState<unknown>(null);
  const [label, setLabel] = useState<string | null>(null);
  const update = useRecordUpdate(def, record);
  const current = record.fields[field.apiName];
  const inputId = `inline-${field.apiName}`;

  const start = () => {
    setValue(current ?? null);
    setLabel(typeof current === 'string' ? (refs[current]?.name ?? null) : null);
    update.reset();
    setEditing(true);
  };
  const save = (e?: FormEvent) => {
    e?.preventDefault();
    update.mutate({ [field.apiName]: value === '' ? null : value }, { onSuccess: () => setEditing(false) });
  };

  if (editing) {
    return (
      <form
        onSubmit={save}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.stopPropagation();
            setEditing(false);
          }
        }}
        className={cx('min-w-0 rounded-lg bg-indigo-50/60 p-2 ring-1 ring-indigo-200', wide && '@lg:col-span-2')}
      >
        <label htmlFor={inputId} className="mb-1 block text-xs font-medium text-slate-600">
          {field.label}
        </label>
        <FieldInput id={inputId} field={field} value={value} refLabel={label} onChange={setValue} />
        {update.error && <p className="mt-1 text-xs text-rose-600">{errorMessage(update.error)}</p>}
        <div className="mt-2 flex justify-end gap-2">
          <Button size="sm" onClick={() => setEditing(false)}>
            Cancel
          </Button>
          <Button size="sm" variant="primary" type="submit" loading={update.isPending}>
            Save
          </Button>
        </div>
      </form>
    );
  }

  return (
    <div className={cx('group min-w-0 border-b border-slate-100 pb-2', wide && '@lg:col-span-2')}>
      <dt className="text-xs font-medium text-slate-500" title={field.helpText}>
        {field.label}
      </dt>
      <dd className="mt-0.5 flex min-h-6 items-start justify-between gap-2 text-sm text-slate-900">
        <span className={cx('min-w-0 break-words', field.type === 'longtext' && 'whitespace-pre-wrap')}>
          <FieldValue field={field} value={current} refs={refs} />
        </span>
        {editable && (
          <button
            type="button"
            onClick={start}
            aria-label={`Edit ${field.label}`}
            className="shrink-0 rounded p-0.5 text-slate-300 opacity-0 group-hover:opacity-100 hover:bg-slate-100 hover:text-slate-600 focus-visible:opacity-100"
          >
            <Pencil className="size-3.5" />
          </button>
        )}
      </dd>
    </div>
  );
}

function OwnerField({ def, record, refs, editable }: { def: ObjectDef; record: CrmRecord; refs: RefMap; editable: boolean }) {
  const [editing, setEditing] = useState(false);
  const toast = useToast();
  const update = useRecordUpdate(def, record);
  return (
    <div className="group min-w-0 border-b border-slate-100 pb-2">
      <dt className="text-xs font-medium text-slate-500">
        <label htmlFor="inline-owner">Owner</label>
      </dt>
      <dd className="mt-0.5 flex min-h-6 items-center justify-between gap-2 text-sm text-slate-900">
        {editing ? (
          <UserSelect
            id="inline-owner"
            value={record.ownerId}
            allowEmpty={false}
            onChange={(id) => {
              setEditing(false);
              if (id && id !== record.ownerId) update.mutate({ owner_id: id }, { onSuccess: () => toast.success('Owner changed'), onError: (err) => toast.error(errorMessage(err)) });
            }}
          />
        ) : record.ownerId ? (
          <UserChip id={record.ownerId} name={refs[record.ownerId]?.name} size="sm" />
        ) : (
          <span className="text-slate-300">—</span>
        )}
        {editable && !editing && (
          <button
            type="button"
            onClick={() => setEditing(true)}
            aria-label="Change owner"
            className="shrink-0 rounded p-0.5 text-slate-300 opacity-0 group-hover:opacity-100 hover:bg-slate-100 hover:text-slate-600 focus-visible:opacity-100"
          >
            <Pencil className="size-3.5" />
          </button>
        )}
      </dd>
    </div>
  );
}

function Stamp({ label, at, by, refs }: { label: string; at: string; by: string | null; refs: RefMap }) {
  return (
    <div className="min-w-0 border-b border-slate-100 pb-2">
      <dt className="text-xs font-medium text-slate-500">{label}</dt>
      <dd className="mt-0.5 text-sm text-slate-900" title={formatDateTime(at)}>
        {by ? (refs[by]?.name ?? 'Unknown user') : 'System'}, {relativeTime(at)}
      </dd>
    </div>
  );
}

export function DetailsPanel({ def, record, refs }: { def: ObjectDef; record: CrmRecord; refs: RefMap }) {
  const perms = usePermissions();
  const canEdit = perms.canEdit(record);
  const sections = new Map<string, FieldDef[]>();
  for (const f of def.fields) {
    const s = f.section || `${def.label} Information`;
    sections.set(s, [...(sections.get(s) ?? []), f]);
  }
  return (
    <div className="space-y-4">
      {[...sections.entries()].map(([title, fields]) => (
        <Card key={title} title={title}>
          <dl className="grid gap-x-8 gap-y-3 @lg:grid-cols-2">
            {fields.map((f) => (
              <InlineField key={f.apiName} def={def} record={record} refs={refs} field={f} editable={canEdit && perms.canEditField(def, f)} wide={f.type === 'longtext'} />
            ))}
          </dl>
        </Card>
      ))}
      <Card title="System Information">
        <dl className="grid gap-x-8 gap-y-3 @lg:grid-cols-2">
          <OwnerField def={def} record={record} refs={refs} editable={perms.canChangeOwner(record)} />
          <div className="min-w-0 border-b border-slate-100 pb-2">
            <dt className="text-xs font-medium text-slate-500">Record ID</dt>
            <dd className="mt-0.5 font-mono text-xs text-slate-700">{record.id}</dd>
          </div>
          <Stamp label="Created" at={record.createdAt} by={record.createdBy} refs={refs} />
          <Stamp label="Last modified" at={record.updatedAt} by={record.updatedBy} refs={refs} />
        </dl>
      </Card>
    </div>
  );
}
