import { type ApprovalProcessDef, type ApprovalRequest, type ApprovalStatus, type CrmRecord, matchesFilter } from '@titoforce/shared';
import { type Db, parseJson } from '../db/database.ts';
import type { EventBus } from '../platform/events.ts';
import type { MetadataService } from '../platform/metadata.ts';
import type { NotificationService } from '../platform/notifications.ts';
import { canRead, type Principal } from '../platform/principal.ts';
import { type RecordService, toFlat } from '../platform/records.ts';
import type { UserService } from '../platform/users.ts';
import { AppError, badRequest, conflict, forbidden, newId, notFound, nowIso } from '../util.ts';
import type { ActionExecutor } from './actions.ts';
import { fieldTypes, validateFilter } from './engine.ts';

export type ApprovalProcessInput = Omit<ApprovalProcessDef, 'id'>;

interface RequestRow {
  id: string;
  process_id: string;
  record_id: string;
  object_api_name: string;
  submitted_by: string;
  approver_id: string;
  status: ApprovalStatus;
  comment: string | null;
  decision_comment: string | null;
  created_at: string;
  decided_at: string | null;
}

export class ApprovalService {
  private db: Db;
  private metadata: MetadataService;
  private records: RecordService;
  private users: UserService;
  private notifications: NotificationService;
  private executor: ActionExecutor;

  constructor(db: Db, metadata: MetadataService, records: RecordService, users: UserService, notifications: NotificationService, executor: ActionExecutor, events: EventBus) {
    this.db = db;
    this.metadata = metadata;
    this.records = records;
    this.users = users;
    this.notifications = notifications;
    this.executor = executor;
    executor.submitApproval = (actor, record, processId, comment) => this.submitRecord(actor, record, processId, comment);
    events.on(async (e) => {
      if (e.type === 'deleted') {
        await this.db.run(`UPDATE approval_requests SET status = 'recalled', decided_at = ? WHERE record_id = ? AND status = 'pending'`, [nowIso(), e.record.id]);
      }
    });
  }

  // ---------- processes ----------

  async listProcesses(object?: string): Promise<ApprovalProcessDef[]> {
    const rows = await this.db.all<{ id: string; object_api_name: string; active: number; definition: unknown }>(
      `SELECT * FROM approval_processes ${object ? 'WHERE object_api_name = ?' : ''} ORDER BY created_at`,
      object ? [object] : [],
    );
    return rows.map((r) => ({ ...parseJson<ApprovalProcessInput>(r.definition, {} as ApprovalProcessInput), id: r.id, object: r.object_api_name, active: !!Number(r.active) }));
  }

  async getProcess(id: string): Promise<ApprovalProcessDef> {
    const p = (await this.listProcesses()).find((x) => x.id === id);
    if (!p) throw notFound('Approval process not found');
    return p;
  }

