import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { RoleDef, UserDTO } from '@titoforce/shared';
import { Bot, Pencil, RotateCcw, Search, ShieldCheck, ShieldOff, UserPlus, Users as UsersIcon } from 'lucide-react';
import { useId, useRef, useState } from 'react';
import { api } from '../../api.ts';
import { useConfirm, useToast } from '../../components/feedback.tsx';
import { Avatar, Badge, Button, EmptyState, ErrorBanner, FormField, IconButton, Loading, Modal, PageHeader, Toggle } from '../../components/ui.tsx';
import { formatDate, formatDateTime } from '../../lib/format.ts';
import { useAuth, useUsers } from '../../lib/hooks.ts';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function useRoles() {
  return useQuery({ queryKey: ['roles'], queryFn: () => api.get<RoleDef[]>('/api/roles') });
}

function RoleSelect({ id, value, onChange, roles, disabled }: { id: string; value: string; onChange: (v: string) => void; roles: RoleDef[]; disabled?: boolean }) {
  return (
    <select id={id} className="input" value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)}>
      {!value && <option value="">Choose a role…</option>}
      {value && !roles.some((r) => r.id === value) && <option value={value}>{value}</option>}
      {roles.map((r) => (
        <option key={r.id} value={r.id}>
          {r.name}
        </option>
      ))}
    </select>
  );
}

