import { useMutation } from '@tanstack/react-query';
import { type FormEvent, useState } from 'react';
import { Link, Navigate } from 'react-router';
import { api, isNativeApp } from '../api.ts';
import { AuthLayout } from '../components/AuthLayout.tsx';
import { Button, ErrorBanner, FormField, Loading } from '../components/ui.tsx';
import { t } from '../i18n/index.ts';
import { useSession } from '../lib/hooks.ts';
import { type SignInResult, useCompleteSignIn, usePublicConfig } from '../lib/session.ts';

/** Suggests an organization ID from its name ("Acme Rockets, Inc." → "acme-rockets-inc"). */
export function slugFromName(name: string): string {
  return name
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .slice(0, 32)
    .replace(/^-+|-+$/g, '');
}

export default function Signup() {
  const session = useSession();
  const config = usePublicConfig(null);
  const complete = useCompleteSignIn();
  const [orgName, setOrgName] = useState('');
  const [slug, setSlug] = useState('');
  const [slugEdited, setSlugEdited] = useState(false);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [demo, setDemo] = useState(true);
  const organization = slugEdited ? slug : slugFromName(orgName);

  const signup = useMutation({
    mutationFn: () =>
      api.post<SignInResult>(
        '/api/signup',
        { organization, organizationName: orgName.trim(), name: name.trim(), email: email.trim(), password, demo, ...(isNativeApp() ? { issueToken: true } : {}) },
        // A new organization does not depend on the one this tab was in (which might not even exist).
        { org: null },
      ),
    onSuccess: (s) => complete(s, '/'),
  });

  if (session.data) return <Navigate to="/" replace />;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    signup.mutate();
  };

  let body;
  if (config.isLoading) body = <Loading />;
  else if (!config.data?.signup) {
    body = (
      <>
        <h2 className="text-2xl font-semibold tracking-tight text-slate-900">{t('orgs.signUp.title')}</h2>
        {config.error ? <ErrorBanner error={config.error} className="mt-4" /> : <p className="mt-3 text-sm text-slate-600">{t('orgs.signUp.disabled')}</p>}
      </>
    );
  } else {
    body = (
      <>
        <h2 className="text-2xl font-semibold tracking-tight text-slate-900">{t('orgs.signUp.title')}</h2>
        <p className="mt-1 text-sm text-slate-500">{t('orgs.signUp.subtitle')}</p>
        <form className="mt-6 space-y-4" onSubmit={submit}>
          <ErrorBanner error={signup.error} />
          <FormField label={t('orgs.signUp.organizationName')} htmlFor="signup-org-name" required>
            <input id="signup-org-name" required maxLength={80} autoComplete="organization" className="input" value={orgName} onChange={(e) => setOrgName(e.target.value)} />
          </FormField>
          <FormField label={t('orgs.signUp.organizationId')} htmlFor="signup-org" required help={t('orgs.signUp.organizationIdHelp')}>
            <input
              id="signup-org"
              required
              maxLength={32}
              pattern="[a-z0-9](?:[a-z0-9\-]*[a-z0-9])?"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              className="input font-mono"
              value={organization}
              onChange={(e) => {
                setSlugEdited(true);
                setSlug(e.target.value.toLowerCase());
              }}
            />
          </FormField>
          <FormField label={t('orgs.signUp.yourName')} htmlFor="signup-name" required>
            <input id="signup-name" required maxLength={80} autoComplete="name" className="input" value={name} onChange={(e) => setName(e.target.value)} />
          </FormField>
          <FormField label={t('common.email')} htmlFor="signup-email" required>
            <input id="signup-email" type="email" required autoComplete="email" className="input" value={email} onChange={(e) => setEmail(e.target.value)} />
          </FormField>
          <FormField label={t('common.password')} htmlFor="signup-password" required help={t('orgs.signUp.passwordHelp')}>
            <input id="signup-password" type="password" required minLength={8} autoComplete="new-password" className="input" value={password} onChange={(e) => setPassword(e.target.value)} />
          </FormField>
          <label className="flex items-start gap-2 text-sm text-slate-700">
            <input type="checkbox" className="mt-0.5 size-4 rounded border-slate-300 text-indigo-600" checked={demo} onChange={(e) => setDemo(e.target.checked)} />
            {t('orgs.signUp.demo')}
          </label>
          <Button type="submit" variant="primary" className="w-full" loading={signup.isPending} disabled={!organization || password.length < 8}>
            {t('orgs.signUp.submit')}
          </Button>
        </form>
      </>
    );
  }

  return (
    <AuthLayout>
      {body}
      <p className="mt-6 text-center text-sm text-slate-500">
        {t('orgs.signUp.haveAccount')}{' '}
        <Link to="/login" className="font-medium text-indigo-600 hover:text-indigo-500">
          {t('orgs.signUp.signIn')}
        </Link>
      </p>
    </AuthLayout>
  );
}
