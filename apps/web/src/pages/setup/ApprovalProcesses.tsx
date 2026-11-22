import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ApprovalProcessDef, AutomationAction, AutomationActionType, FilterGroup, ObjectDef } from '@titoforce/shared';
import { Info, Pencil, Plus, Search, Stamp, Trash } from 'lucide-react';
import { useId, useState } from 'react';
import { useSearchParams } from 'react-router';
import { api, errorMessage } from '../../api.ts';
import { ACTION_LABELS, ActionsEditor, actionsProblem } from '../../components/ActionsEditor.tsx';
import { useConfirm, useToast } from '../../components/feedback.tsx';
import { UserSelect } from '../../components/FieldInput.tsx';
import { completeFilter, describeFilter, FilterEditor } from '../../components/FilterEditor.tsx';
import { InlineToggle } from '../../components/pickers.tsx';
import { Button, cx, EmptyState, ErrorBanner, FormField, IconButton, Loading, Modal, ObjectTile, PageHeader, Toggle } from '../../components/ui.tsx';
import { inSentence, type MessageKey, t } from '../../i18n/index.ts';
import { useObjects, useUsers } from '../../lib/hooks.ts';

// The server validates process actions without any agents, so "Run AI agent" is never accepted here.
const SUBMIT_TYPES: AutomationActionType[] = ['update_record', 'update_related', 'create_record', 'notify', 'webhook'];
const DECISION_TYPES: AutomationActionType[] = [...SUBMIT_TYPES, 'submit_approval'];
const PATH_RE = /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*){0,4}$/;
const CUSTOM = '__custom';

type Stage = 'onSubmit' | 'onApprove' | 'onReject';
const STAGES: { id: Stage; title: MessageKey; help: MessageKey; item: MessageKey; add: MessageKey; types: AutomationActionType[] }[] = [
  { id: 'onSubmit', title: 'setupApprovals.stages.onSubmit.title', help: 'setupApprovals.stages.onSubmit.help', item: 'setupApprovals.stages.onSubmit.item', add: 'setupApprovals.stages.onSubmit.add', types: SUBMIT_TYPES },
  { id: 'onApprove', title: 'setupApprovals.stages.onApprove.title', help: 'setupApprovals.stages.onApprove.help', item: 'setupApprovals.stages.onApprove.item', add: 'setupApprovals.stages.onApprove.add', types: DECISION_TYPES },
  { id: 'onReject', title: 'setupApprovals.stages.onReject.title', help: 'setupApprovals.stages.onReject.help', item: 'setupApprovals.stages.onReject.item', add: 'setupApprovals.stages.onReject.add', types: DECISION_TYPES },
];

interface PathGroup {
  label: string;
  options: { path: string; label: string }[];
}

