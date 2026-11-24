import type { AgentAction, ApprovalRequest, AppDef, NotificationDTO, ObjectDef, SearchResultGroup } from '@titoforce/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bell, Bot, Building2, ChartColumn, ChevronDown, FlaskConical, Inbox, KeyRound, LayoutDashboard, LogOut, Menu, Search, Settings, Sparkles, Wrench, X } from 'lucide-react';
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, NavLink, Outlet, useLocation, useMatch, useNavigate } from 'react-router';
import { api, ApiError, currentOrganization, errorMessage, openOrganization, qs, recentOrganizations, signOut } from '../api.ts';
import { t, tx } from '../i18n/index.ts';
import { AiPanelContext, useAgents, useAiStatus, useApps, useAuth, useCurrentApp, useDebounced, useObjects, usePermissions } from '../lib/hooks.ts';
import { relativeTime } from '../lib/format.ts';
import { usePublicConfig } from '../lib/session.ts';
import { Icon } from '../lib/icons.tsx';
import { AgentChat } from './AgentChat.tsx';
import { useToast } from './feedback.tsx';
import { Avatar, Badge, Button, cx, FormField, IconButton, Modal, ObjectTile, Popover, ErrorBanner } from './ui.tsx';

// ---------- global search ----------

function GlobalSearch() {
  const navigate = useNavigate();
  const { data: objects } = useObjects();
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const term = useDebounced(q.trim(), 200);
  const results = useQuery({
    queryKey: ['search', term],
    queryFn: () => api.get<SearchResultGroup[]>(`/api/search${qs({ q: term, limit: 5 })}`),
    enabled: term.length >= 2,
    staleTime: 10_000,
  });
  const flat = useMemo(() => (results.data ?? []).flatMap((g) => g.records.map((r) => ({ ...r, object: g.object, group: g.label }))), [results.data]);
  useEffect(() => setActive(0), [term]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = e.target instanceof HTMLElement && (e.target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName));
      if ((e.key === 'k' && (e.metaKey || e.ctrlKey)) || (e.key === '/' && !typing)) {
        e.preventDefault();
        input.current?.focus();
        setOpen(true);
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  const go = (id: string) => {
    setOpen(false);
    setQ('');
    input.current?.blur();
    navigate(`/r/${id}`);
  };
  const iconOf = (object: string) => objects?.find((o) => o.apiName === object);
  const show = open && term.length >= 2;

  return (
    <div className="relative w-full max-w-xl">
      <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-slate-400" aria-hidden />
      <input
        ref={input}
        type="search"
        role="combobox"
        aria-expanded={show}
        aria-controls="global-search-results"
        aria-label={t('shell.search.label')}
        placeholder={t('shell.search.placeholder')}
        className="h-9 w-full rounded-lg border border-slate-200 bg-slate-50 pr-14 pl-9 text-sm outline-none placeholder:text-slate-400 focus:border-indigo-400 focus:bg-white focus:ring-2 focus:ring-indigo-500/20"
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            setActive((a) => Math.min(a + 1, flat.length - 1));
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setActive((a) => Math.max(a - 1, 0));
          } else if (e.key === 'Enter' && flat[active]) {
            e.preventDefault();
            go(flat[active].id);
          } else if (e.key === 'Escape') {
            setOpen(false);
            input.current?.blur();
          }
        }}
      />
      <kbd className="pointer-events-none absolute top-1/2 right-2.5 hidden -translate-y-1/2 rounded border border-slate-200 bg-white px-1.5 text-[10px] text-slate-400 sm:block">{t('shell.search.shortcut')}</kbd>
      {show && (
        <div id="global-search-results" role="listbox" className="absolute top-11 right-0 left-0 z-40 max-h-[70vh] overflow-y-auto rounded-xl border border-slate-200 bg-white py-1 shadow-xl">
          {results.isLoading && <p className="px-3 py-2 text-sm text-slate-500">{t('shell.search.searching')}</p>}
          {results.error && <p className="px-3 py-2 text-sm text-rose-600">{t('shell.search.failed')}</p>}
          {results.data && !flat.length && <p className="px-3 py-2 text-sm text-slate-500">{t('shell.search.noMatches', { term })}</p>}
          {(results.data ?? []).map((g) => (
            <div key={g.object} className="py-1">
              <p className="px-3 pt-1 pb-0.5 text-[11px] font-semibold tracking-wide text-slate-400 uppercase">{g.label}</p>
              {g.records.map((r) => {
                const idx = flat.findIndex((f) => f.id === r.id);
                const def = iconOf(g.object);
                return (
                  <button
                    key={r.id}
                    type="button"
                    role="option"
                    aria-selected={idx === active}
                    onMouseDown={(e) => e.preventDefault()}
                    onMouseEnter={() => setActive(idx)}
                    onClick={() => go(r.id)}
                    className={cx('flex w-full items-center gap-2.5 px-3 py-1.5 text-left', idx === active && 'bg-indigo-50')}
                  >
                    {def && <ObjectTile icon={def.icon} color={def.color} size="sm" />}
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm text-slate-800">{r.name}</span>
                      {r.subtitle && <span className="block truncate text-xs text-slate-500">{r.subtitle}</span>}
                    </span>
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------- notifications & inbox ----------

function Notifications() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const notes = useQuery({
    queryKey: ['notifications'],
    queryFn: () => api.get<{ items: NotificationDTO[]; unread: number }>('/api/notifications?limit=30'),
    refetchInterval: 30_000,
  });
  const markRead = useMutation({
    mutationFn: (ids?: string[]) => api.post('/api/notifications/read', ids ? { ids } : {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['notifications'] }),
  });
  const unread = notes.data?.unread ?? 0;
  return (
    <Popover
      align="right"
      className="w-96"
      trigger={({ toggle, open }) => (
        <button type="button" onClick={toggle} aria-expanded={open} aria-label={unread ? t('shell.notifications.labelUnread', { count: unread }) : t('shell.notifications.title')} className="relative inline-flex size-9 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 hover:text-slate-900">
          <Bell className="size-5" aria-hidden />
          {unread > 0 && <span className="absolute top-1 right-1 min-w-4 rounded-full bg-rose-500 px-1 text-[10px] leading-4 font-semibold text-white">{unread > 99 ? '99+' : unread}</span>}
        </button>
      )}
    >
      {(close) => (
        <div>
          <div className="flex items-center justify-between border-b border-slate-100 px-3 py-2">
            <p className="text-sm font-semibold text-slate-900">{t('shell.notifications.title')}</p>
            {unread > 0 && (
              <button type="button" className="text-xs font-medium text-indigo-600 hover:underline" onClick={() => markRead.mutate(undefined)}>
                {t('shell.notifications.markAllRead')}
              </button>
            )}
          </div>
          <ul className="max-h-[60vh] divide-y divide-slate-100 overflow-y-auto">
            {notes.data?.items.length === 0 && <li className="px-3 py-6 text-center text-sm text-slate-500">{t('shell.notifications.empty')}</li>}
            {notes.data?.items.map((n) => (
              <li key={n.id}>
                <button
                  type="button"
                  className={cx('flex w-full gap-2.5 px-3 py-2.5 text-left hover:bg-slate-50', !n.read && 'bg-indigo-50/40')}
                  onClick={() => {
                    if (!n.read) markRead.mutate([n.id]);
                    close();
                    if (n.link?.startsWith('/')) navigate(n.link);
                  }}
                >
                  <span className={cx('mt-1.5 size-2 shrink-0 rounded-full', n.read ? 'bg-transparent' : 'bg-indigo-500')} aria-hidden />
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm text-slate-800">{n.title}</span>
                    {n.body && <span className="mt-0.5 line-clamp-2 block text-xs text-slate-500">{n.body}</span>}
                    <span className="mt-0.5 block text-[11px] text-slate-400">{relativeTime(n.createdAt)}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Popover>
  );
}

/** Count of approval requests and agent actions waiting for the current user. */
export function useInboxCount() {
  const { user } = useAuth();
  const { canManageAgents } = usePermissions();
  const approvals = useQuery({ queryKey: ['approvals', 'to_me', 'pending'], queryFn: () => api.get<ApprovalRequest[]>('/api/approvals?scope=to_me&status=pending'), refetchInterval: 30_000 });
  const actions = useQuery({ queryKey: ['agent-actions', 'pending'], queryFn: () => api.get<AgentAction[]>('/api/agent-actions?status=pending'), refetchInterval: 30_000 });
  const mine = (actions.data ?? []).filter((a) => a.approverId === user.id || (a.approverId === null && canManageAgents));
  return (approvals.data?.length ?? 0) + mine.length;
}

function InboxButton() {
  const count = useInboxCount();
  return (
    <Link to="/approvals" aria-label={count ? t('shell.inbox.labelPending', { count }) : t('shell.inbox.label')} title={t('shell.nav.approvals')} className="relative inline-flex size-9 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 hover:text-slate-900">
      <Inbox className="size-5" aria-hidden />
      {count > 0 && <span className="absolute top-1 right-1 min-w-4 rounded-full bg-amber-500 px-1 text-[10px] leading-4 font-semibold text-white">{count}</span>}
    </Link>
  );
}

// ---------- user menu ----------

function ChangePasswordModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const toast = useToast();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const change = useMutation({
    mutationFn: () => api.post('/api/auth/password', { current, next }),
    onSuccess: () => {
      toast.success(t('shell.changePassword.success'));
      setCurrent('');
      setNext('');
      onClose();
    },
  });
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t('shell.changePassword.title')}
      size="sm"
      footer={
        <>
          <Button onClick={onClose}>{t('common.cancel')}</Button>
          <Button variant="primary" type="submit" form="change-password" loading={change.isPending} disabled={!current || next.length < 8}>
            {t('shell.changePassword.submit')}
          </Button>
        </>
      }
    >
      <form
        id="change-password"
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          change.mutate();
        }}
      >
        <ErrorBanner error={change.error} />
        <FormField label={t('shell.changePassword.current')} htmlFor="pw-current">
          <input id="pw-current" type="password" autoComplete="current-password" className="input" value={current} onChange={(e) => setCurrent(e.target.value)} />
        </FormField>
        <FormField label={t('shell.changePassword.new')} htmlFor="pw-next" help={t('shell.changePassword.help')}>
          <input id="pw-next" type="password" autoComplete="new-password" className="input" value={next} onChange={(e) => setNext(e.target.value)} />
        </FormField>
      </form>
    </Modal>
  );
}

/** Opens another organization (each has its own users, so its sign-in page shows unless already signed in there). */
function SwitchOrganizationModal({ open, onClose, baseDomain }: { open: boolean; onClose: () => void; baseDomain: string | null }) {
  const { organization } = useAuth();
  const [slug, setSlug] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const recent = useMemo(() => (open ? recentOrganizations() : []), [open]);

  const go = async (target: string) => {
    const org = target.trim().toLowerCase();
    if (!org) return;
    if (org === organization.slug) return onClose();
    setError(null);
    // With subdomain routing the other organization's address is checked by its own server name instead.
    if (!baseDomain) {
      setBusy(true);
      try {
        await api.get('/api/config', { org });
      } catch (err) {
        setBusy(false);
        setError(err instanceof ApiError && err.code === 'organization_not_found' ? t('orgs.signIn.notFound', { slug: org }) : errorMessage(err));
        return;
      }
    }
    openOrganization(org, baseDomain);
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="sm"
      title={t('orgs.switcher.title')}
      footer={
        <>
          <Button onClick={onClose}>{t('common.cancel')}</Button>
          <Button variant="primary" type="submit" form="switch-org" loading={busy} disabled={!slug.trim()}>
            {t('orgs.switcher.open')}
          </Button>
        </>
      }
    >
      <form
        id="switch-org"
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          void go(slug);
        }}
      >
        <p className="text-sm text-slate-600">{t('orgs.switcher.help')}</p>
        <FormField label={t('orgs.switcher.organizationId')} htmlFor="switch-org-id" error={error}>
          <input
            id="switch-org-id"
            className="input"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            value={slug}
            onChange={(e) => {
              setSlug(e.target.value);
              setError(null);
            }}
          />
        </FormField>
        {recent.length > 0 && (
          <div>
            <p className="text-xs font-medium tracking-wide text-slate-500 uppercase">{t('orgs.switcher.recent')}</p>
            <ul className="mt-1.5 divide-y divide-slate-100 rounded-lg border border-slate-200">
              {recent.map((o) => (
                <li key={o.slug}>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void go(o.slug)}
                    className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-slate-50 disabled:opacity-60"
                  >
                    <Building2 className="size-4 shrink-0 text-slate-400" aria-hidden />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium text-slate-800">{o.name}</span>
                      <span className="block truncate font-mono text-xs text-slate-500">{o.slug}</span>
                    </span>
                    {o.kind === 'sandbox' && <Badge color="yellow">{t('orgs.sandbox.badge')}</Badge>}
                    {o.slug === organization.slug && <Badge>{t('orgs.switcher.current')}</Badge>}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </form>
    </Modal>
  );
}

function UserMenu() {
  const { user, organization } = useAuth();
  const perms = usePermissions();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const config = usePublicConfig(currentOrganization());
  const [pwOpen, setPwOpen] = useState(false);
  const [switchOpen, setSwitchOpen] = useState(false);
  const multiOrg = !!config.data?.multiOrg;
  const logout = async () => {
    try {
      await signOut();
    } finally {
      qc.clear();
      qc.setQueryData(['session'], null);
      navigate('/login', { replace: true });
    }
  };
  const canSetup = perms.isAdmin || perms.canManageAutomations || perms.canManageAgents;
  return (
    <>
      <Popover
        align="right"
        className="w-64"
        trigger={({ toggle, open }) => (
          <button type="button" onClick={toggle} aria-expanded={open} aria-label={t('shell.userMenu.label')} className="rounded-full ring-offset-2 hover:ring-2 hover:ring-indigo-200">
            <Avatar name={user.name} color={user.avatarColor} size="sm" />
          </button>
        )}
      >
        {(close) => (
          <div className="py-1">
            <div className="border-b border-slate-100 px-3 pt-1.5 pb-2.5">
              <p className="truncate text-sm font-semibold text-slate-900">{user.name}</p>
              <p className="truncate text-xs text-slate-500">{user.email}</p>
              <p className="mt-0.5 text-xs text-slate-500">{user.roleName}</p>
              {(multiOrg || organization.kind === 'sandbox') && (
                <p className="mt-1.5 flex items-center gap-1.5 text-xs text-slate-600">
                  <Building2 className="size-3.5 shrink-0 text-slate-400" aria-hidden />
                  <span className="truncate">{organization.name}</span>
                  {organization.kind === 'sandbox' && <Badge color="yellow">{t('orgs.sandbox.badge')}</Badge>}
                </p>
              )}
            </div>
            <div className="py-1">
              <MenuLink
                icon={<Settings className="size-4" />}
                onClick={() => {
                  close();
                  navigate('/settings');
                }}
              >
                {t('shell.userMenu.settings')}
              </MenuLink>
              <MenuLink
                icon={<KeyRound className="size-4" />}
                onClick={() => {
                  close();
                  setPwOpen(true);
                }}
              >
                {t('shell.userMenu.changePassword')}
              </MenuLink>
              {multiOrg && (
                <MenuLink
                  icon={<Building2 className="size-4" />}
                  onClick={() => {
                    close();
                    setSwitchOpen(true);
                  }}
                >
                  {t('orgs.switcher.title')}
                </MenuLink>
              )}
              {canSetup && (
                <MenuLink
                  icon={<Wrench className="size-4" />}
                  onClick={() => {
                    close();
                    navigate('/setup');
                  }}
                >
                  {t('shell.nav.setup')}
                </MenuLink>
              )}
            </div>
            <div className="border-t border-slate-100 pt-1">
              <MenuLink icon={<LogOut className="size-4" />} onClick={() => void logout()}>
                {t('shell.userMenu.signOut')}
              </MenuLink>
            </div>
          </div>
        )}
      </Popover>
      <ChangePasswordModal open={pwOpen} onClose={() => setPwOpen(false)} />
      {switchOpen && <SwitchOrganizationModal open onClose={() => setSwitchOpen(false)} baseDomain={config.data?.baseDomain ?? null} />}
    </>
  );
}

function MenuLink({ icon, children, onClick }: { icon: ReactNode; children: ReactNode; onClick: () => void }) {
  return (
    <button type="button" role="menuitem" onClick={onClick} className="flex w-full items-center gap-2.5 px-3 py-1.5 text-left text-sm text-slate-700 hover:bg-slate-50">
      <span className="text-slate-400">{icon}</span>
      {children}
    </button>
  );
}

// ---------- sidebar ----------

const PAGE_PATH: Record<string, (app: AppDef) => string> = {
  home: (app) => `/app/${app.id}`,
  forecast: () => '/forecast',
  'org-chart': () => '/org-chart',
  reports: () => '/reports',
};

function SideLink({ to, icon, children, active, onNavigate }: { to: string; icon: ReactNode; children: ReactNode; active?: boolean; onNavigate?: () => void }) {
  return (
    <NavLink
      to={to}
      onClick={onNavigate}
      className={({ isActive }) =>
        cx(
          'flex items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-sm transition-colors',
          (active ?? isActive) ? 'bg-indigo-50 font-medium text-indigo-700' : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900',
        )
      }
    >
      {icon}
      <span className="truncate">{children}</span>
    </NavLink>
  );
}

function AppSwitcher({ apps, current, onPick }: { apps: AppDef[]; current: AppDef | undefined; onPick: (a: AppDef) => void }) {
  return (
    <Popover
      className="w-72"
      trigger={({ toggle, open }) => (
        <button type="button" onClick={toggle} aria-expanded={open} aria-label={t('shell.apps.switch')} className="flex w-full items-center gap-2.5 rounded-xl border border-slate-200 bg-white px-2.5 py-2 text-left shadow-xs hover:border-slate-300">
          {current ? <ObjectTile icon={current.icon} color={current.color} size="sm" /> : null}
          <span className="min-w-0 flex-1">
            <span className="block text-[10px] font-semibold tracking-wide text-slate-400 uppercase">{t('shell.apps.caption')}</span>
            <span className="block truncate text-sm font-semibold text-slate-900">{current?.name ?? t('shell.apps.choose')}</span>
          </span>
          <ChevronDown className="size-4 text-slate-400" aria-hidden />
        </button>
      )}
    >
      {(close) => (
        <ul className="max-h-[70vh] overflow-y-auto py-1" aria-label={t('shell.apps.list')}>
          {apps.map((a) => (
            <li key={a.id}>
              <button
                type="button"
                onClick={() => {
                  close();
                  onPick(a);
                }}
                className={cx('flex w-full items-start gap-2.5 px-3 py-2 text-left hover:bg-slate-50', a.id === current?.id && 'bg-indigo-50/60')}
              >
                <ObjectTile icon={a.icon} color={a.color} size="sm" />
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium text-slate-900">{a.name}</span>
                  <span className="line-clamp-2 block text-xs text-slate-500">{a.description}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </Popover>
  );
}

function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const apps = useApps();
  const { data: objects } = useObjects();
  const { appId, setAppId } = useCurrentApp();
  const perms = usePermissions();
  const ai = useAiStatus();
  const navigate = useNavigate();
  const location = useLocation();
  const current = apps.data?.find((a) => a.id === appId) ?? apps.data?.[0];
  const recordMatch = useMatch('/r/:id');
  const recordPrefix = recordMatch?.params.id?.slice(0, 3);
  const objectMatch = useMatch('/o/:object');
  const byApi = useMemo(() => new Map((objects ?? []).map((o) => [o.apiName, o] as const)), [objects]);

  const isObjectActive = (def: ObjectDef) => objectMatch?.params.object === def.apiName || (!!recordPrefix && def.keyPrefix === recordPrefix);
  const canSetup = perms.isAdmin || perms.canManageAutomations || perms.canManageAgents;
  // Workspace links that the current app already shows in its own navigation are omitted.
  const appPages = new Set(current?.nav.flatMap((n) => (n.type === 'page' ? [PAGE_PATH[n.page]?.(current)] : [])) ?? []);

  return (
    <nav aria-label={t('shell.nav.main')} className="flex h-full flex-col gap-4 overflow-y-auto p-3">
      {apps.data && apps.data.length > 0 && (
        <AppSwitcher
          apps={apps.data}
          current={current}
          onPick={(a) => {
            setAppId(a.id);
            onNavigate?.();
            navigate(`/app/${a.id}`);
          }}
        />
      )}
      {current && (
        <div className="space-y-0.5">
          {current.nav.map((item, i) => {
            if (item.type === 'page') {
              const to = PAGE_PATH[item.page]?.(current) ?? '/';
              return (
                <SideLink key={i} to={to} icon={<Icon name={item.icon} className="size-4 shrink-0" aria-hidden />} onNavigate={onNavigate} active={item.page === 'home' ? location.pathname === to : undefined}>
                  {item.label}
                </SideLink>
              );
            }
            const def = byApi.get(item.object);
            if (!def) return null;
            return (
              <SideLink key={i} to={`/o/${def.apiName}${item.view && item.view !== 'table' ? `?vt=${item.view}` : ''}`} icon={<Icon name={def.icon} className="size-4 shrink-0" aria-hidden />} active={isObjectActive(def)} onNavigate={onNavigate}>
                {item.label || def.pluralLabel}
              </SideLink>
            );
          })}
        </div>
      )}
      <div className="space-y-0.5 border-t border-slate-200 pt-3">
        <p className="px-2.5 pb-1 text-[11px] font-semibold tracking-wide text-slate-400 uppercase">{t('shell.nav.workspace')}</p>
        <SideLink to="/agents" icon={<Bot className="size-4 shrink-0" />} onNavigate={onNavigate} active={location.pathname.startsWith('/agents')}>
          {t('shell.nav.agents')}
        </SideLink>
        <SideLink to="/approvals" icon={<Inbox className="size-4 shrink-0" />} onNavigate={onNavigate}>
          {t('shell.nav.approvals')}
        </SideLink>
        {!appPages.has('/reports') && (
          <SideLink to="/reports" icon={<ChartColumn className="size-4 shrink-0" />} onNavigate={onNavigate} active={location.pathname.startsWith('/reports')}>
            {t('shell.nav.reports')}
          </SideLink>
        )}
        <SideLink to="/dashboards" icon={<LayoutDashboard className="size-4 shrink-0" />} onNavigate={onNavigate} active={location.pathname.startsWith('/dashboards')}>
          {t('shell.nav.dashboards')}
        </SideLink>
        {canSetup && (
          <SideLink to="/setup" icon={<Settings className="size-4 shrink-0" />} onNavigate={onNavigate} active={location.pathname.startsWith('/setup')}>
            {t('shell.nav.setup')}
          </SideLink>
        )}
      </div>
      {ai.data && (
        <div className="mt-auto rounded-lg bg-slate-50 px-2.5 py-2 text-[11px] text-slate-500" title={ai.data.note}>
          <span className={cx('mr-1.5 inline-block size-1.5 rounded-full align-middle', ai.data.configured ? 'bg-emerald-500' : 'bg-amber-500')} aria-hidden />
          {ai.data.configured ? t('shell.ai.status', { provider: `${ai.data.provider}${ai.data.model ? ` · ${ai.data.model}` : ''}` }) : t('shell.ai.offline')}
        </div>
      )}
    </nav>
  );
}

// ---------- AI side panel ----------

interface PanelState {
  recordId?: string;
  recordName?: string;
  agentId?: string;
  prompt?: string;
  nonce: number;
}

function AiPanel({ state, onClose, onNew }: { state: PanelState; onClose: () => void; onNew: () => void }) {
  const agents = useAgents();
  const usable = (agents.data ?? []).filter((a) => a.active);
  const [agentId, setAgentId] = useState(state.agentId ?? 'agt_copilot');
  useEffect(() => {
    if (state.agentId) setAgentId(state.agentId);
  }, [state.agentId, state.nonce]);
  const agent = usable.find((a) => a.id === agentId) ?? usable[0];

  return (
    <aside aria-label={t('shell.aiPanel.label')} className="fixed inset-y-0 right-0 z-40 flex w-full max-w-md animate-slide-in flex-col border-l border-slate-200 bg-white pt-(--safe-top) pr-(--safe-right) pb-(--safe-bottom) shadow-2xl xl:static xl:p-0 xl:z-auto xl:w-[26rem] xl:max-w-none xl:shadow-none">
      <div className="flex items-center gap-2 border-b border-slate-200 px-3 py-2">
        <Sparkles className="size-4 text-violet-600" aria-hidden />
        <label htmlFor="ai-panel-agent" className="sr-only">
          {t('shell.aiPanel.agent')}
        </label>
        <select id="ai-panel-agent" className="input h-8 flex-1 py-0 text-sm font-medium" value={agent?.id ?? ''} onChange={(e) => setAgentId(e.target.value)}>
          {usable.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
        <Button size="sm" variant="ghost" onClick={onNew}>
          {t('shell.aiPanel.newChat')}
        </Button>
        <IconButton icon={X} label={t('shell.aiPanel.close')} onClick={onClose} />
      </div>
      {state.recordName && (
        <p className="truncate border-b border-slate-100 bg-violet-50/50 px-3 py-1.5 text-xs text-violet-800">
          {tx('shell.aiPanel.context', { record: <span className="font-medium">{state.recordName}</span> })}
        </p>
      )}
      <div className="min-h-0 flex-1">
        {agent ? (
          <AgentChat key={`${agent.id}:${state.recordId ?? ''}:${state.nonce}`} agent={agent} recordId={state.recordId} recordName={state.recordName} initialPrompt={state.prompt} compact />
        ) : (
          <p className="p-4 text-sm text-slate-500">{agents.isLoading ? t('shell.aiPanel.loadingAgents') : t('shell.aiPanel.noAgents')}</p>
        )}
      </div>
    </aside>
  );
}

// ---------- layout ----------

/** Every page of a sandbox says so, so nobody mistakes it for production. */
function SandboxBanner() {
  const { organization } = useAuth();
  const config = usePublicConfig(currentOrganization());
  if (organization.kind !== 'sandbox') return null;
  return (
    <div className="flex shrink-0 flex-wrap items-center justify-center gap-x-3 gap-y-1 border-b border-amber-200 bg-amber-50 px-3 py-1.5 text-center text-xs text-amber-900" role="status">
      <span className="flex items-center gap-1.5">
        <FlaskConical className="size-3.5 shrink-0" aria-hidden />
        {t('orgs.sandbox.banner', { name: organization.name, parent: organization.parentName ?? '' })}
      </span>
      {organization.parentSlug && (
        <button type="button" className="font-semibold underline-offset-2 hover:underline" onClick={() => openOrganization(organization.parentSlug!, config.data?.baseDomain ?? null)}>
          {t('orgs.sandbox.openProduction')}
        </button>
      )}
    </div>
  );
}

export function Shell() {
  const [mobileNav, setMobileNav] = useState(false);
  const [panel, setPanel] = useState<PanelState | null>(null);
  const appMatch = useMatch('/app/:appId');
  const { appId, setAppId } = useCurrentApp();
  const location = useLocation();
  const nonce = useRef(0);

  useEffect(() => {
    const id = appMatch?.params.appId;
    if (id && id !== appId) setAppId(id);
  }, [appMatch?.params.appId, appId, setAppId]);
  useEffect(() => setMobileNav(false), [location.pathname]);

  const open = useCallback((ctx?: { recordId?: string; recordName?: string; agentId?: string; prompt?: string }) => setPanel({ ...ctx, nonce: ++nonce.current }), []);
  const close = useCallback(() => setPanel(null), []);
  const aiCtx = useMemo(() => ({ open, close, isOpen: !!panel }), [open, close, panel]);

  return (
    <AiPanelContext.Provider value={aiCtx}>
      <div className="flex h-full flex-col bg-slate-50">
        <SandboxBanner />
        <header className="flex h-14 shrink-0 items-center gap-3 border-b border-slate-200 bg-white px-3 sm:px-4">
          <IconButton icon={Menu} label={t('shell.mobile.openNav')} className="md:hidden" onClick={() => setMobileNav(true)} />
          <Link to="/" className="flex shrink-0 items-center gap-2" aria-label={t('shell.homeLink')}>
            <img src="/favicon.svg" alt="" className="size-7" />
            <span className="hidden text-[15px] font-semibold tracking-tight text-slate-900 sm:block">titoForce</span>
          </Link>
          <div className="flex flex-1 justify-center px-2">
            <GlobalSearch />
          </div>
          <Button variant="ai" icon={Sparkles} onClick={() => (panel ? close() : open())} aria-pressed={!!panel} className="max-sm:hidden">
            {t('shell.askAi')}
          </Button>
          <IconButton icon={Sparkles} label={t('shell.askAi')} className="sm:hidden" onClick={() => (panel ? close() : open())} />
          <InboxButton />
          <Notifications />
          <UserMenu />
        </header>
        <div className="flex min-h-0 flex-1">
          <aside className="hidden w-60 shrink-0 border-r border-slate-200 bg-white md:block">
            <Sidebar />
          </aside>
          {mobileNav && (
            <div className="fixed inset-0 z-50 md:hidden" role="dialog" aria-modal="true" aria-label={t('shell.mobile.nav')}>
              <div className="absolute inset-0 bg-slate-900/40" onClick={() => setMobileNav(false)} aria-hidden />
              <div className="absolute inset-y-0 left-0 flex w-72 animate-slide-in flex-col bg-white pt-(--safe-top) pb-(--safe-bottom) pl-(--safe-left) shadow-xl">
                <div className="flex justify-end p-2">
                  <IconButton icon={X} label={t('shell.mobile.closeNav')} onClick={() => setMobileNav(false)} />
                </div>
                <div className="min-h-0 flex-1">
                  <Sidebar onNavigate={() => setMobileNav(false)} />
                </div>
              </div>
            </div>
          )}
          {/* A size container, so pages lay out by the space they get (the docked AI panel takes 26rem) rather than by the viewport. */}
          <main id="main" className="@container min-w-0 flex-1 overflow-y-auto">
            <Outlet />
          </main>
          {panel && <AiPanel state={panel} onClose={close} onNew={() => open({ recordId: panel.recordId, recordName: panel.recordName })} />}
        </div>
      </div>
    </AiPanelContext.Provider>
  );
}
