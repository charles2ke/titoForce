import { useCallback, useEffect } from 'react';
import { useBlocker } from 'react-router';
import { useConfirm } from '../components/feedback.tsx';
import { t } from '../i18n/index.ts';

/**
 * Asks before leaving a page that has unsaved changes, both in the app and when closing the tab. Returns a function
 * that asks the same question before switching what the page edits (resolves true when the changes may be discarded).
 */
export function useUnsavedChanges(dirty: boolean): () => Promise<boolean> {
  const confirm = useConfirm();
  const ask = useCallback(
    () => (dirty ? confirm({ title: t('components.unsaved.title'), message: t('components.unsaved.message'), confirmLabel: t('components.unsaved.discard'), danger: true }) : Promise.resolve(true)),
    [confirm, dirty],
  );
  const blocker = useBlocker(({ currentLocation, nextLocation }) => dirty && currentLocation.pathname !== nextLocation.pathname);
  useEffect(() => {
    if (blocker.state !== 'blocked') return;
    void ask().then((ok) => (ok ? blocker.proceed() : blocker.reset()));
  }, [blocker, ask]);
  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [dirty]);
  return ask;
}
