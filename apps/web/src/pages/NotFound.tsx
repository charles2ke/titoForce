import { Compass, TriangleAlert } from 'lucide-react';
import { isRouteErrorResponse, Link, useRouteError } from 'react-router';
import { Button, EmptyState } from '../components/ui.tsx';
import { t } from '../i18n/index.ts';

export default function NotFound() {
  return (
    <div className="p-6">
      <EmptyState icon={Compass} title={t('components.notFound.title')} action={<Link to="/" className="text-sm font-medium text-indigo-600 hover:underline">{t('components.notFound.home')}</Link>}>
        {t('components.notFound.body')}
      </EmptyState>
    </div>
  );
}

/** Router error boundary: covers render errors and failed lazy chunk loads (e.g. after a deploy). */
export function RouteError() {
  const error = useRouteError();
  const message = isRouteErrorResponse(error) ? `${error.status} ${error.statusText}` : error instanceof Error ? error.message : t('components.routeError.unknown');
  const chunk = /dynamically imported module|Importing a module script failed|Failed to fetch/i.test(message);
  return (
    <div className="mx-auto mt-20 max-w-lg px-4">
      <EmptyState
        icon={TriangleAlert}
        title={chunk ? t('components.routeError.newVersion') : t('common.somethingWentWrong')}
        action={
          <Button variant="primary" onClick={() => window.location.reload()}>
            {t('common.reload')}
          </Button>
        }
      >
        {chunk ? t('components.routeError.reloadToContinue') : message}
      </EmptyState>
    </div>
  );
}
