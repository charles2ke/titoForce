import type { CrmRecord, EditConflictDetails, FieldDef, ObjectDef, PageLayoutDef, RecordResponse, RefMap } from '@titoforce/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Info, TriangleAlert } from 'lucide-react';
import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router';
import { ApiError, api, editConflict, errorField } from '../api.ts';
import { formatList, t } from '../i18n/index.ts';
import { isEditable, relativeTime } from '../lib/format.ts';
import { invalidateRecordData, useAuth, useObjectDef } from '../lib/hooks.ts';
import { type PageSection, pageSections, useLayout } from '../lib/layout.ts';
import { useEditingPresence } from '../lib/realtime.tsx';
import { useToast } from './feedback.tsx';
import { FieldInput, UserSelect } from './FieldInput.tsx';
import { FieldValue, UserChip } from './FieldValue.tsx';
import { Button, cx, ErrorBanner, FormField } from './ui.tsx';

const blank = (v: unknown) => v === null || v === undefined || v === '' || (Array.isArray(v) && v.length === 0);
const norm = (v: unknown) => (blank(v) ? null : v);
const same = (a: unknown, b: unknown) => JSON.stringify(norm(a)) === JSON.stringify(norm(b));
const later = (a: string, b: string) => (Date.parse(b) > Date.parse(a) ? b : a);

/**
 * The version of the record an edit starts from: fields whose value differs from it are saved, with its `updatedAt`, so
 * the server can tell whether someone else changed those fields meanwhile. Changes to other fields are left alone.
 */
interface Base {
  values: Record<string, unknown>;
  updatedAt: string;
}

const baseOf = (record: CrmRecord, editable: FieldDef[]): Base => ({
  values: { ...Object.fromEntries(editable.map((f) => [f.apiName, record.fields[f.apiName] ?? null])), owner_id: record.ownerId },
  updatedAt: record.updatedAt,
});

const theirValues = (conflict: EditConflictDetails) => Object.fromEntries(conflict.fields.map((c) => [c.apiName, c.value ?? null]));

const isLiteralDefault = (v: unknown) => v !== undefined && v !== null && !(typeof v === 'string' && v.includes('{'));

export interface RecordFormProps {
  object: string;
  /** Record to edit; omitted when creating. */
  record?: CrmRecord | null;
  refs?: RefMap;
  /** Prefilled values for new records (e.g. the parent lookup on a related list). */
  initial?: Record<string, unknown>;
  initialLabels?: Record<string, string>;
  open: boolean;
  onClose: () => void;
  onSaved?: (record: CrmRecord) => void;
}

export function RecordFormModal(props: RecordFormProps) {
  const { def } = useObjectDef(props.object);
  const layout = useLayout(props.open ? props.object : undefined);
  if (!props.open || !def || layout.isLoading) return null;
  return <RecordForm {...props} def={def} layout={layout.data} />;
}

/** The page layout's sections with the fields the user can edit, plus required fields the layout leaves out. */
function formSections(def: ObjectDef, layout: PageLayoutDef | undefined, editable: FieldDef[]): PageSection[] {
  const untitled = t('components.recordForm.defaultSection', { object: def.label });
  const canEdit = new Set(editable.map((f) => f.apiName));
  const sections = pageSections(def, layout, untitled).map((s) => ({ ...s, fields: s.fields.filter((f) => canEdit.has(f.apiName)) }));
  const placed = new Set(sections.flatMap((s) => s.fields.map((f) => f.apiName)));
  const missing = editable.filter((f) => f.required && !placed.has(f.apiName));
  if (missing.length && sections[0]) sections[0] = { ...sections[0], fields: [...sections[0].fields, ...missing] };
  else if (missing.length) sections.push({ id: 'required', title: untitled, columns: 2, fields: missing });
  const visible = sections.filter((s) => s.fields.length > 0);
  // The owner field goes in the first section, so keep one.
  return visible.length ? visible : [{ id: 'main', title: untitled, columns: 2, fields: [] }];
}

