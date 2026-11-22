import { useMutation, useQuery } from '@tanstack/react-query';
import { CircleCheck } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { useParams } from 'react-router';
import { api } from '../api.ts';
import { Button, ErrorBanner, FormField, Loading } from '../components/ui.tsx';
import { t } from '../i18n/index.ts';

interface PublicField {
  apiName: string;
  label: string;
  type: string;
  required: boolean;
  options?: string[];
}

interface PublicFormDef {
  id: string;
  name: string;
  description: string | null;
  submitLabel: string | null;
  fields: PublicField[];
}

function Input({ field, value, onChange }: { field: PublicField; value: unknown; onChange: (v: unknown) => void }) {
  const id = `pf-${field.apiName}`;
  const common = { id, name: field.apiName, required: field.required, className: 'input' };
  switch (field.type) {
    case 'longtext':
      return <textarea {...common} rows={4} value={String(value ?? '')} onChange={(e) => onChange(e.target.value)} />;
    case 'picklist':
      return (
        <select {...common} value={String(value ?? '')} onChange={(e) => onChange(e.target.value)}>
          <option value="">{t('publicForm.select')}</option>
          {field.options?.map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </select>
      );
    case 'checkbox':
      return <input id={id} type="checkbox" className="size-4 rounded border-slate-300 text-indigo-600" checked={value === true} onChange={(e) => onChange(e.target.checked)} />;
    case 'number':
    case 'currency':
    case 'percent':
      return <input {...common} type="number" step="any" value={String(value ?? '')} onChange={(e) => onChange(e.target.value === '' ? '' : Number(e.target.value))} />;
    default: {
      const type = field.type === 'email' ? 'email' : field.type === 'phone' ? 'tel' : field.type === 'url' ? 'url' : field.type === 'date' ? 'date' : 'text';
      return <input {...common} type={type} value={String(value ?? '')} onChange={(e) => onChange(e.target.value)} />;
    }
  }
}

export default function PublicForm() {
  const { formId } = useParams();
  const [values, setValues] = useState<Record<string, unknown>>({});
  const form = useQuery({ queryKey: ['public-form', formId], queryFn: () => api.get<PublicFormDef>(`/api/public/forms/${formId}`), retry: false });
  const submit = useMutation({
    mutationFn: () => api.post<{ message: string }>(`/api/public/forms/${formId}/submit`, Object.fromEntries(Object.entries(values).filter(([, v]) => v !== '' && v !== undefined))),
  });

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    submit.mutate();
  };

  return (
    <div className="min-h-full bg-gradient-to-b from-indigo-50 to-slate-50 px-4 py-12">
      <div className="mx-auto max-w-lg">
        {form.isLoading && <Loading />}
        {form.error && <ErrorBanner error={form.error} />}
        {form.data && (
          <div className="card p-6 sm:p-8">
            {submit.data ? (
              <div className="py-6 text-center" role="status">
                <CircleCheck className="mx-auto size-10 text-emerald-500" aria-hidden />
                <p className="mt-3 text-lg font-semibold text-slate-900">{submit.data.message}</p>
              </div>
            ) : (
              <>
                <h1 className="text-xl font-semibold text-slate-900">{form.data.name}</h1>
                {form.data.description && <p className="mt-1 text-sm whitespace-pre-line text-slate-600">{form.data.description}</p>}
                <form className="mt-6 space-y-4" onSubmit={onSubmit}>
                  <ErrorBanner error={submit.error} />
                  {form.data.fields.map((f) => (
                    <FormField key={f.apiName} label={f.label} required={f.required} htmlFor={`pf-${f.apiName}`}>
                      <Input field={f} value={values[f.apiName]} onChange={(v) => setValues((prev) => ({ ...prev, [f.apiName]: v }))} />
                    </FormField>
                  ))}
                  <Button type="submit" variant="primary" className="w-full" loading={submit.isPending}>
                    {form.data.submitLabel || t('common.submit')}
                  </Button>
                </form>
              </>
            )}
          </div>
        )}
        <p className="mt-6 text-center text-xs text-slate-400">{t('publicForm.poweredBy')}</p>
      </div>
    </div>
  );
}
