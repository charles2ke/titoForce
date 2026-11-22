import type { LoginResponse, MfaEnrollment, PublicSsoProvider, SessionInfo, SsoErrorReason } from '@titoforce/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Bot, ChartColumn, Kanban, KeyRound, LifeBuoy, Users } from 'lucide-react';
import { type FormEvent, type ReactNode, useEffect, useRef, useState } from 'react';
import { Navigate, useNavigate, useSearchParams } from 'react-router';
import { ApiError, api } from '../api.ts';
import { AuthenticatorSetup, CodeField, RecoveryCodes } from '../components/mfa.tsx';
import { Avatar, Button, ErrorBanner, FormField, Spinner } from '../components/ui.tsx';
import { useSession } from '../lib/hooks.ts';

interface DemoLogin {
  email: string;
  name: string;
  title: string;
  roleId: string;
}

interface PublicConfig {
  demo: boolean;
  demoLogins: DemoLogin[];
  demoPassword: string | null;
  sso: PublicSsoProvider[];
}

/** A session from the second sign-in step; it includes recovery codes when the user just set up two-factor authentication. */
type Verified = SessionInfo & { recoveryCodes?: string[] };

type Step =
  | { name: 'password' }
  | { name: 'code'; challenge: string }
  | { name: 'enroll'; challenge: string }
  | { name: 'recovery'; session: SessionInfo; codes: string[] };

const STEP_TEXT: Record<Step['name'], { title: string; intro: string }> = {
  password: { title: 'Sign in', intro: 'Welcome back. Enter your work email and password.' },
  code: { title: 'Two-factor authentication', intro: 'Enter the 6-digit code from your authenticator app, or one of your recovery codes.' },
  enroll: { title: 'Set up two-factor authentication', intro: 'Your role requires two-factor authentication. Add titoForce to your authenticator app, then enter the code it shows.' },
  recovery: { title: 'Save your recovery codes', intro: 'Two-factor authentication is set up. Use one of these codes to sign in if you lose your authenticator app.' },
};

const SSO_ERRORS: Record<SsoErrorReason, string> = {
  expired: 'Your single sign-on attempt expired or was started in another browser. Please try again.',
  denied: 'The identity provider did not sign you in.',
  failed: 'Single sign-on failed. Please try again, or ask your administrator to check the provider settings.',
  disabled: 'That single sign-on provider is not available.',
  no_email: 'The identity provider did not share your email address.',
  unverified_email: 'The identity provider has not verified your email address.',
  domain_not_allowed: 'Your email address is not in a domain allowed to sign in with this provider.',
  not_provisioned: 'No titoForce user has your email address. Ask your administrator to add you.',
  inactive: 'Your titoForce user is deactivated.',
  rate_limited: 'Too many sign-in attempts. Please wait a minute and try again.',
};

const ssoErrorMessage = (reason: string): string => (Object.hasOwn(SSO_ERRORS, reason) ? SSO_ERRORS[reason as SsoErrorReason] : SSO_ERRORS.failed);

const hasCode = (err: unknown, code: string) => err instanceof ApiError && err.code === code;

const HIGHLIGHTS = [
  { icon: ChartColumn, text: 'Sales: leads, accounts, pipeline, quotes and forecasts' },
  { icon: LifeBuoy, text: 'Service: cases, knowledge and SLAs' },
  { icon: Kanban, text: 'Work: projects, boards, calendars and timelines' },
  { icon: Users, text: 'People: employees, time off, reviews and hiring' },
  { icon: Bot, text: 'AI agents that act through the same permissions as you' },
];

/** Only same-origin, in-app paths are allowed as post-login redirects. */
function safeNext(next: string | null): string {
  return next && next.startsWith('/') && !next.startsWith('//') && !next.startsWith('/login') ? next : '/';
}

