import { type AutomationAction, type CrmRecord, expressionIdentifiers, renderTemplate, stringify } from '@titoforce/shared';
import type { MetadataService } from '../platform/metadata.ts';
import type { NotificationService } from '../platform/notifications.ts';
import type { Principal } from '../platform/principal.ts';
import { type RecordService, toFlat } from '../platform/records.ts';
import type { UserService } from '../platform/users.ts';
import type { JobQueue } from '../platform/events.ts';
import { badRequest } from '../util.ts';

export interface ActionContext {
  record: CrmRecord;
  previous: CrmRecord | null;
  /** Principal that performs the actions (automation / approval process). */
  actor: Principal;
  /** The principal whose change triggered the actions. */
  triggeredBy: Principal;
  source: { type: 'automation' | 'approval'; id: string; name: string };
  /** Set when the triggering record has been deleted. */
  deleted?: boolean;
}

/** `depth` is the automation recursion depth of the actor, carried into the agent's own writes. */
export type AgentLauncher = (args: { agentId: string; prompt: string; record: CrmRecord; source: string; depth: number }) => void;
export type ApprovalSubmitter = (actor: Principal, record: CrmRecord, processId: string | undefined, comment: string | undefined) => Promise<unknown>;

const WEBHOOK_TIMEOUT_MS = 10_000;

/** Executes automation / approval actions. Shared by flows and approval processes. */
export class ActionExecutor {
  private records: RecordService;
  private metadata: MetadataService;
  private users: UserService;
  private notifications: NotificationService;
  private jobs: JobQueue;
  launchAgent: AgentLauncher | null = null;
  submitApproval: ApprovalSubmitter | null = null;
  fetchImpl: typeof fetch = (...args) => fetch(...args);

  constructor(records: RecordService, metadata: MetadataService, users: UserService, notifications: NotificationService, jobs: JobQueue) {
    this.records = records;
    this.metadata = metadata;
    this.users = users;
    this.notifications = notifications;
    this.jobs = jobs;
  }

  reload(id: string): Promise<CrmRecord | undefined> {
    return this.records.getRaw(id);
  }

  /** Template context: {{record.x}}, {{previous.x}}, {{related.<lookup>.x}}, {{user.name}}. */
  async templateContext(ctx: ActionContext): Promise<Record<string, unknown>> {
    const def = this.metadata.get(ctx.record.object);
    const related: Record<string, unknown> = {};
    for (const f of def?.fields ?? []) {
      const v = ctx.record.fields[f.apiName];
      if (f.type === 'lookup' && typeof v === 'string') {
        const rec = await this.records.getRaw(v);
        if (rec) related[f.apiName] = toFlat(rec);
      } else if (f.type === 'user' && typeof v === 'string') {
        const u = await this.users.getUser(v);
        if (u) related[f.apiName] = { id: u.id, name: u.name, email: u.email };
      }
    }
    const owner = ctx.record.ownerId ? await this.users.getUser(ctx.record.ownerId) : undefined;
    return {
      record: toFlat(ctx.record),
      previous: ctx.previous ? toFlat(ctx.previous) : null,
      related,
      owner: owner ? { id: owner.id, name: owner.name, email: owner.email } : null,
      user: { id: ctx.triggeredBy.userId, name: ctx.triggeredBy.name },
    };
  }

