import { useMutation } from '@tanstack/react-query';
import { type FormEvent, useEffect, useState } from 'react';
import { Link, Navigate, useSearchParams } from 'react-router';
import { ApiError, api, currentOrganization, isNativeApp, normalizeServerUrl, serverUrl, setServerUrl } from '../api.ts';
import { AuthLayout } from '../components/AuthLayout.tsx';
import { Avatar, Badge, Button, ErrorBanner, FormField, Spinner } from '../components/ui.tsx';
import { t, tx } from '../i18n/index.ts';
import { useDebounced, useSession } from '../lib/hooks.ts';
import { type SignInResult, useCompleteSignIn, usePublicConfig } from '../lib/session.ts';

/** Only same-origin, in-app paths are allowed as post-login redirects. */
export function safeNext(next: string | null): string {
  return next && next.startsWith('/') && !next.startsWith('//') && !next.startsWith('/login') && !next.startsWith('/signup') ? next : '/';
}

const normalizeSlug = (s: string) => s.trim().toLowerCase();

/** First step of the mobile app: which titoForce server to use. */
function ConnectServer({ onConnected }: { onConnected: (url: string) => void }) {
  const [input, setInput] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const url = normalizeServerUrl(input);
    if (!url) {
      setError(t('orgs.native.invalid'));
      return;
    }
    setBusy(true);
    setError(null);
    setServerUrl(url);
    try {
      await api.get('/api/config', { org: null });
      onConnected(url);
    } catch {
      setServerUrl(null);
      setError(t('orgs.native.unreachable', { url }));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <h2 className="text-2xl font-semibold tracking-tight text-slate-900">{t('orgs.native.title')}</h2>
      <p className="mt-1 text-sm text-slate-500">{t('orgs.native.subtitle')}</p>
      <form className="mt-6 space-y-4" onSubmit={(e) => void submit(e)}>
        <FormField label={t('orgs.native.server')} htmlFor="login-server" error={error}>
          <input
            id="login-server"
            type="url"
            inputMode="url"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            required
            className="input"
            placeholder={t('orgs.native.serverPlaceholder')}
            value={input}
            onChange={(e) => setInput(e.target.value)}
          />
        </FormField>
        <Button type="submit" variant="primary" className="w-full" loading={busy}>
          {t('orgs.native.connect')}
        </Button>
      </form>
    </>
  );
}

