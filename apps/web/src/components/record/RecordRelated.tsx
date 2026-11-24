import type { CrmRecord, FieldDef, ObjectDef, RefMap } from '@titoforce/shared';
import { useQuery } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';
import { api } from '../../api.ts';
import { inSentence, t } from '../../i18n/index.ts';
import { fieldDef, listColumns, valueOf } from '../../lib/format.ts';
import { useObjects, usePermissions } from '../../lib/hooks.ts';
import { FieldValue } from '../FieldValue.tsx';
import { RecordFormModal } from '../RecordForm.tsx';
import { Button, Card, EmptyState, ErrorBanner, Loading, ObjectTile } from '../ui.tsx';

export interface RelatedList {
  object: string;
  field: string;
  label: string;
  total: number;
  records: CrmRecord[];
}

export function useRelated(def: ObjectDef, record: CrmRecord) {
  return useQuery({
    queryKey: ['related', record.id],
    queryFn: () => api.get<{ lists: RelatedList[]; refs: RefMap }>(`/api/records/${def.apiName}/${record.id}/related`),
  });
}

function RelatedCard({ list, child, parent, refs }: { list: RelatedList; child: ObjectDef; parent: CrmRecord; refs: RefMap }) {
  const perms = usePermissions();
  const [creating, setCreating] = useState(false);
  const cols = listColumns(child)
    .filter((c) => c !== list.field && c !== 'name' && c !== child.nameField)
    .slice(0, 3)
    .map((c) => fieldDef(child, c))
    .filter((f): f is FieldDef => !!f);
  return (
    <Card
      title={
        <span className="flex items-center gap-2">
          <ObjectTile icon={child.icon} color={child.color} size="sm" />
          {list.label} <span className="font-normal text-slate-400">({list.total})</span>
        </span>
      }
      actions={
        perms.canCreate(child.apiName) && (
          <Button size="sm" icon={Plus} onClick={() => setCreating(true)} aria-label={t('record.related.newLabel', { label: child.label })}>
            {t('common.new')}
          </Button>
        )
      }
      bodyClassName="p-0"
    >
      {list.records.length === 0 ? (
        <p className="px-4 py-3 text-sm text-slate-400">{t('record.related.empty', { plural: inSentence(child.pluralLabel) })}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100 text-left text-xs text-slate-500">
                <th className="px-4 py-2 font-medium">{fieldDef(child, 'name')?.label ?? t('common.name')}</th>
                {cols.map((f) => (
                  <th key={f.apiName} className="px-3 py-2 font-medium whitespace-nowrap">
                    {f.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {list.records.map((r) => (
                <tr key={r.id} className="hover:bg-slate-50/70">
                  <td className="max-w-56 truncate px-4 py-2">
                    <Link to={`/r/${r.id}`} className="font-medium text-indigo-700 hover:underline">
                      {r.name || t('record.noName')}
                    </Link>
                  </td>
                  {cols.map((f) => (
                    <td key={f.apiName} className="max-w-48 truncate px-3 py-2 text-slate-600">
                      <FieldValue field={f} value={valueOf(r, f.apiName)} refs={refs} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {list.total > list.records.length && (
        <div className="border-t border-slate-100 px-4 py-2 text-right">
          <Link to={`/o/${child.apiName}?rf=${encodeURIComponent(`${list.field}:${parent.id}`)}`} className="text-xs font-medium text-indigo-600 hover:underline">
            {t('record.related.viewAll', { count: list.total })}
          </Link>
        </div>
      )}
      {creating && (
        <RecordFormModal
          object={child.apiName}
          open
          initial={{ [list.field]: parent.id }}
          initialLabels={{ [list.field]: parent.name }}
          onClose={() => setCreating(false)}
        />
      )}
    </Card>
  );
}

export function RelatedLists({ def, record }: { def: ObjectDef; record: CrmRecord }) {
  const related = useRelated(def, record);
  const objects = useObjects();
  if (related.isLoading) return <Loading />;
  if (related.error) return <ErrorBanner error={related.error} />;
  const lists = (related.data?.lists ?? []).map((l) => ({ list: l, child: objects.data?.find((o) => o.apiName === l.object) })).filter((x): x is { list: RelatedList; child: ObjectDef } => !!x.child);
  if (!lists.length) {
    return <EmptyState title={t('record.related.noListsTitle')}>{t('record.related.noListsBody', { label: inSentence(def.label) })}</EmptyState>;
  }
  return (
    <div className="space-y-4">
      {lists.map(({ list, child }) => (
        <RelatedCard key={`${list.object}.${list.field}`} list={list} child={child} parent={record} refs={related.data!.refs} />
      ))}
    </div>
  );
}
