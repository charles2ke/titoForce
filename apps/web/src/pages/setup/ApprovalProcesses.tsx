import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ApprovalProcessDef, AutomationAction, AutomationActionType, FilterGroup, ObjectDef } from '@titoforce/shared';
import { Info, Pencil, Plus, Search, Stamp, Trash } from 'lucide-react';
import { useId, useState } from 'react';
import { useSearchParams } from 'react-router';
import { api, errorMessage } from '../../api.ts';
import { ActionsEditor, actionsProblem } from '../../components/ActionsEditor.tsx';
import { useConfirm, useToast } from '../../components/feedback.tsx';
import { UserSelect } from '../../components/FieldInput.tsx';
import { completeFilter, describeFilter, FilterEditor } from '../../components/FilterEditor.tsx';
import { InlineToggle } from '../../components/pickers.tsx';
import { Button, cx, EmptyState, ErrorBanner, FormField, IconButton, Loading, Modal, ObjectTile, PageHeader, Toggle } from '../../components/ui.tsx';
import { useObjects, useUsers } from '../../lib/hooks.ts';

// The server validates process actions without any agents, so "Run AI agent" is never accepted here.
const SUBMIT_TYPES: AutomationActionType[] = ['update_record', 'update_related', 'create_record', 'notify', 'webhook'];
const DECISION_TYPES: AutomationActionType[] = [...SUBMIT_TYPES, 'submit_approval'];
const PATH_RE = /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*){0,4}$/;
const CUSTOM = '__custom';

type Stage = 'onSubmit' | 'onApprove' | 'onReject';
const STAGES: { id: Stage; title: string; help: string; item: string; add: string; types: AutomationActionType[] }[] = [
  { id: 'onSubmit', title: 'When submitted', help: 'Runs right after the record is submitted, e.g. set Status to “In Review”.', item: 'On submit action', add: 'Add submit action', types: SUBMIT_TYPES },
  { id: 'onApprove', title: 'When approved', help: 'Runs after the approver approves. Use “Submit for approval” to chain a next approval step.', item: 'On approve action', add: 'Add approve action', types: DECISION_TYPES },
  { id: 'onReject', title: 'When rejected', help: 'Runs after the approver rejects the request.', item: 'On reject action', add: 'Add reject action', types: DECISION_TYPES },
];

interface PathGroup {
  label: string;
  options: { path: string; label: string }[];
}

/** Approver paths the server can resolve: owner/user fields, reached through up to two lookups. */
function approverPaths(def: ObjectDef, objects: ObjectDef[]): PathGroup[] {
  const target = (api: string | null | undefined) => (api && api !== '*' ? objects.find((o) => o.apiName === api) : undefined);
  const users = (d: ObjectDef, prefix: string, labelPrefix: string) => [
    { path: `${prefix}owner_id`, label: prefix ? `${labelPrefix}Owner` : 'Record owner' },
    ...d.fields.filter((f) => f.type === 'user').map((f) => ({ path: prefix + f.apiName, label: labelPrefix + f.label })),
  ];
  const groups: PathGroup[] = [{ label: `This ${def.label.toLowerCase()}`, options: users(def, '', '') }];
  for (const l of def.fields) {
    const t = l.type === 'lookup' ? target(l.referenceTo) : undefined;
    if (!t) continue;
    const options = users(t, `${l.apiName}.`, `${l.label} → `);
    for (const l2 of t.fields) {
      const t2 = l2.type === 'lookup' ? target(l2.referenceTo) : undefined;
      if (t2) options.push(...users(t2, `${l.apiName}.${l2.apiName}.`, `${l.label} → ${l2.label} → `));
    }
    groups.push({ label: `${l.label} (${t.label})`, options });
  }
  return groups;
}

function pathLabel(def: ObjectDef | undefined, objects: ObjectDef[], path: string): string {
  if (!def) return path;
  for (const g of approverPaths(def, objects)) {
    const o = g.options.find((x) => x.path === path);
    if (o) return o.label;
  }
  return path;
}

