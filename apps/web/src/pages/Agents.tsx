import type { AgentDef, Conversation } from '@titoforce/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { History, MessageSquare, MessageSquarePlus, Settings2, Trash2, Wrench } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { api, errorMessage } from '../api.ts';
import { AgentChat, AUTONOMY_LABEL } from '../components/AgentChat.tsx';
import { useConfirm, useToast } from '../components/feedback.tsx';
import { Badge, Button, cx, EmptyState, ErrorBanner, Loading, ObjectTile, Popover } from '../components/ui.tsx';
import { relativeTime } from '../lib/format.ts';
import { useAgents, usePermissions } from '../lib/hooks.ts';

type ConversationSummary = Omit<Conversation, 'messages'>;

const AUTONOMY_HELP: Record<AgentDef['autonomy'], string> = {
  read_only: 'Can look things up but never changes data.',
  approval_required: 'Proposes changes; a person approves each one before it runs.',
  autonomous: 'Makes changes directly, within your permissions. Every action is logged.',
};

export default function Agents() {
  const { agentId } = useParams();
  const agents = useAgents();
  const perms = usePermissions();
  if (agents.isLoading) return <Loading />;
  if (agents.error)
    return (
      <div className="p-6">
        <ErrorBanner error={agents.error} />
      </div>
    );
  const active = (agents.data ?? []).filter((a) => a.active);
  const agent = active.find((a) => a.id === agentId) ?? active.find((a) => a.id === 'agt_copilot') ?? active[0];
  if (!agent)
    return (
      <div className="p-6">
        <EmptyState
          title="No active agents"
          action={
            perms.canManageAgents ? (
              <Link to="/setup/agents" className="text-sm font-medium text-indigo-600 hover:underline">
                Set up agents
              </Link>
            ) : undefined
          }
        >
          Ask an administrator to activate an agent.
        </EmptyState>
      </div>
    );
  return <AgentPage key={agent.id} agent={agent} agents={active} />;
}

