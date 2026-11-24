import type { CrmRecord, ObjectDef, RefMap, TimelineItem } from '@titoforce/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bot, Circle, CircleCheck, History, Mail, Phone, SquareCheckBig, StickyNote, Users, Workflow } from 'lucide-react';
import { type FormEvent, type ReactNode, useState } from 'react';
import { Link } from 'react-router';
import { api, errorMessage } from '../../api.ts';
import { inSentence, intlLocale, t, tryT, tx } from '../../i18n/index.ts';
import { formatDate, formatDateTime, relativeTime, todayIso } from '../../lib/format.ts';
import { invalidateRecordData, useObjectDef, usePermissions } from '../../lib/hooks.ts';
import { Markdown } from '../../lib/markdown.tsx';
import { useToast } from '../feedback.tsx';
import { Badge, Button, Card, cx, ErrorBanner, Loading } from '../ui.tsx';

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
  if (typeof v === 'boolean') return v ? t('common.yes') : t('common.no');
  if (typeof v === 'number') return v.toLocaleString(intlLocale());
  const s = String(v);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? formatDate(s) : /^\d{4}-\d{2}-\d{2}T/.test(s) ? formatDateTime(s) : s;
}

function Composer({ record }: { record: CrmRecord }) {
  const { def: activity } = useObjectDef('activity');
  const qc = useQueryClient();
  const toast = useToast();
  const types = activity?.fields.find((f) => f.apiName === 'type')?.options?.map((o) => o.value) ?? ['Call', 'Email', 'Meeting', 'Task', 'Note'];
  const [type, setType] = useState(types.includes('Call') ? 'Call' : types[0]!);
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
      toast.success(t(planned ? 'record.activity.scheduled' : 'record.activity.logged', { type }));
    },
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    create.mutate();
  };
  return (
    <form onSubmit={submit} className="space-y-2" aria-label={t('record.activity.formLabel')}>
      <div role="radiogroup" aria-label={t('record.activity.typeLabel')} className="flex flex-wrap gap-1">
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
      <ErrorBanner error={create.error} />
      <input className="input" aria-label={t('record.activity.subject')} placeholder={t('record.activity.subjectPlaceholder', { type })} maxLength={255} value={subject} onChange={(e) => setSubject(e.target.value)} />
      <textarea
        className="input min-h-16"
        aria-label={t('record.activity.notes')}
        placeholder={t(planned ? 'record.activity.detailsPlaceholder' : 'record.activity.whatHappenedPlaceholder')}
        value={description}
        onChange={(e) => setDescription(e.target.value)}
      />
      <div className="flex items-center justify-between gap-2">
        {planned ? (
          <label className="flex items-center gap-2 text-xs text-slate-500">
            {t('record.activity.dueLabel')}
            <input type="date" className="input h-8 w-auto py-0 text-xs" value={due} onChange={(e) => setDue(e.target.value)} />
          </label>
        ) : (
          <span />
        )}
        <Button type="submit" size="sm" variant="primary" loading={create.isPending}>
          {t(planned ? 'record.activity.add' : 'record.activity.log', { type: inSentence(type) })}
        </Button>
      </div>
    </form>
  );
}

function ActivityItem({ item }: { item: TimelineItem }) {
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
              aria-label={t(open ? 'record.activity.markComplete' : 'record.activity.reopen', { title: item.title })}
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
          {item.activityType} · {item.actorName ?? t('record.activity.someone')} · <span title={formatDateTime(item.at)}>{relativeTime(item.at)}</span>
          {item.dueDate && (
            <span className={cx('ml-1', overdue && 'font-medium text-rose-600')}>
              · {t(overdue ? 'record.activity.overdueDueOn' : 'record.activity.dueOn', { date: formatDate(item.dueDate) })}
            </span>
          )}
        </p>
        {item.body && <p className="mt-1 line-clamp-3 text-sm whitespace-pre-wrap text-slate-600">{item.body}</p>}
      </div>
    </>
  );
}

