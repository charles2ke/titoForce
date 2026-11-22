import type { CrmRecord, FieldDef, FilterGroup, ObjectDef, QueryResponse, RefMap, SortSpec } from '@titoforce/shared';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowDown, ArrowUp, ArrowUpDown, Ellipsis, Pencil, Trash } from 'lucide-react';
import { type ReactNode, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router';
import { api, errorMessage } from '../../api.ts';
import { inSentence, t } from '../../i18n/index.ts';
import { fieldDef, isEditable, valueOf } from '../../lib/format.ts';
import { invalidateRecordData, usePermissions } from '../../lib/hooks.ts';
import { useConfirm, useToast } from '../feedback.tsx';
import { FieldInput } from '../FieldInput.tsx';
import { FieldValue } from '../FieldValue.tsx';
import { RecordFormModal } from '../RecordForm.tsx';
import { Button, cx, EmptyState, ErrorBanner, FormField, Loading, MenuItem, Modal, Pagination, Popover } from '../ui.tsx';

/** Filters, search and sort shared by every list presentation (table, kanban, calendar, timeline). */
export interface BaseQuery {
  filters: FilterGroup | null;
  q: string;
  sort: SortSpec | null;
}

export const PAGE_SIZE = 50;

const UNSORTABLE = new Set(['longtext', 'multipicklist']);

type BulkResult = { done: number; errors: { id: string; message: string }[] };

function BulkEditModal({ def, ids, open, onClose, onDone }: { def: ObjectDef; ids: string[]; open: boolean; onClose: () => void; onDone: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const fields = def.fields.filter((f) => isEditable(def, f) && f.apiName !== 'name');
  const [field, setField] = useState(fields[0]?.apiName ?? '');
  const [value, setValue] = useState<unknown>(null);
  const f = fields.find((x) => x.apiName === field);
  const run = useMutation({
    mutationFn: () => api.post<BulkResult>(`/api/records/${def.apiName}/bulk`, { action: 'update', ids, fields: { [field]: value === '' ? null : value } }),
    onSuccess: async (res) => {
      await invalidateRecordData(qc);
      if (res.errors.length) toast.error(t('views.table.bulkUpdatePartial', { done: res.done, failed: res.errors.length, error: res.errors[0]!.message }));
      else toast.success(t('views.table.bulkUpdated', { count: res.done }));
      onDone();
      onClose();
    },
  });
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t('views.table.bulkUpdateTitle', { count: ids.length, singular: inSentence(def.label), plural: inSentence(def.pluralLabel) })}
      size="sm"
      footer={
        <>
          <Button onClick={onClose}>{t('common.cancel')}</Button>
          <Button variant="primary" loading={run.isPending} disabled={!f} onClick={() => run.mutate()}>
            {t('views.table.update')}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <ErrorBanner error={run.error} />
        <FormField label={t('common.field')} htmlFor="bulk-field">
          <select
            id="bulk-field"
            className="input"
            value={field}
            onChange={(e) => {
              setField(e.target.value);
              setValue(null);
            }}
          >
            {fields.map((x) => (
              <option key={x.apiName} value={x.apiName}>
                {x.label}
              </option>
            ))}
          </select>
        </FormField>
        {f && (
          <FormField label={t('views.table.newValue')} htmlFor="bulk-value" help={t('views.table.newValueHelp')}>
            <FieldInput key={f.apiName} id="bulk-value" field={f} value={value} onChange={setValue} />
          </FormField>
        )}
      </div>
    </Modal>
  );
}

export function RowMenu({ def, record, refs }: { def: ObjectDef; record: CrmRecord; refs: RefMap }) {
  const perms = usePermissions();
  const confirm = useConfirm();
  const toast = useToast();
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
  const canEdit = perms.canEdit(def.apiName, record.ownerId);
  const canDelete = perms.canDelete(def.apiName, record.ownerId);
  if (!canEdit && !canDelete) return null;
  const remove = async () => {
    if (!(await confirm({ title: t('views.table.deleteTitle', { label: inSentence(def.label) }), message: t('views.table.deleteMessage', { name: record.name }), confirmLabel: t('common.delete'), danger: true }))) return;
    try {
      await api.del(`/api/records/${def.apiName}/${record.id}`);
      await invalidateRecordData(qc);
      toast.success(t('views.table.deleted', { name: record.name }));
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };
  return (
    <>
      <Popover
        align="right"
        className="w-40"
        trigger={({ toggle, open }) => (
          <button type="button" onClick={toggle} aria-expanded={open} aria-label={t('views.table.rowActions', { name: record.name })} className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700">
            <Ellipsis className="size-4" />
          </button>
        )}
      >
        {(close) => (
          <div className="py-1">
            {canEdit && (
              <MenuItem
                icon={Pencil}
                onClick={() => {
                  close();
                  setEditing(true);
                }}
              >
                {t('common.edit')}
              </MenuItem>
            )}
            {canDelete && (
              <MenuItem
                icon={Trash}
                danger
                onClick={() => {
                  close();
                  void remove();
                }}
              >
                {t('common.delete')}
              </MenuItem>
            )}
          </div>
        )}
      </Popover>
      <RecordFormModal object={def.apiName} record={record} refs={refs} open={editing} onClose={() => setEditing(false)} />
    </>
  );
}

export function TableView({
  def,
  base,
  columns,
  page,
  onPage,
  onSort,
  emptyAction,
}: {
  def: ObjectDef;
  base: BaseQuery;
  columns: string[];
  page: number;
  onPage: (p: number) => void;
  onSort: (s: SortSpec | null) => void;
  emptyAction?: ReactNode;
}) {
  const qc = useQueryClient();
  const toast = useToast();
  const confirm = useConfirm();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkOpen, setBulkOpen] = useState(false);
  const query = useQuery({
    queryKey: ['records', def.apiName, base, page],
    queryFn: () => api.post<QueryResponse>(`/api/records/${def.apiName}/query`, { ...base, page, pageSize: PAGE_SIZE }),
    placeholderData: keepPreviousData,
  });
  const records = query.data?.records ?? [];
  const refs = query.data?.refs ?? {};
  const cols = useMemo(() => columns.map((c) => fieldDef(def, c)).filter((f): f is FieldDef => !!f), [columns, def]);
  const baseKey = JSON.stringify(base);
  useEffect(() => setSelected(new Set()), [baseKey, page]);

  const bulkDelete = useMutation({
    mutationFn: (ids: string[]) => api.post<BulkResult>(`/api/records/${def.apiName}/bulk`, { action: 'delete', ids }),
    onSuccess: async (res) => {
      await invalidateRecordData(qc);
      setSelected(new Set());
      if (res.errors.length) toast.error(t('views.table.bulkDeletePartial', { done: res.done, failed: res.errors.length, error: res.errors[0]!.message }));
      else toast.success(t('views.table.bulkDeleted', { count: res.done }));
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  if (query.isLoading) return <Loading />;
  if (query.error) return <ErrorBanner error={query.error} className="m-4" />;

  const allOnPage = records.length > 0 && records.every((r) => selected.has(r.id));
  const toggleAll = () => setSelected(allOnPage ? new Set() : new Set(records.map((r) => r.id)));
  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const sortBy = (f: FieldDef) => {
    const current = base.sort?.field === f.apiName ? base.sort.dir : null;
    onSort(current === 'asc' ? { field: f.apiName, dir: 'desc' } : current === 'desc' ? null : { field: f.apiName, dir: 'asc' });
  };
  const ids = [...selected];
  const isNameCol = (f: FieldDef) => f.apiName === 'name' || f.apiName === def.nameField;

  return (
    <div className={cx('flex min-h-0 flex-col transition-opacity', query.isPlaceholderData && 'opacity-70')}>
      {selected.size > 0 && (
        <div className="flex flex-wrap items-center gap-2 border-b border-indigo-100 bg-indigo-50 px-4 py-2 text-sm">
          <span className="font-medium text-indigo-900">{t('views.table.selected', { count: selected.size })}</span>
          <Button size="sm" icon={Pencil} onClick={() => setBulkOpen(true)}>
            {t('views.table.updateField')}
          </Button>
          <Button
            size="sm"
            variant="danger"
            icon={Trash}
            loading={bulkDelete.isPending}
            onClick={async () => {
              if (await confirm({ title: t('views.table.bulkDeleteTitle', { count: ids.length }), message: t('views.table.bulkDeleteMessage'), confirmLabel: t('common.delete'), danger: true })) bulkDelete.mutate(ids);
            }}
          >
            {t('common.delete')}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>
            {t('views.table.clearSelection')}
          </Button>
        </div>
      )}
      {records.length === 0 ? (
        <div className="p-6">
          <EmptyState title={t('views.table.emptyTitle', { plural: inSentence(def.pluralLabel) })} action={emptyAction}>
            {base.q || base.filters ? t('views.table.emptyFiltered') : t('views.table.emptyCreate', { label: inSentence(def.label) })}
          </EmptyState>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-max text-sm">
            <thead className="sticky top-0 z-10 bg-slate-50">
              <tr className="border-b border-slate-200 text-left">
                <th className="w-10 px-4 py-2">
                  <input type="checkbox" aria-label={t('views.table.selectAll')} className="size-4 rounded border-slate-300 text-indigo-600" checked={allOnPage} onChange={toggleAll} />
                </th>
                {cols.map((f) => {
                  const dir = base.sort?.field === f.apiName ? base.sort.dir : null;
                  return (
                    <th key={f.apiName} scope="col" aria-sort={dir === 'asc' ? 'ascending' : dir === 'desc' ? 'descending' : undefined} className="px-3 py-2 text-xs font-semibold tracking-wide whitespace-nowrap text-slate-500 uppercase">
                      {UNSORTABLE.has(f.type) ? (
                        f.label
                      ) : (
                        <button type="button" onClick={() => sortBy(f)} className="group inline-flex items-center gap-1 uppercase hover:text-slate-800">
                          {f.label}
                          {dir === 'asc' ? <ArrowUp className="size-3" /> : dir === 'desc' ? <ArrowDown className="size-3" /> : <ArrowUpDown className="size-3 opacity-0 group-hover:opacity-60" />}
                        </button>
                      )}
                    </th>
                  );
                })}
                <th className="w-10">
                  <span className="sr-only">{t('common.actions')}</span>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 bg-white">
              {records.map((r) => (
                <tr key={r.id} className={cx('hover:bg-slate-50/80', selected.has(r.id) && 'bg-indigo-50/40')}>
                  <td className="px-4 py-2">
                    <input type="checkbox" aria-label={t('views.table.selectRecord', { name: r.name })} className="size-4 rounded border-slate-300 text-indigo-600" checked={selected.has(r.id)} onChange={() => toggle(r.id)} />
                  </td>
                  {cols.map((f) => (
                    <td key={f.apiName} className="max-w-xs truncate px-3 py-2 text-slate-700">
                      {isNameCol(f) ? (
                        <Link to={`/r/${r.id}`} className="font-medium text-indigo-700 hover:underline">
                          {r.name || t('views.noName')}
                        </Link>
                      ) : (
                        <FieldValue field={f} value={valueOf(r, f.apiName)} refs={refs} />
                      )}
                    </td>
                  ))}
                  <td className="px-2 py-2 text-right">
                    <RowMenu def={def} record={r} refs={refs} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {query.data && query.data.total > PAGE_SIZE && (
        <div className="border-t border-slate-200 bg-white px-4 py-2">
          <Pagination page={page} pageSize={PAGE_SIZE} total={query.data.total} onPage={onPage} />
        </div>
      )}
      {bulkOpen && <BulkEditModal def={def} ids={ids} open onClose={() => setBulkOpen(false)} onDone={() => setSelected(new Set())} />}
    </div>
  );
}
