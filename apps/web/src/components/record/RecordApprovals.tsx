import type { ApprovalProcessDef, ApprovalRequest, ApprovalStatus, CrmRecord, ObjectDef } from '@titoforce/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ShieldCheck, ThumbsDown, ThumbsUp, Undo2 } from 'lucide-react';
import { useState } from 'react';
import { api, errorMessage } from '../../api.ts';
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
      toast.success(decision === 'approve' ? `Approved “${request.recordName}”` : `Rejected “${request.recordName}”`);
      onClose();
    },
  });
  return (
    <Modal
      open
      onClose={onClose}
      size="sm"
      title={decision === 'approve' ? 'Approve request' : 'Reject request'}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant={decision === 'approve' ? 'primary' : 'danger'} loading={decide.isPending} onClick={() => decide.mutate()}>
            {decision === 'approve' ? 'Approve' : 'Reject'}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <p className="text-sm text-slate-600">
          <span className="font-medium text-slate-900">{request.recordName}</span> · {request.processName}
          <br />
          Submitted by {request.submittedByName} {relativeTime(request.createdAt)}
          {request.comment && <span className="mt-1 block text-slate-500 italic">“{request.comment}”</span>}
        </p>
        <ErrorBanner error={decide.error} />
        <FormField label="Comment" htmlFor="decision-comment" help="Optional. Shared with the submitter.">
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
      toast.success(`Submitted to ${req.approverName} for approval`);
      onClose();
    },
  });
  return (
    <Modal
      open
      onClose={onClose}
      size="sm"
      title="Submit for approval"
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={submit.isPending} onClick={() => submit.mutate()}>
            Submit
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <ErrorBanner error={submit.error} />
        {processes.length > 1 && (
          <FormField label="Approval process" htmlFor="approval-process">
            <select id="approval-process" className="input" value={processId} onChange={(e) => setProcessId(e.target.value)}>
              <option value="">Automatic (first process whose criteria match)</option>
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
            Process: <span className="font-medium text-slate-900">{processes[0]!.name}</span>
            {processes[0]!.description && <span className="block text-xs text-slate-500">{processes[0]!.description}</span>}
          </p>
        )}
        <FormField label="Comment" htmlFor="approval-comment" help="Optional. The approver sees this with the request.">
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
      toast.success('Request recalled');
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
          <ShieldCheck className="size-4 text-slate-400" aria-hidden /> Approvals
        </span>
      }
      actions={
        !pending &&
        active.length > 0 && (
          <Button size="sm" onClick={() => setSubmitting(true)}>
            Submit for approval
          </Button>
        )
      }
    >
      <ErrorBanner error={requests.error} />
      {pending && (
        <div className="rounded-lg bg-amber-50 p-3 ring-1 ring-amber-200" aria-label="Pending approval">
          <p className="text-sm text-amber-900">
            <span className="font-medium">Waiting on {pending.approverId === user.id ? 'you' : pending.approverName}</span> · {pending.processName}
          </p>
          <p className="mt-0.5 text-xs text-amber-800/80">
            Submitted by {pending.submittedByName} {relativeTime(pending.createdAt)}
          </p>
          {pending.comment && <p className="mt-1 text-sm text-amber-900 italic">“{pending.comment}”</p>}
          <div className="mt-2 flex flex-wrap gap-2">
            {(pending.approverId === user.id || perms.isAdmin) && (
              <>
                <Button size="sm" variant="primary" icon={ThumbsUp} onClick={() => setDeciding({ request: pending, decision: 'approve' })}>
                  Approve
                </Button>
                <Button size="sm" variant="danger" icon={ThumbsDown} onClick={() => setDeciding({ request: pending, decision: 'reject' })}>
                  Reject
                </Button>
              </>
            )}
            {(pending.submittedBy === user.id || perms.isAdmin) && (
              <Button size="sm" icon={Undo2} loading={recall.isPending} onClick={() => recall.mutate(pending.id)}>
                Recall
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
                <Badge color={STATUS_COLOR[r.status]}>{r.status}</Badge>
              </div>
              <p className="text-xs text-slate-500" title={formatDateTime(r.decidedAt ?? r.createdAt)}>
                {r.status === 'recalled' ? 'Recalled' : r.approverName} · {relativeTime(r.decidedAt ?? r.createdAt)}
              </p>
              {r.decisionComment && <p className="mt-0.5 text-xs text-slate-600 italic">“{r.decisionComment}”</p>}
            </li>
          ))}
        </ul>
      )}
      {!pending && !past.length && <p className="text-sm text-slate-400">Not submitted yet.</p>}
      {deciding && <DecisionModal request={deciding.request} decision={deciding.decision} onClose={() => setDeciding(null)} />}
      {submitting && <SubmitApprovalModal record={record} processes={active} onClose={() => setSubmitting(false)} />}
    </Card>
  );
}
