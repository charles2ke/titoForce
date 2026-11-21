import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { AutomationAction, AutomationActionType, AutomationDef, FilterGroup, ObjectDef, TriggerType } from '@titoforce/shared';
import { History, Info, Pencil, Plus, Search, Trash, Workflow } from 'lucide-react';
import { useId, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { api, errorMessage } from '../../api.ts';
import { ACTION_LABELS, ActionsEditor, actionsProblem } from '../../components/ActionsEditor.tsx';
import { useConfirm, useToast } from '../../components/feedback.tsx';
import { completeFilter, describeFilter, FilterEditor } from '../../components/FilterEditor.tsx';
import { InlineToggle } from '../../components/pickers.tsx';
import { Button, EmptyState, ErrorBanner, FormField, IconButton, Loading, Modal, ObjectTile, PageHeader, Toggle } from '../../components/ui.tsx';
import { fieldDef, formatDateTime, relativeTime } from '../../lib/format.ts';
import { useObjects } from '../../lib/hooks.ts';

const TRIGGERS: { id: TriggerType; label: string; short: string }[] = [
  { id: 'created', label: 'A record is created', short: 'Created' },
  { id: 'updated', label: 'A record is updated', short: 'Updated' },
  { id: 'saved', label: 'A record is created or updated', short: 'Created or updated' },
  { id: 'deleted', label: 'A record is deleted', short: 'Deleted' },
];
const DELETE_TYPES: AutomationActionType[] = ['update_related', 'create_record', 'notify', 'webhook'];
const MAX_WATCH = 20;

const watchable = (t: TriggerType) => t === 'updated' || t === 'saved';

function useAutomations() {
  return useQuery({ queryKey: ['automations'], queryFn: () => api.get<AutomationDef[]>('/api/automations') });
}

function triggerSummary(a: AutomationDef, def: ObjectDef | undefined): string {
  const t = TRIGGERS.find((x) => x.id === a.trigger.type)?.short ?? a.trigger.type;
  const w = a.trigger.watchFields ?? [];
  if (!w.length || !watchable(a.trigger.type)) return t;
  return `${t} · when ${w.map((f) => (def ? (fieldDef(def, f)?.label ?? f) : f)).join(', ')} change${w.length === 1 ? 's' : ''}`;
}

function WatchFields({ def, value, onChange }: { def: ObjectDef; value: string[]; onChange: (v: string[]) => void }) {
  const fields = [...def.fields.map((f) => ({ apiName: f.apiName, label: f.label })), ...(def.fields.some((f) => f.apiName === 'owner_id') ? [] : [{ apiName: 'owner_id', label: 'Owner' }])];
  const full = value.length >= MAX_WATCH;
  return (
    <fieldset>
      <legend className="label">Only when these fields change</legend>
      <p className="mb-2 text-xs text-slate-500">{value.length ? `${value.length} selected — record creations still run for “created or updated”.` : 'Leave all unchecked to run on any change.'}</p>
      <div className="grid max-h-44 gap-x-4 gap-y-1 overflow-y-auto rounded-lg border border-slate-200 p-2 sm:grid-cols-2 lg:grid-cols-3">
        {fields.map((f) => {
          const on = value.includes(f.apiName);
          return (
            <label key={f.apiName} className="flex items-center gap-2 rounded px-1 py-0.5 text-sm text-slate-700 hover:bg-slate-50">
              <input type="checkbox" className="size-4 accent-indigo-600" checked={on} disabled={!on && full} onChange={(e) => onChange(e.target.checked ? [...value, f.apiName] : value.filter((x) => x !== f.apiName))} />
              <span className="truncate">{f.label}</span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

function AutomationForm({ automation, objects, defaultObject, onClose }: { automation: AutomationDef | null; objects: ObjectDef[]; defaultObject: string; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const confirm = useConfirm();
  const isNew = !automation;
  const formId = useId();
  const ids = { name: useId(), desc: useId(), object: useId(), trigger: useId() };
  const [name, setName] = useState(automation?.name ?? '');
  const [description, setDescription] = useState(automation?.description ?? '');
  const [object, setObject] = useState(automation?.object ?? defaultObject);
  const [trigger, setTrigger] = useState<TriggerType>(automation?.trigger.type ?? 'created');
  const [watch, setWatch] = useState<string[]>(automation?.trigger.watchFields ?? []);
  const [conditions, setConditions] = useState<FilterGroup | null>(automation?.conditions ?? null);
  const [actions, setActions] = useState<AutomationAction[]>(automation?.actions ?? []);
  const [active, setActive] = useState(automation?.active ?? true);
  const def = objects.find((o) => o.apiName === object);
  const sorted = [...objects].sort((a, b) => a.label.localeCompare(b.label));

  const afterDelete = trigger === 'deleted' ? actions.findIndex((a) => !DELETE_TYPES.includes(a.type)) : -1;
  // The server re-runs automations for changes made by automations (until nothing changes or the depth limit of 4).
  const selfUpdated = watchable(trigger) ? actions.flatMap((a) => (a.type === 'update_record' ? Object.keys(a.fields ?? {}).filter(Boolean) : [])) : [];
  const mayRetrigger = selfUpdated.length > 0 && (!watch.length || selfUpdated.some((f) => watch.includes(f)));
  const problem = !name.trim()
    ? 'Enter a name.'
    : !def
      ? 'Choose an object.'
      : !actions.length
        ? 'Add at least one action.'
        : afterDelete >= 0
          ? `Action ${afterDelete + 1} (${ACTION_LABELS[actions[afterDelete]!.type]}) can’t run after a record is deleted.`
          : actionsProblem(actions);

  const save = useMutation({
    mutationFn: () => {
      const body = {
        name: name.trim(),
        description: description.trim(),
        object,
        trigger: watchable(trigger) && watch.length ? { type: trigger, watchFields: watch } : { type: trigger },
        conditions: completeFilter(conditions),
        actions,
        active,
      };
      return isNew ? api.post<AutomationDef>('/api/automations', body) : api.patch<AutomationDef>(`/api/automations/${automation!.id}`, body);
    },
    onSuccess: async (saved) => {
      toast.success(isNew ? `${saved.name} created` : `${saved.name} saved`);
      onClose();
      await qc.invalidateQueries({ queryKey: ['automations'] });
    },
  });

  const changeObject = async (next: string) => {
    if (next === object) return;
    if (actions.length || conditions?.rules.length || watch.length) {
      const ok = await confirm({ title: 'Change the object?', message: 'The conditions, watched fields and actions refer to the current object and will be cleared.', confirmLabel: 'Change object' });
      if (!ok) return;
    }
    setObject(next);
    setWatch([]);
    setConditions(null);
    setActions([]);
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={isNew ? 'New automation' : `Edit ${automation?.name}`}
      size="xl"
      footer={
        <>
          {problem && <span className="mr-auto text-xs text-slate-500">{problem}</span>}
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" type="submit" form={formId} disabled={!!problem} loading={save.isPending}>
            {isNew ? 'Create automation' : 'Save automation'}
          </Button>
        </>
      }
    >
      <form
        id={formId}
        className="space-y-6"
        onSubmit={(e) => {
          e.preventDefault();
          if (!problem) save.mutate();
        }}
      >
        <ErrorBanner error={save.error} />
        <section className="grid gap-4 sm:grid-cols-2">
          <FormField label="Name" required htmlFor={ids.name}>
            <input id={ids.name} className="input" value={name} maxLength={120} placeholder="Notify owner of large deals" onChange={(e) => setName(e.target.value)} />
          </FormField>
          {isNew ? (
            <FormField label="Object" required htmlFor={ids.object}>
              <select id={ids.object} className="input" value={object} onChange={(e) => void changeObject(e.target.value)}>
                {!def && <option value="">Choose an object…</option>}
                {sorted.map((o) => (
                  <option key={o.apiName} value={o.apiName}>
                    {o.label}
                  </option>
                ))}
              </select>
            </FormField>
          ) : (
            <FormField label="Object" help="The object of an existing automation can’t be changed.">
              <div className="input flex items-center gap-2 bg-slate-50 text-slate-700">
                {def && <ObjectTile icon={def.icon} color={def.color} size="sm" />}
                {def?.label ?? object}
              </div>
            </FormField>
          )}
          <FormField label="Description" htmlFor={ids.desc} className="sm:col-span-2">
            <textarea id={ids.desc} className="input" rows={2} maxLength={1000} value={description} onChange={(e) => setDescription(e.target.value)} />
          </FormField>
        </section>

        {def && (
          <>
            <section className="space-y-3 rounded-xl border border-slate-200 p-4">
              <h3 className="text-sm font-semibold text-slate-800">1. When</h3>
              <FormField label="Trigger" required htmlFor={ids.trigger} className="sm:w-80">
                <select id={ids.trigger} className="input" value={trigger} onChange={(e) => setTrigger(e.target.value as TriggerType)}>
                  {TRIGGERS.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.label.replace('A record', `A ${def.label.toLowerCase()}`)}
                    </option>
                  ))}
                </select>
              </FormField>
              {watchable(trigger) && <WatchFields def={def} value={watch} onChange={setWatch} />}
              {trigger === 'deleted' && (
                <p className="flex items-start gap-1.5 text-xs text-slate-500">
                  <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                  The record is already gone when the automation runs, so it can only notify, call webhooks, create records or update related records.
                </p>
              )}
            </section>

            <section className="space-y-2 rounded-xl border border-slate-200 p-4">
              <h3 className="text-sm font-semibold text-slate-800">2. Only if (optional)</h3>
              <p className="text-xs text-slate-500">
                {trigger === 'deleted' ? 'Conditions are checked against the record as it was before deletion.' : 'Conditions are checked against the record after the change.'} “Current user” means the person who made the change.
              </p>
              <FilterEditor key={object} def={def} value={conditions} onChange={setConditions} />
            </section>

            <section className="space-y-3 rounded-xl border border-slate-200 p-4">
              <h3 className="text-sm font-semibold text-slate-800">3. Then</h3>
              <ActionsEditor
                key={object}
                object={def}
                value={actions}
                onChange={setActions}
                types={trigger === 'deleted' ? DELETE_TYPES : undefined}
                emptyText="Add the first action this automation should perform."
              />
              {mayRetrigger && (
                <p className="flex items-start gap-1.5 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
                  <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                  This automation updates the record it runs on, and that update can trigger it again. Repeats stop once a run changes nothing, or after 4 levels. To run it once per change, watch specific fields (not the ones it sets) or add a condition.
                </p>
              )}
            </section>
          </>
        )}

        <Toggle checked={active} onChange={setActive} label="Active" />
      </form>
    </Modal>
  );
}

export default function Automations() {
  const automations = useAutomations();
  const objects = useObjects();
  const qc = useQueryClient();
  const toast = useToast();
  const confirm = useConfirm();
  const [params, setParams] = useSearchParams();
  const objectFilter = params.get('object') ?? '';
  const [q, setQ] = useState('');
  const [editing, setEditing] = useState<AutomationDef | 'new' | null>(null);

  const objectOf = (api: string) => objects.data?.find((o) => o.apiName === api);

  const toggle = useMutation({
    mutationFn: ({ a, active }: { a: AutomationDef; active: boolean }) => api.patch<AutomationDef>(`/api/automations/${a.id}`, { active }),
    onMutate: ({ a, active }) => {
      qc.setQueryData<AutomationDef[]>(['automations'], (old) => old?.map((x) => (x.id === a.id ? { ...x, active } : x)));
    },
    onSuccess: (_r, { a, active }) => toast.success(`${a.name} ${active ? 'activated' : 'deactivated'}`),
    onError: (e) => toast.error(errorMessage(e)),
    onSettled: () => qc.invalidateQueries({ queryKey: ['automations'] }),
  });
  const remove = useMutation({
    mutationFn: (a: AutomationDef) => api.del(`/api/automations/${a.id}`),
    onSuccess: async (_r, a) => {
      toast.success(`${a.name} deleted`);
      await qc.invalidateQueries({ queryKey: ['automations'] });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const term = q.trim().toLowerCase();
  const list = (automations.data ?? [])
    .filter((a) => (!objectFilter || a.object === objectFilter) && (!term || `${a.name} ${a.description}`.toLowerCase().includes(term)))
    .sort((a, b) => a.name.localeCompare(b.name));
  const usedObjects = [...new Set((automations.data ?? []).map((a) => a.object))].map((api) => ({ api, label: objectOf(api)?.label ?? api })).sort((a, b) => a.label.localeCompare(b.label));

  return (
    <div className="mx-auto max-w-7xl p-6">
      <PageHeader
        title="Automations"
        subtitle="Run actions automatically when records are created, updated or deleted."
        actions={
          <>
            <Link to="/setup/runs" className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3.5 text-sm font-medium text-slate-700 shadow-xs hover:bg-slate-50">
              <History className="size-4" aria-hidden /> Run history
            </Link>
            <Button variant="primary" icon={Plus} disabled={!objects.data} onClick={() => setEditing('new')}>
              New automation
            </Button>
          </>
        }
      />
      <div className="card overflow-hidden">
        <div className="flex flex-wrap items-center gap-3 border-b border-slate-100 p-3">
          <div className="relative w-full max-w-xs">
            <Search className="pointer-events-none absolute top-2.5 left-2.5 size-4 text-slate-400" aria-hidden />
            <input type="search" aria-label="Search automations" placeholder="Search automations…" className="input pl-8" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <select
            aria-label="Filter by object"
            className="input w-auto"
            value={objectFilter}
            onChange={(e) => {
              const next = new URLSearchParams(params);
              if (e.target.value) next.set('object', e.target.value);
              else next.delete('object');
              setParams(next, { replace: true });
            }}
          >
            <option value="">All objects</option>
            {objectFilter && !usedObjects.some((o) => o.api === objectFilter) && <option value={objectFilter}>{objectOf(objectFilter)?.label ?? objectFilter}</option>}
            {usedObjects.map((o) => (
              <option key={o.api} value={o.api}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
        {automations.isLoading ? (
          <Loading />
        ) : automations.error ? (
          <div className="p-4">
            <ErrorBanner error={automations.error} />
          </div>
        ) : list.length === 0 ? (
          <EmptyState
            icon={Workflow}
            title={term || objectFilter ? 'No automations match' : 'No automations yet'}
            action={
              !term && !objectFilter ? (
                <Button variant="primary" icon={Plus} disabled={!objects.data} onClick={() => setEditing('new')}>
                  Create your first automation
                </Button>
              ) : undefined
            }
          >
            {!term && !objectFilter && 'Automations update fields, create follow-up records, notify people, call webhooks or hand work to AI agents.'}
          </EmptyState>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50/70 text-left text-xs font-semibold text-slate-500 uppercase">
                <tr>
                  <th className="px-4 py-2.5">Name</th>
                  <th className="px-4 py-2.5">Object</th>
                  <th className="px-4 py-2.5">Trigger</th>
                  <th className="px-4 py-2.5">Conditions</th>
                  <th className="px-4 py-2.5">Actions</th>
                  <th className="px-4 py-2.5 text-right">Runs</th>
                  <th className="px-4 py-2.5">Last run</th>
                  <th className="px-4 py-2.5">Active</th>
                  <th className="px-4 py-2.5">
                    <span className="sr-only">Row actions</span>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {list.map((a) => {
                  const def = objectOf(a.object);
                  const conditions = def ? describeFilter(def, a.conditions) : a.conditions?.rules.length ? `${a.conditions.rules.length} conditions` : 'No conditions';
                  const actionNames = a.actions.map((x) => ACTION_LABELS[x.type] ?? x.type);
                  return (
                    <tr key={a.id} className="align-top hover:bg-slate-50/70">
                      <td className="max-w-64 px-4 py-2.5">
                        <button type="button" className="text-left font-medium text-slate-900 hover:text-indigo-700" disabled={!objects.data} onClick={() => setEditing(a)}>
                          {a.name}
                        </button>
                        {a.description && <p className="line-clamp-2 text-xs text-slate-500">{a.description}</p>}
                      </td>
                      <td className="px-4 py-2.5 whitespace-nowrap">
                        <span className="flex items-center gap-2 text-slate-700">
                          {def && <ObjectTile icon={def.icon} color={def.color} size="sm" />}
                          {def?.label ?? a.object}
                        </span>
                      </td>
                      <td className="max-w-56 px-4 py-2.5 text-slate-600">{triggerSummary(a, def)}</td>
                      <td className="max-w-64 px-4 py-2.5 text-slate-600">
                        <span className="line-clamp-2" title={conditions}>
                          {conditions}
                        </span>
                      </td>
                      <td className="max-w-56 px-4 py-2.5 text-slate-600">
                        <span className="line-clamp-2" title={actionNames.join(', ')}>
                          <span className="font-medium text-slate-800">{a.actions.length}</span> · {actionNames.join(', ')}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-right whitespace-nowrap tabular-nums">
                        <span className="text-slate-700">{a.stats?.runs ?? 0}</span>
                        {!!a.stats?.failures && <span className="block text-xs text-rose-600">{a.stats.failures} failed</span>}
                      </td>
                      <td className="px-4 py-2.5 whitespace-nowrap text-slate-500">
                        {a.stats?.lastRunAt ? <span title={formatDateTime(a.stats.lastRunAt)}>{relativeTime(a.stats.lastRunAt)}</span> : 'Never'}
                      </td>
                      <td className="px-4 py-2.5">
                        <InlineToggle checked={a.active} label={`${a.name} active`} disabled={toggle.isPending} onChange={(active) => toggle.mutate({ a, active })} />
                      </td>
                      <td className="px-4 py-2.5">
                        <div className="flex justify-end gap-0.5">
                          <Link to={`/setup/runs?automationId=${encodeURIComponent(a.id)}`} aria-label={`Run history of ${a.name}`} title="Run history" className="inline-flex size-8 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 hover:text-slate-900">
                            <History className="size-4" aria-hidden />
                          </Link>
                          <IconButton icon={Pencil} label={`Edit ${a.name}`} disabled={!objects.data} onClick={() => setEditing(a)} />
                          <IconButton
                            icon={Trash}
                            label={`Delete ${a.name}`}
                            className="hover:text-rose-600"
                            disabled={remove.isPending}
                            onClick={async () => {
                              const ok = await confirm({ title: `Delete ${a.name}?`, message: 'The automation stops running and is permanently deleted, together with its run history.', confirmLabel: 'Delete automation', danger: true });
                              if (ok) remove.mutate(a);
                            }}
                          />
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
      {editing && objects.data && (
        <AutomationForm key={editing === 'new' ? '__new' : editing.id} automation={editing === 'new' ? null : editing} objects={objects.data} defaultObject={objectFilter} onClose={() => setEditing(null)} />
      )}
    </div>
  );
}