/** Approver paths the server can resolve: owner/user fields, reached through up to two lookups. */
function approverPaths(def: ObjectDef, objects: ObjectDef[]): PathGroup[] {
  const target = (api: string | null | undefined) => (api && api !== '*' ? objects.find((o) => o.apiName === api) : undefined);
  const users = (d: ObjectDef, prefix: string, labelPrefix: string) => [
    { path: `${prefix}owner_id`, label: prefix ? labelPrefix + t('common.owner') : t('setupApprovals.approverPaths.recordOwner') },
    ...d.fields.filter((f) => f.type === 'user').map((f) => ({ path: prefix + f.apiName, label: labelPrefix + f.label })),
  ];
  const groups: PathGroup[] = [{ label: t('setupApprovals.approverPaths.thisObject', { object: inSentence(def.label) }), options: users(def, '', '') }];
  for (const l of def.fields) {
    const t1 = l.type === 'lookup' ? target(l.referenceTo) : undefined;
    if (!t1) continue;
    const options = users(t1, `${l.apiName}.`, `${l.label} → `);
    for (const l2 of t1.fields) {
      const t2 = l2.type === 'lookup' ? target(l2.referenceTo) : undefined;
      if (t2) options.push(...users(t2, `${l.apiName}.${l2.apiName}.`, `${l.label} → ${l2.label} → `));
    }
    groups.push({ label: `${l.label} (${t1.label})`, options });
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
    ? t('setupApprovals.form.problems.enterName')
    : !def
      ? t('setupApprovals.form.problems.chooseObject')
      : mode === 'user' && !userId
        ? t('setupApprovals.form.problems.chooseApprover')
        : mode === 'field' && !PATH_RE.test(path)
          ? t('setupApprovals.form.problems.enterPath')
          : mode === 'field' && first !== 'owner_id' && !def.fields.some((f) => f.apiName === first)
            ? t('setupApprovals.form.problems.noSuchField', { object: def.label, field: first })
            : (actionsProblem(stages.onSubmit, t('setupApprovals.stages.onSubmit.item')) ?? actionsProblem(stages.onApprove, t('setupApprovals.stages.onApprove.item')) ?? actionsProblem(stages.onReject, t('setupApprovals.stages.onReject.item')));

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
      toast.success(isNew ? t('setupApprovals.toasts.created', { name: saved.name }) : t('setupApprovals.toasts.saved', { name: saved.name }));
      onClose();
      await qc.invalidateQueries({ queryKey: ['approval-processes'] });
    },
  });

  const changeObject = async (next: string) => {
    if (next === object) return;
    const used = conditions?.rules.length || stages.onSubmit.length || stages.onApprove.length || stages.onReject.length || (mode === 'field' && path !== 'owner_id');
    if (used) {
      const ok = await confirm({ title: t('setupApprovals.form.changeObjectTitle'), message: t('setupApprovals.form.changeObjectMessage'), confirmLabel: t('setupApprovals.form.changeObjectConfirm') });
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
      title={isNew ? t('setupApprovals.new') : t('setupApprovals.edit', { name: process?.name ?? '' })}
      size="xl"
      footer={
        <>
          {problem && <span className="mr-auto text-xs text-slate-500">{problem}</span>}
          <Button onClick={onClose}>{t('common.cancel')}</Button>
          <Button variant="primary" type="submit" form={formId} disabled={!!problem} loading={save.isPending}>
            {isNew ? t('setupApprovals.form.create') : t('setupApprovals.form.save')}
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
          <FormField label={t('common.name')} required htmlFor={ids.name}>
            <input id={ids.name} className="input" value={name} maxLength={120} placeholder={t('setupApprovals.form.namePlaceholder')} onChange={(e) => setName(e.target.value)} />
          </FormField>
          {isNew ? (
            <FormField label={t('common.object')} required htmlFor={ids.object}>
              <select id={ids.object} className="input" value={object} onChange={(e) => void changeObject(e.target.value)}>
                {!def && <option value="">{t('setupApprovals.form.chooseObject')}</option>}
                {sorted.map((o) => (
                  <option key={o.apiName} value={o.apiName}>
                    {o.label}
                  </option>
                ))}
              </select>
            </FormField>
          ) : (
            <FormField label={t('common.object')} help={t('setupApprovals.form.objectFixed')}>
              <div className="input flex items-center gap-2 bg-slate-50 text-slate-700">
                {def && <ObjectTile icon={def.icon} color={def.color} size="sm" />}
                {def?.label ?? object}
              </div>
            </FormField>
          )}
          <FormField label={t('common.description')} htmlFor={ids.desc} className="sm:col-span-2">
            <textarea id={ids.desc} className="input" rows={2} maxLength={1000} value={description} onChange={(e) => setDescription(e.target.value)} />
          </FormField>
        </section>

        {def && (
          <>
            <section className="space-y-2 rounded-xl border border-slate-200 p-4">
              <h3 className="text-sm font-semibold text-slate-800">{t('setupApprovals.form.entryConditions')}</h3>
              <p className="text-xs text-slate-500">{t('setupApprovals.form.entryConditionsHelp', { objects: inSentence(def.pluralLabel) })}</p>
              <FilterEditor key={object} def={def} value={conditions} onChange={setConditions} />
            </section>

            <section className="space-y-3 rounded-xl border border-slate-200 p-4">
              <h3 id={ids.mode} className="text-sm font-semibold text-slate-800">
                {t('setupApprovals.form.approver')}
              </h3>
              <div role="radiogroup" aria-labelledby={ids.mode} className="grid gap-2 sm:grid-cols-2">
                {(
                  [
                    { id: 'user', title: t('setupApprovals.form.approverModes.user.title'), text: t('setupApprovals.form.approverModes.user.text') },
                    { id: 'field', title: t('setupApprovals.form.approverModes.field.title'), text: t('setupApprovals.form.approverModes.field.text') },
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
                <FormField label={t('setupApprovals.form.approverUser')} required htmlFor={ids.user} className="sm:w-80">
                  <UserSelect id={ids.user} value={userId} onChange={setUserId} emptyLabel={t('setupApprovals.form.chooseUser')} />
                </FormField>
              ) : (
                <div className="grid gap-3 sm:grid-cols-2">
                  <FormField label={t('setupApprovals.form.approverField')} required htmlFor={ids.path} help={t('setupApprovals.form.approverFieldHelp')}>
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
                      <option value={CUSTOM}>{t('setupApprovals.form.customPath')}</option>
                    </select>
                  </FormField>
                  <FormField label={t('setupApprovals.form.fallbackApprover')} htmlFor={ids.fallback} help={t('setupApprovals.form.fallbackApproverHelp')}>
                    <UserSelect id={ids.fallback} value={fallback} onChange={setFallback} emptyLabel={t('setupApprovals.form.noFallback')} />
                  </FormField>
                  {custom && (
                    <FormField
                      label={t('setupApprovals.form.fieldPath')}
                      required
                      htmlFor={ids.custom}
                      className="sm:col-span-2"
                      help={t('setupApprovals.form.fieldPathHelp', { ownerId: 'owner_id', example: 'employee.manager.user' })}
                      error={path && !PATH_RE.test(path) ? t('setupApprovals.form.fieldPathError') : undefined}
                    >
                      <input id={ids.custom} className="input font-mono" value={path} placeholder="employee.manager.user" onChange={(e) => setPath(e.target.value.trim())} />
                    </FormField>
                  )}
                </div>
              )}
            </section>

            <section className="space-y-4 rounded-xl border border-slate-200 p-4">
              <div>
                <h3 className="text-sm font-semibold text-slate-800">{t('setupApprovals.form.actions')}</h3>
                <p className="flex items-start gap-1.5 text-xs text-slate-500">
                  <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                  {t('setupApprovals.form.actionsNote')}
                </p>
              </div>
              {STAGES.map((s) => (
                <div key={s.id} className="space-y-2">
                  <div>
                    <h4 className="text-sm font-medium text-slate-800">{t(s.title)}</h4>
                    <p className="text-xs text-slate-500">{t(s.help, { action: ACTION_LABELS.submit_approval })}</p>
                  </div>
                  <ActionsEditor
                    key={object}
                    object={def}
                    value={stages[s.id]}
                    onChange={(v) => setStages((cur) => ({ ...cur, [s.id]: v }))}
                    types={s.types}
                    itemLabel={t(s.item)}
                    addLabel={t(s.add)}
                    emptyText={t('setupApprovals.form.actionsEmpty')}
                  />
                </div>
              ))}
            </section>
          </>
        )}

        <Toggle checked={active} onChange={setActive} label={t('common.active')} />
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
  const userName = (id: string | undefined) => (id ? (users.data?.find((u) => u.id === id)?.name ?? t('common.unknownUser')) : '');

  const toggle = useMutation({
    mutationFn: ({ p, active }: { p: ApprovalProcessDef; active: boolean }) => api.patch<ApprovalProcessDef>(`/api/approval-processes/${p.id}`, { active }),
    onMutate: ({ p, active }) => {
      qc.setQueryData<ApprovalProcessDef[]>(['approval-processes'], (old) => old?.map((x) => (x.id === p.id ? { ...x, active } : x)));
    },
    onSuccess: (_r, { p, active }) => toast.success(active ? t('setupApprovals.toasts.activated', { name: p.name }) : t('setupApprovals.toasts.deactivated', { name: p.name })),
    onError: (e) => toast.error(errorMessage(e)),
    onSettled: () => qc.invalidateQueries({ queryKey: ['approval-processes'] }),
  });
  const remove = useMutation({
    mutationFn: (p: ApprovalProcessDef) => api.del(`/api/approval-processes/${p.id}`),
    onSuccess: async (_r, p) => {
      toast.success(t('setupApprovals.toasts.deleted', { name: p.name }));
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
        title={t('setupApprovals.title')}
        subtitle={t('setupApprovals.subtitle')}
        actions={
          <Button variant="primary" icon={Plus} disabled={!objects.data} onClick={() => setEditing('new')}>
            {t('setupApprovals.new')}
          </Button>
        }
      />
      <div className="card overflow-hidden">
        <div className="flex flex-wrap items-center gap-3 border-b border-slate-100 p-3">
          <div className="relative w-full max-w-xs">
            <Search className="pointer-events-none absolute top-2.5 left-2.5 size-4 text-slate-400" aria-hidden />
            <input type="search" aria-label={t('setupApprovals.list.searchLabel')} placeholder={t('setupApprovals.list.searchPlaceholder')} className="input pl-8" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <select
            aria-label={t('setupApprovals.list.filterByObject')}
            className="input w-auto"
            value={objectFilter}
            onChange={(e) => {
              const next = new URLSearchParams(params);
              if (e.target.value) next.set('object', e.target.value);
              else next.delete('object');
              setParams(next, { replace: true });
            }}
          >
            <option value="">{t('setupApprovals.list.allObjects')}</option>
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
            title={term || objectFilter ? t('setupApprovals.list.noMatch') : t('setupApprovals.list.empty')}
            action={
              !term && !objectFilter ? (
                <Button variant="primary" icon={Plus} disabled={!objects.data} onClick={() => setEditing('new')}>
                  {t('setupApprovals.list.createFirst')}
                </Button>
              ) : undefined
            }
          >
            {!term && !objectFilter && t('setupApprovals.list.emptyText')}
          </EmptyState>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50/70 text-left text-xs font-semibold text-slate-500 uppercase">
                <tr>
                  <th className="px-4 py-2.5">{t('common.name')}</th>
                  <th className="px-4 py-2.5">{t('common.object')}</th>
                  <th className="px-4 py-2.5">{t('setupApprovals.list.entryConditions')}</th>
                  <th className="px-4 py-2.5">{t('setupApprovals.list.approver')}</th>
                  <th className="px-4 py-2.5">{t('setupApprovals.list.actions')}</th>
                  <th className="px-4 py-2.5">{t('common.active')}</th>
                  <th className="px-4 py-2.5">
                    <span className="sr-only">{t('setupApprovals.list.rowActions')}</span>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {list.map((p) => {
                  const def = objectOf(p.object);
                  const conditions = def ? describeFilter(def, p.entryConditions) : p.entryConditions?.rules.length ? t('setupApprovals.list.conditionCount', { count: p.entryConditions.rules.length }) : t('setupApprovals.list.noConditions');
                  const approver =
                    p.approver.type === 'user' ? (
                      userName(p.approver.userId)
                    ) : (
                      <>
                        {pathLabel(def, objects.data ?? [], p.approver.path)}
                        {p.approver.fallbackUserId && <span className="block text-xs text-slate-500">{t('setupApprovals.list.fallback', { name: userName(p.approver.fallbackUserId) })}</span>}
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
                        <span title={t('setupApprovals.list.actionsTitle')}>
                          {p.onSubmit.length} / {p.onApprove.length} / {p.onReject.length}
                        </span>
                      </td>
                      <td className="px-4 py-2.5">
                        <InlineToggle checked={p.active} label={t('setupApprovals.list.activeLabel', { name: p.name })} disabled={toggle.isPending} onChange={(active) => toggle.mutate({ p, active })} />
                      </td>
                      <td className="px-4 py-2.5">
                        <div className="flex justify-end gap-0.5">
                          <IconButton icon={Pencil} label={t('setupApprovals.edit', { name: p.name })} disabled={!objects.data} onClick={() => setEditing(p)} />
                          <IconButton
                            icon={Trash}
                            label={t('setupApprovals.list.delete', { name: p.name })}
                            className="hover:text-rose-600"
                            disabled={remove.isPending}
                            onClick={async () => {
                              const ok = await confirm({
                                title: t('setupApprovals.list.deleteTitle', { name: p.name }),
                                message: t('setupApprovals.list.deleteMessage'),
                                confirmLabel: t('setupApprovals.list.deleteConfirm'),
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
