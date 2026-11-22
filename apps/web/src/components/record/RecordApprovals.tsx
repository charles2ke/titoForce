import type { ApprovalProcessDef, ApprovalRequest, ApprovalStatus, CrmRecord, ObjectDef } from '@titoforce/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ShieldCheck, ThumbsDown, ThumbsUp, Undo2 } from 'lucide-react';
import { useState } from 'react';
import { api, errorMessage } from '../../api.ts';
import { t, tx } from '../../i18n/index.ts';
import { formatDateTime, relativeTime } from '../../lib/format.ts';
import { invalidateRecordData, useAuth, usePermissions } from '../../lib/hooks.ts';
import { useToast } from '../feedback.tsx';
import { Badge, Button, Card, ErrorBanner, FormField, Modal } from '../ui.tsx';

export const STATUS_COLOR: Record<ApprovalStatus, string> = { pending: 'yellow', approved: 'green', rejected: 'red', recalled: 'gray' };

export function useApprovalProcesses(object: string) {
  return useQuery({
    queryKey: ['approval-processes', object],
    queryFn: () => api.get<ApprovalProcessDef[]>(`/api/approval-processes?object=${encodeURIComponent(object)}`),
    select: (all) => all.filter((p) => p.active),
    staleTime: 60_000,
  });
}

export function useRecordApprovals(recordId: string) {
  return useQuery({
    queryKey: ['approvals', 'record', recordId],
    queryFn: () => api.get<ApprovalRequest[]>(`/api/approvals?scope=all&status=any&recordId=${encodeURIComponent(recordId)}`),
  });
}

