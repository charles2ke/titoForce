import { Bot, Database, History, KeyRound, LayoutGrid, Lock, type LucideIcon, Plug, Settings, Share2, ShieldCheck, Stamp, Users, Workflow } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { Navigate, NavLink, Outlet, useLocation } from 'react-router';
import { cx, EmptyState } from '../../components/ui.tsx';
import { usePermissions } from '../../lib/hooks.ts';

type Perms = ReturnType<typeof usePermissions>;
type Section = { id: string; label: string; icon: LucideIcon; allowed: (p: Perms) => boolean };

const admin = (p: Perms) => p.isAdmin;
const automations = (p: Perms) => p.canManageAutomations;

const GROUPS: { label: string; items: Section[] }[] = [
  { label: 'Data model', items: [{ id: 'objects', label: 'Objects & Fields', icon: Database, allowed: admin }] },
  {
    label: 'Users & access',
    items: [
      { id: 'users', label: 'Users', icon: Users, allowed: admin },
      { id: 'roles', label: 'Roles & Permissions', icon: ShieldCheck, allowed: admin },
      { id: 'sharing', label: 'Sharing Rules', icon: Share2, allowed: admin },
      { id: 'sso', label: 'Single Sign-On', icon: KeyRound, allowed: admin },
    ],
  },
  { label: 'Experience', items: [{ id: 'apps', label: 'Apps', icon: LayoutGrid, allowed: admin }] },
  { label: 'Integrations', items: [{ id: 'integrations', label: 'Email, Calendar & Phone', icon: Plug, allowed: admin }] },
  {
    label: 'Automation',
    items: [
      { id: 'automations', label: 'Automations', icon: Workflow, allowed: automations },
      { id: 'approval-processes', label: 'Approval Processes', icon: Stamp, allowed: automations },
      { id: 'runs', label: 'Run History', icon: History, allowed: (p) => p.canManageAutomations || p.canManageAgents },
    ],
  },
  { label: 'AI', items: [{ id: 'agents', label: 'Agents', icon: Bot, allowed: (p) => p.canManageAgents }] },
];

const SECTIONS = GROUPS.flatMap((g) => g.items);

function NoAccess() {
  return (
    <div className="mx-auto max-w-3xl p-6">
      <div className="card">
        <EmptyState icon={Lock} title="You don’t have access to this area">
          This part of Setup requires additional permissions. Ask an administrator to update your role if you need it.
        </EmptyState>
      </div>
    </div>
  );
}

export default function SetupLayout() {
  const perms = usePermissions();
  const { pathname } = useLocation();
  const current = SECTIONS.find((s) => s.id === pathname.split('/')[2]);
  const groups = GROUPS.map((g) => ({ ...g, items: g.items.filter((s) => s.allowed(perms)) })).filter((g) => g.items.length > 0);
  const hasNav = groups.length > 0;
  const navRef = useRef<HTMLElement>(null);

  // In a narrow content area the nav becomes a sideways-scrolling tab bar: keep the current section's tab in view,
  // including when the area narrows later (e.g. the AI panel docks).
  useEffect(() => {
    const nav = navRef.current;
    if (!nav) return;
    const reveal = () => {
      const active = nav.querySelector<HTMLElement>('[aria-current="page"]');
      if (!active || nav.scrollWidth <= nav.clientWidth) return;
      const bar = nav.getBoundingClientRect();
      const tab = active.getBoundingClientRect();
      if (tab.left < bar.left || tab.right > bar.right) nav.scrollLeft += tab.left + tab.width / 2 - (bar.left + bar.width / 2);
    };
    const observer = new ResizeObserver(reveal);
    observer.observe(nav);
    return () => observer.disconnect();
  }, [pathname, hasNav]);

  return (
    <div className="flex min-h-full flex-col @4xl:flex-row">
      {hasNav && (
        <aside className="shrink-0 border-b border-slate-200 bg-white @4xl:w-60 @4xl:border-r @4xl:border-b-0">
          <div className="p-3 @4xl:sticky @4xl:top-0 @4xl:p-4">
            <div className="mb-2 hidden items-center gap-2 px-2 text-sm font-semibold text-slate-900 @4xl:flex">
              <Settings className="size-4 text-slate-500" aria-hidden />
              Setup
            </div>
            {/* The tab bar's end padding (pr-1) keeps the last tab whole when scrolled to the end: browsers round the
                scroll range to whole pixels, which can otherwise stop a fraction of a pixel short of the tab. */}
            <nav ref={navRef} aria-label="Setup" className="flex gap-1 overflow-x-auto pr-1 @4xl:block @4xl:space-y-4 @4xl:overflow-visible @4xl:pr-0">
              {groups.map((g) => (
                <div key={g.label} className="flex shrink-0 gap-1 @4xl:block @4xl:space-y-0.5">
                  <p className="hidden px-2 pb-1 text-[11px] font-semibold tracking-wide text-slate-400 uppercase @4xl:block">{g.label}</p>
                  {g.items.map((s) => (
                    <NavLink
                      key={s.id}
                      to={`/setup/${s.id}`}
                      className={({ isActive }) =>
                        cx(
                          'flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-sm whitespace-nowrap transition-colors',
                          isActive ? 'bg-indigo-50 font-medium text-indigo-700' : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900',
                        )
                      }
                    >
                      <s.icon className="size-4 shrink-0 opacity-80" aria-hidden />
                      {s.label}
                    </NavLink>
                  ))}
                </div>
              ))}
            </nav>
          </div>
        </aside>
      )}
      <div className="@container min-w-0 flex-1">{current && !current.allowed(perms) ? <NoAccess /> : <Outlet />}</div>
    </div>
  );
}

/** /setup → the first section the user may open. */
export function SetupIndex() {
  const perms = usePermissions();
  const first = SECTIONS.find((s) => s.allowed(perms));
  if (first) return <Navigate to={`/setup/${first.id}`} replace />;
  return <NoAccess />;
}