export default function Login() {
  const session = useSession();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const next = safeNext(params.get('next'));
  const ssoError = params.get('sso_error');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [step, setStep] = useState<Step>({ name: 'password' });
  /** Why the user is back at the password step, such as an expired second step. */
  const [stepError, setStepError] = useState<unknown>(null);
  /** The single sign-on provider the browser is leaving for. */
  const [redirecting, setRedirecting] = useState<string | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const passwordInput = useRef<HTMLInputElement>(null);
  const shownStep = useRef(step.name);
  const config = useQuery({ queryKey: ['public-config'], queryFn: () => api.get<PublicConfig>('/api/config'), staleTime: Number.POSITIVE_INFINITY });

  const finish = (s: SessionInfo) => {
    qc.clear();
    qc.setQueryData(['session'], { user: s.user, permissions: s.permissions });
    navigate(next, { replace: true });
  };

  const login = useMutation({
    mutationFn: (creds: { email: string; password: string }) => api.post<LoginResponse>('/api/auth/login', creds),
    onSuccess: (res) => {
      if ('mfaRequired' in res || 'mfaSetupRequired' in res) {
        // Going back starts a new sign-in attempt, which needs the password again.
        setPassword('');
        setStep('mfaRequired' in res ? { name: 'code', challenge: res.challenge } : { name: 'enroll', challenge: res.challenge });
      } else finish(res);
    },
  });

  useEffect(() => {
    if (shownStep.current === step.name) return;
    shownStep.current = step.name;
    // The code step focuses its input itself.
    if (step.name === 'password') passwordInput.current?.focus();
    else if (step.name !== 'code') heading.current?.focus();
  }, [step.name]);

  useEffect(() => {
    // The back button can restore this page from the browser's cache with a provider button still busy.
    const reset = (e: PageTransitionEvent) => {
      if (e.persisted) setRedirecting(null);
    };
    window.addEventListener('pageshow', reset);
    return () => window.removeEventListener('pageshow', reset);
  }, []);

  // The user is signed in while their new recovery codes are on screen; Continue takes them into the app.
  if (session.data && step.name !== 'recovery') return <Navigate to={next} replace />;
  const cfg = config.data;
  const providers = cfg?.sso ?? [];
  const busy = login.isPending || redirecting !== null;
  const text = STEP_TEXT[step.name];

  const signIn = (creds: { email: string; password: string }) => {
    setStepError(null);
    if (ssoError) {
      setParams(
        (prev) => {
          const p = new URLSearchParams(prev);
          p.delete('sso_error');
          return p;
        },
        { replace: true },
      );
    }
    login.mutate(creds);
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    signIn({ email, password });
  };

  const startSso = (provider: PublicSsoProvider) => {
    setRedirecting(provider.id);
    // A full page load: the server redirects the browser to the identity provider.
    window.location.assign(`/api/auth/sso/${encodeURIComponent(provider.id)}/start?next=${encodeURIComponent(next)}`);
  };

  const backToSignIn = (err: unknown = null) => {
    setStepError(err);
    setStep({ name: 'password' });
  };

  const verified = ({ recoveryCodes, ...s }: Verified) => {
    if (recoveryCodes?.length) setStep({ name: 'recovery', session: s, codes: recoveryCodes });
    else finish(s);
  };

  return (
    <div className="flex min-h-screen bg-slate-50">
      <div className="relative hidden w-[44%] overflow-hidden bg-gradient-to-br from-indigo-700 via-violet-700 to-fuchsia-700 p-12 text-white lg:flex lg:flex-col">
        <div className="flex items-center gap-2.5">
          <img src="/favicon.svg" alt="" className="size-9 rounded-lg bg-white/10 p-1" />
          <span className="text-xl font-semibold tracking-tight">titoForce</span>
        </div>
        <div className="my-auto max-w-md">
          <h1 className="text-4xl leading-tight font-semibold tracking-tight">The agentic CRM for your whole company.</h1>
          <p className="mt-4 text-indigo-100">One metadata-driven platform for customers, work and people, with AI agents built in.</p>
          <ul className="mt-8 space-y-3">
            {HIGHLIGHTS.map(({ icon: I, text }) => (
              <li key={text} className="flex items-center gap-3 text-sm text-indigo-50">
                <span className="flex size-8 items-center justify-center rounded-lg bg-white/10">
                  <I className="size-4" aria-hidden />
                </span>
                {text}
              </li>
            ))}
          </ul>
        </div>
        <p className="text-xs text-indigo-200">Open source · AGPL-3.0</p>
      </div>

      <div className="flex flex-1 items-center justify-center p-6">
        <div className="w-full max-w-sm">
          <div className="mb-8 flex items-center gap-2.5 lg:hidden">
            <img src="/favicon.svg" alt="" className="size-9" />
            <span className="text-xl font-semibold tracking-tight text-slate-900">titoForce</span>
          </div>
          <h2 ref={heading} tabIndex={-1} className="text-2xl font-semibold tracking-tight text-slate-900 focus:outline-none">
            {text.title}
          </h2>
          <p className="mt-1 text-sm text-slate-500">{text.intro}</p>

          {step.name === 'password' && (
            <>
              <form className="mt-6 space-y-4" onSubmit={submit}>
                <ErrorBanner error={login.error ?? stepError ?? (ssoError ? ssoErrorMessage(ssoError) : null)} />
                <FormField label="Email" htmlFor="login-email">
                  <input id="login-email" type="email" autoComplete="username" required className="input" value={email} onChange={(e) => setEmail(e.target.value)} />
                </FormField>
                <FormField label="Password" htmlFor="login-password">
                  <input ref={passwordInput} id="login-password" type="password" autoComplete="current-password" required className="input" value={password} onChange={(e) => setPassword(e.target.value)} />
                </FormField>
                <Button type="submit" variant="primary" className="w-full" loading={login.isPending} disabled={redirecting !== null}>
                  Sign in
                </Button>
              </form>

              {providers.length > 0 && (
                <div className="mt-6">
                  <Divider>or</Divider>
                  <ul className="mt-4 space-y-2">
                    {providers.map((p) => (
                      <li key={p.id}>
                        <Button icon={KeyRound} className="w-full" loading={redirecting === p.id} disabled={busy} onClick={() => startSso(p)}>
                          <span className="min-w-0 truncate">Sign in with {p.name}</span>
                        </Button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {config.isLoading && (
                <div className="mt-8 flex justify-center">
                  <Spinner className="size-4 text-slate-400" />
                </div>
              )}
              {cfg?.demo && (
                <div className="mt-8">
                  <Divider>Demo company: sign in as</Divider>
                  <ul className="mt-3 grid grid-cols-1 gap-1.5 sm:grid-cols-2">
                    {cfg.demoLogins.map((d) => (
                      <li key={d.email}>
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => {
                            setEmail(d.email);
                            setPassword(cfg.demoPassword ?? '');
                            signIn({ email: d.email, password: cfg.demoPassword ?? '' });
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
                    Demo password: <code className="rounded bg-slate-100 px-1">{cfg.demoPassword}</code>
                  </p>
                </div>
              )}
            </>
          )}

          {step.name === 'code' && (
            <div className="mt-6 space-y-3">
              <VerifyForm key={step.challenge} challenge={step.challenge} submitLabel="Verify" autoFocus onVerified={verified} onExpired={backToSignIn} />
              <Button icon={ArrowLeft} className="w-full" onClick={() => backToSignIn()}>
                Back to sign in
              </Button>
            </div>
          )}

          {step.name === 'enroll' && <EnrollStep key={step.challenge} challenge={step.challenge} onVerified={verified} onExpired={backToSignIn} onBack={() => backToSignIn()} />}

          {step.name === 'recovery' && (
            <div className="mt-6 space-y-6">
              <RecoveryCodes codes={step.codes} account={step.session.user.email} />
              <Button variant="primary" className="w-full" onClick={() => finish(step.session)}>
                Continue
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Divider({ children }: { children: ReactNode }) {
  return (
    <div className="flex items-center gap-3 text-xs text-slate-400">
      <span className="h-px flex-1 bg-slate-200" />
      {children}
      <span className="h-px flex-1 bg-slate-200" />
    </div>
  );
}

/** Checks an authenticator or recovery code for the challenge that the password step returned. */
function VerifyForm({ challenge, submitLabel, autoFocus, onVerified, onExpired }: { challenge: string; submitLabel: string; autoFocus?: boolean; onVerified: (v: Verified) => void; onExpired: (err: unknown) => void }) {
  const [code, setCode] = useState('');
  const input = useRef<HTMLInputElement>(null);
  const verify = useMutation({
    mutationFn: (value: string) => api.post<Verified>('/api/auth/mfa/verify', { challenge, code: value }),
    onSuccess: (v) => onVerified(v),
    onError: (err) => {
      if (hasCode(err, 'challenge_expired')) onExpired(err);
      else if (hasCode(err, 'invalid_code')) {
        setCode('');
        input.current?.focus();
      }
    },
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    verify.mutate(code.trim());
  };

  return (
    <form className="space-y-4" onSubmit={submit}>
      <ErrorBanner error={verify.error} />
      <CodeField id="login-code" value={code} onChange={setCode} autoFocus={autoFocus} inputRef={input} />
      <Button type="submit" variant="primary" className="w-full" loading={verify.isPending}>
        {submitLabel}
      </Button>
    </form>
  );
}

/** For users whose role requires two-factor authentication but who have not set it up yet. */
function EnrollStep({ challenge, onVerified, onExpired, onBack }: { challenge: string; onVerified: (v: Verified) => void; onExpired: (err: unknown) => void; onBack: () => void }) {
  // Every request issues a new secret, so ask once per challenge; the code must come from the secret shown.
  const enrollment = useQuery({
    queryKey: ['mfa-enroll', challenge],
    queryFn: () => api.post<MfaEnrollment>('/api/auth/mfa/enroll', { challenge }),
    staleTime: Number.POSITIVE_INFINITY,
    gcTime: 0,
    retry: false,
  });
  const { error } = enrollment;
  const expired = hasCode(error, 'challenge_expired');
  useEffect(() => {
    if (expired) onExpired(error);
  }, [expired, error, onExpired]);

  return (
    <div className="mt-6 space-y-5">
      {enrollment.isPending && (
        <div className="flex justify-center py-10">
          <Spinner />
        </div>
      )}
      {!expired && <ErrorBanner error={error} />}
      {enrollment.data && <AuthenticatorSetup enrollment={enrollment.data} />}
      <div className="space-y-3">
        {enrollment.data && <VerifyForm challenge={challenge} submitLabel="Verify and sign in" onVerified={onVerified} onExpired={onExpired} />}
        <Button icon={ArrowLeft} className="w-full" onClick={onBack}>
          Back to sign in
        </Button>
      </div>
    </div>
  );
}
