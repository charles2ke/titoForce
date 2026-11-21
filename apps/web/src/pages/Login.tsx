import type { SessionInfo } from '@titoforce/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bot, ChartColumn, Kanban, LifeBuoy, Users } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { Navigate, useNavigate, useSearchParams } from 'react-router';
import { api } from '../api.ts';
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
}

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
  const [params] = useSearchParams();
  const next = safeNext(params.get('next'));
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const config = useQuery({ queryKey: ['public-config'], queryFn: () => api.get<PublicConfig>('/api/config'), staleTime: Number.POSITIVE_INFINITY });

  const login = useMutation({
    mutationFn: (creds: { email: string; password: string }) => api.post<SessionInfo>('/api/auth/login', creds),
    onSuccess: (s) => {
      qc.clear();
      qc.setQueryData(['session'], { user: s.user, permissions: s.permissions });
      navigate(next, { replace: true });
    },
  });

  if (session.data) return <Navigate to={next} replace />;
  const cfg = config.data;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    login.mutate({ email, password });
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
          <h2 className="text-2xl font-semibold tracking-tight text-slate-900">Sign in</h2>
          <p className="mt-1 text-sm text-slate-500">Welcome back. Enter your work email and password.</p>
          <form className="mt-6 space-y-4" onSubmit={submit}>
            <ErrorBanner error={login.error} />
            <FormField label="Email" htmlFor="login-email">
              <input id="login-email" type="email" autoComplete="username" required className="input" value={email} onChange={(e) => setEmail(e.target.value)} />
            </FormField>
            <FormField label="Password" htmlFor="login-password">
              <input id="login-password" type="password" autoComplete="current-password" required className="input" value={password} onChange={(e) => setPassword(e.target.value)} />
            </FormField>
            <Button type="submit" variant="primary" className="w-full" loading={login.isPending}>
              Sign in
            </Button>
          </form>

          {config.isLoading && (
            <div className="mt-8 flex justify-center">
              <Spinner className="size-4 text-slate-400" />
            </div>
          )}
          {cfg?.demo && (
            <div className="mt-8">
              <div className="flex items-center gap-3 text-xs text-slate-400">
                <span className="h-px flex-1 bg-slate-200" />
                Demo company: sign in as
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
                Demo password: <code className="rounded bg-slate-100 px-1">{cfg.demoPassword}</code>
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
