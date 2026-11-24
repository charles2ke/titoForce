import type { CrmRecord, FieldDef, ObjectDef, QueryResponse, RecordResponse, RefMap } from '@titoforce/shared';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowRightLeft } from 'lucide-react';
import { type DragEvent, useMemo, useState } from 'react';
import { Link } from 'react-router';
import { api, errorMessage } from '../../api.ts';
import { inSentence, t } from '../../i18n/index.ts';
import { hex } from '../../lib/colors.ts';
import { fieldDef, formatCompact, valueOf } from '../../lib/format.ts';
import { invalidateRecordData, usePermissions } from '../../lib/hooks.ts';
import { useToast } from '../feedback.tsx';
import { FieldValue, UserChip } from '../FieldValue.tsx';
import { cx, ErrorBanner, Loading, MenuItem, Popover } from '../ui.tsx';
import type { BaseQuery } from './TableView.tsx';

export const BOARD_LIMIT = 500;
const NONE = '__none__';

interface Column {
  key: string;
  value: string | null;
  label: string;
  color: string | null | undefined;
}

/** Fields that make sense as kanban lanes. */
export const groupableFields = (def: ObjectDef): FieldDef[] => def.fields.filter((f) => f.type === 'picklist');

function MoveMenu({ record, columns, current, onMove }: { record: CrmRecord; columns: Column[]; current: string; onMove: (value: string | null) => void }) {
  return (
    <Popover
      align="right"
      className="w-48"
      trigger={({ toggle, open }) => (
        <button
          type="button"
          onClick={toggle}
          aria-expanded={open}
          aria-label={t('views.kanban.move', { name: record.name })}
          className="rounded p-0.5 text-slate-300 opacity-0 group-hover:opacity-100 hover:bg-slate-100 hover:text-slate-600 focus-visible:opacity-100"
        >
          <ArrowRightLeft className="size-3.5" />
        </button>
      )}
    >
      {(close) => (
        <div className="max-h-64 overflow-y-auto py-1">
          {columns
            .filter((c) => c.key !== current)
            .map((c) => (
              <MenuItem
                key={c.key}
                onClick={() => {
                  close();
                  onMove(c.value);
                }}
              >
                <span className="size-2 shrink-0 rounded-full" style={{ background: hex(c.color) }} />
                {c.label}
              </MenuItem>
            ))}
        </div>
      )}
    </Popover>
  );
}