/** Approve/reject with an optional comment. Shared by the record page and the Approvals inbox. */
export function DecisionModal({ request, decision, onClose }: { request: ApprovalRequest; decision: 'approve' | 'reject'; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [comment, setComment] = useState('');
  const decide = useMutation({
    mutationFn: () => api.post<ApprovalRequest>(`/api/approvals/${request.id}/${decision}`, { comment: comment.trim() || undefined }),
    onSuccess: async () => {
      await invalidateRecordData(qc);
      toast.success(t(decision === 'approve' ? 'record.approvals.approvedRecord' : 'record.approvals.rejectedRecord', { name: request.recordName }));
      onClose();
    },
  });
  return (
    <Modal
      open
      onClose={onClose}
      size="sm"
      title={t(decision === 'approve' ? 'record.approvals.approveTitle' : 'record.approvals.rejectTitle')}
      footer={
        <>
          <Button onClick={onClose}>{t('common.cancel')}</Button>
          <Button variant={decision === 'approve' ? 'primary' : 'danger'} loading={decide.isPending} onClick={() => decide.mutate()}>
            {t(decision === 'approve' ? 'record.approvals.approve' : 'record.approvals.reject')}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <p className="text-sm text-slate-600">
          <span className="font-medium text-slate-900">{request.recordName}</span> · {request.processName}
          <br />
          {t('record.approvals.submittedBy', { name: request.submittedByName, time: relativeTime(request.createdAt) })}
          {request.comment && <span className="mt-1 block text-slate-500 italic">{t('record.approvals.quote', { comment: request.comment })}</span>}
        </p>
        <ErrorBanner error={decide.error} />
        <FormField label={t('record.approvals.comment')} htmlFor="decision-comment" help={t('record.approvals.decisionCommentHelp')}>
          <textarea id="decision-comment" className="input min-h-20" maxLength={2000} value={comment} onChange={(e) => setComment(e.target.value)} />
        </FormField>
      </div>
    </Modal>
  );
}

export function SubmitApprovalModal({ record, processes, onClose }: { record: CrmRecord; processes: ApprovalProcessDef[]; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [processId, setProcessId] = useState('');
  const [comment, setComment] = useState('');
  const submit = useMutation({
    mutationFn: () => api.post<ApprovalRequest>('/api/approvals/submit', { recordId: record.id, processId: processId || undefined, comment: comment.trim() || undefined }),
    onSuccess: async (req) => {
      await invalidateRecordData(qc);
      toast.success(t('record.approvals.submitted', { name: req.approverName }));
      onClose();
    },
  });
  return (
    <Modal
      open
      onClose={onClose}
      size="sm"
      title={t('record.approvals.submit')}
      footer={
        <>
          <Button onClick={onClose}>{t('common.cancel')}</Button>
          <Button variant="primary" loading={submit.isPending} onClick={() => submit.mutate()}>
            {t('common.submit')}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <ErrorBanner error={submit.error} />
        {processes.length > 1 && (
          <FormField label={t('record.approvals.processLabel')} htmlFor="approval-process">
            <select id="approval-process" className="input" value={processId} onChange={(e) => setProcessId(e.target.value)}>
              <option value="">{t('record.approvals.automaticProcess')}</option>
              {processes.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </FormField>
        )}
        {processes.length === 1 && (
          <p className="text-sm text-slate-600">
            {tx('record.approvals.process', { name: <span className="font-medium text-slate-900">{processes[0]!.name}</span> })}
            {processes[0]!.description && <span className="block text-xs text-slate-500">{processes[0]!.description}</span>}
          </p>
        )}
        <FormField label={t('record.approvals.comment')} htmlFor="approval-comment" help={t('record.approvals.submitCommentHelp')}>
          <textarea id="approval-comment" className="input min-h-20" maxLength={2000} value={comment} onChange={(e) => setComment(e.target.value)} />
        </FormField>
      </div>
    </Modal>
  );
}

export function ApprovalsCard({ def, record }: { def: ObjectDef; record: CrmRecord }) {
  const { user } = useAuth();
  const perms = usePermissions();
  const qc = useQueryClient();
  const toast = useToast();
  const requests = useRecordApprovals(record.id);
  const processes = useApprovalProcesses(def.apiName);
  const [deciding, setDeciding] = useState<{ request: ApprovalRequest; decision: 'approve' | 'reject' } | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const recall = useMutation({
    mutationFn: (id: string) => api.post(`/api/approvals/${id}/recall`, {}),
    onSuccess: async () => {
      await invalidateRecordData(qc);
      toast.success(t('record.approvals.recalledToast'));
    },
    onError: (err) => toast.error(errorMessage(err)),
  });
  const list = requests.data ?? [];
  const active = processes.data ?? [];
  if (!list.length && !active.length) return null;
  const pending = list.find((r) => r.status === 'pending');
  const past = list.filter((r) => r !== pending);
  return (
    <Card
      title={
        <span className="flex items-center gap-2">
          <ShieldCheck className="size-4 text-slate-400" aria-hidden /> {t('record.approvals.title')}
        </span>
      }
      actions={
        !pending &&
        active.length > 0 && (
          <Button size="sm" onClick={() => setSubmitting(true)}>
            {t('record.approvals.submit')}
          </Button>
        )
      }
    >
      <ErrorBanner error={requests.error} />
      {pending && (
        <div className="rounded-lg bg-amber-50 p-3 ring-1 ring-amber-200" aria-label={t('record.approvals.pendingLabel')}>
          <p className="text-sm text-amber-900">
            <span className="font-medium">{pending.approverId === user.id ? t('record.approvals.waitingOnYou') : t('record.approvals.waitingOn', { name: pending.approverName })}</span> · {pending.processName}
          </p>
          <p className="mt-0.5 text-xs text-amber-800/80">{t('record.approvals.submittedBy', { name: pending.submittedByName, time: relativeTime(pending.createdAt) })}</p>
          {pending.comment && <p className="mt-1 text-sm text-amber-900 italic">{t('record.approvals.quote', { comment: pending.comment })}</p>}
          <div className="mt-2 flex flex-wrap gap-2">
            {(pending.approverId === user.id || perms.isAdmin) && (
              <>
                <Button size="sm" variant="primary" icon={ThumbsUp} onClick={() => setDeciding({ request: pending, decision: 'approve' })}>
                  {t('record.approvals.approve')}
                </Button>
                <Button size="sm" variant="danger" icon={ThumbsDown} onClick={() => setDeciding({ request: pending, decision: 'reject' })}>
                  {t('record.approvals.reject')}
                </Button>
              </>
            )}
            {(pending.submittedBy === user.id || perms.isAdmin) && (
              <Button size="sm" icon={Undo2} loading={recall.isPending} onClick={() => recall.mutate(pending.id)}>
                {t('record.approvals.recall')}
              </Button>
            )}
          </div>
        </div>
      )}
      {past.length > 0 && (
        <ul className="mt-2 divide-y divide-slate-100">
          {past.map((r) => (
            <li key={r.id} className="py-2 text-sm">
              <div className="flex items-center justify-between gap-2">
                <span className="min-w-0 truncate text-slate-700">{r.processName}</span>
                <Badge color={STATUS_COLOR[r.status]}>{t(`record.approvals.status.${r.status}`)}</Badge>
              </div>
              <p className="text-xs text-slate-500" title={formatDateTime(r.decidedAt ?? r.createdAt)}>
                {r.status === 'recalled' ? t('record.approvals.recalled') : r.approverName} · {relativeTime(r.decidedAt ?? r.createdAt)}
              </p>
              {r.decisionComment && <p className="mt-0.5 text-xs text-slate-600 italic">{t('record.approvals.quote', { comment: r.decisionComment })}</p>}
            </li>
          ))}
        </ul>
      )}
      {!pending && !past.length && <p className="text-sm text-slate-400">{t('record.approvals.notSubmitted')}</p>}
      {deciding && <DecisionModal request={deciding.request} decision={deciding.decision} onClose={() => setDeciding(null)} />}
      {submitting && <SubmitApprovalModal record={record} processes={active} onClose={() => setSubmitting(false)} />}
    </Card>
  );
}
