import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { AccessLevel, ObjectDef, ObjectPermission, RoleDef, RolePermissions } from '@titoforce/shared';
import { Plus, RotateCcw, Save, ShieldCheck, Trash } from 'lucide-react';
import { useId, useState } from 'react';
import { api, errorMessage } from '../../api.ts';
import { useConfirm, useToast } from '../../components/feedback.tsx';
import { Badge, Button, cx, EmptyState, ErrorBanner, FormField, IconButton, Loading, Modal, ObjectTile, PageHeader, Toggle } from '../../components/ui.tsx';
import { invalidateMetadata, useAuth, useObjects, useUsers } from '../../lib/hooks.ts';

const ROLE_ID_RE = /^[a-z][a-z0-9_]{1,39}$/;
const NO_ACCESS: ObjectPermission = { read: 'none', create: false, edit: 'none', delete: 'none' };
const LEVELS: { id: AccessLevel; label: string }[] = [
  { id: 'none', label: 'None' },
  { id: 'own', label: 'Own records' },
  { id: 'all', label: 'All records' },
];

type Capability = 'setup' | 'viewSensitive' | 'manageAutomations' | 'manageAgents';
const CAPABILITIES: { key: Capability; label: string; help: string }[] = [
  { key: 'setup', label: 'Administrator (Setup access)', help: 'Manage objects, fields, users, roles and apps. Also grants automations and AI agents.' },
  { key: 'viewSensitive', label: 'View sensitive fields', help: 'See and edit fields marked as sensitive, such as salaries.' },
  { key: 'manageAutomations', label: 'Manage automations', help: 'Create and edit automations, approval processes, reports and dashboards, and see automation run history.' },
  { key: 'manageAgents', label: 'Manage AI agents', help: 'Create and edit AI agents and see every agent run.' },
];

const blankPermissions = (): RolePermissions => ({ setup: false, viewSensitive: false, manageAutomations: false, manageAgents: false, objects: { '*': { ...NO_ACCESS } } });

const roleIdFrom = (name: string) =>
  name
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^[^a-z]+/, '')
    .replace(/_+$/, '')
    .slice(0, 40);

function useRoles() {
  return useQuery({ queryKey: ['roles'], queryFn: () => api.get<RoleDef[]>('/api/roles') });
}

function LevelSelect({ value, onChange, label, inherited }: { value: AccessLevel; onChange: (v: AccessLevel) => void; label: string; inherited: boolean }) {
  return (
    <select aria-label={label} className={cx('input h-8 py-0 text-xs', inherited && 'text-slate-400')} value={value} onChange={(e) => onChange(e.target.value as AccessLevel)}>
      {LEVELS.map((l) => (
        <option key={l.id} value={l.id}>
          {l.label}
        </option>
      ))}
    </select>
  );
}

