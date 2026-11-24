import { LayoutGrid } from 'lucide-react';
import { Navigate } from 'react-router';
import { EmptyState, ErrorBanner, Loading } from '../components/ui.tsx';
import { t } from '../i18n/index.ts';
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
        <EmptyState icon={LayoutGrid} title={t('components.homeRedirect.noApps')}>
          {t('components.homeRedirect.noAppsHelp')}
        </EmptyState>
      </div>
    );
  }
  return <Navigate to={`/app/${target.id}`} replace />;
}
