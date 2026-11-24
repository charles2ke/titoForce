import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { PALETTE, type AgentAutonomy, type AgentDef, type PaletteColor, type ToolInfo } from '@titoforce/shared';
import type { LucideIcon } from 'lucide-react';
import { Bot, BrainCircuit, CircleCheck, Eye, Hand, History, MessageSquare, Pencil, Plus, Search, Trash, TriangleAlert, Zap } from 'lucide-react';
import { useId, useState } from 'react';
import { Link } from 'react-router';
import { api, errorMessage } from '../../api.ts';
import { useConfirm, useToast } from '../../components/feedback.tsx';
import { ColorPicker, IconPicker, InlineToggle } from '../../components/pickers.tsx';
import { Badge, Button, cx, EmptyState, ErrorBanner, FormField, IconButton, Loading, Modal, ObjectTile, PageHeader, Spinner, Toggle } from '../../components/ui.tsx';
import { type MessageKey, t, tryT } from '../../i18n/index.ts';
import { useAgents, useAiStatus } from '../../lib/hooks.ts';

const AUTONOMY: { id: AgentAutonomy; label: MessageKey; color: string; icon: LucideIcon; text: MessageKey }[] = [
  { id: 'read_only', label: 'setupAgents.autonomy.readOnly.label', color: 'gray', icon: Eye, text: 'setupAgents.autonomy.readOnly.text' },
  {
    id: 'approval_required',
    label: 'setupAgents.autonomy.approvalRequired.label',
    color: 'yellow',
    icon: Hand,
    text: 'setupAgents.autonomy.approvalRequired.text',
  },
  {
    id: 'autonomous',
    label: 'setupAgents.autonomy.autonomous.label',
    color: 'green',
    icon: Zap,
    text: 'setupAgents.autonomy.autonomous.text',
  },
];
const autonomyOf = (a: AgentAutonomy) => AUTONOMY.find((x) => x.id === a) ?? AUTONOMY[0]!;

const isPalette = (c: string): c is PaletteColor => (PALETTE as readonly string[]).includes(c);
// Tool names are keyed by the server's tool id in camelCase; unknown tools show their humanized id.
const toolLabel = (name: string) => tryT(`setupAgents.toolNames.${name.replace(/_([a-z])/g, (_m, c: string) => c.toUpperCase())}`) ?? name.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());
// Brand names (openai, anthropic) have no message and are shown as-is.
const providerLabel = (provider: string) => tryT(`setupAgents.providers.${provider}`) ?? provider;

function useTools() {
  return useQuery({ queryKey: ['ai-tools'], queryFn: () => api.get<ToolInfo[]>('/api/ai/tools'), staleTime: 10 * 60_000 });
}

function StatusCard() {
  const status = useAiStatus();
  const s = status.data;
  return (
    <section aria-label={t('setupAgents.status.title')} className="card mb-6 flex flex-wrap items-start gap-4 p-4">
      <div className={cx('flex size-10 shrink-0 items-center justify-center rounded-xl', s?.configured ? 'bg-emerald-50 text-emerald-600' : 'bg-amber-50 text-amber-600')}>
        <BrainCircuit className="size-5" aria-hidden />
      </div>
      <div className="min-w-0 flex-1">
        {status.isLoading ? (
          <Spinner />
        ) : status.error ? (
          <ErrorBanner error={status.error} />
        ) : s ? (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-sm font-semibold text-slate-900">{t('setupAgents.status.title')}</h2>
              {s.configured ? (
                <Badge color="green">
                  <CircleCheck className="size-3" aria-hidden /> {t('setupAgents.status.connected')}
                </Badge>
              ) : (
                <Badge color="yellow">{t('setupAgents.status.offline')}</Badge>
              )}
            </div>
            <dl className="mt-1 flex flex-wrap gap-x-6 gap-y-1 text-sm">
              <div className="flex gap-1.5">
                <dt className="text-slate-500">{t('setupAgents.status.provider')}</dt>
                <dd className="font-medium text-slate-800 capitalize">{providerLabel(s.provider)}</dd>
              </div>
              <div className="flex gap-1.5">
                <dt className="text-slate-500">{t('setupAgents.status.model')}</dt>
                <dd className="font-medium text-slate-800">{s.model ?? '—'}</dd>
              </div>
            </dl>
            <p className="mt-1.5 text-sm text-slate-600">{s.note}</p>
            {!s.configured && <p className="mt-1 text-xs text-slate-500">{t('setupAgents.status.offlineNote')}</p>}
          </>
        ) : null}
      </div>
    </section>
  );
}

