import { LayoutGrid } from 'lucide-react';
import { Navigate } from 'react-router';
import { EmptyState, ErrorBanner, Loading } from '../components/ui.tsx';
import { useApps, useCurrentApp } from '../lib/hooks.ts';

/** `/` → the last used app (or the first one available). */
export function HomeRedirect() {
  const apps = useApps();
  const { appId } = useCurrentApp();
  if (apps.isLoading) return <Loading />;
  if (apps.error) return <ErrorBanner error={apps.error} className="m-6" />;
  const target = apps.data?.find((a) => a.id === appId) ?? apps.data?.[0];
  if (!target) {
    return (
      <div className="p-6">
        <EmptyState icon={LayoutGrid} title="No apps yet">
          Ask an administrator to create an app in Setup.
        </EmptyState>
      </div>
    );
  }
  return <Navigate to={`/app/${target.id}`} replace />;
}
