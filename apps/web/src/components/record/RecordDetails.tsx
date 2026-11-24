import type { CrmRecord, FieldDef, ObjectDef, PageLayoutDef, PresenceViewer, RecordResponse, RefMap } from '@titoforce/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Check, Pencil, TriangleAlert } from 'lucide-react';
import { type FormEvent, useEffect, useRef, useState } from 'react';
import { api, editConflict, errorMessage } from '../../api.ts';
import { inSentence, t } from '../../i18n/index.ts';
import { hex } from '../../lib/colors.ts';
import { formatDateTime, isEditable, optionLabel, relativeTime } from '../../lib/format.ts';
import { invalidateRecordData, usePermissions } from '../../lib/hooks.ts';
import { pageSections } from '../../lib/layout.ts';
import { useEditingPresence } from '../../lib/realtime.tsx';
import { useToast } from '../feedback.tsx';
import { FieldInput, UserSelect } from '../FieldInput.tsx';
import { FieldValue, UserChip } from '../FieldValue.tsx';
import { Button, Card, cx } from '../ui.tsx';
import { PresenceFace, presenceLabel } from './Presence.tsx';

/**
 * PATCHes one or more fields and refreshes everything that shows the record. `since` is the `updatedAt` the edit started
 * from: if someone else changed these fields after it, the save fails with `edit_conflict` (see editConflict).
 */
export function useRecordUpdate(def: ObjectDef, record: CrmRecord) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ fields, since }: { fields: Record<string, unknown>; since: string }) =>
      api.patch<RecordResponse>(`/api/records/${def.apiName}/${record.id}`, { fields, expectedUpdatedAt: since }),
    onSuccess: async (res) => {
      qc.setQueryData(['record', record.id], res);
      await invalidateRecordData(qc);
    },
    onError: (err) => {
      if (editConflict(err)) void qc.invalidateQueries({ queryKey: ['record', record.id] });
    },
  });
}

