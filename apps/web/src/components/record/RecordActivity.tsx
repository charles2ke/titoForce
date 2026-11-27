import type { CallDetails, CrmRecord, EmailDetails, MeetingDetails, ObjectDef, RefMap, TimelineItem } from '@titoforce/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowDownLeft, ArrowUpRight, Bot, Circle, CircleCheck, History, Mail, MapPin, Paperclip, Phone, Reply, SquareCheckBig, StickyNote, Users, Workflow } from 'lucide-react';
import { type FormEvent, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import { api, errorMessage } from '../../api.ts';
import { formatDate, formatDateTime, parseDate, plural, relativeTime, todayIso } from '../../lib/format.ts';
import { invalidateRecordData, useObjectDef, usePermissions } from '../../lib/hooks.ts';
import { CALENDAR_LABEL, formatBytes, formatDuration } from '../../lib/integrations.ts';
import { Markdown } from '../../lib/markdown.tsx';
import { useToast } from '../feedback.tsx';
import { Badge, Button, Card, cx, ErrorBanner, Loading } from '../ui.tsx';
import { CallComposer, type EmailDraft, EmailComposer, MeetingComposer } from './ActivityComposers.tsx';
import { downloadUrl } from './RecordFiles.tsx';

const TYPE_ICON: Record<string, typeof Phone> = { Call: Phone, Email: Mail, Meeting: Users, Task: SquareCheckBig, Note: StickyNote };
const TYPE_TINT: Record<string, string> = {
  Call: 'bg-sky-100 text-sky-700',
  Email: 'bg-teal-100 text-teal-700',
  Meeting: 'bg-violet-100 text-violet-700',
  Task: 'bg-orange-100 text-orange-700',
  Note: 'bg-slate-200 text-slate-700',
};
/** Activity types that are planned (open, with a due date) rather than logged after the fact. */
const PLANNED = new Set(['Task', 'Meeting']);

type Filter = 'all' | 'activity' | 'history' | 'agent';

function display(v: unknown): string {
  if (v === null || v === undefined || v === '') return '—';
  if (Array.isArray(v)) return v.join(', ');
  if (typeof v === 'boolean') return v ? 'Yes' : 'No';
  if (typeof v === 'number') return v.toLocaleString();
  const s = String(v);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? formatDate(s) : /^\d{4}-\d{2}-\d{2}T/.test(s) ? formatDateTime(s) : s;
}

function Composer({ def, record, draft, draftKey, onCancelReply }: { def: ObjectDef; record: CrmRecord; draft: EmailDraft | null; draftKey: number; onCancelReply: () => void }) {
  const { def: activity } = useObjectDef('activity');
  const types = activity?.fields.find((f) => f.apiName === 'type')?.options?.map((o) => o.value) ?? ['Call', 'Email', 'Meeting', 'Task', 'Note'];
  const [type, setType] = useState(types.includes('Call') ? 'Call' : types[0]!);
  useEffect(() => {
    if (draft) setType('Email');
  }, [draft]);
  return (
    <div className="space-y-2">
      <div role="radiogroup" aria-label="Activity type" className="flex flex-wrap gap-1">
        {types.map((t) => {
          const IconCmp = TYPE_ICON[t] ?? StickyNote;
          return (
            <button
              key={t}
              type="button"
              role="radio"
              aria-checked={type === t}
              onClick={() => setType(t)}
              className={cx('inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium', type === t ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200')}
            >
              <IconCmp className="size-3.5" aria-hidden />
              {t}
            </button>
          );
        })}
      </div>
      {type === 'Email' ? (
        <EmailComposer key={draftKey} def={def} record={record} draft={draft} onCancelReply={onCancelReply} />
      ) : type === 'Call' ? (
        <CallComposer def={def} record={record} />
      ) : type === 'Meeting' ? (
        <MeetingComposer def={def} record={record} />
      ) : (
        <ActivityComposer key={type} type={type} record={record} />
      )}
    </div>
  );
}

/** Tasks, notes and custom activity types. */
function ActivityComposer({ type, record }: { type: string; record: CrmRecord }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [subject, setSubject] = useState('');
  const [due, setDue] = useState(todayIso());
  const [description, setDescription] = useState('');
  const planned = PLANNED.has(type);
  const create = useMutation({
    mutationFn: () =>
      api.post('/api/records/activity', {
        fields: {
          subject: subject.trim() || `${type} with ${record.name}`.slice(0, 255),
          type,
          status: planned ? 'Open' : 'Completed',
          due_date: planned ? due || null : todayIso(),
          related_to: record.id,
          description: description.trim() || null,
        },
      }),
    onSuccess: async () => {
      setSubject('');
      setDescription('');
      await invalidateRecordData(qc);
      toast.success(planned ? `${type} scheduled` : `${type} logged`);
    },
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    create.mutate();
  };
  return (
    <form onSubmit={submit} className="space-y-2" aria-label="Log activity">
      <ErrorBanner error={create.error} />
      <input className="input" aria-label="Subject" placeholder={`${type} subject`} maxLength={255} value={subject} onChange={(e) => setSubject(e.target.value)} />
      <textarea className="input min-h-16" aria-label="Notes" placeholder={planned ? 'Details (optional)' : 'What happened? (optional)'} value={description} onChange={(e) => setDescription(e.target.value)} />
      <div className="flex items-center justify-between gap-2">
        {planned ? (
          <label className="flex items-center gap-2 text-xs text-slate-500">
            Due
            <input type="date" className="input h-8 w-auto py-0 text-xs" value={due} onChange={(e) => setDue(e.target.value)} />
          </label>
        ) : (
          <span />
        )}
        <Button type="submit" size="sm" variant="primary" loading={create.isPending}>
          {planned ? `Add ${type.toLowerCase()}` : `Log ${type.toLowerCase()}`}
        </Button>
      </div>
    </form>
  );
}

function ActivityItem({ item, onReply }: { item: TimelineItem; onReply?: (item: TimelineItem) => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const IconCmp = TYPE_ICON[item.activityType ?? ''] ?? StickyNote;
  const open = item.status === 'Open';
  const overdue = open && item.dueDate && item.dueDate < todayIso();
  const toggle = useMutation({
    mutationFn: () => api.patch(`/api/records/activity/${item.recordId}`, { fields: { status: open ? 'Completed' : 'Open' } }),
    onSuccess: () => invalidateRecordData(qc),
    onError: (err) => toast.error(errorMessage(err)),
  });
  return (
    <>
      <span className={cx('grid size-7 shrink-0 place-items-center rounded-full', TYPE_TINT[item.activityType ?? ''] ?? TYPE_TINT.Note)}>
        <IconCmp className="size-3.5" aria-hidden />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-start gap-2">
          {item.status && (
            <button
              type="button"
              onClick={() => toggle.mutate()}
              disabled={toggle.isPending}
              aria-label={open ? `Mark “${item.title}” complete` : `Reopen “${item.title}”`}
              className="mt-0.5 text-slate-400 hover:text-emerald-600"
            >
              {open ? <Circle className="size-4" /> : <CircleCheck className="size-4 text-emerald-600" />}
            </button>
          )}
          <Link to={`/r/${item.recordId}`} className={cx('min-w-0 text-sm font-medium hover:underline', open ? 'text-slate-900' : 'text-slate-500 line-through decoration-slate-300')}>
            {item.title}
          </Link>
        </div>
        <p className="mt-0.5 text-xs text-slate-500">
          {item.activityType} · {item.actorName ?? 'Someone'} · <span title={formatDateTime(item.at)}>{relativeTime(item.at)}</span>
          {item.dueDate && !item.meeting?.start && (
            <span className={cx('ml-1', overdue && 'font-medium text-rose-600')}>
              · {overdue ? 'Overdue, due' : 'Due'} {formatDate(item.dueDate)}
            </span>
          )}
        </p>
        {item.email && <EmailMeta email={item.email} />}
        {item.call && <CallMeta call={item.call} />}
        {item.meeting && <MeetingMeta meeting={item.meeting} />}
        {item.body && <p className="mt-1 line-clamp-3 text-sm whitespace-pre-wrap text-slate-600">{item.body}</p>}
        {item.attachments && item.attachments.length > 0 && (
          <ul className="mt-1.5 flex flex-wrap gap-1" aria-label={`Attachments of ${item.title}`}>
            {item.attachments.map((a) => (
              <li key={a.id} className="max-w-full">
                <a
                  href={downloadUrl(a.id)}
                  download={a.fileName}
                  className="inline-flex max-w-full items-center gap-1 rounded-md bg-slate-100 px-2 py-0.5 text-xs text-slate-700 hover:bg-slate-200"
                >
                  <Paperclip className="size-3 shrink-0" aria-hidden />
                  <span className="truncate">{a.fileName}</span>
                  <span className="text-slate-400">{formatBytes(a.size)}</span>
                </a>
              </li>
            ))}
          </ul>
        )}
        {item.email && onReply && (
          <button type="button" onClick={() => onReply(item)} className="mt-1 inline-flex items-center gap-1 text-xs font-medium text-indigo-600 hover:underline">
            <Reply className="size-3.5" aria-hidden />
            Reply<span className="sr-only"> to “{item.title}”</span>
          </button>
        )}
      </div>
    </>
  );
}

const EMAIL_STATUS: Record<EmailDetails['status'], { label: string; color: string }> = {
  sent: { label: 'Sent', color: 'green' },
  received: { label: 'Received', color: 'blue' },
  logged: { label: 'Logged', color: 'gray' },
};

function EmailMeta({ email }: { email: EmailDetails }) {
  const inbound = email.direction === 'inbound';
  const status = EMAIL_STATUS[email.status];
  const who = inbound ? `From ${email.fromName ? `${email.fromName} <${email.from}>` : email.from}` : `To ${[...email.to, ...email.cc].join(', ')}`;
  return (
    <p className="mt-1 flex min-w-0 items-center gap-1.5 text-xs text-slate-500">
      {inbound ? <ArrowDownLeft className="size-3.5 shrink-0 text-teal-600" aria-label="Inbound" /> : <ArrowUpRight className="size-3.5 shrink-0 text-teal-600" aria-label="Outbound" />}
      <span className="min-w-0 truncate" title={who}>
        {who}
      </span>
      <Badge color={status.color}>{status.label}</Badge>
    </p>
  );
}

const LIVE_CALL: Partial<Record<CallDetails['status'], string>> = { queued: 'Calling', ringing: 'Ringing', 'in-progress': 'In progress' };

function CallMeta({ call }: { call: CallDetails }) {
  const number = call.direction === 'inbound' ? call.from : call.to;
  const parts = [call.direction === 'inbound' ? 'Inbound' : 'Outbound', call.outcome, call.durationSeconds ? formatDuration(call.durationSeconds) : null, number].filter(Boolean);
  const live = LIVE_CALL[call.status];
  return (
    <p className="mt-1 flex min-w-0 items-center gap-1.5 text-xs text-slate-500">
      {call.direction === 'inbound' ? <ArrowDownLeft className="size-3.5 shrink-0 text-sky-600" aria-hidden /> : <ArrowUpRight className="size-3.5 shrink-0 text-sky-600" aria-hidden />}
      <span className="min-w-0 truncate">{parts.join(' · ')}</span>
      {live && <Badge color="blue">{live}</Badge>}
    </p>
  );
}

function meetingTime(start: string, end: string | null): string {
  const s = parseDate(start);
  if (!s) return start;
  const day = (d: Date) => d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: d.getFullYear() === new Date().getFullYear() ? undefined : 'numeric' });
  const time = (d: Date) => d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  const e = end ? parseDate(end) : null;
  if (!e) return `${day(s)}, ${time(s)}`;
  return s.toDateString() === e.toDateString() ? `${day(s)}, ${time(s)} – ${time(e)}` : `${day(s)}, ${time(s)} – ${day(e)}, ${time(e)}`;
}

function MeetingMeta({ meeting }: { meeting: MeetingDetails }) {
  const attendees = meeting.attendees.length;
  return (
    <div className="mt-1 space-y-0.5 text-xs text-slate-500">
      {meeting.start && (
        <p className="flex flex-wrap items-center gap-1.5">
          <span>{meetingTime(meeting.start, meeting.end)}</span>
          {meeting.calendar && <Badge color="purple">{CALENDAR_LABEL[meeting.calendar.provider]}</Badge>}
        </p>
      )}
      {(meeting.location || attendees > 0) && (
        <p className="flex min-w-0 items-center gap-1.5">
          {meeting.location && (
            <>
              <MapPin className="size-3.5 shrink-0" aria-hidden />
              <span className="min-w-0 truncate">{meeting.location}</span>
            </>
          )}
          {attendees > 0 && (
            <span className="shrink-0" title={meeting.attendees.join(', ')}>
              {meeting.location && '· '}
              {plural(attendees, 'attendee')}
            </span>
          )}
        </p>
      )}
    </div>
  );
}

function historyVerb(item: TimelineItem): string {
  if (item.title === 'Fields updated') return `updated ${plural(item.changes?.length ?? 0, 'field')}`;
  if (item.title.endsWith(' created')) return 'created this record';
  return item.title.toLowerCase();
}

function HistoryItem({ item }: { item: TimelineItem }) {
  const IconCmp = item.actorType === 'automation' || item.actorType === 'approval' ? Workflow : item.actorType === 'agent' ? Bot : History;
  return (
    <>
      <span className="grid size-7 shrink-0 place-items-center rounded-full bg-slate-100 text-slate-500">
        <IconCmp className="size-3.5" aria-hidden />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm text-slate-700">
          <span className="font-medium">{item.actorName ?? 'System'}</span> {historyVerb(item)}
          {item.actorType && item.actorType !== 'user' && <Badge className="ml-1.5">{item.actorType}</Badge>}
        </p>
        {item.changes && item.changes.length > 0 && (
          <ul className="mt-1 space-y-0.5 text-xs text-slate-500">
            {item.changes.slice(0, 8).map((c) => (
              <li key={c.field} className="truncate">
                <span className="font-medium text-slate-600">{c.label}:</span> {display(c.from)} → <span className="text-slate-700">{display(c.to)}</span>
              </li>
            ))}
            {item.changes.length > 8 && <li>…and {item.changes.length - 8} more</li>}
          </ul>
        )}
        <p className="mt-0.5 text-xs text-slate-400" title={formatDateTime(item.at)}>
          {relativeTime(item.at)}
        </p>
      </div>
    </>
  );
}

function AgentItem({ item }: { item: TimelineItem }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <>
      <span className="grid size-7 shrink-0 place-items-center rounded-full bg-violet-100 text-violet-700">
        <Bot className="size-3.5" aria-hidden />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm text-slate-700">
          <span className="font-medium">{item.title}</span>
          {item.status && item.status !== 'completed' && (
            <Badge color={item.status === 'failed' ? 'red' : 'yellow'} className="ml-1.5">
              {item.status}
            </Badge>
          )}
        </p>
        {item.body && (
          <div className={cx('mt-1 overflow-hidden text-sm text-slate-600', !expanded && 'max-h-24')}>
            <Markdown text={item.body} />
          </div>
        )}
        <p className="mt-0.5 flex gap-2 text-xs text-slate-400">
          <span title={formatDateTime(item.at)}>{relativeTime(item.at)}</span>
          {item.body && item.body.length > 240 && (
            <button type="button" className="font-medium text-indigo-600 hover:underline" onClick={() => setExpanded((e) => !e)}>
              {expanded ? 'Show less' : 'Show more'}
            </button>
          )}
        </p>
      </div>
    </>
  );
}

export function ActivityPanel({ def, record }: { def: ObjectDef; record: CrmRecord }) {
  const perms = usePermissions();
  const [filter, setFilter] = useState<Filter>('all');
  const [draft, setDraft] = useState<EmailDraft | null>(null);
  const [draftKey, setDraftKey] = useState(0);
  const composer = useRef<HTMLDivElement>(null);
  const timeline = useQuery({
    queryKey: ['timeline', record.id],
    queryFn: () => api.get<{ items: TimelineItem[]; refs: RefMap }>(`/api/records/${def.apiName}/${record.id}/timeline`),
  });
  const items = (timeline.data?.items ?? []).filter((i) => filter === 'all' || i.kind === filter);
  const upcoming = items.filter((i) => i.kind === 'activity' && i.status === 'Open').sort((a, b) => (a.dueDate ?? '9999').localeCompare(b.dueDate ?? '9999'));
  const past = items.filter((i) => !(i.kind === 'activity' && i.status === 'Open'));
  const canLog = def.apiName !== 'activity' && perms.canCreate('activity');
  const filters: { id: Filter; label: string }[] = [
    { id: 'all', label: 'All' },
    { id: 'activity', label: 'Activities' },
    { id: 'history', label: 'Changes' },
    { id: 'agent', label: 'AI' },
  ];
  const reply = (item: TimelineItem) => {
    const email = item.email!;
    const subject = email.subject || item.title;
    setDraft({
      to: email.direction === 'inbound' ? [email.from] : [...email.to, ...email.cc],
      subject: /^re:/i.test(subject) ? subject : `Re: ${subject}`,
      inReplyTo: item.recordId ?? item.id,
      replyingTo: subject,
    });
    setDraftKey((k) => k + 1);
    composer.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  };
  const cancelReply = () => {
    setDraft(null);
    setDraftKey((k) => k + 1);
  };
  const row = (i: TimelineItem) => (
    <li key={`${i.kind}:${i.id}`} className="flex gap-3 py-3">
      {i.kind === 'activity' ? <ActivityItem item={i} onReply={canLog ? reply : undefined} /> : i.kind === 'agent' ? <AgentItem item={i} /> : <HistoryItem item={i} />}
    </li>
  );
  return (
    <Card title="Activity" bodyClassName="p-4">
      {canLog && (
        <div ref={composer} className="mb-4 scroll-mt-4 border-b border-slate-100 pb-4">
          <Composer def={def} record={record} draft={draft} draftKey={draftKey} onCancelReply={cancelReply} />
        </div>
      )}
      <div className="mb-1 flex flex-wrap gap-1" role="tablist" aria-label="Show">
        {filters.map((f) => (
          <button
            key={f.id}
            type="button"
            role="tab"
            aria-selected={filter === f.id}
            onClick={() => setFilter(f.id)}
            className={cx('rounded-md px-2 py-1 text-xs font-medium', filter === f.id ? 'bg-slate-800 text-white' : 'text-slate-500 hover:bg-slate-100')}
          >
            {f.label}
          </button>
        ))}
      </div>
      {timeline.isLoading ? (
        <Loading />
      ) : timeline.error ? (
        <ErrorBanner error={timeline.error} />
      ) : items.length === 0 ? (
        <p className="py-6 text-center text-sm text-slate-400">Nothing here yet.</p>
      ) : (
        <>
          {upcoming.length > 0 && (
            <section aria-label="Upcoming and overdue">
              <h3 className="mt-3 text-xs font-semibold tracking-wide text-slate-400 uppercase">Upcoming &amp; overdue</h3>
              <ul className="divide-y divide-slate-100">{upcoming.map(row)}</ul>
            </section>
          )}
          {past.length > 0 && (
            <section aria-label="History">
              <h3 className="mt-3 text-xs font-semibold tracking-wide text-slate-400 uppercase">History</h3>
              <ul className="divide-y divide-slate-100">{past.map(row)}</ul>
            </section>
          )}
        </>
      )}
    </Card>
  );
}
