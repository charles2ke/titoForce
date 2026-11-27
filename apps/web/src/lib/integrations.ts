import { type QueryClient, useQuery } from '@tanstack/react-query';
import type { ConnectedAccountDTO, CrmRecord, IntegrationProvider, IntegrationStatus, ObjectDef } from '@titoforce/shared';
import { api } from '../api.ts';

export function useIntegrationStatus() {
  return useQuery({ queryKey: ['integrations', 'status'], queryFn: () => api.get<IntegrationStatus>('/api/integrations/status'), staleTime: 60_000 });
}

/** With `poll`, refetches while an account is syncing or waiting for its first sync. */
export function useConnectedAccounts({ poll = false }: { poll?: boolean } = {}) {
  return useQuery({
    queryKey: ['integrations', 'accounts'],
    queryFn: () => api.get<ConnectedAccountDTO[]>('/api/integrations/accounts'),
    refetchInterval: (q) => (poll && q.state.data?.some((a) => a.syncing || (!a.lastSyncAt && !a.lastError)) ? 3000 : false),
  });
}

export function invalidateIntegrations(qc: QueryClient): Promise<void> {
  return qc.invalidateQueries({ queryKey: ['integrations'] });
}

export const PROVIDER_LABEL: Record<IntegrationProvider, string> = {
  google: 'Google',
  microsoft: 'Microsoft 365',
  imap: 'IMAP mailbox',
  ics: 'Calendar address',
};

export const CALENDAR_LABEL: Record<IntegrationProvider, string> = {
  google: 'Google Calendar',
  microsoft: 'Outlook calendar',
  imap: 'Calendar',
  ics: 'Subscribed calendar',
};

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / (1024 * 1024)).toFixed(n < 10 * 1024 * 1024 ? 1 : 0)} MB`;
}

/** 75 → "1:15", 3725 → "1:02:05". */
export function formatDuration(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  const p = (n: number) => String(n).padStart(2, '0');
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h ? `${h}:${p(m)}:${p(s % 60)}` : `${m}:${p(s % 60)}`;
}

/** Reads a file as a data: URL, which the server accepts as the file's base64 content. */
export function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error(`Could not read “${file.name}”`));
    reader.readAsDataURL(file);
  });
}

/** Non-empty values of the record's fields of one type (e.g. its email addresses), with the field labels. */
export function contactPoints(def: ObjectDef, record: CrmRecord, type: 'email' | 'phone'): { label: string; value: string }[] {
  const out: { label: string; value: string }[] = [];
  for (const f of def.fields) {
    const v = record.fields[f.apiName];
    if (f.type === type && typeof v === 'string' && v.trim() && !out.some((o) => o.value === v.trim())) out.push({ label: f.label, value: v.trim() });
  }
  return out;
}

/** Splits a typed list of addresses ("a@x.com, b@y.com; c@z.com"). */
export const splitAddresses = (text: string): string[] =>
  text
    .split(/[,;\s]+/)
    .map((a) => a.trim())
    .filter(Boolean);