function UserForm({ user, roles, onClose }: { user: UserDTO | null; roles: RoleDef[]; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const confirm = useConfirm();
  const { user: me } = useAuth();
  const isNew = !user;
  const isSelf = user?.id === me.id;
  const formId = useId();
  const ids = { email: useId(), name: useId(), title: useId(), role: useId(), password: useId() };
  const defaultRole = roles.find((r) => !r.permissions.setup && r.id !== 'ai_agent')?.id ?? roles[0]?.id ?? '';
  const [email, setEmail] = useState('');
  const [name, setName] = useState(user?.name ?? '');
  const [title, setTitle] = useState(user?.title ?? '');
  const [roleId, setRoleId] = useState(user?.roleId ?? defaultRole);
  const [active, setActive] = useState(user?.active ?? true);
  const [password, setPassword] = useState('');
  const [mfa, setMfa] = useState<'on' | 'off' | 'reset'>(user?.mfaEnabled ? 'on' : 'off');
  const mfaBox = useRef<HTMLDivElement>(null);

  const emailError = isNew && email.trim() && !EMAIL_RE.test(email.trim()) ? 'Enter a valid email address.' : null;
  const passwordError = password && password.length < 8 ? 'At least 8 characters.' : null;
  const canSave = !!name.trim() && !!roleId && !passwordError && (isNew ? !!email.trim() && !emailError && password.length >= 8 : true);

  const save = useMutation({
    mutationFn: async () => {
      if (isNew) {
        return api.post<UserDTO>('/api/users', { email: email.trim(), name: name.trim(), title: title.trim() || undefined, roleId, password });
      }
      const u = user!;
      const patch: Record<string, unknown> = {};
      if (name.trim() !== u.name) patch.name = name.trim();
      if (title.trim() !== (u.title ?? '')) patch.title = title.trim() || null;
      if (roleId !== u.roleId) patch.roleId = roleId;
      if (active !== u.active) patch.active = active;
      if (password) patch.password = password;
      if (!Object.keys(patch).length) return null;
      return api.patch<UserDTO>(`/api/users/${u.id}`, patch);
    },
    onSuccess: async (saved) => {
      if (saved) toast.success(isNew ? `${saved.name} added` : `${saved.name} saved`);
      onClose();
      await qc.invalidateQueries({ queryKey: ['users'] });
      if (isSelf) await qc.invalidateQueries({ queryKey: ['session'] });
    },
  });

  const resetMfa = useMutation({
    mutationFn: () => api.del<{ ok: true }>(`/api/users/${user!.id}/mfa`),
    onSuccess: () => {
      setMfa('reset');
      toast.success('Two-factor authentication reset');
    },
    onSettled: () => {
      // Focus can't go back to the reset button (busy, then gone); keep it inside the dialog.
      mfaBox.current?.focus();
      return qc.invalidateQueries({ queryKey: ['users'] });
    },
  });

  return (
    <Modal
      open
      onClose={onClose}
      title={isNew ? 'New user' : `Edit ${user?.name}`}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" type="submit" form={formId} disabled={!canSave} loading={save.isPending}>
            {isNew ? 'Create user' : 'Save user'}
          </Button>
        </>
      }
    >
      <form
        id={formId}
        className="space-y-4"
        autoComplete="off"
        onSubmit={(e) => {
          e.preventDefault();
          if (canSave) save.mutate();
        }}
      >
        <ErrorBanner error={save.error} />
        {user?.isAgent && (
          <p className="flex items-start gap-2 rounded-lg bg-indigo-50 px-3 py-2 text-xs text-indigo-800">
            <Bot className="mt-0.5 size-3.5 shrink-0" aria-hidden />
            This is the service user of the AI agents. Agents started by automations act as this user, so its role limits what they can do. It can’t sign in.
          </p>
        )}
        {isNew ? (
          <FormField label="Email" required htmlFor={ids.email} error={emailError} help="Used to sign in.">
            <input id={ids.email} type="email" className="input" value={email} maxLength={254} autoComplete="off" onChange={(e) => setEmail(e.target.value)} />
          </FormField>
        ) : (
          <FormField label="Email">
            <div className="input bg-slate-50 text-slate-600">{user?.email}</div>
          </FormField>
        )}
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField label="Full name" required htmlFor={ids.name}>
            <input id={ids.name} className="input" value={name} maxLength={120} onChange={(e) => setName(e.target.value)} />
          </FormField>
          <FormField label="Title" htmlFor={ids.title}>
            <input id={ids.title} className="input" value={title} maxLength={120} placeholder="Account Executive" onChange={(e) => setTitle(e.target.value)} />
          </FormField>
        </div>
        <FormField label="Role" required htmlFor={ids.role} help={isSelf ? 'You can’t change your own role.' : 'Controls what the user can see and do.'}>
          <RoleSelect id={ids.role} value={roleId} onChange={setRoleId} roles={roles} disabled={isSelf} />
        </FormField>
        {!user?.isAgent && (
          <FormField
            label={isNew ? 'Password' : 'New password'}
            required={isNew}
            htmlFor={ids.password}
            error={passwordError}
            help={isNew ? 'At least 8 characters. Share it with the user securely.' : isSelf ? 'Leave empty to keep the current password. Changing it signs you out everywhere.' : 'Leave empty to keep the current password. Changing it signs the user out.'}
          >
            <input id={ids.password} type="password" className="input" value={password} maxLength={200} autoComplete="new-password" onChange={(e) => setPassword(e.target.value)} />
          </FormField>
        )}
        {!isNew && (
          <div>
            <Toggle checked={active} onChange={setActive} label="Active" disabled={isSelf} />
            <p className="mt-1 text-xs text-slate-400">{isSelf ? 'You can’t deactivate yourself.' : 'Inactive users can’t sign in. Their records are kept.'}</p>
          </div>
        )}
        {user && mfa !== 'off' && (
          <div ref={mfaBox} tabIndex={-1} className="rounded-lg border border-slate-200 p-3 outline-none">
            {mfa === 'on' ? (
              <>
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="flex items-center gap-1.5 text-sm font-medium text-slate-800">
                      <ShieldCheck className="size-4 shrink-0 text-emerald-600" aria-hidden />
                      Two-factor authentication is on
                    </p>
                    <p className="mt-0.5 text-xs text-slate-500">Reset it if they lost their authenticator app.</p>
                  </div>
                  <Button
                    size="sm"
                    icon={RotateCcw}
                    aria-label="Reset two-factor authentication"
                    loading={resetMfa.isPending}
                    onClick={async () => {
                      const ok = await confirm({
                        title: `Reset two-factor authentication for ${user.name}?`,
                        message: `${user.name} will need to set up two-factor authentication again (if their role requires it) at their next sign-in. Use this when they lost their authenticator.`,
                        confirmLabel: 'Reset',
                        danger: true,
                      });
                      if (ok) resetMfa.mutate();
                    }}
                  >
                    Reset
                  </Button>
                </div>
                <ErrorBanner error={resetMfa.error} className="mt-2" />
              </>
            ) : (
              <p className="flex items-start gap-1.5 text-sm text-slate-600">
                <ShieldOff className="mt-0.5 size-4 shrink-0 text-slate-400" aria-hidden />
                Two-factor authentication was reset. If their role requires it, they’ll set it up again at their next sign-in.
              </p>
            )}
          </div>
        )}
      </form>
    </Modal>
  );
}

