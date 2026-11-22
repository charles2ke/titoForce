import type { CallState, CrmRecord, MeetingResult, ObjectDef, SendEmailRequest, SendEmailResult } from '@titoforce/shared';
import { CALL_OUTCOMES } from '@titoforce/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Paperclip, Phone, PhoneOff, Reply, Send, X } from 'lucide-react';
import { type FormEvent, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import { api } from '../../api.ts';
import { toDateInput } from '../../lib/format.ts';
import { invalidateRecordData } from '../../lib/hooks.ts';
import { CALENDAR_LABEL, contactPoints, formatBytes, formatDuration, readAsDataUrl, splitAddresses, useConnectedAccounts, useIntegrationStatus } from '../../lib/integrations.ts';
import { useToast } from '../feedback.tsx';
import { Button, cx, ErrorBanner, Popover, Toggle } from '../ui.tsx';
import { useRecordFiles } from './RecordFiles.tsx';

/** Prefills the email composer, e.g. to answer an email from the timeline. */
export interface EmailDraft {
  to: string[];
  subject: string;
  /** Activity id of the email being answered. */
  inReplyTo: string | null;
  replyingTo: string;
}

const refreshAfterWrite = (qc: ReturnType<typeof useQueryClient>) => Promise.all([invalidateRecordData(qc), qc.invalidateQueries({ queryKey: ['attachments'] })]);

// ---------- email ----------

export function EmailComposer({ def, record, draft, onCancelReply }: { def: ObjectDef; record: CrmRecord; draft: EmailDraft | null; onCancelReply: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const status = useIntegrationStatus();
  const accounts = useConnectedAccounts();
  const recordFiles = useRecordFiles(def, record);
  const [to, setTo] = useState(() => (draft?.to ?? contactPoints(def, record, 'email').slice(0, 1).map((p) => p.value)).join(', '));
  const [cc, setCc] = useState('');
  const [showCc, setShowCc] = useState(false);
  const [subject, setSubject] = useState(draft?.subject ?? '');
  const [body, setBody] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [attachmentIds, setAttachmentIds] = useState<string[]>([]);
  const [accountId, setAccountId] = useState('');
  const fileInput = useRef<HTMLInputElement>(null);
  const email = status.data?.email;
  const senders = (accounts.data ?? []).filter((a) => a.capabilities.sendEmail);
  const canSend = !!email && email.mode !== 'log';
  const maxBytes = status.data?.attachmentMaxBytes ?? null;
  const existing = (recordFiles.data ?? []).filter((f) => attachmentIds.includes(f.id));

  const send = useMutation({
    mutationFn: async (logOnly: boolean) => {
      const big = maxBytes ? files.find((f) => f.size > maxBytes) : undefined;
      if (big && maxBytes) throw new Error(`“${big.name}” is larger than the ${formatBytes(maxBytes)} limit`);
      const payload: SendEmailRequest = {
        recordId: record.id,
        to: splitAddresses(to),
        cc: splitAddresses(cc),
        subject: subject.trim(),
        body,
        accountId: logOnly ? null : accountId || null,
        inReplyTo: draft?.inReplyTo ?? null,
        files: await Promise.all(files.map(async (f) => ({ fileName: f.name, contentType: f.type || null, data: await readAsDataUrl(f) }))),
        attachmentIds,
        logOnly,
      };
      return api.post<SendEmailResult>('/api/email/send', payload);
    },
    onSuccess: async (res) => {
      setSubject('');
      setBody('');
      setCc('');
      setFiles([]);
      setAttachmentIds([]);
      if (draft) onCancelReply();
      await refreshAfterWrite(qc);
      toast.success(res.status === 'sent' ? 'Email sent' : 'Email logged');
    },
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    send.mutate(!canSend);
  };
  const addFiles = (list: FileList | null) => {
    // Copied now: the list is live and empties when the input is reset, before React runs the updater.
    const picked = list ? [...list] : [];
    if (picked.length) setFiles((prev) => [...prev, ...picked]);
    if (fileInput.current) fileInput.current.value = '';
  };

  return (
    <form onSubmit={submit} className="space-y-2" aria-label="Email">
      {draft && (
        <p className="flex items-center gap-1.5 rounded-md bg-slate-100 px-2 py-1 text-xs text-slate-600">
          <Reply className="size-3.5 shrink-0" aria-hidden />
          <span className="min-w-0 flex-1 truncate">Replying to “{draft.replyingTo}”</span>
          <button type="button" aria-label="Cancel reply" className="text-slate-400 hover:text-slate-700" onClick={onCancelReply}>
            <X className="size-3.5" />
          </button>
        </p>
      )}
      {email && (
        <div className="text-xs text-slate-500">
          {senders.length > 1 ? (
            <label className="flex items-center gap-2">
              From
              <select className="input h-7 w-auto py-0 text-xs" value={accountId || email.accountId || ''} onChange={(e) => setAccountId(e.target.value)}>
                {senders.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.address ?? a.label}
                  </option>
                ))}
              </select>
            </label>
          ) : email.mode === 'account' ? (
            <p>From {email.from}</p>
          ) : email.mode === 'relay' ? (
            <p>
              From {email.from} on your behalf; replies go to you.
            </p>
          ) : (
            <p className="rounded-md bg-amber-50 px-2 py-1 text-amber-800">
              Sending is not set up.{' '}
              <Link to="/settings" className="font-medium underline">
                Connect your mailbox
              </Link>{' '}
              to send from here, or log an email you sent elsewhere.
            </p>
          )}
        </div>
      )}
      <ErrorBanner error={send.error} />
      <div className="flex items-center gap-1">
        <input className="input" aria-label="To" placeholder="To" value={to} onChange={(e) => setTo(e.target.value)} />
        {!showCc && (
          <Button size="sm" variant="ghost" onClick={() => setShowCc(true)}>
            Cc
          </Button>
        )}
      </div>
      {showCc && <input className="input" aria-label="Cc" placeholder="Cc" value={cc} onChange={(e) => setCc(e.target.value)} />}
      <input className="input" aria-label="Subject" placeholder="Subject" maxLength={255} value={subject} onChange={(e) => setSubject(e.target.value)} />
      <textarea className="input min-h-24" aria-label="Message" placeholder={canSend ? 'Write your message' : 'What did you write? (optional)'} value={body} onChange={(e) => setBody(e.target.value)} />
      {(files.length > 0 || existing.length > 0) && (
        <ul className="flex flex-wrap gap-1" aria-label="Attachments">
          {files.map((f, i) => (
            <li key={`new:${i}`} className="inline-flex max-w-full items-center gap-1 rounded-md bg-slate-100 px-2 py-0.5 text-xs text-slate-700">
              <Paperclip className="size-3 shrink-0" aria-hidden />
              <span className="truncate">{f.name}</span>
              <span className="text-slate-400">{formatBytes(f.size)}</span>
              <button type="button" aria-label={`Remove ${f.name}`} className="text-slate-400 hover:text-slate-700" onClick={() => setFiles((prev) => prev.filter((_, j) => j !== i))}>
                <X className="size-3" />
              </button>
            </li>
          ))}
          {existing.map((f) => (
            <li key={f.id} className="inline-flex max-w-full items-center gap-1 rounded-md bg-slate-100 px-2 py-0.5 text-xs text-slate-700">
              <Paperclip className="size-3 shrink-0" aria-hidden />
              <span className="truncate">{f.fileName}</span>
              <button type="button" aria-label={`Remove ${f.fileName}`} className="text-slate-400 hover:text-slate-700" onClick={() => setAttachmentIds((prev) => prev.filter((id) => id !== f.id))}>
                <X className="size-3" />
              </button>
            </li>
          ))}
        </ul>
      )}
      <input ref={fileInput} type="file" multiple className="hidden" aria-label="Attach files" onChange={(e) => addFiles(e.target.files)} />
      <div className="flex items-center justify-between gap-2">
        <Popover
          className="w-64"
          trigger={({ toggle, open }) => (
            <Button size="sm" variant="ghost" icon={Paperclip} aria-expanded={open} onClick={toggle}>
              Attach
            </Button>
          )}
        >
          {(close) => (
            <div className="py-1">
              <button
                type="button"
                className="flex w-full px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-50"
                onClick={() => {
                  close();
                  fileInput.current?.click();
                }}
              >
                From your computer…
              </button>
              {(recordFiles.data?.length ?? 0) > 0 && (
                <div className="border-t border-slate-100 pt-1">
                  <p className="px-3 py-1 text-[11px] font-semibold tracking-wide text-slate-400 uppercase">Files of this record</p>
                  {recordFiles.data!.map((f) => {
                    const on = attachmentIds.includes(f.id);
                    return (
                      <button
                        key={f.id}
                        type="button"
                        role="menuitemcheckbox"
                        aria-checked={on}
                        className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm text-slate-700 hover:bg-slate-50"
                        onClick={() => setAttachmentIds((prev) => (on ? prev.filter((id) => id !== f.id) : [...prev, f.id]))}
                      >
                        <Check className={cx('size-3.5 shrink-0', on ? 'text-indigo-600' : 'invisible')} aria-hidden />
                        <span className="min-w-0 flex-1 truncate">{f.fileName}</span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </Popover>
        <div className="flex items-center gap-2">
          {canSend && (
            <Button size="sm" disabled={send.isPending} onClick={() => send.mutate(true)} title="Record the email without sending it">
              Log only
            </Button>
          )}
          <Button type="submit" size="sm" variant="primary" icon={canSend ? Send : undefined} loading={send.isPending}>
            {canSend ? 'Send' : 'Log email'}
          </Button>
        </div>
      </div>
    </form>
  );
}

// ---------- calls ----------

const FINAL = new Set(['completed', 'busy', 'no-answer', 'failed', 'canceled', 'logged']);

function callMessage({ call }: CallState, ownPhone: string | null): string {
  switch (call.status) {
    case 'queued':
      return `Calling your phone${ownPhone ? ` (${ownPhone})` : ''}. Answer it and press 1 to connect.`;
    case 'ringing':
      return `Calling ${call.to ?? 'the number'}…`;
    case 'in-progress':
      return `Connected to ${call.to ?? 'the number'}`;
    case 'completed':
      return call.durationSeconds ? `Call ended after ${formatDuration(call.durationSeconds)}` : 'Call ended';
    case 'busy':
      return `${call.to ?? 'The number'} was busy`;
    case 'no-answer':
      return 'No answer';
    case 'canceled':
      return 'The call was not connected';
    default:
      return 'The call failed';
  }
}

function CallProgress({ initial, ownPhone, onClose }: { initial: CallState; ownPhone: string | null; onClose: () => void }) {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ['call', initial.call.id],
    queryFn: () => api.get<CallState>(`/api/calls/${initial.call.id}`),
    initialData: initial,
    refetchInterval: (query) => (FINAL.has(query.state.data?.call.status ?? '') ? false : 2000),
  });
  const state = q.data;
  const final = FINAL.has(state.call.status);
  // The call is logged on the timeline once it rings the other party, and updated when it ends.
  useEffect(() => {
    void invalidateRecordData(qc);
  }, [state.call.status, qc]);
  return (
    <div role="status" className={cx('flex items-center gap-2 rounded-lg px-3 py-2 text-sm', final ? 'bg-slate-100 text-slate-700' : 'bg-sky-50 text-sky-800')}>
      {final ? <PhoneOff className="size-4 shrink-0" aria-hidden /> : <Phone className="size-4 shrink-0 animate-pulse" aria-hidden />}
      <span className="min-w-0 flex-1">{callMessage(state, ownPhone)}</span>
      {final && (
        <button type="button" aria-label="Dismiss" className="text-slate-400 hover:text-slate-700" onClick={onClose}>
          <X className="size-4" />
        </button>
      )}
    </div>
  );
}

export function CallComposer({ def, record }: { def: ObjectDef; record: CrmRecord }) {
  const qc = useQueryClient();
  const toast = useToast();
  const status = useIntegrationStatus();
  const phones = contactPoints(def, record, 'phone');
  const [number, setNumber] = useState(phones[0]?.value ?? '');
  const [active, setActive] = useState<CallState | null>(null);
  const [direction, setDirection] = useState<'outbound' | 'inbound'>('outbound');
  const [outcome, setOutcome] = useState('');
  const [minutes, setMinutes] = useState('');
  const [subject, setSubject] = useState('');
  const [notes, setNotes] = useState('');
  const telephony = status.data?.telephony;
  const listId = `phones-${record.id}`;

  const start = useMutation({
    mutationFn: () => api.post<CallState>('/api/calls', { recordId: record.id, phone: number.trim() }),
    onSuccess: setActive,
  });
  const log = useMutation({
    mutationFn: () =>
      api.post<CallState>('/api/calls/log', {
        recordId: record.id,
        direction,
        subject: subject.trim() || null,
        outcome: outcome || null,
        durationSeconds: minutes ? Math.round(Number(minutes) * 60) : null,
        notes: notes.trim() || null,
        phone: number.trim() || null,
      }),
    onSuccess: async () => {
      setSubject('');
      setNotes('');
      setOutcome('');
      setMinutes('');
      await invalidateRecordData(qc);
      toast.success('Call logged');
    },
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    log.mutate();
  };

  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <div className="flex items-center gap-2">
          <input className="input" aria-label="Phone number" placeholder="Phone number" list={listId} value={number} onChange={(e) => setNumber(e.target.value)} />
          <datalist id={listId}>
            {phones.map((p) => (
              <option key={p.value} value={p.value}>
                {p.label}
              </option>
            ))}
          </datalist>
          {telephony?.twilio && (
            <Button
              variant="primary"
              size="sm"
              icon={Phone}
              loading={start.isPending}
              disabled={!telephony.ready || !number.trim() || (!!active && !FINAL.has(active.call.status))}
              onClick={() => start.mutate()}
            >
              Call
            </Button>
          )}
        </div>
        <ErrorBanner error={start.error} />
        {active ? (
          <CallProgress key={active.call.id} initial={active} ownPhone={telephony?.phone ?? null} onClose={() => setActive(null)} />
        ) : telephony?.twilio && !telephony.ready ? (
          <p className="text-xs text-slate-500">
            <Link to="/settings" className="font-medium text-indigo-600 hover:underline">
              Add your phone number
            </Link>{' '}
            to call from titoForce: it rings your phone, then connects you.
          </p>
        ) : telephony?.ready ? (
          <p className="text-xs text-slate-500">titoForce rings your phone ({telephony.phone}) first, then connects you.</p>
        ) : null}
      </div>
      <form onSubmit={submit} className="space-y-2 border-t border-slate-100 pt-3" aria-label="Log a call">
        <ErrorBanner error={log.error} />
        <div className="flex flex-wrap gap-2">
          <select className="input h-8 w-auto py-0 text-xs" aria-label="Direction" value={direction} onChange={(e) => setDirection(e.target.value as 'outbound' | 'inbound')}>
            <option value="outbound">Outbound</option>
            <option value="inbound">Inbound</option>
          </select>
          <select className="input h-8 w-auto py-0 text-xs" aria-label="Outcome" value={outcome} onChange={(e) => setOutcome(e.target.value)}>
            <option value="">Outcome…</option>
            {CALL_OUTCOMES.map((o) => (
              <option key={o} value={o}>
                {o}
              </option>
            ))}
          </select>
          <label className="flex items-center gap-1 text-xs text-slate-500">
            <input className="input h-8 w-16 py-0 text-xs" type="number" min={0} max={1440} step={1} aria-label="Duration in minutes" value={minutes} onChange={(e) => setMinutes(e.target.value)} />
            min
          </label>
        </div>
        <input className="input" aria-label="Subject" placeholder="Call subject" maxLength={255} value={subject} onChange={(e) => setSubject(e.target.value)} />
        <textarea className="input min-h-16" aria-label="Notes" placeholder="What happened? (optional)" value={notes} onChange={(e) => setNotes(e.target.value)} />
        <div className="flex justify-end">
          <Button type="submit" size="sm" variant={telephony?.twilio ? 'secondary' : 'primary'} loading={log.isPending}>
            Log call
          </Button>
        </div>
      </form>
    </div>
  );
}

// ---------- meetings ----------

const DURATIONS = [
  { minutes: 15, label: '15 min' },
  { minutes: 30, label: '30 min' },
  { minutes: 45, label: '45 min' },
  { minutes: 60, label: '1 hour' },
  { minutes: 90, label: '1.5 hours' },
  { minutes: 120, label: '2 hours' },
  { minutes: 240, label: '4 hours' },
];

const pad = (n: number) => String(n).padStart(2, '0');

function nextHalfHour(): Date {
  const d = new Date();
  d.setSeconds(0, 0);
  d.setMinutes(d.getMinutes() < 30 ? 30 : 60);
  return d;
}

export function MeetingComposer({ def, record }: { def: ObjectDef; record: CrmRecord }) {
  const qc = useQueryClient();
  const toast = useToast();
  const accounts = useConnectedAccounts();
  const calendars = (accounts.data ?? []).filter((a) => a.capabilities.exportEvents);
  const [initial] = useState(nextHalfHour);
  const [subject, setSubject] = useState('');
  const [date, setDate] = useState(toDateInput(initial));
  const [time, setTime] = useState(`${pad(initial.getHours())}:${pad(initial.getMinutes())}`);
  const [duration, setDuration] = useState(30);
  const [location, setLocation] = useState('');
  const [attendees, setAttendees] = useState(() => contactPoints(def, record, 'email').slice(0, 1).map((p) => p.value).join(', '));
  const [description, setDescription] = useState('');
  const [accountId, setAccountId] = useState('');
  const [invite, setInvite] = useState(true);

  const create = useMutation({
    mutationFn: () => {
      const start = new Date(`${date}T${time}`);
      if (Number.isNaN(start.getTime())) throw new Error('Choose the date and time of the meeting');
      return api.post<MeetingResult>('/api/meetings', {
        recordId: record.id,
        subject: subject.trim() || `Meeting with ${record.name}`.slice(0, 255),
        start: start.toISOString(),
        end: new Date(start.getTime() + duration * 60_000).toISOString(),
        location: location.trim() || null,
        description: description.trim() || null,
        attendees: splitAddresses(attendees),
        accountId: accountId || null,
        sendInvites: !!accountId && invite,
      });
    },
    onSuccess: async (res) => {
      setSubject('');
      setLocation('');
      setDescription('');
      await invalidateRecordData(qc);
      if (res.calendarError) toast.error(`Meeting saved, but your calendar did not accept it: ${res.calendarError}`);
      else toast.success(res.calendar ? `Meeting added to ${CALENDAR_LABEL[res.calendar.provider]}` : 'Meeting scheduled');
    },
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    create.mutate();
  };

  return (
    <form onSubmit={submit} className="space-y-2" aria-label="Schedule a meeting">
      <ErrorBanner error={create.error} />
      <input className="input" aria-label="Subject" placeholder="Meeting subject" maxLength={255} value={subject} onChange={(e) => setSubject(e.target.value)} />
      <div className="flex flex-wrap gap-2">
        <input type="date" className="input h-8 w-auto py-0 text-xs" aria-label="Date" required value={date} onChange={(e) => setDate(e.target.value)} />
        <input type="time" className="input h-8 w-auto py-0 text-xs" aria-label="Start time" required value={time} onChange={(e) => setTime(e.target.value)} />
        <select className="input h-8 w-auto py-0 text-xs" aria-label="Duration" value={duration} onChange={(e) => setDuration(Number(e.target.value))}>
          {DURATIONS.map((d) => (
            <option key={d.minutes} value={d.minutes}>
              {d.label}
            </option>
          ))}
        </select>
      </div>
      <input className="input" aria-label="Location" placeholder="Location or video link (optional)" maxLength={255} value={location} onChange={(e) => setLocation(e.target.value)} />
      <input className="input" aria-label="Attendees" placeholder="Attendees’ email addresses" value={attendees} onChange={(e) => setAttendees(e.target.value)} />
      <textarea className="input min-h-16" aria-label="Notes" placeholder="Agenda (optional)" value={description} onChange={(e) => setDescription(e.target.value)} />
      <div className="flex flex-wrap items-center justify-between gap-2">
        {calendars.length > 0 ? (
          <div className="flex flex-wrap items-center gap-2">
            <select className="input h-8 w-auto max-w-48 py-0 text-xs" aria-label="Calendar" value={accountId} onChange={(e) => setAccountId(e.target.value)}>
              <option value="">Only in titoForce</option>
              {calendars.map((a) => (
                <option key={a.id} value={a.id}>
                  {CALENDAR_LABEL[a.provider]} · {a.address ?? a.label}
                </option>
              ))}
            </select>
            {accountId && <Toggle checked={invite} onChange={setInvite} label="Invite attendees" />}
          </div>
        ) : (
          <span />
        )}
        <Button type="submit" size="sm" variant="primary" loading={create.isPending}>
          Schedule meeting
        </Button>
      </div>
    </form>
  );
}
