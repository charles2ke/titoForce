import { useMutation } from '@tanstack/react-query';
import type { AccessLevel } from '@titoforce/shared';
import { Bot, Check, KeyRound, LayoutGrid, ShieldCheck, UserRound } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { Link } from 'react-router';
import { api } from '../api.ts';
import { useToast } from '../components/feedback.tsx';
import { CalendarFeedCard, ConnectedAccountsCard, OAuthReturnNotice, PhoneCard } from '../components/settings/IntegrationSettings.tsx';
import { Avatar, Badge, Button, Card, cx, ErrorBanner, FormField, KeyValue, Loading, ObjectTile } from '../components/ui.tsx';
import { objectPerm, useAiStatus, useApps, useAuth, useCurrentApp, useObjects, usePermissions } from '../lib/hooks.ts';

const LEVEL: Record<AccessLevel, { label: string; color: string }> = {
  all: { label: 'All', color: 'green' },
  own: { label: 'Own', color: 'blue' },
  none: { label: '—', color: 'gray' },
};

function Level({ level }: { level: AccessLevel }) {
  const l = LEVEL[level];
  return level === 'none' ? <span className="text-slate-300">—</span> : <Badge color={l.color}>{l.label}</Badge>;
}

function PasswordCard() {
  const toast = useToast();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const mismatch = confirm.length > 0 && next !== confirm;
  const change = useMutation({
    mutationFn: () => api.post('/api/auth/password', { current, next }),
    onSuccess: () => {
      setCurrent('');
      setNext('');
      setConfirm('');
      toast.success('Password changed. Your other sessions were signed out.');
    },
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (next.length < 8 || next !== confirm) return;
    change.mutate();
  };
  return (
    <Card
      title={
        <span className="flex items-center gap-2">
          <KeyRound className="size-4 text-slate-400" aria-hidden />
          Change password
        </span>
      }
    >
      <form onSubmit={submit} className="max-w-sm space-y-3" aria-label="Change password">
        <ErrorBanner error={change.error} />
        <FormField label="Current password" htmlFor="pw-current" required>
          <input id="pw-current" className="input" type="password" autoComplete="current-password" required value={current} onChange={(e) => setCurrent(e.target.value)} />
        </FormField>
        <FormField label="New password" htmlFor="pw-next" required help="At least 8 characters.">
          <input id="pw-next" className="input" type="password" autoComplete="new-password" required minLength={8} value={next} onChange={(e) => setNext(e.target.value)} />
        </FormField>
        <FormField label="Confirm new password" htmlFor="pw-confirm" required error={mismatch ? 'Passwords do not match' : null}>
          <input id="pw-confirm" className="input" type="password" autoComplete="new-password" required value={confirm} onChange={(e) => setConfirm(e.target.value)} aria-invalid={mismatch || undefined} />
        </FormField>
        <Button type="submit" variant="primary" loading={change.isPending} disabled={!current || next.length < 8 || next !== confirm}>
          Update password
        </Button>
      </form>
    </Card>
  );
}

function DefaultAppCard() {
  const apps = useApps();
  const { appId, setAppId } = useCurrentApp();
  const toast = useToast();
  const current = appId && apps.data?.some((a) => a.id === appId) ? appId : apps.data?.[0]?.id;
  return (
    <Card
      title={
        <span className="flex items-center gap-2">
          <LayoutGrid className="size-4 text-slate-400" aria-hidden />
          Default app
        </span>
      }
    >
      {apps.isLoading ? (
        <Loading />
      ) : (
        <div className="space-y-2" role="radiogroup" aria-label="Default app">
          <p className="text-xs text-slate-500">Where you land after signing in. Switching apps from the app launcher also updates this (saved in this browser).</p>
          {apps.data?.map((a) => (
            <button
              key={a.id}
              type="button"
              role="radio"
              aria-checked={current === a.id}
              onClick={() => {
                setAppId(a.id);
                toast.success(`${a.name} is now your default app`);
              }}
              className={cx('flex w-full items-center gap-3 rounded-lg border px-3 py-2 text-left', current === a.id ? 'border-indigo-300 bg-indigo-50/60' : 'border-slate-200 hover:bg-slate-50')}
            >
              <ObjectTile icon={a.icon} color={a.color} size="sm" />
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium text-slate-900">{a.name}</span>
                <span className="block truncate text-xs text-slate-500">{a.description}</span>
              </span>
              {current === a.id && <Check className="size-4 text-indigo-600" aria-hidden />}
            </button>
          ))}
        </div>
      )}
    </Card>
  );
}

function AiCard() {
  const ai = useAiStatus();
  return (
    <Card
      title={
        <span className="flex items-center gap-2">
          <Bot className="size-4 text-slate-400" aria-hidden />
          AI provider
        </span>
      }
    >
      {ai.isLoading ? (
        <Loading />
      ) : ai.error ? (
        <ErrorBanner error={ai.error} />
      ) : ai.data ? (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <Badge color={ai.data.configured ? 'green' : 'yellow'}>{ai.data.configured ? 'Connected' : 'Offline mode'}</Badge>
            <span className="text-sm font-medium text-slate-800">
              {ai.data.provider === 'openai' ? 'OpenAI-compatible' : ai.data.provider === 'anthropic' ? 'Anthropic' : 'Built-in rules engine'}
            </span>
            {ai.data.model && <code className="rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-600">{ai.data.model}</code>}
          </div>
          <p className="text-sm text-slate-600">{ai.data.note}</p>
          <p className="text-xs text-slate-400">The provider is configured by an administrator through server environment variables.</p>
        </div>
      ) : null}
    </Card>
  );
}

function AccessCard() {
  const { permissions } = useAuth();
  const objects = useObjects();
  const caps = [
    { on: permissions.setup, label: 'Administer setup' },
    { on: permissions.manageAutomations, label: 'Manage automations, reports & dashboards' },
    { on: permissions.manageAgents, label: 'Manage AI agents' },
    { on: permissions.viewSensitive, label: 'View sensitive fields' },
  ];
  const rows = (objects.data ?? []).map((o) => ({ def: o, perm: objectPerm(permissions, o.apiName) })).filter((r) => r.perm.read !== 'none');
  return (
    <Card
      title={
        <span className="flex items-center gap-2">
          <ShieldCheck className="size-4 text-slate-400" aria-hidden />
          Your access
        </span>
      }
      bodyClassName="p-0"
    >
      <ul className="flex flex-wrap gap-2 px-4 pt-4 pb-3">
        {caps.map((c) => (
          <li key={c.label}>
            <Badge color={c.on ? 'green' : 'gray'}>
              {c.on ? <Check className="size-3" aria-hidden /> : null}
              <span className={c.on ? undefined : 'line-through decoration-slate-300'}>{c.label}</span>
            </Badge>
          </li>
        ))}
      </ul>
      {objects.isLoading ? (
        <Loading />
      ) : (
        <div className="max-h-96 overflow-y-auto border-t border-slate-100">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-white">
              <tr className="border-b border-slate-200 text-left text-xs text-slate-500">
                <th className="px-4 py-2 font-medium">Object</th>
                <th className="px-2 py-2 text-center font-medium">Read</th>
                <th className="px-2 py-2 text-center font-medium">Create</th>
                <th className="px-2 py-2 text-center font-medium">Edit</th>
                <th className="px-4 py-2 text-center font-medium">Delete</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map(({ def, perm }) => (
                <tr key={def.apiName}>
                  <td className="px-4 py-1.5">
                    <span className="flex items-center gap-2">
                      <ObjectTile icon={def.icon} color={def.color} size="sm" soft />
                      {def.pluralLabel}
                    </span>
                  </td>
                  <td className="px-2 py-1.5 text-center">
                    <Level level={perm.read} />
                  </td>
                  <td className="px-2 py-1.5 text-center">{perm.create ? <Check className="mx-auto size-4 text-emerald-600" aria-label="Yes" /> : <span className="text-slate-300">—</span>}</td>
                  <td className="px-2 py-1.5 text-center">
                    <Level level={perm.edit} />
                  </td>
                  <td className="px-4 py-1.5 text-center">
                    <Level level={perm.delete} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="border-t border-slate-100 px-4 py-2 text-xs text-slate-400">“Own” means records you own. Objects you cannot read are hidden.</p>
    </Card>
  );
}

export default function Settings() {
  const { user } = useAuth();
  const { isAdmin } = usePermissions();
  return (
    <div className="mx-auto max-w-5xl space-y-5 p-6">
      <h1 className="text-xl font-semibold text-slate-900">My settings</h1>
      <OAuthReturnNotice />
      <Card
        title={
          <span className="flex items-center gap-2">
            <UserRound className="size-4 text-slate-400" aria-hidden />
            Profile
          </span>
        }
      >
        <div className="flex flex-wrap items-start gap-5">
          <Avatar name={user.name} color={user.avatarColor} />
          <dl className="grid min-w-0 flex-1 grid-cols-1 gap-x-8 gap-y-3 @xl:grid-cols-2">
            <KeyValue label="Name">{user.name}</KeyValue>
            <KeyValue label="Email">{user.email}</KeyValue>
            <KeyValue label="Title">{user.title ?? '—'}</KeyValue>
            <KeyValue label="Role">{user.roleName}</KeyValue>
          </dl>
        </div>
        <p className="mt-4 text-xs text-slate-500">
          {isAdmin ? (
            <>
              Edit names, titles and roles in{' '}
              <Link to="/setup/users" className="text-indigo-600 hover:underline">
                Setup › Users
              </Link>
              .
            </>
          ) : (
            'Ask an administrator to change your name, title or role.'
          )}
        </p>
      </Card>
      <ConnectedAccountsCard />
      <div className="grid gap-5 @3xl:grid-cols-2">
        <PhoneCard />
        <CalendarFeedCard />
      </div>
      <div className="grid gap-5 @3xl:grid-cols-2">
        <PasswordCard />
        <div className="space-y-5">
          <DefaultAppCard />
          <AiCard />
        </div>
      </div>
      <AccessCard />
    </div>
  );
}
