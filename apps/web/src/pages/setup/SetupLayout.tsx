import { Bot, Database, History, LayoutGrid, Lock, type LucideIcon, Settings, ShieldCheck, Stamp, Users, Workflow } from 'lucide-react';
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
    ],
  },
  { label: 'Experience', items: [{ id: 'apps', label: 'Apps', icon: LayoutGrid, allowed: admin }] },
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

  return (
    <div className="flex min-h-full flex-col md:flex-row">
      {groups.length > 0 && (
        <aside className="shrink-0 border-b border-slate-200 bg-white md:w-60 md:border-r md:border-b-0">
          <div className="p-3 md:sticky md:top-0 md:p-4">
            <div className="mb-2 hidden items-center gap-2 px-2 text-sm font-semibold text-slate-900 md:flex">
              <Settings className="size-4 text-slate-500" aria-hidden />
              Setup
            </div>
            <nav aria-label="Setup" className="flex gap-1 overflow-x-auto md:block md:space-y-4 md:overflow-visible">
              {groups.map((g) => (
                <div key={g.label} className="flex shrink-0 gap-1 md:block md:space-y-0.5">
                  <p className="hidden px-2 pb-1 text-[11px] font-semibold tracking-wide text-slate-400 uppercase md:block">{g.label}</p>
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
      <div className="min-w-0 flex-1">{current && !current.allowed(perms) ? <NoAccess /> : <Outlet />}</div>
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
