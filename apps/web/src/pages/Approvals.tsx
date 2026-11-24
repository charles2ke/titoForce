import type { AgentAction, ApprovalRequest } from '@titoforce/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bot, Check, ChevronDown, ChevronRight, Inbox, ShieldCheck, ThumbsDown, ThumbsUp, Undo2, X } from 'lucide-react';
import { useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { api, errorMessage } from '../api.ts';
import { useToast } from '../components/feedback.tsx';
import { DecisionModal, STATUS_COLOR } from '../components/record/RecordApprovals.tsx';
import { Badge, Button, cx, EmptyState, ErrorBanner, Loading, ObjectTile, Tabs } from '../components/ui.tsx';
import { t, tryT, tx } from '../i18n/index.ts';
import { formatDateTime, relativeTime } from '../lib/format.ts';
import { invalidateRecordData, useAuth, useObjects, usePermissions } from '../lib/hooks.ts';

type Tab = 'inbox' | 'submitted' | 'all' | 'agent';

const ACTION_COLOR: Record<string, string> = { pending: 'yellow', executing: 'blue', executed: 'green', rejected: 'gray', failed: 'red' };

function RequestRow({ r, showActions }: { r: ApprovalRequest; showActions: boolean }) {
  const { user } = useAuth();
  const perms = usePermissions();
  const objects = useObjects();
  const qc = useQueryClient();
  const toast = useToast();
  const [deciding, setDeciding] = useState<'approve' | 'reject' | null>(null);
  const def = objects.data?.find((o) => o.apiName === r.object);
  const recall = useMutation({
    mutationFn: () => api.post(`/api/approvals/${r.id}/recall`, {}),
    onSuccess: async () => {
      await invalidateRecordData(qc);
      toast.success(t('approvals.request.recalled'));
    },
    onError: (err) => toast.error(errorMessage(err)),
  });
  const pending = r.status === 'pending';
  const canDecide = pending && showActions && (r.approverId === user.id || perms.isAdmin);
  const canRecall = pending && (r.submittedBy === user.id || perms.isAdmin);
  return (
    <li className="flex flex-wrap items-start gap-3 px-4 py-3" aria-label={`${r.processName}: ${r.recordName}`}>
      {def ? <ObjectTile icon={def.icon} color={def.color} soft /> : <ShieldCheck className="size-8 text-slate-300" aria-hidden />}
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <Link to={`/r/${r.recordId}`} className="truncate font-medium text-slate-900 hover:text-indigo-700 hover:underline">
            {r.recordName}
          </Link>
          <Badge color={STATUS_COLOR[r.status]}>{t(`approvals.requestStatus.${r.status}`)}</Badge>
        </div>
        <p className="text-xs text-slate-500">
          {def?.label ?? r.object} · {r.processName} ·{' '}
          {tx(r.submittedBy === user.id ? 'approvals.request.submittedByYou' : 'approvals.request.submittedBy', {
            name: r.submittedByName,
            time: <span title={formatDateTime(r.createdAt)}>{relativeTime(r.createdAt)}</span>,
          })}
          {' · '}
          {r.approverId === user.id ? t('approvals.request.approverYou') : t('approvals.request.approver', { name: r.approverName })}
        </p>
        {r.comment && <p className="mt-1 text-sm text-slate-600 italic">{t('approvals.request.quote', { text: r.comment })}</p>}
        {r.decidedAt && r.status !== 'pending' && (
          <p className="mt-1 text-xs text-slate-500">
            {t(r.status === 'recalled' ? 'approvals.request.recalledAt' : r.status === 'approved' ? 'approvals.request.approvedAt' : 'approvals.request.rejectedAt', { time: relativeTime(r.decidedAt) })}
            {r.decisionComment && <span className="text-slate-600 italic"> — {t('approvals.request.quote', { text: r.decisionComment })}</span>}
          </p>
        )}
      </div>
      {(canDecide || canRecall) && (
        <div className="flex shrink-0 gap-2">
          {canDecide && (
            <>
              <Button size="sm" variant="primary" icon={ThumbsUp} onClick={() => setDeciding('approve')}>
                {t('approvals.approve')}
              </Button>
              <Button size="sm" variant="danger" icon={ThumbsDown} onClick={() => setDeciding('reject')}>
                {t('approvals.reject')}
              </Button>
            </>
          )}
          {canRecall && !canDecide && (
            <Button size="sm" icon={Undo2} loading={recall.isPending} onClick={() => recall.mutate()}>
              {t('approvals.recall')}
            </Button>
          )}
        </div>
      )}
      {deciding && <DecisionModal request={r} decision={deciding} onClose={() => setDeciding(null)} />}
    </li>
  );
}

function RequestList({ scope, status, showActions, empty }: { scope: 'to_me' | 'mine' | 'all'; status: 'pending' | 'any'; showActions: boolean; empty: string }) {
  const q = useQuery({
    queryKey: ['approvals', scope, status],
    queryFn: () => api.get<ApprovalRequest[]>(`/api/approvals?scope=${scope}&status=${status}`),
  });
  if (q.isLoading) return <Loading />;
  if (q.error) return <ErrorBanner error={q.error} />;
  const rows = q.data ?? [];
  if (!rows.length) return <EmptyState icon={Inbox} title={empty} />;
  return (
    <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200 bg-white">
      {rows.map((r) => (
        <RequestRow key={r.id} r={r} showActions={showActions} />
      ))}
    </ul>
  );
}

function prettyJson(v: unknown): string {
  try {
    return JSON.stringify(v, null, 2);
  } catch {
    return String(v);
  }
}

function ActionRow({ a }: { a: AgentAction }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const decide = useMutation({
    mutationFn: (d: 'approve' | 'reject') => api.post<AgentAction>(`/api/agent-actions/${a.id}/${d}`, {}),
    onSuccess: async (res) => {
      await invalidateRecordData(qc);
      if (res.status === 'failed') {
        const error = (res.result as { error?: string } | null)?.error;
        toast.error(error == null ? t('approvals.action.failedUnknown') : t('approvals.action.failed', { error }));
      } else toast.success(res.status === 'rejected' ? t('approvals.action.rejected') : t('approvals.action.executed'));
    },
    onError: (err) => toast.error(errorMessage(err)),
  });
  const pending = a.status === 'pending';
  return (
    <li className="px-4 py-3" aria-label={`${a.agentName}: ${a.summary}`}>
      <div className="flex flex-wrap items-start gap-3">
        <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-violet-100 text-violet-700">
          <Bot className="size-4" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium text-slate-900">{a.summary}</span>
            <Badge color={ACTION_COLOR[a.status] ?? 'gray'}>{tryT(`approvals.status.${a.status}`) ?? a.status}</Badge>
          </div>
          <p className="text-xs text-slate-500">
            {tx('approvals.action.wantsToRun', { agent: a.agentName, tool: <code className="rounded bg-slate-100 px-1">{a.tool}</code> })} ·{' '}
            <span title={formatDateTime(a.requestedAt)}>{relativeTime(a.requestedAt)}</span>
            {a.recordId && (
              <>
                {' · '}
                <Link to={`/r/${a.recordId}`} className="text-indigo-600 hover:underline">
                  {t('approvals.action.viewRecord')}
                </Link>
              </>
            )}
          </p>
          <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className="mt-1 inline-flex items-center gap-0.5 text-xs font-medium text-slate-500 hover:text-slate-800">
            {open ? <ChevronDown className="size-3.5" aria-hidden /> : <ChevronRight className="size-3.5" aria-hidden />} {t('common.details')}
          </button>
          {open && (
            <div className="mt-1 grid gap-2 @2xl:grid-cols-2">
              <div>
                <p className="text-xs font-medium text-slate-500">{t('approvals.action.arguments')}</p>
                <pre className="mt-0.5 max-h-48 overflow-auto rounded-lg bg-slate-50 p-2 text-xs text-slate-700">{prettyJson(a.args)}</pre>
              </div>
              {a.result !== null && a.result !== undefined && (
                <div>
                  <p className="text-xs font-medium text-slate-500">{t('approvals.action.result')}</p>
                  <pre className="mt-0.5 max-h-48 overflow-auto rounded-lg bg-slate-50 p-2 text-xs text-slate-700">{prettyJson(a.result)}</pre>
                </div>
              )}
            </div>
          )}
        </div>
        {pending && (
          <div className="flex shrink-0 gap-2">
            <Button size="sm" variant="primary" icon={Check} loading={decide.isPending && decide.variables === 'approve'} disabled={decide.isPending} onClick={() => decide.mutate('approve')}>
              {t('approvals.approve')}
            </Button>
            <Button size="sm" variant="danger" icon={X} loading={decide.isPending && decide.variables === 'reject'} disabled={decide.isPending} onClick={() => decide.mutate('reject')}>
              {t('approvals.reject')}
            </Button>
          </div>
        )}
      </div>
    </li>
  );
}

function AgentActions() {
  const [status, setStatus] = useState<'pending' | 'any'>('pending');
  const q = useQuery({
    queryKey: ['agent-actions', status],
    queryFn: () => api.get<AgentAction[]>(`/api/agent-actions?status=${status}&limit=100`),
  });
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm text-slate-500">{t('approvals.agentActions.intro')}</p>
        <div role="radiogroup" aria-label={t('common.status')} className="flex rounded-lg bg-slate-100 p-0.5">
          {(['pending', 'any'] as const).map((s) => (
            <button
              key={s}
              type="button"
              role="radio"
              aria-checked={status === s}
              onClick={() => setStatus(s)}
              className={cx('rounded-md px-2.5 py-1 text-xs font-medium', status === s ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-800')}
            >
              {s === 'pending' ? t('approvals.agentActions.pending') : t('common.all')}
            </button>
          ))}
        </div>
      </div>
      {q.isLoading ? (
        <Loading />
      ) : q.error ? (
        <ErrorBanner error={q.error} />
      ) : !q.data?.length ? (
        <EmptyState icon={Bot} title={status === 'pending' ? t('approvals.agentActions.emptyPending') : t('approvals.agentActions.emptyAll')} />
      ) : (
        <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200 bg-white">
          {q.data.map((a) => (
            <ActionRow key={a.id} a={a} />
          ))}
        </ul>
      )}
    </div>
  );
}

export default function Approvals() {
  const perms = usePermissions();
  const [params, setParams] = useSearchParams();
  const raw = params.get('tab');
  const tab: Tab = raw === 'submitted' || raw === 'agent' || (raw === 'all' && perms.isAdmin) ? raw : 'inbox';
  const tabs: { id: Tab; label: string }[] = [
    { id: 'inbox', label: t('approvals.tabs.inbox') },
    { id: 'submitted', label: t('approvals.tabs.submitted') },
    ...(perms.isAdmin ? [{ id: 'all' as const, label: t('approvals.tabs.all') }] : []),
    { id: 'agent', label: t('approvals.tabs.agent') },
  ];
  return (
    <div className="mx-auto max-w-5xl space-y-4 p-6">
      <div>
        <h1 className="text-xl font-semibold text-slate-900">{t('approvals.title')}</h1>
        <p className="text-sm text-slate-500">{t('approvals.subtitle')}</p>
      </div>
      <Tabs tabs={tabs} value={tab} onChange={(t) => setParams(t === 'inbox' ? {} : { tab: t }, { replace: true })} />
      {tab === 'inbox' && <RequestList scope="to_me" status="pending" showActions empty={t('approvals.empty.inbox')} />}
      {tab === 'submitted' && <RequestList scope="mine" status="any" showActions={false} empty={t('approvals.empty.submitted')} />}
      {tab === 'all' && <RequestList scope="all" status="any" showActions empty={t('approvals.empty.all')} />}
      {tab === 'agent' && <AgentActions />}
    </div>
  );
}