function Card({
  record,
  refs,
  fields,
  columns,
  current,
  draggable,
  dragging,
  onDragStart,
  onDragEnd,
  onMove,
}: {
  record: CrmRecord;
  refs: RefMap;
  fields: FieldDef[];
  columns: Column[];
  current: string;
  draggable: boolean;
  dragging: boolean;
  onDragStart: (e: DragEvent) => void;
  onDragEnd: () => void;
  onMove: (value: string | null) => void;
}) {
  return (
    <article
      draggable={draggable}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      aria-label={record.name}
      data-record-id={record.id}
      className={cx(
        'group rounded-lg border border-slate-200 bg-white p-3 shadow-xs transition',
        draggable && 'cursor-grab active:cursor-grabbing',
        dragging ? 'opacity-40' : 'hover:border-slate-300 hover:shadow-sm',
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <Link to={`/r/${record.id}`} className="min-w-0 text-sm leading-snug font-medium text-slate-900 hover:text-indigo-700 hover:underline" draggable={false}>
          {record.name || t('views.noName')}
        </Link>
        {draggable && <MoveMenu record={record} columns={columns} current={current} onMove={onMove} />}
      </div>
      {fields.length > 0 && (
        <dl className="mt-2 space-y-1 text-xs">
          {fields.map((f) => (
            <div key={f.apiName} className="flex min-w-0 items-center gap-2">
              <dt className="sr-only">{f.label}</dt>
              <dd className="min-w-0 truncate text-slate-600" title={f.label}>
                <FieldValue field={f} value={valueOf(record, f.apiName)} refs={refs} />
              </dd>
            </div>
          ))}
        </dl>
      )}
      {record.ownerId && (
        <div className="mt-2 text-xs text-slate-500">
          <UserChip id={record.ownerId} name={refs[record.ownerId]?.name} />
        </div>
      )}
    </article>
  );
}

export function KanbanView({ def, base, groupBy, columns: listCols }: { def: ObjectDef; base: BaseQuery; groupBy: string; columns: string[] }) {
  const qc = useQueryClient();
  const toast = useToast();
  const perms = usePermissions();
  const [dragging, setDragging] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const field = def.fields.find((f) => f.apiName === groupBy && f.type === 'picklist');
  const key = ['kanban', def.apiName, base, groupBy];
  const query = useQuery({
    queryKey: key,
    queryFn: () => api.post<QueryResponse>(`/api/records/${def.apiName}/query`, { ...base, page: 1, pageSize: BOARD_LIMIT }),
    placeholderData: keepPreviousData,
    enabled: !!field,
  });
  const records = query.data?.records ?? [];
  const refs = query.data?.refs ?? {};
  const sumField = def.fields.find((f) => f.type === 'currency');
  const cardFields = useMemo(
    () =>
      listCols
        .filter((c) => c !== 'name' && c !== def.nameField && c !== groupBy && c !== 'owner_id')
        .map((c) => fieldDef(def, c))
        .filter((f): f is FieldDef => !!f)
        .slice(0, 3),
    [listCols, def, groupBy],
  );

  const move = useMutation({
    mutationFn: ({ id, value }: { id: string; value: string | null }) => api.patch<RecordResponse>(`/api/records/${def.apiName}/${id}`, { fields: { [groupBy]: value } }),
    onMutate: async ({ id, value }) => {
      await qc.cancelQueries({ queryKey: key });
      const prev = qc.getQueryData<QueryResponse>(key);
      if (prev) qc.setQueryData<QueryResponse>(key, { ...prev, records: prev.records.map((r) => (r.id === id ? { ...r, fields: { ...r.fields, [groupBy]: value } } : r)) });
      return { prev };
    },
    onError: (err, _vars, ctx) => {
      if (ctx?.prev) qc.setQueryData(key, ctx.prev);
      toast.error(errorMessage(err));
    },
    onSettled: () => invalidateRecordData(qc),
  });

  if (!field) return <ErrorBanner className="m-4" error={new Error(t('views.kanban.needsPicklist', { field: groupBy }))} />;
  if (query.isLoading) return <Loading />;
  if (query.error) return <ErrorBanner error={query.error} className="m-4" />;

  const laneOf = (r: CrmRecord): string => {
    const v = r.fields[groupBy];
    return v === null || v === undefined || v === '' ? NONE : String(v);
  };
  const columns: Column[] = (field.options ?? []).map((o) => ({ key: o.value, value: o.value, label: o.label ?? o.value, color: o.color }));
  const known = new Set(columns.map((c) => c.key));
  for (const r of records) {
    const lane = laneOf(r);
    if (!known.has(lane)) {
      known.add(lane);
      columns.push(lane === NONE ? { key: NONE, value: null, label: t('views.kanban.noValue', { field: inSentence(field.label) }), color: 'gray' } : { key: lane, value: lane, label: lane, color: 'gray' });
    }
  }
  const byLane = new Map<string, CrmRecord[]>(columns.map((c) => [c.key, []]));
  for (const r of records) byLane.get(laneOf(r))!.push(r);

  const drop = (col: Column) => (e: DragEvent) => {
    e.preventDefault();
    setOver(null);
    const id = e.dataTransfer.getData('text/plain') || dragging;
    setDragging(null);
    const rec = records.find((r) => r.id === id);
    if (rec && laneOf(rec) !== col.key) move.mutate({ id: rec.id, value: col.value });
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {query.data && query.data.total > records.length && (
        <p className="border-b border-amber-200 bg-amber-50 px-4 py-1.5 text-xs text-amber-800">{t('views.kanban.truncated', { shown: records.length, total: query.data.total })}</p>
      )}
      <div className="flex min-h-0 flex-1 gap-3 overflow-x-auto p-4" role="list" aria-label={t('views.kanban.boardLabel', { plural: def.pluralLabel, field: field.label })}>
        {columns.map((col) => {
          const items = byLane.get(col.key) ?? [];
          const sum = sumField ? items.reduce((acc, r) => acc + (typeof r.fields[sumField.apiName] === 'number' ? (r.fields[sumField.apiName] as number) : 0), 0) : 0;
          return (
            <section
              key={col.key}
              role="listitem"
              aria-label={col.label}
              data-lane={col.key}
              onDragOver={(e) => {
                if (!dragging) return;
                e.preventDefault();
                e.dataTransfer.dropEffect = 'move';
                if (over !== col.key) setOver(col.key);
              }}
              onDragLeave={(e) => {
                if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOver((o) => (o === col.key ? null : o));
              }}
              onDrop={drop(col)}
              className={cx('flex w-72 shrink-0 flex-col rounded-xl bg-slate-100/80 transition-colors', over === col.key && 'bg-indigo-50 ring-2 ring-indigo-300')}
            >
              <header className="flex items-center gap-2 px-3 pt-3 pb-2">
                <span className="size-2.5 shrink-0 rounded-full" style={{ background: hex(col.color) }} aria-hidden />
                <h3 className="min-w-0 truncate text-sm font-semibold text-slate-800">{col.label}</h3>
                <span className="rounded-full bg-white px-1.5 text-xs font-medium text-slate-500 tabular-nums">{items.length}</span>
                {sumField && sum !== 0 && <span className="ml-auto text-xs font-medium text-slate-500 tabular-nums">{formatCompact(sum, 'currency')}</span>}
              </header>
              <div className="flex min-h-24 flex-1 flex-col gap-2 overflow-y-auto px-2 pb-3">
                {items.map((r) => (
                  <Card
                    key={r.id}
                    record={r}
                    refs={refs}
                    fields={cardFields}
                    columns={columns}
                    current={col.key}
                    draggable={perms.canEdit(def.apiName, r.ownerId)}
                    dragging={dragging === r.id}
                    onDragStart={(e) => {
                      e.dataTransfer.setData('text/plain', r.id);
                      e.dataTransfer.effectAllowed = 'move';
                      setDragging(r.id);
                    }}
                    onDragEnd={() => {
                      setDragging(null);
                      setOver(null);
                    }}
                    onMove={(value) => move.mutate({ id: r.id, value })}
                  />
                ))}
                {items.length === 0 && <p className="px-2 py-6 text-center text-xs text-slate-400">{t('views.kanban.dropHere')}</p>}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}