  private renderFields(fields: Record<string, unknown>, tctx: Record<string, unknown>): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(fields ?? {})) out[k] = renderTemplate(v, tctx);
    return out;
  }

  private async recipients(spec: string, ctx: ActionContext): Promise<string[]> {
    const [kind, value] = spec.includes(':') ? [spec.slice(0, spec.indexOf(':')), spec.slice(spec.indexOf(':') + 1)] : [spec, ''];
    switch (kind) {
      case 'owner':
        return ctx.record.ownerId ? [ctx.record.ownerId] : [];
      case 'triggering_user':
        return ctx.triggeredBy.userId ? [ctx.triggeredBy.userId] : [];
      case 'user':
        return value ? [value] : [];
      case 'role':
        return (await this.users.usersWithRole(value)).filter((u) => !u.isAgent).map((u) => u.id);
      case 'field': {
        const v = ctx.record.fields[value];
        return typeof v === 'string' ? [v] : [];
      }
      default:
        return [];
    }
  }

  async execute(actions: AutomationAction[], ctx: ActionContext): Promise<{ type: string; result: unknown }[]> {
    const results: { type: string; result: unknown }[] = [];
    let tctx = await this.templateContext(ctx);
    for (const action of actions) {
      const result = await this.executeOne(action, ctx, tctx);
      results.push({ type: action.type, result });
      if (action.type === 'update_record' || action.type === 'update_related') {
        // Later actions see the updated values.
        const fresh = ctx.deleted ? undefined : await this.records.getRaw(ctx.record.id);
        if (fresh) {
          ctx = { ...ctx, record: fresh };
          tctx = await this.templateContext(ctx);
        }
      }
    }
    return results;
  }

  private async executeOne(action: AutomationAction, ctx: ActionContext, tctx: Record<string, unknown>): Promise<unknown> {
    const { record } = ctx;
    switch (action.type) {
      case 'update_record': {
        if (ctx.deleted) return { skipped: 'record deleted' };
        const fields = this.renderFields(action.fields, tctx);
        const updated = await this.records.update(ctx.actor, record.object, record.id, fields);
        return { recordId: updated.id, fields: Object.keys(fields) };
      }
      case 'update_related': {
        const targetId = record.fields[action.lookupField];
        if (typeof targetId !== 'string') return { skipped: `${action.lookupField} is empty` };
        const target = await this.records.getRaw(targetId);
        if (!target) return { skipped: 'related record not found' };
        const fields = this.renderFields(action.fields, tctx);
        await this.records.update(ctx.actor, target.object, target.id, fields);
        return { recordId: target.id, fields: Object.keys(fields) };
      }
      case 'create_record': {
        const fields = this.renderFields(action.fields, tctx);
        if (!('owner_id' in fields) && record.ownerId) fields.owner_id = record.ownerId;
        const created = await this.records.create(ctx.actor, action.object, fields);
        return { recordId: created.id, object: created.object, name: created.name };
      }
      case 'notify': {
        const to = await this.recipients(action.to, ctx);
        const title = stringify(renderTemplate(action.title, tctx));
        const body = action.body ? stringify(renderTemplate(action.body, tctx)) : null;
        await this.notifications.notify(to, title, body, ctx.deleted ? null : `/r/${record.id}`);
        return { notified: to.length };
      }
      case 'run_agent': {
        if (!this.launchAgent) return { skipped: 'agents unavailable' };
        if (ctx.deleted) return { skipped: 'record deleted' };
        const prompt = stringify(renderTemplate(action.prompt, tctx));
        this.launchAgent({ agentId: action.agentId, prompt, record, source: `${ctx.source.type}:${ctx.source.name}`, depth: ctx.actor.depth ?? 1 });
        return { queued: true, agentId: action.agentId };
      }
      case 'webhook': {
        const payload = {
          event: ctx.deleted ? 'deleted' : ctx.previous ? 'updated' : 'created',
          source: ctx.source,
          object: record.object,
          record: tctx.record,
          previous: tctx.previous,
          at: new Date().toISOString(),
        };
        const url = action.url;
        this.jobs.enqueue(`webhook ${url}`, async () => {
          const res = await this.fetchImpl(url, {
            method: action.method ?? 'POST',
            headers: { 'content-type': 'application/json', 'user-agent': 'titoForce-webhook/1.0' },
            body: JSON.stringify(payload),
            signal: AbortSignal.timeout(WEBHOOK_TIMEOUT_MS),
            redirect: 'manual',
          });
          if (!res.ok) throw new Error(`Webhook ${url} responded ${res.status}`);
        });
        return { queued: true, url };
      }
      case 'submit_approval': {
        if (!this.submitApproval) return { skipped: 'approvals unavailable' };
        if (ctx.deleted) return { skipped: 'record deleted' };
        const comment = action.comment ? stringify(renderTemplate(action.comment, tctx)) : undefined;
        const req = await this.submitApproval(ctx.actor, record, action.processId, comment);
        return { submitted: true, request: (req as { id?: string } | null)?.id ?? null };
      }
      default:
        throw badRequest(`Unknown action ${(action as { type: string }).type}`);
    }
  }

  /** Static validation of actions for the given source object. */
  validate(object: string, actions: AutomationAction[], agentIds: Set<string>): void {
    if (!Array.isArray(actions)) throw badRequest('Actions must be a list');
    if (actions.length > 20) throw badRequest('At most 20 actions are allowed');
    const def = this.metadata.require(object);
    const checkTemplates = (values: unknown[]) => {
      for (const v of values) {
        if (typeof v !== 'string') continue;
        for (const m of v.matchAll(/\{\{([\s\S]+?)\}\}/g)) {
          try {
            expressionIdentifiers(m[1]!.trim());
          } catch (e) {
            throw badRequest(`Invalid template "${m[0]}": ${(e as Error).message}`);
          }
        }
      }
    };
    const checkFields = (target: string, fields: Record<string, unknown>) => {
      const t = this.metadata.require(target);
      if (!fields || typeof fields !== 'object' || !Object.keys(fields).length) throw badRequest('Choose at least one field to set');
      for (const k of Object.keys(fields)) {
        if (k === 'owner_id') continue;
        const f = t.fields.find((x) => x.apiName === k);
        if (!f) throw badRequest(`Unknown field ${k} on ${t.label}`);
        if (f.type === 'formula' || f.type === 'rollup') throw badRequest(`${f.label} is calculated and cannot be set`);
      }
      checkTemplates(Object.values(fields));
    };
    for (const a of actions) {
      switch (a.type) {
        case 'update_record':
          checkFields(object, a.fields);
          break;
        case 'update_related': {
          const lf = def.fields.find((f) => f.apiName === a.lookupField);
          if (!lf || lf.type !== 'lookup') throw badRequest(`${a.lookupField} is not a lookup on ${def.label}`);
          if (lf.referenceTo && lf.referenceTo !== '*') checkFields(lf.referenceTo, a.fields);
          else checkTemplates(Object.values(a.fields ?? {}));
          break;
        }
        case 'create_record':
          checkFields(a.object, a.fields);
          break;
        case 'notify':
          if (!a.title?.trim()) throw badRequest('Notifications need a title');
          if (!/^(owner|triggering_user|user:[a-z0-9_]+|role:[a-z0-9_]+|field:[a-z][a-z0-9_]*)$/.test(a.to)) throw badRequest(`Invalid recipient "${a.to}"`);
          checkTemplates([a.title, a.body]);
          break;
        case 'run_agent':
          if (!agentIds.has(a.agentId)) throw badRequest(`Unknown agent ${a.agentId}`);
          if (!a.prompt?.trim()) throw badRequest('Agent actions need a prompt');
          checkTemplates([a.prompt]);
          break;
        case 'webhook': {
          let u: URL;
          try {
            u = new URL(a.url);
          } catch {
            throw badRequest('Webhook URL is invalid');
          }
          if (u.protocol !== 'https:' && u.protocol !== 'http:') throw badRequest('Webhook URL must use http(s)');
          break;
        }
        case 'submit_approval':
          checkTemplates([a.comment]);
          break;
        default:
          throw badRequest(`Unknown action type ${(a as { type: string }).type}`);
      }
    }
  }
}
