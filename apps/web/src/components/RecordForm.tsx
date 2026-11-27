import type { CrmRecord, FieldDef, ObjectDef, RecordResponse, RefMap } from '@titoforce/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { TriangleAlert } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router';
import { ApiError, api, errorField } from '../api.ts';
import { invalidateRecordData, useAuth, useObjectDef, usePermissions } from '../lib/hooks.ts';
import { useToast } from './feedback.tsx';
import { FieldInput, UserSelect } from './FieldInput.tsx';
import { Button, ErrorBanner, FormField } from './ui.tsx';

const blank = (v: unknown) => v === null || v === undefined || v === '' || (Array.isArray(v) && v.length === 0);
const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
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
  if (!props.open || !def) return null;
  return <RecordForm {...props} def={def} />;
}

function sections(def: ObjectDef, fields: FieldDef[]): [string, FieldDef[]][] {
  const map = new Map<string, FieldDef[]>();
  for (const f of fields) {
    const s = f.section || `${def.label} Information`;
    map.set(s, [...(map.get(s) ?? []), f]);
  }
  return [...map.entries()];
}

function RecordForm({ def, record, refs, initial, initialLabels, onClose, onSaved }: RecordFormProps & { def: ObjectDef }) {
  const { user } = useAuth();
  const perms = usePermissions();
  const qc = useQueryClient();
  const toast = useToast();
  // Read-only fields (calculated, or read only for the user's role) stay out of the form.
  const editable = def.fields.filter((f) => perms.canEditField(def, f));
  const showOwner = !record || perms.canChangeOwner(record);
  const [values, setValues] = useState<Record<string, unknown>>(() => {
    if (record) return { ...Object.fromEntries(editable.map((f) => [f.apiName, record.fields[f.apiName] ?? null])), owner_id: record.ownerId };
    const v: Record<string, unknown> = { owner_id: user.id };
    for (const f of editable) if (isLiteralDefault(f.defaultValue)) v[f.apiName] = f.defaultValue;
    return { ...v, ...initial };
  });
  const labels = useMemo(() => ({ ...Object.fromEntries(Object.entries(refs ?? {}).map(([id, r]) => [id, r.name])), ...initialLabels }), [refs, initialLabels]);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [duplicates, setDuplicates] = useState<{ id: string; name: string }[] | null>(null);

  const save = useMutation({
    mutationFn: async (allowDuplicates: boolean) => {
      const payload: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(values)) {
        if (record) {
          const original = k === 'owner_id' ? record.ownerId : record.fields[k];
          if (!same(original, blank(v) ? null : v)) payload[k] = blank(v) ? null : v;
        } else if (!blank(v)) {
          payload[k] = v;
        }
      }
      if (record) {
        if (!Object.keys(payload).length) return { record, refs: refs ?? {} } satisfies RecordResponse;
        return api.patch<RecordResponse>(`/api/records/${def.apiName}/${record.id}`, { fields: payload, allowDuplicates });
      }
      return api.post<RecordResponse>(`/api/records/${def.apiName}`, { fields: payload, allowDuplicates });
    },
    onSuccess: async (res) => {
      await invalidateRecordData(qc);
      toast.success(`${def.label} "${res.record.name}" ${record ? 'saved' : 'created'}`);
      onSaved?.(res.record);
      onClose();
    },
    onError: (err) => {
      if (err instanceof ApiError && err.code === 'duplicate') {
        setDuplicates((err.details as { duplicates?: { id: string; name: string }[] } | undefined)?.duplicates ?? []);
        return;
      }
      const field = errorField(err);
      if (field) setFieldErrors({ [field]: err.message.replace(/^[^:]+:\s*/, '') });
    },
  });

  const submit = (e: { preventDefault(): void }, allowDuplicates = false) => {
    e.preventDefault();
    const missing: Record<string, string> = {};
    for (const f of editable) if (f.required && blank(values[f.apiName])) missing[f.apiName] = 'Required';
    setFieldErrors(missing);
    setDuplicates(null);
    if (Object.keys(missing).length) return;
    save.mutate(allowDuplicates);
  };

  const set = (k: string, v: unknown) => {
    setValues((prev) => ({ ...prev, [k]: v }));
    if (fieldErrors[k]) setFieldErrors(({ [k]: _, ...rest }) => rest);
  };

  const dialog = useRef<HTMLDivElement>(null);
  useEffect(() => {
    dialog.current?.querySelector<HTMLElement>('input:not([type=checkbox]), select, textarea')?.focus();
  }, []);

  const generalError = save.error && !(save.error instanceof ApiError && save.error.code === 'duplicate') && !errorField(save.error) ? save.error : null;
  const formId = `record-form-${def.apiName}`;

  return createPortal(
    <form id={formId} onSubmit={(e) => submit(e)} noValidate>
      <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/40 p-4 pt-[6vh]" onMouseDown={(e) => e.target === e.currentTarget && onClose()} onKeyDown={(e) => e.key === 'Escape' && onClose()}>
        <div ref={dialog} role="dialog" aria-modal="true" aria-label={record ? `Edit ${record.name}` : `New ${def.label}`} className="w-full max-w-3xl animate-fade-in rounded-2xl bg-white shadow-2xl">
          <div className="border-b border-slate-100 px-5 py-3.5">
            <h2 className="text-base font-semibold text-slate-900">{record ? `Edit ${record.name}` : `New ${def.label}`}</h2>
          </div>
          <div className="max-h-[68vh] space-y-6 overflow-y-auto px-5 py-4">
            <ErrorBanner error={generalError} />
            {Object.keys(fieldErrors).length > 0 && !generalError && <ErrorBanner error="Please fix the highlighted fields." />}
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
                  Save anyway
                </Button>
              </div>
            )}
            {sections(def, editable).map(([title, fields], idx) => (
              <fieldset key={title}>
                <legend className="mb-3 w-full border-b border-slate-100 pb-1.5 text-xs font-semibold tracking-wide text-slate-500 uppercase">{title}</legend>
                <div className="grid grid-cols-1 gap-x-5 gap-y-4 sm:grid-cols-2">
                  {fields.map((f) => (
                    <FormField key={f.apiName} htmlFor={`f-${f.apiName}`} label={f.label} required={f.required} help={f.helpText} error={fieldErrors[f.apiName]} className={f.type === 'longtext' || f.type === 'multipicklist' ? 'sm:col-span-2' : undefined}>
                      <FieldInput id={`f-${f.apiName}`} field={f} value={values[f.apiName]} invalid={!!fieldErrors[f.apiName]} refLabel={labels[String(values[f.apiName] ?? '')]} onChange={(v) => set(f.apiName, v)} />
                    </FormField>
                  ))}
                  {idx === 0 && showOwner && (
                    <FormField htmlFor="f-owner_id" label="Owner" error={fieldErrors.owner_id}>
                      <UserSelect id="f-owner_id" value={(values.owner_id as string | null) ?? null} allowEmpty={false} onChange={(v) => set('owner_id', v)} />
                    </FormField>
                  )}
                </div>
              </fieldset>
            ))}
          </div>
          <div className="flex items-center justify-end gap-2 rounded-b-2xl border-t border-slate-100 bg-slate-50/60 px-5 py-3">
            <Button onClick={onClose}>Cancel</Button>
            <Button type="submit" variant="primary" loading={save.isPending}>
              Save
            </Button>
          </div>
        </div>
      </div>
    </form>,
    document.body,
  );
}
