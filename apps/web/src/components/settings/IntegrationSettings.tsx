import type { ConnectedAccountDTO, ImapAccountRequest, IntegrationProvider, SyncResponse, SyncResult, UnmatchedMailAction, UserDTO } from '@titoforce/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { CalendarDays, CalendarSync, CircleAlert, Ellipsis, Inbox, type LucideIcon, Mail, Pencil, Phone, Plug, RefreshCw, Trash2, X } from 'lucide-react';
import { type FormEvent, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router';
import { api, errorMessage } from '../../api.ts';
import { formatDateTime, plural, relativeTime } from '../../lib/format.ts';
import { invalidateRecordData, useAuth, usePermissions } from '../../lib/hooks.ts';
import { invalidateIntegrations, PROVIDER_LABEL, useConnectedAccounts, useIntegrationStatus } from '../../lib/integrations.ts';
import { useConfirm, useToast } from '../feedback.tsx';
import { Badge, Button, Card, CopyField, cx, ErrorBanner, FormField, IconButton, Loading, MenuItem, Modal, Popover, Toggle } from '../ui.tsx';

const MARK: Record<IntegrationProvider, { icon: LucideIcon; className: string }> = {
  google: { icon: Mail, className: 'bg-rose-50 text-rose-600' },
  microsoft: { icon: Mail, className: 'bg-sky-50 text-sky-600' },
  imap: { icon: Inbox, className: 'bg-slate-100 text-slate-600' },
  ics: { icon: CalendarDays, className: 'bg-violet-50 text-violet-600' },
};

const UNMATCHED: { value: UnmatchedMailAction; label: string; object?: string }[] = [
  { value: 'ignore', label: 'Ignore them' },
  { value: 'lead', label: 'Create a lead', object: 'lead' },
  { value: 'case', label: 'Open a case', object: 'case' },
];

function syncSummary(r: SyncResult): string {
  const parts: string[] = [];
  if (r.mail) parts.push(`${plural(r.mail.logged, 'email')} logged`);
  if (r.calendar) parts.push(`${plural(r.calendar.imported, 'meeting')} imported${r.calendar.updated ? `, ${r.calendar.updated.toLocaleString()} updated` : ''}`);
  return parts.length ? parts.join(', ') : 'nothing to sync';
}

/** Shows the outcome of a Google or Microsoft sign-in, which returns to Settings with ?connected= or ?integrationError=. */
export function OAuthReturnNotice() {
  const [params, setParams] = useSearchParams();
  const toast = useToast();
  const qc = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const handled = useRef('');
  const connected = params.get('connected');
  const failure = params.get('integrationError');
  useEffect(() => {
    if (connected === null && failure === null) return;
    const key = params.toString();
    if (handled.current === key) return;
    handled.current = key;
    if (connected) {
      toast.success(`${connected} is connected`);
      void invalidateIntegrations(qc);
    }
    if (failure) setError(failure);
    const next = new URLSearchParams(params);
    next.delete('connected');
    next.delete('integrationError');
    setParams(next, { replace: true });
  }, [connected, failure, params, setParams, toast, qc]);
  if (!error) return null;
  return (
    <div role="alert" className="flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
      <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
      <p className="min-w-0 flex-1">
        <span className="font-medium">The account was not connected.</span> {error}
      </p>
      <IconButton icon={X} label="Dismiss" className="-my-1.5 size-7 text-rose-500 hover:bg-rose-100" onClick={() => setError(null)} />
    </div>
  );
}

function SendingMode() {
  const { user } = useAuth();
  const status = useIntegrationStatus();
  const email = status.data?.email;
  if (!email) return null;
  return (
    <p className="text-sm text-slate-600">
      {email.mode === 'account' ? (
        <>
          Email you send from titoForce goes out from <span className="font-medium text-slate-900">{email.from}</span>.
        </>
      ) : email.mode === 'relay' ? (
        <>
          Email you send from titoForce goes out from <span className="font-medium text-slate-900">{email.from}</span> on your behalf, with replies going to {user.email}.
          Connect your mailbox to send as yourself.
        </>
      ) : (
        <>Connect your mailbox to send email from titoForce. Until then, you can log emails you send elsewhere.</>
      )}
    </p>
  );
}

function AccountRow({ account, sending, onEdit, onReconnect }: { account: ConnectedAccountDTO; sending: boolean; onEdit: () => void; onReconnect: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const confirm = useConfirm();
  const perms = usePermissions();
  const Mark = MARK[account.provider];
  const oauth = account.provider === 'google' || account.provider === 'microsoft';
  const url = `/api/integrations/accounts/${account.id}`;
  const update = useMutation({
    mutationFn: (patch: Partial<Pick<ConnectedAccountDTO['settings'], 'syncEmail' | 'syncCalendar' | 'unmatched'>>) => api.patch<ConnectedAccountDTO>(url, patch),
    onSettled: () => invalidateIntegrations(qc),
    onError: (err) => toast.error(errorMessage(err)),
  });
  const sync = useMutation({
    mutationFn: () => api.post<SyncResponse>(`${url}/sync`),
    onSuccess: ({ result }) => {
      if (result.error) toast.error(result.error);
      else toast.success(`${account.label}: ${syncSummary(result)}`);
      return invalidateRecordData(qc);
    },
    onError: (err) => toast.error(errorMessage(err)),
    onSettled: () => invalidateIntegrations(qc),
  });
  const remove = useMutation({
    mutationFn: () => api.del(url),
    onSuccess: () => toast.success(`${account.label} disconnected`),
    onError: (err) => toast.error(errorMessage(err)),
    onSettled: () => invalidateIntegrations(qc),
  });
  const disconnect = async () => {
    const ok = await confirm({
      title: `Disconnect ${account.label}?`,
      message: 'titoForce stops syncing this account and deletes its stored credentials. Emails and meetings already logged stay on their records.',
      confirmLabel: 'Disconnect',
      danger: true,
    });
    if (ok) remove.mutate();
  };
  const options = UNMATCHED.filter((o) => !o.object || o.value === account.settings.unmatched || perms.canCreate(o.object));
  const busy = account.syncing || sync.isPending;
  const detail = account.provider === 'ics' ? account.settings.feedHost : account.address !== account.label ? account.address : null;

  return (
    <li className="flex flex-wrap items-start gap-3 py-3" aria-label={account.label}>
      <span className={cx('grid size-9 shrink-0 place-items-center rounded-lg', Mark.className)}>
        <Mark.icon className="size-4" aria-hidden />
      </span>
      <div className="min-w-0 flex-1 space-y-1.5">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="truncate text-sm font-medium text-slate-900">{account.label}</span>
          {busy ? (
            <Badge color="blue">Syncing…</Badge>
          ) : account.status === 'error' ? (
            <Badge color="red">Needs attention</Badge>
          ) : account.lastError ? (
            <Badge color="yellow">Last sync failed</Badge>
          ) : !account.lastSyncAt ? (
            <Badge color="gray">Waiting to sync</Badge>
          ) : null}
          {sending && <Badge color="green">Sends your email</Badge>}
        </div>
        <p className="truncate text-xs text-slate-500">
          {PROVIDER_LABEL[account.provider]}
          {detail && ` · ${detail}`}
          {account.lastSyncAt && (
            <>
              {' '}
              · Synced <span title={formatDateTime(account.lastSyncAt)}>{relativeTime(account.lastSyncAt)}</span>
            </>
          )}
        </p>
        {account.lastError && <p className="text-xs break-words text-rose-700">{account.lastError}</p>}
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2 pt-0.5">
          {account.capabilities.syncEmail && (
            <Toggle checked={account.settings.syncEmail} disabled={update.isPending} onChange={(v) => update.mutate({ syncEmail: v })} label="Log emails" />
          )}
          {account.capabilities.calendar && (
            <Toggle checked={account.settings.syncCalendar} disabled={update.isPending} onChange={(v) => update.mutate({ syncCalendar: v })} label="Import meetings" />
          )}
          {account.capabilities.syncEmail && account.settings.syncEmail && (
            <label className="flex items-center gap-2 text-sm text-slate-700">
              Mail from unknown senders
              <select
                className="input h-8 w-auto py-0 text-sm"
                value={account.settings.unmatched}
                disabled={update.isPending}
                onChange={(e) => update.mutate({ unmatched: e.target.value as UnmatchedMailAction })}
              >
                {options.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>
      </div>
      <div className="flex items-center gap-1">
        {oauth && account.status === 'error' ? (
          <Button size="sm" variant="primary" onClick={onReconnect}>
            Reconnect
          </Button>
        ) : (
          <Button size="sm" icon={RefreshCw} loading={sync.isPending} disabled={account.syncing} onClick={() => sync.mutate()} aria-label={`Sync ${account.label} now`}>
            Sync now
          </Button>
        )}
        <Popover align="right" className="w-48" trigger={({ toggle, open }) => <IconButton icon={Ellipsis} label={`More actions for ${account.label}`} aria-expanded={open} onClick={toggle} />}>
          {(close) => (
            <div className="py-1">
              {account.provider === 'imap' && (
                <MenuItem
                  icon={Pencil}
                  onClick={() => {
                    close();
                    onEdit();
                  }}
                >
                  Edit settings
                </MenuItem>
              )}
              {oauth && (
                <MenuItem
                  icon={RefreshCw}
                  onClick={() => {
                    close();
                    onReconnect();
                  }}
                >
                  Sign in again
                </MenuItem>
              )}
              <MenuItem
                icon={Trash2}
                danger
                onClick={() => {
                  close();
                  void disconnect();
                }}
              >
                Disconnect
              </MenuItem>
            </div>
          )}
        </Popover>
      </div>
    </li>
  );
}

/** Mail servers whose names do not follow imap.<domain> / smtp.<domain>. */
const MAIL_SERVERS: Record<string, { imap: string; smtp: string; smtpPort: number }> = {
  'icloud.com': { imap: 'imap.mail.me.com', smtp: 'smtp.mail.me.com', smtpPort: 587 },
  'me.com': { imap: 'imap.mail.me.com', smtp: 'smtp.mail.me.com', smtpPort: 587 },
  'mac.com': { imap: 'imap.mail.me.com', smtp: 'smtp.mail.me.com', smtpPort: 587 },
  'yahoo.com': { imap: 'imap.mail.yahoo.com', smtp: 'smtp.mail.yahoo.com', smtpPort: 465 },
};

function ImapModal({ account, onClose }: { account?: ConnectedAccountDTO; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const perms = usePermissions();
  const s = account?.settings;
  const [address, setAddress] = useState(account?.address ?? '');
  const [password, setPassword] = useState('');
  const [username, setUsername] = useState(s?.username && s.username !== account?.address ? s.username : '');
  const [imapHost, setImapHost] = useState(s?.imapHost ?? '');
  const [imapPort, setImapPort] = useState(String(s?.imapPort ?? 993));
  const [imapSecure, setImapSecure] = useState(s?.imapSecure ?? true);
  const [smtpHost, setSmtpHost] = useState(s?.smtpHost ?? '');
  const [smtpPort, setSmtpPort] = useState(String(s?.smtpPort ?? 465));
  const [smtpSecure, setSmtpSecure] = useState(s?.smtpSecure ?? true);
  const [syncEmail, setSyncEmail] = useState(s?.syncEmail ?? true);
  const [unmatched, setUnmatched] = useState<UnmatchedMailAction>(s?.unmatched ?? 'ignore');

  const guessServers = () => {
    const domain = address.split('@')[1]?.trim().toLowerCase();
    if (!domain || !/^[a-z0-9.-]+\.[a-z]{2,}$/.test(domain)) return;
    const known = MAIL_SERVERS[domain];
    if (!imapHost) setImapHost(known?.imap ?? `imap.${domain}`);
    if (!smtpHost) {
      setSmtpHost(known?.smtp ?? `smtp.${domain}`);
      const port = known?.smtpPort ?? 465;
      setSmtpPort(String(port));
      setSmtpSecure(port === 465);
    }
  };
  const save = useMutation({
    mutationFn: () => {
      const smtp = smtpHost.trim();
      const body: ImapAccountRequest = {
        address: address.trim(),
        username: username.trim() || null,
        password,
        imapHost: imapHost.trim(),
        imapPort: Number(imapPort),
        imapSecure,
        smtpHost: smtp || null,
        smtpPort: smtp ? Number(smtpPort) : null,
        smtpSecure: smtp ? smtpSecure : null,
        syncEmail,
        unmatched,
      };
      return account ? api.put<ConnectedAccountDTO>(`/api/integrations/imap/${account.id}`, body) : api.post<ConnectedAccountDTO>('/api/integrations/imap', body);
    },
    onSuccess: async (a) => {
      await invalidateIntegrations(qc);
      toast.success(account ? `${a.label} updated` : `${a.label} is connected`);
      onClose();
    },
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    save.mutate();
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={account ? `Edit ${account.label}` : 'Connect a mailbox'}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" type="submit" form="imap-form" loading={save.isPending}>
            {account ? 'Save' : 'Connect'}
          </Button>
        </>
      }
    >
      <form id="imap-form" onSubmit={submit} className="space-y-4" aria-label="Mailbox settings">
        <p className="text-sm text-slate-600">
          Works with any mailbox that offers IMAP. titoForce signs in to the servers before saving. Many providers, such as Gmail, iCloud and Yahoo, need an app password
          rather than your usual password.
        </p>
        <ErrorBanner error={save.error} />
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField label="Email address" htmlFor="imap-address" required>
            <input id="imap-address" className="input" type="email" autoComplete="email" required value={address} onChange={(e) => setAddress(e.target.value)} onBlur={guessServers} />
          </FormField>
          <FormField label="Password" htmlFor="imap-password" required={!account} help={account ? 'Leave empty to keep the saved password.' : undefined}>
            <input id="imap-password" className="input" type="password" autoComplete="off" required={!account} value={password} onChange={(e) => setPassword(e.target.value)} />
          </FormField>
        </div>
        <FormField label="Username" htmlFor="imap-username" help="Only if it differs from the email address.">
          <input id="imap-username" className="input" autoComplete="off" value={username} onChange={(e) => setUsername(e.target.value)} />
        </FormField>
        <fieldset className="space-y-2">
          <legend className="label">Incoming mail (IMAP)</legend>
          <div className="flex flex-wrap items-center gap-2">
            <input className="input min-w-0 flex-1" aria-label="IMAP server" placeholder="imap.example.com" required value={imapHost} onChange={(e) => setImapHost(e.target.value)} />
            <input className="input w-20" aria-label="IMAP port" type="number" min={1} max={65535} required value={imapPort} onChange={(e) => setImapPort(e.target.value)} />
            <Toggle checked={imapSecure} onChange={setImapSecure} label="SSL/TLS" />
          </div>
        </fieldset>
        <fieldset className="space-y-2">
          <legend className="label">Outgoing mail (SMTP)</legend>
          <div className="flex flex-wrap items-center gap-2">
            <input className="input min-w-0 flex-1" aria-label="SMTP server" placeholder="smtp.example.com" value={smtpHost} onChange={(e) => setSmtpHost(e.target.value)} />
            <input className="input w-20" aria-label="SMTP port" type="number" min={1} max={65535} required={!!smtpHost.trim()} value={smtpPort} onChange={(e) => setSmtpPort(e.target.value)} />
            <Toggle checked={smtpSecure} onChange={setSmtpSecure} label="SSL/TLS" />
          </div>
          <p className="text-xs text-slate-500">To send email from this mailbox; leave it empty to only log mail. Without SSL/TLS (usually port 587), the connection is upgraded with STARTTLS.</p>
        </fieldset>
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-slate-100 pt-4">
          <Toggle checked={syncEmail} onChange={setSyncEmail} label="Log emails with my contacts" />
          {syncEmail && (
            <label className="flex items-center gap-2 text-sm text-slate-700">
              Mail from unknown senders
              <select className="input h-8 w-auto py-0 text-sm" value={unmatched} onChange={(e) => setUnmatched(e.target.value as UnmatchedMailAction)}>
                {UNMATCHED.filter((o) => !o.object || o.value === unmatched || perms.canCreate(o.object)).map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>
      </form>
    </Modal>
  );
}

function IcsModal({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [url, setUrl] = useState('');
  const [label, setLabel] = useState('');
  const save = useMutation({
    mutationFn: () => api.post<ConnectedAccountDTO>('/api/integrations/ics', { url: url.trim(), label: label.trim() || null }),
    onSuccess: async (a) => {
      await invalidateIntegrations(qc);
      toast.success(`Subscribed to ${a.label}`);
      onClose();
    },
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    save.mutate();
  };
  return (
    <Modal
      open
      onClose={onClose}
      title="Subscribe to a calendar"
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" type="submit" form="ics-form" loading={save.isPending}>
            Subscribe
          </Button>
        </>
      }
    >
      <form id="ics-form" onSubmit={submit} className="space-y-4" aria-label="Calendar subscription">
        <p className="text-sm text-slate-600">
          Paste the secret iCal address of a calendar: in Google Calendar, it is under Settings › your calendar › Integrate calendar; in Outlook, under Settings › Calendar ›
          Shared calendars › Publish a calendar. titoForce reads it regularly and adds meetings with your contacts to their timelines. It cannot add events to it.
        </p>
        <ErrorBanner error={save.error} />
        <FormField label="Calendar address" htmlFor="ics-url" required>
          <input id="ics-url" className="input" type="text" inputMode="url" required placeholder="https://… or webcal://…" value={url} onChange={(e) => setUrl(e.target.value)} />
        </FormField>
        <FormField label="Name" htmlFor="ics-label" help="Optional, e.g. “Work calendar”. Defaults to the website the calendar comes from.">
          <input id="ics-label" className="input" maxLength={80} value={label} onChange={(e) => setLabel(e.target.value)} />
        </FormField>
      </form>
    </Modal>
  );
}

type Dialog = { kind: 'imap'; account?: ConnectedAccountDTO } | { kind: 'ics' } | null;

/** Mailboxes and calendars the user has connected, and buttons to connect more. */
export function ConnectedAccountsCard() {
  const status = useIntegrationStatus();
  const accounts = useConnectedAccounts({ poll: true });
  const [dialog, setDialog] = useState<Dialog>(null);
  const oauth = status.data?.oauth;
  const start = useMutation({
    mutationFn: (provider: 'google' | 'microsoft') => api.post<{ url: string }>(`/api/integrations/oauth/${provider}/start`),
    onSuccess: ({ url }) => window.location.assign(url),
  });
  const list = accounts.data ?? [];
  const interval = status.data?.syncIntervalMinutes;

  return (
    <Card
      title={
        <span className="flex items-center gap-2">
          <Plug className="size-4 text-slate-400" aria-hidden />
          Email and calendar
        </span>
      }
    >
      <div className="space-y-3">
        <SendingMode />
        <ErrorBanner error={accounts.error ?? start.error} />
        {accounts.isLoading ? (
          <Loading />
        ) : list.length > 0 ? (
          <ul className="divide-y divide-slate-100 border-y border-slate-100" aria-label="Connected accounts">
            {list.map((a) => (
              <AccountRow
                key={a.id}
                account={a}
                sending={status.data?.email.accountId === a.id}
                onEdit={() => setDialog({ kind: 'imap', account: a })}
                onReconnect={() => start.mutate(a.provider as 'google' | 'microsoft')}
              />
            ))}
          </ul>
        ) : null}
        <p className="text-xs text-slate-500">
          titoForce logs emails with your contacts, leads and accounts on their timelines, and imports meetings with them from your calendars
          {interval ? `, checking every ${plural(interval, 'minute')}` : ''}. A new mailbox is read from two weeks back; calendars from a month back to three months ahead.
        </p>
        <div className="flex flex-wrap gap-2">
          {oauth?.google && (
            <Button icon={Mail} loading={start.isPending && start.variables === 'google'} onClick={() => start.mutate('google')}>
              Connect Google
            </Button>
          )}
          {oauth?.microsoft && (
            <Button icon={Mail} loading={start.isPending && start.variables === 'microsoft'} onClick={() => start.mutate('microsoft')}>
              Connect Microsoft 365
            </Button>
          )}
          <Button icon={Inbox} onClick={() => setDialog({ kind: 'imap' })}>
            Connect a mailbox (IMAP)
          </Button>
          <Button icon={CalendarSync} onClick={() => setDialog({ kind: 'ics' })}>
            Subscribe to a calendar
          </Button>
        </div>
      </div>
      {dialog?.kind === 'imap' && <ImapModal account={dialog.account} onClose={() => setDialog(null)} />}
      {dialog?.kind === 'ics' && <IcsModal onClose={() => setDialog(null)} />}
    </Card>
  );
}

/** The user's own phone: click-to-call rings it first, and inbound calls are forwarded to it. */
export function PhoneCard() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const status = useIntegrationStatus();
  const [phone, setPhone] = useState(user.phone ?? '');
  const telephony = status.data?.telephony;
  const save = useMutation({
    mutationFn: (value: string | null) => api.put<UserDTO>('/api/integrations/phone', { phone: value }),
    onSuccess: async (u) => {
      setPhone(u.phone ?? '');
      await Promise.all([qc.invalidateQueries({ queryKey: ['session'] }), invalidateIntegrations(qc)]);
      toast.success(u.phone ? 'Phone number saved' : 'Phone number removed');
    },
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    save.mutate(phone.trim() || null);
  };
  return (
    <Card
      title={
        <span className="flex items-center gap-2">
          <Phone className="size-4 text-slate-400" aria-hidden />
          Phone
        </span>
      }
    >
      <form onSubmit={submit} className="space-y-3" aria-label="Phone">
        <ErrorBanner error={save.error} />
        <FormField label="Your phone number" htmlFor="my-phone" help="In international format, e.g. +1 415 555 0100.">
          <input id="my-phone" className="input" type="tel" autoComplete="tel" maxLength={40} value={phone} onChange={(e) => setPhone(e.target.value)} />
        </FormField>
        <p className="text-xs text-slate-500">
          {telephony?.twilio
            ? `When you click Call on a record, titoForce rings this phone first, then connects you. Calls to ${telephony.number ?? 'the company number'} from people whose records you own ring this phone too.`
            : 'Calling from titoForce is not set up on this server. You can still log calls by hand.'}
        </p>
        <div className="flex gap-2">
          <Button type="submit" variant="primary" loading={save.isPending && save.variables !== null} disabled={phone.trim() === (user.phone ?? '')}>
            Save
          </Button>
          {user.phone && (
            <Button variant="ghost" loading={save.isPending && save.variables === null} onClick={() => save.mutate(null)}>
              Remove
            </Button>
          )}
        </div>
      </form>
    </Card>
  );
}

/** A private iCal link to the user's meetings, calls and tasks for calendar apps. */
export function CalendarFeedCard() {
  const qc = useQueryClient();
  const toast = useToast();
  const confirm = useConfirm();
  const status = useIntegrationStatus();
  const [url, setUrl] = useState<string | null>(null);
  const enabled = status.data?.calendarFeed.enabled ?? false;
  const create = useMutation({
    mutationFn: () => api.post<{ url: string }>('/api/integrations/calendar-feed'),
    onSuccess: (r) => {
      setUrl(r.url);
      return invalidateIntegrations(qc);
    },
  });
  const remove = useMutation({
    mutationFn: () => api.del('/api/integrations/calendar-feed'),
    onSuccess: () => {
      setUrl(null);
      toast.success('Calendar link turned off');
      return invalidateIntegrations(qc);
    },
  });
  const renew = async () => {
    if (await confirm({ title: 'Create a new link?', message: 'The current link stops working. Calendars subscribed to it stop updating until you subscribe to the new one.', confirmLabel: 'Create new link' }))
      create.mutate();
  };
  const turnOff = async () => {
    if (await confirm({ title: 'Turn off the calendar link?', message: 'Calendars subscribed to it stop updating.', confirmLabel: 'Turn off', danger: true })) remove.mutate();
  };
  return (
    <Card
      title={
        <span className="flex items-center gap-2">
          <CalendarDays className="size-4 text-slate-400" aria-hidden />
          Calendar link
        </span>
      }
    >
      <div className="space-y-3">
        <p className="text-sm text-slate-600">
          Subscribe to your titoForce meetings, calls and tasks from Google Calendar, Outlook or Apple Calendar. Calendar apps refresh subscriptions on their own schedule, often
          only every few hours.
        </p>
        <ErrorBanner error={create.error ?? remove.error} />
        {url ? (
          <div className="space-y-1.5">
            <CopyField value={url} label="Calendar link" />
            <p className="text-xs text-amber-700">Copy it now: it is shown only once. Anyone with the link can see your schedule.</p>
          </div>
        ) : enabled ? (
          <p className="flex items-center gap-2 text-sm text-slate-700">
            <Badge color="green">On</Badge>
            Your link is active. For security, it is not shown again.
          </p>
        ) : null}
        <div className="flex flex-wrap gap-2">
          {enabled || url ? (
            <>
              <Button loading={create.isPending} onClick={() => void renew()}>
                Create new link
              </Button>
              <Button variant="ghost" loading={remove.isPending} onClick={() => void turnOff()}>
                Turn off
              </Button>
            </>
          ) : (
            <Button variant="primary" loading={create.isPending} disabled={status.isLoading} onClick={() => create.mutate()}>
              Create calendar link
            </Button>
          )}
        </div>
      </div>
    </Card>
  );
}
