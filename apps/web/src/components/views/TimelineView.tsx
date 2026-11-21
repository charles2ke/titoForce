import type { CrmRecord, FilterGroup, ObjectDef, QueryResponse } from '@titoforce/shared';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Link } from 'react-router';
import { api } from '../../api.ts';
import { hex } from '../../lib/colors.ts';
import { fieldDef, formatDate, parseDate, todayIso, toDateInput, valueOf } from '../../lib/format.ts';
import { Button, EmptyState, ErrorBanner, IconButton, Loading } from '../ui.tsx';
import { currentMonth, dayOf, monthStart, shiftMonth, statusColor } from './CalendarView.tsx';
import { BOARD_LIMIT } from './KanbanView.tsx';
import type { BaseQuery } from './TableView.tsx';

const MONTHS_SHOWN = 3;
const DAY_MS = 86_400_000;

const dayIndex = (iso: string, origin: Date): number => Math.round(((parseDate(iso)?.getTime() ?? origin.getTime()) - origin.getTime()) / DAY_MS);

export function TimelineView({ def, base, month, onMonth }: { def: ObjectDef; base: BaseQuery; month: string | null; onMonth: (m: string) => void }) {
  const tl = def.timeline;
  const first = monthStart(month);
  const monthKey = toDateInput(first).slice(0, 7);
  const from = toDateInput(first);
  const last = new Date(first.getFullYear(), first.getMonth() + MONTHS_SHOWN, 0);
  const to = toDateInput(last);
  const span = dayIndex(to, first) + 1;
  const filters: FilterGroup[] = tl
    ? [
        { match: 'all', rules: [{ field: tl.start, op: 'lte', value: to }] },
        {
          match: 'any',
          rules: [
            { field: tl.end, op: 'gte', value: from },
            { field: tl.end, op: 'is_empty' },
          ],
        },
        {
          match: 'any',
          rules: [
            { field: tl.end, op: 'gte', value: from },
            { field: tl.start, op: 'gte', value: from },
          ],
        },
      ]
    : [];
  const query = useQuery({
    queryKey: ['timeline-view', def.apiName, base, from, to],
    queryFn: () => api.post<QueryResponse>(`/api/records/${def.apiName}/query`, { ...base, sort: { field: tl!.start, dir: 'asc' }, andFilters: filters, page: 1, pageSize: BOARD_LIMIT }),
    placeholderData: keepPreviousData,
    enabled: !!tl,
  });

  if (!tl) return <ErrorBanner className="m-4" error={new Error(`${def.label} has no start/end dates configured for timelines.`)} />;

  const startLabel = fieldDef(def, tl.start)?.label ?? 'Start';
  const endLabel = fieldDef(def, tl.end)?.label ?? 'End';
  const months = Array.from({ length: MONTHS_SHOWN }, (_, i) => {
    const m = new Date(first.getFullYear(), first.getMonth() + i, 1);
    const days = new Date(m.getFullYear(), m.getMonth() + 1, 0).getDate();
    return { key: i, label: m.toLocaleDateString(undefined, { month: 'short', year: 'numeric' }), width: (days / span) * 100 };
  });
  const today = todayIso();
  const todayPos = today >= from && today <= to ? ((dayIndex(today, first) + 0.5) / span) * 100 : null;
  const pct = (n: number) => `${Math.max(0, Math.min(100, n))}%`;

  const bar = (r: CrmRecord) => {
    const s = dayOf(valueOf(r, tl.start));
    if (!s) return null;
    const e = dayOf(valueOf(r, tl.end)) ?? s;
    const a = Math.max(0, dayIndex(s, first));
    const b = Math.min(span - 1, dayIndex(e < s ? s : e, first));
    return { left: (a / span) * 100, width: ((b - a + 1) / span) * 100, start: s, end: dayOf(valueOf(r, tl.end)), clippedStart: s < from, clippedEnd: e > to };
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col p-4">
      <div className="mb-3 flex items-center gap-2">
        <h2 className="text-base font-semibold text-slate-900" aria-live="polite">
          {months[0]!.label} – {months[MONTHS_SHOWN - 1]!.label}
        </h2>
        <span className="text-xs text-slate-500">
          {startLabel} → {endLabel}
        </span>
        <div className="ml-auto flex items-center gap-1">
          <IconButton icon={ChevronLeft} label="Earlier" onClick={() => onMonth(shiftMonth(monthKey, -1))} />
          <Button size="sm" onClick={() => onMonth(currentMonth())}>
            Today
          </Button>
          <IconButton icon={ChevronRight} label="Later" onClick={() => onMonth(shiftMonth(monthKey, 1))} />
        </div>
      </div>
      {query.error ? (
        <ErrorBanner error={query.error} />
      ) : query.isLoading ? (
        <Loading />
      ) : !query.data?.records.length ? (
        <EmptyState title={`No ${def.pluralLabel.toLowerCase()} in this period`}>Use the arrows to look at other months.</EmptyState>
      ) : (
        <div className="min-h-0 flex-1 overflow-auto rounded-xl border border-slate-200 bg-white">
          <div className="min-w-[48rem]">
            <div className="sticky top-0 z-10 flex border-b border-slate-200 bg-slate-50 text-xs font-semibold text-slate-500">
              <div className="w-56 shrink-0 border-r border-slate-200 px-3 py-2">{def.label}</div>
              <div className="relative flex flex-1">
                {months.map((m) => (
                  <div key={m.key} className="border-r border-slate-200 px-2 py-2 last:border-r-0" style={{ width: `${m.width}%` }}>
                    {m.label}
                  </div>
                ))}
              </div>
            </div>
            <ul className="divide-y divide-slate-100">
              {query.data.records.map((r) => {
                const b = bar(r);
                const color = hex(statusColor(def, r));
                return (
                  <li key={r.id} className="flex items-center hover:bg-slate-50/70">
                    <div className="w-56 shrink-0 truncate border-r border-slate-200 px-3 py-2 text-sm">
                      <Link to={`/r/${r.id}`} className="font-medium text-slate-800 hover:text-indigo-700 hover:underline">
                        {r.name || '(no name)'}
                      </Link>
                    </div>
                    <div className="relative h-9 flex-1">
                      {months.slice(0, -1).map((m, i) => (
                        <span key={m.key} className="absolute inset-y-0 border-r border-slate-100" style={{ left: pct(months.slice(0, i + 1).reduce((acc, x) => acc + x.width, 0)) }} aria-hidden />
                      ))}
                      {todayPos !== null && <span className="absolute inset-y-0 w-px bg-rose-400" style={{ left: pct(todayPos) }} aria-hidden />}
                      {b && (
                        <Link
                          to={`/r/${r.id}`}
                          title={`${r.name}: ${formatDate(b.start)} – ${b.end ? formatDate(b.end) : 'no end date'}`}
                          className="absolute top-1.5 h-6 truncate px-2 text-xs leading-6 font-medium text-white shadow-xs hover:brightness-110"
                          style={{
                            left: pct(b.left),
                            width: `max(${pct(b.width)}, 0.5rem)`,
                            background: color,
                            borderRadius: `${b.clippedStart ? 0 : 6}px ${b.clippedEnd ? 0 : 6}px ${b.clippedEnd ? 0 : 6}px ${b.clippedStart ? 0 : 6}px`,
                          }}
                        >
                          {r.name}
                        </Link>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
        </div>
      )}
      {query.data && query.data.total > query.data.records.length && (
        <p className="mt-2 text-xs text-amber-700">Showing the first {query.data.records.length.toLocaleString()} of {query.data.total.toLocaleString()} records in this period.</p>
      )}
      {todayPos !== null && (
        <p className="mt-2 flex items-center gap-1.5 text-xs text-slate-500">
          <span className="inline-block h-3 w-px bg-rose-400" aria-hidden /> Today
        </p>
      )}
    </div>
  );
}
