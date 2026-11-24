import type { AgentDef, AgentRun, AgentStep, Conversation } from '@titoforce/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, ChevronDown, ChevronRight, CircleCheck, CircleX, Clock, Info, Send, Wrench, X } from 'lucide-react';
import { type KeyboardEvent, useEffect, useRef, useState } from 'react';
import { api, errorMessage } from '../api.ts';
import { type MessageKey, t, tEn, tryT } from '../i18n/index.ts';
import { invalidateRecordData, useAiStatus } from '../lib/hooks.ts';
import { Markdown } from '../lib/markdown.tsx';
import { Badge, Button, cx, ErrorBanner, Loading, ObjectTile, Spinner } from './ui.tsx';

const SUGGESTIONS: Record<string, MessageKey[]> = {
  agt_copilot: ['agents.suggestions.myDay', 'agents.suggestions.myOpenOpportunities', 'agents.suggestions.openCasesByPriority', 'agents.suggestions.pipeline'],
  agt_lead_qualifier: ['agents.suggestions.qualifyLeads', 'agents.suggestions.newLeads'],
  agt_service_triage: ['agents.suggestions.triageCases', 'agents.suggestions.openCasesByPriority'],
  agt_deal_coach: ['agents.suggestions.myOpenOpportunities', 'agents.suggestions.pipeline'],
  agt_hr_assistant: ['agents.suggestions.ptoBalance', 'agents.suggestions.employeesByDepartment', 'agents.suggestions.openRequisitions'],
  agt_project_manager: ['agents.suggestions.overdueWorkItems', 'agents.suggestions.workItemsByStatus'],
};
const RECORD_SUGGESTIONS: MessageKey[] = ['agents.suggestions.summarizeRecord', 'agents.suggestions.recordNextSteps', 'agents.suggestions.logCall'];

export const AUTONOMY_LABEL: Record<AgentDef['autonomy'], { label: string; color: string }> = {
  read_only: {
    get label() {
      return t('agents.autonomy.readOnly');
    },
    color: 'gray',
  },
  approval_required: {
    get label() {
      return t('agents.autonomy.approvalRequired');
    },
    color: 'orange',
  },
  autonomous: {
    get label() {
      return t('agents.autonomy.autonomous');
    },
    color: 'green',
  },
};

const humanize = (s: string) => s.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase());

/** Display name of an agent tool, e.g. `search_records` → "Search records"; unknown tools are humanized. */
const toolLabel = (tool: string) => tryT(`agents.tools.${tool.replace(/_([a-z0-9])/g, (_m, c: string) => c.toUpperCase())}`) ?? humanize(tool);

function summarizeArgs(args: unknown): string {
  if (!args || typeof args !== 'object') return '';
  const text = Object.entries(args as Record<string, unknown>)
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => `${k}: ${typeof v === 'string' ? v : JSON.stringify(v)}`)
    .join(' · ');
  return text.length > 140 ? `${text.slice(0, 140)}…` : text;
}

function StepStatusIcon({ status }: { status?: AgentStep['status'] }) {
  if (status === 'error') return <CircleX className="size-3.5 text-rose-500" aria-label={t('agents.stepStatus.error')} />;
  if (status === 'rejected') return <CircleX className="size-3.5 text-slate-400" aria-label={t('agents.stepStatus.rejected')} />;
  if (status === 'pending_approval') return <Clock className="size-3.5 text-amber-500" aria-label={t('agents.stepStatus.pendingApproval')} />;
  return <CircleCheck className="size-3.5 text-emerald-500" aria-label={t('agents.stepStatus.ok')} />;
}

function StepRow({ step }: { step: AgentStep }) {
  const [open, setOpen] = useState(false);
  if (step.type !== 'tool_call') {
    if (step.type === 'error') return <li className="text-xs text-rose-600">{step.text}</li>;
    return null;
  }
  return (
    <li className="text-xs">
      <button type="button" className="flex w-full items-start gap-1.5 text-left text-slate-600 hover:text-slate-900" onClick={() => setOpen(!open)} aria-expanded={open}>
        <span className="mt-0.5">
          <StepStatusIcon status={step.status} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="font-medium text-slate-700">{step.tool == null ? t('agents.chat.tool') : toolLabel(step.tool)}</span>
          <span className="ml-1.5 break-words text-slate-500">{summarizeArgs(step.args)}</span>
        </span>
        {step.durationMs !== undefined && <span className="shrink-0 text-slate-400 tabular-nums">{t('agents.chat.durationMs', { ms: String(step.durationMs) })}</span>}
      </button>
      {open && (
        <pre className="mt-1 ml-5 max-h-56 overflow-auto rounded-md bg-slate-900 p-2 text-[11px] leading-relaxed text-slate-100">
          {JSON.stringify({ args: step.args, result: step.result }, null, 2)}
        </pre>
      )}
    </li>
  );
}

