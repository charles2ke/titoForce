import type { CrmRecord, FieldDef, ObjectDef, RecordResponse, RefMap } from '@titoforce/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Ellipsis, GitPullRequestArrow, Pencil, Repeat, ShieldCheck, Sparkles, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { ApiError, api, errorMessage } from '../api.ts';
import { useConfirm, useToast } from '../components/feedback.tsx';
import { FieldValue, UserChip } from '../components/FieldValue.tsx';
import { ActivityPanel } from '../components/record/RecordActivity.tsx';
import { ApprovalsCard, SubmitApprovalModal, useApprovalProcesses, useRecordApprovals } from '../components/record/RecordApprovals.tsx';
import { DetailsPanel, PathBar } from '../components/record/RecordDetails.tsx';
import { RelatedLists, useRelated } from '../components/record/RecordRelated.tsx';
import { ConvertLeadModal } from '../components/record/ConvertLeadModal.tsx';
import { RecordFormModal } from '../components/RecordForm.tsx';
import { Button, EmptyState, ErrorBanner, Loading, MenuItem, ObjectTile, Popover, Tabs } from '../components/ui.tsx';
import { fieldDef, valueOf } from '../lib/format.ts';
import { invalidateRecordData, useAiPanel, useObjectDef, usePermissions } from '../lib/hooks.ts';

/** The specialist agent to open for each object; anything else gets the general copilot. */
const AGENT_FOR: Record<string, string> = {
  opportunity: 'agt_deal_coach',
  lead: 'agt_lead_qualifier',
  case: 'agt_service_triage',
  employee: 'agt_hr_assistant',
  time_off_request: 'agt_hr_assistant',
  project: 'agt_project_manager',
  work_item: 'agt_project_manager',
};

export default function RecordPage() {
  const { id = '' } = useParams();
  const q = useQuery({ queryKey: ['record', id], queryFn: () => api.get<RecordResponse>(`/api/lookup/${encodeURIComponent(id)}`), retry: (n, err) => !(err instanceof ApiError && err.status < 500) && n < 2 });
  const { def, isLoading } = useObjectDef(q.data?.record.object);
  if (q.isLoading || (q.data && isLoading)) return <Loading />;
  if (q.error) {
    const missing = q.error instanceof ApiError && (q.error.status === 404 || q.error.status === 403);
    return (
      <div className="p-6">
        {missing ? (
          <EmptyState title="Record not available" action={<Link to="/" className="text-sm font-medium text-indigo-600 hover:underline">Go home</Link>}>
            It may have been deleted, or you may not have access to it.
          </EmptyState>
        ) : (
          <ErrorBanner error={q.error} />
        )}
      </div>
    );
  }
  if (!q.data || !def) return <div className="p-6"><ErrorBanner error="This record’s object is not available to you." /></div>;
  return <RecordBody key={id} def={def} record={q.data.record} refs={q.data.refs} />;
}

function Highlights({ def, record, refs }: { def: ObjectDef; record: CrmRecord; refs: RefMap }) {
  const fields = (def.highlightFields ?? []).map((f) => fieldDef(def, f)).filter((f): f is FieldDef => !!f && f.apiName !== def.statusField);
  if (!fields.length) return null;
  return (
    <dl className="mt-4 flex flex-wrap gap-x-8 gap-y-2">
      {fields.slice(0, 6).map((f) => (
        <div key={f.apiName} className="min-w-0">
          <dt className="text-xs text-slate-500">{f.label}</dt>
          <dd className="max-w-64 truncate text-sm font-medium text-slate-900">
            <FieldValue field={f} value={valueOf(record, f.apiName)} refs={refs} />
          </dd>
        </div>
      ))}
    </dl>
  );
}

