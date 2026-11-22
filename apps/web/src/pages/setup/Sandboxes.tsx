import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { DeployComponent, DeployComponentStatus, DeployResult, DeploymentRecord, SandboxInfo, SandboxList, SandboxType } from '@titoforce/shared';
import { ArrowLeft, ExternalLink, FlaskConical, GitCompareArrows, MoreHorizontal, Plus, RefreshCw, Rocket, Trash } from 'lucide-react';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router';
import { api, currentOrganization, errorMessage, isNativeApp, organizationHref } from '../../api.ts';
import { useConfirm, useToast } from '../../components/feedback.tsx';
import { Badge, Button, Card, cx, EmptyState, ErrorBanner, FormField, IconButton, Loading, MenuItem, Modal, PageHeader, Popover, Spinner, Toggle } from '../../components/ui.tsx';
import { formatList, type MessageKey, t } from '../../i18n/index.ts';
import { formatDateTime, relativeTime } from '../../lib/format.ts';
import { useAuth } from '../../lib/hooks.ts';
import { usePublicConfig } from '../../lib/session.ts';

const SANDBOX_NAME_RE = /^[a-z0-9](?:[a-z0-9-]{0,18}[a-z0-9])?$/i;
const BUSY = new Set<SandboxInfo['status']>(['provisioning', 'refreshing']);

const STATUS_COLOR: Record<SandboxInfo['status'], string> = { active: 'green', provisioning: 'blue', refreshing: 'blue', suspended: 'gray', failed: 'red' };
const CHANGE_COLOR: Record<DeployComponentStatus, string> = { new: 'green', changed: 'blue', unchanged: 'gray', production_only: 'gray' };
const DEPLOYABLE = new Set<DeployComponentStatus>(['new', 'changed']);

function useSandboxes() {
  return useQuery({
    queryKey: ['sandboxes'],
    queryFn: () => api.get<SandboxList>('/api/sandboxes'),
    // Copying runs in the background: follow it until every sandbox is ready.
    refetchInterval: (q) => (q.state.data?.sandboxes.some((s) => BUSY.has(s.status)) ? 2000 : false),
  });
}

function SandboxStatus({ sandbox }: { sandbox: SandboxInfo }) {
  return (
    <Badge color={STATUS_COLOR[sandbox.status]}>
      {BUSY.has(sandbox.status) && <Spinner className="size-3 text-current" />}
      {t(`setupSandboxes.status.${sandbox.status}`)}
    </Badge>
  );
}