function AgentPage({ agent, agents }: { agent: AgentDef; agents: AgentDef[] }) {
  const perms = usePermissions();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const urlConversation = params.get('c');
  // The chat remounts only when the user opens a conversation (or starts a new one). A conversation id the
  // chat itself reports after its first message updates the URL without remounting the live chat.
  const [chat, setChat] = useState({ conversationId: urlConversation, nonce: 0 });
  const [activeId, setActiveIdState] = useState(urlConversation);
  const activeRef = useRef(urlConversation);
  const setActive = (id: string | null) => {
    activeRef.current = id;
    setActiveIdState(id);
  };
  const open = (id: string | null, pushUrl: boolean) => {
    setActive(id);
    setChat((s) => ({ conversationId: id, nonce: s.nonce + 1 }));
    if (pushUrl) setParams(id ? { c: id } : {});
  };
  // Browser back/forward: follow URL changes that did not come from this page.
  const previousUrl = useRef(urlConversation);
  useEffect(() => {
    if (previousUrl.current === urlConversation) return;
    previousUrl.current = urlConversation;
    if (urlConversation !== activeRef.current) open(urlConversation, false);
  }, [urlConversation]);

  const autonomy = AUTONOMY_LABEL[agent.autonomy];
  const history = <ConversationList agent={agent} activeId={activeId} onOpen={(id) => open(id, true)} />;

  return (
    <div className="flex h-full min-h-0">
      <aside className="hidden w-72 shrink-0 flex-col border-r border-slate-200 bg-white @2xl:flex" aria-label="Agents">
        <div className="flex items-center justify-between px-4 pt-4 pb-2">
          <h1 className="text-sm font-semibold text-slate-900">AI agents</h1>
          {perms.canManageAgents && (
            <Link to="/setup/agents" className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700" aria-label="Manage agents" title="Manage agents">
              <Settings2 className="size-4" />
            </Link>
          )}
        </div>
        <nav className="space-y-0.5 px-2" aria-label="Agent list">
          {agents.map((a) => (
            <Link
              key={a.id}
              to={`/agents/${a.id}`}
              aria-current={a.id === agent.id ? 'page' : undefined}
              className={cx('flex items-center gap-2.5 rounded-lg px-2 py-2 text-sm', a.id === agent.id ? 'bg-indigo-50 text-indigo-900' : 'text-slate-700 hover:bg-slate-50')}
            >
              <ObjectTile icon={a.icon} color={a.color} size="sm" />
              <span className="min-w-0 flex-1 truncate font-medium">{a.name}</span>
            </Link>
          ))}
        </nav>
        <div className="mt-4 flex min-h-0 flex-1 flex-col border-t border-slate-100">
          <div className="flex items-center justify-between px-4 pt-3 pb-1">
            <h2 className="text-xs font-semibold tracking-wide text-slate-400 uppercase">Conversations</h2>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">{history}</div>
        </div>
      </aside>

      <section className="flex min-w-0 flex-1 flex-col bg-white" aria-label={agent.name}>
        <header className="flex flex-wrap items-center gap-3 border-b border-slate-200 px-4 py-3">
          <ObjectTile icon={agent.icon} color={agent.color} />
          <div className="min-w-0 flex-1">
            <label htmlFor="agent-switch" className="sr-only">
              Agent
            </label>
            <select id="agent-switch" className="input h-8 w-auto py-0 font-semibold @2xl:hidden" value={agent.id} onChange={(e) => navigate(`/agents/${e.target.value}`)}>
              {agents.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
            <h2 className="hidden truncate font-semibold text-slate-900 @2xl:block">{agent.name}</h2>
            <p className="truncate text-xs text-slate-500">{agent.description}</p>
          </div>
          <span title={AUTONOMY_HELP[agent.autonomy]}>
            <Badge color={autonomy.color}>{autonomy.label}</Badge>
          </span>
          <Popover
            align="right"
            className="w-72 p-3"
            trigger={({ toggle, open: isOpen }) => (
              <Button size="sm" icon={Wrench} onClick={toggle} aria-expanded={isOpen}>
                {agent.tools.length} tools
              </Button>
            )}
          >
            {() => (
              <div>
                <p className="text-xs text-slate-500">{AUTONOMY_HELP[agent.autonomy]}</p>
                <ul className="mt-2 flex flex-wrap gap-1" aria-label="Tools">
                  {agent.tools.map((t) => (
                    <li key={t}>
                      <code className="rounded bg-slate-100 px-1.5 py-0.5 text-[11px] text-slate-700">{t}</code>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </Popover>
          <div className="@2xl:hidden">
            <Popover
              align="right"
              className="max-h-96 w-72 overflow-y-auto p-2"
              trigger={({ toggle, open: isOpen }) => (
                <Button size="sm" icon={History} onClick={toggle} aria-expanded={isOpen}>
                  History
                </Button>
              )}
            >
              {(close) => (
                <div onClick={(e) => (e.target as HTMLElement).closest('[data-open-conversation]') && close()}>
                  <ConversationList agent={agent} activeId={activeId} onOpen={(id) => open(id, true)} />
                </div>
              )}
            </Popover>
          </div>
          <Button size="sm" icon={MessageSquarePlus} onClick={() => open(null, true)}>
            New chat
          </Button>
        </header>
        <div className="min-h-0 flex-1">
          <AgentChat
            key={`${chat.conversationId ?? 'new'}:${chat.nonce}`}
            agent={agent}
            conversationId={chat.conversationId}
            onConversation={(id) => {
              setActive(id);
              setParams({ c: id }, { replace: true });
              void qc.invalidateQueries({ queryKey: ['conversations'] });
            }}
          />
        </div>
      </section>
    </div>
  );
}

function ConversationList({ agent, activeId, onOpen }: { agent: AgentDef; activeId: string | null; onOpen: (id: string | null) => void }) {
  const list = useQuery({
    queryKey: ['conversations', agent.id],
    queryFn: () => api.get<ConversationSummary[]>(`/api/conversations?agentId=${encodeURIComponent(agent.id)}`),
  });
  const qc = useQueryClient();
  const confirm = useConfirm();
  const toast = useToast();
  const remove = useMutation({
    mutationFn: (id: string) => api.del(`/api/conversations/${id}`),
    onSuccess: async (_res, id) => {
      if (id === activeId) onOpen(null);
      await qc.invalidateQueries({ queryKey: ['conversations'] });
    },
    onError: (err) => toast.error(errorMessage(err)),
  });
  if (list.isLoading) return <p className="px-2 py-1 text-xs text-slate-400">Loading…</p>;
  if (list.error) return <ErrorBanner error={list.error} />;
  if (!list.data?.length) return <p className="px-2 py-1 text-xs text-slate-400">No conversations with {agent.name} yet.</p>;
  return (
    <ul className="space-y-0.5" aria-label={`Conversations with ${agent.name}`}>
      {list.data.map((c) => (
        <li key={c.id} className="group flex items-center">
          <button
            type="button"
            data-open-conversation
            onClick={() => c.id !== activeId && onOpen(c.id)}
            aria-current={c.id === activeId ? 'true' : undefined}
            className={cx('flex min-w-0 flex-1 items-start gap-2 rounded-lg px-2 py-1.5 text-left', c.id === activeId ? 'bg-slate-100' : 'hover:bg-slate-50')}
          >
            <MessageSquare className="mt-0.5 size-3.5 shrink-0 text-slate-400" aria-hidden />
            <span className="min-w-0">
              <span className="block truncate text-sm text-slate-700">{c.title || 'Untitled conversation'}</span>
              <span className="block text-[11px] text-slate-400">{relativeTime(c.updatedAt)}</span>
            </span>
          </button>
          <button
            type="button"
            aria-label={`Delete conversation “${c.title || 'Untitled'}”`}
            className="ml-0.5 rounded p-1 text-slate-300 opacity-0 group-hover:opacity-100 hover:bg-rose-50 hover:text-rose-600 focus-visible:opacity-100"
            onClick={async () => {
              const ok = await confirm({ title: 'Delete conversation?', message: 'The conversation history will be removed. Agent run logs are kept.', confirmLabel: 'Delete', danger: true });
              if (ok) remove.mutate(c.id);
            }}
          >
            <Trash2 className="size-3.5" />
          </button>
        </li>
      ))}
    </ul>
  );
}
