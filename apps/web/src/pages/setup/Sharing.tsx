import { type QueryClient, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { DATE_LITERALS, type FieldDef, type FilterGroup, type ObjectDef, OPERATOR_LABELS, type RoleDef, type SharingRule, type SharingRuleType } from '@titoforce/shared';
import { Pencil, Plus, Share2, Trash } from 'lucide-react';
import { useId, useState } from 'react';
import { api, errorMessage } from '../../api.ts';
import { useConfirm, useToast } from '../../components/feedback.tsx';
import { completeFilter, FilterEditor } from '../../components/FilterEditor.tsx';
import { InlineToggle } from '../../components/pickers.tsx';
import { Badge, Button, Card, cx, EmptyState, ErrorBanner, FormField, IconButton, Loading, Modal, ObjectTile, PageHeader, Toggle } from '../../components/ui.tsx';
import { fieldDef, plural } from '../../lib/format.ts';
import { invalidateRecordData, objectPerm, useObjects, useUsers } from '../../lib/hooks.ts';

type Access = SharingRule['access'];
type RuleInput = Pick<SharingRule, 'object' | 'name' | 'description' | 'type' | 'ownerRoles' | 'criteria' | 'shareWith' | 'access' | 'active'>;

const ACCESS_LABELS: Record<Access, string> = { read: 'Read only', edit: 'Read and edit' };

const RULE_TYPES: { id: SharingRuleType; title: string; text: string }[] = [
  { id: 'owner', title: 'Records owned by roles', text: 'Share the records owned by users with certain roles.' },
  { id: 'criteria', title: 'Records matching conditions', text: 'Share the records that match conditions, whoever owns them.' },
];

const DATE_WORDS: Record<string, string> = Object.fromEntries(DATE_LITERALS.map((l) => [l, l.toLowerCase().replace(/_/g, ' ')]));

function useSharingRules() {
  return useQuery({ queryKey: ['sharing-rules'], queryFn: () => api.get<SharingRule[]>('/api/sharing-rules') });
}

function useRoles() {
  return useQuery({ queryKey: ['roles'], queryFn: () => api.get<RoleDef[]>('/api/roles') });
}

const inputOf = (r: SharingRule): RuleInput => ({
  object: r.object,
  name: r.name,
  description: r.description,
  type: r.type,
  ownerRoles: r.ownerRoles,
  criteria: r.criteria,
  shareWith: r.shareWith,
  access: r.access,
  active: r.active,
});

// Sharing rules change which records people can see and edit.
const refresh = (qc: QueryClient) => Promise.all([qc.invalidateQueries({ queryKey: ['sharing-rules'] }), invalidateRecordData(qc)]);

function valueText(f: FieldDef | undefined, v: unknown, userName: (id: string) => string): string {
  if (v === 'CURRENT_USER') return 'the current user';
  const dateWord = typeof v === 'string' ? DATE_WORDS[v] : undefined;
  if (dateWord) return dateWord;
  if (f?.type === 'user' && typeof v === 'string') return userName(v);
  return String(v ?? '');
}

/** "Records owned by Sales Rep, Sales Manager" or "Records where Industry equals Energy". */
function ruleSummary(rule: SharingRule, def: ObjectDef | undefined, roleName: (id: string) => string, userName: (id: string) => string): string {
  if (rule.type === 'owner') return `Records owned by ${rule.ownerRoles.map(roleName).join(', ')}`;
  const rules = rule.criteria?.rules ?? [];
  if (!def) return `Records matching ${plural(rules.length, 'condition')}`;
  const parts = rules.map((r) => {
    const f = fieldDef(def, r.field);
    const subject = `${f?.label ?? r.field} ${OPERATOR_LABELS[r.op] ?? r.op}`;
    if (r.op === 'is_empty' || r.op === 'is_not_empty') return subject;
    const values = Array.isArray(r.value) ? r.value : [r.value];
    return `${subject} ${values.map((v) => valueText(f, v, userName)).join(', ')}`;
  });
  return `Records where ${parts.join(rule.criteria?.match === 'any' ? ' or ' : ' and ')}`;
}

/** Why sharing with this role changes nothing (or less than asked) on the object; null when the rule works as set. */
function shareHint(role: RoleDef, object: string, access: Access): string | null {
  const p = objectPerm(role.permissions, object);
  if (p.read === 'none') return 'No access to this object';
  // Edit rules still matter to roles that read all records but only edit their own.
  if (p.read === 'all' && (access === 'read' || p.edit !== 'own')) return 'Already sees all records';
  if (access === 'edit' && p.edit === 'none') return 'Gets read access only — can’t edit this object';
  return null;
}

function RoleChecklist({
  legend,
  help,
  roles,
  value,
  onChange,
  hint,
}: {
  legend: string;
  help: string;
  roles: RoleDef[];
  value: string[];
  onChange: (v: string[]) => void;
  hint?: (r: RoleDef) => string | null;
}) {
  const base = useId();
  return (
    <fieldset>
      <legend className="label">
        {legend}
        <span className="ml-0.5 text-rose-500" aria-hidden>
          *
        </span>
        <span className="sr-only"> (required)</span>
      </legend>
      <p className="mb-2 text-xs text-slate-500">{help}</p>
      <div className="grid gap-x-4 gap-y-1 rounded-lg border border-slate-200 p-2 sm:grid-cols-2">
        {roles.map((r) => {
          const note = hint?.(r) ?? null;
          const noteId = `${base}-${r.id}`;
          return (
            <div key={r.id} className="rounded px-1 py-0.5 hover:bg-slate-50">
              <label className="flex items-center gap-2 text-sm text-slate-700">
                <input
                  type="checkbox"
                  className="size-4 accent-indigo-600"
                  checked={value.includes(r.id)}
                  aria-describedby={note ? noteId : undefined}
                  onChange={(e) => onChange(e.target.checked ? [...value, r.id] : value.filter((x) => x !== r.id))}
                />
                <span className="truncate">{r.name}</span>
              </label>
              {note && (
                <p id={noteId} className="pl-6 text-xs text-slate-400">
                  {note}
                </p>
              )}
            </div>
          );
        })}
      </div>
    </fieldset>
  );
}

function RuleForm({ rule, objects, roles, onClose }: { rule: SharingRule | null; objects: ObjectDef[]; roles: RoleDef[]; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const confirm = useConfirm();
  const isNew = !rule;
  const formId = useId();
  const ids = { name: useId(), object: useId(), desc: useId(), access: useId(), type: useId() };
  const [name, setName] = useState(rule?.name ?? '');
  const [description, setDescription] = useState(rule?.description ?? '');
  const [object, setObject] = useState(rule?.object ?? '');
  const [type, setType] = useState<SharingRuleType>(rule?.type ?? 'owner');
  const [ownerRoles, setOwnerRoles] = useState<string[]>(rule?.ownerRoles ?? []);
  const [criteria, setCriteria] = useState<FilterGroup | null>(rule?.criteria ?? null);
  const [shareWith, setShareWith] = useState<string[]>(rule?.shareWith ?? []);
  const [access, setAccess] = useState<Access>(rule?.access ?? 'read');
  const [active, setActive] = useState(rule?.active ?? true);
  const def = objects.find((o) => o.apiName === object);
  const sorted = [...objects].sort((a, b) => a.label.localeCompare(b.label));
  const conditions = completeFilter(criteria);

  const problem = !name.trim()
    ? 'Enter a name.'
    : !def
      ? 'Choose an object.'
      : type === 'owner' && !ownerRoles.length
        ? 'Choose the roles whose records are shared.'
        : type === 'criteria' && !conditions
          ? 'Add at least one condition.'
          : !shareWith.length
            ? 'Choose the roles to share records with.'
            : null;

  const save = useMutation({
    mutationFn: () => {
      const body: RuleInput = {
        object,
        name: name.trim(),
        description: description.trim(),
        type,
        ownerRoles: type === 'owner' ? ownerRoles : [],
        criteria: type === 'criteria' ? conditions : null,
        shareWith,
        access,
        active,
      };
      return rule ? api.put<SharingRule>(`/api/sharing-rules/${rule.id}`, body) : api.post<SharingRule>('/api/sharing-rules', body);
    },
    onSuccess: async (saved) => {
      toast.success(isNew ? `${saved.name} created` : `${saved.name} saved`);
      onClose();
      await refresh(qc);
    },
  });

  const changeObject = async (next: string) => {
    if (next === object) return;
    if (criteria?.rules.length) {
      const ok = await confirm({ title: 'Change the object?', message: 'The conditions refer to the current object and will be cleared.', confirmLabel: 'Change object' });
      if (!ok) return;
    }
    setObject(next);
    setCriteria(null);
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={isNew ? 'New sharing rule' : 'Edit sharing rule'}
      size="lg"
      footer={
        <>
          {problem && <span className="mr-auto text-xs text-slate-500">{problem}</span>}
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" type="submit" form={formId} disabled={!!problem} loading={save.isPending}>
            Save
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
            <input id={ids.name} className="input" value={name} maxLength={120} placeholder="Share partner accounts with support" onChange={(e) => setName(e.target.value)} />
          </FormField>
          <FormField label="Object" required htmlFor={ids.object} help={isNew ? undefined : 'The object of an existing rule can’t be changed.'}>
            <select id={ids.object} className="input" value={object} disabled={!isNew} onChange={(e) => void changeObject(e.target.value)}>
              {!def && <option value={object}>{object || 'Choose an object…'}</option>}
              {sorted.map((o) => (
                <option key={o.apiName} value={o.apiName}>
                  {o.label}
                </option>
              ))}
            </select>
          </FormField>
          <FormField label="Description" htmlFor={ids.desc} className="sm:col-span-2">
            <textarea id={ids.desc} className="input" rows={2} maxLength={500} value={description} onChange={(e) => setDescription(e.target.value)} />
          </FormField>
        </section>

        <section className="space-y-4 rounded-xl border border-slate-200 p-4">
          <h3 className="text-sm font-semibold text-slate-800">1. Which records</h3>
          <fieldset>
            <legend className="label">Rule type</legend>
            <div className="grid gap-2 sm:grid-cols-2">
              {RULE_TYPES.map((t) => (
                <label
                  key={t.id}
                  className={cx('flex cursor-pointer items-start gap-2.5 rounded-lg border p-3', type === t.id ? 'border-indigo-500 bg-indigo-50/50 ring-1 ring-indigo-500' : 'border-slate-200 hover:bg-slate-50')}
                >
                  <input
                    type="radio"
                    name={ids.type}
                    className="mt-0.5 size-4 accent-indigo-600"
                    checked={type === t.id}
                    aria-labelledby={`${ids.type}-${t.id}`}
                    aria-describedby={`${ids.type}-${t.id}-text`}
                    onChange={() => setType(t.id)}
                  />
                  <span>
                    <span id={`${ids.type}-${t.id}`} className="block text-sm font-medium text-slate-800">
                      {t.title}
                    </span>
                    <span id={`${ids.type}-${t.id}-text`} className="block text-xs text-slate-500">
                      {t.text}
                    </span>
                  </span>
                </label>
              ))}
            </div>
          </fieldset>
          {type === 'owner' ? (
            <RoleChecklist legend="Owner roles" help="Records owned by users with these roles are shared." roles={roles} value={ownerRoles} onChange={setOwnerRoles} />
          ) : def ? (
            <fieldset className="space-y-2">
              <legend className="label">Conditions</legend>
              <p className="text-xs text-slate-500">Records that match are shared. “Current user” means the person viewing the records.</p>
              <FilterEditor key={object} def={def} value={criteria} onChange={setCriteria} />
            </fieldset>
          ) : (
            <p className="text-sm text-slate-500">Choose an object to add conditions.</p>
          )}
        </section>

        <section className="space-y-4 rounded-xl border border-slate-200 p-4">
          <h3 className="text-sm font-semibold text-slate-800">2. Who gets access</h3>
          <RoleChecklist
            legend="Share with"
            help="Users with these roles get access to the records."
            roles={roles}
            value={shareWith}
            onChange={setShareWith}
            hint={def ? (r) => shareHint(r, def.apiName, access) : undefined}
          />
          <FormField label="Access" htmlFor={ids.access} help="Edit access only applies to roles that can edit this object. Sharing never allows deleting records." className="sm:w-96">
            <select id={ids.access} className="input" value={access} onChange={(e) => setAccess(e.target.value as Access)}>
              {(Object.keys(ACCESS_LABELS) as Access[]).map((a) => (
                <option key={a} value={a}>
                  {ACCESS_LABELS[a]}
                </option>
              ))}
            </select>
          </FormField>
        </section>

        <Toggle checked={active} onChange={setActive} label="Active" />
      </form>
    </Modal>
  );
}

export default function Sharing() {
  const rules = useSharingRules();
  const roles = useRoles();
  const objects = useObjects();
  const users = useUsers();
  const qc = useQueryClient();
  const toast = useToast();
  const confirm = useConfirm();
  const [editing, setEditing] = useState<SharingRule | 'new' | null>(null);
  const ready = !!objects.data && !!roles.data;

  const objectOf = (apiName: string) => objects.data?.find((o) => o.apiName === apiName);
  const roleName = (id: string) => roles.data?.find((r) => r.id === id)?.name ?? id;
  const userName = (id: string) => users.data?.find((u) => u.id === id)?.name ?? id;

  const toggle = useMutation({
    mutationFn: ({ rule, active }: { rule: SharingRule; active: boolean }) => api.put<SharingRule>(`/api/sharing-rules/${rule.id}`, { ...inputOf(rule), active }),
    onMutate: ({ rule, active }) => {
      qc.setQueryData<SharingRule[]>(['sharing-rules'], (old) => old?.map((x) => (x.id === rule.id ? { ...x, active } : x)));
    },
    onSuccess: (_r, { rule, active }) => toast.success(`${rule.name} ${active ? 'activated' : 'deactivated'}`),
    onError: (e) => toast.error(errorMessage(e)),
    onSettled: () => refresh(qc),
  });
  const remove = useMutation({
    mutationFn: (rule: SharingRule) => api.del(`/api/sharing-rules/${rule.id}`),
    onSuccess: async (_r, rule) => {
      toast.success(`${rule.name} deleted`);
      await refresh(qc);
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const all = rules.data ?? [];
  const groups = [...new Set(all.map((r) => r.object))]
    .map((apiName) => ({ apiName, def: objectOf(apiName), rules: all.filter((r) => r.object === apiName).sort((a, b) => a.name.localeCompare(b.name)) }))
    .sort((a, b) => (a.def?.label ?? a.apiName).localeCompare(b.def?.label ?? b.apiName));

  const newButton = (label: string) => (
    <Button variant="primary" icon={Plus} disabled={!ready} onClick={() => setEditing('new')}>
      {label}
    </Button>
  );

  return (
    <div className="mx-auto max-w-5xl p-6">
      <PageHeader
        title="Sharing Rules"
        subtitle={
          <p className="max-w-3xl">
            Open more records to roles that only see their own. Share the records owned by users with certain roles, or the records that match conditions. Edit access only applies to roles that
            can edit the object, and sharing never allows deleting. Roles that already see all records, or have no access to the object, aren’t affected.
          </p>
        }
        actions={newButton('New sharing rule')}
      />
      <ErrorBanner error={roles.error ?? objects.error} className="mb-4" />
      {rules.isLoading ? (
        <div className="card">
          <Loading />
        </div>
      ) : rules.error ? (
        <ErrorBanner error={rules.error} />
      ) : groups.length === 0 ? (
        <div className="card">
          <EmptyState icon={Share2} title="No sharing rules yet" action={newButton('Create your first sharing rule')}>
            Roles that can only see their own records get access to more of them through sharing rules.
          </EmptyState>
        </div>
      ) : (
        <div className="space-y-4">
          {groups.map((g) => (
            <Card
              key={g.apiName}
              title={
                <span className="flex items-center gap-2">
                  {g.def && <ObjectTile icon={g.def.icon} color={g.def.color} size="sm" />}
                  {g.def?.label ?? g.apiName}
                </span>
              }
              actions={<span className="text-xs text-slate-500">{plural(g.rules.length, 'rule')}</span>}
              bodyClassName=""
            >
              <ul className="divide-y divide-slate-100">
                {g.rules.map((rule) => (
                  <li key={rule.id} className="flex flex-wrap items-start gap-x-4 gap-y-2 px-4 py-3 sm:flex-nowrap">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className={cx('text-sm font-medium', rule.active ? 'text-slate-900' : 'text-slate-500')}>{rule.name}</h3>
                        <Badge color={rule.access === 'edit' ? 'purple' : 'blue'}>{ACCESS_LABELS[rule.access]}</Badge>
                        {!rule.active && <Badge color="gray">Inactive</Badge>}
                      </div>
                      {rule.description && <p className="mt-0.5 text-sm text-slate-500">{rule.description}</p>}
                      <p className="mt-1.5 text-sm text-slate-700">{ruleSummary(rule, g.def, roleName, userName)}</p>
                      <p className="mt-0.5 text-sm text-slate-500">Shared with: {rule.shareWith.map(roleName).join(', ')}</p>
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      <InlineToggle checked={rule.active} label={`${rule.name} active`} disabled={toggle.isPending} onChange={(active) => toggle.mutate({ rule, active })} />
                      <IconButton icon={Pencil} label={`Edit ${rule.name}`} disabled={!ready} onClick={() => setEditing(rule)} />
                      <IconButton
                        icon={Trash}
                        label={`Delete ${rule.name}`}
                        className="hover:text-rose-600"
                        disabled={remove.isPending}
                        onClick={async () => {
                          const ok = await confirm({
                            title: `Delete ${rule.name}?`,
                            message: 'Roles that get records through this rule lose that access right away.',
                            confirmLabel: 'Delete rule',
                            danger: true,
                          });
                          if (ok) remove.mutate(rule);
                        }}
                      />
                    </div>
                  </li>
                ))}
              </ul>
            </Card>
          ))}
        </div>
      )}
      {editing && objects.data && roles.data && (
        <RuleForm key={editing === 'new' ? '__new' : editing.id} rule={editing === 'new' ? null : editing} objects={objects.data} roles={roles.data} onClose={() => setEditing(null)} />
      )}
    </div>
  );
}
