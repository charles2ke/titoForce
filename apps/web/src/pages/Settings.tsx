import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { AccessLevel, SessionInfo } from '@titoforce/shared';
import { Bot, Check, KeyRound, Languages, LayoutGrid, ShieldCheck, UserRound } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { Link } from 'react-router';
import { api } from '../api.ts';
import { useToast } from '../components/feedback.tsx';
import { Avatar, Badge, Button, Card, cx, ErrorBanner, FormField, KeyValue, Loading, ObjectTile } from '../components/ui.tsx';
import { browserLocale, forgetStoredLocale, isLocale, type Locale, LOCALES, type MessageKey, setLocale, t, tx } from '../i18n/index.ts';
import { objectPerm, useAiStatus, useApps, useAuth, useCurrentApp, useObjects, usePermissions } from '../lib/hooks.ts';

const LEVEL: Record<Exclude<AccessLevel, 'none'>, { label: MessageKey; color: string }> = {
  all: { label: 'settings.access.all', color: 'green' },
  own: { label: 'settings.access.own', color: 'blue' },
};

function Level({ level }: { level: AccessLevel }) {
  if (level === 'none') return <span className="text-slate-300">—</span>;
  const l = LEVEL[level];
  return <Badge color={l.color}>{t(l.label)}</Badge>;
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
      toast.success(t('settings.password.changed'));
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
          {t('settings.password.title')}
        </span>
      }
    >
      <form onSubmit={submit} className="max-w-sm space-y-3" aria-label={t('settings.password.title')}>
        <ErrorBanner error={change.error} />
        <FormField label={t('settings.password.current')} htmlFor="pw-current" required>
          <input id="pw-current" className="input" type="password" autoComplete="current-password" required value={current} onChange={(e) => setCurrent(e.target.value)} />
        </FormField>
        <FormField label={t('settings.password.new')} htmlFor="pw-next" required help={t('settings.password.help')}>
          <input id="pw-next" className="input" type="password" autoComplete="new-password" required minLength={8} value={next} onChange={(e) => setNext(e.target.value)} />
        </FormField>
        <FormField label={t('settings.password.confirm')} htmlFor="pw-confirm" required error={mismatch ? t('settings.password.mismatch') : null}>
          <input id="pw-confirm" className="input" type="password" autoComplete="new-password" required value={confirm} onChange={(e) => setConfirm(e.target.value)} aria-invalid={mismatch || undefined} />
        </FormField>
        <Button type="submit" variant="primary" loading={change.isPending} disabled={!current || next.length < 8 || next !== confirm}>
          {t('settings.password.submit')}
        </Button>
      </form>
    </Card>
  );
}

