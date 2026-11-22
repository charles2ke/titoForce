import type { AttachmentDTO, CrmRecord, ObjectDef } from '@titoforce/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { File, FileArchive, FileImage, FileSpreadsheet, FileText, type LucideIcon, Paperclip, Trash2, Upload } from 'lucide-react';
import { type DragEvent, useRef, useState } from 'react';
import { Link } from 'react-router';
import { api, errorMessage } from '../../api.ts';
import { formatDateTime, relativeTime } from '../../lib/format.ts';
import { usePermissions } from '../../lib/hooks.ts';
import { formatBytes, readAsDataUrl, useIntegrationStatus } from '../../lib/integrations.ts';
import { useConfirm, useToast } from '../feedback.tsx';
import { Button, Card, cx, ErrorBanner, IconButton, Loading } from '../ui.tsx';

export function fileIcon(contentType: string): LucideIcon {
  if (contentType.startsWith('image/')) return FileImage;
  if (/spreadsheet|excel|csv/.test(contentType)) return FileSpreadsheet;
  if (/zip|compressed|tar|gzip/.test(contentType)) return FileArchive;
  if (contentType.startsWith('text/') || /pdf|word|document|rtf/.test(contentType)) return FileText;
  return File;
}

export const downloadUrl = (id: string) => `/api/attachments/${encodeURIComponent(id)}`;

export function useRecordFiles(def: ObjectDef, record: CrmRecord) {
  return useQuery({
    queryKey: ['attachments', record.id],
    queryFn: () => api.get<AttachmentDTO[]>(`/api/records/${def.apiName}/${record.id}/attachments`),
  });
}

/** Files of a record: uploaded to it, or attached to its emails. */
export function FilesCard({ def, record }: { def: ObjectDef; record: CrmRecord }) {
  const perms = usePermissions();
  const status = useIntegrationStatus();
  const qc = useQueryClient();
  const toast = useToast();
  const confirm = useConfirm();
  const files = useRecordFiles(def, record);
  const input = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const canEdit = perms.canEdit(def.apiName, record.ownerId);
  const maxBytes = status.data?.attachmentMaxBytes ?? null;

  const refresh = () => Promise.all([qc.invalidateQueries({ queryKey: ['attachments'] }), qc.invalidateQueries({ queryKey: ['timeline'] })]);
  const upload = useMutation({
    mutationFn: async (list: globalThis.File[]) => {
      const big = maxBytes ? list.find((f) => f.size > maxBytes) : undefined;
      if (big && maxBytes) throw new Error(`“${big.name}” is larger than the ${formatBytes(maxBytes)} limit`);
      const done: AttachmentDTO[] = [];
      for (const f of list) {
        done.push(await api.post<AttachmentDTO>(`/api/records/${def.apiName}/${record.id}/attachments`, { fileName: f.name, contentType: f.type || null, data: await readAsDataUrl(f) }));
      }
      return done;
    },
    onSuccess: (done) => toast.success(done.length === 1 ? `“${done[0]!.fileName}” uploaded` : `${done.length} files uploaded`),
    onError: (err) => toast.error(errorMessage(err)),
    onSettled: refresh,
  });
  const remove = useMutation({
    mutationFn: (f: AttachmentDTO) => api.del(downloadUrl(f.id)),
    onSuccess: (_r, f) => toast.success(`“${f.fileName}” deleted`),
    onError: (err) => toast.error(errorMessage(err)),
    onSettled: refresh,
  });

  const pick = (list: FileList | null) => {
    if (list?.length) upload.mutate([...list]);
    if (input.current) input.current.value = '';
  };
  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragging(false);
    if (canEdit) pick(e.dataTransfer.files);
  };
  const onDelete = async (f: AttachmentDTO) => {
    if (await confirm({ title: 'Delete file?', message: `“${f.fileName}” will be permanently deleted.`, confirmLabel: 'Delete', danger: true })) remove.mutate(f);
  };
  const list = files.data ?? [];

  return (
    <Card
      title={
        <span className="flex items-center gap-2">
          <Paperclip className="size-4 text-slate-400" aria-hidden />
          Files{list.length > 0 && <span className="font-normal text-slate-400">({list.length})</span>}
        </span>
      }
      actions={
        canEdit && (
          <Button size="sm" icon={Upload} loading={upload.isPending} onClick={() => input.current?.click()}>
            Upload
          </Button>
        )
      }
      bodyClassName="p-0"
    >
      <input ref={input} type="file" multiple className="hidden" aria-label="Upload files" onChange={(e) => pick(e.target.files)} />
      <div
        onDragOver={(e) => {
          if (!canEdit) return;
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        className={cx('min-h-14', dragging && 'bg-indigo-50/70 ring-2 ring-indigo-300 ring-inset')}
      >
        {files.isLoading ? (
          <Loading />
        ) : files.error ? (
          <ErrorBanner error={files.error} className="m-3" />
        ) : list.length === 0 ? (
          <p className="px-4 py-4 text-center text-sm text-slate-400">{canEdit ? 'No files yet. Drop files here or upload them.' : 'No files yet.'}</p>
        ) : (
          <ul className="divide-y divide-slate-100" aria-label="Files">
            {list.map((f) => {
              const IconCmp = fileIcon(f.contentType);
              return (
                <li key={f.id} className="flex items-center gap-3 px-4 py-2.5">
                  <IconCmp className="size-5 shrink-0 text-slate-400" aria-hidden />
                  <div className="min-w-0 flex-1">
                    <a href={downloadUrl(f.id)} download={f.fileName} className="block truncate text-sm font-medium text-slate-900 hover:text-indigo-600 hover:underline">
                      {f.fileName}
                    </a>
                    <p className="truncate text-xs text-slate-500">
                      {formatBytes(f.size)} ·{' '}
                      {f.activity ? (
                        <>
                          from{' '}
                          <Link to={`/r/${f.activity.id}`} className="hover:text-indigo-600 hover:underline">
                            {f.activity.name}
                          </Link>
                        </>
                      ) : (
                        (f.createdByName ?? 'Someone')
                      )}{' '}
                      · <span title={formatDateTime(f.createdAt)}>{relativeTime(f.createdAt)}</span>
                    </p>
                  </div>
                  {canEdit && !f.activity && <IconButton icon={Trash2} label={`Delete ${f.fileName}`} disabled={remove.isPending} onClick={() => void onDelete(f)} />}
                </li>
              );
            })}
          </ul>
        )}
      </div>
      {canEdit && maxBytes !== null && <p className="border-t border-slate-100 px-4 py-2 text-xs text-slate-400">Up to {formatBytes(maxBytes)} per file.</p>}
    </Card>
  );
}