function ProcessForm({ process, objects, defaultObject, onClose }: { process: ApprovalProcessDef | null; objects: ObjectDef[]; defaultObject: string; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const confirm = useConfirm();
  const isNew = !process;
  const formId = useId();
  const ids = { name: useId(), desc: useId(), object: useId(), user: useId(), path: useId(), custom: useId(), fallback: useId(), mode: useId() };
  const initial = process?.approver;
  const [name, setName] = useState(process?.name ?? '');
  const [description, setDescription] = useState(process?.description ?? '');
  const [object, setObject] = useState(process?.object ?? defaultObject);
  const [conditions, setConditions] = useState<FilterGroup | null>(process?.entryConditions ?? null);
  const [mode, setMode] = useState<'user' | 'field'>(initial?.type ?? 'user');
  const [userId, setUserId] = useState<string | null>(initial?.type === 'user' ? initial.userId : null);
  const [path, setPath] = useState(initial?.type === 'field' ? initial.path : 'owner_id');
  const [fallback, setFallback] = useState<string | null>(initial?.type === 'field' ? (initial.fallbackUserId ?? null) : null);
  const [stages, setStages] = useState<Record<Stage, AutomationAction[]>>({
    onSubmit: process?.onSubmit ?? [],
    onApprove: process?.onApprove ?? [],
    onReject: process?.onReject ?? [],
  });
  const [active, setActive] = useState(process?.active ?? true);
  const def = objects.find((o) => o.apiName === object);
  const groups = def ? approverPaths(def, objects) : [];
  const known = groups.some((g) => g.options.some((o) => o.path === path));
  const [custom, setCustom] = useState(() => !known);
  const sorted = [...objects].sort((a, b) => a.label.localeCompare(b.label));
  const first = path.split('.')[0] ?? '';

  const problem = !name.trim()
    ? 'Enter a name.'
    : !def
      ? 'Choose an object.'
      : mode === 'user' && !userId
        ? 'Choose the approver.'
        : mode === 'field' && !PATH_RE.test(path)
          ? 'Enter a valid approver field path.'
          : mode === 'field' && first !== 'owner_id' && !def.fields.some((f) => f.apiName === first)
            ? `${def.label} has no field “${first}”.`
            : (actionsProblem(stages.onSubmit, 'On submit action') ?? actionsProblem(stages.onApprove, 'On approve action') ?? actionsProblem(stages.onReject, 'On reject action'));

  const save = useMutation({
    mutationFn: () => {
      const body = {
        name: name.trim(),
        description: description.trim(),
        object,
        entryConditions: completeFilter(conditions),
        approver: mode === 'user' ? { type: 'user' as const, userId: userId! } : { type: 'field' as const, path, ...(fallback ? { fallbackUserId: fallback } : {}) },
        ...stages,
        active,
      };
      return isNew ? api.post<ApprovalProcessDef>('/api/approval-processes', body) : api.patch<ApprovalProcessDef>(`/api/approval-processes/${process!.id}`, body);
    },
    onSuccess: async (saved) => {
      toast.success(isNew ? `${saved.name} created` : `${saved.name} saved`);
      onClose();
      await qc.invalidateQueries({ queryKey: ['approval-processes'] });
    },
  });

  const changeObject = async (next: string) => {
    if (next === object) return;
    const used = conditions?.rules.length || stages.onSubmit.length || stages.onApprove.length || stages.onReject.length || (mode === 'field' && path !== 'owner_id');
    if (used) {
      const ok = await confirm({ title: 'Change the object?', message: 'The entry conditions, approver field and actions refer to the current object and will be cleared.', confirmLabel: 'Change object' });
      if (!ok) return;
    }
    setObject(next);
    setConditions(null);
    setPath('owner_id');
    setCustom(false);
    setStages({ onSubmit: [], onApprove: [], onReject: [] });
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={isNew ? 'New approval process' : `Edit ${process?.name}`}
      size="xl"
      footer={
        <>
          {problem && <span className="mr-auto text-xs text-slate-500">{problem}</span>}
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" type="submit" form={formId} disabled={!!problem} loading={save.isPending}>
            {isNew ? 'Create process' : 'Save process'}
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
            <input id={ids.name} className="input" value={name} maxLength={120} placeholder="Discount approval" onChange={(e) => setName(e.target.value)} />
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
            <FormField label="Object" help="The object of an existing process can’t be changed.">
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
            <section className="space-y-2 rounded-xl border border-slate-200 p-4">
              <h3 className="text-sm font-semibold text-slate-800">1. Entry conditions (optional)</h3>
              <p className="text-xs text-slate-500">
                Only records matching these conditions can be submitted. When several active processes exist for {def.pluralLabel.toLowerCase()}, the first matching one is used.
              </p>
              <FilterEditor key={object} def={def} value={conditions} onChange={setConditions} />
            </section>

            <section className="space-y-3 rounded-xl border border-slate-200 p-4">
              <h3 id={ids.mode} className="text-sm font-semibold text-slate-800">
                2. Approver
              </h3>
              <div role="radiogroup" aria-labelledby={ids.mode} className="grid gap-2 sm:grid-cols-2">
                {(
                  [
                    { id: 'user', title: 'A specific user', text: 'Every request goes to the same person.' },
                    { id: 'field', title: 'Based on the record', text: 'Someone related to the record, e.g. its owner or the employee’s manager.' },
                  ] as const
                ).map((m) => (
                  <label key={m.id} className={cx('flex cursor-pointer items-start gap-2.5 rounded-lg border p-3', mode === m.id ? 'border-indigo-500 bg-indigo-50/50 ring-1 ring-indigo-500' : 'border-slate-200 hover:bg-slate-50')}>
                    <input type="radio" name={ids.mode} className="mt-0.5 size-4 accent-indigo-600" checked={mode === m.id} onChange={() => setMode(m.id)} />
                    <span>
                      <span className="block text-sm font-medium text-slate-800">{m.title}</span>
                      <span className="block text-xs text-slate-500">{m.text}</span>
                    </span>
                  </label>
                ))}
              </div>
              {mode === 'user' ? (
                <FormField label="Approver user" required htmlFor={ids.user} className="sm:w-80">
                  <UserSelect id={ids.user} value={userId} onChange={setUserId} emptyLabel="Choose a user…" />
                </FormField>
              ) : (
                <div className="grid gap-3 sm:grid-cols-2">
                  <FormField label="Approver field" required htmlFor={ids.path} help="The user found here at submission time approves the request.">
                    <select
                      id={ids.path}
                      className="input"
                      value={custom ? CUSTOM : path}
                      onChange={(e) => {
                        if (e.target.value === CUSTOM) setCustom(true);
                        else {
                          setCustom(false);
                          setPath(e.target.value);
                        }
                      }}
                    >
                      {groups.map((g) => (
                        <optgroup key={g.options[0]?.path ?? g.label} label={g.label}>
                          {g.options.map((o) => (
                            <option key={o.path} value={o.path}>
                              {o.label}
                            </option>
                          ))}
                        </optgroup>
                      ))}
                      <option value={CUSTOM}>Custom path…</option>
                    </select>
                  </FormField>
                  <FormField label="Fallback approver" htmlFor={ids.fallback} help="Used when the field is empty or the user is inactive.">
                    <UserSelect id={ids.fallback} value={fallback} onChange={setFallback} emptyLabel="None — submission fails" />
                  </FormField>
                  {custom && (
                    <FormField
                      label="Field path"
                      required
                      htmlFor={ids.custom}
                      className="sm:col-span-2"
                      help="Dot-separated API names: lookups to follow, ending in a user field or owner_id (up to 5 parts), e.g. employee.manager.user."
                      error={path && !PATH_RE.test(path) ? 'Use lowercase API names separated by dots.' : undefined}
                    >
                      <input id={ids.custom} className="input font-mono" value={path} placeholder="employee.manager.user" onChange={(e) => setPath(e.target.value.trim())} />
                    </FormField>
                  )}
                </div>
              )}
            </section>

            <section className="space-y-4 rounded-xl border border-slate-200 p-4">
              <div>
                <h3 className="text-sm font-semibold text-slate-800">3. Actions</h3>
                <p className="flex items-start gap-1.5 text-xs text-slate-500">
                  <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                  The approver is always notified. Actions run as the approval process, so they aren’t limited by anyone’s permissions.
                </p>
              </div>
              {STAGES.map((s) => (
                <div key={s.id} className="space-y-2">
                  <div>
                    <h4 className="text-sm font-medium text-slate-800">{s.title}</h4>
                    <p className="text-xs text-slate-500">{s.help}</p>
                  </div>
                  <ActionsEditor
                    key={object}
                    object={def}
                    value={stages[s.id]}
                    onChange={(v) => setStages((cur) => ({ ...cur, [s.id]: v }))}
                    types={s.types}
                    itemLabel={s.item}
                    addLabel={s.add}
                    emptyText="No actions."
                  />
                </div>
              ))}
            </section>
          </>
        )}

        <Toggle checked={active} onChange={setActive} label="Active" />
      </form>
    </Modal>
  );
}

