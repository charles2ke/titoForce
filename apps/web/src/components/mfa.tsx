import type { MfaEnrollment } from '@titoforce/shared';
import { Check, Copy, Download, TriangleAlert } from 'lucide-react';
import { type Ref, useEffect, useId, useMemo, useRef, useState } from 'react';
import { encode } from 'uqr';
import { formatDateTime } from '../lib/format.ts';
import { useToast } from './feedback.tsx';
import { Button, FormField } from './ui.tsx';

/** Light margin around the code (in modules) that scanners need to find it. */
const QUIET_ZONE = 4;
/** Whole screen pixels per module keep the edges sharp. */
const MODULE_PX = 3;

/** QR code drawn as an inline SVG (the content security policy rules out generated images from elsewhere). */
export function QrCode({ value }: { value: string }) {
  const { size, path } = useMemo(() => {
    const qr = encode(value, { ecc: 'M', border: QUIET_ZONE });
    let d = '';
    qr.data.forEach((row, y) =>
      row.forEach((dark, x) => {
        if (dark) d += `M${x} ${y}h1v1h-1z`;
      }),
    );
    return { size: qr.size, path: d };
  }, [value]);
  return (
    <svg
      role="img"
      aria-label="QR code for your authenticator app"
      viewBox={`0 0 ${size} ${size}`}
      width={size * MODULE_PX}
      height={size * MODULE_PX}
      shapeRendering="crispEdges"
      className="h-auto max-w-full shrink-0 rounded-lg ring-1 ring-slate-200"
    >
      <rect width={size} height={size} fill="#fff" />
      <path d={path} fill="#000" />
    </svg>
  );
}

/** Copies text to the clipboard with a toast; `copied` is briefly true afterwards. */
function useCopy() {
  const toast = useToast();
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const copy = async (text: string, message: string) => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      toast.error('Couldn’t copy. Select the text and copy it instead.');
      return;
    }
    toast.success(message);
    setCopied(true);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(false), 2000);
  };
  return { copied, copy };
}

/** Groups of four characters are easier to read and type. */
const groupKey = (secret: string) => secret.match(/.{1,4}/g)?.join(' ') ?? secret;

/** Adds titoForce to an authenticator app: a QR code, plus the setup key for typing it in. */
export function AuthenticatorSetup({ enrollment }: { enrollment: MfaEnrollment }) {
  const keyLabel = useId();
  const { copied, copy } = useCopy();
  return (
    <div className="@container space-y-3">
      <p className="text-sm text-slate-600">Scan this QR code with an authenticator app such as Google Authenticator, Microsoft Authenticator or 1Password.</p>
      <div className="flex flex-col items-center gap-4 @md:flex-row">
        <QrCode value={enrollment.uri} />
        <div className="w-full min-w-0 @md:flex-1">
          <dl>
            <dt id={keyLabel} className="label">
              Setup key
            </dt>
            <dd aria-labelledby={keyLabel} className="flex gap-2">
              <span className="min-w-0 flex-1 rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 font-mono text-sm text-balance break-words text-slate-900 select-all">
                {groupKey(enrollment.secret)}
              </span>
              <Button icon={copied ? Check : Copy} aria-label="Copy setup key" title="Copy setup key" className="self-start" onClick={() => void copy(enrollment.secret, 'Setup key copied')} />
            </dd>
          </dl>
          <p className="mt-1 text-xs text-slate-400">Can’t scan the code? Enter this key in your app instead.</p>
        </div>
      </div>
    </div>
  );
}

const DOWNLOAD_NAME = 'titoforce-recovery-codes.txt';

function downloadCodes(codes: string[], account?: string) {
  const lines = [`titoForce recovery codes${account ? ` for ${account}` : ''}`, `Created ${formatDateTime(new Date().toISOString())}`, '', ...codes, '', 'Each code works once.'];
  const blob = new Blob([`${lines.join('\n')}\n`], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = DOWNLOAD_NAME;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Newly issued recovery codes, shown once. `account` labels the downloaded file. */
export function RecoveryCodes({ codes, account }: { codes: string[]; account?: string }) {
  const { copied, copy } = useCopy();
  return (
    <div className="@container space-y-3">
      <ul aria-label="Recovery codes" className="grid gap-x-6 gap-y-1.5 rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 font-mono text-sm text-slate-900 @xs:grid-cols-2">
        {codes.map((c) => (
          <li key={c}>{c}</li>
        ))}
      </ul>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" icon={copied ? Check : Copy} onClick={() => void copy(codes.join('\n'), 'Recovery codes copied')}>
          Copy codes
        </Button>
        <Button size="sm" icon={Download} onClick={() => downloadCodes(codes, account)}>
          Download
        </Button>
      </div>
      <p className="flex items-start gap-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
        <TriangleAlert className="mt-px size-3.5 shrink-0" aria-hidden />
        Each code works once. Store them somewhere safe: they won’t be shown again.
      </p>
    </div>
  );
}

/**
 * The "Authentication code" field. It takes a 6-digit authenticator code or a recovery code (letters and dashes), so
 * it is a plain text input rather than a numeric one.
 */
export function CodeField({ id, value, onChange, autoFocus, inputRef, help }: { id: string; value: string; onChange: (v: string) => void; autoFocus?: boolean; inputRef?: Ref<HTMLInputElement>; help?: string }) {
  return (
    <FormField label="Authentication code" htmlFor={id} help={help}>
      <input
        ref={inputRef}
        id={id}
        className="input font-mono"
        autoComplete="one-time-code"
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        maxLength={40}
        required
        autoFocus={autoFocus}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </FormField>
  );
}