function RoleEditor({ role, objects, userCount, onDeleted }: { role: RoleDef; objects: ObjectDef[]; userCount: number; onDeleted: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const confirm = useConfirm();
  const { user: me } = useAuth();
  const ids = { name: useId(), desc: useId() };
  const [name, setName] = useState(role.name);
  const [description, setDescription] = useState(role.description);
  const [perms, setPerms] = useState<RolePermissions>(() => structuredClone(role.permissions));
  const isAdminRole = role.id === 'admin';
  const dirty = name !== role.name || description !== role.description || JSON.stringify(perms) !== JSON.stringify(role.permissions);

  const defaults = perms.objects['*'] ?? NO_ACCESS;
  const setObject = (api: string, next: ObjectPermission | null) =>
    setPerms((p) => {
      const objectsNext = { ...p.objects };
      if (next) objectsNext[api] = next;
      else delete objectsNext[api];
      return { ...p, objects: objectsNext };
    });
  const update = (api: string, patch: Partial<ObjectPermission>) => setObject(api, { ...(perms.objects[api] ?? defaults), ...patch });

  const save = useMutation({
    mutationFn: () => api.put<RoleDef>(`/api/roles/${role.id}`, { name: name.trim(), description: description.trim(), permissions: perms }),
    onSuccess: async () => {
      toast.success(`${name.trim()} saved`);
      await invalidateMetadata(qc);
      if (me.roleId === role.id) await qc.invalidateQueries({ queryKey: ['session'] });
    },
  });
  const remove = useMutation({
    mutationFn: () => api.del(`/api/roles/${role.id}`),
    onSuccess: async () => {
      qc.setQueryData<RoleDef[]>(['roles'], (old) => old?.filter((r) => r.id !== role.id));
      toast.success(`${role.name} deleted`);
      onDeleted();
      await qc.invalidateQueries({ queryKey: ['roles'] });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const deleteBlocked = isAdminRole ? 'The administrator role can’t be deleted.' : userCount > 0 ? `Assign the ${userCount} user${userCount === 1 ? '' : 's'} with this role to another role first.` : null;
  const sorted = [...objects].sort((a, b) => a.label.localeCompare(b.label));
  // Permissions for objects that were deleted (or that you can't read) are kept by the server; the server rejects saving deleted ones.
  const orphans = Object.keys(perms.objects).filter((k) => k !== '*' && !objects.some((o) => o.apiName === k));
  const rows: { api: string; label: string; icon?: string; color?: string; orphan?: boolean }[] = [
    { api: '*', label: 'Default for other objects' },
    ...sorted.map((o) => ({ api: o.apiName, label: o.label, icon: o.icon, color: o.color })),
    ...orphans.map((k) => ({ api: k, label: k, orphan: true })),
  ];

  return (
    <form
      className="space-y-4"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!dirty || !name.trim()) return;
        if (me.roleId === role.id && role.permissions.setup && !perms.setup) {
          const ok = await confirm({
            title: 'Remove your own Setup access?',
            message: 'You have this role, so after saving you will no longer be able to open Setup.',
            confirmLabel: 'Save anyway',
            danger: true,
          });
          if (!ok) return;
        }
        save.mutate();
      }}
    >
      <div className="card p-4">
        <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-slate-900">{role.name}</h2>
            <p className="font-mono text-xs text-slate-500">{role.id}</p>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              icon={Trash}
              disabled={!!deleteBlocked}
              title={deleteBlocked ?? undefined}
              loading={remove.isPending}
              onClick={async () => {
                const ok = await confirm({ title: `Delete ${role.name}?`, message: 'The role and its permissions are permanently deleted.', confirmLabel: 'Delete role', danger: true });
                if (ok) remove.mutate();
              }}
            >
              Delete role
            </Button>
          </div>
        </div>
        <ErrorBanner error={save.error} className="mb-4" />
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField label="Role name" required htmlFor={ids.name}>
            <input id={ids.name} className="input" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} />
          </FormField>
          <FormField label="Description" htmlFor={ids.desc}>
            <input id={ids.desc} className="input" value={description} maxLength={500} onChange={(e) => setDescription(e.target.value)} />
          </FormField>
        </div>
        <fieldset className="mt-5">
          <legend className="mb-2 text-sm font-semibold text-slate-800">Capabilities</legend>
          <div className="grid gap-3 sm:grid-cols-2">
            {CAPABILITIES.map((c) => (
              <div key={c.key} className="rounded-lg border border-slate-200 p-3">
                <Toggle checked={perms[c.key]} disabled={isAdminRole && c.key === 'setup'} onChange={(v) => setPerms((p) => ({ ...p, [c.key]: v }))} label={c.label} />
                <p className="mt-1 text-xs text-slate-500">{isAdminRole && c.key === 'setup' ? 'Always on for the administrator role, so nobody gets locked out.' : c.help}</p>
              </div>
            ))}
          </div>
        </fieldset>
      </div>

      <div className="card overflow-hidden">
        <div className="border-b border-slate-100 px-4 py-3">
          <h3 className="text-sm font-semibold text-slate-800">Object permissions</h3>
          <p className="text-xs text-slate-500">
            “Own records” means records the user owns. Objects without their own settings use the default row
            {isAdminRole || perms.setup ? '. Setup access doesn’t bypass these settings.' : '.'}
          </p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50/70 text-left text-xs font-semibold text-slate-500 uppercase">
              <tr>
                <th className="px-4 py-2.5">Object</th>
                <th className="px-2 py-2.5">Read</th>
                <th className="px-2 py-2.5 text-center">Create</th>
                <th className="px-2 py-2.5">Edit</th>
                <th className="px-2 py-2.5">Delete</th>
                <th className="w-10 px-2 py-2.5">
                  <span className="sr-only">Reset</span>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((r) => {
                const explicit = perms.objects[r.api];
                const p = explicit ?? defaults;
                const inherited = r.api !== '*' && !explicit;
                return (
                  <tr key={r.api} className={r.api === '*' ? 'bg-indigo-50/40' : undefined}>
                    <td className="px-4 py-2">
                      <div className="flex items-center gap-2.5">
                        {r.icon ? <ObjectTile icon={r.icon} color={r.color ?? 'gray'} size="sm" soft /> : <span className="size-7 shrink-0" />}
                        <span className={cx('font-medium', r.api === '*' ? 'text-indigo-800' : r.orphan ? 'font-mono text-xs text-slate-500' : 'text-slate-800')}>{r.label}</span>
                        {inherited && <Badge color="gray">Default</Badge>}
                        {r.orphan && (
                          <span title="This object no longer exists or you can’t read it. Remove the row if the object was deleted — otherwise saving fails.">
                            <Badge color="orange">Unknown object</Badge>
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-2 py-2">
                      <LevelSelect label={`${r.label}: read`} value={p.read} inherited={inherited} onChange={(v) => update(r.api, { read: v })} />
                    </td>
                    <td className="px-2 py-2 text-center">
                      <input type="checkbox" aria-label={`${r.label}: create`} className="size-4 accent-indigo-600" checked={p.create} onChange={(e) => update(r.api, { create: e.target.checked })} />
                    </td>
                    <td className="px-2 py-2">
                      <LevelSelect label={`${r.label}: edit`} value={p.edit} inherited={inherited} onChange={(v) => update(r.api, { edit: v })} />
                    </td>
                    <td className="px-2 py-2">
                      <LevelSelect label={`${r.label}: delete`} value={p.delete} inherited={inherited} onChange={(v) => update(r.api, { delete: v })} />
                    </td>
                    <td className="px-2 py-2">
                      {r.orphan ? (
                        <IconButton icon={Trash} label={`Remove permissions for ${r.label}`} className="size-7 hover:text-rose-600" onClick={() => setObject(r.api, null)} />
                      ) : (
                        r.api !== '*' && explicit && <IconButton icon={RotateCcw} label={`Use default for ${r.label}`} className="size-7" onClick={() => setObject(r.api, null)} />
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
      <div className="sticky bottom-0 flex items-center justify-end gap-3 border-t border-slate-200 bg-slate-50/90 py-3 backdrop-blur">
        {dirty && (
          <>
            <span className="mr-auto text-xs text-slate-500">Unsaved changes</span>
            <Button
              onClick={() => {
                setName(role.name);
                setDescription(role.description);
                setPerms(structuredClone(role.permissions));
              }}
            >
              Discard
            </Button>
          </>
        )}
        <Button variant="primary" type="submit" icon={Save} disabled={!dirty || !name.trim()} loading={save.isPending}>
          Save role
        </Button>
      </div>
    </form>
  );
}

function NewRoleForm({ roles, objects, onClose, onCreated }: { roles: RoleDef[]; objects: ObjectDef[]; onClose: () => void; onCreated: (id: string) => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const formId = useId();
  const ids = { name: useId(), id: useId(), desc: useId(), copy: useId() };
  const [name, setName] = useState('');
  const [roleId, setRoleId] = useState('');
  const [idTouched, setIdTouched] = useState(false);
  const [description, setDescription] = useState('');
  const [copyFrom, setCopyFrom] = useState('');
  const effectiveId = idTouched ? roleId : roleIdFrom(name);
  const idError = !effectiveId
    ? null
    : !ROLE_ID_RE.test(effectiveId)
      ? 'Use 2–40 lowercase letters, numbers and underscores, starting with a letter.'
      : roles.some((r) => r.id === effectiveId)
        ? 'A role with this id already exists.'
        : null;
  const canSave = !!name.trim() && !!effectiveId && !idError;

  const create = useMutation({
    mutationFn: () => {
      const source = roles.find((r) => r.id === copyFrom);
      const permissions = source ? structuredClone(source.permissions) : blankPermissions();
      // Skip permissions for objects that no longer exist; the server rejects them.
      permissions.objects = Object.fromEntries(Object.entries(permissions.objects).filter(([k]) => k === '*' || objects.some((o) => o.apiName === k)));
      return api.put<RoleDef>(`/api/roles/${effectiveId}`, { name: name.trim(), description: description.trim(), permissions });
    },
    onSuccess: async (role) => {
      qc.setQueryData<RoleDef[]>(['roles'], (old) => (old ? [...old, role] : old));
      toast.success(`${role.name} created`);
      onCreated(role.id);
      onClose();
      await qc.invalidateQueries({ queryKey: ['roles'] });
    },
  });

  return (
    <Modal
      open
      onClose={onClose}
      title="New role"
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" type="submit" form={formId} disabled={!canSave} loading={create.isPending}>
            Create role
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
        <FormField label="Role name" required htmlFor={ids.name}>
          <input id={ids.name} className="input" value={name} maxLength={80} placeholder="Customer Success" onChange={(e) => setName(e.target.value)} />
        </FormField>
        <FormField label="Role id" required htmlFor={ids.id} error={idError} help="Permanent identifier, e.g. customer_success.">
          <input
            id={ids.id}
            className="input font-mono"
            value={effectiveId}
            maxLength={40}
            onChange={(e) => {
              setIdTouched(true);
              setRoleId(e.target.value);
            }}
          />
        </FormField>
        <FormField label="Description" htmlFor={ids.desc}>
          <input id={ids.desc} className="input" value={description} maxLength={500} onChange={(e) => setDescription(e.target.value)} />
        </FormField>
        <FormField label="Start from" htmlFor={ids.copy} help="Copy the permissions of an existing role, or start with no access.">
          <select id={ids.copy} className="input" value={copyFrom} onChange={(e) => setCopyFrom(e.target.value)}>
            <option value="">No access</option>
            {roles.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </select>
        </FormField>
      </form>
    </Modal>
  );
}

export default function Roles() {
  const roles = useRoles();
  const objects = useObjects();
  const users = useUsers();
  const [selected, setSelected] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const list = roles.data ?? [];
  const current = list.find((r) => r.id === selected) ?? list[0];
  const countFor = (id: string) => (users.data ?? []).filter((u) => u.roleId === id).length;

  return (
    <div className="mx-auto max-w-7xl p-6">
      <PageHeader
        title="Roles & Permissions"
        subtitle="Control what each role can see and do, object by object."
        actions={
          <Button variant="primary" icon={Plus} disabled={!roles.data} onClick={() => setCreating(true)}>
            New role
          </Button>
        }
      />
      {roles.isLoading || objects.isLoading ? (
        <Loading />
      ) : roles.error || objects.error ? (
        <ErrorBanner error={roles.error ?? objects.error} />
      ) : !current ? (
        <div className="card">
          <EmptyState icon={ShieldCheck} title="No roles yet" />
        </div>
      ) : (
        <div className="grid items-start gap-5 lg:grid-cols-[16rem_minmax(0,1fr)]">
          <nav aria-label="Roles" className="card overflow-hidden lg:sticky lg:top-4">
            <ul className="divide-y divide-slate-100">
              {list.map((r) => {
                const on = r.id === current.id;
                const n = countFor(r.id);
                return (
                  <li key={r.id}>
                    <button
                      type="button"
                      aria-current={on ? 'true' : undefined}
                      onClick={() => setSelected(r.id)}
                      className={cx('block w-full px-4 py-2.5 text-left', on ? 'bg-indigo-50' : 'hover:bg-slate-50')}
                    >
                      <span className={cx('flex items-center gap-2 text-sm font-medium', on ? 'text-indigo-700' : 'text-slate-800')}>
                        <span className="truncate">{r.name}</span>
                        {r.permissions.setup && <Badge color="indigo">Admin</Badge>}
                      </span>
                      <span className="mt-0.5 block text-xs text-slate-500">
                        {n} user{n === 1 ? '' : 's'}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </nav>
          <RoleEditor key={`${current.id}:${JSON.stringify(current)}`} role={current} objects={objects.data ?? []} userCount={countFor(current.id)} onDeleted={() => setSelected(null)} />
        </div>
      )}
      {creating && roles.data && <NewRoleForm roles={roles.data} objects={objects.data ?? []} onClose={() => setCreating(false)} onCreated={setSelected} />}
    </div>
  );
}