function ToolList({ tools, kind, value, onChange, disabledNote }: { tools: ToolInfo[]; kind: 'read' | 'write'; value: string[]; onChange: (v: string[]) => void; disabledNote?: string }) {
  const list = tools.filter((tool) => tool.kind === kind);
  const names = list.map((tool) => tool.name);
  const all = names.every((n) => value.includes(n));
  const title = t(`setupAgents.toolKinds.${kind}.title`);
  return (
    <fieldset aria-label={title} className="rounded-lg border border-slate-200">
      <div className="flex items-center gap-2 border-b border-slate-100 bg-slate-50/70 px-3 py-2">
        <span className="text-sm font-medium text-slate-800">{title}</span>
        <span className="text-xs text-slate-500">{t(`setupAgents.toolKinds.${kind}.text`)}</span>
        <Button size="sm" variant="ghost" className="ml-auto" onClick={() => onChange(all ? value.filter((v) => !names.includes(v)) : [...new Set([...value, ...names])])}>
          {all ? t(`setupAgents.toolKinds.${kind}.clear`) : t(`setupAgents.toolKinds.${kind}.selectAll`)}
        </Button>
      </div>
      {disabledNote && (
        <p className="flex items-start gap-1.5 border-b border-amber-100 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          <TriangleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          {disabledNote}
        </p>
      )}
      <ul className="divide-y divide-slate-100">
        {list.map((tool) => (
          <li key={tool.name}>
            <label className="flex cursor-pointer items-start gap-2.5 px-3 py-2 hover:bg-slate-50">
              <input
                type="checkbox"
                className="mt-0.5 size-4 accent-indigo-600"
                checked={value.includes(tool.name)}
                onChange={(e) => onChange(e.target.checked ? [...value, tool.name] : value.filter((v) => v !== tool.name))}
              />
              <span className="min-w-0">
                <span className="block text-sm font-medium text-slate-800">{toolLabel(tool.name)}</span>
                <span className="block text-xs text-slate-500">{tool.description}</span>
              </span>
            </label>
          </li>
        ))}
      </ul>
    </fieldset>
  );
}

