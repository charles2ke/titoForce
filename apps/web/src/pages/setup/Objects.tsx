import { useMutation, useQueryClient } from '@tanstack/react-query';
import { API_NAME_RE, type ObjectDef, type PaletteColor, toApiName } from '@titoforce/shared';
import { Database, Plus, Search } from 'lucide-react';
import { useId, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { api } from '../../api.ts';
import { useToast } from '../../components/feedback.tsx';
import { ColorPicker, IconPicker } from '../../components/pickers.tsx';
import { Badge, Button, EmptyState, ErrorBanner, FormField, Loading, Modal, ObjectTile, PageHeader } from '../../components/ui.tsx';
import { t } from '../../i18n/index.ts';
import { invalidateMetadata, useSetupObjects } from '../../lib/hooks.ts';

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
      ? t('setupObjects.apiNameInvalid')
      : existing.some((o) => o.apiName === effectiveApi)
        ? t('setupObjects.newObject.alreadyExists')
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
      qc.setQueryData<ObjectDef[]>(['objects', 'raw'], (old) => (old ? [...old.filter((o) => o.apiName !== def.apiName), def] : old));
      toast.success(t('setupObjects.newObject.created', { label: def.label }));
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
      title={t('setupObjects.newObject.title')}
      size="lg"
      footer={
        <>
          <Button onClick={onClose}>{t('common.cancel')}</Button>
          <Button variant="primary" type="submit" form={formId} disabled={!canSave} loading={create.isPending}>
            {t('setupObjects.newObject.create')}
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
          <FormField label={t('common.label')} required htmlFor={ids.label} help={t('setupObjects.newObject.labelHelp')}>
            <input id={ids.label} className="input" value={label} maxLength={60} onChange={(e) => setLabel(e.target.value)} />
          </FormField>
          <FormField label={t('setupObjects.pluralLabel')} htmlFor={ids.plural} help={label.trim() ? t('setupObjects.newObject.pluralHelp', { plural: `${label.trim()}s` }) : undefined}>
            <input id={ids.plural} className="input" value={plural} maxLength={60} placeholder={label.trim() ? `${label.trim()}s` : ''} onChange={(e) => setPlural(e.target.value)} />
          </FormField>
        </div>
        <FormField label={t('common.apiName')} required htmlFor={ids.api} error={apiError} help={t('setupObjects.newObject.apiNameHelp')}>
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
        <FormField label={t('common.description')} htmlFor={ids.desc}>
          <textarea id={ids.desc} className="input" rows={2} maxLength={500} value={description} onChange={(e) => setDescription(e.target.value)} />
        </FormField>
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField label={t('common.icon')} htmlFor={ids.icon}>
            <IconPicker id={ids.icon} value={icon} onChange={setIcon} />
          </FormField>
          <div>
            <span className="label">{t('common.color')}</span>
            <ColorPicker value={color} onChange={setColor} />
          </div>
        </div>
        <div className="flex items-center gap-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5">
          <ObjectTile icon={icon} color={color} />
          <div className="min-w-0 text-sm">
            <div className="font-medium text-slate-900">{plural.trim() || (label.trim() ? `${label.trim()}s` : t('setupObjects.newObject.preview'))}</div>
            {/* Mirrors the server, which names the record name field “<label> Name”. */}
            <div className="text-xs text-slate-500">{t('setupObjects.newObject.nameFieldHint', { field: `${label.trim() || t('common.name')} Name` })}</div>
          </div>
        </div>
      </form>
    </Modal>
  );
}

export default function Objects() {
  const objects = useSetupObjects();
  const [q, setQ] = useState('');
  const [creating, setCreating] = useState(false);
  const term = q.trim().toLowerCase();
  const list = [...(objects.data ?? [])]
    .filter((o) => !term || [o.label, o.pluralLabel, o.apiName, o.description ?? ''].some((s) => s.toLowerCase().includes(term)))
    .sort((a, b) => a.label.localeCompare(b.label));

  return (
    <div className="mx-auto max-w-6xl p-6">
      <PageHeader
        title={t('setupObjects.list.title')}
        subtitle={t('setupObjects.list.subtitle')}
        actions={
          <Button variant="primary" icon={Plus} onClick={() => setCreating(true)}>
            {t('setupObjects.list.newObject')}
          </Button>
        }
      />
      <div className="card overflow-hidden">
        <div className="border-b border-slate-100 p-3">
          <div className="relative max-w-sm">
            <Search className="pointer-events-none absolute top-2.5 left-2.5 size-4 text-slate-400" aria-hidden />
            <input type="search" aria-label={t('setupObjects.list.searchLabel')} placeholder={t('setupObjects.list.searchPlaceholder')} className="input pl-8" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
        </div>
        {objects.isLoading ? (
          <Loading />
        ) : objects.error ? (
          <div className="p-4">
            <ErrorBanner error={objects.error} />
          </div>
        ) : list.length === 0 ? (
          <EmptyState icon={Database} title={term ? t('setupObjects.list.noMatches') : t('setupObjects.list.empty')} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50/70 text-left text-xs font-semibold text-slate-500 uppercase">
                <tr>
                  <th className="px-4 py-2.5">{t('common.object')}</th>
                  <th className="px-4 py-2.5">{t('common.apiName')}</th>
                  <th className="px-4 py-2.5">{t('common.type')}</th>
                  <th className="px-4 py-2.5 text-right">{t('setupObjects.list.fields')}</th>
                  <th className="px-4 py-2.5">{t('common.description')}</th>
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
                    <td className="px-4 py-2.5">{o.isCustom ? <Badge color="purple">{t('setupObjects.custom')}</Badge> : <Badge color="gray">{t('setupObjects.standard')}</Badge>}</td>
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
