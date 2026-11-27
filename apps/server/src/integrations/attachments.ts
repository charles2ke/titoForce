import type { AttachmentDTO, AttachmentRef, CrmRecord } from '@titoforce/shared';
import { type Db, toBuffer } from '../db/database.ts';
import { objectPermission, type Principal } from '../platform/principal.ts';
import type { RecordService } from '../platform/records.ts';
import { badRequest, chunk, forbidden, newId, notFound, nowIso, placeholders } from '../util.ts';
import { sha256 } from './crypto.ts';

interface AttachmentRow {
  id: string;
  record_id: string;
  file_name: string;
  content_type: string;
  size: number;
  source: string;
  created_by: string | null;
  created_by_name?: string | null;
  created_at: string;
}

export interface FileContent {
  fileName: string;
  contentType: string;
  data: Buffer;
}

const CONTENT_TYPE_RE = /^[\w.+-]+\/[\w.+-]+$/;
/** Types a browser could execute or render as a page; always downloaded as opaque bytes. */
const ACTIVE_TYPES = new Set(['text/html', 'application/xhtml+xml', 'image/svg+xml', 'text/xml', 'application/xml', 'text/javascript', 'application/javascript']);

export function safeContentType(value: unknown): string {
  const t = typeof value === 'string' ? (value.split(';')[0] ?? '').trim().toLowerCase() : '';
  return t.length <= 100 && CONTENT_TYPE_RE.test(t) ? t : 'application/octet-stream';
}

/** Content type to serve a stored file with (active content is never served under its own type). */
export const downloadContentType = (stored: string): string => (ACTIVE_TYPES.has(stored) ? 'application/octet-stream' : stored);

export function safeFileName(value: unknown): string {
  const name = String(value ?? '').replace(/[\u0000-\u001f\u007f/\\]+/g, '_').replace(/^[.\s]+/, '').trim();
  if (!name) return 'file';
  if (name.length <= 200) return name;
  const dot = name.lastIndexOf('.');
  const ext = dot > 0 && name.length - dot <= 16 ? name.slice(dot) : '';
  return name.slice(0, 200 - ext.length) + ext;
}

const toRef = (r: AttachmentRow): AttachmentRef => ({ id: r.id, fileName: r.file_name, contentType: r.content_type, size: Number(r.size) });

/** Files stored in the database and attached to records (including activities such as logged emails). */
export class AttachmentService {
  private db: Db;
  private records: RecordService;
  readonly maxBytes: number;

  constructor(db: Db, records: RecordService, maxBytes: number) {
    this.db = db;
    this.records = records;
    this.maxBytes = maxBytes;
  }

  /** Readable activity ids (and names) related to a record. */
  private async activitiesOf(principal: Principal, recordId: string): Promise<Map<string, string>> {
    if (objectPermission(principal, 'activity').read === 'none') return new Map();
    const res = await this.records.query(principal, 'activity', {
      filters: { match: 'all', rules: [{ field: 'related_to', op: 'eq', value: recordId }] },
      pageSize: 500,
    });
    return new Map(res.records.map((r) => [r.id, r.name]));
  }

