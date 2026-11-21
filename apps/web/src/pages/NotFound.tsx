import { Compass, TriangleAlert } from 'lucide-react';
import { isRouteErrorResponse, Link, useRouteError } from 'react-router';
import { Button, EmptyState } from '../components/ui.tsx';

export default function NotFound() {
  return (
    <div className="p-6">
      <EmptyState icon={Compass} title="Page not found" action={<Link to="/" className="text-sm font-medium text-indigo-600 hover:underline">Go to home</Link>}>
        The page you're looking for doesn't exist or you don't have access to it.
      </EmptyState>
    </div>
  );
}

/** Router error boundary: covers render errors and failed lazy chunk loads (e.g. after a deploy). */
export function RouteError() {
  const error = useRouteError();
  const message = isRouteErrorResponse(error) ? `${error.status} ${error.statusText}` : error instanceof Error ? error.message : 'Unknown error';
  const chunk = /dynamically imported module|Importing a module script failed|Failed to fetch/i.test(message);
  return (
    <div className="mx-auto mt-20 max-w-lg px-4">
      <EmptyState
        icon={TriangleAlert}
        title={chunk ? 'A new version is available' : 'Something went wrong'}
        action={
          <Button variant="primary" onClick={() => window.location.reload()}>
            Reload
          </Button>
        }
      >
        {chunk ? 'Reload the page to continue.' : message}
      </EmptyState>
    </div>
  );
}