export default function ApprovalProcesses() {
  const objects = useObjects();
  const users = useUsers();
  const processes = useQuery({ queryKey: ['approval-processes'], queryFn: () => api.get<ApprovalProcessDef[]>('/api/approval-processes') });
  const qc = useQueryClient();
  const toast = useToast();
  const confirm = useConfirm();
  const [params, setParams] = useSearchParams();
  const objectFilter = params.get('object') ?? '';
  const [q, setQ] = useState('');
  const [editing, setEditing] = useState<ApprovalProcessDef | 'new' | null>(null);

  const objectOf = (api: string) => objects.data?.find((o) => o.apiName === api);
  const userName = (id: string | undefined) => (id ? (users.data?.find((u) => u.id === id)?.name ?? 'Unknown user') : '');

  const toggle = useMutation({
    mutationFn: ({ p, active }: { p: ApprovalProcessDef; active: boolean }) => api.patch<ApprovalProcessDef>(`/api/approval-processes/${p.id}`, { active }),
    onMutate: ({ p, active }) => {
      qc.setQueryData<ApprovalProcessDef[]>(['approval-processes'], (old) => old?.map((x) => (x.id === p.id ? { ...x, active } : x)));
    },
    onSuccess: (_r, { p, active }) => toast.success(`${p.name} ${active ? 'activated' : 'deactivated'}`),
    onError: (e) => toast.error(errorMessage(e)),
    onSettled: () => qc.invalidateQueries({ queryKey: ['approval-processes'] }),
  });
  const remove = useMutation({
    mutationFn: (p: ApprovalProcessDef) => api.del(`/api/approval-processes/${p.id}`),
    onSuccess: async (_r, p) => {
      toast.success(`${p.name} deleted`);
      await qc.invalidateQueries({ queryKey: ['approval-processes'] });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const term = q.trim().toLowerCase();
  const list = (processes.data ?? [])
    .filter((p) => (!objectFilter || p.object === objectFilter) && (!term || `${p.name} ${p.description}`.toLowerCase().includes(term)))
    .sort((a, b) => a.name.localeCompare(b.name));
  const usedObjects = [...new Set((processes.data ?? []).map((p) => p.object))].map((api) => ({ api, label: objectOf(api)?.label ?? api })).sort((a, b) => a.label.localeCompare(b.label));

  return (
    <div className="mx-auto max-w-7xl p-6">
      <PageHeader
        title="Approval processes"
        subtitle="Route records to an approver and run actions when they are submitted, approved or rejected."
        actions={
          <Button variant="primary" icon={Plus} disabled={!objects.data} onClick={() => setEditing('new')}>
            New approval process
          </Button>
        }
      />
      <div className="card overflow-hidden">
        <div className="flex flex-wrap items-center gap-3 border-b border-slate-100 p-3">
          <div className="relative w-full max-w-xs">
            <Search className="pointer-events-none absolute top-2.5 left-2.5 size-4 text-slate-400" aria-hidden />
            <input type="search" aria-label="Search approval processes" placeholder="Search processes…" className="input pl-8" value={q} onChange={(e) => setQ(e.target.value)} />
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
        {processes.isLoading ? (
          <Loading />
        ) : processes.error ? (
          <div className="p-4">
            <ErrorBanner error={processes.error} />
          </div>
        ) : list.length === 0 ? (
          <EmptyState
            icon={Stamp}
            title={term || objectFilter ? 'No approval processes match' : 'No approval processes yet'}
            action={
              !term && !objectFilter ? (
                <Button variant="primary" icon={Plus} disabled={!objects.data} onClick={() => setEditing('new')}>
                  Create your first approval process
                </Button>
              ) : undefined
            }
          >
            {!term && !objectFilter && 'Approval processes let people submit records such as discounts or time off for sign-off.'}
          </EmptyState>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50/70 text-left text-xs font-semibold text-slate-500 uppercase">
                <tr>
                  <th className="px-4 py-2.5">Name</th>
                  <th className="px-4 py-2.5">Object</th>
                  <th className="px-4 py-2.5">Entry conditions</th>
                  <th className="px-4 py-2.5">Approver</th>
                  <th className="px-4 py-2.5">Actions</th>
                  <th className="px-4 py-2.5">Active</th>
                  <th className="px-4 py-2.5">
                    <span className="sr-only">Row actions</span>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {list.map((p) => {
                  const def = objectOf(p.object);
                  const conditions = def ? describeFilter(def, p.entryConditions) : p.entryConditions?.rules.length ? `${p.entryConditions.rules.length} conditions` : 'No conditions';
                  const approver =
                    p.approver.type === 'user' ? (
                      userName(p.approver.userId)
                    ) : (
                      <>
                        {pathLabel(def, objects.data ?? [], p.approver.path)}
                        {p.approver.fallbackUserId && <span className="block text-xs text-slate-500">Fallback: {userName(p.approver.fallbackUserId)}</span>}
                      </>
                    );
                  return (
                    <tr key={p.id} className="align-top hover:bg-slate-50/70">
                      <td className="max-w-64 px-4 py-2.5">
                        <button type="button" className="text-left font-medium text-slate-900 hover:text-indigo-700" disabled={!objects.data} onClick={() => setEditing(p)}>
                          {p.name}
                        </button>
                        {p.description && <p className="line-clamp-2 text-xs text-slate-500">{p.description}</p>}
                      </td>
                      <td className="px-4 py-2.5 whitespace-nowrap">
                        <span className="flex items-center gap-2 text-slate-700">
                          {def && <ObjectTile icon={def.icon} color={def.color} size="sm" />}
                          {def?.label ?? p.object}
                        </span>
                      </td>
                      <td className="max-w-64 px-4 py-2.5 text-slate-600">
                        <span className="line-clamp-2" title={conditions}>
                          {conditions}
                        </span>
                      </td>
                      <td className="max-w-56 px-4 py-2.5 text-slate-700">{approver}</td>
                      <td className="px-4 py-2.5 whitespace-nowrap text-slate-600">
                        <span title="Actions on submit / approve / reject">
                          {p.onSubmit.length} / {p.onApprove.length} / {p.onReject.length}
                        </span>
                      </td>
                      <td className="px-4 py-2.5">
                        <InlineToggle checked={p.active} label={`${p.name} active`} disabled={toggle.isPending} onChange={(active) => toggle.mutate({ p, active })} />
                      </td>
                      <td className="px-4 py-2.5">
                        <div className="flex justify-end gap-0.5">
                          <IconButton icon={Pencil} label={`Edit ${p.name}`} disabled={!objects.data} onClick={() => setEditing(p)} />
                          <IconButton
                            icon={Trash}
                            label={`Delete ${p.name}`}
                            className="hover:text-rose-600"
                            disabled={remove.isPending}
                            onClick={async () => {
                              const ok = await confirm({
                                title: `Delete ${p.name}?`,
                                message: 'Records can no longer be submitted to this process. Processes with pending requests can’t be deleted.',
                                confirmLabel: 'Delete process',
                                danger: true,
                              });
                              if (ok) remove.mutate(p);
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
        <ProcessForm key={editing === 'new' ? '__new' : editing.id} process={editing === 'new' ? null : editing} objects={objects.data} defaultObject={objectFilter} onClose={() => setEditing(null)} />
      )}
    </div>
  );
}