/** "<actor> updated 3 fields"; history titles come from the server in English, so they are matched (not shown) here. */
function historyLine(item: TimelineItem): ReactNode {
  const actor = <span className="font-medium">{item.actorName ?? t('record.system')}</span>;
  if (item.title === 'Fields updated') return tx('record.history.updatedFields', { actor, count: item.changes?.length ?? 0 });
  if (item.title.endsWith(' created')) return tx('record.history.createdRecord', { actor });
  return tx('record.history.other', { actor, action: item.title.toLowerCase() });
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
          {historyLine(item)}
          {item.actorType && item.actorType !== 'user' && <Badge className="ml-1.5">{t(`record.history.actorType.${item.actorType}`)}</Badge>}
        </p>
        {item.changes && item.changes.length > 0 && (
          <ul className="mt-1 space-y-0.5 text-xs text-slate-500">
            {item.changes.slice(0, 8).map((c) => (
              <li key={c.field} className="truncate">
                <span className="font-medium text-slate-600">{c.label}:</span> {display(c.from)} → <span className="text-slate-700">{display(c.to)}</span>
              </li>
            ))}
            {item.changes.length > 8 && <li>{t('record.history.more', { count: item.changes.length - 8 })}</li>}
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
              {tryT(`record.agentRun.status.${item.status}`) ?? item.status}
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
              {expanded ? t('common.showLess') : t('common.showMore')}
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
  const timeline = useQuery({
    queryKey: ['timeline', record.id],
    queryFn: () => api.get<{ items: TimelineItem[]; refs: RefMap }>(`/api/records/${def.apiName}/${record.id}/timeline`),
  });
  const items = (timeline.data?.items ?? []).filter((i) => filter === 'all' || i.kind === filter);
  const upcoming = items.filter((i) => i.kind === 'activity' && i.status === 'Open').sort((a, b) => (a.dueDate ?? '9999').localeCompare(b.dueDate ?? '9999'));
  const past = items.filter((i) => !(i.kind === 'activity' && i.status === 'Open'));
  const canLog = def.apiName !== 'activity' && perms.canCreate('activity');
  const filters: { id: Filter; label: string }[] = [
    { id: 'all', label: t('common.all') },
    { id: 'activity', label: t('record.activity.filter.activities') },
    { id: 'history', label: t('record.activity.filter.changes') },
    { id: 'agent', label: t('record.activity.filter.ai') },
  ];
  const row = (i: TimelineItem) => (
    <li key={`${i.kind}:${i.id}`} className="flex gap-3 py-3">
      {i.kind === 'activity' ? <ActivityItem item={i} /> : i.kind === 'agent' ? <AgentItem item={i} /> : <HistoryItem item={i} />}
    </li>
  );
  return (
    <Card title={t('record.activity.title')} bodyClassName="p-4">
      {canLog && (
        <div className="mb-4 border-b border-slate-100 pb-4">
          <Composer record={record} />
        </div>
      )}
      <div className="mb-1 flex flex-wrap gap-1" role="tablist" aria-label={t('record.activity.filterLabel')}>
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
        <p className="py-6 text-center text-sm text-slate-400">{t('record.activity.empty')}</p>
      ) : (
        <>
          {upcoming.length > 0 && (
            <section aria-label={t('record.activity.upcomingLabel')}>
              <h3 className="mt-3 text-xs font-semibold tracking-wide text-slate-400 uppercase">{t('record.activity.upcoming')}</h3>
              <ul className="divide-y divide-slate-100">{upcoming.map(row)}</ul>
            </section>
          )}
          {past.length > 0 && (
            <section aria-label={t('record.activity.history')}>
              <h3 className="mt-3 text-xs font-semibold tracking-wide text-slate-400 uppercase">{t('record.activity.history')}</h3>
              <ul className="divide-y divide-slate-100">{past.map(row)}</ul>
            </section>
          )}
        </>
      )}
    </Card>
  );
}