function CreateSandboxModal({ parentSlug, onClose }: { parentSlug: string; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const formId = useId();
  const nameId = useId();
  const [name, setName] = useState('');
  const [type, setType] = useState<SandboxType>('developer');
  const trimmed = name.trim();
  const invalid = !!trimmed && (!SANDBOX_NAME_RE.test(trimmed) || trimmed.includes('--'));
  const create = useMutation({
    mutationFn: () => api.post<SandboxInfo>('/api/sandboxes', { name: trimmed, type }),
    onSuccess: async (sandbox) => {
      toast.success(t('setupSandboxes.create.started', { name: sandbox.name }));
      onClose();
      await qc.invalidateQueries({ queryKey: ['sandboxes'] });
    },
  });
  return (
    <Modal
      open
      onClose={onClose}
      title={t('setupSandboxes.create.title')}
      footer={
        <>
          <Button onClick={onClose}>{t('common.cancel')}</Button>
          <Button variant="primary" type="submit" form={formId} disabled={!trimmed || invalid} loading={create.isPending}>
            {t('setupSandboxes.create.submit')}
          </Button>
        </>
      }
    >
      <form
        id={formId}
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (trimmed && !invalid) create.mutate();
        }}
      >
        <ErrorBanner error={create.error} />
        <FormField
          label={t('setupSandboxes.create.name')}
          required
          htmlFor={nameId}
          error={invalid ? t('setupSandboxes.create.invalidName') : null}
          help={t('setupSandboxes.create.nameHelp', { slug: `${parentSlug}--${trimmed.toLowerCase() || 'dev'}` })}
        >
          <input id={nameId} className="input" value={name} maxLength={20} autoComplete="off" spellCheck={false} placeholder="dev" onChange={(e) => setName(e.target.value)} />
        </FormField>
        <fieldset>
          <legend className="label">{t('setupSandboxes.create.type')}</legend>
          <div className="mt-1 grid gap-2 sm:grid-cols-2">
            {(['developer', 'full'] as const).map((k) => (
              <label key={k} className={cx('flex cursor-pointer gap-2.5 rounded-lg border p-3', type === k ? 'border-indigo-300 bg-indigo-50/60' : 'border-slate-200 hover:bg-slate-50')}>
                <input type="radio" name="sandbox-type" className="mt-0.5" checked={type === k} onChange={() => setType(k)} />
                <span>
                  <span className="block text-sm font-medium text-slate-900">{t(`setupSandboxes.types.${k}.label`)}</span>
                  <span className="mt-0.5 block text-xs text-slate-500">{t(`setupSandboxes.types.${k}.help`)}</span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>
      </form>
    </Modal>
  );
}

function SandboxRow({ sandbox, baseDomain }: { sandbox: SandboxInfo; baseDomain: string | null }) {
  const qc = useQueryClient();
  const toast = useToast();
  const confirm = useConfirm();
  const busy = BUSY.has(sandbox.status);
  const ready = sandbox.status === 'active';
  const refresh = useMutation({
    mutationFn: () => api.post<SandboxInfo>(`/api/sandboxes/${sandbox.id}/refresh`),
    onSuccess: () => toast.success(t('setupSandboxes.refresh.started', { name: sandbox.name })),
    onError: (err) => toast.error(errorMessage(err)),
    onSettled: () => qc.invalidateQueries({ queryKey: ['sandboxes'] }),
  });
  const remove = useMutation({
    mutationFn: () => api.del(`/api/sandboxes/${sandbox.id}`),
    onSuccess: () => toast.success(t('setupSandboxes.delete.done', { name: sandbox.name })),
    onError: (err) => toast.error(errorMessage(err)),
    onSettled: () => qc.invalidateQueries({ queryKey: ['sandboxes'] }),
  });
  const copiedAt = sandbox.refreshedAt ?? sandbox.createdAt;

  return (
    <tr className="hover:bg-slate-50/70">
      <td className="px-4 py-3">
        <div className="flex items-center gap-2.5">
          <span className="inline-flex size-8 shrink-0 items-center justify-center rounded-lg bg-amber-100 text-amber-700">
            <FlaskConical className="size-4" aria-hidden />
          </span>
          <div className="min-w-0">
            <p className="font-medium text-slate-900">{sandbox.name}</p>
            <p className="truncate font-mono text-xs text-slate-500">{sandbox.slug}</p>
          </div>
        </div>
      </td>
      <td className="px-4 py-3 text-slate-600">{t(`setupSandboxes.types.${sandbox.sandboxType ?? 'developer'}.label`)}</td>
      <td className="px-4 py-3">
        <SandboxStatus sandbox={sandbox} />
        {sandbox.status === 'failed' && sandbox.error && <p className="mt-1 max-w-xs text-xs text-rose-600">{sandbox.error}</p>}
      </td>
      <td className="px-4 py-3 text-slate-600">{sandbox.createdByName ?? '—'}</td>
      <td className="px-4 py-3 whitespace-nowrap text-slate-500" title={formatDateTime(copiedAt)}>
        {relativeTime(copiedAt)}
      </td>
      <td className="px-4 py-3">
        <div className="flex items-center justify-end gap-1.5">
          {ready ? (
            <a
              href={organizationHref(sandbox.slug, baseDomain)}
              target={isNativeApp() ? undefined : '_blank'}
              rel="noopener"
              className="inline-flex h-7 items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-2.5 text-xs font-medium text-slate-700 shadow-xs hover:bg-slate-50"
            >
              <ExternalLink className="size-3.5" aria-hidden />
              {t('setupSandboxes.actions.open')}
            </a>
          ) : (
            <Button size="sm" icon={ExternalLink} disabled>
              {t('setupSandboxes.actions.open')}
            </Button>
          )}
          {ready ? (
            <Link
              to={`/setup/sandboxes/${sandbox.id}`}
              className="inline-flex h-7 items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-2.5 text-xs font-medium text-slate-700 shadow-xs hover:bg-slate-50"
            >
              <GitCompareArrows className="size-3.5" aria-hidden />
              {t('setupSandboxes.actions.deploy')}
            </Link>
          ) : (
            <Button size="sm" icon={GitCompareArrows} disabled>
              {t('setupSandboxes.actions.deploy')}
            </Button>
          )}
          <Popover
            align="right"
            className="w-44"
            trigger={({ toggle, open }) => (
              <IconButton icon={MoreHorizontal} label={t('setupSandboxes.actions.more', { name: sandbox.name })} aria-expanded={open} disabled={refresh.isPending || remove.isPending} onClick={toggle} />
            )}
          >
            {(close) => (
              <div className="py-1">
                {!busy && (
                  <MenuItem
                    icon={RefreshCw}
                    onClick={() => {
                      close();
                      void confirm({
                        title: t('setupSandboxes.refresh.title', { name: sandbox.name }),
                        message: t('setupSandboxes.refresh.message'),
                        confirmLabel: t('setupSandboxes.refresh.confirm'),
                        danger: true,
                      }).then((ok) => ok && refresh.mutate());
                    }}
                  >
                    {t('setupSandboxes.actions.refresh')}
                  </MenuItem>
                )}
                <MenuItem
                  icon={Trash}
                  danger
                  onClick={() => {
                    close();
                    void confirm({
                      title: t('setupSandboxes.delete.title', { name: sandbox.name }),
                      message: t('setupSandboxes.delete.message'),
                      confirmLabel: t('setupSandboxes.delete.confirm'),
                      danger: true,
                    }).then((ok) => ok && remove.mutate());
                  }}
                >
                  {t('setupSandboxes.actions.delete')}
                </MenuItem>
              </div>
            )}
          </Popover>
        </div>
      </td>
    </tr>
  );
}

function DeploymentHistory() {
  const deployments = useQuery({ queryKey: ['deployments'], queryFn: () => api.get<DeploymentRecord[]>('/api/deployments') });
  return (
    <Card title={t('setupSandboxes.history.title')} bodyClassName="">
      {deployments.isLoading ? (
        <Loading />
      ) : deployments.error ? (
        <div className="p-4">
          <ErrorBanner error={deployments.error} />
        </div>
      ) : !deployments.data?.length ? (
        <p className="px-4 py-6 text-center text-sm text-slate-500">{t('setupSandboxes.history.empty')}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50/70 text-left text-xs font-semibold text-slate-500 uppercase">
              <tr>
                <th className="px-4 py-2.5">{t('setupSandboxes.history.columns.date')}</th>
                <th className="px-4 py-2.5">{t('setupSandboxes.history.columns.from')}</th>
                <th className="px-4 py-2.5">{t('setupSandboxes.history.columns.by')}</th>
                <th className="px-4 py-2.5">{t('setupSandboxes.history.columns.components')}</th>
                <th className="px-4 py-2.5">{t('setupSandboxes.history.columns.status')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {deployments.data.map((d) => (
                <tr key={d.id} className="align-top">
                  <td className="px-4 py-2.5 whitespace-nowrap text-slate-600" title={formatDateTime(d.createdAt)}>
                    {relativeTime(d.createdAt)}
                  </td>
                  <td className="px-4 py-2.5 text-slate-700">{d.sourceName}</td>
                  <td className="px-4 py-2.5 text-slate-600">{d.deployedBy}</td>
                  <td className="px-4 py-2.5 text-slate-600">
                    <details>
                      <summary className="cursor-pointer text-slate-700">{t('setupSandboxes.history.componentCount', { count: d.components.length })}</summary>
                      <ul className="mt-1.5 space-y-0.5 text-xs">
                        {d.components.map((c) => (
                          <li key={`${c.type}:${c.id}`}>
                            <span className="text-slate-400">{t(`setupSandboxes.deploy.types.${c.type}`)}:</span> {c.label}
                          </li>
                        ))}
                      </ul>
                    </details>
                  </td>
                  <td className="px-4 py-2.5">
                    {d.status === 'succeeded' ? <Badge color="green">{t('setupSandboxes.history.succeeded')}</Badge> : <Badge color="red">{t('setupSandboxes.history.failed')}</Badge>}
                    {d.error && <p className="mt-1 max-w-sm text-xs text-rose-600">{d.error}</p>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

/** Setup → Sandboxes. */
export default function Sandboxes() {
  const { organization } = useAuth();
  const list = useSandboxes();
  const config = usePublicConfig(currentOrganization());
  const toast = useToast();
  const toastRef = useRef(toast);
  toastRef.current = toast;
  const [creating, setCreating] = useState(false);
  const sandboxes = list.data?.sandboxes;
  const atLimit = !!list.data && list.data.sandboxes.length >= list.data.max;

  // Tell the admin when a copy started earlier finishes.
  const previous = useRef(new Map<string, SandboxInfo['status']>());
  useEffect(() => {
    if (!sandboxes) return;
    for (const s of sandboxes) {
      const before = previous.current.get(s.id);
      if (before && BUSY.has(before) && s.status === 'active') toastRef.current.success(t('setupSandboxes.ready', { name: s.name }));
      if (before && BUSY.has(before) && s.status === 'failed') toastRef.current.error(t('setupSandboxes.failed', { name: s.name }));
    }
    previous.current = new Map(sandboxes.map((s) => [s.id, s.status]));
  }, [sandboxes]);

  return (
    <div className="mx-auto max-w-6xl space-y-5 p-6">
      <PageHeader
        title={t('setupSandboxes.title')}
        subtitle={t('setupSandboxes.subtitle')}
        actions={
          list.data?.enabled && (
            <Button variant="primary" icon={Plus} disabled={atLimit} onClick={() => setCreating(true)}>
              {t('setupSandboxes.newSandbox')}
            </Button>
          )
        }
      />
      {list.isLoading ? (
        <Loading />
      ) : list.error ? (
        <ErrorBanner error={list.error} />
      ) : !list.data?.enabled ? (
        <div className="card">
          <EmptyState icon={FlaskConical} title={t('setupSandboxes.unavailable')} />
        </div>
      ) : (
        <>
          <div className="card overflow-hidden">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-4 py-2.5 text-xs text-slate-500">
              <span>{t('setupSandboxes.signInHint')}</span>
              <span className="font-medium">{t('setupSandboxes.usage', { count: list.data.sandboxes.length, max: list.data.max })}</span>
            </div>
            {atLimit && <p className="border-b border-amber-100 bg-amber-50 px-4 py-2 text-xs text-amber-800">{t('setupSandboxes.limitReached')}</p>}
            {list.data.sandboxes.length === 0 ? (
              <EmptyState
                icon={FlaskConical}
                title={t('setupSandboxes.empty.title')}
                action={
                  <Button variant="primary" icon={Plus} onClick={() => setCreating(true)}>
                    {t('setupSandboxes.newSandbox')}
                  </Button>
                }
              >
                {t('setupSandboxes.empty.message')}
              </EmptyState>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50/70 text-left text-xs font-semibold text-slate-500 uppercase">
                    <tr>
                      <th className="px-4 py-2.5">{t('setupSandboxes.columns.sandbox')}</th>
                      <th className="px-4 py-2.5">{t('setupSandboxes.columns.type')}</th>
                      <th className="px-4 py-2.5">{t('setupSandboxes.columns.status')}</th>
                      <th className="px-4 py-2.5">{t('setupSandboxes.columns.createdBy')}</th>
                      <th className="px-4 py-2.5">{t('setupSandboxes.columns.copied')}</th>
                      <th className="px-4 py-2.5">
                        <span className="sr-only">{t('common.actions')}</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {list.data.sandboxes.map((s) => (
                      <SandboxRow key={s.id} sandbox={s} baseDomain={config.data?.baseDomain ?? null} />
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
          <DeploymentHistory />
        </>
      )}
      {creating && <CreateSandboxModal parentSlug={organization.slug} onClose={() => setCreating(false)} />}
    </div>
  );
}

function changeSummary(c: DeployComponent): string | null {
  if (!c.items || c.status === 'unchanged') return null;
  const kind = c.type === 'translation' ? 'labels' : 'fields';
  const parts = (['added', 'changed', 'productionOnly'] as const)
    .filter((k) => c.items![k] > 0)
    .map((k) => t(`setupSandboxes.deploy.${kind}.${k}` as MessageKey, { count: c.items![k] }));
  return parts.length ? formatList(parts) : null;
}

const keyOf = (c: Pick<DeployComponent, 'type' | 'id'>) => `${c.type}:${c.id}`;

/** Setup → Sandboxes → Compare and deploy. */
export function SandboxDeploy() {
  const { id } = useParams();
  const qc = useQueryClient();
  const toast = useToast();
  const confirm = useConfirm();
  const sandbox = useQuery({ queryKey: ['sandboxes', id], queryFn: () => api.get<SandboxInfo>(`/api/sandboxes/${id}`) });
  const ready = sandbox.data?.status === 'active';
  const compare = useQuery({
    queryKey: ['sandboxes', id, 'compare'],
    queryFn: () => api.get<DeployComponent[]>(`/api/sandboxes/${id}/compare`),
    enabled: ready,
    staleTime: 0,
  });
  const [showUnchanged, setShowUnchanged] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const components = compare.data ?? [];
  const deployable = useMemo(() => components.filter((c) => DEPLOYABLE.has(c.status)), [components]);
  const visible = showUnchanged ? components : deployable;
  const chosen = deployable.filter((c) => selected.has(keyOf(c)));
  const allChosen = deployable.length > 0 && chosen.length === deployable.length;

  const deploy = useMutation({
    mutationFn: () => api.post<DeployResult>(`/api/sandboxes/${id}/deploy`, { components: chosen.map((c) => ({ type: c.type, id: c.id })) }),
    onSuccess: async (result) => {
      toast.success(t('setupSandboxes.deploy.done', { count: result.deployment.components.length }));
      qc.setQueryData(['sandboxes', id, 'compare'], result.components);
      setSelected(new Set());
      // Deployed configuration is now live in this organization.
      await qc.invalidateQueries({ predicate: (q) => q.queryKey[0] !== 'session' && q.queryKey[0] !== 'sandboxes' });
    },
    onError: () => void qc.invalidateQueries({ queryKey: ['deployments'] }),
  });

  const toggle = (c: DeployComponent) =>
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(keyOf(c))) next.delete(keyOf(c));
      else next.add(keyOf(c));
      return next;
    });

  const submit = async () => {
    const ok = await confirm({
      title: t('setupSandboxes.deploy.confirm.title'),
      message: t('setupSandboxes.deploy.confirm.message', { count: chosen.length }),
      confirmLabel: t('setupSandboxes.deploy.confirm.confirm'),
    });
    if (ok) deploy.mutate();
  };

  return (
    <div className="mx-auto max-w-6xl p-6">
      <Link to="/setup/sandboxes" className="mb-3 inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-800">
        <ArrowLeft className="size-4" aria-hidden />
        {t('setupSandboxes.deploy.back')}
      </Link>
      <PageHeader
        title={t('setupSandboxes.deploy.title', { name: sandbox.data?.name ?? '…' })}
        subtitle={t('setupSandboxes.deploy.subtitle')}
        actions={sandbox.data && <SandboxStatus sandbox={sandbox.data} />}
      />
      {sandbox.isLoading ? (
        <Loading />
      ) : sandbox.error ? (
        <ErrorBanner error={sandbox.error} />
      ) : !ready ? (
        <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">{t('setupSandboxes.deploy.notReady')}</p>
      ) : compare.isLoading ? (
        <Loading />
      ) : compare.error ? (
        <ErrorBanner error={compare.error} />
      ) : (
        <>
          <ErrorBanner error={deploy.error} className="mb-4" />
          <div className="card overflow-hidden">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-4 py-2.5">
              <label className={cx('inline-flex items-center gap-2 text-sm text-slate-700', !deployable.length && 'opacity-50')}>
                <input
                  type="checkbox"
                  className="size-4 rounded border-slate-300 text-indigo-600"
                  checked={allChosen}
                  disabled={!deployable.length}
                  ref={(el) => {
                    if (el) el.indeterminate = chosen.length > 0 && !allChosen;
                  }}
                  onChange={() => setSelected(allChosen ? new Set() : new Set(deployable.map(keyOf)))}
                />
                {t('setupSandboxes.deploy.selectAll')}
              </label>
              <Toggle checked={showUnchanged} onChange={setShowUnchanged} label={t('setupSandboxes.deploy.showUnchanged')} />
            </div>
            {visible.length === 0 ? (
              <EmptyState icon={GitCompareArrows} title={t('setupSandboxes.deploy.noChanges.title')}>
                {t('setupSandboxes.deploy.noChanges.message')}
              </EmptyState>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50/70 text-left text-xs font-semibold text-slate-500 uppercase">
                    <tr>
                      <th className="w-10 px-4 py-2.5">
                        <span className="sr-only">{t('setupSandboxes.deploy.selectAll')}</span>
                      </th>
                      <th className="px-4 py-2.5">{t('setupSandboxes.deploy.columns.component')}</th>
                      <th className="px-4 py-2.5">{t('setupSandboxes.deploy.columns.type')}</th>
                      <th className="px-4 py-2.5">{t('setupSandboxes.deploy.columns.object')}</th>
                      <th className="px-4 py-2.5">{t('setupSandboxes.deploy.columns.change')}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {visible.map((c) => {
                      const canDeploy = DEPLOYABLE.has(c.status);
                      const summary = changeSummary(c);
                      return (
                        <tr key={keyOf(c)} className={cx(canDeploy ? 'hover:bg-slate-50/70' : 'text-slate-400')}>
                          <td className="px-4 py-2.5">
                            <input
                              type="checkbox"
                              className="size-4 rounded border-slate-300 text-indigo-600"
                              aria-label={t('setupSandboxes.deploy.select', { name: c.label })}
                              disabled={!canDeploy}
                              checked={selected.has(keyOf(c))}
                              onChange={() => toggle(c)}
                            />
                          </td>
                          <td className={cx('px-4 py-2.5 font-medium', canDeploy ? 'text-slate-900' : 'text-slate-500')}>{c.label}</td>
                          <td className="px-4 py-2.5">{t(`setupSandboxes.deploy.types.${c.type}`)}</td>
                          <td className="px-4 py-2.5">{c.objectLabel ?? ''}</td>
                          <td className="px-4 py-2.5">
                            <Badge color={CHANGE_COLOR[c.status]}>{t(`setupSandboxes.deploy.statuses.${c.status}`)}</Badge>
                            {summary && <span className="ml-2 text-xs text-slate-500">{summary}</span>}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
          <div className="sticky bottom-0 z-20 -mx-6 mt-4 -mb-6 border-t border-slate-200 bg-white/95 px-6 py-3 backdrop-blur">
            <div className="flex items-center justify-end gap-3">
              <span className="text-sm text-slate-600">{t('setupSandboxes.deploy.selected', { count: chosen.length })}</span>
              <Button variant="primary" icon={Rocket} disabled={!chosen.length} loading={deploy.isPending} onClick={() => void submit()}>
                {t('setupSandboxes.deploy.submit')}
              </Button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