  /** Files on a record and on its activities, newest first. */
  async list(principal: Principal, object: string, id: string): Promise<AttachmentDTO[]> {
    await this.records.get(principal, object, id);
    const activities = await this.activitiesOf(principal, id);
    const out: AttachmentDTO[] = [];
    for (const part of chunk([id, ...activities.keys()], 300)) {
      const rows = await this.db.all<AttachmentRow>(
        `SELECT a.id, a.record_id, a.file_name, a.content_type, a.size, a.source, a.created_by, a.created_at, u.name AS created_by_name
         FROM attachments a LEFT JOIN users u ON u.id = a.created_by WHERE a.record_id IN (${placeholders(part.length)})`,
        part,
      );
      for (const r of rows) {
        out.push({
          ...toRef(r),
          recordId: r.record_id,
          source: r.source === 'email' ? 'email' : 'upload',
          createdBy: r.created_by,
          createdByName: r.created_by_name ?? null,
          createdAt: r.created_at,
          activity: r.record_id === id ? null : { id: r.record_id, name: activities.get(r.record_id) ?? '' },
        });
      }
    }
    return out.sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0));
  }

  /** Attachment references per record id (for timelines). Callers must already have checked read access to the records. */
  async refsFor(recordIds: string[]): Promise<Map<string, AttachmentRef[]>> {
    const out = new Map<string, AttachmentRef[]>();
    for (const part of chunk(recordIds, 300)) {
      const rows = await this.db.all<AttachmentRow>(
        `SELECT id, record_id, file_name, content_type, size, source, created_by, created_at FROM attachments WHERE record_id IN (${placeholders(part.length)}) ORDER BY created_at`,
        part,
      );
      for (const r of rows) out.set(r.record_id, [...(out.get(r.record_id) ?? []), toRef(r)]);
    }
    return out;
  }

  /** Decodes a base64 upload (a data: URL prefix is accepted) and checks the size limit. */
  decode(base64: string): Buffer {
    const clean = base64.replace(/^data:[^,]*;base64,/, '').replace(/\s+/g, '');
    if (!/^[A-Za-z0-9+/]*={0,2}$/.test(clean)) throw badRequest('The file data must be base64 encoded');
    if (Math.floor((clean.length * 3) / 4) > this.maxBytes + 3) throw this.tooLarge();
    const data = Buffer.from(clean, 'base64');
    if (!data.length) throw badRequest('The file is empty');
    if (data.length > this.maxBytes) throw this.tooLarge();
    return data;
  }

  private tooLarge() {
    return badRequest(`Files can be at most ${Math.round((this.maxBytes / 1024 / 1024) * 10) / 10} MB`);
  }

  async upload(principal: Principal, object: string, id: string, file: { fileName: string; contentType?: string | null; data: string }): Promise<AttachmentDTO> {
    const rec = await this.records.get(principal, object, id);
    if (!rec.access?.edit) throw forbidden(`You cannot edit this ${rec.object} record`);
    const data = this.decode(file.data);
    const [ref] = await this.store(this.db, rec.id, [{ fileName: file.fileName, contentType: file.contentType ?? '', data }], 'upload', principal.userId);
    return { ...ref!, recordId: rec.id, source: 'upload', createdBy: principal.userId, createdByName: principal.name, activity: null };
  }

  /** Stores files on a record (the caller has checked access). Pass a transaction handle to write inside it. */
  async store(db: Db, recordId: string, files: FileContent[], source: 'upload' | 'email', createdBy: string | null): Promise<(AttachmentRef & { createdAt: string })[]> {
    const refs: (AttachmentRef & { createdAt: string })[] = [];
    const createdAt = nowIso();
    const write = async (tx: Db) => {
      for (const f of files) {
        const id = newId('att');
        const fileName = safeFileName(f.fileName);
        const contentType = safeContentType(f.contentType);
        await tx.run(
          'INSERT INTO attachments (id, record_id, file_name, content_type, size, sha256, source, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
          [id, recordId, fileName, contentType, f.data.length, sha256(f.data), source, createdBy, createdAt],
        );
        await tx.run('INSERT INTO attachment_contents (attachment_id, data) VALUES (?, ?)', [id, f.data]);
        refs.push({ id, fileName, contentType, size: f.data.length, createdAt });
      }
    };
    await db.transaction(write);
    return refs;
  }

  private async findReadable(principal: Principal, id: string): Promise<{ row: AttachmentRow; record: CrmRecord }> {
    const row = await this.db.get<AttachmentRow>('SELECT id, record_id, file_name, content_type, size, source, created_by, created_at FROM attachments WHERE id = ?', [id]);
    if (!row) throw notFound('File not found');
    try {
      return { row, record: await this.records.get(principal, null, row.record_id) };
    } catch {
      throw notFound('File not found');
    }
  }

  /** File contents, if the principal can read the record the file is attached to. */
  async read(principal: Principal, id: string): Promise<FileContent & { id: string; size: number }> {
    const { row } = await this.findReadable(principal, id);
    const content = await this.db.get<{ data: unknown }>('SELECT data FROM attachment_contents WHERE attachment_id = ?', [id]);
    if (!content) throw notFound('File not found');
    return { id: row.id, fileName: row.file_name, contentType: row.content_type, size: Number(row.size), data: toBuffer(content.data) };
  }

  async delete(principal: Principal, id: string): Promise<void> {
    const { record } = await this.findReadable(principal, id);
    if (!record.access?.edit) throw forbidden(`You cannot edit this ${record.object} record`);
    await this.db.run('DELETE FROM attachments WHERE id = ?', [id]);
  }
}