/** True for a moment after `value` changes, e.g. when someone else's edit arrives. */
function useChangeHighlight(value: unknown): boolean {
  const previous = useRef(JSON.stringify(value ?? null));
  const [on, setOn] = useState(false);
  useEffect(() => {
    const next = JSON.stringify(value ?? null);
    if (next === previous.current) return;
    previous.current = next;
    setOn(true);
    const timer = setTimeout(() => setOn(false), 2500);
    return () => clearTimeout(timer);
  }, [value]);
  return on;
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
  const canEdit = perms.canEdit(def.apiName, record.ownerId);
  const pick = (value: string) =>
    update.mutate(
      { fields: { [field.apiName]: value }, since: record.updatedAt },
      {
        onSuccess: () => toast.success(t('record.path.set', { field: field.label, value: optionLabel(field, value) })),
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
                title={canEdit && !active ? t('record.path.markAs', { field: inSentence(field.label), value: o.label ?? o.value }) : (o.label ?? o.value)}
                style={{ clipPath: clip, ...(active ? { background: hex(o.color ?? 'indigo') } : {}) }}
                className={cx(
                  'flex h-8 w-full items-center justify-center gap-1 px-5 text-xs font-medium whitespace-nowrap transition-colors disabled:cursor-default',
                  active ? 'text-white' : done ? 'bg-emerald-100 text-emerald-800 enabled:hover:bg-emerald-200' : 'bg-slate-100 text-slate-600 enabled:hover:bg-slate-200',
                )}
              >
                {done && <Check className="size-3.5" aria-hidden />}
                {o.label ?? o.value}
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

function InlineField({
  def,
  record,
  refs,
  field,
  editable,
  wide,
  editors,
}: {
  def: ObjectDef;
  record: CrmRecord;
  refs: RefMap;
  field: FieldDef;
  editable: boolean;
  wide?: boolean;
  /** Other people editing this field. */
  editors?: PresenceViewer[];
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState<unknown>(null);
  const [label, setLabel] = useState<string | null>(null);
  const [since, setSince] = useState(record.updatedAt);
  const update = useRecordUpdate(def, record);
  const current = record.fields[field.apiName];
  const inputId = `inline-${field.apiName}`;
  const highlight = useChangeHighlight(current);
  useEditingPresence(record.id, field.apiName, editing);
  const conflict = editConflict(update.error);
  const theirs = conflict?.fields.find((c) => c.apiName === field.apiName);

  const start = () => {
    setValue(current ?? null);
    setLabel(typeof current === 'string' ? (refs[current]?.name ?? null) : null);
    setSince(record.updatedAt);
    update.reset();
    setEditing(true);
  };
  const save = (e: FormEvent) => {
    e.preventDefault();
    // After a conflict the user has seen their value: save over it, still checking for even newer changes.
    update.mutate({ fields: { [field.apiName]: value === '' ? null : value }, since: conflict?.updatedAt ?? since }, { onSuccess: () => setEditing(false) });
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
        {conflict && theirs ? (
          <div role="alert" className="mt-2 rounded-md border border-amber-200 bg-amber-50 px-2.5 py-2 text-xs text-amber-900">
            <p className="flex items-center gap-1.5">
              <TriangleAlert className="size-3.5 shrink-0" aria-hidden />
              {t('collab.fieldConflict', { name: theirs.by ?? t('collab.someone'), time: relativeTime(theirs.at) })}
            </p>
            <div className="mt-1 text-sm break-words text-slate-900">
              <FieldValue field={field} value={theirs.value} refs={refs} />
            </div>
          </div>
        ) : (
          update.error && <p className="mt-1 text-xs text-rose-600">{errorMessage(update.error)}</p>
        )}
        <div className="mt-2 flex justify-end gap-2">
          {conflict ? (
            <>
              <Button size="sm" onClick={() => setEditing(false)}>
                {t('collab.useTheirs')}
              </Button>
              <Button size="sm" variant="primary" type="submit" loading={update.isPending}>
                {t('collab.saveMine')}
              </Button>
            </>
          ) : (
            <>
              <Button size="sm" onClick={() => setEditing(false)}>
                {t('common.cancel')}
              </Button>
              <Button size="sm" variant="primary" type="submit" loading={update.isPending}>
                {t('common.save')}
              </Button>
            </>
          )}
        </div>
      </form>
    );
  }

  return (
    <div className={cx('group min-w-0 rounded-sm border-b border-slate-100 pb-2 transition-[background-color,box-shadow] duration-700', highlight && 'bg-amber-50 ring-4 ring-amber-50', wide && '@lg:col-span-2')}>
      <dt className="flex items-center gap-1.5 text-xs font-medium text-slate-500" title={field.helpText}>
        {field.label}
        {editors?.map((v) => <PresenceFace key={v.userId} viewer={v} label={presenceLabel(def, v)} size="xs" />)}
      </dt>
      <dd className="mt-0.5 flex min-h-6 items-start justify-between gap-2 text-sm text-slate-900">
        <span className={cx('min-w-0 break-words', field.type === 'longtext' && 'whitespace-pre-wrap')}>
          <FieldValue field={field} value={current} refs={refs} />
        </span>
        {editable && (
          <button
            type="button"
            onClick={start}
            aria-label={t('record.details.editField', { field: field.label })}
            className="shrink-0 rounded p-0.5 text-slate-300 opacity-0 group-hover:opacity-100 hover:bg-slate-100 hover:text-slate-600 focus-visible:opacity-100"
          >
            <Pencil className="size-3.5" />
          </button>
        )}
      </dd>
    </div>
  );
}

function OwnerField({ def, record, refs, editable, editors }: { def: ObjectDef; record: CrmRecord; refs: RefMap; editable: boolean; editors?: PresenceViewer[] }) {
  const [editing, setEditing] = useState(false);
  const [since, setSince] = useState(record.updatedAt);
  const toast = useToast();
  const update = useRecordUpdate(def, record);
  useEditingPresence(record.id, 'owner_id', editing);
  return (
    <div className="group min-w-0 border-b border-slate-100 pb-2">
      <dt className="flex items-center gap-1.5 text-xs font-medium text-slate-500">
        <label htmlFor="inline-owner">{t('common.owner')}</label>
        {editors?.map((v) => <PresenceFace key={v.userId} viewer={v} label={presenceLabel(def, v)} size="xs" />)}
      </dt>
      <dd className="mt-0.5 flex min-h-6 items-center justify-between gap-2 text-sm text-slate-900">
        {editing ? (
          <UserSelect
            id="inline-owner"
            value={record.ownerId}
            allowEmpty={false}
            onChange={(id) => {
              setEditing(false);
              if (id && id !== record.ownerId)
                update.mutate({ fields: { owner_id: id }, since }, { onSuccess: () => toast.success(t('record.details.ownerChanged')), onError: (err) => toast.error(errorMessage(err)) });
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
            onClick={() => {
              setSince(record.updatedAt);
              setEditing(true);
            }}
            aria-label={t('record.details.changeOwner')}
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
        {t('record.details.stamp', { user: by ? (refs[by]?.name ?? t('common.unknownUser')) : t('record.system'), time: relativeTime(at) })}
      </dd>
    </div>
  );
}

export function DetailsPanel({ def, record, refs, layout, viewers }: { def: ObjectDef; record: CrmRecord; refs: RefMap; layout?: PageLayoutDef; viewers?: PresenceViewer[] }) {
  const perms = usePermissions();
  const canEdit = perms.canEdit(def.apiName, record.ownerId);
  const sections = pageSections(def, layout, t('record.details.defaultSection', { label: def.label })).filter((s) => s.fields.length > 0);
  const editorsOf = (apiName: string) => viewers?.filter((v) => v.editing === apiName);
  return (
    <div className="space-y-4">
      {sections.map((s) => (
        <Card key={s.id} title={s.title}>
          <dl className={cx('grid gap-x-8 gap-y-3', s.columns === 2 && '@lg:grid-cols-2')}>
            {s.fields.map((f) => (
              <InlineField
                key={f.apiName}
                def={def}
                record={record}
                refs={refs}
                field={f}
                editable={canEdit && isEditable(def, f)}
                wide={s.columns === 2 && f.type === 'longtext'}
                editors={editorsOf(f.apiName)}
              />
            ))}
          </dl>
        </Card>
      ))}
      <Card title={t('record.details.systemInformation')}>
        <dl className="grid gap-x-8 gap-y-3 @lg:grid-cols-2">
          <OwnerField def={def} record={record} refs={refs} editable={canEdit} editors={editorsOf('owner_id')} />
          <div className="min-w-0 border-b border-slate-100 pb-2">
            <dt className="text-xs font-medium text-slate-500">{t('common.recordId')}</dt>
            <dd className="mt-0.5 font-mono text-xs text-slate-700">{record.id}</dd>
          </div>
          <Stamp label={t('common.created')} at={record.createdAt} by={record.createdBy} refs={refs} />
          <Stamp label={t('record.details.lastModified')} at={record.updatedAt} by={record.updatedBy} refs={refs} />
        </dl>
      </Card>
    </div>
  );
}