function RecordBody({ def, record, refs }: { def: ObjectDef; record: CrmRecord; refs: RefMap }) {
  const perms = usePermissions();
  const ai = useAiPanel();
  const qc = useQueryClient();
  const toast = useToast();
  const confirm = useConfirm();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') === 'related' ? 'related' : 'details';
  const [editing, setEditing] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [converting, setConverting] = useState(false);
  const related = useRelated(def, record);
  const processes = useApprovalProcesses(def.apiName);
  const approvals = useRecordApprovals(record.id);
  const canEdit = perms.canEdit(def.apiName, record.ownerId);
  const canDelete = perms.canDelete(def.apiName, record.ownerId);
  const agentId = AGENT_FOR[def.apiName] ?? 'agt_copilot';
  const hasPending = (approvals.data ?? []).some((r) => r.status === 'pending');
  const canSubmit = (processes.data?.length ?? 0) > 0 && !hasPending;
  const isLead = def.apiName === 'lead';
  const converted = isLead && String(record.fields.status ?? '').toLowerCase() === 'converted';
  const relatedCount = (related.data?.lists ?? []).reduce((n, l) => n + l.total, 0);

  const remove = useMutation({
    mutationFn: () => api.del(`/api/records/${def.apiName}/${record.id}`),
    onSuccess: async () => {
      navigate(`/o/${def.apiName}`, { replace: true });
      qc.removeQueries({ queryKey: ['record', record.id] });
      await invalidateRecordData(qc);
      toast.success(`${def.label} “${record.name}” deleted`);
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  const askAi = (prompt?: string) => ai.open({ recordId: record.id, recordName: record.name, agentId, prompt });
  const onDelete = async () => {
    const ok = await confirm({
      title: `Delete ${def.label.toLowerCase()}?`,
      message: `“${record.name}” will be permanently deleted. Records that reference it may be deleted too, or have the reference cleared.`,
      confirmLabel: 'Delete',
      danger: true,
    });
    if (ok) remove.mutate();
  };

  return (
    <div className="min-h-full bg-slate-50">
      <div className="border-b border-slate-200 bg-white px-6 pt-5 pb-4">
        <div className="flex flex-wrap items-start gap-4">
          <ObjectTile icon={def.icon} color={def.color} size="lg" />
          <div className="min-w-0 flex-1">
            <Link to={`/o/${def.apiName}`} className="text-xs font-medium text-slate-500 hover:text-indigo-600 hover:underline">
              {def.label}
            </Link>
            <h1 className="truncate text-xl font-semibold text-slate-900">{record.name || '(no name)'}</h1>
            {record.ownerId && (
              <p className="mt-1 flex items-center gap-1.5 text-xs text-slate-500">
                Owner <UserChip id={record.ownerId} name={refs[record.ownerId]?.name} />
              </p>
            )}
          </div>
          <div className="flex items-center gap-2">
            {canEdit && (
              <Button icon={Pencil} onClick={() => setEditing(true)}>
                Edit
              </Button>
            )}
            {isLead && !converted && canEdit && (
              <Button icon={Repeat} onClick={() => setConverting(true)}>
                Convert
              </Button>
            )}
            <Button variant="ai" icon={Sparkles} onClick={() => askAi()}>
              Ask AI
            </Button>
            <Popover
              align="right"
              className="w-56"
              trigger={({ toggle, open }) => (
                <button type="button" onClick={toggle} aria-expanded={open} aria-label="More actions" className="inline-flex size-9 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-600 hover:bg-slate-50">
                  <Ellipsis className="size-4" />
                </button>
              )}
            >
              {(close) => (
                <>
                  <MenuItem
                    icon={Sparkles}
                    onClick={() => {
                      close();
                      askAi(`Summarize this ${def.label.toLowerCase()} and suggest next steps.`);
                    }}
                  >
                    Summarize with AI
                  </MenuItem>
                  {canSubmit && (
                    <MenuItem
                      icon={ShieldCheck}
                      onClick={() => {
                        close();
                        setSubmitting(true);
                      }}
                    >
                      Submit for approval
                    </MenuItem>
                  )}
                  <MenuItem
                    icon={GitPullRequestArrow}
                    onClick={() => {
                      close();
                      setParams({ tab: 'related' }, { replace: true });
                    }}
                  >
                    Show related records
                  </MenuItem>
                  {canDelete && (
                    <MenuItem
                      icon={Trash2}
                      danger
                      onClick={() => {
                        close();
                        void onDelete();
                      }}
                    >
                      Delete
                    </MenuItem>
                  )}
                </>
              )}
            </Popover>
          </div>
        </div>
        <Highlights def={def} record={record} refs={refs} />
        <div className="mt-4">
          <PathBar def={def} record={record} />
        </div>
      </div>

      <div className="grid gap-6 p-6 xl:grid-cols-[minmax(0,1fr)_400px]">
        <div className="min-w-0">
          <Tabs
            tabs={[
              { id: 'details', label: 'Details' },
              { id: 'related', label: relatedCount ? `Related (${relatedCount.toLocaleString()})` : 'Related' },
            ]}
            value={tab}
            onChange={(t) => setParams(t === 'details' ? {} : { tab: t }, { replace: true })}
          />
          <div className="mt-4">{tab === 'details' ? <DetailsPanel def={def} record={record} refs={refs} /> : <RelatedLists def={def} record={record} />}</div>
        </div>
        <aside className="min-w-0 space-y-6" aria-label="Activity and approvals">
          <ApprovalsCard def={def} record={record} />
          <ActivityPanel def={def} record={record} />
        </aside>
      </div>

      {editing && <RecordFormModal object={def.apiName} record={record} refs={refs} open onClose={() => setEditing(false)} />}
      {submitting && processes.data && <SubmitApprovalModal record={record} processes={processes.data} onClose={() => setSubmitting(false)} />}
      {converting && <ConvertLeadModal lead={record} onClose={() => setConverting(false)} />}
    </div>
  );
}
