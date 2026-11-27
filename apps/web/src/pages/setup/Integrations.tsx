import type { AdminIntegrationStatus, IntegrationProvider } from '@titoforce/shared';
import { useQuery } from '@tanstack/react-query';
import { CalendarDays, KeyRound, Mail, Paperclip, Phone, Send } from 'lucide-react';
import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { api } from '../../api.ts';
import { Badge, Card, CopyField, ErrorBanner, Loading, PageHeader } from '../../components/ui.tsx';
import { formatBytes, PROVIDER_LABEL } from '../../lib/integrations.ts';
import { plural } from '../../lib/format.ts';

function Status({ on, onLabel = 'Configured', offLabel = 'Not configured' }: { on: boolean; onLabel?: string; offLabel?: string }) {
  return <Badge color={on ? 'green' : 'gray'}>{on ? onLabel : offLabel}</Badge>;
}

function Env({ names }: { names: string[] }) {
  return (
    <p className="flex flex-wrap items-center gap-1.5 text-xs text-slate-500">
      Set with
      {names.map((n) => (
        <code key={n} className="rounded bg-slate-100 px-1.5 py-0.5 text-[11px] text-slate-700">
          {n}
        </code>
      ))}
    </p>
  );
}

function Section({ icon: IconCmp, title, status, children }: { icon: typeof Mail; title: string; status?: ReactNode; children: ReactNode }) {
  return (
    <Card
      title={
        <span className="flex items-center gap-2">
          <IconCmp className="size-4 text-slate-400" aria-hidden />
          {title}
        </span>
      }
      actions={status}
    >
      <div className="space-y-3 text-sm text-slate-600">{children}</div>
    </Card>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="space-y-1">
      <p className="text-xs font-medium text-slate-500">{label}</p>
      {children}
    </div>
  );
}

const ORDER: IntegrationProvider[] = ['google', 'microsoft', 'imap', 'ics'];

