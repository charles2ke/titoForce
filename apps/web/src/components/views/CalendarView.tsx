import type { CrmRecord, FilterGroup, ObjectDef, QueryResponse } from '@titoforce/shared';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight, Plus } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';
import { api } from '../../api.ts';
import { hex } from '../../lib/colors.ts';
import { addDays, fieldDef, parseDate, todayIso, toDateInput, valueOf } from '../../lib/format.ts';
import { usePermissions } from '../../lib/hooks.ts';
import { RecordFormModal } from '../RecordForm.tsx';
import { Button, cx, ErrorBanner, IconButton, Loading, Popover } from '../ui.tsx';
import { BOARD_LIMIT } from './KanbanView.tsx';
import type { BaseQuery } from './TableView.tsx';

const MONTH_RE = /^(\d{4})-(\d{2})$/;
const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export const currentMonth = () => todayIso().slice(0, 7);

/** Parses "YYYY-MM" (falling back to the current month). */
export function monthStart(month: string | null | undefined): Date {
  const m = MONTH_RE.exec(month ?? '');
  const now = new Date();
  return m && Number(m[2]) >= 1 && Number(m[2]) <= 12 ? new Date(Number(m[1]), Number(m[2]) - 1, 1) : new Date(now.getFullYear(), now.getMonth(), 1);
}

export const shiftMonth = (month: string | null | undefined, delta: number): string => {
  const d = monthStart(month);
  return toDateInput(new Date(d.getFullYear(), d.getMonth() + delta, 1)).slice(0, 7);
};

/** Calendar day (YYYY-MM-DD, local) of a date or datetime value. */
export function dayOf(v: unknown): string | null {
  if (typeof v !== 'string' || !v) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return v;
  const d = parseDate(v);
  return d ? toDateInput(d) : null;
}

export function statusColor(def: ObjectDef, r: CrmRecord): string | null {
  if (!def.statusField) return def.color;
  const f = def.fields.find((x) => x.apiName === def.statusField);
  return f?.options?.find((o) => o.value === r.fields[def.statusField!])?.color ?? 'gray';
}

function EventChip({ def, record }: { def: ObjectDef; record: CrmRecord }) {
  const color = statusColor(def, record);
  return (
    <Link
      to={`/r/${record.id}`}
      title={record.name}
      className="flex items-center gap-1.5 truncate rounded px-1.5 py-0.5 text-xs text-slate-700 hover:bg-slate-100"
    >
      <span className="size-1.5 shrink-0 rounded-full" style={{ background: hex(color) }} aria-hidden />
      <span className="truncate">{record.name || '(no name)'}</span>
    </Link>
  );
}

