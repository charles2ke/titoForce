import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { RoleDef, UserDTO } from '@titoforce/shared';
import { Bot, Pencil, Search, UserPlus, Users as UsersIcon } from 'lucide-react';
import { useId, useState } from 'react';
import { api } from '../../api.ts';
import { useToast } from '../../components/feedback.tsx';
import { Avatar, Badge, Button, EmptyState, ErrorBanner, FormField, IconButton, Loading, Modal, PageHeader, Toggle } from '../../components/ui.tsx';
import { t } from '../../i18n/index.ts';
import { formatDate, formatDateTime } from '../../lib/format.ts';
import { useAuth, useUsers } from '../../lib/hooks.ts';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function useRoles() {
  return useQuery({ queryKey: ['roles'], queryFn: () => api.get<RoleDef[]>('/api/roles') });
}

function RoleSelect({ id, value, onChange, roles, disabled }: { id: string; value: string; onChange: (v: string) => void; roles: RoleDef[]; disabled?: boolean }) {
  return (
    <select id={id} className="input" value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)}>
      {!value && <option value="">{t('setupUsers.form.chooseRole')}</option>}
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

  const emailError = isNew && email.trim() && !EMAIL_RE.test(email.trim()) ? t('setupUsers.form.invalidEmail') : null;
  const passwordError = password && password.length < 8 ? t('setupUsers.form.passwordTooShort') : null;
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
      if (saved) toast.success(isNew ? t('setupUsers.form.added', { name: saved.name }) : t('setupUsers.form.saved', { name: saved.name }));
      onClose();
      await qc.invalidateQueries({ queryKey: ['users'] });
      if (isSelf) await qc.invalidateQueries({ queryKey: ['session'] });
    },
  });

  return (
    <Modal
      open
      onClose={onClose}
      title={isNew ? t('setupUsers.form.newTitle') : t('setupUsers.editUser', { name: user?.name ?? '' })}
      footer={
        <>
          <Button onClick={onClose}>{t('common.cancel')}</Button>
          <Button variant="primary" type="submit" form={formId} disabled={!canSave} loading={save.isPending}>
            {isNew ? t('setupUsers.form.create') : t('setupUsers.form.save')}
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
            {t('setupUsers.form.agentNotice')}
          </p>
        )}
        {isNew ? (
          <FormField label={t('common.email')} required htmlFor={ids.email} error={emailError} help={t('setupUsers.form.emailHelp')}>
            <input id={ids.email} type="email" className="input" value={email} maxLength={254} autoComplete="off" onChange={(e) => setEmail(e.target.value)} />
          </FormField>
        ) : (
          <FormField label={t('common.email')}>
            <div className="input bg-slate-50 text-slate-600">{user?.email}</div>
          </FormField>
        )}
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField label={t('setupUsers.form.fullName')} required htmlFor={ids.name}>
            <input id={ids.name} className="input" value={name} maxLength={120} onChange={(e) => setName(e.target.value)} />
          </FormField>
          <FormField label={t('setupUsers.jobTitle')} htmlFor={ids.title}>
            <input id={ids.title} className="input" value={title} maxLength={120} placeholder={t('setupUsers.form.titlePlaceholder')} onChange={(e) => setTitle(e.target.value)} />
          </FormField>
        </div>
        <FormField label={t('common.role')} required htmlFor={ids.role} help={isSelf ? t('setupUsers.form.ownRoleHelp') : t('setupUsers.form.roleHelp')}>
          <RoleSelect id={ids.role} value={roleId} onChange={setRoleId} roles={roles} disabled={isSelf} />
        </FormField>
        {!user?.isAgent && (
          <FormField
            label={isNew ? t('common.password') : t('setupUsers.form.newPassword')}
            required={isNew}
            htmlFor={ids.password}
            error={passwordError}
            help={isNew ? t('setupUsers.form.passwordHelp') : isSelf ? t('setupUsers.form.ownPasswordHelp') : t('setupUsers.form.userPasswordHelp')}
          >
            <input id={ids.password} type="password" className="input" value={password} maxLength={200} autoComplete="new-password" onChange={(e) => setPassword(e.target.value)} />
          </FormField>
        )}
        {!isNew && (
          <div>
            <Toggle checked={active} onChange={setActive} label={t('common.active')} disabled={isSelf} />
            <p className="mt-1 text-xs text-slate-400">{isSelf ? t('setupUsers.form.cantDeactivateSelf') : t('setupUsers.form.inactiveHelp')}</p>
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
        title={t('setupUsers.title')}
        subtitle={t('setupUsers.subtitle')}
        actions={
          <Button variant="primary" icon={UserPlus} disabled={!roles.data} onClick={() => setEditing('new')}>
            {t('setupUsers.newUser')}
          </Button>
        }
      />
      <ErrorBanner error={roles.error} className="mb-4" />
      <div className="card overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 p-3">
          <div className="relative w-full max-w-sm">
            <Search className="pointer-events-none absolute top-2.5 left-2.5 size-4 text-slate-400" aria-hidden />
            <input type="search" aria-label={t('setupUsers.searchLabel')} placeholder={t('setupUsers.searchPlaceholder')} className="input pl-8" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <Toggle checked={showInactive} onChange={setShowInactive} label={t('setupUsers.showInactive', { count: inactiveCount })} />
        </div>
        {users.isLoading ? (
          <Loading />
        ) : users.error ? (
          <div className="p-4">
            <ErrorBanner error={users.error} />
          </div>
        ) : list.length === 0 ? (
          <EmptyState icon={UsersIcon} title={term ? t('setupUsers.noMatches') : t('setupUsers.empty')} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50/70 text-left text-xs font-semibold text-slate-500 uppercase">
                <tr>
                  <th className="px-4 py-2.5">{t('common.name')}</th>
                  <th className="px-4 py-2.5">{t('common.email')}</th>
                  <th className="px-4 py-2.5">{t('setupUsers.jobTitle')}</th>
                  <th className="px-4 py-2.5">{t('common.role')}</th>
                  <th className="px-4 py-2.5">{t('common.status')}</th>
                  <th className="px-4 py-2.5">{t('common.created')}</th>
                  <th className="px-4 py-2.5">
                    <span className="sr-only">{t('common.actions')}</span>
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
                        {u.id === me.id && <Badge color="indigo">{t('setupUsers.you')}</Badge>}
                        {u.isAgent && (
                          <Badge color="purple">
                            <Bot className="mr-1 inline size-3" aria-hidden />
                            {t('setupUsers.aiAgent')}
                          </Badge>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-2.5 text-slate-600">{u.email}</td>
                    <td className="px-4 py-2.5 text-slate-600">{u.title ?? ''}</td>
                    <td className="px-4 py-2.5 text-slate-700">{u.roleName}</td>
                    <td className="px-4 py-2.5">{u.active ? <Badge color="green">{t('common.active')}</Badge> : <Badge color="gray">{t('common.inactive')}</Badge>}</td>
                    <td className="px-4 py-2.5 whitespace-nowrap text-slate-500" title={formatDateTime(u.createdAt)}>
                      {formatDate(u.createdAt)}
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      <IconButton icon={Pencil} label={t('setupUsers.editUser', { name: u.name })} disabled={!roles.data} onClick={() => setEditing(u)} />
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