function SignInForm({ next }: { next: string }) {
  const complete = useCompleteSignIn();
  const native = isNativeApp();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [orgInput, setOrgInput] = useState(() => currentOrganization() ?? '');
  const org = useDebounced(normalizeSlug(orgInput), 400);
  const config = usePublicConfig(org || null);
  const cfg = config.data;
  const orgError = config.error instanceof ApiError && config.error.code.startsWith('organization_') ? config.error : null;
  // Once shown (several organizations, or an unknown one was asked for), the field stays while the ID is retyped.
  const [showOrg, setShowOrg] = useState(false);
  useEffect(() => {
    if ((cfg?.multiOrg && !cfg.baseDomain) || orgError) setShowOrg(true);
  }, [cfg?.multiOrg, cfg?.baseDomain, orgError]);
  const typing = normalizeSlug(orgInput) !== org;

  const login = useMutation({
    mutationFn: (creds: { email: string; password: string }) =>
      api.post<SignInResult>('/api/auth/login', { ...creds, ...(native ? { issueToken: true } : {}) }, { org: normalizeSlug(orgInput) || null }),
    onSuccess: (s) => complete(s, next),
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    login.mutate({ email, password });
  };
  const ready = !!cfg && !orgError && !typing;

  return (
    <>
      <h2 className="text-2xl font-semibold tracking-tight text-slate-900">{t('login.title')}</h2>
      {ready && cfg.multiOrg ? (
        <p className="mt-1 flex flex-wrap items-center gap-2 text-sm text-slate-500">
          {t('orgs.signIn.to', { name: cfg.organization.name })}
          {cfg.organization.kind === 'sandbox' && <Badge color="yellow">{t('orgs.sandbox.badge')}</Badge>}
        </p>
      ) : (
        <p className="mt-1 text-sm text-slate-500">{t('login.subtitle')}</p>
      )}
      <form className="mt-6 space-y-4" onSubmit={submit}>
        <ErrorBanner error={login.error} />
        {config.error && !orgError && <ErrorBanner error={config.error} />}
        {showOrg && (
          <FormField
            label={t('orgs.signIn.organization')}
            htmlFor="login-org"
            help={orgError ? undefined : t('orgs.signIn.organizationHelp')}
            error={orgError && !typing ? (orgError.code === 'organization_not_found' ? t('orgs.signIn.notFound', { slug: org }) : orgError.message) : null}
          >
            <input
              id="login-org"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              autoComplete="organization"
              className="input"
              value={orgInput}
              onChange={(e) => setOrgInput(e.target.value)}
            />
          </FormField>
        )}
        <FormField label={t('common.email')} htmlFor="login-email">
          <input id="login-email" type="email" autoComplete="username" required className="input" value={email} onChange={(e) => setEmail(e.target.value)} />
        </FormField>
        <FormField label={t('common.password')} htmlFor="login-password">
          <input id="login-password" type="password" autoComplete="current-password" required className="input" value={password} onChange={(e) => setPassword(e.target.value)} />
        </FormField>
        <Button type="submit" variant="primary" className="w-full" loading={login.isPending} disabled={!!orgError && !typing}>
          {t('login.submit')}
        </Button>
      </form>

      {cfg?.signup && (
        <p className="mt-4 text-center text-sm text-slate-500">
          {t('orgs.signIn.noAccount')}{' '}
          <Link to="/signup" className="font-medium text-indigo-600 hover:text-indigo-500">
            {t('orgs.signIn.createOrganization')}
          </Link>
        </p>
      )}

      {config.isLoading && (
        <div className="mt-8 flex justify-center">
          <Spinner className="size-4 text-slate-400" />
        </div>
      )}
      {ready && cfg.demo && (
        <div className="mt-8">
          <div className="flex items-center gap-3 text-xs text-slate-400">
            <span className="h-px flex-1 bg-slate-200" />
            {t('login.demo.signInAs')}
            <span className="h-px flex-1 bg-slate-200" />
          </div>
          <ul className="mt-3 grid grid-cols-1 gap-1.5 sm:grid-cols-2">
            {cfg.demoLogins.map((d) => (
              <li key={d.email}>
                <button
                  type="button"
                  disabled={login.isPending}
                  onClick={() => {
                    setEmail(d.email);
                    setPassword(cfg.demoPassword ?? '');
                    login.mutate({ email: d.email, password: cfg.demoPassword ?? '' });
                  }}
                  className="flex w-full items-center gap-2 rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-left shadow-xs hover:border-indigo-300 hover:bg-indigo-50/40 disabled:opacity-60"
                >
                  <Avatar name={d.name} size="xs" />
                  <span className="min-w-0">
                    <span className="block truncate text-xs font-medium text-slate-800">{d.name}</span>
                    <span className="block truncate text-[11px] text-slate-500">{d.title}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-center text-[11px] text-slate-400">
            {tx('login.demo.password', { password: <code className="rounded bg-slate-100 px-1">{cfg.demoPassword}</code> })}
          </p>
        </div>
      )}
    </>
  );
}

export default function Login() {
  const session = useSession();
  const [params] = useSearchParams();
  const next = safeNext(params.get('next'));
  const native = isNativeApp();
  const [server, setServer] = useState(serverUrl);

  if (session.data) return <Navigate to={next} replace />;
  if (native && !server) {
    return (
      <AuthLayout>
        <ConnectServer onConnected={setServer} />
      </AuthLayout>
    );
  }
  return (
    <AuthLayout
      footer={
        native && (
          <span className="flex items-center gap-1.5">
            <span className="max-w-56 truncate">{t('orgs.native.connectedTo', { url: server.replace(/^https?:\/\//, '') })}</span>
            <button
              type="button"
              className="font-medium text-indigo-600 hover:text-indigo-500"
              onClick={() => {
                setServerUrl(null);
                setServer('');
              }}
            >
              {t('orgs.native.change')}
            </button>
          </span>
        )
      }
    >
      <SignInForm key={server} next={next} />
    </AuthLayout>
  );
}
