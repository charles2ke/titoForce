import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { AgentRun, AgentStep, AgentStepStatus, AgentTrigger, AutomationDef, AutomationRun } from '@titoforce/shared';
import { Bot, ChevronDown, ChevronRight, ExternalLink, History, RefreshCw, Workflow, X } from 'lucide-react';
import { Fragment, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { api, qs } from '../../api.ts';
import { ACTION_LABELS } from '../../components/ActionsEditor.tsx';
import { Badge, Button, cx, EmptyState, ErrorBanner, IconButton, KeyValue, Loading, Modal, PageHeader, Spinner, Tabs } from '../../components/ui.tsx';
import { formatDateTime, relativeTime } from '../../lib/format.ts';
import { useAgents, usePermissions } from '../../lib/hooks.ts';
import { Markdown } from '../../lib/markdown.tsx';

type Tab = 'automations' | 'agents';

const RUN_STATUS: Record<AutomationRun['status'], { label: string; color: string }> = {
  success: { label: 'Success', color: 'green' },
  failed: { label: 'Failed', color: 'red' },
  skipped: { label: 'Skipped', color: 'gray' },
};
const AGENT_STATUS: Record<AgentRun['status'], { label: string; color: string }> = {
  running: { label: 'Running', color: 'blue' },
  completed: { label: 'Completed', color: 'green' },
  failed: { label: 'Failed', color: 'red' },
};
const STEP_STATUS: Record<AgentStepStatus, { label: string; color: string }> = {
  ok: { label: 'OK', color: 'green' },
  error: { label: 'Error', color: 'red' },
  pending_approval: { label: 'Awaiting approval', color: 'yellow' },
  rejected: { label: 'Rejected', color: 'gray' },
};
const TRIGGERS: Record<AgentTrigger, string> = { chat: 'Chat', automation: 'Automation', record_action: 'Record action', api: 'API' };

const json = (v: unknown) => JSON.stringify(v, null, 2) ?? 'null';

function Time({ at }: { at: string }) {
  return (
    <time dateTime={at} title={formatDateTime(at)} className="whitespace-nowrap">
      {relativeTime(at)}
    </time>
  );
}

function RecordLink({ id }: { id: string | null }) {
  if (!id) return <span className="text-slate-400">—</span>;
  return (
    <Link to={`/r/${encodeURIComponent(id)}`} className="inline-flex items-center gap-1 font-mono text-xs text-indigo-700 hover:underline">
      {id}
      <ExternalLink className="size-3" aria-hidden />
    </Link>
  );
}

function FilterChip({ label, onClear, clearLabel }: { label: string; onClear: () => void; clearLabel: string }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-indigo-50 py-0.5 pr-0.5 pl-2.5 text-xs font-medium text-indigo-700 ring-1 ring-indigo-200 ring-inset">
      {label}
      <button type="button" aria-label={clearLabel} title={clearLabel} onClick={onClear} className="rounded-full p-0.5 hover:bg-indigo-100">
        <X className="size-3" aria-hidden />
      </button>
    </span>
  );
}

function detailSummary(run: AutomationRun): string {
  if (!Array.isArray(run.detail)) return '';
  const items = run.detail as { type?: string; result?: unknown }[];
  return items
    .map((d) => {
      const label = (d.type && ACTION_LABELS[d.type as keyof typeof ACTION_LABELS]) || d.type || 'Action';
      const skipped = d.result && typeof d.result === 'object' && 'skipped' in d.result ? String((d.result as { skipped: unknown }).skipped) : null;
      return skipped ? `${label} (skipped: ${skipped})` : label;
    })
    .join(' · ');
}

