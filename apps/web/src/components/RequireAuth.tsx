import { useCallback, useMemo, useState } from 'react';
import { Navigate, Outlet, useLocation } from 'react-router';
import { CurrentAppContext, SessionContext, storeAppId, storedAppId, useSession } from '../lib/hooks.ts';
import { Button, ErrorBanner, Spinner } from './ui.tsx';

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

  if (session.isLoading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <Spinner className="size-6 text-indigo-500" />
      </div>
    );
  }
  if (session.error) {
    return (
      <div className="mx-auto mt-24 max-w-md space-y-3 px-4">
        <ErrorBanner error={session.error} />
        <Button onClick={() => void session.refetch()}>Try again</Button>
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
        <Outlet />
      </CurrentAppContext.Provider>
    </SessionContext.Provider>
  );
}