  async validateProcess(input: ApprovalProcessInput): Promise<ApprovalProcessInput> {
    if (!input.name?.trim()) throw badRequest('Name is required');
    const def = this.metadata.require(input.object);
    validateFilter(this.metadata, input.object, input.entryConditions);
    const a = input.approver;
    if (!a || (a.type !== 'user' && a.type !== 'field')) throw badRequest('Choose an approver');
    if (a.type === 'user' && !(await this.users.getUser(a.userId))) throw badRequest('Unknown approver');
    if (a.type === 'field') {
      if (!/^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*){0,4}$/.test(a.path ?? '')) throw badRequest('Invalid approver field path');
      const first = a.path.split('.')[0]!;
      if (first !== 'owner_id' && !def.fields.some((f) => f.apiName === first)) throw badRequest(`Unknown field ${first}`);
      if (a.fallbackUserId && !(await this.users.getUser(a.fallbackUserId))) throw badRequest('Unknown fallback approver');
    }
    for (const list of [input.onSubmit ?? [], input.onApprove ?? [], input.onReject ?? []]) this.executor.validate(input.object, list, new Set());
    return {
      name: input.name.trim(),
      description: input.description ?? '',
      object: input.object,
      entryConditions: input.entryConditions?.rules?.length ? input.entryConditions : null,
      approver: a,
      onSubmit: input.onSubmit ?? [],
      onApprove: input.onApprove ?? [],
      onReject: input.onReject ?? [],
      active: input.active !== false,
    };
  }

  async createProcess(input: ApprovalProcessInput): Promise<ApprovalProcessDef> {
    const p = await this.validateProcess(input);
    const id = newId('apr');
    const now = nowIso();
    await this.db.run('INSERT INTO approval_processes (id, object_api_name, active, definition, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)', [
      id,
      p.object,
      p.active ? 1 : 0,
      JSON.stringify(p),
      now,
      now,
    ]);
    return this.getProcess(id);
  }

  async updateProcess(id: string, input: Partial<ApprovalProcessInput>): Promise<ApprovalProcessDef> {
    const { id: _id, ...current } = await this.getProcess(id);
    const p = await this.validateProcess({ ...current, ...input, object: current.object });
    await this.db.run('UPDATE approval_processes SET active = ?, definition = ?, updated_at = ? WHERE id = ?', [p.active ? 1 : 0, JSON.stringify(p), nowIso(), id]);
    return this.getProcess(id);
  }

  async deleteProcess(id: string): Promise<void> {
    await this.getProcess(id);
    const pending = await this.db.get<{ c: number }>(`SELECT COUNT(*) AS c FROM approval_requests WHERE process_id = ? AND status = 'pending'`, [id]);
    if (Number(pending?.c ?? 0) > 0) throw conflict('This process has pending requests; resolve them first');
    await this.db.run('DELETE FROM approval_processes WHERE id = ?', [id]);
  }

  // ---------- requests ----------

  private async toDto(rows: RequestRow[]): Promise<ApprovalRequest[]> {
    if (!rows.length) return [];
    const processes = new Map((await this.listProcesses()).map((p) => [p.id, p.name]));
    const users = new Map((await this.users.listUsers()).map((u) => [u.id, u.name]));
    const out: ApprovalRequest[] = [];
    for (const r of rows) {
      const rec = await this.records.getRaw(r.record_id);
      out.push({
        id: r.id,
        processId: r.process_id,
        processName: processes.get(r.process_id) ?? '(deleted process)',
        recordId: r.record_id,
        object: r.object_api_name,
        recordName: rec?.name ?? '(deleted record)',
        submittedBy: r.submitted_by,
        submittedByName: users.get(r.submitted_by) ?? 'Automation',
        approverId: r.approver_id,
        approverName: users.get(r.approver_id) ?? 'Unknown',
        status: r.status,
        comment: r.comment,
        decisionComment: r.decision_comment,
        createdAt: r.created_at,
        decidedAt: r.decided_at,
      });
    }
    return out;
  }

  async listRequests(principal: Principal, filter: { scope?: 'to_me' | 'mine' | 'all'; status?: ApprovalStatus | 'any'; recordId?: string } = {}): Promise<ApprovalRequest[]> {
    const where: string[] = [];
    const params: string[] = [];
    const isAdmin = !principal.permissions || principal.permissions.setup;
    const scope = filter.scope ?? 'to_me';
    if (scope === 'to_me') {
      where.push('approver_id = ?');
      params.push(principal.userId ?? '-');
    } else if (scope === 'mine') {
      where.push('submitted_by = ?');
      params.push(principal.userId ?? '-');
    } else if (!isAdmin && !filter.recordId) {
      where.push('(approver_id = ? OR submitted_by = ?)');
      params.push(principal.userId ?? '-', principal.userId ?? '-');
    }
    if (filter.status && filter.status !== 'any') {
      where.push('status = ?');
      params.push(filter.status);
    }
    if (filter.recordId) {
      await this.records.get(principal, null, filter.recordId);
      where.push('record_id = ?');
      params.push(filter.recordId);
    }
    const rows = await this.db.all<RequestRow>(`SELECT * FROM approval_requests ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY created_at DESC LIMIT 200`, params);
    return this.toDto(rows);
  }

  async getRequest(id: string): Promise<ApprovalRequest> {
    const row = await this.db.get<RequestRow>('SELECT * FROM approval_requests WHERE id = ?', [id]);
    if (!row) throw notFound('Approval request not found');
    return (await this.toDto([row]))[0]!;
  }

  /** Resolves an approver from a field path such as "employee.manager.user" or "owner_id". */
  async resolveApprover(process: ApprovalProcessDef, record: CrmRecord): Promise<string | null> {
    const a = process.approver;
    if (a.type === 'user') return a.userId;
    const parts = a.path.split('.');
    let current: CrmRecord | undefined = record;
    for (const [i, seg] of parts.entries()) {
      if (!current) break;
      const last = i === parts.length - 1;
      const v: unknown = seg === 'owner_id' ? current.ownerId : current.fields[seg];
      if (typeof v !== 'string') {
        current = undefined;
        break;
      }
      if (last) {
        const user = await this.users.getUser(v);
        if (user?.active) return user.id;
        break;
      }
      current = await this.records.getRaw(v);
    }
    return a.fallbackUserId ?? null;
  }

  async submit(principal: Principal, recordId: string, opts: { processId?: string; comment?: string } = {}): Promise<ApprovalRequest> {
    const rec = await this.records.get(principal, null, recordId);
    const raw = (await this.records.getRaw(recordId))!;
    if (principal.permissions && !canRead(principal, rec.object, rec.ownerId)) throw forbidden();
    return this.submitRecord(principal, raw, opts.processId, opts.comment);
  }

  async submitRecord(principal: Principal, record: CrmRecord, processId?: string, comment?: string): Promise<ApprovalRequest> {
    const processes = (await this.listProcesses(record.object)).filter((p) => p.active && (!processId || p.id === processId));
    const types = fieldTypes(this.metadata, record.object);
    const process = processes.find((p) => matchesFilter(p.entryConditions, toFlat(record), { types, currentUserId: principal.userId }));
    if (!process) {
      throw new AppError(400, 'no_approval_process', processes.length ? 'This record does not meet the entry criteria of any approval process' : 'No active approval process applies to this record');
    }
    const pending = await this.db.get('SELECT id FROM approval_requests WHERE record_id = ? AND status = ?', [record.id, 'pending']);
    if (pending) throw conflict('This record already has a pending approval request');
    const approverId = await this.resolveApprover(process, record);
    if (!approverId) throw badRequest('No approver could be determined for this record');

    const id = newId('req');
    const submittedBy = principal.userId ?? record.ownerId ?? approverId;
    await this.db.run(
      `INSERT INTO approval_requests (id, process_id, record_id, object_api_name, submitted_by, approver_id, status, comment, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?)`,
      [id, process.id, record.id, record.object, submittedBy, approverId, comment?.trim() || null, nowIso()],
    );
    await this.runActions(process, process.onSubmit, record, principal);
    const def = this.metadata.get(record.object);
    await this.notifications.notify([approverId], `Approval requested: ${record.name}`, `${principal.name} submitted this ${def?.label.toLowerCase() ?? 'record'} for "${process.name}".${comment ? ` "${comment}"` : ''}`, '/approvals');
    return this.getRequest(id);
  }

  private async runActions(process: ApprovalProcessDef, actions: ApprovalProcessDef['onApprove'], record: CrmRecord, triggeredBy: Principal): Promise<void> {
    if (!actions.length) return;
    const actor: Principal = { type: 'approval', userId: null, name: `Approval: ${process.name}`, permissions: null, depth: (triggeredBy.depth ?? 0) + 1 };
    const fresh = (await this.records.getRaw(record.id)) ?? record;
    await this.executor.execute(actions, { record: fresh, previous: null, actor, triggeredBy, source: { type: 'approval', id: process.id, name: process.name } });
  }

  async decide(principal: Principal, requestId: string, decision: 'approve' | 'reject', comment?: string): Promise<ApprovalRequest> {
    const row = await this.db.get<RequestRow>('SELECT * FROM approval_requests WHERE id = ?', [requestId]);
    if (!row) throw notFound('Approval request not found');
    if (row.status !== 'pending') throw conflict(`This request is already ${row.status}`);
    const isAdmin = !principal.permissions || principal.permissions.setup;
    if (row.approver_id !== principal.userId && !isAdmin) throw forbidden('Only the assigned approver can decide this request');
    const status: ApprovalStatus = decision === 'approve' ? 'approved' : 'rejected';
    const res = await this.db.run(`UPDATE approval_requests SET status = ?, decision_comment = ?, decided_at = ?, decided_by = ? WHERE id = ? AND status = 'pending'`, [
      status,
      comment?.trim() || null,
      nowIso(),
      principal.userId,
      requestId,
    ]);
    if (!res.changes) throw conflict('This request was already decided');
    const process = await this.getProcess(row.process_id).catch(() => null);
    const record = await this.records.getRaw(row.record_id);
    if (process && record) {
      await this.runActions(process, decision === 'approve' ? process.onApprove : process.onReject, record, principal);
      await this.notifications.notify(
        [row.submitted_by],
        `${record.name} was ${status}`,
        `${principal.name} ${status} your request "${process.name}".${comment ? ` "${comment}"` : ''}`,
        `/r/${record.id}`,
      );
    }
    return this.getRequest(requestId);
  }

  async recall(principal: Principal, requestId: string): Promise<ApprovalRequest> {
    const row = await this.db.get<RequestRow>('SELECT * FROM approval_requests WHERE id = ?', [requestId]);
    if (!row) throw notFound('Approval request not found');
    if (row.status !== 'pending') throw conflict(`This request is already ${row.status}`);
    const isAdmin = !principal.permissions || principal.permissions.setup;
    if (row.submitted_by !== principal.userId && !isAdmin) throw forbidden('Only the submitter can recall this request');
    await this.db.run(`UPDATE approval_requests SET status = 'recalled', decided_at = ?, decided_by = ? WHERE id = ?`, [nowIso(), principal.userId, requestId]);
    return this.getRequest(requestId);
  }
}
