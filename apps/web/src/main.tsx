import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider } from 'react-router/dom';
import { ApiError, isNativeApp, onUnauthorized } from './api.ts';
import { FeedbackProvider } from './components/feedback.tsx';
import { initI18n, onLocaleChange, useLocale } from './i18n/index.ts';
import './index.css';
import { router } from './router.tsx';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      refetchOnWindowFocus: false,
      retry: (count, err) => !(err instanceof ApiError && err.status >= 400 && err.status < 500) && count < 2,
    },
  },
});

// Any 401 outside the auth endpoints means the session expired: drop it so the router shows the login page.
onUnauthorized(() => queryClient.setQueryData(['session'], null));
// Metadata (object, field and app labels) is translated by the server per request. Requests already on their way ask
// for the previous language: cancel them first, as refetching would reuse a first load that has no data yet.
onLocaleChange(() => {
  const predicate = (q: { queryKey: readonly unknown[] }) => q.queryKey[0] !== 'session';
  void queryClient.cancelQueries({ predicate }).then(() => queryClient.invalidateQueries({ predicate }));
});

/** Re-mounts the UI when the language changes so every `t()` call re-renders. */
function Root() {
  const locale = useLocale();
  return (
    <FeedbackProvider key={locale}>
      <RouterProvider router={router} />
    </FeedbackProvider>
  );
}

// Makes the web app installable and quick to start (see public/sw.js). The native app ships these files itself.
if (import.meta.env.PROD && 'serviceWorker' in navigator && !isNativeApp()) {
  window.addEventListener('load', () => void navigator.serviceWorker.register('/sw.js').catch(() => undefined));
}

void initI18n().then(() =>
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <QueryClientProvider client={queryClient}>
        <Root />
      </QueryClientProvider>
    </StrictMode>,
  ),
);