function AgentForm({ agent, onClose }: { agent: AgentDef | null; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const tools = useTools();
  const isNew = !agent;
  const formId = useId();
  const ids = { name: useId(), desc: useId(), instructions: useId(), icon: useId(), autonomy: useId() };
  const [name, setName] = useState(agent?.name ?? '');
  const [description, setDescription] = useState(agent?.description ?? '');
  const [instructions, setInstructions] = useState(agent?.instructions ?? '');
  const [autonomy, setAutonomy] = useState<AgentAutonomy>(agent?.autonomy ?? 'approval_required');
  const [selected, setSelected] = useState<string[]>(agent?.tools ?? []);
  const [icon, setIcon] = useState(agent?.icon ?? 'bot');
  const [color, setColor] = useState<PaletteColor>(agent && isPalette(agent.color) ? agent.color : 'indigo');
  const [active, setActive] = useState(agent?.active ?? true);

  const known = tools.data ?? [];
  // Drop tools that no longer exist on the server; it rejects unknown names.
  const effective = tools.data ? selected.filter((n) => known.some((tool) => tool.name === n)) : selected;
  const writeSelected = known.filter((tool) => tool.kind === 'write' && selected.includes(tool.name)).length;
  const problem = !name.trim() ? t('setupAgents.form.problems.enterName') : !effective.length ? t('setupAgents.form.problems.chooseTool') : null;

  const save = useMutation({
    mutationFn: () => {
      const body = { name: name.trim(), description: description.trim(), instructions: instructions.trim(), tools: effective, autonomy, icon, color, active };
      return isNew ? api.post<AgentDef>('/api/agents', body) : api.patch<AgentDef>(`/api/agents/${agent!.id}`, body);
    },
    onSuccess: async (saved) => {
      toast.success(isNew ? t('setupAgents.toasts.created', { name: saved.name }) : t('setupAgents.toasts.saved', { name: saved.name }));
      onClose();
      await qc.invalidateQueries({ queryKey: ['agents'] });
    },
  });

  return (
    <Modal
      open
      onClose={onClose}
      title={isNew ? t('setupAgents.new') : t('setupAgents.edit', { name: agent?.name ?? '' })}
      size="xl"
      footer={
        <>
          {problem && <span className="mr-auto text-xs text-slate-500">{problem}</span>}
          <Button onClick={onClose}>{t('common.cancel')}</Button>
          <Button variant="primary" type="submit" form={formId} disabled={!!problem} loading={save.isPending}>
            {isNew ? t('setupAgents.form.create') : t('setupAgents.form.save')}
          </Button>
        </>
      }
    >
      <form
        id={formId}
        className="space-y-5"
        onSubmit={(e) => {
          e.preventDefault();
          if (!problem) save.mutate();
        }}
      >
        <ErrorBanner error={save.error} />
        {agent?.builtIn && <p className="rounded-lg bg-indigo-50 px-3 py-2 text-xs text-indigo-800">{t('setupAgents.form.builtInNote')}</p>}
        <div className="grid gap-4 sm:grid-cols-[1fr_auto]">
          <FormField label={t('common.name')} required htmlFor={ids.name}>
            <input id={ids.name} className="input" value={name} maxLength={80} placeholder={t('setupAgents.form.namePlaceholder')} onChange={(e) => setName(e.target.value)} />
          </FormField>
          <FormField label={t('common.icon')} htmlFor={ids.icon} className="sm:w-56">
            <IconPicker id={ids.icon} value={icon} onChange={setIcon} />
          </FormField>
          <FormField label={t('common.description')} htmlFor={ids.desc} help={t('setupAgents.form.descriptionHelp')}>
            <textarea id={ids.desc} className="input" rows={2} maxLength={1000} value={description} onChange={(e) => setDescription(e.target.value)} />
          </FormField>
          <div className="sm:w-56">
            <span className="label">{t('common.color')}</span>
            <ColorPicker value={color} onChange={setColor} size="sm" />
          </div>
        </div>
        <FormField label={t('setupAgents.form.instructions')} htmlFor={ids.instructions} help={t('setupAgents.form.instructionsHelp', { length: String(instructions.length) })}>
          <textarea
            id={ids.instructions}
            className="input font-mono text-xs leading-relaxed"
            rows={8}
            maxLength={8000}
            placeholder={t('setupAgents.form.instructionsPlaceholder')}
            value={instructions}
            onChange={(e) => setInstructions(e.target.value)}
          />
        </FormField>

        <div>
          <span id={ids.autonomy} className="label">
            {t('setupAgents.form.autonomy')}
          </span>
          <div role="radiogroup" aria-labelledby={ids.autonomy} className="grid gap-2 sm:grid-cols-3">
            {AUTONOMY.map((a) => (
              <label key={a.id} className={cx('flex cursor-pointer items-start gap-2.5 rounded-lg border p-3', autonomy === a.id ? 'border-indigo-500 bg-indigo-50/50 ring-1 ring-indigo-500' : 'border-slate-200 hover:bg-slate-50')}>
                <input type="radio" name={ids.autonomy} className="mt-0.5 size-4 accent-indigo-600" checked={autonomy === a.id} onChange={() => setAutonomy(a.id)} />
                <span>
                  <span className="flex items-center gap-1.5 text-sm font-medium text-slate-800">
                    <a.icon className="size-3.5 text-slate-500" aria-hidden />
                    {t(a.label)}
                  </span>
                  <span className="mt-0.5 block text-xs text-slate-500">{t(a.text)}</span>
                </span>
              </label>
            ))}
          </div>
        </div>

        <div className="space-y-3">
          <div>
            <span className="label">{t('setupAgents.form.tools')}</span>
            <p className="text-xs text-slate-500">{t('setupAgents.form.toolsHelp', { count: effective.length })}</p>
          </div>
          {tools.isLoading ? (
            <Loading />
          ) : tools.error ? (
            <ErrorBanner error={tools.error} />
          ) : (
            <div className="grid gap-3 lg:grid-cols-2">
              <ToolList tools={known} kind="read" value={selected} onChange={setSelected} />
              <ToolList
                tools={known}
                kind="write"
                value={selected}
                onChange={setSelected}
                disabledNote={autonomy === 'read_only' && writeSelected ? t('setupAgents.form.writeToolsIgnored') : undefined}
              />
            </div>
          )}
        </div>

        <Toggle checked={active} onChange={setActive} label={t('common.active')} />
      </form>
    </Modal>
  );
}

export default function Agents() {
  const agents = useAgents();
  const qc = useQueryClient();
  const toast = useToast();
  const confirm = useConfirm();
  const [q, setQ] = useState('');
  const [editing, setEditing] = useState<AgentDef | 'new' | null>(null);

  const toggle = useMutation({
    mutationFn: ({ a, active }: { a: AgentDef; active: boolean }) => api.patch<AgentDef>(`/api/agents/${a.id}`, { active }),
    onMutate: ({ a, active }) => {
      qc.setQueryData<AgentDef[]>(['agents'], (old) => old?.map((x) => (x.id === a.id ? { ...x, active } : x)));
    },
    onSuccess: (_r, { a, active }) => toast.success(active ? t('setupAgents.toasts.activated', { name: a.name }) : t('setupAgents.toasts.deactivated', { name: a.name })),
    onError: (e) => toast.error(errorMessage(e)),
    onSettled: () => qc.invalidateQueries({ queryKey: ['agents'] }),
  });
  const remove = useMutation({
    mutationFn: (a: AgentDef) => api.del(`/api/agents/${a.id}`),
    onSuccess: async (_r, a) => {
      toast.success(t('setupAgents.toasts.deleted', { name: a.name }));
      await qc.invalidateQueries({ queryKey: ['agents'] });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const term = q.trim().toLowerCase();
  const list = (agents.data ?? []).filter((a) => !term || `${a.name} ${a.description}`.toLowerCase().includes(term));

  return (
    <div className="mx-auto max-w-7xl p-6">
      <PageHeader
        title={t('setupAgents.title')}
        subtitle={t('setupAgents.subtitle')}
        actions={
          <>
            <Link to="/setup/runs?tab=agents" className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3.5 text-sm font-medium text-slate-700 shadow-xs hover:bg-slate-50">
              <History className="size-4" aria-hidden /> {t('setupAgents.runHistory')}
            </Link>
            <Button variant="primary" icon={Plus} onClick={() => setEditing('new')}>
              {t('setupAgents.new')}
            </Button>
          </>
        }
      />
      <StatusCard />

      <div className="relative mb-4 w-full max-w-xs">
        <Search className="pointer-events-none absolute top-2.5 left-2.5 size-4 text-slate-400" aria-hidden />
        <input type="search" aria-label={t('setupAgents.list.searchLabel')} placeholder={t('setupAgents.list.searchPlaceholder')} className="input pl-8" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>

      {agents.isLoading ? (
        <Loading />
      ) : agents.error ? (
        <ErrorBanner error={agents.error} />
      ) : list.length === 0 ? (
        <div className="card">
          <EmptyState
            icon={Bot}
            title={term ? t('setupAgents.list.noMatch') : t('setupAgents.list.empty')}
            action={
              term ? undefined : (
                <Button variant="primary" icon={Plus} onClick={() => setEditing('new')}>
                  {t('setupAgents.list.createFirst')}
                </Button>
              )
            }
          >
            {!term && t('setupAgents.list.emptyText')}
          </EmptyState>
        </div>
      ) : (
        <ul className="grid gap-4 @lg:grid-cols-2 @3xl:grid-cols-3">
          {list.map((a) => {
            const au = autonomyOf(a.autonomy);
            return (
              <li key={a.id} aria-label={a.name} className={cx('card flex flex-col p-4', !a.active && 'bg-slate-50/60')}>
                <div className="flex items-start gap-3">
                  <ObjectTile icon={a.icon} color={a.color} size="lg" soft={!a.active} />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <button type="button" className="truncate text-left font-semibold text-slate-900 hover:text-indigo-700" onClick={() => setEditing(a)}>
                        {a.name}
                      </button>
                      {a.builtIn && <Badge color="indigo">{t('setupAgents.list.builtIn')}</Badge>}
                      {!a.active && <Badge color="gray">{t('common.inactive')}</Badge>}
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-1.5">
                      <Badge color={au.color}>
                        <au.icon className="size-3" aria-hidden /> {t(au.label)}
                      </Badge>
                      <span className="text-xs text-slate-500">{t('setupAgents.list.toolCount', { count: a.tools.length })}</span>
                    </div>
                  </div>
                  <InlineToggle checked={a.active} label={t('setupAgents.list.activeLabel', { name: a.name })} disabled={toggle.isPending} onChange={(active) => toggle.mutate({ a, active })} />
                </div>
                <p className="mt-3 line-clamp-3 flex-1 text-sm text-slate-600">{a.description || <span className="text-slate-400">{t('setupAgents.list.noDescription')}</span>}</p>
                <div className="mt-4 flex items-center gap-1 border-t border-slate-100 pt-3">
                  {a.active ? (
                    <Link to={`/agents/${encodeURIComponent(a.id)}`} aria-label={t('setupAgents.list.chatWith', { name: a.name })} className="inline-flex h-7 items-center gap-1.5 rounded-lg px-2.5 text-xs font-medium text-indigo-700 hover:bg-indigo-50">
                      <MessageSquare className="size-3.5" aria-hidden /> {t('setupAgents.list.chat')}
                    </Link>
                  ) : (
                    <span className="px-2.5 text-xs text-slate-400">{t('setupAgents.list.activateToChat')}</span>
                  )}
                  <Link
                    to={`/setup/runs?tab=agents&agentId=${encodeURIComponent(a.id)}`}
                    aria-label={t('setupAgents.list.runHistoryOf', { name: a.name })}
                    title={t('setupAgents.runHistory')}
                    className="ml-auto inline-flex size-8 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 hover:text-slate-900"
                  >
                    <History className="size-4" aria-hidden />
                  </Link>
                  <IconButton icon={Pencil} label={t('setupAgents.edit', { name: a.name })} onClick={() => setEditing(a)} />
                  {!a.builtIn && (
                    <IconButton
                      icon={Trash}
                      label={t('setupAgents.list.delete', { name: a.name })}
                      className="hover:text-rose-600"
                      disabled={remove.isPending}
                      onClick={async () => {
                        const ok = await confirm({
                          title: t('setupAgents.list.deleteTitle', { name: a.name }),
                          message: t('setupAgents.list.deleteMessage'),
                          confirmLabel: t('setupAgents.list.deleteConfirm'),
                          danger: true,
                        });
                        if (ok) remove.mutate(a);
                      }}
                    />
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {editing && <AgentForm key={editing === 'new' ? '__new' : editing.id} agent={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </div>
  );
}
