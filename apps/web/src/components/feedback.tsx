import { CircleAlert, CircleCheck, X } from 'lucide-react';
import { createContext, type ReactNode, useCallback, useContext, useRef, useState } from 'react';
import { t } from '../i18n/index.ts';
import { Button, cx, Modal } from './ui.tsx';

type Toast = { id: number; kind: 'success' | 'error'; message: string };
type ConfirmOptions = { title: string; message?: ReactNode; confirmLabel?: string; danger?: boolean };

const ToastContext = createContext<(kind: Toast['kind'], message: string) => void>(() => {});
const ConfirmContext = createContext<(o: ConfirmOptions) => Promise<boolean>>(async () => false);

export const useToast = () => {
  const push = useContext(ToastContext);
  return { success: (m: string) => push('success', m), error: (m: string) => push('error', m) };
};

export const useConfirm = () => useContext(ConfirmContext);

export function FeedbackProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [confirm, setConfirm] = useState<(ConfirmOptions & { resolve: (v: boolean) => void }) | null>(null);
  const next = useRef(1);

  const push = useCallback((kind: Toast['kind'], message: string) => {
    const id = next.current++;
    setToasts((all) => [...all.slice(-3), { id, kind, message }]);
    setTimeout(() => setToasts((all) => all.filter((x) => x.id !== id)), kind === 'error' ? 7000 : 3500);
  }, []);

  const ask = useCallback((o: ConfirmOptions) => new Promise<boolean>((resolve) => setConfirm({ ...o, resolve })), []);
  const settle = (v: boolean) => {
    confirm?.resolve(v);
    setConfirm(null);
  };

  return (
    <ToastContext.Provider value={push}>
      <ConfirmContext.Provider value={ask}>
        {children}
        <div aria-live="polite" className="pointer-events-none fixed right-[max(1rem,var(--safe-right))] bottom-[max(1rem,var(--safe-bottom))] z-[60] flex w-80 max-w-[calc(100vw-2rem)] flex-col gap-2">
          {toasts.map((toast) => (
            <div key={toast.id} role={toast.kind === 'error' ? 'alert' : 'status'} className={cx('pointer-events-auto flex animate-slide-in items-start gap-2 rounded-xl border bg-white px-3 py-2.5 text-sm shadow-lg', toast.kind === 'error' ? 'border-rose-200' : 'border-emerald-200')}>
              {toast.kind === 'error' ? <CircleAlert className="mt-0.5 size-4 shrink-0 text-rose-500" /> : <CircleCheck className="mt-0.5 size-4 shrink-0 text-emerald-500" />}
              <span className="flex-1 text-slate-700">{toast.message}</span>
              <button type="button" aria-label={t('common.dismiss')} onClick={() => setToasts((all) => all.filter((x) => x.id !== toast.id))} className="text-slate-400 hover:text-slate-600">
                <X className="size-4" />
              </button>
            </div>
          ))}
        </div>
        <Modal
          open={!!confirm}
          onClose={() => settle(false)}
          title={confirm?.title ?? ''}
          size="sm"
          footer={
            <>
              <Button onClick={() => settle(false)}>{t('common.cancel')}</Button>
              <Button variant={confirm?.danger ? 'danger' : 'primary'} onClick={() => settle(true)}>
                {confirm?.confirmLabel ?? t('common.confirm')}
              </Button>
            </>
          }
        >
          <div className="text-sm text-slate-600">{confirm?.message}</div>
        </Modal>
      </ConfirmContext.Provider>
    </ToastContext.Provider>
  );
}