function PendingAction({ run, step }: { run: AgentRun; step: AgentStep }) {
  const qc = useQueryClient();
  const decide = useMutation({
    mutationFn: (d: 'approve' | 'reject') => api.post(`/api/agent-actions/${step.actionId}/${d}`),
    onSettled: async () => {
      await qc.invalidateQueries({ queryKey: ['agent-run', run.id] });
      await invalidateRecordData(qc);
    },
  });
  const summary = (step.result as { summary?: string } | undefined)?.summary ?? (step.tool == null ? t('agents.chat.action') : toolLabel(step.tool));
  return (
    <div className="rounded-lg border border-amber-200 bg-amber-50 p-2.5 text-sm">
      <p className="flex items-start gap-1.5 text-amber-900">
        <Clock className="mt-0.5 size-4 shrink-0" aria-hidden />
        <span>
          <span className="font-medium">{t('agents.chat.awaitingApproval')}</span> {summary}
        </span>
      </p>
      <ErrorBanner error={decide.error} className="mt-2" />
      <div className="mt-2 flex gap-2">
        <Button size="sm" variant="primary" icon={Check} loading={decide.isPending && decide.variables === 'approve'} disabled={decide.isPending} onClick={() => decide.mutate('approve')}>
          {t('agents.chat.approve')}
        </Button>
        <Button size="sm" icon={X} loading={decide.isPending && decide.variables === 'reject'} disabled={decide.isPending} onClick={() => decide.mutate('reject')}>
          {t('agents.chat.reject')}
        </Button>
      </div>
    </div>
  );
}

function AssistantAvatar({ agent }: { agent: Pick<AgentDef, 'icon' | 'color'> }) {
  return (
    <div className="mt-0.5 shrink-0">
      <ObjectTile icon={agent.icon} color={agent.color} size="sm" />
    </div>
  );
}