export function CalendarView({ def, base, dateField, month, onMonth }: { def: ObjectDef; base: BaseQuery; dateField: string; month: string | null; onMonth: (m: string) => void }) {
  const perms = usePermissions();
  const [creating, setCreating] = useState<string | null>(null);
  const field = fieldDef(def, dateField);
  const first = monthStart(month);
  const offset = (first.getDay() + 6) % 7;
  const daysInMonth = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
  const weeks = Math.ceil((offset + daysInMonth) / 7);
  const gridStart = addDays(toDateInput(first), -offset);
  const gridEnd = addDays(gridStart, weeks * 7 - 1);
  const range: FilterGroup = {
    match: 'all',
    rules: [
      { field: dateField, op: 'gte', value: gridStart },
      { field: dateField, op: 'lte', value: gridEnd },
    ],
  };
  const query = useQuery({
    queryKey: ['calendar', def.apiName, base, dateField, gridStart, gridEnd],
    queryFn: () => api.post<QueryResponse>(`/api/records/${def.apiName}/query`, { ...base, sort: { field: dateField, dir: 'asc' }, andFilters: [range], page: 1, pageSize: BOARD_LIMIT }),
    placeholderData: keepPreviousData,
    enabled: !!field,
  });

  if (!field || (field.type !== 'date' && field.type !== 'datetime')) return <ErrorBanner className="m-4" error={new Error(`Calendar views need a date field; “${dateField}” is not one.`)} />;

  const byDay = new Map<string, CrmRecord[]>();
  for (const r of query.data?.records ?? []) {
    const d = dayOf(valueOf(r, dateField));
    if (!d) continue;
    const list = byDay.get(d) ?? [];
    list.push(r);
    byDay.set(d, list);
  }
  const today = todayIso();
  const monthKey = toDateInput(first).slice(0, 7);
  const days = Array.from({ length: weeks * 7 }, (_, i) => addDays(gridStart, i));
  const canCreate = perms.canCreate(def.apiName) && field.type === 'date';

  return (
    <div className="flex min-h-0 flex-1 flex-col p-4">
      <div className="mb-3 flex items-center gap-2">
        <h2 className="text-base font-semibold text-slate-900" aria-live="polite">
          {first.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}
        </h2>
        <span className="text-xs text-slate-500">by {field.label}</span>
        <div className="ml-auto flex items-center gap-1">
          <IconButton icon={ChevronLeft} label="Previous month" onClick={() => onMonth(shiftMonth(monthKey, -1))} />
          <Button size="sm" onClick={() => onMonth(currentMonth())}>
            Today
          </Button>
          <IconButton icon={ChevronRight} label="Next month" onClick={() => onMonth(shiftMonth(monthKey, 1))} />
        </div>
      </div>
      {query.error ? (
        <ErrorBanner error={query.error} />
      ) : query.isLoading ? (
        <Loading />
      ) : (
        <div className="grid min-h-0 flex-1 grid-cols-7 overflow-hidden rounded-xl border border-slate-200 bg-slate-200 [gap:1px]" role="grid" aria-label="Calendar">
          {WEEKDAYS.map((d) => (
            <div key={d} role="columnheader" className="bg-slate-50 px-2 py-1.5 text-xs font-semibold text-slate-500">
              {d}
            </div>
          ))}
          {days.map((day) => {
            const items = byDay.get(day) ?? [];
            const inMonth = day.slice(0, 7) === monthKey;
            const label = parseDate(day)!.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
            return (
              <div key={day} role="gridcell" aria-label={`${label}: ${items.length} ${items.length === 1 ? 'item' : 'items'}`} className={cx('group flex min-h-24 flex-col gap-0.5 p-1', inMonth ? 'bg-white' : 'bg-slate-50/80')}>
                <div className="flex items-center justify-between px-1">
                  <span className={cx('grid size-6 place-items-center rounded-full text-xs', day === today ? 'bg-indigo-600 font-semibold text-white' : inMonth ? 'text-slate-700' : 'text-slate-400')}>
                    {Number(day.slice(8))}
                  </span>
                  {canCreate && (
                    <button
                      type="button"
                      onClick={() => setCreating(day)}
                      aria-label={`New ${def.label.toLowerCase()} on ${label}`}
                      className="rounded p-0.5 text-slate-400 opacity-0 group-hover:opacity-100 hover:bg-slate-100 hover:text-slate-700 focus-visible:opacity-100"
                    >
                      <Plus className="size-3.5" />
                    </button>
                  )}
                </div>
                {items.slice(0, 3).map((r) => (
                  <EventChip key={r.id} def={def} record={r} />
                ))}
                {items.length > 3 && (
                  <Popover
                    className="w-64"
                    trigger={({ toggle, open }) => (
                      <button type="button" onClick={toggle} aria-expanded={open} className="px-1.5 text-left text-xs font-medium text-indigo-600 hover:underline">
                        +{items.length - 3} more
                      </button>
                    )}
                  >
                    {() => (
                      <div className="max-h-72 overflow-y-auto p-1.5">
                        <p className="px-1.5 pb-1 text-xs font-semibold text-slate-500">{label}</p>
                        {items.map((r) => (
                          <EventChip key={r.id} def={def} record={r} />
                        ))}
                      </div>
                    )}
                  </Popover>
                )}
              </div>
            );
          })}
        </div>
      )}
      {query.data && query.data.total > query.data.records.length && (
        <p className="mt-2 text-xs text-amber-700">Showing the first {query.data.records.length.toLocaleString()} of {query.data.total.toLocaleString()} records in this range.</p>
      )}
      <RecordFormModal object={def.apiName} open={!!creating} initial={creating ? { [dateField]: creating } : undefined} onClose={() => setCreating(null)} />
    </div>
  );
}
