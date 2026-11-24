import { useQuery } from '@tanstack/react-query';
import { ChevronDown, ChevronRight, ChevronsDownUp, ChevronsUpDown, Network, Search } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import { api } from '../api.ts';
import { Avatar, Badge, Button, cx, EmptyState, ErrorBanner, Loading } from '../components/ui.tsx';
import { inSentence, t } from '../i18n/index.ts';
import { useDebounced, useObjectDef } from '../lib/hooks.ts';

interface OrgNode {
  id: string;
  name: string;
  title: string | null;
  department: string | null;
  managerId: string | null;
  status: string | null;
  directReports: number;
}

interface Tree {
  byId: Map<string, OrgNode>;
  children: Map<string | null, OrgNode[]>;
}

function buildTree(nodes: OrgNode[]): Tree {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const children = new Map<string | null, OrgNode[]>();
  for (const n of nodes) {
    // Guard against reporting cycles: a node whose manager chain loops back is treated as a root.
    let parent = n.managerId;
    const seen = new Set([n.id]);
    for (let p = parent; p; p = byId.get(p)?.managerId ?? null) {
      if (seen.has(p)) {
        parent = null;
        break;
      }
      seen.add(p);
    }
    children.set(parent, [...(children.get(parent) ?? []), n]);
  }
  return { byId, children };
}

function chain(tree: Tree, id: string): OrgNode[] {
  const out: OrgNode[] = [];
  const seen = new Set<string>();
  for (let m = tree.byId.get(id)?.managerId ?? null; m && !seen.has(m); m = tree.byId.get(m)?.managerId ?? null) {
    seen.add(m);
    const node = tree.byId.get(m);
    if (node) out.unshift(node);
  }
  return out;
}

function PersonCard({ node, compact }: { node: OrgNode; compact?: boolean }) {
  const inactive = node.status && !/active/i.test(node.status);
  return (
    <div className={cx('flex min-w-0 items-center gap-3 rounded-xl border border-slate-200 bg-white px-3 py-2 shadow-xs', compact ? 'w-full' : 'w-80 max-w-full')}>
      <Avatar name={node.name} />
      <div className="min-w-0 flex-1">
        <Link to={`/r/${node.id}`} className="block truncate text-sm font-medium text-slate-900 hover:text-indigo-700 hover:underline">
          {node.name}
        </Link>
        <p className="truncate text-xs text-slate-500">{node.title ?? '—'}</p>
      </div>
      <div className="flex shrink-0 flex-col items-end gap-1">
        {node.department && <Badge>{node.department}</Badge>}
        {inactive && <Badge color="yellow">{node.status}</Badge>}
      </div>
    </div>
  );
}

