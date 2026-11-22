import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { AccessLevel, ObjectDef, ObjectPermission, RoleDef, RolePermissions } from '@titoforce/shared';
import { Plus, RotateCcw, Save, ShieldCheck, Trash } from 'lucide-react';
import { useId, useState } from 'react';
import { api, errorMessage } from '../../api.ts';
import { useConfirm, useToast } from '../../components/feedback.tsx';
import { Badge, Button, cx, EmptyState, ErrorBanner, FormField, IconButton, Loading, Modal, ObjectTile, PageHeader, Toggle } from '../../components/ui.tsx';
import { type MessageKey, t } from '../../i18n/index.ts';
import { invalidateMetadata, useAuth, useObjects, useUsers } from '../../lib/hooks.ts';

const ROLE_ID_RE = /^[a-z][a-z0-9_]{1,39}$/;
const NO_ACCESS: ObjectPermission = { read: 'none', create: false, edit: 'none', delete: 'none' };
const LEVELS: { id: AccessLevel; label: MessageKey }[] = [
  { id: 'none', label: 'setupRoles.levels.none' },
  { id: 'own', label: 'setupRoles.levels.own' },
  { id: 'all', label: 'setupRoles.levels.all' },
];

type Capability = 'setup' | 'viewSensitive' | 'manageAutomations' | 'manageAgents';
const CAPABILITIES: { key: Capability; label: MessageKey; help: MessageKey }[] = [
  { key: 'setup', label: 'setupRoles.capabilities.setup.label', help: 'setupRoles.capabilities.setup.help' },
  { key: 'viewSensitive', label: 'setupRoles.capabilities.viewSensitive.label', help: 'setupRoles.capabilities.viewSensitive.help' },
  { key: 'manageAutomations', label: 'setupRoles.capabilities.manageAutomations.label', help: 'setupRoles.capabilities.manageAutomations.help' },
  { key: 'manageAgents', label: 'setupRoles.capabilities.manageAgents.label', help: 'setupRoles.capabilities.manageAgents.help' },
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
    <select aria-label={label} className={cx('input h-8 min-w-20 py-0 text-xs', inherited && 'text-slate-400')} value={value} onChange={(e) => onChange(e.target.value as AccessLevel)}>
      {LEVELS.map((l) => (
        <option key={l.id} value={l.id}>
          {t(l.label)}
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
      toast.success(t('setupRoles.editor.saved', { name: name.trim() }));
      await invalidateMetadata(qc);
      if (me.roleId === role.id) await qc.invalidateQueries({ queryKey: ['session'] });
    },
  });
  const remove = useMutation({
    mutationFn: () => api.del(`/api/roles/${role.id}`),
    onSuccess: async () => {
      qc.setQueryData<RoleDef[]>(['roles'], (old) => old?.filter((r) => r.id !== role.id));
      toast.success(t('setupRoles.editor.deleted', { name: role.name }));
      onDeleted();
      await qc.invalidateQueries({ queryKey: ['roles'] });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const deleteBlocked = isAdminRole ? t('setupRoles.editor.adminNotDeletable') : userCount > 0 ? t('setupRoles.editor.reassignUsers', { count: userCount }) : null;
  const sorted = [...objects].sort((a, b) => a.label.localeCompare(b.label));
  // Permissions for objects that were deleted (or that you can't read) are kept by the server; the server rejects saving deleted ones.
  const orphans = Object.keys(perms.objects).filter((k) => k !== '*' && !objects.some((o) => o.apiName === k));
  const rows: { api: string; label: string; icon?: string; color?: string; orphan?: boolean }[] = [
    { api: '*', label: t('setupRoles.objectPermissions.defaultRow') },
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
            title: t('setupRoles.editor.removeOwnSetupTitle'),
            message: t('setupRoles.editor.removeOwnSetupMessage'),
            confirmLabel: t('setupRoles.editor.saveAnyway'),
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
                const ok = await confirm({ title: t('setupRoles.editor.deleteTitle', { name: role.name }), message: t('setupRoles.editor.deleteMessage'), confirmLabel: t('setupRoles.editor.deleteRole'), danger: true });
                if (ok) remove.mutate();
              }}
            >
              {t('setupRoles.editor.deleteRole')}
            </Button>
          </div>
        </div>
        <ErrorBanner error={save.error} className="mb-4" />
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField label={t('setupRoles.roleName')} required htmlFor={ids.name}>
            <input id={ids.name} className="input" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} />
          </FormField>
          <FormField label={t('common.description')} htmlFor={ids.desc}>
            <input id={ids.desc} className="input" value={description} maxLength={500} onChange={(e) => setDescription(e.target.value)} />
          </FormField>
        </div>
        <fieldset className="mt-5">
          <legend className="mb-2 text-sm font-semibold text-slate-800">{t('setupRoles.capabilities.title')}</legend>
          <div className="grid gap-3 sm:grid-cols-2">
            {CAPABILITIES.map((c) => (
              <div key={c.key} className="rounded-lg border border-slate-200 p-3">
                <Toggle checked={perms[c.key]} disabled={isAdminRole && c.key === 'setup'} onChange={(v) => setPerms((p) => ({ ...p, [c.key]: v }))} label={t(c.label)} />
                <p className="mt-1 text-xs text-slate-500">{isAdminRole && c.key === 'setup' ? t('setupRoles.capabilities.adminAlwaysOn') : t(c.help)}</p>
              </div>
            ))}
          </div>
        </fieldset>
      </div>

      <div className="card overflow-hidden">
        <div className="border-b border-slate-100 px-4 py-3">
          <h3 className="text-sm font-semibold text-slate-800">{t('setupRoles.objectPermissions.title')}</h3>
          <p className="text-xs text-slate-500">{t(isAdminRole || perms.setup ? 'setupRoles.objectPermissions.helpSetup' : 'setupRoles.objectPermissions.help', { own: t('setupRoles.levels.own') })}</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50/70 text-left text-xs font-semibold text-slate-500 uppercase">
              <tr>
                <th className="px-4 py-2.5">{t('common.object')}</th>
                <th className="px-2 py-2.5">{t('setupRoles.objectPermissions.columns.read')}</th>
                <th className="px-2 py-2.5 text-center">{t('setupRoles.objectPermissions.columns.create')}</th>
                <th className="px-2 py-2.5">{t('setupRoles.objectPermissions.columns.edit')}</th>
                <th className="px-2 py-2.5">{t('setupRoles.objectPermissions.columns.delete')}</th>
                <th className="w-10 px-2 py-2.5">
                  <span className="sr-only">{t('common.reset')}</span>
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
                        {inherited && <Badge color="gray">{t('setupRoles.objectPermissions.inherited')}</Badge>}
                        {r.orphan && (
                          <span title={t('setupRoles.objectPermissions.unknownObjectHelp')}>
                            <Badge color="orange">{t('setupRoles.objectPermissions.unknownObject')}</Badge>
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-2 py-2">
                      <LevelSelect label={t('setupRoles.objectPermissions.controls.read', { object: r.label })} value={p.read} inherited={inherited} onChange={(v) => update(r.api, { read: v })} />
                    </td>
                    <td className="px-2 py-2 text-center">
                      <input type="checkbox" aria-label={t('setupRoles.objectPermissions.controls.create', { object: r.label })} className="size-4 accent-indigo-600" checked={p.create} onChange={(e) => update(r.api, { create: e.target.checked })} />
                    </td>
                    <td className="px-2 py-2">
                      <LevelSelect label={t('setupRoles.objectPermissions.controls.edit', { object: r.label })} value={p.edit} inherited={inherited} onChange={(v) => update(r.api, { edit: v })} />
                    </td>
                    <td className="px-2 py-2">
                      <LevelSelect label={t('setupRoles.objectPermissions.controls.delete', { object: r.label })} value={p.delete} inherited={inherited} onChange={(v) => update(r.api, { delete: v })} />
                    </td>
                    <td className="px-2 py-2">
                      {r.orphan ? (
                        <IconButton icon={Trash} label={t('setupRoles.objectPermissions.removeRow', { object: r.label })} className="size-7 hover:text-rose-600" onClick={() => setObject(r.api, null)} />
                      ) : (
                        r.api !== '*' && explicit && <IconButton icon={RotateCcw} label={t('setupRoles.objectPermissions.useDefault', { object: r.label })} className="size-7" onClick={() => setObject(r.api, null)} />
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
            <span className="mr-auto text-xs text-slate-500">{t('setupRoles.editor.unsavedChanges')}</span>
            <Button
              onClick={() => {
                setName(role.name);
                setDescription(role.description);
                setPerms(structuredClone(role.permissions));
              }}
            >
              {t('setupRoles.editor.discard')}
            </Button>
          </>
        )}
        <Button variant="primary" type="submit" icon={Save} disabled={!dirty || !name.trim()} loading={save.isPending}>
          {t('setupRoles.editor.save')}
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
      ? t('setupRoles.createForm.idInvalid')
      : roles.some((r) => r.id === effectiveId)
        ? t('setupRoles.createForm.idExists')
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
      toast.success(t('setupRoles.createForm.created', { name: role.name }));
      onCreated(role.id);
      onClose();
      await qc.invalidateQueries({ queryKey: ['roles'] });
    },
  });

  return (
    <Modal
      open
      onClose={onClose}
      title={t('setupRoles.createForm.title')}
      footer={
        <>
          <Button onClick={onClose}>{t('common.cancel')}</Button>
          <Button variant="primary" type="submit" form={formId} disabled={!canSave} loading={create.isPending}>
            {t('setupRoles.createForm.create')}
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
        <FormField label={t('setupRoles.roleName')} required htmlFor={ids.name}>
          <input id={ids.name} className="input" value={name} maxLength={80} placeholder={t('setupRoles.createForm.namePlaceholder')} onChange={(e) => setName(e.target.value)} />
        </FormField>
        <FormField label={t('setupRoles.createForm.roleId')} required htmlFor={ids.id} error={idError} help={t('setupRoles.createForm.roleIdHelp', { example: 'customer_success' })}>
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
        <FormField label={t('common.description')} htmlFor={ids.desc}>
          <input id={ids.desc} className="input" value={description} maxLength={500} onChange={(e) => setDescription(e.target.value)} />
        </FormField>
        <FormField label={t('setupRoles.createForm.startFrom')} htmlFor={ids.copy} help={t('setupRoles.createForm.startFromHelp')}>
          <select id={ids.copy} className="input" value={copyFrom} onChange={(e) => setCopyFrom(e.target.value)}>
            <option value="">{t('setupRoles.createForm.noAccess')}</option>
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
        title={t('setupRoles.title')}
        subtitle={t('setupRoles.subtitle')}
        actions={
          <Button variant="primary" icon={Plus} disabled={!roles.data} onClick={() => setCreating(true)}>
            {t('setupRoles.newRole')}
          </Button>
        }
      />
      {roles.isLoading || objects.isLoading ? (
        <Loading />
      ) : roles.error || objects.error ? (
        <ErrorBanner error={roles.error ?? objects.error} />
      ) : !current ? (
        <div className="card">
          <EmptyState icon={ShieldCheck} title={t('setupRoles.empty')} />
        </div>
      ) : (
        <div className="grid items-start gap-5 @4xl:grid-cols-[16rem_minmax(0,1fr)]">
          <nav aria-label={t('setupRoles.listLabel')} className="card overflow-hidden @4xl:sticky @4xl:top-4">
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
                        {r.permissions.setup && <Badge color="indigo">{t('setupRoles.admin')}</Badge>}
                      </span>
                      <span className="mt-0.5 block text-xs text-slate-500">{t('setupRoles.userCount', { count: n })}</span>
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