function AutomationRuns({ automationId, setFilter }: { automationId: string; setFilter: (id: string) => void }) {
  const automations = useQuery({ queryKey: ['automations'], queryFn: () => api.get<AutomationDef[]>('/api/automations') });
  const runs = useQuery({
    queryKey: ['automation-runs', 'list', automationId],
    queryFn: () => api.get<AutomationRun[]>(`/api/automation-runs${qs({ automationId, limit: 100 })}`),
  });
  const [open, setOpen] = useState<Set<string>>(() => new Set());
  const current = automations.data?.find((a) => a.id === automationId);
  const sorted = [...(automations.data ?? [])].sort((a, b) => a.name.localeCompare(b.name));

  const toggle = (id: string) =>
    setOpen((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <div className="card overflow-hidden">
      <div className="flex flex-wrap items-center gap-3 border-b border-slate-100 p-3">
        <select aria-label="Filter by automation" className="input w-auto max-w-xs" value={automationId} onChange={(e) => setFilter(e.target.value)}>
          <option value="">All automations</option>
          {automationId && !current && <option value={automationId}>{automations.isLoading ? 'Loading…' : 'Deleted automation'}</option>}
          {sorted.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
        {automationId && <FilterChip label={`Automation: ${current?.name ?? runs.data?.[0]?.automationName ?? automationId}`} clearLabel="Clear automation filter" onClear={() => setFilter('')} />}
        <span className="ml-auto text-xs text-slate-500">Latest 100 runs</span>
      </div>
      {runs.isLoading ? (
        <Loading />
      ) : runs.error ? (
        <div className="p-4">
          <ErrorBanner error={runs.error} />
        </div>
      ) : !runs.data?.length ? (
        <EmptyState icon={Workflow} title="No automation runs yet">
          Runs appear here when an active automation’s trigger and conditions match a record change.
        </EmptyState>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50/70 text-left text-xs font-semibold text-slate-500 uppercase">
              <tr>
                <th className="w-10 px-2 py-2.5">
                  <span className="sr-only">Details</span>
                </th>
                <th className="px-4 py-2.5">Time</th>
                <th className="px-4 py-2.5">Automation</th>
                <th className="px-4 py-2.5">Record</th>
                <th className="px-4 py-2.5">Status</th>
                <th className="px-4 py-2.5">Result</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {runs.data.map((r) => {
                const st = RUN_STATUS[r.status] ?? { label: r.status, color: 'gray' };
                const expanded = open.has(r.id);
                const summary = detailSummary(r);
                return (
                  <Fragment key={r.id}>
                    <tr className="align-top hover:bg-slate-50/70">
                      <td className="px-2 py-2">
                        <IconButton icon={expanded ? ChevronDown : ChevronRight} label={expanded ? 'Hide run details' : 'Show run details'} aria-expanded={expanded} onClick={() => toggle(r.id)} />
                      </td>
                      <td className="px-4 py-2.5 text-slate-600">
                        <Time at={r.createdAt} />
                      </td>
                      <td className="px-4 py-2.5">
                        {r.automationName === '(deleted)' ? (
                          <span className="text-slate-400">Deleted automation</span>
                        ) : (
                          <button type="button" className="text-left font-medium text-slate-800 hover:text-indigo-700" title="Show only this automation" onClick={() => setFilter(r.automationId)}>
                            {r.automationName}
                          </button>
                        )}
                      </td>
                      <td className="px-4 py-2.5">
                        <RecordLink id={r.recordId} />
                      </td>
                      <td className="px-4 py-2.5">
                        <Badge color={st.color}>{st.label}</Badge>
                      </td>
                      <td className="max-w-md px-4 py-2.5">
                        {r.error ? <span className="line-clamp-2 text-rose-700">{r.error}</span> : <span className="line-clamp-2 text-slate-600">{summary || '—'}</span>}
                      </td>
                    </tr>
                    {expanded && (
                      <tr className="bg-slate-50/60">
                        <td />
                        <td colSpan={5} className="px-4 pt-1 pb-3">
                          {r.error && <p className="mb-2 text-sm whitespace-pre-wrap text-rose-700">{r.error}</p>}
                          <pre className="max-h-80 overflow-auto rounded-lg bg-slate-900 p-3 font-mono text-xs text-slate-100">{json(r.detail)}</pre>
                          <p className="mt-1 text-xs text-slate-500">
                            Run {r.id} · {formatDateTime(r.createdAt)}
                          </p>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function StepItem({ step, index }: { step: AgentStep; index: number }) {
  if (step.type === 'message') {
    return (
      <li className="rounded-lg border border-slate-200 p-3">
        <p className="mb-1 text-xs font-medium text-slate-500">
          {index + 1}. Message
        </p>
        <p className="text-sm whitespace-pre-wrap text-slate-700">{step.text}</p>
      </li>
    );
  }
  if (step.type === 'error') {
    return (
      <li className="rounded-lg border border-rose-200 bg-rose-50 p-3">
        <p className="mb-1 text-xs font-medium text-rose-600">{index + 1}. Error</p>
        <p className="text-sm whitespace-pre-wrap text-rose-700">{step.text}</p>
      </li>
    );
  }
  const st = step.status ? STEP_STATUS[step.status] : null;
  return (
    <li className="rounded-lg border border-slate-200 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-medium text-slate-500">{index + 1}.</span>
        <code className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-xs font-semibold text-slate-800">{step.tool}</code>
        {st && <Badge color={st.color}>{st.label}</Badge>}
        {step.durationMs !== undefined && <span className="text-xs text-slate-500">{step.durationMs} ms</span>}
        {step.status === 'pending_approval' && (
          <Link to="/approvals" className="ml-auto text-xs font-medium text-indigo-700 hover:underline">
            Open approvals
          </Link>
        )}
      </div>
      <div className="mt-2 grid gap-2 lg:grid-cols-2">
        <div>
          <p className="mb-0.5 text-xs font-medium text-slate-500">Arguments</p>
          <pre className="max-h-56 overflow-auto rounded-md bg-slate-50 p-2 font-mono text-xs text-slate-700 ring-1 ring-slate-200 ring-inset">{json(step.args ?? {})}</pre>
        </div>
        <div>
          <p className="mb-0.5 text-xs font-medium text-slate-500">Result</p>
          <pre className="max-h-56 overflow-auto rounded-md bg-slate-50 p-2 font-mono text-xs text-slate-700 ring-1 ring-slate-200 ring-inset">{json(step.result)}</pre>
        </div>
      </div>
    </li>
  );
}

function AgentRunModal({ runId, initial, onClose }: { runId: string; initial: AgentRun | undefined; onClose: () => void }) {
  const query = useQuery({
    queryKey: ['agent-runs', 'run', runId],
    queryFn: () => api.get<AgentRun>(`/api/agent-runs/${encodeURIComponent(runId)}`),
    initialData: initial,
    staleTime: 0,
    refetchInterval: (q) => (q.state.data?.status === 'running' ? 2000 : false),
  });
  const run = query.data;
  const st = run ? AGENT_STATUS[run.status] : null;
  const toolCalls = run?.steps.filter((s) => s.type === 'tool_call').length ?? 0;
  return (
    <Modal open onClose={onClose} size="xl" title={run ? `${run.agentName} run` : 'Agent run'} footer={<Button onClick={onClose}>Close</Button>}>
      {query.error && !run ? (
        <ErrorBanner error={query.error} />
      ) : !run ? (
        <Loading />
      ) : (
        <div className="space-y-5">
          <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <KeyValue label="Status">
              <span className="inline-flex items-center gap-1.5">
                {st && <Badge color={st.color}>{st.label}</Badge>}
                {run.status === 'running' && <Spinner className="size-4" />}
              </span>
            </KeyValue>
            <KeyValue label="Trigger">{TRIGGERS[run.trigger] ?? run.trigger}</KeyValue>
            <KeyValue label="Started">{formatDateTime(run.createdAt)}</KeyValue>
            <KeyValue label="Duration">{run.finishedAt ? `${((Date.parse(run.finishedAt) - Date.parse(run.createdAt)) / 1000).toFixed(1)} s` : '—'}</KeyValue>
            <KeyValue label="Provider">
              <span className="capitalize">{run.provider}</span>
              {run.model && <span className="text-slate-500"> · {run.model}</span>}
            </KeyValue>
            <KeyValue label="Record">
              <RecordLink id={run.recordId} />
            </KeyValue>
            <KeyValue label="Tool calls">{toolCalls}</KeyValue>
            <KeyValue label="Run ID">
              <span className="font-mono text-xs">{run.id}</span>
            </KeyValue>
          </dl>
          <section>
            <h3 className="mb-1 text-xs font-semibold text-slate-500 uppercase">Input</h3>
            <p className="rounded-lg bg-slate-50 p-3 text-sm whitespace-pre-wrap text-slate-800 ring-1 ring-slate-200 ring-inset">{run.input}</p>
          </section>
          {run.output && (
            <section>
              <h3 className="mb-1 text-xs font-semibold text-slate-500 uppercase">Output</h3>
              <div className="rounded-lg border border-slate-200 p-3 text-sm">
                <Markdown text={run.output} onNavigate={onClose} />
              </div>
            </section>
          )}
          {run.error && <ErrorBanner error={run.error} />}
          <section>
            <h3 className="mb-2 text-xs font-semibold text-slate-500 uppercase">Steps ({run.steps.length})</h3>
            {run.steps.length ? (
              <ol className="space-y-2">
                {run.steps.map((s, i) => (
                  <StepItem key={`${i}:${s.at}`} step={s} index={i} />
                ))}
              </ol>
            ) : (
              <p className="text-sm text-slate-500">{run.status === 'running' ? 'Working…' : 'No steps were recorded.'}</p>
            )}
          </section>
        </div>
      )}
    </Modal>
  );
}

function AgentRuns({ agentId, setFilter }: { agentId: string; setFilter: (id: string) => void }) {
  const agents = useAgents();
  const runs = useQuery({
    queryKey: ['agent-runs', 'list', agentId],
    queryFn: () => api.get<AgentRun[]>(`/api/agent-runs${qs({ agentId, limit: 100 })}`),
    refetchInterval: (q) => (q.state.data?.some((r) => r.status === 'running') ? 3000 : false),
  });
  const [viewing, setViewing] = useState<string | null>(null);
  const current = agents.data?.find((a) => a.id === agentId);
  const sorted = [...(agents.data ?? [])].sort((a, b) => a.name.localeCompare(b.name));

  return (
    <div className="card overflow-hidden">
      <div className="flex flex-wrap items-center gap-3 border-b border-slate-100 p-3">
        <select aria-label="Filter by agent" className="input w-auto max-w-xs" value={agentId} onChange={(e) => setFilter(e.target.value)}>
          <option value="">All agents</option>
          {agentId && !current && <option value={agentId}>{agents.isLoading ? 'Loading…' : 'Deleted agent'}</option>}
          {sorted.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
        {agentId && <FilterChip label={`Agent: ${current?.name ?? runs.data?.[0]?.agentName ?? agentId}`} clearLabel="Clear agent filter" onClear={() => setFilter('')} />}
        <span className="ml-auto text-xs text-slate-500">Latest 100 runs</span>
      </div>
      {runs.isLoading ? (
        <Loading />
      ) : runs.error ? (
        <div className="p-4">
          <ErrorBanner error={runs.error} />
        </div>
      ) : !runs.data?.length ? (
        <EmptyState icon={Bot} title="No agent runs yet">
          Runs appear here when someone chats with an agent or an automation runs one.
        </EmptyState>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50/70 text-left text-xs font-semibold text-slate-500 uppercase">
              <tr>
                <th className="px-4 py-2.5">Time</th>
                <th className="px-4 py-2.5">Agent</th>
                <th className="px-4 py-2.5">Trigger</th>
                <th className="px-4 py-2.5">Status</th>
                <th className="px-4 py-2.5">Input</th>
                <th className="px-4 py-2.5">Provider</th>
                <th className="px-4 py-2.5 text-right">Steps</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {runs.data.map((r) => {
                const st = AGENT_STATUS[r.status] ?? { label: r.status, color: 'gray' };
                return (
                  <tr key={r.id} className="cursor-pointer align-top hover:bg-slate-50/70" onClick={() => setViewing(r.id)}>
                    <td className="px-4 py-2.5 text-slate-600">
                      <Time at={r.createdAt} />
                    </td>
                    <td className="px-4 py-2.5 font-medium whitespace-nowrap text-slate-800">{r.agentName}</td>
                    <td className="px-4 py-2.5 whitespace-nowrap text-slate-600">{TRIGGERS[r.trigger] ?? r.trigger}</td>
                    <td className="px-4 py-2.5">
                      <span className="inline-flex items-center gap-1.5">
                        <Badge color={st.color}>{st.label}</Badge>
                        {r.status === 'running' && <Spinner className="size-3.5" />}
                      </span>
                    </td>
                    <td className="max-w-md px-4 py-2.5">
                      <button
                        type="button"
                        title="View run details"
                        className="line-clamp-2 text-left text-slate-700 hover:text-indigo-700"
                        onClick={(e) => {
                          e.stopPropagation();
                          setViewing(r.id);
                        }}
                      >
                        {r.input || '(no input)'}
                      </button>
                      {r.error && <span className="line-clamp-1 text-xs text-rose-600">{r.error}</span>}
                    </td>
                    <td className="px-4 py-2.5 whitespace-nowrap text-slate-600">
                      <span className="capitalize">{r.provider}</span>
                      {r.model && <span className="block text-xs text-slate-500">{r.model}</span>}
                    </td>
                    <td className="px-4 py-2.5 text-right text-slate-600 tabular-nums">{r.steps.length}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {viewing && <AgentRunModal key={viewing} runId={viewing} initial={runs.data?.find((r) => r.id === viewing)} onClose={() => setViewing(null)} />}
    </div>
  );
}

export default function Runs() {
  const { canManageAutomations, canManageAgents } = usePermissions();
  const qc = useQueryClient();
  const [params, setParams] = useSearchParams();
  const automationId = params.get('automationId') ?? '';
  const agentId = params.get('agentId') ?? '';
  const allowed: Tab[] = [...(canManageAutomations ? (['automations'] as const) : []), ...(canManageAgents ? (['agents'] as const) : [])];
  const tabParam = params.get('tab');
  const requested: Tab = tabParam === 'agents' || tabParam === 'automations' ? tabParam : agentId && !automationId ? 'agents' : 'automations';
  const tab = allowed.includes(requested) ? requested : allowed[0];
  const [refreshing, setRefreshing] = useState(false);

  const update = (changes: Record<string, string>) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(changes)) {
      if (v) next.set(k, v);
      else next.delete(k);
    }
    setParams(next, { replace: true });
  };

  const refresh = async () => {
    setRefreshing(true);
    try {
      await qc.invalidateQueries({ queryKey: [tab === 'agents' ? 'agent-runs' : 'automation-runs'] });
    } finally {
      setRefreshing(false);
    }
  };

  return (
    <div className="mx-auto max-w-7xl p-6">
      <PageHeader
        title="Run history"
        subtitle="What automations and AI agents did, step by step."
        actions={
          tab && (
            <Button icon={RefreshCw} loading={refreshing} onClick={() => void refresh()}>
              Refresh
            </Button>
          )
        }
      />
      {!tab ? (
        <div className="card">
          <EmptyState icon={History} title="Nothing to show">
            You need permission to manage automations or agents to see run history.
          </EmptyState>
        </div>
      ) : (
        <>
          {allowed.length > 1 && (
            <div className="mb-4">
              <Tabs<Tab>
                tabs={[
                  { id: 'automations', label: 'Automation runs' },
                  { id: 'agents', label: 'Agent runs' },
                ]}
                value={tab}
                onChange={(t) => update({ tab: t })}
              />
            </div>
          )}
          <div className={cx(allowed.length === 1 && 'mt-2')}>
            {tab === 'automations' ? <AutomationRuns automationId={automationId} setFilter={(id) => update({ automationId: id })} /> : <AgentRuns agentId={agentId} setFilter={(id) => update({ agentId: id, tab: 'agents' })} />}
          </div>
        </>
      )}
    </div>
  );
}