function Branch({ node, tree, depth, expanded, toggle }: { node: OrgNode; tree: Tree; depth: number; expanded: Set<string>; toggle: (id: string) => void }) {
  const kids = tree.children.get(node.id) ?? [];
  const open = expanded.has(node.id);
  return (
    <li role="treeitem" aria-expanded={kids.length ? open : undefined} aria-level={depth + 1} aria-label={node.name} className="relative">
      <div className="flex items-center gap-1">
        {kids.length ? (
          <button
            type="button"
            onClick={() => toggle(node.id)}
            aria-label={t(open ? 'orgChart.collapseTeam' : 'orgChart.expandTeam', { name: node.name, count: kids.length })}
            className="grid size-6 shrink-0 place-items-center rounded text-slate-400 hover:bg-slate-200 hover:text-slate-700"
          >
            {open ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
          </button>
        ) : (
          <span className="size-6 shrink-0" />
        )}
        <PersonCard node={node} />
        {kids.length > 0 && !open && <span className="ml-2 text-xs text-slate-400">{t('orgChart.directReports', { count: kids.length })}</span>}
      </div>
      {open && kids.length > 0 && (
        <ul role="group" className="mt-2 ml-3 space-y-2 border-l border-slate-200 pl-5">
          {kids.map((k) => (
            <Branch key={k.id} node={k} tree={tree} depth={depth + 1} expanded={expanded} toggle={toggle} />
          ))}
        </ul>
      )}
    </li>
  );
}

export default function OrgChart() {
  const { def } = useObjectDef('employee');
  const q = useQuery({ queryKey: ['org-chart'], queryFn: () => api.get<OrgNode[]>('/api/org-chart') });
  const [search, setSearch] = useState('');
  const [department, setDepartment] = useState('');
  const term = useDebounced(search.trim().toLowerCase(), 200);
  const nodes = q.data ?? [];
  const tree = useMemo(() => buildTree(nodes), [nodes]);
  const roots = tree.children.get(null) ?? [];
  const [expanded, setExpanded] = useState<Set<string> | null>(null);
  // Default: roots and their direct reports are open.
  const open = expanded ?? new Set(roots.flatMap((r) => [r.id, ...(tree.children.get(r.id) ?? []).filter((k) => tree.children.has(k.id)).map((k) => k.id)]));
  const toggle = (id: string) => {
    const next = new Set(open);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setExpanded(next);
  };
  const departments = [...new Set(nodes.map((n) => n.department).filter((d): d is string => !!d))].sort();
  const filtering = !!term || !!department;
  const matches = filtering
    ? nodes.filter((n) => (!department || n.department === department) && (!term || [n.name, n.title, n.department].some((v) => v?.toLowerCase().includes(term))))
    : [];

  if (q.isLoading) return <Loading />;

  return (
    <div className="mx-auto max-w-6xl space-y-4 p-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">{t('orgChart.title')}</h1>
          <p className="text-sm text-slate-500">
            {def ? t('orgChart.objectCount', { count: nodes.length, label: inSentence(def.label), pluralLabel: inSentence(def.pluralLabel) }) : t('orgChart.employeeCount', { count: nodes.length })} ·{' '}
            {t('orgChart.departmentCount', { count: departments.length })} · {t('orgChart.managerCount', { count: nodes.filter((n) => n.directReports > 0).length })}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-slate-400" aria-hidden />
            <input className="input h-9 w-56 pl-8" placeholder={t('orgChart.searchPlaceholder')} aria-label={t('orgChart.searchLabel')} value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <select className="input h-9 w-auto" aria-label={t('orgChart.department')} value={department} onChange={(e) => setDepartment(e.target.value)}>
            <option value="">{t('orgChart.allDepartments')}</option>
            {departments.map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </select>
          {!filtering && (
            <>
              <Button size="sm" icon={ChevronsUpDown} onClick={() => setExpanded(new Set(nodes.filter((n) => tree.children.has(n.id)).map((n) => n.id)))}>
                {t('orgChart.expandAll')}
              </Button>
              <Button size="sm" icon={ChevronsDownUp} onClick={() => setExpanded(new Set())}>
                {t('orgChart.collapseAll')}
              </Button>
            </>
          )}
        </div>
      </div>

      <ErrorBanner error={q.error} />
      {!nodes.length && !q.error ? (
        <EmptyState icon={Network} title={t('orgChart.empty.title')}>
          {def ? t('orgChart.empty.bodyFor', { objects: inSentence(def.pluralLabel) }) : t('orgChart.empty.body')}
        </EmptyState>
      ) : filtering ? (
        matches.length ? (
          <ul className="space-y-2" aria-label={t('orgChart.matchingPeople')}>
            {matches.slice(0, 200).map((n) => {
              const path = chain(tree, n.id);
              return (
                <li key={n.id} className="max-w-xl space-y-1">
                  {path.length > 0 && <p className="truncate text-xs text-slate-400">{path.map((p) => p.name).join(' › ')}</p>}
                  <PersonCard node={n} compact />
                </li>
              );
            })}
            {matches.length > 200 && <li className="text-xs text-slate-400">{t('orgChart.truncated', { limit: 200, total: matches.length })}</li>}
          </ul>
        ) : (
          <p className="py-10 text-center text-sm text-slate-400">{t('orgChart.noMatches')}</p>
        )
      ) : (
        <ul role="tree" aria-label={t('orgChart.reportingLines')} className="space-y-3 overflow-x-auto pb-4">
          {roots.map((r) => (
            <Branch key={r.id} node={r} tree={tree} depth={0} expanded={open} toggle={toggle} />
          ))}
        </ul>
      )}
    </div>
  );
}