export default function Users() {
  const users = useUsers();
  const roles = useRoles();
  const { user: me } = useAuth();
  const [q, setQ] = useState('');
  const [showInactive, setShowInactive] = useState(false);
  const [editing, setEditing] = useState<UserDTO | 'new' | null>(null);

  const term = q.trim().toLowerCase();
  const all = users.data ?? [];
  const inactiveCount = all.filter((u) => !u.active).length;
  const list = all.filter((u) => (showInactive || u.active) && (!term || [u.name, u.email, u.title ?? '', u.roleName].some((s) => s.toLowerCase().includes(term))));

  return (
    <div className="mx-auto max-w-6xl p-6">
      <PageHeader
        title="Users"
        subtitle="People who can sign in, their roles and access."
        actions={
          <Button variant="primary" icon={UserPlus} disabled={!roles.data} onClick={() => setEditing('new')}>
            New user
          </Button>
        }
      />
      <ErrorBanner error={roles.error} className="mb-4" />
      <div className="card overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 p-3">
          <div className="relative w-full max-w-sm">
            <Search className="pointer-events-none absolute top-2.5 left-2.5 size-4 text-slate-400" aria-hidden />
            <input type="search" aria-label="Search users" placeholder="Search by name, email, title or role…" className="input pl-8" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <Toggle checked={showInactive} onChange={setShowInactive} label={`Show inactive (${inactiveCount})`} />
        </div>
        {users.isLoading ? (
          <Loading />
        ) : users.error ? (
          <div className="p-4">
            <ErrorBanner error={users.error} />
          </div>
        ) : list.length === 0 ? (
          <EmptyState icon={UsersIcon} title={term ? 'No users match your search' : 'No users'} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50/70 text-left text-xs font-semibold text-slate-500 uppercase">
                <tr>
                  <th className="px-4 py-2.5">Name</th>
                  <th className="px-4 py-2.5">Email</th>
                  <th className="px-4 py-2.5">Title</th>
                  <th className="px-4 py-2.5">Role</th>
                  <th className="px-4 py-2.5">Status</th>
                  <th className="px-4 py-2.5">Created</th>
                  <th className="px-4 py-2.5">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {list.map((u) => (
                  <tr key={u.id} className={u.active ? 'hover:bg-slate-50/70' : 'bg-slate-50/50 text-slate-400'}>
                    <td className="px-4 py-2.5">
                      <div className="flex items-center gap-2.5">
                        <Avatar name={u.name} color={u.avatarColor} size="sm" />
                        <button type="button" className="font-medium text-slate-900 hover:text-indigo-700" onClick={() => setEditing(u)}>
                          {u.name}
                        </button>
                        {u.id === me.id && <Badge color="indigo">You</Badge>}
                        {u.isAgent && (
                          <Badge color="purple">
                            <Bot className="mr-1 inline size-3" aria-hidden />
                            AI agent
                          </Badge>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-2.5 text-slate-600">{u.email}</td>
                    <td className="px-4 py-2.5 text-slate-600">{u.title ?? ''}</td>
                    <td className="px-4 py-2.5 text-slate-700">{u.roleName}</td>
                    <td className="px-4 py-2.5">
                      <div className="flex flex-wrap items-center gap-1.5">
                        {u.active ? <Badge color="green">Active</Badge> : <Badge color="gray">Inactive</Badge>}
                        {u.mfaEnabled && (
                          <span title="Two-factor authentication is on">
                            <Badge color="teal">
                              <ShieldCheck className="size-3" aria-hidden />
                              2FA
                            </Badge>
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-2.5 whitespace-nowrap text-slate-500" title={formatDateTime(u.createdAt)}>
                      {formatDate(u.createdAt)}
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      <IconButton icon={Pencil} label={`Edit ${u.name}`} disabled={!roles.data} onClick={() => setEditing(u)} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      {editing && roles.data && <UserForm key={editing === 'new' ? '__new' : editing.id} user={editing === 'new' ? null : editing} roles={roles.data} onClose={() => setEditing(null)} />}
    </div>
  );
}