function RecordForm({ def, layout, record, refs, initial, initialLabels, onClose, onSaved }: RecordFormProps & { def: ObjectDef; layout: PageLayoutDef | undefined }) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const editable = useMemo(() => def.fields.filter((f) => isEditable(def, f)), [def]);
  const [base, setBase] = useState<Base | null>(() => (record ? baseOf(record, editable) : null));
  const [values, setValues] = useState<Record<string, unknown>>(() => {
    if (base) return { ...base.values };
    const v: Record<string, unknown> = { owner_id: user.id };
    for (const f of editable) if (isLiteralDefault(f.defaultValue)) v[f.apiName] = f.defaultValue;
    return { ...v, ...initial };
  });
  // Names of lookup records picked in this form, which refs do not have yet.
  const [picked, setPicked] = useState<RefMap>({});
  const labels = useMemo(
    () => ({ ...Object.fromEntries(Object.entries({ ...refs, ...picked }).map(([id, r]) => [id, r.name])), ...initialLabels }),
    [refs, picked, initialLabels],
  );
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [duplicates, setDuplicates] = useState<{ id: string; name: string }[] | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const seen = useRef(record?.updatedAt);
  useEditingPresence(record?.id, '*', !!record);

  const fieldLabel = (apiName: string, fallback = apiName) => (apiName === 'owner_id' ? t('common.owner') : (def.fields.find((f) => f.apiName === apiName)?.label ?? fallback));

  // The record refreshes live while the form is open: show others' changes to fields this user has not edited. Fields
  // both changed keep the user's value and the old version, so saving reports the conflict.
  useEffect(() => {
    if (!record || !base || !seen.current || !(Date.parse(record.updatedAt) > Date.parse(seen.current))) return;
    seen.current = record.updatedAt;
    const latest = baseOf(record, editable).values;
    const edited = new Set(Object.keys(values).filter((k) => !same(values[k], base.values[k])));
    const changed = Object.keys(latest).filter((k) => !same(latest[k], base.values[k]));
    const theirs = Object.fromEntries(changed.filter((k) => !edited.has(k)).map((k) => [k, latest[k]]));
    const crossed = changed.filter((k) => edited.has(k));
    setValues((v) => ({ ...v, ...theirs }));
    setBase({ values: { ...base.values, ...theirs }, updatedAt: crossed.length ? base.updatedAt : later(base.updatedAt, record.updatedAt) });
    if (changed.length && record.updatedBy !== user.id) {
      const name = (record.updatedBy && refs?.[record.updatedBy]?.name) || t('collab.someone');
      setNotice([t('collab.changed', { name }), crossed.length ? t('collab.changedEdited', { fields: formatList(crossed.map((k) => fieldLabel(k))) }) : ''].join(' ').trim());
    }
  }, [record]);

  const save = useMutation({
    mutationFn: async ({ allowDuplicates, from }: { allowDuplicates: boolean; from: Base | null }) => {
      const payload: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(values)) {
        if (from) {
          if (!same(from.values[k], v)) payload[k] = norm(v);
        } else if (!blank(v)) {
          payload[k] = v;
        }
      }
      if (record && from) {
        if (!Object.keys(payload).length) return { record, refs: refs ?? {} } satisfies RecordResponse;
        return api.patch<RecordResponse>(`/api/records/${def.apiName}/${record.id}`, { fields: payload, allowDuplicates, expectedUpdatedAt: from.updatedAt });
      }
      return api.post<RecordResponse>(`/api/records/${def.apiName}`, { fields: payload, allowDuplicates });
    },
    onSuccess: async (res) => {
      await invalidateRecordData(qc);
      toast.success(t(record ? 'components.recordForm.saved' : 'components.recordForm.created', { object: def.label, name: res.record.name }));
      onSaved?.(res.record);
      onClose();
    },
    onError: (err) => {
      if (err instanceof ApiError && err.code === 'duplicate') {
        setDuplicates((err.details as { duplicates?: { id: string; name: string }[] } | undefined)?.duplicates ?? []);
        return;
      }
      if (editConflict(err)) {
        // Without live updates the form would not get their version otherwise.
        if (record) void qc.invalidateQueries({ queryKey: ['record', record.id] });
        return;
      }
      const field = errorField(err);
      if (field) setFieldErrors({ [field]: err.message.replace(/^[^:]+:\s*/, '') });
    },
  });

  const submit = (e: { preventDefault(): void }, allowDuplicates = false, from = base) => {
    e.preventDefault();
    const missing: Record<string, string> = {};
    for (const f of editable) if (f.required && blank(values[f.apiName])) missing[f.apiName] = t('common.required');
    setFieldErrors(missing);
    setDuplicates(null);
    if (Object.keys(missing).length) return;
    save.mutate({ allowDuplicates, from });
  };

  const set = (k: string, v: unknown, label?: string) => {
    setValues((prev) => ({ ...prev, [k]: v }));
    if (label && typeof v === 'string') setPicked((prev) => ({ ...prev, [v]: { name: label, object: '' } }));
    if (fieldErrors[k]) setFieldErrors(({ [k]: _, ...rest }) => rest);
  };

  const conflict = editConflict(save.error);
  const keepTheirs = () => {
    if (!conflict || !base) return;
    const theirs = theirValues(conflict);
    setValues((v) => ({ ...v, ...theirs }));
    setBase({ values: { ...base.values, ...theirs }, updatedAt: later(base.updatedAt, conflict.updatedAt) });
    save.reset();
    setNotice(t('collab.conflict.rebased'));
  };
  // Their values become the version the edit starts from, so the user's differing values are saved over them; changes
  // made after the conflict are still checked.
  const saveMine = (e: { preventDefault(): void }) => {
    if (!conflict || !base) return;
    const from = { values: { ...base.values, ...theirValues(conflict) }, updatedAt: later(base.updatedAt, conflict.updatedAt) };
    setBase(from);
    setNotice(null);
    submit(e, false, from);
  };
  const shown = (apiName: string, value: unknown): ReactNode => {
    if (apiName === 'owner_id') return typeof value === 'string' ? <UserChip id={value} name={refs?.[value]?.name} /> : '—';
    const f = def.fields.find((x) => x.apiName === apiName);
    return f ? <FieldValue field={f} value={value} refs={{ ...refs, ...picked }} /> : String(value ?? '—');
  };

  const dialog = useRef<HTMLDivElement>(null);
  useEffect(() => {
    dialog.current?.querySelector<HTMLElement>('input:not([type=checkbox]), select, textarea')?.focus();
  }, []);

  const generalError = save.error && !(save.error instanceof ApiError && save.error.code === 'duplicate') && !errorField(save.error) && !conflict ? save.error : null;
  const formId = `record-form-${def.apiName}`;
  const title = record ? t('components.recordForm.editTitle', { name: record.name }) : t('components.recordForm.newTitle', { object: def.label });

  return createPortal(
    <form id={formId} onSubmit={(e) => submit(e)} noValidate>
      <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/40 px-[max(1rem,var(--safe-left),var(--safe-right))] pt-[max(6vh,var(--safe-top))] pb-[max(1rem,var(--safe-bottom))]" onMouseDown={(e) => e.target === e.currentTarget && onClose()} onKeyDown={(e) => e.key === 'Escape' && onClose()}>
        <div ref={dialog} role="dialog" aria-modal="true" aria-label={title} className="w-full max-w-3xl animate-fade-in rounded-2xl bg-white shadow-2xl">
          <div className="border-b border-slate-100 px-5 py-3.5">
            <h2 className="text-base font-semibold text-slate-900">{title}</h2>
          </div>
          <div className="max-h-[68vh] space-y-6 overflow-y-auto px-5 py-4">
            <ErrorBanner error={generalError} />
            {Object.keys(fieldErrors).length > 0 && !generalError && <ErrorBanner error={t('components.recordForm.fixFields')} />}
            {notice && !conflict && (
              <p role="status" className="flex items-start gap-1.5 rounded-lg border border-sky-200 bg-sky-50 px-3 py-2.5 text-sm text-sky-900">
                <Info className="mt-0.5 size-4 shrink-0" aria-hidden /> {notice}
              </p>
            )}
            {conflict && (
              <div role="alert" className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm text-amber-900">
                <p className="flex items-center gap-1.5 font-medium">
                  <TriangleAlert className="size-4 shrink-0" aria-hidden /> {t('collab.conflict.title')}
                </p>
                <p className="mt-1">{t('collab.conflict.message')}</p>
                <dl className="mt-2 divide-y divide-amber-100 rounded-md border border-amber-200 bg-white">
                  {conflict.fields.map((c) => (
                    <div key={c.apiName} className="grid gap-x-4 gap-y-1.5 px-3 py-2 sm:grid-cols-[10rem_minmax(0,1fr)_minmax(0,1fr)]">
                      <dt className="font-medium text-slate-800">{fieldLabel(c.apiName, c.label)}</dt>
                      <dd className="min-w-0 text-slate-900">
                        <span className="block text-xs text-slate-500">{t('collab.conflict.theirValue')}</span>
                        <span className="block break-words">{shown(c.apiName, c.value)}</span>
                        <span className="block text-xs text-slate-500">{t('collab.conflict.by', { name: c.by ?? t('collab.someone'), time: relativeTime(c.at) })}</span>
                      </dd>
                      <dd className="min-w-0 text-slate-900">
                        <span className="block text-xs text-slate-500">{t('collab.conflict.yourValue')}</span>
                        <span className="block break-words">{shown(c.apiName, values[c.apiName])}</span>
                      </dd>
                    </div>
                  ))}
                </dl>
                <div className="mt-2.5 flex flex-wrap gap-2">
                  <Button size="sm" onClick={keepTheirs}>
                    {t('collab.conflict.useTheirs')}
                  </Button>
                  <Button size="sm" onClick={saveMine} loading={save.isPending}>
                    {t('collab.conflict.saveMine')}
                  </Button>
                </div>
              </div>
            )}
            {duplicates && (
              <div role="alert" className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm text-amber-900">
                <p className="flex items-center gap-1.5 font-medium">
                  <TriangleAlert className="size-4" /> {save.error?.message}
                </p>
                {duplicates.length > 0 && (
                  <ul className="mt-1 list-disc pl-6">
                    {duplicates.map((d) => (
                      <li key={d.id}>
                        <Link className="underline" to={`/r/${d.id}`} onClick={onClose}>
                          {d.name}
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
                <Button size="sm" className="mt-2" onClick={(e) => submit(e, true)}>
                  {t('components.recordForm.saveAnyway')}
                </Button>
              </div>
            )}
            {formSections(def, layout, editable).map((s, idx) => (
              <fieldset key={s.id}>
                <legend className="mb-3 w-full border-b border-slate-100 pb-1.5 text-xs font-semibold tracking-wide text-slate-500 uppercase">{s.title}</legend>
                <div className={cx('grid grid-cols-1 gap-x-5 gap-y-4', s.columns === 2 && 'sm:grid-cols-2')}>
                  {s.fields.map((f) => (
                    <FormField
                      key={f.apiName}
                      htmlFor={`f-${f.apiName}`}
                      label={f.label}
                      required={f.required}
                      help={f.helpText}
                      error={fieldErrors[f.apiName]}
                      className={s.columns === 2 && (f.type === 'longtext' || f.type === 'multipicklist') ? 'sm:col-span-2' : undefined}
                    >
                      <FieldInput id={`f-${f.apiName}`} field={f} value={values[f.apiName]} invalid={!!fieldErrors[f.apiName]} refLabel={labels[String(values[f.apiName] ?? '')]} onChange={(v, label) => set(f.apiName, v, label)} />
                    </FormField>
                  ))}
                  {idx === 0 && (
                    <FormField htmlFor="f-owner_id" label={t('common.owner')} error={fieldErrors.owner_id}>
                      <UserSelect id="f-owner_id" value={(values.owner_id as string | null) ?? null} allowEmpty={false} onChange={(v) => set('owner_id', v)} />
                    </FormField>
                  )}
                </div>
              </fieldset>
            ))}
          </div>
          <div className="flex items-center justify-end gap-2 rounded-b-2xl border-t border-slate-100 bg-slate-50/60 px-5 py-3">
            <Button onClick={onClose}>{t('common.cancel')}</Button>
            <Button type="submit" variant="primary" loading={save.isPending}>
              {t('common.save')}
            </Button>
          </div>
        </div>
      </div>
    </form>,
    document.body,
  );
}
