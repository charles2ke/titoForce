import { useMutation, useQueryClient } from '@tanstack/react-query';
import { API_NAME_RE, type ObjectDef, type PaletteColor, toApiName } from '@titoforce/shared';
import { Database, Plus, Search } from 'lucide-react';
import { useId, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { api } from '../../api.ts';
import { useToast } from '../../components/feedback.tsx';
import { ColorPicker, IconPicker } from '../../components/pickers.tsx';
import { Badge, Button, EmptyState, ErrorBanner, FormField, Loading, Modal, ObjectTile, PageHeader } from '../../components/ui.tsx';
import { invalidateMetadata, useObjects } from '../../lib/hooks.ts';

function NewObjectForm({ existing, onClose }: { existing: ObjectDef[]; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const navigate = useNavigate();
  const formId = useId();
  const ids = { label: useId(), plural: useId(), api: useId(), desc: useId(), icon: useId() };
  const [label, setLabel] = useState('');
  const [plural, setPlural] = useState('');
  const [apiName, setApiName] = useState('');
  const [apiTouched, setApiTouched] = useState(false);
  const [description, setDescription] = useState('');
  const [icon, setIcon] = useState('layout-grid');
  const [color, setColor] = useState<PaletteColor>('indigo');

  const effectiveApi = apiTouched ? apiName : label.trim() ? toApiName(label) : '';
  const apiError = !effectiveApi
    ? null
    : !API_NAME_RE.test(effectiveApi)
      ? 'Use lowercase letters, numbers and underscores, starting with a letter (max 40).'
      : existing.some((o) => o.apiName === effectiveApi)
        ? 'An object with this API name already exists.'
        : null;

  const create = useMutation({
    mutationFn: () =>
      api.post<ObjectDef>('/api/objects', {
        label: label.trim(),
        pluralLabel: plural.trim() || undefined,
        apiName: effectiveApi,
        description: description.trim() || undefined,
        icon,
        color,
      }),
    onSuccess: async (def) => {
      qc.setQueryData<ObjectDef[]>(['objects'], (old) => (old ? [...old.filter((o) => o.apiName !== def.apiName), def] : old));
      toast.success(`${def.label} created`);
      onClose();
      navigate(`/setup/objects/${def.apiName}`);
      await invalidateMetadata(qc);
    },
  });

  const canSave = !!label.trim() && !!effectiveApi && !apiError;

  return (
    <Modal
      open
      onClose={onClose}
      title="New object"
      size="lg"
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" type="submit" form={formId} disabled={!canSave} loading={create.isPending}>
            Create object
          </Button>
        </>
      }
    >
      <form
        id={formId}
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (canSave) create.mutate();
        }}
      >
        <ErrorBanner error={create.error} />
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField label="Label" required htmlFor={ids.label} help="Singular, e.g. “Vehicle”.">
            <input id={ids.label} className="input" value={label} maxLength={60} onChange={(e) => setLabel(e.target.value)} />
          </FormField>
          <FormField label="Plural label" htmlFor={ids.plural} help={label.trim() ? `Defaults to “${label.trim()}s”.` : undefined}>
            <input id={ids.plural} className="input" value={plural} maxLength={60} placeholder={label.trim() ? `${label.trim()}s` : ''} onChange={(e) => setPlural(e.target.value)} />
          </FormField>
        </div>
        <FormField label="API name" required htmlFor={ids.api} error={apiError} help="Used by the API, formulas and templates. It cannot be changed later.">
          <input
            id={ids.api}
            className="input font-mono"
            value={effectiveApi}
            maxLength={40}
            onChange={(e) => {
              setApiTouched(true);
              setApiName(e.target.value);
            }}
          />
        </FormField>
        <FormField label="Description" htmlFor={ids.desc}>
          <textarea id={ids.desc} className="input" rows={2} maxLength={500} value={description} onChange={(e) => setDescription(e.target.value)} />
        </FormField>
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField label="Icon" htmlFor={ids.icon}>
            <IconPicker id={ids.icon} value={icon} onChange={setIcon} />
          </FormField>
          <div>
            <span className="label">Color</span>
            <ColorPicker value={color} onChange={setColor} />
          </div>
        </div>
        <div className="flex items-center gap-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5">
          <ObjectTile icon={icon} color={color} />
          <div className="min-w-0 text-sm">
            <div className="font-medium text-slate-900">{plural.trim() || (label.trim() ? `${label.trim()}s` : 'Preview')}</div>
            <div className="text-xs text-slate-500">A “{label.trim() || 'Name'} Name” text field is created automatically.</div>
          </div>
        </div>
      </form>
    </Modal>
  );
}

export default function Objects() {
  const objects = useObjects();
  const [q, setQ] = useState('');
  const [creating, setCreating] = useState(false);
  const term = q.trim().toLowerCase();
  const list = [...(objects.data ?? [])]
    .filter((o) => !term || [o.label, o.pluralLabel, o.apiName, o.description ?? ''].some((s) => s.toLowerCase().includes(term)))
    .sort((a, b) => a.label.localeCompare(b.label));

  return (
    <div className="mx-auto max-w-6xl p-6">
      <PageHeader
        title="Objects & Fields"
        subtitle="Standard and custom objects, their fields, page layouts and validation rules."
        actions={
          <Button variant="primary" icon={Plus} onClick={() => setCreating(true)}>
            New object
          </Button>
        }
      />
      <div className="card overflow-hidden">
        <div className="border-b border-slate-100 p-3">
          <div className="relative max-w-sm">
            <Search className="pointer-events-none absolute top-2.5 left-2.5 size-4 text-slate-400" aria-hidden />
            <input type="search" aria-label="Search objects" placeholder="Search objects…" className="input pl-8" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
        </div>
        {objects.isLoading ? (
          <Loading />
        ) : objects.error ? (
          <div className="p-4">
            <ErrorBanner error={objects.error} />
          </div>
        ) : list.length === 0 ? (
          <EmptyState icon={Database} title={term ? 'No objects match your search' : 'No objects yet'} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50/70 text-left text-xs font-semibold text-slate-500 uppercase">
                <tr>
                  <th className="px-4 py-2.5">Object</th>
                  <th className="px-4 py-2.5">API name</th>
                  <th className="px-4 py-2.5">Type</th>
                  <th className="px-4 py-2.5 text-right">Fields</th>
                  <th className="px-4 py-2.5">Description</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {list.map((o) => (
                  <tr key={o.apiName} className="hover:bg-slate-50/70">
                    <td className="px-4 py-2.5">
                      <Link to={`/setup/objects/${o.apiName}`} className="flex items-center gap-3 font-medium text-slate-900 hover:text-indigo-700">
                        <ObjectTile icon={o.icon} color={o.color} size="sm" />
                        {o.label}
                      </Link>
                    </td>
                    <td className="px-4 py-2.5 font-mono text-xs text-slate-600">{o.apiName}</td>
                    <td className="px-4 py-2.5">{o.isCustom ? <Badge color="purple">Custom</Badge> : <Badge color="gray">Standard</Badge>}</td>
                    <td className="px-4 py-2.5 text-right text-slate-600 tabular-nums">{o.fields.length}</td>
                    <td className="max-w-md truncate px-4 py-2.5 text-slate-500" title={o.description}>
                      {o.description}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      {creating && <NewObjectForm existing={objects.data ?? []} onClose={() => setCreating(false)} />}
    </div>
  );
}