/** An assistant turn backed by an agent run. Polls while the run is in progress. */
function RunMessage({ agent, runId, content, live, onChange, onFinished }: { agent: AgentDef; runId?: string; content?: string; live: boolean; onChange: () => void; onFinished?: () => void }) {
  const qc = useQueryClient();
  const [expanded, setExpanded] = useState(false);
  const run = useQuery({
    queryKey: ['agent-run', runId],
    queryFn: () => api.get<AgentRun>(`/api/agent-runs/${runId}`),
    enabled: !!runId && (live || expanded || content === undefined),
    refetchInterval: (q) => (live && q.state.data?.status !== 'completed' && q.state.data?.status !== 'failed' ? 800 : false),
  });
  const data = run.data;
  const running = live && (!data || data.status === 'running');
  const finished = data && data.status !== 'running';
  const toolSteps = data?.steps.filter((s) => s.type === 'tool_call') ?? [];
  const pending = data?.steps.filter((s) => s.status === 'pending_approval' && s.actionId) ?? [];

  const finishedRef = useRef(onFinished);
  finishedRef.current = onFinished;
  useEffect(() => {
    if (!live || !finished) return;
    // The agent may have changed records; refresh anything derived from them.
    void invalidateRecordData(qc);
    finishedRef.current?.();
  }, [live, finished, qc]);
  useEffect(onChange, [data?.steps.length, data?.status, pending.length, expanded, onChange]);

  const text = content ?? (data ? (data.output ?? (data.error ? t('agents.chat.runError', { error: data.error }) : '')) : '');
  return (
    <div className="flex gap-2.5">
      <AssistantAvatar agent={agent} />
      <div className="min-w-0 flex-1 space-y-2">
        {running ? (
          <div className="space-y-1.5 rounded-2xl rounded-tl-sm bg-slate-50 px-3.5 py-2.5">
            <p className="flex items-center gap-2 text-sm text-slate-500">
              <Spinner className="size-4" /> {toolSteps.length ? t('agents.chat.working') : t('agents.chat.thinking')}
            </p>
            {toolSteps.length > 0 && (
              <ul className="space-y-1">
                {toolSteps.map((s, i) => (
                  <StepRow key={i} step={s} />
                ))}
              </ul>
            )}
          </div>
        ) : (
          <div className={cx('rounded-2xl rounded-tl-sm px-3.5 py-2.5 text-sm text-slate-800', data?.status === 'failed' ? 'bg-rose-50' : 'bg-slate-50')}>
            {text ? <Markdown text={text} className="prose-chat" /> : run.isLoading ? <Spinner className="size-4" /> : <span className="text-slate-400">{t('agents.chat.noResponse')}</span>}
          </div>
        )}
        {data && pending.map((s) => <PendingAction key={s.actionId} run={data} step={s} />)}
        {runId && !running && (
          <div className="text-xs text-slate-400">
            <button type="button" className="inline-flex items-center gap-1 hover:text-slate-600" onClick={() => setExpanded(!expanded)} aria-expanded={expanded}>
              {expanded ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
              <Wrench className="size-3" aria-hidden />
              {data ? `${t('agents.chat.toolCalls', { count: toolSteps.length })} · ${data.provider}${data.model ? ` (${data.model})` : ''}` : t('agents.chat.showSteps')}
            </button>
            {expanded && data && (
              <ul className="mt-1.5 space-y-1 border-l-2 border-slate-100 pl-2.5">
                {toolSteps.length ? toolSteps.map((s, i) => <StepRow key={i} step={s} />) : <li>{t('agents.chat.noTools')}</li>}
              </ul>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

type ChatItem = { key: string; role: 'user' | 'assistant'; content?: string; runId?: string; live?: boolean };

let seq = 0;
const nextKey = () => `m${++seq}`;

export interface AgentChatProps {
  agent: AgentDef;
  conversationId?: string | null;
  recordId?: string | null;
  recordName?: string | null;
  onConversation?: (id: string) => void;
  compact?: boolean;
  /** Sent automatically once when the chat opens (e.g. "Summarize this record"). */
  initialPrompt?: string;
}

/**
 * Chat with an agent. `conversationId` is read once on mount (new conversations are reported through
 * `onConversation`); remount with a different `key` to switch conversations.
 */
export function AgentChat(props: AgentChatProps) {
  const [conversationId] = useState(props.conversationId ?? null);
  const conv = useQuery({
    queryKey: ['conversation', conversationId],
    queryFn: () => api.get<Conversation>(`/api/conversations/${conversationId}`),
    enabled: !!conversationId,
    staleTime: Number.POSITIVE_INFINITY,
    gcTime: 0,
  });
  if (conversationId && conv.isLoading) return <Loading label={t('agents.chat.loadingConversation')} />;
  if (conv.error) return <ErrorBanner error={conv.error} className="m-4" />;
  const initial: ChatItem[] = (conv.data?.messages ?? []).map((m) => ({ key: nextKey(), role: m.role, content: m.content, runId: m.runId }));
  return <ChatBody {...props} conversationId={conversationId} initial={initial} />;
}

function ChatBody({ agent, conversationId, recordId, recordName, onConversation, compact, initialPrompt, initial }: AgentChatProps & { initial: ChatItem[] }) {
  const ai = useAiStatus();
  const [items, setItems] = useState<ChatItem[]>(initial);
  const [convId, setConvId] = useState(conversationId ?? null);
  const [draft, setDraft] = useState('');
  const scroller = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);

  const scrollDown = useRef(() => {
    const el = scroller.current;
    if (el) el.scrollTop = el.scrollHeight;
  }).current;
  useEffect(scrollDown, [items.length, scrollDown]);

  const send = useMutation({
    mutationFn: (message: string) => api.post<{ runId: string; conversationId: string }>(`/api/agents/${agent.id}/chat`, { message, conversationId: convId, recordId: recordId ?? undefined }),
    onMutate: (message) => setItems((prev) => [...prev, { key: nextKey(), role: 'user', content: message }]),
    onSuccess: (res) => {
      if (res.conversationId !== convId) {
        setConvId(res.conversationId);
        onConversation?.(res.conversationId);
      }
      setItems((prev) => [...prev, { key: nextKey(), role: 'assistant', runId: res.runId, live: true }]);
    },
    onError: (err) => setItems((prev) => [...prev, { key: nextKey(), role: 'assistant', content: t('agents.chat.sendFailed', { error: errorMessage(err) }) }]),
  });

  const live = items.some((i) => i.live);
  const busy = send.isPending;
  const submit = (text = draft) => {
    const message = text.trim();
    if (!message || busy) return;
    setDraft('');
    send.mutate(message);
    input.current?.focus();
  };
  const autoSent = useRef(false);
  useEffect(() => {
    if (!initialPrompt || autoSent.current || initial.length) return;
    autoSent.current = true;
    send.mutate(initialPrompt);
  }, []);
  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      submit();
    }
  };
  // Suggestions are sent as prompts; the built-in offline rules engine only understands English.
  const promptText = (key: MessageKey) => (ai.data?.configured ? t(key) : tEn(key));
  const suggestions = (recordId ? RECORD_SUGGESTIONS : (SUGGESTIONS[agent.id] ?? SUGGESTIONS.agt_copilot!)).map(promptText);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div ref={scroller} className={cx('min-h-0 flex-1 space-y-4 overflow-y-auto', compact ? 'p-3' : 'p-5')} aria-live="polite">
        {ai.data && !ai.data.configured && (
          <p className="flex items-start gap-1.5 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-500">
            <Info className="mt-px size-3.5 shrink-0" aria-hidden />
            <span>{t('agents.chat.offline')}</span>
          </p>
        )}
        {items.length === 0 && (
          <div className="py-6 text-center">
            <div className="mx-auto w-fit">
              <ObjectTile icon={agent.icon} color={agent.color} size="lg" />
            </div>
            <h3 className="mt-3 font-semibold text-slate-900">{agent.name}</h3>
            <p className="mx-auto mt-1 max-w-md text-sm text-slate-500">{agent.description}</p>
            <div className="mt-2">
              <Badge color={AUTONOMY_LABEL[agent.autonomy].color}>{AUTONOMY_LABEL[agent.autonomy].label}</Badge>
            </div>
            {recordName && <p className="mt-3 text-xs text-slate-500">{t('agents.chat.context', { record: recordName })}</p>}
            <div className="mt-4 flex flex-wrap justify-center gap-2">
              {suggestions.map((s) => (
                <button key={s} type="button" onClick={() => submit(s)} className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-700 shadow-xs hover:border-indigo-300 hover:text-indigo-700">
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}
        {items.map((item) =>
          item.role === 'user' ? (
            <div key={item.key} className="flex justify-end">
              <div className="max-w-[85%] rounded-2xl rounded-tr-sm bg-indigo-600 px-3.5 py-2 text-sm whitespace-pre-wrap text-white">{item.content}</div>
            </div>
          ) : (
            <RunMessage
              key={item.key}
              agent={agent}
              runId={item.runId}
              content={item.content}
              live={!!item.live}
              onChange={scrollDown}
              onFinished={() => setItems((prev) => prev.map((x) => (x.key === item.key ? { ...x, live: false } : x)))}
            />
          ),
        )}
        {busy && (
          <div className="flex gap-2.5">
            <AssistantAvatar agent={agent} />
            <p className="flex items-center gap-2 text-sm text-slate-500">
              <Spinner className="size-4" /> {t('agents.chat.sending')}
            </p>
          </div>
        )}
      </div>
      <form
        className={cx('border-t border-slate-200 bg-white', compact ? 'p-2.5' : 'p-3')}
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <div className="flex items-end gap-2 rounded-xl border border-slate-300 bg-white p-1.5 focus-within:border-indigo-500 focus-within:ring-2 focus-within:ring-indigo-500/20">
          <textarea
            ref={input}
            aria-label={t('agents.chat.messageLabel', { agent: agent.name })}
            rows={1}
            value={draft}
            disabled={!agent.active}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder={agent.active ? t('agents.chat.messagePlaceholder', { agent: agent.name }) : t('agents.chat.inactive')}
            className="max-h-40 min-h-9 flex-1 resize-none border-0 bg-transparent px-2 py-1.5 text-sm outline-none [field-sizing:content] placeholder:text-slate-400"
          />
          <Button type="submit" variant="ai" icon={Send} disabled={!draft.trim() || busy || !agent.active} aria-label={t('agents.chat.send')}>
            {compact ? null : t('agents.chat.send')}
          </Button>
        </div>
        {live && <p className="mt-1 px-1 text-[11px] text-slate-400">{t('agents.chat.keepTyping')}</p>}
      </form>
    </div>
  );
}
