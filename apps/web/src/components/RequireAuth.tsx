import { AlertTriangle } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Navigate, Outlet, useLocation, useNavigate } from 'react-router';
import { ApiError, errorMessage } from '../api.ts';
import { getLocale, isLocale, setLocale, t } from '../i18n/index.ts';
import { CurrentAppContext, SessionContext, storeAppId, storedAppId, useSession } from '../lib/hooks.ts';
import { RealtimeProvider } from '../lib/realtime.tsx';
import { Button, ErrorBanner, Spinner } from './ui.tsx';

/** The organization asked for does not exist, is suspended or is still being copied (a sandbox). */
function OrganizationProblem({ error, onRetry }: { error: ApiError; onRetry: () => void }) {
  const navigate = useNavigate();
  return (
    <div className="mx-auto mt-24 max-w-md px-4">
      <div className="card p-6 text-center">
        <AlertTriangle className="mx-auto size-8 text-amber-500" aria-hidden />
        <h1 className="mt-3 text-lg font-semibold text-slate-900">{t('orgs.problem.title')}</h1>
        <p className="mt-1 text-sm text-slate-600">{errorMessage(error)}</p>
        <div className="mt-5 flex flex-wrap justify-center gap-2">
          {error.code === 'organization_unavailable' && <Button onClick={onRetry}>{t('orgs.problem.tryAgain')}</Button>}
          <Button variant="primary" onClick={() => navigate('/login')}>
            {t('orgs.problem.otherOrganization')}
          </Button>
        </div>
      </div>
    </div>
  );
}

/** Gate for the authenticated part of the app; provides the session and current-app contexts. */
export function RequireAuth() {
  const session = useSession();
  const location = useLocation();
  const [appId, setAppIdState] = useState(storedAppId);
  const setAppId = useCallback((id: string) => {
    storeAppId(id);
    setAppIdState(id);
  }, []);
  const appCtx = useMemo(() => ({ appId, setAppId }), [appId, setAppId]);

  // The language chosen in My settings follows the user to every device.
  const preferred = session.data?.user.locale;
  useEffect(() => {
    if (isLocale(preferred) && preferred !== getLocale()) void setLocale(preferred);
  }, [preferred]);

  if (session.isLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Spinner className="size-6 text-indigo-500" />
      </div>
    );
  }
  if (session.error) {
    if (session.error instanceof ApiError && session.error.code.startsWith('organization_')) {
      return <OrganizationProblem error={session.error} onRetry={() => void session.refetch()} />;
    }
    return (
      <div className="mx-auto mt-24 max-w-md space-y-3 px-4">
        <ErrorBanner error={session.error} />
        <Button onClick={() => void session.refetch()}>{t('components.tryAgain')}</Button>
      </div>
    );
  }
  if (!session.data) {
    const next = location.pathname + location.search;
    return <Navigate to={next === '/' ? '/login' : `/login?next=${encodeURIComponent(next)}`} replace />;
  }
  return (
    <SessionContext.Provider value={session.data}>
      <CurrentAppContext.Provider value={appCtx}>
        <RealtimeProvider userId={session.data.user.id}>
          <Outlet />
        </RealtimeProvider>
      </CurrentAppContext.Provider>
    </SessionContext.Provider>
  );
}