/** The user's language, saved on their account so it follows them to other devices (empty: each browser's own). */
function LanguageCard() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const browser = browserLocale() ?? 'en';
  const save = useMutation({
    mutationFn: (locale: Locale | null) => api.put<{ locale: Locale | null }>('/api/auth/locale', { locale }),
    onSuccess: async (_res, locale) => {
      qc.setQueryData<SessionInfo>(['session'], (s) => (s ? { ...s, user: { ...s.user, locale } } : s));
      if (locale) await setLocale(locale);
      else {
        forgetStoredLocale();
        await setLocale(browser, { persist: false });
      }
    },
  });
  const value = save.isPending ? (save.variables ?? '') : (user.locale ?? '');
  return (
    <Card
      title={
        <span className="flex items-center gap-2">
          <Languages className="size-4 text-slate-400" aria-hidden />
          {t('settings.language.title')}
        </span>
      }
    >
      <div className="space-y-2">
        <ErrorBanner error={save.error} />
        <select
          id="settings-language"
          aria-label={t('settings.language.title')}
          className="input"
          value={value}
          disabled={save.isPending}
          onChange={(e) => save.mutate(isLocale(e.target.value) ? e.target.value : null)}
        >
          <option value="">{t('settings.language.browserDefault', { language: LOCALES.find((l) => l.code === browser)!.name })}</option>
          {LOCALES.map((l) => (
            <option key={l.code} value={l.code} lang={l.code}>
              {l.name}
            </option>
          ))}
        </select>
        <p className="text-xs text-slate-500">{t('settings.language.help')}</p>
      </div>
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
          {t('settings.defaultApp.title')}
        </span>
      }
    >
      {apps.isLoading ? (
        <Loading />
      ) : (
        <div className="space-y-2" role="radiogroup" aria-label={t('settings.defaultApp.title')}>
          <p className="text-xs text-slate-500">{t('settings.defaultApp.help')}</p>
          {apps.data?.map((a) => (
            <button
              key={a.id}
              type="button"
              role="radio"
              aria-checked={current === a.id}
              onClick={() => {
                setAppId(a.id);
                toast.success(t('settings.defaultApp.changed', { app: a.name }));
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
          {t('settings.ai.title')}
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
            <Badge color={ai.data.configured ? 'green' : 'yellow'}>{ai.data.configured ? t('settings.ai.connected') : t('settings.ai.offline')}</Badge>
            <span className="text-sm font-medium text-slate-800">
              {ai.data.provider === 'openai' ? t('settings.ai.openai') : ai.data.provider === 'anthropic' ? 'Anthropic' : t('settings.ai.rulesEngine')}
            </span>
            {ai.data.model && <code className="rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-600">{ai.data.model}</code>}
          </div>
          <p className="text-sm text-slate-600">{ai.data.note}</p>
          <p className="text-xs text-slate-400">{t('settings.ai.configuredBy')}</p>
        </div>
      ) : null}
    </Card>
  );
}

function AccessCard() {
  const { permissions } = useAuth();
  const objects = useObjects();
  const caps = [
    { on: permissions.setup, label: t('settings.access.capabilities.setup') },
    { on: permissions.manageAutomations, label: t('settings.access.capabilities.manageAutomations') },
    { on: permissions.manageAgents, label: t('settings.access.capabilities.manageAgents') },
    { on: permissions.viewSensitive, label: t('settings.access.capabilities.viewSensitive') },
  ];
  const rows = (objects.data ?? []).map((o) => ({ def: o, perm: objectPerm(permissions, o.apiName) })).filter((r) => r.perm.read !== 'none');
  return (
    <Card
      title={
        <span className="flex items-center gap-2">
          <ShieldCheck className="size-4 text-slate-400" aria-hidden />
          {t('settings.access.title')}
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
                <th className="px-4 py-2 font-medium">{t('common.object')}</th>
                <th className="px-2 py-2 text-center font-medium">{t('settings.access.read')}</th>
                <th className="px-2 py-2 text-center font-medium">{t('settings.access.create')}</th>
                <th className="px-2 py-2 text-center font-medium">{t('settings.access.edit')}</th>
                <th className="px-4 py-2 text-center font-medium">{t('settings.access.delete')}</th>
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
                  <td className="px-2 py-1.5 text-center">{perm.create ? <Check className="mx-auto size-4 text-emerald-600" aria-label={t('common.yes')} /> : <span className="text-slate-300">—</span>}</td>
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
      <p className="border-t border-slate-100 px-4 py-2 text-xs text-slate-400">{t('settings.access.footnote', { own: t('settings.access.own') })}</p>
    </Card>
  );
}

export default function Settings() {
  const { user } = useAuth();
  const { isAdmin } = usePermissions();
  return (
    <div className="mx-auto max-w-5xl space-y-5 p-6">
      <h1 className="text-xl font-semibold text-slate-900">{t('settings.title')}</h1>
      <Card
        title={
          <span className="flex items-center gap-2">
            <UserRound className="size-4 text-slate-400" aria-hidden />
            {t('settings.profile.title')}
          </span>
        }
      >
        <div className="flex flex-wrap items-start gap-5">
          <Avatar name={user.name} color={user.avatarColor} />
          <dl className="grid min-w-0 flex-1 grid-cols-1 gap-x-8 gap-y-3 @xl:grid-cols-2">
            <KeyValue label={t('common.name')}>{user.name}</KeyValue>
            <KeyValue label={t('common.email')}>{user.email}</KeyValue>
            <KeyValue label={t('settings.profile.jobTitle')}>{user.title ?? '—'}</KeyValue>
            <KeyValue label={t('common.role')}>{user.roleName}</KeyValue>
          </dl>
        </div>
        <p className="mt-4 text-xs text-slate-500">
          {isAdmin
            ? tx('settings.profile.adminHint', {
                link: (
                  <Link to="/setup/users" className="text-indigo-600 hover:underline">
                    {t('settings.profile.usersLink')}
                  </Link>
                ),
              })
            : t('settings.profile.askAdmin')}
        </p>
      </Card>
      <div className="grid grid-cols-1 gap-5 @3xl:grid-cols-2">
        <PasswordCard />
        <div className="space-y-5">
          <LanguageCard />
          <DefaultAppCard />
          <AiCard />
        </div>
      </div>
      <AccessCard />
    </div>
  );
}