export default function SetupIntegrations() {
  const q = useQuery({ queryKey: ['integrations', 'admin'], queryFn: () => api.get<AdminIntegrationStatus>('/api/integrations/admin') });
  const s = q.data;
  return (
    <div className="mx-auto max-w-5xl p-6">
      <PageHeader title="Integrations" subtitle="Email, calendars, phone calls and files. Providers are configured with server environment variables." />
      {q.isLoading ? (
        <Loading />
      ) : q.error ? (
        <ErrorBanner error={q.error} />
      ) : s ? (
        <div className="space-y-5">
          <p className="text-sm text-slate-600">
            People connect their own mailboxes and calendars, add their phone number and get a calendar link in{' '}
            <Link to="/settings" className="text-indigo-600 hover:underline">
              My settings
            </Link>
            .
          </p>

          <Section icon={KeyRound} title="Server" status={<Status on={s.secretKey} onLabel="Secret key set" offLabel="No secret key" />}>
            <Field label="Public address">
              <CopyField value={s.publicUrl} label="Public address" />
            </Field>
            <p>Google and Microsoft sign-in, calendar links and Twilio webhooks use this address, so it must be the one people and providers reach titoForce at.</p>
            {!s.secretKey && (
              <p className="rounded-md bg-amber-50 px-3 py-2 text-amber-800">
                Passwords and tokens of connected accounts are encrypted with a key stored in the database. Set a secret key so that a copy of the database alone does not expose
                them. In production, accounts cannot be connected until it is set.
              </p>
            )}
            <Env names={['TITO_PUBLIC_URL', 'TITO_SECRET_KEY']} />
          </Section>

          <div className="grid gap-5 @3xl:grid-cols-2">
            <Section icon={Send} title="Email relay" status={<Status on={s.smtpRelay.configured} />}>
              <p>
                {s.smtpRelay.configured ? (
                  <>
                    People without a connected mailbox send from <span className="font-medium text-slate-900">{s.smtpRelay.from}</span>, with replies going to their own
                    address.
                  </>
                ) : (
                  'Without a relay, only people who connect a mailbox can send email from titoForce. Everyone can still log emails.'
                )}
              </p>
              <Env names={['TITO_SMTP_URL', 'TITO_EMAIL_FROM']} />
            </Section>

            <Section icon={Paperclip} title="Sync and files">
              <p>
                {s.syncIntervalMinutes > 0 ? `Connected accounts are synced every ${plural(s.syncIntervalMinutes, 'minute')}.` : 'Automatic sync is off; people sync accounts by hand.'}{' '}
                Files can be up to {formatBytes(s.attachmentMaxBytes)} each.
              </p>
              <Env names={['TITO_SYNC_INTERVAL_MINUTES', 'TITO_ATTACHMENT_MAX_MB']} />
            </Section>

            <Section icon={Mail} title="Google" status={<Status on={s.google} />}>
              <p>Gmail and Google Calendar. In Google Cloud, enable the Gmail API and Google Calendar API, and create an OAuth client of type “Web application” with this redirect URI:</p>
              <CopyField value={s.oauthRedirects.google} label="Google redirect URI" />
              <p className="text-xs text-slate-500">
                titoForce asks to read Gmail, which Google treats as a restricted scope: unless the OAuth app is internal to your Google Workspace, Google has to verify it before
                other people can connect.
              </p>
              <Env names={['TITO_GOOGLE_CLIENT_ID', 'TITO_GOOGLE_CLIENT_SECRET']} />
            </Section>

            <Section icon={Mail} title="Microsoft 365" status={<Status on={s.microsoft} />}>
              <p>Outlook mail and calendar through Microsoft Graph. Register an app in Microsoft Entra ID with a client secret and this Web redirect URI:</p>
              <CopyField value={s.oauthRedirects.microsoft} label="Microsoft redirect URI" />
              <p className="text-xs text-slate-500">
                Delegated permissions: User.Read, Mail.Read, Mail.Send, Calendars.ReadWrite and offline_access. Unless TITO_MICROSOFT_TENANT is set to your tenant ID, the app
                must accept accounts in any organizational directory.
              </p>
              <Env names={['TITO_MICROSOFT_CLIENT_ID', 'TITO_MICROSOFT_CLIENT_SECRET', 'TITO_MICROSOFT_TENANT']} />
            </Section>
          </div>

          <Section icon={Phone} title="Twilio phone calls" status={<Status on={s.twilio.configured} />}>
            {s.twilio.configured ? (
              <p>
                Calls go out from <span className="font-medium text-slate-900">{s.twilio.number}</span>. Click-to-call rings the person's own phone first; when they press 1, Twilio
                connects the customer. Calls to the number ring the owner of the caller's record; unknown callers, and owners without a phone number, fall back to the first administrator.
              </p>
            ) : (
              <p>Click-to-call and inbound call logging. Without Twilio, people log calls by hand.</p>
            )}
            <Field label="“A call comes in” webhook of the number (HTTP POST)">
              <CopyField value={s.twilio.inboundWebhook} label="Twilio voice webhook" />
            </Field>
            <p className="text-xs text-slate-500">titoForce sets status callbacks on each call itself. Requests are checked against Twilio's signature, which covers the public address.</p>
            <Env names={['TITO_TWILIO_ACCOUNT_SID', 'TITO_TWILIO_AUTH_TOKEN', 'TITO_TWILIO_NUMBER', 'TITO_DEFAULT_CALLING_CODE']} />
          </Section>

          <Section icon={CalendarDays} title="Connected accounts">
            {s.accounts.length === 0 ? (
              <p>Nobody has connected a mailbox or calendar yet.</p>
            ) : (
              <table className="w-full text-sm" aria-label="Connected accounts by provider">
                <thead>
                  <tr className="text-left text-xs text-slate-500">
                    <th className="py-1.5 font-medium">Provider</th>
                    <th className="py-1.5 text-right font-medium">Accounts</th>
                    <th className="py-1.5 text-right font-medium">With sync errors</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {[...s.accounts]
                    .sort((a, b) => ORDER.indexOf(a.provider) - ORDER.indexOf(b.provider))
                    .map((a) => (
                      <tr key={a.provider}>
                        <td className="py-2 text-slate-900">{PROVIDER_LABEL[a.provider]}</td>
                        <td className="py-2 text-right tabular-nums">{a.total.toLocaleString()}</td>
                        <td className="py-2 text-right tabular-nums">{a.failing ? <Badge color="red">{a.failing.toLocaleString()}</Badge> : '0'}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            )}
          </Section>
        </div>
      ) : null}
    </div>
  );
}
